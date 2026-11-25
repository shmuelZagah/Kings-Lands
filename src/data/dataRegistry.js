/**
 * Kings Lands — Single Game Data Registry (src/data/dataRegistry.js)
 *
 * The ONLY module that reads/writes game data and persists user overrides in localStorage:
 *   - units (assembled from src/data/races/** + bases/** + shared/**, see src/data/DATA_LAYOUT.md)
 *   - bases (derived dynamically from units data — no hardcoded template lists)
 *   - gear / prefabs (units + heroes prefabs)
 *   - animations (units, buildings, heroes keyframes & procedural clips)
 *   - skins (unit faction/look skins & imported building skins)
 *   - races / factions
 *   - buildings (src/data/shared/buildings.json + buildingVisuals.json)
 *   - heroes (src/data/races/<race>/heroes.json + shared/heroesMeta.json)
 *
 * Every getter returns deep-cloned data (never a mutable shared object).
 * Every save / transaction runs full cross-reference & structural validation (`validateRegistryState`)
 * and rejects invalid references with a clear error message before committing.
 * localStorage (`kings_lands_data_registry_draft_v1`) stores compact overrides-only by id with
 * file version stamps, migrating all legacy draft keys automatically without dropping user work.
 */

import { defaultUnitsVisuals } from './defaults.js';
import { defaultUnitStats } from './defaults.js';
import { defaultBuildingsData } from './defaults.js';
import { defaultBuildingVisuals } from './defaults.js';
import { defaultHeroesData } from './defaults.js';
import { sanitizeUnitsData, registerDefaultUnitsVisuals } from '../tools/studio/clipEditing.js';
import { restow, loadoutsOf, MAIN_LOADOUT } from '../tools/studio/weaponRules.js';
import { computeCapabilitiesForLoadout } from '../sim/combatCapabilitiesRegistry.js';
import { ensureUnitStatsForVisualUnit, removeUnitAcrossLabs } from '../tools/labSync.js';
import { validateRegistryState } from '../tools/studio/healthCheck.js';
import { buildSimSnapshot } from '../sim/simConfig.js';
import { BASE_ONLY_RACE_IDS } from './dataLayout.js';

registerDefaultUnitsVisuals(defaultUnitsVisuals);

export const DRAFT_STORAGE_KEY = 'kings_lands_data_registry_draft_v1';

export const LEGACY_STORAGE_KEYS = Object.freeze({
  STUDIO_DRAFT_V3: 'kings_lands_studio_draft_v3',
  STUDIO_DRAFT_V1: 'kings_lands_studio_draft',
  UNIT_STATS: 'kings_lands_unit_stats_v2',
  BUILDINGS_DATA: 'kings_lands_buildings_data_v2',
  BUILDING_VISUALS: 'kings_lands_building_visuals_v2',
  BUILDING_SKINS: 'kings_lands_building_skins_v1',
  HEROES_DATA: 'kings_lands_heroes_data_v10'
});

// ------------------------------------------------------------------ Base migration exports (folded from baseUnitsMigration.js)

export const DEFAULT_BASE_CHAR_ID = 'human_base_1';
export const LEGACY_BASE_ALIASES = Object.freeze({ human_base: 'human_base_1' });
export const MANAGED_BASE_IDS = Object.freeze(['human_base_1', 'human_base_2', 'mirukenkay_base_2']);
export const RETIRED_UNIT_IDS = Object.freeze([
  'mirukenkay_light',
  'mirukenkay_medium',
  'mirukenkay_heavy',
  'mirukenkay_royal'
]);
export const RETIRED_PREFAB_RE = /^$^/; // nothing is retired any more (the mirukenkay_gb_* armour prefabs are shipped data)

export function resolveBaseCharId(id, fallback = DEFAULT_BASE_CHAR_ID) {
  if (!id) return fallback;
  return LEGACY_BASE_ALIASES[id] || id;
}

function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Fast deep clone for game data. Large mesh arrays (vertices / faces / indices / colors / normals / uvs with >= 32
 * entries) are IMMUTABLE BLOBS: they are shared by reference instead of copied (they are only ever replaced, never
 * edited in place - nothing in the code base mutates them). That makes cloning the 8 MB units data ~10x faster than
 * structuredClone / JSON round-trips while every other value is still copied.
 */
const BLOB_KEYS = new Set(['vertices', 'faces', 'indices', 'colors', 'normals', 'uvs']);
const BLOB_MIN = 32;

function cloneData(v, key) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    if (key !== undefined && v.length >= BLOB_MIN && BLOB_KEYS.has(key)) return v;
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = cloneData(v[i]);
    return out;
  }
  if (ArrayBuffer.isView(v)) return v;
  const out = {};
  for (const k in v) {
    if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = cloneData(v[k], k);
  }
  return out;
}

function deepClone(obj) {
  if (obj === undefined || obj === null) return obj;
  return cloneData(obj);
}

function stableEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const aa = Array.isArray(a);
  if (aa !== Array.isArray(b)) return false;
  if (aa) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!stableEqual(a[i], b[i])) return false;
    return true;
  }
  let na = 0;
  for (const k in a) {
    if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
    na++;
    if (!stableEqual(a[k], b[k])) return false;
    if (!(k in b)) return false;
  }
  let nb = 0;
  for (const k in b) if (Object.prototype.hasOwnProperty.call(b, k)) nb++;
  return na === nb;
}

function hasMeshShape(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node.meshes) && node.meshes.some((m) => m && (m.shape === 'mesh' || m.shape === 'custom_mesh'))) {
    return true;
  }
  if (node.children && hasMeshShape(node.children)) return true;
  if (node.hierarchy && hasMeshShape(node.hierarchy)) return true;
  for (const [k, c] of Object.entries(node)) {
    if (k === 'meshes' || k === 'children' || k === 'hierarchy' || k === 'pos' || k === 'rot' || k === 'scale') continue;
    if (c && typeof c === 'object' && hasMeshShape(c)) return true;
  }
  return false;
}

const _hashCache = new WeakMap();

export function computeManagedHashes(shipped) {
  if (!shipped?.units) return {};
  let out = _hashCache.get(shipped.units);
  if (!out) {
    out = {};
    for (const id of MANAGED_BASE_IDS) {
      if (shipped.units[id]) out[id] = hashString(JSON.stringify(shipped.units[id]));
    }
    _hashCache.set(shipped.units, out);
  }
  return out;
}

function isStaleManaged(id, cur, shipped, recorded) {
  const sh = shipped.units[id];
  if (!sh || !cur) return false;
  const shHash = computeManagedHashes(shipped)[id];
  if (recorded && recorded[id]) return recorded[id] !== shHash;
  if (id === 'human_base_2' || id === 'mirukenkay_base_2') return true;
  return hasMeshShape(cur) && !hasMeshShape(sh);
}

export function migrateDraftData(data, shipped, recorded = null) {
  const notes = [];
  if (!data || !data.units || !shipped?.units) return notes;

  if (data.units.human_base && !shipped.units.human_base) {
    const cur1 = data.units.human_base_1;
    if (!cur1 || isStaleManaged('human_base_1', cur1, shipped, recorded)) {
      data.units.human_base_1 = { ...data.units.human_base, id: 'human_base_1' };
      if (
        shipped.units.human_base_1?.displayName &&
        /^human base( character)?$/i.test(String(data.units.human_base.displayName || ''))
      ) {
        data.units.human_base_1.displayName = shipped.units.human_base_1.displayName;
      }
      notes.push('human_base → human_base_1');
    }
    delete data.units.human_base;
  }
  for (const id of RETIRED_UNIT_IDS) {
    if (data.units[id] && !shipped.units[id]) {
      delete data.units[id];
      notes.push(`removed ${id}`);
    }
  }
  if (data.prefabs) {
    let n = 0;
    for (const id of Object.keys(data.prefabs)) {
      if (RETIRED_PREFAB_RE.test(id) && !shipped.prefabs?.[id]) {
        delete data.prefabs[id];
        n++;
      }
    }
    if (n) notes.push(`removed ${n} retired prefab(s)`);
  }

  for (const id of MANAGED_BASE_IDS) {
    const sh = shipped.units[id];
    if (!sh) continue;
    const cur = data.units[id];
    if (!cur || isStaleManaged(id, cur, shipped, recorded)) {
      data.units[id] = deepClone(sh);
      notes.push(`${id} refreshed`);
    }
  }
  return notes;
}

export function pruneDraftForRuntime(draft, shipped, recorded = null) {
  const units = {};
  const prefabs = {};
  if (!draft) return { units, prefabs };
  for (const [id, u] of Object.entries(draft.units || {})) {
    if (!shipped?.units) {
      units[id] = u;
      continue;
    }
    if (id === 'human_base' && !shipped.units.human_base) continue;
    if (RETIRED_UNIT_IDS.includes(id) && !shipped.units[id]) continue;
    if (MANAGED_BASE_IDS.includes(id) && isStaleManaged(id, u, shipped, recorded)) continue;
    units[id] = u;
  }
  for (const [id, p] of Object.entries(draft.prefabs || {})) {
    if (RETIRED_PREFAB_RE.test(id) && !shipped?.prefabs?.[id]) continue;
    prefabs[id] = p;
  }
  return { units, prefabs };
}

// ------------------------------------------------------------------ Immutable Shipped Baselines (captured once at module load)

const BASELINE_UNITS_VISUALS = deepClone(defaultUnitsVisuals);
try {
  sanitizeUnitsData(BASELINE_UNITS_VISUALS);
} catch (_) {}
const BASELINE_UNIT_STATS = deepClone(defaultUnitStats);
const BASELINE_BUILDINGS = deepClone(defaultBuildingsData);
const BASELINE_BUILDING_VISUALS = deepClone(defaultBuildingVisuals);
const BASELINE_HEROES = deepClone(defaultHeroesData);
const BASELINE_BUILDING_SKINS = deepClone(BASELINE_UNITS_VISUALS.buildingSkins || {});

export const FILE_VERSIONS = Object.freeze({
  unitsVisuals: `${BASELINE_UNITS_VISUALS.version ?? '1'}:${hashString(JSON.stringify(defaultUnitsVisuals))}`,
  unitStats: `${BASELINE_UNIT_STATS.version ?? '1'}:${hashString(JSON.stringify(defaultUnitStats))}`,
  buildings: `${BASELINE_BUILDINGS.version ?? '1'}:${hashString(JSON.stringify(defaultBuildingsData))}`,
  buildingVisuals: `${BASELINE_BUILDING_VISUALS.version ?? '1'}:${hashString(JSON.stringify(defaultBuildingVisuals))}`,
  heroes: `${BASELINE_HEROES.version ?? '1'}:${hashString(JSON.stringify(defaultHeroesData))}`
});

const LEGACY_SPELL_ID_ALIASES = Object.freeze({
  iron_skin: 'iron_blood',
  cleave_strike: 'shockwave_slam',
  berserk: 'wind_stride',
  arcane_shield: 'self_heal',
  revive_fallen: 'royal_sanctuary'
});

const normalizeSpellId = (spellId) => (spellId ? LEGACY_SPELL_ID_ALIASES[spellId] || spellId : null);
const r4 = (n) => Math.round(Number(n) * 10000) / 10000;

normalizeAndSyncBundle(
  {
    unitsVisuals: BASELINE_UNITS_VISUALS,
    unitStats: BASELINE_UNIT_STATS,
    buildings: BASELINE_BUILDINGS,
    buildingVisuals: BASELINE_BUILDING_VISUALS,
    buildingSkins: BASELINE_BUILDING_SKINS,
    heroes: BASELINE_HEROES
  },
  { syncUnitVisualFromStats: true }
);

const MANAGED_HIER_STR = Object.fromEntries(
  MANAGED_BASE_IDS
    .filter((id) => BASELINE_UNITS_VISUALS.units?.[id]?.hierarchy)
    .map((id) => [id, JSON.stringify(BASELINE_UNITS_VISUALS.units[id].hierarchy)])
);

// ------------------------------------------------------------------ Normalization & Cross-Sync Helpers

