// Bot AI v0 — one dumb opponent so the page is never a solo flight sim.
// Goals: keeps a cruise altitude, steers toward the player, throttles to
// stay above stall. No weapons yet, no evasion, no tactics. v1 adds those.

import type { PlaneInput, PlaneState } from './physics';
import { STALL_SPEED } from './physics';

export type BotMemory = {
  targetAltitude: number;
};

export function createBotMemory(groundY: number): BotMemory {
  return { targetAltitude: groundY - 180 };
}

/** Produce a PlaneInput for this bot given the target (player plane). */
export function thinkBot(bot: PlaneState, target: PlaneState, mem: BotMemory): PlaneInput {
  const throttle = bot.speed < STALL_SPEED + 1.2;

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const desiredAngle = Math.atan2(dy, dx);

  let diff = desiredAngle - bot.angle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  const altitudeError = bot.y - mem.targetAltitude;
  const altitudeBias = altitudeError > 40 ? -0.15 : altitudeError < -40 ? 0.15 : 0;
  const steer = diff + altitudeBias;

  const up = steer < -0.1;
  const down = steer > 0.1;

  return { up, down, throttle };
}
