import { createPlane, stepPlane, STALL_SPEED } from './physics';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const GROUND_Y = canvas.height - 30;
const plane = createPlane(100, GROUND_Y, 0);
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.key));
addEventListener('keyup', (e) => keys.delete(e.key));
function readInput() {
    return {
        up: keys.has('ArrowUp') || keys.has('w'),
        down: keys.has('ArrowDown') || keys.has('s'),
        throttle: keys.has('ArrowRight') || keys.has('d') || keys.has(' ')
    };
}
function drawPlane() {
    ctx.save();
    ctx.translate(plane.x, plane.y);
    ctx.rotate(plane.angle);
    ctx.fillStyle = '#c94';
    ctx.fillRect(-14, -2, 28, 4);
    ctx.fillStyle = '#843';
    ctx.fillRect(-10, -7, 12, 14);
    ctx.fillStyle = '#b84';
    ctx.fillRect(-2, -5, 4, 10);
    ctx.fillStyle = '#555';
    ctx.fillRect(14, -1, 3, 2);
    ctx.restore();
}
function drawWorld() {
    ctx.fillStyle = '#5a8fc9';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#3a5';
    ctx.fillRect(0, GROUND_Y, canvas.width, canvas.height - GROUND_Y);
    ctx.fillStyle = '#285';
    ctx.fillRect(0, GROUND_Y - 4, canvas.width, 4);
}
function drawHUD() {
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
function loop(now) {
    const dt = Math.min(32, now - last) / 16.666;
    last = now;
    stepPlane(plane, readInput(), dt, GROUND_Y);
    drawWorld();
    drawPlane();
    drawHUD();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
