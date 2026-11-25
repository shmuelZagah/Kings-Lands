import assert from 'node:assert/strict';
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
    localStorage: globalThis.localStorage,
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
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  globalThis.document = {
    addEventListener: noop,
    removeEventListener: noop,
    visibilityState: 'visible',
    createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => ctx2d }),
  };
}

import { readEngineConfig } from '../helpers/loadData.mjs';
import fs from 'node:fs';
import { GameState } from '../../src/sim/gameState.js';
import { CommandTypes } from '../../src/core/commandBus.js';
import { GathererState } from '../../src/sim/systems/workerGatheringStepper.js';
import {
  FormationTypes,
  getAllowedFormationsForUnit,
  computeFormationLocalSlotsFx
} from '../../src/sim/formations/formations.js';
import {
  UnitsBuildingsStateManager,
  computeEligibleFormationsForUnit
} from '../../src/tools/units_buildings/unitsBuildingsStateManager.js';
import {
  buildBuildingsStudioViewData,
  BUILDING_STUDIO_CLIPS
} from '../../src/tools/units_buildings/buildingStudioAdapter.js';
import {
  renderUnitsLeftListHtml,
  renderUnitRightInspectorHtml
} from '../../src/tools/units_buildings/unitsTabRenderer.js';
import {
  renderBuildingsLeftListHtml,
  renderBuildingRightInspectorHtml
} from '../../src/tools/units_buildings/buildingsTabRenderer.js';
import { BuildingModelFactory } from '../../src/render/buildingModelFactory.js';

const engineConfig = readEngineConfig();

