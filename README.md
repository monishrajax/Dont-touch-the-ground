# DON'T TOUCH THE FLOOR

*One jump away from game over.*

A neon arcade platformer for the browser. Climb floating platforms, dodge saws, orbs and spikes, and stay above the rising lava floor for as long as you can.

It's built with plain HTML5 Canvas, CSS and JavaScript. There are no dependencies, no build step, no server and no internet connection needed.

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
├── style.css    # neon UI styling, overlay transitions, responsive + touch layout
├── game.js      # all game logic and Canvas rendering
└── README.md
```

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move | `A` / `D` or `←` / `→` | ◀ ▶ buttons (hold) |
| Jump (hold for higher) | `Space`, `W` or `↑` | ▲ button |
| Pause / resume | `P` or `Esc` | ❚❚ (top right) |
| Restart | `R` | Pause → Restart |
| Mute | `M` | ♪ (top right) |
| Start / play again | `Enter` or `Space` | PLAY button |

The left and right screen edges wrap around: walk off one side and you come back on the other.

## Gameplay

- **Score** = metres climbed (1 m = 10 px of height) **+5** for the first landing on each platform. Standing still or re-landing on the same platform earns nothing.
- **The floor** is lava. Touching it ends the run immediately. It starts rising after 4 seconds and speeds up a little each stage, so you can't camp. It also stays at the bottom of the screen, so falling off the view means death.
- **Stages** (based on height):

| Stage | Height | New in this stage |
|---|---|---|
| 1 | 0 m | Normal platforms only (learning zone) |
| 2 | 120 m | Moving and bouncy platforms |
| 3 | 280 m | Moving saws and stationary spikes |
| 4 | 480 m | Vanishing platforms |
| 5 | 720 m | Crumbling platforms and electric orbs |
| 6+ | every +350 m | Bigger gaps, narrower platforms, faster hazards, faster lava |

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
| `stepPlaying()` | One gameplay tick: platforms → hazards → lava → player → collisions → camera → score → generation → cleanup → particles. |
| `updatePlayer()` | Acceleration/friction, screen wrap, jump with coyote time and input buffering, variable jump height, gravity, one-way platform landing. |
| `landOn()` | Landing feedback plus platform effects (bounce, start crumbling or vanishing, +5 bonus). |
| `checkHazards()` / `checkLava()` | Real hitbox collisions (circle vs. rectangle for saws and orbs, rectangle vs. rectangle for spikes, feet vs. lava surface). |
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
- Five platform types, three hazard types (saws, orbs, spikes) and a rising lava floor.
- Procedural, always-reachable level generation with gradual, height-based difficulty.
- Smooth vertical camera, parallax starfield, glowing neon visuals.
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
