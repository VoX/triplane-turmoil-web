import { describe, it, expect } from 'vitest';
import { createPlane, stepPlane, STALL_SPEED } from './physics';

const GROUND = 400;

describe('plane physics', () => {
  it('throttle accelerates the plane from rest', () => {
    // Start high enough that 1s of throttle physics doesn't ground-bounce.
    const p = createPlane(0, -800, 0);
    p.onGround = false;
    const before = p.speed;
    for (let i = 0; i < 60; i++) stepPlane(p, { up: false, down: false, throttle: true }, 1 / 60, GROUND);
    expect(p.speed).toBeGreaterThan(before + 2);
  });

  it('plane below stall + airborne loses altitude (positive y delta)', () => {
    const p = createPlane(0, 100, 0);
    p.onGround = false;
    p.speed = STALL_SPEED * 0.5; // deep stall
    const yBefore = p.y;
    for (let i = 0; i < 30; i++) stepPlane(p, { up: false, down: false, throttle: false }, 1 / 60, GROUND);
    expect(p.y).toBeGreaterThan(yBefore + 1);
  });

  it('throttled plane at cruise speed maintains altitude approximately', () => {
    const p = createPlane(0, 100, 0);
    p.onGround = false;
    p.speed = 6.0; // above both lift thresholds
    const yBefore = p.y;
    for (let i = 0; i < 60; i++) stepPlane(p, { up: false, down: false, throttle: true }, 1 / 60, GROUND);
    // Allow some sag but not freefall
    expect(p.y - yBefore).toBeLessThan(60);
  });

  it('turning at high speed is slower than at stall', () => {
    const slow = createPlane(0, 100, 0);
    slow.onGround = false;
    slow.speed = STALL_SPEED;
    const fast = createPlane(0, 100, 0);
    fast.onGround = false;
    fast.speed = 8.0;
    for (let i = 0; i < 30; i++) {
      stepPlane(slow, { up: true, down: false, throttle: false }, 1 / 60, GROUND);
      stepPlane(fast, { up: true, down: false, throttle: false }, 1 / 60, GROUND);
    }
    const slowDelta = Math.abs(slow.angle);
    const fastDelta = Math.abs(fast.angle - 2 * Math.PI) < Math.abs(fast.angle)
      ? Math.abs(fast.angle - 2 * Math.PI)
      : Math.abs(fast.angle);
    expect(slowDelta).toBeGreaterThan(fastDelta);
  });
});
