/**
 * Calibration flow controller (PRD §11.1, FR-9a/9b/10/12).
 *
 * Four steps:
 *   1. Play area — drag four corners over the wall region to use (corner-pin).
 *                  Everything outside is ignored by detection (PRD FR-9).
 *   2. Colors    — player taps which sticky-note colors they have.
 *   3. Roles     — assign each color to a behavior (Bouncer / Brake). Editable;
 *                  auto-suggested. Supports 1-color (Bouncer-only) play.
 *   4. Sample    — for each *assigned* color, hold the note up and tap it to
 *                  sample its HSV under current lighting. Warns on overlap.
 *
 * Usage:
 *   const profile = await runCalibration(video, existingProfile);
 */

import './calibration.css';
import { PALETTE, ROLES, getColor, suggestMapping } from './palette.js';
import { sampleHsvRange, rangesTooClose } from './sampler.js';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function runCalibration(video, existing = null) {
  return new Promise((resolve) => {
    new CalibrationFlow(video, existing, resolve).start();
  });
}

/** Rectangle {l,t,r,b} → 4 corner points in order TL, TR, BR, BL. */
function cornersFromRect({ l, t, r, b }) {
  return [
    [l, t],
    [r, t],
    [r, b],
    [l, b],
  ];
}

/** 4 corner points → their bounding rectangle {l,t,r,b}. */
function rectFromCorners(corners) {
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return {
    l: Math.min(...xs),
    t: Math.min(...ys),
    r: Math.max(...xs),
    b: Math.max(...ys),
  };
}

class CalibrationFlow {
  constructor(video, existing, onDone) {
    this.video = video;
    this.onDone = onDone;

    // Working state, seeded from an existing profile when re-calibrating.
    this.chosen = new Set(existing?.chosenColors || []);
    this.mapping = existing?.mapping || { bouncer: null, brake: null };
    this.samples = { ...(existing?.samples || {}) }; // colorId → {center, range}
    // Corner-pin is an axis-aligned rectangle (normalized [0,1]); resized by
    // dragging its edges/corners so it stays a rectangle (not an arbitrary
    // quad). Seed from an existing profile's bounding box when re-calibrating.
    this.rect = existing?.corners
      ? rectFromCorners(existing.corners)
      : { l: 0.15, t: 0.12, r: 0.85, b: 0.88 };

    this.overlay = el('div', { class: 'cal-overlay' });
    this.card = el('div', { class: 'cal-card' });
    this.overlay.appendChild(this.card);
  }

  start() {
    document.body.appendChild(this.overlay);
    this.renderCorners();
  }

  finish() {
    // Drop samples for colors no longer assigned to a role. Persist the full
    // {center, range} so re-calibration can re-seed without losing `center`.
    const assigned = new Set(
      [this.mapping.bouncer, this.mapping.brake].filter(Boolean),
    );
    const samples = {};
    for (const id of assigned) {
      if (this.samples[id] && this.samples[id].range) samples[id] = this.samples[id];
    }
    this.overlay.remove();
    this.onDone({
      chosenColors: [...this.chosen],
      mapping: { ...this.mapping },
      samples,
      corners: cornersFromRect(this.rect),
    });
  }

