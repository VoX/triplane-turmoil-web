// Short motion trails behind each fighter — cheap atmospheric polish
// (tinyclaw's brainstorm #3 from the 2026-04-24 06:07Z sweep). Each fighter
// gets a ring buffer of recent world positions; draw as a translucent fading
// polyline tinted by the fighter's team color.
//
// No state beyond the per-fighter ring buffers, so nothing to serialize for
// netcode — renderer-only, each client builds its own from the fighter
// positions it already sees.

import type { Fighter } from './entity';

type Sample = { x: number; y: number };

// Samples per trail. At 60 FPS and 1 sample/frame, 20 = ~0.33s of history.
// Short so tight-turn trails curve crisply instead of smearing.
const TRAIL_LENGTH = 20;

// How much time between samples. 0 = every frame. A small gap smooths out
// jittery super-short trails without making turns laggy.
const SAMPLE_INTERVAL = 1 / 120;

type TrailState = {
  samples: Sample[];
  // Accumulator for rate-limiting samples.
  timeToSample: number;
};

const trails = new Map<number, TrailState>();

/** Clear a single fighter's trail — call from respawnFighter. */
export function clearTrail(id: number): void {
  trails.delete(id);
}

/** Clear all trails — call on world reset. */
export function clearAllTrails(): void {
  trails.clear();
}

/** Advance every fighter's trail. Call once per frame before draw. */
export function updateTrails(fighters: Fighter[], dt: number): void {
  for (const f of fighters) {
    // Don't draw trails on dead planes — looks weird past the explosion.
    if (f.combatant.hp <= 0) { trails.delete(f.id); continue; }

    let t = trails.get(f.id);
    if (!t) {
      t = { samples: [], timeToSample: 0 };
      trails.set(f.id, t);
    }
    t.timeToSample -= dt;
    if (t.timeToSample <= 0) {
      t.timeToSample = SAMPLE_INTERVAL;
      t.samples.push({ x: f.plane.x, y: f.plane.y });
      if (t.samples.length > TRAIL_LENGTH) t.samples.shift();
    }
  }

  // GC: drop trails whose owner is no longer in the fighters list.
  if (trails.size > fighters.length) {
    const ids = new Set(fighters.map((f) => f.id));
    for (const id of trails.keys()) if (!ids.has(id)) trails.delete(id);
  }
}

/**
 * Draw each fighter's trail — translucent polyline from oldest→newest in the
 * fighter's fallbackWing color, alpha ramps from 0 at tail to ~0.45 at head.
 * Should be called AFTER background / hills / ground but BEFORE planes so
 * the plane sprite sits on top of its own trail.
 */
export function drawTrails(ctx: CanvasRenderingContext2D, fighters: Fighter[]): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const f of fighters) {
    const t = trails.get(f.id);
    if (!t || t.samples.length < 2) continue;

    const color = f.fallbackWing;
    const n = t.samples.length;
    // Draw as individual segments so each can have its own alpha + width.
    for (let i = 1; i < n; i++) {
      const prev = t.samples[i - 1];
      const cur = t.samples[i];
      const progress = i / n;                     // 0 at tail, 1 at head
      ctx.globalAlpha = 0.05 + progress * 0.4;
      ctx.lineWidth = 1 + progress * 1.5;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(cur.x, cur.y);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Test helper — current trail length for a fighter. */
export function getTrailLength(id: number): number {
  return trails.get(id)?.samples.length ?? 0;
}
