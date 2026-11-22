/**
 * Kings Lands — Studio clip naming, variations & resolution (src/tools/studio/clipResolver.js)
 *
 * Phase 8 Update:
 * - Supports dynamic Hero spell animation slots (`spell_<spellId>`), resolving both
 *   hero-specific `${heroId}_${faction}_spell_<spellId>` and global `spell_<spellId>` clips.
 * - Resolves weapon-specific combat base (`getEquipmentCombatBase`) per active loadout so Set 1 and Set 2
 *    stay 100% synchronized across Animation Lab, Fighters Lab, Simulators, and Main Game.
 */

import { weaponTypeOf } from './weaponRules.js';

export const MOVE_CLIPS = Object.freeze([
  'idle',
  'walk',
  'run',
  'charge',
  'retreat_run',
  'gallop',
  'worker_build',
  'worker_chop',
  'worker_mine'
]);

export const ACTION_CLIPS = Object.freeze([
  'attack_slash',
  'attack_thrust',
  'shoot_bow',
  'throw_javelin',
  'attack_bash',
  'block',
  'worker_build',
  'worker_chop',
  'worker_mine',
  'switch_weapon',
  'take_damage',
  'knocked_down',
  'victory_cheer',
  'die'
]);

export const ATTACK_CLIPS = Object.freeze([
  'attack_slash',
  'attack_thrust',
  'shoot_bow',
  'throw_javelin',
  'attack_bash'
]);

export const BUILDING_CLIPS = Object.freeze([
  'build_construct',
  'idle',
  'level_up',
  'recruit_spawn',
  'damage_stage_1',
  'damage_stage_2',
  'collapse_destroy'
]);

const ALL_BASES = Object.freeze([...new Set([...ACTION_CLIPS, ...MOVE_CLIPS, ...BUILDING_CLIPS])]);

export const isMoveClip = (base) => MOVE_CLIPS.includes(base);
export const isAttackClip = (base) => ATTACK_CLIPS.includes(base);
export const isSpellClip = (base) => typeof base === 'string' && base.startsWith('spell_');

export function stripVariantSuffix(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/__v\d+$/, '');
}

export function variantIndexOf(name) {
  if (typeof name !== 'string') return 1;
  const m = /__v(\d+)$/.exec(name);
  return m ? Math.max(1, Number(m[1]) | 0) : 1;
}

export function withVariantIndex(baseClipName, variantIdx = 1) {
  const clean = stripVariantSuffix(baseClipName);
  const v = Number(variantIdx) | 0;
  return v > 1 ? `${clean}__v${v}` : clean;
}

export const clipNameFor = (unitId, faction, base, variantIdx = 1) =>
  withVariantIndex(`${unitId}_${faction}_${stripVariantSuffix(base)}`, variantIdx);

export const unitClipNameFor = (unitId, base, variantIdx = 1) =>
  withVariantIndex(`${unitId}_${stripVariantSuffix(base)}`, variantIdx);

/** "swordsman_human_attack_slash__v2" -> "attack_slash" or "wizard_human_spell_fireball" -> "spell_fireball". */
export function baseOfClip(name) {
  if (typeof name !== 'string' || !name) return null;
  const clean = stripVariantSuffix(name);
  const spellMatch = /(?:^|_)(spell_[a-z0-9_]+)$/i.exec(clean);
  if (spellMatch) return spellMatch[1];
  let best = null;
  for (const b of ALL_BASES) {
    if (clean === b || clean.endsWith(`_${b}`)) {
      if (!best || b.length > best.length) best = b;
    }
  }
  return best;
}

/** Does a clip called `name` exist for this kind of base clip? */
export function clipExists(anims, base, name) {
  if (!anims || !name) return false;
  if (isMoveClip(base)) {
    const kf = anims.keyframes?.[name];
    if (kf && kf.tracks && Object.keys(kf.tracks).length > 0) return true;
    if (anims.procedural?.[name]) return true;
    return false;
  }
  return Boolean(anims.keyframes?.[name]);
}

export function resolveClip(data, unitId, faction, base, variantIdx = 1) {
  const anims = data?.animations;
  const cleanBase = stripVariantSuffix(base);
  const specific = clipNameFor(unitId, faction, cleanBase, variantIdx);
  if (clipExists(anims, cleanBase, specific)) return specific;
  const unitWide = unitClipNameFor(unitId, cleanBase, variantIdx);
  if (clipExists(anims, cleanBase, unitWide)) return unitWide;
  const globalVar = withVariantIndex(cleanBase, variantIdx);
  if (clipExists(anims, cleanBase, globalVar)) return globalVar;
  if (variantIdx > 1) {
    return resolveClip(data, unitId, faction, cleanBase, 1);
  }
  return cleanBase;
}

/**
 * Returns all existing variation clip names [v1, v2, v3, ...] for (unitId, faction, base).
 * Used both by the Studio variation bar and by UnitRenderer for randomized live variation playback!
 */
