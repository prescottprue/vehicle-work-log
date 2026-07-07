/**
 * Client-side document flattening: find the four corners of a document in a
 * photo and perspective-warp it flat (deskew). The OpenCV work runs in a
 * dedicated web worker (`public/document-scan.worker.js`) because OpenCV
 * calls are synchronous WASM that JS timers cannot interrupt on the main
 * thread — in a worker, a hung call is killed for real via
 * `worker.terminate()`, so the page can never freeze (the iOS Safari hang
 * this replaced). The detection + warp entry points are browser-only
 * (canvas + worker); the geometry helpers below them are pure and
 * unit-tested.
 *
 * Coordinates crossing the module boundary are fractions of the
 * orientation-corrected image (0..1), so callers work in the displayed
 * `<img>`'s space without caring about intrinsic pixel size or EXIF rotation
 * — same convention as `cropImage`.
 */

export type Point = { x: number; y: number };
/** Four corners, ordered top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** Largest edge dimension the detector runs at — keeps it fast on phones. */
const DETECT_MAX = 1000;
/**
 * Largest edge dimension the warp runs at. Full phone photos (12MP+) decode
 * into ~50MB RGBA Mats that crash iOS Safari; this caps peak memory. The
 * scan flow downscales to 1600px afterward anyway, and a flattened document
 * at 2000px is plenty legible / OCR-friendly.
 */
const WARP_MAX = 2000;
/** A candidate quad must cover at least this fraction of the frame. */
const MIN_AREA_FRACTION = 0.2;
/** Guard against a decode that never settles (malformed/huge input). */
const DECODE_TIMEOUT_MS = 15_000;
/**
 * Guard against `canvas.toBlob` never calling back — iOS Safari can stall the
 * JPEG encode under canvas memory pressure instead of failing.
 */
const ENCODE_TIMEOUT_MS = 10_000;
/**
 * Per-call cap on worker round-trips. The first call also downloads + inits
 * the ~10MB OpenCV build inside the worker, so this can't be too tight. On
 * expiry the worker is TERMINATED — unlike a main-thread timer, this stops a
 * wedged WASM call dead; the next attempt starts a fresh worker.
 */
const CV_CALL_TIMEOUT_MS = 25_000;
/**
 * Hard cap on a whole flatten (worker call + decode + encode). The per-step
 * timeouts should fire first; this is the backstop that guarantees
 * `warpDocument` settles so callers can fall back to the original photo.
 */
export const FLATTEN_TIMEOUT_MS = 30_000;

const WORKER_URL = "/document-scan.worker.js";

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// --- Worker client -------------------------------------------------------

type DetectRequest = {
  op: "detect";
  width: number;
  height: number;
  buffer: ArrayBuffer;
  minAreaFraction: number;
};
type WarpRequest = {
  op: "warp";
  width: number;
  height: number;
  buffer: ArrayBuffer;
  quad: Quad;
  outWidth: number;
  outHeight: number;
};
type DetectResponse = { points: Point[] | null };
type WarpResponse = { width: number; height: number; buffer: ArrayBuffer };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

let cvWorker: Worker | null = null;
let nextCallId = 0;
const pending = new Map<number, Pending>();

/** Kill the worker and fail every in-flight call (timeout / script error). */
function destroyCvWorker(err: Error) {
  cvWorker?.terminate();
  cvWorker = null;
  const waiting = [...pending.values()];
  pending.clear();
  for (const p of waiting) p.reject(err);
}

function getCvWorker(): Worker {
  if (cvWorker) return cvWorker;
  const worker = new Worker(WORKER_URL);
  worker.onmessage = (event) => {
    const { id, ok, error, ...rest } = event.data as {
      id: number;
      ok: boolean;
      error?: string;
    };
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    if (ok) call.resolve(rest);
    else call.reject(new Error(error ?? "Scan worker error"));
  };
  worker.onerror = (event) => {
    destroyCvWorker(
      new Error(`Scan worker failed: ${event.message || "script error"}`),
    );
  };
  cvWorker = worker;
  return worker;
}

function callCvWorker<T>(
  request: DetectRequest | WarpRequest,
  label: string,
): Promise<T> {
  const id = nextCallId++;
  const worker = getCvWorker();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // The only way to stop a stuck synchronous WASM call.
      destroyCvWorker(new Error(`${label} timed out`));
    }, CV_CALL_TIMEOUT_MS);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    worker.postMessage({ id, ...request }, [request.buffer]);
  });
}

