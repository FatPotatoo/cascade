/**
 * Note tracker (PRD FR-7, FR-8, FR-8a).
 *
 * Turns per-frame detections (which flicker and jitter) into stable, identified
 * notes so that moving a note updates the *same* collider instead of churning
 * create/destroy. Responsibilities:
 *   - Track-by-proximity: match each detection to the nearest same-color track.
 *   - Smoothing + deadzone: ride over sub-threshold jitter (anti-jitter freeze).
 *   - Occlusion-hold: keep a track (and its collider) alive for a few frames
 *     when detection is briefly lost — a reaching hand must never drop a ball.
 */

import { CONFIG } from '../config.js';

const POS_SMOOTH = 0.4; // 0 = frozen, 1 = snap to detection
const POS_DEADZONE = 3; // game px; ignore movements smaller than this
const ANGLE_SMOOTH = 0.25; // gentle — angle is the most jitter-prone signal
const ANGLE_DEADZONE = 0.035; // rad (~2°); a still note shouldn't rotate at all
// A note whose long/short sides are within this ratio is treated as square, so
// its angle has 90° symmetry (not 180°) — prevents a 0°/90° flip from spinning.
const SQUARE_ASPECT = 1.3;

let nextId = 1;

export class Tracker {
  constructor() {
    this.tracks = []; // {id, colorId, role, x, y, w, h, angle, missed, visible}
  }

  /**
   * @param {Array} detections game-space detections {colorId, role, x,y,w,h,angle}
   * @param {number} frame monotonically increasing frame counter
   * @returns {Array} active tracks (includes occlusion-held ones)
   */
  update(detections) {
    const radius = CONFIG.tracking.matchRadius;
    const radius2 = radius * radius;
    const used = new Set();

    // Build candidate (track, detection) pairs of matching color within radius.
    const pairs = [];
    this.tracks.forEach((track, ti) => {
      detections.forEach((det, di) => {
        if (det.colorId !== track.colorId) return;
        const d2 = (det.x - track.x) ** 2 + (det.y - track.y) ** 2;
        if (d2 <= radius2) pairs.push({ ti, di, d2 });
      });
    });
    pairs.sort((a, b) => a.d2 - b.d2);

    const matchedTracks = new Set();
    for (const { ti, di } of pairs) {
      if (matchedTracks.has(ti) || used.has(di)) continue;
      matchedTracks.add(ti);
      used.add(di);
      this._applyDetection(this.tracks[ti], detections[di]);
    }

    // Unmatched tracks: occlusion-hold, then expire.
    const survivors = [];
    this.tracks.forEach((track, ti) => {
      if (matchedTracks.has(ti)) {
        survivors.push(track);
      } else {
        track.missed += 1;
        track.visible = false;
        if (track.missed <= CONFIG.notes.occlusionHoldFrames) survivors.push(track);
      }
    });
    this.tracks = survivors;

    // Unmatched detections: spawn new tracks.
    detections.forEach((det, di) => {
      if (used.has(di)) return;
      this.tracks.push({
        id: nextId++,
        colorId: det.colorId,
        role: det.role,
        x: det.x,
        y: det.y,
        w: det.w,
        h: det.h,
        angle: normalizeAngle(det.angle, anglePeriod(det.w, det.h)),
        missed: 0,
        visible: true,
      });
    });

    return this.tracks;
  }

  _applyDetection(track, det) {
    track.missed = 0;
    track.visible = true;
    track.role = det.role;

    const dx = det.x - track.x;
    const dy = det.y - track.y;
    if (Math.hypot(dx, dy) > POS_DEADZONE) {
      track.x += dx * POS_SMOOTH;
      track.y += dy * POS_SMOOTH;
    }
    track.w += (det.w - track.w) * POS_SMOOTH;
    track.h += (det.h - track.h) * POS_SMOOTH;

    // Angle: use the note's symmetry period and ignore tiny jitter so a fixed
    // note holds completely still (no spinning that flings the ball around).
    const period = anglePeriod(track.w, track.h);
    const d = wrapAngle(det.angle - track.angle, period);
    if (Math.abs(d) > ANGLE_DEADZONE) {
      track.angle = normalizeAngle(track.angle + d * ANGLE_SMOOTH, period);
    }
  }

  reset() {
    this.tracks = [];
  }
}

/** Square notes have 90° symmetry; clearly oblong ones have 180°. */
function anglePeriod(w, h) {
  const aspect = Math.max(w, h) / Math.max(1e-3, Math.min(w, h));
  return aspect < SQUARE_ASPECT ? Math.PI / 2 : Math.PI;
}

/** Wrap an angle delta into (-period/2, period/2]. */
function wrapAngle(d, period) {
  const half = period / 2;
  return ((d + half) % period + period) % period - half;
}

/** Normalize an absolute angle into (-period/2, period/2]. */
function normalizeAngle(a, period) {
  return wrapAngle(a, period);
}
