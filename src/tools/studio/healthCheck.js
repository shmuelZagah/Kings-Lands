/**
 * Kings Lands — units.json health check (src/tools/studio/healthCheck.js)
 *
 * Pure function (no DOM, no THREE): scans a units.json working copy and returns a list of problems.
 * It never changes the data. See docs/DATA_CONTRACT.md for what every rule means.
 *
 *   runHealthCheck(data) -> { issues: Issue[], counts: { error, warn, info } }
 *   Issue = { level: 'error'|'warn'|'info', area: string, message: string, goto?: { unit?, faction?, clip?, base? } }
 *
 * Levels
 *   error  the game or the studio will misbehave (missing clip, broken reference, NaN ...)
 *   warn   probably a mistake (event outside the clip, hit missing in an attack ...)
 *   info   worth knowing (unused clip, procedural clip without footsteps ...)
 */

import { grantedActions, lockedHand, loadoutsOf, asLoadout, HAND_SOCKETS } from './weaponRules.js';
import { ACTION_CLIPS, ATTACK_CLIPS, MOVE_CLIPS, baseOfClip, getCombatBase, getLocomotionBase, isAttackClip, isMoveClip, resolveClip, stripVariantSuffix } from './clipResolver.js';

const LAYERS = ['upperBody', 'lowerBody', 'fullBody'];
const EVENT_TYPES = ['hit', 'release', 'footstep', 'sound', 'effect', 'swap', 'hold'];
const SHAPES = ['cylinder', 'box', 'sphere', 'cone', 'extrude', 'lathe', 'torus', 'mesh', 'custom_mesh'];
const TEAM_TOKENS = ['primary', 'secondary', 'cloth', 'metal', 'darkMetal'];
const RANGED_BASES = ['shoot_bow', 'throw_javelin'];
const DEFAULT_FACTIONS = ['human', 'orc', 'elf', 'katiler'];
const EPS = 1e-6;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec = (v, n = 3) => Array.isArray(v) && v.length === n && v.every(isNum);

/** Every joint name of a hierarchy tree ({ name: { pos, meshes, children } }). */
function collectJoints(tree, out = new Set()) {
  for (const [name, node] of Object.entries(tree || {})) {
    out.add(name);
    collectJoints(node?.children, out);
  }
  return out;
}

function eachNode(tree, fn, path = '') {
  for (const [name, node] of Object.entries(tree || {})) {
    fn(name, node, `${path}${name}`);
    eachNode(node?.children, fn, `${path}${name}/`);
  }
}

