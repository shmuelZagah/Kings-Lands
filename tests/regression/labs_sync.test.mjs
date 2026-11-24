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
    fillRect: noop, clearRect: noop, fillText: noop, beginPath: noop,
    moveTo: noop, lineTo: noop, closePath: noop, arc: noop, ellipse: noop,
    fill: noop, stroke: noop, save: noop, restore: noop, translate: noop,
    rotate: noop, scale: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
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
  NON_COMBAT_VISUAL_BASE_IDS,
  isNonCombatBaseOrMountVisual,
  ensureUnitStatsForVisualUnit,
  removeUnitAcrossLabs,
  listStudioBaseChoices,
  listCosmeticOptionsForSlot,
  listSkinsForUnit,
  filterStudioEntitiesForFaction
} from '../../src/tools/labSync.js';
import {
  UnitsBuildingsStateManager,
  getBaseCharacterTemplates,
  syncLiveConfigObjectsInMemory
} from '../../src/tools/units_buildings/unitsBuildingsStateManager.js';
import {
  loadBuildingSkins,
  saveBuildingSkins
} from '../../src/data/buildingSkinStore.js';
import defaultUnitsVisuals from '../../src/data/visuals/units.json';
import defaultBuildingsData from '../../src/data/buildings.json';
import { buildBuildingsStudioViewData } from '../../src/tools/units_buildings/buildingStudioAdapter.js';
import {
  renderUnitsLeftListHtml,
  renderUnitRightInspectorHtml,
  APPEARANCE_HEAD_OPTIONS
} from '../../src/tools/units_buildings/unitsTabRenderer.js';
import { renderBuildingRightInspectorHtml } from '../../src/tools/units_buildings/buildingsTabRenderer.js';
import { HeroStateManager } from '../../src/tools/heroes/heroStateManager.js';

