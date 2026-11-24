/**
 * Kings Lands — Unified 3D Model Provider (src/render/modelProvider.js)
 *
 * Owns the single shared `ModelFactory` and `BuildingModelFactory` instances for the entire
 * application (Battlefield SceneManager, Units & Buildings Lab, Hall of Heroes, Animation Studio,
 * and WorkerPlacementController), and automatically rebuilds/invalidates caches whenever
 * `dataRegistry` changes so units, buildings, and heroes look identical everywhere for the same skin.
 */

import { ModelFactory } from './modelFactory.js';
import { BuildingModelFactory } from './buildingModelFactory.js';
import { dataRegistry } from '../data/dataRegistry.js';
import { applySkinColors, getFactionColors } from '../tools/studio/skinUtils.js';
import { MAIN_LOADOUT, equipmentOf } from '../tools/studio/weaponRules.js';

let _combinedVisuals = dataRegistry.getCombinedVisuals();
const _modelFactory = new ModelFactory(_combinedVisuals);
const _buildingModelFactory = new BuildingModelFactory();
const _subscribers = new Set();

function syncFactoriesFromRegistry() {
  _combinedVisuals = dataRegistry.getCombinedVisuals();
  _modelFactory.visualsData = _combinedVisuals;

  const buildingsSource = dataRegistry.getBuildings();
  const buildingVisualsSource = dataRegistry.getBuildingVisuals();
  const skinsSource = { buildingSkins: dataRegistry.getBuildingSkins() };

  _buildingModelFactory.setDataSources({
    buildingsSource,
    buildingVisualsSource,
    skinsSource
  });
  _buildingModelFactory.clearCaches();
}

syncFactoriesFromRegistry();

dataRegistry.subscribe((event) => {
  syncFactoriesFromRegistry();
  for (const cb of _subscribers) {
    try {
      cb({
        ...event,
        combinedVisuals: _combinedVisuals,
        modelFactory: _modelFactory,
        buildingModelFactory: _buildingModelFactory
      });
    } catch (err) {
      console.warn('[ModelProvider] Subscriber notification error:', err);
    }
  }
});

export function getModelFactory() {
  return _modelFactory;
}

export function getBuildingModelFactory() {
  return _buildingModelFactory;
}

export function getCombinedVisuals() {
  return _combinedVisuals;
}

export function subscribe(cb) {
  if (typeof cb === 'function') _subscribers.add(cb);
  return () => _subscribers.delete(cb);
}

/**
 * Resolves and constructs a 3D unit mesh group using the single shared `ModelFactory`.
 * Options: { skin, team, level, loadoutId, equipmentOverride, isBannerCarrier, isAlly, customTeamColors, visualsOverride }
 */
export function createUnitModel(
  id,
  {
    skin = null,
    team = 1,
    level = 1,
    loadoutId = null,
    equipmentOverride = null,
    isBannerCarrier = false,
    isAlly = false,
    customTeamColors = undefined,
    visualsOverride = null
  } = {}
) {
  const activeVisuals = visualsOverride || _combinedVisuals;
  const uStat = dataRegistry.getUnitStats(id);
  const unitDef = activeVisuals?.units?.[id] || activeVisuals?.units?.swordsman;
  const effectiveSkin =
    skin === 'default'
      ? unitDef?.race || uStat?.race || 'human'
      : skin ||
        (uStat?.activeSkin && uStat.activeSkin !== 'default'
          ? uStat.activeSkin
          : unitDef?.race || uStat?.race || 'human');

  const resolvedColors =
    customTeamColors !== undefined
      ? customTeamColors
      : getFactionColors(activeVisuals, effectiveSkin);

  const prevVisuals = _modelFactory.visualsData;
  const prevEq = unitDef ? unitDef.equipment : undefined;
  let nextEq = prevEq;
  if (unitDef) {
    if (equipmentOverride) {
      nextEq = equipmentOverride;
    } else if (loadoutId && loadoutId !== MAIN_LOADOUT) {
      nextEq = equipmentOf(unitDef, loadoutId) || prevEq;
    }
  }

  let group;
  try {
    if (visualsOverride) {
      _modelFactory.visualsData = visualsOverride;
    }
    if (unitDef && nextEq !== prevEq) {
      unitDef.equipment = nextEq;
    }
    group = _modelFactory.createVisual(id, {
      teamId: team,
      isAlly,
      isBannerCarrier,
      customTeamColors: resolvedColors
    });
  } finally {
    if (unitDef && nextEq !== prevEq) {
      unitDef.equipment = prevEq;
    }
    _modelFactory.visualsData = prevVisuals;
  }

  if (unitDef) {
    applySkinColors(group, unitDef, effectiveSkin);
  }
  if (group?.userData) {
    group.userData.skinId = effectiveSkin;
    group.userData.level = Math.max(1, level | 0 || 1);
  }
  return group;
}

