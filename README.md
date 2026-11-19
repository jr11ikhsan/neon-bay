# NEON BAY

A 3D low-poly crime story on a neon tropical beach at dusk, built for the
make.fun "Make GTA 6" contest (gta6-01). Steal the gold coupe, run the
package, shut down the beach dealers, take the bank — and lose the heat.

## Run it

```
node serve.ts          # serves game/ at http://localhost:8080
```

Then open the page, click or press Enter, and play. Fully offline: no CDN,
no network calls, no build step.

Controls: WASD / arrows move and drive · mouse aims · click punches or
shoots · E enters and exits cars · Shift runs · P / Esc pauses · M mutes ·
C continues a saved game from the title screen.

## Layout

- `game/index.html` — page with the stacked WebGL + HUD canvases
- `game/src/` — the game itself, hand-written for this contest:
  - `world.js` — the simulation (traffic, pedestrians, police and the
    five-star wanted system, combat, the four-mission story, saves)
  - `render.js` — the Three.js scene (procedural low-poly city, beach and
    ocean, dusk-to-night light) plus the 2D HUD / minimap overlay
  - `city.js`, `config.js`, `random.js` — the procedural city layout, tuning
    constants and the seeded RNG
  - `missions.js`, `input.js`, `audio.js` — story data, controls, and the
    procedural WebAudio soundscape
  - `shots.js`, `main.js` — deterministic screenshot scenes and the boot /
    game loop
- `game/lib/three.min.js` — **third-party dependency**: Three.js r160
  (https://threejs.org), MIT License, © 2010–2023 three.js authors. It is a
  library we build on, not our own work; its license ships alongside it in
  `game/lib/THREE-LICENSE.txt`. It is vendored into the repo so the game
  runs completely offline.
- `vendor/makefun-game.ts` — the contest kit's dossier builder (unmodified)
- `main.ts` — builds the submission dossier into the output directory
- `screenshots/` — real captures from the running game
