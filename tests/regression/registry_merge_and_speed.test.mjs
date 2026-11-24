import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    localStorage: globalThis.localStorage
  };
}
if (typeof globalThis.document === 'undefined') {
  const noop = () => {};
  const ctx2d = new Proxy({}, { get: () => noop });
  globalThis.document = {
    addEventListener: noop,
    removeEventListener: noop,
    visibilityState: 'visible',
    createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => ctx2d })
  };
}

import { dataRegistry } from '../../src/data/dataRegistry.js';
import { modelProvider } from '../../src/render/modelProvider.js';

const MESH = { vertices: Array.from({ length: 40 }, (_, i) => [i, 0, 0]), faces: [[0, 1, 2]], colors: Array.from({ length: 40 }, () => [255, 0, 0]) };
const SKIN = { active: 'default', items: { red: { name: 'Red', fitRadius: 5, mesh: MESH } } };

function reset() {
  globalThis.localStorage.clear();
  dataRegistry.resetToDefaults();
}

test('a stale section copy cannot overwrite what another lab saved (three-way merge)', () => {
  reset();
  const stale = dataRegistry.getBuildings();               // a lab loads its working copy ...
  const staleStats = dataRegistry.getUnitStats();

  const house = dataRegistry.getBuilding('house');         // ... meanwhile another lab saves other things
  house.maxHp = 4321;
  assert.ok(dataRegistry.saveBuilding('house', house).ok);
  assert.ok(dataRegistry.setUnitActiveSkin('swordsman', 'almasir').ok);

  stale.buildings.barracks.maxHp = 7777;                   // the stale lab edits something else and saves everything back
  staleStats.units.archer.hp = 1234;
  assert.ok(dataRegistry.saveBuildings(stale).ok);
  assert.ok(dataRegistry.saveUnitStats(staleStats).ok);

  assert.equal(dataRegistry.getBuilding('barracks').maxHp, 7777, 'the stale copy keeps its own edit');
  assert.equal(dataRegistry.getBuilding('house').maxHp, 4321, 'but must not revert the other lab\'s building edit');
  assert.equal(dataRegistry.getUnitStats('archer').hp, 1234);
  assert.equal(dataRegistry.getUnitStats('swordsman').activeSkin, 'almasir', 'nor the other lab\'s unit skin');
});

test('building skin chosen in one place is what every other reader sees, even with stale lab copies around', () => {
  reset();
  const labCopy = dataRegistry.getBuildings();
  const studioCopy = dataRegistry.getUnitsVisuals();

  assert.ok(dataRegistry.saveBuildingSkin('barracks', SKIN).ok);
  assert.ok(dataRegistry.setActiveBuildingSkin('barracks', 'red').ok);

  labCopy.buildings.barracks.name = 'Barracks!';
  studioCopy.units.swordsman.displayName = 'Sword!';
  assert.ok(dataRegistry.saveBuildings(labCopy).ok);
  assert.ok(dataRegistry.saveUnitsVisuals(studioCopy).ok);

  assert.equal(dataRegistry.getBuildingSkin('barracks').active, 'red');
  assert.equal(modelProvider.getBuildingModelFactory().getActiveSkin('barracks')?.id, 'red');
});

test('saving identical data is a no-op (no write, no version bump, no event)', () => {
  reset();
  const v0 = dataRegistry.getVersion();
  let events = 0;
  const off = dataRegistry.subscribe(() => { events++; });
  const copy = dataRegistry.getBuildings();
  const res = dataRegistry.saveBuildings(copy);
  assert.ok(res.ok && res.unchanged);
  assert.equal(dataRegistry.getVersion(), v0);
  assert.equal(events, 0);
  off();
});

test('events carry the changed keys; skin-only changes do not rebuild the unit visuals', () => {
  reset();
  const before = modelProvider.getCombinedVisuals();
  let evt = null;
  const off = dataRegistry.subscribe((e) => { evt = e; });
  assert.ok(dataRegistry.saveBuildingSkin('barracks', SKIN).ok);
  off();
  assert.ok(evt.changed.includes('buildingSkins') && evt.changed.includes('skin:barracks'));
  assert.ok(!evt.changed.some((k) => k.startsWith('unit:')));
  assert.equal(modelProvider.getCombinedVisuals(), before, 'unit visuals were not rebuilt for a skin change');
  assert.equal(evt.snapshot.v, 1, 'snapshot is available lazily');
});

