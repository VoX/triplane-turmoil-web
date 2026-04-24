import { stepPlane, STALL_SPEED, type PlaneInput } from './physics';
import { thinkBot, notifyBotDamage } from './bot';
import { fireMG, dropBomb, updateProjectiles, drawProjectiles, getBullets, reapGroundedBombs } from './projectiles';
import { resolveBulletHits, type PlaneHitbox } from './collision';
import { drawBackground } from './background';
import { spawnExplosion, updateParticles, drawParticles, seedVfx } from './vfx';
import { initAudio, resumeAudio, sfxMGShot, sfxBombDrop, sfxExplosion, sfxHit, sfxEngine, stopEngine } from './sfx';
import { takeDamage, tickRespawn, detectCrash, addKill, createScore, MAX_HP, PLANE_HITBOX_RADIUS } from './combat';
import { createFighter, respawnFighter, type Fighter } from './entity';
import { MG_SHOT_RATE } from './constants';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const bgm = document.getElementById('bgm') as HTMLAudioElement;

const planeRedSprite = new Image();
planeRedSprite.src = './sprites/plane_red.png';
const planeTealSprite = new Image();
planeTealSprite.src = './sprites/plane_teal.png';
const planeGreenSprite = new Image();
planeGreenSprite.src = './sprites/plane_green.png';
const planePurpleSprite = new Image();
planePurpleSprite.src = './sprites/plane_purple.png';
const bombSprite = new Image();
bombSprite.src = './sprites/bomb.png';
const cloudSprite = new Image();
cloudSprite.src = './sprites/cloud.png';
const hillSprite = new Image();
hillSprite.src = './sprites/hill.png';
bgm.volume = 0.4;
let bgmStarted = false;
function startBgm(): void {
  if (bgmStarted) return;
  bgm.play().then(() => { bgmStarted = true; }).catch(() => {});
  initAudio();
}
addEventListener('keydown', () => { startBgm(); resumeAudio(); });
addEventListener('pointerdown', () => { startBgm(); resumeAudio(); });

const GROUND_Y = canvas.height - 30;
const PLAYER_ID = 0;
const BOT_ID = 1;
const BOT2_ID = 2;
const BOT3_ID = 3;
const FIRE_COOLDOWN_SEC = MG_SHOT_RATE / 60;
const BOMB_COOLDOWN_SEC = 0.5;

// Seed deterministic vfx PRNG (per-page-load seed; netcode will swap to world-id).
seedVfx(Date.now() & 0xffffffff);

const fighters: Fighter[] = [
  createFighter({
    id: PLAYER_ID, name: 'You',
    spawn: { x: 100, y: GROUND_Y, angle: 0, speed: 0 },
    sprite: planeRedSprite, fallbackBody: '#843', fallbackWing: '#c94',
    isHuman: true, groundY: GROUND_Y
  }),
  createFighter({
    id: BOT_ID, name: 'Teal',
    spawn: { x: canvas.width - 100, y: GROUND_Y - 160, angle: Math.PI, speed: 3.5 },
    sprite: planeTealSprite, fallbackBody: '#348', fallbackWing: '#4bc',
    isHuman: false, groundY: GROUND_Y
  }),
  createFighter({
    id: BOT2_ID, name: 'Green',
    spawn: { x: canvas.width - 100, y: GROUND_Y - 260, angle: Math.PI, speed: 4.0 },
    sprite: planeGreenSprite, fallbackBody: '#384', fallbackWing: '#4c6',
    isHuman: false, groundY: GROUND_Y
  }),
  createFighter({
    id: BOT3_ID, name: 'Purple',
    spawn: { x: canvas.width / 2, y: GROUND_Y - 320, angle: Math.PI / 2, speed: 4.5 },
    sprite: planePurpleSprite, fallbackBody: '#638', fallbackWing: '#a8d',
    isHuman: false, groundY: GROUND_Y
  })
];
// Convenience handles — used by HUD code that hasn't been generalized yet.
const player = fighters[0].combatant;
const plane = fighters[0].plane;
fighters[1].botMemory!.targetAltitude = GROUND_Y - 160;
fighters[2].botMemory!.targetAltitude = GROUND_Y - 260;
fighters[3].botMemory!.targetAltitude = GROUND_Y - 320;
const score = createScore();
// Plane physics speed is in normalized frame-units (~6 max) but projectile
// system expects px/s. Convert via PLANE_SPEED_TO_PXPS so muzzle velocity
// inheritance lands at the right scale.
const PLANE_SPEED_TO_PXPS = 60;

