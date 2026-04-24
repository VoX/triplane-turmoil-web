// Atmospheric wind streaks — purely cosmetic drift particles that imply
// weather. Visual-only in this first pass; a future `applyWind(dt, fighter)`
// hook can make wind actually push planes.
//
// Design mirrors vfx.ts: module-local mulberry32 stream (seeded) so server
// and client render identical streak fields when netcode lands. Pre-seeded
// on load so it "just works" without seedWind() being called.
//
// Wire-up (for reviewer / main.ts owner): call `updateWind(dt)` once per
// frame and `drawWind(ctx, canvas.width, canvas.height, plane.x)` after
// hills + ground fill but BEFORE planes / projectiles / HUD. Optionally
// `setWindStrength(0..1)` from a weather controller.

type Streak = {
  x: number;          // world-space x in the streak world (wraps via modulo)
  y: number;          // screen-space y, 0 = top
  len: number;        // streak length px
  speed: number;      // horizontal px/s relative to cameraX (before parallax)
  alpha: number;      // base opacity 0..1
  parallax: number;   // 0 = background, 1 = foreground
};

const STREAK_COUNT = 60;
const STREAK_WORLD_W = 1600;           // horizontal wrap distance
const WIND_ANGLE = -0.12;              // radians; slight upward-rightward drift
const BASE_WIND = 180;                 // px/s horizontal drift at strength=1

let rng: () => number = makeRng(0xc0ffee);
let strength = 0.5;                    // 0=invisible, 1=stormy
let streaks: Streak[] = [];

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rebuild(screenH: number): void {
  streaks = [];
  for (let i = 0; i < STREAK_COUNT; i++) {
    streaks.push({
      x: rng() * STREAK_WORLD_W,
      y: rng() * screenH,
      len: 14 + rng() * 22,
      speed: 0.85 + rng() * 0.4,     // stored as a multiplier; scaled by wind each frame
      alpha: 0.15 + rng() * 0.35,
      parallax: 0.35 + rng() * 0.6,
    });
  }
}

/** Reset the wind RNG + regenerate streaks. Call once at world init. */
export function seedWind(seed: number, screenH = 400): void {
  rng = makeRng(seed);
  rebuild(screenH);
}

/** Set visible wind intensity [0..1]. 0 = dead calm (no streaks drawn). */
export function setWindStrength(v: number): void {
  strength = Math.max(0, Math.min(1, v));
}

/** Current strength — useful for future gameplay hookup. */
export function getWindStrength(): number {
  return strength;
}

/** Advance streak positions. `dt` in real seconds. */
export function updateWind(dt: number): void {
  if (streaks.length === 0) return;
  const push = BASE_WIND * strength * dt;
  for (const s of streaks) {
    s.x += s.speed * push;
    if (s.x > STREAK_WORLD_W) s.x -= STREAK_WORLD_W;
    else if (s.x < 0) s.x += STREAK_WORLD_W;
  }
}

/**
 * Draw streaks. `cameraX` is the player-plane world-x (use the same value
 * passed to drawBackground). Streaks are parallax-scrolled + wrap horizontally
 * across the viewport so they look like air moving past the camera.
 */
export function drawWind(
  ctx: CanvasRenderingContext2D,
  viewportW: number,
  viewportH: number,
  cameraX: number,
): void {
  if (strength <= 0.01) return;
  if (streaks.length === 0) rebuild(viewportH);

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  const dx = Math.cos(WIND_ANGLE);
  const dy = Math.sin(WIND_ANGLE);

  for (const s of streaks) {
    // Parallax scroll: faster streaks stick to the camera more (foreground).
    const scrolled = s.x - cameraX * s.parallax * 0.25;
    const wrapped = ((scrolled % viewportW) + viewportW) % viewportW;
    const sx = wrapped;
    const sy = s.y;
    ctx.globalAlpha = s.alpha * strength;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + dx * s.len, sy + dy * s.len);
    ctx.stroke();
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Test / serialization helper — number of live streaks. */
export function getStreakCount(): number {
  return streaks.length;
}
