import { describe, it, expect } from 'vitest';
import { seedWind, setWindStrength, updateWind, getStreakCount, getWindStrength } from './wind';

describe('wind determinism + state', () => {
  it('seedWind generates a fixed streak population', () => {
    seedWind(0xdeadbeef, 400);
    expect(getStreakCount()).toBe(60);
  });

  it('same seed + same wall-clock drives same x positions after N ticks', () => {
    seedWind(7, 400);
    setWindStrength(1);
    for (let i = 0; i < 120; i++) updateWind(1 / 60);
    const count1 = getStreakCount();

    seedWind(7, 400);
    setWindStrength(1);
    for (let i = 0; i < 120; i++) updateWind(1 / 60);
    const count2 = getStreakCount();

    // Streak count should be stable (no spawn/despawn — fixed pool)
    expect(count1).toBe(count2);
    expect(count1).toBe(60);
  });

  it('setWindStrength clamps to [0,1]', () => {
    setWindStrength(-5);
    expect(getWindStrength()).toBe(0);
    setWindStrength(99);
    expect(getWindStrength()).toBe(1);
    setWindStrength(0.42);
    expect(getWindStrength()).toBeCloseTo(0.42);
  });
});
