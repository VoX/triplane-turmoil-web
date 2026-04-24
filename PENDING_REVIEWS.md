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

## 2026-04-24 03:40Z — Architecture sweep #3

Scope: c87252a..74a3c2b (physics rewrite, vfx module, bot v2 evasion, sprites, vitest harness). Priors recap: 2 BLOCKERs (sim/render fused, projectile-pool singleton) + 3 HIGHs (mixed time units, variable dt, no tests) still open from #1; #2 added combat-fused + background-singleton + camera-is-plane.x HIGHs.

**Regression tracker**
- PROGRESS — HIGH #1 "no test runner" resolved. `vitest 4.1.5` wired, `physics.test.ts` (4 tests) + `ai-vs-ai.test.ts` (1 e2e) pass.
- PROGRESS — HIGH #1 "mixed time units" partially resolved: `physics.ts:10` now explicitly seconds. `PLANE_SPEED_TO_PXPS=60` fudge still lives at `main.ts:49`, `projectiles.ts` still frame-life units (`projectiles.ts:26`). Not fully unified.
- REGRESSION — MEDIUM "stale `.js` in src/" back; all 10 modules have shadow `.js`. vitest resolver with `.ts` first is OK **today**, but e2e test importing `./projectiles` from a compiled `.js` will prefer `.js`. `rm src/*.js` + add to `.gitignore` before more test growth.
- UNRESOLVED — BLOCKER #1 (sim/render fused): `main.ts:9-10,118,225-228` still DOM-coupled at import. No `world.ts` / `render.ts` split.
- UNRESOLVED — BLOCKER #2 (projectile pool singleton): `projectiles.ts:47-48` unchanged.
- UNRESOLVED — #2 BLOCKER combat-in-main (`main.ts:33-42,199-221`), HIGH bg singleton, HIGH camera=plane.x.

**New HIGH — VFX is a third module-scope singleton.** `vfx.ts:14` file-scope `particles: Particle[]`. Same anti-pattern as projectiles + background. Now three parallel worlds to thread through rollback. Wrap as `createVfxWorld(): { spawn, update, draw }`.

**New HIGH — Tests validate the singleton pile.** `ai-vs-ai.test.ts:42` calls `getBullets()` global + `killBullet(i)` global. The e2e only works *because* both "fighters" share one bullet pool. This cements the BLOCKER — future refactor breaks the one test proving bots dogfight.

**New MEDIUM — Sprite load is fire-and-forget at module scope (`main.ts:13-16`).** No onload tracking, no "assets ready" gate. Render uses `sprite.complete && naturalWidth>0` fallback which is fine today; pre-M2 add an `AssetLoader` with Promise.all so title/ready state can await.

**New MEDIUM — Bot memory is implicit global state.** `main.ts:31` single `botMem`. No `Bot` class/factory keyed by id. Second bot needs copy-paste.

**LOW — `stepCombatant` still has unused `_p` (`main.ts:142`).** Unchanged from #2.

**Status:** 2 BLOCKERs + 4 HIGHs open (new vfx singleton + test cements coupling). Tests are the right move but validate the wrong shape — refactor before adding more coverage or you'll fossilize the globals.

## 2026-04-24 03:40Z — Security sweep #3

Scope delta: `vitest ^4.1.5` (new devDep), `src/{physics,ai-vs-ai}.test.ts` (new), `src/vfx.ts` (new), `src/bot.ts` evasion rewrite, pixellab sprite PNGs in `public/sprites/`, sergiou87 physics port.

**Dependencies**
- LOW — `package.json:16` vitest ^4.1.5 pulls transitive `tinypool`, `tinyrapid`, `@vitest/*` chain; `npm audit` still reports the same 2 moderate advisories (esbuild/vite), no new CVEs introduced. Keep `vitest run` dev-only; never expose test UI (`vitest --ui`) publicly.

