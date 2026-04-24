// Parallax background — multi-layer scrolling scene behind the action.
// Three layers from back to front: far clouds, mid hills, near hills.
// Each layer scrolls at a fraction of the camera's horizontal motion.
// Pure function of a camera-X offset — caller owns the game's camera state.
//
// Deterministic RNG so the scene is stable across frames + the same across
// server/client in multiplayer (once netplay lands).

type Layer = {
  /** Scroll speed as a fraction of camera motion. 0 = static (sky), 1 = same as foreground. */
  parallax: number;
  /** Baseline Y for this layer's top edge. */
  baseY: number;
  /** Color used for solid-fill elements. */
  color: string;
};

const FAR_CLOUDS: Layer = { parallax: 0.08, baseY: 40, color: '#dfe7f2' };
const MID_HILLS: Layer = { parallax: 0.30, baseY: 260, color: '#3d6b4a' };
const NEAR_HILLS: Layer = { parallax: 0.55, baseY: 320, color: '#2d5038' };

/** One cloud shape: a set of overlapping circles at a fixed world-X. */
type Cloud = { worldX: number; widthUnits: number };
/** One hill: peak world-X + peak height + base width (triangle footprint). */
type Hill = { worldX: number; height: number; width: number };

// Pre-generated deterministic world content. World is ~8000 px wide before
// wrap-around, plenty for a single dogfight session.
const WORLD_WIDTH = 8000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLOUDS: Cloud[] = (() => {
  const rng = mulberry32(0xc10d);
  const out: Cloud[] = [];
  let x = 0;
  while (x < WORLD_WIDTH) {
    out.push({ worldX: x, widthUnits: 3 + Math.floor(rng() * 4) });
    x += 280 + Math.floor(rng() * 320);
  }
  return out;
})();

const MID_HILL_SHAPES: Hill[] = (() => {
  const rng = mulberry32(0xa117);
  const out: Hill[] = [];
  let x = 0;
  while (x < WORLD_WIDTH) {
    const width = 180 + Math.floor(rng() * 160);
    out.push({ worldX: x + width / 2, height: 80 + Math.floor(rng() * 60), width });
    x += width;
  }
  return out;
})();

const NEAR_HILL_SHAPES: Hill[] = (() => {
  const rng = mulberry32(0xb2e5);
  const out: Hill[] = [];
  let x = 0;
  while (x < WORLD_WIDTH) {
    const width = 220 + Math.floor(rng() * 200);
    out.push({ worldX: x + width / 2, height: 50 + Math.floor(rng() * 50), width });
    x += width;
  }
  return out;
})();

function wrapX(worldX: number, cameraX: number, parallax: number, viewportW: number): number {
  // Apply parallax scroll then wrap into the visible viewport so the world
  // appears infinite without repeating visible cuts.
  const scrolled = worldX - cameraX * parallax;
  const modded = ((scrolled % WORLD_WIDTH) + WORLD_WIDTH) % WORLD_WIDTH;
  // Shift so content straddles the viewport cleanly.
  return modded - (modded > viewportW + 400 ? WORLD_WIDTH : 0);
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, widthUnits: number): void {
  // A cloud is 3-6 overlapping circles of varying size
  ctx.beginPath();
  for (let i = 0; i < widthUnits; i++) {
    const cx = x + i * 22;
    const cy = y + Math.sin(i * 1.3) * 6;
    const r = 18 + (i % 3) * 4;
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

function drawHill(ctx: CanvasRenderingContext2D, peakX: number, baseY: number, height: number, width: number): void {
  ctx.beginPath();
  ctx.moveTo(peakX - width / 2, baseY);
  // Use a smooth quadratic peak for a more natural silhouette than a triangle
  ctx.quadraticCurveTo(peakX, baseY - height * 1.2, peakX + width / 2, baseY);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw the sky gradient + all 3 parallax layers. Call before the plane/
 * projectile render passes. `cameraX` is how far the camera has scrolled in
 * world-space (use the player plane's X for solo play, or a centroid for
 * multiplayer).
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  cameraX: number,
  viewportW: number,
  viewportH: number,
): void {
  // Sky gradient — always draws first so layers composite correctly.
  const grad = ctx.createLinearGradient(0, 0, 0, viewportH);
  grad.addColorStop(0, '#6ba4dc');
  grad.addColorStop(0.7, '#a6c8e4');
  grad.addColorStop(1, '#c5dcec');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewportW, viewportH);

  // Layer 1: far clouds (low parallax, light color, top of screen)
  ctx.fillStyle = FAR_CLOUDS.color;
  for (const cloud of CLOUDS) {
    const x = wrapX(cloud.worldX, cameraX, FAR_CLOUDS.parallax, viewportW);
    if (x < -200 || x > viewportW + 200) continue;
    drawCloud(ctx, x, FAR_CLOUDS.baseY, cloud.widthUnits);
  }

  // Layer 2: mid hills (deeper green, further back)
  ctx.fillStyle = MID_HILLS.color;
  for (const hill of MID_HILL_SHAPES) {
    const x = wrapX(hill.worldX, cameraX, MID_HILLS.parallax, viewportW);
    if (x < -300 || x > viewportW + 300) continue;
    drawHill(ctx, x, MID_HILLS.baseY, hill.height, hill.width);
  }

  // Layer 3: near hills (darker, faster-scrolling foreground terrain)
  ctx.fillStyle = NEAR_HILLS.color;
  for (const hill of NEAR_HILL_SHAPES) {
    const x = wrapX(hill.worldX, cameraX, NEAR_HILLS.parallax, viewportW);
    if (x < -400 || x > viewportW + 400) continue;
    drawHill(ctx, x, NEAR_HILLS.baseY, hill.height, hill.width);
  }
}
