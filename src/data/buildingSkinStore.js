/**
 * Building skins store (imported GLB skins for buildings).
 *
 * Skins are kept OUT of the huge Studio draft (the whole units.json, >5 MB, which does not fit in
 * localStorage). The Studio writes here; the buildings lab and the game read from here.
 * Shape: { [buildingId]: { active: 'default'|skinId, items: { [skinId]: { name, fitRadius, mesh:{vertices,faces,colors}, importInfo } } } }
 */
export const BUILDING_SKINS_KEY = 'kings_lands_building_skins_v1';

let cache = null;

export function loadBuildingSkins() {
  if (cache) return cache;
  cache = {};
  try {
    const raw = globalThis.localStorage?.getItem(BUILDING_SKINS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') cache = parsed;
    }
  } catch (_) { /* storage blocked / corrupt: fall back to static data */ }
  return cache;
}

const r4 = (n) => Math.round(n * 10000) / 10000;

/** Writes the skins (compact numbers). Returns { ok, error?, bytes }. */
export function saveBuildingSkins(skins = loadBuildingSkins()) {
  const compact = {};
  for (const [bid, e] of Object.entries(skins || {})) {
    if (!e || !e.items || !Object.keys(e.items).length) continue;
    const items = {};
    for (const [sid, it] of Object.entries(e.items)) {
      if (!it?.mesh) continue;
      items[sid] = {
        ...it,
        mesh: {
          vertices: it.mesh.vertices.map((v) => [r4(v[0]), r4(v[1]), r4(v[2])]),
          faces: it.mesh.faces,
          colors: it.mesh.colors
        }
      };
    }
    compact[bid] = { active: e.active || 'default', items };
  }
  try {
    const json = JSON.stringify(compact);
    globalThis.localStorage.setItem(BUILDING_SKINS_KEY, json);
    return { ok: true, bytes: json.length };
  } catch (error) {
    return { ok: false, error: String(error?.name || error) };
  }
}