test('labSync pure helpers: import registration, deletion, base choices, cosmetics, skins & faction filtering', () => {
  const unitStatsData = {
    units: {
      swordsman: { id: 'swordsman', name: 'Swordsman', race: 'human', hp: 140 }
    },
    _deletedUnits: ['imp_hero_knight']
  };
  const unitsVisualsData = {
    factions: {
      human: { name: 'Kingdom of Men', sharedUnits: true, primary: '#1d4ed8', secondary: '#fbbf24' },
      katiler: { name: 'Katiler Horde', sharedUnits: false, primary: '#dc2626', secondary: '#111827' },
      almasir: { name: 'Almasir', sharedUnits: true, primary: '#10b981', secondary: '#fef08a' }
    },
    prefabs: {
      imp_winged_helm: { id: 'imp_winged_helm', name: 'Winged Helm', slot: 'head', race: 'human', importInfo: { source: 'helm.glb' } },
      imp_katiler_helm: { id: 'imp_katiler_helm', name: 'Horned Helm', slot: 'head', race: 'katiler', importInfo: { source: 'horn.glb' } },
      imp_pauldron_R: { id: 'imp_pauldron_R', name: 'Lion Pauldron (R)', slot: 'shoulder', race: 'human', importInfo: { source: 'sh.glb' } },
      imp_pauldron_L: { id: 'imp_pauldron_L', name: 'Lion Pauldron (L)', slot: 'shoulder', race: 'human', importInfo: { source: 'sh.glb' } }
    },
    units: {
      human_base_1: { id: 'human_base_1', race: 'human', hierarchy: { pelvis: {} } },
      human_base_2: { id: 'human_base_2', race: 'human', hierarchy: { pelvis: {} } },
      katiler_base: { id: 'katiler_base', race: 'katiler', hierarchy: { pelvis: {} } },
      swordsman: {
        id: 'swordsman',
        race: 'human',
        hierarchy: { pelvis: {} },
        skins: { katiler: { colorOverrides: { armor: '#991b1b' } } }
      },
      imp_knight: {
        id: 'imp_knight',
        displayName: 'Imported Knight',
        race: 'human',
        hierarchy: { pelvis: {} },
        importInfo: { source: 'knight.glb' }
      },
      katiler_lancer: {
        id: 'katiler_lancer',
        race: 'katiler',
        hierarchy: { pelvis: {} }
      }
    }
  };

  assert.equal(isNonCombatBaseOrMountVisual('human_base_1'), true);
  assert.equal(NON_COMBAT_VISUAL_BASE_IDS.has('katiler_wolf'), true);

  // Never registers base templates or overwrites existing unitStats
  assert.equal(ensureUnitStatsForVisualUnit(unitStatsData, unitsVisualsData, 'human_base_1'), false);
  assert.equal(ensureUnitStatsForVisualUnit(unitStatsData, unitsVisualsData, 'swordsman'), false);
  assert.equal(unitStatsData.units.swordsman.hp, 140);

  // Registers imported .glb unit cleanly
  assert.equal(ensureUnitStatsForVisualUnit(unitStatsData, unitsVisualsData, 'imp_knight'), true);
  assert.equal(unitStatsData.units.imp_knight.name, 'Imported Knight');
  assert.equal(unitStatsData.units.imp_knight.baseCharId, 'imp_knight');

  // Re-importing clears _deletedUnits
  unitsVisualsData.units.imp_hero_knight = {
    id: 'imp_hero_knight',
    displayName: 'Hero Knight',
    race: 'human',
    hierarchy: { pelvis: {} },
    importInfo: { source: 'hk.glb' }
  };
  assert.equal(ensureUnitStatsForVisualUnit(unitStatsData, unitsVisualsData, 'imp_hero_knight'), true);
  assert.equal(unitStatsData._deletedUnits.includes('imp_hero_knight'), false);

  // Studio Base Choices includes same-race templates & imported GLB models
  const bases = listStudioBaseChoices(unitsVisualsData, unitStatsData, 'swordsman', getBaseCharacterTemplates());
  assert.ok(bases.some((b) => b.id === 'human_base_1'));
  assert.ok(bases.some((b) => b.id === 'human_base_2'));
  assert.ok(bases.some((b) => b.id === 'imp_knight' && b.isImported === true));
  assert.ok(!bases.some((b) => b.id === 'katiler_base'));

  // Cosmetics merge Studio GLB prefabs matching slot + race
  const heads = listCosmeticOptionsForSlot(unitsVisualsData, 'head', 'human', 'none', APPEARANCE_HEAD_OPTIONS);
  assert.ok(heads.some((h) => h.id === 'imp_winged_helm' && h.label.includes('[Studio GLB]')));
  assert.ok(!heads.some((h) => h.id === 'imp_katiler_helm'));

  const shoulders = listCosmeticOptionsForSlot(unitsVisualsData, 'shoulder', 'human', 'none', []);
  assert.ok(shoulders.some((s) => s.id === 'imp_pauldron'));

  // Skins list marks Studio Look
  const skins = listSkinsForUnit(unitsVisualsData, unitsVisualsData.units.swordsman, unitStatsData.units.swordsman);
  assert.equal(skins[0].id, 'default');
  assert.ok(skins.some((s) => s.id === 'katiler' && s.label.includes('Studio Look')));
  assert.ok(skins.some((s) => s.id === 'almasir'));

  // Faction filtering
  const humanEntities = filterStudioEntitiesForFaction(unitsVisualsData.units, 'units', 'human', unitsVisualsData);
  assert.ok(humanEntities.includes('swordsman'));
  assert.ok(!humanEntities.includes('katiler_lancer'));

  const katilerEntities = filterStudioEntitiesForFaction(unitsVisualsData.units, 'units', 'katiler', unitsVisualsData);
  assert.ok(katilerEntities.includes('katiler_lancer'));
  assert.ok(!katilerEntities.includes('swordsman'));

  // Cross-lab removal removes stats, visual, and building options
  const buildingsData = {
    buildings: {
      barracks: { options: [{ kind: 'unit', id: 'imp_knight' }, { kind: 'unit', id: 'swordsman' }] }
    }
  };
  assert.equal(removeUnitAcrossLabs(unitStatsData, unitsVisualsData, buildingsData, 'imp_knight'), true);
  assert.equal(unitStatsData.units.imp_knight, undefined);
  assert.equal(unitsVisualsData.units.imp_knight, undefined);
  assert.deepEqual(buildingsData.buildings.barracks.options.map((o) => o.id), ['swordsman']);
});

