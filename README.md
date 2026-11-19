[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/jr11ikhsan/neon-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/jr11ikhsan/neon-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# NEON BAY

An original 3D open-world crime story for the make.fun **Make GTA 6** bounty (gta6-01),
built from scratch in a recorded session — a neon tropical shore city at dusk, rendered
with Three.js (vendored locally; the game runs fully offline from static files).

## The game

You arrive in Neon Bay with nothing. Six chained story missions — steal the gold coupe,
run the package, shut down the beach dealers, crack the bank vault twice, deliver the
cyan racer, and meet the buyer as a Bay Legend — pay out exactly **$6,200** and take you
through every system in the city:

- **A living city** — a procedural 4800×3600 coastal city: six avenues, five streets,
  lane traffic with signals, parked and stealable cars, wandering pedestrians, palms,
  lamps, a beach and animated water.
- **Wanted system** — heat and five stars; police cars pace and encircle you with flank
  slots, officers bail out to make the arrest at two stars and open fire at three,
  units search your last seen position and stand down when the trail goes cold.
- **Three buyable guns** — pistol (semi-auto, earned in mission 1), SMG (full-auto),
  shotgun (six pellets), plus fists; weapon switching on 1–4 / Q, mouse aim, tracers.
- **Eight working places** — clinic (heal), police station (bribe the desk sergeant),
  Hotel Lumina (rest + save), Market Sol (weapons and snacks), Bay Motors (buy your own
  car), Taller Sol (repairs), Casa Segura safehouse (save + lie low), and the bank,
  whose side vault can be cracked again and again in free roam.
- **Dusk to night** — a full day cycle starting at 17:35; nights stay bright and
  readable under moonlight and strong neon emission.
- **Presentation** — third-person camera with speed FOV and shake, HUD with cash,
  health, stars and clock, a live minimap with place icons and police blips, title,
  pause (with run statistics), busted and wasted screens, a STORY COMPLETE ribbon,
  and local save / continue.

## Play

```sh
node serve.ts        # or any static server over game/
```

Open the page in a desktop browser. **Enter** starts, **WASD** drives and walks,
**mouse** aims, **click** shoots, **E** enters and uses, **Shift** runs,
**1–4 / Q** switch weapons, **P** pauses, **S** saves from the pause screen,
**C** continues a save from the title, **M** mutes.

## Layout

- `main.ts` — the hand-in program: copies `game/` and `screenshots/` out and writes
  the dossier, then prints a measured summary of what went in.
- `game/index.html` — the playable page (two stacked canvases, zero network requests).
- `game/src/` — the game itself: `config`, `random`, `city`, `missions`, `world`
  (simulation), `input`, `audio` (procedural WebAudio), `render` (Three.js + HUD),
  `shots` (deterministic screenshot staging), `main` (boot and loop).
- `game/vendor/three.module.min.js` — Three.js r160, a dependency under its own MIT
  license (`THREE-LICENSE.txt`), not entry code.
- `screenshots/` — four real captures from the staged scenes.

Everything in the entry — code, city, art direction, sounds — is original; no
third-party game assets are used.
