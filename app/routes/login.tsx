import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { loginFn } from "~/auth/server-fns";
import { btnPrimary, card, errorBox, input, label } from "~/components/ui";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>) => ({
    redirectTo:
      typeof search.redirectTo === "string" ? search.redirectTo : undefined,
  }),
});

function LoginPage() {
  const { redirectTo } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    try {
      const result = await loginFn({ data: { email, password, redirectTo } });
      if ("error" in result) {
        setError(result.error);
      } else {
        window.location.assign(result.redirectTo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-8">
      <form onSubmit={onSubmit} className={`${card} w-full max-w-md p-8`}>
        <h1 className="text-2xl font-semibold text-ink">Log in</h1>
        {error ? <p className={`mt-4 ${errorBox}`}>{error}</p> : null}
        <label className={`mt-4 ${label}`}>
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className={input}
          />
        </label>
        <label className={`mt-4 ${label}`}>
          Password
          <div className="relative">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="current-password"
              className={`${input} pr-16`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ink-muted hover:text-ink"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        <button
          type="submit"
          disabled={pending}
          className={`${btnPrimary} mt-6 w-full`}
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <p className="mt-4 text-center text-sm text-ink-muted">
          No account?{" "}
          <Link
            to="/join"
            search={{ redirectTo: undefined }}
            className="font-medium text-accent hover:underline"
          >
            Sign up
          </Link>
        </p>
      </form>
    </main>
  );
}
