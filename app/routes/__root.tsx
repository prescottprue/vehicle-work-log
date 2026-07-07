import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ErrorState } from "~/components/ErrorState";
import stylesHref from "../styles.css?url";

// Applied before paint so dark mode doesn't flash light on reload. Falls back
// to the OS color-scheme preference when the user hasn't picked a theme.
const themeScript = `try{var t=localStorage.getItem("logbook-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Logbook" },
      { name: "theme-color", content: "#0c0e11" },
      // iOS home-screen install: standalone chrome + dark status bar. iOS
      // reads these + the apple-touch-icon, not the web manifest.
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Logbook" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { name: "mobile-web-app-capable", content: "yes" },
    ],
    links: [
      { rel: "stylesheet", href: stylesHref },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  errorComponent: ({ reset }) => (
    <RootDocument>
      <ErrorState
        title="Something threw a rod"
        message="An unexpected error stalled this page. Try again, or head back to your garage."
        onReset={reset}
      />
    </RootDocument>
  ),
  notFoundComponent: () => (
    <RootDocument>
      <ErrorState
        title="Took a wrong turn"
        message="We couldn't find that page — it may have moved or never existed. Let's get you back on the road."
      />
    </RootDocument>
  ),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static inline theme script */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-surface text-ink antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
