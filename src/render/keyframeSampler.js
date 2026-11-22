/**
 * Kings Lands — 3D Procedural & Keyframe Animator (src/render/animator3d.js)
 *
 * Updated for Phase 6.5 Deep Combat, Relative Keyframe Deltas & 1,200+ Unit Performance:
 * - Keyframe tracks in `units.json` store `rot` and `pos` as DELTAS relative to `restPoses[jointName]`
 *   (per DATA_CONTRACT.md Section 4). `_applyKeyframeClip` adds sampled deltas to `rest.rot` / `rest.pos`
 *   and respects `rotKey !== false` / `posKey !== false` so unkeyed channels never collapse limb positions.
 * - Procedural locomotion states (`idle`, `walk`, `run`, `gallop`, `combat_standby`, `block_idle`,
 *   `spear_wall_idle`, `worker_build`, `worker_gather`) add to `restPoses[joint].rot` so mounted riders
 *   and custom rest poses retain their natural posture.
 * - Single-pass Euler & Position commit per frame: intermediate layer calculations run on plain float
 *   scratch fields (`wx, wy, wz, wrx, wry, wrz`), invoking Three.js `Quaternion.setFromEuler` only once
 *   per changed bone at the end of `update()`.
 */

import * as THREE from 'three';
import { updateBowstringRig } from './modelFactory.js';

export const AnimationLayers = Object.freeze({
  LOWER_BODY: 'lowerBody',
  UPPER_BODY: 'upperBody',
  FULL_BODY: 'fullBody'
});

export const AnimEventTypes = Object.freeze({
  HIT: 'hit',
  RELEASE: 'release',
  FOOTSTEP: 'footstep',
  SOUND: 'sound',
  EFFECT: 'effect'
});

export function smoothstep01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export const _sampleScratch = {
  hasRot: false,
  rx: 0,
  ry: 0,
  rz: 0,
  hasPos: false,
  px: 0,
  py: 0,
  pz: 0
};

export function ensureTrackMetadata(keyframes) {
  let hasRot = false;
  let hasPos = false;
  let nonZeroRot = false;
  let nonZeroPos = false;

  for (let i = 0; i < keyframes.length; i++) {
    const k = keyframes[i];
    if (!k) continue;
    if (Array.isArray(k.rot)) {
      hasRot = true;
      if (
        k.rotKey !== false ||
        Math.abs(k.rot[0] || 0) > 1e-5 ||
        Math.abs(k.rot[1] || 0) > 1e-5 ||
        Math.abs(k.rot[2] || 0) > 1e-5
      ) {
        nonZeroRot = true;
      }
    }
    if (Array.isArray(k.pos)) {
      hasPos = true;
      if (
        k.posKey === true ||
        Math.abs(k.pos[0] || 0) > 1e-5 ||
        Math.abs(k.pos[1] || 0) > 1e-5 ||
        Math.abs(k.pos[2] || 0) > 1e-5
      ) {
        nonZeroPos = true;
      }
    }
  }

  Object.defineProperty(keyframes, '_hasRot', { value: hasRot, enumerable: false, configurable: true, writable: true });
  Object.defineProperty(keyframes, '_hasPos', { value: hasPos && nonZeroPos, enumerable: false, configurable: true, writable: true });
  Object.defineProperty(keyframes, '_isActiveTrack', {
    value: (hasRot && nonZeroRot) || (hasPos && nonZeroPos),
    enumerable: false,
    configurable: true,
    writable: true
  });
}

export function isTrackEffectivelyAnimated(keyframes) {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return false;
  ensureTrackMetadata(keyframes);
  return Boolean(keyframes._isActiveTrack);
}

