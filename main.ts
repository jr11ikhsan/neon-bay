// NEON BAY — a make.fun "Make GTA 6" (gta6-01) entry, built with three.js vendored under game/.
// The game is this directory's game/ folder: plain static files a desktop browser loads fully
// offline (game/index.html and its ES modules; three.js r160 is vendored at game/vendor/ under
// its own MIT license, it is a dependency, not entry code). This program hands the entry in:
// it copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
//
// The game: an original 3D open-world crime story on a neon tropical shore at dusk — a
// procedural city you cross on foot and by car, lane traffic and pedestrians, stealable cars,
// a 5-star wanted system with encircling police, six chained story missions ($6,200), three
// buyable guns, eight working places (clinic, bribed desk sergeant, hotel, market, car lot,
// garage, safehouse, a re-robbable bank), a dusk-to-night cycle with bright readable nights,
// HUD + live minimap, title/pause/busted/wasted screens and local saves.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
