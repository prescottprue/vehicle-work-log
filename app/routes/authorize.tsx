import type {
  AuthRequest,
  ClientInfo,
} from "@cloudflare/workers-oauth-provider";
import { createFileRoute } from "@tanstack/react-router";

import { useAppSession } from "~/auth/session.server";
import { getOAuthHelpers } from "~/mcp/oauth-context.server";
import { getUserById } from "~/models/user.server";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/**
 * The MCP client (e.g. claude.ai) registered itself via dynamic client
 * registration, so the only trust signal we can show is what it claimed
 * about itself plus the redirect host. Scopes are not granular yet — a
 * grant means "act as you in Logbook".
 */
function consentPage({
  client,
  authRequest,
  email,
}: {
  client: ClientInfo;
  authRequest: AuthRequest;
  email: string;
}): string {
  const clientName = escapeHtml(client.clientName ?? client.clientId);
  const redirectHost = escapeHtml(new URL(authRequest.redirectUri).host);
  const reqInfo = escapeHtml(JSON.stringify(authRequest));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize ${clientName} — Logbook</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0f172a; color: #e2e8f0; font: 16px/1.5 system-ui, sans-serif; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 2rem;
          max-width: 26rem; margin: 1rem; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p { color: #94a3b8; font-size: 0.9rem; }
  ul { color: #cbd5e1; font-size: 0.9rem; padding-left: 1.25rem; }
  .who { color: #e2e8f0; font-weight: 600; }
  .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
  button { flex: 1; border: 0; border-radius: 8px; padding: 0.6rem 1rem; font-size: 0.95rem;
           cursor: pointer; }
  .approve { background: #2563eb; color: white; }
  .deny { background: #334155; color: #e2e8f0; }
</style>
</head>
<body>
<main class="card">
  <h1>🔧 Connect to Logbook</h1>
  <p><span class="who">${clientName}</span> (redirects to <code>${redirectHost}</code>)
     is asking to access Logbook as <span class="who">${escapeHtml(email)}</span>.</p>
  <p>It will be able to:</p>
  <ul>
    <li>See your vehicles, logs, reminders, and projects</li>
    <li>Log completed work and odometer entries</li>
    <li>Complete reminders and update project parts</li>
  </ul>
  <form method="post">
    <input type="hidden" name="oauth_req_info" value="${reqInfo}" />
    <div class="actions">
      <button class="deny" type="submit" name="decision" value="deny">Deny</button>
      <button class="approve" type="submit" name="decision" value="approve">Approve</button>
    </div>
  </form>
</main>
</body>
</html>`;
}

export const Route = createFileRoute("/authorize")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const oauth = getOAuthHelpers();
        let authRequest: AuthRequest;
        try {
          authRequest = await oauth.parseAuthRequest(request);
        } catch {
          return html("<h1>Invalid authorization request</h1>", 400);
        }
        const client = await oauth.lookupClient(authRequest.clientId);
        if (!client) return html("<h1>Unknown OAuth client</h1>", 400);

        const session = await useAppSession();
        const userId = session.data.userId;
        if (!userId) {
          const url = new URL(request.url);
          return redirect(
            `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`,
          );
        }
        const user = await getUserById(userId);
        if (!user) return html("<h1>Account not found</h1>", 403);

        return html(consentPage({ client, authRequest, email: user.email }));
      },

      POST: async ({ request }: { request: Request }) => {
        const oauth = getOAuthHelpers();
        const session = await useAppSession();
        const userId = session.data.userId;
        if (!userId) return new Response("Unauthorized", { status: 401 });

        const form = await request.formData();
        let authRequest: AuthRequest;
        try {
          authRequest = JSON.parse(String(form.get("oauth_req_info")));
        } catch {
          return html("<h1>Invalid authorization request</h1>", 400);
        }

        // Re-validate against the registered client so a forged form post
        // can't mint a code for an arbitrary redirect target.
        const client = await oauth.lookupClient(authRequest.clientId);
        if (!client || !client.redirectUris.includes(authRequest.redirectUri)) {
          return html("<h1>Invalid OAuth client</h1>", 400);
        }

        if (form.get("decision") !== "approve") {
          const deny = new URL(authRequest.redirectUri);
          deny.searchParams.set("error", "access_denied");
          if (authRequest.state)
            deny.searchParams.set("state", authRequest.state);
          return redirect(deny.toString());
        }

        const user = await getUserById(userId);
        const { redirectTo } = await oauth.completeAuthorization({
          request: authRequest,
          userId,
          scope: authRequest.scope,
          metadata: { grantedAt: new Date().toISOString() },
          props: { userId, email: user?.email ?? "" },
        });
        return redirect(redirectTo);
      },
    },
  },
});