function isBaseUnitEntry(id, uDef) {
  if (!id || !uDef || typeof uDef !== 'object') return false;
  if (uDef.isBuildingEntity || uDef.isHero || uDef.isMount) return false;
  if (uDef.isBaseTemplate === true || uDef.isBaseCharacter === true) return true;
  if (/_base(_\d+)?$/.test(id)) return true;
  if (uDef.importInfo) return true;
  return false;
}

function baseEntryToMeta(id, uDef) {
  const bare = uDef.bare !== undefined ? Boolean(uDef.bare) : Boolean(hasMeshShape(uDef.hierarchy) && !uDef.importInfo);
  const label = uDef.importInfo
    ? `${uDef.displayName || id} (Imported GLB)`
    : (uDef.displayName || id);
  return {
    id,
    race: uDef.race || 'human',
    label,
    bare,
    isImported: Boolean(uDef.importInfo)
  };
}

function sanitizeHeroParameters(h) {
  if (!h || typeof h !== 'object') return;
  h.isHero = true;
  if (h.portraitDataUrl && h.portraitVersion !== 3) {
    delete h.portraitDataUrl;
  }
  if (h.parameters) {
    if (h.parameters.visionRange === undefined) {
      h.parameters.visionRange = h.heroClass === 'archer' ? 120 : h.heroClass === 'wizard' ? 100 : 96;
    }
    if (h.parameters.accuracy === undefined) {
      h.parameters.accuracy = h.heroClass === 'archer' ? 90 : h.heroClass === 'wizard' ? 88 : 85;
    }
    if (h.parameters.trainTimeSec === undefined) h.parameters.trainTimeSec = 10;
    if (h.parameters.reviveBaseTimeSec === undefined) h.parameters.reviveBaseTimeSec = 8;
    if (h.parameters.hpPerLevel === undefined) h.parameters.hpPerLevel = 45;
    if (h.parameters.damagePerLevel === undefined) h.parameters.damagePerLevel = 6;
    if (h.parameters.armorPerLevel === undefined) h.parameters.armorPerLevel = 2;
    if (h.parameters.attackSpeedPctPerLevel === undefined) h.parameters.attackSpeedPctPerLevel = 4;
    if (h.parameters.moveSpeedPctPerLevel === undefined) h.parameters.moveSpeedPctPerLevel = 2;
  }
  if (Array.isArray(h.spellSchedule)) {
    for (let i = 0; i < h.spellSchedule.length; i++) {
      const slot = h.spellSchedule[i];
      if (slot && slot.spellId) slot.spellId = normalizeSpellId(slot.spellId);
    }
  }
}

function normalizeAndSyncBundle(bundle, { syncUnitVisualFromStats = true } = {}) {
  const unitsVisuals = bundle.unitsVisuals;
  const unitStats = bundle.unitStats;
  const buildings = bundle.buildings;
  const buildingVisuals = bundle.buildingVisuals;
  const heroes = bundle.heroes;

  if (!unitsVisuals.factions) unitsVisuals.factions = {};
  if (!unitsVisuals.teamPalettes) unitsVisuals.teamPalettes = {};
  if (!unitsVisuals.prefabs) unitsVisuals.prefabs = {};
  if (!unitsVisuals.units) unitsVisuals.units = {};
  if (!unitsVisuals.animations) unitsVisuals.animations = { keyframes: {}, procedural: {} };
  if (!unitsVisuals.animations.keyframes) unitsVisuals.animations.keyframes = {};
  if (!unitsVisuals.animations.procedural) unitsVisuals.animations.procedural = {};

  if (!unitStats.units) unitStats.units = {};
  if (!buildings.buildings) buildings.buildings = {};
  if (!buildingVisuals.animations) buildingVisuals.animations = { keyframes: {}, procedural: {} };
  if (!heroes.heroes) heroes.heroes = {};

  const deletedSet = new Set(unitStats._deletedUnits || []);
  for (const [vid, vDef] of Object.entries(unitsVisuals.units)) {
    if (deletedSet.has(vid)) continue;
    ensureUnitStatsForVisualUnit(unitStats, unitsVisuals, vid, vDef);
  }

  for (const [uid, uStat] of Object.entries(unitStats.units)) {
    if (!uStat || typeof uStat !== 'object') continue;
    if (!uStat.mountType) uStat.mountType = uStat.isMounted ? 'human_horse' : 'none';
    if (!uStat.visionRangeMeters) uStat.visionRangeMeters = uStat.isRanged ? 112 : uStat.isMounted ? 118 : 96;
    if (!uStat.blacksmithBonuses) {
      uStat.blacksmithBonuses = {
        forged_blades: 20,
        heavy_plate: 20,
        bodkin_arrows: uStat.isRanged ? 25 : 0,
        barding: uStat.isMounted ? 25 : 0
      };
    }

    if (uStat.baseCharId) {
      uStat.baseCharId = resolveBaseCharId(uStat.baseCharId, uStat.baseCharId);
    }

    // Bootstrap missing visual for units that have unitStats (e.g. shipped `ballista` referencing self)
    if (!unitsVisuals.units[uid] && syncUnitVisualFromStats) {
      const candidateBase = resolveBaseCharId(uStat.baseCharId || uStat.baseModel, DEFAULT_BASE_CHAR_ID);
      const effectiveBaseId =
        unitsVisuals.units[candidateBase]
          ? candidateBase
          : candidateBase === uid
            ? DEFAULT_BASE_CHAR_ID
            : null;
      if (effectiveBaseId && unitsVisuals.units[effectiveBaseId]) {
        const cloned = deepClone(unitsVisuals.units[effectiveBaseId]);
        cloned.displayName = uStat.name || uid;
        if (uStat.race) cloned.race = uStat.race;
        unitsVisuals.units[uid] = cloned;
        if (uStat.baseCharId === uid) {
          uStat.baseCharId = effectiveBaseId;
        }
      }
    } else if (unitsVisuals.units[uid]) {
      unitsVisuals.units[uid].displayName = uStat.name || unitsVisuals.units[uid].displayName || uid;
    }

    const visDef = unitsVisuals.units[uid];
    if (visDef) {
      if (uStat.isMounted || (uStat.mountType && uStat.mountType !== 'none')) {
        visDef.isMounted = true;
      }
      const compatData = {
        ...unitsVisuals,
        prefabs: { ...(unitsVisuals.prefabs || {}), ...(heroes.prefabs || {}) }
      };
      restow(compatData, visDef);
      if (!uStat.loadoutCapabilities) uStat.loadoutCapabilities = {};
      for (const ld of loadoutsOf(visDef)) {
        const caps = computeCapabilitiesForLoadout(uStat, visDef, compatData, ld.id);
        uStat.loadoutCapabilities[ld.id] = {
          allowedFormations: caps.allowedFormations,
          allowedModes: caps.allowedModes
        };
        if (ld.id === MAIN_LOADOUT) {
          uStat.allowedFormations = caps.allowedFormations;
          uStat.allowedModes = caps.allowedModes;
        }
      }
    }
  }

  for (const bDef of Object.values(buildings.buildings)) {
    if (!bDef || typeof bDef !== 'object') continue;
    if (bDef.hasWatchtowerSupport === undefined) {
      bDef.hasWatchtowerSupport = (bDef.watchtowerLevel | 0) > 0 || Boolean(bDef.hasBuiltInTurret);
    }
    if (!Array.isArray(bDef.turretOffset)) bDef.turretOffset = [0, 8.0, 0];
    if (!Array.isArray(bDef.options)) continue;
    for (const opt of bDef.options) {
      if (opt && opt.kind === 'unit') {
        const targetUid = opt.unitType || opt.id;
        if (targetUid && unitStats.units[targetUid]) {
          const uStat = unitStats.units[targetUid];
          if (!opt.unitType || opt.unitType === opt.id) {
            opt.name = uStat.name || opt.name;
          }
          if (uStat.cost && opt.id === targetUid) {
            opt.cost = deepClone(uStat.cost);
          }
        }
      }
    }
  }

  for (const h of Object.values(heroes.heroes)) {
    sanitizeHeroParameters(h);
  }
}

// ------------------------------------------------------------------ Sync live shipped module exports (keeps untouched `src/sim/` working)

function syncMap(target, source) {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const k of Object.keys(source)) {
    if (!stableEqual(target[k], source[k])) target[k] = deepClone(source[k]);
  }
}

function syncValue(target, key, value) {
  if (!stableEqual(target[key], value)) target[key] = deepClone(value);
}

function syncRuntimeModuleExports(bundle) {
  const { unitStats, buildings, unitsVisuals, buildingVisuals, heroes } = bundle;
  // Only entries that really differ are copied (equality short-circuits on shared mesh blobs), so a one-skin
  // change no longer re-clones every unit, prefab and building.

  if (unitStats?.formationRules) syncValue(defaultUnitStats, 'formationRules', unitStats.formationRules);
  if (unitStats?.units) {
    defaultUnitStats.units = defaultUnitStats.units || {};
    syncMap(defaultUnitStats.units, unitStats.units);
  }

  if (buildings?.economy) {
    defaultBuildingsData.economy = defaultBuildingsData.economy || {};
    for (const [k, v] of Object.entries(buildings.economy)) syncValue(defaultBuildingsData.economy, k, v);
  }
  if (buildings?.sharedBuildingWatchtower) {
    syncValue(defaultBuildingsData, 'sharedBuildingWatchtower', buildings.sharedBuildingWatchtower);
  }
  if (buildings?.buildings) {
    defaultBuildingsData.buildings = defaultBuildingsData.buildings || {};
    syncMap(defaultBuildingsData.buildings, buildings.buildings);
  }

  if (unitsVisuals?.units) {
    defaultUnitsVisuals.units = defaultUnitsVisuals.units || {};
    syncMap(defaultUnitsVisuals.units, unitsVisuals.units);
  }
  if (unitsVisuals?.prefabs) {
    defaultUnitsVisuals.prefabs = defaultUnitsVisuals.prefabs || {};
    syncMap(defaultUnitsVisuals.prefabs, unitsVisuals.prefabs);
  }
  if (unitsVisuals?.factions) syncValue(defaultUnitsVisuals, 'factions', unitsVisuals.factions);
  if (unitsVisuals?.teamPalettes) syncValue(defaultUnitsVisuals, 'teamPalettes', unitsVisuals.teamPalettes);
  if (unitsVisuals?.arrowConfig) syncValue(defaultUnitsVisuals, 'arrowConfig', unitsVisuals.arrowConfig);
  if (unitsVisuals?.actionRules) syncValue(defaultUnitsVisuals, 'actionRules', unitsVisuals.actionRules);
  if (unitsVisuals?.animations?.keyframes) {
    defaultUnitsVisuals.animations = defaultUnitsVisuals.animations || {};
    const tgt = defaultUnitsVisuals.animations.keyframes || (defaultUnitsVisuals.animations.keyframes = {});
    for (const [k, v] of Object.entries(unitsVisuals.animations.keyframes)) syncValue(tgt, k, v);
  }
  if (unitsVisuals?.animations?.procedural) {
    defaultUnitsVisuals.animations = defaultUnitsVisuals.animations || {};
    const tgt = defaultUnitsVisuals.animations.procedural || (defaultUnitsVisuals.animations.procedural = {});
    for (const [k, v] of Object.entries(unitsVisuals.animations.procedural)) syncValue(tgt, k, v);
  }

  if (buildingVisuals?.animations) {
    syncValue(defaultBuildingVisuals, 'animations', buildingVisuals.animations);
  }
  if (heroes?.heroes) {
    defaultHeroesData.heroes = defaultHeroesData.heroes || {};
    syncMap(defaultHeroesData.heroes, heroes.heroes);
  }
}

// ------------------------------------------------------------------ Diff & Compact Overrides Serialization

function computeMapDiff(currentMap = {}, baselineMap = {}) {
  const modified = {};
  const deleted = [];
  for (const [id, val] of Object.entries(currentMap)) {
    if (!stableEqual(val, baselineMap[id])) {
      modified[id] = deepClone(val);
    }
  }
  for (const id of Object.keys(baselineMap)) {
    if (!(id in currentMap)) {
      deleted.push(id);
    }
  }
  return { modified, deleted };
}

