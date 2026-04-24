// Bot AI v1 — one dumb-but-armed opponent. Steers toward player, cruises,
// and fires the MG when roughly aimed at the player + in range. No evasion
// or tactics yet; next pass adds break-turn on damage taken.

import type { PlaneInput, PlaneState } from './physics';
import { STALL_SPEED } from './physics';

export type BotMemory = {
  targetAltitude: number;
  /** Should the bot pull the trigger this tick? Set by thinkBot, read by main.ts. */
  shouldFire: boolean;
};

export function createBotMemory(groundY: number): BotMemory {
  return { targetAltitude: groundY - 180, shouldFire: false };
}

const FIRE_AIM_TOLERANCE = 0.35;  // radians — fires when angle-to-target within ~20°
const FIRE_RANGE = 500;           // px — close enough for MG fire to matter

/** Produce a PlaneInput for this bot given the target (player plane). */
export function thinkBot(bot: PlaneState, target: PlaneState, mem: BotMemory): PlaneInput {
  const throttle = bot.speed < STALL_SPEED + 1.2;

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.hypot(dx, dy);
  const desiredAngle = Math.atan2(dy, dx);

  let diff = desiredAngle - bot.angle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  const altitudeError = bot.y - mem.targetAltitude;
  const altitudeBias = altitudeError > 40 ? -0.15 : altitudeError < -40 ? 0.15 : 0;
  const steer = diff + altitudeBias;

  const up = steer < -0.1;
  const down = steer > 0.1;

  mem.shouldFire = Math.abs(diff) < FIRE_AIM_TOLERANCE && dist < FIRE_RANGE && !bot.onGround;

  return { up, down, throttle };
}
