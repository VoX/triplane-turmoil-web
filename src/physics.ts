// Plane physics — faithful port of sergiou87/triplane-turmoil src/world/plane.cpp.
//
// Original runs at 70Hz (DOS timer tick). Angle + speed are 8-bit fixed-point
// integers. Speed "units" are stored scaled by 256; angles are degrees × 256.
// Game uses Y-UP internally, converting to screen-Y-down via a negation on
// render. We use floats + screen-Y-down directly; sin(angle) > 0 means nose
// pointed down in screen coords, which maps to "diving" in the game.
//
// All constants are ported from constants.h / plane.cpp and scaled into a
// per-second basis so dt can be variable wall-clock seconds.

export type PlaneInput = {
  up: boolean;
  down: boolean;
  throttle: boolean;
};

export type PlaneState = {
  x: number;
  y: number;
  angle: number;        // radians; 0 = right/level, Math.PI/2 = down (DIVE in screen coords)
  speed: number;        // world-units per second; tuned cruise ≈ 220, stall ≈ 110
  onGround: boolean;
};

// Reference plane: Red Baron (index 0 in the C++ array).
// plane_mass=200, plane_power=80, plane_manover=RED_MANOVER*PLANE_TURN_SPEED
// constants.h: RED_POWER=80, PLANE_TURN_SPEED not declared in constants.h
// but grep finds it = 16 in plane.h. RED_MANOVER=16. So manover = 256.
const MASS = 200;
const POWER = 80;          // RED_POWER
const MANOVER = 256;       // RED_MANOVER * PLANE_TURN_SPEED
const TICK_HZ = 70;        // original game tick rate

// Below these fixed-point thresholds (1000+mass powered, 1500+mass idle) the
// plane falls; above them it holds altitude. BASE values feed the fall amount
// formula `(BASE - speed + mass) >> 3` from the source.
const LIFT_FALL_BASE_POWERED = 1000;                   // "fall = (BASE - speed + mass) >> 3" in source
const LIFT_FALL_BASE_IDLE = 1350;
// FALL_SCALE translates (BASE - speed*256 + mass) >> 3 into per-tick y-pixels,
// then into per-second for our dt model.
const FALL_SCALE = TICK_HZ / 8 / 256;                  // 8.75 / 256 ≈ 0.034 per "unit"

// Stall: below 768 in game-speed units = 3.0 float.
export const STALL_SPEED = 768 / 256;

// Drag: speed -= speed / 50 per tick. At 70Hz that's a ~75% retention per second.
const DRAG_PER_SEC = Math.pow(1 - 1 / 50, TICK_HZ);

// Gravity tangential: in source, when angle > 180 (climbing in their y-up),
// speed gets (90 - |angle-270|) * mass / 32000. max contribution at 270° (straight up)
// and zero at 180°/360° (level). In our screen-y-down, sin(angle) < 0 is climbing.
// Equivalent float form: gain = -sin(angle) * (90/32000) * mass * 256 (per tick).
// Over a tick = 1/70s, multiply by TICK_HZ for per-second.
// Numeric: 90 * 200 / 32000 * 256 * 70 = 100800. (units: 8bit-speed per sec)
// Divide by 256 → 393.75 float-speed/sec at straight dive.
const GRAVITY_TANGENTIAL = (90 * MASS / 32000 * 256 * TICK_HZ) / 256; // ≈ 393.75

// Power: speed += (plane_power << 8) / mass per tick. For red baron:
// += (80*256)/200 = 102.4 per tick, * 70 tick/sec = 7168/sec in game-units
// Divide by 256 → 28 float-speed/sec.
const POWER_ACCEL = (POWER * 256 / MASS * TICK_HZ) / 256;  // = 28.0

// Turn rate: initial_turn = (manover << 8) / (mass + 200) per tick.
// For red baron: (256 * 256) / 400 = 163.84 per tick, over a tick = 1/70s.
// Angle is degrees*256 in source. For our radians form, divide by 256 for degrees
// then convert to radians. Per-second: (163.84 / 256) deg/tick * 70 tick/sec
// = 44.8 deg/sec = 0.781 rad/sec at stall.
const TURN_BASE_RAD_PER_SEC = ((MANOVER * 256 / (MASS + 200)) / 256) * (Math.PI / 180) * TICK_HZ;

// Above stall, turn rate shrinks: initial_turn /= 1 + ((speed-768)/20) >> 8.
// In float: divisor = 1 + (speed*256 - 768) / (20 * 256) = 1 + (speed - 3) / 20.
const TURN_SPEED_FACTOR = 20; // (speed - stall) / TURN_SPEED_FACTOR

// Turning eats speed: speed -= initial_turn / 100 per tick.
// For red baron at stall: 163.84 / 100 = 1.6384 per tick, * 70 = 114.7/sec = 0.448 float/sec.
const TURN_SPEED_COST = 1 / 100;  // fraction of initial_turn subtracted from speed