function compactBuildingSkins(skins = {}) {
  const compact = {};
  for (const [bid, e] of Object.entries(skins || {})) {
    if (!e || typeof e !== 'object') continue;
    const itemEntries = Object.entries(e.items || {});
    if (!itemEntries.length && (!e.active || e.active === 'default')) continue;
    const items = {};
    for (const [sid, it] of itemEntries) {
      if (!it?.mesh) continue;
      items[sid] = {
        ...it,
        mesh: {
          vertices: (it.mesh.vertices || []).map((v) => [r4(v[0]), r4(v[1]), r4(v[2])]),
          faces: it.mesh.faces,
          colors: it.mesh.colors
        }
      };
    }
    compact[bid] = { active: e.active || 'default', items };
  }
  return compact;
}

function buildOverridesPayload(bundle) {
  const overrides = {};

  // 1. unitsVisuals overrides
  const uv = bundle.unitsVisuals;
  const buv = BASELINE_UNITS_VISUALS;
  const uvOv = {};

  const unitsDiff = computeMapDiff(uv.units, buv.units);
  const compactUnits = {};
  const sharedHierarchies = {};
  const omittedUnits = [];

  for (const uid of MANAGED_BASE_IDS) {
    if (uv.units[uid] && stableEqual(uv.units[uid], buv.units[uid])) {
      omittedUnits.push(uid);
    }
  }

  for (const [uid, udef] of Object.entries(unitsDiff.modified)) {
    if (
      udef?.hierarchy &&
      MANAGED_HIER_STR.human_base_2 &&
      JSON.stringify(udef.hierarchy) === MANAGED_HIER_STR.human_base_2
    ) {
      const { hierarchy: _omitted, ...rest } = udef;
      compactUnits[uid] = rest;
      sharedHierarchies[uid] = 'human_base_2';
    } else {
      compactUnits[uid] = udef;
    }
  }
  if (Object.keys(compactUnits).length) uvOv.units = compactUnits;
  if (unitsDiff.deleted.length) uvOv.deletedUnits = unitsDiff.deleted;
  if (Object.keys(sharedHierarchies).length) uvOv.sharedHierarchies = sharedHierarchies;
  if (omittedUnits.length) uvOv.omittedUnits = omittedUnits;

  const prefabsDiff = computeMapDiff(uv.prefabs, buv.prefabs);
  if (Object.keys(prefabsDiff.modified).length) uvOv.prefabs = prefabsDiff.modified;
  if (prefabsDiff.deleted.length) uvOv.deletedPrefabs = prefabsDiff.deleted;

  const factionsDiff = computeMapDiff(uv.factions, buv.factions);
  if (Object.keys(factionsDiff.modified).length) uvOv.factions = factionsDiff.modified;
  if (factionsDiff.deleted.length) uvOv.deletedFactions = factionsDiff.deleted;

  if (!stableEqual(uv.teamPalettes, buv.teamPalettes)) uvOv.teamPalettes = deepClone(uv.teamPalettes);
  if (!stableEqual(uv.arrowConfig, buv.arrowConfig)) uvOv.arrowConfig = deepClone(uv.arrowConfig);
  if (!stableEqual(uv.actionRules, buv.actionRules)) uvOv.actionRules = deepClone(uv.actionRules);

  const kfDiff = computeMapDiff(uv.animations?.keyframes, buv.animations?.keyframes);
  const procDiff = computeMapDiff(uv.animations?.procedural, buv.animations?.procedural);
  if (
    Object.keys(kfDiff.modified).length ||
    kfDiff.deleted.length ||
    Object.keys(procDiff.modified).length ||
    procDiff.deleted.length
  ) {
    uvOv.animations = {};
    if (Object.keys(kfDiff.modified).length) uvOv.animations.keyframes = kfDiff.modified;
    if (kfDiff.deleted.length) uvOv.animations.deletedKeyframes = kfDiff.deleted;
    if (Object.keys(procDiff.modified).length) uvOv.animations.procedural = procDiff.modified;
    if (procDiff.deleted.length) uvOv.animations.deletedProcedural = procDiff.deleted;
  }
  if (Object.keys(uvOv).length) overrides.unitsVisuals = uvOv;

  // 2. unitStats overrides
  const us = bundle.unitStats;
  const bus = BASELINE_UNIT_STATS;
  const usOv = {};
  const statsDiff = computeMapDiff(us.units, bus.units);
  if (Object.keys(statsDiff.modified).length) usOv.units = statsDiff.modified;
  if (statsDiff.deleted.length) usOv.deletedUnits = statsDiff.deleted;
  if (Array.isArray(us._deletedUnits) && us._deletedUnits.length) {
    usOv._deletedUnits = deepClone(us._deletedUnits);
  }
  if (!stableEqual(us.formationRules, bus.formationRules)) {
    usOv.formationRules = deepClone(us.formationRules);
  }
  if (Array.isArray(us.customPlaceholderIcons) && us.customPlaceholderIcons.length) {
    usOv.customPlaceholderIcons = deepClone(us.customPlaceholderIcons);
  }
  if (Object.keys(usOv).length) overrides.unitStats = usOv;

  // 3. buildings overrides
  const bld = bundle.buildings;
  const bbld = BASELINE_BUILDINGS;
  const bOv = {};
  const bDiff = computeMapDiff(bld.buildings, bbld.buildings);
  if (Object.keys(bDiff.modified).length) bOv.buildings = bDiff.modified;
  if (bDiff.deleted.length) bOv.deletedBuildings = bDiff.deleted;
  if (!stableEqual(bld.economy, bbld.economy)) bOv.economy = deepClone(bld.economy);
  if (!stableEqual(bld.sharedBuildingWatchtower, bbld.sharedBuildingWatchtower)) {
    bOv.sharedBuildingWatchtower = deepClone(bld.sharedBuildingWatchtower);
  }
  if (Object.keys(bOv).length) overrides.buildings = bOv;

  // 4. buildingVisuals overrides
  const bv = bundle.buildingVisuals;
  const bbv = BASELINE_BUILDING_VISUALS;
  const bvKfDiff = computeMapDiff(bv.animations?.keyframes, bbv.animations?.keyframes);
  const bvProcDiff = computeMapDiff(bv.animations?.procedural, bbv.animations?.procedural);
  if (
    Object.keys(bvKfDiff.modified).length ||
    bvKfDiff.deleted.length ||
    Object.keys(bvProcDiff.modified).length ||
    bvProcDiff.deleted.length
  ) {
    overrides.buildingVisuals = { animations: {} };
    if (Object.keys(bvKfDiff.modified).length) overrides.buildingVisuals.animations.keyframes = bvKfDiff.modified;
    if (bvKfDiff.deleted.length) overrides.buildingVisuals.animations.deletedKeyframes = bvKfDiff.deleted;
    if (Object.keys(bvProcDiff.modified).length) overrides.buildingVisuals.animations.procedural = bvProcDiff.modified;
    if (bvProcDiff.deleted.length) overrides.buildingVisuals.animations.deletedProcedural = bvProcDiff.deleted;
  }

  // 5. buildingSkins overrides
  const compactedSkins = compactBuildingSkins(bundle.buildingSkins);
  if (!stableEqual(compactedSkins, BASELINE_BUILDING_SKINS)) {
    overrides.buildingSkins = compactedSkins;
  }

  // 6. heroes overrides
  const h = bundle.heroes;
  const bh = BASELINE_HEROES;
  const hOv = {};
  const hDiff = computeMapDiff(h.heroes, bh.heroes);
  if (Object.keys(hDiff.modified).length) hOv.heroes = hDiff.modified;
  if (hDiff.deleted.length) hOv.deletedHeroes = hDiff.deleted;
  const hpDiff = computeMapDiff(h.prefabs, bh.prefabs);
  if (Object.keys(hpDiff.modified).length) hOv.prefabs = hpDiff.modified;
  if (hpDiff.deleted.length) hOv.deletedPrefabs = hpDiff.deleted;
  const hKfDiff = computeMapDiff(h.animations?.keyframes, bh.animations?.keyframes);
  const hProcDiff = computeMapDiff(h.animations?.procedural, bh.animations?.procedural);
  if (
    Object.keys(hKfDiff.modified).length ||
    hKfDiff.deleted.length ||
    Object.keys(hProcDiff.modified).length ||
    hProcDiff.deleted.length
  ) {
    hOv.animations = {};
    if (Object.keys(hKfDiff.modified).length) hOv.animations.keyframes = hKfDiff.modified;
    if (hKfDiff.deleted.length) hOv.animations.deletedKeyframes = hKfDiff.deleted;
    if (Object.keys(hProcDiff.modified).length) hOv.animations.procedural = hProcDiff.modified;
    if (hProcDiff.deleted.length) hOv.animations.deletedProcedural = hProcDiff.deleted;
  }
  if (!stableEqual(h.spellTrees, bh.spellTrees)) hOv.spellTrees = deepClone(h.spellTrees);
  if (!stableEqual(h.hybridSpells, bh.hybridSpells)) hOv.hybridSpells = deepClone(h.hybridSpells);
  if (Object.keys(hOv).length) overrides.heroes = hOv;

  return {
    v: 1,
    fileVersions: { ...FILE_VERSIONS },
    managedHashes: computeManagedHashes(BASELINE_UNITS_VISUALS),
    savedAt: Date.now(),
    overrides
  };
}

