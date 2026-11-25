import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
}
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: globalThis.localStorage };
if (typeof globalThis.document === 'undefined') {
  const noop = () => {}; const ctx2d = new Proxy({}, { get: () => noop });
  globalThis.document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => ctx2d }) };
}
import { dataRegistry, DRAFT_STORAGE_KEY } from '../../src/data/dataRegistry.js';
import { defaultUnitsVisuals } from '../../src/data/defaults.js';

const reset = () => { globalThis.localStorage.clear(); dataRegistry.resetToDefaults(); };

test('races: identity, units, bases, gear and heroes per race; mirukenkay is a base unit only', () => {
  reset();
  const ids = dataRegistry.getRaceCards().map((r) => r.id);
  assert.deepEqual(ids.sort(), ['almasir', 'human', 'katiler', 'nefrolai', 'takdik']);
  assert.ok(!ids.includes('mirukenkay'));
  assert.ok(dataRegistry.getRaceCards({ includeBaseOnly: true }).some((r) => r.id === 'mirukenkay' && r.baseOnly));
  const human = dataRegistry.getRaceCard('human');
  assert.ok(human.bases.includes('human_base_1') && human.units.includes('swordsman'));
  assert.ok(Object.keys(dataRegistry.getUnitsForRace('human').stats).includes('swordsman'));
  assert.ok(Object.keys(dataRegistry.getHeroesForRace('human')).length >= 1);
  assert.ok(Object.keys(dataRegistry.getGearForRace('katiler')).every((id) => dataRegistry.getGearForRace('katiler')[id].race === 'katiler'));
  assert.equal(dataRegistry.getRaceCard('nope'), null);
  assert.ok(dataRegistry.getBases('katiler').some((b) => b.id === 'katiler_base'));
  const copy = dataRegistry.getRaceCard('human'); copy.units.length = 0;
  assert.ok(dataRegistry.getRaceCard('human').units.length > 0, 'returns copies');
});

test('an old draft saved against the monolithic files is migrated, not lost', () => {
  reset();
  // old studio draft: the WHOLE units.json (what kings_lands_studio_draft_v3 held) with one edit by the user
  const oldDraft = JSON.parse(JSON.stringify(defaultUnitsVisuals));
  oldDraft.units.swordsman.selectionRingRadius = 1.2345;
  globalThis.localStorage.setItem('kings_lands_studio_draft_v3', JSON.stringify(oldDraft));
  const skin = { active: 'cube', items: { cube: { name: 'Cube', fitRadius: 4, mesh: { vertices: Array.from({ length: 40 }, (_, i) => [i, 0, 0]), faces: [[0, 1, 2]], colors: Array.from({ length: 40 }, () => [255, 0, 0]) } } } };
  globalThis.localStorage.setItem('kings_lands_building_skins_v1', JSON.stringify({ house: skin }));
  globalThis.localStorage.setItem('kings_lands_unit_stats_v2', JSON.stringify({ ...dataRegistry.getUnitStats(), units: { ...dataRegistry.getUnitStats().units, swordsman: { ...dataRegistry.getUnitStats('swordsman'), hp: 777 } } }));
  dataRegistry.reloadFromStorage();
  const vis = dataRegistry.getUnitsVisuals();
  assert.equal(vis.units.swordsman.selectionRingRadius, 1.2345, 'visual edit from the old draft survives');
  assert.equal(dataRegistry.getUnitStats('swordsman').hp, 777, 'stats edit from the old stats key survives');
  assert.equal(dataRegistry.getBuildingSkin('house')?.active, 'cube', 'building skin from the old skins key survives');
  assert.ok(vis.units.human_base_1?.hierarchy, 'base meshes (now in bases/*.json) are intact after migration');
  assert.ok(Object.keys(vis.prefabs).length >= 296);
  assert.ok(globalThis.localStorage.getItem(DRAFT_STORAGE_KEY), 'written into the unified draft');
});