test('Units & Buildings Lab, Hero Manager & Studio cross-lab integration', () => {
  const sm = new UnitsBuildingsStateManager();
  sm.resetAllToDefaults();

  // Default creation uses human_base_1 and no mount
  const newId = sm.createNewUnit({ name: 'Sync Guard' });
  assert.equal(sm.getUnitBaseId(newId), 'human_base_1');
  assert.equal(sm.unitStatsData.units[newId].mountType, 'none');

  // Equip weapon & custom mount in Units Lab
  sm.unitsVisualsData.units[newId].equipment.weapon_socket_R = { prefab: 'spear', gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] };
  sm.setUnitMount(newId, 'katiler_wolf');
  assert.equal(sm.unitStatsData.units[newId].mountType, 'katiler_wolf');
  assert.ok(sm.unitsVisualsData.units[newId].mountHierarchy);

  // Syncing preserves non-horse mount rather than overwriting with horse
  sm.saveAll();
  assert.equal(sm.unitStatsData.units[newId].mountType, 'katiler_wolf');

  // Rebase in Studio keeps mount, stats, and weapons
  const rebaseRes = sm.rebaseUnit(newId, 'human_base_2');
  assert.equal(rebaseRes.ok, true);
  assert.equal(sm.getUnitBaseId(newId), 'human_base_2');
  assert.equal(sm.unitStatsData.units[newId].mountType, 'katiler_wolf');
  assert.equal(sm.unitsVisualsData.units[newId].equipment.weapon_socket_R.prefab, 'spear');

  // Deleted unit stays deleted across sync
  assert.equal(sm.deleteUnit(newId), true);
  sm.saveAll();
  assert.equal(sm.unitStatsData.units[newId], undefined);

  // Building Studio View derives factions dynamically
  const bView = buildBuildingsStudioViewData(sm.buildingsData, sm.buildingVisualsData, sm.unitsVisualsData);
  assert.ok(Object.keys(bView.factions).length >= 2);
  assert.ok(bView.units.barracks);

  // Renderers enforce ownership boundaries & Studio links
  const leftHtml = renderUnitsLeftListHtml(sm, 'swordsman');
  assert.ok(!leftHtml.includes('ub-new-unit-base'), 'Left creation bar must NOT contain ub-new-unit-base');
  assert.ok(leftHtml.includes('ub-btn-create-unit'));

  const rightHtml = renderUnitRightInspectorHtml(sm, 'swordsman');
  assert.ok(!rightHtml.includes('id="ub-unit-base-select"'), 'Units Lab must NOT contain editable Base Character dropdown');
  assert.ok(rightHtml.includes('id="ub-unit-base-readonly"'));
  assert.ok(rightHtml.includes('id="ub-btn-edit-look-studio"'));
  assert.ok(rightHtml.includes('id="ub-unit-skin-select"'));
  assert.ok(rightHtml.includes('id="ub-btn-edit-cosmetic-studio"'));
  assert.ok(rightHtml.includes('id="ub-unit-mount-select"'), 'Mount selection must remain in Units Lab');

  const bldHtml = renderBuildingRightInspectorHtml(sm, 'barracks');
  assert.ok(bldHtml.includes('id="ub-btn-edit-bld-skins-studio"'), 'Buildings tab always shows Studio Skins link');

  // StudioStateManager compact save + reload preserves rebased human_base_2 hierarchy without bloating localStorage
  globalThis.localStorage.clear();
  const sm2 = new UnitsBuildingsStateManager();
  sm2.resetAllToDefaults();
  const rebasedId = sm2.createNewUnit({ name: 'Compact Check' });
  const r2 = sm2.rebaseUnit(rebasedId, 'human_base_2');
  assert.equal(r2.ok, true);
  sm2.saveAll();
  const savedPack = JSON.parse(globalThis.localStorage.getItem('kings_lands_data_registry_draft_v1'));
  assert.ok(savedPack.fileVersions?.unitsVisuals, 'Registry draft stores fileVersions stamp');
  assert.ok(savedPack.overrides?.unitsVisuals?.omittedUnits?.includes('human_base_2'), 'Unedited human_base_2 omitted from localStorage draft');
  assert.equal(savedPack.overrides?.unitsVisuals?.sharedHierarchies?.[rebasedId], 'human_base_2', 'Rebased unit references shared human_base_2 hierarchy');
  const smReloaded = new UnitsBuildingsStateManager();
  assert.ok(smReloaded.unitsVisualsData.units.human_base_2?.hierarchy?.pelvis, 'Reload restores human_base_2 hierarchy');
  assert.ok(smReloaded.unitsVisualsData.units[rebasedId]?.hierarchy?.pelvis, 'Reload restores rebased unit hierarchy');

  // HeroStateManager preserves existing heroes across flush
  const hm = new HeroStateManager();
  hm.resetToDefault();
  const createdHero = hm.createNewHero({ name: 'Sync Paladin', heroClass: 'warrior' });
  assert.ok(hm.data.heroes[createdHero.id]);
  hm.flush();
  assert.equal(hm.data.heroes[createdHero.id].displayName, 'Sync Paladin');
});