export function sampleChannelInto(keyframes, normT, prop, keyFlag, out, isRot) {
  let prev = null;
  let next = null;

  for (let i = 0; i < keyframes.length; i++) {
    const k = keyframes[i];
    if (!k || !Array.isArray(k[prop]) || k[keyFlag] === false) continue;
    const kt = k.t ?? k.time ?? 0;
    if (kt <= normT) {
      prev = k;
    } else {
      next = k;
      break;
    }
  }

  if (!prev && !next) {
    // Static property (empty diamond ◇ in Studio): all keys have keyFlag === false, storing a constant value in keyframes[0]!
    const first = keyframes[0];
    const v = first && Array.isArray(first[prop]) ? first[prop] : null;
    if (!v) return;
    if (isRot) {
      out.hasRot = true;
      out.rx = v[0] || 0;
      out.ry = v[1] || 0;
      out.rz = v[2] || 0;
    } else if (
      Math.abs(v[0] || 0) > 1e-5 ||
      Math.abs(v[1] || 0) > 1e-5 ||
      Math.abs(v[2] || 0) > 1e-5
    ) {
      out.hasPos = true;
      out.px = v[0] || 0;
      out.py = v[1] || 0;
      out.pz = v[2] || 0;
    }
    return;
  }
  if (!prev) {
    const v = next[prop];
    if (isRot) {
      out.hasRot = true;
      out.rx = v[0] || 0;
      out.ry = v[1] || 0;
      out.rz = v[2] || 0;
    } else {
      out.hasPos = true;
      out.px = v[0] || 0;
      out.py = v[1] || 0;
      out.pz = v[2] || 0;
    }
    return;
  }
  if (!next || prev === next) {
    const v = prev[prop];
    if (isRot) {
      out.hasRot = true;
      out.rx = v[0] || 0;
      out.ry = v[1] || 0;
      out.rz = v[2] || 0;
    } else {
      out.hasPos = true;
      out.px = v[0] || 0;
      out.py = v[1] || 0;
      out.pz = v[2] || 0;
    }
    return;
  }

  const prevT = prev.t ?? prev.time ?? 0;
  const nextT = next.t ?? next.time ?? 1;
  const span = Math.max(0.0001, nextT - prevT);
  let localT = Math.max(0, Math.min(1, (normT - prevT) / span));
  if (prev.easing === 'ease-in-out') localT = easeInOutQuad(localT);
  else if (prev.easing !== 'linear') localT = smoothstep01(localT);

  const a = prev[prop];
  const b = next[prop];
  const x = (a[0] || 0) + ((b[0] || 0) - (a[0] || 0)) * localT;
  const y = (a[1] || 0) + ((b[1] || 0) - (a[1] || 0)) * localT;
  const z = (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * localT;

  if (isRot) {
    out.hasRot = true;
    out.rx = x;
    out.ry = y;
    out.rz = z;
  } else {
    out.hasPos = true;
    out.px = x;
    out.py = y;
    out.pz = z;
  }
}

export function sampleKeyframeTrackInto(keyframes, normT, out) {
  out.hasRot = false;
  out.hasPos = false;
  if (!Array.isArray(keyframes) || keyframes.length === 0) return out;

  sampleChannelInto(keyframes, normT, 'rot', 'rotKey', out, true);
  sampleChannelInto(keyframes, normT, 'pos', 'posKey', out, false);
  if (out.hasPos && Math.abs(out.px) < 1e-6 && Math.abs(out.py) < 1e-6 && Math.abs(out.pz) < 1e-6) {
    let anyExplicitPos = false;
    for (let i = 0; i < keyframes.length; i++) {
      const k = keyframes[i];
      if (k && (k.posKey === true || (Array.isArray(k.pos) && k.posKey !== false && (Math.abs(k.pos[0] || 0) > 1e-5 || Math.abs(k.pos[1] || 0) > 1e-5 || Math.abs(k.pos[2] || 0) > 1e-5)))) {
        anyExplicitPos = true;
        break;
      }
    }
    if (!anyExplicitPos) out.hasPos = false;
  }
  return out;
}

export function sampleClipPose(clip, normT = 0) {
  if (!clip || !clip.tracks) return {};
  const pose = {};
  const scratch = { hasRot: false, rx: 0, ry: 0, rz: 0, hasPos: false, px: 0, py: 0, pz: 0 };
  for (const [boneName, keyframes] of Object.entries(clip.tracks)) {
    sampleKeyframeTrackInto(keyframes, normT, scratch);
    pose[boneName] = {
      rot: scratch.hasRot ? [scratch.rx, scratch.ry, scratch.rz] : [0, 0, 0],
      pos: scratch.hasPos ? [scratch.px, scratch.py, scratch.pz] : [0, 0, 0]
    };
  }
  return pose;
}
