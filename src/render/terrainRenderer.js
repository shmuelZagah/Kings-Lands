/**
 * Kings Lands — 3D Terrain, Water, Bridges, Fords, Multi-Skin Trees, Mines & Decorative Props Renderer
 * (src/render/terrainRenderer.js)
 *
 * Upgraded for the 16x Expanded Battlefield (4096m x 4096m) & Custom 3D Map Editor Integration:
 * - Renders sculpted heights, painted biome layers, and custom uploaded ground textures.
 * - Renders custom or default Stone Bridges and Shallow Fords.
 * - Renders multi-skin forest trees (`createTreeMeshBySkin`), multi-skin mines (`createMineMeshBySkin`),
 *   and decorative 3D scenery props (`createDecorativePropMesh`).
 */

import * as THREE from 'three';
import { toFx, toFloat } from '../core/fx.js';
import {
  sampleTerrainHeightFx,
  computeRiverCenterZFx
} from '../sim/gameState.js';
import { getBridgeCentersMeters, getFordCentersMeters } from '../sim/nav/grid.js';
import { generateDeterministicTreesFx, generateDeterministicMinesFx } from '../sim/world/worldGen.js';
import { mergeStaticGroupMeshesByMaterial } from './buildingModelFactory.js';
import {
  TERRAIN_BIOME_LAYERS,
  getActiveCustomMapState,
  sampleCustomMapBiomeId,
  sampleCustomMapVertexRgb,
  createTreeMeshBySkin,
  createMineMeshBySkin,
  createDecorativePropMesh
} from '../tools/map_editor/mapStateManager.js';

export class TerrainRenderer {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.tilesX = config?.map?.tilesX || 1024;
    this.tilesZ = config?.map?.tilesZ || 1024;
    this.tileSize = config?.map?.tileSizeMeters || 4;
    this.worldSize = this.tilesX * this.tileSize;
    this.centerCoord = this.worldSize * 0.5;

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'TerrainRoot';
    this.scene.add(this.rootGroup);

    this.fordMarkers = [];
    this._elapsedTime = 0;
    this._treeRecords = [];
    this._customTreeGroups = [];
    this._lastDepletedKey = '__uninitialized__';
    this._matScratch = new THREE.Matrix4();
    this._posScratch = new THREE.Vector3();
    this._quatIdentity = new THREE.Quaternion();
    this._scaleScratch = new THREE.Vector3();

