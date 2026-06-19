/**
 * Matter.js physics world for Cascade (PRD §8, §14).
 *
 * Responsibilities for the M0/core-loop harness:
 *  - Build the bucket (static container with slightly bouncy inner walls).
 *  - Pick a fixed-per-session spawn spout (random x).
 *  - Spawn a gentle stream of balls under gravity.
 *  - Detect catch (settled inside the bucket) and miss (left the play area).
 *
 * Note colliders (driven by CV detection) are added in a later milestone via
 * a dedicated notes module; the world exposes hooks for that.
 */

import Matter from 'matter-js';
import { CONFIG } from '../config.js';

const { Engine, World, Bodies, Body, Composite, Events } = Matter;

export class PhysicsWorld {
  /**
   * @param {number} width  play-area width (game coordinates)
   * @param {number} height play-area height
   * @param {() => number} rng deterministic-ish random in [0,1); defaults to Math.random
   */
  constructor(width, height, rng = Math.random) {
    this.width = width;
    this.height = height;

    this.engine = Engine.create();
    this.engine.gravity.y = CONFIG.physics.gravityY;
    this.world = this.engine.world;

    this.balls = new Set();
    this.lastSpawn = 0;

    // Catch/miss callbacks the game layer subscribes to.
    this.onCatch = null;
    this.onMiss = null;

    this.spoutY = CONFIG.spout.y;
    this._buildBucket();

    // Fixed-per-session spout x (PRD §8). Place it OFF to one side of the
    // bucket opening so a straight drop misses — the player must use notes to
    // redirect the ball in (PRD §4 catch requires deliberate aiming).
    this.spoutX = this._pickSpoutX(rng);
  }

  _pickSpoutX(rng) {
    const { marginX, bucketClearance } = CONFIG.spout;
    const r = this.bucketRect;
    const leftSpan = [marginX, r.x - bucketClearance];
    const rightSpan = [r.x + r.w + bucketClearance, this.width - marginX];
    const valid = [leftSpan, rightSpan].filter(([a, b]) => b - a > 20);

    if (valid.length === 0) {
      // Degenerate (tiny play area): fall back to a corner away from center.
      return rng() < 0.5 ? marginX : this.width - marginX;
    }
    const span = valid[Math.floor(rng() * valid.length)];
    return span[0] + rng() * (span[1] - span[0]);
  }

  _buildBucket() {
    const { width: bw, height: bh, wallThickness: t, innerRestitution, bottomMargin } =
      CONFIG.bucket;
    const cx = this.width / 2;
    const top = this.height - bottomMargin - bh;

    const opts = {
      isStatic: true,
      restitution: innerRestitution,
      friction: 0.6,
      label: 'bucket',
    };

    const left = Bodies.rectangle(cx - bw / 2, top + bh / 2, t, bh, opts);
    const right = Bodies.rectangle(cx + bw / 2, top + bh / 2, t, bh, opts);
    const floor = Bodies.rectangle(cx, top + bh, bw + t, t, {
      ...opts,
      restitution: 0.05, // floor shouldn't bounce balls back up
    });

    this.bucket = { left, right, floor };
    // Opening region used for catch detection.
    this.bucketRect = {
      x: cx - bw / 2,
      y: top,
      w: bw,
      h: bh,
      cx,
    };

    Composite.add(this.world, [left, right, floor]);
  }

  /** Spawn a ball at the fixed spout if the stream interval has elapsed. */
  maybeSpawn(now) {
    if (this.balls.size >= CONFIG.physics.maxBalls) return;
    if (now - this.lastSpawn < CONFIG.physics.spawnIntervalMs) return;
    this.lastSpawn = now;
    this.spawnBall();
  }

  spawnBall() {
    const ball = Bodies.circle(this.spoutX, this.spoutY, CONFIG.physics.ballRadius, {
      restitution: CONFIG.physics.ballRestitution,
      friction: CONFIG.physics.ballFriction,
      label: 'ball',
    });
    this.balls.add(ball);
    Composite.add(this.world, ball);
    return ball;
  }

  removeBall(ball) {
    if (!this.balls.has(ball)) return;
    this.balls.delete(ball);
    Composite.remove(this.world, ball);
  }

  /** Advance the simulation and run catch/miss checks. */
  step(deltaMs) {
    Engine.update(this.engine, Math.min(deltaMs, 1000 / 30));
    this._checkBalls();
  }

  _checkBalls() {
    const r = this.bucketRect;
    for (const ball of this.balls) {
      const { x, y } = ball.position;
      const speed = Math.hypot(ball.velocity.x, ball.velocity.y);

      // Caught: resting slowly inside the bucket opening footprint.
      const insideBucket =
        x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
      if (insideBucket && speed < CONFIG.bucket.catchSpeed) {
        this.removeBall(ball);
        this.onCatch && this.onCatch(ball);
        continue;
      }

      // Missed: left the play area (sides or bottom) outside the bucket.
      const out =
        y - CONFIG.physics.ballRadius > this.height ||
        x < -50 ||
        x > this.width + 50;
      if (out) {
        this.removeBall(ball);
        this.onMiss && this.onMiss(ball);
      }
    }
  }
}
