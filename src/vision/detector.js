/**
 * Pure-JavaScript note detector (PRD FR-4, FR-5, FR-6, §14).
 *
 * Replaces the OpenCV.js pipeline (whose 11 MB WASM init froze the main
 * thread). For our needs — colored rectangles on a wall — plain JS on a
 * downscaled frame is fast (a few ms) and has zero dependencies / no freeze.
 *
 * Per call:
 *   webcam frame → (downscaled) → per-pixel HSV threshold → binary mask →
 *   connected-components (flood fill) → area/aspect filter → centroid inside
 *   the play-area quad? → orientation + size from image moments → map the
 *   oriented box through the perspective transform into game space.
 */

import { CONFIG } from '../config.js';

export class Detector {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.pw = 0;
    this.ph = 0;
    this.mask = null;
    this.visited = null;
    this.stack = null;
  }

  _ensure(pw, ph) {
    if (pw === this.pw && ph === this.ph && this.mask) return;
    this.pw = pw;
    this.ph = ph;
    this.canvas.width = pw;
    this.canvas.height = ph;
    const n = pw * ph;
    this.mask = new Uint8Array(n);
    this.visited = new Uint8Array(n);
    this.stack = new Int32Array(n);
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {Array<{colorId, role, range}>} colors assigned colors to detect
   * @param {Array<[number,number]>} corners normalized play-area quad (or null)
   * @param {{map:(nx,ny)=>[number,number]}} transform camera→game mapper
   * @returns {Array<{colorId, role, x, y, w, h, angle}>} detections in game space
   */
  detect(video, colors, corners, transform) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return [];

    const scale = CONFIG.capture.processScale;
    const pw = Math.max(1, Math.round(vw * scale));
    const ph = Math.max(1, Math.round(vh * scale));
    this._ensure(pw, ph);

    this.ctx.drawImage(video, 0, 0, pw, ph);
    const data = this.ctx.getImageData(0, 0, pw, ph).data;
    const n = pw * ph;

    const { minAreaFrac, maxAreaFrac, maxAspect } = CONFIG.detection;
    const minArea = minAreaFrac * n;
    const maxArea = maxAreaFrac * n;

    const detections = [];
    const { mask, visited, stack } = this;

    for (const color of colors) {
      buildMask(data, mask, n, color.range);
      visited.fill(0);

      for (let seed = 0; seed < n; seed++) {
        if (!mask[seed] || visited[seed]) continue;

        // Flood fill this component. Collect the blob's *boundary* pixels —
        // enough to compute its convex hull / minimum-area rectangle, which
        // gives a STABLE rotation even for square notes (image moments don't).
        let sp = 0;
        stack[sp++] = seed;
        visited[seed] = 1;
        let area = 0;
        let sx = 0;
        let sy = 0;
        const boundary = []; // [x, y, x, y, ...]

        while (sp > 0) {
          const idx = stack[--sp];
          const x = idx % pw;
          const y = (idx / pw) | 0;
          area++;
          sx += x;
          sy += y;

          // A pixel is on the boundary if it touches the frame edge or any
          // 4-neighbour outside the mask.
          const onEdge = x === 0 || y === 0 || x === pw - 1 || y === ph - 1;
          const isBoundary =
            onEdge ||
            !mask[idx - 1] ||
            !mask[idx + 1] ||
            !mask[idx - pw] ||
            !mask[idx + pw];
          if (isBoundary) boundary.push(x, y);

          // 8-connected flood.
          const x0 = x > 0 ? x - 1 : x;
          const x1 = x < pw - 1 ? x + 1 : x;
          const y0 = y > 0 ? y - 1 : y;
          const y1 = y < ph - 1 ? y + 1 : y;
          for (let ny = y0; ny <= y1; ny++) {
            for (let nx = x0; nx <= x1; nx++) {
              const ni = ny * pw + nx;
              if (mask[ni] && !visited[ni]) {
                visited[ni] = 1;
                stack[sp++] = ni;
              }
            }
          }
        }

        if (area < minArea || area > maxArea) continue;
        if (corners && !pointInQuad(sx / area / pw, sy / area / ph, corners)) continue;

        const rect = minAreaRect(boundary);
        if (!rect) continue;
        const aspect = Math.max(rect.w, rect.h) / Math.max(1e-3, Math.min(rect.w, rect.h));
        if (aspect > maxAspect) continue; // too elongated → hand/arm/edge

        // Map the 4 rectangle corners (processed px) → game space, then grow
        // outward so the box fully covers the note (edges the threshold missed).
        const pts = rect.corners.map(([px, py]) => transform.map(px / pw, py / ph));
        const box = boxToGame(pts);
        box.w *= CONFIG.detection.boxScale;
        box.h *= CONFIG.detection.boxScale;
        detections.push({ colorId: color.colorId, role: color.role, ...box });
      }
    }

    return detections;
  }

  dispose() {
    this.mask = this.visited = this.stack = null;
    this.pw = this.ph = 0;
  }
}

