import { createId } from "@paralleldrive/cuid2";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { requireAuth } from "~/auth/session.server";
import { ImageCropper } from "~/components/ImageCropper";
import {
  btnPrimary,
  btnSecondary,
  card,
  errorBox,
  input,
  label,
  okBox,
} from "~/components/ui";
import { downscaleImage } from "~/lib/image";
import {
  type DriveConnectionStatus,
  type DriveSyncSummary,
  disconnectDrive,
  getDriveConnectionStatus,
  syncToDrive,
} from "~/models/google-drive.server";
import { changePassword, updateUser } from "~/models/user.server";
import { getStorage } from "~/storage.server";

const MAX_AVATAR_BYTES = 500 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/png", "image/jpeg"]);

const updateProfileFn = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }) => {
    const userId = await requireAuth();

    const displayName = String(data.get("displayName") ?? "").trim() || null;

    let avatarPath: string | null | undefined;
    const avatar = data.get("avatar");
    if (avatar instanceof File && avatar.size > 0) {
      if (avatar.size > MAX_AVATAR_BYTES) {
        return { error: "Avatar must be 500KB or smaller" as const };
      }
      if (!ALLOWED_AVATAR_TYPES.has(avatar.type)) {
        return { error: "Avatar must be PNG or JPEG" as const };
      }
      const bytes = new Uint8Array(await avatar.arrayBuffer());
      const key = `user-avatars/${userId}/${createId()}`;
      await getStorage().upload(key, bytes, avatar.type);
      avatarPath = key;
    }

    const updates: { displayName: string | null; avatarPath?: string } = {
      displayName,
    };
    if (avatarPath) {
      updates.avatarPath = avatarPath;
    }

    await updateUser(userId, updates);
    return { success: true as const };
  });

const changePasswordFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const userId = await requireAuth();

    if (data.newPassword.length < 8) {
      return { error: "New password must be at least 8 characters" };
    }
    if (data.newPassword !== data.confirmPassword) {
      return { error: "Passwords do not match" };
    }

    const result = await changePassword(
      userId,
      data.currentPassword,
      data.newPassword,
    );
    if (result.error) return { error: result.error };
    return { success: true as const };
  });

const getDriveStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await requireAuth();
  return getDriveConnectionStatus(userId);
});

const syncDriveFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ summary: DriveSyncSummary } | { error: string }> => {
    const userId = await requireAuth();
    try {
      return { summary: await syncToDrive(userId) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Sync failed" };
    }
  },
);

const disconnectDriveFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const userId = await requireAuth();
    await disconnectDrive(userId);
    return { success: true as const };
  },
);

