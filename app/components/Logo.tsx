/**
 * Logbook brand mark — a folder (filing/access) with a simple car silhouette
 * (the rig). Single-color via `currentColor` so it inherits text color and
 * themes for light/dark; built from primitive shapes so it stays crisp at
 * favicon-to-hero sizes. Size it with a className (e.g. `h-6 w-6`).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* folder */}
      <path
        d="M3 7.25c0-.83.67-1.5 1.5-1.5h3.55c.46 0 .9.21 1.18.58l.78 1.02h9.49c.83 0 1.5.67 1.5 1.5v8.4c0 .82-.67 1.5-1.5 1.5h-15c-.83 0-1.5-.68-1.5-1.5V7.25Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* car body + roof */}
      <rect
        x="6.7"
        y="13.1"
        width="10.6"
        height="2.3"
        rx="1.1"
        fill="currentColor"
      />
      <rect
        x="9"
        y="11.3"
        width="5.5"
        height="2.4"
        rx="1.1"
        fill="currentColor"
      />
      {/* wheels */}
      <circle cx="9.5" cy="15.8" r="1.15" fill="currentColor" />
      <circle cx="14.5" cy="15.8" r="1.15" fill="currentColor" />
    </svg>
  );
}
