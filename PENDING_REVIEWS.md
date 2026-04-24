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
