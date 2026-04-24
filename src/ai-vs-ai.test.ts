// E2E sanity: two bots fly toward each other and one of them wins.
// No DOM, no canvas — pure sim loop.

import { describe, it, expect } from 'vitest';
import { createPlane, stepPlane, STALL_SPEED } from './physics';
import { createBotMemory, thinkBot, notifyBotDamage } from './bot';
import { fireMG, updateProjectiles, getBullets, killBullet } from './projectiles';

const GROUND = 400;
const PXPS = 60;
const HITBOX = 14;
const MAX_HP = 100;
const MG_COOLDOWN = 3 / 60; // MG_SHOT_RATE = 3 frames

type Combatant = {
  id: number;
  plane: ReturnType<typeof createPlane>;
  mem: ReturnType<typeof createBotMemory>;
  hp: number;
  fireCd: number;
  alive: boolean;
};

function makeFighter(id: number, x: number, y: number, angle: number): Combatant {
  const plane = createPlane(x, y, angle);
  plane.onGround = false;
  plane.speed = 4.5;
  return { id, plane, mem: createBotMemory(GROUND), hp: MAX_HP, fireCd: 0, alive: true };
}

function tryFire(c: Combatant): void {
  c.fireCd = Math.max(0, c.fireCd - (1 / 60));
  if (!c.mem.shouldFire || c.fireCd > 0) return;
  const muzzleX = c.plane.x + Math.cos(c.plane.angle) * 16;
  const muzzleY = c.plane.y + Math.sin(c.plane.angle) * 16;
  const vx = Math.cos(c.plane.angle) * c.plane.speed * PXPS;
  const vy = Math.sin(c.plane.angle) * c.plane.speed * PXPS;
  if (fireMG(muzzleX, muzzleY, vx, vy, c.plane.angle, c.id)) c.fireCd = MG_COOLDOWN;
}

function resolveHits(combatants: Combatant[]): void {
  const bullets = getBullets();
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    for (const c of combatants) {
      if (!c.alive || c.id === b.ownerId) continue;
      const dx = b.x - c.plane.x;
      const dy = b.y - c.plane.y;
      if (dx * dx + dy * dy <= HITBOX * HITBOX) {
        c.hp = Math.max(0, c.hp - 10);
        const attacker = combatants.find(x => x.id === b.ownerId);
        if (c.hp <= 0) c.alive = false;
        else if (attacker) notifyBotDamage(c.plane, attacker.plane, c.mem);
        killBullet(i);
        break;
      }
    }
  }
}

describe('ai-vs-ai e2e', () => {
  it('two bots dogfight and one wins (or both alive after generous timeout)', () => {
    const a = makeFighter(0, 100, 200, 0);
    const b = makeFighter(1, 700, 220, Math.PI);
    const all = [a, b];

    const dt = 1 / 60;
    for (let tick = 0; tick < 60 * 60 && a.alive && b.alive; tick++) {
      const aTarget = b.plane;
      const bTarget = a.plane;
      const aIn = thinkBot(a.plane, aTarget, a.mem, dt);
      const bIn = thinkBot(b.plane, bTarget, b.mem, dt);
      stepPlane(a.plane, aIn, dt, GROUND);
      stepPlane(b.plane, bIn, dt, GROUND);
      tryFire(a);
      tryFire(b);
      updateProjectiles(dt);
      resolveHits(all);
    }

    expect(a.alive || b.alive).toBe(true);
    // Combat actually engaged: at least one of them took damage.
    expect(Math.min(a.hp, b.hp)).toBeLessThan(MAX_HP);
    // Speeds stay sensible — no nan/inf and not stalled-stuck.
    expect(Number.isFinite(a.plane.speed)).toBe(true);
    expect(Number.isFinite(b.plane.speed)).toBe(true);
    expect(a.plane.speed).toBeGreaterThan(STALL_SPEED * 0.3);
    expect(b.plane.speed).toBeGreaterThan(STALL_SPEED * 0.3);
  });
});
