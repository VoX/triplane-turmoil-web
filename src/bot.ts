// Bot AI v2 — pursue + fire + break-turn-when-hit.
// Two modes: PURSUE (steer toward player, fire when aimed) and EVADE
// (hard turn away, throttle full, brief duration). Damage triggers EVADE.

import type { PlaneInput, PlaneState } from './physics';
import { STALL_SPEED } from './physics';

export type BotMode = 'pursue' | 'evade';

export type BotMemory = {
  targetAltitude: number;
  /** Should the bot pull the trigger this tick? Set by thinkBot, read by main.ts. */
  shouldFire: boolean;
  mode: BotMode;
  /** Seconds remaining in current evade burn. */
  evadeFor: number;
  /** Last hp seen; thinkBot detects hp drops to trigger evade. */
  lastHp: number;
  /** Direction (radians) to break-turn during evade. */
  evadeAngle: number;
};

export function createBotMemory(groundY: number): BotMemory {
  return { targetAltitude: groundY - 180, shouldFire: false, mode: 'pursue', evadeFor: 0, lastHp: 100, evadeAngle: 0 };
}

const FIRE_AIM_TOLERANCE = 0.35;  // radians — fires when angle-to-target within ~20°
const FIRE_RANGE = 500;           // px — close enough for MG fire to matter
const EVADE_BURN_SEC = 1.2;       // hard-turn duration after taking damage

/** Notify the bot it took damage so it picks an evade direction. */
export function notifyBotDamage(bot: PlaneState, target: PlaneState, mem: BotMemory): void {
  mem.mode = 'evade';
  mem.evadeFor = EVADE_BURN_SEC;
  // Pick the perpendicular-to-target direction the bot is closer to.
  const toTarget = Math.atan2(target.y - bot.y, target.x - bot.x);
  const left = toTarget - Math.PI / 2;
  const right = toTarget + Math.PI / 2;
  let leftDiff = left - bot.angle;
  let rightDiff = right - bot.angle;
  while (leftDiff > Math.PI) leftDiff -= 2 * Math.PI;
  while (leftDiff < -Math.PI) leftDiff += 2 * Math.PI;
  while (rightDiff > Math.PI) rightDiff -= 2 * Math.PI;
  while (rightDiff < -Math.PI) rightDiff += 2 * Math.PI;
  mem.evadeAngle = Math.abs(leftDiff) < Math.abs(rightDiff) ? left : right;
}

/** Produce a PlaneInput for this bot given the target (player plane). */
export function thinkBot(bot: PlaneState, target: PlaneState, mem: BotMemory, dtSec: number): PlaneInput {
  if (mem.mode === 'evade') {
    mem.evadeFor -= dtSec;
    if (mem.evadeFor <= 0) mem.mode = 'pursue';
  }

  const throttle = bot.speed < STALL_SPEED + 1.2 || mem.mode === 'evade';

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const dist = Math.hypot(dx, dy);
  const desiredAngle = mem.mode === 'evade' ? mem.evadeAngle : Math.atan2(dy, dx);

  let diff = desiredAngle - bot.angle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  const altitudeError = bot.y - mem.targetAltitude;
  const altitudeBias = altitudeError > 40 ? -0.15 : altitudeError < -40 ? 0.15 : 0;
  const steer = diff + (mem.mode === 'pursue' ? altitudeBias : 0);

  const up = steer < -0.1;
  const down = steer > 0.1;

  mem.shouldFire = mem.mode === 'pursue'
    && Math.abs(diff) < FIRE_AIM_TOLERANCE
    && dist < FIRE_RANGE
    && !bot.onGround;

  return { up, down, throttle };
}