export function runHealthCheck(data) {
  const issues = [];
  const add = (level, area, message, goto) => issues.push({ level, area, message, ...(goto ? { goto } : {}) });

  if (!data || typeof data !== 'object') {
    add('error', 'file', 'units.json is empty or not an object');
    return finish(issues);
  }

  const units = data.units || {};
  const prefabs = data.prefabs || {};
  const palettes = data.teamPalettes || {};
  const kf = data.animations?.keyframes || {};
  const proc = data.animations?.procedural || {};
  const unitIds = Object.keys(units);

  for (const key of ['units', 'prefabs', 'teamPalettes', 'animations']) {
    if (!data[key] || typeof data[key] !== 'object') add('error', 'file', `Top-level "${key}" is missing`);
  }
  if (!data.animations?.keyframes) add('error', 'file', 'animations.keyframes is missing');
  if (!data.animations?.procedural) add('error', 'file', 'animations.procedural is missing');

  // ---------------------------------------------------------------- palettes
  for (const team of ['1', '2']) {
    const p = palettes[team];
    if (!p) { add('error', 'palette', `teamPalettes["${team}"] is missing`); continue; }
    for (const k of TEAM_TOKENS) {
      if (typeof p[k] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(p[k])) add('warn', `palette ${team}`, `"${k}" is not a #rrggbb colour (${JSON.stringify(p[k])})`);
    }
  }

  // ---------------------------------------------------------------- joints known to the game
  const allJoints = new Set(['cape_back', 'quiver_back', 'arrow_socket', 'bowstring_mid']);
  for (const u of Object.values(units)) { collectJoints(u?.hierarchy, allJoints); collectJoints(u?.mountHierarchy, allJoints); }

  const checkMeshes = (owner, jointName, node, goto) => {
    for (const m of node?.meshes || []) {
      const where = `${owner} · ${jointName} · ${m?.name || '(unnamed mesh)'}`;
      if (!SHAPES.includes(m?.shape)) add('error', 'model', `${where}: unknown shape "${m?.shape}"`, goto);
      if (m?.shape === 'extrude') {
        if (!Array.isArray(m.points) || m.points.length < 3) add('error', 'model', `${where}: extrude needs at least 3 points`, goto);
      } else if (m?.shape === 'mesh' || m?.shape === 'custom_mesh') {
        // explicit geometry (sculpts, imported GLB): size is not used, the data must be consistent instead
        const flat = (a) => (Array.isArray(a) && Array.isArray(a[0]) ? a : null);
        const nV = Array.isArray(m.vertices) ? (flat(m.vertices) ? m.vertices.length : m.vertices.length / 3) : 0;
        const fl = m.faces || m.indices;
        if (nV < 3 || !Array.isArray(fl) || !fl.length) add('error', 'model', `${where}: mesh needs vertices and faces`, goto);
        else {
          const ids = flat(fl) ? fl.flat() : fl;
          let bad = false; for (let i = 0; i < ids.length; i++) if (!(ids[i] >= 0 && ids[i] < nV)) { bad = true; break; }
          if (bad) add('error', 'model', `${where}: a face points to a vertex that does not exist`, goto);
          if (Array.isArray(m.colors) && m.colors.length && m.colors.length !== nV) add('error', 'model', `${where}: colors must have one entry per vertex (${m.colors.length} vs ${nV})`, goto);
        }
      } else if (m?.shape === 'lathe') {
        if (!Array.isArray(m.points) || m.points.length < 2) add('error', 'model', `${where}: lathe needs at least 2 profile points`, goto);
      } else if (!Array.isArray(m?.size) || !m.size.every(isNum)) add('error', 'model', `${where}: size must be numbers`, goto);
      if (m?.pos && !isVec(m.pos)) add('error', 'model', `${where}: pos must be 3 numbers`, goto);
      if (m?.rot && !isVec(m.rot)) add('error', 'model', `${where}: rot must be 3 numbers`, goto);
      if (typeof m?.color === 'string' && m.color.startsWith('team.')) {
        const token = m.color.slice(5);
        if (!TEAM_TOKENS.includes(token)) add('error', 'model', `${where}: unknown team colour "${m.color}"`, goto);
      } else if (typeof m?.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(m.color)) {
        add('warn', 'model', `${where}: colour should be "#rrggbb" or "team.<name>" (${JSON.stringify(m?.color)})`, goto);
      }
    }
  };

  // ---------------------------------------------------------------- prefabs
  for (const [id, pf] of Object.entries(prefabs)) {
    if (pf?.id && pf.id !== id) add('warn', `prefab ${id}`, `id "${pf.id}" differs from its key "${id}"`);
    if (pf?.defaultSocket && !allJoints.has(pf.defaultSocket)) add('warn', `prefab ${id}`, `defaultSocket "${pf.defaultSocket}" is not a joint of any unit`);
    if (!Array.isArray(pf?.parts) || pf.parts.length === 0) add('warn', `prefab ${id}`, 'has no parts (invisible item)');
    for (const part of pf?.parts || []) {
      if (!SHAPES.includes(part?.shape)) add('error', `prefab ${id}`, `part "${part?.name}": unknown shape "${part?.shape}"`);
    }
  }

  // ---------------------------------------------------------------- units
  const factionsOf = (u) => [...new Set([...DEFAULT_FACTIONS, ...Object.keys(u?.skins || {})])];

  for (const [id, u] of Object.entries(units)) {
    const goto = { unit: id };
    if (u?.id && u.id !== id) add('warn', `unit ${id}`, `id "${u.id}" differs from its key "${id}"`, goto);
    if (!(u?.scale > 0)) add('warn', `unit ${id}`, `scale should be > 0 (${u?.scale})`, goto);
    if ((!u?.hierarchy || !Object.keys(u.hierarchy).length) && !(u?.isMounted && u?.mountHierarchy)) { add('error', `unit ${id}`, 'has no hierarchy (no body)', goto); continue; }
    const joints = collectJoints(u.hierarchy || {});
    if (!joints.has('torso') && !collectJoints(u.mountHierarchy || {}).has('torso')) add('error', `unit ${id}`, 'hierarchy has no "torso" joint', goto);
    if (u.isMounted && !u.mountHierarchy) add('error', `unit ${id}`, 'isMounted is true but mountHierarchy is missing', goto);
    const allOfUnit = collectJoints(u.mountHierarchy, new Set([...joints, 'cape_back', 'quiver_back', 'arrow_socket', 'bowstring_mid']));

    eachNode(u.hierarchy, (name, node) => {
      if (node?.pos && !isVec(node.pos)) add('error', `unit ${id}`, `joint "${name}": pos must be 3 numbers`, goto);
      checkMeshes(`unit ${id}`, name, node, goto);
    });
    eachNode(u.mountHierarchy, (name, node) => checkMeshes(`unit ${id} (mount)`, name, node, goto));

    for (const ld of loadoutsOf(u)) for (const [socket, eq] of Object.entries(ld.equipment || {})) {
      if (!allOfUnit.has(socket)) add('error', `unit ${id}`, `equipment${ld.id === 'main' ? '' : ` (loadout ${ld.id})`} on "${socket}", but the unit has no such joint`, goto);
      if (eq?.prefab && !prefabs[eq.prefab]) add('error', `unit ${id}`, `equipment "${eq.prefab}" (on ${socket}) is not in prefabs`, goto);
      if (eq?.gripOffset && !isVec(eq.gripOffset)) add('error', `unit ${id}`, `${socket}: gripOffset must be 3 numbers`, goto);
      if (eq?.gripRotation && !isVec(eq.gripRotation)) add('error', `unit ${id}`, `${socket}: gripRotation must be 3 numbers`, goto);
    }

    // gear rules (weaponRules.js): hands, granted actions, stray / legacy clips
    for (const ld of loadoutsOf(u)) {
      const lu = asLoadout(u, ld.id), tag = ld.id === 'main' ? '' : ` (loadout ${ld.id})`;
      const lh = lockedHand(data, lu);
      if (lh && ld.equipment?.[lh]) add('error', `unit ${id}`, `${lh} holds an item, but the other hand has a two-handed weapon${tag}`, goto);
      for (const sock of HAND_SOCKETS) { const pf = prefabs[ld.equipment?.[sock]?.prefab]; if (pf && !pf.weaponType) add('warn', `unit ${id}`, `${ld.equipment[sock].prefab} has no weaponType, so it opens no actions${tag}`, goto); }
    }
    const granted = grantedActions(data, u, ACTION_CLIPS, { allLoadouts: true }).actions;
    for (const base of granted) {
      if (base === 'take_damage' || base === 'die') continue;
      const missing = factionsOf(u).filter((f) => !kf[resolveClip(data, id, f, base)]);
      if (missing.length === factionsOf(u).length) add('warn', `unit ${id}`, `gear opens "${base}" but no clip exists for it yet (draw one in the studio)`, { unit: id, base });
    }
    for (const base of ACTION_CLIPS) {
      if (granted.includes(base) || base === getCombatBase(u)) continue;
      for (const name of Object.keys(kf)) {
        if (name !== base && stripVariantSuffix(name) !== base && name.startsWith(`${id}_`) && baseOfClip(name) === base) add('warn', `clip ${name}`, `belongs to ${id}, whose gear does not open "${base}" (stray clip?)`, { clip: name, base });
      }
    }
    for (const name of Object.keys(kf)) {
      const b = baseOfClip(name);
      if (b && name === `${id}_${b}`) add('warn', `clip ${name}`, `legacy unit-wide name: use ${id}_<faction>_${b}`, { clip: name, base: b });
    }

    // references from the unit / its skins
    const refs = [['combatAnim', u.combatAnim, 'keyframes'], ['locomotionAnim', u.locomotionAnim, 'procedural']];
    for (const [fac, s] of Object.entries(u.skins || {})) {
      refs.push([`skins.${fac}.combatAnim`, s?.combatAnim, 'keyframes'], [`skins.${fac}.locomotionAnim`, s?.locomotionAnim, 'procedural']);
    }
    for (const [field, value, where] of refs) {
      if (!value) continue;
      const exists = where === 'keyframes' ? Boolean(kf[value]) : Boolean(proc[value] || kf[value]);
      if (!exists) add('error', `unit ${id}`, `${field} = "${value}" does not exist`, goto);
      else if (!baseOfClip(value)) add('warn', `unit ${id}`, `${field} = "${value}" does not end with a known clip name`, goto);
    }

    // what every faction of this unit will actually play
    for (const fac of factionsOf(u)) {
      const g = { unit: id, faction: fac };
      const combatBase = getCombatBase(u, fac);
      const locoBase = getLocomotionBase(u, fac);
      const needs = [['attack', combatBase, kf], ['move', locoBase, proc], ['idle', 'idle', proc], ['die', 'die', kf], ['take_damage', 'take_damage', kf]];
      for (const [label, base, bucket] of needs) {
        const name = resolveClip(data, id, fac, base);
        const found = bucket === proc ? Boolean(proc[name] || kf[name]) : Boolean(kf[name]);
        if (!found) add('error', `unit ${id} / ${fac}`, `plays no ${label} clip: "${name}" does not exist`, { ...g, base });
      }
    }
  }

  // ---------------------------------------------------------------- keyframe clips
  const knownPrefix = (name) => unitIds.some((u) => name.startsWith(`${u}_`));
  for (const [name, clip] of Object.entries(kf)) {
    const base = baseOfClip(name);
    const goto = { clip: name, base };
    const area = `clip ${name}`;
    if (!base) add('warn', area, 'name does not end with a known clip name (attack_slash, die, idle ...)', goto);
    else if (stripVariantSuffix(name) !== base && !knownPrefix(name)) add('warn', area, `prefix does not match any unit (${unitIds.join(', ')})`, goto);
    if (base && isMoveClip(base) && clip.layer !== 'lowerBody') add('warn', area, `a ${base} keyframe clip should use layer "lowerBody"`, goto);
    if (base === 'idle' && clip.layer !== 'lowerBody') add('warn', area, 'an idle keyframe clip should use layer "lowerBody"', goto);
    if (!LAYERS.includes(clip.layer)) add('error', area, `layer "${clip.layer}" is not one of ${LAYERS.join(', ')}`, goto);
    if (!(clip.duration > 0)) { add('error', area, `duration must be > 0 (${clip.duration})`, goto); continue; }
    if (clip.mode && clip.mode !== 'keyframes') add('warn', area, `mode is "${clip.mode}"`, goto);

    for (const [joint, track] of Object.entries(clip.tracks || {})) {
      if (!allJoints.has(joint)) add('warn', area, `track "${joint}" is not a joint of any unit`, goto);
      if (!Array.isArray(track) || track.length === 0) { add('warn', area, `track "${joint}" is empty`, goto); continue; }
      let last = -1;
      let sortedOk = true;
      for (const k of track) {
        if (!isNum(k?.t) || k.t < -EPS || k.t > 1 + EPS) add('error', area, `${joint}: key time ${JSON.stringify(k?.t)} is outside 0..1`, goto);
        if (!isVec(k?.rot)) add('error', area, `${joint}: key at t=${k?.t} has bad rot ${JSON.stringify(k?.rot)}`, goto);
        if (!isVec(k?.pos)) add('error', area, `${joint}: key at t=${k?.t} has bad pos ${JSON.stringify(k?.pos)}`, goto);
        if (isNum(k?.t)) { if (k.t < last - EPS) sortedOk = false; last = k.t; }
        if (k?.rotKey !== undefined && typeof k.rotKey !== 'boolean') add('warn', area, `${joint}: rotKey must be true/false`, goto);
        if (k?.posKey !== undefined && typeof k.posKey !== 'boolean') add('warn', area, `${joint}: posKey must be true/false`, goto);
      }
      if (!sortedOk) add('error', area, `${joint}: keys are not sorted by time`, goto);
      const times = track.map((k) => Math.round(k.t * 1000));
      if (new Set(times).size !== times.length) add('warn', area, `${joint}: two keys at the same time`, goto);
      for (const prop of ['rotKey', 'posKey']) {
        // a property without any owning key is static: every key must carry the same value
        if (track.every((k) => k[prop] === false)) {
          const field = prop === 'rotKey' ? 'rot' : 'pos';
          const first = track[0][field];
          if (isVec(first) && track.some((k) => isVec(k[field]) && k[field].some((v, i) => Math.abs(v - first[i]) > 1e-3))) {
            add('warn', area, `${joint}: ${field} is static but its keys hold different values`, goto);
          }
        }
      }
    }

    // events
    const events = clip.events || [];
    const count = (type) => events.filter((e) => e?.type === type).length;
    for (const [i, ev] of events.entries()) {
      const at = `event #${i + 1} (${ev?.type})`;
      if (!EVENT_TYPES.includes(ev?.type)) { add('error', area, `${at}: unknown type`, goto); continue; }
      if (!isNum(ev.time)) add('error', area, `${at}: time must be a number of seconds`, goto);
      else if (ev.time < -EPS || ev.time > clip.duration + EPS) add('warn', area, `${at}: time ${ev.time}s is outside the clip (0..${clip.duration}s)`, goto);
      const pl = ev.payload || {};
      if (ev.type === 'hit' || ev.type === 'release') {
        if (!pl.socket) add('warn', area, `${at}: no payload.socket`, goto);
        else if (!allJoints.has(pl.socket)) add('error', area, `${at}: socket "${pl.socket}" is not a joint of any unit`, goto);
      }
      if (ev.type === 'hit' && !pl.damageType) add('warn', area, `${at}: no payload.damageType`, goto);
      if (ev.type === 'release' && !pl.projectile) add('warn', area, `${at}: no payload.projectile`, goto);
      if (ev.type === 'sound' && !pl.cue) add('warn', area, `${at}: no payload.cue`, goto);
      if (ev.type === 'effect' && !pl.fx) add('warn', area, `${at}: no payload.fx`, goto);
    }
    if (base && isAttackClip(base)) {
      if (RANGED_BASES.includes(base)) {
        if (count('release') === 0) add('error', area, 'ranged attack without a "release" event: nothing will be shot', goto);
        if (count('hit') > 0) add('warn', area, 'ranged attack has a "hit" event (damage comes from the projectile)', goto);
      } else {
        if (count('hit') === 0) add('error', area, 'melee attack without a "hit" event: it will never damage anyone', goto);
        if (count('hit') > 1) add('info', area, `${count('hit')} hit events: damage is applied once per event`, goto);
      }
    }
    if ((base === 'die' || base === 'take_damage') && count('sound') === 0) add('info', area, 'no sound event', goto);
    if (base === 'die' && !clip.clampWhenFinished) add('warn', area, 'die should have clampWhenFinished: true, or the unit stands up again at the end', goto);
    if (base !== 'idle' && !MOVE_CLIPS.includes(base) && base !== 'victory_cheer' && clip.loop === true && base && ACTION_CLIPS.includes(base)) add('warn', area, 'an action clip with loop: true repeats forever', goto);
  }

  // ---------------------------------------------------------------- procedural clips
  for (const [name, clip] of Object.entries(proc)) {
    const base = baseOfClip(name);
    const goto = { clip: name, base };
    const area = `move ${name}`;
    if (!base || !MOVE_CLIPS.includes(base)) { add('warn', area, 'name does not end with idle / walk / run / gallop', goto); continue; }
    for (const k of ['frequency', 'bobAmplitude', 'torsoSway', 'armSwing', 'legSwing']) {
      if (clip[k] !== undefined && !isNum(clip[k])) add('error', area, `${k} must be a number (${JSON.stringify(clip[k])})`, goto);
    }
    if (!(clip.frequency > 0)) add('warn', area, `frequency should be > 0 (${clip.frequency})`, goto);
    if (base !== 'idle' && !(clip.events || []).some((e) => e?.type === 'footstep')) add('info', area, 'no footstep events', goto);
  }

  // ---------------------------------------------------------------- unused clips
  const used = new Set();
  for (const [id, u] of Object.entries(units)) {
    for (const fac of factionsOf(u)) {
      used.add(resolveClip(data, id, fac, getCombatBase(u, fac)));
      used.add(resolveClip(data, id, fac, getLocomotionBase(u, fac)));
      for (const b of ['idle', 'die', 'take_damage']) used.add(resolveClip(data, id, fac, b));
    }
  }
  for (const name of [...Object.keys(kf), ...Object.keys(proc)]) {
    if (!used.has(name) && !ATTACK_CLIPS.includes(name) && !ACTION_CLIPS.includes(name) && !MOVE_CLIPS.includes(name)) {
      add('info', `clip ${name}`, 'is not played by any unit / faction (unused)', { clip: name, base: baseOfClip(name) });
    }
  }

  return finish(issues);
}

