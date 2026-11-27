import test from 'node:test';
import assert from 'node:assert/strict';
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: globalThis.localStorage };
if (typeof globalThis.document === 'undefined') globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', createElement: () => ({ style: {}, getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }) }) };

import { dataRegistry } from '../../src/data/dataRegistry.js';
import { newPart, effectiveParts, legacyPartsFromDef, partsActiveAtLevel, fireStatsAtLevel, validateParts } from '../../src/data/buildingParts.js';

const shared = () => dataRegistry.getBuildings().sharedBuildingWatchtower;

test('legacy tower fields become parts (nothing is lost)', () => {
  dataRegistry.resetToDefaults();
  const b = dataRegistry.getBuildings().buildings;
  const cit = effectiveParts(b.citadel, shared());
  assert.equal(cit.filter((p) => p.kind === 'fire_point').length, 1);
  assert.equal(cit[0].range, b.citadel.turretRangeMeters);
  assert.deepEqual(cit[0].pos, b.citadel.turretOffset);
  const bar = effectiveParts(b.barracks, shared());
  assert.deepEqual(bar.map((p) => p.kind).sort(), ['fire_point', 'model']);
  assert.ok(bar.every((p) => p.minLevel === 3));
  assert.equal(partsActiveAtLevel(bar, 2).length, 0);
  assert.equal(partsActiveAtLevel(bar, 3).length, 2);
  assert.deepEqual(effectiveParts(b.house, shared()), [], 'a house without a tower has no parts');
  for (const id of Object.keys(b)) assert.deepEqual(validateParts({ parts: legacyPartsFromDef(b[id], shared()) }), [], id);
});

test('a building with its own parts: any part can be the fire point, no tower needed', () => {
  dataRegistry.resetToDefaults();
  const d = dataRegistry.getBuilding('barracks');
  d.parts = [newPart('fire_point', { id: 'top_window', pos: [0, 9, 1], range: 30, damage: 12, levelStats: { 2: { damage: 20 } } }), newPart('exit_point', { id: 'door', pos: [0, 0, 6] })];
  assert.equal(fireStatsAtLevel(d.parts[0], 1).damage, 12);
  assert.equal(fireStatsAtLevel(d.parts[0], 2).damage, 20);
  assert.equal(dataRegistry.saveBuilding('barracks', d).ok, true);
  assert.equal(dataRegistry.getBuilding('barracks').parts.length, 2);
  assert.equal(effectiveParts(dataRegistry.getBuilding('barracks')).some((p) => p.kind === 'model'), false, 'stored parts replace the legacy tower');
});

test('broken parts are rejected with a clear message', () => {
  dataRegistry.resetToDefaults();
  const d = dataRegistry.getBuilding('barracks');
  d.parts = [{ id: 'a', kind: 'fire_point', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], minLevel: 1, maxLevel: null, range: 0, damage: 1, reloadMinTicks: 5, reloadMaxTicks: 4, volleyCount: 1 }];
  const r = dataRegistry.saveBuilding('barracks', d);
  assert.equal(r.ok, false);
  assert.match(String(r.error), /range|reload/i);
});

test('the Studio view shows every part as a joint under the building body', async () => {
  dataRegistry.resetToDefaults();
  const { buildBuildingsStudioViewData } = await import('../../src/tools/units_buildings/buildingStudioAdapter.js');
  const view = buildBuildingsStudioViewData(dataRegistry.getBuildings(), dataRegistry.getBuildingVisuals(), dataRegistry.getUnitsVisuals());
  const cit = view.units.citadel;
  assert.ok(cit.hierarchy.pelvis.children.torso.children.fire_main, 'citadel fire point is a joint');
  assert.deepEqual(cit.hiddenJoints, ['head', 'turret_socket', 'cape_back', 'quiver_back']);
  assert.ok(cit.restPoses.fire_main);
  assert.equal(cit.parts[0].kind, 'fire_point');
});

test('glb model parts need data; disabled parts are not active at any level', async () => {
  const { isPartActiveAtLevel } = await import('../../src/data/buildingParts.js');
  const g = newPart('model', { id: 'g', model: { type: 'glb', ref: 'x', glbBase64: '' } });
  assert.match(JSON.stringify(validateParts({ parts: [g] })), /no data/);
  g.model.glbBase64 = 'AAAA';
  assert.deepEqual(validateParts({ parts: [g] }), []);
  assert.equal(isPartActiveAtLevel(g, 1), true);
  g.enabled = false;
  assert.equal(isPartActiveAtLevel(g, 1), false);
});

test('groups: children follow the group; a disabled group switches its children off; only one exit point', async () => {
  const { resolvePartPosition, isPartEffectivelyActive } = await import('../../src/data/buildingParts.js');
  const g = newPart('group', { id: 'g', pos: [10, 0, 0], rot: [0, Math.PI / 2, 0] });
  const f = newPart('fire_point', { id: 'f', parent: 'g', pos: [0, 5, 3] });
  const pos = resolvePartPosition([g, f], f);
  assert.ok(Math.abs(pos[0] - 13) < 1e-9 && Math.abs(pos[1] - 5) < 1e-9 && Math.abs(pos[2]) < 1e-9, `rotated 90deg about Y: (${pos})`);
  assert.deepEqual(validateParts({ parts: [g, f] }), []);
  assert.equal(isPartEffectivelyActive([g, f], f, 1), true);
  g.enabled = false;
  assert.equal(isPartEffectivelyActive([g, f], f, 1), false, 'disabled parent disables the child');
  assert.match(JSON.stringify(validateParts({ parts: [newPart('exit_point', { id: 'a' }), newPart('exit_point', { id: 'b' })] })), /ONE exit/);
  assert.match(JSON.stringify(validateParts({ parts: [{ ...f, parent: 'nope' }] })), /parent/);
});
