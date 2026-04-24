import { describe, it, expect, beforeEach } from 'vitest';
import { spawnExplosion, updateParticles, clearParticles, getParticleCount, seedVfx } from './vfx';

// Deterministic-particle guarantee: same seed → same count + same post-step
// state after N ticks. Underpins netcode client/server reconciliation.

describe('vfx determinism', () => {
  beforeEach(() => clearParticles());

  it('spawnExplosion with a fixed seed adds exactly 30 particles', () => {
    spawnExplosion(100, 100, 0, 0, 42);
    expect(getParticleCount()).toBe(30);
  });

  it('same seed + same step count yields same surviving-particle count', () => {
    // Run A
    clearParticles();
    spawnExplosion(0, 0, 0, 0, 12345);
    for (let i = 0; i < 60; i++) updateParticles(1 / 60);
    const countA = getParticleCount();

    // Run B — identical inputs
    clearParticles();
    spawnExplosion(0, 0, 0, 0, 12345);
    for (let i = 0; i < 60; i++) updateParticles(1 / 60);
    const countB = getParticleCount();

    expect(countA).toBe(countB);
  });

  it('seedVfx makes the default-stream reproducible across runs', () => {
    // Run A — using the default (unseeded) stream
    clearParticles();
    seedVfx(0xbeef);
    spawnExplosion(0, 0, 0, 0);
    spawnExplosion(50, 50, 0, 0);
    const countA = getParticleCount();

    // Run B — reseed + repeat identically
    clearParticles();
    seedVfx(0xbeef);
    spawnExplosion(0, 0, 0, 0);
    spawnExplosion(50, 50, 0, 0);
    const countB = getParticleCount();

    expect(countA).toBe(countB);
    expect(countA).toBe(60);
  });

  it('different seeds do not necessarily produce identical traces', () => {
    // This is a weak check — 30 particles × different RNG should diverge
    // enough that at least one update cycle shows a different survivor count
    // at some tick. If this flakes, re-tune the sample window.
    clearParticles();
    spawnExplosion(0, 0, 0, 0, 1);
    const trace1: number[] = [];
    for (let i = 0; i < 80; i++) { updateParticles(1 / 60); trace1.push(getParticleCount()); }

    clearParticles();
    spawnExplosion(0, 0, 0, 0, 2);
    const trace2: number[] = [];
    for (let i = 0; i < 80; i++) { updateParticles(1 / 60); trace2.push(getParticleCount()); }

    // They should agree on count most of the time (same count=30 initial) but
    // the survival curves should not be byte-identical traces; easier check:
    // at least one of the two runs produces a different count at some tick.
    // With life ∈ [0.5, 1.2] drawn from different streams, the window 60-80
    // should catch the divergence cleanly.
    expect(trace1).not.toEqual(trace2);
  });
});
