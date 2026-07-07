import { createFileRoute, Link } from "@tanstack/react-router";

import { getCurrentUserFn } from "~/auth/server-fns";
import { Logo } from "~/components/Logo";
import { btnPrimary, btnSecondary, card } from "~/components/ui";

export const Route = createFileRoute("/")({
  // Public page: a failed/absent session must never crash it — degrade to
  // the logged-out view if the user lookup throws (e.g. stale cookie).
  loader: async () => {
    try {
      return { user: await getCurrentUserFn() };
    } catch {
      return { user: null };
    }
  },
  component: Home,
});

const REPO_URL = "https://github.com/prescottprue/logbook";

function Home() {
  const { user } = Route.useLoaderData();

  return (
    <main className="min-h-screen bg-surface px-4 py-12 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="text-center">
          <Logo className="mx-auto h-14 w-14 text-accent" />
          <h1 className="mt-3 text-4xl font-semibold text-ink">Logbook</h1>
          <p className="mt-1 text-lg font-medium text-ink-muted">
            File information for any rig.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-lg text-ink-muted">
            Service history, receipts, and documents for every rig you own — in
            one place you control, accessible anywhere (even from your AI
            assistant). Self-hosted, open source, and yours to export.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {user ? (
              <Link to="/vehicles" className={btnPrimary}>
                Your vehicles
              </Link>
            ) : (
              <>
                <Link
                  to="/join"
                  search={{ redirectTo: undefined }}
                  className={btnPrimary}
                >
                  Sign up
                </Link>
                <Link
                  to="/login"
                  search={{ redirectTo: undefined }}
                  className={btnSecondary}
                >
                  Log in
                </Link>
              </>
            )}
          </div>
        </header>

        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          <div className={`${card} p-6`}>
            <h2 className="text-lg font-semibold text-ink">
              📷 Scan paper receipts — privately
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Snap a shop invoice and Logbook reads the date, mileage, cost, and
              work performed into a log entry, with the original photo attached.
              Extraction runs on self-hosted AI models — your records are never
              sent to third-party AI services.
            </p>
          </div>

          <div className={`${card} p-6`}>
            <h2 className="text-lg font-semibold text-ink">
              🤖 Talk to your garage from any AI
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Logbook is an MCP server: connect it to your own AI assistant and
              ask "what's due on the Jeep?" or "log the oil change I just did" —
              from your phone, mid-wrench. You sign in with your Logbook
              account; your AI only sees what you can see.
            </p>
          </div>

          <div className={`${card} p-6`}>
            <h2 className="text-lg font-semibold text-ink">
              🛠️ Built for a crew
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Invite people to a vehicle and everyone logs work, completes
              reminders, and tracks project parts in one place. Service
              reminders come due by date or mileage — whichever hits first.
            </p>
          </div>

          <div className={`${card} p-6`}>
            <h2 className="text-lg font-semibold text-ink">
              🔓 Your data is yours
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Export your complete history as JSON at any time. Logbook is open
              source, so you can always run your own instance — on Cloudflare or
              a single self-hosted container — and take your data with you.
            </p>
          </div>
        </section>

        <section className="mt-8">
          <div className={`${card} p-6`}>
            <h2 className="text-lg font-semibold text-ink">🚀 Get set up</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
              <li>
                Create an account (or self-host your own instance) and add your
                vehicles.
              </li>
              <li>
                Log work, scan receipts, and set reminders due by date or
                mileage.
              </li>
              <li>
                Connect your AI assistant over MCP to query and log from chat —
                the connector URL and steps live on your{" "}
                <Link
                  to="/profile"
                  className="font-medium text-accent hover:underline"
                >
                  profile
                </Link>{" "}
                once you sign in.
              </li>
            </ol>
            <div className="mt-4">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className={btnSecondary}
              >
                Setup &amp; self-hosting guide
              </a>
            </div>
          </div>
        </section>

        <footer className="mt-10 text-center text-sm text-ink-muted">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent hover:underline"
          >
            Open source on GitHub
          </a>{" "}
          — MIT licensed. Self-host it, fork it, make it yours.
        </footer>
      </div>
    </main>
  );
}
