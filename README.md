[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/jr11ikhsan/neon-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/jr11ikhsan/neon-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# NEON BAY

A 3D open-world crime story in a low-poly neon beach city at dusk, built with
Three.js. Steal the gold coupe, run packages, crack the Banco Neon vault, and
become a Bay Legend — while the whole Comisaria 9 tries to box you in.

**NEON BAY v2** is a ground-up rebuild: a brighter night (strong moonlight and
neon emission so the city glows after dark), smarter police that pace, flank
and back off to re-engage instead of gluing onto your bumper, and traffic
that brakes for pedestrians instead of flattening them.

## The game

- **Six chained story missions, $6,200 total** — steal a gold coupe, run a hot
  package, drop three beach dealers, crack the bank vault (twice), deliver a
  stolen racer, and meet the buyer at the pier under a five-star sky.
- **Three buyable guns** — pistol (precise, semi-auto), SMG (full auto),
  shotgun (six pellets), plus your fists. Dealers shoot back.
- **Cars you can steal and buy** — carjack anything that moves, or buy your
  own sedan at Bay Motors. Wrecked mission cars are replaced at the lot.
- **A wanted system with encirclement** — five stars, witnesses and line of
  sight, heat that decays only when nobody sees you, patrol cars that flank
  and foot officers who move in for the bust.
- **A full place economy** — Clinica Sol heals ($40), the police desk takes
  bribes ($150), Hotel Lumina rests and saves ($60), Market Sol sells snacks
  and guns, Taller Sol repairs ($50), the safehouse saves and burns heat, and
  the bank's side vault can be cracked again and again ($700, on a cooldown).
- **A living city** — 4800×3600 world: grid avenues, a boardwalk, palms,
  traffic with lanes and braking, wandering pedestrians, a dusk-to-night
  cycle from 17:35, HUD with minimap, title / pause / busted / wasted
  screens, and a localStorage save with Continue.

## Run it

The game is plain static files and runs fully offline — no build step, no
network. From this folder:

```
node serve.ts
```

then open <http://localhost:8080>. (Any static file server pointed at
`game/` works just as well.)

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Move / drive |
| Mouse | Aim (on foot) |
| Click / Space | Punch / shoot |
| E | Interact: enter/exit cars, use places |
| 1–4 / Q | Switch weapon (Q cycles owned) |
| Shift | Run |
| P / Esc | Pause (stats, save with S, restart with R) |
| M | Mute |
| Enter / C | Start / Continue on the title screen |

## Layout

- `game/` — the game itself: `index.html` plus ES modules in `game/src/`
  (simulation in `world.js`, city generation in `city.js`, rendering in
  `render.js`, missions as data in `missions.js`). It loads with no build
  step and no network.
- `game/vendor/three.module.min.js` — Three.js r160 (MIT, © the three.js
  authors; license in `game/vendor/THREE-LICENSE.txt`), vendored as a
  dependency so the game works offline. It is a library, not our work.
- `main.ts` — the contest hand-in: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json`.
- `vendor/makefun-game.ts` — the unmodified make.fun kit library used by
  `main.ts`.
- `shots.json` + `screenshots/` — the four deterministic scenes
  (`?shot=start|play|chase|end&seed=1`) used for the screenshots.