export async function runUnitsBuildingsLabAndDoorTests() {
  console.log('=== Running Units & Buildings Lab (11 Fixes + 3 Enhancements), Doorway Economy & AI Suite ===');

  const sm = new UnitsBuildingsStateManager();
  sm.resetAllToDefaults();

  // 1. Verify Fix 1 (Create from Base Character vs Duplicate Selected Unit), Fix 5 (Mount Dropdown), Fix 6 & Fix 11
  {
    const baseUnitId = sm.createNewUnit({
      id: 'royal_halberdier',
      name: 'Royal Halberdiers',
      baseCharId: 'human_base',
      mountType: 'none',
      weaponR: 'pike',
      weaponL: 'none'
    });
    assert.equal(baseUnitId, 'royal_halberdier');
    const uStat = sm.unitStatsData.units.royal_halberdier;
    const uVis = sm.unitsVisualsData.units.royal_halberdier;
    assert.ok(uStat && uVis, 'Base character unit created in both stats and Studio visuals');
    assert.equal(uStat.labelHe, undefined, 'Fix 6: No labelHe on unit');
    assert.equal(uStat.recruitedIn, undefined, 'Fix 11: Unit does not store recruitedIn');
    assert.equal(uStat.unlockLevel, undefined, 'Fix 11: Unit does not store unlockLevel');
    assert.equal(uStat.trainTimeSec, undefined, 'Fix 11: Unit does not store trainTimeSec');
    assert.equal(uStat.xpReward, undefined, 'Fix 11: Unit does not store xpReward');
    assert.equal(uVis.equipment.weapon_socket_R.prefab, 'pike', 'Fix 7: Weapon synced into StudioStateManager data');

    // Fix 1 (Part B): Duplicate Selected Unit (`swordsman`)
    const dupId = sm.duplicateUnit('swordsman', 'Elite Swordsmen');
    assert.ok(dupId && sm.unitStatsData.units[dupId], 'Fix 1: Duplicate unit created');
    assert.equal(
      sm.unitsVisualsData.units[dupId].equipment.weapon_socket_R?.prefab,
      sm.unitsVisualsData.units.swordsman.equipment.weapon_socket_R?.prefab,
      'Fix 1: Duplicated unit preserves source unit weapon & armor'
    );

    // Fix 5: Mount Selection Dropdown attaches/removes 3D mountHierarchy in real time
    sm.setUnitMount('royal_halberdier', 'human_horse');
    assert.equal(sm.unitStatsData.units.royal_halberdier.isMounted, true, 'Mount sets isMounted = true');
    assert.ok(sm.unitsVisualsData.units.royal_halberdier.mountHierarchy, '3D mountHierarchy attached to unit');
    assert.ok(
      getAllowedFormationsForUnit('royal_halberdier').includes('wedge'),
      'Mounting a melee warrior enables Square <-> Wedge toggle'
    );

    sm.setUnitMount('royal_halberdier', 'none');
    assert.equal(sm.unitStatsData.units.royal_halberdier.isMounted, false, 'Unmounting sets isMounted = false');
    assert.equal(sm.unitsVisualsData.units.royal_halberdier.mountHierarchy, undefined, '3D mountHierarchy removed');
    assert.ok(
      getAllowedFormationsForUnit('royal_halberdier').includes('spearWall'),
      'Unmounted pike warrior has Square <-> Spear Wall toggle'
    );
  }

  // 2. Verify Fix 2, Fix 3 (Vision Range), Fix 4 (Weapons vs Appearance), Fix 10 (100% English UI), Enhancement 1 & 2
  {
    const leftUnitsHtml = renderUnitsLeftListHtml(sm, 'swordsman');
    const rightUnitsHtml = renderUnitRightInspectorHtml(sm, 'swordsman');
    const leftBldHtml = renderBuildingsLeftListHtml(sm, 'barracks');
    const rightBldHtml = renderBuildingRightInspectorHtml(sm, 'barracks');

    assert.ok(leftUnitsHtml.includes('Copy "Citadel Swordsmen"'), 'Fix 1 & 10: Copy button in English');
    assert.ok(leftUnitsHtml.includes('+ New Unit'), 'Fix 1 & 10: Clean + New Unit button in English');
    assert.ok(!leftUnitsHtml.includes('ub-new-unit-base'), 'Fix 1 & 6: No base-character or weapon selector in creation box');
    assert.ok(rightUnitsHtml.includes('Delete Unit'), 'Combat unit (swordsman) has Delete Unit button');
    assert.ok(rightUnitsHtml.includes('Weapon Sets (Hands Only)'), 'Fix 4: Weapon Sets contain hand weapons only');
    assert.ok(rightUnitsHtml.includes('Visual Appearance (Cosmetic)'), 'Fix 4: Helmets & armor separated into Visual Appearance');
    assert.ok(rightUnitsHtml.includes('data-unit-field="visionRangeMeters"'), 'Fix 3: Vision Range field present on unit');
    assert.ok(rightUnitsHtml.includes('Blacksmith Upgrade Bonuses (%)'), 'Enhancement 1: Blacksmith bonuses per unit');
    assert.ok(rightBldHtml.includes('Has Levels') && rightBldHtml.includes('Has Watchtower'), 'Building toggles Has Levels & Has Watchtower present');
    assert.ok(rightBldHtml.includes('Muzzle X'), 'Enhancement 3: Turret Muzzle Socket XYZ controls present');

    const duel = sm.simulateUnitDuel('cavalry', 'archer', 'squad');
    assert.ok(duel && duel.winnerId === 'cavalry', 'Enhancement 2: Live Squad Duel Simulator computes DPS, TTK & winner');
  }

  // 3. Verify Fix 11 (Buildings Own Recruitment, Unlock Level, Train Time & XP), Building Level Unlocks & Dedicated Building Animation Session
  {
    sm.buildingsData.buildings.barracks.options.push({
      id: 'royal_halberdier',
      name: 'Royal Halberdiers',
      kind: 'unit',
      unitType: 'royal_halberdier',
      unlockLevel: 2,
      cost: { coins: 150, wood: 0, stone: 0, iron: 30 },
      trainTicks: 120,
      xpReward: 45
    });
    sm.saveAll();

    const gs = new GameState(engineConfig);
    gs.enemyAi.setMode('off');
    gs.economySystem.grantCheatResources(1, 50000);

    const archerEnt = Array.from(gs.entities.values()).find((e) => e.unitTypeIdx === 3);
    assert.equal(archerEnt.visionRangeMeters, 112, 'Fix 3: Spawned archer receives visionRangeMeters = 112 from unitStats.json');

    const barracks = gs.constructionSystem.createBuilding({
      type: 'barracks',
      team: 1,
      xFx: 2010 * 1024,
      zFx: 1650 * 1024,
      instantComplete: true,
      bypassValidation: true,
      gameState: gs
    });

    const tryLocked = gs.constructionSystem.productionSystem.queueProductionOption(
      barracks.id,
      'royal_halberdier',
      1
    );
    assert.equal(tryLocked, false, 'Cannot recruit Level 2 unit from Level 1 Barracks');

    gs.constructionSystem.productionSystem.levelUpBuilding(
      barracks,
      gs.constructionSystem.buildingDefs.barracks
    );
    assert.equal(barracks.level, 2, 'Barracks leveled up to Level 2');

    const tryUnlocked = gs.constructionSystem.productionSystem.queueProductionOption(
      barracks.id,
      'royal_halberdier',
      1
    );
    assert.equal(tryUnlocked, true, 'Level 2 unit unlocks once Barracks reaches Level 2');

    // Verify Dedicated Building Animation Session clips (including level_up & victory_cheer, no walk/attack)
    assert.deepEqual(
      BUILDING_STUDIO_CLIPS,
      [
        'build_construct',
        'idle',
        'level_up',
        'recruit_spawn',
        'damage_stage_1',
        'damage_stage_2',
        'collapse_destroy',
        'victory_cheer'
      ],
      'Building Studio Session contains only building-specific lifecycle clips plus victory_cheer'
    );

    const bStudio = buildBuildingsStudioViewData(sm.buildingsData, sm.buildingVisualsData, sm.unitsVisualsData);
    assert.ok(bStudio.units.barracks, 'Barracks appears in Animation Lab Buildings category');
    assert.ok(
      bStudio.units.barracks.hierarchy.pelvis.children.torso.children.head.children.turret_socket,
      'Enhancement 3: Building Studio hierarchy includes articulated turret_socket'
    );
    for (const clipName of BUILDING_STUDIO_CLIPS) {
      assert.ok(
        bStudio.animations.keyframes[`building_${clipName}`],
        `Building animation clip building_${clipName} exists`
      );
    }
    // Verify zero unit movement/combat clips leak into building studio keyframes
    assert.equal(bStudio.animations.keyframes.walk, undefined, 'Building keyframes must NOT include unit walk');
    assert.equal(bStudio.animations.keyframes.attack_slash, undefined, 'Building keyframes must NOT include unit attack_slash');

    const wtMeshes = bStudio.units.watchtower.hierarchy.pelvis.children.torso.meshes;
    const btMeshes = bStudio.units.ballista_tower.hierarchy.pelvis.children.torso.meshes;
    assert.ok(
      wtMeshes.some((m) => m.name.startsWith('arrow_slit_')),
      'Watchtower with maxGarrison=2 has arrow slits'
    );
    assert.equal(
      btMeshes.some((m) => m.name.startsWith('arrow_slit_')),
      false,
      'Ballista Tower with maxGarrison=0 has NO arrow slits'
    );
  }

  // 4. Verify Workers Enter Building Through the Front Door on Resource Dropoff
  {
    sm.resetAllToDefaults();
    const gs = new GameState(engineConfig);
    gs.enemyAi.setMode('off');

    const workerComp = Array.from(gs.companies.values()).find(
      (c) => c.team === 1 && c.unitType === 'worker'
    );
    const citadel = Array.from(gs.constructionSystem.buildings.values()).find(
      (b) => b.team === 1 && b.type === 'citadel'
    );
    const tree = gs.economySystem.findNearestGrownTree(
      workerComp.anchorXFx,
      workerComp.anchorZFx,
      180 * 1024
    );
    assert.ok(workerComp && citadel && tree, 'Worker, Citadel, and Tree exist');

    const startWood = gs.economySystem.getTeamLedger(1).wood;
    gs.processCommands([
      {
        type: CommandTypes.GATHER_RESOURCE,
        payload: {
          team: 1,
          workerCompanyIds: [workerComp.id],
          xFx: tree.xFx,
          zFx: tree.zFx,
          queue: false
        }
      }
    ]);

    let sawEnteringDoorState = false;
    let sawBuildingDoorOpen = false;
    for (let t = 0; t < 1100; t++) {
      gs.stepTick([]);
      const task = gs.economySystem.companyGatherTasks.get(workerComp.id);
      if (task?.state === GathererState.ENTERING_DOOR) {
        sawEnteringDoorState = true;
      }
      if ((citadel.doorOpenTicks | 0) > 0) {
        sawBuildingDoorOpen = true;
      }
      if (gs.economySystem.getTeamLedger(1).wood > startWood) {
        break;
      }
    }

    assert.equal(sawEnteringDoorState, true, 'Workers entered GathererState.ENTERING_DOOR at the building doorway');
    assert.equal(sawBuildingDoorOpen, true, 'Building doorway opened while workers stepped inside to deposit');
    assert.equal(
      gs.economySystem.getTeamLedger(1).wood,
      startWood + 45,
      'Workers deposited configured carryCapacity (45 wood) after entering the door'
    );
  }

  // --- 3D Mount Rendering & Building Door Animation Verification ---
  const { ModelFactory } = await import('../../src/render/modelFactory.js');
  const mf = new ModelFactory(sm.unitsVisualsData);

  sm.setUnitMount('swordsman', 'human_horse');
  const horseMesh = mf.createVisual('swordsman', 'blue');
  assert(Boolean(horseMesh.userData.sockets.mount_torso), '3D Warhorse must spawn mount_torso socket');
  assert(Boolean(horseMesh.userData.sockets.mount_head), '3D Warhorse must spawn mount_head socket');
  assert(horseMesh.userData.sockets.pelvis.position.y > 1.3, 'Rider pelvis must be elevated onto Warhorse saddle');

  sm.setUnitMount('swordsman', 'katiler_wolf');
  const wolfMesh = mf.createVisual('swordsman', 'blue');
  assert(Boolean(wolfMesh.userData.sockets.mount_torso), '3D Dire Wolf must spawn mount_torso socket');
  assert(Boolean(wolfMesh.userData.sockets.mount_head), '3D Dire Wolf must spawn mount_head socket');
  assert(wolfMesh.userData.sockets.pelvis.position.y > 1.3, 'Rider pelvis must be elevated onto Dire Wolf saddle');

  sm.setUnitMount('swordsman', 'war_chameleon');
  const chamMesh = mf.createVisual('swordsman', 'blue');
  assert(Boolean(chamMesh.userData.sockets.mount_torso), '3D War Chameleon must spawn mount_torso socket');
  assert(Boolean(chamMesh.userData.sockets.mount_head), '3D War Chameleon must spawn mount_head socket');
  assert(chamMesh.userData.sockets.pelvis.position.y > 1.5, 'Rider pelvis must be elevated onto War Chameleon saddle');

  sm.setUnitMount('swordsman', 'none');
  const footMesh = mf.createVisual('swordsman', 'blue');
  assert(!footMesh.userData.sockets.mount_torso, 'Unmounted unit must not have mount_torso socket');
  assert(Math.abs(footMesh.userData.sockets.pelvis.position.y - 0.92) < 0.05, 'Unmounted unit pelvis must return to 0.92m');

  const bmf = new BuildingModelFactory();
  const bActor = bmf.createBuildingActor({ id: 'test_barracks', type: 'barracks', owner: 'player', x: 0, z: 0, level: 2, watchtowerLevel: 1 });
  assert(typeof bmf.updateDoorAnimation === 'function', 'BuildingModelFactory must provide updateDoorAnimation');
  bmf.updateDoorAnimation(bActor, true, 0.1);
  assert(bActor.doorOpenAmount > 0, 'updateDoorAnimation(true) must open building doors');
  bmf.updateDoorAnimation(bActor, false, 1.0);
  assert(bActor.doorOpenAmount === 0, 'updateDoorAnimation(false) must close building doors');

  // --- END-TO-END INTEGRATION SUITE ---
  const { loadUnitsBuildingsConfigFromStorage } = await import('../../src/tools/units_buildings/unitsBuildingsStateManager.js');
  const { buildCombinedVisualsData } = await import('../../src/tools/heroes/heroStateManager.js');
  const { getBuildingStudioClipsForBuilding, canBuildingRecruitUnits } = await import('../../src/tools/units_buildings/buildingStudioAdapter.js');
  const { processSimCommands } = await import('../../src/sim/commandHandlers.js');

  assert.equal(canBuildingRecruitUnits(sm.buildingsData.buildings.house), false, 'House must not be marked as recruiting');
  assert(!getBuildingStudioClipsForBuilding(sm.buildingsData.buildings.house).includes('recruit_spawn'), 'Non-recruiting House must NOT have recruit_spawn gate animation');
  assert.equal(canBuildingRecruitUnits(sm.buildingsData.buildings.barracks), true, 'Barracks must be marked as recruiting');
  assert(getBuildingStudioClipsForBuilding(sm.buildingsData.buildings.barracks).includes('recruit_spawn'), 'Recruiting Barracks must have recruit_spawn gate animation');

  const bldHtml = renderBuildingRightInspectorHtml(sm, 'barracks');
  assert(!bldHtml.includes('data-bld-opt-key="cost.coins"'), 'Building recruitment options must NOT show a Coins input');

  const e2eUnitId = sm.createNewUnit({
    id: 'e2e_royal_ranger',
    name: 'E2E Royal Ranger',
    baseCharId: 'human_base',
    mountType: 'none',
    weaponR: 'none',
    weaponL: 'bow'
  });
  const e2eVis = sm.unitsVisualsData.units[e2eUnitId];
  assert.equal(e2eVis.equipment?.quiver_back?.prefab, 'quiver', 'Equipping a bow must automatically attach quiver on quiver_back');
  const rangerMeshSet1 = mf.createVisual(e2eUnitId, 'blue');
  assert(Boolean(rangerMeshSet1.userData.attachedPrefabs?.quiver_back), 'ModelFactory 3D mesh must include attached quiver_back prefab when bow is equipped');

  e2eVis.loadouts = {
    loadout2: {
      label: 'Set 2',
      equipment: {
        ...JSON.parse(JSON.stringify(e2eVis.equipment || {})),
        weapon_socket_R: { prefab: 'spear', gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] },
        weapon_socket_L: { prefab: 'shield', gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] }
      }
    }
  };
  sm.setUnitPortraits(e2eUnitId, {
    recruitPortraitUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    squadCardIconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  });

  const leftUnitsHtml = renderUnitsLeftListHtml(sm, e2eUnitId);
  assert(leftUnitsHtml.includes(`data-delete-unit-row="${e2eUnitId}"`), 'Left unit list must render inline delete button per combat unit');
  assert(leftUnitsHtml.includes('id="ub-btn-delete-unit-left"'), 'Left unit list must render prominent Delete Selected Unit button');
  const rightUnitHtmlSet1 = renderUnitRightInspectorHtml(sm, e2eUnitId, 'main');
  assert(rightUnitHtmlSet1.includes('id="ub-btn-capture-recruit-portrait"') && rightUnitHtmlSet1.includes('id="ub-btn-capture-squad-icon"'), 'Unit inspector must render both Building Recruit Portrait and Multi-Squad Card Icon capture/upload controls');
  assert(rightUnitHtmlSet1.includes('data-unit-mode-toggle="fireAtWill"'), 'Unit inspector must render dynamic Combat Modes (Fire at Will)');

  sm.buildingsData.buildings.barracks.options.push({
    id: e2eUnitId,
    name: 'E2E Royal Ranger',
    kind: 'unit',
    unitType: e2eUnitId,
    unlockLevel: 1,
    trainTicks: 20,
    xpReward: 40
  });
  sm.saveAll();

  const { dataRegistry: simRegistry } = await import('../../src/data/dataRegistry.js');
  const gs = new GameState({ ...engineConfig, simSnapshot: simRegistry.getSimSnapshot() });
  gs.applySimConfig(simRegistry.getSimSnapshot());

  gs.constructionSystem.createBuilding({
    type: 'house',
    team: 1,
    xFx: 1960 * 1024,
    zFx: 1700 * 1024,
    instantComplete: true,
    bypassValidation: true
  });
  const bks = gs.constructionSystem.createBuilding({
    type: 'barracks',
    team: 1,
    xFx: 2000 * 1024,
    zFx: 1700 * 1024,
    instantComplete: true,
    bypassValidation: true
  });
  gs.economySystem.grantCheatResources(1, 5000);
  processSimCommands(gs, [
    {
      type: CommandTypes.QUEUE_PRODUCTION,
      payload: { team: 1, buildingId: bks.id, optionId: e2eUnitId }
    }
  ]);
  assert.equal(bks.productionQueue.length, 1, 'Custom unit must be accepted into Building productionQueue in Worker');
  assert.equal(bks.productionQueue[0].unitType, e2eUnitId, 'Queued item must preserve custom unitType');

  for (let t = 0; t < 45; t++) {
    gs.stepTick([]);
  }
  const spawnedComp = Array.from(gs.companies.values()).find((c) => c.unitType === e2eUnitId);
  assert(Boolean(spawnedComp), 'Custom unit company must spawn from the building into GameState');
  assert(spawnedComp.memberIds.length > 0, 'Custom unit company must spawn live soldier entities from the building door');
  assert.equal(spawnedComp.canFireAtWill(), true, 'Set 1 (Bow) must enable canFireAtWill on the spawned company');
  assert.equal(spawnedComp.hasSecondaryLoadout, true, 'Spawned company must detect Set 2 (hasSecondaryLoadout)');

  processSimCommands(gs, [
    {
      type: CommandTypes.SWITCH_COMPANY_WEAPON,
      payload: { team: 1, companyIds: [spawnedComp.id] }
    }
  ]);
  assert.equal(spawnedComp.activeLoadoutIdx, 1, 'SWITCH_COMPANY_WEAPON must switch company to Set 2 (activeLoadoutIdx = 1)');
  assert.equal(spawnedComp.activeWeaponMode, 'melee', 'Set 2 (Spear + Shield) must switch company activeWeaponMode to melee');
  assert.equal(spawnedComp.canFireAtWill(), false, 'Set 2 (Spear + Shield) must disable canFireAtWill');
  assert(spawnedComp.getAllowedFormations().includes('shieldWall') || spawnedComp.getAllowedFormations().includes('spearWall'), 'Set 2 (Spear + Shield) must unlock Shield Wall / Spear Wall formations');

  const snap = gs.packSnapshot();
  const compSnap = snap.economy.companyStates[spawnedComp.id];
  assert.equal(compSnap.unitType, e2eUnitId, 'packSnapshot companyStates must include custom unitType');
  assert.equal(compSnap.activeLoadoutIdx, 1, 'packSnapshot companyStates must include activeLoadoutIdx = 1');

  const combinedVis = buildCombinedVisualsData(sm.unitsVisualsData);
  assert(Boolean(combinedVis.units[e2eUnitId]), 'buildCombinedVisualsData must include custom unit Set 1 visual');
  assert(Boolean(combinedVis.units[`${e2eUnitId}__loadout2`]), 'buildCombinedVisualsData must generate __loadout2 visual variant for custom unit');

  // 7. Verify the 5 Previous Requests
  {
    const { getCombatBase, resolveClip } = await import("../../src/tools/studio/clipResolver.js");
    const { ensureKeyframeClip } = await import("../../src/tools/studio/clipEditing.js");
    const { asLoadout } = await import("../../src/tools/studio/weaponRules.js");
    const { Animator3D } = await import("../../src/render/animator3d.js");
    const { renderUnitSlotPreviewInnerHtml, resolveAutoUnitIconKey } = await import("../../src/ui/hud/unitIconsCatalog.js");

    assert.ok(
      sm.unitsVisualsData.animations?.keyframes?.switch_weapon?.tracks?.arm_R?.length > 0,
      "Request 1: switch_weapon keyframe animation must exist with upper-body tracks"
    );
    const animTestGroup = mf.createVisual(e2eUnitId, "blue");
    const testAnimator = new Animator3D(animTestGroup, sm.unitsVisualsData.animations, { entityId: 77 });
    const playedSw = testAnimator.playAction("switch_weapon", { restart: true, loop: false });
    assert.equal(playedSw, true, "Request 1: Animator3D.playAction(switch_weapon) must activate upperLayer");

    const set1Combat = getCombatBase(asLoadout(e2eVis, "main"), "human", sm.unitsVisualsData.prefabs);
    const set2Combat = getCombatBase(asLoadout(e2eVis, "loadout2"), "human", sm.unitsVisualsData.prefabs);
    assert.equal(set1Combat, "shoot_bow", "Request 2: Set 1 (Bow) must resolve shoot_bow");
    assert.equal(set2Combat, "attack_thrust", "Request 2: Set 2 (Spear) must resolve attack_thrust");
    assert.equal(
      combinedVis.units[`${e2eUnitId}__loadout2`]?.combatAnim,
      "attack_thrust",
      "Request 2: buildCombinedVisualsData __loadout2 must use attack_thrust for Spear Set 2"
    );

    const { clip: editedClip, name: editedClipName } = ensureKeyframeClip(
      sm.studioStateManager.data,
      e2eUnitId,
      "human",
      "shoot_bow",
      "unit",
      1
    );
    editedClip.duration = 0.63;
    sm.studioStateManager.saveDraft();
    sm.unitsVisualsData = sm.studioStateManager.data;
    sm.saveAll();
    const reloadedCfg = loadUnitsBuildingsConfigFromStorage();
    assert.equal(
      reloadedCfg.unitsVisualsData.animations.keyframes[editedClipName]?.duration,
      0.63,
      "Request 3: Animation edited in Studio for a unit must persist in storage and live config"
    );
    assert.equal(
      resolveClip(reloadedCfg.unitsVisualsData, e2eUnitId, "human", "shoot_bow"),
      editedClipName,
      "Request 3: resolveClip must resolve the saved custom unit animation"
    );

    const customIconId = sm.addCustomPlaceholderIcon({
      label: "Golden Eagle",
      dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    });
    assert.ok(customIconId, "Request 4: addCustomPlaceholderIcon must add icon to shared library");
    sm.setUnitPortraits(e2eUnitId, {
      recruitPortraitUrl: null,
      recruitIconKey: "archer",
      squadCardIconUrl: null,
      squadCardIconKey: customIconId,
      placeholderIconUrl: null,
      placeholderIconKey: "auto",
      placeholderIconUrlSet2: null,
      placeholderIconKeySet2: "auto"
    });
    const recruitPreviewHtml = renderUnitSlotPreviewInnerHtml(
      sm.unitStatsData.units[e2eUnitId],
      "recruit",
      sm.unitStatsData.customPlaceholderIcons,
      e2eUnitId
    );
    const squadPreviewHtml = renderUnitSlotPreviewInnerHtml(
      sm.unitStatsData.units[e2eUnitId],
      "squad",
      sm.unitStatsData.customPlaceholderIcons,
      e2eUnitId
    );
    assert.ok(recruitPreviewHtml.includes("<svg"), "Request 4: Default icon selection must render visual <svg>, not English text");
    assert.ok(squadPreviewHtml.includes("<img"), "Request 4: Custom library icon selection must render visual <img> across any slot");

    // 8. Verify New Requests:
    // (A) 2 Map Placement Icons per Gear Set (Bow in Set 1 -> 'archer', Spear+Shield in Set 2 -> 'spearman')
    const iconKeySet1 = resolveAutoUnitIconKey(sm.unitStatsData.units[e2eUnitId], e2eUnitId, ["bow"], 0);
    const iconKeySet2 = resolveAutoUnitIconKey(sm.unitStatsData.units[e2eUnitId], e2eUnitId, ["spear", "shield"], 1);
    assert.equal(iconKeySet1, "archer", "Per-Gear-Set Map Icon: Set 1 (Bow) resolves to archer icon");
    assert.equal(iconKeySet2, "spearman", "Per-Gear-Set Map Icon: Set 2 (Spear+Shield) resolves to spearman icon");

    // (B) Fire at Will strictly disabled when holding a Sword / melee weapon
    const { computeCapabilitiesForLoadout } = await import("../../src/sim/combatCapabilitiesRegistry.js");
    const swordCaps = computeCapabilitiesForLoadout(
      { id: "swordsman", combatModes: ["fireAtWill"] }, // Even if savedModes had fireAtWill!
      sm.unitsVisualsData.units.swordsman,
      sm.unitsVisualsData,
      "main"
    );
    const fireAtWillModeOnSword = swordCaps.modes.find((m) => m.id === "fireAtWill");
    assert.equal(fireAtWillModeOnSword.eligible, false, "Fire at Will must be ineligible when holding a sword");
    assert.equal(fireAtWillModeOnSword.enabled, false, "Fire at Will must be disabled when holding a sword");

    // (C) Building animations synced with live game (including victory_cheer)
    bmf.updateBuildingLiveState(bActor, { isConstructing: false, hpRatio: 1.0, playVictoryCheer: true }, 0.25);
    assert.equal(bActor._activeClipKey, "building_victory_cheer", "BuildingModelFactory must play building_victory_cheer when playVictoryCheer is active");

    // (D) Unity-Style 3D Map Editor (Sculpting, Biomes, Resource Skins, Decorative Props & Live Game Sync)
    const {
      RESOURCE_SKINS_CATALOG,
      DECORATIVE_PROPS_CATALOG,
      setActiveCustomMapState,
      getActiveCustomMapState,
      createTreeMeshBySkin,
      createMineMeshBySkin,
      createDecorativePropMesh,
      parseWavefrontObjToVertices
    } = await import("../../src/tools/map_editor/mapStateManager.js");
    const { MapEditorApp } = await import("../../src/tools/map_editor/mapEditorApp.js");
    const { sampleTerrainHeightFx } = await import("../../src/sim/nav/grid.js");
    const { generateDeterministicTreesFx, generateDeterministicMinesFx } = await import("../../src/sim/world/worldGen.js");

    assert.ok(RESOURCE_SKINS_CATALOG.wood.length >= 6, "Wood resource has 6 distinct tree skins");
    assert.ok(RESOURCE_SKINS_CATALOG.coins.length >= 3, "Coins resource has 3 distinct gold mine skins");
    assert.ok(RESOURCE_SKINS_CATALOG.iron.length >= 3, "Iron resource has 3 distinct iron mine skins");
    assert.ok(RESOURCE_SKINS_CATALOG.stone.length >= 3, "Stone resource has 3 distinct stone quarry skins");
    assert.ok(DECORATIVE_PROPS_CATALOG.length >= 10, "Decorative Props catalog has 10 built-in 3D props");

    const editor = new MapEditorApp(null);
    editor.sculptMode = "flatten";
    editor.flattenTargetHeight = 12.5;
    editor.brushRadius = 64;
    editor.brushStrength = 1.0;
    editor.applyTerrainBrushAt(1024, 1024, 0.2);

    editor.activeResourceType = "wood";
    editor.activeResourceSkins.wood = "autumn_gold";
    editor.resourcePlacementMode = "single";
    editor.placeOrScatterResourceAt(1500, 1500);

    editor.activeResourceType = "coins";
    editor.activeResourceSkins.coins = "gold_crystals";
    editor.placeOrScatterResourceAt(1600, 1600);

    editor.activePropType = "statue_king";
    editor.placeOrEraseDecorativePropAt(1700, 1700);

    editor.mapState.isCustomMapActive = true;
    setActiveCustomMapState(editor.mapState);

    assert.ok(getActiveCustomMapState()?.isCustomMapActive, "Custom map state is active");
    const sculptedH = sampleTerrainHeightFx(1024 * 1024, 1024 * 1024, false, 4096) / 1024;
    assert.ok(Math.abs(sculptedH - 12.5) < 0.5, "sampleTerrainHeightFx reflects sculpted custom map elevation (12.5m)");

    const customTrees = generateDeterministicTreesFx({}, 4096);
    assert.ok(customTrees.some((t) => t.skinId === "autumn_gold"), "generateDeterministicTreesFx preserves selected tree skinId (autumn_gold)");

    const customMines = generateDeterministicMinesFx(4096);
    assert.ok(customMines.some((m) => m.skinId === "gold_crystals"), "generateDeterministicMinesFx preserves selected mine skinId (gold_crystals)");

    const treeMesh = createTreeMeshBySkin("palm_oasis", 1.2);
    const mineMesh = createMineMeshBySkin("coins", "gold_crystals", 1.0, 0);
    const propMesh = createDecorativePropMesh({ propType: "statue_king", scale: 1.0 });
    assert.ok(treeMesh.children.length > 0 && mineMesh.children.length > 0 && propMesh.children.length > 0, "3D meshes created for custom skins & props");

    const objVerts = parseWavefrontObjToVertices("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3");
    assert.equal(objVerts.length, 9, "Wavefront .OBJ parser extracts triangle vertices for custom 3D prop uploads");

    // Verify Blank Flat Map, Clear All Resources, Saved Maps List, Visual Skin SVG, Ghost Rotation & Candidate Spawn Points
    const {
      createBlankFlatMapState,
      saveMapToLibrary,
      getSavedMapsList,
      renderSkinVisualThumbnailSvg
    } = await import("../../src/tools/map_editor/mapStateManager.js");

    const skinSvg = renderSkinVisualThumbnailSvg("wood", RESOURCE_SKINS_CATALOG.wood[0]);
    assert.ok(skinSvg.includes("<svg"), "Visual skin thumbnail renders pure SVG without text clutter");

    editor.rotateActiveGhostBy(45);
    assert.equal(editor.resourceRotDeg, 45, "Ghost rotation hotkey/method rotates active object by 45 deg");

    editor.clearAllResources();
    assert.equal(editor.mapState.trees.length, 0, "Clear All Resources removes all trees");
    assert.equal(editor.mapState.mines.length, 0, "Clear All Resources removes all mines");
    // Sculpted terrain height at (1024, 1024) must remain untouched after clearing resources!
    assert.ok(Math.abs(editor.getVertexHeight(64 * 257 + 64) - 12.5) < 0.5, "Clearing/deleting resources never alters sculpted terrain");

    const flatMap = createBlankFlatMapState("Test Clean Flat Battlefield");
    setActiveCustomMapState(flatMap);
    const flatHCenter = sampleTerrainHeightFx(2048 * 1024, 2048 * 1024, false, 4096) / 1024;
    const flatHCorner = sampleTerrainHeightFx(512 * 1024, 3200 * 1024, false, 4096) / 1024;
    assert.ok(Math.abs(flatHCenter - 1.6) < 0.01, "Blank Flat Map has uniform 1.6m elevation at center (no river)");
    assert.ok(Math.abs(flatHCorner - 1.6) < 0.01, "Blank Flat Map has uniform 1.6m elevation at corners (no hills)");

    editor._loadMapStateIntoEditor(flatMap);
    editor.activeMainTab = "world";
    editor.spawnToolMode = "place";
    editor.spawnRotDeg = 90;
    editor.placeOrEraseSpawnPointAt(900, 900);
    assert.equal(editor.mapState.spawnPoints.length, 3, "Candidate spawn point added to mapState.spawnPoints");

    saveMapToLibrary(editor.mapState);
    assert.ok(getSavedMapsList().some((m) => m.name === "Test Clean Flat Battlefield"), "Saved Maps Library persists custom maps");

    // Verify 4-Spawn-Point Match Setup (1 Base + 2 Worker Squads per Spawn Point, Multi-AI Difficulties & Zero Combat Squads)
    editor.placeOrEraseSpawnPointAt(3100, 3100);
    assert.equal(editor.mapState.spawnPoints.length, 4, "Map now has 4 candidate spawn points");

    const { buildDefaultMatchSetupForMap } = await import("../../src/ui/lobby/matchSetupManager.js");
    const matchSetup4 = buildDefaultMatchSetupForMap(editor.mapState);
    assert.equal(matchSetup4.participants.length, 4, "Match Setup creates 4 slots for a 4-spawn-point map");
    matchSetup4.participants[0].role = "player";
    matchSetup4.participants[0].controller = "player";
    matchSetup4.participants[0].team = 1;
    matchSetup4.participants[1].role = "ai_ally";
    matchSetup4.participants[1].controller = "ai";
    matchSetup4.participants[1].team = 1;
    matchSetup4.participants[1].aiDifficulty = "easy";
    matchSetup4.participants[2].role = "ai_enemy";
    matchSetup4.participants[2].controller = "ai";
    matchSetup4.participants[2].team = 2;
    matchSetup4.participants[2].aiDifficulty = "normal";
    matchSetup4.participants[3].role = "ai_enemy";
    matchSetup4.participants[3].controller = "ai";
    matchSetup4.participants[3].team = 2;
    matchSetup4.participants[3].aiDifficulty = "hard";

    const gsLobby = new GameState({ ...engineConfig, matchSetup: matchSetup4 });
    const citadelsLobby = Array.from(gsLobby.constructionSystem.buildings.values()).filter((b) => b.type === "citadel");
    const allCompaniesLobby = Array.from(gsLobby.companies.values());
    assert.equal(citadelsLobby.length, 4, "Each of the 4 active spawn points spawns 1 Starting Base (Citadel)");
    assert.equal(allCompaniesLobby.length, 8, "Each of the 4 active spawn points spawns strictly 2 Worker Squads (8 total)");
    assert.ok(allCompaniesLobby.every((c) => c.unitType === "worker"), "Match starts purely with Worker Squads (0 pre-spawned combat squads)");
    assert.equal(gsLobby.aiControllers.length, 3, "3 AI controllers created (1 Ally + 2 Enemies)");
    assert.deepEqual(
      gsLobby.aiControllers.map((a) => a.difficulty),
      ["easy", "normal", "hard"],
      "Each AI slot receives its configured AI difficulty level"
    );

    // Verify Smooth Color Blending, Visual Paint Swatch SVG, 2-Point Stretch Bridge, Map Size Control & Zero-Jump Incremental Eraser
    const { renderPaintBrushThumbnailSvg, TERRAIN_BIOME_LAYERS } = await import("../../src/tools/map_editor/mapStateManager.js");
    const { isOnWalkableBridgeDeckFx } = await import("../../src/sim/nav/grid.js");

    const paintSvg = renderPaintBrushThumbnailSvg(TERRAIN_BIOME_LAYERS[3]);
    assert.ok(paintSvg.includes("<svg"), "Paint brush thumbnail renders visual SVG swatch");

    // Smooth color blending at 25% strength vs 100% strength
    editor.brushRadius = 32;
    editor.brushFalloff = "flat";
    editor.useCustomPaintHex = true;
    editor.customPaintHex = "#ff0000";
    editor.brushStrength = 0.25;
    editor.applyBiomePaintAt(512, 512);
    const vIdx512 = 32 * 257 + 32;
    const rgb25 = editor.mapState.colorOverrides[vIdx512];
    assert.ok(Array.isArray(rgb25) && rgb25[0] > 0.3 && rgb25[0] < 0.9, "25% brush strength creates intermediate faded/blended RGB");

    editor.brushStrength = 1.0;
    editor.applyBiomePaintAt(512, 512);
    const rgb100 = editor.mapState.colorOverrides[vIdx512];
    assert.ok(rgb100[0] > rgb25[0], "100% brush strength blends stronger than 25% brush strength");

    // 2-Point Stretch Bridge (diagonal from (1000, 1000) to (1060, 1080) -> length 100m, center (1030, 1040))
    editor.bridgeWidth = 20;
    editor.placeBridgeBetweenPoints({ x: 1000, z: 1000 }, { x: 1060, z: 1080 });
    const stretchedBridge = editor.mapState.bridges[editor.mapState.bridges.length - 1];
    assert.equal(stretchedBridge.x, 1030, "Stretched bridge center X is midpoint (1030)");
    assert.equal(stretchedBridge.z, 1040, "Stretched bridge center Z is midpoint (1040)");
    assert.equal(stretchedBridge.length, 100, "Stretched bridge length is hypot(60, 80) = 100m");
    setActiveCustomMapState({ ...editor.mapState, isCustomMapActive: true });
    assert.equal(
      isOnWalkableBridgeDeckFx(1030 * 1024, 1040 * 1024, 2048),
      true,
      "Rotated stretched bridge is walkable on NavGrid"
    );

    // Zero-Jump Incremental Eraser: place 3 trees at (400,400), (600,600), (800,800), erase only (400,400), verify others untouched
    editor.activeResourceType = "wood";
    editor.resourcePlacementMode = "single";
    editor.placeOrScatterResourceAt(400, 400);
    editor.placeOrScatterResourceAt(600, 600);
    editor.placeOrScatterResourceAt(800, 800);
    const uid600 = editor.mapState.trees.find((t) => t.x === 600 && t.z === 600)?.uid;
    const uid800 = editor.mapState.trees.find((t) => t.x === 800 && t.z === 800)?.uid;
    editor.resourcePlacementMode = "erase";
    editor.brushRadius = 25;
    editor.placeOrScatterResourceAt(400, 400);
    assert.equal(editor.mapState.trees.some((t) => t.x === 400 && t.z === 400), false, "Tree inside eraser radius removed");
    assert.equal(editor.mapState.trees.find((t) => t.uid === uid600)?.x, 600, "Tree at (600,600) outside eraser radius did not move");
    assert.equal(editor.mapState.trees.find((t) => t.uid === uid800)?.x, 800, "Tree at (800,800) outside eraser radius did not move");

    // Verify Visual Brush Shapes (SVG + Square/Diamond/Star math), Physical Map Size, Fixed-Row Team Lobby & Allied Vision Sharing
    const { BRUSH_SHAPES_CATALOG, renderBrushShapeSvg } = await import("../../src/tools/map_editor/mapStateManager.js");
    const { computeBrushShapeDistRatio } = await import("../../src/tools/map_editor/mapEditorApp.js");
    const { normalizeParticipantTeams } = await import("../../src/ui/lobby/matchSetupManager.js");
    const { FowState } = await import("../../src/sim/systems/visionSystem.js");

    assert.ok(BRUSH_SHAPES_CATALOG.length >= 5, "Brush shapes catalog includes circle, flat, square, diamond, star");
    assert.ok(renderBrushShapeSvg("star").includes("<svg"), "Brush shape renders visual SVG");
    assert.ok(computeBrushShapeDistRatio(18, 18, 20, "square") <= 1.0, "Square brush covers corners within radius");
    assert.ok(computeBrushShapeDistRatio(15, 15, 20, "diamond") > 1.0, "Diamond brush excludes outer diagonal corners");

    // Fixed-row Team Number normalization & Allied Shared Vision
    const teamSetup = buildDefaultMatchSetupForMap(editor.mapState);
    assert.equal(teamSetup.participants[0].role, "player", "Row 0 is always human player");
    if (teamSetup.participants[1]) {
      teamSetup.participants[1].teamNumber = 3;
      teamSetup.participants[0].teamNumber = 3;
      normalizeParticipantTeams(teamSetup.participants);
      assert.equal(teamSetup.participants[0].team, 1, "Player team maps to sim team 1");
      assert.equal(teamSetup.participants[1].team, 1, "Ally with matching teamNumber shares sim team 1");
      assert.equal(teamSetup.participants[1].role, "ai_ally", "Ally role inferred from shared teamNumber");

      const gsAlly = new GameState({ ...engineConfig, matchSetup: teamSetup });
      const allyX = Math.round(teamSetup.participants[1].x);
      const allyZ = Math.round(teamSetup.participants[1].z);
      const cellX = gsAlly.visionSystem.worldFxToCellX(allyX * 1024);
      const cellZ = gsAlly.visionSystem.worldFxToCellZ(allyZ * 1024);
      const fowVal = gsAlly.visionSystem.fowGridTeam1[cellZ * gsAlly.visionSystem.gridSize + cellX];
      assert.equal(fowVal, FowState.VISIBLE, "Ally on same teamNumber shares Fog-of-War vision with player");
    }

    // Reset custom map state so other tests run against default map
    setActiveCustomMapState(null);
  }

  sm.deleteUnit(e2eUnitId);

  console.log('  [PASS] All Units/Buildings Lab Fixes, Per-Set Map Icons, Sword FireAtWill Lock, Building Sync & 3D Map Editor Verified!');
  return 'PASS: Units & Buildings Lab, Per-Set Map Icons, Building Sync & 3D Map Editor';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runUnitsBuildingsLabAndDoorTests();
}