**Untrusted asset loading (pixellab)**
- LOW — `main.ts:13-16` loads `./sprites/plane_*.png` by relative path — same subpath bug as sweep #2 audio (`base='/triplane/'` rewrites absolute but not relative consistently; under `/triplane/` subpath it happens to resolve, but drop-in re-host breaks). Switch to `/sprites/plane_red.png` so Vite base-rewrites it.
- INFO — PNGs (64×64 RGBA, <2KB each) verified clean PNG via `file`. No EXIF/ICC metadata scanning performed; pixellab output is trusted enough for client-side canvas, but if asset pipeline ever accepts user-supplied sprites, run `oxipng --strip all` + MIME sniff server-side.
- LOW — No `crossorigin` attr on `new Image()` loads. Fine today (same-origin), but once sprites move to a CDN, `getImageData`/`toDataURL` from canvas will taint. Set `img.crossOrigin='anonymous'` + CDN CORS now to avoid retrofit.

**Test harness**
- INFO — `src/ai-vs-ai.test.ts` + `src/physics.test.ts` import pure modules only, no DOM/network. `main.ts:9,11` still imports `document.getElementById` at module top — tests avoid it by not importing main. Guard: don't add re-exports from main.ts or tests break under jsdom-free env.

**VFX RNG**
- INFO — `vfx.ts:21-29` uses `Math.random()` for particle spread. Cosmetic-only (no physics/damage impact). When netcode lands, either keep VFX client-local (recommended) or seed from match RNG; do NOT let it drift into damage rolls.

**Bot evasion**
- INFO — `bot.ts:32-46` `notifyBotDamage` is pure state mutation, no external input. Clean.

**Stale `.js` regression**
- LOW — 10 compiled `.js` (incl. `vfx.js`, `ai-vs-ai.test.js`) still in `src/`. `.gitignore`'d but on disk; vitest may prefer `.js` over `.ts`. `rm src/*.js` now.

## 2026-04-24 03:40Z — Delta correctness sweep #3

Scope: `1bb609e..74a3c2b` — physics rewrite, vfx, sprites, bot v2, vitest.

### HIGH
- **physics.ts:129** — turn-speed-cost is dimensionally scrambled. Intent: `speed -= initial_turn/100` per 70Hz tick (~0.175 float/sec at stall). Actual: `turnRate*TICK_HZ*dtSec*0.01*(180/π)/TICK_HZ` ≈ 0.0075/sec, ~23× under. Turning is effectively free. Drop the TICK_HZ pair and rad→deg.
- **physics.ts:160-164** — at zero speed, `fallPerSec=(1000+200)*FALL_SCALE*TICK_HZ≈2860 px/sec`; cruise `movePerSec=speed*60` tops ~600. FALL_SCALE bakes TICK_HZ (70/8/256) then gets `*dtSec` downstream — double-applied. Planes fall 5-7× faster than fly. Drop TICK_HZ from scale or divide by 60 to match pixel basis.

### MEDIUM
- **physics.test.ts:22 (cruise)** — speed=6.0 → `6*256>1200` threshold → `fallPerSec=0` by construction. Passes trivially, doesn't validate lift. Need `stall*1.2` case.
- **physics.test.ts:39 (turn)** — slow=STALL_SPEED exactly; drag pushes below stall in ~400ms, divisor branch gates on `≥stall` so slow gets full turnRate for the wrong reason. Set both throttled, slow=stall+0.5.
- **ai-vs-ai.test.ts** — no respawn exercised; 1bb609e cooldown-zero fix has zero regression coverage. Add kill→wait→assert-no-burst.
- **bot.ts:27-29** — "perpendicular to attacker" comment misleading; evadeAngle is perp to line-to-target in world frame.

### LOW
- **physics.ts:114** — "radians per tick" stale; STALL_DRIFT bakes dtSec·TICK_HZ.
- **74a3c2b msg** — claims stale `.js` fixed; 10 still on disk per Security #3. `rm` not run.

## 2026-04-24 04:05Z — Security sweep #4

Scope delta: `sfx.ts` (WebAudio), `combat.ts`, `main.ts` bot2, 4 new sprite PNGs.