test('Two-way skin checkmarks, buildingSkinStore cache sync & in-memory lab propagation', () => {
  globalThis.localStorage.clear();
  const sm = new UnitsBuildingsStateManager();
  sm.resetAllToDefaults();

  // Unit skin checkmark moves cleanly with activeSkin
  sm.unitStatsData.units.swordsman.activeSkin = 'default';
  let unitHtml = renderUnitRightInspectorHtml(sm, 'swordsman');
  assert.ok(unitHtml.includes('data-unit-skin-pick="default"'));
  assert.ok(unitHtml.includes('data-skin-check="true"'));

  sm.unitStatsData.units.swordsman.activeSkin = 'katiler';
  unitHtml = renderUnitRightInspectorHtml(sm, 'swordsman');
  const katilerBlock = unitHtml.split('data-unit-skin-pick="katiler"')[1]?.split('</button>')[0] || '';
  const defaultBlock = unitHtml.split('data-unit-skin-pick="default"')[1]?.split('</button>')[0] || '';
  assert.ok(katilerBlock.includes('data-skin-check="true"'), 'Selected unit skin card shows green checkmark badge');
  assert.ok(!defaultBlock.includes('data-skin-check="true"'), 'Unselected unit skin card must not show checkmark badge');

  // Building skin persistence + checkmark sync
  const skinsRoot = loadBuildingSkins();
  skinsRoot.barracks = {
    active: 'citadel_alt',
    items: {
      citadel_alt: {
        name: 'Citadel Alt',
        fitRadius: 5,
        mesh: {
          vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
          faces: [[0, 1, 2]],
          colors: [[200, 180, 160], [200, 180, 160], [200, 180, 160]]
        }
      }
    }
  };
  const saveRes = saveBuildingSkins(skinsRoot);
  assert.equal(saveRes.ok, true);
  assert.equal(loadBuildingSkins().barracks.active, 'citadel_alt');

  let bldHtml = renderBuildingRightInspectorHtml(sm, 'barracks');
  const altSkinBlock = bldHtml.split('data-bld-skin-pick="citadel_alt"')[1]?.split('</button>')[0] || '';
  assert.ok(altSkinBlock.includes('data-skin-check="true"'), 'Selected building skin card shows green checkmark badge');

  // Switching back to default via saveBuildingSkins updates live cache & renderer
  skinsRoot.barracks.active = 'default';
  saveBuildingSkins({ ...skinsRoot });
  assert.equal(loadBuildingSkins().barracks.active, 'default');
  bldHtml = renderBuildingRightInspectorHtml(sm, 'barracks');
  const defSkinBlock = bldHtml.split('data-bld-skin-pick="default"')[1]?.split('</button>')[0] || '';
  assert.ok(defSkinBlock.includes('data-skin-check="true"'), 'Default building skin card shows checkmark when active');

  // syncLiveConfigObjectsInMemory removes deleted units & custom buildings and syncs prefabs/arrowConfig
  const tempUnit = sm.createNewUnit({ name: 'Temp Sync Unit' });
  sm.unitsVisualsData.prefabs.temp_custom_helm = { id: 'temp_custom_helm', name: 'Temp Helm', slot: 'head' };
  sm.buildingsData.buildings.custom_tower = { id: 'custom_tower', name: 'Custom Tower', isCustom: true, options: [] };
  syncLiveConfigObjectsInMemory(sm.unitStatsData, sm.buildingsData, sm.unitsVisualsData, sm.buildingVisualsData);
  assert.ok(defaultUnitsVisuals.units[tempUnit]);
  assert.ok(defaultUnitsVisuals.prefabs.temp_custom_helm);
  assert.ok(defaultBuildingsData.buildings.custom_tower);

  sm.deleteUnit(tempUnit);
  delete sm.unitsVisualsData.prefabs.temp_custom_helm;
  delete sm.buildingsData.buildings.custom_tower;
  syncLiveConfigObjectsInMemory(sm.unitStatsData, sm.buildingsData, sm.unitsVisualsData, sm.buildingVisualsData);
  assert.equal(defaultUnitsVisuals.units[tempUnit], undefined);
  assert.equal(defaultUnitsVisuals.prefabs.temp_custom_helm, undefined);
  assert.equal(defaultBuildingsData.buildings.custom_tower, undefined);
});

