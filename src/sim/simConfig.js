/**
 * Kings Lands - simulation config snapshot (src/sim/simConfig.js)
 *
 * The simulation never reads the registry or localStorage. A match is configured by ONE explicit, versioned,
 * frozen snapshot of everything the sim reads from game data:
 *
 *   { schema, version, hash, unitStats, buildings, unitsVisuals:{units,prefabs,actionRules}, heroes:{heroes,spellTrees,hybridSpells} }
 *
 *   main thread : dataRegistry.getSimSnapshot()  ->  SimBridge sends it in the INIT message of a NEW match
 *   worker      : GameState constructor          ->  applySimSnapshot(snapshot)   (the only place that changes sim data)
 *
 * The same snapshot always gives the same match (tests/regression/sim_snapshot.test.mjs). A lab edit reaches the NEXT
 * match; a running match keeps the snapshot it started with.
 *
 * Sim modules read the shipped default objects (src/data/defaults.js) that applySimSnapshot updates in place
 * (this is what the old syncRuntimeModuleExports did implicitly for every lab save, mid-match included).
 */
import { defaultUnitStats, defaultBuildingsData, defaultUnitsVisuals, defaultHeroesData } from '../data/defaults.js';

export const SIM_SNAPSHOT_SCHEMA = 1;

function deepFreeze(o) {
  if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.keys(o)) deepFreeze(o[k]);
  return o;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** FNV-1a over a key-sorted JSON text: same data -> same hash, whatever the key order. */
export function stableHash(value) {
  const text = JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** bundle = { unitStats, buildings, unitsVisuals, heroes } (registry bundle). Returns a deep-frozen plain snapshot. */
export function buildSimSnapshot(bundle, version = 0) {
  const uv = bundle.unitsVisuals || {};
  const body = {
    unitStats: clone({ formationRules: bundle.unitStats?.formationRules, units: bundle.unitStats?.units || {} }),
    buildings: clone({
      economy: bundle.buildings?.economy, sharedBuildingWatchtower: bundle.buildings?.sharedBuildingWatchtower,
      buildings: bundle.buildings?.buildings || {}
    }),
    unitsVisuals: clone({ units: uv.units || {}, prefabs: uv.prefabs || {}, actionRules: uv.actionRules }),
    heroes: clone({ heroes: bundle.heroes?.heroes || {}, spellTrees: bundle.heroes?.spellTrees || {}, hybridSpells: bundle.heroes?.hybridSpells || {} })
  };
  return deepFreeze({ schema: SIM_SNAPSHOT_SCHEMA, version: version | 0, hash: stableHash(body), ...body });
}

function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!(k in b) || !sameValue(a[k], b[k])) return false;
  return true;
}
function syncMap(target, source) {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const k of Object.keys(source)) if (!sameValue(target[k], source[k])) target[k] = clone(source[k]);
}
function syncKey(target, key, value) {
  if (value === undefined) { delete target[key]; return; }
  if (!sameValue(target[key], value)) target[key] = clone(value);
}

let appliedHash = null;
export const appliedSimSnapshotHash = () => appliedHash;

/** The single place that changes the data the sim reads. Idempotent. Returns the snapshot hash. */
export function applySimSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== SIM_SNAPSHOT_SCHEMA) throw new Error('applySimSnapshot: not a sim snapshot (schema ' + snapshot?.schema + ')');
  if (snapshot.hash === appliedHash) return appliedHash;
  const { unitStats, buildings, unitsVisuals, heroes } = snapshot;
  syncKey(defaultUnitStats, 'formationRules', unitStats.formationRules);
  defaultUnitStats.units = defaultUnitStats.units || {};
  syncMap(defaultUnitStats.units, unitStats.units);
  defaultBuildingsData.economy = defaultBuildingsData.economy || {};
  for (const [k, v] of Object.entries(buildings.economy || {})) syncKey(defaultBuildingsData.economy, k, v);
  syncKey(defaultBuildingsData, 'sharedBuildingWatchtower', buildings.sharedBuildingWatchtower);
  defaultBuildingsData.buildings = defaultBuildingsData.buildings || {};
  syncMap(defaultBuildingsData.buildings, buildings.buildings);
  defaultUnitsVisuals.units = defaultUnitsVisuals.units || {};
  syncMap(defaultUnitsVisuals.units, unitsVisuals.units);
  defaultUnitsVisuals.prefabs = defaultUnitsVisuals.prefabs || {};
  syncMap(defaultUnitsVisuals.prefabs, unitsVisuals.prefabs);
  syncKey(defaultUnitsVisuals, 'actionRules', unitsVisuals.actionRules);
  defaultHeroesData.heroes = defaultHeroesData.heroes || {};
  syncMap(defaultHeroesData.heroes, heroes.heroes);
  syncKey(defaultHeroesData, 'spellTrees', heroes.spellTrees);
  syncKey(defaultHeroesData, 'hybridSpells', heroes.hybridSpells);
  appliedHash = snapshot.hash;
  return appliedHash;
}
