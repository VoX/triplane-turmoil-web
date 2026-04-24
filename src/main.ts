// Triplane Turmoil Web — bootstrap. Placeholder single-plane physics sketch,
// will grow into full multiplayer deathmatch over the PM loop.

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

type Plane = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  throttle: number;
};

const plane: Plane = { x: 100, y: 200, vx: 0, vy: 0, angle: 0, throttle: 0 };

const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.key));
addEventListener('keyup', (e) => keys.delete(e.key));

const TURN_RATE = 0.04;
const THROTTLE_UP = 0.02;
const MAX_THROTTLE = 1;
const THRUST = 0.15;
const LIFT = 0.08;
const GRAVITY = 0.08;
const DRAG = 0.995;

function step(dt: number): void {
  if (keys.has('ArrowLeft')) plane.angle -= TURN_RATE * dt;
  if (keys.has('ArrowRight')) plane.angle += TURN_RATE * dt;
  if (keys.has('ArrowUp')) plane.throttle = Math.min(MAX_THROTTLE, plane.throttle + THROTTLE_UP * dt);
  if (keys.has('ArrowDown')) plane.throttle = Math.max(0, plane.throttle - THROTTLE_UP * dt);

  const thrust = plane.throttle * THRUST;
  plane.vx += Math.cos(plane.angle) * thrust;
  plane.vy += Math.sin(plane.angle) * thrust;

  const speed = Math.hypot(plane.vx, plane.vy);
  const liftForce = speed * LIFT;
  plane.vx += Math.cos(plane.angle - Math.PI / 2) * liftForce * 0;
  plane.vy -= liftForce;

  plane.vy += GRAVITY;
  plane.vx *= DRAG;
  plane.vy *= DRAG;

  plane.x += plane.vx;
  plane.y += plane.vy;

  if (plane.x < 0) plane.x += canvas.width;
  if (plane.x > canvas.width) plane.x -= canvas.width;
  if (plane.y > canvas.height - 20) {
    plane.y = canvas.height - 20;
    plane.vy = 0;
  }
}

function drawPlane(p: Plane): void {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.fillStyle = '#c94';
  ctx.fillRect(-10, -3, 20, 6);
  ctx.fillStyle = '#843';
  ctx.fillRect(-4, -6, 8, 12);
  ctx.restore();
}

function draw(): void {
  ctx.fillStyle = '#5a8fc9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#3a5';
  ctx.fillRect(0, canvas.height - 20, canvas.width, 20);

  drawPlane(plane);

  ctx.fillStyle = '#fff';
  ctx.font = '10px monospace';
  ctx.fillText(`throttle ${(plane.throttle * 100).toFixed(0)}%`, 10, 20);
  ctx.fillText(`speed ${Math.hypot(plane.vx, plane.vy).toFixed(1)}`, 10, 34);
  ctx.fillText('arrows: turn / throttle', 10, canvas.height - 30);
}

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(32, now - last) / 16.666;
  last = now;
  step(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
