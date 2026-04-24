import { createPlane, stepPlane, STALL_SPEED, type PlaneInput } from './physics';
import { createBotMemory, thinkBot, notifyBotDamage } from './bot';
import { fireMG, dropBomb, updateProjectiles, drawProjectiles, getBullets, reapGroundedBombs } from './projectiles';
import { resolveBulletHits, type PlaneHitbox } from './collision';
import { drawBackground } from './background';
import { spawnExplosion, updateParticles, drawParticles } from './vfx';
import { MG_SHOT_RATE } from './constants';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const bgm = document.getElementById('bgm') as HTMLAudioElement;

const planeRedSprite = new Image();
planeRedSprite.src = './sprites/plane_red.png';
const planeTealSprite = new Image();
planeTealSprite.src = './sprites/plane_teal.png';
bgm.volume = 0.4;
let bgmStarted = false;
function startBgm(): void {
  if (bgmStarted) return;
  bgm.play().then(() => { bgmStarted = true; }).catch(() => {});
}
addEventListener('keydown', startBgm, { once: true });
addEventListener('pointerdown', startBgm, { once: true });

const GROUND_Y = canvas.height - 30;
const plane = createPlane(100, GROUND_Y, 0);
const bot = createPlane(canvas.width - 100, GROUND_Y - 160, Math.PI);
bot.speed = 3.5;
bot.onGround = false; // explicit — bot spawns mid-air, not on tarmac
const botMem = createBotMemory(GROUND_Y);

const PLAYER_ID = 0;
const BOT_ID = 1;
const FIRE_COOLDOWN_SEC = MG_SHOT_RATE / 60;
const PLANE_HITBOX_RADIUS = 14;
const MAX_HP = 100;
const RESPAWN_SEC = 2.0;
type Combatant = { hp: number; respawnTimer: number };
const player: Combatant = { hp: MAX_HP, respawnTimer: 0 };
const botC: Combatant = { hp: MAX_HP, respawnTimer: 0 };
const score = { player: 0, bot: 0 };
let playerFireCooldown = 0;
let bombDropCooldown = 0;
const BOMB_COOLDOWN_SEC = 0.5;
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

function tryPlayerFire(dtSec: number): void {
  if (player.hp <= 0) { playerFireCooldown = 0; return; }
  playerFireCooldown = Math.max(0, playerFireCooldown - dtSec);
  if (!keys.has(' ') && !keys.has('f')) return;
  if (playerFireCooldown > 0) return;
  if (plane.onGround) return;
  const muzzleX = plane.x + Math.cos(plane.angle) * 16;
  const muzzleY = plane.y + Math.sin(plane.angle) * 16;
  const planeVx = Math.cos(plane.angle) * plane.speed * PLANE_SPEED_TO_PXPS;
  const planeVy = Math.sin(plane.angle) * plane.speed * PLANE_SPEED_TO_PXPS;
  if (fireMG(muzzleX, muzzleY, planeVx, planeVy, plane.angle, PLAYER_ID)) {
    playerFireCooldown = FIRE_COOLDOWN_SEC;
  }
}

function tryPlayerBomb(dtSec: number): void {
  if (player.hp <= 0) { bombDropCooldown = 0; return; }
  bombDropCooldown = Math.max(0, bombDropCooldown - dtSec);
  if (!shiftDown && !keys.has('b')) return;
  if (bombDropCooldown > 0) return;
  if (plane.onGround) return;
  const planeVx = Math.cos(plane.angle) * plane.speed * PLANE_SPEED_TO_PXPS;
  const planeVy = Math.sin(plane.angle) * plane.speed * PLANE_SPEED_TO_PXPS;
  if (dropBomb(plane.x, plane.y + 4, planeVx, planeVy, PLAYER_ID)) {
    bombDropCooldown = BOMB_COOLDOWN_SEC;
  }
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

  ctx.fillStyle = '#3a5';
  ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

  ctx.fillStyle = '#285';
  ctx.fillRect(0, GROUND_Y - 4, canvas.width, 4);
}