**WebAudio / DoS**
- MEDIUM — `sfx.ts:110-115` `sfxExplosion` has **no throttle** (MG/hit do) and allocs 3 nodes/call. Simultaneous deaths in 4p FFA / netcode can burst toward Chrome's ~1000-voice ceiling and throw. Add ~80ms throttle + voice cap.
- LOW — `sfx.ts:40` noise buffer seeded once via `Math.random()`, reused forever. Wall off from any future gameplay RNG so buffer bytes can't leak into damage rolls.
- LOW — `sfx.ts:26-33` `initAudio` fires on any keydown/pointerdown; iframe-embed lets hostile parent spoof via synthetic events. Single-instance `AudioContext` caps damage — keep it.

**combat.ts**
- INFO — pure state; `Map<number,number>` numeric-keyed, safe from `__proto__` pollution.

**bot2**
- LOW — `main.ts:173` `botFireCooldowns: Record<string,number>` on string literals. Swap to `Map<number,number>` on `ownerId` to match combat.ts and pre-empt prototype-key risk.

**Sprites**
- INFO — 4 new PNGs verified 8-bit RGBA, 381B-1843B, no metadata chunks. Relative `./sprites/…` load issue from #2/#3 still applies across all 6.

**Deps**
- INFO — `npm audit --omit=dev` → 0 vulns. Unchanged.

## 2026-04-24 04:05Z — Architecture sweep #4

Scope: `74a3c2b..d6055b5` (combat.ts extracted, sfx.ts added, bot2 inlined, bomb/cloud/hill sprites).

**Regression tracker**
- PROGRESS — #2 BLOCKER combat-fused partially addressed. `combat.ts` owns HP/respawn/score/crash as pure functions. `main.ts:229-300` still orchestrates (mutates Combatants + spawns VFX/sfx inline) but the *rules* are extractable. Net win.
- UNRESOLVED — #1 BLOCKER projectile-pool singleton untouched (`projectiles.ts:47-48`).
- REGRESSION — "bot is singleton" copy-pasted into `bot2`. `main.ts:43-47,51,55,173` — parallel `bot2/bot2Mem/bot2C/BOT2_ID` + `botFireCooldowns: Record<string,number>` keyed on magic strings. Sweep #3 MEDIUM predicted this; the 2nd bot forced duplication, not a fix. Three-plane paths (`main.ts:229-300`) are now three near-identical blocks.
- REGRESSION — `sfx.ts:14-20` new module-scope singleton (ctx/masterGain/throttle/engine state). Four singletons now (projectiles, background, vfx, sfx) to thread through server/rollback.

**New HIGH — combatant/plane/mem/id sprawl.** 4 parallel bindings per player. `Entity { id, plane, combatant, memory?, sprite }` + `entities[]` collapses the three-block pile into single passes. Blocks M2 FFA.

**New MEDIUM — `Record<string,number>` cooldowns** (`main.ts:173`). String-keyed; belongs on Combatant/Entity by numeric id.

**LOW — `stepCombatant` unused `_p`** (`main.ts:189`) — carried from #2/#3.

**Status:** 2 BLOCKERs + 5 HIGHs. Combat extraction was right; feature velocity (bot2, sprites, sfx) outpaces debt paydown. Pause new planes until entities array + projectile world land, or FFA is a rewrite.

## 2026-04-24 04:05Z — Performance sweep #4

Net-new: sfx oscillators, bot2, cloud/hill sprites, bomb rotation.

### HIGH
- **sfx.ts:95-102,118-123** — every MG shot allocs 4 fresh nodes (BufferSource+BiquadFilter+GainNode+Oscillator). 2 shooters × ~28 shots/s = ~224 node allocs/s + graph-teardown GC. Scales with N bots. Pre-build a 16-voice ring, retrigger. **Kills graph churn + ~50 µs/shot.**
- **main.ts:250-253** — `hitboxes: []` allocated per frame; 3 planes × 60Hz = 180 pushes/s + GC. Pre-alloc module-scope, `length=0`/reuse.

