/**
 * Building parts (stage 1 data layer). Pure functions, no registry / DOM / Three.js imports.
 *
 * A building owns a list `bDef.parts` (stored in shared/buildings.json -> buildings.<id>.parts and saved through
 * dataRegistry.saveBuilding like every other building field). Each part follows the building body.
 *
 *   kind 'model'       - something you see (glb / prefab / primitive), may have its own animation clip tracks
 *   kind 'fire_point'  - where arrows are shot from + range / damage / reload (not tied to any tower)
 *   kind 'exit_point'  - where units come out (pos = the door spot). A building has AT MOST ONE.
 *   kind 'group'       - an empty object (label only): other parts can be placed under it (`parent`) and move / hide / switch off with it
 *
 * Hierarchy: `parent` = id of another part (usually a group) or null. A child's pos/rot/scale are relative to its parent.
 *   A part is only active when it AND all its ancestors are enabled and inside their level range.
 * Common fields : { id, kind, name, enabled, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z], minLevel, maxLevel }
 *   enabled: false = the part is switched off (not in the game: no model, no shooting, no exit); the Studio still shows it dimmed.
 *   pos is in metres relative to the building centre, y up (same unit as the legacy `turretOffset`).
 *   minLevel/maxLevel: the part exists from building level minLevel to maxLevel (maxLevel null = no upper bound).
 * model         : + model: { type: 'glb'|'prefab'|'primitive', ref: string, primitive?: {...} }
 *                 glb = imported file kept inside the part: { type:'glb', ref:<unique id>, name, glbBase64, glbByteLength, fitSize }
 *                 (textures are inside the glb; fitSize = size in metres of the longest side at scale 1)
 * fire_point    : + range, damage, reloadMinTicks, reloadMaxTicks, volleyCount, elevationRangeBonus
 *                 + levelStats?: { "<level>": { range?, damage?, ... } }   (overrides from that level on)
 *
 * Part animations: keyframe tracks of a building clip use the part id as the joint name (tracks.<partId>),
 * exactly like tracks.torso does today. No separate animation store.
 */

export const PART_KINDS = Object.freeze(['model', 'fire_point', 'exit_point', 'group']);
export const FIRE_STAT_KEYS = Object.freeze(['range', 'damage', 'reloadMinTicks', 'reloadMaxTicks', 'volleyCount', 'elevationRangeBonus']);

const clone = (v) => JSON.parse(JSON.stringify(v));
const vec = (v, d) => (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(Number(n))) ? v.map(Number) : [...d]);

/** A new part with sane defaults; `over` wins. The id is made unique among `existing` parts. */
export function newPart(kind, over = {}, existing = []) {
  if (!PART_KINDS.includes(kind)) throw new Error(`Unknown part kind "${kind}"`);
  const taken = new Set((existing || []).map((p) => p.id));
  const base = over.id || kind;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  const part = {
    id,
    kind,
    name: over.name || id,
    parent: over.parent || null,
    enabled: over.enabled !== false,
    pos: vec(over.pos, [0, 0, 0]),
    rot: vec(over.rot, [0, 0, 0]),
    scale: vec(over.scale, [1, 1, 1]),
    minLevel: Number.isFinite(Number(over.minLevel)) ? Math.max(1, Number(over.minLevel) | 0) : 1,
    maxLevel: over.maxLevel === null || over.maxLevel === undefined ? null : Math.max(1, Number(over.maxLevel) | 0)
  };
  if (kind === 'model') part.model = clone(over.model || { type: 'primitive', ref: 'box', primitive: { shape: 'box', size: [1, 1, 1], color: '#94a3b8' } });
  if (kind === 'fire_point') {
    Object.assign(part, { range: 28, damage: 10, reloadMinTicks: 44, reloadMaxTicks: 58, volleyCount: 1, elevationRangeBonus: 0 });
    for (const k of FIRE_STAT_KEYS) if (Number.isFinite(Number(over[k]))) part[k] = Number(over[k]);
    if (over.levelStats) part.levelStats = clone(over.levelStats);
  }
  return part;
}

