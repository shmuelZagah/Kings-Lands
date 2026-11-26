/**
 * End-to-end consistency (stage 4): one edit, every reader sees it.
 *
 * "Readers" = everything that can show a unit/building/hero:
 *   registry (source of truth) · Units/Buildings lab · Studio · Hero lab (Hall of Heroes) · modelProvider (game + previews)
 *   · sim snapshot (the match).
 * Each scenario edits through ONE writer and then builds FRESH readers (as when a lab is opened), asserting they agree
 * without any manual refresh. Checklist for the parts that need a real browser: tests/e2e/MANUAL_CHECKLIST.md.
 */
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
  globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {}, localStorage: globalThis.localStorage };
}
if (typeof globalThis.document === 'undefined') {
  const noop = () => {};
  const grad = () => ({ addColorStop: noop });
  const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? grad : noop) });
  globalThis.document = { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible', createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => ctx2d }) };
}

import { dataRegistry } from '../../src/data/dataRegistry.js';
import { dataHash } from '../../src/data/dataHash.js';
import { modelProvider } from '../../src/render/modelProvider.js';
import { UnitsBuildingsStateManager } from '../../src/tools/units_buildings/unitsBuildingsStateManager.js';
import { StudioStateManager } from '../../src/tools/studio/studioStateManager.js';
import { HeroStateManager } from '../../src/tools/heroes/heroStateManager.js';
import { GameState } from '../../src/sim/gameState.js';
import { setSimDataSource } from '../../src/sim/simConfig.js';

const engineConfig = dataRegistry.getEngineConfig();
setSimDataSource(() => dataRegistry.getSimView());

const reset = () => { globalThis.localStorage.clear(); dataRegistry.resetToDefaults(); };

/** What every reader says about a unit (hash of its visual + stats), as seen by FRESH readers. */
function unitViews(id) {
  const lab = new UnitsBuildingsStateManager();
  const studio = new StudioStateManager();
  return {
    registryVisual: dataHash(dataRegistry.getUnitsVisuals().units[id]),
    labVisual: dataHash(lab.unitsVisualsData.units[id]),
    studioVisual: dataHash(studio.data.units[id]),
    providerVisual: dataHash(modelProvider.getCombinedVisuals().units[id]),
    registryStats: dataHash(dataRegistry.getUnitStats().units[id]),
    labStats: dataHash(lab.unitStatsData.units[id]),
    simStats: dataHash(dataRegistry.getSimSnapshot().unitStats.units[id])
  };
}
function assertAllAgree(id, label) {
  const v = unitViews(id);
  assert.equal(v.labVisual, v.registryVisual, `${label}: Units lab sees a different visual`);
  assert.equal(v.studioVisual, v.registryVisual, `${label}: Studio sees a different visual`);
  assert.equal(v.providerVisual, v.registryVisual, `${label}: the game/provider sees a different visual`);
  assert.equal(v.labStats, v.registryStats, `${label}: Units lab sees different stats`);
  assert.equal(v.simStats, v.registryStats, `${label}: the match snapshot has different stats`);
}

test('(a) a new unit on EVERY base, with a changed skin, is identical in every reader and renders', () => {
  reset();
  const bases = dataRegistry.getBases();
  assert.ok(bases.length >= 3, 'several bases are shipped');
  for (const base of bases) {
    const lab = new UnitsBuildingsStateManager();
    const id = lab.createNewUnit({ name: `e2e_${base.id}`, baseCharId: base.id });
    assert.ok(id, `unit created on ${base.id}`);
    assert.equal(lab.getUnitBaseId(id), base.id);

    // change its skin: a colour override on a skin + make it the active skin (what the Units lab / Studio do)
    const vis = dataRegistry.getUnitsVisuals();
    vis.units[id].skins = { ...(vis.units[id].skins || {}), e2e: { colorOverrides: { torso: '#12ab34' } } };
    assert.ok(dataRegistry.saveUnitsVisuals(vis).ok, `visual saved on ${base.id}`);
    assert.ok(dataRegistry.setUnitActiveSkin(id, 'e2e').ok);

    assertAllAgree(id, `base ${base.id}`);
    assert.equal(dataRegistry.getUnitStats(id).activeSkin, 'e2e');
    assert.equal(new UnitsBuildingsStateManager().unitStatsData.units[id].activeSkin, 'e2e');
    assert.ok(modelProvider.createUnitModel(id, { team: 1, level: 1 }), `the game can build a model for a unit on ${base.id}`);
  }
});

test('(b) a building skin and a hero edit are identical in every reader', () => {
  reset();
  const MESH = { vertices: Array.from({ length: 40 }, (_, i) => [i, 0, 0]), faces: [[0, 1, 2]], colors: Array.from({ length: 40 }, () => [255, 0, 0]) };
  assert.ok(dataRegistry.saveBuildingSkin('barracks', { active: 'default', items: { e2e: { name: 'E2E', fitRadius: 5, mesh: MESH } } }).ok);
  assert.ok(dataRegistry.setActiveBuildingSkin('barracks', 'e2e').ok);
  const lab = new UnitsBuildingsStateManager();
  assert.equal(dataRegistry.getBuildingSkin('barracks').active, 'e2e');
  assert.equal(modelProvider.getBuildingModelFactory().getActiveSkin('barracks')?.id, 'e2e', 'the game factory uses the skin');
  assert.ok(lab.buildingVisualsData, 'the Buildings lab loads');
  assert.equal(dataRegistry.getSimSnapshot().buildings.buildings.barracks.maxHp, dataRegistry.getBuilding('barracks').maxHp);

  // hero: create in the Hero lab, then every reader sees it
  const hm = new HeroStateManager();
  const hero = hm.createNewHero({ name: 'E2E Hero', heroClass: 'warrior' });
  assert.ok(hero?.id);
  const id = hero.id;
  assert.ok(dataRegistry.getHero(id), 'registry has the hero');
  assert.equal(new HeroStateManager().data.heroes[id].displayName, 'E2E Hero', 'a freshly opened Hero lab sees it');
  assert.ok(dataRegistry.getSimSnapshot().heroes.heroes[id], 'the match snapshot has the hero');
  assert.ok(modelProvider.getCombinedVisuals().units[id], 'the game/provider has the hero visual');
});