const keys = new Set<string>();
let shiftDown = false;
addEventListener('keydown', (e) => {
  keys.add(e.key);
  if (e.shiftKey) shiftDown = true;
});
addEventListener('keyup', (e) => {
  keys.delete(e.key);
  shiftDown = e.shiftKey;
});

function readInput(): PlaneInput {
  return {
    up: keys.has('ArrowUp') || keys.has('w'),
    down: keys.has('ArrowDown') || keys.has('s'),
    throttle: keys.has('ArrowRight') || keys.has('d')
  };
}

function tryFighterFire(f: Fighter, fire: boolean, dtSec: number): void {
  if (f.combatant.hp <= 0) { f.fireCooldown = 0; return; }
  f.fireCooldown = Math.max(0, f.fireCooldown - dtSec);
  if (!fire || f.fireCooldown > 0 || f.plane.onGround) return;
  const muzzleX = f.plane.x + Math.cos(f.plane.angle) * 16;
  const muzzleY = f.plane.y + Math.sin(f.plane.angle) * 16;
  const vx = Math.cos(f.plane.angle) * f.plane.speed * PLANE_SPEED_TO_PXPS;
  const vy = Math.sin(f.plane.angle) * f.plane.speed * PLANE_SPEED_TO_PXPS;
  if (fireMG(muzzleX, muzzleY, vx, vy, f.plane.angle, f.id)) {
    f.fireCooldown = FIRE_COOLDOWN_SEC;
    sfxMGShot();
  }
}

function tryFighterBomb(f: Fighter, drop: boolean, dtSec: number): void {
  if (f.combatant.hp <= 0) { f.bombCooldown = 0; return; }
  f.bombCooldown = Math.max(0, f.bombCooldown - dtSec);
  if (!drop || f.bombCooldown > 0 || f.plane.onGround) return;
  const vx = Math.cos(f.plane.angle) * f.plane.speed * PLANE_SPEED_TO_PXPS;
  const vy = Math.sin(f.plane.angle) * f.plane.speed * PLANE_SPEED_TO_PXPS;
  if (dropBomb(f.plane.x, f.plane.y + 4, vx, vy, f.id)) {
    f.bombCooldown = BOMB_COOLDOWN_SEC;
    sfxBombDrop();
  }
}

type KillEvent = { message: string; born: number };
const killFeed: KillEvent[] = [];
const KILL_FEED_LIFE_SEC = 3.0;
function pushKill(victimName: string, killerName: string | null): void {
  const message = killerName ? `${killerName} downed ${victimName}` : `${victimName} crashed`;
  killFeed.push({ message, born: performance.now() / 1000 });
  while (killFeed.length > 5) killFeed.shift();
}
function drawKillFeed(): void {
  const now = performance.now() / 1000;
  let y = 30;
  for (let i = killFeed.length - 1; i >= 0; i--) {
    const k = killFeed[i];
    const age = now - k.born;
    if (age > KILL_FEED_LIFE_SEC) { killFeed.splice(i, 1); continue; }
    const alpha = age > KILL_FEED_LIFE_SEC - 0.5 ? (KILL_FEED_LIFE_SEC - age) / 0.5 : 1;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000a';
    const w = ctx.measureText(k.message).width + 8;
    ctx.fillRect(canvas.width - w - 8, y - 10, w, 14);
    ctx.fillStyle = '#fff';
    ctx.fillText(k.message, canvas.width - w - 4, y);
    y += 16;
  }
  ctx.globalAlpha = 1;
}

function drawHpBar(x: number, y: number, hp: number): void {
  const w = 30;
  const h = 3;
  ctx.fillStyle = '#0008';
  ctx.fillRect(x - w / 2, y, w, h);
  const pct = Math.max(0, hp / MAX_HP);
  ctx.fillStyle = pct > 0.5 ? '#7f7' : pct > 0.2 ? '#fc4' : '#f55';
  ctx.fillRect(x - w / 2, y, w * pct, h);
}

