[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/jr11ikhsan/neon-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/jr11ikhsan/neon-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# NEON BAY — a tropical crime story

An open-world action game in the browser, built with Three.js: a neon
bayside city at dusk that slides into a bright, readable night, a
six-mission story chain, wanted stars, and police that box you in,
deploy on foot, and — only from three stars — start shooting.

You are a nobody with a safehouse by the beach. Steal a gold coupe for
the garage, run a hot package to the market, shut down the beach
dealers, crack the bank vault, deliver a stolen racer to the hotel,
then empty the vault a second time and meet the buyer — six missions,
**$6,200** in story pay, and a city that stays alive after the credits:
the bank can be robbed again in free roam, cars can be bought and
repaired, and every door in town does something.

## The city

- A 4800 × 3600 tropical bay city: seven avenues, six streets, a
  plaza, a boardwalk, sand and water, palms and lamps, living traffic
  and pedestrians who cross at the corners and wait for a gap.
- **Eight working places**: Bay Motors (buy a car), Banco del Sol
  (channel the vault — and rob it again later), Clínica Sol (heal),
  Market Sol (snacks), Comisaría (bribe the sergeant), Hotel Lumina
  (a room to cool off), Taller Sol (repairs), and the Safehouse
  (lie low and save).
- A full day arc from golden dusk to a neon night that stays bright
  enough to read the street — windows light up, lamps glow, the moon
  takes over from the sun.

## Crime and police

- **Four weapons**: fists, a semi-auto pistol (one press, one shot),
  an auto SMG ($600), and a six-pellet shotgun ($900).
- **Wanted stars** from witnessed crime, with heat that decays faster
  when no one can see you. Police pace you with flank slots instead
  of ramming, back off rather than box-lock forever, and deploy
  officers on foot against a suspect who is on foot or truly boxed.
- **Fair busts**: arrest needs two stars and a grabbed suspect who is
  actually slow; shooting starts at three stars. Busted means a fine
  and the police door; wasted means the clinic bill.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrows | Walk and drive (screen-relative) |
| Mouse | Aim; click to shoot or punch |
| E | Interact: doors, cars, pickups |
| Shift | Sprint |
| 1–4 / Q | Switch weapon |
| P / Esc | Pause (save with S on the pause screen) |
| C | Continue a saved game from the title screen |
| M | Mute |

Saves live in `localStorage` — money, weapons, car, heat, mission
progress and statistics all round-trip.

## Running it

The game is fully offline: plain static files, no build step, no CDN.
Three.js (r160) is vendored under `game/vendor/` as a dependency.

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

Then open the page and press Enter. `main.ts` is the contest hand-in
program: it copies `game/` and `screenshots/` to the output directory,
writes `dossier.json`, and prints a measured summary of what was
handed in (file counts, byte counts, screenshot sizes, cap checks).

## Layout

- `game/src/config.js` — every tuning number in one place
- `game/src/random.js` — seeded RNG and math helpers
- `game/src/city.js` — the city grid, places, lots, spawn data
- `game/src/missions.js` — the six-mission story chain
- `game/src/world.js` — the whole simulation: traffic, peds, police,
  combat, economy, missions, saves
- `game/src/input.js` / `game/src/audio.js` — keys+mouse, synth audio
- `game/src/render.js` — Three.js renderer, HUD, minimap, screens
- `game/src/shots.js` / `game/src/main.js` — screenshot staging, shell
- `shots.json` — the four judged screenshots and their shot queries

MIT licensed (see `LICENSE`). Three.js is under its own MIT license,
included in `game/vendor/`.
