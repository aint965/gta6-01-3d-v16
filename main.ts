// main.ts — Palkon Auto entrypoint for the make.fun packager (Node 22,
// standard library only). It copies game/ and screenshots/ from beside this
// file into the output directory and writes /output/dossier.json with the
// vendored make.fun library, then prints the dossier hash and the
// screenshots it handed in so a packaging run can be checked byte-for-byte.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Wipe the output dir first: cpSync never deletes, so a stale screenshot (or
// a removed game file) from an earlier run would otherwise survive into the
// dossier and fail the caps — or silently ship a wrong entry.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes).
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossier);

// Verification output: the dossier hash (two runs must agree byte-for-byte)
// and the screenshots handed in, with sizes, so a packaging check can fail
// loudly instead of silently shipping a wrong dossier.
const hash = createHash('sha256').update(dossier).digest('hex');
const shots = readdirSync(join(out, 'screenshots'))
  .filter((f) => !f.startsWith('.'))
  .sort()
  .map((f) => `${f} (${statSync(join(out, 'screenshots', f)).size} bytes)`);
console.log(`dossier: ${dossier.length} bytes sha256 ${hash}`);
console.log(`screenshots: ${shots.length} — ${shots.join(', ')}`);
