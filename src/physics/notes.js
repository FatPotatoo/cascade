/**
 * Note colliders (PRD FR-12, FR-13, §14).
 *
 * Bridges the tracker's stable notes to Matter.js static bodies. Each tracked
 * note owns one static body whose transform is driven by detection every cycle
 * (moved via setPosition/setAngle, never recreated, to keep the world stable).
 * Behavior (restitution/friction) comes from the note's role, not its color.
 */

import Matter from 'matter-js';
import { CONFIG } from '../config.js';

const { Bodies, Body, Composite } = Matter;

export class NoteBodies {
  constructor(world) {
    this.world = world;
    this.bodies = new Map(); // trackId → { body, w, h }
  }

  /** Reconcile the live set of tracks with their physics bodies. */
  sync(tracks) {
    const seen = new Set();

    for (const t of tracks) {
      seen.add(t.id);
      const behavior = CONFIG.notes[t.role] || CONFIG.notes.bouncer;
      const existing = this.bodies.get(t.id);

      const sizeChanged =
        existing &&
        (Math.abs(existing.w - t.w) > CONFIG.notes.resizeThreshold ||
          Math.abs(existing.h - t.h) > CONFIG.notes.resizeThreshold);

      if (!existing || sizeChanged) {
        if (existing) Composite.remove(this.world, existing.body);
        const body = Bodies.rectangle(t.x, t.y, Math.max(8, t.w), Math.max(8, t.h), {
          isStatic: true,
          angle: t.angle,
          restitution: behavior.restitution,
          friction: behavior.friction,
          label: `note:${t.role}`,
        });
        Composite.add(this.world, body);
        this.bodies.set(t.id, { body, w: t.w, h: t.h });
      } else {
        const { body } = existing;
        Body.setPosition(body, { x: t.x, y: t.y });
        Body.setAngle(body, t.angle);
        // Behavior can change if the role was reassigned mid-session.
        body.restitution = behavior.restitution;
        body.friction = behavior.friction;
      }
    }

    // Remove bodies whose track is gone (past occlusion-hold).
    for (const [id, entry] of this.bodies) {
      if (!seen.has(id)) {
        Composite.remove(this.world, entry.body);
        this.bodies.delete(id);
      }
    }
  }

  clear() {
    for (const { body } of this.bodies.values()) Composite.remove(this.world, body);
    this.bodies.clear();
  }
}