test('(c) switching a unit\'s base and editing an animation clip show up in every reader', () => {
  reset();
  const lab = new UnitsBuildingsStateManager();
  const id = lab.createNewUnit({ name: 'e2e_rebase' });
  assert.equal(lab.getUnitBaseId(id), 'human_base_1');
  assert.equal(lab.rebaseUnit(id, 'human_base_2').ok, true);
  assertAllAgree(id, 'after rebase');
  assert.equal(new UnitsBuildingsStateManager().getUnitBaseId(id), 'human_base_2', 'a freshly opened lab sees the new base');
  assert.equal(new StudioStateManager().data.units[id].hierarchy?.pelvis ? true : false, true);

  // edit a clip in the Studio: change a walk track and save
  const clipName = 'idle';
  const anims = dataRegistry.getUnitsVisuals();
  const clip = anims.animations.procedural[clipName] || anims.animations.keyframes[clipName];
  assert.ok(clip, 'clip exists');
  const kind = anims.animations.procedural[clipName] ? 'procedural' : 'keyframes';
  anims.animations[kind][clipName] = { ...clip, __e2e: 42 };
  assert.ok(dataRegistry.saveUnitsVisuals(anims).ok);
  assert.equal(new StudioStateManager().data.animations[kind][clipName].__e2e, 42, 'Studio sees the edited clip');
  assert.equal(modelProvider.getCombinedVisuals().animations[kind][clipName].__e2e, 42, 'the game sees the edited clip');
  assert.equal(new UnitsBuildingsStateManager().unitsVisualsData.animations[kind][clipName].__e2e, 42, 'the Units lab sees it');
});

test('(d) a save that breaks a cross reference is rejected with a clear message and changes nothing', () => {
  reset();
  const before = dataRegistry.getVersion();

  const stats = dataRegistry.getUnitStats();
  stats.units.swordsman.baseCharId = 'no_such_base';
  const r1 = dataRegistry.saveUnitStats(stats);
  assert.equal(r1.ok, false, 'unit pointing at a missing base is rejected');
  assert.match(String(r1.error), /no_such_base|base/i, `clear message (got: ${r1.error})`);

  const blds = dataRegistry.getBuildings();
  blds.buildings.barracks.options.push({ id: 'ghost', name: 'Ghost', kind: 'unit', unitType: 'ghost_unit_that_does_not_exist', unlockLevel: 1, cost: { coins: 1 }, trainTicks: 10, xpReward: 0 });
  const r2 = dataRegistry.saveBuildings(blds);
  assert.equal(r2.ok, false, 'building recruiting a missing unit is rejected');
  assert.match(String(r2.error), /ghost_unit_that_does_not_exist|unit/i, `clear message (got: ${r2.error})`);

  const vis = dataRegistry.getUnitsVisuals();
  vis.units.swordsman.equipment = { ...(vis.units.swordsman.equipment || {}), weapon_socket_R: { prefab: 'prefab_that_is_missing', gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] } };
  const r3 = dataRegistry.saveUnitsVisuals(vis);
  assert.equal(r3.ok, false, 'unit equipped with a missing prefab is rejected');
  assert.match(String(r3.error), /prefab_that_is_missing|prefab/i, `clear message (got: ${r3.error})`);

  assert.equal(dataRegistry.getVersion(), before, 'rejected saves do not bump the version');
  assert.notEqual(dataRegistry.getUnitStats('swordsman').baseCharId, 'no_such_base', 'and the registry is untouched');
  assert.equal(dataRegistry.getPersistStatus().ok, true);
});

test('(e) a running match is unaffected by a lab edit; the next match uses the new data', () => {
  reset();
  const hp0 = dataRegistry.getUnitStats('swordsman').hp;
  const running = new GameState({ ...engineConfig, simSnapshot: dataRegistry.getSimSnapshot() });
  const defsRunning = running.constructionSystem.buildingDefs.house.maxHp;

  const stats = dataRegistry.getUnitStats();
  stats.units.swordsman.hp = hp0 + 500;
  assert.ok(dataRegistry.saveUnitStats(stats).ok);
  const house = dataRegistry.getBuilding('house');
  house.maxHp = defsRunning + 1000;
  assert.ok(dataRegistry.saveBuilding('house', house).ok);

  assert.equal(running.constructionSystem.buildingDefs.house.maxHp, defsRunning, 'the running match keeps its building data');
  for (let t = 0; t < 5; t++) running.stepTick([]);   // still steps fine on its own snapshot
  const next = new GameState({ ...engineConfig, simSnapshot: dataRegistry.getSimSnapshot() });
  assert.equal(next.constructionSystem.buildingDefs.house.maxHp, defsRunning + 1000, 'the next match uses the new building data');
  assert.equal(dataRegistry.getSimSnapshot().unitStats.units.swordsman.hp, hp0 + 500, 'and the new unit data');
});
