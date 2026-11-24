/**
 * Kings Lands — Cross-Lab Pure Synchronization Helpers (src/tools/labSync.js)
 *
 * Pure, Three-free, DOM-free synchronization logic shared across:
 * 1. Animation Studio (`StudioApp`) — owns factions view, base character look, skins, clothing prefabs, keyframes & portraits
 * 2. Units & Buildings Lab (`UnitsBuildingsLabApp`) — owns unit creation, stats, hand weapons, mounts, and buildings
 * 3. Hall of Heroes (`HallOfHeroesApp`) — owns hero roster, class templates, stats, and spell trees
 */

import { DEFAULT_BASE_CHAR_ID, resolveBaseCharId } from './studio/baseUnitsMigration.js';
import { getFactions, getFactionLabel, isSharedUnitsFaction } from './studio/skinUtils.js';

export const NON_COMBAT_VISUAL_BASE_IDS = new Set([
  'human_base_1',
  'human_base_2',
  'katiler_base',
  'mirukenkay_base',
  'almasir_base',
  'takdik_base',
  'nefrolai_base',
  'katiler_wolf',
  'human_horse',
  'war_chameleon',
  'sisnat_chameleon'
]);

export function isNonCombatBaseOrMountVisual(id, unitVis = null) {
  if (!id) return true;
  if (NON_COMBAT_VISUAL_BASE_IDS.has(id)) return true;
  if (unitVis?.isBaseTemplate || unitVis?.isMount) return true;
  return false;
}

/**
 * Registers default combat stats in `unitStatsData.units[unitId]` when a new unit model
 * is imported in Animation Studio (so it immediately appears and is configurable in Units Lab).
 * Never overwrites existing unit stats, and skips base templates, mounts, and buildings.
 */
export function ensureUnitStatsForVisualUnit(unitStatsData, unitsVisualsData, unitId, unitVis = null) {
  const vis = unitVis || unitsVisualsData?.units?.[unitId];
  if (!unitStatsData || !unitStatsData.units || !unitId || !vis) return false;
  if (vis.isBuildingEntity || vis.isHero) return false;
  if (unitStatsData.units[unitId]) return false;
  if (!vis.importInfo) return false;
  if (isNonCombatBaseOrMountVisual(unitId, vis)) return false;

  const race = vis.race || 'human';
  const defaultStats = {
    id: unitId,
    name: vis.displayName || unitId,
    race,
    baseCharId: unitId,
    activeSkin: race,
    mountType: vis.mountHierarchy ? 'human_horse' : 'none',
    isMounted: Boolean(vis.mountHierarchy),
    isRanged: false,
    isWorker: false,
    isSiege: false,
    squadSize: 20,
    popCost: 20,
    visionRangeMeters: 96,
    hp: 135,
    mass: 90,
    speedMetersPerSec: 4.2,
    runSpeedMultPermille: 1450,
    staminaRunDrainPerTick: 2,
    radiusMeters: 0.57,
    meleeDamage: 15,
    meleeAttackRangeMeters: 2.0,
    vsBuildingDamage: 10,
    armor: 10,
    meleeBlockRating: 35,
    missileBlockRating: 35,
    windupTicks: 6,
    reloadMinTicks: 14,
    reloadMaxTicks: 22,
    bracingPermille: 1000,
    antiChargePermille: 0,
    chargeBonusDamage: 8,
    rangedDamage: 0,
    attackRangeMeters: 2.0,
    maxAmmo: 0,
    accuracy: 78,
    scatterRadiusMeters: 1.2,
    cost: { coins: 150, wood: 0, stone: 0, iron: 20 },
    allowedFormations: ['square'],
    allowedModes: ['hold_fire', 'fire_at_will'],
    blacksmithBonuses: { forged_blades: 20, heavy_plate: 20, bodkin_arrows: 0, barding: 0 }
  };

  unitStatsData.units[unitId] = defaultStats;
  if (Array.isArray(unitStatsData._deletedUnits)) {
    unitStatsData._deletedUnits = unitStatsData._deletedUnits.filter((x) => x !== unitId);
  }
  return true;
}

/**
 * Cleanly deletes a unit across `unitStatsData`, `unitsVisualsData`, and building recruitment options.
 */
export function removeUnitAcrossLabs(unitStatsData, unitsVisualsData, buildingsData, unitId) {
  if (!unitId) return false;
  let removed = false;
  if (unitStatsData?.units?.[unitId]) {
    delete unitStatsData.units[unitId];
    removed = true;
  }
  if (unitsVisualsData?.units?.[unitId]) {
    delete unitsVisualsData.units[unitId];
    removed = true;
  }
  if (buildingsData?.buildings) {
    for (const bDef of Object.values(buildingsData.buildings)) {
      if (Array.isArray(bDef?.options)) {
        bDef.options = bDef.options.filter((opt) => !(opt.kind === 'unit' && opt.id === unitId));
      }
    }
  }
  return removed;
}

/**
 * Returns selectable base characters in Animation Studio for `unitId`.
 * Includes same-race built-in templates AND same-race Studio-imported `.glb` unit models.
 */
