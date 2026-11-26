/**
 * Kings Lands - data layout (pure, no I/O, no Three, no DOM).
 *
 * The game data used to live in five monolithic files (units.json 8.7 MB, unitStats.json, buildings.json,
 * buildingVisuals.json, heroes.json). It now lives in many small files, one identity card per race:
 *
 *   races/<race>.json              identity card (references only: ids)
 *   races/<race>/units.json        { visuals: {id: unitVisual}, stats: {id: unitStat} }   (non-base units of that race)
 *   races/<race>/gear.json         { prefabs: {id: prefab} }                                (gear/armour of that race)
 *   races/<race>/animations.json   { keyframes: {...}, procedural: {...} }                  (clips named after that race's units)
 *   races/<race>/heroes.json       { heroes: {...}, prefabs: {...} }                        (only races that have heroes)
 *   bases/<baseId>.json            one base character / mount visual (the heavy meshes)
 *   shared/*.json                  things used by several races (engine config, formations, buildings, common clips...)
 *
 * `splitBundle(mono)` cuts the monolithic bundle into that file map, `assembleBundle(files)` puts it back
 * (deep-equal, tests/regression/data_split_equality.test.mjs proves it). Both are pure functions over
 * `{ [relativePath]: json }`, so the build script, the Vite app and the node tests all use the same code.
 */

/** Races whose data is stored with the bases / shared gear instead of as a race: they are base units only. */
export const BASE_ONLY_RACE_IDS = Object.freeze(['mirukenkay']);

export const SHARED_FILES = Object.freeze({
  engine: 'shared/engineConfig.json',
  unitsMeta: 'shared/unitsMeta.json',           // version, teamPalettes, actionRules, factions, arrowConfig
  unitStatsMeta: 'shared/unitStatsMeta.json',   // version, formationRules
  buildings: 'shared/buildings.json',           // economy, sharedBuildingWatchtower, buildings
  buildingVisuals: 'shared/buildingVisuals.json',
  heroesMeta: 'shared/heroesMeta.json',         // version, spellTrees, hybridSpells, animations
  gear: 'shared/gear.json',                     // prefabs without a race
  animations: 'shared/animations.json',         // clips not tied to one race's unit
  order: 'shared/order.json'                    // original key order of every id-map (UI lists keep their order)
});

const BASE_ID_RE = /(^|_)base(_\d+)?$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Ids that are base characters or mounts: by name, or referenced as baseCharId / mountType by stats and heroes. */
export function deriveBaseIds(mono) {
  const ids = new Set();
  const visuals = mono.unitsVisuals?.units || {};
  for (const id of Object.keys(visuals)) if (BASE_ID_RE.test(id)) ids.add(id);
  for (const s of Object.values(mono.unitStats?.units || {})) {
    // a unit that is its own model (baseCharId === its own id, e.g. the ballista) is a unit, not a shared base
    if (s.baseCharId && s.baseCharId !== s.id && visuals[s.baseCharId]) ids.add(s.baseCharId);
    if (s.mountType && s.mountType !== 'none' && visuals[s.mountType]) ids.add(s.mountType);
  }
  for (const h of Object.values(mono.heroes?.heroes || {})) {
    if (h.baseCharId && visuals[h.baseCharId]) ids.add(h.baseCharId);
  }
  for (const [id, u] of Object.entries(visuals)) if (u.isBaseTemplate || u.isBaseCharacter || u.isMount) ids.add(id);
  return ids;
}

const rKey = (race) => (BASE_ONLY_RACE_IDS.includes(race) ? null : race);
const clip = (name) => name.replace(/__v\d+$/, '');

