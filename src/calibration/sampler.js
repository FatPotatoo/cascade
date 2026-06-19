/**
 * HSV sampling for calibration (PRD FR-10).
 *
 * Grabs a small patch from the live video, averages it, converts to HSV in
 * OpenCV convention (H 0–179, S/V 0–255), and expands it into a threshold
 * range with tolerance. Done in plain canvas/JS — no OpenCV needed for the
 * single-patch sample (OpenCV is used later for full-frame detection).
 */

// Range half-widths around the sampled center. S/V are generous so a note's
// lighter/less-saturated edges are still captured (otherwise the fitted box
// shrinks to the saturated core); H stays tight to keep colors separable.
const TOL = { h: 13, s: 105, v: 95 };

let scratch = null;

function getScratch(w, h) {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  return scratch;
}

/** RGB (0–255) → HSV in OpenCV convention (H 0–179, S/V 0–255). */
export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h: Math.round(h / 2), s: Math.round(s * 255), v: Math.round(v * 255) };
}

function clampH(x) {
  return Math.max(0, Math.min(179, x));
}
function clamp255(x) {
  return Math.max(0, Math.min(255, x));
}

/**
 * Sample the average HSV of a square patch centred at (nx, ny) in normalized
 * [0,1] video coordinates, and return a threshold range.
 *
 * @param {HTMLVideoElement} video
 * @param {number} nx normalized x (0..1)
 * @param {number} ny normalized y (0..1)
 * @param {number} patch patch size in px (default 28)
 */
export function sampleHsvRange(video, nx, ny, patch = 28) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cv = getScratch(vw, vh);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, vw, vh);

  const px = Math.round(nx * vw);
  const py = Math.round(ny * vh);
  const half = Math.floor(patch / 2);
  const x0 = Math.max(0, px - half);
  const y0 = Math.max(0, py - half);
  const w = Math.min(patch, vw - x0);
  const h = Math.min(patch, vh - y0);

  const data = ctx.getImageData(x0, y0, w, h).data;
  let sh = 0,
    ss = 0,
    sv = 0,
    n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    sh += hsv.h;
    ss += hsv.s;
    sv += hsv.v;
    n++;
  }
  const center = { h: sh / n, s: ss / n, v: sv / n };

  return {
    center,
    range: {
      hLow: clampH(Math.round(center.h - TOL.h)),
      hHigh: clampH(Math.round(center.h + TOL.h)),
      sLow: clamp255(Math.round(center.s - TOL.s)),
      sHigh: 255,
      vLow: clamp255(Math.round(center.v - TOL.v)),
      vHigh: 255,
    },
  };
}

/**
 * Do two sampled ranges overlap enough to risk misdetection? (PRD FR-12)
 * Cheap heuristic: hue centers closer than a threshold on the hue circle.
 */
export function rangesTooClose(centerA, centerB, minHueGap = 14) {
  const d = Math.abs(centerA.h - centerB.h);
  return Math.min(d, 180 - d) < minHueGap;
}
