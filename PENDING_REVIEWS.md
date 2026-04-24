# Pending Reviews

## 2026-04-24 02:40Z — Security sweep #1

Scope: src/{main,physics,bot,projectiles,constants}.ts, index.html, package.json, lockfile. Single-player only — no netcode wired yet.

**Dependency CVEs**
- MEDIUM — `package.json:13` vite ^5.4.10 → npm audit reports 2 moderate advisories: GHSA-67mh-4wv8-2f99 (esbuild dev-server SSRF, CVSS 5.3) and GHSA-4w7w-66w2-5vf9 (vite path traversal in optimized-deps `.map`). Dev-only impact. Fix: bump to vite ^8.0.10 (semver-major) or pin vite ^5.4.20 if available. Mitigate now by binding `vite dev` to localhost only; never expose dev server publicly.

**XSS / injection**
- INFO — No `innerHTML`, `document.write`, `eval`, `Function()`, `insertAdjacentHTML` anywhere. All rendering via Canvas2D `fillRect`/`fillText`. HUD strings (`main.ts:94-102`) are formatted numerics, no user input. Clean.

**Prototype pollution**
- INFO — No `Object.assign`, spread-merge, or `JSON.parse` on untrusted input in current code. State objects (`PlaneState`, `Bullet`, `Bomb`) are constructed via literals only.

**WebSocket / netcode**
- INFO — No WebSocket wiring present. Confirmed clean for M0/M1.
- HIGH (preemptive, for M3) — when netcode lands: validate every inbound message with a strict schema (zod/valibot), reject unknown fields, clamp numeric ranges (`x/y` to canvas, `angle` to [0,2π], `speed` to [0, MAX_POWERED_SPEED]), drop messages exceeding rate budget. Server must be authoritative for collisions/damage — never trust client-reported hits.

**URL params (planned `?room=<id>`)**
- HIGH (preemptive) — allowlist room IDs to `^[a-zA-Z0-9_-]{4,32}$`. Reject anything else before any DOM/network use. Never reflect raw `location.search` into the page.

**Secrets**
- INFO — None found. `.gitignore:4-5` excludes `.env*`. Good.

**Misc**
- LOW — `src/main.ts:26-27` global `addEventListener` for keys is fine for single-canvas page but will leak if game ever unmounts; bind to `canvas` once HUD/menu DOM appears.
- LOW — Stale compiled `.js` files exist in `src/` (e.g. `main.js`, `physics.js`) despite `.gitignore` excluding them. Run `find src -name '*.js*' -delete` to avoid the vitest-resolver-shadowing trap (see prior tinyclaw feedback).
- INFO — `index.html:7-10` inline `<style>` is trivial, no CSP needed yet; add `Content-Security-Policy: default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self' wss://claw.bitvox.me` when deploying.

## 2026-04-24 02:40Z — Architecture sweep #1

Scope: src/{main,physics,bot,projectiles,constants}.ts. Goals: low-latency MP, fun bots, <5s page-to-match.

**BLOCKER — Sim/render fused in main.ts.** `main.ts:6-9` reads `canvas`/`ctx` at module load; world dims derived from canvas (`main.ts:9`). Sim cannot run headlessly (server, worker, test). Extract `world.ts` with pure `stepWorld(state, inputs[], dt)` + separate `render.ts(state, ctx)`. Without this, M3 server is a rewrite.

**BLOCKER — Projectile pool is module-global singleton.** `projectiles.ts:47-48` — file-scope `bullets`/`bombs` arrays. Server-auth + client prediction needs N parallel worlds (predicted/confirmed/rollback). Refactor to `ProjectileWorld` instance threaded through; functions take `world` param.

**HIGH — Mixed time units across modules.** `physics.ts` uses normalized "frames at 60fps" dt (`main.ts:107`); `projectiles.ts:97-106` uses real seconds; bridged via `PLANE_SPEED_TO_PXPS=60` fudge (`main.ts:23`) and re-multiplied by 60 (`projectiles.ts:106`). Pick one — fixed-step frames recommended for determinism — and convert at I/O edge only.

**HIGH — Non-deterministic timestep.** `main.ts:106-107` variable dt from `performance.now()`. Lockstep/rollback requires fixed-step accumulator (60Hz). `Math.pow(DRAG, dt)` (`physics.ts:46`) with variable dt diverges across clients within seconds.

