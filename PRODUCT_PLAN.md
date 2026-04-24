# Triplane Turmoil — Web Remake (multiplayer)

## 0) Current Execution Status
*Last updated: 2026-04-24 06:07Z by tinyclaw (planning sweep). Live: <https://claw.bitvox.me/triplane/>. Repo: <https://github.com/VoX/triplane-turmoil-web> @ main `b9c7f22`. Ref source: <https://github.com/sergiou87/triplane-turmoil> (C++/SDL2).*

### Vision
Browser-playable remake of Triplane Turmoil's **multiplayer dogfight** mode — up to 4 players on one screen (keyboard split) + network multiplayer as the stretch. Pixel-art sprites via pixellab. Deployed at `claw.bitvox.me/triplane/`.

### Top-Level Goals (per VoX)
1. **Fun, low-latency multiplayer.** Netcode that feels responsive — client-side prediction + server reconciliation. Sub-100ms perceived input lag.
2. **Fun against bots.** Single-player must be a real game on its own. Bots scale in difficulty, have distinct personalities, decent dogfight AI.
3. **Easy startup.** Visiting `claw.bitvox.me/triplane/` drops you into a bot match within 5 seconds — no signup, no lobby wait. Multiplayer is opt-in.

### Stack
- Vite + TypeScript + Canvas2D (pixelated scaling)
- Vitest for unit + e2e sim tests (5 passing)
- Netcode: WebSockets (authoritative server on claw.bitvox.me), authoritative-server + client-prediction + reconciliation — NOT YET BUILT
- Sprites: pixellab MCP
- SFX: seb's WebAudio synth (sfx.ts), no asset payload

### Current milestone
**M1 — Solo combat loop feels like Triplane.** 30+ commits tonight. 3 AI planes in air, real combat loop, VFX/SFX, deployed. Still have architectural debt (projectile-pool singleton, sim/render not split) and no netcode. Physics is a faithful port of plane.cpp.

### Shipped (compressed — see `git log` for detail)
| Area | Status |
|------|--------|
| repo scaffold + vite+ts | ✓ |
| physics port from plane.cpp (throttle/stall/lift/drag/gravity-tangential/turn-rate-falls-with-speed) | ✓ |
| projectiles (MG + bombs, pool, owner-ID) — seb | ✓ |
| bullet-vs-plane collision (circle hitbox) | ✓ |
| HP + respawn + score (combat.ts) | ✓ |
| bot AI v0→v2 (pursue + fire + break-turn-evade on damage) | ✓ |
| 2nd bot (green biplane) | ✓ |
| explosion particle VFX | ✓ |
| WebAudio sfx (MG/bomb/hit/explosion/engine) — seb | ✓ |
| landing BGM via lyria | ✓ |
| pixellab sprites: red/teal/green biplanes, bomb, cloud, hill, explosion | ✓ |
| sprite horizontal-flip when flying left (pilot stays upright) | ✓ |
| bombs explode on ground contact | ✓ |
| crash-on-ground above CRASH_SPEED | ✓ |
| parallax background (3-layer procedural) — seb | ✓ |
| cloud + hill sprite parallax overlays | ✓ |
| vitest + physics unit tests + AI-vs-AI e2e | ✓ |
| Caddy deploy @ claw.bitvox.me/triplane/ | ✓ |

### Open PRs
_none — all direct-to-main at sam's call_

### Backlog (priority-ordered, post-sweep 2026-04-24 04:15Z)

#### P0 — unblocks playable multiplayer demo
1. **`Fighter` entity abstraction + `fighters[]` array.** Current 3-plane config has 4 parallel bindings per fighter (plane, combatant, memory, sprite). Arch review #4 flags this as new HIGH — it's about to force copy-paste on every plane touch. Refactor before adding any 4th plane. `src/entity.ts` consolidates, `main.ts` iterates. Dissolves the bot1/bot2 sprawl.
2. **Projectile pool per-world instance.** `projectiles.ts` module-scope array is the BLOCKER for headless server + rollback. Change to `createWorld()` returning `{ bullets, bombs, fire, update, draw }`. Caller owns lifetime.
3. **Fixed-step simulation loop.** Physics is per-wall-clock-dt which diverges across clients. Accumulator that runs sim at fixed 60Hz steps with render interpolation. Needed before netcode.
4. **Seeded PRNG in vfx.ts.** `Math.random()` in particle spawns will drift between server/client. Use mulberry32 with world-seeded state. vfx → deterministic.
5. **Simple WebSocket relay.** Node.js server on `/triplane-ws/` via Caddy reverse-proxy. Each client broadcasts input; server authoritative sim runs fixed-step; clients predict + reconcile. First target: 2-player dogfight. ~4-6 hrs.

#### P1 — retain player attention (solo depth)
6. **Bot variety v2 — 3 personalities.** `pursuer` (current), `sniper` (keep distance, high altitude), `kamikaze` (dive attack, no evasion). Picked at spawn.
7. **Difficulty scaling.** FIRE_AIM_TOLERANCE + FIRE_RANGE + evade_latency configurable. Expose via `?difficulty=easy|normal|hard`.
8. **Bot-vs-bot combat.** Currently bots only target player. Change `thinkBot(bot, player, ...)` → `thinkBot(bot, enemies[], ...)` to pick nearest non-allied.
9. **Kill feed HUD.** "Red downed Green" pops at top-right for 2s on each kill.
10. **Off-screen enemy indicator.** Arrow at edge of screen pointing to nearest enemy when they're off-canvas. "Where'd they go?" solves.

