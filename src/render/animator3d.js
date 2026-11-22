import * as THREE from 'three';
import { updateBowstringRig } from './modelFactory.js';
import {
  AnimationLayers,
  AnimEventTypes,
  smoothstep01,
  easeInOutQuad,
  _sampleScratch,
  ensureTrackMetadata,
  isTrackEffectivelyAnimated,
  sampleChannelInto,
  sampleKeyframeTrackInto
} from './keyframeSampler.js';

export {
  AnimationLayers,
  AnimEventTypes,
  isTrackEffectivelyAnimated,
  sampleKeyframeTrackInto
};

export class Animator3D {
  constructor(unitGroup, animationsCatalog, options = {}) {
    this.unitGroup = unitGroup;
    this.animations = animationsCatalog || { procedural: {}, keyframes: {} };
    this.entityId = options.entityId ?? 0;
    this._eventListeners = new Set();
    if (typeof options.onEvent === 'function') this._eventListeners.add(options.onEvent);

    this.phaseOffset = (this.entityId * 0.43) % 1.0;
    this.lowerLayer = {
      clipName: 'idle',
      prevNormTime: 0,
      normTime: this.phaseOffset,
      speedMultiplier: 1.0
    };
    this.upperLayer = {
      active: false,
      clipName: null,
      elapsed: 0,
      duration: 0.85,
      speed: 1.0,
      holdAt: -1,
      holding: false,
      loop: false,
      prevNormTime: 0,
      normTime: 0,
      weight: 0
    };
    this.fullBodyLayer = {
      active: false,
      clipName: null,
      elapsed: 0,
      duration: 0.95,
      prevNormTime: 0,
      normTime: 0,
      poseLocked: false
    };
    this._worldPosScratch = new THREE.Vector3();
    this._fastJoints = null;
    this._fastJointMap = null;
    this._lastLowerClip = 'idle';
    this._locoBlendTimer = 0;
    this._hasPoseHistory = false;
    this._rebuildFastJointCache();
  }

  _rebuildFastJointCache() {
    const sockets = this.unitGroup?.userData?.sockets;
    const restPoses = this.unitGroup?.userData?.restPoses;
    if (!sockets || !restPoses) {
      this._fastJoints = null;
      this._fastJointMap = null;
      return;
    }

    const list = [];
    const map = Object.create(null);
    const keys = Object.keys(sockets);
    for (let i = 0; i < keys.length; i++) {
      const jointName = keys[i];
      const joint = sockets[jointName];
      const rest = restPoses[jointName];
      if (!joint || !rest) continue;
      const px = rest.pos[0] || 0;
      const py = rest.pos[1] || 0;
      const pz = rest.pos[2] || 0;
      const rx = rest.rot[0] || 0;
      const ry = rest.rot[1] || 0;
      const rz = rest.rot[2] || 0;
      const entry = {
        name: jointName,
        joint,
        px,
        py,
        pz,
        rx,
        ry,
        rz,
        wx: px,
        wy: py,
        wz: pz,
        wrx: rx,
        wry: ry,
        wrz: rz,
        curPx: px,
        curPy: py,
        curPz: pz,
        curRx: rx,
        curRy: ry,
        curRz: rz,
        appliedPx: joint.position.x,
        appliedPy: joint.position.y,
        appliedPz: joint.position.z,
        appliedRx: joint.rotation.x,
        appliedRy: joint.rotation.y,
        appliedRz: joint.rotation.z
      };
      list.push(entry);
      map[jointName] = entry;
    }
    this._fastJoints = list;
    this._fastJointMap = map;
  }

  onEvent(callback) {
    this._eventListeners.add(callback);
    return () => this._eventListeners.delete(callback);
  }

  setLocomotion(clipNameOrVariants, speedMultiplier = 1.0) {
    let variants = null;
    let clipName = clipNameOrVariants;
    if (Array.isArray(clipNameOrVariants) && clipNameOrVariants.length > 0) {
      variants = clipNameOrVariants;
      if (
        this.lowerLayer.variants &&
        this.lowerLayer.variants.length === variants.length &&
        this.lowerLayer.variants[0] === variants[0] &&
        variants.includes(this.lowerLayer.clipName)
      ) {
        this.lowerLayer.speedMultiplier = speedMultiplier;
        return;
      }
      const idx = ((this.entityId * 17 + (this._locoCycleCount | 0) * 29) >>> 0) % variants.length;
      clipName = variants[idx] || variants[0];
    }
    this.lowerLayer.variants = variants;

    let resolved = 'idle';
    if (
      this.animations.keyframes?.[clipName] &&
      this.animations.keyframes[clipName].layer === AnimationLayers.LOWER_BODY
    ) {
      resolved = clipName;
    } else if (this.animations.procedural?.[clipName]) {
      resolved = clipName;
    } else if (
      clipName === 'spear_wall_idle' ||
      clipName === 'worker_build' ||
      clipName === 'worker_chop' ||
      clipName === 'worker_mine' ||
      clipName === 'worker_gather' ||
      clipName === 'block_idle' ||
      clipName === 'knocked_down' ||
      clipName === 'combat_standby'
    ) {
      resolved = clipName;
    } else {
      resolved = 'idle';
    }

    if (this.lowerLayer.clipName !== resolved) {
      this.lowerLayer.clipName = resolved;
      this._locoBlendTimer = 0.22;
    }
    this.lowerLayer.speedMultiplier = speedMultiplier;
  }