**HIGH — No test runner, no headless sim path.** Cannot unit-test `stepPlane`/`thinkBot`/`updateProjectiles` because `main.ts` pulls DOM at import and projectile state is global. Add vitest now while sim is small; write golden-trace tests (seed → N ticks → expected state hash).

**MEDIUM — Stale `.js` artifacts in src/.** `src/{main,physics,bot,projectiles,constants}.js` checked alongside `.ts`. vitest/Node resolver may prefer `.js` and you'll chase ghosts. `.gitignore` them, delete now. (See feedback_stale_js_artifacts.md.)

**MEDIUM — Mixed import extensions.** `projectiles.ts:17` imports `./constants.js`; `main.ts:1-4` and `bot.ts:5` omit. Pick one; inconsistency bites bundlers + test resolvers.

**MEDIUM — Input read coupled to globals.** `tryPlayerFire`/`tryPlayerBomb` (`main.ts:37,51`) read global `keys` Set + mutate `plane` directly. Wrap as `collectLocalInput(): InputFrame` returning a serializable struct — that struct is what the wire sends in M3.

**MEDIUM — `ownerId` numeric with magic `PLAYER_ID=0`.** `main.ts:15`, `projectiles.ts:30`. Define `PlayerId` type + central registry; bots and remote players need stable IDs across reconnect.

**LOW — Bot reads opponent state by reference.** `bot.ts:17` takes `target: PlaneState`. Fine for 1v1, breaks at 4 players. Pass `WorldView` (read-only snapshot) so bot can target anyone and is trivially network-safe.

**LOW — `splice` in projectile hot loop.** `projectiles.ts:108,114` O(n) per dead projectile; at 500 bullets this stalls. Use swap-with-last + pop, or generation-tagged pool.

**LOW — HUD allocates strings every frame.** `main.ts:94-100` `toFixed` + template literals each frame = GC churn. Cache + only update on change.

