import test from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
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
  const ctx2d = {
    fillRect: noop,
    clearRect: noop,
    fillText: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    closePath: noop,
    arc: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop })
  };
  globalThis.document = {
    addEventListener: noop,
    removeEventListener: noop,
    visibilityState: 'visible',
    createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => ctx2d })
  };
}

import {
  dataRegistry,
  DRAFT_STORAGE_KEY,
  LEGACY_STORAGE_KEYS
} from '../../src/data/dataRegistry.js';
import { modelProvider } from '../../src/render/modelProvider.js';
import { getBaseCharacterTemplates } from '../../src/tools/units_buildings/unitsBuildingsStateManager.js';

test('dataRegistry getters return deep clones and buildingSkinStore delegates cleanly without shared mutation', () => {
  globalThis.localStorage.clear();
  dataRegistry.resetToDefaults();

  const stats1 = dataRegistry.getUnitStats();
  stats1.units.swordsman.hp = 999999;
  assert.notEqual(dataRegistry.getUnitStats('swordsman').hp, 999999);

  const unitObj = dataRegistry.getUnit('swordsman');
  unitObj.stats.hp = 777;
  unitObj.visual.scale = 99;
  assert.notEqual(dataRegistry.getUnit('swordsman').stats.hp, 777);
  assert.notEqual(dataRegistry.getUnit('swordsman').visual.scale, 99);

  const races = dataRegistry.getRaces();
  races.human.name = 'Mutated Race';
  assert.notEqual(dataRegistry.getRace('human').name, 'Mutated Race');

  const bases = dataRegistry.getBases();
  bases[0].label = 'Mutated Base';
  assert.notEqual(dataRegistry.getBases()[0].label, 'Mutated Base');

  const bld = dataRegistry.getBuilding('barracks');
  bld.maxHp = 123456;
  assert.notEqual(dataRegistry.getBuilding('barracks').maxHp, 123456);

  const hero = dataRegistry.getHero('wizard');
  hero.displayName = 'Mutated Hero';
  assert.notEqual(dataRegistry.getHero('wizard').displayName, 'Mutated Hero');

  // buildingSkinStore returns deep clones so `delete dataRegistry.getBuildingSkins()[id]` never mutates internal registry
  const skinSave = dataRegistry.saveBuildingSkins({
    barracks: {
      active: 'alt_keep',
      items: {
        alt_keep: {
          name: 'Alt Keep',
          fitRadius: 5,
          mesh: {
            vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
            faces: [[0, 1, 2]],
            colors: [[180, 180, 180], [180, 180, 180], [180, 180, 180]]
          }
        }
      }
    }
  });
  assert.equal(skinSave.ok, true);
  const leaked = dataRegistry.getBuildingSkins();
  delete leaked.barracks;
  assert.ok(dataRegistry.getBuildingSkins().barracks?.items?.alt_keep, 'In-place delete on dataRegistry.getBuildingSkins() must not mutate registry state');
});

test('dataRegistry validation gate rejects broken cross-references without mutating live state or storage', () => {
  globalThis.localStorage.clear();
  dataRegistry.resetToDefaults();

  const beforeSnap = dataRegistry.snapshot();
  const beforeDraft = globalThis.localStorage.getItem(DRAFT_STORAGE_KEY);

  // 1. Broken unit -> base reference
  const badBaseStat = dataRegistry.getUnitStats('swordsman');
  badBaseStat.baseCharId = 'nonexistent_base_999';
  const r1 = dataRegistry.saveUnitStats('swordsman', badBaseStat);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /nonexistent_base_999/);
  assert.notEqual(dataRegistry.getUnitStats('swordsman').baseCharId, 'nonexistent_base_999');

  // 2. Broken unit -> gear prefab reference
  const badUnitVis = dataRegistry.getUnit('swordsman').visual;
  badUnitVis.equipment.weapon_socket_R = { prefab: 'missing_mythic_blade' };
  const r2 = dataRegistry.saveUnit('swordsman', { visual: badUnitVis });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /missing_mythic_blade/);
  assert.notEqual(dataRegistry.getUnit('swordsman').visual.equipment?.weapon_socket_R?.prefab, 'missing_mythic_blade');

  // 3. Broken hero -> gear prefab reference
  const badHero = dataRegistry.getHero('wizard');
  badHero.equipment.weapon_socket_R = { prefab: 'missing_wizard_orb' };
  const r3 = dataRegistry.saveHero('wizard', badHero);
  assert.equal(r3.ok, false);
  assert.match(r3.error, /missing_wizard_orb/);
  assert.notEqual(dataRegistry.getHero('wizard').equipment?.weapon_socket_R?.prefab, 'missing_wizard_orb');

  // 4. Broken building -> unit production reference
  const badBld = dataRegistry.getBuilding('barracks');
  badBld.options.push({ kind: 'unit', id: 'ghost_pikeman', unitType: 'ghost_pikeman', name: 'Ghost' });
  const r4 = dataRegistry.saveBuilding('barracks', badBld);
  assert.equal(r4.ok, false);
  assert.match(r4.error, /ghost_pikeman/);

  // 5. Broken buildingSkins active pointer
  const r5 = dataRegistry.saveBuildingSkin('barracks', { active: 'missing_skin_item', items: {} });
  assert.equal(r5.ok, false);
  assert.match(r5.error, /missing_skin_item/);

  assert.equal(globalThis.localStorage.getItem(DRAFT_STORAGE_KEY), beforeDraft);
  assert.deepEqual(dataRegistry.snapshot().data.unitStats.units.swordsman, beforeSnap.data.unitStats.units.swordsman);
});