export function createPlane(x: number, y: number, angle = 0): PlaneState {
  return { x, y, angle, speed: 0, onGround: true };
}

/** Advance the plane by dtSec wall-clock seconds. Ground at groundY. */
export function stepPlane(p: PlaneState, input: PlaneInput, dtSec: number, groundY: number): void {
  const inputUp = input.up;
  const inputDown = input.down;
  const throttle = input.throttle;

  // --- Lift / fall threshold (replicates the source's y += (BASE - speed + mass) >> 3 block).
  const speedFixed = p.speed * 256;  // back to game-space units for threshold comparison
  let fallPerSec = 0;
  if (throttle) {
    if (speedFixed < 1000 + MASS) {
      fallPerSec = (LIFT_FALL_BASE_POWERED - speedFixed + MASS) * FALL_SCALE;
    }
  } else {
    if (speedFixed < 1500 + MASS) {
      fallPerSec = (LIFT_FALL_BASE_IDLE - speedFixed + MASS) * FALL_SCALE;
    }
  }
  // Small extra sink when stalled + airborne (source: `player_y += 256` in stall branch).
  if (p.speed < STALL_SPEED && !p.onGround) {
    fallPerSec += 256 * FALL_SCALE * TICK_HZ;
  }

  // --- Turn rate: base, divided down as speed exceeds stall.
  let turnRate = TURN_BASE_RAD_PER_SEC;
  if (p.speed >= STALL_SPEED && !p.onGround) {
    const divisor = 1 + (p.speed - STALL_SPEED) / TURN_SPEED_FACTOR;
    turnRate /= divisor;
  }

  // --- Stall: forced angle drift toward nose-down (source forces angle via -= / += 1024).
  if (p.speed < STALL_SPEED && !p.onGround) {
    const STALL_DRIFT = (1024 / 256) * (Math.PI / 180) * TICK_HZ * dtSec;
    if (p.angle < Math.PI / 2 && p.angle >= 0) {
      p.angle -= STALL_DRIFT;
    } else if (p.angle > Math.PI / 2 && p.angle < (3 * Math.PI) / 2) {
      p.angle += STALL_DRIFT;
    } else if (p.angle > (3 * Math.PI) / 2) {
      p.angle -= STALL_DRIFT;
    }
  }

  // --- Turning input consumes speed (per source "if up/down: speed -= initial_turn/100").
  if ((inputUp || inputDown) && p.speed > 0) {
    // TURN_SPEED_COST is per-tick; scale by tick rate × dtSec.
    p.speed -= (turnRate * TICK_HZ * dtSec) * TURN_SPEED_COST * (180 / Math.PI) / TICK_HZ;
    if (p.speed < 0) p.speed = 0;
  }

  // --- Gravity tangential: dive (sin > 0) adds speed, climb (sin < 0) bleeds.
  if (!p.onGround) {
    p.speed += Math.sin(p.angle) * GRAVITY_TANGENTIAL * dtSec;
  }

  // --- Throttle: adds speed when power + gas. No gas model yet so always-on while throttled.
  if (throttle) {
    p.speed += POWER_ACCEL * dtSec;
  }

  // --- Drag: speed *= DRAG_PER_SEC (with dt interpolation).
  p.speed *= Math.pow(DRAG_PER_SEC, dtSec);
  if (p.speed < 0) p.speed = 0;

  // --- Turn angle: input applied AFTER speed modifications (source order).
  if (p.speed > 0) {
    if (inputUp) p.angle -= turnRate * dtSec;
    if (inputDown) p.angle += turnRate * dtSec;
  }

  // Wrap angle.
  if (p.angle >= 2 * Math.PI) p.angle -= 2 * Math.PI;
  if (p.angle < 0) p.angle += 2 * Math.PI;

  // --- Integrate position. Speed direction = plane angle (cos, sin).
  // Source: player_y -= y_speed (i.e. speed in screen-up direction). We're already
  // in screen-y-down so sin(angle)*speed is correct directly.
  const movePerSec = p.speed * 60;  // world-px per float-speed unit per second (tuned)
  p.x += Math.cos(p.angle) * movePerSec * dtSec;
  p.y += Math.sin(p.angle) * movePerSec * dtSec;
  // Plus the lift-fall (straight down, regardless of angle)
  p.y += fallPerSec * dtSec;

  // Ground handling.
  if (p.y >= groundY) {
    p.y = groundY;
    if (!p.onGround) p.speed *= 0.3;
    p.onGround = true;
  } else {
    p.onGround = false;
  }

  // Ground rest: if on airfield with no throttle + speed small, snap to 0.
  if (p.onGround && !throttle && Math.abs(p.speed) < 0.0625 /* STOP_SPEED_LIMIT/256 */) {
    p.speed = 0;
  }
}
