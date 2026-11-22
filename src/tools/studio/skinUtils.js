/**
 * Kings Lands — Studio skin & dynamic faction helpers (src/tools/studio/skinUtils.js)
 *
 * Shared by the studio viewport, modelFactory, healthCheck and the sandbox arena.
 * Factions are discovered dynamically from units.json (`data.factions`, `unit.race`, `unit.skins`),
 * so adding a new faction/race in units.json never requires editing code.
 */

/** Fallback team-colour tint per built-in faction when `data.factions[id].teamColors` is not specified. */
export const FACTION_TEAM_COLORS = Object.freeze({
  human: null,
  orc: Object.freeze({ primary: '#064e3b', secondary: '#7f1d1d' }),
  elf: Object.freeze({ primary: '#0f766e', secondary: '#fde047' }),
  katiler: Object.freeze({ primary: '#4c1d95', secondary: '#d4a017' }),
  mirukenkay: Object.freeze({ primary: '#d97706', secondary: '#f5f5f4' })
});

/**
 * Discover every faction/race present in `unitsData` dynamically:
 *  1. keys of `unitsData.factions`
 *  2. any `unit.race` in `unitsData.units`
 *  3. any `unit.skins` key in `unitsData.units`
 *  4. fallback defaults if `unitsData` is empty
 */
export function getFactions(unitsData) {
  const out = new Set();
  if (unitsData?.factions && typeof unitsData.factions === 'object') {
    for (const k of Object.keys(unitsData.factions)) if (k) out.add(k);
  }
  for (const u of Object.values(unitsData?.units || {})) {
    if (u?.race) out.add(u.race);
    for (const k of Object.keys(u?.skins || {})) if (k) out.add(k);
  }
  if (out.size === 0) {
    for (const k of ['human', 'orc', 'elf', 'katiler']) out.add(k);
  }
  return [...out];
}

/** Human-readable display name for a faction ID. */
export function getFactionLabel(unitsData, faction) {
  if (!faction) return '';
  const explicit = unitsData?.factions?.[faction]?.displayName;
  if (explicit) return explicit;
  return faction.charAt(0).toUpperCase() + faction.slice(1);
}

/** Team colour overrides for a faction, read from `unitsData.factions[faction].teamColors` first. */
export function getFactionColors(unitsData, faction) {
  if (!faction) return null;
  const fromData = unitsData?.factions?.[faction]?.teamColors;
  if (fromData !== undefined) return fromData;
  return FACTION_TEAM_COLORS[faction] || null;
}

/**
 * Does `faction` use the shared (race-less) units like swordsman/spearman/archer,
 * or does it have its own dedicated race units?
 */
export function isSharedUnitsFaction(unitsData, faction) {
  const explicit = unitsData?.factions?.[faction]?.sharedUnits;
  if (typeof explicit === 'boolean') return explicit;
  const hasOwnRaceUnits = Object.values(unitsData?.units || {}).some((u) => u?.race === faction);
  return !hasOwnRaceUnits;
}

/**
 * ModelFactory shares one material between every mesh with the same colour (per team scope).
 * Before a mesh is recoloured it gets its OWN copy, so the change can never leak into other parts / units / later spawns.
 */
export function ownMaterial(mesh) {
  const m = mesh?.material;
  if (!m || m.userData?.ownMaterial) return m;
  const copy = m.clone();
  copy.userData = { ...m.userData, ownMaterial: true };
  mesh.material = copy;
  return copy;
}

/**
 * Paint the per-joint colour overrides (unit level, then skin level on top).
 * An override is keyed by JOINT name and paints every mesh directly under that joint.
 * Painted meshes get their own material (see ownMaterial), so team-colour changes
 * (applyTeamColors) no longer touch them.
 */
export function applySkinColors(group, unitDef, faction) {
  if (!group) return;
  const merged = { ...(unitDef?.colorOverrides || {}), ...(unitDef?.skins?.[faction]?.colorOverrides || {}) };
  if (Object.keys(merged).length === 0) return;

  const trouserColor = merged.leg_R || merged.leg_L || merged.pelvis || null;
  const trouserBaseMeshes = new Set([
    "shorts_hip", "glute_R", "glute_L",
    "thigh_R", "quad_R", "shorts_leg_R",
    "thigh_L", "quad_L", "shorts_leg_L",
    "knee_R", "kneecap_R", "calf_R", "calf_muscle_R",
    "knee_L", "kneecap_L", "calf_L", "calf_muscle_L",
    "trouser_leg_R", "trouser_leg_L",
    "padded_trouser_leg_R", "padded_trouser_leg_L",
    "royal_trouser_leg_R", "royal_trouser_leg_L"
  ]);

  group.traverse((child) => {
    if (!child.isMesh || !child.parent) return;
    if (trouserColor && trouserBaseMeshes.has(child.name)) {
      ownMaterial(child).color.set(trouserColor);
      return;
    }
    const hex = merged[child.parent.name];
    if (!hex || !child.material || !child.material.color) return;
    ownMaterial(child).color.set(hex);
  });
}

/**
 * Free the materials a visual owns. Shared materials and geometries are NOT disposed
 * (ModelFactory caches them and shares them between units).
 */
export function disposeVisual(group) {
  if (!group) return;
  group.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const list = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of list) if (m?.userData?.ownMaterial) m.dispose?.();
  });
}
