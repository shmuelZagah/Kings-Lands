import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
}
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: globalThis.localStorage };
if (typeof globalThis.document === 'undefined') {
  const noop = () => {}; const ctx2d = new Proxy({}, { get: () => noop });
  globalThis.document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => ctx2d }) };
}

import { dataRegistry } from '../../src/data/dataRegistry.js';
import { applySimSnapshot, appliedSimSnapshotHash, buildSimSnapshot, stableHash } from '../../src/sim/simConfig.js';
import { defaultUnitStats } from '../../src/data/defaults.js';
import { GameState } from '../../src/sim/gameState.js';

const engineConfig = JSON.parse(fs.readFileSync(new URL('../../src/data/shared/engineConfig.json', import.meta.url), 'utf8'));
const reset = () => { globalThis.localStorage.clear(); dataRegistry.resetToDefaults(); };

function runMatch(snapshot, ticks = 300) {
  const gs = new GameState({ ...engineConfig, simSnapshot: snapshot });
  const hashes = [];
  for (let i = 1; i <= ticks; i++) {
    gs.stepTick([]);
    if (i % 50 === 0) hashes.push(gs.computeStateHash() | 0);
  }
  return hashes;
}

test('snapshot is plain, frozen, versioned and its hash ignores key order', () => {
  reset();
  const snap = dataRegistry.getSimSnapshot();
  assert.equal(snap.schema, 1);
  assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.unitStats.units));
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(snap))), JSON.stringify(snap), 'survives structured clone / postMessage as plain data');
  assert.equal(dataRegistry.getSimSnapshot(), snap, 'cached while the registry version does not change');
  assert.equal(stableHash({ a: 1, b: { c: 2, d: 3 } }), stableHash({ b: { d: 3, c: 2 }, a: 1 }));
  assert.throws(() => applySimSnapshot({ schema: 99 }), /not a sim snapshot/);
  assert.throws(() => { snap.unitStats.units.swordsman.hp = 1; });
});

test('determinism: the same snapshot gives the same match (state hash every 50 ticks)', () => {
  reset();
  const snap = dataRegistry.getSimSnapshot();
  const a = runMatch(snap);
  const b = runMatch(JSON.parse(JSON.stringify(snap)));   // as if it came through postMessage into a worker
  assert.deepEqual(a, b);
  assert.equal(a.length, 6);
});

test('a lab edit reaches the next match, and the snapshot of the running match does not change', () => {
  reset();
  const before = dataRegistry.getSimSnapshot();
  const hpBefore = before.unitStats.units.swordsman.hp;
  const hashBefore = before.hash;
  const copy = dataRegistry.getUnitStats();
  copy.units.swordsman.hp = hpBefore + 111;
  assert.ok(dataRegistry.saveUnitStats(copy).ok);

  assert.equal(before.unitStats.units.swordsman.hp, hpBefore, 'the old snapshot is immutable');
  const after = dataRegistry.getSimSnapshot();
  assert.notEqual(after.hash, hashBefore);
  assert.equal(after.unitStats.units.swordsman.hp, hpBefore + 111);

  new GameState({ ...engineConfig, simSnapshot: after });   // a NEW match applies it
  assert.equal(appliedSimSnapshotHash(), after.hash);
  assert.equal(defaultUnitStats.units.swordsman.hp, hpBefore + 111, 'sim modules read the edited value');
  const house = dataRegistry.getBuilding('house');
  house.maxHp = 4321;
  assert.ok(dataRegistry.saveBuilding('house', house).ok);
  const withHouse = dataRegistry.getSimSnapshot();
  const houseHpIn = (snap) => new GameState({ ...engineConfig, simSnapshot: snap }).constructionSystem.buildingDefs.house.maxHp;
  assert.equal(houseHpIn(withHouse), 4321, 'a building edit reaches the new match through the snapshot');
  assert.notEqual(houseHpIn(before), 4321, 'a match started from the older snapshot does not see it');
});

test('applying the same snapshot twice is a no-op, and the registry data was not touched by the sim', () => {
  reset();
  const snap = dataRegistry.getSimSnapshot();
  const h1 = applySimSnapshot(snap);
  assert.equal(applySimSnapshot(snap), h1);
  const reg = dataRegistry.getUnitStats();
  assert.equal(reg.units.swordsman.hp, snap.unitStats.units.swordsman.hp);
  assert.equal(buildSimSnapshot({ unitStats: reg, buildings: dataRegistry.getBuildings(), unitsVisuals: dataRegistry.getUnitsVisuals(), heroes: dataRegistry.getHeroesData() }, 0).hash, snap.hash, 'same data -> same hash, whatever the version number');
});