/** monolith bundle ({unitsVisuals, unitStats, buildings, buildingVisuals, heroes, engineConfig}) -> { path: json } */
export function splitBundle(mono) {
  const files = {};
  const order = {};
  const put = (path, json) => { files[path] = json; };
  const uv = mono.unitsVisuals || {};
  const us = mono.unitStats || {};
  const hv = mono.heroes || {};
  const factions = uv.factions || {};
  const baseIds = deriveBaseIds(mono);
  const raceIds = Object.keys(factions).filter((r) => !BASE_ONLY_RACE_IDS.includes(r));
  const perRace = Object.fromEntries(raceIds.map((r) => [r, { visuals: {}, stats: {}, prefabs: {}, keyframes: {}, procedural: {}, heroes: {}, heroPrefabs: {}, bases: [] }]));
  const sharedGear = {};
  const sharedClips = { keyframes: {}, procedural: {} };
  const recordOrder = (name, obj) => { if (isObj(obj)) order[name] = Object.keys(obj); };

  recordOrder('unitsVisuals.top', uv); recordOrder('unitsVisuals.units', uv.units); recordOrder('unitsVisuals.prefabs', uv.prefabs);
  recordOrder('unitsVisuals.animations', uv.animations); recordOrder('unitsVisuals.keyframes', uv.animations?.keyframes);
  recordOrder('unitsVisuals.procedural', uv.animations?.procedural);
  recordOrder('unitStats.top', us); recordOrder('unitStats.units', us.units);
  recordOrder('heroes.top', hv); recordOrder('heroes.heroes', hv.heroes); recordOrder('heroes.prefabs', hv.prefabs);
  recordOrder('buildings.top', mono.buildings); recordOrder('buildings.buildings', mono.buildings?.buildings);
  recordOrder('buildingVisuals.top', mono.buildingVisuals);

  // ---- unit visuals: bases/<id>.json or races/<race>/units.json (units with an unknown race stay in shared)
  const sharedUnits = {};
  for (const [id, u] of Object.entries(uv.units || {})) {
    if (baseIds.has(id)) { put(`bases/${id}.json`, u); const r = rKey(u.race); if (r && perRace[r]) perRace[r].bases.push(id); continue; }
    const r = rKey(u.race);
    if (r && perRace[r]) perRace[r].visuals[id] = u; else sharedUnits[id] = u;
  }
  // ---- unit stats
  const sharedStats = {};
  for (const [id, s] of Object.entries(us.units || {})) {
    const r = rKey(s.race);
    if (r && perRace[r]) perRace[r].stats[id] = s; else sharedStats[id] = s;
  }
  // ---- gear prefabs
  for (const [id, p] of Object.entries(uv.prefabs || {})) {
    const r = rKey(p.race);
    if (r && perRace[r]) perRace[r].prefabs[id] = p; else sharedGear[id] = p;
  }
  // ---- animation clips: named after a unit of a race -> that race, else shared
  const unitRace = {};
  for (const r of raceIds) for (const id of [...Object.keys(perRace[r].visuals), ...perRace[r].bases]) unitRace[id] = r;
  const clipRace = (name) => {
    const base = clip(name);
    for (const id of Object.keys(unitRace)) if (base.startsWith(`${id}_`)) return unitRace[id];
    return null;
  };
  for (const kind of ['keyframes', 'procedural']) {
    for (const [name, c] of Object.entries(uv.animations?.[kind] || {})) {
      const r = clipRace(name);
      if (r) perRace[r][kind][name] = c; else sharedClips[kind][name] = c;
    }
  }
  // ---- heroes (race field; heroes without a known race stay in shared)
  const sharedHeroes = {};
  for (const [id, h] of Object.entries(hv.heroes || {})) {
    const r = rKey(h.race);
    if (r && perRace[r]) perRace[r].heroes[id] = h; else sharedHeroes[id] = h;
  }
  const heroPrefabRace = {};
  for (const [id, p] of Object.entries(hv.prefabs || {})) {
    const owner = Object.entries(hv.heroes || {}).find(([hid]) => id.startsWith(`${hid}_`) || id.startsWith(`${hid.replace(/^the_/, '')}_`));
    const r = rKey(owner?.[1]?.race);
    if (r && perRace[r]) perRace[r].heroPrefabs[id] = p; else (sharedHeroes.__prefabs ||= {})[id] = p;
  }

  // ---- write race files
  for (const r of raceIds) {
    const d = perRace[r];
    const f = factions[r] || {};
    put(`races/${r}/units.json`, { visuals: d.visuals, stats: d.stats });
    put(`races/${r}/gear.json`, { prefabs: d.prefabs });
    put(`races/${r}/animations.json`, { keyframes: d.keyframes, procedural: d.procedural });
    const hasHeroes = Object.keys(d.heroes).length > 0;
    if (hasHeroes) put(`races/${r}/heroes.json`, { heroes: d.heroes, prefabs: d.heroPrefabs });
    put(`races/${r}.json`, {
      id: r,
      name: f.displayName || r,
      teamColors: f.teamColors ?? null,
      sharedUnits: Boolean(f.sharedUnits),
      bases: d.bases,
      units: Object.keys(d.visuals),
      buildings: 'shared',
      heroes: Object.keys(d.heroes),
      gear: Object.keys(d.prefabs),
      animations: [...Object.keys(d.keyframes), ...Object.keys(d.procedural)],
      files: {
        units: `races/${r}/units.json`,
        gear: `races/${r}/gear.json`,
        animations: `races/${r}/animations.json`,
        ...(hasHeroes ? { heroes: `races/${r}/heroes.json` } : {})
      }
    });
  }

  // ---- shared files
  const { units: _u, prefabs: _p, animations: _a, ...uvMeta } = uv;
  put(SHARED_FILES.unitsMeta, uvMeta);
  const { units: _su, ...usMeta } = us;
  put(SHARED_FILES.unitStatsMeta, usMeta);
  put(SHARED_FILES.buildings, mono.buildings);
  put(SHARED_FILES.buildingVisuals, mono.buildingVisuals);
  const { heroes: _h, prefabs: _hp, ...hvMeta } = hv;
  put(SHARED_FILES.heroesMeta, hvMeta);
  put(SHARED_FILES.gear, { prefabs: sharedGear });
  put(SHARED_FILES.animations, { units: sharedUnits, stats: sharedStats, heroes: sharedHeroes, ...sharedClips });
  if (mono.engineConfig) put(SHARED_FILES.engine, mono.engineConfig);
  put(SHARED_FILES.order, order);
  return files;
}

