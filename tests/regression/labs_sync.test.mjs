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
  getBaseCharacterTemplates
} from '../../src/tools/units_buildings/unitsBuildingsStateManager.js';
import { dataRegistry as sharedRegistry } from '../../src/data/dataRegistry.js';
import { buildBuildingsStudioViewData } from '../../src/tools/units_buildings/buildingStudioAdapter.js';
import { studioImportMethods } from '../../src/tools/studio/studioImport.js';
import {
  renderUnitsLeftListHtml,
  renderUnitRightInspectorHtml,
  APPEARANCE_HEAD_OPTIONS
} from '../../src/tools/units_buildings/unitsTabRenderer.js';
import { renderBuildingRightInspectorHtml } from '../../src/tools/units_buildings/buildingsTabRenderer.js';
import { HeroStateManager } from '../../src/tools/heroes/heroStateManager.js';
import { MapEditorApp, computeBlendedColorOverridesPatch } from '../../src/tools/map_editor/mapEditorApp.js';
import {
  DECORATIVE_PROPS_CATALOG,
  RESOURCE_SKINS_CATALOG,
  renderDecorativePropThumbnailSvg,
  createTreeMeshBySkin,
  createMineMeshBySkin,
  createDecorativePropMesh,
  hydrateMapState,
  serializeMapState
} from '../../src/tools/map_editor/mapStateManager.js';

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
  assert.ok(!rightHtml.includes('id="ub-unit-base-readonly"'), 'Units Lab must NOT contain Base Character appearance block');
  assert.ok(!rightHtml.includes('id="ub-btn-edit-look-studio"'), 'Units Lab must NOT contain Base & Look button');
  assert.ok(!rightHtml.includes('id="ub-unit-skin-select"'), 'Units Lab must NOT contain active unit skin selector');
  assert.ok(!rightHtml.includes('data-unit-skin-pick'), 'Units Lab must NOT contain active unit skin cards');
  assert.ok(!rightHtml.includes('id="ub-btn-edit-cosmetic-studio"'), 'Units Lab must NOT contain cosmetic appearance Studio button');
  assert.ok(!rightHtml.includes('data-unit-appearance'), 'Units Lab must NOT contain cosmetic armour dropdowns');
  assert.ok(rightHtml.includes('Weapon Sets (Hands Only)'), 'Weapon Sets must remain in Units Lab');
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

  // Unit active skin list still resolves cleanly for Studio & activeSkin
  sm.unitStatsData.units.swordsman.activeSkin = 'katiler';
  const unitSkins = listSkinsForUnit(sm.unitsVisualsData, sm.unitsVisualsData.units.swordsman, sm.unitStatsData.units.swordsman);
  assert.ok(unitSkins.some((s) => s.id === 'default'));
  assert.ok(unitSkins.some((s) => s.id === 'katiler'));

  // Building skin persistence + checkmark sync
  const skinsRoot = sharedRegistry.getBuildingSkins();
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
  const saveRes = sharedRegistry.saveBuildingSkins(skinsRoot);
  assert.equal(saveRes.ok, true);
  assert.equal(sharedRegistry.getBuildingSkins().barracks.active, 'citadel_alt');

  let bldHtml = renderBuildingRightInspectorHtml(sm, 'barracks');
  const altSkinBlock = bldHtml.split('data-bld-skin-pick="citadel_alt"')[1]?.split('</button>')[0] || '';
  assert.ok(altSkinBlock.includes('data-skin-check="true"'), 'Selected building skin card shows green checkmark badge');

  // Switching back to default via saveBuildingSkins updates live cache & renderer
  skinsRoot.barracks.active = 'default';
  sharedRegistry.saveBuildingSkins({ ...skinsRoot });
  assert.equal(sharedRegistry.getBuildingSkins().barracks.active, 'default');
  bldHtml = renderBuildingRightInspectorHtml(sm, 'barracks');
  const defSkinBlock = bldHtml.split('data-bld-skin-pick="default"')[1]?.split('</button>')[0] || '';
  assert.ok(defSkinBlock.includes('data-skin-check="true"'), 'Default building skin card shows checkmark when active');

  // saving through the registry adds / removes units, prefabs and custom buildings for every reader (no manual in-memory sync)
  const tempUnit = sm.createNewUnit({ name: 'Temp Sync Unit' });
  sm.unitsVisualsData.prefabs.temp_custom_helm = { id: 'temp_custom_helm', name: 'Temp Helm', slot: 'head' };
  sm.buildingsData.buildings.custom_tower = { id: 'custom_tower', name: 'Custom Tower', isCustom: true, options: [] };
  assert.ok(sm.saveAll().ok !== false);
  let live = sharedRegistry.getSimView();
  assert.ok(live.unitsVisuals.units[tempUnit]);
  assert.ok(live.unitsVisuals.prefabs.temp_custom_helm);
  assert.ok(live.buildings.buildings.custom_tower);

  sm.deleteUnit(tempUnit);
  delete sm.unitsVisualsData.prefabs.temp_custom_helm;
  delete sm.buildingsData.buildings.custom_tower;
  assert.ok(sm.saveAll().ok !== false);
  live = sharedRegistry.getSimView();
  assert.equal(live.unitsVisuals.units[tempUnit], undefined);
  assert.equal(live.unitsVisuals.prefabs.temp_custom_helm, undefined);
  assert.equal(live.buildings.buildings.custom_tower, undefined);
});

