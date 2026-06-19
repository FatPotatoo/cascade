/**
 * Central tuning constants for Cascade.
 *
 * Keeping every "magic number" here makes the physics feel and the CV
 * thresholds easy to tweak without hunting through modules. Values are
 * starting points from the PRD's design (§7, §8, §14) and expected to be
 * tuned by hand once the loop is playable.
 */

export const CONFIG = {
  // --- Capture / processing ---------------------------------------------
  capture: {
    width: 960, // displayed/working resolution
    height: 540,
    targetFps: 30,
    // Vision can run at a lower resolution than we render, to stay in budget.
    processScale: 0.5, // process at 50% (PRD §14 performance budget)
  },

  // --- Physics world ----------------------------------------------------
  physics: {
    gravityY: 1, // Matter default-ish; tuned for a calm fall
    ballRadius: 10,
    ballRestitution: 0.4, // balls themselves are mildly bouncy
    ballFriction: 0.02,
    // Gentle stream, a touch livelier (PRD §8).
    spawnIntervalMs: 1500,
    maxBalls: 14, // safety cap so the world never floods
  },

  // --- Spawn spout (fixed per session, random x within a band) ----------
  spout: {
    // Random x chosen within [marginX, width - marginX] at session start,
    // but kept at least `bucketClearance` px to the side of the bucket opening
    // so a straight unaided drop misses (notes required to score).
    marginX: 90,
    bucketClearance: 90,
    y: 24,
  },

  // --- Bucket (fixed position, slight inner-wall restitution) -----------
  bucket: {
    width: 116, // opening width
    height: 100,
    wallThickness: 11,
    // Inner walls are a bit bouncy so a *fast* ball bounces out — this is
    // what makes the blue brake matter (PRD §8, §14).
    innerRestitution: 0.55,
    // A ball counts as "caught" when resting inside below this speed.
    catchSpeed: 1.2,
    bottomMargin: 28, // distance from bottom of play area
  },

  // --- Detection (CV) ---------------------------------------------------
  detection: {
    rateHz: 18, // run detection ~18×/s while rendering physics at 60 (PRD §14)
    // Contour area as a fraction of the processed-frame area. Smaller than
    // minArea = noise; larger than maxArea = a hand/arm/clutter, not a note.
    minAreaFrac: 0.0009,
    maxAreaFrac: 0.08,
    // A sticky note is roughly square; reject very elongated blobs.
    minAspect: 0.35,
    maxAspect: 2.9,
    morphKernel: 3, // open/close kernel size to denoise the mask
    // The HSV threshold tends to miss a note's lighter/less-saturated edges,
    // so the fitted box comes out slightly small. Grow it outward for full
    // coverage of the physical note (collider + visual).
    boxScale: 1.18,
  },

  // --- Tracking ---------------------------------------------------------
  tracking: {
    matchRadius: 70, // game px: a detection within this of a track = same note
  },

  // --- Note behaviours (role → physics) ---------------------------------
  // Keyed by behavior role, not color, since the player picks which color is
  // which (PRD §7).
  notes: {
    bouncer: {
      restitution: 0.9, // aim — reflects off the note's surface angle
      friction: 0.05,
    },
    brake: {
      restitution: 0.05, // kills speed so balls settle into the bucket
      friction: 0.9,
    },
    // Frames a tracked note may go undetected before its collider is
    // removed. Bridges brief occlusion by a reaching hand (PRD FR-8a).
    occlusionHoldFrames: 12,
    // Recreate a collider only if its size drifts more than this (px); small
    // changes are applied as cheap position/angle moves.
    resizeThreshold: 10,
  },

  // --- Default HSV ranges (overwritten by calibration) ------------------
  // Hue 0–179, Sat/Val 0–255 (OpenCV convention). These are only fallbacks
  // for before the user calibrates against their real notes & lighting.
  defaultHsv: {
    pink: { hLow: 150, hHigh: 175, sLow: 90, sHigh: 255, vLow: 80, vHigh: 255 },
    blue: { hLow: 95, hHigh: 120, sLow: 90, sHigh: 255, vLow: 80, vHigh: 255 },
  },

  storageKey: 'cascade.calibration.v1',
};
