// Combat state + rules — HP, respawn, score, crash.
// Isolated from render / input / DOM so this becomes reusable on the server
// side once netcode lands.

import type { PlaneState } from './physics';

export const MAX_HP = 100;
export const RESPAWN_SEC = 2.0;
export const CRASH_SPEED = 5.0;
export const PLANE_HITBOX_RADIUS = 14;

export type Combatant = {
  id: number;
  hp: number;
  respawnTimer: number;
};

export type Score = {
  /** Map from combatant id → kills they scored. */
  kills: Map<number, number>;
};

export function createCombatant(id: number): Combatant {
  return { id, hp: MAX_HP, respawnTimer: 0 };
}

export function createScore(): Score {
  return { kills: new Map() };
}

export function addKill(score: Score, killerId: number): void {
  score.kills.set(killerId, (score.kills.get(killerId) ?? 0) + 1);
}

/** Apply `dmg` to `victim`. Returns `true` if victim just died (hp crossed to 0). */
export function takeDamage(victim: Combatant, dmg: number): boolean {
  if (victim.hp <= 0) return false;
  victim.hp = Math.max(0, victim.hp - dmg);
  if (victim.hp === 0) {
    victim.respawnTimer = RESPAWN_SEC;
    return true;
  }
  return false;
}

/** Tick respawn timer; returns true if respawn is due now. */
export function tickRespawn(c: Combatant, dtSec: number): boolean {
  if (c.hp > 0) return false;
  c.respawnTimer -= dtSec;
  if (c.respawnTimer <= 0) {
    c.hp = MAX_HP;
    return true;
  }
  return false;
}

/** Returns true if the plane smashed into the ground (fast enough to die). */
export function detectCrash(plane: PlaneState): boolean {
  return plane.onGround && plane.speed > CRASH_SPEED;
}