test('Studio import panel shows only tab-relevant sections and omits redundant building skins list', () => {
  globalThis.localStorage.clear();
  sharedRegistry.resetToDefaults();
  const unitsData = sharedRegistry.getUnitsVisuals();
  const hostEl = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const fakeStudio = {
    ...studioImportMethods,
    entityCategory: 'units',
    currentUnitId: 'swordsman',
    currentFaction: 'human',
    unitsData,
    ubStateManager: { buildingsData: sharedRegistry.getBuildings() },
    rootContainer: { querySelector: (sel) => (sel === '#insp-import' ? hostEl : null) },
    currentUnitGroup: { userData: { sockets: { head: {}, torso: {} } } }
  };

  fakeStudio._renderImportPanel();
  assert.ok(hostEl.innerHTML.includes('data-imp-kind="unit"'), 'Units tab shows Import base unit');
  assert.ok(hostEl.innerHTML.includes('data-imp-kind="gear"'), 'Units tab shows Import armour');
  assert.ok(!hostEl.innerHTML.includes('data-imp-kind="building"'), 'Units tab hides Import building skin');
  assert.ok(!hostEl.innerHTML.includes('data-imp-kind="newbuilding"'), 'Studio hides New building');

  fakeStudio.entityCategory = 'heroes';
  fakeStudio._imp.kind = null;
  fakeStudio._renderImportPanel();
  assert.ok(hostEl.innerHTML.includes('data-imp-kind="unit"'), 'Heroes tab shows Import base unit');
  assert.ok(hostEl.innerHTML.includes('data-imp-kind="gear"'), 'Heroes tab shows Import armour');
  assert.ok(!hostEl.innerHTML.includes('data-imp-kind="building"'), 'Heroes tab hides Import building skin');

  fakeStudio.entityCategory = 'buildings';
  fakeStudio.currentUnitId = 'barracks';
  fakeStudio._renderImportPanel();
  assert.ok(hostEl.innerHTML.includes('data-imp-kind="building"'), 'Buildings tab shows Import building skin');
  assert.ok(!hostEl.innerHTML.includes('data-imp-kind="unit"'), 'Buildings tab hides Import base unit');
  assert.ok(!hostEl.innerHTML.includes('data-imp-kind="gear"'), 'Buildings tab hides Import armour');
  assert.ok(!hostEl.innerHTML.includes('data-imp-kind="newbuilding"'), 'Buildings tab hides New building');
  assert.ok(!hostEl.innerHTML.includes('data-imp-del-skin'), 'Import window omits redundant list of all building skins');
});

