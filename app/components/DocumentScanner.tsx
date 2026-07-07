import { useEffect, useRef, useState } from "react";

import { btnPrimary, btnSecondary } from "~/components/ui";
import {
  defaultQuad,
  detectDocumentQuad,
  FLATTEN_TIMEOUT_MS,
  type Quad,
  warpDocument,
} from "~/lib/document-scan";

type Status = "idle" | "detecting" | "flattening" | "fallback";

/** How long the "using the original" notice shows before auto-continuing. */
const FALLBACK_NOTICE_MS = 2_500;

/** Clamp a fractional coordinate to the image. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Full-screen document-scan modal. Opens instantly showing the photo with a
 * draggable quad — no WASM yet. OpenCV.js (a ~10MB module) loads lazily only
 * when the user taps "Auto-detect" or "Flatten", so a routine capture never
 * pays that cost. Detection/warp run on capped-size images and are
 * time-boxed, so they can't hang or OOM the tab on iOS; if flattening fails
 * or times out, the modal announces it and auto-continues with the original
 * photo. Browser-only — render from an event handler, never SSR.
 */
export function DocumentScanner({
  file,
  onConfirm,
  onCancel,
  onCropInstead,
}: {
  file: File;
  onConfirm: (flattened: File) => void;
  onCancel: () => void;
  /** Fall back to the plain rectangular cropper with the same photo. */
  onCropInstead: (file: File) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [quad, setQuad] = useState<Quad>(defaultQuad());
  const [status, setStatus] = useState<Status>("idle");
  const [note, setNote] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ corner: number; id: number } | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
  }, []);

  function onImgLoad() {
    const img = imgRef.current;
    if (img) setBox({ w: img.clientWidth, h: img.clientHeight });
  }

  function startDrag(e: React.PointerEvent, corner: number) {
    if (status !== "idle") return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { corner, id: e.pointerId };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const img = imgRef.current;
    if (!d || !img) return;
    const r = img.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width);
    const y = clamp01((e.clientY - r.top) / r.height);
    setQuad(quad.map((p, i) => (i === d.corner ? { x, y } : p)) as Quad);
  }

  function endDrag() {
    drag.current = null;
  }

  async function autoDetect() {
    setStatus("detecting");
    setNote(null);
    try {
      const detected = await detectDocumentQuad(file);
      setQuad(detected ?? defaultQuad());
      if (!detected) {
        setNote("No clear edges found — drag the corners to fit.");
      }
      setStatus("idle");
    } catch {
      setNote("Auto-detect isn't available here — drag the corners, or crop.");
      setStatus("idle");
    }
  }

  async function flatten() {
    setStatus("flattening");
    setNote(null);
    // Overall backstop on top of the per-step timeouts inside warpDocument —
    // whatever happens, the user is never stuck on the spinner.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const flattened = await Promise.race([
        warpDocument(file, quad),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Flatten timed out")),
            FLATTEN_TIMEOUT_MS,
          );
        }),
      ]);
      onConfirm(flattened);
    } catch {
      // Announce the failure briefly, then continue with the original photo.
      setStatus("fallback");
      fallbackTimer.current = setTimeout(
        () => onConfirm(file),
        FALLBACK_NOTICE_MS,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  const busy = status !== "idle";
  const points =
    box && quad.map((p) => `${p.x * box.w},${p.y * box.h}`).join(" ");

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Scan document"
    >
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {url ? (
          <div className="relative">
            <img
              ref={imgRef}
              src={url}
              alt=""
              draggable={false}
              onLoad={onImgLoad}
              className="max-h-[68vh] max-w-full select-none object-contain"
            />
            {box && status !== "fallback" ? (
              <>
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox={`0 0 ${box.w} ${box.h}`}
                  preserveAspectRatio="none"
                  role="img"
                >
                  <title>Document outline</title>
                  <polygon
                    points={points || ""}
                    fill="rgba(251,146,60,0.18)"
                    stroke="#fb923c"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {!busy &&
                  quad.map((p, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed 4-corner quad, index is the identity
                      key={i}
                      aria-hidden
                      onPointerDown={(e) => startDrag(e, i)}
                      style={{
                        left: p.x * box.w,
                        top: p.y * box.h,
                        touchAction: "none",
                      }}
                      className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent/70"
                    />
                  ))}
              </>
            ) : null}
          </div>
        ) : null}

        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="flex items-center gap-3 rounded-xl bg-card px-4 py-3">
              {status !== "fallback" ? (
                <span
                  aria-hidden
                  className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-accent"
                />
              ) : null}
              <p className="text-sm font-medium text-ink" role="status">
                {status === "detecting"
                  ? "Finding the document…"
                  : status === "flattening"
                    ? "Flattening…"
                    : "Couldn't flatten this photo — using the original instead."}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mx-auto mt-4 w-full max-w-md space-y-2">
        {note ? (
          <p className="rounded-xl border border-line bg-card p-2 text-center text-xs text-ink-muted">
            {note}
          </p>
        ) : null}

        <div className="flex gap-3">
          <button
            type="button"
            className={`${btnSecondary} flex-1`}
            onClick={() => onConfirm(file)}
            disabled={busy}
          >
            Use photo
          </button>
          <button
            type="button"
            className={`${btnPrimary} flex-1`}
            onClick={flatten}
            disabled={busy}
          >
            {status === "flattening" ? "Flattening…" : "Flatten & use"}
          </button>
        </div>
        <div className="flex items-center justify-center gap-4 pt-1 text-sm text-ink-muted">
          <button
            type="button"
            className="hover:underline disabled:opacity-50"
            onClick={autoDetect}
            disabled={busy}
          >
            ✨ Auto-detect
          </button>
          <span aria-hidden>·</span>
          <button
            type="button"
            className="hover:underline disabled:opacity-50"
            onClick={() => onCropInstead(file)}
            disabled={busy}
          >
            Crop
          </button>
          <span aria-hidden>·</span>
          <button type="button" className="hover:underline" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
