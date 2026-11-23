/**
 * Kings Lands — base-unit ids and one-off draft clean-up (src/tools/studio/baseUnitsMigration.js)
 *
 * The human base characters are now:
 *   human_base_1  the ORIGINAL human_base that was already in the game (renamed, geometry untouched)
 *   human_base_2  the detailed, scan-derived base (per-vertex colours + normals, joint domes so it does not break when posed)
 *
 * Saved drafts (localStorage, `kings_lands_studio_draft_v3`) keep their own copy of every unit and only ever ADD missing ones from units.json,
 * so after units.json changed an old draft would keep shadowing the new base characters. `migrateDraftData` fixes that:
 *   - a draft's legacy `human_base` (the original, possibly edited) becomes `human_base_1` and replaces the obsolete generated human_base_1;
 *   - units / prefabs of an earlier delivery that are not wanted any more are dropped (`RETIRED_*`);
 *   - the base characters in `MANAGED_BASE_IDS` are refreshed from the shipped units.json when the shipped version changed
 *     (the draft remembers a hash of the shipped version it was saved against, `managedHashes`), otherwise the draft's own copy is kept.
 * `pruneDraftForRuntime` applies the same rules read-only for code that merges the draft over units.json without opening the lab (game, Hall of Heroes).
 */

export const DEFAULT_BASE_CHAR_ID = 'human_base_1';

/** old id -> current id (stats / drafts written before the rename still say `human_base`) */
export const LEGACY_BASE_ALIASES = Object.freeze({ human_base: 'human_base_1' });

/** base characters that are shipped data, not user content: refreshed from units.json when the shipped one changes */
export const MANAGED_BASE_IDS = Object.freeze(['human_base_1', 'human_base_2']);

export const RETIRED_UNIT_IDS = Object.freeze(['mirukenkay_light', 'mirukenkay_medium', 'mirukenkay_heavy', 'mirukenkay_royal']);
export const RETIRED_PREFAB_RE = /^mirukenkay_gb_/;

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

const deepClone = (o) => JSON.parse(JSON.stringify(o));

const _hashCache = new WeakMap(); // shipped units object -> { id: hash } (the human_base_2 mesh is a few MB: hash it once)

/** hash of every managed base character in the shipped units.json (saved with the draft) */
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

function hasMeshShape(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node.meshes) && node.meshes.some((m) => m && m.shape === 'mesh')) return true;
  for (const c of Object.values(node.children || {})) if (hasMeshShape(c)) return true;
  for (const c of Object.values(node.hierarchy || {})) if (hasMeshShape(c)) return true;
  return false;
}

/** is the draft's copy of a managed base character obsolete (so the shipped one should be used)? */
function isStaleManaged(id, cur, shipped, recorded) {
  const sh = shipped.units[id];
  if (!sh || !cur) return false;
  const shHash = computeManagedHashes(shipped)[id];
  if (recorded && recorded[id]) return recorded[id] !== shHash;               // shipped version changed since the draft was saved
  // draft saved before hashes existed: whatever an earlier delivery generated is obsolete
  if (id === 'human_base_2') return true;
  return hasMeshShape(cur) && !hasMeshShape(sh);
}

/**
 * @param {object} data       parsed draft ({units, prefabs, ...}); modified in place
 * @param {object} shipped    the shipped units.json
 * @param {Record<string,string>|null} recorded  `managedHashes` saved with the draft (null for drafts saved before this existed)
 * @returns {string[]} human-readable notes of what changed (empty = nothing to do)
 */
export function migrateDraftData(data, shipped, recorded = null) {
  const notes = [];
  if (!data || !data.units || !shipped?.units) return notes;

  // legacy id: the draft's `human_base` is the original base (maybe with the author's edits) -> human_base_1
  if (data.units.human_base && !shipped.units.human_base) {
    const cur1 = data.units.human_base_1;
    if (!cur1 || isStaleManaged('human_base_1', cur1, shipped, recorded)) {
      data.units.human_base_1 = { ...data.units.human_base, id: 'human_base_1' };
      if (shipped.units.human_base_1?.displayName && /^human base( character)?$/i.test(String(data.units.human_base.displayName || ''))) {
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
      if (RETIRED_PREFAB_RE.test(id) && !shipped.prefabs?.[id]) { delete data.prefabs[id]; n++; }
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

/**
 * Read-only version for code that merges the saved draft over units.json without opening the lab (game start, Hall of Heroes).
 * Returns the draft's `units` / `prefabs` WITHOUT the entries that migrateDraftData would drop or refresh (shallow copies, nothing cloned).
 */
export function pruneDraftForRuntime(draft, shipped, recorded = null) {
  const units = {}, prefabs = {};
  if (!draft) return { units, prefabs };
  for (const [id, u] of Object.entries(draft.units || {})) {
    if (!shipped?.units) { units[id] = u; continue; }
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
