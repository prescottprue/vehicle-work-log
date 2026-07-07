/**
 * Shared Tailwind class recipes so every screen uses the same garage-friendly
 * sizing: ≥44px touch targets, semantic color tokens (see styles.css).
 */

export const card = "rounded-2xl border border-line bg-card shadow-sm";

const btnBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 active:scale-[.98]";

export const btnPrimary = `${btnBase} bg-accent text-accent-ink hover:bg-accent-strong`;

export const btnSecondary = `${btnBase} border border-line bg-card text-ink hover:bg-sunken`;

export const btnDanger = `${btnBase} border border-danger/40 bg-card text-danger hover:bg-danger/10`;

export const input =
  "mt-1 block w-full min-h-11 rounded-xl border border-line bg-card px-3 text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

export const textarea =
  "mt-1 block w-full rounded-xl border border-line bg-card p-3 text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

export const label = "block text-sm font-medium text-ink-muted";

export const errorBox =
  "rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger";

export const okBox =
  "rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm text-ok";

/** Selectable pill (service-type presets, status filters). */
export function chip(selected: boolean) {
  return `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
    selected
      ? "border-accent bg-accent text-accent-ink"
      : "border-line bg-card text-ink hover:bg-sunken"
  }`;
}