test('Task 4: Studio delete X buttons & guards + Map Editor object grid and custom delete helpers', () => {
  globalThis.localStorage.clear();
  sharedRegistry.resetToDefaults();
  const prevConfirm = globalThis.confirm;
  globalThis.confirm = () => true;

  try {
    const unitsData = sharedRegistry.getUnitsVisuals();
    unitsData.units.imported_knight = {
      id: 'imported_knight',
      displayName: 'Imported Knight',
      race: 'human',
      hierarchy: { pelvis: { shape: 'box', size: [0.2, 0.2, 0.2], children: {} } },
      equipment: {},
      importInfo: { source: 'knight.glb' }
    };
    unitsData.prefabs.imp_helm = {
      id: 'imp_helm',
      name: 'Imported Helm',
      slot: 'head',
      race: 'human',
      importInfo: { source: 'helm.glb' }
    };

    const fakeStudio = {
      ...studioImportMethods,
      entityCategory: 'units',
      currentUnitId: 'swordsman',
      currentFaction: 'human',
      unitsData,
      ubStateManager: {
        unitStatsData: sharedRegistry.getUnitStats(),
        buildingsData: sharedRegistry.getBuildings(),
        saveAll() {}
      },
      rootContainer: { querySelector: () => null },
      stateManager: { scheduleSave() {} },
      _beginEdit() {},
      _rebindData() {},
      _spawnStudioUnit() {},
      _restowAll() {},
      _unitsOfPeople: () => ['swordsman'],
      _toast() {}
    };

    // Shipped models cannot be deleted
    fakeStudio._deleteImportedUnit('swordsman');
    assert.ok(unitsData.units.swordsman, 'Shipped unit swordsman must NEVER be deleted');
    const firstPrefabId = Object.keys(unitsData.prefabs).find((k) => !unitsData.prefabs[k]?.importInfo);
    fakeStudio._deleteImportedGear(firstPrefabId);
    assert.ok(unitsData.prefabs[firstPrefabId], 'Shipped prefab must NEVER be deleted');

    // Imported models ARE deleted cleanly
    fakeStudio._deleteImportedUnit('imported_knight');
    assert.equal(unitsData.units.imported_knight, undefined, 'Imported unit deleted');
    fakeStudio._deleteImportedGear('imp_helm');
    assert.equal(unitsData.prefabs.imp_helm, undefined, 'Imported gear deleted');

    // Building skins grid: visible X button on custom skin only, never default
    sharedRegistry.saveBuildingSkin('barracks', {
      active: 'custom_skin',
      items: { custom_skin: { name: 'Custom Stone', mesh: { vertices: [], faces: [], colors: [] } } }
    });
    fakeStudio.entityCategory = 'buildings';
    fakeStudio.currentUnitId = 'barracks';
    const gridHtml = fakeStudio._skinsGridHtml();
    assert.ok(gridHtml.includes('data-skin-del="custom_skin"'), 'Custom skin has delete button');
    assert.ok(!gridHtml.includes('data-skin-del="default"'), 'Default skin has NO delete button');
    assert.ok(!gridHtml.includes('hidden group-hover:flex'), 'Skin delete X button is always visible');

    // Map Editor decorative prop SVG preview & custom asset deletions
    for (const p of DECORATIVE_PROPS_CATALOG) {
      assert.ok(renderDecorativePropThumbnailSvg(p).includes('<svg'), `Prop ${p.id} has SVG preview`);
    }
    const ed = new MapEditorApp(null);
    ed.mapState.customPropAssets.push({ id: 'custom_prop_1', name: 'Statue X', kind: 'json', parts: [] });
    ed.mapState.decorativeProps.push({ id: 'dp1', propType: 'custom_prop_1', x: 100, z: 100 });
    ed.activePropType = 'custom_prop_1';
    assert.equal(ed.deleteCustomPropAsset('custom_prop_1'), true);
    assert.equal(ed.mapState.customPropAssets.length, 0);
    assert.equal(ed.mapState.decorativeProps.length, 0);
    assert.equal(ed.activePropType, DECORATIVE_PROPS_CATALOG[0].id);
    assert.equal(ed.deleteCustomPropAsset('statue_king'), false, 'Built-in prop cannot be deleted');

    ed.mapState.customResourceSkins.wood.push({ id: 'custom_tree_1', name: 'Custom Tree', kind: 'glb', mesh: { vertices: [], faces: [], colors: [] } });
    ed.mapState.trees.push({ uid: 't_c1', x: 200, z: 200, skinId: 'custom_tree_1' });
    ed.activeResourceSkins.wood = 'custom_tree_1';
    assert.equal(ed.deleteCustomResourceSkin('wood', 'custom_tree_1'), true);
    assert.equal(ed.mapState.customResourceSkins.wood.length, 0);
    assert.equal(ed.mapState.trees[0].skinId, RESOURCE_SKINS_CATALOG.wood[0].id);
    assert.equal(ed.activeResourceSkins.wood, RESOURCE_SKINS_CATALOG.wood[0].id);
    assert.equal(ed.deleteCustomResourceSkin('wood', 'pine_emerald'), false, 'Shipped resource cannot be deleted');

    ed.mapState.customTextures.push({ id: 'tex_1', name: 'Moss', dataUrl: 'data:image/png;base64,AA==' });
    ed.mapState.activeGroundTextureId = 'tex_1';
    assert.equal(ed.deleteCustomGroundTexture('tex_1'), true);
    assert.equal(ed.mapState.customTextures.length, 0);
    assert.equal(ed.mapState.activeGroundTextureId, 'none');
  } finally {
    globalThis.confirm = prevConfirm;
  }
});