function drawPlane(p: typeof plane, sprite: HTMLImageElement, fallbackBody: string, fallbackWing: string): void {
  // Flip sprite vertically when flying left-half so the pilot stays upright.
  // cos(angle) < 0 means nose pointing left; mirror the sprite and flip the
  // rotation so the biplane reads correctly (classic 2D "left-right-flip").
  const facingLeft = Math.cos(p.angle) < 0;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (facingLeft) {
    ctx.rotate(Math.PI - p.angle);
    ctx.scale(-1, 1);
  } else {
    ctx.rotate(p.angle);
  }
  if (sprite.complete && sprite.naturalWidth > 0) {
    ctx.drawImage(sprite, -sprite.naturalWidth / 2, -sprite.naturalHeight / 2);
  } else {
    ctx.fillStyle = fallbackWing;
    ctx.fillRect(-14, -2, 28, 4);
    ctx.fillStyle = fallbackBody;
    ctx.fillRect(-10, -7, 12, 14);
    ctx.fillStyle = fallbackWing;
    ctx.fillRect(-2, -5, 4, 10);
    ctx.fillStyle = '#555';
    ctx.fillRect(14, -1, 3, 2);
  }
  ctx.restore();
}

function drawWorld(): void {
  drawBackground(ctx, plane.x, canvas.width, canvas.height);

  // Overlay parallax cloud sprites (cheap, scrolls with player.x at 0.15 rate).
  // Triple-draw (one wrap each side) so no seam regardless of scroll direction.
  if (cloudSprite.complete && cloudSprite.naturalWidth > 0) {
    const cloudPositions = [120, 380, 670];
    const parallax = 0.15;
    const cw = cloudSprite.naturalWidth;
    for (const cx of cloudPositions) {
      const sx = ((cx - plane.x * parallax) % canvas.width + canvas.width) % canvas.width;
      ctx.drawImage(cloudSprite, sx - cw / 2, 60);
      ctx.drawImage(cloudSprite, sx - cw / 2 + canvas.width, 60);
      ctx.drawImage(cloudSprite, sx - cw / 2 - canvas.width, 60);
    }
  }

  // Hill silhouette (mid-parallax) just above the ground band.
  if (hillSprite.complete && hillSprite.naturalWidth > 0) {
    const hillW = hillSprite.naturalWidth;
    const hillY = GROUND_Y - hillSprite.naturalHeight + 8;
    const parallax = 0.4;
    const offset = ((-plane.x * parallax) % hillW + hillW) % hillW;
    for (let x = -hillW + offset; x < canvas.width; x += hillW) {
      ctx.drawImage(hillSprite, x, hillY);
    }
  }

  ctx.fillStyle = '#3a5';
  ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

  ctx.fillStyle = '#285';
  ctx.fillRect(0, GROUND_Y - 4, canvas.width, 4);
}

function nameForId(id: number): string {
  const f = fighters.find((x) => x.id === id);
  return f ? f.name : `#${id}`;
}

function drawHUD(): void {
  ctx.fillStyle = '#fff';
  ctx.font = '10px monospace';
  ctx.fillText(`speed ${plane.speed.toFixed(2)}`, 10, 14);
  ctx.fillText(`angle ${((plane.angle * 180) / Math.PI).toFixed(0)}°`, 10, 26);
  const stalling = plane.speed < STALL_SPEED && !plane.onGround;
  ctx.fillStyle = stalling ? '#f55' : '#fff';
  ctx.fillText(stalling ? 'STALL' : (plane.onGround ? 'GROUND' : 'FLYING'), 10, 38);
  ctx.fillStyle = '#fff6a0';
  ctx.fillText(`bullets ${getBullets().length}`, 10, 50);
  ctx.fillStyle = player.hp > 50 ? '#7f7' : player.hp > 20 ? '#fc4' : '#f55';
  ctx.fillText(`hp ${player.hp}`, 10, 62);
  ctx.fillStyle = '#fff';
  ctx.fillText(`score  you ${score.kills.get(PLAYER_ID) ?? 0} : ${score.kills.get(BOT_ID) ?? 0} bot`, canvas.width - 160, 14);
  if (player.hp <= 0) {
    ctx.fillStyle = '#f55';
    ctx.fillText(`respawn in ${player.respawnTimer.toFixed(1)}s`, canvas.width / 2 - 40, canvas.height / 2);
  }
  ctx.fillStyle = '#ccc';
  ctx.fillText('arrows: pitch | right=power | space/f=fire | shift/b=bomb', 10, canvas.height - 8);
}

