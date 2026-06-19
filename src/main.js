/**
 * Cascade entry point — landing page + game lifecycle.
 *
 * The app has two states:
 *   HOME    — landing page, camera OFF. Nothing touches getUserMedia here, so
 *             the webcam light stays off while the player is just browsing.
 *   PLAYING — camera ON, calibration + Zen game loop running.
 *
 * Pressing Play starts the camera and game; Exit stops the camera (releasing
 * the device) and returns to HOME. Pipeline (PRD §14): camera → calibration →
 * physics → render. Live note detection from the feed is the next milestone.
 */

import './style.css';
import { CONFIG } from './config.js';
import { Camera } from './camera/camera.js';
import { PhysicsWorld } from './physics/world.js';
import { Overlay } from './render/overlay.js';
import { Detector } from './vision/detector.js';
import { Tracker } from './vision/tracker.js';
import { makePlayAreaTransform } from './vision/perspective.js';
import { NoteBodies } from './physics/notes.js';
import { runCalibration } from './calibration/flow.js';
import { loadProfile, saveProfile, isPlayable } from './calibration/store.js';
import { getColor, ROLES } from './calibration/palette.js';

const els = {
  home: document.getElementById('home'),
  homeError: document.getElementById('home-error'),
  playBtn: document.getElementById('play-btn'),
  canvas: document.getElementById('stage'),
  overlayUi: document.getElementById('overlay-ui'),
  status: document.getElementById('status'),
  legend: document.getElementById('legend'),
  cameraError: document.getElementById('camera-error'),
  recalibrate: document.getElementById('recalibrate'),
  exitBtn: document.getElementById('exit-btn'),
};

const camera = new Camera();
let session = null; // active game session (camera + loop), or null at HOME
let starting = false; // true while startGame() is mid-flight (camera/calibration)
let playToken = 0; // invalidates an in-flight startGame() if we navigate away

function setStatus(text) {
  els.status.textContent = text;
}

/** Rebuild the on-screen legend from the player's chosen color→role mapping. */
function updateLegend(profile) {
  els.legend.replaceChildren();
  for (const role of ROLES) {
    const colorId = profile.mapping[role.id];
    if (!colorId) continue;
    const color = getColor(colorId);
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML =
      `<span class="legend-dot" style="background:${color.css}"></span>` +
      `${color.name} — ${role.name}`;
    els.legend.appendChild(item);
  }
  els.legend.classList.remove('hidden');
}

function showHome() {
  els.home.classList.remove('hidden');
  els.canvas.classList.add('hidden');
  els.overlayUi.classList.add('hidden');
}

function showGame() {
  els.home.classList.add('hidden');
  els.canvas.classList.remove('hidden');
  els.overlayUi.classList.remove('hidden');
  els.cameraError.classList.add('hidden');
}

/** Tear down the running session and release the camera; return to landing. */
function enterHome() {
  playToken++; // cancel any startGame() still awaiting camera/calibration
  starting = false;
  if (session) {
    cancelAnimationFrame(session.raf);
    session.detector?.dispose();
    session = null;
  }
  // Remove any calibration overlay that may still be mounted.
  document.querySelectorAll('.cal-overlay').forEach((n) => n.remove());
  camera.stop();
  els.recalibrate.classList.add('hidden');
  els.exitBtn.classList.add('hidden');
  showHome();
}

/** Return to the landing page, fixing the URL. `denied` shows a camera note. */
function backToHome(denied = false) {
  if (location.hash) history.replaceState(null, '', location.pathname);
  enterHome();
  if (denied) els.homeError?.classList.remove('hidden');
}

/**
 * Start a play session. MUST be called from a real user gesture (the Play
 * button or the resume gate), because getUserMedia needs user activation to
 * prompt — auto-starting on page load just hangs at "Requesting camera…".
 */