/** Fill `mask` (1/0) for pixels whose HSV falls in `range`. */
function buildMask(data, mask, n, range) {
  const { hLow, hHigh, sLow, sHigh, vLow, vHigh } = range;
  const wrap = hLow > hHigh; // hue range crosses 0/179
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const [h, s, v] = rgbToHsv(data[p], data[p + 1], data[p + 2]);
    if (s < sLow || s > sHigh || v < vLow || v > vHigh) {
      mask[i] = 0;
      continue;
    }
    const hueOk = wrap ? h >= hLow || h <= hHigh : h >= hLow && h <= hHigh;
    mask[i] = hueOk ? 1 : 0;
  }
}

/** RGB (0–255) → HSV in OpenCV convention (H 0–179, S/V 0–255). */
function rgbToHsv(r, g, b) {
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
  return [Math.round(h / 2), Math.round(s * 255), Math.round(max * 255)];
}

/**
 * Convex hull (Andrew's monotone chain) of a flat [x,y,x,y,…] point list.
 * Returns hull vertices as [[x,y],…] in CCW order, or null if degenerate.
 */
function convexHull(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  if (pts.length < 3) return null;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : null;
}

/**
 * Minimum-area bounding rectangle of a blob (rotating calipers over the convex
 * hull edges). This is the pure-JS equivalent of OpenCV's minAreaRect and gives
 * a stable, edge-aligned angle — unlike image moments, which are degenerate for
 * square notes. Returns { corners:[[x,y]×4 in TL,TR,BR,BL of the edge frame],
 * w, h } or null.
 */
function minAreaRect(boundary) {
  const hull = convexHull(boundary);
  if (!hull) return null;
  const nH = hull.length;
  let best = null;

  for (let i = 0; i < nH; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % nH];
    let ex = b[0] - a[0];
    let ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    ex /= len;
    ey /= len;
    const px = -ey; // unit normal
    const py = ex;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const h of hull) {
      const dx = h[0] - a[0];
      const dy = h[1] - a[1];
      const u = dx * ex + dy * ey;
      const v = dx * px + dy * py;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const areaR = w * h;
    if (!best || areaR < best.areaR) {
      best = { areaR, a, ex, ey, px, py, minU, maxU, minV, maxV, w, h };
    }
  }

  const { a, ex, ey, px, py, minU, maxU, minV, maxV } = best;
  const corner = (u, v) => [a[0] + ex * u + px * v, a[1] + ey * u + py * v];
  return {
    corners: [corner(minU, minV), corner(maxU, minV), corner(maxU, maxV), corner(minU, maxV)],
    w: best.w,
    h: best.h,
  };
}

/** Convex-quad point test; quad in order TL, TR, BR, BL (PRD corner-pin). */
function pointInQuad(px, py, quad) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross !== 0) {
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

/**
 * Turn 4 transformed game-space corner points into center/size/angle.
 * Always reports `w ≥ h` with `angle` measured along the LONGER edge, so the
 * angle is stable (doesn't flip 90° depending on which edge minAreaRect picked).
 */
function boxToGame(pts) {
  const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
  const edge = (a, b) => Math.hypot(pts[b][0] - pts[a][0], pts[b][1] - pts[a][1]);
  const side01 = (edge(0, 1) + edge(2, 3)) / 2; // along edge 0→1
  const side12 = (edge(1, 2) + edge(3, 0)) / 2; // along edge 1→2

  let w;
  let h;
  let angle;
  if (side01 >= side12) {
    w = side01;
    h = side12;
    angle = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]);
  } else {
    w = side12;
    h = side01;
    angle = Math.atan2(pts[2][1] - pts[1][1], pts[2][0] - pts[1][0]);
  }
  return { x: cx, y: cy, w, h, angle };
}