### MEDIUM
- **projectiles.ts:134-139** — bomb draw: `atan2`+`save/translate/rotate/restore` per bomb per frame. ~8 µs × MAX_BOMBS=8 = ~64 µs. Cache angle in `updateProjectiles`.
- **main.ts:143-164** — cloud+hill sprite loops run on top of `background.ts`'s gradient+shape layer. Two backdrop systems = ~200 µs overdraw. Pick one.
- **main.ts:173** — `botFireCooldowns` string-keyed `Record`; per-frame hash lookup. Move to `Map<number,number>` on ownerId (also fixes Sec/Arch LOW).

### LOW
- **main.ts:258-294** — six sites recompute `cos/sin*speed*PXPS` for explosion inheritance; #2/#3 carryover, worse with bot2.
- **sfx.ts:40** — 22050-sample `Math.random()` fill in `initAudio` = ~200 µs first-gesture jank. Lazy-fill in idle callback.

### Frame budget (3 planes, ~45 bullets, bg+sprites, audio)
Sim ~80 µs (+25 bot2), draw ~340 µs (+60 bomb-rotate, +20 sprite double-draw), audio ~30 µs fire-spikes. Total ~450 µs = 2.7% of 16.67 ms. Death-frame +600 µs. Chromebook hitch-risk growing. **Top 3:** sfx voice pool, hitbox pre-alloc, pick one bg system. SLOs unchanged.

## 2026-04-24 04:05Z — Delta correctness sweep #4

Scope: `ef8165f..d6055b5` — sfx, crash, combat extract, bomb/green/cloud/hill sprites, bot2.

### HIGH
- **main.ts:279,285,293 — bot2 kills unrecorded.** Damage path hard-codes `addKill(score, BOT_ID)`/`PLAYER_ID`; `resolveBulletHits` returns victim→dmg only, no killer. Bot2 kills never enter `score.kills`; bot1-vs-bot2 crossfire credits the player. HUD reads BOT_ID only — bot2 stats invisible. Fix: return killer ownerId from collision.
- **main.ts:308-312 — `sfxEngine` schedules 60 ramps/sec.** `linearRampToValueAtTime` every frame piles automation events on one Gain+Osc timeline unboundedly → CPU creep over a long match. Gate on throttle delta > 0.02 or ~100ms.
- **main.ts:147-152 — cloud parallax pops.** `drawImage` at `sx - 32` draws one copy; sx crossing 0/640 vanishes the cloud instead of wrapping. Draw twice (`sx` and `sx ± canvas.width`).

### MEDIUM
- **main.ts:255-278 — same-frame crash+bullet race.** Crash sets hp=0; bullet block then `takeDamage`s a dead victim. Early-return saves it; `addKill` would double-credit without the guard. Document "crash authoritative".
- **main.ts:44,197 — bot2 respawn speed mismatch.** Initial 4.0; `respawnPlane` 3.5. Post-respawn bot2 behaves differently. Parameterize.
- **bot.ts:49 — both bots target `plane` only** (commit admits). Bot1-vs-bot2 crossfire credits player via HIGH #1. Tag for M2.
- **ai-vs-ai.test.ts** — no new coverage for crash, sfx, bot2, respawn. 16b6b2a "5 tests pass" true, unchanged since 74a3c2b.

### LOW
- **projectiles.ts:134** — `atan2(vy,vx)` assumes bomb PNG nose at +x; confirm orientation.
- **main.ts:303-305** — three stale comments describe a moved block. Delete.
- **main.ts:189** — `stepCombatant` unused `_p`, third sweep flagging.

## 2026-04-24 04:40Z — Performance sweep #5

Net-new: HP bars + kill feed.

### MEDIUM
- **main.ts:114-122** — `drawHpBar` 2 `fillRect` + 2 `fillStyle`/plane. 3p ≈ 12 µs; 8p ≈ 40 µs. Batch by color bucket (backings, then fills) to halve state thrash.
- **main.ts:127-130** — `ctx.measureText(k.message)` per entry per frame. 5 × 60fps = 300/sec (~5-15 µs each). Strings stable 3s. Cache `width` on push; draw becomes pure `fillText`. **Saves ~3 ms per feed lifetime.**
- **main.ts:135** — `killFeed.splice(i,1)` mid-reverse-loop. Cosmetic at cap-5; same swap-pop pattern as projectile BLOCKER.