  // --- Step 1: corner-pin play area (axis-aligned rectangle) -------------
  renderCorners() {
    this.card.replaceChildren();

    const preview = el('video', { autoplay: '', playsinline: '', muted: '' });
    preview.srcObject = this.video.srcObject;
    preview.muted = true;
    preview.play?.();

    const wrap = el('div', { class: 'cal-preview-wrap' }, [preview]);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cal-corner-svg');
    const rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectEl.setAttribute('class', 'cal-corner-poly');
    svg.appendChild(rectEl);
    wrap.appendChild(svg);

    // Handles: 4 corners + 4 edge midpoints. Each declares which rectangle
    // bound(s) it moves (x: 'l'|'r', y: 't'|'b'), so dragging keeps a rectangle.
    const HANDLES = [
      { id: 'tl', x: 'l', y: 't', cls: 'corner' },
      { id: 'tr', x: 'r', y: 't', cls: 'corner' },
      { id: 'br', x: 'r', y: 'b', cls: 'corner' },
      { id: 'bl', x: 'l', y: 'b', cls: 'corner' },
      { id: 't', y: 't', cls: 'edge edge-h' },
      { id: 'b', y: 'b', cls: 'edge edge-h' },
      { id: 'l', x: 'l', cls: 'edge edge-v' },
      { id: 'r', x: 'r', cls: 'edge edge-v' },
    ];
    const handleEls = HANDLES.map((h) => {
      const node = el('div', { class: `cal-rect-handle cal-rect-${h.cls.split(' ')[0]} ${h.cls}` });
      node.addEventListener('pointerdown', (e) => this._dragEdge(e, wrap, h));
      wrap.appendChild(node);
      return { spec: h, node };
    });

    const place = () => {
      const r = wrap.getBoundingClientRect();
      const { l, t, r: rr, b } = this.rect;
      rectEl.setAttribute('x', l * r.width);
      rectEl.setAttribute('y', t * r.height);
      rectEl.setAttribute('width', (rr - l) * r.width);
      rectEl.setAttribute('height', (b - t) * r.height);
      const cx = ((l + rr) / 2) * r.width;
      const cy = ((t + b) / 2) * r.height;
      for (const { spec, node } of handleEls) {
        const px = spec.x ? this.rect[spec.x] * r.width : cx;
        const py = spec.y ? this.rect[spec.y] * r.height : cy;
        node.style.left = `${px}px`;
        node.style.top = `${py}px`;
      }
    };
    requestAnimationFrame(place);
    this._placeRect = place;

    this.card.append(
      el('div', { class: 'cal-step-label' }, 'Step 1 of 4'),
      el('h2', {}, 'Mark your play area'),
      el(
        'p',
        { class: 'cal-sub' },
        'Drag the edges (or corners) to frame the wall region the game should watch. It stays a rectangle. Everything outside the blue box is ignored — keep clutter out of it.',
      ),
      wrap,
      el('div', { class: 'cal-footer' }, [
        el('span', { class: 'cal-rel' }, 'Tip: make it a bit smaller than the whole wall.'),
        el('button', { class: 'cal-btn cal-btn-primary', onclick: () => this.renderColors() }, 'Next'),
      ]),
    );
  }

