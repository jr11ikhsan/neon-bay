// NEON BAY — make.fun "Make GTA 6" (gta6-01) entry, v5.
// A 3D open-world crime story in a neon tropical bay city, written on
// Three.js: six story missions paying exactly $6,200 in total, a working
// place economy (clinic, bribe desk, hotel, market, car lot, garage,
// hideout, bank vault), a five-star wanted system with pursuing police
// cars and arresting officers, four weapons, a full day/night cycle,
// minimap HUD, and localStorage saves.
//
// Dossier builder (kit plumbing): copies game/ and screenshots/ into
// MAKEFUN_OUTPUT_DIR (default /output), then writes dossier.json with
// the buildDossier() helper from ./vendor/makefun-game.ts.
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDossier } from "./vendor/makefun-game.ts";

const root = new URL(".", import.meta.url).pathname;
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const shotsDir = join(root, "screenshots");
const shotNames = (await readdir(shotsDir)).filter((f) => f.endsWith(".jpg")).sort();

await mkdir(outDir, { recursive: true });
await cp(join(root, "game"), join(outDir, "game"), { recursive: true });
await cp(shotsDir, join(outDir, "screenshots"), { recursive: true });

const dossier = await buildDossier({
  rootDir: root,
  gameDir: "game",
  screenshots: shotNames.map((name) => join("screenshots", name)),
  caps: {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  },
});
await writeFile(join(outDir, "dossier.json"), dossier);

async function walk(dir, prefix, acc) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, `${prefix}${entry.name}/`, acc);
    else {
      const info = await stat(path);
      acc.push({ path: `${prefix}${entry.name}`, bytes: info.size });
    }
  }
  return acc;
}
const gameFiles = await walk(join(outDir, "game"), "game/", []);
const textBytes = gameFiles
  .filter((f) => /\.(js|html|json|md|ts|txt)$/.test(f.path))
  .reduce((sum, f) => sum + f.bytes, 0);
console.log(`NEON BAY v5 dossier: ${gameFiles.length} game files, text ${textBytes} bytes, ${shotNames.length} screenshots (${shotNames.join(", ")}), dossier ${dossier.byteLength} bytes.`);
for (const name of shotNames) {
  const info = await stat(join(shotsDir, name));
  console.log(`  ${name}: ${info.size} bytes`);
}