    this._initFowTexture();
    this._buildTerrainMesh();
    this._buildWaterPlane();
    this._buildStoneBridge();
    this._buildTreesAndMines();
    this._buildDecorativeProps();
    this._buildTileGridOverlay();
  }

  _initFowTexture() {
    this._fowSize = 256;
    const total = this._fowSize * this._fowSize;
    this._fowCurrentBrightness = new Uint8Array(total);
    this._fowCurrentBrightness.fill(255);
    this._fowTexRgba = new Uint8Array(total * 4);
    this._fowTexRgba.fill(255);
    this._fowDataTexture = new THREE.DataTexture(
      this._fowTexRgba,
      this._fowSize,
      this._fowSize,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    this._fowDataTexture.magFilter = THREE.LinearFilter;
    this._fowDataTexture.minFilter = THREE.LinearFilter;
    this._fowDataTexture.wrapS = THREE.ClampToEdgeWrapping;
    this._fowDataTexture.wrapT = THREE.ClampToEdgeWrapping;
    this._fowDataTexture.generateMipmaps = false;
    this._fowDataTexture.needsUpdate = true;
    this._maxRevealCircles = 8;
    this._revealCirclesUniform = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0));
    this._revealStartTimes = new Map();
  }

  _buildTerrainMesh() {
    const segX = Math.min(256, this.tilesX);
    const segZ = Math.min(256, this.tilesZ);
    const geom = new THREE.PlaneGeometry(this.worldSize, this.worldSize, segX, segZ);
    geom.rotateX(-Math.PI / 2);

    const posAttr = geom.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    this._vertexFowCellIdx = new Uint16Array(posAttr.count);

    const colorDeepBed = new THREE.Color(0x1b2d36);
    const colorShallowSand = new THREE.Color(0xa6946b);
    const colorLushGrass = new THREE.Color(0x3f6b34);
    const colorHighGrass = new THREE.Color(0x55773d);
    const colorRockSlope = new THREE.Color(0x69645c);
    const colorHighPeak = new THREE.Color(0x948f86);
    const colorRoadStone = new THREE.Color(0x7c7567);
    const tmpColor = new THREE.Color();

    const customMap = getActiveCustomMapState();
    const isCustomActive = Boolean(customMap && customMap.isCustomMapActive);
    const bridgeXs = getBridgeCentersMeters(this.centerCoord);

    for (let i = 0; i < posAttr.count; i++) {
      const worldX = posAttr.getX(i) + this.centerCoord;
      const worldZ = posAttr.getZ(i) + this.centerCoord;
      const heightMeters = toFloat(
        sampleTerrainHeightFx(toFx(worldX), toFx(worldZ), false, this.worldSize)
      );

      posAttr.setX(i, worldX);
      posAttr.setY(i, heightMeters);
      posAttr.setZ(i, worldZ);

      const cx = Math.max(0, Math.min(255, Math.floor((worldX / this.worldSize) * 256)));
      const cz = Math.max(0, Math.min(255, Math.floor((worldZ / this.worldSize) * 256)));
      this._vertexFowCellIdx[i] = (cz << 8) | cx;

      const customRgb = isCustomActive ? sampleCustomMapVertexRgb(customMap, i) : null;
      const customBiomeId = isCustomActive ? sampleCustomMapBiomeId(customMap, worldX, worldZ) : 0;
      if (customRgb) {
        tmpColor.setRGB(customRgb[0], customRgb[1], customRgb[2]);
      } else if (customBiomeId > 0) {
        const layer = TERRAIN_BIOME_LAYERS.find((b) => b.id === customBiomeId);
        tmpColor.set(layer ? layer.hex : '#3f6b34');
      } else {
        let minRoadDist = Infinity;
        for (let b = 0; b < bridgeXs.length; b++) {
          const d = Math.abs(worldX - bridgeXs[b]);
          if (d < minRoadDist) minRoadDist = d;
        }

        if (heightMeters < -0.45) {
          tmpColor.copy(colorDeepBed);
        } else if (heightMeters <= 0.22) {
          tmpColor
            .copy(colorDeepBed)
            .lerp(colorShallowSand, Math.max(0, Math.min(1, (heightMeters + 0.45) / 0.67)));
        } else if (minRoadDist < 10.5 && Math.abs(worldZ - this.centerCoord) < 420) {
          tmpColor.copy(colorRoadStone);
        } else if (heightMeters < 4.6) {
          tmpColor.copy(colorLushGrass).lerp(colorHighGrass, (heightMeters - 0.22) / 4.38);
        } else if (heightMeters < 8.5) {
          tmpColor.copy(colorHighGrass).lerp(colorRockSlope, (heightMeters - 4.6) / 3.9);
        } else {
          tmpColor.copy(colorRockSlope).lerp(colorHighPeak, Math.min(1, (heightMeters - 8.5) / 4.0));
        }
      }

      const tileX = Math.floor(worldX / this.tileSize);
      const tileZ = Math.floor(worldZ / this.tileSize);
      if ((tileX + tileZ) % 2 === 0) tmpColor.multiplyScalar(0.96);

      colors[i * 3 + 0] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }

    this._baseTerrainColors = new Float32Array(colors);
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const fowFactors = new Float32Array(posAttr.count);
    fowFactors.fill(1.0);
    geom.setAttribute('aFowFactor', new THREE.BufferAttribute(fowFactors, 1));
    geom.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.06
    });

    // Apply custom uploaded ground texture if active in custom map
    if (
      isCustomActive &&
      customMap.activeGroundTextureId &&
      customMap.activeGroundTextureId !== 'none' &&
      Array.isArray(customMap.customTextures) &&
      typeof Image !== 'undefined'
    ) {
      const texEntry = customMap.customTextures.find((t) => t.id === customMap.activeGroundTextureId);
      if (texEntry && texEntry.dataUrl) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 512;
          canvas.height = 512;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage?.(img, 0, 0, 512, 512);
          const tex = new THREE.CanvasTexture(canvas);
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          const rep = Math.max(1, Number(customMap.groundTextureRepeat) || 24);
          tex.repeat.set(rep, rep);
          terrainMat.map = tex;
          terrainMat.needsUpdate = true;
        };
        img.src = texEntry.dataUrl;
      }
    }

    const revealUniforms = this._revealCirclesUniform;
    const fowTexture = this._fowDataTexture;
    const worldSizeVal = this.worldSize;
    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uRevealCircles = { value: revealUniforms };
      shader.uniforms.uFowMap = { value: fowTexture };
      shader.uniforms.uWorldSize = { value: worldSizeVal };
      shader.vertexShader =
        "attribute float aFowFactor;\nvarying float vFowFactor;\nvarying vec2 vWorldXZ;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n  vWorldXZ = position.xz;\n  vFowFactor = aFowFactor;"
        );
      shader.fragmentShader =
        "uniform vec4 uRevealCircles[8];\nuniform sampler2D uFowMap;\nuniform float uWorldSize;\nvarying float vFowFactor;\nvarying vec2 vWorldXZ;\n" +
        shader.fragmentShader.replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          vec2 fowUv = clamp(vWorldXZ / uWorldSize, 0.002, 0.998);
          float texel = 1.0 / 256.0;
          float c0 = texture2D(uFowMap, fowUv).r * 4.0;
          float c1 = texture2D(uFowMap, fowUv + vec2(texel, 0.0)).r * 2.0;
          float c2 = texture2D(uFowMap, fowUv - vec2(texel, 0.0)).r * 2.0;
          float c3 = texture2D(uFowMap, fowUv + vec2(0.0, texel)).r * 2.0;
          float c4 = texture2D(uFowMap, fowUv - vec2(0.0, texel)).r * 2.0;
          float c5 = texture2D(uFowMap, fowUv + vec2(texel, texel)).r;
          float c6 = texture2D(uFowMap, fowUv + vec2(-texel, texel)).r;
          float c7 = texture2D(uFowMap, fowUv + vec2(texel, -texel)).r;
          float c8 = texture2D(uFowMap, fowUv + vec2(-texel, -texel)).r;
          float rawFow = (c0 + c1 + c2 + c3 + c4 + c5 + c6 + c7 + c8) / 16.0;
          float exploredBand = mix(0.07, 0.46, smoothstep(0.14, 0.36, rawFow));
          float pixelFow = mix(exploredBand, 1.0, smoothstep(0.56, 0.84, rawFow));
          float spellCircleReveal = 0.0;
          for (int i = 0; i < 8; i++) {
            vec4 rc = uRevealCircles[i];
            if (rc.w > 0.5) {
              float d = distance(vWorldXZ, rc.xy);
              float m = 1.0 - smoothstep(rc.z - 1.5, rc.z + 0.5, d);
              spellCircleReveal = max(spellCircleReveal, m);
            }
          }
          float finalFow = max(pixelFow, spellCircleReveal);
          diffuseColor.rgb *= finalFow;`
        );
    };
    terrainMat.customProgramCacheKey = () => "kings_lands_terrain_circular_fow_v3";

    this.terrainMesh = new THREE.Mesh(geom, terrainMat);
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.matrixAutoUpdate = false;
    this.terrainMesh.updateMatrix();
    this.rootGroup.add(this.terrainMesh);
  }

  _buildWaterPlane() {
    const customMap = getActiveCustomMapState();
    const isCustomActive = Boolean(customMap && customMap.isCustomMapActive);
    const baseWaterLevel = isCustomActive ? (Number(customMap.waterLevelMeters) ?? -0.08) : -0.08;
    const waterColor = isCustomActive ? (customMap.waterColorHex || 0x22789b) : 0x22789b;
    this._baseWaterLevel = baseWaterLevel;

    if (isCustomActive) {
      // Full-world water plane so any carved river or lake anywhere on the custom map renders water!
      const waterGeom = new THREE.PlaneGeometry(this.worldSize, this.worldSize, 64, 64);
      waterGeom.rotateX(-Math.PI / 2);
      this.waterMesh = new THREE.Mesh(
        waterGeom,
        new THREE.MeshStandardMaterial({
          color: waterColor,
          roughness: 0.22,
          metalness: 0.35,
          transparent: true,
          opacity: 0.78,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        })
      );
      this.waterMesh.position.set(this.centerCoord, baseWaterLevel, this.centerCoord);
      this.rootGroup.add(this.waterMesh);
      return;
    }

    const waterGeom = new THREE.PlaneGeometry(this.worldSize, 110, 200, 16);
    waterGeom.rotateX(-Math.PI / 2);
    const pos = waterGeom.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + this.centerCoord;
      const localZ = pos.getZ(i);
      const riverCenterZ = toFloat(computeRiverCenterZFx(toFx(wx), this.centerCoord));
      pos.setX(i, wx);
      pos.setY(i, baseWaterLevel);
      pos.setZ(i, riverCenterZ + localZ);
    }
    waterGeom.computeVertexNormals();

    this.waterMesh = new THREE.Mesh(
      waterGeom,
      new THREE.MeshStandardMaterial({
        color: waterColor,
        roughness: 0.22,
        metalness: 0.35,
        transparent: true,
        opacity: 0.78,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
      })
    );
    this.rootGroup.add(this.waterMesh);

    const fordMat = new THREE.MeshStandardMaterial({ color: 0x9aa095, roughness: 0.75 });
    const pebbleGeom = new THREE.CylinderGeometry(1.3, 1.7, 0.35, 7);
    const fordCoords = getFordCentersMeters(this.centerCoord);
    const pebbleInst = new THREE.InstancedMesh(pebbleGeom, fordMat, fordCoords.length * 11);
    pebbleInst.frustumCulled = false;
    pebbleInst.matrixAutoUpdate = false;
    let pIdx = 0;

    const ringGeom = new THREE.RingGeometry(8.0, 9.2, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45
    });

    for (const fx of fordCoords) {
      const rz = toFloat(computeRiverCenterZFx(toFx(fx), this.centerCoord));
      for (let s = -15; s <= 15; s += 3) {
        this._matScratch.makeTranslation(fx + (s % 2) * 2.2, -0.08, rz + s);
        pebbleInst.setMatrixAt(pIdx++, this._matScratch);
      }
      const ring = new THREE.Mesh(ringGeom, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(fx, -0.02, rz);
      this.rootGroup.add(ring);
      this.fordMarkers.push(ring);
    }
    pebbleInst.instanceMatrix.needsUpdate = true;
    this.rootGroup.add(pebbleInst);
  }

  _buildStoneBridge() {
    this.bridgeGroup = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x8a857a,
      roughness: 0.8,
      metalness: 0.1
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x656057, roughness: 0.85 });
    const brazierFlameMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });

    const customMap = getActiveCustomMapState();
    const isCustomActive = Boolean(customMap && customMap.isCustomMapActive && Array.isArray(customMap.bridges));
    const bridgesToBuild = isCustomActive
      ? customMap.bridges
      : getBridgeCentersMeters(this.centerCoord).map((bx) => ({
          x: bx,
          z: this.centerCoord,
          width: 20,
          length: 48
        }));

    const segments = 48;
    const pillarGeom = new THREE.BoxGeometry(1.3, 2.5, 1.3);
    const flameGeom = new THREE.SphereGeometry(0.45, 8, 8);

    for (let b = 0; b < bridgesToBuild.length; b++) {
      const bSpec = bridgesToBuild[b];
      const cx = Number(bSpec.x) || this.centerCoord;
      const cz = Number(bSpec.z) || this.centerCoord;
      const rotY = Number(bSpec.rotY) || 0;
      const bridgeWidth = Number(bSpec.width) || 20;
      const bridgeLen = Number(bSpec.length) || 48;
      const segLen = bridgeLen / segments;
      const slabGeom = new THREE.BoxGeometry(bridgeWidth, 0.44, segLen + 0.18);
      const wallGeom = new THREE.BoxGeometry(0.8, 1.15, segLen + 0.18);

      const singleBridgeGroup = new THREE.Group();
      singleBridgeGroup.position.set(cx, 0, cz);
      singleBridgeGroup.rotation.y = rotY;

      for (let i = 0; i < segments; i++) {
        const localZ0 = -bridgeLen * 0.5 + i * segLen;
        const localZ1 = localZ0 + segLen;
        const localZCenter = (localZ0 + localZ1) * 0.5;
        const tArch = Math.max(0, 1 - Math.abs(localZCenter) / Math.max(1, bridgeLen * 0.5));
        const deckY = 0.82 + 1.35 * (tArch * tArch * (3 - 2 * tArch));

        const slab = new THREE.Mesh(slabGeom, stoneMat);
        slab.position.set(0, deckY - 0.22, localZCenter);
        slab.castShadow = true;
        slab.receiveShadow = true;
        singleBridgeGroup.add(slab);

        for (const side of [-1, 1]) {
          const wall = new THREE.Mesh(wallGeom, trimMat);
          wall.position.set(side * (bridgeWidth * 0.5 - 0.4), deckY + 0.5, localZCenter);
          wall.castShadow = true;
          singleBridgeGroup.add(wall);
        }
      }
      for (const localPz of [-bridgeLen * 0.33, -bridgeLen * 0.1, bridgeLen * 0.1, bridgeLen * 0.33]) {
        const tArch = Math.max(0, 1 - Math.abs(localPz) / Math.max(1, bridgeLen * 0.5));
        const deckY = 0.82 + 1.35 * (tArch * tArch * (3 - 2 * tArch));
        const pierGeom = new THREE.CylinderGeometry(1.3, 1.65, Math.max(1, deckY + 3.2), 8);
        for (const side of [-1, 1]) {
          const pier = new THREE.Mesh(pierGeom, trimMat);
          pier.position.set(side * (bridgeWidth * 0.34), (deckY - 3.2) * 0.5, localPz);
          singleBridgeGroup.add(pier);

          const pillar = new THREE.Mesh(pillarGeom, stoneMat);
          pillar.position.set(side * (bridgeWidth * 0.5 - 0.4), deckY + 1.2, localPz);
          singleBridgeGroup.add(pillar);

          const flame = new THREE.Mesh(flameGeom, brazierFlameMat);
          flame.position.set(side * (bridgeWidth * 0.5 - 0.4), deckY + 2.65, localPz);
          singleBridgeGroup.add(flame);
        }
      }
      this.bridgeGroup.add(singleBridgeGroup);
    }

    if (this.bridgeGroup.children.length > 0) {
      mergeStaticGroupMeshesByMaterial(this.bridgeGroup, { castShadow: true, receiveShadow: true });
    }
    this.rootGroup.add(this.bridgeGroup);
  }

  _buildTreesAndMines() {
    this.propsGroup = new THREE.Group();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4028, roughness: 0.9 });
    const foliageMatA = new THREE.MeshStandardMaterial({ color: 0x264e26, roughness: 0.8 });
    const foliageMatB = new THREE.MeshStandardMaterial({ color: 0x325e2c, roughness: 0.8 });

    const trunkGeom = new THREE.CylinderGeometry(0.22, 0.35, 2.1, 6);
    const lowerCrownGeom = new THREE.ConeGeometry(1.5, 3.3, 7);
    const upperCrownGeom = new THREE.ConeGeometry(1.1, 2.5, 7);

    const treeList = generateDeterministicTreesFx(this.config, this.worldSize);
    const totalTrees = treeList.length;
    const countA = Math.max(1, Math.ceil(totalTrees / 2));
    const countB = Math.max(1, Math.floor(totalTrees / 2));

    this.trunkInstMesh = new THREE.InstancedMesh(trunkGeom, trunkMat, Math.max(1, totalTrees));
    this.trunkInstMesh.frustumCulled = false;
    this.trunkInstMesh.matrixAutoUpdate = false;

    this.lowerCrownInstA = new THREE.InstancedMesh(lowerCrownGeom, foliageMatA, countA);
    this.lowerCrownInstA.castShadow = true;
    this.lowerCrownInstA.frustumCulled = false;
    this.lowerCrownInstA.matrixAutoUpdate = false;

    this.upperCrownInstA = new THREE.InstancedMesh(upperCrownGeom, foliageMatA, countA);
    this.upperCrownInstA.castShadow = true;
    this.upperCrownInstA.frustumCulled = false;
    this.upperCrownInstA.matrixAutoUpdate = false;

    this.lowerCrownInstB = new THREE.InstancedMesh(lowerCrownGeom, foliageMatB, countB);
    this.lowerCrownInstB.castShadow = true;
    this.lowerCrownInstB.frustumCulled = false;
    this.lowerCrownInstB.matrixAutoUpdate = false;

    this.upperCrownInstB = new THREE.InstancedMesh(upperCrownGeom, foliageMatB, countB);
    this.upperCrownInstB.castShadow = true;
    this.upperCrownInstB.frustumCulled = false;
    this.upperCrownInstB.matrixAutoUpdate = false;

    let idxA = 0;
    let idxB = 0;

    for (let i = 0; i < totalTrees; i++) {
      const t = treeList[i];
      const tx = toFloat(t.xFx);
      const tz = toFloat(t.zFx);
      const groundY = toFloat(t.yFx);
      const scale = t.scalePermille / 1000;
      const skinId = t.skinId || 'pine_emerald';
      const isA = i % 2 === 0;
      const crownIdx = isA ? idxA++ : idxB++;

      let customSkinMesh = null;
      if (skinId && skinId !== 'pine_emerald') {
        customSkinMesh = createTreeMeshBySkin(skinId, scale, t.rotY || 0);
        customSkinMesh.position.set(tx, groundY, tz);
        this.propsGroup.add(customSkinMesh);
      }

      this._treeRecords.push({
        tx,
        tz,
        groundY,
        scale,
        skinId,
        customSkinMesh,
        isA,
        crownIdx
      });

      this._setTreeMatricesAt(i, false);
    }

    this.trunkInstMesh.instanceMatrix.needsUpdate = true;
    this.lowerCrownInstA.instanceMatrix.needsUpdate = true;
    this.upperCrownInstA.instanceMatrix.needsUpdate = true;
    this.lowerCrownInstB.instanceMatrix.needsUpdate = true;
    this.upperCrownInstB.instanceMatrix.needsUpdate = true;

    if (totalTrees > 0) {
      this.propsGroup.add(this.trunkInstMesh);
      this.propsGroup.add(this.lowerCrownInstA);
      this.propsGroup.add(this.upperCrownInstA);
      this.propsGroup.add(this.lowerCrownInstB);
      this.propsGroup.add(this.upperCrownInstB);
    }

    const mineList = generateDeterministicMinesFx(this.worldSize);
    for (let i = 0; i < mineList.length; i++) {
      const m = mineList[i];
      const mx = toFloat(m.xFx);
      const mz = toFloat(m.zFx);
      const my = toFloat(m.yFx);
      const rType = m.resourceType || 'coins';
      const skinId =
        m.skinId ||
        (rType === 'iron' ? 'iron_outcrop' : rType === 'stone' ? 'stone_granite' : 'gold_vein');
      const mineGroup = createMineMeshBySkin(rType, skinId, m.scale || 1.0, m.rotY || 0);
      mineGroup.position.set(mx, my, mz);
      if (!mineGroup.userData?.skipStaticMerge) {
        mergeStaticGroupMeshesByMaterial(mineGroup, { castShadow: true, receiveShadow: true });
      }
      this.propsGroup.add(mineGroup);
    }

    this.rootGroup.add(this.propsGroup);
  }

  _buildDecorativeProps() {
    const customMap = getActiveCustomMapState();
    if (!customMap || !customMap.isCustomMapActive || !Array.isArray(customMap.decorativeProps)) return;

    this.decorativePropsGroup = new THREE.Group();
    for (const p of customMap.decorativeProps) {
      const px = Number(p.x) || 2048;
      const pz = Number(p.z) || 2048;
      const py = toFloat(sampleTerrainHeightFx(toFx(px), toFx(pz), false, this.worldSize));
      const mesh = createDecorativePropMesh(p, customMap.customPropAssets || []);
      mesh.position.set(px, py, pz);
      this.decorativePropsGroup.add(mesh);
    }
    this.rootGroup.add(this.decorativePropsGroup);
  }

  _setTreeMatricesAt(treeIndex, isChopped) {
    const rec = this._treeRecords[treeIndex];
    if (!rec) return;
    const { tx, tz, groundY, scale, customSkinMesh, isA, crownIdx } = rec;

    if (customSkinMesh) {
      if (isChopped) {
        customSkinMesh.scale.set(scale * 1.1, scale * 0.18, scale * 1.1);
      } else {
        customSkinMesh.scale.set(scale, scale, scale);
      }
      // Hide instanced pine mesh for custom-skinned tree
      this._scaleScratch.set(0, 0, 0);
      this._matScratch.compose(this._posScratch, this._quatIdentity, this._scaleScratch);
      this.trunkInstMesh.setMatrixAt(treeIndex, this._matScratch);
      if (isA) {
        this.lowerCrownInstA.setMatrixAt(crownIdx, this._matScratch);
        this.upperCrownInstA.setMatrixAt(crownIdx, this._matScratch);
      } else {
        this.lowerCrownInstB.setMatrixAt(crownIdx, this._matScratch);
        this.upperCrownInstB.setMatrixAt(crownIdx, this._matScratch);
      }
      return;
    }

    if (isChopped) {
      this._posScratch.set(tx, groundY + 1.05 * scale * 0.25, tz);
      this._scaleScratch.set(1.22 * scale, scale * 0.25, 1.22 * scale);
      this._matScratch.compose(this._posScratch, this._quatIdentity, this._scaleScratch);
      this.trunkInstMesh.setMatrixAt(treeIndex, this._matScratch);

      this._scaleScratch.set(0, 0, 0);
      this._matScratch.compose(this._posScratch, this._quatIdentity, this._scaleScratch);
      if (isA) {
        this.lowerCrownInstA.setMatrixAt(crownIdx, this._matScratch);
        this.upperCrownInstA.setMatrixAt(crownIdx, this._matScratch);
      } else {
        this.lowerCrownInstB.setMatrixAt(crownIdx, this._matScratch);
        this.upperCrownInstB.setMatrixAt(crownIdx, this._matScratch);
      }
    } else {
      this._posScratch.set(tx, groundY + 1.05 * scale, tz);
      this._scaleScratch.set(scale, scale, scale);
      this._matScratch.compose(this._posScratch, this._quatIdentity, this._scaleScratch);
      this.trunkInstMesh.setMatrixAt(treeIndex, this._matScratch);

      this._posScratch.set(tx, groundY + 2.8 * scale, tz);
      this._matScratch.compose(this._posScratch, this._quatIdentity, this._scaleScratch);
      if (isA) {
        this.lowerCrownInstA.setMatrixAt(crownIdx, this._matScratch);
      } else {
        this.lowerCrownInstB.setMatrixAt(crownIdx, this._matScratch);
      }

      this._posScratch.set(tx, groundY + 4.4 * scale, tz);
      this._matScratch.compose(this._posScratch, this._quatIdentity, this._scaleScratch);
      if (isA) {
        this.upperCrownInstA.setMatrixAt(crownIdx, this._matScratch);
      } else {
        this.upperCrownInstB.setMatrixAt(crownIdx, this._matScratch);
      }
    }
  }

  syncDepletedTrees(depletedIds = []) {
    const key = depletedIds.join(',');
    if (key === this._lastDepletedKey) return;
    this._lastDepletedKey = key;

    const depletedSet = new Set(depletedIds);
    for (let i = 0; i < this._treeRecords.length; i++) {
      this._setTreeMatricesAt(i, depletedSet.has(i));
    }
    if (this.trunkInstMesh) this.trunkInstMesh.instanceMatrix.needsUpdate = true;
    if (this.lowerCrownInstA) this.lowerCrownInstA.instanceMatrix.needsUpdate = true;
    if (this.upperCrownInstA) this.upperCrownInstA.instanceMatrix.needsUpdate = true;
    if (this.lowerCrownInstB) this.lowerCrownInstB.instanceMatrix.needsUpdate = true;
    if (this.upperCrownInstB) this.upperCrownInstB.instanceMatrix.needsUpdate = true;
  }

  _buildTileGridOverlay() {
    this.gridOverlay = new THREE.GridHelper(this.worldSize, 256, 0x38bdf8, 0x334155);
    this.gridOverlay.position.set(this.centerCoord, 0.25, this.centerCoord);
    this.gridOverlay.material.transparent = true;
    this.gridOverlay.material.opacity = 0.25;
    this.gridOverlay.visible = false;
    this.rootGroup.add(this.gridOverlay);
  }

  setGridVisible(visible) {
    if (this.gridOverlay) this.gridOverlay.visible = Boolean(visible);
  }

  updateFogOfWar(fowGrid) {
    if (!fowGrid || !this.terrainMesh || !this._baseTerrainColors || !this._vertexFowCellIdx) return;
    const total = this._fowSize * this._fowSize;
    if (fowGrid.length !== total) return;

    const curr = this._fowCurrentBrightness;
    let changed = false;

    const isFirstSync = !this._hasInitialFowSync;
    this._hasInitialFowSync = true;
    for (let i = 0; i < total; i++) {
      const state = fowGrid[i];
      const target = state === 2 ? 255 : state === 1 ? 118 : 18;
      const c = curr[i];
      if (c !== target) {
        curr[i] = isFirstSync
          ? target
          : target > c
            ? Math.min(target, c + 36)
            : Math.max(target, c - 28);
        changed = true;
      }
    }

    if (changed) {
      if (this._fowTexRgba && this._fowDataTexture) {
        const rgba = this._fowTexRgba;
        for (let i = 0; i < total; i++) {
          const val = curr[i];
          const idx4 = i << 2;
          rgba[idx4] = val;
          rgba[idx4 + 1] = val;
          rgba[idx4 + 2] = val;
          rgba[idx4 + 3] = 255;
        }
        this._fowDataTexture.needsUpdate = true;
      }
      const fowAttr = this.terrainMesh.geometry.attributes.aFowFactor;
      if (fowAttr) {
        const dst = fowAttr.array;
        const vCells = this._vertexFowCellIdx;
        const vCount = vCells.length;
        for (let i = 0; i < vCount; i++) {
          dst[i] = curr[vCells[i]] * 0.00392156862745098;
        }
        fowAttr.needsUpdate = true;
      }
    }
  }

  update(dtSeconds, fowGrid = null, temporaryReveals = null) {
    this._elapsedTime += dtSeconds;
    if (this._revealCirclesUniform) {
      const list = Array.isArray(temporaryReveals) ? temporaryReveals : [];
      const activeKeys = new Set();
      for (let i = 0; i < 8; i++) {
        const rev = list[i];
        if (rev && typeof rev.wx === "number" && typeof rev.wz === "number") {
          const maxRad = Number(rev.radiusMeters) || 32;
          const rKey = `${Math.round(rev.wx * 10)}:${Math.round(rev.wz * 10)}:${Math.round(maxRad)}`;
          activeKeys.add(rKey);
          if (!this._revealStartTimes.has(rKey)) {
            this._revealStartTimes.set(rKey, this._elapsedTime);
          }
          const ageSec = Math.max(0, this._elapsedTime - this._revealStartTimes.get(rKey));
          const growU = Math.min(1.0, ageSec / 0.52);
          const easeOut = 1.0 - Math.pow(1.0 - growU, 1.85);
          const curRad = Math.max(0.8, easeOut * maxRad);
          this._revealCirclesUniform[i].set(rev.wx, rev.wz, curRad, 1.0);
        } else {
          this._revealCirclesUniform[i].set(0, 0, 0, 0.0);
        }
      }
      if (this._revealStartTimes.size > activeKeys.size) {
        for (const k of this._revealStartTimes.keys()) {
          if (!activeKeys.has(k)) this._revealStartTimes.delete(k);
        }
      }
    }
    if (fowGrid) {
      this.updateFogOfWar(fowGrid);
    }
    if (this.waterMesh) {
      this.waterMesh.position.y = (this._baseWaterLevel ?? 0) + Math.sin(this._elapsedTime * 2.2) * 0.04;
    }
    for (let i = 0; i < this.fordMarkers.length; i++) {
      const s = 1 + Math.sin(this._elapsedTime * 2.6 + i) * 0.08;
      this.fordMarkers[i].scale.set(s, s, 1);
    }
  }
}