const sortLike = (obj, keys) => {
  if (!keys) return obj;
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
  return out;
};

/** { path: json } -> monolith bundle. Inverse of splitBundle (key order restored from shared/order.json). */
export function assembleBundle(files) {
  const order = files[SHARED_FILES.order] || {};
  const sharedAnim = files[SHARED_FILES.animations] || {};
  const raceCards = Object.keys(files).filter((p) => /^races\/[^/]+\.json$/.test(p)).map((p) => files[p]);
  const units = { ...(sharedAnim.units || {}) };
  const stats = { ...(sharedAnim.stats || {}) };
  const prefabs = { ...(files[SHARED_FILES.gear]?.prefabs || {}) };
  const keyframes = { ...(sharedAnim.keyframes || {}) };
  const procedural = { ...(sharedAnim.procedural || {}) };
  const heroes = { ...(sharedAnim.heroes || {}) };
  const heroPrefabs = { ...(heroes.__prefabs || {}) };
  delete heroes.__prefabs;

  for (const [path, json] of Object.entries(files)) {
    if (/^bases\/[^/]+\.json$/.test(path)) units[json.id || path.slice(6, -5)] = json;
  }
  for (const card of raceCards) {
    const u = files[card.files.units] || {};
    Object.assign(units, u.visuals); Object.assign(stats, u.stats);
    Object.assign(prefabs, files[card.files.gear]?.prefabs);
    const an = files[card.files.animations] || {};
    Object.assign(keyframes, an.keyframes); Object.assign(procedural, an.procedural);
    if (card.files.heroes) {
      const h = files[card.files.heroes];
      Object.assign(heroes, h.heroes); Object.assign(heroPrefabs, h.prefabs);
    }
  }
  const uvMeta = files[SHARED_FILES.unitsMeta] || {};
  const unitsVisuals = sortLike({
    ...uvMeta,
    units: sortLike(units, order['unitsVisuals.units']),
    prefabs: sortLike(prefabs, order['unitsVisuals.prefabs']),
    animations: sortLike({ keyframes: sortLike(keyframes, order['unitsVisuals.keyframes']), procedural: sortLike(procedural, order['unitsVisuals.procedural']) }, order['unitsVisuals.animations'])
  }, order['unitsVisuals.top']);
  const unitStats = sortLike({ ...(files[SHARED_FILES.unitStatsMeta] || {}), units: sortLike(stats, order['unitStats.units']) }, order['unitStats.top']);
  const hMeta = files[SHARED_FILES.heroesMeta] || {};
  const heroesData = sortLike({ ...hMeta, heroes: sortLike(heroes, order['heroes.heroes']), prefabs: sortLike(heroPrefabs, order['heroes.prefabs']) }, order['heroes.top']);
  const buildings = files[SHARED_FILES.buildings];
  const out = { unitsVisuals, unitStats, buildings, buildingVisuals: files[SHARED_FILES.buildingVisuals], heroes: heroesData };
  if (files[SHARED_FILES.engine]) out.engineConfig = files[SHARED_FILES.engine];
  return out;
}
