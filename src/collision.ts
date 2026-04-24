// Bullet-vs-plane collision. Brute-force loop: ~few dozen bullets ×
// 2-4 planes is comfortably <1000 dist² calcs per frame. Promote to
// spatial grid only when N grows.

import type { PlaneState } from './physics';
import { getBullets, killBullet } from './projectiles';

export type PlaneHitbox = {
  plane: PlaneState;
  ownerId: number;
  /** radius (px) treated as a circle */
  radius: number;
};

/** One unit of damage per bullet hit. Tune later. */
export const BULLET_DAMAGE = 10;

/** Returns ownerId → damage taken this frame. */
export function resolveBulletHits(planes: readonly PlaneHitbox[]): Map<number, number> {
  const bullets = getBullets();
  const damage = new Map<number, number>();
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    for (const p of planes) {
      if (p.ownerId === b.ownerId) continue;
      const dx = b.x - p.plane.x;
      const dy = b.y - p.plane.y;
      if (dx * dx + dy * dy <= p.radius * p.radius) {
        damage.set(p.ownerId, (damage.get(p.ownerId) ?? 0) + BULLET_DAMAGE);
        killBullet(i);
        break;
      }
    }
  }
  return damage;
}