#### P2 — polish + game modes
11. **Capture-the-flag mode.** Two team bases, flag object, carry-home scoring. Classic Triplane mode.
12. **Bomber mode.** One side defends ground targets, other side carries bombs. Asymmetric.
13. **Mobile touch controls.** Swipe pad for pitch, tap for fire. Opens mobile audience.
14. **Fullscreen canvas + responsive.** Currently hardcoded 640x400.
15. **Weather.** Wind that pushes planes, visible as particle drift. Tactical depth.
16. **Time-of-day.** Sunrise/sunset palettes swap per match. Cosmetic.

#### P3 — backlog / nice-to-haves
17. Modding API (JSON-defined plane stats).
18. Meta-progression (unlock new plane models after N wins).
19. Sound settings (bgm volume, sfx volume, mute).
20. Lose-stinger using the 60s minor variant.

### Recent brainstorms

**2026-04-24 10:07Z — steady-state hold (tinyclaw):**
- No ship activity since 98aded1 (~2hr). Review sweeps #13/14/15/16 all no-delta. Status stable at 1 BLOCKER + 7 HIGHs.
- Morning rounds fired at 10:00Z, all 🟢 (load 0.50, 6.2gi free, 36% disk, all endpoints 200, cert good).
- Next-session pickup plan: netcode prototype (WebSocket relay on `/triplane-ws/`) as turn-1 priority. Requires projectile-pool refactor first — batch those two commits.

**2026-04-24 08:07Z — steady-state (tinyclaw):**
- No ship activity since 966800f (~1hr idle). Review sweeps stable at 1 BLOCKER + 7 HIGHs. Game is feature-complete for solo FFA.
- Next cycle priorities when momentum returns: (1) projectile-pool `createWorld()` factory — closes the last BLOCKER + unblocks netcode, (2) `hud.ts` module extract (title/pause/killfeed/banner/offscreen as 5 functions sharing a game-time clock), (3) first WebSocket echo relay — simplest possible multiplayer prototype on `/triplane-ws/`.
- Content ideas queued: ground-target placeholders to bomb (ammo crates, fuel depots), plane hull variants (faster/heavier per ref plane.cpp's mass/power/manover), bot difficulty `?difficulty=easy|hard`.

**2026-04-24 06:07Z — post-fighters[] refactor + FFA chaos (tinyclaw):**
- Fighters[] refactor landed (de4c12c). Adding bot3 was 8 lines; adding bot4/N is same shape. Scales cleanly to netcode as `createFighter` can wrap server-authored state.
- 4-plane FFA is genuinely chaotic. Bots target nearest enemy (not hardcoded player) — bot-vs-bot crossfire is real combat, not just solo target practice.
- Collision now returns `HitRecord[]` with `{victimId, shooterId, damage}`. Correct kill attribution + multi-kill banners work in FFA.
- UX polish shipped: title screen with "press any key", ESC pause, HP bars per plane, kill feed, DOUBLE KILL / TRIPLE KILL / RAMPAGE banners, off-screen enemy indicators.
- Sound+music+wind+parallax — game has atmosphere now.
- 1 BLOCKER remaining: projectile pool module-singleton. Unavoidable when netcode lands; touches collision + bombs + projectiles + main.
- Netcode design reaffirmed: authoritative server + client prediction + reconciliation. Avoid rollback for now (4-player FFA doesn't need it).
- New idea set to try if/when momentum allows:
  1. **Spectator mode** — visit `claw.bitvox.me/triplane/?watch=<room>` to observe someone's bot match. Cheap, no netcode yet needed (snapshot replay).
  2. **Aim-assist lead indicator** — draw a tick at predicted enemy position when player is in fire range. Helps new players land hits.
  3. **Plane trails** — short translucent line behind each plane showing recent path. Looks sick + helps read dogfight.
  4. **Starvation respawn** — after 2 consecutive deaths, player gets a fuel/ammo powerup spawn to keep engagement.
  5. **Daily seed** — `?seed=today` reproducible bot AI + wind for a daily leaderboard fairness.

**2026-04-24 04:15Z — post-30-commit planning sweep (tinyclaw):**
- Netcode choice: **authoritative server + client prediction + reconciliation** is the right model. Lockstep is simplest but input-lag-sensitive in dogfights; rollback is overkill for 2-4 player dogfights at 60Hz. Go server-authoritative like Quake.
- Shipping before netcode: refactor fighters[] + projectile pool + fixed-step. Otherwise the sim-state-serialization surface keeps growing.
- Bot personality variety is cheapest way to keep solo interesting for 30+ min. Current bot is one-trick-pony.
- Mobile controls deferred — desktop-first until netcode lands, then mobile is a marketing play.

### Ritual
Sam called it — direct-to-main is fine for tinyclaw's atomic commits. Test + build before push is the bar. Seb still uses PRs per her note.

### Risks / open questions
- **Architectural debt stacking.** 4 review sweeps flagged 2 BLOCKERs + growing HIGHs. Combat extract addressed 1. Projectile-pool + fighters[] are next.
- **Fixed-step integration.** Physics tuned to per-wall-clock seconds; switching to fixed-step could change feel. Budget for a tuning pass.
- **Asset cost.** pixellab gen at $0 so far (free tier); if volume grows, switch to single atlas-pack.
- **Browser audio autoplay.** Currently works via first-gesture, but any regression in keydown/pointerdown handler path breaks bgm silently.
- **No visual regression testing.** Sprite swaps can subtly break; no screenshot diff yet. Playwright harness is the fix path.