function hydrateBundleFromOverrides(pack) {
  const bundle = {
    unitsVisuals: deepClone(BASELINE_UNITS_VISUALS),
    unitStats: deepClone(BASELINE_UNIT_STATS),
    buildings: deepClone(BASELINE_BUILDINGS),
    buildingVisuals: deepClone(BASELINE_BUILDING_VISUALS),
    buildingSkins: deepClone(BASELINE_BUILDING_SKINS),
    heroes: deepClone(BASELINE_HEROES)
  };
  const ov = pack?.overrides;
  if (!ov || typeof ov !== 'object') return bundle;

  // 1. unitsVisuals
  const uvOv = ov.unitsVisuals;
  if (uvOv) {
    for (const delId of uvOv.deletedUnits || []) delete bundle.unitsVisuals.units[delId];
    for (const [uid, udef] of Object.entries(uvOv.units || {})) {
      const cloned = deepClone(udef);
      const sharedBaseId = uvOv.sharedHierarchies?.[uid];
      if (!cloned.hierarchy && sharedBaseId && bundle.unitsVisuals.units[sharedBaseId]?.hierarchy) {
        cloned.hierarchy = deepClone(bundle.unitsVisuals.units[sharedBaseId].hierarchy);
      }
      bundle.unitsVisuals.units[uid] = cloned;
    }
    for (const delPid of uvOv.deletedPrefabs || []) delete bundle.unitsVisuals.prefabs[delPid];
    for (const [pid, pdef] of Object.entries(uvOv.prefabs || {})) {
      bundle.unitsVisuals.prefabs[pid] = deepClone(pdef);
    }
    for (const delFid of uvOv.deletedFactions || []) delete bundle.unitsVisuals.factions[delFid];
    for (const [fid, fdef] of Object.entries(uvOv.factions || {})) {
      bundle.unitsVisuals.factions[fid] = deepClone(fdef);
    }
    if (uvOv.teamPalettes) bundle.unitsVisuals.teamPalettes = deepClone(uvOv.teamPalettes);
    if (uvOv.arrowConfig) bundle.unitsVisuals.arrowConfig = deepClone(uvOv.arrowConfig);
    if (uvOv.actionRules) bundle.unitsVisuals.actionRules = deepClone(uvOv.actionRules);
    if (uvOv.animations) {
      for (const dk of uvOv.animations.deletedKeyframes || []) delete bundle.unitsVisuals.animations.keyframes[dk];
      for (const [k, v] of Object.entries(uvOv.animations.keyframes || {})) {
        bundle.unitsVisuals.animations.keyframes[k] = deepClone(v);
      }
      for (const dp of uvOv.animations.deletedProcedural || []) delete bundle.unitsVisuals.animations.procedural[dp];
      for (const [k, v] of Object.entries(uvOv.animations.procedural || {})) {
        bundle.unitsVisuals.animations.procedural[k] = deepClone(v);
      }
    }
  }

  // 2. unitStats
  const usOv = ov.unitStats;
  if (usOv) {
    for (const delId of usOv.deletedUnits || []) delete bundle.unitStats.units[delId];
    if (Array.isArray(usOv._deletedUnits)) bundle.unitStats._deletedUnits = deepClone(usOv._deletedUnits);
    for (const [uid, sdef] of Object.entries(usOv.units || {})) {
      bundle.unitStats.units[uid] = { ...(bundle.unitStats.units[uid] || {}), ...deepClone(sdef) };
    }
    if (usOv.formationRules) bundle.unitStats.formationRules = deepClone(usOv.formationRules);
    if (Array.isArray(usOv.customPlaceholderIcons)) {
      bundle.unitStats.customPlaceholderIcons = deepClone(usOv.customPlaceholderIcons);
    }
  }

  // 3. buildings
  const bOv = ov.buildings;
  if (bOv) {
    for (const delId of bOv.deletedBuildings || []) delete bundle.buildings.buildings[delId];
    for (const [bid, bdef] of Object.entries(bOv.buildings || {})) {
      bundle.buildings.buildings[bid] = { ...(bundle.buildings.buildings[bid] || {}), ...deepClone(bdef) };
    }
    if (bOv.economy) bundle.buildings.economy = deepClone(bOv.economy);
    if (bOv.sharedBuildingWatchtower) {
      bundle.buildings.sharedBuildingWatchtower = deepClone(bOv.sharedBuildingWatchtower);
    }
  }

  // 4. buildingVisuals
  const bvOv = ov.buildingVisuals;
  if (bvOv?.animations) {
    for (const dk of bvOv.animations.deletedKeyframes || []) delete bundle.buildingVisuals.animations.keyframes[dk];
    for (const [k, v] of Object.entries(bvOv.animations.keyframes || {})) {
      bundle.buildingVisuals.animations.keyframes[k] = deepClone(v);
    }
    for (const dp of bvOv.animations.deletedProcedural || []) delete bundle.buildingVisuals.animations.procedural[dp];
    for (const [k, v] of Object.entries(bvOv.animations.procedural || {})) {
      bundle.buildingVisuals.animations.procedural[k] = deepClone(v);
    }
  }

  // 5. buildingSkins
  if (ov.buildingSkins && typeof ov.buildingSkins === 'object') {
    bundle.buildingSkins = deepClone(ov.buildingSkins);
  }

  // 6. heroes
  const hOv = ov.heroes;
  if (hOv) {
    for (const delId of hOv.deletedHeroes || []) delete bundle.heroes.heroes[delId];
    for (const [hid, hdef] of Object.entries(hOv.heroes || {})) {
      bundle.heroes.heroes[hid] = { ...(bundle.heroes.heroes[hid] || {}), ...deepClone(hdef) };
    }
    for (const delPid of hOv.deletedPrefabs || []) delete bundle.heroes.prefabs[delPid];
    for (const [pid, pdef] of Object.entries(hOv.prefabs || {})) {
      bundle.heroes.prefabs[pid] = deepClone(pdef);
    }
    if (hOv.animations) {
      for (const dk of hOv.animations.deletedKeyframes || []) delete bundle.heroes.animations.keyframes[dk];
      for (const [k, v] of Object.entries(hOv.animations.keyframes || {})) {
        bundle.heroes.animations.keyframes[k] = deepClone(v);
      }
      for (const dp of hOv.animations.deletedProcedural || []) delete bundle.heroes.animations.procedural[dp];
      for (const [k, v] of Object.entries(hOv.animations.procedural || {})) {
        bundle.heroes.animations.procedural[k] = deepClone(v);
      }
    }
    if (hOv.spellTrees) bundle.heroes.spellTrees = deepClone(hOv.spellTrees);
    if (hOv.hybridSpells) bundle.heroes.hybridSpells = deepClone(hOv.hybridSpells);
  }

  return bundle;
}

// ------------------------------------------------------------------ Legacy Storage Migration (from the 6+ legacy keys)

function loadFromLegacyStorageKeys() {
  const storage = globalThis.localStorage;
  if (!storage) return null;

  let anyFound = false;
  const notes = [];
  const bundle = {
    unitsVisuals: deepClone(BASELINE_UNITS_VISUALS),
    unitStats: deepClone(BASELINE_UNIT_STATS),
    buildings: deepClone(BASELINE_BUILDINGS),
    buildingVisuals: deepClone(BASELINE_BUILDING_VISUALS),
    buildingSkins: deepClone(BASELINE_BUILDING_SKINS),
    heroes: deepClone(BASELINE_HEROES)
  };

  // A. Studio draft (`kings_lands_studio_draft_v3` or legacy `kings_lands_studio_draft`)
  try {
    const rawV3 = storage.getItem(LEGACY_STORAGE_KEYS.STUDIO_DRAFT_V3);
    const rawV1 = !rawV3 ? storage.getItem(LEGACY_STORAGE_KEYS.STUDIO_DRAFT_V1) : null;
    if (rawV3) {
      const pack = JSON.parse(rawV3);
      const draft = pack?.data || pack;
      if (draft && draft.units && draft.animations) {
        anyFound = true;
        if (Array.isArray(pack?.omittedUnits)) {
          for (const uid of pack.omittedUnits) {
            if (!draft.units[uid] && BASELINE_UNITS_VISUALS.units?.[uid]) {
              draft.units[uid] = deepClone(BASELINE_UNITS_VISUALS.units[uid]);
            }
          }
        }
        if (pack?.sharedHierarchies && typeof pack.sharedHierarchies === 'object') {
          for (const [uid, baseId] of Object.entries(pack.sharedHierarchies)) {
            if (draft.units[uid] && !draft.units[uid].hierarchy && BASELINE_UNITS_VISUALS.units?.[baseId]?.hierarchy) {
              draft.units[uid].hierarchy = deepClone(BASELINE_UNITS_VISUALS.units[baseId].hierarchy);
            }
          }
        }
        const mNotes = migrateDraftData(draft, BASELINE_UNITS_VISUALS, pack?.managedHashes || null);
        if (mNotes.length) notes.push(...mNotes);

        // Merge baseline missing items cleanly while keeping author overrides
        for (const [k, v] of Object.entries(BASELINE_UNITS_VISUALS.factions || {})) {
          if (!(k in (draft.factions || {}))) (draft.factions = draft.factions || {})[k] = deepClone(v);
        }
        for (const [k, v] of Object.entries(BASELINE_UNITS_VISUALS.teamPalettes || {})) {
          if (!(k in (draft.teamPalettes || {}))) (draft.teamPalettes = draft.teamPalettes || {})[k] = deepClone(v);
        }
        for (const [k, v] of Object.entries(BASELINE_UNITS_VISUALS.prefabs || {})) {
          if (!(k in (draft.prefabs || {}))) (draft.prefabs = draft.prefabs || {})[k] = deepClone(v);
        }
        for (const [k, v] of Object.entries(BASELINE_UNITS_VISUALS.units || {})) {
          if (!(k in draft.units)) draft.units[k] = deepClone(v);
        }
        for (const [k, v] of Object.entries(BASELINE_UNITS_VISUALS.animations?.keyframes || {})) {
          if (!(k in (draft.animations?.keyframes || {}))) {
            (draft.animations.keyframes = draft.animations.keyframes || {})[k] = deepClone(v);
          }
        }
        for (const [k, v] of Object.entries(BASELINE_UNITS_VISUALS.animations?.procedural || {})) {
          if (!(k in (draft.animations?.procedural || {}))) {
            (draft.animations.procedural = draft.animations.procedural || {})[k] = deepClone(v);
          }
        }
        try { sanitizeUnitsData(draft); } catch (_) {}
        bundle.unitsVisuals = draft;
      }
    } else if (rawV1) {
      const draft = JSON.parse(rawV1);
      if (draft && draft.units && draft.animations) {
        anyFound = true;
        migrateDraftData(draft, BASELINE_UNITS_VISUALS, null);
        for (const [k, v] of Object.entries(BASELINE_UNITS_VISUALS.units || {})) {
          if (!(k in draft.units)) draft.units[k] = deepClone(v);
        }
        try { sanitizeUnitsData(draft); } catch (_) {}
        bundle.unitsVisuals = draft;
      }
    }
  } catch (e) {
    console.warn('[DataRegistry] Failed migrating legacy Studio draft:', e);
  }

  // B. unitStats (`kings_lands_unit_stats_v2`)
  try {
    const rawU = storage.getItem(LEGACY_STORAGE_KEYS.UNIT_STATS);
    if (rawU) {
      const parsedU = JSON.parse(rawU);
      if (parsedU && typeof parsedU.units === 'object') {
        anyFound = true;
        for (const delId of parsedU._deletedUnits || []) {
          delete bundle.unitStats.units[delId];
        }
        for (const [uid, uDef] of Object.entries(parsedU.units)) {
          bundle.unitStats.units[uid] = { ...(bundle.unitStats.units[uid] || {}), ...uDef };
        }
        if (parsedU.formationRules) {
          bundle.unitStats.formationRules = { ...bundle.unitStats.formationRules, ...parsedU.formationRules };
        }
        if (Array.isArray(parsedU.customPlaceholderIcons)) {
          bundle.unitStats.customPlaceholderIcons = parsedU.customPlaceholderIcons;
        }
        if (Array.isArray(parsedU._deletedUnits)) {
          bundle.unitStats._deletedUnits = parsedU._deletedUnits;
        }
      }
    }
  } catch (_) {}

  // C. buildingsData (`kings_lands_buildings_data_v2`)
  try {
    const rawB = storage.getItem(LEGACY_STORAGE_KEYS.BUILDINGS_DATA);
    if (rawB) {
      const parsedB = JSON.parse(rawB);
      if (parsedB && typeof parsedB === 'object') {
        anyFound = true;
        if (parsedB.sharedBuildingWatchtower) {
          bundle.buildings.sharedBuildingWatchtower = {
            ...bundle.buildings.sharedBuildingWatchtower,
            ...parsedB.sharedBuildingWatchtower
          };
        }
        if (parsedB.economy) {
          bundle.buildings.economy = { ...bundle.buildings.economy, ...parsedB.economy };
        }
        if (typeof parsedB.buildings === 'object') {
          for (const [bid, bDef] of Object.entries(parsedB.buildings)) {
            bundle.buildings.buildings[bid] = { ...(bundle.buildings.buildings[bid] || {}), ...bDef };
          }
        }
      }
    }
  } catch (_) {}

  // D. buildingVisuals (`kings_lands_building_visuals_v2`)
  try {
    const rawBv = storage.getItem(LEGACY_STORAGE_KEYS.BUILDING_VISUALS);
    if (rawBv) {
      const parsedBv = JSON.parse(rawBv);
      if (parsedBv?.animations?.keyframes) {
        anyFound = true;
        bundle.buildingVisuals.animations.keyframes = {
          ...(bundle.buildingVisuals.animations?.keyframes || {}),
          ...parsedBv.animations.keyframes
        };
      }
    }
  } catch (_) {}

  // E. buildingSkins (`kings_lands_building_skins_v1`)
  try {
    const rawBs = storage.getItem(LEGACY_STORAGE_KEYS.BUILDING_SKINS);
    if (rawBs) {
      const parsedBs = JSON.parse(rawBs);
      if (parsedBs && typeof parsedBs === 'object') {
        anyFound = true;
        bundle.buildingSkins = parsedBs;
      }
    }
  } catch (_) {}

  // F. heroes (`kings_lands_heroes_data_v10`)
  try {
    const rawH = storage.getItem(LEGACY_STORAGE_KEYS.HEROES_DATA);
    if (rawH) {
      const pack = JSON.parse(rawH);
      const data = pack?.data || pack;
      if (data && typeof data === 'object' && data.heroes) {
        anyFound = true;
        const applySavedSpellEdits = (sp, oldSp) => {
          if (!sp || !oldSp) return;
          if (typeof oldSp.rangeMeters === 'number' && (oldSp.userModifiedRange || oldSp.userModifiedParams)) {
            sp.rangeMeters = oldSp.rangeMeters;
            sp.userModifiedRange = true;
          }
          if (typeof oldSp.radiusMeters === 'number' && (oldSp.userModifiedRadius || oldSp.userModifiedParams)) {
            sp.radiusMeters = oldSp.radiusMeters;
            sp.userModifiedRadius = true;
          }
          if (oldSp.vfxStyle && (oldSp.userModifiedVfx || oldSp.userModifiedParams)) {
            sp.vfxStyle = oldSp.vfxStyle;
            sp.userModifiedVfx = true;
          }
          if (oldSp.userModifiedParams) {
            sp.userModifiedParams = true;
            for (const k of ['cooldownSec', 'castTimeSec', 'maxKnockbackWeight', 'knockbackMeters', 'lineWidthMeters', 'cost', 'description']) {
              if (oldSp[k] !== undefined) sp[k] = deepClone(oldSp[k]);
            }
            if (Array.isArray(oldSp.ranks) && Array.isArray(sp.ranks)) {
              for (let r = 0; r < sp.ranks.length && r < oldSp.ranks.length; r++) {
                sp.ranks[r] = { ...sp.ranks[r], ...deepClone(oldSp.ranks[r]) };
              }
            }
          }
        };
        const prevTrees = data.spellTrees || {};
        const prevHybrids = data.hybridSpells || {};
        data.spellTrees = deepClone(BASELINE_HEROES.spellTrees);
        for (const [tid, tree] of Object.entries(data.spellTrees)) {
          const oldTree = prevTrees[tid];
          if (!oldTree?.spells) continue;
          for (const [sid, sp] of Object.entries(tree.spells || {})) applySavedSpellEdits(sp, oldTree.spells[sid]);
        }
        data.hybridSpells = deepClone(BASELINE_HEROES.hybridSpells || {});
        for (const [sid, sp] of Object.entries(data.hybridSpells)) applySavedSpellEdits(sp, prevHybrids[sid]);

        if (!data.prefabs) data.prefabs = {};
        for (const [pid, pdef] of Object.entries(BASELINE_HEROES.prefabs || {})) {
          if (!(pid in data.prefabs)) data.prefabs[pid] = deepClone(pdef);
        }
        if (!data.animations) data.animations = { keyframes: {}, procedural: {} };
        if (!data.animations.keyframes) data.animations.keyframes = {};
        if (!data.animations.procedural) data.animations.procedural = {};
        for (const [k, v] of Object.entries(BASELINE_HEROES.animations?.keyframes || {})) {
          if (!data.animations.keyframes[k] || !data.animations.keyframes[k].userModifiedInStudio) {
            data.animations.keyframes[k] = deepClone(v);
          }
        }
        for (const [k, v] of Object.entries(BASELINE_HEROES.animations?.procedural || {})) {
          if (!data.animations.procedural[k]) data.animations.procedural[k] = deepClone(v);
        }
        for (const [hid, hdef] of Object.entries(BASELINE_HEROES.heroes || {})) {
          if (!data.heroes[hid]) {
            data.heroes[hid] = deepClone(hdef);
          } else {
            data.heroes[hid].isBuiltIn = true;
            sanitizeHeroParameters(data.heroes[hid]);
          }
        }
        bundle.heroes = data;
      }
    }
  } catch (_) {}

  if (!anyFound) return null;
  return { bundle, notes };
}

