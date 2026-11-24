/**
 * Kings Lands — Studio clip data operations (src/tools/studio/clipEditing.js)
 *
 * Pure functions that change the units.json data (no DOM, no THREE):
 *   - copy-on-write: the first edit of a clip for "this unit + faction" clones it into
 *     `${unit}_${faction}_${base}`, so editing one unit never silently changes everybody else;
 *   - reset a single clip back to the shipped default;
 *   - sanitize stale/garbage clips that old studio versions left behind.
 *
 * Edit scope:
 *   'unit'   -> writes to `${unit}_${faction}_${base}` (created on first edit)
 *   'global' -> writes to `${base}` (affects every unit that has no clip of its own)
 */

import {
  baseOfClip,
  clipNameFor,
  getCombatBase,
  getLocomotionBase,
  isAttackClip,
  isMoveClip,
  resolveClip,
  resolveClipVariants,
  variantIndexOf,
  withVariantIndex
} from './clipResolver.js';
import { migrateLegacyTrack } from './keyTracks.js';

let _defaultUnitsVisuals = null;

export function registerDefaultUnitsVisuals(unitsData) {
  _defaultUnitsVisuals = unitsData || null;
}

const clone = (o) => JSON.parse(JSON.stringify(o));

const DEFAULT_SWITCH_WEAPON_CLIP = Object.freeze({
  mode: 'keyframes',
  layer: 'upperBody',
  duration: 0.52,
  loop: false,
  clampWhenFinished: false,
  tracks: {
    torso: [
      { t: 0, pos: [0, 0, 0], rot: [0.04, 0, 0], easing: 'smooth', posKey: false },
      { t: 0.35, pos: [0, 0, 0], rot: [0.14, -0.26, 0.05], easing: 'smooth', posKey: false },
      { t: 0.68, pos: [0, 0, 0], rot: [0.08, 0.18, -0.03], easing: 'smooth', posKey: false },
      { t: 1, pos: [0, 0, 0], rot: [0.04, 0, 0], easing: 'smooth', posKey: false }
    ],
    arm_R: [
      { t: 0, pos: [0, 0, 0], rot: [-0.24, -0.16, 0.12], easing: 'smooth', posKey: false },
      { t: 0.35, pos: [0, 0, 0], rot: [0.68, 0.42, -0.28], easing: 'smooth', posKey: false },
      { t: 0.68, pos: [0, 0, 0], rot: [-0.72, -0.25, 0.22], easing: 'smooth', posKey: false },
      { t: 1, pos: [0, 0, 0], rot: [-0.24, -0.16, 0.12], easing: 'smooth', posKey: false }
    ],
    forearm_R: [
      { t: 0, pos: [0, 0, 0], rot: [-0.52, 0, 0], easing: 'smooth', posKey: false },
      { t: 0.35, pos: [0, 0, 0], rot: [-1.18, 0.25, 0], easing: 'smooth', posKey: false },
      { t: 0.68, pos: [0, 0, 0], rot: [-0.85, -0.12, 0], easing: 'smooth', posKey: false },
      { t: 1, pos: [0, 0, 0], rot: [-0.52, 0, 0], easing: 'smooth', posKey: false }
    ],
    arm_L: [
      { t: 0, pos: [0, 0, 0], rot: [-0.24, 0.16, -0.12], easing: 'smooth', posKey: false },
      { t: 0.35, pos: [0, 0, 0], rot: [0.48, -0.35, 0.22], easing: 'smooth', posKey: false },
      { t: 0.68, pos: [0, 0, 0], rot: [-0.54, 0.28, -0.18], easing: 'smooth', posKey: false },
      { t: 1, pos: [0, 0, 0], rot: [-0.24, 0.16, -0.12], easing: 'smooth', posKey: false }
    ],
    forearm_L: [
      { t: 0, pos: [0, 0, 0], rot: [-0.5, 0, 0], easing: 'smooth', posKey: false },
      { t: 0.35, pos: [0, 0, 0], rot: [-1.05, -0.2, 0], easing: 'smooth', posKey: false },
      { t: 0.68, pos: [0, 0, 0], rot: [-0.74, 0.1, 0], easing: 'smooth', posKey: false },
      { t: 1, pos: [0, 0, 0], rot: [-0.5, 0, 0], easing: 'smooth', posKey: false }
    ]
  },
  events: []
});

