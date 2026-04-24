// Plane physics — ported from sergiou87/triplane-turmoil src/world/plane.cpp
// Original uses fixed-point integer math (8-bit scaled). Here we use floats
// for the port but preserve the gameplay-relevant behavior:
//   - throttle adds to a SCALAR SPEED (not a thrust vector)
//   - velocity direction follows the plane's angle
//   - diving gains speed, climbing loses speed (gravity tangential)
//   - plane must maintain speed above STALL_SPEED or it noses down
//   - turn rate DECREASES as speed increases (harder to maneuver fast)
//   - constant drag bleeds speed
//   - lift proportional to speed keeps the plane aloft; gravity pulls it down

export const STALL_SPEED = 3.0;             // below this, plane loses lift + control
export const MAX_POWERED_SPEED = 6.5;       // loose cap via drag balance at full throttle
export const POWER_ACCEL = 0.4;             // speed gained per tick at full throttle
export const GRAVITY_TANGENTIAL = 0.25;     // speed gained per tick when nose fully down
export const GRAVITY_VERTICAL = 0.18;       // constant downward acceleration
export const LIFT_PER_SPEED = 0.045;        // downward gravity offset per unit speed (tuned for hands-off level cruise ~7 speed)
export const DRAG = 0.985;                  // per-tick speed multiplier
export const TURN_BASE = 0.055;             // radians per tick at stall speed
export const TURN_SPEED_DIVISOR = 4.0;      // turn rate = TURN_BASE / (1 + (speed-stall)/div)
export const STALL_DROP_RATE = 0.035;       // radians per tick the nose slides toward 90°

export type PlaneInput = {
  up: boolean;     // pitch nose up (angle -= turnRate)
  down: boolean;   // pitch nose down (angle += turnRate)
  throttle: boolean;
};

export type PlaneState = {
  x: number;
  y: number;
  angle: number;          // radians; 0 = flying right, PI/2 = flying down
  speed: number;
  onGround: boolean;
};

export function createPlane(x: number, y: number, angle = 0): PlaneState {
  return { x, y, angle, speed: 0, onGround: true };
}

/** Advance the plane by dt frames (1 frame = 1/60 sec). */
export function stepPlane(p: PlaneState, input: PlaneInput, dt: number, groundY: number): void {
  if (input.throttle) p.speed += POWER_ACCEL * dt;

  p.speed += Math.sin(p.angle) * GRAVITY_TANGENTIAL * dt;
  p.speed *= Math.pow(DRAG, dt);
  if (p.speed < 0) p.speed = 0;

  if (p.speed < STALL_SPEED && !p.onGround) {
    const toDown = Math.PI / 2 - p.angle;
    const dir = Math.sign(((toDown + Math.PI) % (2 * Math.PI)) - Math.PI);
    p.angle += dir * STALL_DROP_RATE * dt;
  }

  const turnRate = TURN_BASE / Math.max(1, 1 + (p.speed - STALL_SPEED) / TURN_SPEED_DIVISOR);
  if (input.up) p.angle -= turnRate * dt;
  if (input.down) p.angle += turnRate * dt;

  if (p.angle >= 2 * Math.PI) p.angle -= 2 * Math.PI;
  if (p.angle < 0) p.angle += 2 * Math.PI;

  const vx = Math.cos(p.angle) * p.speed;
  const flightVy = Math.sin(p.angle) * p.speed;
  const lift = Math.max(0, p.speed - STALL_SPEED) * LIFT_PER_SPEED;
  const vy = flightVy + (GRAVITY_VERTICAL - lift) * dt;

  p.x += vx * dt;
  p.y += vy * dt;

  if (p.y >= groundY) {
    p.y = groundY;
    if (!p.onGround) p.speed *= 0.3;
    p.onGround = true;
  } else {
    p.onGround = false;
  }
}