  playAction(clipName, options = {}) {
    const clip = this.animations.keyframes?.[clipName];
    if (!clip) return false;
    if (clip.layer === AnimationLayers.FULL_BODY || clipName === 'die') {
      if (this.fullBodyLayer.active && this.fullBodyLayer.clipName === clipName && !options.restart) return true;
      this.fullBodyLayer.active = true;
      this.fullBodyLayer.clipName = clipName;
      this.fullBodyLayer.elapsed = 0;
      this.fullBodyLayer.duration = clip.duration || 0.95;
      this.fullBodyLayer.prevNormTime = 0;
      this.fullBodyLayer.normTime = 0;
      this.fullBodyLayer.poseLocked = false;
      return true;
    }
    if (this.upperLayer.active && this.upperLayer.clipName === clipName && !options.restart) return true;
    this.upperLayer.active = true;
    this.upperLayer.clipName = clipName;
    this.upperLayer.elapsed = 0;
    this.upperLayer.duration = clip.duration || 0.85;
    this.upperLayer.speed = options.speed > 0 ? options.speed : 1.0;
    this.upperLayer.holdAt = options.holdAt >= 0 ? options.holdAt : -1;
    this.upperLayer.holding = this.upperLayer.holdAt >= 0;
    this.upperLayer.loop = Boolean(options.loop ?? clip.loop);
    this.upperLayer.prevNormTime = 0;
    this.upperLayer.normTime = 0;
    this.upperLayer.weight = 1.0;
    return true;
  }

  getActionHitFraction(clipName) {
    const clip = this.animations.keyframes?.[clipName];
    if (!clip) return 0.5;
    if (clip._hitFraction === undefined) {
      const dur = clip.duration || 0.85;
      const ev = (clip.events || []).find(
        (e) => e && (e.type === 'hit' || e.type === 'release' || e.type === 'launch' || e.type === 'throw')
      );
      const f = ev && Number.isFinite(ev.time) ? ev.time / dur : 0.5;
      Object.defineProperty(clip, '_hitFraction', {
        value: Math.min(0.95, Math.max(0.05, f)),
        enumerable: false,
        writable: true
      });
    }
    return clip._hitFraction;
  }

  getActionHoldFraction(clipName) {
    const clip = this.animations.keyframes?.[clipName];
    if (!clip) return -1;
    const dur = clip.duration || 0.85;
    const ev = (clip.events || []).find((e) => e && e.type === 'hold' && Number.isFinite(e.time));
    return ev ? Math.min(0.9, Math.max(0.05, ev.time / dur)) : -1;
  }

  getActionTailSeconds(clipName) {
    const clip = this.animations.keyframes?.[clipName];
    const h = this.getActionHoldFraction(clipName);
    if (!clip || h < 0) return 0;
    return Math.max(0, this.getActionHitFraction(clipName) - h) * (clip.duration || 0.85);
  }

  playActionAimed(clipName, secondsTotal, options = {}) {
    const clip = this.animations.keyframes?.[clipName];
    const hold = this.getActionHoldFraction(clipName);
    if (!clip || hold < 0) {
      this.playActionTimed(clipName, secondsTotal, options);
      return false;
    }
    const dur = clip.duration || 0.85;
    const drawSec = hold * dur;
    const tailSec = this.getActionTailSeconds(clipName);
    if (secondsTotal < drawSec + tailSec + 0.1) {
      this.playActionTimed(clipName, secondsTotal, options);
      return false;
    }
    this.playAction(clipName, { ...options, restart: true, speed: 1.0, holdAt: drawSec });
    return true;
  }

  releaseHold(secondsToHit) {
    const L = this.upperLayer;
    if (!L.active || !L.holding) return;
    L.holding = false;
    const clip = this.animations.keyframes?.[L.clipName];
    const tail = this.getActionTailSeconds(L.clipName);
    L.speed = secondsToHit > 0 && tail > 0 ? Math.min(3.0, Math.max(0.5, tail / secondsToHit)) : 1.0;
    if (!clip) L.active = false;
  }

  cancelAction() {
    this.upperLayer.active = false;
    this.upperLayer.holding = false;
    this.upperLayer.clipName = null;
    this._locoBlendTimer = 0.18;
  }

  playActionTimed(clipName, secondsToHit, options = {}) {
    const clip = this.animations.keyframes?.[clipName];
    if (!clip) return false;
    const hitSeconds = this.getActionHitFraction(clipName) * (clip.duration || 0.85);
    const speed = secondsToHit > 0 ? Math.min(3.0, Math.max(0.5, hitSeconds / secondsToHit)) : 1.0;
    return this.playAction(clipName, { ...options, restart: true, speed });
  }

  resetFullBody() {
    this.fullBodyLayer.active = false;
    this.fullBodyLayer.clipName = null;
    this.fullBodyLayer.poseLocked = false;
    this.upperLayer.active = false;
    this.upperLayer.clipName = null;
    this._locoBlendTimer = 0;
    this._hasPoseHistory = false;
  }

  _checkAndFireEvents(eventsList, prevNorm, currNorm, clipName, layerName, clipDuration = 1.0) {
    if (!Array.isArray(eventsList) || eventsList.length === 0 || this._eventListeners.size === 0) return;
    const wrapped = currNorm < prevNorm;
    const dur = clipDuration > 0 ? clipDuration : 1.0;
    for (let i = 0; i < eventsList.length; i++) {
      const evDef = eventsList[i];
      if (!evDef || evDef.type === 'hold') continue;
      const rawTime = evDef.time ?? 0.5;
      const evNorm = Math.max(0, Math.min(1, rawTime / dur));
      const crossed = wrapped
        ? (evNorm > prevNorm || evNorm <= currNorm)
        : (evNorm > prevNorm && evNorm <= currNorm);
      if (crossed) {
        const sockets = this.unitGroup?.userData?.sockets;
        const targetSocket = sockets?.[evDef.payload?.socket || 'torso'] || this.unitGroup;
        if (targetSocket) targetSocket.getWorldPosition(this._worldPosScratch);
        const eventPacket = {
          entityId: this.entityId,
          clipName,
          layer: layerName,
          type: evDef.type,
          time: rawTime,
          worldPosition: {
            x: this._worldPosScratch.x,
            y: this._worldPosScratch.y,
            z: this._worldPosScratch.z
          },
          payload: evDef.payload || {}
        };
        for (const listener of this._eventListeners) listener(eventPacket);
      }
    }
  }