test('dataRegistry dynamic bases, atomic deleteUnit, snapshot/restore, and overrides-only draft persistence', () => {
  globalThis.localStorage.clear();
  dataRegistry.resetToDefaults();

  // Dynamic base templates come strictly from dataRegistry.getBases()
  const baseTemplate = dataRegistry.getBase('human_base_1').visual;
  baseTemplate.displayName = 'Elven Base';
  baseTemplate.race = 'human';
  const addBaseRes = dataRegistry.saveBase('elven_base_custom', baseTemplate);
  assert.equal(addBaseRes.ok, true);
  assert.ok(getBaseCharacterTemplates().some((b) => b.id === 'elven_base_custom'));

  // Create a custom unit and add it to barracks options atomically, then deleteUnit removes everywhere
  const swordCopyStats = { ...dataRegistry.getUnitStats('swordsman'), id: 'test_temp_unit', name: 'Test Temp', baseCharId: 'elven_base_custom' };
  const swordCopyVis = { ...dataRegistry.getUnit('swordsman').visual, displayName: 'Test Temp' };
  const txAdd = dataRegistry.transaction((b) => {
    b.unitStats.units.test_temp_unit = swordCopyStats;
    b.unitsVisuals.units.test_temp_unit = swordCopyVis;
    b.buildings.buildings.barracks.options.push({ kind: 'unit', id: 'test_temp_unit', unitType: 'test_temp_unit', name: 'Test Temp' });
  });
  assert.equal(txAdd.ok, true);

  const snapWithTemp = dataRegistry.snapshot();
  assert.ok(snapWithTemp.version >= 1);
  assert.ok(snapWithTemp.fileVersions?.unitStats);

  // Draft stored in localStorage contains ONLY overrides (unchanged shipped entries are omitted)
  const rawDraft = JSON.parse(globalThis.localStorage.getItem(DRAFT_STORAGE_KEY));
  assert.equal(rawDraft.v, 1);
  assert.ok(rawDraft.fileVersions?.unitsVisuals);
  assert.ok(rawDraft.overrides?.unitStats?.units?.test_temp_unit);
  assert.equal(rawDraft.overrides?.unitStats?.units?.archer, undefined, 'Unchanged shipped units must not bloat overrides draft');

  // deleteUnit removes stats, visuals, and barracks recruitment option atomically
  const delRes = dataRegistry.deleteUnit('test_temp_unit');
  assert.equal(delRes.ok, true);
  assert.equal(dataRegistry.getUnit('test_temp_unit'), null);
  assert.ok(!dataRegistry.getBuilding('barracks').options.some((o) => o.id === 'test_temp_unit'));

  // restoreSnapshot brings back exact versioned bundle
  const restoreRes = dataRegistry.restoreSnapshot(snapWithTemp);
  assert.equal(restoreRes.ok, true);
  assert.ok(dataRegistry.getUnit('test_temp_unit'));
  assert.ok(dataRegistry.getBuilding('barracks').options.some((o) => o.id === 'test_temp_unit'));
});