**INFO — Plan collision as `collision.ts(world): Event[]`.** Returns hit events; sim consumes events. Keeps determinism + replayability clean. Terrain (seb's lane) should expose pure `sampleHeight(x): number` so bot AI + bullets share one source of truth.

**INFO — RNG audit clean.** No `Math.random` in physics/bot/projectiles. Keep it that way; when needed, use seeded PRNG (mulberry32) stored in world state so rollback reproduces the same numbers.

## 2026-04-24 02:40Z — Performance sweep #1

Target: 60fps (16.67 ms/frame) on low-end Chromebooks. Today's load (2 planes, <30 bullets) costs ~110 µs/frame — 0.7% of budget. Headroom is fine **now** but several patterns will bite when collisions, terrain, multiplayer, FX land.

### HIGH

- **projectiles.ts:108,114,136,139** — `bullets.splice(i, 1)` inside reverse-iter loop. With MG_MAX=500 + per-bullet despawn, worst-case full-pool churn: up to 500 splices/frame, each O(n) shift = up to ~125k element copies (~250–400 µs). Once collisions add mid-array kills it gets worse. Fix: swap-pop (`bullets[i]=bullets[len-1]; bullets.length--`) or true free-list pool with `active` flag. **Saves ~300 µs/frame at full pool.**
- **projectiles.ts:69,92** — `bullets.push({...})` allocates a fresh object per shot. At 20 shots/sec × 2+ planes = steady GC pressure (V8 minor GC = 1–5 ms = dropped frame on Chromebook). Fix: pre-allocate pool of 500 Bullet objects at boot, reuse via `active:boolean` flag. **Eliminates per-shot alloc.**

### MEDIUM

- **main.ts:42-45,56-57** — 4× `Math.cos`/`sin` of identical `plane.angle` per fire+bomb attempt. Each ~30–80 ns; redundant. Fix: compute `cosA, sinA` once per frame, pass in. Bigger win once multiple weapons share angle.
- **physics.ts:46** — `Math.pow(DRAG, dt)` per plane per frame. With dt typically =1.0, conditional fast-path: `if (dt===1) p.speed *= DRAG; else p.speed *= Math.pow(DRAG, dt)`. **~200 ns saved per plane per frame**, scales with N.
- **main.ts:64-77** — `drawPlane` does `ctx.save/restore + translate + rotate` per plane (~5–10 µs each). Fine for 2; for 8+ planes batch via shared `setTransform` baseline or pre-render rotated sprites.
- **main.ts:80-89** — full-canvas `fillRect` clear + 2 ground rects per frame. Fine, but once parallax/terrain lands switch static layers to a pre-rendered offscreen canvas.

### LOW

- **main.ts:107** — `Math.min(32, now-last)/16.666` — magic literal; precompute `1/16.666` constant.
- **main.ts:91-103** — `drawHUD` calls `toFixed` (allocates string) + 5× `fillText` per frame (~50 µs). Cache HUD strings if values unchanged — `fillText` is the most expensive draw call here.
- **bot.ts:25-26** — `while (diff > Math.PI) diff -= 2*Math.PI` — one iter typical, but `((diff+PI)%(2*PI))-PI` is branchless. Trivial.
- **physics.ts:59-60** — same angle-wrap pattern; replace with `%` form for consistency.

### INFO

- **Frame budget today (2 planes, ~30 bullets):** sim ~30 µs, draw ~80 µs, total ~110 µs of 16,667 µs.
- **At MG_MAX=500 sustained:** sim ~600 µs (splice-dominated), draw ~250 µs (state-shared `fillRect`, fast). Still fits — splice fix is cheapest first win.
- **Future O(n²) risk:** bullet-vs-plane = O(B×P) = fine. Plane-vs-terrain: keep terrain as heightmap-array lookup (O(1) per plane), not polygon list, to avoid creep.
- **constants.ts:6,10** — `MG_SHOT_SPEED=4000` px/s × 0.016 = 64 px/frame; bullet crosses 800px screen in ~12 frames but `MG_RANGE=55` = ~0.9s lifetime. Bullets persist long after offscreen. Add cheap AABB offscreen cull to thin pool.

### Top 3 priorities
1. **Swap-pop in `updateProjectiles`** (projectiles.ts:108,114) — biggest pool-scale win, 5-line change.
2. **Object-pool bullets/bombs** (projectiles.ts:69,92) — kills steady GC, prevents Chromebook stutters.
3. **Offscreen bullet cull** — drops typical pool size, multiplies above gains, also reduces draw calls.

### Suggested SLOs
- Sim < 1 ms/frame at 500 bullets + 8 planes.
- Draw < 4 ms/frame same load.
- Total frame work < 8 ms (half budget) — leaves headroom for compositor/GC.
- Zero allocations in steady-state inner loop (verify via Chrome DevTools allocation timeline).

## 2026-04-24 02:40Z — Delta correctness sweep #1

Scope: 295b5f7..HEAD (311690c projectiles, ba5f37d lift, 476748f bot v0, bc0b75c MG+bomb).

**Logic**
- HIGH — `src/main.ts:11-12` bot spawns mid-air but `createPlane` (`physics.ts:38`) returns `onGround:true`. Frame-0 stall skipped; survives only because `speed=3.5 > STALL 3.0`. Set `bot.onGround=false` after spawn.
- HIGH — `src/projectiles.ts:106-107` `b.life -= 60*dt` + comment "60fps × MG_RANGE = seconds" reads backward (works only because 60×dtSec≈1/frame). Use `lifeSec=MG_RANGE/60`, decrement by `dt`.
- MEDIUM — `src/projectiles.ts:54` `bullets.length >= MG_MAX(500)` is global, shadowing reference's per-side cap. One team starves the other once a 2nd shooter exists. Per-`ownerId` count before M3.
- MEDIUM — `src/main.ts:53` `keys.has('Shift')` only matches bare-Shift `keydown`, not Shift-as-modifier. Verify; switch to `e.shiftKey`.
- LOW — `src/bot.ts:18` throttle binary-flips at STALL+1.2 → chatter. Add hysteresis.
- LOW — `src/bot.ts:29-30` fixed `altitudeBias=±0.15` can dominate `diff` → bot circles altitude. Scale by `1/(1+|diff|)`.

**Comments that lie**
- LOW — `src/physics.ts:17` "cruise ~7 speed" — `MAX_POWERED_SPEED=6.5`, never reached. Fix to ~6.
- LOW — `src/projectiles.ts:5` claims dt in seconds; `physics.ts` is frame-units; `PLANE_SPEED_TO_PXPS=60` (`main.ts:23`) bridges. Document the split.

**Style/TS**
- LOW — `src/main.ts:63` `drawPlane(p: typeof plane, ...)` leaks module binding. Use `PlaneState`.
- INFO — `src/constants.ts:9` `MG_SHOT_COLOR=8` exported, unused.

**Tests**
- HIGH (gap) — No runner. Zero coverage for projectile cap/life, bot ±π wrap, lift retune. `ba5f37d` is the canonical regression ("speed 5, angle 0, hands-off → drift < N px/2s"). Add vitest before next physics tune.

**Commit-msg vs diff**
- INFO — All four messages match diffs.

## 2026-04-24 03:05Z — Performance sweep #2

New surfaces since #1: `collision.ts`, `background.ts`, bot-fire path in `main.ts`, bot cooldown.

### HIGH
- **background.ts:121-126** — `createLinearGradient` + 3 `addColorStop` every frame. Gradient object allocated + GC'd 60/s (~40-80 µs + steady churn). Fix: build once at module init, cache; re-create only on canvas resize. **Saves ~60 µs/frame + kills alloc.**
- **background.ts:130-149** — loops over all ~25-40 shapes per layer every frame with `wrapX` running 2× `%` each. Cull is post-wrap so every shape pays full transform. Fix: precompute worldX ranges, skip entire layer with early bounds test, or hoist visible-shape list and refresh only when camera crosses a tile boundary. **~30-50 µs/frame at today's shape count.**
- **collision.ts:22-34 + projectiles.ts:136** — `killBullet(i)` calls `splice` mid-reverse-loop while also incrementing outer `i--`; correct today but compounds the #1 HIGH at full pool. Swap-pop here too; 500 bullets × 2 planes worst case = ~1000 copies/frame now, ~O(n·p) with more planes.

### MEDIUM
- **main.ts:69-72,83-84,122-125** — 4 fire paths each compute `cos/sin(angle)` 2× + `speed*PLANE_SPEED_TO_PXPS`. Hoist `cosA, sinA, vx, vy` into `PlaneKinematics` cached on plane after `stepPlane`. Saves ~400 ns/plane/frame, scales with weapons.
- **main.ts:188-200** — fresh `hitboxes: []` + `Map` every frame. Pre-allocate module-scope, `length=0` each tick; replace Map with 2-slot typed array keyed by ownerId.
- **background.ts:86-96** — `drawCloud` uses `beginPath` per cloud + multi-arc. Batch all clouds into one path per layer (single `fill()`). 3-4× fewer path ops.

### LOW
- **bot.ts:27** — `Math.hypot(dx,dy)` every tick; squared-distance compare against `FIRE_RANGE²` avoids sqrt.
- **main.ts:172** — `Math.min(32, now-last)/16.666` — precompute `1/16.666`.

### Frame budget update (2 planes, ~30 bullets, bg on)
Sim ~45 µs (+15 for collision), draw ~230 µs (+150 for bg gradient+shapes). Total ~275 µs = 1.6% of 16.67 ms budget. Bg dominates draw. Top 3: gradient cache, swap-pop everywhere (collision + projectiles), pre-alloc hitboxes/Map.

## 2026-04-24 03:05Z — Security sweep #2

Scope delta: `background.ts` (new), `bot.ts` bot-fire wiring, `main.ts` audio + bot-fire + background wiring, `vite.config.ts` (new `base='/triplane/'`), `index.html` audio src change.

**Deploy path / subpath**
- MEDIUM — `vite.config.ts:4` sets `base='/triplane/'` but built `dist/index.html` emits `<script src="/triplane/assets/...">` (absolute, rewritten) while `<audio>` stays `./audio/landing.mp3` (relative). If Caddy serves `dist/` with any trailing-slash redirect or nested route, audio resolves wrong and 404s; also defeats future CSP `media-src 'self'` path-locking. Fix: `index.html:14` back to `/audio/landing.mp3` so Vite rewrites it to `/triplane/audio/landing.mp3`, matching the script. Add a smoke-fetch of the mp3 post-deploy.
- LOW — No `Content-Security-Policy` on deploy. Add at Caddy for `/triplane/*`: `default-src 'self'; media-src 'self'; img-src 'self' data:; script-src 'self'; connect-src 'self'`. Also `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: geolocation=(), microphone=(), camera=()`.
- INFO — Serve under HTTPS only (Caddy default on claw.bitvox.me) — satisfies secure-context reqs for any future WebRTC/gamepad/pointerlock.

**Audio element**
- INFO — `main.ts:10-18` `bgm.play()` gated behind user gesture with `.catch(() => {})`. No user-controlled URL, no XSS surface. Clean.
- LOW — Hardcoded `bgm.volume=0.4`, no mute. Not a security issue; mitigated by gesture gate against hostile-embed abuse.

**Bot fire path**
- INFO — `main.ts:117-129` `tryBotFire` uses const `BOT_ID=1` + same muzzle math as player. No external input. Sweep #1 MEDIUM on global pool cap still stands (one shooter can starve others once N>1).

**background.ts**
- INFO — Pure Canvas2D draws, hardcoded `mulberry32` seeds, no DOM/fetch/eval. Clean.

**Dependencies**
- INFO — `npm audit`: same 2 moderate dev-only advisories (esbuild/vite). Unchanged.

**Secrets**
- INFO — No new env/token surface. `.gitignore` still excludes src *.js; 7 stale compiled .js remain on disk (cosmetic, not sec).

## 2026-04-24 03:05Z — Architecture sweep #2

Scope: 295b5f7..HEAD (+ bg, combat, bot-fire, audio, /triplane/ deploy). Sweep #1 BLOCKERs/HIGHs still open.

**Regression tracker**
- INFO — `.gitignore:src/**/*.js` (MEDIUM #1) resolved. Untracked compiled `.js` still on disk — `rm src/*.js` before vitest lands or resolver prefers them.
- INFO — `ownerId` promoted to `main.ts:27-28` constants but still numeric. `PlayerId` type still owed for M3.
- INFO — `drawPlane(p: typeof plane)` (#1 LOW) unresolved at `main.ts:90`.

**New BLOCKER — Combat state fused into main.ts.** `main.ts:33-38` inline `Combatant`/HP/score; `main.ts:191-200` mutates HP + score in render tick. Third system glued to the DOM-entry module (after projectiles + plane physics). Extract `combat.ts` with pure `applyDamage(state, events): ScoreDelta` before lives/teams/rounds land — M3 server rewrite otherwise doubles.

**New HIGH — `background.ts` world is module-scope singleton.** `background.ts:42-75` — `CLOUDS`/`MID_HILL_SHAPES`/`NEAR_HILL_SHAPES` pre-generated at import. Same anti-pattern as the open projectile-pool BLOCKER. Un-swappable per-match/per-seed. Wrap as `createBackground(seed): { draw(ctx, cam) }`; drive seed from match config.

**New HIGH — Camera === `plane.x` (`main.ts:108`).** Breaks the moment a second human joins (whose plane?). `drawBackground` takes `cameraX` (good seam) but a `camera.ts` policy (centroid/leader/split-screen) is owed before M2.

**New MEDIUM — Bot targets player by direct reference (`main.ts:180`, `thinkBot(bot, plane, …)`).** Sweep #1 LOW now load-bearing since bot fires at `plane`. `WorldView` snapshot owed before >1 bot or reconnection.

**New MEDIUM — Audio is DOM-coupled singleton (`main.ts:10-18`).** `getElementById('bgm')` at module load; no `AudioSystem` seam. Bake `sound.ts(Event[])` before SFX (gunfire, explosions) so combat emits events instead of imperative `.play()`.

**LOW — `stepCombatant` unused `_p` param (`main.ts:131`).** Dead signature.

**INFO — `vite.config.ts:4 base='/triplane/'`** hard-codes subpath into the bundle — breaks at root or alt prefixes. Env-drive before a second deploy target.

**Status:** 2 BLOCKERs + 3 HIGHs unchanged. New code actively deepens both BLOCKERs (combat joins fused pile; background adds second singleton). Recommend pausing features for sim/render split + vitest harness before M2.

## 2026-04-24 03:05Z — Delta correctness sweep #2

Scope: bc0b75c..c87252a (combat, audio, parallax+wire, vite-base, bot-fire, audio swaps). Wrong-logic / off-by-one / sign only; skipping issues caught by Perf/Sec/Arch #2.

**Combat / respawn**
- HIGH — `src/main.ts:57,73` `playerFireCooldown`/`bombDropCooldown` keep decrementing while `hp<=0` (the `Math.max(0,cd-dt)` runs before dead/onGround early-returns). Holding space through death = instant burst on respawn. Fix: reset cooldowns in `respawnPlane`, or gate the decrement behind `hp>0`.
- MEDIUM — `src/collision.ts:20` `break` after first hit: one bullet can only damage one plane even if two overlap. Fine 1v1; intent call for 4-plane melees.
- LOW — `src/main.ts:175` `dtSec = dt/60` where `dt = ms/16.666` → `ms/999.96`, off 0.004% vs real seconds. Cosmetic.

**Parallax wrap**
- HIGH — `src/background.ts:42-46` cull uses `peakX` only, ignoring shape width. A `width=420` hill with peak at `x=-300` paints to `x=-90`, inside viewport, but the `x < -400` cull (line 149) can drop it — edge-pop. Cull by `peakX ± width/2`.
- MEDIUM — `cameraX = plane.x` (`main.ts:108`): on respawn plane teleports → background snaps ~540 px. Lerp or reset explicitly.

**Input**
- MEDIUM — `src/main.ts:39-47` `shiftDown = e.shiftKey` only updates on key events. Alt-tab with Shift held → keyup never fires → stuck true → bomb-spam on refocus. Clear on `blur`/`visibilitychange`.

**Sign / off-by-one**
- `bot.ts:41` fire predicate sign correct. Muzzle offsets (`main.ts:69-72,122-125`) all `+16` forward, consistent with facing. Parallax scroll `-cameraX*parallax` yields correct rightward-motion illusion. No sign bugs.

**Commit-msg vs diff** — all match; 270e8f1 cleanly reverts 265e647, c87252a reapplies.

## 2026-04-24 03:40Z — Performance sweep #3

Net-new surfaces: `vfx.ts`, `physics.ts` rewrite (variable-dt floats), `physics.test.ts`, `ai-vs-ai.test.ts`, sprite draws.

### HIGH
- **vfx.ts:23,38** — `particles.push({...})` allocates 30 objs per death + `splice(i,1)` on expire. At 2-player match w/ ~1 death/5s it's fine, but scales with N² at team/FFA. Same fix as projectiles BLOCKER: pre-alloc pool (cap 256) + swap-pop + `active` flag. **Kills GC spike at death moment (30 allocs in one frame = visible hitch on Chromebook).**
- **physics.ts:48,144** — `Math.pow(DRAG_PER_SEC, dtSec)` every plane/frame (was called out #1 but now runs in new rewrite's hot path + unconditionally). At 8 planes × 60Hz = 480 calls/s (~100-200 ns each). Fast-path dtSec≈1/60 via precomputed `DRAG_PER_FRAME`.

### MEDIUM
- **physics.ts:117-123** — stall-drift `while` wrap on angle-diff; replace with `((d+PI)%(2*PI))-PI` branchless. Runs only when stalled but lands in same-frame determinism hot loop for tests.
- **vfx.ts:42-43** — two `Math.pow` per particle per frame = up to 60 pow/frame at 30 particles. Use `exp(ln(k)*dt)` precomputed, or simple linear damping; difference imperceptible visually.
- **main.ts:209,216** — duplicates `cos/sin(angle)*speed*PXPS` for velocity inheritance on death. Reuse cached kinematics (still owed from #2).

### LOW
- **vfx.ts:48-53** — per-particle `fillStyle` + `globalAlpha` writes = state thrash. Bucket by color, one alpha sort, batch draw. ~15 µs saved at 100 particles.

### Frame budget update (2 planes, 30 bullets, bg, 30 particles mid-death)
Sim ~55 µs, draw ~260 µs (+30 vfx), total ~315 µs = 1.9% of 16.67 ms. Death-frame spike: +300-500 µs GC = survivable now, hitch-risk at 8p. **Top 3:** vfx pool, drag fast-path, hitbox/Map pre-alloc (#2 carryover). SLOs unchanged.
