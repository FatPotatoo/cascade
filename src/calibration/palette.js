/**
 * Bring-your-own palette (PRD §11.1, FR-9a/9b).
 *
 * The player tells us which sticky-note colors they actually have, then maps
 * them to behavior roles. Nothing here is required — these are the common
 * sticky-note hues we can offer, each with:
 *  - a display swatch (CSS color),
 *  - a nominal HSV center (OpenCV convention: H 0–179, S/V 0–255) used only
 *    to seed the sampler and to estimate color separation before calibration,
 *  - a `reliability` hint shown in the UI (how well it tends to detect).
 */

export const PALETTE = [
  { id: 'magenta', name: 'Magenta / Hot Pink', css: '#ff2d95', hsv: { h: 162, s: 200, v: 230 }, reliability: 'great' },
  { id: 'red',     name: 'Red',                css: '#e63946', hsv: { h: 177, s: 200, v: 220 }, reliability: 'good' },
  { id: 'orange',  name: 'Orange',             css: '#ff8c1a', hsv: { h: 15,  s: 210, v: 235 }, reliability: 'good' },
  { id: 'yellow',  name: 'Yellow',             css: '#ffd60a', hsv: { h: 28,  s: 200, v: 240 }, reliability: 'tricky' },
  { id: 'green',   name: 'Green',              css: '#2ecc71', hsv: { h: 70,  s: 180, v: 210 }, reliability: 'good' },
  { id: 'cyan',    name: 'Cyan / Light Blue',  css: '#1fb6ff', hsv: { h: 100, s: 190, v: 230 }, reliability: 'great' },
  { id: 'blue',    name: 'Blue',               css: '#3a66ff', hsv: { h: 115, s: 200, v: 210 }, reliability: 'good' },
  { id: 'purple',  name: 'Purple',             css: '#9b5de5', hsv: { h: 140, s: 170, v: 210 }, reliability: 'tricky' },
];

export function getColor(id) {
  return PALETTE.find((c) => c.id === id) || null;
}

/**
 * The behavior roles a color can be assigned to (PRD §7). v1 has exactly two;
 * extra colors the player owns are ignored. Bouncer is the primary role and is
 * what 1-color play uses.
 */
export const ROLES = [
  {
    id: 'bouncer',
    name: 'Bouncer',
    blurb: 'Aim — tilt it to bounce balls toward the bucket.',
    primary: true,
  },
  {
    id: 'brake',
    name: 'Brake',
    blurb: 'Slow balls so they settle in instead of bouncing out.',
    primary: false,
  },
];

/** Reliability ranking, best first — used for auto-suggesting role colors. */
const RELIABILITY_RANK = { great: 0, good: 1, tricky: 2 };

/** Hue distance on the 0–179 circle. */
export function hueDistance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 180 - d);
}

/**
 * Auto-suggest a role→colorId mapping from the chosen colors.
 * Picks the most reliable color for Bouncer, then the color that is both
 * reliable and best-separated in hue for Brake (PRD §7, FR-9b).
 *
 * @param {string[]} chosenIds
 * @returns {{bouncer: string|null, brake: string|null}}
 */
export function suggestMapping(chosenIds) {
  const colors = chosenIds.map(getColor).filter(Boolean);
  if (colors.length === 0) return { bouncer: null, brake: null };

  const byReliability = [...colors].sort(
    (a, b) => RELIABILITY_RANK[a.reliability] - RELIABILITY_RANK[b.reliability],
  );
  const bouncer = byReliability[0];

  if (colors.length === 1) return { bouncer: bouncer.id, brake: null };

  // For brake, prefer a reliable color far from the bouncer's hue.
  const brake = colors
    .filter((c) => c.id !== bouncer.id)
    .map((c) => ({
      c,
      score: hueDistance(c.hsv.h, bouncer.hsv.h) - RELIABILITY_RANK[c.reliability] * 12,
    }))
    .sort((a, b) => b.score - a.score)[0].c;

  return { bouncer: bouncer.id, brake: brake.id };
}
