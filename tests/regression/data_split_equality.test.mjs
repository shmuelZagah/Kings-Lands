import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitBundle, assembleBundle, SHARED_FILES } from '../../src/data/dataLayout.js';
import { DATA_FILES } from '../../src/data/dataFiles.generated.js';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/data');
const R = (rel) => JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8'));

// Migration proof: while the old monolithic files still exist they are the reference (they were deleted from the
// game only after this passed). Without them the round-trip tests below still guard the layout.
const hasMono = fs.existsSync(path.join(dataDir, 'visuals/units.json'));
const mono = () => ({
  unitsVisuals: R('visuals/units.json'), unitStats: R('unitStats.json'), buildings: R('buildings.json'),
  buildingVisuals: R('buildingVisuals.json'), heroes: R('heroes.json'), engineConfig: R('engineConfig.json')
});

/** Equality incl. key order, with the path of the first difference (assert.deepStrictEqual runs out of memory on 8 MB of meshes). */
function firstDiff(a, b, p = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) return `${p}/${k} only in assembled`;
      if (!(k in b)) return `${p}/${k} missing in assembled`;
      const d = firstDiff(a[k], b[k], `${p}/${k}`);
      if (d) return d;
    }
    return `${p} key order`;
  }
  return `${p} value`;
}
const diffAll = (x, y) => Object.keys(x).map((k) => [k, firstDiff(x[k], y[k], k)]).filter(([, d]) => d);

function readDisk() {
  const files = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.json')) files[path.relative(dataDir, f).split(path.sep).join('/')] = JSON.parse(fs.readFileSync(f, 'utf8')); } };
  for (const dir of ['races', 'bases', 'shared']) walk(path.join(dataDir, dir));
  return files;
}

test('split -> assemble -> split is stable (incl. key order), so exporting/re-splitting a lab JSON never reorders data', () => {
  const once = assembleBundle(readDisk());
  const files = splitBundle(once);
  assert.deepEqual(diffAll(once, assembleBundle(JSON.parse(JSON.stringify(files)))), []);
  assert.deepEqual(diffAll(readDisk(), files), []);
});

test('migration proof: the per-race files assemble to exactly the old monolithic JSON', { skip: !hasMono && 'monolithic files already removed' }, () => {
  const m = mono();
  assert.deepEqual(diffAll(m, assembleBundle(JSON.parse(JSON.stringify(splitBundle(m))))), []);
  assert.deepEqual(diffAll(m, assembleBundle(readDisk())), []);
  assert.deepEqual(diffAll(m, assembleBundle(DATA_FILES)), []);
});

test('the generated index (what Vite/node load) contains exactly the files on disk', () => {
  assert.deepEqual(Object.keys(DATA_FILES).sort(), Object.keys(readDisk()).sort(), 'run: node scripts/data/build.mjs index');
});

test('layout rules: every race has an identity card that only references ids that exist; mirukenkay is a base, never a race', () => {
  const files = readDisk();
  const b = assembleBundle(files);
  const cards = Object.keys(files).filter((p) => /^races\/[^/]+\.json$/.test(p)).map((p) => files[p]);
  assert.ok(cards.length >= 5);
  assert.ok(!cards.some((c) => c.id === 'mirukenkay'), 'mirukenkay must not be a race');
  assert.ok(files['bases/mirukenkay_base_2.json'], 'mirukenkay bases are stored in bases/');
  for (const c of cards) {
    for (const id of c.bases) assert.ok(b.unitsVisuals.units[id], `${c.id}: base ${id}`);
    for (const id of c.units) assert.ok(b.unitsVisuals.units[id], `${c.id}: unit ${id}`);
    for (const id of c.gear) assert.ok(b.unitsVisuals.prefabs[id], `${c.id}: gear ${id}`);
    for (const id of c.heroes) assert.ok(b.heroes.heroes[id], `${c.id}: hero ${id}`);
  }
  assert.ok(files[SHARED_FILES.order]);
});
