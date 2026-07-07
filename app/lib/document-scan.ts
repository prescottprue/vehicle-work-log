/**
 * Client-side document flattening: find the four corners of a document in a
 * photo and perspective-warp it flat (deskew). Built on OpenCV.js, loaded
 * lazily via `~/lib/opencv`. The detection + warp helpers are browser-only
 * (canvas + WASM); the geometry helpers below them are pure and unit-tested.
 *
 * Coordinates crossing the module boundary are fractions of the
 * orientation-corrected image (0..1), so callers work in the displayed
 * `<img>`'s space without caring about intrinsic pixel size or EXIF rotation
 * — same convention as `cropImage`.
 */

import { loadOpenCv } from "~/lib/opencv";

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
 * Hard cap on a whole flatten (OpenCV load + decode + warp + encode). The
 * per-step timeouts should fire first; this is the backstop that guarantees
 * `warpDocument` settles so callers can fall back to the original photo.
 */
export const FLATTEN_TIMEOUT_MS = 30_000;

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

/** Decode a File to a canvas no larger than `maxDim`, orientation-corrected. */
async function fileToCanvas(
  file: File,
  maxDim: number,
): Promise<HTMLCanvasElement | null> {
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
    return canvas;
  } finally {
    // Release the full-resolution bitmap promptly — critical on iOS.
    bitmap.close();
  }
}

/**
 * Detect the document quadrilateral in an image, as fractional corners, or
 * null when no confident rectangle is found (caller falls back to a manual
 * crop / default quad). Runs Canny edge detection → contour search → pick the
 * largest convex 4-gon covering enough of the frame.
 */
export async function detectDocumentQuad(file: File): Promise<Quad | null> {
  const cv = await loadOpenCv();
  const canvas = await fileToCanvas(file, DETECT_MAX);
  if (!canvas) return null;
  const { width: w, height: h } = canvas;

  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 75, 200);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.dilate(edges, edges, kernel);
    kernel.delete();
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );

    const minArea = w * h * MIN_AREA_FRACTION;
    let best: { quad: Quad; area: number } | null = null;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const approx = new cv.Mat();
      cv.approxPolyDP(
        contour,
        approx,
        0.02 * cv.arcLength(contour, true),
        true,
      );
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const area = Math.abs(cv.contourArea(approx));
        if (area >= minArea && (!best || area > best.area)) {
          const pts: Point[] = [];
          for (let j = 0; j < 4; j++) {
            pts.push({
              x: approx.data32S[j * 2],
              y: approx.data32S[j * 2 + 1],
            });
          }
          best = { quad: orderCorners(pts), area };
        }
      }
      approx.delete();
      contour.delete();
    }
    if (!best) return null;
    return best.quad.map((p) => ({ x: p.x / w, y: p.y / h })) as Quad;
  } finally {
    src.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
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
  const cv = await loadOpenCv();
  const canvas = await fileToCanvas(file, WARP_MAX);
  if (!canvas) return file;

  const quad = orderCorners(
    quadFractions.map((p) => ({
      x: p.x * canvas.width,
      y: p.y * canvas.height,
    })),
  );
  const { width, height } = quadOutputSize(quad);
  const [tl, tr, br, bl] = quad;

  const src = cv.imread(canvas);
  const dst = new cv.Mat();
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x,
    tl.y,
    tr.x,
    tr.y,
    br.x,
    br.y,
    bl.x,
    bl.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    width,
    0,
    width,
    height,
    0,
    height,
  ]);
  const transform = cv.getPerspectiveTransform(srcTri, dstTri);
  try {
    cv.warpPerspective(
      src,
      dst,
      transform,
      new cv.Size(width, height),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    );
    const out = document.createElement("canvas");
    cv.imshow(out, dst);
    const blob = await withTimeout(
      new Promise<Blob | null>((res) => out.toBlob(res, "image/jpeg", quality)),
      ENCODE_TIMEOUT_MS,
      "JPEG encode",
    );
    if (!blob) return file;
    const base = file.name.replace(/\.\w+$/, "") || "scan";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    src.delete();
    dst.delete();
    srcTri.delete();
    dstTri.delete();
    transform.delete();
  }
}