function clearLegacyKeys() {
  const storage = globalThis.localStorage;
  if (!storage) return;
  for (const key of Object.values(LEGACY_STORAGE_KEYS)) {
    try {
      storage.removeItem(key);
    } catch (_) {}
  }
}

// ------------------------------------------------------------------ Registry Core State & Operations

let _version = 1;
let _bundle = null;
let _notice = '';
let _lastValidation = null;
let _lastChanged = ['*'];
let _persistStatus = { ok: true, error: null, at: 0 };
const _subscribers = new Set();
let _simSnapshotCache = null;

function persistOverridesToStorage(bundle) {
  const storage = globalThis.localStorage;
  if (!storage) return { ok: true, bytes: 0 };
  const payload = buildOverridesPayload(bundle);
  if (!Object.keys(payload.overrides || {}).length) {
    try {
      storage.removeItem(DRAFT_STORAGE_KEY);
    } catch (_) {}
    return { ok: true, bytes: 0 };
  }
  let json = '';
  try {
    json = JSON.stringify(payload);
    storage.setItem(DRAFT_STORAGE_KEY, json);
    return { ok: true, bytes: json.length };
  } catch (error) {
    // Leftover pre-registry keys (old Studio drafts can be several MB) are the usual reason for a full quota: drop them and retry once.
    try {
      clearLegacyKeys();
      storage.setItem(DRAFT_STORAGE_KEY, json);
      return { ok: true, bytes: json.length };
    } catch (error2) {
      return { ok: false, error: String(error2?.name || error2 || 'QuotaExceededError') };
    }
  }
}

function notifySubscribers(reason = 'update') {
  let _snap = null;
  const evt = {
    version: _version,
    reason,
    changed: _lastChanged,
    // built lazily: most listeners never look at it and it is a full (structurally shared) copy of the data
    get snapshot() {
      if (!_snap) _snap = getSnapshotObject();
      return _snap;
    }
  };
  for (const cb of _subscribers) {
    try {
      cb(evt);
    } catch (err) {
      console.warn('[DataRegistry] Subscriber error:', err);
    }
  }
  if (typeof globalThis.window !== 'undefined' && typeof globalThis.window.dispatchEvent === 'function') {
    try {
      globalThis.window.dispatchEvent(new CustomEvent('kings_lands_units_buildings_updated', { detail: evt }));
    } catch (_) {}
  }
}

function loadInitialBundle() {
  _notice = '';
  const storage = globalThis.localStorage;
  let bundle = null;
  let needsSave = false;

  // 1. Try unified overrides draft first
  try {
    const raw = storage?.getItem(DRAFT_STORAGE_KEY);
    if (raw) {
      const pack = JSON.parse(raw);
      if (pack && pack.v === 1 && pack.overrides && typeof pack.overrides === 'object') {
        bundle = hydrateBundleFromOverrides(pack);
        if (
          JSON.stringify(pack.fileVersions) !== JSON.stringify(FILE_VERSIONS) ||
          JSON.stringify(pack.managedHashes) !== JSON.stringify(computeManagedHashes(BASELINE_UNITS_VISUALS))
        ) {
          needsSave = true;
          _notice = 'Shipped files updated — overrides merged cleanly';
        }
      }
    }
  } catch (e) {
    console.warn('[DataRegistry] Corrupt unified draft ignored, falling back to baselines:', e);
    try {
      storage?.removeItem(DRAFT_STORAGE_KEY);
    } catch (_) {}
    _notice = 'Draft was corrupted – defaults loaded';
  }

  // 2. If no unified draft, migrate from any legacy keys without losing user edits
  if (!bundle) {
    const migrated = loadFromLegacyStorageKeys();
    if (migrated) {
      bundle = migrated.bundle;
      needsSave = true;
      if (migrated.notes?.length) {
        _notice = `Migrated legacy drafts (${migrated.notes.join(', ')})`;
      }
    }
  }

  // 3. Otherwise fresh clone of immutable shipped baselines
  if (!bundle) {
    bundle = {
      unitsVisuals: deepClone(BASELINE_UNITS_VISUALS),
      unitStats: deepClone(BASELINE_UNIT_STATS),
      buildings: deepClone(BASELINE_BUILDINGS),
      buildingVisuals: deepClone(BASELINE_BUILDING_VISUALS),
      buildingSkins: deepClone(BASELINE_BUILDING_SKINS),
      heroes: deepClone(BASELINE_HEROES)
    };
  }

  normalizeAndSyncBundle(bundle, { syncUnitVisualFromStats: true });
  _lastValidation = validateRegistryState(bundle);
  _bundle = bundle;
  syncRuntimeModuleExports(_bundle);

  if (needsSave && _lastValidation.ok) {
    persistOverridesToStorage(_bundle);
    clearLegacyKeys();
  }
}

function ensureLoaded() {
  if (!_bundle) loadInitialBundle();
  return _bundle;
}

function commitBundle(candidateBundle, { reason = 'save', persist = true, validate = true, syncFromStats = false } = {}) {
  normalizeAndSyncBundle(candidateBundle, { syncUnitVisualFromStats: syncFromStats });

  const report = validate ? validateRegistryState(candidateBundle) : { ok: true, error: null, blockingIssues: [], issues: [], counts: { error: 0, warn: 0, info: 0 } };
  if (!report.ok) {
    return {
      ok: false,
      error: report.error || 'Validation failed',
      issues: report.blockingIssues,
      report
    };
  }

  const changed = _bundle ? computeChanged(_bundle, candidateBundle) : ['*'];
  if (!changed.length && _bundle) {
    // nothing differs from what the registry already holds: no write, no version bump, no event (labs echo their state back a lot)
    _lastValidation = report;
    return { ok: true, version: _version, report, unchanged: true, persisted: true };
  }

  let persisted = true;
  let persistError = null;
  if (persist) {
    const storageRes = persistOverridesToStorage(candidateBundle);
    if (!storageRes.ok) {
      // Never make the edit vanish: keep it in memory (every lab sees it) but tell the user loudly that it is not stored.
      persisted = false;
      persistError = storageRes.error;
    } else {
      clearLegacyKeys();
    }
    _persistStatus = { ok: persisted, error: persistError, at: Date.now() };
  }

  _bundle = candidateBundle;
  _lastValidation = report;
  _version += 1;
  _lastChanged = changed;
  syncRuntimeModuleExports(_bundle);
  notifySubscribers(reason);
  if (!persisted) notifyPersistFailure(persistError);
  return { ok: true, version: _version, report, changed, persisted, ...(persistError ? { warning: `Not saved to browser storage (${persistError}). Export JSON to keep this work.` } : {}) };
}

const ENTRY_MAPS = [
  ['unitsVisuals', 'units', 'unit'],
  ['unitsVisuals', 'prefabs', 'prefab'],
  ['unitsVisuals', 'factions', 'faction'],
  ['unitStats', 'units', 'stats'],
  ['buildings', 'buildings', 'building'],
  ['buildingSkins', null, 'skin'],
  ['heroes', 'heroes', 'hero'],
  ['heroes', 'prefabs', 'heroPrefab']
];

/** What differs between two bundles: section names ('unitsVisuals', 'buildingSkins', ...) and per-entry keys ('unit:swordsman', 'skin:barracks', ...). */
function computeChanged(a, b) {
  const out = [];
  for (const sec of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (stableEqual(a?.[sec], b?.[sec])) continue;
    out.push(sec);
  }
  if (!out.length) return out;
  for (const [sec, sub, tag] of ENTRY_MAPS) {
    if (!out.includes(sec)) continue;
    const ma = (sub ? a?.[sec]?.[sub] : a?.[sec]) || {};
    const mb = (sub ? b?.[sec]?.[sub] : b?.[sec]) || {};
    for (const id of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
      if (!stableEqual(ma[id], mb[id])) out.push(`${tag}:${id}`);
    }
  }
  return out;
}

function notifyPersistFailure(error) {
  try {
    console.warn('[DataRegistry] Could not write to localStorage (' + error + '). Changes are kept in memory only.');
    if (typeof globalThis.window?.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      globalThis.window.dispatchEvent(new CustomEvent('kings_lands_registry_persist_failed', { detail: { error } }));
    }
  } catch (_) {}
}

