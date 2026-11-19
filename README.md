[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/jr11ikhsan/neon-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/jr11ikhsan/neon-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# NEON BAY

A 3D open-world crime story in a neon tropical bay city, built with
Three.js. One night, six jobs, exactly **$6,200** in story pay — if the
Comisaria doesn't take it first.

## The night

You start on foot at dusk with empty pockets. Sol at **Taller Sol** needs
a gold coupe moved; that first job pays $250 and leaves you a pistol.
From there the night escalates: a warm package for **Mercado Sol**, three
dealers selling on your sand at the beach, the **Banco del Sol** vault
(twice — the second time for the legend money), and a buyer waiting at
the pier as the city glitters.

## The city that pushes back

- **Eight working places** — clinic ($40 heal), Comisaria ($150 bribe
  wipes your heat), Hotel Lumina ($60 rest-and-save), Mercado Sol (SMG
  $600, shotgun $900, snacks $15), Bay Motors (a car of your own, $800),
  Taller Sol ($50 repairs), Casa Segura (lie low, heat −200, save), and
  the bank's side vault (+$700 for three brave seconds, on a cooldown).
- **A five-star wanted system** — patrol cars hunt in flanking pairs,
  officers deploy on foot, arrest at two stars or less and shoot at
  three or more. Break line of sight, or disappear into Casa Segura,
  and the heat bleeds away.
- **Four weapons** — fists, pistol, SMG, shotgun — with semi/auto fire
  discipline, tracers, and dealers who shoot back.
- **A living bay** — lane-disciplined traffic, wandering crowds, a full
  day/night cycle (dawn, dusk and a bright neon night), palms, lamps,
  traffic lights, the boardwalk, the beach and the sea.
- **HUD + minimap**, objective banner with live distance, busted/wasted
  cards, pause-screen run stats, and localStorage saves (`C` continues).

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Walk, drive |
| Mouse | Aim |
| Mouse button (hold) | Shoot |
| E | Interact / enter / exit car |
| Shift | Sprint |
| 1–4 or Q | Fists / pistol / SMG / shotgun |
| P or Esc | Pause |
| S (in pause) | Save |
| C (title) | Continue |
| M | Sound on/off |
| R (in pause) | Restart the night |

## Tech

Vanilla ES modules, no build step. `game/src/` holds a deterministic
fixed-step simulation (`world.js` and friends — the same world runs
headless in tests) with a Three.js renderer and a 2D-canvas HUD on top.
Procedural WebAudio for engine, sirens and gunfire; procedural canvas
textures for facades, signs and the city ground. Saves are plain JSON in
localStorage.

## Screenshots

The four shots in `screenshots/` are deterministic scenes staged by
`game/src/shots.js` (`?shot=start|play|chase|end&seed=1`): the title at
dusk, a three-star drive at golden hour, the beach shootout at night,
and the story-complete kerb in front of Taller Sol.

MIT — see `LICENSE`.