export function listStudioBaseChoices(unitsVisualsData, unitStatsData, unitId, baseTemplates = []) {
  const unitsVis = unitsVisualsData?.units || {};
  const uStat = unitStatsData?.units?.[unitId];
  const uVis = unitsVis[unitId];
  if (!uStat && !uVis) return [];

  const rawBase = uStat?.baseCharId || uStat?.baseModel;
  const resolvedBase = rawBase ? resolveBaseCharId(rawBase, rawBase) : null;
  const unitRace = uStat?.race || uVis?.race || 'human';
  const curId =
    resolvedBase && (baseTemplates.some((b) => b.id === resolvedBase) || unitsVis[resolvedBase]?.importInfo)
      ? resolvedBase
      : baseTemplates.find((b) => b.race === unitRace)?.id || DEFAULT_BASE_CHAR_ID;

  const curTemplate = baseTemplates.find((b) => b.id === curId);
  const curImported = unitsVis[curId]?.importInfo ? unitsVis[curId] : null;
  if (!curTemplate && !curImported) return [];
  if (uStat?.isSiege || uVis?.isBuildingEntity || uVis?.isHero) return [];

  const activeRace = curTemplate?.race || curImported?.race || unitRace || 'human';
  const out = [];
  const seen = new Set();

  for (const b of baseTemplates) {
    if (b.race !== activeRace) continue;
    if (!unitsVis[b.id]?.hierarchy) continue;
    seen.add(b.id);
    out.push({
      id: b.id,
      label: b.label,
      race: b.race,
      bare: Boolean(b.bare),
      isImported: false,
      current: b.id === curId
    });
  }

  for (const [uid, vis] of Object.entries(unitsVis)) {
    if (seen.has(uid) || !vis?.importInfo || vis.isBuildingEntity || !vis.hierarchy) continue;
    const impRace = vis.race || activeRace;
    if (impRace !== activeRace && vis.race) continue;
    seen.add(uid);
    out.push({
      id: uid,
      label: `${vis.displayName || uid} (Imported GLB)`,
      race: impRace,
      bare: false,
      isImported: true,
      current: uid === curId
    });
  }

  return out;
}

/**
 * Dynamically merges built-in cosmetic dropdown options with any clothing/gear prefabs
 * registered in `unitsVisualsData.prefabs` (including `.glb` gear imported in Studio).
 */
export function listCosmeticOptionsForSlot(
  unitsVisualsData,
  slotKind,
  race = 'human',
  currentId = 'none',
  builtInOptions = []
) {
  const prefabs = unitsVisualsData?.prefabs || {};
  const isPaired = slotKind === 'shoulder' || slotKind === 'boots';
  const out = [];
  const seen = new Set();

  for (const opt of builtInOptions) {
    if (!seen.has(opt.id)) {
      seen.add(opt.id);
      out.push({ id: opt.id, label: opt.label });
    }
  }

  if (!seen.has('none')) {
    seen.add('none');
    out.unshift({ id: 'none', label: 'None' });
  }

  for (const [pid, pf] of Object.entries(prefabs)) {
    if (!pf) continue;
    if (pf.slot !== slotKind) continue;
    if (pf.race && race && pf.race !== race) continue;

    const baseId = isPaired ? pid.replace(/_(R|L)$/, '') : pid;
    if (seen.has(baseId)) continue;
    seen.add(baseId);
    const rawLabel = pf.name ? pf.name.replace(/\s*\([RL]\)\s*$/i, '').trim() : baseId;
    const suffix = pf.importInfo ? ' [Studio GLB]' : '';
    out.push({ id: baseId, label: `${rawLabel}${suffix}` });
  }

  if (currentId && currentId !== 'none' && !seen.has(currentId)) {
    const pf = prefabs[currentId] || prefabs[`${currentId}_R`];
    const lbl = pf?.name ? pf.name.replace(/\s*\([RL]\)\s*$/i, '').trim() : currentId;
    out.push({ id: currentId, label: `${lbl} [Studio]` });
  }

  return out;
}

/**
 * Discovers selectable visual skins/looks for a unit in Units Lab
 * (combines unit's Studio-authored `skins` and dynamic factions from `units.json`).
 */
export function listSkinsForUnit(unitsVisualsData, unitVis, unitStat = null) {
  const factions = getFactions(unitsVisualsData);
  const customKeys = Object.keys(unitVis?.skins || {});
  const mergedKeys = [...new Set([...factions, ...customKeys])];
  const defaultRace = unitStat?.race || unitVis?.race || 'human';

  const out = [{ id: 'default', label: `Default (${getFactionLabel(unitsVisualsData, defaultRace)})` }];
  for (const fk of mergedKeys) {
    if (!fk) continue;
    const hasCustomColors = Boolean(
      unitVis?.skins?.[fk]?.colorOverrides && Object.keys(unitVis.skins[fk].colorOverrides).length > 0
    );
    const baseLbl = getFactionLabel(unitsVisualsData, fk);
    out.push({
      id: fk,
      label: hasCustomColors ? `${baseLbl} (Studio Look)` : baseLbl
    });
  }
  return out;
}

/**
 * Pure faction entity filter for Animation Studio's Left Panel across Units, Heroes, and Buildings.
 */
export function filterStudioEntitiesForFaction(unitsMap = {}, category = 'units', faction = 'human', unitsData = {}) {
  const keys = Object.keys(unitsMap || {});
  if (category === 'buildings') {
    const matching = keys.filter((id) => {
      const r = unitsMap[id]?.race;
      return !r || r === faction;
    });
    return matching.length > 0 ? matching : keys;
  }

  if (category === 'heroes') {
    const usesShared = isSharedUnitsFaction(unitsData, faction);
    const matching = keys.filter((id) => {
      const r = unitsMap[id]?.race;
      if (r) return r === faction;
      return usesShared || faction === 'human';
    });
    return matching.length > 0 ? matching : keys;
  }

  const usesShared = isSharedUnitsFaction(unitsData, faction);
  const raceOf = (id) => {
    const explicit = unitsMap[id]?.race;
    if (explicit) return explicit;
    if (/^katiler/.test(id)) return 'katiler';
    if (/^mirukenkay/.test(id)) return 'mirukenkay';
    return null;
  };
  return keys.filter((id) => {
    const race = raceOf(id);
    return race ? race === faction : usesShared;
  });
}