  _dragEdge(e, wrap, spec) {
    e.preventDefault();
    const MIN = 0.12; // minimum normalized width/height
    const move = (ev) => {
      const r = wrap.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const ny = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
      if (spec.x === 'l') this.rect.l = Math.min(nx, this.rect.r - MIN);
      if (spec.x === 'r') this.rect.r = Math.max(nx, this.rect.l + MIN);
      if (spec.y === 't') this.rect.t = Math.min(ny, this.rect.b - MIN);
      if (spec.y === 'b') this.rect.b = Math.max(ny, this.rect.t + MIN);
      this._placeRect();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // --- Step 1: choose available colors ----------------------------------
  renderColors() {
    this.card.replaceChildren();
    const swatches = PALETTE.map((c) => {
      const selected = this.chosen.has(c.id);
      return el(
        'button',
        {
          class: `cal-swatch${selected ? ' selected' : ''}`,
          onclick: () => {
            if (this.chosen.has(c.id)) this.chosen.delete(c.id);
            else this.chosen.add(c.id);
            this.renderColors();
          },
        },
        [
          el('span', { class: 'cal-dot', style: `background:${c.css}` }),
          el('span', { class: 'cal-swatch-text' }, [
            el('span', {}, c.name),
            el('span', { class: `cal-rel ${c.reliability}` }, `detects ${c.reliability}`),
          ]),
        ],
      );
    });

    this.card.append(
      el('div', { class: 'cal-step-label' }, 'Step 2 of 4'),
      el('h2', {}, 'Which sticky-note colors do you have?'),
      el(
        'p',
        { class: 'cal-sub' },
        'Tap every color you can grab right now. Bright, saturated notes detect best — pastels are trickier. You only need one to start, two for the full game.',
      ),
      el('div', { class: 'cal-swatches' }, swatches),
      el('div', { class: 'cal-footer' }, [
        el('button', { class: 'cal-btn cal-btn-ghost', onclick: () => this.renderCorners() }, 'Back'),
        el(
          'button',
          {
            class: 'cal-btn cal-btn-primary',
            disabled: this.chosen.size === 0 ? '' : null,
            onclick: () => {
              this.mapping = suggestMapping([...this.chosen]);
              this.renderRoles();
            },
          },
          'Next',
        ),
      ]),
    );
  }

  // --- Step 2: assign colors to roles -----------------------------------
  renderRoles() {
    this.card.replaceChildren();
    const chosenColors = [...this.chosen].map(getColor);
    const single = chosenColors.length === 1;

    const roleRows = ROLES.map((role) => {
      const disabled = single && role.id === 'brake';
      const select = el('select', {
        disabled: disabled ? '' : null,
        onchange: (e) => {
          this.mapping[role.id] = e.target.value || null;
        },
      });
      select.appendChild(el('option', { value: '' }, disabled ? '—' : 'None'));
      for (const c of chosenColors) {
        const opt = el('option', { value: c.id }, c.name);
        if (this.mapping[role.id] === c.id) opt.selected = true;
        select.appendChild(opt);
      }

      return el('div', { class: 'cal-role' }, [
        el('div', { class: 'cal-role-info' }, [
          el('strong', {}, role.name),
          el(
            'p',
            {},
            disabled
              ? 'Add a second color to enable the Brake. Playing with the Bouncer only for now.'
              : role.blurb,
          ),
        ]),
        select,
      ]);
    });

    this.card.append(
      el('div', { class: 'cal-step-label' }, 'Step 3 of 4'),
      el('h2', {}, 'Assign your colors'),
      el(
        'p',
        { class: 'cal-sub' },
        'Pick which color does what. We suggested the two best-separated colors — change them however you like.',
      ),
      el('div', { class: 'cal-roles' }, roleRows),
      el('div', { class: 'cal-footer' }, [
        el('button', { class: 'cal-btn cal-btn-ghost', onclick: () => this.renderColors() }, 'Back'),
        el(
          'button',
          {
            class: 'cal-btn cal-btn-primary',
            onclick: () => {
              if (!this.mapping.bouncer) {
                // Bouncer is required to play; default to first chosen color.
                this.mapping.bouncer = chosenColors[0].id;
              }
              this.startSampling();
            },
          },
          'Calibrate colors',
        ),
      ]),
    );
  }

  // --- Step 3: sample HSV for each assigned color -----------------------
  startSampling() {
    // Ordered list of distinct color ids actually mapped to a role.
    this.sampleQueue = [this.mapping.bouncer, this.mapping.brake]
      .filter(Boolean)
      .filter((id, i, arr) => arr.indexOf(id) === i);
    this.sampleIndex = 0;
    this.renderSample();
  }

  renderSample() {
    this.card.replaceChildren();
    const colorId = this.sampleQueue[this.sampleIndex];
    const color = getColor(colorId);
    const roleNames = ROLES.filter((r) => this.mapping[r.id] === colorId)
      .map((r) => r.name)
      .join(' + ');
    const existing = this.samples[colorId];

    const preview = el('video', { autoplay: '', playsinline: '', muted: '' });
    preview.srcObject = this.video.srcObject;
    preview.play?.();

    const onSample = (ev) => {
      const rect = preview.getBoundingClientRect();
      const nx = (ev.clientX - rect.left) / rect.width;
      const ny = (ev.clientY - rect.top) / rect.height;
      this.samples[colorId] = sampleHsvRange(this.video, nx, ny);
      this.renderSample();
    };
    preview.addEventListener('click', onSample);

    const result = existing
      ? el('div', { class: 'cal-sample-result' }, [
          el('span', {
            class: 'cal-dot',
            style: `background:hsl(${(existing.center.h / 179) * 360} 70% 55%)`,
          }),
          el('span', {}, 'Got it — tap again to re-sample if it looks off.'),
        ])
      : el('div', { class: 'cal-sample-result' }, [
          el('span', {}, 'Hold the note steady in the box and tap it.'),
        ]);

    this.card.append(
      el('div', { class: 'cal-step-label' }, `Step 4 of 4 · color ${this.sampleIndex + 1} of ${this.sampleQueue.length}`),
      el('h2', {}, [
        el('span', { class: 'cal-mini-dot', style: `background:${color.css}` }),
        `Calibrate your ${color.name} note`,
      ]),
      el('p', { class: 'cal-sub' }, `This is your ${roleNames}. Hold the real note up to the camera so it fills the dashed box, then tap it.`),
      el('div', { class: 'cal-preview-wrap' }, [preview, el('div', { class: 'cal-reticle' })]),
      result,
      this.renderOverlapWarning(),
      el('div', { class: 'cal-footer' }, [
        el('button', { class: 'cal-btn cal-btn-ghost', onclick: () => this.renderRoles() }, 'Back'),
        el(
          'button',
          {
            class: 'cal-btn cal-btn-primary',
            disabled: existing ? null : '',
            onclick: () => {
              if (this.sampleIndex < this.sampleQueue.length - 1) {
                this.sampleIndex++;
                this.renderSample();
              } else {
                this.finish();
              }
            },
          },
          this.sampleIndex < this.sampleQueue.length - 1 ? 'Next color' : 'Start playing',
        ),
      ]),
    );
  }

  renderOverlapWarning() {
    // Warn only once both assigned colors are sampled (PRD FR-12).
    const ids = this.sampleQueue.filter((id) => this.samples[id]);
    if (ids.length < 2) return null;
    const [a, b] = ids;
    if (!rangesTooClose(this.samples[a].center, this.samples[b].center)) return null;
    return el(
      'div',
      { class: 'cal-warn' },
      'These two colors look very similar to the camera and may be confused. Consider re-sampling under better light, or going Back to pick a more different color.',
    );
  }
}
