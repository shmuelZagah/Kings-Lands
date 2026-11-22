import defaultBuildingVisuals from '../data/buildingVisuals.json';
import { sampleClipPose } from './keyframeSampler.js';
import { getCumulativeBuildingUpgradesAtLevel } from '../tools/units_buildings/buildingStudioAdapter.js';
import defaultBuildingsData from '../data/buildings.json';
/**
 * Kings Lands — 3D Building Actor Factory, Occluded Rings & Rally Flags
 * (src/render/buildingModelFactory.js)
 *
 * Refactored in Stage 4 & Optimized for High-Density Battles:
 * - Delegates building-specific procedural geometry to `src/render/buildingArchitectures.js`
 * - Merges static child meshes inside `bodyGroup` by shared material, reducing per-building WebGL
 *   draw calls from ~35-45 down to ~4-6 (and cutting shadow-pass draw calls by >85%).
 * - Merges `createOccludedDashedRingMesh` segments into a single BufferGeometry (1 draw call instead of 28).
 */

import * as THREE from 'three';
import { toFx, toFloat } from '../core/fx.js';
import { sampleTerrainHeightFx } from '../sim/gameState.js';
import {
  BUILDINGS_WITH_DOORS,
  addCourtyardGateFence,
  addBuildingDoorway,
  populateArchitectureByType
} from './buildingArchitectures.js';

const _tmpV = new THREE.Vector3();
const _tmpN = new THREE.Vector3();
const _tmpNormMat = new THREE.Matrix3();

/**
 * Merges all static child meshes inside `group` that share the same material into a single Mesh per material.
 * Preserves material references so `setBuildingSelectHighlight` and ghost opacity updates continue to work seamlessly.
 */
export function mergeStaticGroupMeshesByMaterial(group, { castShadow = true, receiveShadow = true } = {}) {
  group.updateMatrixWorld(true);

  const buckets = new Map();
  const meshesToRemove = [];

  group.traverse((child) => {
    if (!child.isMesh || !child.geometry || !child.material) return;
    const posAttr = child.geometry.attributes.position;
    if (!posAttr) return;
    let list = buckets.get(child.material);
    if (!list) {
      list = [];
      buckets.set(child.material, list);
    }
    list.push(child);
    meshesToRemove.push(child);
  });

  if (meshesToRemove.length <= 1) return;

  const mergedMeshes = [];
  for (const [mat, meshList] of buckets.entries()) {
    let totalVerts = 0;
    let totalIndices = 0;
    let anyCastShadow = false;
    let anyReceiveShadow = false;

    for (let i = 0; i < meshList.length; i++) {
      const m = meshList[i];
      const g = m.geometry;
      const p = g.attributes.position;
      totalVerts += p.count;
      totalIndices += g.index ? g.index.count : p.count;
      if (m.castShadow) anyCastShadow = true;
      if (m.receiveShadow) anyReceiveShadow = true;
    }

    if (totalVerts === 0) continue;

    const positions = new Float32Array(totalVerts * 3);
    const normals = new Float32Array(totalVerts * 3);
    const indices = totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

    let vOffset = 0;
    let iOffset = 0;

    for (let i = 0; i < meshList.length; i++) {
      const m = meshList[i];
      const g = m.geometry;
      const posAttr = g.attributes.position;
      const normAttr = g.attributes.normal;
      const idxAttr = g.index;
      const vCount = posAttr.count;

      const matWorld = m.matrixWorld;
      _tmpNormMat.getNormalMatrix(matWorld);

      for (let v = 0; v < vCount; v++) {
        const dst = (vOffset + v) * 3;
        _tmpV.fromBufferAttribute(posAttr, v).applyMatrix4(matWorld);
        positions[dst] = _tmpV.x;
        positions[dst + 1] = _tmpV.y;
        positions[dst + 2] = _tmpV.z;

        if (normAttr) {
          _tmpN.fromBufferAttribute(normAttr, v).applyMatrix3(_tmpNormMat).normalize();
          normals[dst] = _tmpN.x;
          normals[dst + 1] = _tmpN.y;
          normals[dst + 2] = _tmpN.z;
        } else {
          normals[dst] = 0;
          normals[dst + 1] = 1;
          normals[dst + 2] = 0;
        }
      }

      if (idxAttr) {
        const idxCount = idxAttr.count;
        for (let k = 0; k < idxCount; k++) {
          indices[iOffset + k] = idxAttr.getX(k) + vOffset;
        }
        iOffset += idxCount;
      } else {
        for (let k = 0; k < vCount; k++) {
          indices[iOffset + k] = vOffset + k;
        }
        iOffset += vCount;
      }

      vOffset += vCount;
    }

    const mergedGeom = new THREE.BufferGeometry();
    mergedGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    mergedGeom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    mergedGeom.setIndex(new THREE.BufferAttribute(indices, 1));
    mergedGeom.computeBoundingSphere();

    const mergedMesh = new THREE.Mesh(mergedGeom, mat);
    mergedMesh.castShadow = castShadow && anyCastShadow;
    mergedMesh.receiveShadow = receiveShadow && anyReceiveShadow;
    mergedMesh.matrixAutoUpdate = false;
    mergedMesh.updateMatrix();
    mergedMeshes.push(mergedMesh);
  }

  if (typeof group.clear === 'function') group.clear(); else if (Array.isArray(group.children)) group.children.length = 0;
  for (let i = 0; i < mergedMeshes.length; i++) {
    group.add(mergedMeshes[i]);
  }
}

