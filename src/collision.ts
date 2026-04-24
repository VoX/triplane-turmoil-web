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

export type HitRecord = {
  /** planeId of the victim */
  victimId: number;
  /** planeId of the shooter */
  shooterId: number;
  damage: number;
};

/** Returns one HitRecord per bullet that connected. Preserves shooter attribution so
 *  callers can credit kills correctly in free-for-all combat. */
export function resolveBulletHits(planes: readonly PlaneHitbox[]): HitRecord[] {
  const bullets = getBullets();
  const hits: HitRecord[] = [];
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    for (const p of planes) {
      if (p.ownerId === b.ownerId) continue;
      const dx = b.x - p.plane.x;
      const dy = b.y - p.plane.y;
      if (dx * dx + dy * dy <= p.radius * p.radius) {
        hits.push({ victimId: p.ownerId, shooterId: b.ownerId, damage: BULLET_DAMAGE });
        killBullet(i);
        break;
      }
    }
  }
  return hits;
}
