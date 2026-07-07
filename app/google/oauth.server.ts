/**
 * Google OAuth 2.0 client — the side where Logbook authenticates *to* Google
 * so it can write into the user's Drive. Plain `fetch` against Google's
 * endpoints (no `googleapis` SDK, which isn't Workers-friendly), so this runs
 * unchanged on Cloudflare Workers and Node.
 *
 * Credentials come from env (process.env works on Workers with nodejs_compat,
 * same as SESSION_SECRET): GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET.
 * The redirect URI is derived per-request from the app origin and passed in.
 *
 * Scope is `drive.file` — Logbook can only access files it creates — plus
 * `openid email` so we can show which Google account is connected.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "openid",
  "email",
].join(" ");

export type GoogleTokens = {
  accessToken: string;
  /** Present only on the first consent (access_type=offline + prompt=consent). */
  refreshToken: string | null;
  expiresInSeconds: number;
  scope: string;
  /** Connected Google account email, decoded from the id_token when present. */
  email: string | null;
};

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Drive is not configured (set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET)",
    );
  }
  return { clientId, clientSecret };
}

/** True when the server has Google OAuth credentials configured. */
export function isGoogleDriveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

/**
 * Build the consent-screen URL. `access_type=offline` + `prompt=consent`
 * force Google to return a refresh token even on re-connect, so a user who
 * revoked access can reconnect cleanly.
 */
export function buildAuthUrl({
  redirectUri,
  state,
}: {
  redirectUri: string;
  state: string;
}): string {
  const { clientId } = clientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<GoogleTokens> {
  const { clientId, clientSecret } = clientCredentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
    id_token?: string;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresInSeconds: data.expires_in,
    scope: data.scope,
    email: data.id_token ? emailFromIdToken(data.id_token) : null,
  };
}

/** Trade a stored refresh token for a fresh access token. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const { clientId, clientSecret } = clientCredentials();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

/** Best-effort revoke at Google (disconnect). Never throws. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // The local connection is removed regardless; a failed revoke is harmless.
  }
}

/**
 * Pull the `email` claim out of an id_token. The token came straight from
 * Google's TLS-protected token endpoint, so we trust the payload without
 * verifying the signature (we never accept id_tokens from elsewhere).
 */
function emailFromIdToken(idToken: string): string | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}