/**
 * Cross-reference validator across all game data domains:
 *  - building.options (unit recruitment) <-> unitStats & unitsVisuals
 *  - building.mountedBallistaUnitId -> unitStats & unitsVisuals
 *  - unitStats.baseCharId / baseModel -> unitsVisuals (resolving legacy aliases)
 *  - unitStats[id] <-> unitsVisuals[id]
 *  - unit & hero equipment / loadouts / mountedConfig -> combined prefabs
 *  - hero baseUnitId / baseCharId -> unitsVisuals & valid torso hierarchy
 *  - buildingSkins[bid].active -> buildingSkins[bid].items & buildings[bid]
 */
export function validateCrossReferences({
  unitsVisuals = null,
  unitStats = null,
  buildings = null,
  buildingVisuals = null,
  buildingSkins = null,
  heroes = null
} = {}) {
  const issues = [];
  const add = (level, area, message, goto) =>
    issues.push({ level, area, message, ...(goto ? { goto } : {}) });

  const uVisMap = unitsVisuals?.units || {};
  const uStatMap = unitStats?.units || {};
  const bMap = buildings?.buildings || {};
  const hMap = heroes?.heroes || {};
  const combinedPrefabs = {
    ...(unitsVisuals?.prefabs || {}),
    ...(heroes?.prefabs || {})
  };
  const resolveAlias = (id) => (id === 'human_base' ? 'human_base_1' : id);

  // 1. building <-> unit production lists & ballista turret unit ref
  for (const [bid, bDef] of Object.entries(bMap)) {
    if (!bDef || typeof bDef !== 'object') continue;
    if (Array.isArray(bDef.options)) {
      for (const opt of bDef.options) {
        if (!opt || opt.kind !== 'unit') continue;
        const uid = opt.unitType || opt.id;
        if (!uid) {
          add('error', 'cross-ref', `Building "${bid}" has a unit option with no unit id`, { building: bid });
          continue;
        }
        if (unitStats && !uStatMap[uid]) {
          add('error', 'cross-ref', `Building "${bid}" recruits unknown unit "${uid}" (missing in unitStats)`, { building: bid, unit: uid });
        }
        if (unitsVisuals && !uVisMap[uid]) {
          add('error', 'cross-ref', `Building "${bid}" recruits unit "${uid}" with no visual definition in units`, { building: bid, unit: uid });
        }
      }
    }
    if (bDef.mountedBallistaUnitId && unitStats && !uStatMap[bDef.mountedBallistaUnitId]) {
      add('error', 'cross-ref', `Building "${bid}" references unknown mountedBallistaUnitId "${bDef.mountedBallistaUnitId}"`, { building: bid, unit: bDef.mountedBallistaUnitId });
    }
  }

  // 2. unitStats -> baseCharId & matching visual
  const deletedSet = new Set(unitStats?._deletedUnits || []);
  for (const [uid, uStat] of Object.entries(uStatMap)) {
    if (!uStat || typeof uStat !== 'object' || deletedSet.has(uid)) continue;
    const rawBase = uStat.baseCharId || uStat.baseModel;
    if (rawBase && unitsVisuals) {
      const resolvedBase = resolveAlias(rawBase);
      if (!uVisMap[resolvedBase]) {
        add('error', 'cross-ref', `Unit "${uid}" references missing base "${rawBase}"`, { unit: uid, base: rawBase });
      }
    }
    if (unitsVisuals && !uVisMap[uid]) {
      add('error', 'cross-ref', `Unit "${uid}" exists in unitStats but is missing in units visuals`, { unit: uid });
    }
  }

  // 3. unit -> gear (prefabs across main equipment + loadouts)
  for (const [uid, uVis] of Object.entries(uVisMap)) {
    if (!uVis || typeof uVis !== 'object') continue;
    for (const ld of loadoutsOf(uVis)) {
      for (const [socket, eq] of Object.entries(ld.equipment || {})) {
        if (eq?.prefab && !combinedPrefabs[eq.prefab]) {
          add(
            'error',
            'cross-ref',
            `Unit "${uid}" (${ld.id}:${socket}) references missing gear prefab "${eq.prefab}"`,
            { unit: uid }
          );
        }
      }
    }
  }

  // 4. hero -> unit / hierarchy / gear (prefabs)
  for (const [hid, hDef] of Object.entries(hMap)) {
    if (!hDef || typeof hDef !== 'object') continue;
    const heroBase = hDef.baseUnitId || hDef.baseCharId;
    if (heroBase && unitsVisuals) {
      const resolvedHeroBase = resolveAlias(heroBase);
      if (!uVisMap[resolvedHeroBase] && !hMap[resolvedHeroBase]) {
        add('error', 'cross-ref', `Hero "${hid}" references missing base unit "${heroBase}"`, { hero: hid });
      }
    }
    const joints = collectJoints(hDef.hierarchy || {});
    const mountJoints = collectJoints(hDef.mountHierarchy || {});
    if (!joints.has('torso') && !mountJoints.has('torso')) {
      add('error', 'cross-ref', `Hero "${hid}" hierarchy is missing required "torso" joint`, { hero: hid });
    }
    for (const ld of loadoutsOf(hDef)) {
      for (const [socket, eq] of Object.entries(ld.equipment || {})) {
        if (eq?.prefab && !combinedPrefabs[eq.prefab]) {
          add(
            'error',
            'cross-ref',
            `Hero "${hid}" (${ld.id}:${socket}) references missing gear prefab "${eq.prefab}"`,
            { hero: hid }
          );
        }
      }
    }
    if (hDef.mountedConfig?.equipment) {
      for (const [socket, eq] of Object.entries(hDef.mountedConfig.equipment)) {
        if (eq?.prefab && !combinedPrefabs[eq.prefab]) {
          add(
            'error',
            'cross-ref',
            `Hero "${hid}" (mountedConfig:${socket}) references missing gear prefab "${eq.prefab}"`,
            { hero: hid }
          );
        }
      }
    }
  }

  // 5. buildingSkins -> active skin key & building existence
  if (buildingSkins && typeof buildingSkins === 'object') {
    for (const [bid, entry] of Object.entries(buildingSkins)) {
      if (!entry || typeof entry !== 'object') continue;
      if (buildings && Object.keys(bMap).length > 0 && !bMap[bid]) {
        add('warn', 'cross-ref', `Building skin entry "${bid}" has no matching building in buildings.json`, { building: bid });
      }
      if (entry.active && entry.active !== 'default' && !entry.items?.[entry.active]) {
        add('error', 'cross-ref', `Building "${bid}" active skin "${entry.active}" does not exist in its skin items`, { building: bid });
      }
    }
  }

  // 6. buildingVisuals top-level check
  if (buildingVisuals && (!buildingVisuals.animations || typeof buildingVisuals.animations !== 'object')) {
    add('error', 'cross-ref', 'buildingVisuals.animations is missing or invalid');
  }

  return finish(issues);
}