function getCombinedVisualsFromBundle(b) {
  const effUnits = b.unitsVisuals;
  const hData = b.heroes;
  const allPrefabs = {
    ...(effUnits.prefabs || {}),
    ...(hData.prefabs || {})
  };

  const getEquipmentWeaponMode = (eq) => {
    if (!eq) return 'melee';
    const r = String(eq.weapon_socket_R?.prefab || '');
    const l = String(eq.weapon_socket_L?.prefab || '');
    return /bow|crossbow/i.test(r) || /bow|crossbow/i.test(l) ? 'ranged' : 'melee';
  };

  const resolveLoadoutCombatAnim = (ownerId, race, ld, fallbackMode, allKf) => {
    if (ld?.combatAnim && allKf[ld.combatAnim]) return ld.combatAnim;
    const eq = ld?.equipment || {};
    const pfR = allPrefabs[eq.weapon_socket_R?.prefab];
    const pfL = allPrefabs[eq.weapon_socket_L?.prefab];
    let eqBase = fallbackMode === 'ranged' ? 'shoot_bow' : 'attack_slash';
    if (pfR?.weaponType === 'melee_long') eqBase = 'attack_thrust';
    else if (pfR?.weaponType === 'thrown') eqBase = 'throw_javelin';
    else if (pfR?.weaponType === 'bow' || pfL?.weaponType === 'bow') eqBase = 'shoot_bow';
    const specific = `${ownerId}_${race || 'human'}_${eqBase}`;
    if (allKf[specific]) return specific;
    const humanSpec = `${ownerId}_human_${eqBase}`;
    if (allKf[humanSpec]) return humanSpec;
    return eqBase;
  };

  const allKeyframes = {
    ...(BASELINE_HEROES.animations?.keyframes || {}),
    ...(effUnits.animations?.keyframes || {})
  };
  for (const [k, v] of Object.entries(hData.animations?.keyframes || {})) {
    if (!v) continue;
    const inUnits = Boolean(effUnits.animations?.keyframes?.[k]);
    const origHeroClip = BASELINE_HEROES.animations?.keyframes?.[k];
    const modifiedFromDefault =
      Boolean(v.userModifiedInStudio) || !origHeroClip || JSON.stringify(v) !== JSON.stringify(origHeroClip);
    if (!inUnits || modifiedFromDefault) allKeyframes[k] = v;
  }

  const combinedUnits = {};
  for (const [uid, udef] of Object.entries(effUnits.units || {})) {
    if (!udef) continue;
    combinedUnits[uid] = udef;
    const secondKey = Object.keys(udef.loadouts || {}).find((k) => k !== MAIN_LOADOUT);
    const secondLd = secondKey ? udef.loadouts[secondKey] : null;
    const eq2 = secondLd?.equipment;
    if (secondLd && eq2 && Object.values(eq2).some(Boolean)) {
      const mode2 = getEquipmentWeaponMode(eq2);
      const race = udef.race || 'human';
      const set2CombatAnim = resolveLoadoutCombatAnim(uid, race, secondLd, mode2, allKeyframes);
      const variantId = `${uid}__loadout2`;
      combinedUnits[variantId] = {
        ...udef,
        id: variantId,
        baseHeroId: uid,
        isMounted: secondLd.isMounted ?? udef.isMounted ?? false,
        locomotionAnim: secondLd.locomotionAnim || udef.locomotionAnim || (udef.isMounted ? 'gallop' : 'walk'),
        mountHierarchy: secondLd.mountHierarchy || udef.mountHierarchy || undefined,
        hierarchy: secondLd.hierarchy || udef.hierarchy,
        combatAnim: set2CombatAnim,
        equipment: eq2,
        skins: {
          ...(udef.skins || {}),
          [race]: {
            ...(udef.skins?.[race] || {}),
            combatAnim: set2CombatAnim,
            locomotionAnim: secondLd.locomotionAnim || udef.locomotionAnim || (udef.isMounted ? 'gallop' : 'walk')
          }
        }
      };
    }
  }

  for (const [hid, hdef] of Object.entries(hData.heroes || {})) {
    if (!hdef) continue;
    combinedUnits[hid] = hdef;
    const secondKey = Object.keys(hdef.loadouts || {}).find((k) => k !== MAIN_LOADOUT);
    const secondLd = secondKey ? hdef.loadouts[secondKey] : null;
    if (secondLd && secondLd.equipment && (secondLd.equipment.weapon_socket_R?.prefab || secondLd.equipment.weapon_socket_L?.prefab)) {
      const mode2 = getEquipmentWeaponMode(secondLd.equipment);
      const race = hdef.race || 'human';
      const set2CombatAnim = resolveLoadoutCombatAnim(hid, race, secondLd, mode2, allKeyframes);
      const variantId = `${hid}__loadout2`;
      combinedUnits[variantId] = {
        ...hdef,
        id: variantId,
        baseHeroId: hid,
        isMounted: secondLd.isMounted ?? hdef.isMounted ?? false,
        locomotionAnim: secondLd.locomotionAnim || hdef.locomotionAnim || 'walk',
        mountHierarchy: secondLd.mountHierarchy || hdef.mountHierarchy || undefined,
        hierarchy: secondLd.hierarchy || hdef.hierarchy,
        combatAnim: set2CombatAnim,
        equipment: secondLd.equipment,
        skins: {
          ...(hdef.skins || {}),
          [race]: {
            ...(hdef.skins?.[race] || {}),
            combatAnim: set2CombatAnim,
            locomotionAnim: secondLd.locomotionAnim || hdef.locomotionAnim || 'walk'
          }
        }
      };
    }
    if (hdef.mountedConfig && hdef.mountedConfig.equipment) {
      const mc = hdef.mountedConfig;
      const race = hdef.race || 'human';
      const mountedVariant = {
        ...hdef,
        id: `${hid}__mounted`,
        baseHeroId: hid,
        isMounted: true,
        locomotionAnim: mc.locomotionAnim || 'gallop',
        mountHierarchy: mc.mountHierarchy || hdef.mountHierarchy,
        hierarchy: mc.hierarchy || hdef.hierarchy,
        combatAnim: mc.combatAnim || 'attack_slash',
        equipment: mc.equipment,
        skins: {
          ...(hdef.skins || {}),
          [race]: {
            ...(hdef.skins?.[race] || {}),
            combatAnim: mc.combatAnim || 'attack_slash',
            locomotionAnim: mc.locomotionAnim || 'gallop'
          }
        }
      };
      combinedUnits[`${hid}__mounted`] = mountedVariant;
      if (!combinedUnits[`${hid}__loadout2`]) {
        combinedUnits[`${hid}__loadout2`] = { ...mountedVariant, id: `${hid}__loadout2` };
      }
    }
  }

  return {
    ...effUnits,
    prefabs: allPrefabs,
    units: combinedUnits,
    heroes: hData.heroes || {},
    buildingSkins: b.buildingSkins || {},
    animations: {
      keyframes: allKeyframes,
      procedural: {
        ...(hData.animations?.procedural || {}),
        ...(effUnits.animations?.procedural || {})
      }
    }
  };
}

function getSnapshotObject() {
  const b = ensureLoaded();
  return {
    v: 1,
    version: _version,
    fileVersions: { ...FILE_VERSIONS },
    timestamp: Date.now(),
    data: {
      unitsVisuals: deepClone(b.unitsVisuals),
      unitStats: deepClone(b.unitStats),
      buildings: deepClone(b.buildings),
      buildingVisuals: deepClone(b.buildingVisuals),
      buildingSkins: deepClone(b.buildingSkins),
      heroes: deepClone(b.heroes)
    }
  };
}


// ---- compact snapshots (undo stacks): mesh blobs are stored as {"$blob": id} references instead of megabytes of numbers
const _blobIds = new WeakMap();
const _blobById = new Map();
let _blobSeq = 0;

function blobId(arr) {
  let id = _blobIds.get(arr);
  if (!id) {
    id = ++_blobSeq;
    _blobIds.set(arr, id);
    _blobById.set(id, arr);
  }
  return id;
}

function stringifyWithBlobs(obj) {
  return JSON.stringify(obj, (k, v) =>
    Array.isArray(v) && v.length >= BLOB_MIN && BLOB_KEYS.has(k) ? { $blob: blobId(v) } : v
  );
}

function reviveBlobs(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = reviveBlobs(node[i]);
    return node;
  }
  const keys = Object.keys(node);
  if (keys.length === 1 && keys[0] === '$blob') {
    const arr = _blobById.get(node.$blob);
    if (!arr) throw new Error('Snapshot refers to a mesh that is no longer in memory');
    return arr;
  }
  for (const k of keys) node[k] = reviveBlobs(node[k]);
  return node;
}

function parseSnapshotText(text) {
  const parsed = JSON.parse(text);
  return reviveBlobs(parsed);
}


// ---- Working copies and three-way merge -------------------------------------------------------------------------
// Labs/Studio edit a private copy of a whole section (unitsVisuals, unitStats, buildings, buildingVisuals, heroes) and
// save it back. The getters below remember what each returned copy was loaded from (`_bases`). A save of such a copy is
// a THREE-WAY MERGE (copy + what it was loaded from + what the registry holds now): only what that copy really changed
// is written, so a stale copy can no longer overwrite what another lab saved in the meantime.
// Both changed the same leaf -> the saving copy wins (it is the latest explicit action).

const _bases = new WeakMap();

function checkout(value) {
  const working = deepClone(value);
  _bases.set(working, deepClone(value));
  return working;
}

function isPlain(o) {
  return o !== null && typeof o === 'object' && !Array.isArray(o);
}

function merge3(w, b, c, depth) {
  if (stableEqual(w, b)) return c;
  if (stableEqual(c, b)) return deepClone(w);
  if (depth < 5 && isPlain(w) && isPlain(b) && isPlain(c)) {
    for (const k of new Set([...Object.keys(w), ...Object.keys(b)])) {
      const inW = Object.prototype.hasOwnProperty.call(w, k);
      const inB = Object.prototype.hasOwnProperty.call(b, k);
      if (inW && inB) c[k] = merge3(w[k], b[k], c[k], depth + 1);
      else if (inW) c[k] = deepClone(w[k]);          // added by the saving copy
      else delete c[k];                              // deleted by the saving copy
    }
    return c;
  }
  return deepClone(w);
}

/** next[section] <- merge of `working` (a copy handed out by a getter) into the current state; unknown copies replace the section. */
function mergeSectionInto(next, section, working) {
  const base = _bases.get(working);
  next[section] = base ? merge3(working, base, next[section], 0) : deepClone(working);
}

function rememberSaved(working) {
  if (working && typeof working === 'object') _bases.set(working, deepClone(working));
}

// ------------------------------------------------------------------ Public Registry API