export function defaultKeyframeClip(base, shippedDefaults = _defaultUnitsVisuals) {
  if (base === 'switch_weapon') {
    return clone(shippedDefaults?.animations?.keyframes?.switch_weapon || DEFAULT_SWITCH_WEAPON_CLIP);
  }
  const shipped = shippedDefaults?.animations?.keyframes?.[base];
  if (shipped) {
    return clone(shipped);
  }
  if (isMoveClip(base)) {
    return { mode: 'keyframes', layer: 'lowerBody', duration: base === 'idle' ? 2.0 : 0.85, loop: true, tracks: {}, events: [] };
  }
  if (base === 'die') {
    return { mode: 'keyframes', layer: 'fullBody', duration: 0.95, loop: false, clampWhenFinished: true, tracks: {}, events: [] };
  }
  return { mode: 'keyframes', layer: 'upperBody', duration: 0.85, loop: false, tracks: {}, events: [] };
}

export function defaultProceduralClip() {
  return { mode: 'procedural', layer: 'lowerBody', frequency: 2.0, bobAmplitude: 0.04, torsoSway: 0.04, armSwing: 0.05, legSwing: 0, events: [] };
}

/** Name an edit is written to. */
export function editTargetName(unitId, faction, base, scope, variantIdx = 1) {
  return scope === 'global'
    ? withVariantIndex(base, variantIdx)
    : clipNameFor(unitId, faction, base, variantIdx);
}

/** Name the editor READS (and previews) for this scope. */
export function readClipName(data, unitId, faction, base, scope, variantIdx = 1) {
  return scope === 'global'
    ? withVariantIndex(base, variantIdx)
    : resolveClip(data, unitId, faction, base, variantIdx);
}

function normalizeKeyframeClip(clip, base) {
  const d = defaultKeyframeClip(base);
  if (!clip.mode) clip.mode = 'keyframes';
  if (!clip.layer) clip.layer = d.layer;
  if (isMoveClip(base)) {
    clip.layer = 'lowerBody';
    if (clip.loop === undefined) clip.loop = true;
  }
  if (!(Number(clip.duration) > 0)) clip.duration = d.duration;
  if (!clip.tracks || typeof clip.tracks !== 'object') clip.tracks = {};
  if (!Array.isArray(clip.events)) clip.events = [];
  return clip;
}

/** Keep the fields the game/arena read (`skin.combatAnim`, `skin.locomotionAnim`) in sync with a newly created custom clip. */
function publishFields(data, unitId, faction, base, name) {
  const unit = data.units?.[unitId];
  if (!unit) return;
  const wantsCombat = isAttackClip(base) && base === getCombatBase(unit, faction, data?.prefabs);
  const wantsLoco = isMoveClip(base) && base === getLocomotionBase(unit, faction);
  if (!wantsCombat && !wantsLoco) return;
  if (!unit.skins) unit.skins = {};
  if (!unit.skins[faction]) unit.skins[faction] = {};
  if (wantsCombat) {
    unit.skins[faction].combatAnim = name;
    if (faction === (unit.race || 'human')) unit.combatAnim = name;
  }
  if (wantsLoco) {
    unit.skins[faction].locomotionAnim = name;
    if (faction === (unit.race || 'human')) unit.locomotionAnim = name;
  }
}

/** Returns { name, clip, created } — the keyframe clip an edit must be written to (created on demand). */
export function ensureKeyframeClip(data, unitId, faction, base, scope, variantIdx = 1) {
  const anims = data.animations;
  if (!anims.keyframes) anims.keyframes = {};
  const target = editTargetName(unitId, faction, base, scope, variantIdx);

  if (anims.keyframes[target]) {
    if (scope !== 'global' && (variantIdx | 0) <= 1) publishFields(data, unitId, faction, base, target);
    return { name: target, clip: normalizeKeyframeClip(anims.keyframes[target], base), created: false };
  }
  const sourceName = readClipName(data, unitId, faction, base, scope, variantIdx);
  const source = anims.keyframes[sourceName] || anims.keyframes[readClipName(data, unitId, faction, base, scope, 1)];
  const clip = normalizeKeyframeClip(source ? clone(source) : defaultKeyframeClip(base), base);
  anims.keyframes[target] = clip;
  if (scope !== 'global' && (variantIdx | 0) <= 1) publishFields(data, unitId, faction, base, target);
  return { name: target, clip, created: true };
}

/** Clones the current clip into a new variation (__v2, __v3, ...) and returns { variantIdx, name, clip }. */
export function createClipVariation(data, unitId, faction, base, scope, fromVariantIdx = 1) {
  const anims = data.animations;
  if (!anims.keyframes) anims.keyframes = {};
  const variants = resolveClipVariants(data, unitId, faction, base, scope);
  let maxIdx = 1;
  for (const vName of variants) {
    maxIdx = Math.max(maxIdx, variantIndexOf(vName));
  }
  const nextIdx = maxIdx + 1;
  const sourceName = readClipName(data, unitId, faction, base, scope, fromVariantIdx);
  const source = anims.keyframes[sourceName] || defaultKeyframeClip(base);
  const target = editTargetName(unitId, faction, base, scope, nextIdx);
  anims.keyframes[target] = normalizeKeyframeClip(clone(source), base);
  return { variantIdx: nextIdx, name: target, clip: anims.keyframes[target] };
}

