// Reads the shipped game data for tests (the monolithic JSON files no longer exist; the data lives in src/data/{races,bases,shared}).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleBundle } from '../../src/data/dataLayout.js';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/data');
let cached = null;
function readDisk() {
  const files = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.json')) files[path.relative(dataDir, f).split(path.sep).join('/')] = JSON.parse(fs.readFileSync(f, 'utf8')); } };
  for (const dir of ['races', 'bases', 'shared']) walk(path.join(dataDir, dir));
  return files;
}
/** Fresh deep copy each call (tests mutate what they read). */
export const readBundle = () => { cached = cached || assembleBundle(readDisk()); return JSON.parse(JSON.stringify(cached)); };
export const readEngineConfig = () => readBundle().engineConfig;
export const readUnitsJson = () => readBundle().unitsVisuals;
export const readHeroesJson = () => readBundle().heroes;
