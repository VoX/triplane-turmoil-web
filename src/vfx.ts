// Minimal particle VFX — explosion on plane death.
// Spawn a burst of short-lived particles, update position + alpha, draw.

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

/** Spawn a burst at (x,y). Inherit plane velocity as initial outward push bias. */
export function spawnExplosion(x: number, y: number, inheritVx = 0, inheritVy = 0): void {
  const count = 30;
  const palette = ['#ffed8a', '#ffa348', '#e94e1b', '#8c2b0e', '#444'];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 200;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed + inheritVx * 0.3,
      vy: Math.sin(angle) * speed + inheritVy * 0.3,
      life: 0.5 + Math.random() * 0.7,
      maxLife: 1.2,
      color: palette[(Math.random() * palette.length) | 0]
    });
  }
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
