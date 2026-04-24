// WebAudio-synthesized sound effects — no external assets.
// Everything is generated at play-time via oscillators + noise buffers, so
// the game ships with zero audio payload and works fully offline.
//
// Browsers block AudioContext until a user gesture. Call initAudio() from a
// click/keydown handler; all sfx* functions are no-ops until then.
//
// Design notes:
// - Single shared AudioContext + master gain so per-sound level mixing stays
//   predictable and a future settings menu can just tweak masterGain.value.
// - MG shots and hits are throttled to avoid UI-blocking click storms when
//   firerate is maxed or two planes collide head-on.

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

// Throttle state — earliest wall-clock time (ms) at which a given sfx may play.
let mgNextAt = 0;
let hitNextAt = 0;

const MG_MIN_INTERVAL_MS = 35;
const HIT_MIN_INTERVAL_MS = 40;

/** Lazy-init on first call. Safe to invoke more than once. */
export function initAudio(): void {
  if (ctx) return;
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  if (!AC) return;
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.35;
  masterGain.connect(ctx.destination);

  // One-shot white-noise buffer reused across all noise-based sfx. 1s @ 22kHz
  // is plenty for the longest explosion tail.
  const sampleRate = ctx.sampleRate;
  noiseBuffer = ctx.createBuffer(1, sampleRate, sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

/** Set master output volume [0..1]. Does nothing before initAudio(). */
export function setMasterVolume(v: number): void {
  if (!masterGain) return;
  masterGain.gain.value = Math.max(0, Math.min(1, v));
}

/** Resume a suspended context (some browsers suspend after tab-hide). */
export function resumeAudio(): void {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

// Internal: short noise burst routed through a band-pass.
function noiseBurst(duration: number, freq: number, q: number, gain: number): void {
  if (!ctx || !noiseBuffer || !masterGain) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  src.connect(bp).connect(g).connect(masterGain);
  src.start(now);
  src.stop(now + duration + 0.02);
}

// Internal: oscillator tone with a quick exponential decay envelope.
function tone(
  type: OscillatorType,
  startFreq: number,
  endFreq: number,
  duration: number,
  gain: number,
): void {
  if (!ctx || !masterGain) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  const g = ctx.createGain();
  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(startFreq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), now + duration);
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

/** Machine-gun shot — sharp, short, bright band-passed noise. */
export function sfxMGShot(): void {
  if (!ctx) return;
  const nowMs = performance.now();
  if (nowMs < mgNextAt) return;
  mgNextAt = nowMs + MG_MIN_INTERVAL_MS;
  noiseBurst(0.06, 2400, 8, 0.5);
  tone('square', 900, 300, 0.04, 0.12);
}

/** Bomb-release whistle — descending tone, no thud (thud is the hit). */
export function sfxBombDrop(): void {
  tone('triangle', 700, 120, 0.55, 0.18);
}

/** Plane/bomb explosion — noise sweep + low sub-thud. */
export function sfxExplosion(): void {
  if (!ctx) return;
  noiseBurst(0.5, 700, 2, 0.6);
  noiseBurst(0.35, 180, 1.5, 0.5);
  tone('sine', 110, 40, 0.4, 0.5);
}

/** Bullet/terrain hit — short metallic clang. */
export function sfxHit(): void {
  const nowMs = performance.now();
  if (nowMs < hitNextAt) return;
  hitNextAt = nowMs + HIT_MIN_INTERVAL_MS;
  noiseBurst(0.08, 3200, 12, 0.3);
  tone('triangle', 1800, 600, 0.07, 0.1);
}

// Continuous engine buzz — lazily created on first sfxEngine() call.
let engineOsc: OscillatorNode | null = null;
let engineGain: GainNode | null = null;

/**
 * Continuous engine drone modulated by throttle [0..1].
 * Pass 0 to silence (the node stays alive for quick resumption).
 * No-op before initAudio().
 */
export function sfxEngine(throttle: number): void {
  if (!ctx || !masterGain) return;
  const t = Math.max(0, Math.min(1, throttle));
  if (!engineOsc || !engineGain) {
    engineOsc = ctx.createOscillator();
    engineGain = ctx.createGain();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 60;
    engineGain.gain.value = 0;
    engineOsc.connect(engineGain).connect(masterGain);
    engineOsc.start();
  }
  const now = ctx.currentTime;
  // 60Hz idle → 180Hz wide-open; gentle ramp to avoid zipper noise.
  engineGain.gain.linearRampToValueAtTime(0.04 * t, now + 0.08);
  engineOsc.frequency.linearRampToValueAtTime(60 + 120 * t, now + 0.08);
}

/** Stop + dispose the engine drone (e.g. on plane death). */
export function stopEngine(): void {
  if (!ctx || !engineOsc || !engineGain) return;
  const now = ctx.currentTime;
  engineGain.gain.linearRampToValueAtTime(0, now + 0.1);
  engineOsc.stop(now + 0.12);
  engineOsc = null;
  engineGain = null;
}