export class BuildingModelFactory {
  constructor() {
    this._sharedMaterials = new Map();
  }

  _createActorMaterials(team = 1, isGhost = false, isAlly = false) {
    if (isGhost) {
      const ghostMat = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        roughness: 0.35,
        metalness: 0.15,
        transparent: true,
        opacity: 0.86
      });
      return {
        isGhost: true,
        ghostMat,
        stone: ghostMat,
        darkStone: ghostMat,
        whiteStone: ghostMat,
        wood: ghostMat,
        darkWood: ghostMat,
        teamRoof: ghostMat,
        gold: ghostMat,
        iron: ghostMat,
        thatch: ghostMat,
        ember: ghostMat,
        water: ghostMat,
        orbGlow: ghostMat,
        doorRecess: ghostMat,
        cloth: ghostMat,
        standardMats: []
      };
    }

    const teamColor = team === 1 ? 0x2563eb : isAlly ? 0x059669 : team === 3 ? 0xd97706 : team === 4 ? 0x7e22ce : 0xdc2626;
    const teamAccent = team === 1 ? 0x38bdf8 : isAlly ? 0x34d399 : team === 3 ? 0xfbbf24 : team === 4 ? 0xe879f9 : 0xf87171;

    const stone = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.82 });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.88 });
    const whiteStone = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.72 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.85 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x5c2808, roughness: 0.9 });
    const teamRoof = new THREE.MeshStandardMaterial({
      color: teamColor,
      roughness: 0.52,
      metalness: 0.12
    });
    const gold = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.32,
      metalness: 0.65
    });
    const iron = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.45,
      metalness: 0.7
    });
    const thatch = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.92 });

    return {
      isGhost: false,
      stone,
      darkStone,
      whiteStone,
      wood,
      darkWood,
      teamRoof,
      gold,
      iron,
      thatch,
      ember: new THREE.MeshBasicMaterial({ color: 0xf97316 }),
      water: new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        roughness: 0.15,
        metalness: 0.3,
        emissive: 0x0284c7,
        emissiveIntensity: 0.35
      }),
      orbGlow: new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        roughness: 0.1,
        metalness: 0.5,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.75
      }),
      doorRecess: new THREE.MeshBasicMaterial({ color: 0x090d16 }),
      cloth: new THREE.MeshStandardMaterial({
        color: teamAccent,
        roughness: 0.6,
        side: THREE.DoubleSide
      }),
      standardMats: [
        stone,
        darkStone,
        whiteStone,
        wood,
        darkWood,
        teamRoof,
        gold,
        iron,
        thatch
      ]
    };
  }

  createOccludedDashedRingMesh(
    radius,
    material,
    dashCount = 24,
    worldCenterX = null,
    worldCenterZ = null,
    centerGroundY = null
  ) {
    const ringGroup = new THREE.Group();
    const innerR = Math.max(0.8, radius * 0.97);
    const outerR = innerR + 0.13;
    const stepAngle = (Math.PI * 2) / dashCount;
    const arcSpan = stepAngle * 0.64;

    const hasWorldCoords =
      typeof worldCenterX === 'number' &&
      typeof worldCenterZ === 'number' &&
      typeof centerGroundY === 'number';

    for (let i = 0; i < dashCount; i++) {
      const startAngle = i * stepAngle;
      const midAngle = startAngle + arcSpan * 0.5;
      const segGeom = new THREE.RingGeometry(innerR, outerR, 6, 1, startAngle, arcSpan);
      segGeom.rotateX(-Math.PI * 0.5);
      const segMesh = new THREE.Mesh(segGeom, material);

      if (hasWorldCoords) {
        const sx = worldCenterX + Math.cos(midAngle) * innerR;
        const sz = worldCenterZ - Math.sin(midAngle) * innerR;
        const segGroundY = toFloat(sampleTerrainHeightFx(toFx(sx), toFx(sz), true));
        segMesh.position.y = segGroundY - centerGroundY + 0.22;
      }

      ringGroup.add(segMesh);
    }

    // Merge all 24-28 ring segments into a single draw call
    mergeStaticGroupMeshesByMaterial(ringGroup, { castShadow: false, receiveShadow: false });
    return ringGroup;
  }

  updateBuildingLiveState(actor, bldState, bDefOverride = null, dtSeconds = 0.016) {
    if (!actor || !bldState) return;
    if (typeof bDefOverride === "number") {
      dtSeconds = bDefOverride;
      bDefOverride = null;
    }
    const bDef = (bDefOverride && typeof bDefOverride === "object" ? bDefOverride : null) || defaultBuildingsData?.buildings?.[actor.type] || null;

    // 1. Recruitment / Door Open Animation (recruit_spawn)
    const shouldOpenDoor = Boolean(
      bldState.isDoorOpen ||
      (Array.isArray(bldState.activeDoorSpawns) && bldState.activeDoorSpawns.length > 0) ||
      (bldState.doorOpenTicks | 0) > 0
    );
    this.updateDoorAnimation(actor, shouldOpenDoor, dtSeconds);

    // 2. Cumulative Level Upgrades & Level-Up Celebration Animation
    const curLevel = Math.max(1, (bldState.level | 0) || 1);
    if (curLevel > (actor.lastRenderedLevel || 1)) {
      actor.levelUpAnimTimer = 1.1;
    }
    actor.lastRenderedLevel = curLevel;

    const cum = getCumulativeBuildingUpgradesAtLevel(bDef, curLevel);
    if (actor.levelBannersGroup) actor.levelBannersGroup.visible = Boolean(cum.banners);
    if (actor.levelTrimGroup) actor.levelTrimGroup.visible = Boolean(cum.trim);
    if (actor.levelBraziersGroup) actor.levelBraziersGroup.visible = Boolean(cum.braziers);
    if (actor.levelButtressesGroup) actor.levelButtressesGroup.visible = Boolean(cum.buttresses);
    if (actor.turretGroup) {
      actor.turretGroup.visible =
        Boolean(bldState.hasWatchtower) &&
        actor.type !== 'watchtower' &&
        actor.type !== 'ballista_tower';
    }

    // 3. Construction, Level-Up Pulse & Damage Stage Visuals
    const isComp = bldState.isCompleted !== undefined ? Boolean(bldState.isCompleted) : !bldState.isConstructing;
    const baseProgress = isComp
      ? 1.0
      : Math.max(0.12, (bldState.buildProgressPermille || 0) / 1000);
    let scaleXZ = 1.0;
    let scaleY = baseProgress;

    if ((actor.levelUpAnimTimer || 0) > 0) {
      actor.levelUpAnimTimer = Math.max(0, actor.levelUpAnimTimer - dtSeconds);
      const pulse = Math.sin(actor.levelUpAnimTimer * Math.PI * 2.5) * 0.09 * actor.levelUpAnimTimer;
      scaleXZ = 1.0 + pulse;
      scaleY = baseProgress * (1.0 + pulse * 1.3);
    }

    // Sample synchronized building keyframe animation from buildingVisuals.json / Studio edits
    const kfBag = defaultBuildingVisuals?.animations?.keyframes || {};
    const resolveBldClip = (clipBase) =>
      kfBag[`${actor.type}_human_${clipBase}`] ||
      kfBag[`${actor.type}_${clipBase}`] ||
      kfBag[`building_${clipBase}`] ||
      kfBag[clipBase] ||
      null;

    const hpRatio = (bldState.maxHp | 0) > 0 ? (bldState.hp || 0) / bldState.maxHp : 1.0;
    let activeClipBase = 'idle';
    let normT = 0;
    actor._animClock = ((actor._animClock || 0) + dtSeconds) % 60;

    if (!isComp) {
      activeClipBase = 'build_construct';
      normT = Math.max(0, Math.min(1, baseProgress));
    } else if (bldState.isVictoryCheer || bldState.playVictoryCheer) {
      activeClipBase = 'victory_cheer';
      const c = resolveBldClip('victory_cheer');
      const dur = Math.max(0.2, Number(c?.duration) || 1.4);
      normT = (actor._animClock % dur) / dur;
    } else if ((actor.levelUpAnimTimer || 0) > 0) {
      activeClipBase = 'level_up';
      normT = Math.max(0, Math.min(1, 1.0 - (actor.levelUpAnimTimer / 1.1)));
    } else if (hpRatio < 0.35) {
      activeClipBase = 'damage_stage_2';
      normT = 1.0;
    } else if (hpRatio < 0.7) {
      activeClipBase = 'damage_stage_1';
      normT = 1.0;
    } else {
      activeClipBase = 'idle';
      const c = resolveBldClip('idle');
      const dur = Math.max(0.2, Number(c?.duration) || 2.0);
      normT = (actor._animClock % dur) / dur;
    }

    const activeBldClip = resolveBldClip(activeClipBase);
    actor._activeClipKey = `building_${activeClipBase}`;
    const sampledPose = activeBldClip ? sampleClipPose(activeBldClip, normT) : null;

    if (actor.bodyGroup) {
      actor.bodyGroup.scale.set(scaleXZ, scaleY, scaleXZ);
      const tPos = sampledPose?.torso?.pos || [0, 0, 0];
      const tRot = sampledPose?.torso?.rot || [0, 0, 0];
      const pRot = sampledPose?.pelvis?.rot || [0, 0, 0];
      actor.bodyGroup.position.set(tPos[0] || 0, Math.max(0, tPos[1] || 0), tPos[2] || 0);
      actor.bodyGroup.rotation.set(
        (tRot[0] || 0) + (pRot[0] || 0),
        (tRot[1] || 0) + (pRot[1] || 0),
        (tRot[2] || 0) + (pRot[2] || 0)
      );
      if (!sampledPose && bldState.isCompleted) {
        if (hpRatio < 0.35) {
          actor.bodyGroup.rotation.z = 0.045;
          actor.bodyGroup.rotation.x = 0.03;
        } else if (hpRatio < 0.7) {
          actor.bodyGroup.rotation.z = 0.02;
          actor.bodyGroup.rotation.x = 0.01;
        }
      }
    }

    // Also sync recruit_spawn door leaf rotations if customized in Studio
    if (shouldOpenDoor) {
      const doorClip = resolveBldClip('recruit_spawn');
      if (doorClip && (doorClip.tracks?.arm_L || doorClip.tracks?.arm_R)) {
        const doorPose = sampleClipPose(doorClip, 0.5);
        if (actor.doorLeafL && doorPose?.arm_L?.rot) {
          actor.doorLeafL.rotation.y = doorPose.arm_L.rot[1] * actor.doorOpenAmount;
        }
        if (actor.doorLeafR && doorPose?.arm_R?.rot) {
          actor.doorLeafR.rotation.y = doorPose.arm_R.rot[1] * actor.doorOpenAmount;
        }
      }
    }
  }

  updateDoorAnimation(actor, isOpen = false, dtSeconds = 0.016) {
    if (!actor) return;
    const targetOpen = isOpen ? 1.0 : 0.0;
    const currentOpen = Number(actor.doorOpenAmount || 0);
    const step = Math.min(1, Math.max(0.05, dtSeconds * 8.0));
    actor.doorOpenAmount = Math.abs(targetOpen - currentOpen) < 0.01
      ? targetOpen
      : currentOpen + (targetOpen - currentOpen) * step;
    const targetRot = 0.18 + actor.doorOpenAmount * (1.35 - 0.18);
    if (actor.doorLeafL) {
      actor.doorLeafL.rotation.y = -targetRot;
      actor.doorLeafL.updateMatrixWorld?.(true);
    }
    if (actor.doorLeafR) {
      actor.doorLeafR.rotation.y = targetRot;
      actor.doorLeafR.updateMatrixWorld?.(true);
    }
  }

  setBuildingSelectHighlight(actor, intensity = 0) {
    const mats = actor?.standardMats;
    if (!Array.isArray(mats)) return;
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (intensity > 0.001) {
        m.emissive.setHex(0xfef08a);
        m.emissiveIntensity = intensity * 0.38;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  }

  createBuildingActor(bld, options = {}) {
    const isGhost = Boolean(options.isGhost);
    const type = bld.type || 'barracks';
    const r = bld.footprintRadiusMeters || 5;
    const mats = this._createActorMaterials(bld.team || 1, isGhost, Boolean(options?.isAlly));

    const group = new THREE.Group();
    group.name = `Building_${type}`;

    if (type === 'citadel_slot') {
      const slotPad = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.92, r * 0.98, 0.24, 20),
        mats.darkStone
      );
      slotPad.position.y = 0.12;
      slotPad.receiveShadow = !isGhost;
      group.add(slotPad);
    }

    const doorSign = 1;
    const bodyGroup = new THREE.Group();
    populateArchitectureByType(type, r, mats, bodyGroup, doorSign);

    let doorLeaves = null;
    if (BUILDINGS_WITH_DOORS.has(type)) {
      doorLeaves = addBuildingDoorway(bodyGroup, r, mats, doorSign, type);
    }

    addCourtyardGateFence(bodyGroup, type, r, mats, doorSign);

    if (!isGhost) {
      bodyGroup.traverse((child) => {
        if (child.isMesh) {
          // Only cast shadows from primary structural materials (stone, wood, roof, thatch)
          const m = child.material;
          child.castShadow =
            m === mats.stone ||
            m === mats.darkStone ||
            m === mats.whiteStone ||
            m === mats.wood ||
            m === mats.teamRoof ||
            m === mats.thatch;
          child.receiveShadow = true;
        }
      });
    }

    // Merge all static architecture parts sharing the same material (~38 meshes -> ~5 meshes per building)
    mergeStaticGroupMeshesByMaterial(bodyGroup, {
      castShadow: !isGhost,
      receiveShadow: !isGhost
    });

    if (doorLeaves?.doorLeafL) bodyGroup.add(doorLeaves.doorLeafL);
    if (doorLeaves?.doorLeafR) bodyGroup.add(doorLeaves.doorLeafR);
    group.add(bodyGroup);

    const flashRingMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      depthTest: true,
      depthWrite: false
    });
    const flashRingGroup = this.createOccludedDashedRingMesh(
      r * 1.06,
      flashRingMat,
      28,
      bld.x,
      bld.z,
      bld.y
    );
    if (typeof bld.x !== 'number') {
      flashRingGroup.position.y = 0.32;
    }
    flashRingGroup.visible = false;
    group.add(flashRingGroup);

    const turretGroup = new THREE.Group();
    const towerX = r * 0.56;
    const towerZ = -doorSign * r * 0.52;
    const towerShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.35, 8.2, 8),
      mats.stone
    );
    towerShaft.position.set(towerX, 4.1, towerZ);
    turretGroup.add(towerShaft);

    const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(1.65, 2.5, 8), mats.teamRoof);
    towerRoof.position.set(towerX, 9.4, towerZ);
    turretGroup.add(towerRoof);

    const bDef = defaultBuildingsData?.buildings?.[type] || null;
    const initLevel = Math.max(1, (bld.level | 0) || 1);
    const initCum = getCumulativeBuildingUpgradesAtLevel(bDef, initLevel);
    const hBody = type === 'citadel' ? 7.2 : 4.6;

    // Cumulative Level Feature 1: Royal Banners & Flags (typically unlocked at Lv.2 and kept at Lv.3+)
    const levelBannersGroup = new THREE.Group();
    levelBannersGroup.name = 'level_banners';
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 6), mats.gold);
      pole.position.set(side * (r * 0.52), hBody * 0.72, doorSign * (r * 0.62));
      levelBannersGroup.add(pole);
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.35, 0.04), mats.cloth);
      cloth.position.set(side * (r * 0.52), hBody * 0.65, doorSign * (r * 0.66));
      levelBannersGroup.add(cloth);
    }
    levelBannersGroup.visible = !isGhost && Boolean(initCum.banners);
    group.add(levelBannersGroup);

    // Cumulative Level Feature 2: Gilded Roof & Crest Trim (typically unlocked at Lv.3 and kept at Lv.4+)
    const levelTrimGroup = new THREE.Group();
    levelTrimGroup.name = 'level_trim';
    const spireCrest = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), mats.gold);
    spireCrest.position.set(0, hBody + 2.4, 0);
    levelTrimGroup.add(spireCrest);
    const trimRing = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.68, r * 0.72, 0.24, 8), mats.gold);
    trimRing.position.set(0, hBody + 0.15, 0);
    levelTrimGroup.add(trimRing);
    levelTrimGroup.visible = !isGhost && Boolean(initCum.trim);
    group.add(levelTrimGroup);

    // Cumulative Level Feature 3: Entrance War Braziers
    const levelBraziersGroup = new THREE.Group();
    levelBraziersGroup.name = 'level_braziers';
    for (const side of [-1, 1]) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.22, 0.75, 8), mats.iron);
      bowl.position.set(side * 1.65, 0.4, doorSign * (r * 0.78));
      levelBraziersGroup.add(bowl);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.65, 6), mats.ember);
      flame.position.set(side * 1.65, 0.95, doorSign * (r * 0.78));
      levelBraziersGroup.add(flame);
    }
    levelBraziersGroup.visible = !isGhost && Boolean(initCum.braziers);
    group.add(levelBraziersGroup);

    // Cumulative Level Feature 4: Reinforced Stone Buttresses
    const levelButtressesGroup = new THREE.Group();
    levelButtressesGroup.name = 'level_buttresses';
    for (const [bx, bz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.65, hBody * 0.85, 0.65), mats.whiteStone);
      pil.position.set(bx * (r * 0.64), hBody * 0.42, bz * (r * 0.58));
      levelButtressesGroup.add(pil);
    }
    levelButtressesGroup.visible = !isGhost && Boolean(initCum.buttresses);
    group.add(levelButtressesGroup);

    turretGroup.visible =
      !isGhost &&
      Boolean(bld.hasWatchtower) &&
      type !== 'watchtower' &&
      type !== 'ballista_tower';
    group.add(turretGroup);

    const scaffoldGroup = new THREE.Group();
    let progressBarFill = null;
    const h = type === 'citadel' ? 8.5 : 5.2;

    if (!isGhost && type !== 'citadel_slot') {
      const polesGroup = new THREE.Group();
      const corners = [
        [-r * 0.65, -r * 0.55],
        [r * 0.65, -r * 0.55],
        [-r * 0.65, r * 0.55],
        [r * 0.65, r * 0.55]
      ];
      for (let c = 0; c < corners.length; c++) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.12, h + 1.2, 6),
          mats.wood
        );
        pole.position.set(corners[c][0], (h + 1.2) * 0.5, corners[c][1]);
        polesGroup.add(pole);
      }
      mergeStaticGroupMeshesByMaterial(polesGroup, { castShadow: false, receiveShadow: false });
      scaffoldGroup.add(polesGroup);

      const barWidth = Math.max(4.5, r * 1.1);
      const barBg = new THREE.Mesh(
        new THREE.BoxGeometry(barWidth, 0.42, 0.25),
        new THREE.MeshBasicMaterial({ color: 0x0f172a })
      );
      barBg.position.set(0, h + 2.6, 0);
      scaffoldGroup.add(barBg);

      progressBarFill = new THREE.Mesh(
        new THREE.BoxGeometry(barWidth - 0.16, 0.28, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x22c55e })
      );
      progressBarFill.position.set(0, h + 2.6, 0);
      scaffoldGroup.add(progressBarFill);
    }

    scaffoldGroup.visible = !isGhost && !bld.isCompleted && type !== 'citadel_slot';
    group.add(scaffoldGroup);

    const hpBarGroup = new THREE.Group();
    let hpBarFill = null;
    if (!isGhost && type !== 'citadel_slot') {
      const hpBarWidth = Math.max(4.8, r * 1.15);
      const hpBg = new THREE.Mesh(
        new THREE.BoxGeometry(hpBarWidth, 0.46, 0.26),
        new THREE.MeshBasicMaterial({ color: 0x0f172a })
      );
      hpBg.position.set(0, h + 4.8, 0);
      hpBarGroup.add(hpBg);

      hpBarFill = new THREE.Mesh(
        new THREE.BoxGeometry(hpBarWidth - 0.16, 0.32, 0.32),
        new THREE.MeshBasicMaterial({ color: 0x22c55e })
      );
      hpBarFill.position.set(0, h + 4.8, 0);
      hpBarGroup.add(hpBarFill);
    }
    hpBarGroup.visible = false;
    group.add(hpBarGroup);

    return {
      group,
      bodyGroup,
      doorLeafL: doorLeaves?.doorLeafL || null,
      doorLeafR: doorLeaves?.doorLeafR || null,
      levelBannersGroup,
      levelTrimGroup,
      levelBraziersGroup,
      levelButtressesGroup,
      lastRenderedLevel: initLevel,
      levelUpAnimTimer: 0,
      turretGroup,
      scaffoldGroup,
      progressBarFill,
      hpBarGroup,
      hpBarFill,
      flashRingGroup,
      flashRingMat,
      flashTimer: 0,
      selectFlashTimer: 0,
      standardMats: mats.standardMats,
      type,
      ghostMat: mats.ghostMat || null
    };
  }

  createMineOutcropMesh(mine) {
    const resType = mine.resourceType;
    const isIron = resType === 'iron';
    const isGold = resType === 'coins';
    const group = new THREE.Group();
    group.name = `Mine_${resType}_${mine.id}`;

    const rockMat = new THREE.MeshStandardMaterial({
      color: isIron ? 0x334155 : isGold ? 0x57534e : 0x94a3b8,
      roughness: 0.78,
      metalness: isIron ? 0.45 : 0.15
    });
    const veinMat = new THREE.MeshStandardMaterial({
      color: isGold ? 0xfbbf24 : isIron ? 0x38bdf8 : 0xe2e8f0,
      roughness: 0.22,
      metalness: 0.85,
      emissive: isGold ? 0xb45309 : isIron ? 0x0284c7 : 0x475569,
      emissiveIntensity: 0.28
    });

    const baseMound = new THREE.Mesh(new THREE.DodecahedronGeometry(3.2, 1), rockMat);
    baseMound.scale.set(1.2, 0.75, 1.1);
    baseMound.position.y = 1.2;
    baseMound.castShadow = true;
    baseMound.receiveShadow = true;
    group.add(baseMound);

    for (let c = 0; c < 5; c++) {
      const angle = (c / 5) * Math.PI * 2;
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.95, 0), veinMat);
      crystal.scale.set(0.7, 1.6, 0.7);
      crystal.position.set(Math.cos(angle) * 1.6, 2.1, Math.sin(angle) * 1.6);
      crystal.rotation.set(Math.sin(angle) * 0.35, angle, Math.cos(angle) * 0.35);
      crystal.castShadow = false;
      group.add(crystal);
    }

    mergeStaticGroupMeshesByMaterial(group, { castShadow: true, receiveShadow: true });
    return group;
  }

  createRallyFlagMesh() {
    const group = new THREE.Group();
    group.name = 'BuildingRallyPointFlag';
    group.visible = false;

    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      metalness: 0.7,
      roughness: 0.3
    });
    const flagMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide
    });

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8), poleMat);
    pole.position.y = 2.1;
    group.add(pole);

    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), poleMat);
    finial.position.y = 4.3;
    group.add(finial);

    const pennant = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.95), flagMat);
    pennant.position.set(0.82, 3.65, 0);
    group.add(pennant);

    return group;
  }
}