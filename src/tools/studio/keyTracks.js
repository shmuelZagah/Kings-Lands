/**
 * Kings Lands — Studio keyframe track maths (src/tools/studio/keyTracks.js)
 *
 * Pure functions (no DOM, no THREE) that edit ONE joint's track: an array of
 *   { t, pos:[x,y,z], rot:[x,y,z], easing, posKey?:false, rotKey?:false }
 * with values RELATIVE to the joint's rest pose.
 *
 * Position and rotation are independent "properties", like in After Effects:
 *   - a property is ANIMATED when at least one key owns it. A key owns a property unless `posKey` / `rotKey` is false
 *     (old files have no flags, so every key owns both – nothing breaks);
 *   - a property is STATIC (the empty diamond) when no key owns it: its value is the same for the whole clip.
 *     It is stored in the track's keys (all equal), usually a single key at t=0 with both flags false.
 *
 * The animator reads `pos` / `rot` of every key. To stay correct with an animator that does not know the flags,
 * the value a key stores for a property it does NOT own is kept equal to that property's curve at the key's time
 * (resync). An animator that does know the flags simply skips those keys, and the curves are exact.
 */

export const EPS_T = 0.012;

const FLAG = { pos: 'posKey', rot: 'rotKey' };
export const PROPS = ['rot', 'pos'];

const ZERO = () => [0, 0, 0];
const copy3 = (v) => (Array.isArray(v) ? [v[0] || 0, v[1] || 0, v[2] || 0] : ZERO());
const byT = (a, b) => a.t - b.t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

const smoothstep01 = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const isOwner = (key, prop) => key[FLAG[prop]] !== false;
export const ownedKeys = (track, prop) => (track || []).filter((k) => isOwner(k, prop));
export const isAnimated = (track, prop) => ownedKeys(track, prop).length > 0;