let botFireCooldown = 0;
function tryBotFire(dtSec: number): void {
  if (botC.hp <= 0) { botFireCooldown = 0; return; }
  botFireCooldown = Math.max(0, botFireCooldown - dtSec);
  if (!botMem.shouldFire) return;
  if (botFireCooldown > 0) return;
  const muzzleX = bot.x + Math.cos(bot.angle) * 16;
  const muzzleY = bot.y + Math.sin(bot.angle) * 16;
  const vx = Math.cos(bot.angle) * bot.speed * PLANE_SPEED_TO_PXPS;
  const vy = Math.sin(bot.angle) * bot.speed * PLANE_SPEED_TO_PXPS;
  if (fireMG(muzzleX, muzzleY, vx, vy, bot.angle, BOT_ID)) {
    botFireCooldown = FIRE_COOLDOWN_SEC;
  }
}

function stepCombatant(c: Combatant, _p: typeof plane, dtSec: number, respawn: () => void): void {
  if (c.hp > 0) return;
  c.respawnTimer -= dtSec;
  if (c.respawnTimer <= 0) {
    c.hp = MAX_HP;
    respawn();
  }
}

function respawnPlane(p: typeof plane, x: number, y: number, angle: number): void {
  p.x = x;
  p.y = y;
  p.angle = angle;
  p.speed = 3.5;
  p.onGround = false;
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
  ctx.fillText(`score  you ${score.player} : ${score.bot} bot`, canvas.width - 160, 14);
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

  stepCombatant(player, plane, dtSec, () => respawnPlane(plane, 100, GROUND_Y, 0));
  stepCombatant(botC, bot, dtSec, () => respawnPlane(bot, canvas.width - 100, GROUND_Y - 160, Math.PI));

  if (player.hp > 0) stepPlane(plane, readInput(), dtSec, GROUND_Y);
  if (botC.hp > 0) stepPlane(bot, thinkBot(bot, plane, botMem, dtSec), dtSec, GROUND_Y);
  if (player.hp > 0) {
    tryPlayerFire(dtSec);
    tryPlayerBomb(dtSec);
  }
  if (botC.hp > 0) tryBotFire(dtSec);
  updateProjectiles(dtSec);

  // Ground bombs explode.
  for (const hit of reapGroundedBombs(GROUND_Y)) {
    spawnExplosion(hit.x, hit.y, 0, 0);
  }

  const hitboxes: PlaneHitbox[] = [];
  if (player.hp > 0) hitboxes.push({ plane, ownerId: PLAYER_ID, radius: PLANE_HITBOX_RADIUS });
  if (botC.hp > 0) hitboxes.push({ plane: bot, ownerId: BOT_ID, radius: PLANE_HITBOX_RADIUS });
  const damage = resolveBulletHits(hitboxes);
  for (const [target, dmg] of damage) {
    if (target === PLAYER_ID) {
      player.hp = Math.max(0, player.hp - dmg);
      if (player.hp === 0) {
        player.respawnTimer = RESPAWN_SEC;
        score.bot++;
        spawnExplosion(plane.x, plane.y, Math.cos(plane.angle) * plane.speed * PLANE_SPEED_TO_PXPS, Math.sin(plane.angle) * plane.speed * PLANE_SPEED_TO_PXPS);
      }
    } else if (target === BOT_ID) {
      botC.hp = Math.max(0, botC.hp - dmg);
      if (botC.hp === 0) {
        botC.respawnTimer = RESPAWN_SEC;
        score.player++;
        spawnExplosion(bot.x, bot.y, Math.cos(bot.angle) * bot.speed * PLANE_SPEED_TO_PXPS, Math.sin(bot.angle) * bot.speed * PLANE_SPEED_TO_PXPS);
      } else {
        notifyBotDamage(bot, plane, botMem);
      }
    }
  }
  updateParticles(dtSec);

  drawWorld();
  if (player.hp > 0) drawPlane(plane, planeRedSprite, '#843', '#c94');
  if (botC.hp > 0) drawPlane(bot, planeTealSprite, '#348', '#4bc');
  drawProjectiles(ctx);
  drawParticles(ctx);
  drawHUD();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