  _commitFastJoints(fastJoints) {
    for (let i = 0; i < fastJoints.length; i++) {
      const fj = fastJoints[i];
      const j = fj.joint;
      if (
        Math.abs(fj.wx - j.position.x) +
          Math.abs(fj.wy - j.position.y) +
          Math.abs(fj.wz - j.position.z) >
        1e-5
      ) {
        j.position.set(fj.wx, fj.wy, fj.wz);
      }
      if (
        Math.abs(fj.wrx - j.rotation.x) +
          Math.abs(fj.wry - j.rotation.y) +
          Math.abs(fj.wrz - j.rotation.z) >
        1e-5
      ) {
        j.rotation.set(fj.wrx, fj.wry, fj.wrz);
      }
    }
  }

  update(rawDtSeconds) {
    if (this.fullBodyLayer.active && this.fullBodyLayer.poseLocked) {
      return;
    }

    const sockets = this.unitGroup?.userData?.sockets;
    const restPoses = this.unitGroup?.userData?.restPoses;
    if (!sockets || !restPoses) return;

    if (!this._fastJoints || !this._fastJointMap) {
      this._rebuildFastJointCache();
    }
    const fastJoints = this._fastJoints;
    const jm = this._fastJointMap;
    if (!fastJoints || !jm) return;

    // Clamp animation step delta so temporary frame drops never jump half a walk cycle in 1 frame
    const dtSeconds = Math.min(Math.max(0, rawDtSeconds), 0.08);

    // 1. Reset working pose in plain float scratch fields (zero Three.js Euler/Quaternion trig overhead)
    for (let i = 0; i < fastJoints.length; i++) {
      const fj = fastJoints[i];
      fj.wx = fj.px;
      fj.wy = fj.py;
      fj.wz = fj.pz;
      fj.wrx = fj.rx;
      fj.wry = fj.ry;
      fj.wrz = fj.rz;
    }

    // 2. Full-body layer (e.g. death clip)
    if (this.fullBodyLayer.active) {
      const clip = this.animations.keyframes?.[this.fullBodyLayer.clipName];
      if (clip) {
        this.fullBodyLayer.prevNormTime = this.fullBodyLayer.normTime;
        this.fullBodyLayer.elapsed += dtSeconds;
        this.fullBodyLayer.normTime = Math.min(
          1.0,
          this.fullBodyLayer.elapsed / this.fullBodyLayer.duration
        );
        this._applyKeyframeClip(clip, this.fullBodyLayer.normTime, 1.0, jm);
        this._commitFastJoints(fastJoints);
        this._checkAndFireEvents(
          clip.events,
          this.fullBodyLayer.prevNormTime,
          this.fullBodyLayer.normTime,
          this.fullBodyLayer.clipName,
          AnimationLayers.FULL_BODY,
          this.fullBodyLayer.duration
        );
        if (this.fullBodyLayer.normTime >= 1.0 && clip.clampWhenFinished !== false) {
          this.fullBodyLayer.poseLocked = true;
        }
        return;
      }
    }

    // 3. Lower-body / locomotion layer (additive on top of restPoses so mounted riders keep their leg posture)
    const lowerClipName = this.lowerLayer.clipName;
    const cleanLowerName = typeof lowerClipName === 'string' ? lowerClipName.replace(/__v\d+$/, '') : 'idle';
    const baseLowerName =
      ['worker_build', 'worker_chop', 'worker_mine', 'walk', 'run', 'charge', 'retreat_run', 'gallop', 'idle'].find(
        (b) => cleanLowerName === b || cleanLowerName.endsWith(`_${b}`)
      ) || cleanLowerName;
    const candLowerKf =
      this.animations.keyframes?.[lowerClipName] ||
      this.animations.keyframes?.[cleanLowerName] ||
      this.animations.keyframes?.[baseLowerName];
    const lowerKeyframeClip =
      candLowerKf &&
      candLowerKf.layer === AnimationLayers.LOWER_BODY &&
      candLowerKf.tracks &&
      Object.keys(candLowerKf.tracks).length > 0
        ? candLowerKf
        : null;

    if (lowerKeyframeClip) {
      const dur = lowerKeyframeClip.duration || 1.6;
      this.lowerLayer.prevNormTime = this.lowerLayer.normTime;
      const rawNextNorm =
        this.lowerLayer.normTime + (dtSeconds * this.lowerLayer.speedMultiplier) / dur;
      if (rawNextNorm >= 1.0 && this.lowerLayer.variants && this.lowerLayer.variants.length > 1) {
        this._locoCycleCount = ((this._locoCycleCount | 0) + 1) | 0;
        const vList = this.lowerLayer.variants;
        const kfMap = this.animations?.keyframes || {};
        let totalW = 0;
        for (let vi = 0; vi < vList.length; vi++) {
          const w = Number(kfMap[vList[vi]]?.weight);
          totalW += w > 0 ? w : (vi === 0 ? 70 : 30);
        }
        let nextVar = vList[0];
        if (totalW > 0) {
          let roll = ((this.entityId * 2654435761 + this._locoCycleCount * 1013904223) >>> 0) % totalW;
          for (let vi = 0; vi < vList.length; vi++) {
            const w = Number(kfMap[vList[vi]]?.weight);
            const effW = w > 0 ? w : (vi === 0 ? 70 : 30);
            if (roll < effW) {
              nextVar = vList[vi];
              break;
            }
            roll -= effW;
          }
        }
        if (nextVar && nextVar !== this.lowerLayer.clipName) {
          this.lowerLayer.clipName = nextVar;
          this._locoBlendTimer = 0.16;
        }
      }
      this.lowerLayer.normTime = rawNextNorm % 1.0;
      this._applyKeyframeClip(lowerKeyframeClip, this.lowerLayer.normTime, 1.0, jm);
      this._checkAndFireEvents(
        lowerKeyframeClip.events,
        this.lowerLayer.prevNormTime,
        this.lowerLayer.normTime,
        lowerClipName,
        AnimationLayers.LOWER_BODY,
        dur
      );
    } else if (lowerClipName === 'knocked_down') {
      this.upperLayer.active = false;
      const airAlt = Number(this.airOffset) || 0;
      const isMounted = Boolean(this.isMountedUnit);

      if (airAlt > 0.06) {
        // PHASE 1 & 2: Airborne Launch + Repeating Mid-Air Flailing Loop until ground contact!
        this.knockdownAirTime = (this.knockdownAirTime || 0) + dtSeconds;
        this.knockdownGroundTime = 0;
        const loopPhase = this.knockdownAirTime * Math.PI * 7.5;
        const flailSin = Math.sin(loopPhase);
        const flailCos = Math.cos(loopPhase);

        if (isMounted) {
          // Cavalry rider thrown backward/sideways in mid-air while horse stumbles
          if (jm.torso) {
            jm.torso.wx = jm.torso.px + 0.48;
            jm.torso.wy = jm.torso.py - 0.32 + 0.08 * flailSin;
            jm.torso.wz = jm.torso.pz - 0.42;
            jm.torso.wrx = jm.torso.rx - 1.05 + 0.22 * flailSin;
            jm.torso.wrz = jm.torso.rz - 0.55;
          }
        } else if (jm.torso) {
          jm.torso.wy = jm.torso.py - 0.18;
          jm.torso.wz = jm.torso.pz - 0.22;
          jm.torso.wrx = jm.torso.rx - 1.12 + 0.24 * flailSin;
          jm.torso.wry = jm.torso.ry + 0.18 * flailCos;
        }
        if (jm.arm_L) {
          jm.arm_L.wrx = jm.arm_L.rx - 1.25 + 0.55 * flailSin;
          jm.arm_L.wrz = jm.arm_L.rz + 0.75 + 0.25 * flailCos;
        }
        if (jm.arm_R) {
          jm.arm_R.wrx = jm.arm_R.rx - 1.25 - 0.55 * flailSin;
          jm.arm_R.wrz = jm.arm_R.rz - 0.75 - 0.25 * flailCos;
        }
        if (jm.leg_L) jm.leg_L.wrx = jm.leg_L.rx - 0.65 + 0.45 * flailCos;
        if (jm.leg_R) jm.leg_R.wrx = jm.leg_R.rx - 0.65 - 0.45 * flailCos;
      } else {
        // PHASE 3: Ground Impact on Back (0..0.48s) -> Pushing Up / Remounting Horse (0.48s..1.10s)
        this.knockdownGroundTime = (this.knockdownGroundTime || 0) + dtSeconds;
        const gt = this.knockdownGroundTime;

        if (gt < 0.48) {
          // Phase 3a: Lands flat on back with a damped ground impact bounce
          const impactBounce = Math.exp(-gt * 9.0) * Math.abs(Math.sin(gt * 22.0)) * 0.12;
          if (isMounted) {
            if (jm.torso) {
              jm.torso.wx = jm.torso.px + 0.68;
              jm.torso.wy = jm.torso.py - 0.92 + impactBounce;
              jm.torso.wz = jm.torso.pz - 0.35;
              jm.torso.wrx = jm.torso.rx - 1.42;
              jm.torso.wrz = jm.torso.rz - 0.45;
            }
          } else if (jm.torso) {
            jm.torso.wy = jm.torso.py - 0.68 + impactBounce;
            jm.torso.wz = jm.torso.pz - 0.35;
            jm.torso.wrx = jm.torso.rx - 1.45;
          }
          if (jm.arm_L) {
            jm.arm_L.wrx = jm.arm_L.rx - 0.45;
            jm.arm_L.wrz = jm.arm_L.rz + 0.72;
          }
          if (jm.arm_R) {
            jm.arm_R.wrx = jm.arm_R.rx - 0.52;
            jm.arm_R.wrz = jm.arm_R.rz - 0.78;
          }
          if (jm.leg_L) jm.leg_L.wrx = jm.leg_L.rx - 0.32;
          if (jm.leg_R) jm.leg_R.wrx = jm.leg_R.rx - 0.48;
        } else {
          // Phase 3b: Getting Back Up (or Climbing Back Onto the Horse for Cavalry!)
          const u = Math.min(1.0, (gt - 0.48) / 0.58);
          const smoothU = u * u * (3 - 2 * u);

          if (isMounted) {
            // Rider pushes up from beside the horse and vaults back into the saddle
            const vaultArc = Math.sin(smoothU * Math.PI) * 0.28;
            if (jm.torso) {
              jm.torso.wx = jm.torso.px + 0.68 * (1 - smoothU);
              jm.torso.wy = jm.torso.py - 0.92 * (1 - smoothU) + vaultArc;
              jm.torso.wz = jm.torso.pz - 0.35 * (1 - smoothU);
              jm.torso.wrx = jm.torso.rx + (-1.42 * (1 - smoothU) + Math.sin(smoothU * Math.PI) * 0.35);
              jm.torso.wrz = jm.torso.rz - 0.45 * (1 - smoothU);
            }
            if (jm.arm_L) {
              jm.arm_L.wrx = jm.arm_L.rx - 0.95 * Math.sin(smoothU * Math.PI);
              jm.arm_L.wrz = jm.arm_L.rz + 0.55 * (1 - smoothU);
            }
            if (jm.arm_R) {
              jm.arm_R.wrx = jm.arm_R.rx - 0.95 * Math.sin(smoothU * Math.PI);
              jm.arm_R.wrz = jm.arm_R.rz - 0.55 * (1 - smoothU);
            }
          } else {
            // Infantry / Archer pushes up off its back -> leans forward on one knee -> stands upright
            const forwardPushPitch =
              smoothU < 0.55
                ? -1.45 + (smoothU / 0.55) * 1.85
                : 0.40 * (1 - (smoothU - 0.55) / 0.45);
            if (jm.torso) {
              jm.torso.wy = jm.torso.py - 0.68 * (1 - smoothU);
              jm.torso.wz = jm.torso.pz - 0.35 * (1 - smoothU);
              jm.torso.wrx = jm.torso.rx + forwardPushPitch;
            }
            if (jm.arm_L) {
              jm.arm_L.wrx = jm.arm_L.rx + (0.65 * Math.sin(smoothU * Math.PI) - 0.45 * (1 - smoothU));
              jm.arm_L.wrz = jm.arm_L.rz + 0.65 * (1 - smoothU);
            }
            if (jm.arm_R) {
              jm.arm_R.wrx = jm.arm_R.rx + (0.65 * Math.sin(smoothU * Math.PI) - 0.52 * (1 - smoothU));
              jm.arm_R.wrz = jm.arm_R.rz - 0.72 * (1 - smoothU);
            }
            if (jm.leg_L) jm.leg_L.wrx = jm.leg_L.rx - 0.55 * Math.sin(smoothU * Math.PI);
            if (jm.leg_R) jm.leg_R.wrx = jm.leg_R.rx + 0.45 * Math.sin(smoothU * Math.PI);
          }
        }
      }
    } else if (lowerClipName === 'block_idle') {
      this.lowerLayer.normTime = (this.lowerLayer.normTime + dtSeconds * 2.0) % 1.0;
      const bracePulse = Math.sin(this.lowerLayer.normTime * Math.PI * 2) * 0.03;
      if (jm.torso) {
        jm.torso.wy = jm.torso.py - 0.07;
        jm.torso.wrx = jm.torso.rx + 0.14 + bracePulse;
        jm.torso.wry = jm.torso.ry + 0.25;
      }
      if (jm.arm_L) {
        jm.arm_L.wrx = jm.arm_L.rx - 1.05;
        jm.arm_L.wry = jm.arm_L.ry + 0.78;
        jm.arm_L.wrz = jm.arm_L.rz + 0.22;
      }
      if (jm.arm_R) {
        jm.arm_R.wrx = jm.arm_R.rx - 0.65;
        jm.arm_R.wry = jm.arm_R.ry - 0.35;
      }
    } else if (lowerClipName === 'combat_standby') {
      this.lowerLayer.normTime = (this.lowerLayer.normTime + dtSeconds * 1.2) % 1.0;
      const breathe = Math.sin(this.lowerLayer.normTime * Math.PI * 2) * 0.015;
      if (jm.torso) {
        jm.torso.wy = jm.torso.py - 0.05 + breathe;
        jm.torso.wrx = jm.torso.rx + 0.16;
        jm.torso.wry = jm.torso.ry + 0.12;
      }
      if (jm.arm_L) {
        jm.arm_L.wrx = jm.arm_L.rx - 0.85;
        jm.arm_L.wry = jm.arm_L.ry + 0.55;
        jm.arm_L.wrz = jm.arm_L.rz + 0.15;
      }
      if (jm.arm_R) {
        jm.arm_R.wrx = jm.arm_R.rx - 0.65;
        jm.arm_R.wry = jm.arm_R.ry - 0.22;
      }
    } else if (lowerClipName === 'worker_build') {
      this.lowerLayer.normTime = (this.lowerLayer.normTime + dtSeconds * 2.8) % 1.0;
      const phase = this.lowerLayer.normTime * Math.PI * 2;
      const strike = Math.sin(phase);
      if (jm.torso) {
        jm.torso.wy = jm.torso.py - 0.12;
        jm.torso.wrx = jm.torso.rx + 0.25 + Math.max(0, strike) * 0.22;
      }
      if (jm.arm_R) {
        jm.arm_R.wrx = jm.arm_R.rx - 1.35 + strike * 1.15;
      }
      if (jm.arm_L) {
        jm.arm_L.wrx = jm.arm_L.rx - 0.55;
      }
    } else if (lowerClipName === 'worker_gather') {
      this.lowerLayer.normTime = (this.lowerLayer.normTime + dtSeconds * 1.35) % 1.0;
      const phase = this.lowerLayer.normTime * Math.PI * 2;
      const swing = Math.sin(phase);
      if (jm.torso) {
        jm.torso.wry = jm.torso.ry + swing * 0.55;
        jm.torso.wrx = jm.torso.rx + 0.18 + Math.max(0, -swing) * 0.28;
      }
      if (jm.arm_R) {
        jm.arm_R.wrx = jm.arm_R.rx - 0.95 - swing * 0.85;
        jm.arm_R.wrz = jm.arm_R.rz - 0.25 + swing * 0.35;
      }
      if (jm.arm_L) {
        jm.arm_L.wrx = jm.arm_L.rx - 0.85 - swing * 0.75;
        jm.arm_L.wry = jm.arm_L.ry + 0.35;
      }
    } else if (lowerClipName === 'spear_wall_idle') {
      this.lowerLayer.prevNormTime = this.lowerLayer.normTime;
      this.lowerLayer.normTime = (this.lowerLayer.normTime + dtSeconds * 0.7) % 1.0;
      const phaseRad = this.lowerLayer.normTime * Math.PI * 2;
      const breathe = Math.sin(phaseRad) * 0.018;

      if (jm.torso) {
        jm.torso.wy = jm.torso.py - 0.08 + Math.abs(breathe);
        jm.torso.wrx = jm.torso.rx + 0.22 + breathe;
        jm.torso.wry = jm.torso.ry - 0.18;
      }
      if (jm.head) {
        jm.head.wrx = jm.head.rx - 0.16;
        jm.head.wry = jm.head.ry + 0.18;
      }
      if (jm.arm_L) {
        jm.arm_L.wrx = jm.arm_L.rx - 0.55;
        jm.arm_L.wry = jm.arm_L.ry + 0.65;
        jm.arm_L.wrz = jm.arm_L.rz + 0.15;
      }
      if (jm.arm_R) {
        jm.arm_R.wz = jm.arm_R.pz + 0.16;
        jm.arm_R.wrx = jm.arm_R.rx - 0.78 + breathe * 1.5;
        jm.arm_R.wry = jm.arm_R.ry + 0.12;
      }
      if (jm.leg_L && jm.leg_R) {
        jm.leg_L.wz = jm.leg_L.pz + 0.14;
        jm.leg_L.wrx = jm.leg_L.rx - 0.24;
        jm.leg_R.wz = jm.leg_R.pz - 0.14;
        jm.leg_R.wrx = jm.leg_R.rx + 0.26;
      }

    } else {
      const procClip =
        this.animations.procedural?.[lowerClipName] || this.animations.procedural?.idle;
      if (procClip) {
        const isWalkClip =
          lowerClipName === 'walk' || lowerClipName.endsWith('_walk');
        const baseFreq = isWalkClip
          ? Math.min(procClip.frequency || 2.4, 2.5)
          : procClip.frequency || 2.0;
        const freq = baseFreq * this.lowerLayer.speedMultiplier;
        this.lowerLayer.prevNormTime = this.lowerLayer.normTime;
        this.lowerLayer.normTime = (this.lowerLayer.normTime + dtSeconds * (freq * 0.5)) % 1.0;
        const phaseRad = this.lowerLayer.normTime * Math.PI * 2;
        const sinP = Math.sin(phaseRad);
        const cosP = Math.cos(phaseRad);
        const bob = Math.abs(sinP) * (procClip.bobAmplitude || 0.04);

        if (jm.torso) {
          jm.torso.wy = jm.torso.py + bob;
          jm.torso.wrz = jm.torso.rz + sinP * (procClip.torsoSway || 0.04) * 0.5;
          jm.torso.wry = jm.torso.ry + cosP * (procClip.torsoSway || 0.04);
        }
        const hasMount = Boolean(this.isMountedUnit || this.unitGroup?.userData?.isMounted || jm.mount_torso);
        if (!hasMount && jm.leg_L && jm.leg_R) {
          const legAmp = isWalkClip
            ? Math.min(procClip.legSwing || 0, 0.48)
            : procClip.legSwing || 0;
          jm.leg_L.wrx = jm.leg_L.rx + sinP * legAmp;
          jm.leg_R.wrx = jm.leg_R.rx - sinP * legAmp;
        }
        const isChargeClip = lowerClipName === "charge" || lowerClipName.endsWith("_charge");
        const isRetreatClip = lowerClipName === "retreat_run" || lowerClipName.endsWith("_retreat_run");
        if (isChargeClip) {
          if (jm.torso) {
            jm.torso.wrx = jm.torso.rx + 0.34;
          }
          if (jm.arm_R) {
            jm.arm_R.wrx = jm.arm_R.rx - 1.75 + sinP * 0.22;
            jm.arm_R.wrz = jm.arm_R.rz - 0.18;
          }
          if (jm.arm_L) {
            jm.arm_L.wrx = jm.arm_L.rx - 0.92 - sinP * 0.25;
            jm.arm_L.wry = jm.arm_L.ry + 0.45;
          }
        } else if (isRetreatClip) {
          if (jm.torso) {
            jm.torso.wrx = jm.torso.rx + 0.26;
          }
          if (jm.head) {
            jm.head.wry = jm.head.ry + Math.sin(phaseRad * 0.5) * 0.65;
          }
          if (jm.arm_L && jm.arm_R) {
            jm.arm_L.wrx = jm.arm_L.rx - 0.55 - sinP * 0.75;
            jm.arm_R.wrx = jm.arm_R.rx - 0.55 + sinP * 0.75;
          }
        } else if (jm.arm_L && jm.arm_R) {
          const armAmp = isWalkClip
            ? Math.min(procClip.armSwing || 0.05, 0.34)
            : procClip.armSwing || 0.05;
          jm.arm_L.wrx = jm.arm_L.rx - sinP * armAmp;
          jm.arm_R.wrx = jm.arm_R.rx + sinP * armAmp;
        }
        if ((procClip.isMountGallop || hasMount) && jm.mount_torso) {
          const isIdleMount = lowerClipName === "idle" || lowerClipName.endsWith("_idle");
          const stride = isIdleMount ? 0.0 : (procClip.mountStride || 0.62);
          const mountBob = isIdleMount ? Math.abs(sinP) * 0.025 : Math.abs(sinP) * 0.08;
          jm.mount_torso.wy = jm.mount_torso.py + mountBob;
          jm.mount_torso.wrx = jm.mount_torso.rx + cosP * (isIdleMount ? 0.02 : 0.06);
          if (jm.pelvis) {
            jm.pelvis.wy = jm.pelvis.py + mountBob;
          }
          if (jm.mount_head) jm.mount_head.wrx = jm.mount_head.rx - cosP * (isIdleMount ? 0.04 : 0.12);
          if (jm.mount_tail) {
            jm.mount_tail.wry = jm.mount_tail.ry + Math.sin(phaseRad) * 0.16;
          }
          if (stride > 0) {
            if (jm.mount_leg_FL) jm.mount_leg_FL.wrx = jm.mount_leg_FL.rx + Math.sin(phaseRad) * stride;
            if (jm.mount_leg_FR) jm.mount_leg_FR.wrx = jm.mount_leg_FR.rx + Math.sin(phaseRad + Math.PI) * stride;
            if (jm.mount_leg_BR) jm.mount_leg_BR.wrx = jm.mount_leg_BR.rx + Math.sin(phaseRad + Math.PI * 0.5) * stride;
            if (jm.mount_leg_BL) jm.mount_leg_BL.wrx = jm.mount_leg_BL.rx + Math.sin(phaseRad + Math.PI * 1.5) * stride;
          }
        }

        this._checkAndFireEvents(
          procClip.events,
          this.lowerLayer.prevNormTime,
          this.lowerLayer.normTime,
          lowerClipName,
          AnimationLayers.LOWER_BODY,
          1.0
        );
      }
    }

    // 4. Upper-body action layer (melee swings, bow shots, javelin throws, hurt reactions)
    if (this.upperLayer.active) {
      const upperClip = this.animations.keyframes?.[this.upperLayer.clipName];
      if (!upperClip) {
        this.upperLayer.active = false;
      } else {
        this.upperLayer.prevNormTime = this.upperLayer.normTime;
        if (this.upperLayer.holding && this.upperLayer.elapsed >= this.upperLayer.holdAt) {
          this.upperLayer.elapsed = this.upperLayer.holdAt;
        } else {
          this.upperLayer.elapsed += dtSeconds * this.upperLayer.speed;
          if (this.upperLayer.holding && this.upperLayer.elapsed > this.upperLayer.holdAt) {
            this.upperLayer.elapsed = this.upperLayer.holdAt;
          }
        }
        let rawNorm = this.upperLayer.elapsed / this.upperLayer.duration;

        if (rawNorm >= 1.0) {
          if (this.upperLayer.loop) {
            this.upperLayer.elapsed %= this.upperLayer.duration;
            rawNorm = this.upperLayer.elapsed / this.upperLayer.duration;
          } else {
            rawNorm = 1.0;
            this.upperLayer.active = false;
            this._locoBlendTimer = 0.16;
          }
        }
        this.upperLayer.normTime = rawNorm;

        let blendWeight = 1.0;
        if (rawNorm < 0.12) blendWeight = rawNorm / 0.12;
        else if (rawNorm > 0.85 && !this.upperLayer.loop) blendWeight = (1.0 - rawNorm) / 0.15;

        const UPPER_BONES = [
          'torso',
          'head',
          'arm_L',
          'forearm_L',
          'hand_L',
          'arm_R',
          'forearm_R',
          'hand_R',
          'weapon_socket_L',
          'weapon_socket_R'
        ];
        for (let u = 0; u < UPPER_BONES.length; u++) {
          const ub = jm[UPPER_BONES[u]];
          if (!ub) continue;
          ub.wx = ub.wx + (ub.px - ub.wx) * blendWeight;
          ub.wy = ub.wy + (ub.py - ub.wy) * blendWeight;
          ub.wz = ub.wz + (ub.pz - ub.wz) * blendWeight;
          ub.wrx = ub.wrx + (ub.rx - ub.wrx) * blendWeight;
          ub.wry = ub.wry + (ub.ry - ub.wry) * blendWeight;
          ub.wrz = ub.wrz + (ub.rz - ub.wrz) * blendWeight;
        }

        this._applyKeyframeClip(upperClip, rawNorm, blendWeight, jm);
        this._checkAndFireEvents(
          upperClip.events,
          this.upperLayer.prevNormTime,
          this.upperLayer.normTime,
          this.upperLayer.clipName,
          AnimationLayers.UPPER_BODY,
          this.upperLayer.duration
        );
      }
    }

    // 5. Smooth cross-fade damping across any locomotion clip transitions
    if (this._hasPoseHistory && this._locoBlendTimer > 0 && dtSeconds > 0) {
      this._locoBlendTimer = Math.max(0, this._locoBlendTimer - dtSeconds);
      const alpha = Math.min(1.0, 1.0 - Math.exp(-dtSeconds * 16.0));
      for (let i = 0; i < fastJoints.length; i++) {
        const fj = fastJoints[i];
        fj.wx = fj.curPx + (fj.wx - fj.curPx) * alpha;
        fj.wy = fj.curPy + (fj.wy - fj.curPy) * alpha;
        fj.wz = fj.curPz + (fj.wz - fj.curPz) * alpha;
        let drx = fj.wrx - fj.curRx;
        if (drx > Math.PI) drx -= Math.PI * 2;
        else if (drx < -Math.PI) drx += Math.PI * 2;
        let dry = fj.wry - fj.curRy;
        if (dry > Math.PI) dry -= Math.PI * 2;
        else if (dry < -Math.PI) dry += Math.PI * 2;
        let drz = fj.wrz - fj.curRz;
        if (drz > Math.PI) drz -= Math.PI * 2;
        else if (drz < -Math.PI) drz += Math.PI * 2;
        fj.wrx = fj.curRx + drx * alpha;
        fj.wry = fj.curRy + dry * alpha;
        fj.wrz = fj.curRz + drz * alpha;
        fj.curPx = fj.wx;
        fj.curPy = fj.wy;
        fj.curPz = fj.wz;
        fj.curRx = fj.wrx;
        fj.curRy = fj.wry;
        fj.curRz = fj.wrz;
      }
    } else {
      this._hasPoseHistory = true;
      for (let i = 0; i < fastJoints.length; i++) {
        const fj = fastJoints[i];
        fj.curPx = fj.wx;
        fj.curPy = fj.wy;
        fj.curPz = fj.wz;
        fj.curRx = fj.wrx;
        fj.curRy = fj.wry;
        fj.curRz = fj.wrz;
      }
    }

    // 5b. Layer frantic "On Fire Panic" upper-body flailing when unit is burning (`this.isBurning`)
    if (this.isBurning && lowerClipName !== 'knocked_down' && !this.fullBodyLayer.active) {
      this._burningAnimTime = (this._burningAnimTime || 0) + dtSeconds * 15.0;
      const bt = this._burningAnimTime;
      const waveA = Math.sin(bt);
      const waveB = Math.cos(bt * 1.35);
      if (jm.torso) {
        jm.torso.wrx += -0.18 + 0.14 * waveB;
        jm.torso.wry += 0.28 * waveA;
      }
      if (jm.head) {
        jm.head.wrx += -0.32 + 0.18 * waveA;
        jm.head.wry += 0.42 * waveB;
      }
      if (jm.arm_L) {
        jm.arm_L.wrx = jm.arm_L.rx - 2.35 + 0.55 * waveA;
        jm.arm_L.wrz = jm.arm_L.rz + 0.65 + 0.35 * waveB;
      }
      if (jm.arm_R) {
        jm.arm_R.wrx = jm.arm_R.rx - 2.35 - 0.55 * waveA;
        jm.arm_R.wrz = jm.arm_R.rz - 0.65 - 0.35 * waveB;
      }
    }

    // 6. Commit final pose to Three.js bone objects once per frame
    this._commitFastJoints(fastJoints);
    if (this.unitGroup?.userData?.bowstringRig) {
      updateBowstringRig(this.unitGroup);
    }
  }

