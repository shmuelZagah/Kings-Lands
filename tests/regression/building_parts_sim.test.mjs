import test from 'node:test';
import assert from 'node:assert/strict';
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, localStorage: globalThis.localStorage };
if (typeof globalThis.document === 'undefined') globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', createElement: () => ({ style: {}, getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }) }) };

import { dataRegistry } from '../../src/data/dataRegistry.js';
import { newPart } from '../../src/data/buildingParts.js';
import { GameState, UnitTypeIndex } from '../../src/sim/gameState.js';
import { setSimDataSource } from '../../src/sim/simConfig.js';
import { FX_ONE } from '../../src/core/fx.js';

const engineConfig = dataRegistry.getEngineConfig();
setSimDataSource(() => dataRegistry.getSimView());

function matchWith(buildingId, parts) {
  dataRegistry.resetToDefaults();
  if (parts) { const d = dataRegistry.getBuilding(buildingId); d.parts = parts; assert.ok(dataRegistry.saveBuilding(buildingId, d).ok); }
  const gs = new GameState({ ...engineConfig, simSnapshot: dataRegistry.getSimSnapshot() });
  gs.enemyAi.setMode('off');
  return gs;
}
const build = (gs, type, team, x, z) => gs.constructionSystem.createBuilding({ type, team, xFx: x * FX_ONE, zFx: z * FX_ONE, instantComplete: true, bypassValidation: true, gameState: gs });
const hpSum = (gs, comp) => comp.memberIds.reduce((s, id) => s + (gs.entities.get(id)?.hp || 0), 0);

test('a house with a fire point (no tower) shoots enemies in range; a house without one does not', () => {
  for (const withPoint of [true, false]) {
    const gs = matchWith('house', withPoint ? [newPart('fire_point', { id: 'window', pos: [0, 6, 0], range: 30, damage: 9, reloadMinTicks: 10, reloadMaxTicks: 12 })] : null);
    const b = build(gs, 'house', 2, 1850, 1750);
    const comp = gs.spawnCompany({ name: 'E', team: 1, unitType: 'swordsman', count: 5, spawnMetersX: 1850, spawnMetersZ: 1765, facingDir: 256, speedFx: 0, hp: 100 });
    const before = hpSum(gs, comp);
    for (let t = 0; t < 80; t++) gs.stepTick([]);
    const lost = before - hpSum(gs, comp);
    if (withPoint) assert.ok(lost > 0, `fire point must damage the enemy (lost ${lost})`);
    else assert.equal(lost, 0, 'no fire point: no shooting');
    assert.ok(b);
  }
});

test('a fire point only exists from its minLevel', () => {
  const gs = matchWith('house', [newPart('fire_point', { id: 'w', pos: [0, 6, 0], range: 30, damage: 9, minLevel: 2, reloadMinTicks: 10, reloadMaxTicks: 12 })]);
  const b = build(gs, 'house', 2, 1850, 1750);
  const comp = gs.spawnCompany({ name: 'E', team: 1, unitType: 'swordsman', count: 5, spawnMetersX: 1850, spawnMetersZ: 1765, facingDir: 256, speedFx: 0, hp: 100 });
  const before = hpSum(gs, comp);
  for (let t = 0; t < 60; t++) gs.stepTick([]);
  assert.equal(hpSum(gs, comp), before, 'level 1: part inactive');
  b.level = 2;
  for (let t = 0; t < 60; t++) gs.stepTick([]);
  assert.ok(hpSum(gs, comp) < before, 'level 2: part active');
});

test('legacy buildings (no stored parts) behave exactly as before; same match twice is deterministic', () => {
  const run = () => {
    const gs = matchWith('watchtower', null);
    build(gs, 'watchtower', 2, 1850, 1750);
    const comp = gs.spawnCompany({ name: 'E', team: 1, unitType: 'swordsman', count: 5, spawnMetersX: 1850, spawnMetersZ: 1765, facingDir: 256, speedFx: 0, hp: 100 });
    for (let t = 0; t < 120; t++) gs.stepTick([]);
    return hpSum(gs, comp);
  };
  const a = run();
  assert.ok(a < 500, 'the old watchtower still shoots');
  assert.equal(run(), a);
});

test('an exit point decides where units come out (+Z = the facing direction)', () => {
  const gs = matchWith('barracks', [newPart('exit_point', { id: 'door', pos: [0, 0, 20] })]);
  const b = build(gs, 'barracks', 1, 1900, 1900);
  const dir = b.facingDir;
  const off = gs.constructionSystem._localOffsetToWorldFx(b, 0, 20);
  const cs = gs.constructionSystem;
  const f = cs._getBuildingDoorVectorFx(b, 20);
  assert.ok(Math.abs(off.dxFx - f.dxFx) <= 2 && Math.abs(off.dzFx - f.dzFx) <= 2, 'local +Z is the facing direction');
  cs.productionSystem.startSequentialCompanySpawn(gs, b, { unitType: 'swordsman', name: 'S' }, UnitTypeIndex);
  const s = b.activeDoorSpawns[0];
  assert.equal(s.doorXFx, (b.xFx + off.dxFx) | 0);
  assert.equal(s.doorZFx, (b.zFx + off.dzFx) | 0);
  assert.equal(dir, b.facingDir);
});

test('a disabled fire point never shoots and a disabled exit point is ignored', () => {
  const gs = matchWith('house', [newPart('fire_point', { id: 'w', pos: [0, 6, 0], range: 30, damage: 9, enabled: false, reloadMinTicks: 10, reloadMaxTicks: 12 })]);
  build(gs, 'house', 2, 1850, 1750);
  const comp = gs.spawnCompany({ name: 'E', team: 1, unitType: 'swordsman', count: 5, spawnMetersX: 1850, spawnMetersZ: 1765, facingDir: 256, speedFx: 0, hp: 100 });
  const before = hpSum(gs, comp);
  for (let t = 0; t < 80; t++) gs.stepTick([]);
  assert.equal(hpSum(gs, comp), before);
  const gs2 = matchWith('barracks', [newPart('exit_point', { id: 'door', pos: [0, 0, 20], enabled: false })]);
  const b = build(gs2, 'barracks', 1, 1900, 1900);
  assert.equal(gs2.constructionSystem._activeStoredParts(b, 'exit_point').length, 0);
});