async function startGame() {
  if (session || starting) return;
  starting = true;
  const token = ++playToken;
  els.homeError?.classList.add('hidden');
  showGame();
  // Reflect the route without firing the router (pushState doesn't emit events).
  if (location.hash !== '#/play') history.pushState(null, '', '#/play');

  // 1. Camera (PRD FR-1). Only now does the webcam turn on.
  try {
    setStatus('Requesting camera…');
    await camera.start();
  } catch (err) {
    console.error('Camera denied/unavailable:', err);
    starting = false;
    backToHome(true); // PRD: on denial, redirect to the landing page
    return;
  }
  if (token !== playToken) {
    starting = false;
    camera.stop();
    return;
  }

  // 2. Calibration profile (PRD §11): reuse a saved one, else run the
  //    bring-your-own-palette flow (pick colors → assign roles → sample HSV).
  let profile = loadProfile();
  if (!isPlayable(profile)) {
    setStatus('Let’s set up your colors');
    profile = await runCalibration(camera.video, profile);
    if (token !== playToken) {
      starting = false;
      return; // exited mid-calibration
    }
    saveProfile(profile);
  }
  updateLegend(profile);

  els.recalibrate.onclick = async () => {
    profile = await runCalibration(camera.video, profile);
    saveProfile(profile);
    updateLegend(profile);
  };
  els.recalibrate.classList.remove('hidden');
  els.exitBtn.classList.remove('hidden');

  // 3. World + render.
  const { width, height } = CONFIG.capture;
  const overlay = new Overlay(els.canvas, width, height);
  const physics = new PhysicsWorld(width, height);

  // 3b. Vision: detect notes in the play area → track → drive note colliders.
  const transform = makePlayAreaTransform(profile.corners, width, height);
  // The feed is cropped to this same rect so the image and the detection share
  // one coordinate space (otherwise detected boxes land off the notes).
  const playCrop = cropRectFromCorners(profile.corners);
  const detectColors = buildDetectColors(profile);
  const detector = new Detector();
  const tracker = new Tracker();
  const noteBodies = new NoteBodies(physics.world);
  const colorFor = (id) => getColor(id)?.css || '#ffffff';
  const detectIntervalMs = 1000 / CONFIG.detection.rateHz;
  let lastDetect = 0;
  let detectFailures = 0;
  let detectionEnabled = true;

  let wellDoneUntil = 0;
  physics.onCatch = () => {
    wellDoneUntil = performance.now() + 1600;
  };
  physics.onMiss = () => {
    /* no penalty in Zen mode — play just continues (PRD §5, §9) */
  };

  setStatus('Ready — arrange your notes');

  // 4. Main loop. Detection runs throttled (~detection.rateHz); physics and
  //    render run every frame (PRD §14: decouple detection from render rate).
  session = { raf: 0, detector };
  starting = false;
  let last = performance.now();
  function frame(now) {
    const dt = now - last;
    last = now;

    if (detectionEnabled && detectColors.length && now - lastDetect >= detectIntervalMs) {
      lastDetect = now;
      try {
        const detections = detector.detect(camera.video, detectColors, profile.corners, transform);
        tracker.update(detections);
        noteBodies.sync(tracker.tracks);
        detectFailures = 0;
      } catch (e) {
        console.error('Detection error:', e);
        if (++detectFailures >= 5) {
          detectionEnabled = false;
          setStatus('Detection paused (error) — physics still running');
        }
      }
    }

    physics.maybeSpawn(now);
    physics.step(dt);

    overlay.clear();
    overlay.drawFeed(camera.video, playCrop);
    overlay.drawNotes(tracker.tracks, colorFor);
    overlay.drawSpout(physics.spoutX, physics.spoutY);
    overlay.drawBucket(physics.bucketRect);
    overlay.drawBalls(physics.balls);

    const wd = (wellDoneUntil - now) / 1600;
    overlay.drawWellDone(Math.max(0, Math.min(1, wd)));

    session.raf = requestAnimationFrame(frame);
  }
  session.raf = requestAnimationFrame(frame);
}

/**
 * Build the list of colors to detect from the calibration profile:
 * one entry per assigned role that has a sampled HSV range. De-duped by color
 * (if the same color is mapped to both roles, the primary role wins).
 */
/** Bounding rect {l,t,r,b} (normalized) of the corner-pin play area. */
function cropRectFromCorners(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return {
    l: Math.min(...xs),
    t: Math.min(...ys),
    r: Math.max(...xs),
    b: Math.max(...ys),
  };
}

function buildDetectColors(profile) {
  const out = [];
  const seen = new Set();
  for (const role of ROLES) {
    const colorId = profile.mapping[role.id];
    const sample = colorId && profile.samples[colorId];
    if (!colorId || !sample || !sample.range || seen.has(colorId)) continue;
    seen.add(colorId);
    out.push({ colorId, role: role.id, range: sample.range });
  }
  return out;
}

// --- Routing ----------------------------------------------------------------
// The game lives at its own route (#/play) so the landing page (#/) is a
// distinct "page": Exit and the browser Back button both return home and
// release the camera. The camera is NEVER started by the router — only by a
// user gesture (Play button) — so a reload/deep-link to #/play with no live
// session sends the player back to the landing page to press Play.
function route() {
  if (location.hash === '#/play') {
    if (!session && !starting) backToHome(false);
  } else if (session || starting) {
    enterHome();
  }
}

els.playBtn.addEventListener('click', startGame); // direct → keeps user gesture
els.exitBtn.addEventListener('click', () => backToHome(false));
window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);
// Release the camera if the user closes/navigates away from the tab.
window.addEventListener('pagehide', () => camera.stop());

showHome();
route(); // a reload at #/play with no session falls back to the landing page