  _applyKeyframeClip(clip, normT, weight, fastJointMap, restPoses = null) {
    const tracks = clip.tracks;
    if (!tracks) return;
    const isMounted = Boolean(
      this.isMountedUnit ||
      this.unitGroup?.userData?.isMounted ||
      this.unitGroup?.userData?.unitDef?.isMounted ||
      fastJointMap?.mount_torso
    );
    const isLowerLoco = clip.layer === "lowerBody";
    const keys = Object.keys(tracks);
    for (let i = 0; i < keys.length; i++) {
      const jointName = keys[i];
      // Never let lower-body locomotion clips (walk/run/charge/idle) swing a mounted rider's human legs!
      if (isMounted && isLowerLoco && /^(?:leg|shin|foot)_[RL]$/.test(jointName)) {
        continue;
      }
      const target = fastJointMap ? fastJointMap[jointName] : null;
      if (!target) continue;

      const sampled = sampleKeyframeTrackInto(tracks[jointName], normT, _sampleScratch);
      if (restPoses || target.isObject3D) {
        // Direct Three.js Object3D mode (used by 3D Studio _applyPoseAt)
        const rest = restPoses?.[jointName] || { pos: [0, 0, 0], rot: [0, 0, 0] };
        if (sampled.hasRot) {
          const targetRx = (rest.rot[0] || 0) + sampled.rx;
          const targetRy = (rest.rot[1] || 0) + sampled.ry;
          const targetRz = (rest.rot[2] || 0) + sampled.rz;
          target.rotation.set(
            target.rotation.x + (targetRx - target.rotation.x) * weight,
            target.rotation.y + (targetRy - target.rotation.y) * weight,
            target.rotation.z + (targetRz - target.rotation.z) * weight
          );
        }
        if (sampled.hasPos) {
          const targetPx = (rest.pos[0] || 0) + sampled.px;
          const targetPy = (rest.pos[1] || 0) + sampled.py;
          const targetPz = (rest.pos[2] || 0) + sampled.pz;
          target.position.set(
            target.position.x + (targetPx - target.position.x) * weight,
            target.position.y + (targetPy - target.position.y) * weight,
            target.position.z + (targetPz - target.position.z) * weight
          );
        }
      } else {
        // Fast float scratch mode (used in-game for 1,200+ units)
        if (sampled.hasRot) {
          const targetRx = target.rx + sampled.rx;
          const targetRy = target.ry + sampled.ry;
          const targetRz = target.rz + sampled.rz;
          target.wrx = target.wrx + (targetRx - target.wrx) * weight;
          target.wry = target.wry + (targetRy - target.wry) * weight;
          target.wrz = target.wrz + (targetRz - target.wrz) * weight;
        }
        if (sampled.hasPos) {
          const targetPx = target.px + sampled.px;
          const targetPy = target.py + sampled.py;
          const targetPz = target.pz + sampled.pz;
          target.wx = target.wx + (targetPx - target.wx) * weight;
          target.wy = target.wy + (targetPy - target.wy) * weight;
          target.wz = target.wz + (targetPz - target.wz) * weight;
        }
      }
    }

    // If this clip has a "release" event (e.g. shoot_bow), hide arrow_socket after the arrow is released!
    const arrowObj = restPoses
      ? fastJointMap?.arrow_socket
      : fastJointMap?.arrow_socket?.joint;
    if (arrowObj) {
      const dur = clip.duration || 0.85;
      const relEv = (clip.events || []).find((e) => e && e.type === "release" && Number.isFinite(e.time));
      if (relEv) {
        const relNorm = Math.max(0.05, Math.min(0.95, relEv.time / dur));
        arrowObj.visible = normT <= relNorm;
      } else {
        arrowObj.visible = true;
      }
    }
    if (this.unitGroup?.userData?.bowstringRig) {
      updateBowstringRig(this.unitGroup);
    }
  }
}