### LOW
- **main.ts:124,133** — `performance.now()/1000` twice per feed frame. Hoist once per tick.
- **main.ts:118** — `Math.max(0, hp/MAX_HP)` redundant; clamped in `takeDamage`.

### Frame budget (3p, ~45 bullets, bg, audio, HP+feed)
Sim ~80, draw ~380 (+26 HP +14 measureText), audio ~30 µs. ~490 µs = 2.9% of 16.67 ms. Top 3 unchanged; add #4 cache feed widths. SLOs unchanged.

## 2026-04-24 04:40Z — Architecture sweep #5

Scope: `d6055b5..7b40784` (HP bars + kill feed inlined into `main.ts`; PRODUCT_PLAN promotes `Fighter[]` + per-world projectiles to P0).

**Regression tracker**
- VALIDATION — plan now lists `Fighter` entity + projectile-world as P0 #1/#2. Sweep #4's HIGH self-acknowledged as M2-blocking. Good.
- UNRESOLVED — both BLOCKERs (sim/render fused, projectile singleton) + 5 prior HIGHs all open. Zero structural commits since #4.
- REGRESSION — `main.ts` 310→378 LoC (+22%). HUD (kill feed + hp bar + score readout + crash msgs) is the fourth subsystem inlined alongside combat orchestration, sprite loading, BGM, render loop.

**New HIGH — HUD is a fifth module-scope singleton.** `main.ts:114-115` `killFeed: KillEvent[]` at file scope (allocates, mutates, drains via `splice` in render). Joins projectiles, background, vfx, sfx as state that won't survive a `createWorld()` boundary. `pushKill` called from 6 sites in the loop, fanning the coupling. Extract `hud.ts` with `createHud(): { pushKill, drawFeed, drawHpBar }` before scoreboards/team colors land.

**New HIGH — victim/killer identity stringly-typed at call sites.** `pushKill('You','Enemy')`/`'Teal'`/`'Green'` (`main.ts:323,330,339`) hard-codes display names into combat resolution. Sweep #4 HIGH about killer-id attribution now compounded — kill credit and feed labels are two parallel string maps. Owe `Fighter { id, displayName, color, ... }` (P0 #1) before this fans.

**New MEDIUM — `drawHpBar` reads `MAX_HP` from combat to render** (`main.ts:146`). Couples render to combat constants; pass `hpPct` from caller.

**LOW — `stepCombatant` unused `_p`** (`main.ts:229`) — fourth sweep flagging.

**Status:** 2 BLOCKERs + 6 HIGHs (was 5). Plan promotion is right; feature inlining outpaces it. Hard pause on new HUD/render features until P0 #1+#2 land.

## 2026-04-24 04:40Z — Security sweep #5

Scope: `d6055b5..7b40784` — kill feed, HP bars, crash-attribution fix, plan refresh, cloud double-draw. `npm audit --omit=dev` 0 vulns (unchanged).

**XSS / injection**
- INFO — kill-feed strings (`main.ts:118`) are hardcoded literals (`'You'`/`'Teal'`/`'Green'`/`'Enemy'`); no user input reaches `fillText`. Canvas2D text is non-DOM, immune to script exec. When netcode lands and remote names enter `pushKill`, cap length, strip control chars / RTL overrides (U+202E etc.), reject non-printable before render.

**Resource exhaustion**
- INFO — `killFeed` capped at 5 via `while > 5 shift` (`main.ts:120`); 3s TTL prunes (`:128`). Bounded.
- LOW — `ctx.measureText` (`main.ts:132`) cheap today; with future remote names becomes a CPU-burn vector via long unicode/combining strings. Cap message length at push.

**Crash-attribution fix**
- INFO — removing `addKill` on self-crash (`main.ts:295,301,307`) closes the score-spoof where suicide credited the bot. Correct per crash-authoritative rule from sweep #4.

