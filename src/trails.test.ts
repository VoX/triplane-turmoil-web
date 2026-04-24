import { describe, it, expect, beforeEach } from 'vitest';
import { updateTrails, clearTrail, clearAllTrails, getTrailLength } from './trails';
import { createFighter, type Fighter } from './entity';

// Minimal stand-in sprite (avoids loading real assets in unit tests).
const fakeSprite: HTMLImageElement = {} as HTMLImageElement;

function makeFighter(id: number): Fighter {
  return createFighter({
    id,
    name: `test-${id}`,
    spawn: { x: 0, y: -200, angle: 0, speed: 5 },
    sprite: fakeSprite,
    fallbackBody: '#fff',
    fallbackWing: '#0ff',
    isHuman: true,
    groundY: 400,
  });
}

describe('trails', () => {
  beforeEach(() => clearAllTrails());

  it('accumulates trail samples over multiple updates', () => {
    const f = makeFighter(1);
    // 1 frame at 1/60s = 0.0166s, one sample per 1/120s, so each frame covers
    // about 2 sample-intervals — a single update should produce 1 sample.
    updateTrails([f], 1 / 60);
    expect(getTrailLength(1)).toBe(1);

    // Move the plane and keep updating; trail grows until TRAIL_LENGTH cap.
    for (let i = 0; i < 50; i++) {
      f.plane.x += 1;
      updateTrails([f], 1 / 60);
    }
    // Cap is 20 — verify it doesn't grow unbounded.
    expect(getTrailLength(1)).toBeLessThanOrEqual(20);
    expect(getTrailLength(1)).toBeGreaterThan(5);
  });

  it('clears trail on fighter death (hp <= 0)', () => {
    const f = makeFighter(2);
    for (let i = 0; i < 10; i++) updateTrails([f], 1 / 60);
    expect(getTrailLength(2)).toBeGreaterThan(0);

    f.combatant.hp = 0;
    updateTrails([f], 1 / 60);
    expect(getTrailLength(2)).toBe(0);
  });

  it('clearTrail removes a single fighter\'s trail', () => {
    const a = makeFighter(3);
    const b = makeFighter(4);
    updateTrails([a, b], 1 / 60);
    expect(getTrailLength(3)).toBe(1);
    expect(getTrailLength(4)).toBe(1);

    clearTrail(3);
    expect(getTrailLength(3)).toBe(0);
    expect(getTrailLength(4)).toBe(1);
  });

  it('GCs trails of fighters no longer in the list', () => {
    const a = makeFighter(5);
    const b = makeFighter(6);
    updateTrails([a, b], 1 / 60);
    expect(getTrailLength(5)).toBeGreaterThan(0);
    expect(getTrailLength(6)).toBeGreaterThan(0);

    // Only pass `a` on the next update — `b`'s trail should be GC'd.
    updateTrails([a], 1 / 60);
    expect(getTrailLength(6)).toBe(0);
  });
});