function buildMinimalStaticGlbBuffer() {
  const pos = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
    0, 0, 1
  ]);
  const col = new Uint8Array([
    255, 64, 32,
    32, 255, 64,
    32, 64, 255,
    255, 220, 40
  ]);
  const idx = new Uint16Array([
    0, 2, 1,
    0, 1, 3,
    1, 2, 3,
    2, 0, 3
  ]);
  const chunks = [];
  const views = [];
  const accs = [];
  const add = (arr, type, ct, count, target, extra = {}) => {
    const raw = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (raw.length % 4)) % 4;
    const byteOffset = chunks.reduce((s, c) => s + c.length, 0);
    chunks.push(Buffer.concat([raw, Buffer.alloc(pad)]));
    views.push({ buffer: 0, byteOffset, byteLength: raw.length, target });
    accs.push({ bufferView: views.length - 1, componentType: ct, count, type, ...extra });
    return accs.length - 1;
  };
  const aPos = add(pos, 'VEC3', 5126, 4, 34962, { min: [0, 0, 0], max: [1, 1, 1] });
  const aCol = add(col, 'VEC3', 5121, 4, 34962, { normalized: true });
  const aIdx = add(idx, 'SCALAR', 5123, idx.length, 34963);
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'PropMesh', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: aPos, COLOR_0: aCol }, indices: aIdx }] }],
    accessors: accs,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }]
  };
  const jsonRaw = Buffer.from(JSON.stringify(json));
  const jsonPad = Buffer.concat([jsonRaw, Buffer.alloc((4 - (jsonRaw.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPad.length + 8 + bin.length, 8);
  const mkChunk = (type, payload) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(payload.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, payload]);
  };
  const glb = Buffer.concat([header, mkChunk(0x4e4f534a, jsonPad), mkChunk(0x004e4942, bin)]);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
}

test('Task 5: Map Editor GLB import for both objects and resources builds vertex-colored meshes & serializes cleanly', async () => {
  const ed = new MapEditorApp(null);
  const glbBuf = buildMinimalStaticGlbBuffer();

  const propAsset = await ed.importGlbPropFromBuffer(glbBuf, 'obelisks_pack.glb');
  assert.equal(propAsset.kind, 'glb');
  assert.equal(propAsset.name, 'obelisks_pack');
  assert.ok(propAsset.vertices.length >= 4 && propAsset.faces.length >= 4);
  assert.equal(ed.activePropType, propAsset.id);
  const propGroup = createDecorativePropMesh({ propType: propAsset.id, scale: 1.5, rotY: 0 }, ed.mapState.customPropAssets);
  assert.equal(propGroup.children.length, 1);
  assert.ok(propGroup.children[0].geometry.attributes.position);
  assert.ok(propGroup.children[0].geometry.attributes.color);

  const treeSkin = await ed.importGlbResourceFromBuffer(glbBuf, 'cedar_tree.glb', 'wood');
  assert.equal(treeSkin.kind, 'glb');
  assert.equal(treeSkin.name, 'cedar_tree');
  assert.equal(ed.activeResourceSkins.wood, treeSkin.id);
  const treeGroup = createTreeMeshBySkin(treeSkin.id, 1.0, 0, ed.mapState.customResourceSkins);
  assert.equal(treeGroup.children.length, 1);
  assert.ok(treeGroup.children[0].geometry.attributes.color);

  const mineSkin = await ed.importGlbResourceFromBuffer(glbBuf, 'gold_crystal.glb', 'coins');
  assert.equal(mineSkin.kind, 'glb');
  assert.equal(ed.activeResourceSkins.coins, mineSkin.id);
  const mineGroup = createMineMeshBySkin('coins', mineSkin.id, 1.0, 0, ed.mapState.customResourceSkins);
  assert.equal(mineGroup.children.length, 1);
  assert.ok(mineGroup.children[0].geometry.attributes.color);

  const roundTrip = hydrateMapState(JSON.parse(JSON.stringify(serializeMapState(ed.mapState))));
  assert.equal(roundTrip.customPropAssets.length, 1);
  assert.equal(roundTrip.customPropAssets[0].kind, 'glb');
  assert.equal(roundTrip.customResourceSkins.wood.length, 1);
  assert.equal(roundTrip.customResourceSkins.coins.length, 1);
});

test('Task 6: Map Editor Paint Blend mode smooths color/biome transitions without altering outside vertices', () => {
  const ed = new MapEditorApp(null);
  const cell = ed.getCellMeters();
  const res = 257;
  // Paint sharp split: left side red (ix <= 63), right side blue (ix >= 64) around iz=64
  for (let iz = 58; iz <= 70; iz++) {
    for (let ix = 58; ix <= 70; ix++) {
      ed.mapState.colorOverrides[iz * res + ix] = ix <= 63 ? [1, 0, 0] : [0, 0, 1];
    }
  }
  const farLeftIdx = 64 * res + 50;
  ed.mapState.colorOverrides[farLeftIdx] = [1, 0, 0];

  ed.paintMode = 'blend';
  ed.brushRadius = 48;
  ed.brushStrength = 1.0;
  ed.brushShape = 'circle_smooth';
  ed.brushFalloff = 'smooth';
  ed.applyPaintBlendAt(63.5 * cell, 64 * cell);

  const leftEdge = ed.mapState.colorOverrides[64 * res + 63];
  const rightEdge = ed.mapState.colorOverrides[64 * res + 64];
  assert.ok(leftEdge[0] < 1 && leftEdge[2] > 0, `Left boundary blended toward blue: ${leftEdge}`);
  assert.ok(rightEdge[0] > 0 && rightEdge[2] < 1, `Right boundary blended toward red: ${rightEdge}`);
  assert.deepEqual(ed.mapState.colorOverrides[farLeftIdx], [1, 0, 0], 'Vertices outside brush radius remain unchanged');

  // Uniform patch blends identically to itself
  const uniformPatch = computeBlendedColorOverridesPatch({
    worldX: 20 * cell,
    worldZ: 20 * cell,
    brushRadius: 32,
    brushStrength: 0.8,
    cellMeters: cell,
    mapRes: res,
    getVertexRgb: () => [0.25, 0.5, 0.75]
  });
  for (const rgb of uniformPatch.updates.values()) {
    assert.deepEqual(rgb, [0.25, 0.5, 0.75]);
  }
});