**Cloud double-draw / plan doc**
- INFO — extra `drawImage` (`main.ts:191`) bounded (5 fixed × 2). `PRODUCT_PLAN.md` adds public live URL + commit ref, no secrets.

**Carryovers:** sweep #4 sfx-throttle MEDIUM and bot2-name-string LOW remain open.

## 2026-04-24 04:40Z — Delta correctness sweep #5

Scope: 17e078d (HIGH-fix), 36e5a4c (plan), 9b5cf8d (HP bars), 7b40784 (kill feed).

### HIGH
- **main.ts:191** — Cloud double-draw on the **wrong side**. As `plane.x` grows (player flies right), `sx = (cx - plane.x*0.15) mod canvas.width` decreases and wraps `0 → canvas.width`. Fresh cloud enters at the **right** edge → seam-cover copy must be at `+canvas.width`, not `-canvas.width`. Current `sx - cw/2 - canvas.width` only covers the left-flying case. Pop still visible flying right (the dominant direction). Draw both sides (`±canvas.width`) or sign-pick by velocity.

### MEDIUM
- **main.ts:294-309** — Crash branch runs **before** `resolveBulletHits`. If a bullet kills a plane the same frame it crashes, `takeDamage(p, MAX_HP)` is no-op on a 0-hp plane but `pushKill('Teal', null)` still fires → duplicate "X crashed" + "You downed X" in feed. Guard each crash branch with `&& cmb.hp > 0` re-check, or reorder bullets-then-crashes. Also: HIGH-fix dropped self-crash attribution entirely; if scoreboard rules want suicide to count against the victim, that's now silent. Confirm intent.
- **main.ts:128** — Cap-5 eviction uses `splice` with no fade. If a 6th kill lands within an entry's first 2.5s, the oldest pops out abruptly mid-display. Drop the cap (rely on 3s TTL) or fade-on-evict.
- **main.ts:185** — `cloudPositions = [120, 380, 670, 950, 1280]` — `1280` may exceed canvas.width. Modulo wrap survives, but the magic numbers betray a stale wider-viewport assumption. Confirm.

### LOW
- **main.ts:117** — `KILL_FEED_LIFE_SEC = 3.0` consumed as seconds; matches commit msg.
- **PRODUCT_PLAN.md** — doc-only, no correctness risk.

## 2026-04-24 05:05Z — Performance sweep #6

Net-new: tracers, bomb splash, cloud triple-draw.

### HIGH
- **projectiles.ts:127-137** — per-bullet `beginPath`/`moveTo`/`lineTo`/`stroke` + `hypot`. Stroke is Canvas2D's priciest path op; 500-pool ≈ 3-5 ms/frame. Batch into one path + trailing `stroke()`, reuse cached `ux/uy`, drop redundant `fillRect` line 138. **~2-4 ms saved.**

