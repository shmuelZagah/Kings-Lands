import * as THREE from 'three';
import { ANGLE_STEPS, ANGLE_MASK, TICKS_PER_SEC, toFx, toFloat } from '../core/fx.js';
import { AnimState, IndexToUnitType, sampleTerrainHeightFx, sampleTerrainMeshHeightMeters } from '../sim/gameState.js';
import { FowState, FOW_GRID_SIZE } from '../sim/systems/moraleStaminaSystem.js';
import { Animator3D, isTrackEffectivelyAnimated } from './animator3d.js';
import { updateBowstringRig } from './modelFactory.js';
import { FACTION_TEAM_COLORS, applySkinColors } from '../tools/studio/skinUtils.js';
import {
  resolveClip,
  resolveClipVariants,
  resolveIdleClip,
  resolveLocomotionClip,
  getCombatBase,
  getLocomotionBase
} from '../tools/studio/clipResolver.js';
import {
  INITIAL_BATCH_CAPACITY,
  CORE_ANIMATED_BONES,
  SHADOW_CASTING_BONES,
  shouldCullOccludedBodyMesh,
  mergeBakedJointGeometry,
  InstancedPartBatch
} from './unitInstancingBatcher.js';

export {
  INITIAL_BATCH_CAPACITY,
  CORE_ANIMATED_BONES,
  SHADOW_CASTING_BONES,
  shouldCullOccludedBodyMesh,
  mergeBakedJointGeometry,
  InstancedPartBatch
};

const _tmpInvJointMat = new THREE.Matrix4();

/** Unit height in screen pixels below which LOD1 / LOD2 are used (models that carry unitDef.lods). */
export const LOD_PIXEL_THRESHOLDS = [90, 24];