/**
 * Constructs a 3D building actor using the single shared `BuildingModelFactory`.
 * Options: { skin, level, team, isGhost, isAlly, isCompleted, hasWatchtower, doorOpen, footprintRadiusMeters, hp, maxHp, x, y, z, buildingDefOverride }
 */
export function createBuildingModel(
  id,
  {
    skin = null,
    level = 1,
    team = 1,
    isGhost = false,
    isAlly = false,
    isCompleted = true,
    hasWatchtower = undefined,
    doorOpen = false,
    footprintRadiusMeters = null,
    hp = null,
    maxHp = null,
    x = undefined,
    y = undefined,
    z = undefined,
    buildingDefOverride = null
  } = {}
) {
  const bDef = buildingDefOverride || dataRegistry.getBuilding(id) || {
    id,
    footprintRadiusMeters: 5,
    maxHp: 1200
  };
  const resolvedLevel = Math.max(1, level | 0 || 1);
  const resolvedHasWt =
    hasWatchtower !== undefined
      ? Boolean(hasWatchtower)
      : bDef.hasWatchtowerSupport !== false &&
        (Boolean(bDef.hasBuiltInTurret) ||
          ((bDef.watchtowerLevel | 0) > 0 && resolvedLevel >= Math.max(1, bDef.watchtowerLevel | 0)));

  const bldState = {
    id: 1,
    type: id,
    team,
    level: resolvedLevel,
    footprintRadiusMeters: footprintRadiusMeters ?? bDef.footprintRadiusMeters ?? 5,
    isCompleted: Boolean(isCompleted),
    hasWatchtower: resolvedHasWt,
    isDoorOpen: Boolean(doorOpen),
    hp: hp ?? bDef.maxHp ?? 1200,
    maxHp: maxHp ?? bDef.maxHp ?? 1200,
    ...(typeof x === 'number' ? { x } : {}),
    ...(typeof y === 'number' ? { y } : {}),
    ...(typeof z === 'number' ? { z } : {})
  };

  const actor = _buildingModelFactory.createBuildingActor(bldState, {
    isGhost,
    isAlly,
    skinId: skin && skin !== 'default' ? skin : skin === 'default' ? 'default' : null
  });

  if (!isGhost && typeof _buildingModelFactory.updateBuildingLiveState === 'function') {
    _buildingModelFactory.updateBuildingLiveState(actor, bldState, bDef, 0.05);
  }
  return actor;
}

/**
 * Constructs a 3D hero mesh group using the single shared `ModelFactory`.
 * Options: { skin, team, loadoutId, isMounted, isBannerCarrier, isAlly, customTeamColors, visualsOverride }
 */
export function createHeroModel(
  id,
  {
    skin = null,
    team = 1,
    loadoutId = null,
    isMounted = false,
    isBannerCarrier = false,
    isAlly = false,
    customTeamColors = undefined,
    visualsOverride = null
  } = {}
) {
  const activeVisuals = visualsOverride || _combinedVisuals;
  const heroDef = activeVisuals?.heroes?.[id] || dataRegistry.getHero(id) || activeVisuals?.units?.[id];
  let visualKey = id;
  if (isMounted && activeVisuals?.units?.[`${id}__mounted`]) {
    visualKey = `${id}__mounted`;
  } else if (loadoutId && loadoutId !== MAIN_LOADOUT && activeVisuals?.units?.[`${id}__loadout2`]) {
    visualKey = `${id}__loadout2`;
  }
  const unitDef = activeVisuals?.units?.[visualKey] || heroDef;
  const effectiveSkin =
    skin === 'default'
      ? heroDef?.race || unitDef?.race || 'human'
      : skin ||
        (heroDef?.activeSkin && heroDef.activeSkin !== 'default'
          ? heroDef.activeSkin
          : heroDef?.race || unitDef?.race || 'human');

  const resolvedColors =
    customTeamColors !== undefined
      ? customTeamColors
      : getFactionColors(activeVisuals, effectiveSkin);

  const prevVisuals = _modelFactory.visualsData;
  let group;
  try {
    if (visualsOverride) {
      _modelFactory.visualsData = visualsOverride;
    }
    group = _modelFactory.createVisual(visualKey, {
      teamId: team,
      isAlly,
      isBannerCarrier,
      customTeamColors: resolvedColors
    });
  } finally {
    _modelFactory.visualsData = prevVisuals;
  }

  if (unitDef) {
    applySkinColors(group, unitDef, effectiveSkin);
  }
  if (group?.userData) {
    group.userData.skinId = effectiveSkin;
    group.userData.heroId = id;
  }
  return group;
}

export const modelProvider = {
  getModelFactory,
  getBuildingModelFactory,
  getCombinedVisuals,
  subscribe,
  createUnitModel,
  createBuildingModel,
  createHeroModel
};