### MEDIUM
- **main.ts:289-303** — bomb splash allocs fresh `[{...},{...},{...}]` literal per ground-bomb-per-frame. Fans at 8p. Reuse entities[] (P0 #1); pre-square `BLAST_RADIUS²`.
- **main.ts:191** — cloud draws now 9/frame (was 6). Sign-pick by velocity, draw 2.

### LOW
- **projectiles.ts:123** — hoist `strokeStyle` outside loop.

### Frame budget (3p, ~45 bullets, bg, audio, HUD, tracers, splash)
Sim ~85, draw ~470 (+80 tracer, +10 cloud), audio ~30. ~585 µs = 3.5%. 500-pool blows draw to ~4 ms — first real pressure. **Top 3:** batch tracers, sfx pool (#4), hitbox pre-alloc.

## 2026-04-24 05:05Z — Security sweep #6

Scope: splash, vfx PRNG, tracers, entity.ts. `npm audit` clean.

### MEDIUM
- **main.ts:296-301** — splash kill fires `pushKill` only, no `addKill` (bullets do, `:337+`). Splash-killing player updates feed but not scoreboard.
- **main.ts:301** — killer-name chain defaults unknown ownerId to `'Green'`; brittle once bots/remotes drop bombs — owner→name off `Fighter` (P0 #1).

### LOW
- **main.ts:301** — own-bomb splash → `pushKill('You','You')`. Gate `victim===killer`.

### INFO
- **vfx.ts:38** — mulberry32 non-crypto (correct, VFX). Default seed constant + `seedVfx` never called → identical first burst per load. Netcode must seed from server world-id, never `Date.now()`.

Carryovers: #4 sfx-throttle, #5 measureText caps + RTL strip — netcode-blocked.

## 2026-04-24 05:05Z — Architecture sweep #6

Scope: `7b40784..42c1704` — bomb splash, vfx-seeded-PRNG (#7), cloud triple-draw, bullet tracers, `entity.ts` (`Fighter` type) created but unwired.

**Health movement**
- WIN — `vfx.ts:38-43` adds `seedVfx` + per-burst `seed` arg. First sim-state to go deterministic since the rewrite call. Default-stream + override is the right shape; clone for any future `Math.random` site.
- WIN — `entity.ts` lands `Fighter` + `createFighter`/`respawnFighter`. Type matches PRODUCT_PLAN P0 #1; clean dependency edge (entity → physics/combat/bot, no DOM, no `main`).
- REGRESSION — type exists, **zero call sites**. `main.ts:38-58` still hand-rolls `plane`/`bot`/`bot2` + `botC`/`bot2C` + `botMem`/`bot2Mem` + `botFireCooldowns`. Bullet-damage switch (`main.ts:335-360`) unchanged; new bomb-splash loop (`main.ts:291`) is a fourth N×3 stringly-typed ladder. Adding bot3 = ~14 sites instead of one push.
- REGRESSION — `main.ts` 378→395 LoC. `Fighter` migration cost grows with every feature shipped pre-wire-up.

**New MEDIUM — splash damage hardcodes the roster.** `main.ts:291` literal `[{plane,player,'You'},{bot,botC,'Teal'},{bot2,bot2C,'Green'}]`. Land `fighters[]` first or this gets copied for missiles/AA.

**Status:** 2 BLOCKERs + 6 HIGHs open. Scaffolding in (Fighter, seeded vfx); zero wired. Hard pause on combat features until P0 #1 lands.

## 2026-04-24 05:05Z — Delta correctness sweep #6

Scope: 3baf7ee (bomb splash), 26cf6ed (vfx PRNG #7), 86bc053 (cloud), 42c1704 (tracers).

### HIGH
- **main.ts:298-302** — Bomb splash calls `pushKill` but never `addKill(score, hit.ownerId)`. Scoreboard at L255 silently undercounts every bomb-kill; only MG kills (L337/344/353) increment. Mirror bullet path.
- **main.ts:291,301** — Own plane is in splash `h` array → fly into own bomb, feed reads "You downed You". Skip when `hit.ownerId === h.c.id` or pass `null` killer.

### MEDIUM
- **main.ts:288-304** vs **L314+** — Splash kills before crash branch. Same race sweep #5 flagged: bomb drops plane to 0 hp, ground-impact same frame fires `takeDamage(_, MAX_HP)` + second `pushKill('X', null)` → "X downed X" then "X crashed". Re-check `hp > 0` or reorder.
- **vfx.ts:20** — `seedVfx` exported but `main.ts` never calls it. Determinism claim half-built — module-load seed fixed across runs, but world-reset/reconnect won't reseed → drift between joiners. Wire at boot.
- **main.ts:291** — Per-frame 3-object array literal in bomb loop. Hoist to module scope.

### LOW
- **projectiles.ts:124-138** — Tracer mixes `stroke`+`fill` per bullet, no batching. Perf #6 already flagged.
- **main.ts:185** — `cloudPositions` trimmed to 3 + triple-draw at ±W. Correct.

## 2026-04-24 05:40Z — Security sweep #7

Scope: fighters[] refactor, bot3, seedVfx wired, nearest-enemy targeting. `npm audit` = 2 moderate (vite/esbuild, carryover).

### MEDIUM
- **main.ts:49** — `seedVfx(Date.now() & 0xffffffff)` — client-controlled seed. Fine for solo, but netcode must replace with server-authoritative world-id; clock skew/tampered client → desync-exploit vector. Add TODO comment.
- **main.ts:346-351** — killer attribution still hardcoded `'Enemy'`/`'You'`. With bot3 live, any bot→bot bullet kill credits PLAYER_ID (L349). Scoreboard inflatable by idling while bots dogfight.

### LOW
- **main.ts:239** — `pickNearestEnemy` O(N²) per-frame across all fighters; at 4p trivial but unbounded. Cache last-pick, re-poll every N ticks.

### INFO
- No new input surfaces, no network, no storage. Refactor is internal-shape only.

## 2026-04-24 05:40Z — Performance sweep #7

Net-new: 4th fighter (Purple, `main.ts:70`), `pickNearestEnemy` (`:239`), five `fighters[]` passes per frame (`:281,291,324,335,368`), `fighters.find` in hit path (`:341`), `nameForId` linear scan (`:235`).

### HIGH
- **main.ts:239-250** — `pickNearestEnemy` per-bot per-frame = O(N²). 4p=12 checks (~0.8 µs); 8p=56 (~4 µs); 16p=240 (~17 µs). Fine today, first quadratic in hot path. Fix: per-tick pair-distance matrix, share across AI + splash + collision.

### MEDIUM
- **main.ts:341** — `fighters.find(x=>x.id===target)` inside damage-resolve loop per bullet-hit. Add `fightersById: Map<number,Fighter>` built at roster change; O(1).
- **main.ts:235** — `nameForId` same linear scan from 3 pushKill sites; same Map fixes it.
- **main.ts:281,291,324,335,368** — five separate fighter passes per frame. Fuse to one sim + one render pass; 4p×5=20 iters → 8.

### LOW
- **main.ts:334** — `hitboxes[]` re-alloc per frame (#4 carryover, now 4-elem); module-scope + `length=0`.
- **main.ts:328,352** — 4× `cos/sin*speed*PXPS` for explosion velocity; #2-#4 carryover, worse at 4p.

### Frame budget (4p, ~60 bullets, bg+sprites, audio, HUD, tracers, splash)
Sim ~110 µs (+25 for +1 fighter + O(N²) targeting), draw ~540 (+70 for 4th plane/HP/tracer/splash scale), audio ~35. Total ~685 µs = 4.1% of 16.67 ms. Comfortable; fix O(N²) before 8p. **Top 3:** fightersById Map, fuse loops, pair-distance cache. SLOs unchanged.

## 2026-04-24 05:40Z — Architecture sweep #7

Scope: `42c1704..6143d61` — `fighters[]` landed (de4c12c), bot3 purple (aa14b8d), nearest-enemy targeting (6143d61), vfx seed wired (7faea80).

**Regression tracker**
- WIN — P0 #1 `Fighter` entity CLOSED. `main.ts:51-76` iterates `fighters[]`; all 4 planes share one code path. Splash/crash/hits/draw loops now single passes (`main.ts:281-372`). Copy-paste tax on bot3 = one array entry. `pickNearestEnemy` (`main.ts:239`) retires "bots target player" LOW (#1). Killer `nameForId` (`main.ts:234`) dissolves sweep #5's stringly-typed HIGH — feed labels flow from `Fighter.name`. Best structural delta to date.
- WIN — vfx seed wired at boot (`main.ts:49`), closing #6 MEDIUM.
- BLOCKER — projectile pool singleton UNCHANGED (`projectiles.ts:47-48`). Sole remaining BLOCKER; all rollback work blocks on it. Next.
- UNRESOLVED — sim/render fused (`main.ts:12-14`), variable dt (`:276`), bg/sfx/vfx module singletons, HUD inlined, bullet→killer attribution (`main.ts:344` TODO).

**Status:** 1 BLOCKER + 4 HIGHs (was 2+6). Debt trajectory finally inverted. Ship projectile-world next, then fixed-step — netcode unblocks.
