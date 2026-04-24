// Minimal particle VFX — explosion on plane death.
// Spawn a burst of short-lived particles, update position + alpha, draw.
//
// Determinism: uses a seeded mulberry32 PRNG, NOT Math.random. This is a
// prerequisite for netcode (P0 in PRODUCT_PLAN) — server/client must spawn
// identical particle fields from the same world state, otherwise visible
// drift accumulates and reconciliation looks bad.
// Call `seedVfx(seed)` at world creation; each `spawnExplosion` also accepts
// an optional per-call `seed` to decouple one burst's randomness from the
// running stream (useful for rollback + replay).

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;       // seconds remaining
  maxLife: number;
  color: string;
};

const particles: Particle[] = [];

// Deterministic mulberry32 — cheap, good distribution for 30-particle bursts.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Default stream — seeded at module load so behaviour is reproducible even if
// the caller forgets to call seedVfx(). Tests can override via seedVfx().
let rng: () => number = mulberry32(0x7effaa21);

/** Reset the default particle RNG stream. Call once per world init. */
export function seedVfx(seed: number): void {
  rng = mulberry32(seed);
}

/**
 * Spawn a burst at (x,y). Inherit plane velocity as initial outward push bias.
 * Optional `seed` forces a fresh RNG local to this burst — pass `tick` or
 * `eventId` from netcode so server and client spawn identical fields.
 */
export function spawnExplosion(
  x: number,
  y: number,
  inheritVx = 0,
  inheritVy = 0,
  seed?: number,
): void {
  const count = 30;
  const palette = ['#ffed8a', '#ffa348', '#e94e1b', '#8c2b0e', '#444'];
  const r = seed === undefined ? rng : mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const angle = r() * Math.PI * 2;
    const speed = 80 + r() * 200;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed + inheritVx * 0.3,
      vy: Math.sin(angle) * speed + inheritVy * 0.3,
      life: 0.5 + r() * 0.7,
      maxLife: 1.2,
      color: palette[(r() * palette.length) | 0]
    });
  }
}

/** Drop all live particles. Call on world reset / respawn-all. */
export function clearParticles(): void {
  particles.length = 0;
}

/** Read-only snapshot for tests / netcode serialization. */
export function getParticleCount(): number {
  return particles.length;
}

export function updateParticles(dt: number): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 120 * dt;     // gravity
    p.vx *= Math.pow(0.4, dt);
    p.vy *= Math.pow(0.85, dt);
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D): void {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}
