import { createPlane, stepPlane, STALL_SPEED, type PlaneInput } from './physics';
import { createBotMemory, thinkBot } from './bot';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const GROUND_Y = canvas.height - 30;
const plane = createPlane(100, GROUND_Y, 0);
const bot = createPlane(canvas.width - 100, GROUND_Y - 160, Math.PI);
bot.speed = 3.5;
const botMem = createBotMemory(GROUND_Y);

const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.key));
addEventListener('keyup', (e) => keys.delete(e.key));

function readInput(): PlaneInput {
  return {
    up: keys.has('ArrowUp') || keys.has('w'),
    down: keys.has('ArrowDown') || keys.has('s'),
    throttle: keys.has('ArrowRight') || keys.has('d') || keys.has(' ')
  };
}

function drawPlane(p: typeof plane, bodyColor: string, wingColor: string): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);

  ctx.fillStyle = wingColor;
  ctx.fillRect(-14, -2, 28, 4);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(-10, -7, 12, 14);
  ctx.fillStyle = wingColor;
  ctx.fillRect(-2, -5, 4, 10);
  ctx.fillStyle = '#555';
  ctx.fillRect(14, -1, 3, 2);

  ctx.restore();
}

function drawWorld(): void {
  ctx.fillStyle = '#5a8fc9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#3a5';
  ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);

  ctx.fillStyle = '#285';
  ctx.fillRect(0, GROUND_Y - 4, canvas.width, 4);
}

function drawHUD(): void {
  ctx.fillStyle = '#fff';
  ctx.font = '10px monospace';
  ctx.fillText(`speed ${plane.speed.toFixed(2)}`, 10, 14);
  ctx.fillText(`angle ${((plane.angle * 180) / Math.PI).toFixed(0)}°`, 10, 26);
  const stalling = plane.speed < STALL_SPEED && !plane.onGround;
  ctx.fillStyle = stalling ? '#f55' : '#fff';
  ctx.fillText(stalling ? 'STALL' : (plane.onGround ? 'GROUND' : 'FLYING'), 10, 38);
  ctx.fillStyle = '#ccc';
  ctx.fillText('arrows: pitch+throttle (right=power)', 10, canvas.height - 8);
}

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(32, now - last) / 16.666;
  last = now;

  stepPlane(plane, readInput(), dt, GROUND_Y);
  stepPlane(bot, thinkBot(bot, plane, botMem), dt, GROUND_Y);

  drawWorld();
  drawPlane(plane, '#843', '#c94');
  drawPlane(bot, '#348', '#4bc');
  drawHUD();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