let last = performance.now();
function loop(now: number): void {
  const rawDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const dtSec = rawDt;

  // Tick respawns + sim per fighter.
  for (const f of fighters) {
    if (tickRespawn(f.combatant, dtSec)) respawnFighter(f);
    if (f.combatant.hp <= 0) continue;
    const target = fighters[0]; // bots target the player for now
    const input = f.isHuman ? readInput() : thinkBot(f.plane, target.plane, f.botMemory!, dtSec);
    stepPlane(f.plane, input, dtSec, GROUND_Y);
  }
  // Fire/bomb input per fighter.
  for (const f of fighters) {
    if (f.combatant.hp <= 0) continue;
    const wantsFire = f.isHuman ? (keys.has(' ') || keys.has('f')) : !!f.botMemory?.shouldFire;
    const wantsBomb = f.isHuman ? (shiftDown || keys.has('b')) : false;
    tryFighterFire(f, wantsFire, dtSec);
    tryFighterBomb(f, wantsBomb, dtSec);
  }
  updateProjectiles(dtSec);

  // Ground bombs explode + splash damage to nearby planes.
  const BOMB_BLAST_RADIUS = 60;
  const BOMB_DAMAGE = 60;
  for (const hit of reapGroundedBombs(GROUND_Y)) {
    spawnExplosion(hit.x, hit.y, 0, 0);
    sfxExplosion();
    for (const f of fighters) {
      if (f.combatant.hp <= 0) continue;
      const dx = f.plane.x - hit.x;
      const dy = f.plane.y - hit.y;
      if (dx * dx + dy * dy <= BOMB_BLAST_RADIUS * BOMB_BLAST_RADIUS) {
        const died = takeDamage(f.combatant, BOMB_DAMAGE);
        sfxHit();
        if (died) {
          spawnExplosion(f.plane.x, f.plane.y, 0, 0);
          sfxExplosion();
          if (hit.ownerId !== f.id) addKill(score, hit.ownerId);
          pushKill(f.name, nameForId(hit.ownerId));
        }
      }
    }
  }

  // Crash-on-ground: self-inflicted, no kill credit.
  for (const f of fighters) {
    if (f.combatant.hp <= 0) continue;
    if (!detectCrash(f.plane)) continue;
    takeDamage(f.combatant, MAX_HP);
    spawnExplosion(f.plane.x, f.plane.y, Math.cos(f.plane.angle) * f.plane.speed * PLANE_SPEED_TO_PXPS, 0);
    sfxExplosion();
    pushKill(f.name, null);
  }

  // Bullet hits.
  const hitboxes: PlaneHitbox[] = [];
  for (const f of fighters) {
    if (f.combatant.hp > 0) hitboxes.push({ plane: f.plane, ownerId: f.id, radius: PLANE_HITBOX_RADIUS });
  }
  const damage = resolveBulletHits(hitboxes);
  for (const [target, dmg] of damage) {
    sfxHit();
    const f = fighters.find((x) => x.id === target);
    if (!f) continue;
    if (takeDamage(f.combatant, dmg)) {
      // No reliable killer attribution from collision result (could derive from killBullet ownerId — TODO);
      // For now credit the player when a bot dies, and credit "Enemy" when the player dies.
      if (f.isHuman) {
        pushKill(f.name, 'Enemy');
      } else {
        addKill(score, PLAYER_ID);
        pushKill(f.name, 'You');
      }
      spawnExplosion(f.plane.x, f.plane.y, Math.cos(f.plane.angle) * f.plane.speed * PLANE_SPEED_TO_PXPS, Math.sin(f.plane.angle) * f.plane.speed * PLANE_SPEED_TO_PXPS);
      sfxExplosion();
    } else if (!f.isHuman && f.botMemory) {
      notifyBotDamage(f.plane, fighters[0].plane, f.botMemory);
    }
  }
  updateParticles(dtSec);

  // Engine sfx follows the player plane.
  if (player.hp > 0 && !plane.onGround) {
    sfxEngine(Math.min(1, plane.speed / 7));
  } else {
    stopEngine();
  }

  drawWorld();
  for (const f of fighters) {
    if (f.combatant.hp <= 0) continue;
    drawPlane(f.plane, f.sprite, f.fallbackBody, f.fallbackWing);
    drawHpBar(f.plane.x, f.plane.y - 26, f.combatant.hp);
  }
  drawProjectiles(ctx, bombSprite);
  drawParticles(ctx);
  drawHUD();
  drawKillFeed();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