/** Deletes a variation (variantIdx >= 2) for (unitId, faction, base). */
export function deleteClipVariation(data, unitId, faction, base, scope, variantIdx) {
  if ((variantIdx | 0) <= 1) return false;
  const anims = data.animations;
  const kf = anims?.keyframes || {};
  const target = editTargetName(unitId, faction, base, scope, variantIdx);
  const globalTarget = withVariantIndex(base, variantIdx);
  let deleted = false;
  if (kf[target]) {
    delete kf[target];
    deleted = true;
  }
  if (scope === 'global' && kf[globalTarget]) {
    delete kf[globalTarget];
    deleted = true;
  }
  return deleted;
}

/** Returns { name, clip, created } — the procedural clip an edit must be written to (created on demand). */
export function ensureProceduralClip(data, unitId, faction, base, scope) {
  const anims = data.animations;
  if (!anims.procedural) anims.procedural = {};
  const target = editTargetName(unitId, faction, base, scope);

  if (anims.procedural[target]) return { name: target, clip: anims.procedural[target], created: false };

  const sourceName = readClipName(data, unitId, faction, base, scope);
  const source = anims.procedural[sourceName] || anims.procedural[base];
  const clip = source ? clone(source) : defaultProceduralClip();
  anims.procedural[target] = clip;
  if (scope !== 'global') publishFields(data, unitId, faction, base, target);
  return { name: target, clip, created: true };
}

/**
 * Reset one clip.
 *  scope 'unit'   -> delete this unit+faction's own copy (falls back to the unit-wide / global clip)
 *  scope 'global' -> restore the global clip from the shipped defaults
 * Returns { changed }.
 */
export function resetClip(data, defaults, unitId, faction, base, scope) {
  const anims = data.animations;
  let changed = false;

  if (scope === 'global') {
    const dk = defaults?.animations?.keyframes?.[base] || _defaultUnitsVisuals?.animations?.keyframes?.[base];
    const dp = defaults?.animations?.procedural?.[base];
    if (dk) { anims.keyframes[base] = clone(dk); changed = true; }
    if (dp) { anims.procedural[base] = clone(dp); changed = true; }
    return { changed };
  }

  const name = clipNameFor(unitId, faction, base);
  if (anims.keyframes?.[name]) { delete anims.keyframes[name]; changed = true; }
  if (anims.procedural?.[name]) { delete anims.procedural[name]; changed = true; }
  if (changed) pruneDanglingRefs(data);
  return { changed };
}