/** Is the part present at this building level? */
export function isPartActiveAtLevel(part, level) {
  if (part.enabled === false) return false;
  const lv = Math.max(1, Number(level) | 0 || 1);
  return lv >= (part.minLevel || 1) && (part.maxLevel == null || lv <= part.maxLevel);
}

export function partsActiveAtLevel(parts, level) {
  return (parts || []).filter((p) => isPartEffectivelyActive(parts, p, level));
}

/** Active at the level AND every ancestor (group) active too. */
export function isPartEffectivelyActive(parts, part, level) {
  const byId = new Map((parts || []).map((q) => [q.id, q]));
  let cur = part;
  for (let guard = 0; cur && guard < 32; guard++) {
    if (!isPartActiveAtLevel(cur, level)) return false;
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return true;
}

function eulerXYZ(v, [rx, ry, rz]) {
  const [x, y, z] = v;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  let y1 = y * cx - z * sx, z1 = y * sx + z * cx;
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [x2 * cz - y1 * sz, x2 * sz + y1 * cz, z2];
}

/** Position of a part in building space (its own pos transformed through all its parents; three.js Euler XYZ order). */
export function resolvePartPosition(parts, part) {
  const byId = new Map((parts || []).map((q) => [q.id, q]));
  let pos = [...(part.pos || [0, 0, 0])];
  let cur = part.parent ? byId.get(part.parent) : null;
  for (let guard = 0; cur && guard < 32; guard++) {
    const s = cur.scale || [1, 1, 1];
    const rotated = eulerXYZ([pos[0] * s[0], pos[1] * s[1], pos[2] * s[2]], cur.rot || [0, 0, 0]);
    const cp = cur.pos || [0, 0, 0];
    pos = [rotated[0] + cp[0], rotated[1] + cp[1], rotated[2] + cp[2]];
    cur = cur.parent ? byId.get(cur.parent) : null;
  }
  return pos;
}

/** Fire stats of a fire_point at a level (base values + the highest levelStats entry <= level, applied in order). */
export function fireStatsAtLevel(part, level) {
  const out = {};
  for (const k of FIRE_STAT_KEYS) out[k] = Number(part[k]) || 0;
  const ls = part.levelStats || {};
  for (const lv of Object.keys(ls).map(Number).filter((n) => n <= level).sort((a, b) => a - b)) Object.assign(out, ls[lv]);
  return out;
}

/** Parts of a building as the game / Studio should use them (stored parts, else derived from the legacy tower fields). */
export function effectiveParts(bDef, sharedWatchtower = null) {
  if (Array.isArray(bDef?.parts)) return bDef.parts;
  return legacyPartsFromDef(bDef, sharedWatchtower);
}

/**
 * The old tower model expressed as parts, so existing buildings keep their behaviour until someone edits them:
 *  - built-in turret (citadel, watchtower, ballista_tower): a fire_point at `turretOffset` with the turret* stats
 *  - upgrade watchtower (barracks...): a tower model part + a fire_point, both from `watchtowerLevel` on.
 */
export function legacyPartsFromDef(bDef, sharedWatchtower = null) {
  if (!bDef || typeof bDef !== 'object') return [];
  const parts = [];
  const off = Array.isArray(bDef.turretOffset) ? bDef.turretOffset : [0, 6.5, 0];
  if (bDef.hasBuiltInTurret) {
    parts.push(newPart('fire_point', {
      id: 'fire_main', name: 'Fire point', pos: off,
      range: bDef.turretRangeMeters, damage: bDef.turretDamage, reloadMinTicks: bDef.turretReloadMinTicks,
      reloadMaxTicks: bDef.turretReloadMaxTicks, volleyCount: bDef.turretVolleyCount,
      elevationRangeBonus: bDef.garrisonElevationRangeBonusMeters
    }));
  } else if (bDef.hasWatchtowerSupport !== false && (bDef.watchtowerLevel | 0) > 0) {
    const r = Math.max(1, Number(bDef.footprintRadiusMeters) || 5);
    const wt = sharedWatchtower || {};
    const lv = bDef.watchtowerLevel | 0;
    parts.push(newPart('model', {
      id: 'watchtower', name: 'Watchtower', minLevel: lv,
      pos: [(Number.isFinite(Number(bDef.watchtowerX)) ? Number(bDef.watchtowerX) : 0.56) * r, 0, (Number.isFinite(Number(bDef.watchtowerZ)) ? Number(bDef.watchtowerZ) : -0.52) * r],
      model: { type: 'primitive', ref: 'watchtower' }
    }));
    parts.push(newPart('fire_point', {
      id: 'fire_watchtower', name: 'Fire point', minLevel: lv, pos: off,
      range: wt.rangeMeters, damage: wt.damage, reloadMinTicks: wt.reloadMinTicks, reloadMaxTicks: wt.reloadMaxTicks,
      volleyCount: wt.volleyCount, elevationRangeBonus: wt.elevationRangeBonusMeters
    }));
  }
  return parts;
}

/** Structural validation. Returns [{ level:'error'|'warn', message }] (empty = fine). */
export function validateParts(bDef, { knownPrefabs = null } = {}) {
  const issues = [];
  const err = (message) => issues.push({ level: 'error', message });
  const parts = bDef?.parts;
  if (parts === undefined) return issues;
  if (!Array.isArray(parts)) { err('"parts" must be a list'); return issues; }
  const ids = new Set();
  for (const [i, p] of parts.entries()) {
    const tag = `part #${i + 1}${p?.id ? ` "${p.id}"` : ''}`;
    if (!p || typeof p !== 'object') { err(`${tag} is not an object`); continue; }
    if (!p.id || typeof p.id !== 'string') err(`${tag} has no id`);
    else if (ids.has(p.id)) err(`${tag}: duplicate part id`);
    else ids.add(p.id);
    if (!PART_KINDS.includes(p.kind)) err(`${tag}: unknown kind "${p.kind}"`);
    for (const f of ['pos', 'rot', 'scale']) {
      if (!Array.isArray(p[f]) || p[f].length !== 3 || !p[f].every((n) => Number.isFinite(Number(n)))) err(`${tag}: ${f} must be [x, y, z]`);
    }
    if (Array.isArray(p.scale) && p.scale.some((n) => !(Number(n) > 0))) err(`${tag}: scale must be > 0`);
    if (!(Number(p.minLevel) >= 1)) err(`${tag}: minLevel must be >= 1`);
    if (p.maxLevel != null && !(Number(p.maxLevel) >= Number(p.minLevel))) err(`${tag}: maxLevel is below minLevel`);
    if (p.parent != null) {
      const par = parts.find((q) => q && q.id === p.parent);
      if (!par) err(`${tag}: parent "${p.parent}" does not exist`);
      else if (par.kind !== 'group' && par.kind !== 'model') err(`${tag}: parent must be a group or a model part`);
      else {
        let cur = par;
        for (let g = 0; cur && g < 40; g++) { if (cur.id === p.id) { err(`${tag}: parent loop`); break; } cur = cur.parent ? parts.find((q) => q.id === cur.parent) : null; }
      }
    }
    if (p.kind === 'model') {
      if (!p.model || !['glb', 'prefab', 'primitive'].includes(p.model.type)) err(`${tag}: model.type must be glb, prefab or primitive`);
      else if (p.model.type === 'glb' && (typeof p.model.glbBase64 !== 'string' || !p.model.glbBase64.length)) err(`${tag}: glb model has no data`);
      else if (p.model.type === 'prefab' && knownPrefabs && !knownPrefabs.has(p.model.ref)) err(`${tag}: prefab "${p.model.ref}" does not exist`);
    }
    if (p.kind === 'fire_point') {
      for (const k of ['range', 'damage', 'reloadMinTicks', 'reloadMaxTicks', 'volleyCount']) {
        if (!(Number(p[k]) > 0)) err(`${tag}: ${k} must be > 0`);
      }
      if (Number(p.reloadMaxTicks) < Number(p.reloadMinTicks)) err(`${tag}: reloadMaxTicks is below reloadMinTicks`);
    }
  }
  if (parts.filter((p) => p?.kind === 'exit_point').length > 1) err('a building can have only ONE exit point');
  return issues;
}
