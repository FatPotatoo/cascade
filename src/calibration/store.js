/**
 * Calibration profile persistence (PRD FR-10, §11.2).
 *
 * Profile shape:
 * {
 *   version: 1,
 *   chosenColors: string[],            // palette ids the player owns
 *   mapping: { bouncer: id|null, brake: id|null },
 *   samples: {                         // sampled HSV per *assigned* color id
 *     [colorId]: {
 *       center: { h, s, v },           // sampled center (for UI + overlap check)
 *       range:  { hLow, hHigh, sLow, sHigh, vLow, vHigh }  // threshold for detection
 *     }
 *   },
 *   corners: [[x,y]*4],                // corner-pin rectangle, normalized TL,TR,BR,BL
 * }
 */

import { CONFIG } from '../config.js';

// Bump when the profile shape changes so stale profiles are ignored (and the
// player is re-calibrated cleanly) instead of crashing the flow.
const VERSION = 2;

export function loadProfile() {
  try {
    const raw = localStorage.getItem(CONFIG.storageKey);
    if (!raw) return null;
    const profile = JSON.parse(raw);
    if (profile.version !== VERSION) return null;
    return profile;
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  const toSave = { version: VERSION, ...profile };
  localStorage.setItem(CONFIG.storageKey, JSON.stringify(toSave));
  return toSave;
}

export function clearProfile() {
  localStorage.removeItem(CONFIG.storageKey);
}

/** A profile is playable once the Bouncer role has a fully-sampled color. */
export function isPlayable(profile) {
  const bouncer = profile?.mapping?.bouncer;
  return !!(
    bouncer &&
    profile.samples &&
    profile.samples[bouncer] &&
    profile.samples[bouncer].range &&
    Array.isArray(profile.corners) &&
    profile.corners.length === 4
  );
}
