# DON'T TOUCH THE FLOOR

*One jump away from game over.*

A prison-break arcade platformer for the browser. You are an escaped prisoner (striped jumpsuit, ball and chain included) climbing out of the prison: hop between steel beams, dodge sawblades, shock orbs and barbed wire, and stay above the rising **laser alarm floor** for as long as you can.

It's built with plain HTML5 Canvas, CSS and JavaScript. There are no dependencies and no build step. Single player needs no internet connection. **Multiplayer** lets friends race up the same tower by sharing a 5-character game code (needs internet).

## Run it

1. Download or clone this folder.
2. Double-click `index.html`, or open it with any modern browser (Chrome, Edge, Firefox or Safari).

That's all. If you'd rather serve it over HTTP (optional), run this from the folder:

```bash
npx serve .
```

## Project structure

```
Dont touch the ground/
├── index.html   # page structure: canvas, HUD, menu / pause / game-over overlays, touch buttons
├── style.css    # prison-theme UI styling, overlay transitions, responsive + touch layout
├── game.js      # all game logic and Canvas rendering (incl. multiplayer lobby & match logic)
├── net.js       # multiplayer networking (WebRTC via PeerJS, loaded on demand)
└── README.md
```

## Multiplayer

1. **Host:** open the game → **MULTIPLAYER** → type your name → **HOST GAME**. You get a 5-character code like `LBX7Q`.
2. **Friends:** open the game → **MULTIPLAYER** → type the code → **JOIN**. Up to 6 players can join.
3. The host presses **START MATCH**. After a 3-2-1 countdown everyone climbs the **same tower** (it's built from a shared random seed).
4. Other players appear as see-through ghosts with name tags. Arrows at the screen edges point to players above or below you, and a live scoreboard in the top-right corner shows everyone's score.
5. When you fall, you watch whoever is still climbing. Once everyone has fallen, the results screen ranks everyone by score. The host can start another round or go back to the lobby.

Rules and notes:

- Each player has their own alarm floor and their own vanishing/crumbling platforms, so nobody can break a platform under someone else.
- A match can't be paused. `P` / `Esc` opens a "Leave match?" panel while the game keeps running.
- If a player leaves, they're marked "left" in the results. If the host leaves, everyone goes back to the multiplayer screen.
- **Everyone needs the game files.** The easiest way is to put the game online, for example on GitHub Pages (Settings → Pages → deploy from `main`). When the game is served over `https`, **COPY CODE** copies a ready-made invite link (`...?join=CODE`).

How it works: players connect directly to each other with WebRTC data channels, using the [PeerJS](https://peerjs.com) library. PeerJS's free public server only introduces players to each other; the host's game code is part of their PeerJS id. Everyone connects to the host, and the host relays position updates (15 per second) to the others. Each player runs their own physics, so controls feel instant even with lag.

## The jail cell and the escape

- **Lobby:** the main menu and the multiplayer lobby take place inside a jail cell: bricks, a barred window, a bunk bed, a steel toilet, tally marks and a swinging bulb, all behind the cell bars. Your prisoner paces around inside. In multiplayer, everyone in the lobby is in the same cell, each in their own jumpsuit colour and with a name tag.
- **Escape scene:** pressing **ESCAPE** (or **Enter**) plays a 5-second escape before the run starts:
  1. **Lockdown breach:** sirens, spinning red alarm lights, and the gate slides open.
  2. **Corridor run:** a pseudo-3D chase down the cell block, with the prisoners sprinting straight at the camera past barred cells, ceiling lamps and the guards' flashlights.
  3. **ESCAPED!** They burst out into daylight, and the game fades in.
- In single player, press **Space** or tap to skip it. **Play again** after a game over starts straight away.
- In multiplayer, the host presses **START ESCAPE**. Every player watches the same escape with all the prisoners, then gets the 3-2-1 countdown. It can't be skipped, so everyone starts together.
- The 3D is drawn on the normal canvas with a small perspective projection (`renderCorridor()` in `game.js`). No 3D library is used, so the game still works offline.

## Screen sizes

- **Laptops and monitors:** the game fills the whole screen. Wider screens get a wider prison (up to 1280 units across) split into 2–3 side-by-side towers, so there are several routes up. Every tower is always climbable.
- **Phones (portrait):** a 480-wide world with a taller view, and touch controls underneath.
- The world width is fixed when a run starts; resizing the window during a run just rescales the view.
- **Multiplayer:** everyone plays the same world width, the widest one that fits every player's screen. A laptop player in a match with a phone player gets a narrower world with dark bars at the sides.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | `A` / `D` or `←` / `→` | ◀ ▶ buttons (hold) |
| Jump (hold for higher) | `Space`, `W` or `↑` | ▲ button |
| Pause / resume | `P` or `Esc` | ❚❚ (top right) |
| Restart | `R` | Pause → Restart |
| Mute | `M` | ♪ (top right) |
| Start / play again | `Enter` or `Space` | ESCAPE button |

The left and right screen edges wrap around: walk off one side and you come back on the other.

## Gameplay

- **Score** = metres climbed (1 m = 10 px of height) **+5** for the first landing on each platform. Standing still or re-landing on the same platform earns nothing.
- **The floor** is a laser alarm grid. Touching it ends the run immediately ("Busted!"). It starts rising after 4 seconds and speeds up a little each stage, so you can't camp. It also stays at the bottom of the screen, so falling off the view means death.
- **Stages** (based on height):

| Stage | Height | New in this stage |
|---|---|---|
| 1 | 0 m | Normal platforms only (learning zone) |
| 2 | 120 m | Moving and bouncy platforms |
| 3 | 280 m | Moving saws and stationary spikes |
| 4 | 480 m | Vanishing platforms |
| 5 | 720 m | Crumbling platforms and electric orbs |
| 6+ | every +350 m | Bigger gaps, narrower platforms, faster hazards, faster-rising alarm floor |

| Platform | Look | Behaviour |
|---|---|---|
| Normal | cyan | Safe |
| Moving | purple with arrows | Slides left/right and carries you |
| Bouncy | green with spring | Launches you much higher |
| Vanishing | dashed white | Blinks, then disappears 0.85 s after landing |
| Crumbling | amber, cracked | Shakes, then breaks 0.5 s after landing |

## How `game.js` is organised

The file is split into numbered sections. Key functions:

| Function | What it does |
|---|---|
| `frame()` | `requestAnimationFrame` loop. Runs physics at a fixed 120 Hz step with an accumulator, so it plays the same on 60/120/144 Hz screens. Then renders. |
| `step()` | Dispatches one physics step based on the current state. |
| `stepPlaying()` | One gameplay tick: platforms → hazards → alarm floor → player → collisions → camera → score → generation → cleanup → particles. |
| `updatePlayer()` | Acceleration/friction, screen wrap, jump with coyote time and input buffering, variable jump height, gravity, one-way platform landing. |
| `landOn()` | Landing feedback plus platform effects (bounce, start crumbling or vanishing, +5 bonus). |
| `checkHazards()` / `checkLava()` | Real hitbox collisions (circle vs. rectangle for saws and orbs, rectangle vs. rectangle for spikes, feet vs. the alarm floor surface). |
| `addPlatform()` | Procedural generator. Picks type and gap from the stage, and keeps every platform within a reachable jump. Never places two unstable platforms in a row. Puts moving hazards on the side away from the route. |
| `updateCamera()` | Smooth, upward-only camera that keeps the player in the lower-middle of the screen. |
| `updateScore()` | Height-based score, stage changes, new-record celebration. |
| `resetRun()` | Rebuilds every piece of run state for a completely fresh game. |
| `setState()`, `startGame()`, `togglePause()`, `endRun()`, `goToMenu()` | Game-state machine: menu / playing / paused / gameover. |
| `render()` and `draw*()` | All Canvas drawing (no image files). |
| `Sound` | Procedural Web Audio effects, created only after the first user input. |
| `resize()` | Fits the 480×720 world to the window, using `devicePixelRatio` for sharp graphics. Game logic always uses world units, so resizing never affects collisions. |

**Tweaking:** the `PHYS` object at the top controls feel (gravity, jump, speed). `STAGE_AT` controls when difficulty ramps up.

## Features

- Full platformer physics: acceleration and friction, limited air control, variable jump height, coyote time, jump buffering, no midair double jumps.
- Five platform types, three hazard types (saws, orbs, spikes) and a rising laser alarm floor.
- Procedural, always-reachable level generation with gradual, height-based difficulty.
- Prison look drawn entirely in code: concrete brick wall, barred windows, sweeping searchlights, a mugshot height chart, and a prisoner whose ball and chain drags along behind. Smooth vertical camera with parallax.
- Particles for jump dust, landing rings, debris, embers and confetti. Camera shake and flash on death. Squash and stretch on the character.
- HUD with score bump animation, best score, stage, height and time. Stage announcements and a "new record" celebration.
- Main menu with an animated demo scene, plus pause, game-over and restart screens.
- Best score and mute setting saved in LocalStorage. The best score is only written when you beat it.
- Procedural sound effects with a mute toggle.
- Responsive layout. On-screen touch controls on phones and tablets, placed below the game when there's room.
- Auto-pause when the tab is hidden or the window loses focus, with no physics jump on return.

## Known limitations

- The game uses a fixed 2:3 portrait play area. Very wide screens show empty space on the sides.
- Some mobile browsers (iOS Safari) only start audio after the first tap. That's a browser rule, and the game works normally without sound.
- When opened from `file://`, Safari keeps a separate saved best score for each file location.
- There are no online leaderboards, by design (no backend).
- Multiplayer depends on PeerJS's free public server to connect players. If it's down, hosting or joining fails with a clear message, and single player is unaffected.
- On some very strict networks (some corporate or school Wi-Fi), direct WebRTC connections can fail. Switching networks (e.g. a phone hotspot) usually fixes it.
- Ghost positions are smoothed, so other players appear about 0.1 s behind where they really are. Moving platforms can look slightly out of sync for ghosts. This is cosmetic only; each player's own game is exact.
- If the host's tab is hidden, their own climber freezes, but relaying still works for everyone else.
