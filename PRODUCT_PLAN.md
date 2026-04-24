# Triplane Turmoil — Web Remake (multiplayer)

## 0) Current Execution Status
*Last updated: 2026-04-24 02:14Z by tinyclaw (PM-loop kickoff). Repo: <https://github.com/VoX/triplane-turmoil-web>. Ref source: <https://github.com/sergiou87/triplane-turmoil> (C++/SDL2).*

### Vision
Browser-playable remake of Triplane Turmoil's **multiplayer dogfight** mode — up to 4 players on one screen (keyboard split) + network multiplayer as the stretch. Pixel-art sprites via pixellab. Deploy target: `claw.bitvox.me/triplane/` (static + WebSocket relay for netplay).

### Stack
- Vite + TypeScript + Canvas2D (pixelated scaling)
- Netcode: WebSockets (authoritative server on claw.bitvox.me), lockstep with client-side prediction for plane physics
- Sprites: pixellab MCP (`mcp__pixellab__generate_image_pixflux`)

### Current milestone
**M0 — Bootstrap + single-plane physics sketch (turn 1/N).** Repo scaffolded, placeholder plane with throttle + rotation physics + simple gravity. Local run via `npm run dev`.

### Shipped
| Turn | Commit | What |
|------|--------|------|
| 1 | (pending) | repo scaffold, vite+ts, single-plane placeholder with throttle/rotate physics |

### Reference mechanics (from sergiou87/triplane-turmoil src/world/)
- `constants.h`: MG shot speed 4000, gravity 400, rate 3; bomb gravity 2000, max 25 bombs. AA MG 4800.
- `plane.cpp/.h`: plane physics — pitch/roll via keys, thrust, lift, stall conditions.
- `terrain.cpp/.h`: side-scrolling map w/ terrain collision.
- `fobjects.cpp/.h`: flying objects (bombs, shots, smoke, explosions, parts).
- `tripmis.cpp`: mission/dogfight logic.
- 4 players max, keyboard or gamepad.

### Backlog (priority-ordered)
1. **M1 — proper plane physics** — port lift/stall/thrust/turn model from `plane.cpp`. Replace placeholder integration.
2. **M1 — terrain** — ground collision + scrolling map. Start with flat+hills.
3. **M1 — guns** — MG shots (forward-facing, gravity-affected), max 500 per side.
4. **M1 — bombs** — drop physics, explosion frames.
5. **M2 — sprites** — pixellab gen for plane body, wings, propeller, explosions, terrain tiles. Replace rect placeholders.
6. **M2 — 2-player local** — split keyboard (WASD + arrows), second plane instance.
7. **M3 — multiplayer netcode** — WebSocket relay, authoritative sim on server, prediction on client.
8. **M3 — 4-player local** — gamepad support.
9. **M3 — deployment** — Caddy route for `claw.bitvox.me/triplane/`.
10. **M4 — polish** — sound (howler.js), HUD, scoreboard, game modes (dogfight, bomber, capture-the-flag).

### Ritual
Before merging ANY PR touching `src/`: 2 `/simplify` agents + 2 `/review` agents in parallel (4-agent ritual). Pure-docs PRs ≤ 50 lines merge without ritual.

### Risks / open questions
- Plane physics tuning — the feel of Triplane is specific (momentum, stall on low throttle, dive-for-speed). Port numbers directly from `plane.cpp` initially; tune only if off-feel on playtest.
- Netcode complexity — lockstep is simplest for a deterministic sim but client-side prediction needed for latency. Decide at M3.
- Asset generation cost — pixellab charges per gen. Cache everything.