test('a full localStorage keeps the edit in memory and reports it (never silently loses the skin)', () => {
  reset();
  const realSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  try {
    const res = dataRegistry.saveBuildingSkin('barracks', SKIN);
    assert.ok(res.ok, 'edit is accepted');
    assert.equal(res.persisted, false);
    assert.match(res.warning, /Not saved to browser storage/);
    assert.equal(dataRegistry.getBuildingSkin('barracks').items.red.name, 'Red');
    assert.equal(dataRegistry.getPersistStatus().ok, false);
  } finally {
    globalThis.localStorage.setItem = realSet;
  }
  assert.ok(dataRegistry.saveBuildingSkin('barracks', { ...SKIN, active: 'red' }).persisted);
  assert.equal(dataRegistry.getPersistStatus().ok, true);
});

test('leftover legacy keys are dropped to make room when the quota is hit', () => {
  reset();
  const st = globalThis.localStorage;
  st.setItem('kings_lands_studio_draft_v3', 'x'.repeat(10));
  const realSet = st.setItem;
  let first = true;
  st.setItem = (k, v) => {
    if (k === 'kings_lands_data_registry_draft_v1' && first && st.getItem('kings_lands_studio_draft_v3')) { first = false; throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); }
    return realSet.call(st, k, v);
  };
  try {
    const res = dataRegistry.saveBuildingSkin('barracks', SKIN);
    assert.ok(res.ok && res.persisted, 'retried after removing the legacy draft');
    assert.equal(st.getItem('kings_lands_studio_draft_v3'), null);
  } finally {
    st.setItem = realSet;
  }
});

test('snapshotText round-trips (used by Studio undo) and is much smaller than a plain JSON snapshot', () => {
  reset();
  dataRegistry.saveBuildingSkin('barracks', SKIN);
  const text = dataRegistry.snapshotText();
  assert.ok(text.length < JSON.stringify(dataRegistry.snapshot()).length / 3, 'mesh blobs are references');
  dataRegistry.setActiveBuildingSkin('barracks', 'red');
  assert.equal(dataRegistry.getBuildingSkin('barracks').active, 'red');
  assert.ok(dataRegistry.restoreSnapshot(dataRegistry.parseSnapshot(text)).ok);
  assert.equal(dataRegistry.getBuildingSkin('barracks').active, 'default');
  assert.equal(dataRegistry.getBuildingSkin('barracks').items.red.mesh.vertices.length, 40);
});

test('copies are independent from the registry (mesh arrays are shared but never edited in place)', () => {
  reset();
  const a = dataRegistry.getUnitsVisuals();
  a.units.swordsman.displayName = 'changed';
  a.units.swordsman.hierarchy = null;
  assert.notEqual(dataRegistry.getUnitsVisuals().units.swordsman.displayName, 'changed');
  assert.ok(dataRegistry.getUnitsVisuals().units.swordsman.hierarchy);
});

test('speed guard: reading units data and saving a skin stay cheap', () => {
  reset();
  dataRegistry.getUnitsVisuals();
  let t = performance.now();
  for (let i = 0; i < 6; i++) dataRegistry.getUnitsVisuals();
  const readMs = (performance.now() - t) / 6;
  assert.ok(readMs < 60, `getUnitsVisuals took ${readMs.toFixed(1)} ms (was ~125 ms before blob sharing)`);
  t = performance.now();
  dataRegistry.saveBuildingSkin('barracks', SKIN);
  const saveMs = performance.now() - t;
  assert.ok(saveMs < 250, `saveBuildingSkin took ${saveMs.toFixed(0)} ms (was ~550 ms)`);
});

test('diagnostics lists localStorage keys, persist status and skins', () => {
  reset();
  dataRegistry.saveBuildingSkin('barracks', SKIN);
  const d = dataRegistry.diagnostics();
  assert.ok(d.version >= 1 && d.persist.ok);
  assert.ok(d.localStorageChars.kings_lands_data_registry_draft_v1 > 0);
  assert.deepEqual(d.buildingSkins.barracks.items, ['red']);
});
