/**
 * Classic web worker that runs the OpenCV.js document ops (edge detection +
 * perspective warp) off the main thread. Served as a static asset — same
 * self-hosted pattern as /opencv.js, which it pulls in via importScripts on
 * the first message (so a routine capture never pays the ~10MB download).
 *
 * Running in a worker is the whole point: OpenCV calls are synchronous WASM
 * that JS timers cannot interrupt. Off the main thread the page stays
 * responsive, and the caller (~/lib/document-scan) enforces its timeout by
 * terminating this worker — a real kill switch for a stuck WASM call.
 *
 * Message contract (all buffers are RGBA, transferred not copied):
 *   → { id, op: "detect", width, height, buffer, minAreaFraction }
 *   ← { id, ok: true, points: [{x,y}×4] | null }        (pixel coords, unordered)
 *   → { id, op: "warp", width, height, buffer, quad: [{x,y}×4], outWidth, outHeight }
 *   ← { id, ok: true, width, height, buffer }
 *   ← { id, ok: false, error }                           (any failure)
 */

let cvReadyPromise = null;

function loadCv() {
  cvReadyPromise ??= new Promise((resolve, reject) => {
    const fail = (message) => {
      cvReadyPromise = null; // allow a retry on the next message
      reject(new Error(message));
    };
    try {
      importScripts("/opencv.js");
    } catch (err) {
      fail(
        `OpenCV failed to load in the scan worker (${err?.message ? err.message : err})`,
      );
      return;
    }
    const cv = self.cv;
    if (!cv) {
      fail("OpenCV loaded but self.cv is missing");
      return;
    }
    if (typeof cv.Mat === "function") resolve(cv);
    else cv.onRuntimeInitialized = () => resolve(cv);
  });
  return cvReadyPromise;
}

/** Build an RGBA Mat from a transferred buffer + dimensions. */
function matFromRgba(cv, msg) {
  return cv.matFromImageData({
    data: new Uint8ClampedArray(msg.buffer),
    width: msg.width,
    height: msg.height,
  });
}

/**
 * Canny edge detection → contour search → largest convex 4-gon covering at
 * least minAreaFraction of the frame. Returns pixel-space corner points in
 * contour order; the main thread orders and fractionalizes them.
 */
function detect(cv, msg) {
  const src = matFromRgba(cv, msg);
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

    const minArea = msg.width * msg.height * msg.minAreaFraction;
    let best = null;
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
          const points = [];
          for (let j = 0; j < 4; j++) {
            points.push({
              x: approx.data32S[j * 2],
              y: approx.data32S[j * 2 + 1],
            });
          }
          best = { points, area };
        }
      }
      approx.delete();
      contour.delete();
    }
    return { points: best ? best.points : null };
  } finally {
    src.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/** Perspective-warp the ordered pixel quad onto an outWidth×outHeight RGBA buffer. */
function warp(cv, msg) {
  const [tl, tr, br, bl] = msg.quad;
  const src = matFromRgba(cv, msg);
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
    msg.outWidth,
    0,
    msg.outWidth,
    msg.outHeight,
    0,
    msg.outHeight,
  ]);
  const transform = cv.getPerspectiveTransform(srcTri, dstTri);
  try {
    cv.warpPerspective(
      src,
      dst,
      transform,
      new cv.Size(msg.outWidth, msg.outHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(),
    );
    // Copy out of the WASM heap before the Mats are freed.
    const out = new Uint8ClampedArray(dst.data);
    return { width: msg.outWidth, height: msg.outHeight, buffer: out.buffer };
  } finally {
    src.delete();
    dst.delete();
    srcTri.delete();
    dstTri.delete();
    transform.delete();
  }
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    const cv = await loadCv();
    if (msg.op === "detect") {
      self.postMessage({ id: msg.id, ok: true, ...detect(cv, msg) });
    } else if (msg.op === "warp") {
      const result = warp(cv, msg);
      self.postMessage({ id: msg.id, ok: true, ...result }, [result.buffer]);
    } else {
      throw new Error(`Unknown scan-worker op: ${msg.op}`);
    }
  } catch (err) {
    self.postMessage({
      id: msg.id,
      ok: false,
      error: err?.message ? err.message : String(err),
    });
  }
};