/** Same interpolation as the animator (keyframe easing of the LEFT key, smoothstep by default). */
function sampleList(list, prop, t) {
  if (list.length === 1 || t <= list[0].t) return copy3(list[0][prop]);
  const last = list[list.length - 1];
  if (t >= last.t) return copy3(last[prop]);
  for (let i = 0; i < list.length - 1; i++) {
    const k0 = list[i];
    const k1 = list[i + 1];
    if (t >= k0.t && t <= k1.t) {
      let u = clamp01((t - k0.t) / Math.max(0.0001, k1.t - k0.t));
      if (k0.easing === 'ease-in-out') u = easeInOutQuad(u);
      else if (k0.easing !== 'linear') u = smoothstep01(u);
      const a = copy3(k0[prop]);
      const b = copy3(k1[prop]);
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
  }
  return ZERO();
}

/** Value of a property at normalised time t (a static property returns its constant). */
export function sampleProp(track, prop, t) {
  if (!track || track.length === 0) return ZERO();
  const owned = ownedKeys(track, prop).sort(byT);
  if (owned.length === 0) return copy3(track[0][prop]);
  return sampleList(owned, prop, t);
}

function newKey(t, easing = 'smooth') {
  return { t, pos: ZERO(), rot: ZERO(), easing, posKey: false, rotKey: false };
}

function findKey(track, t, eps = EPS_T) {
  let best = null;
  let bestD = Infinity;
  for (const k of track) {
    const d = Math.abs(k.t - t);
    if (d <= eps && d < bestD) { best = k; bestD = d; }
  }
  return best;
}

function setOwner(key, prop, owns) {
  if (owns) delete key[FLAG[prop]];
  else key[FLAG[prop]] = false;
}

/** Re-establish every invariant after an edit (sort, side values, useless keys). Mutates `track` in place. */
export function resync(track) {
  track.sort(byT);
  for (const prop of PROPS) {
    const owned = ownedKeys(track, prop);
    if (owned.length === 0) {
      const v = copy3(track[0]?.[prop]);
      for (const k of track) k[prop] = copy3(v);
    } else {
      for (const k of track) if (!isOwner(k, prop)) k[prop] = sampleList(owned, prop, k.t);
    }
  }
  const useful = track.filter((k) => isOwner(k, 'pos') || isOwner(k, 'rot'));
  if (useful.length === 0) {
    if (track.length > 1) track.length = 1;
    if (track.length === 1) { track[0].t = 0; track[0].posKey = false; track[0].rotKey = false; }
  } else if (useful.length !== track.length) {
    track.splice(0, track.length, ...useful);
  }
  for (const k of track) for (const prop of PROPS) setOwner(k, prop, isOwner(k, prop));
  return track;
}

/** The property is not animated: give it a constant value for the whole clip. */
export function setStatic(track, prop, value) {
  if (track.length === 0) track.push(newKey(0));
  for (const k of track) k[prop] = copy3(value);
  return resync(track);
}

/**
 * Write (or update) the key that owns `prop` at time t.
 * The first key of a static property also pins its old value at t=0 and t=1 (not t=1 when `clampEnd`),
 * so nothing else in the clip moves.
 */
export function setKey(track, prop, t, value, { clampEnd = false } = {}) {
  const tt = clamp01(Math.round(t * 100) / 100);
  if (!isAnimated(track, prop)) {
    const pinned = track.length ? copy3(track[0][prop]) : ZERO();
    const pin = (at) => {
      let k = findKey(track, at, 0.002);
      if (!k) { k = newKey(at); track.push(k); }
      k[prop] = copy3(pinned);
      setOwner(k, prop, true);
    };
    if (tt > EPS_T) pin(0);
    if (!clampEnd && tt < 1 - EPS_T) pin(1);
  }
  let key = findKey(track, t) || findKey(track, tt);
  if (!key) { key = newKey(tt); track.push(key); }
  key[prop] = copy3(value);
  setOwner(key, prop, true);
  resync(track);
  return key;
}

/** Key of `prop` closest to t (within `eps`), or null. */
export function ownedKeyAt(track, prop, t, eps = EPS_T) {
  return findKey(ownedKeys(track, prop), t, eps);
}

/** Any key (either property) the playhead sits on. */
export function anyKeyAt(track, t, eps = EPS_T) {
  return findKey((track || []).filter((k) => isOwner(k, 'pos') || isOwner(k, 'rot')), t, eps);
}

/** Delete the key of `prop` at t. If it was the last one the property becomes static at that key's value. */
export function removeKey(track, prop, t, eps = 0.03) {
  const key = ownedKeyAt(track, prop, t, eps);
  if (!key) return false;
  const value = copy3(key[prop]);
  setOwner(key, prop, false);
  if (!isAnimated(track, prop)) for (const k of track) k[prop] = copy3(value);
  resync(track);
  return true;
}

/** Stopwatch off: drop every key of the property, keep `value` as its constant. */
export function clearProp(track, prop, value) {
  for (const k of track) { k[prop] = copy3(value); setOwner(k, prop, false); }
  return resync(track);
}

/** Move the key that owns `prop` (only that property) to a new time. Returns the key now holding it. */
export function moveProp(track, fromKey, prop, toT) {
  let t = clamp01(Math.round(toT * 100) / 100);
  const value = copy3(fromKey[prop]);
  const easing = fromKey.easing || 'smooth';
  setOwner(fromKey, prop, false);
  const clash = ownedKeys(track, prop).find((k) => Math.abs(k.t - t) < 0.005);
  if (clash) t = clamp01(Math.round((t + (t > 0.98 ? -0.01 : 0.01)) * 100) / 100);
  let target = findKey(track, t, 0.002);
  if (!target) { target = newKey(t, easing); track.push(target); }
  target[prop] = value;
  setOwner(target, prop, true);
  resync(track);
  return target;
}

/**
 * Old files have no ownership flags and store pos/rot on every key although most tracks only ever animate rotation.
 * Mark a property that never changes as static. Idempotent; only touches tracks that carry no flag yet.
 */
export function migrateLegacyTrack(track) {
  if (!Array.isArray(track) || track.length === 0) return false;
  // a key must always carry both rot and pos (very old clips only stored rot): missing ones mean "no change" = zeros
  let filled = false;
  for (const k of track) {
    if (!Array.isArray(k.rot)) { k.rot = [0, 0, 0]; filled = true; }
    if (!Array.isArray(k.pos)) { k.pos = [0, 0, 0]; filled = true; }
  }
  if (track.some((k) => k.posKey !== undefined || k.rotKey !== undefined)) return filled;
  track.sort(byT);
  const constant = (prop) => track.every((k) => {
    const a = copy3(k[prop]);
    const b = copy3(track[0][prop]);
    return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6;
  });
  let changed = false;
  for (const prop of PROPS) {
    if (constant(prop)) {
      for (const k of track) setOwner(k, prop, false);
      changed = true;
    }
  }
  if (changed) resync(track);
  return changed || filled;
}
