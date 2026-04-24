// Fighter — bundles everything per plane: physics state, combatant
// (HP/respawn), spawn point, sprite, AI memory if bot, cooldowns.
//
// One source of truth per plane. Adding a 4th, 8th, 32nd fighter is
// `fighters.push(createFighter({...}))`. Replaces the bot1/bot2 sprawl
// arch review #4 + #5 flagged.

import { createPlane, type PlaneState } from './physics';
import { createCombatant, type Combatant } from './combat';
import { createBotMemory, type BotMemory } from './bot';
import { clearTrail } from './trails';

export type Spawn = { x: number; y: number; angle: number; speed: number };

export type Fighter = {
  id: number;
  name: string;
  plane: PlaneState;
  combatant: Combatant;
  spawn: Spawn;
  sprite: HTMLImageElement;
  fallbackBody: string;
  fallbackWing: string;
  isHuman: boolean;
  botMemory: BotMemory | null;
  fireCooldown: number;
  bombCooldown: number;
};

export type CreateFighterOpts = {
  id: number;
  name: string;
  spawn: Spawn;
  sprite: HTMLImageElement;
  fallbackBody: string;
  fallbackWing: string;
  isHuman: boolean;
  groundY: number;
};

export function createFighter(o: CreateFighterOpts): Fighter {
  const plane = createPlane(o.spawn.x, o.spawn.y, o.spawn.angle);
  plane.speed = o.spawn.speed;
  plane.onGround = false;
  return {
    id: o.id,
    name: o.name,
    plane,
    combatant: createCombatant(o.id),
    spawn: o.spawn,
    sprite: o.sprite,
    fallbackBody: o.fallbackBody,
    fallbackWing: o.fallbackWing,
    isHuman: o.isHuman,
    botMemory: o.isHuman ? null : createBotMemory(o.groundY),
    fireCooldown: 0,
    bombCooldown: 0
  };
}

/** Reset a fighter's plane to its spawn point. Combatant.hp managed by caller. */
export function respawnFighter(f: Fighter): void {
  f.plane.x = f.spawn.x;
  f.plane.y = f.spawn.y;
  f.plane.angle = f.spawn.angle;
  f.plane.speed = f.spawn.speed;
  f.plane.onGround = false;
  // Drop any stale trail so the new-life polyline starts fresh.
  clearTrail(f.id);
}
