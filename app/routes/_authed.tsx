import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCurrentUserFn } from "~/auth/server-fns";
import { Logo } from "~/components/Logo";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUserFn();
    if (!user) {
      throw redirect({
        to: "/login",
        search: { redirectTo: location.href },
      });
    }
    return { user };
  },
  component: AuthedLayout,
});

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("logbook-theme", next ? "dark" : "light");
    } catch {
      // private browsing — theme just won't persist
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line bg-card text-ink-muted transition-colors hover:text-ink"
    >
      {dark ? (
        // currently dark — sun indicates a switch to light
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        // currently light — moon indicates a switch to dark
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" />
        </svg>
      )}
    </button>
  );
}

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface">
      <header className="sticky top-0 z-20 border-b border-line bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/vehicles"
            className="flex items-center gap-2 font-bold text-ink"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-ink"
            >
              <Logo className="h-6 w-6" />
            </span>
            <span>Logbook</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              >
                {user.avatarPath ? (
                  <img
                    src={`/files/${user.avatarPath}`}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sunken text-sm font-medium text-ink">
                    {(user.displayName ?? user.email)[0]?.toUpperCase()}
                  </span>
                )}
              </button>
              {menuOpen ? (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 cursor-default"
                    onClick={() => setMenuOpen(false)}
                    aria-label="Close menu"
                    tabIndex={-1}
                  />
                  <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-line bg-card py-1 shadow-lg">
                    <div className="border-b border-line px-4 py-2">
                      <p className="truncate text-sm font-medium text-ink">
                        {user.displayName ?? user.email}
                      </p>
                      {user.displayName ? (
                        <p className="truncate text-xs text-ink-muted">
                          {user.email}
                        </p>
                      ) : null}
                    </div>
                    <Link
                      to="/profile"
                      className="block px-4 py-3 text-sm text-ink hover:bg-sunken"
                      onClick={() => setMenuOpen(false)}
                    >
                      Profile
                    </Link>
                    <a
                      href="/logout"
                      className="block px-4 py-3 text-sm text-ink hover:bg-sunken"
                    >
                      Log out
                    </a>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 pb-16 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