// --- Geometry (pure, unit-tested) ----------------------------------------

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Order four arbitrary corner points as [tl, tr, br, bl]. The corner with the
 * smallest x+y is top-left and the largest is bottom-right; the smallest y−x
 * is top-right and the largest is bottom-left. Works for any convex quad.
 */
export function orderCorners(points: Point[]): Quad {
  if (points.length < 4) {
    throw new Error("orderCorners needs four points");
  }
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...points].sort((a, b) => a.y - a.x - (b.y - b.x));
  const tl = bySum[0];
  const br = bySum[bySum.length - 1];
  const tr = byDiff[0];
  const bl = byDiff[byDiff.length - 1];
  if (!tl || !tr || !br || !bl) {
    throw new Error("orderCorners needs four points");
  }
  return [tl, tr, br, bl];
}

/** Output rectangle size for a quad: the longer of each opposing edge pair. */
export function quadOutputSize(quad: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  return {
    width: Math.max(
      1,
      Math.round(Math.max(distance(tl, tr), distance(bl, br))),
    ),
    height: Math.max(
      1,
      Math.round(Math.max(distance(tl, bl), distance(tr, br))),
    ),
  };
}

/** Inset rectangle used when auto-detection finds nothing. */
export function defaultQuad(inset = 0.08): Quad {
  return [
    { x: inset, y: inset },
    { x: 1 - inset, y: inset },
    { x: 1 - inset, y: 1 - inset },
    { x: inset, y: 1 - inset },
  ];
}

// --- Detection + warp entry points (browser-only) -------------------------

/** Decode a File to RGBA pixels no larger than `maxDim`, orientation-corrected. */
async function fileToImageData(
  file: File,
  maxDim: number,
): Promise<ImageData | null> {
  const bitmap = await withTimeout(
    createImageBitmap(file, { imageOrientation: "from-image" }),
    DECODE_TIMEOUT_MS,
    "Image decode",
  );
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    // Release the full-resolution bitmap promptly — critical on iOS.
    bitmap.close();
  }
}

/**
 * Detect the document quadrilateral in an image, as fractional corners, or
 * null when no confident rectangle is found (caller falls back to a manual
 * crop / default quad).
 */
export async function detectDocumentQuad(file: File): Promise<Quad | null> {
  const image = await fileToImageData(file, DETECT_MAX);
  if (!image) return null;
  const { width: w, height: h } = image;
  const { points } = await callCvWorker<DetectResponse>(
    {
      op: "detect",
      width: w,
      height: h,
      buffer: image.data.buffer as ArrayBuffer,
      minAreaFraction: MIN_AREA_FRACTION,
    },
    "Document detect",
  );
  if (!points) return null;
  return orderCorners(points).map((p) => ({ x: p.x / w, y: p.y / h })) as Quad;
}

/**
 * Perspective-warp the four fractional corners onto a flat rectangle and
 * return a JPEG. The source is capped at WARP_MAX first (memory safety on
 * iOS); corner order is normalized so a user-dragged quad can't invert the
 * output.
 */
export async function warpDocument(
  file: File,
  quadFractions: Quad,
  { quality = 0.92 }: { quality?: number } = {},
): Promise<File> {
  const image = await fileToImageData(file, WARP_MAX);
  if (!image) return file;

  const quad = orderCorners(
    quadFractions.map((p) => ({
      x: p.x * image.width,
      y: p.y * image.height,
    })),
  );
  const { width: outWidth, height: outHeight } = quadOutputSize(quad);

  const warped = await callCvWorker<WarpResponse>(
    {
      op: "warp",
      width: image.width,
      height: image.height,
      buffer: image.data.buffer as ArrayBuffer,
      quad,
      outWidth,
      outHeight,
    },
    "Document warp",
  );

  const out = document.createElement("canvas");
  out.width = warped.width;
  out.height = warped.height;
  const ctx = out.getContext("2d");
  if (!ctx) return file;
  ctx.putImageData(
    new ImageData(
      new Uint8ClampedArray(warped.buffer),
      warped.width,
      warped.height,
    ),
    0,
    0,
  );
  const blob = await withTimeout(
    new Promise<Blob | null>((res) => out.toBlob(res, "image/jpeg", quality)),
    ENCODE_TIMEOUT_MS,
    "JPEG encode",
  );
  if (!blob) return file;
  const base = file.name.replace(/\.\w+$/, "") || "scan";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}