/**
 * Full registry validation combining `runHealthCheck` (using combined unit+hero prefabs)
 * and `validateCrossReferences`. Returns `{ ok, error, issues, counts, blockingIssues }`.
 */
export function validateRegistryState(bundle = {}) {
  const {
    unitsVisuals = null,
    unitStats = null,
    buildings = null,
    buildingVisuals = null,
    buildingSkins = null,
    heroes = null
  } = bundle || {};

  const cross = validateCrossReferences({
    unitsVisuals,
    unitStats,
    buildings,
    buildingVisuals,
    buildingSkins,
    heroes
  });

  let studioReport = { issues: [], counts: { error: 0, warn: 0, info: 0 } };
  if (unitsVisuals) {
    const mergedForHealth = {
      ...unitsVisuals,
      prefabs: {
        ...(unitsVisuals.prefabs || {}),
        ...(heroes?.prefabs || {})
      }
    };
    studioReport = runHealthCheck(mergedForHealth);
  }

  // Deduplicate issues by (level + area + message)
  const seen = new Set();
  const merged = [];
  for (const issue of [...cross.issues, ...studioReport.issues]) {
    const key = `${issue.level}|${issue.area}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(issue);
  }

  // Blocking errors: any broken cross-reference OR structural error in file/unit/model/prefab
  const blockingIssues = merged.filter(
    (i) =>
      i.level === 'error' &&
      (i.area === 'cross-ref' ||
        i.area === 'file' ||
        i.area === 'model' ||
        i.area.startsWith('unit ') ||
        i.area.startsWith('prefab '))
  );
  // Filter out legacy false-positive warning/error when a unit only exists in unitStats-less visuals vs prefabs already merged:
  const referenceBlocking = blockingIssues.filter((i) => {
    if (i.area === 'cross-ref') return true;
    if (i.area === 'file') return true;
    if (i.message.includes('is not in prefabs') || i.message.includes('has no hierarchy') || i.message.includes('has no "torso" joint')) {
      return true;
    }
    return false;
  });

  const finished = finish(merged);
  const ok = referenceBlocking.length === 0;
  const error = ok
    ? null
    : referenceBlocking.slice(0, 3).map((i) => i.message).join('; ') +
      (referenceBlocking.length > 3 ? ` (+${referenceBlocking.length - 3} more)` : '');

  return {
    ok,
    error,
    blockingIssues: referenceBlocking,
    ...finished
  };
}

function finish(issues) {
  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level] || a.area.localeCompare(b.area));
  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.level]++;
  return { issues, counts };
}
