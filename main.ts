// Entry point for "Bahia Marisol" (Node 22, standard library only).
//
// The game itself is game/: plain static files with no build step, opened at game/index.html in a
// desktop browser and played with no network request. This program hands the entry in: it copies
// game/ and screenshots/ beside this file into the output directory and writes dossier.json with the
// vendored make.fun library, which is what the judge reads.
//
//   /output  (or $MAKEFUN_OUTPUT_DIR off the grader) receives game/, screenshots/, dossier.json

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The grader's own caps. They sit beside the copy so an oversized entry fails here, where the reason
// is readable, rather than as a 0 from the sealed scorer.
const LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
}

function countFiles(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    n += statSync(full).isDirectory() ? countFiles(full) : 1;
  }
  return n;
}

function main() {
  mkdirSync(output, { recursive: true });
  copyDir(join(root, 'game'), join(output, 'game'));
  copyDir(join(root, 'screenshots'), join(output, 'screenshots'));

  const shots = existsSync(join(output, 'screenshots'))
    ? readdirSync(join(output, 'screenshots')).filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith('.'))
    : [];
  if (shots.length < 3 || shots.length > LIMITS.screenshots.max) {
    throw new Error(`screenshots/ must hold 3 or 4 images, found ${shots.length}`);
  }

  const dossier = buildDossier(output, LIMITS);
  writeFileSync(join(output, 'dossier.json'), dossier);

  const report = {
    game: countFiles(join(output, 'game')),
    screenshots: shots.length,
    dossier_bytes: Buffer.byteLength(dossier),
  };
  console.log(`wrote ${output}: ${report.game} game files, ${report.screenshots} screenshots, dossier ${report.dossier_bytes} B`);
}

main();
