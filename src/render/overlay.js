/**
 * Canvas renderer: draws the webcam feed with the physics overlay on top,
 * aligned 1:1 in game coordinates (PRD §12 game view, FR-19).
 *
 * The canvas backing store matches the play-area (game) resolution; CSS
 * scales it to fit the viewport while preserving aspect ratio.
 */

import { CONFIG } from '../config.js';

export class Overlay {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, width, height) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    canvas.width = width;
    canvas.height = height;
    this.ctx = canvas.getContext('2d');
    // Show the feed in its true orientation (not mirrored).
    this.mirror = false;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * Draw the webcam feed. When `crop` (normalized {l,t,r,b}) is given, only the
   * play-area rectangle is shown, stretched to fill the canvas — so the feed
   * shares the exact coordinate space detection maps into (play area → game),
   * and detected note boxes line up with the notes in the image.
   */
  drawFeed(video, crop = null) {
    const { ctx, width, height } = this;
    ctx.save();
    if (this.mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    if (video && video.videoWidth) {
      if (crop) {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        ctx.drawImage(
          video,
          crop.l * vw,
          crop.t * vh,
          (crop.r - crop.l) * vw,
          (crop.b - crop.t) * vh,
          0,
          0,
          width,
          height,
        );
      } else {
        ctx.drawImage(video, 0, 0, width, height);
      }
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }

  drawSpout(x, y) {
    const { ctx } = this;
    const sx = this.mirror ? this.width - x : x;
    ctx.save();
    ctx.fillStyle = 'rgba(232,236,244,0.9)';
    ctx.beginPath();
    ctx.moveTo(sx - 18, y);
    ctx.lineTo(sx + 18, y);
    ctx.lineTo(sx + 10, y + 16);
    ctx.lineTo(sx - 10, y + 16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawBucket(rect) {
    const { ctx } = this;
    const { wallThickness: t, height: bh } = CONFIG.bucket;
    const x = this.mirror ? this.width - rect.x - rect.w : rect.x;
    const left = x + t / 2;
    const right = x + rect.w - t / 2;
    const top = rect.y;
    const bottom = rect.y + bh - t / 2;
    const r = Math.min(22, (right - left) / 2.4); // rounded bottom corners

    // Inner U-shaped path (centre line of the walls), rounded at the base.
    const u = new Path2D();
    u.moveTo(left, top);
    u.lineTo(left, bottom - r);
    u.quadraticCurveTo(left, bottom, left + r, bottom);
    u.lineTo(right - r, bottom);
    u.quadraticCurveTo(right, bottom, right, bottom - r);
    u.lineTo(right, top);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Soft translucent interior so the cup reads as a container.
    const fillGrad = ctx.createLinearGradient(0, top, 0, bottom);
    fillGrad.addColorStop(0, 'rgba(31,182,255,0.04)');
    fillGrad.addColorStop(1, 'rgba(31,182,255,0.18)');
    ctx.fillStyle = fillGrad;
    ctx.fill(u);

    // Walls: vertical gradient stroke with a soft drop shadow for depth.
    const wallGrad = ctx.createLinearGradient(0, top, 0, bottom);
    wallGrad.addColorStop(0, '#f2f8ff');
    wallGrad.addColorStop(1, '#a9cfe6');
    ctx.strokeStyle = wallGrad;
    ctx.lineWidth = t;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.stroke(u);

    // Warm rim caps marking the opening (where balls should land).
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffd166';
    for (const rx of [left, right]) {
      ctx.beginPath();
      ctx.arc(rx, top, t * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawBalls(balls) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#ffd166';
    ctx.shadowColor = 'rgba(255,209,102,0.6)';
    ctx.shadowBlur = 12;
    for (const ball of balls) {
      const x = this.mirror ? this.width - ball.position.x : ball.position.x;
      ctx.beginPath();
      ctx.arc(x, ball.position.y, CONFIG.physics.ballRadius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Draw detected notes as translucent rotated rectangles in their color.
   * Occlusion-held notes (not currently visible) are drawn dimmer.
   * @param {Array} tracks tracker notes {x,y,w,h,angle,colorId,visible}
   * @param {(colorId:string)=>string} colorFor resolves a colorId to CSS
   */
  drawNotes(tracks, colorFor) {
    const { ctx } = this;
    for (const t of tracks) {
      const x = this.mirror ? this.width - t.x : t.x;
      const angle = this.mirror ? -t.angle : t.angle;
      ctx.save();
      ctx.translate(x, t.y);
      ctx.rotate(angle);
      ctx.globalAlpha = t.visible ? 0.5 : 0.25;
      ctx.fillStyle = colorFor(t.colorId);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      const w = Math.max(8, t.w);
      const h = Math.max(8, t.h);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.globalAlpha = t.visible ? 0.9 : 0.4;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  /** Brief celebratory text on catch (PRD §5, §9). */
  drawWellDone(alpha) {
    if (alpha <= 0) return;
    const { ctx, width, height } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffd166';
    ctx.font = '700 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 16;
    ctx.fillText('Well done!', width / 2, height / 2);
    ctx.restore();
  }
}