test('dataRegistry migrates all legacy localStorage draft keys into single draft without dropping user work', () => {
  globalThis.localStorage.clear();

  const unitStatsLegacy = dataRegistry.getUnitStats();
  unitStatsLegacy.units.swordsman.hp = 245;

  const buildingsLegacy = dataRegistry.getBuildings();
  buildingsLegacy.buildings.barracks.maxHp = 2222;

  const bvLegacy = dataRegistry.getBuildingVisuals();
  bvLegacy.animations.keyframes.custom_bld_clip = {
    mode: 'keyframes',
    layer: 'fullBody',
    duration: 1.0,
    loop: false,
    tracks: {},
    events: []
  };

  const skinsLegacy = {
    barracks: {
      active: 'stone_keep',
      items: {
        stone_keep: {
          name: 'Stone Keep',
          fitRadius: 5,
          mesh: {
            vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
            faces: [[0, 1, 2]],
            colors: [[160, 160, 160], [160, 160, 160], [160, 160, 160]]
          }
        }
      }
    }
  };

  const heroesLegacy = dataRegistry.getHeroesData();
  heroesLegacy.heroes.wizard.displayName = 'Archmage Migrated';

  const studioLegacy = dataRegistry.getUnitsVisuals();
  studioLegacy.units.swordsman.scale = 1.35;

  globalThis.localStorage.setItem(LEGACY_STORAGE_KEYS.STUDIO_DRAFT_V3, JSON.stringify({
    v: 3,
    data: studioLegacy
  }));
  globalThis.localStorage.setItem(LEGACY_STORAGE_KEYS.UNIT_STATS, JSON.stringify(unitStatsLegacy));
  globalThis.localStorage.setItem(LEGACY_STORAGE_KEYS.BUILDINGS_DATA, JSON.stringify(buildingsLegacy));
  globalThis.localStorage.setItem(LEGACY_STORAGE_KEYS.BUILDING_VISUALS, JSON.stringify(bvLegacy));
  globalThis.localStorage.setItem(LEGACY_STORAGE_KEYS.BUILDING_SKINS, JSON.stringify(skinsLegacy));
  globalThis.localStorage.setItem(LEGACY_STORAGE_KEYS.HEROES_DATA, JSON.stringify(heroesLegacy));

  dataRegistry.reloadFromStorage();

  assert.equal(dataRegistry.getUnitStats('swordsman').hp, 245);
  assert.equal(dataRegistry.getUnit('swordsman').visual.scale, 1.35);
  assert.equal(dataRegistry.getBuilding('barracks').maxHp, 2222);
  assert.ok(dataRegistry.getBuildingVisuals().animations.keyframes.custom_bld_clip);
  assert.equal(dataRegistry.getBuildingSkin('barracks').active, 'stone_keep');
  assert.equal(dataRegistry.getHero('wizard').displayName, 'Archmage Migrated');

  assert.ok(globalThis.localStorage.getItem(DRAFT_STORAGE_KEY), 'Single unified draft key written after migration');
});

test('modelProvider owns singleton factories, rebuilds on registry changes, and produces identical models for same skin', () => {
  globalThis.localStorage.clear();
  dataRegistry.resetToDefaults();

  const mf1 = modelProvider.getModelFactory();
  const mf2 = modelProvider.getModelFactory();
  const bmf1 = modelProvider.getBuildingModelFactory();
  const bmf2 = modelProvider.getBuildingModelFactory();
  assert.equal(mf1, mf2);
  assert.equal(bmf1, bmf2);

  let notified = 0;
  const unsub = modelProvider.subscribe(() => { notified++; });

  const uStats = dataRegistry.getUnitStats('swordsman');
  uStats.activeSkin = 'katiler';
  assert.equal(dataRegistry.saveUnitStats('swordsman', uStats).ok, true);
  assert.ok(notified >= 1);

  // Unit model created with explicit skin vs registry activeSkin produces identical skinId and structure
  const mExplicit = modelProvider.createUnitModel('swordsman', { skin: 'katiler', team: 1, level: 2 });
  const mRegistryDefault = modelProvider.createUnitModel('swordsman', { team: 1, level: 2 });
  assert.equal(mExplicit.userData.skinId, 'katiler');
  assert.equal(mRegistryDefault.userData.skinId, 'katiler');
  assert.equal(mExplicit.children.length, mRegistryDefault.children.length);

  // Building model uses shared BuildingModelFactory & skin
  const bActor1 = modelProvider.createBuildingModel('barracks', { level: 2, team: 1 });
  const bActor2 = modelProvider.createBuildingModel('barracks', { level: 2, team: 1 });
  assert.ok(bActor1.group);
  assert.equal(bActor1.group.children.length, bActor2.group.children.length);

  // Hero model uses shared ModelFactory & skin
  const heroGroup = modelProvider.createHeroModel('wizard', { team: 1 });
  assert.equal(heroGroup.userData.heroId, 'wizard');
  assert.ok(heroGroup.userData.sockets?.torso);

  unsub();
});
