// Projectile system — MG shots + bombs. Standalone from plane physics so tinyclaw's
// plane.cpp port doesn't collide with this module. Integrates via `fireMG()` /
// `dropBomb()` — plane code spawns projectiles by calling into the pool.
//
// All physics are real-time dt in SECONDS, matching the reference source's unit.
// The game loop's dt needs to be passed in as seconds (not the normalized
// 1.0-at-60fps scale the placeholder uses). When plane physics gets ported
// properly, it'll move to the same scale and these stay aligned.

import {
  MG_SHOT_SPEED,
  MG_SHOT_GRAVITY,
  MG_RANGE,
  MG_MAX,
  BOMB_GRAVITY,
  MAX_BOMBS,
} from './constants.js';

// ---- MG bullet ----

export type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Frames remaining until despawn. Matches reference MG_RANGE (55 frames ≈ 0.9s @ 60fps). */
  life: number;
  /** Index of the plane that fired this — so a bullet ignores its owner's hitbox. */
  ownerId: number;
};

// ---- Bomb ----

export type Bomb = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Bombs don't have a range limit — they live until they hit terrain/target. */
  ownerId: number;
};

// ---- Pools ----
// Plain arrays with in-place compacting. Trades minor GC churn for simplicity;
// upgrade to object-pool if profiling shows bullet-spawn hot path.

const bullets: Bullet[] = [];
const bombs: Bomb[] = [];

/** Spawn an MG bullet. Returns true if spawn succeeded, false if side cap hit. */
export function fireMG(
  x: number,
  y: number,
  planeVx: number,
  planeVy: number,
  angleRadians: number,
  ownerId: number,
): boolean {
  // Cap total in-flight shots per reference MAX_SHOTS. The reference has a
  // per-side cap; we track globally here until multi-player wiring lands.
  if (bullets.length >= MG_MAX) return false;

  // Bullet velocity = plane's velocity + muzzle velocity along facing direction.
  // Matches the reference (plane.cpp: shot inherits plane momentum so strafing
  // runs feel correct).
  const muzzleVx = Math.cos(angleRadians) * MG_SHOT_SPEED;
  const muzzleVy = Math.sin(angleRadians) * MG_SHOT_SPEED;

  bullets.push({
    x,
    y,
    vx: planeVx + muzzleVx,
    vy: planeVy + muzzleVy,
    life: MG_RANGE,
    ownerId,
  });
  return true;
}

/** Spawn a bomb. Returns true if spawn succeeded, false if cap hit. */
export function dropBomb(
  x: number,
  y: number,
  planeVx: number,
  planeVy: number,
  ownerId: number,
): boolean {
  if (bombs.length >= MAX_BOMBS) return false;

  // Bomb inherits plane velocity. No forward impulse (drops straight, then
  // arcs under gravity).
  bombs.push({ x, y, vx: planeVx, vy: planeVy, ownerId });
  return true;
}

/** Advance all projectiles by `dt` seconds. */
export function updateProjectiles(dt: number): void {
  // Bullets: gravity + lifetime decay.
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.vy += MG_SHOT_GRAVITY * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // `life` is frame-count in reference; approximate as dt-scaled here so
    // timing matches at any frame-rate. 60 fps × MG_RANGE frames = seconds.
    b.life -= 60 * dt;
    if (b.life <= 0) {
      bullets.splice(i, 1);
    }
  }

  // Bombs: gravity. No life decay — despawn happens on terrain collision
  // (handled elsewhere, TODO wire when terrain.ts lands).
  for (let i = bombs.length - 1; i >= 0; i--) {
    const bomb = bombs[i];
    bomb.vy += BOMB_GRAVITY * dt;
    bomb.x += bomb.vx * dt;
    bomb.y += bomb.vy * dt;
  }
}

/** Draw all projectiles. Pass `bombSprite` to use pixel art; falls back to rects. */
export function drawProjectiles(ctx: CanvasRenderingContext2D, bombSprite?: HTMLImageElement): void {
  // Bullets render as short streaks aligned to velocity (poor man's tracer).
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  for (const b of bullets) {
    const len = 6;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed < 1) continue;
    const ux = b.vx / speed;
    const uy = b.vy / speed;
    ctx.strokeStyle = '#ff9';
    ctx.beginPath();
    ctx.moveTo(b.x - ux * len, b.y - uy * len);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = '#fff6a0';
    ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
  }
  const spriteReady = bombSprite && bombSprite.complete && bombSprite.naturalWidth > 0;
  for (const bomb of bombs) {
    if (spriteReady) {
      const w = bombSprite!.naturalWidth;
      const h = bombSprite!.naturalHeight;
      // Rotate bomb sprite so its nose aligns with flight direction.
      const angle = Math.atan2(bomb.vy, bomb.vx);
      ctx.save();
      ctx.translate(bomb.x, bomb.y);
      ctx.rotate(angle);
      ctx.drawImage(bombSprite!, -w / 2, -h / 2);
      ctx.restore();
    } else {
      ctx.fillStyle = '#444';
      ctx.fillRect(bomb.x - 2, bomb.y - 3, 4, 6);
    }
  }
}

/** Remove a projectile by index (for collision-handler use). */
export function killBullet(i: number): void {
  bullets.splice(i, 1);
}
export function killBomb(i: number): void {
  bombs.splice(i, 1);
}

/** Drain and return bombs that have hit or passed `groundY`. Caller spawns VFX + damage. */
export function reapGroundedBombs(groundY: number): Array<{ x: number; y: number; ownerId: number }> {
  const out: Array<{ x: number; y: number; ownerId: number }> = [];
  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    if (b.y >= groundY) {
      out.push({ x: b.x, y: groundY, ownerId: b.ownerId });
      bombs.splice(i, 1);
    }
  }
  return out;
}

/** Read-only accessors for collision / render systems. */
export function getBullets(): readonly Bullet[] {
  return bullets;
}
export function getBombs(): readonly Bomb[] {
  return bombs;
}

/** Clear all projectiles (e.g. round reset). */
export function clearProjectiles(): void {
  bullets.length = 0;
  bombs.length = 0;
}