export const Route = createFileRoute("/_authed/profile")({
  loader: async () => ({ drive: await getDriveStatusFn() }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const { drive } = Route.useLoaderData();

  return (
    <section className="space-y-10">
      <h1 className="text-2xl font-semibold text-ink">Profile</h1>
      <ProfileForm user={user} />
      <hr className="border-line" />
      <PasswordForm />
      <hr className="border-line" />
      <ConnectAI />
      <hr className="border-line" />
      <GoogleDrive status={drive} />
      <hr className="border-line" />
      <YourData />
    </section>
  );
}

function GoogleDrive({ status }: { status: DriveConnectionStatus }) {
  const router = useRouter();
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState<null | "sync" | "disconnect">(null);
  const [result, setResult] = useState<DriveSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Surface the ?drive=… outcome from the OAuth redirect, then strip it from
  // the URL so a refresh doesn't re-show the banner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("drive");
    if (!outcome) return;
    setBanner(
      {
        connected: "Google Drive connected.",
        denied: "Connection cancelled.",
        unconfigured: "Google Drive sync isn't configured on this server.",
        error: "Something went wrong connecting Google Drive. Try again.",
      }[outcome] ?? null,
    );
    params.delete("drive");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : ""),
    );
  }, []);

  async function runSync() {
    setPending("sync");
    setError(null);
    setResult(null);
    try {
      const res = await syncDriveFn();
      if ("error" in res) setError(res.error);
      else {
        setResult(res.summary);
        await router.invalidate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setPending(null);
    }
  }

  async function disconnect() {
    setPending("disconnect");
    setError(null);
    setResult(null);
    try {
      await disconnectDriveFn();
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-medium text-ink">☁️ Sync to Google Drive</h2>
      <div className={`${card} mt-4 max-w-lg p-5`}>
        <p className="text-sm text-ink-muted">
          Keep a copy of your records in your own Google Drive. Logbook creates
          a single <span className="font-medium text-ink">Logbook</span> folder
          and copies your vehicle documents, receipt scans, and a full data
          export into it. Using Google's <code>drive.file</code> access, Logbook
          can only see files it created here — never the rest of your Drive.
        </p>

        {banner ? (
          <p className="mt-3 rounded border border-line bg-sunken p-2 text-sm text-ink">
            {banner}
          </p>
        ) : null}

        {!status.configured ? (
          <p className="mt-4 text-sm text-ink-muted">
            Google Drive sync isn't configured on this server.
          </p>
        ) : status.connected ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-ink">
              Connected
              {status.googleEmail ? (
                <>
                  {" as "}
                  <span className="font-medium">{status.googleEmail}</span>
                </>
              ) : null}
              .
            </p>
            <p className="text-xs text-ink-muted">
              {status.lastSyncedAt
                ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}`
                : "Not synced yet."}
            </p>

            {error ? <p className={errorBox}>{error}</p> : null}
            {result ? (
              <p className={okBox}>
                Synced: {result.created} added, {result.updated} updated,{" "}
                {result.skipped} already current
                {result.failed > 0 ? `, ${result.failed} failed` : ""}.
                {result.errors.length > 0 ? (
                  <span className="mt-1 block text-xs text-danger">
                    {result.errors.slice(0, 5).join("; ")}
                  </span>
                ) : null}
              </p>
            ) : null}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={runSync}
                disabled={pending !== null}
                className={btnPrimary}
              >
                {pending === "sync" ? "Syncing…" : "Sync now"}
              </button>
              <button
                type="button"
                onClick={disconnect}
                disabled={pending !== null}
                className={btnSecondary}
              >
                {pending === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>
        ) : (
          <a href="/auth/google/start" className={`${btnPrimary} mt-4`}>
            Connect Google Drive
          </a>
        )}
      </div>
    </div>
  );
}

function ConnectAI() {
  // window.location is browser-only; render the path until hydration fills
  // in the full origin.
  const [mcpUrl, setMcpUrl] = useState("/mcp");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMcpUrl(`${window.location.origin}/mcp`);
  }, []);

  async function copy() {
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <h2 className="text-lg font-medium text-ink">🤖 Connect your AI (MCP)</h2>
      <div className={`${card} mt-4 max-w-lg p-5`}>
        <p className="text-sm text-ink-muted">
          Logbook is an MCP server, so you can talk to your garage from your own
          AI assistant — "what's due on the Jeep?", "log the oil change I just
          did at 87,420 miles" — from a phone, mid-wrench. Your AI signs in as{" "}
          <em>you</em>: it can only see and log to vehicles your account can
          access.
        </p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
          <li>
            Open your AI client's MCP connector settings (in Claude:{" "}
            <span className="font-medium text-ink">
              Settings → Connectors → Add custom connector
            </span>
            )
          </li>
          <li>Paste the URL below</li>
          <li>Sign in with your Logbook account and approve access</li>
        </ol>
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            readOnly
            value={mcpUrl}
            aria-label="MCP connector URL"
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-11 w-full rounded-xl border border-line bg-sunken px-3 font-mono text-sm text-ink"
          />
          <button type="button" onClick={copy} className={btnSecondary}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Your AI can list your vehicles, check what's due, log completed work,
          complete reminders, and manage project parts. Connections use OAuth —
          no API keys, and your password is never shared with the AI.
        </p>
      </div>
    </div>
  );
}

function YourData() {
  return (
    <div>
      <h2 className="text-lg font-medium text-ink">🔓 Your data</h2>
      <div className={`${card} mt-4 max-w-lg p-5`}>
        <p className="text-sm text-ink-muted">
          Your records belong to you. Download your complete history — vehicles,
          logs, readings, vendors, tags, and parts — as JSON at any time.
          Logbook is also{" "}
          <a
            href="https://github.com/prescottprue/logbook"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent hover:underline"
          >
            open source
          </a>
          , so you can always run your own instance and bring this export with
          you.
        </p>
        <a href="/account/export" download className={`${btnSecondary} mt-4`}>
          ⬇️ Export everything (JSON)
        </a>
      </div>
    </div>
  );
}

function ProfileForm({
  user,
}: {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    avatarPath: string | null;
  };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  // Raw photo awaiting a square crop before it becomes the avatar.
  const [cropping, setCropping] = useState<File | null>(null);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setPending(true);
    const formData = new FormData(e.currentTarget);
    // The file input is cleared once a photo is cropped, so inject the
    // cropped avatar here (already squared + downscaled under the 500KB cap).
    if (avatarFile) formData.set("avatar", avatarFile);
    try {
      const result = await updateProfileFn({ data: formData });
      if (result && "error" in result && result.error) {
        setError(String(result.error));
      } else {
        setSuccess(true);
        setAvatarFile(null);
        await router.invalidate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-medium text-ink">Account details</h2>
      <form onSubmit={onSubmit} className="mt-4 max-w-lg space-y-4">
        {error ? <p className={errorBox}>{error}</p> : null}
        {success ? <p className={okBox}>Profile updated.</p> : null}

        <div>
          <label htmlFor="profile-email" className={label}>
            Email
          </label>
          <input
            id="profile-email"
            type="email"
            value={user.email}
            disabled
            className={`${input} bg-sunken text-ink-muted`}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Email cannot be changed at this time.
          </p>
        </div>

        <label className={label}>
          Display name
          <input
            name="displayName"
            type="text"
            defaultValue={user.displayName ?? ""}
            className={input}
          />
        </label>

        <div>
          <label className={label}>
            Profile image (cropped to a square)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.currentTarget.value = "";
                if (picked) setCropping(picked);
              }}
              className="mt-1 block w-full text-sm"
            />
          </label>
          {avatarPreview || user.avatarPath ? (
            <img
              src={avatarPreview ?? `/files/${user.avatarPath}`}
              alt={avatarPreview ? "New avatar" : "Current avatar"}
              className="mt-2 h-20 w-20 rounded-full object-cover"
            />
          ) : null}
        </div>

        {cropping ? (
          <ImageCropper
            file={cropping}
            aspect={1}
            onCancel={() => setCropping(null)}
            onConfirm={async (cropped) => {
              setCropping(null);
              setAvatarFile(
                await downscaleImage(cropped, { maxDim: 512, quality: 0.85 }),
              );
            }}
          />
        ) : null}

        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>
    </div>
  );
}

function PasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setPending(true);
    const form = e.currentTarget;
    const currentPassword = String(
      new FormData(form).get("currentPassword") ?? "",
    );
    const newPassword = String(new FormData(form).get("newPassword") ?? "");
    const confirmPassword = String(
      new FormData(form).get("confirmPassword") ?? "",
    );
    try {
      const result = await changePasswordFn({
        data: { currentPassword, newPassword, confirmPassword },
      });
      if (result && "error" in result && result.error) {
        setError(String(result.error));
      } else {
        setSuccess(true);
        form.reset();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to change password",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-medium text-ink">Change password</h2>
      <form onSubmit={onSubmit} className="mt-4 max-w-lg space-y-4">
        {error ? <p className={errorBox}>{error}</p> : null}
        {success ? (
          <p className={okBox}>Password changed successfully.</p>
        ) : null}

        <label className={label}>
          Current password
          <input
            name="currentPassword"
            type="password"
            required
            className={input}
          />
        </label>

        <label className={label}>
          New password
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            className={input}
          />
        </label>

        <label className={label}>
          Confirm new password
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            className={input}
          />
        </label>

        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Changing…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