/** Fix `combatAnim` / `locomotionAnim` fields that point at clips which no longer exist. */
export function pruneDanglingRefs(data, report = null) {
  const kf = data.animations?.keyframes || {};
  const proc = data.animations?.procedural || {};
  for (const [uid, u] of Object.entries(data.units || {})) {
    if (u.combatAnim && baseOfClip(u.combatAnim) && !kf[u.combatAnim]) {
      const b = baseOfClip(u.combatAnim);
      u.combatAnim = kf[b] ? b : 'attack_slash';
      report?.fixed.push(`${uid}.combatAnim`);
    }
    if (u.locomotionAnim && baseOfClip(u.locomotionAnim) && !proc[u.locomotionAnim] && !kf[u.locomotionAnim]) {
      const b = baseOfClip(u.locomotionAnim);
      u.locomotionAnim = proc[b] ? b : 'walk';
      report?.fixed.push(`${uid}.locomotionAnim`);
    }
    for (const [fac, s] of Object.entries(u.skins || {})) {
      if (s.combatAnim && baseOfClip(s.combatAnim) && !kf[s.combatAnim]) {
        delete s.combatAnim;
        report?.fixed.push(`${uid}.skins.${fac}.combatAnim`);
      }
      if (s.locomotionAnim && baseOfClip(s.locomotionAnim) && !proc[s.locomotionAnim] && !kf[s.locomotionAnim]) {
        delete s.locomotionAnim;
        report?.fixed.push(`${uid}.skins.${fac}.locomotionAnim`);
      }
    }
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const strip = (clip) => JSON.stringify({ duration: clip?.duration, tracks: clip?.tracks, events: clip?.events });
const hasKeys = (clip) => Object.values(clip?.tracks || {}).some((t) => Array.isArray(t) && t.length > 0);

/**
 * Conservative cleanup of leftovers from old studio versions. Never touches a clip that has real content
 * unless it is a provable duplicate.
 * Returns { removed: [], migrated: [], fixed: [] }.
 */
export function sanitizeUnitsData(data, shippedDefaults = _defaultUnitsVisuals) {
  const report = { removed: [], migrated: [], fixed: [] };
  if (!data || typeof data !== 'object') return report;
  const shippedData = shippedDefaults || _defaultUnitsVisuals;

  if (!data.animations) data.animations = {};
  const anims = data.animations;
  if (!anims.keyframes) anims.keyframes = {};
  if (!anims.procedural) anims.procedural = {};
  const unitIds = Object.keys(data.units || {});

  const hasRepeatedPrefix = (name) => {
    const base = baseOfClip(name);
    if (!base || name === base) return false;
    const prefix = `${name.slice(0, name.length - base.length - 1)}_`;
    return unitIds.some((u) => (prefix.match(new RegExp(`(?<=^|_)${escapeRe(u)}_`, 'g')) || []).length > 1);
  };

  for (const name of Object.keys(anims.keyframes)) {
    const clip = anims.keyframes[name];
    const base = baseOfClip(name);
    if (!clip || typeof clip !== 'object') { delete anims.keyframes[name]; report.removed.push(name); continue; }

    if (hasRepeatedPrefix(name)) { delete anims.keyframes[name]; report.removed.push(name); continue; }

    if (base && isMoveClip(base)) {
      clip.mode = 'keyframes';
      clip.layer = 'lowerBody';
      if (clip.loop === undefined) clip.loop = true;
      if (!hasKeys(clip)) {
        if (name === base && shippedData?.animations?.keyframes?.[base]) {
          anims.keyframes[name] = clone(shippedData.animations.keyframes[base]);
        } else {
          delete anims.keyframes[name];
          report.removed.push(name);
        }
      }
      continue;
    }

    if (base === 'idle' && clip.layer !== 'lowerBody') {
      if (!hasKeys(clip)) { delete anims.keyframes[name]; report.removed.push(name); continue; }
      if (name === 'idle') {
        const twin = Object.keys(anims.keyframes).find(
          (n) => n !== 'idle' && baseOfClip(n) === 'idle' && strip(anims.keyframes[n]) === strip(clip)
        );
        if (twin) { delete anims.keyframes.idle; report.removed.push('idle'); }
        continue;
      }
      clip.mode = 'keyframes';
      clip.layer = 'lowerBody';
      clip.loop = true;
      report.migrated.push(name);
    }
  }

  for (const name of Object.keys(anims.procedural)) {
    if (hasRepeatedPrefix(name)) { delete anims.procedural[name]; report.removed.push(`procedural:${name}`); }
  }

  for (const [name, clip] of Object.entries(anims.keyframes)) {
    if (!clip.tracks || typeof clip.tracks !== 'object') clip.tracks = {};
    if (!Array.isArray(clip.events)) clip.events = [];
    if (!(Number(clip.duration) > 0)) clip.duration = baseOfClip(name) === 'idle' ? 2.0 : 0.85;
    for (const track of Object.values(clip.tracks)) migrateLegacyTrack(track);
  }

  for (const moveBase of ['idle', 'walk', 'run', 'charge', 'retreat_run', 'gallop']) {
    if (!anims.keyframes[moveBase] || !hasKeys(anims.keyframes[moveBase])) {
      const shippedMove = shippedData?.animations?.keyframes?.[moveBase];
      if (shippedMove) {
        anims.keyframes[moveBase] = clone(shippedMove);
      }
    }
  }

  if (!anims.keyframes.switch_weapon || !hasKeys(anims.keyframes.switch_weapon)) {
    anims.keyframes.switch_weapon = clone(
      shippedData?.animations?.keyframes?.switch_weapon || DEFAULT_SWITCH_WEAPON_CLIP
    );
  }

  if (anims.procedural?.swordsman_human_walk && !anims.keyframes?.swordsman_human_walk) {
    delete anims.procedural.swordsman_human_walk;
  }

  if (!data._animOverhaulV3 && shippedData?.animations?.keyframes) {
    data._animOverhaulV3 = true;
    for (const k of [
      'idle', 'swordsman_human_idle', 'walk', 'run', 'charge', 'retreat_run', 'gallop',
      'attack_slash', 'swordsman_human_attack_slash',
      'attack_thrust', 'spearman_human_attack_thrust', 'block'
    ]) {
      if (shippedData.animations.keyframes[k]) {
        anims.keyframes[k] = clone(shippedData.animations.keyframes[k]);
      }
    }
  }

  if (!data._animOverhaulV4 && shippedData?.animations?.keyframes) {
    data._animOverhaulV4 = true;
    for (const k of [
      'worker_build', 'worker_chop', 'worker_mine',
      'idle__v2', 'swordsman_human_idle__v2',
      'attack_slash__v2', 'swordsman_human_attack_slash__v2'
    ]) {
      if (shippedData.animations.keyframes[k] && !anims.keyframes[k]) {
        anims.keyframes[k] = clone(shippedData.animations.keyframes[k]);
      }
    }
  }

  pruneDanglingRefs(data, report);
  return report;
}
