import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { signupFn } from "~/auth/server-fns";
import { btnPrimary, card, errorBox, input, label } from "~/components/ui";

export const Route = createFileRoute("/join")({
  component: JoinPage,
  validateSearch: (search: Record<string, unknown>) => ({
    redirectTo:
      typeof search.redirectTo === "string" ? search.redirectTo : undefined,
  }),
});

function JoinPage() {
  const { redirectTo } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    try {
      const result = await signupFn({
        data: { email, password, redirectTo },
      });
      if ("error" in result) {
        setError(result.error);
      } else {
        window.location.assign(result.redirectTo);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-8">
      <form onSubmit={onSubmit} className={`${card} w-full max-w-md p-8`}>
        <h1 className="text-2xl font-semibold text-ink">Create account</h1>
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
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={input}
          />
          <span className="mt-1 block text-xs text-ink-muted">
            Minimum 8 characters.
          </span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className={`${btnPrimary} mt-6 w-full`}
        >
          {pending ? "Creating…" : "Create account"}
        </button>
        <p className="mt-4 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <Link
            to="/login"
            search={{ redirectTo: undefined }}
            className="font-medium text-accent hover:underline"
          >
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}
