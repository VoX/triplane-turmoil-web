// Game constants ported from sergiou87/triplane-turmoil src/world/constants.h
// Reference units: pixels per second (the source uses real-time dt integration).
// All projectile/terrain physics should use real dt in seconds to stay scale-consistent.

// --- Plane machine guns (MG) ---
export const MG_SHOT_SPEED = 4000;     // forward velocity of an MG round, px/s
export const MG_SHOT_GRAVITY = 400;    // downward accel applied each tick, px/s^2
export const MG_SHOT_RATE = 3;         // min frames between shots (fire cooldown)
export const MG_MAX = 500;             // global cap per side
export const MG_RANGE = 55;            // lifetime in frames before despawn
export const MG_SHOT_COLOR = 8;        // reference palette index (ignored in web)

// --- Anti-aircraft machine guns ---
export const AA_MG_SHOT_SPEED = 4800;
export const MAX_AA_GUNS = 16;

// --- Infantry shots ---
export const INFANT_SHOTS_SPEED = 4000;
export const INFANTRY_AIM_RANDOM = 40;
export const MAX_INFANTRY = 100;

// --- Bombs ---
export const BOMB_GRAVITY = 2000;      // px/s^2 — bombs fall ~5x faster than MG arc
export const MAX_BOMBS = 25;
export const MIN_BOMB_PARTS = 25;      // debris particles on explosion
export const MAX_BOMB_PARTS = 50;

// --- Infantry tracked gun (heavy weapon) ---
export const ITGUN_SHOT_SPEED = 8000;
export const ITGUN_SHOT_GRAVITY = 500;
export const ITGUN_SHOT_RATE = 15;
export const MAX_ITGUN_SHOTS = 20;
export const ITGUN_AGE_VARIETY = 10;
export const ITGUN_BASE_AGE = 32;

// --- Flying objects (smoke, parts, explosions) ---
export const FOBJECTS_GRAVITY = 3000;
export const PARTS_SPEED = 270000;
export const SMOKE_SPEED = -3500;
export const MAX_FLYING_OBJECTS = 200;
export const FOBJECTS_DAMAGE = 8;
export const NUMBER_OF_EXPLOSION_PARTS = 30;

// --- Animation frame counts (sprite-sheet strips) ---
export const SMOKE_FRAMES = 17;
export const EXPLOX_FRAMES = 6;
export const WAVE1_FRAMES = 15;
export const WAVE2_FRAMES = 5;

// --- World caps ---
export const MAX_SHOTS = 500;
export const MAX_FLAGS = 12;
export const FLAGS_SPEED = 2;
export const MAX_STRUCTURES = 100;
export const NUMBER_OF_SCENES = 15;
