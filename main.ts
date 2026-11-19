// NEON BAY — the hand-in program for the make.fun "Make GTA 6" contest
// (gta6-01). The game itself is this directory's game/ folder: plain static
// files a desktop browser loads fully offline (game/index.html and its ES
// modules; three.js is vendored under game/vendor/ as a dependency, not
// authored code). This program copies game/ and screenshots/ from beside
// this file to the output directory and writes dossier.json, the summary
// the judge reads, using the vendored make.fun library.
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files in all, or a path under game/ over 1000 bytes).
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

console.log('NEON BAY handed in: dossier written to ' + join(out, 'dossier.json'));

// Measured hand-in summary, read back from what was actually written to
// the output directory (not from constants): the judge's caps are only
// meaningful against the real bytes on disk.
function measure(dir) {
  let files = 0, bytes = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { const sub = measure(p); files += sub.files; bytes += sub.bytes; }
    else { files++; bytes += st.size; }
  }
  return { files, bytes };
}
const gameStats = measure(join(out, 'game'));
const shotsDir = join(out, 'screenshots');
const shotNames = existsSync(shotsDir) ? readdirSync(shotsDir).filter(n => n.endsWith('.jpg')).sort() : [];
const dossierBytes = statSync(join(out, 'dossier.json')).size;
console.log('— hand-in summary (measured from disk) —');
console.log('game/: ' + gameStats.files + ' files, ' + gameStats.bytes + ' bytes (caps: 993 files, 50331648 bytes)');
for (const n of shotNames) console.log('screenshots/' + n + ': ' + statSync(join(shotsDir, n)).size + ' bytes (cap: 262144)');
console.log('screenshots: ' + shotNames.length + ' (cap: 4)');
console.log('dossier.json: ' + dossierBytes + ' bytes (text cap: 163840)');
const overCap = gameStats.files > 993 || gameStats.bytes > 50331648 || shotNames.length > 4 ||
  shotNames.some(n => statSync(join(shotsDir, n)).size > 262144) || dossierBytes > 163840;
console.log(overCap ? 'WARNING: a hand-in cap is exceeded — do not submit this build.' : 'all hand-in caps satisfied.');