export class UnitRenderer {
  constructor({ scene, camera, modelFactory, animationsData, onAnimatorEvent, simBridge = null }) {
    this.scene = scene;
    this.camera = camera;
    this.modelFactory = modelFactory;
    this.animationsData = animationsData;
    this.onAnimatorEvent = onAnimatorEvent;
    this.simBridge = simBridge;

    this.unitsGroup = new THREE.Group();
    this.unitsGroup.name = 'UnitsGroup';
    this.scene.add(this.unitsGroup);

    this.unitActors = new Map();
    this.actorPool = new Map();
    this._activeEntityIds = new Set();

    this._instancedBatches = new Map();
    this._bakedJointTemplates = new Map();
    this._lodTemplates = new Map();   // `${team}:${visualId}` → { [lod]: [{ jointName, batch }] }  (units that carry unitDef.lods)
    this._skeletonTemplates = new Map();
    this._sharedRingMats = new Map();
    this._frameTick = 0;

    this._animatedBones = new Set(CORE_ANIMATED_BONES);
    for (const clip of Object.values(this.animationsData?.keyframes || {})) {
      for (const [trackBone, keyframes] of Object.entries(clip?.tracks || {})) {
        if (!/^(?:index|middle|ring|pinky|thumb)/.test(trackBone) && isTrackEffectivelyAnimated(keyframes)) {
          this._animatedBones.add(trackBone);
        }
      }
    }

    const attachMatPropsShader = (mat, cacheKey) => {
      mat.customProgramCacheKey = () => cacheKey;
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nattribute vec2 matProps;\nvarying vec2 vMatProps;"
          )
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvMatProps = matProps;"
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec2 vMatProps;"
          )
          .replace(
            "#include <roughnessmap_fragment>",
            "#include <roughnessmap_fragment>\nroughnessFactor = vMatProps.x;"
          )
          .replace(
            "#include <metalnessmap_fragment>",
            "#include <metalnessmap_fragment>\nmetalnessFactor = vMatProps.y;"
          );
      };
    };

    this._bakedUnitMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1.0,
      metalness: 1.0
    });
    attachMatPropsShader(this._bakedUnitMat, "kings_lands_baked_unit_mat_v2");

    this._bloodlustCrimsonMat = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      emissive: new THREE.Color(0xdc2626),
      emissiveIntensity: 0.72,
      vertexColors: true,
      roughness: 1.0,
      metalness: 1.0
    });
    attachMatPropsShader(this._bloodlustCrimsonMat, "kings_lands_bloodlust_crimson_mat_v1");

    this._azureFuryMat = new THREE.MeshStandardMaterial({
      color: 0x93c5fd,
      emissive: new THREE.Color(0x0284c7),
      emissiveIntensity: 0.68,
      vertexColors: true,
      roughness: 1.0,
      metalness: 1.0
    });
    attachMatPropsShader(this._azureFuryMat, "kings_lands_azure_fury_mat_v1");


    this._whiteBannerClothMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.05
    });
    this._darkBannerInkMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.88,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });

    const auraRingGeom = new THREE.RingGeometry(0.42, 0.78, 16);
    auraRingGeom.rotateX(-Math.PI * 0.5);

    this._bannerAuraMat = new THREE.MeshBasicMaterial({
      color: 0xd97706,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.44,
      depthWrite: false
    });
    this._bannerAuraBatch = new InstancedPartBatch(
      'phase6_banner_aura_ring',
      auraRingGeom,
      this._bannerAuraMat,
      false,
      false,
      true,
      this.unitsGroup
    );

    this._healingAuraMat = new THREE.MeshBasicMaterial({
      color: 0x2dd4bf,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });
    this._healingAuraBatch = new InstancedPartBatch(
      'phase6_healing_aura_ring',
      auraRingGeom,
      this._healingAuraMat,
      false,
      false,
      true,
      this.unitsGroup
    );

    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();
    this._boundSphere = new THREE.Sphere(new THREE.Vector3(), 6.5);
    this._worldMatScratch = new THREE.Matrix4();
    this._auraScaleMat = new THREE.Matrix4();

    this.prewarmPool();
  }

  prewarmPool() {
    const prewarmCounts = [
      { unitTypeIdx: 0, count: 6 },
      { unitTypeIdx: 1, count: 32 },
      { unitTypeIdx: 2, count: 32 },
      { unitTypeIdx: 3, count: 32 },
      { unitTypeIdx: 4, count: 24 }
    ];

    let dummyId = 900000;
    for (const team of [1, 2]) {
      for (const { unitTypeIdx, count } of prewarmCounts) {
        const visualId = IndexToUnitType[unitTypeIdx];
        if (!this.modelFactory?.visualsData?.units?.[visualId]) continue;
        const actors = [];
        for (let i = 0; i < count; i++) {
          const act = this._acquireUnitActor({
            id: dummyId++,
            team,
            unitTypeIdx,
            role: i === 0 ? 1 : 0,
            hp: 100
          });
          actors.push(act);
        }
        for (let i = 0; i < actors.length; i++) {
          this._releaseUnitActor(actors[i]);
        }
      }
    }
  }

  _getPoolKey(team, visualId) {
    return `${team | 0}:${visualId}`;
  }

  _getSharedRingMaterial(teamId) {
    const key = teamId | 0;
    let mat = this._sharedRingMats.get(key);
    if (!mat) {
      const palette = this.modelFactory.getTeamPalette(key);
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(palette.primary),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: key === 1 ? 0.92 : 0.82,
        depthWrite: false
      });
      this._sharedRingMats.set(key, mat);
    }
    return mat;
  }

  _getOrCreateBatch(geometry, material, castShadow, receiveShadow, isRing) {
    const key = `${geometry.uuid}:${material.uuid}:${castShadow ? 1 : 0}:${receiveShadow ? 1 : 0}:${isRing ? 1 : 0}`;
    let batch = this._instancedBatches.get(key);
    if (!batch) {
      batch = new InstancedPartBatch(
        key,
        geometry,
        material,
        castShadow,
        receiveShadow,
        isRing,
        this.unitsGroup
      );
      this._instancedBatches.set(key, batch);
    }
    return batch;
  }

  _classifyMeshCategory(mesh) {
    if (mesh.name === 'selection_ring') return 'ring';
    let curr = mesh.parent;
    while (curr) {
      const nm = curr.name;
      if (nm === 'company_banner') return 'banner';
      if (nm === 'carry_wood') return 'carry_1';
      if (nm === 'carry_gold') return 'carry_2';
      if (nm === 'carry_iron') return 'carry_3';
      if (nm === 'carry_stone') return 'carry_4';
      curr = curr.parent;
    }
    return 'body';
  }

  _findAnimatedAncestorJoint(mesh, rootGroup) {
    let curr = mesh.parent;
    while (curr && curr !== rootGroup) {
      if (this._animatedBones.has(curr.name)) {
        return curr;
      }
      curr = curr.parent;
    }
    return rootGroup;
  }

  _createActorGroupFromSkeletonTemplate(templateKey) {
    const tpl = this._skeletonTemplates.get(templateKey);
    const baked = this._bakedJointTemplates.get(templateKey);
    if (!tpl || !baked) return null;

    const group = tpl.group.clone(true);
    const sockets = {};
    const restPoses = {};

    group.traverse((node) => {
      if (node !== group && node.name) {
        sockets[node.name] = node;
        const srcRest = tpl.restPoses[node.name];
        if (srcRest) {
          restPoses[node.name] = {
            pos: [srcRest.pos[0], srcRest.pos[1], srcRest.pos[2]],
            rot: [srcRest.rot[0], srcRest.rot[1], srcRest.rot[2]]
          };
        }
      }
    });

    group.userData = {
      unitDef: tpl.unitDef,
      sockets,
      restPoses
    };

    const resolveParent = (parentName) =>
      parentName === '__root__' ? group : sockets[parentName] || group;

    const bodyEntries = [];
    for (const [jointName, batchSpecs] of baked.jointBatches.entries()) {
      const jointGroup = resolveParent(jointName);
      if (!jointGroup) continue;
      for (let i = 0; i < batchSpecs.length; i++) {
        const spec = batchSpecs[i];
        bodyEntries.push({
          parent: jointGroup,
          jointName,
          localMatrix: spec.localMatrix,
          batch: spec.batch,
          cachedWorldMatrix: new THREE.Matrix4()
        });
      }
    }

    const bannerEntries = baked.bannerSpecs.map((sp) => ({
      parent: resolveParent(sp.parentName),
      localMatrix: sp.localMatrix,
      batch: sp.batch,
      routingBatch: sp.routingBatch,
      cachedWorldMatrix: new THREE.Matrix4()
    }));

    const carryEntriesByType = { 1: [], 2: [], 3: [], 4: [] };
    for (const cType of [1, 2, 3, 4]) {
      const specs = baked.carrySpecs[cType] || [];
      carryEntriesByType[cType] = specs.map((sp) => ({
        parent: resolveParent(sp.parentName),
        localMatrix: sp.localMatrix,
        batch: sp.batch,
        routingBatch: null,
        cachedWorldMatrix: new THREE.Matrix4()
      }));
    }

    const ringEntry = baked.ringSpec
      ? {
          parent: resolveParent(baked.ringSpec.parentName),
          localMatrix: baked.ringSpec.localMatrix,
          batch: baked.ringSpec.batch,
          routingBatch: null,
          cachedWorldMatrix: new THREE.Matrix4()
        }
      : null;

    return {
      group,
      extracted: {
        bodyEntries,
        bannerEntries,
        carryEntriesByType,
        ringEntry
      }
    };
  }

  /**
   * LOD for imported / heavy models: `unitDef.lods[k][joint] = [meshDef]` holds lighter geometry for the SAME joints.
   * Returns { [lod]: [{ batch, src }] } where `src` is the LOD0 body entry of that joint, whose cachedWorldMatrix is shared
   * (so the skeleton is stepped once, whichever LOD is drawn). null when the unit has no lods.
   */
  _buildLodEntries(visualId, teamId, group, bodyEntries) {
    const unitDef = group.userData?.unitDef;
    const lods = unitDef?.lods;
    if (!lods || !bodyEntries) return null;
    const key = `${teamId | 0}:${visualId}`;
    let specs = this._lodTemplates.get(key);
    if (!specs) {
      specs = {};
      const palette = this.modelFactory.getTeamPalette(teamId);
      for (const lodKey of Object.keys(lods)) {
        const list = [];
        for (const [jointName, partDefs] of Object.entries(lods[lodKey] || {})) {
          const items = [];
          for (const pd of partDefs) {
            const mesh = this.modelFactory.adapter.createPrimitiveMesh(pd, palette);
            items.push({
              geom: mesh.geometry, relMatrix: new THREE.Matrix4(), color: mesh.material.color,
              roughness: mesh.material.roughness ?? 0.65, metalness: mesh.material.metalness ?? 0.2
            });
          }
          const merged = mergeBakedJointGeometry(items);
          if (merged) list.push({ jointName, batch: this._getOrCreateBatch(merged, this._bakedUnitMat, SHADOW_CASTING_BONES.has(jointName), false, false) });
        }
        specs[lodKey] = list;
      }
      this._lodTemplates.set(key, specs);
    }
    const byJoint = new Map();
    for (const e of bodyEntries) if (!e.localMatrix && !byJoint.has(e.jointName)) byJoint.set(e.jointName, e);
    const out = {};
    for (const lodKey of Object.keys(specs)) {
      out[lodKey] = specs[lodKey].map((sp) => ({ batch: sp.batch, src: byJoint.get(sp.jointName) })).filter((x) => x.src);
    }
    return out;
  }

  /** Screen-height based LOD with hysteresis: LOD0 when the unit is tall on screen, LOD2 when it is a few pixels. */
  _pickLod(actor, x, y, z) {
    const cam = this.camera;
    const dx = cam.position.x - x, dy = cam.position.y - y, dz = cam.position.z - z;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
    const viewH = (typeof window !== 'undefined' ? window.innerHeight : 0) || 1080;
    const projScale = viewH / (2 * Math.tan(((cam.fov || 45) * Math.PI) / 360));
    const px = (actor.lodHeight || 2) * projScale / dist;
    const t = LOD_PIXEL_THRESHOLDS, cur = actor.lod | 0;
    let lod = px >= t[0] ? 0 : px >= t[1] ? 1 : 2;
    if (lod !== cur) { // hysteresis: only change when clearly past the threshold
      const edge = cur < lod ? (lod === 1 ? t[0] : t[1]) : (cur === 1 ? t[0] : t[1]);
      if (Math.abs(px - edge) < edge * 0.12) lod = cur;
    }
    return lod;
  }

  _extractMeshEntriesFromRig(group, teamId, visualId) {
    const unitDef = group.userData?.unitDef;
    if (unitDef) {
      applySkinColors(group, unitDef, unitDef.race || 'human');
    }
    group.updateMatrixWorld(true);

    const equipMap = unitDef?.equipment || null;
    const rawMeshes = [];
    group.traverse((child) => {
      if (child.isMesh && child.geometry && child.material) {
        rawMeshes.push(child);
      }
    });

    const bannerEntries = [];
    const bannerSpecs = [];
    const carryEntriesByType = { 1: [], 2: [], 3: [], 4: [] };
    const carrySpecs = { 1: [], 2: [], 3: [], 4: [] };
    let ringEntry = null;
    let ringSpec = null;

    const bodyMeshesByJoint = new Map();
    const getParentKey = (p) => (!p || p === group ? '__root__' : p.name || '__root__');

    for (let i = 0; i < rawMeshes.length; i++) {
      const mesh = rawMeshes[i];
      const parent = mesh.parent;
      if (!parent) continue;

      mesh.updateMatrix();
      const category = this._classifyMeshCategory(mesh);
      const isRing = category === 'ring';

      if (isRing) {
        const mat = this._getSharedRingMaterial(teamId);
        const batch = this._getOrCreateBatch(mesh.geometry, mat, false, false, true);
        const localMat = mesh.matrix.clone();
        ringEntry = {
          parent: group,
          localMatrix: localMat,
          batch,
          routingBatch: null,
          cachedWorldMatrix: new THREE.Matrix4()
        };
        ringSpec = { parentName: '__root__', localMatrix: localMat, batch };
        parent.remove(mesh);
        continue;
      }

      const jointGroup = this._findAnimatedAncestorJoint(mesh, group);
      _tmpInvJointMat.copy(jointGroup.matrixWorld).invert();
      const relMatrix = new THREE.Matrix4().multiplyMatrices(_tmpInvJointMat, mesh.matrixWorld);

      if (category === 'banner') {
        const batch = this._getOrCreateBatch(
          mesh.geometry,
          mesh.material,
          false,
          false,
          false
        );
        let routingBatch = null;
        if (mesh.name === 'banner_cloth') {
          routingBatch = this._getOrCreateBatch(
            mesh.geometry,
            this._whiteBannerClothMat,
            false,
            false,
            false
          );
        } else if (mesh.name && mesh.name.startsWith('ink_')) {
          routingBatch = this._getOrCreateBatch(
            mesh.geometry,
            this._darkBannerInkMat,
            false,
            false,
            false
          );
        }
        bannerEntries.push({
          parent: jointGroup,
          localMatrix: relMatrix,
          batch,
          routingBatch,
          cachedWorldMatrix: new THREE.Matrix4()
        });
        bannerSpecs.push({
          parentName: getParentKey(jointGroup),
          localMatrix: relMatrix,
          batch,
          routingBatch
        });
        parent.remove(mesh);
        continue;
      }

      if (category.startsWith('carry_')) {
        const cType = Number(category.slice(6)) | 0;
        if (carryEntriesByType[cType]) {
          const batch = this._getOrCreateBatch(
            mesh.geometry,
            mesh.material,
            false,
            false,
            false
          );
          carryEntriesByType[cType].push({
            parent: jointGroup,
            localMatrix: relMatrix,
            batch,
            routingBatch: null,
            cachedWorldMatrix: new THREE.Matrix4()
          });
          carrySpecs[cType].push({
            parentName: getParentKey(jointGroup),
            localMatrix: relMatrix,
            batch
          });
        }
        parent.remove(mesh);
        continue;
      }

      if (mesh.visible === false || shouldCullOccludedBodyMesh(mesh, equipMap)) {
        parent.remove(mesh);
        continue;
      }

      let list = bodyMeshesByJoint.get(jointGroup);
      if (!list) {
        list = [];
        bodyMeshesByJoint.set(jointGroup, list);
      }

      list.push({
        mesh,
        geom: mesh.geometry,
        mat: mesh.material,
        relMatrix,
        color: mesh.material.color,
        roughness: mesh.material.roughness ?? 0.65,
        metalness: mesh.material.metalness ?? 0.2
      });

      parent.remove(mesh);
    }

    const templateKey = `${teamId | 0}:${visualId}`;
    let baked = this._bakedJointTemplates.get(templateKey);

    if (!baked) {
      const jointBatches = new Map();
      for (const [jointGroup, items] of bodyMeshesByJoint.entries()) {
        const jointName = getParentKey(jointGroup);
        const solidItems = [];
        const texturedItems = [];

        for (let k = 0; k < items.length; k++) {
          const it = items[k];
          if (it.mat.map) {
            texturedItems.push(it);
          } else {
            solidItems.push(it);
          }
        }

        const batchesForJoint = [];
        const shouldCastShadow = SHADOW_CASTING_BONES.has(jointName);

        if (solidItems.length > 0) {
          const mergedGeom = mergeBakedJointGeometry(solidItems);
          if (mergedGeom) {
            const batch = this._getOrCreateBatch(
              mergedGeom,
              this._bakedUnitMat,
              shouldCastShadow,
              false,
              false
            );
            batchesForJoint.push({ batch, localMatrix: null });
          }
        }

        for (let t = 0; t < texturedItems.length; t++) {
          const it = texturedItems[t];
          const batch = this._getOrCreateBatch(it.geom, it.mat, shouldCastShadow, false, false);
          batchesForJoint.push({ batch, localMatrix: it.relMatrix });
        }

        jointBatches.set(jointName, batchesForJoint);
      }

      baked = {
        jointBatches,
        bannerSpecs,
        carrySpecs,
        ringSpec
      };
      this._bakedJointTemplates.set(templateKey, baked);
    }

    const bodyEntries = [];
    const socketsMap = group.userData?.sockets || {};
    for (const [jointName, batchSpecs] of baked.jointBatches.entries()) {
      const jointGroup =
        jointName === '__root__' ? group : socketsMap[jointName] || (group.name === jointName ? group : null);
      if (!jointGroup) continue;
      for (let i = 0; i < batchSpecs.length; i++) {
        const spec = batchSpecs[i];
        bodyEntries.push({
          parent: jointGroup,
          jointName,
          localMatrix: spec.localMatrix,
          batch: spec.batch,
          cachedWorldMatrix: new THREE.Matrix4()
        });
      }
    }

    const restPosesMap = group.userData?.restPoses || {};
    const pruneStaticChildren = (node) => {
      if (!node || !node.children) return;
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        pruneStaticChildren(child);
        const cname = child.name || '';
        const isNeededBone = this._animatedBones.has(cname) || child.children.length > 0;
        if (!isNeededBone) {
          node.remove(child);
          delete socketsMap[cname];
          delete restPosesMap[cname];
        }
      }
    };
    pruneStaticChildren(group);

    if (!this._skeletonTemplates.has(templateKey)) {
      const clonedRest = {};
      for (const [k, v] of Object.entries(restPosesMap)) {
        clonedRest[k] = {
          pos: [v.pos[0], v.pos[1], v.pos[2]],
          rot: [v.rot[0], v.rot[1], v.rot[2]]
        };
      }
      this._skeletonTemplates.set(templateKey, {
        group: group.clone(true),
        unitDef: group.userData?.unitDef,
        restPoses: clonedRest
      });
    }

    return {
      bodyEntries,
      bannerEntries,
      carryEntriesByType,
      ringEntry
    };
  }

  _getHeroBuffBatch(baseBatch, heroBuffVisual, jointName = "") {
    if (!baseBatch || !heroBuffVisual) return baseBatch;
    // Ravan Azure Blade Fury (heroBuffVisual === 2): only the sword glows electric-blue, not his entire body/horse!
    if (heroBuffVisual === 2 && jointName !== "weapon_socket_R" && jointName !== "weapon_socket_L") {
      return baseBatch;
    }
    const cacheProp = heroBuffVisual === 1 ? "_crimsonBatch" : "_azureBatch";
    if (baseBatch[cacheProp]) return baseBatch[cacheProp];
    const overrideMat = heroBuffVisual === 1 ? this._bloodlustCrimsonMat : this._azureFuryMat;
    const buffBatch = this._getOrCreateBatch(
      baseBatch.mesh.geometry,
      overrideMat,
      baseBatch.mesh.castShadow,
      false,
      false
    );
    baseBatch[cacheProp] = buffBatch;
    return buffBatch;
  }

  _resolveHeroVisualId(state) {
    const compState = this.simBridge?.getEconomyState?.()?.companyStates?.[state.companyId];
    if (state.unitTypeIdx !== 5) {
      const rawUnitId = compState?.unitType || state.unitType || IndexToUnitType[state.unitTypeIdx] || 'swordsman';
      const baseUnitId = this.modelFactory?.visualsData?.units?.[rawUnitId]
        ? rawUnitId
        : (IndexToUnitType[state.unitTypeIdx] || 'swordsman');
      if (
        compState?.activeLoadoutIdx === 1 ||
        state.isOutOfAmmo
      ) {
        const ld2Id = `${baseUnitId}__loadout2`;
        if (this.modelFactory?.visualsData?.units?.[ld2Id]) {
          return ld2Id;
        }
      }
      return baseUnitId;
    }
    const heroKeys = Object.keys(this.modelFactory?.visualsData?.heroes || {});
    const idx = (state.carryType | 0) & 0x07;
    const baseHeroId = compState?.heroId || heroKeys[idx] || 'wizard';

    if (state.isWarhorseMounted || compState?.isWarhorseMounted) {
      const mountedId = `${baseHeroId}__mounted`;
      if (this.modelFactory?.visualsData?.units?.[mountedId]) return mountedId;
    }
    if (compState?.activeLoadoutIdx === 1) {
      const ld2Id = `${baseHeroId}__loadout2`;
      if (this.modelFactory?.visualsData?.units?.[ld2Id]) return ld2Id;
    }
    if (this.modelFactory?.visualsData?.units?.[baseHeroId]) {
      return baseHeroId;
    }
    return this.modelFactory?.visualsData?.units?.wizard ? 'wizard' : 'swordsman';
  }

  clearVisualCaches(newAnimationsData = null) {
    if (newAnimationsData) {
      this.animationsData = newAnimationsData;
    }
    this._bakedJointTemplates.clear();
    this._skeletonTemplates.clear();
    this.unitActors.clear();
    this.actorPool.clear();
    this._animatedBones = new Set(CORE_ANIMATED_BONES);
    for (const clip of Object.values(this.animationsData?.keyframes || {})) {
      for (const [trackBone, keyframes] of Object.entries(clip?.tracks || {})) {
        if (!/^(?:index|middle|ring|pinky|thumb)/.test(trackBone) && isTrackEffectivelyAnimated(keyframes)) {
          this._animatedBones.add(trackBone);
        }
      }
    }
  }

  _resolveActorClips(visualId, unitDef) {
    const clipUnitId = unitDef?.baseHeroId || visualId;
    const data = {
      units: this.modelFactory?.visualsData?.units || {},
      heroes: this.modelFactory?.visualsData?.heroes || {},
      prefabs: this.modelFactory?.visualsData?.prefabs || {},
      animations: this.animationsData
    };
    const faction = unitDef?.race || 'human';
    const combatBase = getCombatBase(unitDef, faction, data.prefabs);
    const meleeCombatBase =
      combatBase === 'shoot_bow'
        ? 'attack_bash'
        : combatBase === 'throw_javelin'
          ? 'attack_slash'
          : combatBase;
    const locoBase = getLocomotionBase(unitDef, faction);
    const runBase = unitDef?.isMounted ? 'gallop' : 'run';
    const chargeBase = unitDef?.isMounted ? 'gallop' : 'charge';
    const retreatBase = unitDef?.isMounted ? 'gallop' : 'retreat_run';
    return {
      idle: resolveIdleClip(data, clipUnitId, faction),
      idleVariants: resolveClipVariants(data, clipUnitId, faction, 'idle'),
      walk: resolveClip(data, clipUnitId, faction, locoBase),
      walkVariants: resolveClipVariants(data, clipUnitId, faction, locoBase),
      run: resolveClip(data, clipUnitId, faction, runBase),
      runVariants: resolveClipVariants(data, clipUnitId, faction, runBase),
      charge: resolveClip(data, clipUnitId, faction, chargeBase),
      chargeVariants: resolveClipVariants(data, clipUnitId, faction, chargeBase),
      retreat: resolveClip(data, clipUnitId, faction, retreatBase),
      retreatVariants: resolveClipVariants(data, clipUnitId, faction, retreatBase),
      build: resolveClip(data, clipUnitId, faction, 'worker_build'),
      buildVariants: resolveClipVariants(data, clipUnitId, faction, 'worker_build'),
      chop: resolveClip(data, clipUnitId, faction, 'worker_chop'),
      chopVariants: resolveClipVariants(data, clipUnitId, faction, 'worker_chop'),
      mine: resolveClip(data, clipUnitId, faction, 'worker_mine'),
      mineVariants: resolveClipVariants(data, clipUnitId, faction, 'worker_mine'),
      block: resolveClip(data, clipUnitId, faction, 'block'),
      blockVariants: resolveClipVariants(data, clipUnitId, faction, 'block'),
      switchWeapon: resolveClip(data, clipUnitId, faction, 'switch_weapon'),
      switchWeaponVariants: resolveClipVariants(data, clipUnitId, faction, 'switch_weapon'),
      knockedDown: resolveClip(data, clipUnitId, faction, 'knocked_down'),
      attack: resolveClip(data, clipUnitId, faction, meleeCombatBase),
      attackVariants: resolveClipVariants(data, clipUnitId, faction, meleeCombatBase),
      shoot: resolveClip(data, clipUnitId, faction, 'shoot_bow'),
      shootVariants: resolveClipVariants(data, clipUnitId, faction, 'shoot_bow'),
      throw: resolveClip(data, clipUnitId, faction, 'throw_javelin'),
      throwVariants: resolveClipVariants(data, clipUnitId, faction, 'throw_javelin'),
      hurt: resolveClip(data, clipUnitId, faction, 'take_damage'),
      hurtVariants: resolveClipVariants(data, clipUnitId, faction, 'take_damage'),
      die: resolveClip(data, clipUnitId, faction, 'die'),
      dieVariants: resolveClipVariants(data, clipUnitId, faction, 'die')
    };
  }

  _pickActionVariant(actor, variants, fallback) {
    if (!Array.isArray(variants) || variants.length <= 1) {
      return (variants && variants[0]) || fallback;
    }
    actor.actionCounter = ((actor.actionCounter | 0) + 1) | 0;
    const kfMap = this.animationsData?.keyframes || {};
    let totalWeight = 0;
    for (let i = 0; i < variants.length; i++) {
      const w = Number(kfMap[variants[i]]?.weight);
      totalWeight += w > 0 ? w : (i === 0 ? 70 : 30);
    }
    if (totalWeight <= 0) return variants[0] || fallback;
    let roll = ((actor.animator.entityId * 2654435761 + actor.actionCounter * 1013904223) >>> 0) % totalWeight;
    for (let i = 0; i < variants.length; i++) {
      const w = Number(kfMap[variants[i]]?.weight);
      const effW = w > 0 ? w : (i === 0 ? 70 : 30);
      if (roll < effW) return variants[i];
      roll -= effW;
    }
    return variants[0] || fallback;
  }

  _startShot(actor, clip, shotWindupTicks) {
    const seconds = shotWindupTicks / TICKS_PER_SEC;
    const holding = actor.animator.playActionAimed(clip, seconds);
    actor.aimTail = holding ? actor.animator.getActionTailSeconds(clip) : -1;
  }

  _acquireUnitActor(state) {
    const visualId = this._resolveHeroVisualId(state);
    const isAlly = Boolean(this.simBridge?.isAlliedWithPlayer?.(state.team) && state.team !== (this.simBridge?.getPlayerTeam?.() ?? 1));
    const poolKey = this._getPoolKey(state.team, visualId, isAlly);
    const poolList = this.actorPool.get(poolKey);

    if (poolList && poolList.length > 0) {
      const actor = poolList.pop();
      actor.animator.entityId = state.id;
      actor.animator.phaseOffset = (state.id * 0.43) % 1.0;
      actor.animator.lowerLayer.normTime = actor.animator.phaseOffset;
      actor.animator.resetFullBody();
      actor.lastAnimState = -1;
      actor.prevWindup = 0;
      actor.prevShotWindup = 0;
      actor.aimTail = -1;
      actor.moveHoldTimer = 0;
      actor.lastMoveClip = null;
      actor.role = state.role === 1 && visualId !== 'worker' && state.unitTypeIdx !== 5 && state.hp > 0 ? 1 : 0;
      actor.carryType = 0;
      actor.hasCachedMatrices = false;
      actor.accumDt = 0;
      actor.spawnScale = 1.0;
      return actor;
    }

    let group = null;
    let extracted = null;

    const cloned = this._createActorGroupFromSkeletonTemplate(poolKey);
    if (cloned) {
      group = cloned.group;
      extracted = cloned.extracted;
    } else {
      group = this.modelFactory.createVisual(visualId, {
        teamId: state.team,
        isAlly,
        isBannerCarrier: visualId !== 'worker' && state.unitTypeIdx !== 5
      });
      extracted = this._extractMeshEntriesFromRig(group, state.team, visualId);
    }

    const animator = new Animator3D(group, this.animationsData, {
      entityId: state.id,
      onEvent: (evt) => {
        if (this.onAnimatorEvent) this.onAnimatorEvent(evt);
      }
    });

    return {
      group,
      animator,
      visualId,
      clips: this._resolveActorClips(visualId, group.userData.unitDef),
      prevWindup: 0,
      prevShotWindup: 0,
      aimTail: -1,
      moveHoldTimer: 0,
      lastMoveClip: null,
      team: state.team | 0,
      role: state.role === 1 && visualId !== 'worker' && state.hp > 0 ? 1 : 0,
      carryType: 0,
      lastAnimState: -1,
      hasCachedMatrices: false,
      spawnScale: 1.0,
      cachedX: 0,
      cachedY: 0,
      cachedZ: 0,
      cachedYaw: 0,
      accumDt: 0,
      bodyEntries: extracted.bodyEntries,
      lodEntries: this._buildLodEntries(visualId, state.team, group, extracted.bodyEntries),
      lodHeight: 1.9 * (group.userData?.unitDef?.scale ?? 1),
      lod: 0,
      bannerEntries: extracted.bannerEntries,
      carryEntriesByType: extracted.carryEntriesByType,
      ringEntry: extracted.ringEntry
    };
  }

  _releaseUnitActor(actor) {
    actor.role = 0;
    actor.carryType = 0;
    actor.moveHoldTimer = 0;
    actor.lastMoveClip = null;
    actor.hasCachedMatrices = false;
    actor.accumDt = 0;

    const isAllyPool = Boolean(this.simBridge?.isAlliedWithPlayer?.(actor.team) && actor.team !== (this.simBridge?.getPlayerTeam?.() ?? 1));
    const poolKey = this._getPoolKey(actor.team, actor.visualId, isAllyPool);
    let poolList = this.actorPool.get(poolKey);
    if (!poolList) {
      poolList = [];
      this.actorPool.set(poolKey, poolList);
    }
    poolList.push(actor);
  }

  update(entities, dtSeconds, formationPreview, fowGrid = null) {
    this._frameTick = (this._frameTick + 1) | 0;
    const frameTick = this._frameTick;
    this._routingPulseTime = (this._routingPulseTime || 0) + dtSeconds;

    if (this._whiteBannerClothMat) {
      const flash = 0.5 + 0.5 * Math.sin(this._routingPulseTime * 14.0);
      this._whiteBannerClothMat.color.setRGB(1.0, 0.72 + 0.28 * flash, 0.65 + 0.35 * flash);
      if (this._whiteBannerClothMat.emissive) {
        this._whiteBannerClothMat.emissive.setRGB(0.45 * (1 - flash), 0.08 * (1 - flash), 0.05);
      }
    }

    this._projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    for (const batch of this._instancedBatches.values()) {
      batch.reset();
    }
    this._bannerAuraBatch.reset();
    this._healingAuraBatch.reset();

    const activeIds = this._activeEntityIds;
    activeIds.clear();
    const totalEntities = entities.length;
    const highLoad = totalEntities > 240;
    const massiveLoad = totalEntities > 420;

    for (let i = 0; i < totalEntities; i++) {
      const state = entities[i];
      activeIds.add(state.id);

      const compStateForLoadout = this.simBridge?.getEconomyState?.()?.companyStates?.[state.companyId];
      const currentLoadoutIdx = (compStateForLoadout?.activeLoadoutIdx | 0) || (state.isOutOfAmmo ? 1 : 0);
      let actor = this.unitActors.get(state.id);
      let triggeredWeaponSwitch = false;
      if (actor) {
        const expectedVis = this._resolveHeroVisualId(state);
        if (actor.visualId !== expectedVis) {
          const prevYaw = actor.cachedYaw || 0;
          const prevPitch = actor.smoothedPitch || 0;
          const prevRoll = actor.smoothedRoll || 0;
          const prevNormTime = actor.animator?.lowerLayer?.normTime || 0;
          const prevAnimState = actor.lastAnimState;
          const prevBaseVis = String(actor.visualId || '').replace(/__(?:loadout2|mounted)$/, '');
          const nextBaseVis = String(expectedVis || '').replace(/__(?:loadout2|mounted)$/, '');
          const isWeaponSwitch = prevBaseVis === nextBaseVis;
          this._releaseUnitActor(actor);
          actor = this._acquireUnitActor(state);
          actor.cachedYaw = prevYaw;
          actor.smoothedPitch = prevPitch;
          actor.smoothedRoll = prevRoll;
          actor.spawnScale = 1.0;
          if (actor.animator?.lowerLayer) {
            actor.animator.lowerLayer.normTime = prevNormTime;
          }
          actor.lastAnimState = prevAnimState;
          actor.lastLoadoutIdx = currentLoadoutIdx;
          if (isWeaponSwitch && state.hp > 0) {
            const swClip = this._pickActionVariant(
              actor,
              actor.clips?.switchWeaponVariants,
              actor.clips?.switchWeapon || 'switch_weapon'
            );
            actor.animator.playAction(swClip, { restart: true, loop: false });
            triggeredWeaponSwitch = true;
          }
          this.unitActors.set(state.id, actor);
        } else if (
          actor.lastLoadoutIdx !== undefined &&
          actor.lastLoadoutIdx !== currentLoadoutIdx &&
          state.hp > 0
        ) {
          actor.lastLoadoutIdx = currentLoadoutIdx;
          const swClip = this._pickActionVariant(
            actor,
            actor.clips?.switchWeaponVariants,
            actor.clips?.switchWeapon || 'switch_weapon'
          );
          actor.animator.playAction(swClip, { restart: true, loop: false });
          triggeredWeaponSwitch = true;
        }
      }
      if (!actor) {
        actor = this._acquireUnitActor(state);
        actor.lastLoadoutIdx = currentLoadoutIdx;
        this.unitActors.set(state.id, actor);
      }

      if (state.isGarrisoned) continue;

      // Phase 7 Fog of War: Enemy units are hidden unless in a VISIBLE (2) cell OR permanently revealed by LAST STAND!
      const isAlliedVis = this.simBridge?.isAlliedWithPlayer ? this.simBridge.isAlliedWithPlayer(state.team) : state.team === 1;
      if (!isAlliedVis && fowGrid && !state.isRevealedLastStand) {
        const cx = Math.max(0, Math.min(FOW_GRID_SIZE - 1, Math.floor((state.x / 4096) * FOW_GRID_SIZE)));
        const cz = Math.max(0, Math.min(FOW_GRID_SIZE - 1, Math.floor((state.z / 4096) * FOW_GRID_SIZE)));
        if (fowGrid[cz * FOW_GRID_SIZE + cx] < FowState.VISIBLE) {
          continue;
        }
      }

      const isAlive = state.hp > 0 && state.animState !== AnimState.DIE;

      if (actor.visualId === 'worker') {
        actor.carryType = isAlive ? state.carryType | 0 : 0;
        actor.role = 0;
      } else if (state.unitTypeIdx === 5 || actor.group?.userData?.unitDef?.isHero) {
        actor.carryType = 0;
        actor.role = 0;
      } else {
        actor.role = isAlive && state.role === 1 ? 1 : 0;
      }

      const unitDef = actor.group.userData.unitDef;
      const clips = actor.clips;
      const defaultWalkClip = clips.walkVariants || clips.walk || unitDef?.locomotionAnim || 'walk';
      const defaultIdleClip = clips.idleVariants || clips.idle || 'idle';
      const windup = state.windupTicks | 0;
      const shotWindup = state.shotWindupTicks | 0;
      const spellSlotIdx = state.activeSpellSlotIdx | 0;
      if (spellSlotIdx > 0 && spellSlotIdx !== (actor.lastSpellSlotIdx || 0)) {
        const compState = this.simBridge?.getEconomyState?.()?.companyStates?.[state.companyId];
        const spellEntry = compState?.heroSpells?.[spellSlotIdx - 1];
        const spellId = spellEntry?.spellId || 'fireball';
        const data = {
          units: this.modelFactory?.visualsData?.units || {},
          animations: this.animationsData
        };
        const clipUnitId = unitDef?.baseHeroId || actor.visualId;
        const spellClip = resolveClip(data, clipUnitId, unitDef?.race || 'human', `spell_${spellId}`);
        actor.animator.playAction(spellClip, { restart: true });
      }
      actor.lastSpellSlotIdx = spellSlotIdx;
      const syncedShots = state.shotWindupTicks !== undefined;
      const prevAnimState = actor.lastAnimState;

      if (state.animState === AnimState.DIE || !isAlive) {
        actor.moveHoldTimer = 0;
        if (prevAnimState !== AnimState.DIE) {
          actor.animator.playAction(this._pickActionVariant(actor, clips.dieVariants, clips.die));
        }
      } else if (state.animState === AnimState.KNOCKED_DOWN || state.isKnockedDown) {
        actor.moveHoldTimer = 0;
        if (prevAnimState !== AnimState.KNOCKED_DOWN) {
          actor.animator.knockdownAirTime = 0;
          actor.animator.knockdownGroundTime = 0;
        }
        actor.animator.setLocomotion('knocked_down');
      } else if (state.animState === AnimState.HURT) {
        actor.moveHoldTimer = 0;
        actor.animator.setLocomotion(defaultIdleClip);
        if (clips.hurt && prevAnimState !== AnimState.HURT) {
          actor.animator.playAction(this._pickActionVariant(actor, clips.hurtVariants, clips.hurt), { restart: true });
        }
      } else if (state.animState === AnimState.CHARGE) {
        const chargeClip = clips.chargeVariants || clips.charge || (unitDef?.isMounted ? "gallop" : "charge");
        actor.lastMoveClip = chargeClip;
        actor.moveHoldTimer = 0.14;
        actor.animator.setLocomotion(chargeClip, unitDef?.isMounted ? 1.18 : 1.0);
        if (windup > 0 && (actor.prevWindup === 0 || windup > actor.prevWindup)) {
          const chosenAttack = this._pickActionVariant(actor, clips.attackVariants, clips.attack);
          actor.animator.playActionTimed(chosenAttack, windup / TICKS_PER_SEC);
        }
      } else if (state.animState === AnimState.BLOCK) {
        actor.moveHoldTimer = 0;
        actor.animator.setLocomotion(actor.visualId === 'ballista' ? defaultIdleClip : 'block_idle');
        if (clips.block && prevAnimState !== AnimState.BLOCK) {
          actor.animator.playAction(this._pickActionVariant(actor, clips.blockVariants, clips.block));
        }
      } else if (state.animState === AnimState.COMBAT_STANDBY) {
        if ((actor.moveHoldTimer || 0) > 0 && actor.lastMoveClip) {
          actor.moveHoldTimer = Math.max(0, actor.moveHoldTimer - dtSeconds);
          actor.animator.setLocomotion(actor.lastMoveClip);
        } else {
          actor.animator.setLocomotion(actor.visualId === 'ballista' ? defaultIdleClip : 'combat_standby');
        }
      } else if (state.animState === AnimState.BUILD) {
        actor.moveHoldTimer = 0;
        actor.animator.setLocomotion(clips.buildVariants || clips.build || 'worker_build');
      } else if (state.animState === AnimState.CHOP) {
        actor.moveHoldTimer = 0;
        actor.animator.setLocomotion(clips.chopVariants || clips.chop || 'worker_chop');
      } else if (state.animState === AnimState.MINE || state.animState === AnimState.GATHER) {
        actor.moveHoldTimer = 0;
        actor.animator.setLocomotion(clips.mineVariants || clips.mine || 'worker_mine');
      } else if (state.animState === AnimState.RUN) {
        const runClip = state.isRouting
          ? (clips.retreatVariants || clips.retreat || (unitDef?.isMounted ? 'gallop' : 'retreat_run'))
          : (clips.runVariants || clips.run || (unitDef?.isMounted ? 'gallop' : 'run'));
        actor.lastMoveClip = runClip;
        actor.moveHoldTimer = 0.14;
        actor.animator.setLocomotion(runClip);
        if (windup > 0 && (actor.prevWindup === 0 || windup > actor.prevWindup)) {
          const chosenAttack = this._pickActionVariant(actor, clips.attackVariants, clips.attack);
          actor.animator.playActionTimed(chosenAttack, windup / TICKS_PER_SEC);
        }
      } else if (state.animState === AnimState.WALK) {
        actor.lastMoveClip = defaultWalkClip;
        actor.moveHoldTimer = 0.14;
        actor.animator.setLocomotion(defaultWalkClip, unitDef?.isMounted ? 0.68 : 1.0);
        if (windup > 0 && (actor.prevWindup === 0 || windup > actor.prevWindup)) {
          const chosenAttack = this._pickActionVariant(actor, clips.attackVariants, clips.attack);
          actor.animator.playActionTimed(chosenAttack, windup / TICKS_PER_SEC);
        }
      } else if (state.animState === AnimState.SPEAR_WALL_IDLE) {
        if ((actor.moveHoldTimer || 0) > 0 && actor.lastMoveClip) {
          actor.moveHoldTimer = Math.max(0, actor.moveHoldTimer - dtSeconds);
          actor.animator.setLocomotion(actor.lastMoveClip);
        } else {
          actor.animator.setLocomotion('spear_wall_idle');
        }
      } else if (state.animState === AnimState.IDLE) {
        if ((actor.moveHoldTimer || 0) > 0 && actor.lastMoveClip) {
          actor.moveHoldTimer = Math.max(0, actor.moveHoldTimer - dtSeconds);
          actor.animator.setLocomotion(actor.lastMoveClip);
        } else {
          actor.animator.setLocomotion(defaultIdleClip);
        }
      } else if (state.animState === AnimState.ATTACK) {
        actor.moveHoldTimer = 0;
        actor.animator.setLocomotion(
          actor.visualId === 'spearman' ? 'spear_wall_idle' : defaultIdleClip
        );
        if (windup > 0 && (actor.prevWindup === 0 || windup > actor.prevWindup)) {
          const chosenAttack = this._pickActionVariant(actor, clips.attackVariants, clips.attack);
          actor.animator.playActionTimed(chosenAttack, windup / TICKS_PER_SEC);
        } else if (windup === 0 && actor.prevWindup === 0 && !actor.animator.upperLayer.active) {
          const chosenAttack = this._pickActionVariant(actor, clips.attackVariants, clips.attack);
          actor.animator.playAction(chosenAttack);
        }
      } else if (state.animState === AnimState.SHOOT) {
        actor.moveHoldTimer = 0;
        actor.animator.setLocomotion(defaultIdleClip);
        if (!syncedShots) {
          actor.animator.playAction(this._pickActionVariant(actor, clips.shootVariants, clips.shoot));
        } else if (shotWindup > 0 && (actor.prevShotWindup === 0 || shotWindup > actor.prevShotWindup)) {
          this._startShot(actor, this._pickActionVariant(actor, clips.shootVariants, clips.shoot), shotWindup);
        }
      } else if (state.animState === AnimState.THROW) {
        actor.animator.setLocomotion(defaultWalkClip, 0.85);
        if (!syncedShots) {
          actor.animator.playAction(this._pickActionVariant(actor, clips.throwVariants, clips.throw));
        } else if (shotWindup > 0 && (actor.prevShotWindup === 0 || shotWindup > actor.prevShotWindup)) {
          this._startShot(actor, this._pickActionVariant(actor, clips.throwVariants, clips.throw), shotWindup);
        }
      }

      if (actor.aimTail >= 0) {
        if (
          state.animState !== AnimState.SHOOT &&
          state.animState !== AnimState.THROW &&
          state.animState !== AnimState.IDLE
        ) {
          actor.animator.cancelAction();
          actor.aimTail = -1;
        } else if (shotWindup / TICKS_PER_SEC <= actor.aimTail + 0.04) {
          actor.animator.releaseHold(Math.max(0.05, shotWindup / TICKS_PER_SEC));
          actor.aimTail = -1;
        }
      }


      actor.prevHp = state.hp;
      actor.prevWindup = windup;
      actor.prevShotWindup = shotWindup;
      actor.lastAnimState = state.animState;

      this._boundSphere.center.set(state.x, state.y + 1.0, state.z);
      const inFrustum = this._frustum.intersectsSphere(this._boundSphere);
      if (!inFrustum) {
        if (actor.animator.fullBodyLayer.active && !actor.animator.fullBodyLayer.poseLocked) {
          actor.animator.update(dtSeconds);
        }
        continue;
      }

      actor.accumDt = (actor.accumDt || 0) + dtSeconds;
      const targetYaw = -state.yawRad + Math.PI * 0.5;
      const fwdCos = Math.cos(state.yawRad);
      const fwdSin = Math.sin(state.yawRad);
      const hCenter = sampleTerrainMeshHeightMeters(state.x, state.z, true, 4096);
      const isKnocked = state.animState === AnimState.KNOCKED_DOWN || Boolean(state.isKnockedDown);
      const airOffset = isKnocked ? Math.max(0, state.y - hCenter) : 0;
      if (state.hp > 0 && !state.isFlying) {
        state.y = hCenter + airOffset;
      }
      actor.animator.airOffset = airOffset;
      actor.animator.isMountedUnit = Boolean(actor.visualId === 'cavalry' || unitDef?.isMounted);
      actor.animator.isBurning = Boolean(state.isBurning && !isKnocked && state.hp > 0);
      const hAhead = sampleTerrainMeshHeightMeters(state.x + fwdCos * 0.7, state.z + fwdSin * 0.7, true, 4096);
      const hBehind = sampleTerrainMeshHeightMeters(state.x - fwdCos * 0.7, state.z - fwdSin * 0.7, true, 4096);
      // Local +X of actor.group points along (fwdSin, 0, -fwdCos) (World Left)
      const hLeft = sampleTerrainMeshHeightMeters(state.x + fwdSin * 0.55, state.z - fwdCos * 0.55, true, 4096);
      const hRight = sampleTerrainMeshHeightMeters(state.x - fwdSin * 0.55, state.z + fwdCos * 0.55, true, 4096);
      const rawPitchSlope = Math.max(-0.42, Math.min(0.42, Math.atan2(hAhead - hBehind, 1.4)));
      const rawRollSlope = Math.max(-0.32, Math.min(0.32, Math.atan2(hLeft - hRight, 1.1)));
      const desiredPitch = actor.visualId === 'cavalry' ? -rawPitchSlope * 1.0 : -rawPitchSlope * 0.85;
      const desiredRoll = actor.visualId === 'cavalry' ? rawRollSlope * 0.85 : rawRollSlope * 0.65;
      const tiltBlend = Math.min(1, dtSeconds * 16);
      actor.smoothedPitch =
        actor.smoothedPitch === undefined
          ? desiredPitch
          : actor.smoothedPitch + (desiredPitch - actor.smoothedPitch) * tiltBlend;
      actor.smoothedRoll =
        actor.smoothedRoll === undefined
          ? desiredRoll
          : actor.smoothedRoll + (desiredRoll - actor.smoothedRoll) * tiltBlend;
      const targetPitch = actor.smoothedPitch;
      const targetRoll = actor.smoothedRoll;

      const yawDelta =
        Math.abs(targetYaw - actor.cachedYaw) +
        Math.abs(targetPitch - (actor.cachedPitch || 0)) +
        Math.abs(targetRoll - (actor.cachedRoll || 0));
      const yawChanged = yawDelta > 0.006;
      const bigYawChanged = yawDelta > 0.055;
      const animChanged = state.animState !== prevAnimState;
      const isStationaryPose =
        (state.animState === AnimState.IDLE ||
          state.animState === AnimState.SPEAR_WALL_IDLE ||
          state.animState === AnimState.COMBAT_STANDBY ||
          state.animState === AnimState.BLOCK) &&
        (actor.moveHoldTimer || 0) <= 0 &&
        !actor.animator.upperLayer.active &&
        !actor.animator.fullBodyLayer.active;

      if ((actor.spawnScale ?? 1.0) < 1.0) {
        actor.spawnScale = Math.min(1.0, (actor.spawnScale || 0.08) + dtSeconds * 2.6);
      }
      const lodList = actor.lodEntries ? (actor.lod = this._pickLod(actor, state.x, state.y, state.z)) > 0 ? actor.lodEntries[actor.lod] || null : null : null;
      let shouldStepSkeleton = true;
      if (actor.hasCachedMatrices && !animChanged && !bigYawChanged && (actor.spawnScale ?? 1.0) >= 1.0) {
        if (actor.animator.fullBodyLayer.active && actor.animator.fullBodyLayer.poseLocked && !yawChanged) {
          shouldStepSkeleton = false;
        } else if (highLoad && isStationaryPose && !yawChanged) {
          shouldStepSkeleton = ((i + frameTick) & 3) === 0;
        } else if (massiveLoad && !yawChanged) {
          shouldStepSkeleton = ((i + frameTick) & 1) === 0;
        }
      }

      if (shouldStepSkeleton) {
        actor.group.position.set(state.x, state.y, state.z);
        const spScale = actor.spawnScale ?? 1.0;
        actor.group.scale.setScalar(spScale);
        actor.group.rotation.order = 'YXZ';
        actor.group.rotation.y = targetYaw;
        actor.group.rotation.x = targetPitch;
        actor.group.rotation.z = targetRoll;
        actor.animator.update(actor.accumDt);
        actor.accumDt = 0;
        actor.group.updateMatrixWorld(true);

        actor.cachedX = state.x;
        actor.cachedY = state.y;
        actor.cachedZ = state.z;
        actor.cachedYaw = targetYaw;
        actor.cachedPitch = targetPitch;
        actor.cachedRoll = targetRoll;
        actor.hasCachedMatrices = true;

        const bodyEntries = actor.bodyEntries;
        const heroBuffVis = state.unitTypeIdx === 5 ? (state.heroBuffVisual | 0) : 0;
        for (let b = 0; b < bodyEntries.length; b++) {
          const entry = bodyEntries[b];
          if (entry.localMatrix) {
            entry.cachedWorldMatrix.multiplyMatrices(entry.parent.matrixWorld, entry.localMatrix);
          } else {
            entry.cachedWorldMatrix.copy(entry.parent.matrixWorld);
          }
          const targetBatch = heroBuffVis > 0 ? this._getHeroBuffBatch(entry.batch, heroBuffVis, entry.jointName) : entry.batch;
          if (!lodList) targetBatch.pushMatrix(entry.cachedWorldMatrix);
        }
        if (lodList) for (let k = 0; k < lodList.length; k++) lodList[k].batch.pushMatrix(lodList[k].src.cachedWorldMatrix);

        if (actor.role === 1 && actor.bannerEntries.length > 0) {
          const bannerEntries = actor.bannerEntries;
          const isRouting = Boolean(state.isRouting);
          for (let b = 0; b < bannerEntries.length; b++) {
            const entry = bannerEntries[b];
            entry.cachedWorldMatrix.multiplyMatrices(entry.parent.matrixWorld, entry.localMatrix);
            if (isRouting && entry.routingBatch) {
              entry.routingBatch.pushMatrix(entry.cachedWorldMatrix);
            } else {
              entry.batch.pushMatrix(entry.cachedWorldMatrix);
            }
          }
        }

        if (actor.carryType > 0) {
          const carryEntries = actor.carryEntriesByType[actor.carryType];
          if (carryEntries) {
            for (let c = 0; c < carryEntries.length; c++) {
              const entry = carryEntries[c];
              entry.cachedWorldMatrix.multiplyMatrices(entry.parent.matrixWorld, entry.localMatrix);
              entry.batch.pushMatrix(entry.cachedWorldMatrix);
            }
          }
        }

        if (isAlive && actor.ringEntry) {
          actor.ringEntry.cachedWorldMatrix.multiplyMatrices(
            actor.ringEntry.parent.matrixWorld,
            actor.ringEntry.localMatrix
          );
        }
      } else {
        // Fast path: translate cached bone world matrices by (dx, dy, dz) for 60 FPS smooth movement
        // without running Animator3D or updateMatrixWorld(true) on this frame!
        const dx = state.x - actor.cachedX;
        const dy = state.y - actor.cachedY;
        const dz = state.z - actor.cachedZ;
        const moved = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-5;
        if (moved) {
          actor.cachedX = state.x;
          actor.cachedY = state.y;
          actor.cachedZ = state.z;
        }

        const bodyEntries = actor.bodyEntries;
        const heroBuffVis = state.unitTypeIdx === 5 ? (state.heroBuffVisual | 0) : 0;
        for (let b = 0; b < bodyEntries.length; b++) {
          const entry = bodyEntries[b];
          if (moved) {
            const te = entry.cachedWorldMatrix.elements;
            te[12] += dx;
            te[13] += dy;
            te[14] += dz;
          }
          const targetBatch = heroBuffVis > 0 ? this._getHeroBuffBatch(entry.batch, heroBuffVis, entry.jointName) : entry.batch;
          if (!lodList) targetBatch.pushMatrix(entry.cachedWorldMatrix);
        }
        if (lodList) for (let k = 0; k < lodList.length; k++) lodList[k].batch.pushMatrix(lodList[k].src.cachedWorldMatrix);

        if (actor.role === 1 && actor.bannerEntries.length > 0) {
          const bannerEntries = actor.bannerEntries;
          const isRouting = Boolean(state.isRouting);
          for (let b = 0; b < bannerEntries.length; b++) {
            const entry = bannerEntries[b];
            if (moved) {
              const te = entry.cachedWorldMatrix.elements;
              te[12] += dx;
              te[13] += dy;
              te[14] += dz;
            }
            if (isRouting && entry.routingBatch) {
              entry.routingBatch.pushMatrix(entry.cachedWorldMatrix);
            } else {
              entry.batch.pushMatrix(entry.cachedWorldMatrix);
            }
          }
        }

        if (actor.carryType > 0) {
          const carryEntries = actor.carryEntriesByType[actor.carryType];
          if (carryEntries) {
            for (let c = 0; c < carryEntries.length; c++) {
              const entry = carryEntries[c];
              if (moved) {
                const te = entry.cachedWorldMatrix.elements;
                te[12] += dx;
                te[13] += dy;
                te[14] += dz;
              }
              entry.batch.pushMatrix(entry.cachedWorldMatrix);
            }
          }
        }

        if (isAlive && actor.ringEntry && moved) {
          const te = actor.ringEntry.cachedWorldMatrix.elements;
          te[12] += dx;
          te[13] += dy;
          te[14] += dz;
        }
      }

      if (isAlive) {
        if (actor.ringEntry) {
          const routingFlashOn =
            Boolean(state.isRouting) && ((frameTick >> 2) & 1) === 0;
          const showRing =
            routingFlashOn ||
            (state.team === 1 &&
              (Boolean(formationPreview?.isCompanySelected(state.companyId)) ||
                Boolean(formationPreview?.isCompanyHovered?.(state.companyId)))) ||
            (state.team !== 1 && Boolean(formationPreview?.isEnemyCompanyHovered?.(state.companyId)));
          if (showRing) {
            actor.ringEntry.batch.pushMatrix(actor.ringEntry.cachedWorldMatrix);
          }
        }

        const waistHeightOffset = actor.visualId === 'cavalry' ? 1.25 : 0.85;

        if (state.hasBannerBuff) {
          const rScale = actor.visualId === 'cavalry' ? 1.25 : 0.92;
          this._auraScaleMat.makeScale(rScale, 1, rScale);
          this._auraScaleMat.setPosition(state.x, state.y + waistHeightOffset, state.z);
          this._bannerAuraBatch.pushMatrix(this._auraScaleMat);
        }

        if (state.isHealing) {
          const rScale = actor.visualId === 'cavalry' ? 1.12 : 0.82;
          this._auraScaleMat.makeScale(rScale, 1, rScale);
          this._auraScaleMat.setPosition(state.x, state.y + waistHeightOffset + 0.06, state.z);
          this._healingAuraBatch.pushMatrix(this._auraScaleMat);
        }
      }
    }

    for (const [id, actor] of this.unitActors.entries()) {
      if (!activeIds.has(id)) {
        this.unitActors.delete(id);
        this._releaseUnitActor(actor);
      }
    }

    for (const batch of this._instancedBatches.values()) {
      batch.commit();
    }
    this._bannerAuraBatch.commit();
    this._healingAuraBatch.commit();
  }
}