export function resolveClipVariants(data, unitId, faction, base, scope = 'unit') {
  const anims = data?.animations;
  const kf = anims?.keyframes || {};
  const cleanBase = stripVariantSuffix(base);
  const v1 = scope === 'global' ? cleanBase : resolveClip(data, unitId, faction, cleanBase, 1);
  const out = [v1];

  const candidatePrefixes =
    scope === 'global'
      ? [cleanBase]
      : [
          `${unitId}_${faction}_${cleanBase}`,
          `${unitId}_${cleanBase}`,
          cleanBase
        ];

  const foundByIdx = new Map();
  for (const key of Object.keys(kf)) {
    const vIdx = variantIndexOf(key);
    if (vIdx <= 1) continue;
    const stripped = stripVariantSuffix(key);
    const pRank = candidatePrefixes.indexOf(stripped);
    if (pRank === -1) continue;
    if (!clipExists(anims, cleanBase, key)) continue;
    const prev = foundByIdx.get(vIdx);
    if (!prev || pRank < prev.pRank) {
      foundByIdx.set(vIdx, { key, pRank });
    }
  }

  const sortedVarNums = Array.from(foundByIdx.keys()).sort((a, b) => a - b);
  for (const vNum of sortedVarNums) {
    out.push(foundByIdx.get(vNum).key);
  }
  return out;
}

export function getEquipmentCombatBase(eq, prefabs = null, unitId = '') {
  if (!eq || typeof eq !== 'object') return null;
  const rPrefab = typeof eq.weapon_socket_R === 'string' ? eq.weapon_socket_R : eq.weapon_socket_R?.prefab;
  const lPrefab = typeof eq.weapon_socket_L === 'string' ? eq.weapon_socket_L : eq.weapon_socket_L?.prefab;
  const inferType = (pid) => {
    if (!pid) return null;
    if (prefabs && prefabs[pid]) { const wt = weaponTypeOf(prefabs[pid]); if (wt) return wt; }
    if (pid === 'bow' || pid === 'crossbow' || pid === 'ballista_crossbow' || pid.includes('bow')) return 'bow';
    if (pid === 'javelin') return 'thrown';
    if (pid === 'spear' || pid === 'pike' || pid === 'halberd' || pid === 'lance') return 'melee_long';
    if (pid.includes('shield') || pid.includes('buckler')) return 'shield';
    return 'melee_short';
  };
  const rType = inferType(rPrefab);
  const lType = inferType(lPrefab);

  if (lType === 'bow' || rType === 'bow') {
    return 'shoot_bow';
  }
  if (rType === 'thrown' || lType === 'thrown') {
    return 'throw_javelin';
  }
  if (rType === 'melee_long' || lType === 'melee_long') {
    return 'attack_thrust';
  }
  if (rType === 'melee_short') {
    if (unitId === 'worker' && (rPrefab === 'pickaxe' || rPrefab === 'axe' || rPrefab === 'hammer' || rPrefab === 'worker_hammer')) {
      return null;
    }
    return 'attack_slash';
  }
  if (!rType && lType === 'shield') {
    return 'attack_bash';
  }
  return null;
}

/** Which BASE clip does this unit attack with? (attack_slash / attack_thrust / shoot_bow / ...) */
export function getCombatBase(unitDef, faction, prefabs = null) {
  if (!unitDef) return 'attack_slash';
  const eqBase = getEquipmentCombatBase(unitDef.equipment, prefabs, unitDef.id || unitDef.baseHeroId || '');
  const skinOrUnitBase =
    baseOfClip(unitDef?.skins?.[faction]?.combatAnim) ||
    baseOfClip(unitDef?.combatAnim);
  if (eqBase) {
    if (skinOrUnitBase && skinOrUnitBase === eqBase) return skinOrUnitBase;
    return eqBase;
  }
  return skinOrUnitBase || 'attack_slash';
}

/** Which BASE clip does this unit move with? (walk / gallop / ...) */
export function getLocomotionBase(unitDef, faction) {
  if (unitDef?.isMounted) return 'gallop';
  return (
    baseOfClip(unitDef?.skins?.[faction]?.locomotionAnim) ||
    baseOfClip(unitDef?.locomotionAnim) ||
    'walk'
  );
}

export const resolveCombatClip = (data, unitId, faction) =>
  resolveClip(
    data,
    unitId,
    faction,
    getCombatBase(data?.units?.[unitId] || data?.heroes?.[unitId], faction, data?.prefabs)
  );

export const resolveLocomotionClip = (data, unitId, faction) =>
  resolveClip(data, unitId, faction, getLocomotionBase(data?.units?.[unitId] || data?.heroes?.[unitId], faction));

export const resolveIdleClip = (data, unitId, faction) =>
  resolveClip(data, unitId, faction, 'idle');