export const dataRegistry = {
  // ---- Races ----
  getRaces() {
    return deepClone(ensureLoaded().unitsVisuals.factions || {});
  },
  getRace(id) {
    if (!id) return null;
    const f = ensureLoaded().unitsVisuals.factions?.[id];
    return f ? deepClone(f) : null;
  },
  saveRaces(factions) {
    const next = deepClone(ensureLoaded());
    next.unitsVisuals.factions = deepClone(factions || {});
    return commitBundle(next, { reason: 'saveRaces' });
  },
  saveRace(id, raceDef) {
    if (!id) return { ok: false, error: 'Race id is required' };
    const next = deepClone(ensureLoaded());
    next.unitsVisuals.factions = next.unitsVisuals.factions || {};
    next.unitsVisuals.factions[id] = deepClone(raceDef);
    return commitBundle(next, { reason: 'saveRace' });
  },

  // ---- Bases (derived dynamically from units data — zero hardcoded lists) ----
  getBases(race = null) {
    const units = ensureLoaded().unitsVisuals.units || {};
    const out = [];
    for (const [id, uDef] of Object.entries(units)) {
      if (!isBaseUnitEntry(id, uDef)) continue;
      const meta = baseEntryToMeta(id, uDef);
      if (race && meta.race !== race) continue;
      out.push(meta);
    }
    return out;
  },
  // ---- Race cards (getRaces()/getRace() above keep returning the faction definitions the labs use) ----
  // A card = identity + the ids of the race's bases, units, heroes and gear, grouped live by the `race` field
  // (the same grouping as src/data/races/<race>.json). Per-race getters below return copies of that data.
  /** Race cards. Base-only ids (mirukenkay) are bases, never races, unless `includeBaseOnly` is set. */
  getRaceCards({ includeBaseOnly = false } = {}) {
    const b = ensureLoaded();
    const out = [];
    for (const id of Object.keys(b.unitsVisuals.factions || {})) {
      if (!includeBaseOnly && BASE_ONLY_RACE_IDS.includes(id)) continue;
      out.push(this.getRaceCard(id));
    }
    return out;
  },
  getRaceCard(id) {
    const b = ensureLoaded();
    const f = b.unitsVisuals.factions?.[id];
    if (!f) return null;
    const visuals = b.unitsVisuals.units || {};
    const bases = [];
    const units = [];
    for (const [uid, u] of Object.entries(visuals)) {
      if (u?.race !== id) continue;
      if (isBaseUnitEntry(uid, u)) bases.push(uid); else if (!u.isBuildingEntity && !u.isHero) units.push(uid);
    }
    return deepClone({
      id,
      name: f.displayName || id,
      teamColors: f.teamColors ?? null,
      sharedUnits: Boolean(f.sharedUnits),
      baseOnly: BASE_ONLY_RACE_IDS.includes(id),
      bases,
      units,
      heroes: Object.entries(b.heroes.heroes || {}).filter(([, h]) => h?.race === id).map(([hid]) => hid),
      gear: Object.entries(b.unitsVisuals.prefabs || {}).filter(([, p]) => p?.race === id).map(([pid]) => pid),
      buildings: 'shared'
    });
  },
  getUnitsForRace(id) {
    const b = ensureLoaded();
    const race = this.getRaceCard(id);
    if (!race) return { visuals: {}, stats: {} };
    const pick = (map, ids) => Object.fromEntries(ids.filter((k) => map?.[k]).map((k) => [k, deepClone(map[k])]));
    return { visuals: pick(b.unitsVisuals.units, race.units), stats: pick(b.unitStats.units, Object.keys(b.unitStats.units || {}).filter((k) => b.unitStats.units[k]?.race === id)) };
  },
  getBasesForRace(id) { return this.getBases(id); },
  getGearForRace(id) {
    return deepClone(Object.fromEntries(Object.entries(ensureLoaded().unitsVisuals.prefabs || {}).filter(([, p]) => p?.race === id)));
  },
  getHeroesForRace(id) {
    return deepClone(Object.fromEntries(Object.entries(ensureLoaded().heroes.heroes || {}).filter(([, h]) => h?.race === id)));
  },
  /** Buildings are shared by every race today (no `race` on a building); a future per-race building list plugs in here. */
  getBuildingsForRace(_id) { return this.getBuildings().buildings; },
  getBase(id) {
    if (!id) return null;
    const resolved = resolveBaseCharId(id, id);
    const uDef = ensureLoaded().unitsVisuals.units?.[resolved];
    if (!uDef) return null;
    return deepClone({ ...baseEntryToMeta(resolved, uDef), visual: uDef });
  },
  saveBase(id, baseDef) {
    if (!id || !baseDef) return { ok: false, error: 'Base id and definition are required' };
    const next = deepClone(ensureLoaded());
    next.unitsVisuals.units[id] = {
      ...deepClone(baseDef),
      id,
      isBaseTemplate: true
    };
    return commitBundle(next, { reason: 'saveBase' });
  },

  // ---- Units (Stats + Visuals) ----
  getUnits() {
    const b = ensureLoaded();
    return {
      stats: deepClone(b.unitStats),
      visuals: deepClone(b.unitsVisuals)
    };
  },
  getUnit(id) {
    if (!id) return null;
    const b = ensureLoaded();
    const stats = b.unitStats.units?.[id];
    const visual = b.unitsVisuals.units?.[id];
    if (!stats && !visual) return null;
    return {
      id,
      stats: stats ? deepClone(stats) : null,
      visual: visual ? deepClone(visual) : null
    };
  },
  getUnitStats(id = null) {
    const us = ensureLoaded().unitStats;
    if (id !== null && id !== undefined) {
      const u = us.units?.[id];
      return u ? deepClone(u) : null;
    }
    return checkout(us);
  },
  getUnitsVisuals() {
    return checkout(ensureLoaded().unitsVisuals);
  },
  saveUnits({ stats = null, visuals = null } = {}) {
    const working = {};
    if (stats) working.unitStats = stats;
    if (visuals) working.unitsVisuals = visuals;
    return dataRegistry.commitWorking(working, { reason: 'saveUnits' });
  },
  saveUnit(id, { stats = undefined, visual = undefined } = {}) {
    if (!id) return { ok: false, error: 'Unit id is required' };
    const next = deepClone(ensureLoaded());
    if (stats !== undefined) {
      if (stats === null) delete next.unitStats.units[id];
      else next.unitStats.units[id] = { ...deepClone(stats), id };
    }
    if (visual !== undefined) {
      if (visual === null) delete next.unitsVisuals.units[id];
      else next.unitsVisuals.units[id] = deepClone(visual);
    }
    return commitBundle(next, { reason: 'saveUnit' });
  },
  saveUnitStats(arg1, arg2 = undefined) {
    const next = deepClone(ensureLoaded());
    if (typeof arg1 === 'string') {
      if (!arg2) return { ok: false, error: 'Unit stats payload is required' };
      next.unitStats.units[arg1] = { ...deepClone(arg2), id: arg1 };
    } else if (arg1 && typeof arg1 === 'object') {
      return dataRegistry.commitWorking({ unitStats: arg1 }, { reason: 'saveUnitStats' });
    } else {
      return { ok: false, error: 'Invalid saveUnitStats arguments' };
    }
    return commitBundle(next, { reason: 'saveUnitStats' });
  },
  saveUnitsVisuals(visualsData) {
    if (!visualsData || typeof visualsData !== 'object') {
      return { ok: false, error: 'Invalid units visuals payload' };
    }
    return dataRegistry.commitWorking({ unitsVisuals: visualsData }, { reason: 'saveUnitsVisuals' });
  },
  deleteUnit(id) {
    if (!id) return { ok: false, error: 'Unit id is required' };
    const next = deepClone(ensureLoaded());
    const uStat = next.unitStats.units?.[id];
    if (uStat && (uStat.isWorker || id === 'worker')) {
      return { ok: false, error: 'Worker unit cannot be deleted' };
    }
    removeUnitAcrossLabs(next.unitStats, next.unitsVisuals, next.buildings, id);
    if (!Array.isArray(next.unitStats._deletedUnits)) next.unitStats._deletedUnits = [];
    if (!next.unitStats._deletedUnits.includes(id)) next.unitStats._deletedUnits.push(id);
    for (const bDef of Object.values(next.buildings.buildings || {})) {
      if (Array.isArray(bDef?.options)) {
        bDef.options = bDef.options.filter((o) => o.id !== id && o.unitType !== id);
      }
    }
    return commitBundle(next, { reason: 'deleteUnit' });
  },

  // ---- Gear & Prefabs ----
  getGear() {
    const b = ensureLoaded();
    return deepClone({
      ...(b.unitsVisuals.prefabs || {}),
      ...(b.heroes.prefabs || {})
    });
  },
  getPrefab(id) {
    if (!id) return null;
    const b = ensureLoaded();
    const pf = b.unitsVisuals.prefabs?.[id] || b.heroes.prefabs?.[id];
    return pf ? deepClone(pf) : null;
  },
  saveGear(prefabs, domain = 'units') {
    const next = deepClone(ensureLoaded());
    if (domain === 'heroes') {
      next.heroes.prefabs = deepClone(prefabs || {});
    } else {
      next.unitsVisuals.prefabs = deepClone(prefabs || {});
    }
    return commitBundle(next, { reason: 'saveGear' });
  },
  savePrefab(id, prefabDef, domain = 'units') {
    if (!id || !prefabDef) return { ok: false, error: 'Prefab id and definition are required' };
    const next = deepClone(ensureLoaded());
    if (domain === 'heroes') {
      next.heroes.prefabs = next.heroes.prefabs || {};
      next.heroes.prefabs[id] = deepClone(prefabDef);
    } else {
      next.unitsVisuals.prefabs = next.unitsVisuals.prefabs || {};
      next.unitsVisuals.prefabs[id] = deepClone(prefabDef);
    }
    return commitBundle(next, { reason: 'savePrefab' });
  },
  deletePrefab(id) {
    if (!id) return { ok: false, error: 'Prefab id is required' };
    const next = deepClone(ensureLoaded());
    delete next.unitsVisuals.prefabs?.[id];
    delete next.heroes.prefabs?.[id];
    for (const u of Object.values(next.unitsVisuals.units || {})) {
      for (const eq of [u.equipment, ...Object.values(u.loadouts || {}).map((l) => l?.equipment)]) {
        if (!eq) continue;
        for (const [sock, entry] of Object.entries(eq)) {
          if (entry?.prefab === id) delete eq[sock];
        }
      }
    }
    for (const h of Object.values(next.heroes.heroes || {})) {
      for (const eq of [h.equipment, h.mountedConfig?.equipment, ...Object.values(h.loadouts || {}).map((l) => l?.equipment)]) {
        if (!eq) continue;
        for (const [sock, entry] of Object.entries(eq)) {
          if (entry?.prefab === id) delete eq[sock];
        }
      }
    }
    return commitBundle(next, { reason: 'deletePrefab' });
  },

  // ---- Animations ----
  getAnimations(domain = 'units') {
    const b = ensureLoaded();
    if (domain === 'buildings') return deepClone(b.buildingVisuals.animations || { keyframes: {}, procedural: {} });
    if (domain === 'heroes') return deepClone(b.heroes.animations || { keyframes: {}, procedural: {} });
    if (domain === 'combined') return deepClone(getCombinedVisualsFromBundle(b).animations);
    return deepClone(b.unitsVisuals.animations || { keyframes: {}, procedural: {} });
  },
  saveAnimations(animations, domain = 'units') {
    const next = deepClone(ensureLoaded());
    const cloned = deepClone(animations || { keyframes: {}, procedural: {} });
    if (domain === 'buildings') next.buildingVisuals.animations = cloned;
    else if (domain === 'heroes') next.heroes.animations = cloned;
    else next.unitsVisuals.animations = cloned;
    return commitBundle(next, { reason: 'saveAnimations' });
  },

  // ---- Skins (units + buildings) ----
  getBuildingSkins() {
    return deepClone(ensureLoaded().buildingSkins || {});
  },
  getBuildingSkin(bid) {
    if (!bid) return null;
    const entry = ensureLoaded().buildingSkins?.[bid];
    return entry ? deepClone(entry) : null;
  },
  getSkins(targetType = 'all', id = null) {
    const b = ensureLoaded();
    if (targetType === 'building') {
      return id ? (b.buildingSkins?.[id] ? deepClone(b.buildingSkins[id]) : null) : deepClone(b.buildingSkins || {});
    }
    if (targetType === 'unit') {
      if (id) {
        const u = b.unitsVisuals.units?.[id];
        return u ? deepClone(u.skins || {}) : null;
      }
      const map = {};
      for (const [uid, u] of Object.entries(b.unitsVisuals.units || {})) {
        if (u?.skins) map[uid] = deepClone(u.skins);
      }
      return map;
    }
    if (typeof targetType === 'string' && targetType !== 'all' && id === null) {
      // Convenience: getSkins(unitOrBuildingId)
      const u = b.unitsVisuals.units?.[targetType];
      if (u) return deepClone(u.skins || {});
      const bs = b.buildingSkins?.[targetType];
      if (bs) return deepClone(bs);
    }
    return {
      units: Object.fromEntries(
        Object.entries(b.unitsVisuals.units || {})
          .filter(([, u]) => u?.skins)
          .map(([uid, u]) => [uid, deepClone(u.skins)])
      ),
      buildings: deepClone(b.buildingSkins || {})
    };
  },
  saveSkins(skinsOrPayload, targetType = 'building', id = null) {
    if (targetType === 'unit' && id) {
      const next = deepClone(ensureLoaded());
      if (!next.unitsVisuals.units?.[id]) return { ok: false, error: `Unknown unit "${id}"` };
      next.unitsVisuals.units[id].skins = deepClone(skinsOrPayload || {});
      return commitBundle(next, { reason: 'saveUnitSkins' });
    }
    if (skinsOrPayload && typeof skinsOrPayload === 'object' && ('buildings' in skinsOrPayload || 'units' in skinsOrPayload)) {
      const next = deepClone(ensureLoaded());
      if (skinsOrPayload.buildings) next.buildingSkins = deepClone(skinsOrPayload.buildings);
      if (skinsOrPayload.units) {
        for (const [uid, skMap] of Object.entries(skinsOrPayload.units)) {
          if (next.unitsVisuals.units[uid]) next.unitsVisuals.units[uid].skins = deepClone(skMap);
        }
      }
      return commitBundle(next, { reason: 'saveSkins' });
    }
    return this.saveBuildingSkins(skinsOrPayload);
  },
  saveBuildingSkins(skins) {
    const next = deepClone(ensureLoaded());
    next.buildingSkins = deepClone(skins || {});
    return commitBundle(next, { reason: 'saveBuildingSkins' });
  },
  saveBuildingSkin(bid, entry) {
    if (!bid || !entry) return { ok: false, error: 'Building id and skin entry are required' };
    const next = deepClone(ensureLoaded());
    next.buildingSkins[bid] = deepClone(entry);
    return commitBundle(next, { reason: 'saveBuildingSkin' });
  },
  setActiveBuildingSkin(bid, skinId = 'default') {
    if (!bid) return { ok: false, error: 'Building id is required' };
    const next = deepClone(ensureLoaded());
    const entry = next.buildingSkins[bid];
    if (!entry) {
      if (!skinId || skinId === 'default') return { ok: true, version: _version };
      return { ok: false, error: `Building "${bid}" has no skins registered` };
    }
    entry.active = skinId || 'default';
    return commitBundle(next, { reason: 'setActiveBuildingSkin' });
  },
  deleteBuildingSkin(bid, skinId = null) {
    if (!bid) return { ok: false, error: 'Building id is required' };
    const next = deepClone(ensureLoaded());
    if (skinId === null) {
      delete next.buildingSkins[bid];
    } else {
      const entry = next.buildingSkins[bid];
      if (!entry?.items?.[skinId]) return { ok: true, version: _version };
      delete entry.items[skinId];
      if (entry.active === skinId) entry.active = 'default';
      if (!Object.keys(entry.items).length) delete next.buildingSkins[bid];
    }
    return commitBundle(next, { reason: 'deleteBuildingSkin' });
  },
  setUnitActiveSkin(unitId, skinId = 'default') {
    if (!unitId) return { ok: false, error: 'Unit id is required' };
    const next = deepClone(ensureLoaded());
    if (!next.unitStats.units?.[unitId]) return { ok: false, error: `Unknown unit "${unitId}"` };
    next.unitStats.units[unitId].activeSkin = skinId || 'default';
    return commitBundle(next, { reason: 'setUnitActiveSkin' });
  },

  // ---- Buildings ----
  getBuildings() {
    return checkout(ensureLoaded().buildings);
  },
  getBuilding(id) {
    if (!id) return null;
    const b = ensureLoaded().buildings.buildings?.[id];
    return b ? deepClone(b) : null;
  },
  getBuildingVisuals() {
    return checkout(ensureLoaded().buildingVisuals);
  },
  saveBuildings(buildingsData) {
    if (!buildingsData || typeof buildingsData !== 'object') {
      return { ok: false, error: 'Invalid buildings payload' };
    }
    return dataRegistry.commitWorking({ buildings: buildingsData }, { reason: 'saveBuildings' });
  },
  saveBuilding(id, bDef) {
    if (!id || !bDef) return { ok: false, error: 'Building id and definition are required' };
    const next = deepClone(ensureLoaded());
    next.buildings.buildings[id] = { ...deepClone(bDef), id };
    return commitBundle(next, { reason: 'saveBuilding' });
  },
  deleteBuilding(id) {
    if (!id) return { ok: false, error: 'Building id is required' };
    const next = deepClone(ensureLoaded());
    delete next.buildings.buildings?.[id];
    delete next.buildingSkins?.[id];
    return commitBundle(next, { reason: 'deleteBuilding' });
  },
  saveBuildingVisuals(buildingVisualsData) {
    if (!buildingVisualsData || typeof buildingVisualsData !== 'object') {
      return { ok: false, error: 'Invalid buildingVisuals payload' };
    }
    return dataRegistry.commitWorking({ buildingVisuals: buildingVisualsData }, { reason: 'saveBuildingVisuals' });
  },

  // ---- Heroes ----
  getHeroes() {
    return deepClone(ensureLoaded().heroes.heroes || {});
  },
  getHeroesData() {
    return checkout(ensureLoaded().heroes);
  },
  getHero(id) {
    if (!id) return null;
    const h = ensureLoaded().heroes.heroes?.[id];
    return h ? deepClone(h) : null;
  },
  saveHeroes(heroesDataOrMap) {
    if (!heroesDataOrMap || typeof heroesDataOrMap !== 'object') {
      return { ok: false, error: 'Invalid heroes payload' };
    }
    if ('heroes' in heroesDataOrMap && typeof heroesDataOrMap.heroes === 'object') {
      return dataRegistry.commitWorking({ heroes: heroesDataOrMap }, { reason: 'saveHeroes' });
    }
    const next = deepClone(ensureLoaded());
    next.heroes.heroes = deepClone(heroesDataOrMap);
    return commitBundle(next, { reason: 'saveHeroes' });
  },
  saveHero(id, heroDef) {
    if (!id || !heroDef) return { ok: false, error: 'Hero id and definition are required' };
    const next = deepClone(ensureLoaded());
    next.heroes.heroes[id] = { ...deepClone(heroDef), id };
    return commitBundle(next, { reason: 'saveHero' });
  },
  deleteHero(id) {
    if (!id) return { ok: false, error: 'Hero id is required' };
    const next = deepClone(ensureLoaded());
    if (Object.keys(next.heroes.heroes || {}).length <= 1) {
      return { ok: false, error: 'Cannot delete the last remaining Hero.' };
    }
    delete next.heroes.heroes[id];
    return commitBundle(next, { reason: 'deleteHero' });
  },

  // ---- Combined / Transactions / Snapshots / Lifecycle ----
  getCombinedVisuals() {
    return deepClone(getCombinedVisualsFromBundle(ensureLoaded()));
  },
  getTeamPalettes() {
    return deepClone(ensureLoaded().unitsVisuals.teamPalettes || {});
  },
  getArrowConfig() {
    return deepClone(ensureLoaded().unitsVisuals.arrowConfig || null);
  },
  getActionRules() {
    return deepClone(ensureLoaded().unitsVisuals.actionRules || null);
  },
  getFileVersions() {
    return { ...FILE_VERSIONS };
  },
  /** Monotonic data version (bumped by every real change). Labs remember the version they loaded. */
  getVersion() {
    ensureLoaded();
    return _version;
  },
  /** { ok, error, at } of the last write to localStorage (ok:false = the data lives in memory only). */
  getPersistStatus() {
    return { ..._persistStatus };
  },
  /** Cheap facts for bug reports: localStorage keys + sizes, version, validation, persist status. */
  diagnostics() {
    ensureLoaded();
    const keys = {};
    try {
      const st = globalThis.localStorage;
      for (let i = 0; st && i < st.length; i++) {
        const k = st.key(i);
        if (/kings_lands/i.test(k)) keys[k] = (st.getItem(k) || '').length;
      }
    } catch (_) {}
    return {
      version: _version,
      persist: { ..._persistStatus },
      validation: _lastValidation ? { ok: _lastValidation.ok, counts: _lastValidation.counts } : null,
      localStorageChars: keys,
      buildingSkins: Object.fromEntries(Object.entries(_bundle.buildingSkins || {}).map(([k, v]) => [k, { active: v.active, items: Object.keys(v.items || {}) }])),
      notice: _notice
    };
  },
  getLastValidationReport() {
    ensureLoaded();
    return deepClone(_lastValidation);
  },
  getNotice() {
    ensureLoaded();
    return _notice;
  },
  getBaselineSnapshot() {
    return {
      unitsVisuals: deepClone(BASELINE_UNITS_VISUALS),
      unitStats: deepClone(BASELINE_UNIT_STATS),
      buildings: deepClone(BASELINE_BUILDINGS),
      buildingVisuals: deepClone(BASELINE_BUILDING_VISUALS),
      buildingSkins: deepClone(BASELINE_BUILDING_SKINS),
      heroes: deepClone(BASELINE_HEROES)
    };
  },
  /**
   * The frozen, versioned config for a NEW match (see src/sim/simConfig.js). Cached per registry version.
   * The running match never sees later lab edits.
   */
  getSimSnapshot() {
    const b = ensureLoaded();
    if (!_simSnapshotCache || _simSnapshotCache.version !== _version) {
      _simSnapshotCache = { version: _version, snap: buildSimSnapshot(b, _version) };
    }
    return _simSnapshotCache.snap;
  },
  syncRuntimeData({ unitStats = null, buildings = null, unitsVisuals = null, buildingVisuals = null, heroes = null } = {}) {
    syncRuntimeModuleExports({ unitStats, buildings, unitsVisuals, buildingVisuals, heroes });
  },

  /** Tell the registry that a section copy was modified on purpose by its owner and is "clean" (its merge base = its current content). */
  markClean(copy) {
    rememberSaved(copy);
    return copy;
  },

  /**
   * Save one or more section copies (see getUnitsVisuals/getUnitStats/getBuildings/getBuildingVisuals/getHeroesData)
   * as a three-way merge: only what each copy changed is written. { unitStats, buildings, buildingVisuals, unitsVisuals, heroes }
   */
  commitWorking(working, options = {}) {
    if (!working || typeof working !== 'object') return { ok: false, error: 'commitWorking expects an object of section copies' };
    const next = deepClone(ensureLoaded());
    for (const [section, copy] of Object.entries(working)) {
      if (!copy || typeof copy !== 'object' || !(section in next)) continue;
      mergeSectionInto(next, section, copy);
    }
    const res = commitBundle(next, { reason: options.reason || 'commitWorking', persist: options.persist !== false });
    if (res.ok) for (const copy of Object.values(working)) rememberSaved(copy);
    return res;
  },

  transaction(mutatorFn, options = {}) {
    if (typeof mutatorFn !== 'function') {
      return { ok: false, error: 'transaction expects a mutator function' };
    }
    const next = deepClone(ensureLoaded());
    try {
      const result = mutatorFn(next);
      if (result === false) return { ok: false, error: 'Transaction aborted' };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
    return commitBundle(next, { reason: options.reason || 'transaction', persist: options.persist !== false });
  },

  subscribe(cb) {
    if (typeof cb === 'function') _subscribers.add(cb);
    return () => _subscribers.delete(cb);
  },

  snapshot() {
    return getSnapshotObject();
  },

  /** Snapshot as text for undo stacks (~10x smaller / faster than JSON.stringify(snapshot())). restoreSnapshot accepts it. */
  snapshotText() {
    return stringifyWithBlobs(getSnapshotObject());
  },
  /** Parse text produced by snapshotText() (resolves the mesh references). Plain JSON snapshots work too. */
  parseSnapshot(text) {
    return typeof text === 'string' ? parseSnapshotText(text) : text;
  },

  restoreSnapshot(snapOrText, { reason = 'restoreSnapshot', persist = true } = {}) {
    const parsed = typeof snapOrText === 'string' ? parseSnapshotText(snapOrText) : snapOrText;
    const data = parsed?.data || parsed;
    if (!data || !data.unitsVisuals || !data.unitStats || !data.buildings || !data.heroes) {
      return { ok: false, error: 'Invalid registry snapshot object' };
    }
    const next = {
      unitsVisuals: deepClone(data.unitsVisuals),
      unitStats: deepClone(data.unitStats),
      buildings: deepClone(data.buildings),
      buildingVisuals: deepClone(data.buildingVisuals || BASELINE_BUILDING_VISUALS),
      buildingSkins: deepClone(data.buildingSkins || BASELINE_BUILDING_SKINS),
      heroes: deepClone(data.heroes)
    };
    return commitBundle(next, { reason, persist });
  },

  resetToDefaults() {
    try {
      globalThis.localStorage?.removeItem(DRAFT_STORAGE_KEY);
    } catch (_) {}
    clearLegacyKeys();
    const fresh = {
      unitsVisuals: deepClone(BASELINE_UNITS_VISUALS),
      unitStats: deepClone(BASELINE_UNIT_STATS),
      buildings: deepClone(BASELINE_BUILDINGS),
      buildingVisuals: deepClone(BASELINE_BUILDING_VISUALS),
      buildingSkins: deepClone(BASELINE_BUILDING_SKINS),
      heroes: deepClone(BASELINE_HEROES)
    };
    _notice = 'Defaults restored';
    return commitBundle(fresh, { reason: 'resetToDefaults', persist: false, syncFromStats: true });
  },

  /** Re-reads localStorage into memory (useful in tests after populating legacy keys). */
  reloadFromStorage() {
    _bundle = null;
    loadInitialBundle();
    _version += 1;
    notifySubscribers('reloadFromStorage');
    return getSnapshotObject();
  }
};
