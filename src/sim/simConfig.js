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
 * Sim modules read their data ONLY through the accessors below (simUnitStats / simBuildings / simUnitsVisuals /
 * simHeroes). The data behind them is owned by this module:
 *   worker      : a private view that applySimSnapshot fills (identity-stable, updated in place between matches)
 *   main thread : the HUD/formation code that shares sim helpers calls setSimDataSource(() => registry view), so it
 *                 always sees the live registry data
 * Nothing mutates the shipped objects of src/data/defaults.js any more; they stay pristine for the registry baseline.
 * Without a snapshot (unit tests that build a GameState directly) the view starts as a copy of the shipped data.
 */
import { defaultUnitStats, defaultBuildingsData, defaultUnitsVisuals, defaultHeroesData } from '../data/defaults.js';
import { dataHash, BLOB_KEYS, BLOB_MIN } from '../data/dataHash.js';

export const SIM_SNAPSHOT_SCHEMA = 1;

function deepFreeze(o) {
  if (!o || typeof o !== 'object' || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.keys(o)) deepFreeze(o[k]);
  return o;
}

/**
 * Deep copy for the sim. Mesh arrays (vertices / faces / colors ...) are visual-only: the sim never reads them, so they
 * are dropped (empty arrays) - the snapshot shrinks from several MB to a few hundred KB, which makes the hand-over to
 * the worker, the hash and the apply step cheap. Mesh edits therefore do not change the snapshot hash.
 */
function clone(v, key) {
  if (v === undefined || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    if (key !== undefined && v.length >= BLOB_MIN && BLOB_KEYS.has(key)) return [];
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = clone(v[i]);
    return out;
  }
  const out = {};
  for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = clone(v[k], k);
  return out;
}

export const stableHash = dataHash;

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

// ---- the sim's private view of game data ----------------------------------------------------------------------
const view = { unitStats: null, buildings: null, unitsVisuals: null, heroes: null };
let externalSource = null;

function shippedView() {
  return {
    unitStats: clone({ formationRules: defaultUnitStats.formationRules, units: defaultUnitStats.units || {} }),
    buildings: clone({ economy: defaultBuildingsData.economy, sharedBuildingWatchtower: defaultBuildingsData.sharedBuildingWatchtower, buildings: defaultBuildingsData.buildings || {} }),
    unitsVisuals: clone({ units: defaultUnitsVisuals.units || {}, prefabs: defaultUnitsVisuals.prefabs || {}, actionRules: defaultUnitsVisuals.actionRules }),
    heroes: clone({ heroes: defaultHeroesData.heroes || {}, spellTrees: defaultHeroesData.spellTrees || {}, hybridSpells: defaultHeroesData.hybridSpells || {} })
  };
}

function ensureView() {
  if (!view.unitStats) Object.assign(view, shippedView());
  return view;
}

/**
 * Main thread only: read from another live source (the data registry) instead of the snapshot view.
 * `fn()` returns { unitStats, buildings, unitsVisuals, heroes } and must be cheap (no cloning). Pass null to unbind.
 */
export function setSimDataSource(fn) {
  externalSource = typeof fn === 'function' ? fn : null;
}

const current = () => (externalSource ? externalSource() : ensureView());

/** { formationRules, units } */
export const simUnitStats = () => current().unitStats;
/** { economy, sharedBuildingWatchtower, buildings } */
export const simBuildings = () => current().buildings;
/** { units, prefabs, actionRules } */
export const simUnitsVisuals = () => current().unitsVisuals;
/** { heroes, spellTrees, hybridSpells } */
export const simHeroes = () => current().heroes;

let appliedHash = null;
export const appliedSimSnapshotHash = () => appliedHash;

/** The single place that changes the data the sim reads. Idempotent. Returns the snapshot hash. */
export function applySimSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== SIM_SNAPSHOT_SCHEMA) throw new Error('applySimSnapshot: not a sim snapshot (schema ' + snapshot?.schema + ')');
  if (snapshot.hash === appliedHash && view.unitStats) return appliedHash;
  const v = ensureView();
  const { unitStats, buildings, unitsVisuals, heroes } = snapshot;
  syncKey(v.unitStats, 'formationRules', unitStats.formationRules);
  syncMap(v.unitStats.units, unitStats.units);
  v.buildings.economy = v.buildings.economy || {};
  for (const [k, val] of Object.entries(buildings.economy || {})) syncKey(v.buildings.economy, k, val);
  syncKey(v.buildings, 'sharedBuildingWatchtower', buildings.sharedBuildingWatchtower);
  syncMap(v.buildings.buildings, buildings.buildings);
  syncMap(v.unitsVisuals.units, unitsVisuals.units);
  syncMap(v.unitsVisuals.prefabs, unitsVisuals.prefabs);
  syncKey(v.unitsVisuals, 'actionRules', unitsVisuals.actionRules);
  syncMap(v.heroes.heroes, heroes.heroes);
  syncKey(v.heroes, 'spellTrees', heroes.spellTrees);
  syncKey(v.heroes, 'hybridSpells', heroes.hybridSpells);
  appliedHash = snapshot.hash;
  return appliedHash;
}
