/**
 * Kings Lands — Unity-Style 3D Map Generator & Terrain Studio (60 FPS + Smooth Paint Blending + Stretch Bridge)
 * (src/tools/map_editor/mapEditorApp.js)
 *
 * Features:
 * 1. Smooth Per-Vertex Color Blending (`applyBiomePaintAt`) using `brushStrength` & `brushFalloff` (`colorOverrides`).
 * 2. Visual Swatch Grid for both Paint Brushes/Textures and Resource Skins (zero text clutter).
 * 3. 2-Point Stretchable & Auto-Rotated Bridge (`stretch_bridge`: Click Start Point A -> Stretch Ghost -> Click End Point B)
 *    plus Single-Click Rotatable Bridge (`place_bridge`) with Width & Rotation sliders.
 * 4. Map Size Control (`worldSizeMeters`: 1024m, 2048m, 3072m, 4096m) with 3D playable border indicator.
 * 5. Zero-Lag Incremental Eraser & Persistent Mesh Maps (`_treeMeshByUid`, `_mineMeshByUid`, `_propMeshById`):
 *    erasing only removes the targeted meshes inside the brush radius — zero full-scene rebuilds and zero object jumping!
 * 6. Dedicated "💾 Save Map" button that saves in-place without leaving the editor, plus "⬅️ Back to Main Menu".
 */

import * as THREE from 'three';
import { toFx, toFloat } from '../../core/fx.js';
import { sampleTerrainHeightFx } from '../../sim/nav/grid.js';
import { generateDeterministicTreesFx, generateDeterministicMinesFx } from '../../sim/world/worldGen.js';
import {
  MAP_VERTEX_RES,
  MAP_WORLD_SIZE,
  MAP_CELL_METERS,
  MAP_SIZE_PRESETS,
  BRUSH_SHAPES_CATALOG,
  renderBrushShapeSvg,
  TERRAIN_BIOME_LAYERS,
  RESOURCE_SKINS_CATALOG,
  DECORATIVE_PROPS_CATALOG,
  renderPaintBrushThumbnailSvg,
  renderSkinVisualThumbnailSvg,
  renderDecorativePropThumbnailSvg,
  getActiveCustomMapState,
  setActiveCustomMapState,
  getSavedMapsList,
  saveMapToLibrary,
  deleteMapFromLibrary,
  createDefaultMapState,
  createBlankFlatMapState,
  hydrateMapState,
  serializeMapState,
  createTreeMeshBySkin,
  createMineMeshBySkin,
  createDecorativePropMesh,
  createSpawnBeaconMesh,
  parseWavefrontObjToVertices,
  renderStaticMeshThumbnailDataUrl
} from './mapStateManager.js';

export const BRUSH_FALLOFF_PRESETS = Object.freeze([
  { id: 'smooth', label: 'Smooth Bell Curve' },
  { id: 'sphere', label: 'Hemisphere Dome' },
  { id: 'linear', label: 'Linear Cone' },
  { id: 'flat', label: 'Hard Flat Cylinder' },
  { id: 'noise', label: 'Organic Rocky Crag' }
]);

export function computeBrushShapeDistRatio(dx, dz, radius, shapeId = 'circle_smooth') {
  if (radius <= 0) return 2;
  if (shapeId === 'square') {
    return Math.max(Math.abs(dx), Math.abs(dz)) / radius;
  }
  if (shapeId === 'diamond') {
    return (Math.abs(dx) + Math.abs(dz)) / radius;
  }
  if (shapeId === 'star') {
    const dist = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    const starR = radius * (0.68 + 0.32 * Math.cos(ang * 5));
    return dist / Math.max(1, starR);
  }
  return Math.hypot(dx, dz) / radius;
}

export function evaluateBrushFalloff(distRatio, falloffId = 'smooth', worldX = 0, worldZ = 0) {
  const t = Math.max(0, Math.min(1, 1 - distRatio));
  if (t <= 0) return 0;
  if (falloffId === 'flat' || falloffId === 'circle_flat') return 1.0;
  if (falloffId === 'linear') return t;
  if (falloffId === 'sphere') return Math.sqrt(Math.max(0, 1 - distRatio * distRatio));
  if (falloffId === 'noise') {
    const smooth = t * t * (3 - 2 * t);
    const n = 0.65 + 0.35 * Math.sin(worldX * 0.17 + worldZ * 0.13) * Math.cos(worldX * 0.11 - worldZ * 0.19);
    return smooth * n;
  }
  return t * t * (3 - 2 * t);
}

export function computeBlendedColorOverridesPatch({
  worldX,
  worldZ,
  brushRadius = 64,
  brushStrength = 0.45,
  brushShape = 'circle_smooth',
  brushFalloff = 'smooth',
  cellMeters = MAP_CELL_METERS,
  mapRes = MAP_VERTEX_RES,
  getVertexRgb
}) {
  const radius = Math.max(8, Number(brushRadius) || 64);
  const strength = Math.max(0.02, Math.min(1.0, Number(brushStrength) || 0.45));
  const minIx = Math.max(0, Math.floor((worldX - radius) / cellMeters));
  const maxIx = Math.min(mapRes - 1, Math.ceil((worldX + radius) / cellMeters));
  const minIz = Math.max(0, Math.floor((worldZ - radius) / cellMeters));
  const maxIz = Math.min(mapRes - 1, Math.ceil((worldZ + radius) / cellMeters));
  const updates = new Map();

  for (let iz = minIz; iz <= maxIz; iz++) {
    for (let ix = minIx; ix <= maxIx; ix++) {
      const wx = ix * cellMeters;
      const wz = iz * cellMeters;
      const distRatio = computeBrushShapeDistRatio(wx - worldX, wz - worldZ, radius, brushShape);
      if (distRatio > 1.0) continue;

      const effFalloff = brushShape === 'circle_flat' ? 'flat' : brushFalloff;
      const w = evaluateBrushFalloff(distRatio, effFalloff, wx, wz) * strength;
      const blendAlpha = Math.max(0, Math.min(1, w * 0.85));
      if (blendAlpha <= 0.001) continue;

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = Math.max(0, Math.min(mapRes - 1, ix + dx));
          const nz = Math.max(0, Math.min(mapRes - 1, iz + dz));
          const [nr, ng, nb] = getVertexRgb(nz * mapRes + nx);
          sumR += nr;
          sumG += ng;
          sumB += nb;
          count++;
        }
      }

      const avgR = sumR / count;
      const avgG = sumG / count;
      const avgB = sumB / count;
      const vIdx = iz * mapRes + ix;
      const [cr, cg, cb] = getVertexRgb(vIdx);
      updates.set(vIdx, [
        Math.round((cr + (avgR - cr) * blendAlpha) * 1000) / 1000,
        Math.round((cg + (avgG - cg) * blendAlpha) * 1000) / 1000,
        Math.round((cb + (avgB - cb) * blendAlpha) * 1000) / 1000
      ]);
    }
  }
  return { minIx, maxIx, minIz, maxIz, updates };
}

const GHOST_VALID_MAT = new THREE.MeshStandardMaterial({
  color: 0x22c55e,
  emissive: 0x16a34a,
  emissiveIntensity: 0.65,
  roughness: 0.35,
  transparent: true,
  opacity: 0.58,
  depthWrite: false
});

const GHOST_INVALID_MAT = new THREE.MeshStandardMaterial({
  color: 0xef4444,
  emissive: 0xdc2626,
  emissiveIntensity: 0.65,
  roughness: 0.35,
  transparent: true,
  opacity: 0.58,
  depthWrite: false
});

export class MapEditorApp {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;

    const existing = getActiveCustomMapState();
    if (existing) {
      this.mapState = hydrateMapState(existing);
    } else {
      const baseTrees = generateDeterministicTreesFx({}, MAP_WORLD_SIZE);
      const baseMines = generateDeterministicMinesFx(MAP_WORLD_SIZE);
      this.mapState = createDefaultMapState(baseTrees, baseMines);
    }

    // Active Editor Tool State
    this.activeMainTab = 'sculpt'; // 'sculpt' | 'paint' | 'water' | 'resources' | 'props' | 'world'
    this.sculptMode = 'raise';     // 'raise' | 'lower' | 'smooth' | 'flatten' | 'ramp' | 'noise'
    this.brushFalloff = 'smooth';
    this.brushShape = 'circle_smooth';
    this.brushRadius = 64;         // meters
    this.brushStrength = 0.45;     // 0.05..1.0
    this.flattenTargetHeight = 4.5;
    this.rampStartPoint = null;

    this.paintMode = 'paint';      // 'paint' | 'blend'
    this.activeBiomeLayerId = 1;
    this.useCustomPaintHex = false;
    this.customPaintHex = '#4d7c0f';

    // Water & Bridge Tools: 'carve_river' | 'shallow_ford' | 'stretch_bridge' | 'place_bridge' | 'erase_bridge'
    this.waterToolMode = 'stretch_bridge';
    this.bridgeStretchStart = null;
    this.bridgeWidth = 20;
    this.bridgeLength = 48;
    this.bridgeRotDeg = 0;

    this.activeResourceType = 'wood'; // 'wood' | 'coins' | 'iron' | 'stone'
    this.activeResourceSkins = {
      wood: 'pine_emerald',
      coins: 'gold_vein',
      iron: 'iron_outcrop',
      stone: 'stone_granite'
    };
    this.resourcePlacementMode = 'single'; // 'single' | 'scatter' | 'erase'
    this.resourceScale = 1.0;
    this.resourceRotDeg = 0;

    this.activePropType = 'statue_king';
    this.propPlacementMode = 'place'; // 'place' | 'erase'
    this.propScale = 1.0;
    this.propRotDeg = 0;
    this.propColorHex = '#cbd5e1';

    this.spawnToolMode = 'place'; // 'place' | 'erase'
    this.spawnRotDeg = 0;

    // Persistent 3D mesh maps so deleting 1 tree/mine/prop never rebuilds or shifts any other object!
    this._treeMeshByUid = new Map();
    this._mineMeshByUid = new Map();
    this._propMeshById = new Map();
    this._nextUidCounter = 1;

    this._undoStack = [];
    this._redoStack = [];
    this._isPointerDown = false;
    this._isRightOrbiting = false;
    this._isMiddlePanning = false;
    this._lastMouseX = 0;
    this._lastMouseY = 0;
    this._lastHoverWorldPt = { x: 2048, y: 1.6, z: 2048 };
    this._lastScatterPos = null;
    this._keysDown = new Set();
    this._destroyed = false;

    this._baseHeights = new Float32Array(MAP_VERTEX_RES * MAP_VERTEX_RES);
    this._initBaseProceduralHeights();

    if (this.container && typeof document !== 'undefined') {
      this._buildUI();
      this._initThreeScene();
      this._bindEvents();
      this._animate();
    }
  }

  _initBaseProceduralHeights() {
    const prevActive = getActiveCustomMapState();
    setActiveCustomMapState(null);
    for (let iz = 0; iz < MAP_VERTEX_RES; iz++) {
      const wz = iz * this.getCellMeters();
      for (let ix = 0; ix < MAP_VERTEX_RES; ix++) {
        const wx = ix * this.getCellMeters();
        const h = toFloat(sampleTerrainHeightFx(toFx(wx), toFx(wz), false, MAP_WORLD_SIZE));
        this._baseHeights[iz * MAP_VERTEX_RES + ix] = h;
      }
    }
    if (prevActive) {
      setActiveCustomMapState(prevActive);
    }
  }

  getCellMeters() {
    return (this.mapState.worldSizeMeters || MAP_WORLD_SIZE) / (MAP_VERTEX_RES - 1);
  }

  getVertexHeight(vIdx) {
    const override = this.mapState.heightOverrides[vIdx];
    if (override !== undefined) return Number(override);
    if (this.mapState.isBlankFlatBase) {
      return Number.isFinite(Number(this.mapState.baseFlatHeightMeters))
        ? Number(this.mapState.baseFlatHeightMeters)
        : 1.6;
    }
    let baseH = this._baseHeights[vIdx] || 0;
    if (!this.mapState.hasCentralRiver && baseH < 0.8) {
      baseH = 1.45;
    }
    return baseH;
  }

  setVertexHeight(vIdx, hMeters) {
    const clamped = Math.max(-12, Math.min(48, Number(hMeters) || 0));
    this.mapState.heightOverrides[vIdx] = Math.round(clamped * 1000) / 1000;
  }

  _syncLegacySpawnsFromPoints() {
    const pts = this.mapState.spawnPoints || [];
    if (pts.length >= 1) {
      this.mapState.spawns.team1 = {
        x: pts[0].x,
        z: pts[0].z,
        facingDir: pts[0].facingDir ?? 256
      };
    }
    if (pts.length >= 2) {
      this.mapState.spawns.team2 = {
        x: pts[1].x,
        z: pts[1].z,
        facingDir: pts[1].facingDir ?? 768
      };
    }
  }

  pushUndoSnapshot() {
    const snap = {
      isBlankFlatBase: this.mapState.isBlankFlatBase,
      worldSizeMeters: this.mapState.worldSizeMeters || 4096,
      baseFlatHeightMeters: this.mapState.baseFlatHeightMeters,
      heightOverrides: { ...this.mapState.heightOverrides },
      biomeOverrides: { ...this.mapState.biomeOverrides },
      colorOverrides: { ...(this.mapState.colorOverrides || {}) },
      trees: this.mapState.trees.map((t) => ({ ...t })),
      mines: this.mapState.mines.map((m) => ({ ...m })),
      bridges: this.mapState.bridges.map((b) => ({ ...b })),
      decorativeProps: this.mapState.decorativeProps.map((p) => ({ ...p })),
      spawnPoints: (this.mapState.spawnPoints || []).map((s) => ({ ...s })),
      waterLevelMeters: this.mapState.waterLevelMeters,
      waterColorHex: this.mapState.waterColorHex,
      hasCentralRiver: this.mapState.hasCentralRiver
    };
    this._undoStack.push(snap);
    if (this._undoStack.length > 18) this._undoStack.shift();
    this._redoStack.length = 0;
  }

  undo() {
    if (this._undoStack.length === 0) return;
    const currentSnap = {
      isBlankFlatBase: this.mapState.isBlankFlatBase,
      worldSizeMeters: this.mapState.worldSizeMeters || 4096,
      baseFlatHeightMeters: this.mapState.baseFlatHeightMeters,
      heightOverrides: { ...this.mapState.heightOverrides },
      biomeOverrides: { ...this.mapState.biomeOverrides },
      colorOverrides: { ...(this.mapState.colorOverrides || {}) },
      trees: this.mapState.trees.map((t) => ({ ...t })),
      mines: this.mapState.mines.map((m) => ({ ...m })),
      bridges: this.mapState.bridges.map((b) => ({ ...b })),
      decorativeProps: this.mapState.decorativeProps.map((p) => ({ ...p })),
      spawnPoints: (this.mapState.spawnPoints || []).map((s) => ({ ...s })),
      waterLevelMeters: this.mapState.waterLevelMeters,
      waterColorHex: this.mapState.waterColorHex,
      hasCentralRiver: this.mapState.hasCentralRiver
    };
    this._redoStack.push(currentSnap);
    const prev = this._undoStack.pop();
    Object.assign(this.mapState, prev);
    this._syncLegacySpawnsFromPoints();
    this._rebuildAllVisuals();
    this._renderSidebarInspector();
  }

  redo() {
    if (this._redoStack.length === 0) return;
    const next = this._redoStack.pop();
    this.pushUndoSnapshot();
    Object.assign(this.mapState, next);
    this._syncLegacySpawnsFromPoints();
    this._rebuildAllVisuals();
    this._renderSidebarInspector();
  }

  // ==========================================================================
  // PLACEMENT VALIDATION & 3D GREEN / RED GHOST PREVIEW (INCLUDING STRETCH BRIDGE)
  // ==========================================================================
  isSinglePlacementRequested() {
    if (this.activeMainTab === 'resources' && this.resourcePlacementMode === 'single') return true;
    if (this.activeMainTab === 'props' && this.propPlacementMode === 'place') return true;
    if (
      this.activeMainTab === 'water' &&
      (this.waterToolMode === 'place_bridge' || this.waterToolMode === 'stretch_bridge')
    ) {
      return true;
    }
    if (this.activeMainTab === 'world' && this.spawnToolMode === 'place') return true;
    return false;
  }

  isPlacementLocationValid(worldX, worldZ) {
    const maxW = this.mapState.worldSizeMeters || MAP_WORLD_SIZE;
    if (worldX < 20 || worldX > maxW - 20 || worldZ < 20 || worldZ > maxW - 20) {
      return false;
    }
    if (
      this.activeMainTab === 'water' &&
      (this.waterToolMode === 'place_bridge' || this.waterToolMode === 'stretch_bridge')
    ) {
      return true;
    }

    const groundY = this._sampleEditorGroundY(worldX, worldZ);
    const waterY = this.mapState.waterLevelMeters;
    const allowWater = this.activeMainTab === 'props' && this.activePropType === 'dock_pier';
    if (!allowWater && groundY < waterY - 0.15) {
      return false;
    }

    const minClearance =
      this.activeMainTab === 'world'
        ? 36
        : this.activeMainTab === 'resources' && this.activeResourceType !== 'wood'
          ? 12
          : 3.0;
    for (let i = 0; i < this.mapState.mines.length; i++) {
      const m = this.mapState.mines[i];
      if (Math.hypot(m.x - worldX, m.z - worldZ) < minClearance) return false;
    }
    for (let i = 0; i < (this.mapState.spawnPoints || []).length; i++) {
      const sp = this.mapState.spawnPoints[i];
      if (Math.hypot(sp.x - worldX, sp.z - worldZ) < Math.max(18, minClearance)) return false;
    }
    return true;
  }

  _rebuildGhostPreviewMesh() {
    if (!this.ghostGroup) return;
    this.ghostGroup.clear();

    if (!this.isSinglePlacementRequested()) {
      this.ghostGroup.visible = false;
      if (this.brushRingMesh) this.brushRingMesh.visible = true;
      return;
    }

    let previewObj = null;
    if (this.activeMainTab === 'resources') {
      const rType = this.activeResourceType;
      const skinId = this.activeResourceSkins[rType] || RESOURCE_SKINS_CATALOG[rType]?.[0]?.id;
      const sc = Number(this.resourceScale) || 1.0;
      const rotRad = ((Number(this.resourceRotDeg) || 0) * Math.PI) / 180;
      if (rType === 'wood') {
        previewObj = createTreeMeshBySkin(skinId, sc, rotRad, this.mapState.customResourceSkins);
      } else {
        previewObj = createMineMeshBySkin(rType, skinId, sc, rotRad, this.mapState.customResourceSkins);
      }
    } else if (this.activeMainTab === 'props') {
      const sc = Number(this.propScale) || 1.0;
      const rotRad = ((Number(this.propRotDeg) || 0) * Math.PI) / 180;
      previewObj = createDecorativePropMesh(
        { propType: this.activePropType, scale: sc, rotY: rotRad, colorHex: this.propColorHex },
        this.mapState.customPropAssets
      );
    } else if (
      this.activeMainTab === 'water' &&
      (this.waterToolMode === 'place_bridge' || this.waterToolMode === 'stretch_bridge')
    ) {
      previewObj = new THREE.Group();
      const w = Number(this.bridgeWidth) || 20;
      const len = Number(this.bridgeLength) || 48;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 1.0), GHOST_VALID_MAT);
      deck.name = 'ghost_bridge_deck';
      deck.position.y = 1.6;
      deck.scale.set(1, 1, len);
      previewObj.add(deck);
      previewObj.rotation.y = ((Number(this.bridgeRotDeg) || 0) * Math.PI) / 180;
    } else if (this.activeMainTab === 'world' && this.spawnToolMode === 'place') {
      const facingDir = Math.round(((Number(this.spawnRotDeg) || 0) / 360) * 1024) & 1023;
      previewObj = createSpawnBeaconMesh((this.mapState.spawnPoints?.length || 0) + 1, facingDir);
    }

    if (previewObj) {
      this.ghostGroup.add(previewObj);
      this.ghostGroup.visible = true;
      if (this.brushRingMesh) this.brushRingMesh.visible = false;
      this._updateGhostTransformAndValidity(this._lastHoverWorldPt.x, this._lastHoverWorldPt.z);
    }
  }

  _updateGhostTransformAndValidity(worldX, worldZ) {
    if (!this.ghostGroup || !this.ghostGroup.visible) return;

    // Special handling for 2-Point Stretch Bridge (Point A -> Point B)
    if (
      this.activeMainTab === 'water' &&
      this.waterToolMode === 'stretch_bridge' &&
      this.bridgeStretchStart
    ) {
      const p0 = this.bridgeStretchStart;
      const dx = worldX - p0.x;
      const dz = worldZ - p0.z;
      const stretchLen = Math.max(14, Math.min(280, Math.hypot(dx, dz)));
      const rotY = Math.atan2(dx, dz);
      const cx = (p0.x + worldX) * 0.5;
      const cz = (p0.z + worldZ) * 0.5;
      const gy = Math.max(this.mapState.waterLevelMeters, this._sampleEditorGroundY(cx, cz));
      this.ghostGroup.position.set(cx, gy, cz);
      const inner = this.ghostGroup.children[0];
      if (inner) {
        inner.rotation.y = rotY;
        const deck = inner.getObjectByName('ghost_bridge_deck');
        if (deck) deck.scale.set(1, 1, stretchLen);
      }
      this.ghostGroup.traverse((child) => {
        if (child.isMesh) child.material = GHOST_VALID_MAT;
      });
      return;
    }

    const gy = this._sampleEditorGroundY(worldX, worldZ);
    this.ghostGroup.position.set(worldX, gy, worldZ);

    const isValid = this.isPlacementLocationValid(worldX, worldZ);
    const targetMat = isValid ? GHOST_VALID_MAT : GHOST_INVALID_MAT;
    this.ghostGroup.traverse((child) => {
      if (child.isMesh) {
        child.material = targetMat;
      }
    });
  }

  // ==========================================================================
  // CORE TERRAIN, SMOOTH PAINT BLENDING & INCREMENTAL OBJECT OPERATIONS
  // ==========================================================================
  applyTerrainBrushAt(worldX, worldZ, dtSec = 0.05) {
    const radius = Math.max(8, Number(this.brushRadius) || 64);
    const strength = Math.max(0.02, Math.min(1.0, Number(this.brushStrength) || 0.45));
    const minIx = Math.max(0, Math.floor((worldX - radius) / this.getCellMeters()));
    const maxIx = Math.min(MAP_VERTEX_RES - 1, Math.ceil((worldX + radius) / this.getCellMeters()));
    const minIz = Math.max(0, Math.floor((worldZ - radius) / this.getCellMeters()));
    const maxIz = Math.min(MAP_VERTEX_RES - 1, Math.ceil((worldZ + radius) / this.getCellMeters()));

    if (this.sculptMode === 'smooth') {
      const tempHeights = new Map();
      for (let iz = minIz; iz <= maxIz; iz++) {
        for (let ix = minIx; ix <= maxIx; ix++) {
          const wx = ix * this.getCellMeters();
          const wz = iz * this.getCellMeters();
          const distRatio = computeBrushShapeDistRatio(wx - worldX, wz - worldZ, radius, this.brushShape);
          if (distRatio > 1.0) continue;
          const effFalloff = this.brushShape === 'circle_flat' ? 'flat' : this.brushFalloff;
          const w = evaluateBrushFalloff(distRatio, effFalloff, wx, wz) * strength;
          let sum = 0;
          let count = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = Math.max(0, Math.min(MAP_VERTEX_RES - 1, ix + dx));
              const nz = Math.max(0, Math.min(MAP_VERTEX_RES - 1, iz + dz));
              sum += this.getVertexHeight(nz * MAP_VERTEX_RES + nx);
              count++;
            }
          }
          const avg = sum / count;
          const vIdx = iz * MAP_VERTEX_RES + ix;
          const cur = this.getVertexHeight(vIdx);
          tempHeights.set(vIdx, cur + (avg - cur) * Math.min(1, w * 0.85));
        }
      }
      for (const [vIdx, hVal] of tempHeights.entries()) {
        this.setVertexHeight(vIdx, hVal);
      }
    } else {
      for (let iz = minIz; iz <= maxIz; iz++) {
        for (let ix = minIx; ix <= maxIx; ix++) {
          const wx = ix * this.getCellMeters();
          const wz = iz * this.getCellMeters();
          const distRatio = computeBrushShapeDistRatio(wx - worldX, wz - worldZ, radius, this.brushShape);
          if (distRatio > 1.0) continue;
          const effFalloff = this.brushShape === 'circle_flat' ? 'flat' : this.brushFalloff;
          const falloff = evaluateBrushFalloff(distRatio, effFalloff, wx, wz);
          const vIdx = iz * MAP_VERTEX_RES + ix;
          const curH = this.getVertexHeight(vIdx);

          if (this.sculptMode === 'raise') {
            this.setVertexHeight(vIdx, curH + falloff * strength * 14.0 * dtSec);
          } else if (this.sculptMode === 'lower') {
            this.setVertexHeight(vIdx, curH - falloff * strength * 14.0 * dtSec);
          } else if (this.sculptMode === 'flatten') {
            const target = Number(this.flattenTargetHeight) || 0;
            const blend = Math.min(1, falloff * strength);
            this.setVertexHeight(vIdx, curH + (target - curH) * blend);
          } else if (this.sculptMode === 'noise') {
            const n =
              Math.sin(wx * 0.09 + wz * 0.07) * 1.4 +
              Math.cos(wx * 0.21 - wz * 0.17) * 0.85;
            this.setVertexHeight(vIdx, curH + n * falloff * strength * 6.0 * dtSec);
          }
        }
      }
    }

    this._updateTerrainVertexPatch(minIx, maxIx, minIz, maxIz);
    this._syncPlacedObjectsYInRadius(worldX, worldZ, radius + 16);
  }

  applyRampBetween(p0, p1) {
    if (!p0 || !p1) return;
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq < 4) return;
    const radius = Math.max(16, Number(this.brushRadius) || 48);
    const minIx = Math.max(0, Math.floor((Math.min(p0.x, p1.x) - radius) / this.getCellMeters()));
    const maxIx = Math.min(MAP_VERTEX_RES - 1, Math.ceil((Math.max(p0.x, p1.x) + radius) / this.getCellMeters()));
    const minIz = Math.max(0, Math.floor((Math.min(p0.z, p1.z) - radius) / this.getCellMeters()));
    const maxIz = Math.min(MAP_VERTEX_RES - 1, Math.ceil((Math.max(p0.z, p1.z) + radius) / this.getCellMeters()));

    for (let iz = minIz; iz <= maxIz; iz++) {
      for (let ix = minIx; ix <= maxIx; ix++) {
        const wx = ix * this.getCellMeters();
        const wz = iz * this.getCellMeters();
        const t = Math.max(0, Math.min(1, ((wx - p0.x) * dx + (wz - p0.z) * dz) / lenSq));
        const projX = p0.x + t * dx;
        const projZ = p0.z + t * dz;
        const dist = Math.hypot(wx - projX, wz - projZ);
        if (dist > radius) continue;
        const w = evaluateBrushFalloff(dist / radius, 'smooth', wx, wz);
        const targetH = p0.y + t * (p1.y - p0.y);
        const vIdx = iz * MAP_VERTEX_RES + ix;
        const curH = this.getVertexHeight(vIdx);
        this.setVertexHeight(vIdx, curH + (targetH - curH) * w);
      }
    }
    this._updateTerrainVertexPatch(minIx, maxIx, minIz, maxIz);
    this._syncPlacedObjectsYInRadius((p0.x + p1.x) * 0.5, (p0.z + p1.z) * 0.5, Math.hypot(dx, dz) + radius);
  }

  _getElevationNaturalRgb(h) {
    const waterY = this.mapState.waterLevelMeters;
    if (h < waterY - 0.35) return [0.11, 0.18, 0.21];
    if (h <= waterY + 0.3) return [0.65, 0.58, 0.42];
    if (h < 4.6) {
      const t = Math.max(0, Math.min(1, (h - 0.22) / 4.38));
      return [0.25 + t * 0.08, 0.42 + t * 0.05, 0.20 + t * 0.04];
    }
    if (h < 8.5) {
      const t = Math.max(0, Math.min(1, (h - 4.6) / 3.9));
      return [0.33 + t * 0.08, 0.47 - t * 0.08, 0.24 + t * 0.12];
    }
    return [0.55, 0.53, 0.50];
  }

  _getCurrentVertexRgb(vIdx, h) {
    if (!this.mapState.colorOverrides) this.mapState.colorOverrides = {};
    const customRgb = this.mapState.colorOverrides[vIdx];
    if (Array.isArray(customRgb) && customRgb.length >= 3) {
      return customRgb;
    }
    const biomeId = this.mapState.biomeOverrides?.[vIdx] || 0;
    if (biomeId > 0) {
      const layer = TERRAIN_BIOME_LAYERS.find((x) => x.id === biomeId);
      const c = new THREE.Color(layer ? layer.hex : '#3f6b34');
      return [c.r, c.g, c.b];
    }
    return this._getElevationNaturalRgb(h);
  }

  /**
   * Smoothly blends/fades vertex colors toward the selected Biome Layer or Custom Hex Color
   * proportional to `this.brushStrength` (5%..100%) and `this.brushFalloff`!
   */
  applyBiomePaintAt(worldX, worldZ, biomeId = this.activeBiomeLayerId) {
    if (!this.mapState.colorOverrides) this.mapState.colorOverrides = {};
    const radius = Math.max(8, Number(this.brushRadius) || 64);
    const strength = Math.max(0.02, Math.min(1.0, Number(this.brushStrength) || 0.45));
    const minIx = Math.max(0, Math.floor((worldX - radius) / this.getCellMeters()));
    const maxIx = Math.min(MAP_VERTEX_RES - 1, Math.ceil((worldX + radius) / this.getCellMeters()));
    const minIz = Math.max(0, Math.floor((worldZ - radius) / this.getCellMeters()));
    const maxIz = Math.min(MAP_VERTEX_RES - 1, Math.ceil((worldZ + radius) / this.getCellMeters()));

    const layer = TERRAIN_BIOME_LAYERS.find((b) => b.id === biomeId);
    const targetHex = this.useCustomPaintHex ? this.customPaintHex : (layer ? layer.hex : '#3b6e2e');
    const targetCol = new THREE.Color(targetHex);

    for (let iz = minIz; iz <= maxIz; iz++) {
      for (let ix = minIx; ix <= maxIx; ix++) {
        const wx = ix * this.getCellMeters();
        const wz = iz * this.getCellMeters();
        const distRatio = computeBrushShapeDistRatio(wx - worldX, wz - worldZ, radius, this.brushShape);
        if (distRatio > 1.0) continue;

        const effFalloff = this.brushShape === 'circle_flat' ? 'flat' : this.brushFalloff;
        const falloff = evaluateBrushFalloff(distRatio, effFalloff, wx, wz);
        const blendAlpha = Math.max(0, Math.min(1, falloff * strength));
        if (blendAlpha <= 0.001) continue;

        const vIdx = iz * MAP_VERTEX_RES + ix;
        const h = this.getVertexHeight(vIdx);
        const [cr, cg, cb] = this._getCurrentVertexRgb(vIdx, h);

        if (biomeId === 0 && !this.useCustomPaintHex) {
          // Smoothly fade back toward natural elevation color
          const [nr0, ng0, nb0] = this._getElevationNaturalRgb(h);
          const nr = cr + (nr0 - cr) * blendAlpha;
          const ng = cg + (ng0 - cg) * blendAlpha;
          const nb = cb + (nb0 - cb) * blendAlpha;
          if (Math.hypot(nr - nr0, ng - ng0, nb - nb0) < 0.02) {
            delete this.mapState.colorOverrides[vIdx];
            delete this.mapState.biomeOverrides[vIdx];
          } else {
            this.mapState.colorOverrides[vIdx] = [
              Math.round(nr * 1000) / 1000,
              Math.round(ng * 1000) / 1000,
              Math.round(nb * 1000) / 1000
            ];
          }
        } else {
          const nr = cr + (targetCol.r - cr) * blendAlpha;
          const ng = cg + (targetCol.g - cg) * blendAlpha;
          const nb = cb + (targetCol.b - cb) * blendAlpha;
          this.mapState.colorOverrides[vIdx] = [
            Math.round(nr * 1000) / 1000,
            Math.round(ng * 1000) / 1000,
            Math.round(nb * 1000) / 1000
          ];
          if (blendAlpha >= 0.3 && !this.useCustomPaintHex) {
            this.mapState.biomeOverrides[vIdx] = biomeId;
          }
        }
      }
    }
    this._updateTerrainVertexPatch(minIx, maxIx, minIz, maxIz);
  }

  applyPaintBlendAt(worldX, worldZ) {
    if (!this.mapState.colorOverrides) this.mapState.colorOverrides = {};
    const { minIx, maxIx, minIz, maxIz, updates } = computeBlendedColorOverridesPatch({
      worldX,
      worldZ,
      brushRadius: this.brushRadius,
      brushStrength: this.brushStrength,
      brushShape: this.brushShape,
      brushFalloff: this.brushFalloff,
      cellMeters: this.getCellMeters(),
      mapRes: MAP_VERTEX_RES,
      getVertexRgb: (vIdx) => this._getCurrentVertexRgb(vIdx, this.getVertexHeight(vIdx))
    });
    for (const [vIdx, rgb] of updates.entries()) {
      this.mapState.colorOverrides[vIdx] = rgb;
    }
    this._updateTerrainVertexPatch(minIx, maxIx, minIz, maxIz);
  }

  placeBridgeBetweenPoints(p0, p1) {
    if (!p0 || !p1) return;
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const length = Math.max(16, Math.min(280, Math.round(Math.hypot(dx, dz))));
    const rotY = Math.atan2(dx, dz);
    const cx = Math.round((p0.x + p1.x) * 0.5);
    const cz = Math.round((p0.z + p1.z) * 0.5);
    const width = Math.max(8, Number(this.bridgeWidth) || 20);

    this.mapState.bridges.push({
      id: `bridge_${Date.now()}_${Math.floor(Math.random() * 999)}`,
      x: cx,
      z: cz,
      rotY: Math.round(rotY * 1000) / 1000,
      width,
      length
    });
    this._rebuildBridgesGroup();
    this._updateStatsHud();
  }

  applyWaterToolAt(worldX, worldZ) {
    if (this.waterToolMode === 'carve_river') {
      const prevMode = this.sculptMode;
      const prevTarget = this.flattenTargetHeight;
      this.sculptMode = 'flatten';
      this.flattenTargetHeight = (this.mapState.waterLevelMeters || 0) - 2.1;
      this.applyTerrainBrushAt(worldX, worldZ, 0.12);
      this.applyBiomePaintAt(worldX, worldZ, 9);
      this.sculptMode = prevMode;
      this.flattenTargetHeight = prevTarget;
    } else if (this.waterToolMode === 'shallow_ford') {
      const prevMode = this.sculptMode;
      const prevTarget = this.flattenTargetHeight;
      this.sculptMode = 'flatten';
      this.flattenTargetHeight = (this.mapState.waterLevelMeters || 0) - 0.12;
      this.applyTerrainBrushAt(worldX, worldZ, 0.14);
      this.applyBiomePaintAt(worldX, worldZ, 10);
      this.sculptMode = prevMode;
      this.flattenTargetHeight = prevTarget;
    } else if (this.waterToolMode === 'place_bridge') {
      this.mapState.bridges.push({
        id: `bridge_${Date.now()}_${Math.floor(Math.random() * 999)}`,
        x: Math.round(worldX),
        z: Math.round(worldZ),
        rotY: ((Number(this.bridgeRotDeg) || 0) * Math.PI) / 180,
        width: Math.max(8, Number(this.bridgeWidth) || 20),
        length: Math.max(16, Number(this.bridgeLength) || 48)
      });
      this._rebuildBridgesGroup();
      this._updateStatsHud();
    } else if (this.waterToolMode === 'erase_bridge') {
      const r = Math.max(25, this.brushRadius);
      this.mapState.bridges = this.mapState.bridges.filter(
        (b) => Math.hypot(b.x - worldX, b.z - worldZ) > r
      );
      this._rebuildBridgesGroup();
      this._updateStatsHud();
    }
  }

  /**
   * ZERO-JUMPING & ZERO-LAG INCREMENTAL ERASER:
   * Only removes the specific 3D meshes inside `radius` at `(worldX, worldZ)` —
   * NEVER rebuilds or re-indexes any tree/mine/prop outside the brush!
   */
  _eraseResourcesInRadius(worldX, worldZ, radius) {
    let anyRemoved = false;
    const keptTrees = [];
    for (let i = 0; i < this.mapState.trees.length; i++) {
      const t = this.mapState.trees[i];
      if (computeBrushShapeDistRatio(t.x - worldX, t.z - worldZ, radius, this.brushShape) <= 1.0) {
        const mesh = this._treeMeshByUid.get(t.uid);
        if (mesh && this.resourcesGroup) {
          this.resourcesGroup.remove(mesh);
        }
        this._treeMeshByUid.delete(t.uid);
        anyRemoved = true;
      } else {
        keptTrees.push(t);
      }
    }
    this.mapState.trees = keptTrees;

    const keptMines = [];
    for (let i = 0; i < this.mapState.mines.length; i++) {
      const m = this.mapState.mines[i];
      if (computeBrushShapeDistRatio(m.x - worldX, m.z - worldZ, radius, this.brushShape) <= 1.0) {
        const mesh = this._mineMeshByUid.get(m.uid);
        if (mesh && this.resourcesGroup) {
          this.resourcesGroup.remove(mesh);
        }
        this._mineMeshByUid.delete(m.uid);
        anyRemoved = true;
      } else {
        keptMines.push(m);
      }
    }
    this.mapState.mines = keptMines;

    if (anyRemoved) {
      this._updateStatsHud();
    }
  }

  placeOrScatterResourceAt(worldX, worldZ) {
    const resType = this.activeResourceType;
    const skinId =
      this.activeResourceSkins[resType] ||
      RESOURCE_SKINS_CATALOG[resType]?.[0]?.id ||
      'pine_emerald';

    if (this.resourcePlacementMode === 'erase') {
      const r = Math.max(8, this.brushRadius);
      this._eraseResourcesInRadius(worldX, worldZ, r);
      return;
    }

    if (this.resourcePlacementMode === 'single' && !this.isPlacementLocationValid(worldX, worldZ)) {
      return;
    }

    const rotRad = ((Number(this.resourceRotDeg) || 0) * Math.PI) / 180;
    const baseScale = Number(this.resourceScale) || 1.0;

    if (resType === 'wood') {
      if (this.resourcePlacementMode === 'single') {
        const uid = `tree_${Date.now()}_${this._nextUidCounter++}`;
        const newTree = {
          uid,
          id: this.mapState.trees.length,
          x: Math.round(worldX * 10) / 10,
          z: Math.round(worldZ * 10) / 10,
          scale: baseScale,
          rotY: rotRad,
          skinId
        };
        this.mapState.trees.push(newTree);
        this._appendSingleTreeMesh(newTree);
      } else {
        const maxW = this.mapState.worldSizeMeters || MAP_WORLD_SIZE;
        const count = Math.max(2, Math.min(8, Math.round(this.brushRadius / 16)));
        for (let i = 0; i < count; i++) {
          let ox = 0;
          let oz = 0;
          for (let tries = 0; tries < 10; tries++) {
            const rx = (Math.random() * 2 - 1) * this.brushRadius;
            const rz = (Math.random() * 2 - 1) * this.brushRadius;
            if (computeBrushShapeDistRatio(rx, rz, this.brushRadius, this.brushShape) <= 0.92) {
              ox = rx;
              oz = rz;
              break;
            }
          }
          const tx = Math.max(24, Math.min(maxW - 24, worldX + ox));
          const tz = Math.max(24, Math.min(maxW - 24, worldZ + oz));
          if (!this.isPlacementLocationValid(tx, tz)) continue;
          const randScale = Math.round(baseScale * (0.85 + Math.random() * 0.3) * 100) / 100;
          const uid = `tree_${Date.now()}_${this._nextUidCounter++}`;
          const newTree = {
            uid,
            id: this.mapState.trees.length,
            x: Math.round(tx * 10) / 10,
            z: Math.round(tz * 10) / 10,
            scale: randScale,
            rotY: Math.random() * Math.PI * 2,
            skinId
          };
          this.mapState.trees.push(newTree);
          this._appendSingleTreeMesh(newTree);
        }
      }
    } else {
      const nextId =
        this.mapState.mines.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;
      const uid = `mine_${Date.now()}_${this._nextUidCounter++}`;
      const newMine = {
        uid,
        id: nextId,
        x: Math.round(worldX),
        z: Math.round(worldZ),
        type: resType,
        skinId,
        rotY: rotRad,
        scale: baseScale
      };
      this.mapState.mines.push(newMine);
      this._appendSingleMineMesh(newMine);
    }

    this._updateStatsHud();
    this._updateGhostTransformAndValidity(worldX, worldZ);
  }

  clearAllResources() {
    this.pushUndoSnapshot();
    this.mapState.trees = [];
    this.mapState.mines = [];
    this._rebuildResourcesGroup();
    this._updateStatsHud();
    this._renderSidebarInspector();
  }

  placeOrEraseDecorativePropAt(worldX, worldZ) {
    if (this.propPlacementMode === 'erase') {
      const r = Math.max(8, this.brushRadius);
      const kept = [];
      let anyRemoved = false;
      for (let i = 0; i < this.mapState.decorativeProps.length; i++) {
        const p = this.mapState.decorativeProps[i];
        if (computeBrushShapeDistRatio(p.x - worldX, p.z - worldZ, r, this.brushShape) <= 1.0) {
          const mesh = this._propMeshById.get(p.id);
          if (mesh && this.propsGroup) {
            this.propsGroup.remove(mesh);
          }
          this._propMeshById.delete(p.id);
          anyRemoved = true;
        } else {
          kept.push(p);
        }
      }
      this.mapState.decorativeProps = kept;
      if (anyRemoved) this._updateStatsHud();
      return;
    }

    if (!this.isPlacementLocationValid(worldX, worldZ)) return;

    const newProp = {
      id: `prop_${Date.now()}_${this._nextUidCounter++}`,
      propType: this.activePropType,
      x: Math.round(worldX * 10) / 10,
      z: Math.round(worldZ * 10) / 10,
      scale: Number(this.propScale) || 1.0,
      rotY: ((Number(this.propRotDeg) || 0) * Math.PI) / 180,
      colorHex: this.propColorHex || '#cbd5e1'
    };
    this.mapState.decorativeProps.push(newProp);
    this._appendSinglePropMesh(newProp);
    this._updateStatsHud();
  }

  deleteCustomPropAsset(assetId) {
    if (!assetId || !Array.isArray(this.mapState.customPropAssets)) return false;
    const idx = this.mapState.customPropAssets.findIndex((a) => a.id === assetId);
    if (idx < 0) return false;
    if (typeof this.pushUndoSnapshot === 'function') this.pushUndoSnapshot();
    this.mapState.customPropAssets.splice(idx, 1);
    if (Array.isArray(this.mapState.decorativeProps)) {
      this.mapState.decorativeProps = this.mapState.decorativeProps.filter(
        (p) => p.customAssetId !== assetId && p.propType !== assetId
      );
    }
    if (this.activePropType === assetId) {
      this.activePropType = DECORATIVE_PROPS_CATALOG[0]?.id || 'statue_king';
      const def = DECORATIVE_PROPS_CATALOG.find((p) => p.id === this.activePropType);
      if (def?.defaultColor) this.propColorHex = def.defaultColor;
    }
    this._rebuildPropsGroup?.();
    this._renderSidebarInspector?.();
    this._rebuildGhostPreviewMesh?.();
    return true;
  }

  deleteCustomResourceSkin(resourceType, skinId) {
    const bucket = this.mapState.customResourceSkins?.[resourceType];
    if (!skinId || !Array.isArray(bucket)) return false;
    const idx = bucket.findIndex((s) => s.id === skinId);
    if (idx < 0) return false;
    if (typeof this.pushUndoSnapshot === 'function') this.pushUndoSnapshot();
    bucket.splice(idx, 1);
    const fallbackSkin = RESOURCE_SKINS_CATALOG[resourceType]?.[0]?.id || 'pine_emerald';
    if (resourceType === 'wood') {
      for (const t of this.mapState.trees || []) {
        if (t.skinId === skinId) t.skinId = fallbackSkin;
      }
    } else {
      for (const m of this.mapState.mines || []) {
        if (m.type === resourceType && m.skinId === skinId) m.skinId = fallbackSkin;
      }
    }
    if (this.activeResourceSkins?.[resourceType] === skinId) {
      this.activeResourceSkins[resourceType] = fallbackSkin;
    }
    this._rebuildResourcesGroup?.();
    this._renderSidebarInspector?.();
    this._rebuildGhostPreviewMesh?.();
    return true;
  }

  async importGlbPropFromBuffer(arrayBuffer, fileName = 'object.glb') {
    const { readGlb } = await import('../import/glbReader.js');
    const { buildStaticMeshFromScene } = await import('../import/glbToUnit.js');
    const scene = await readGlb(arrayBuffer);
    const mesh = buildStaticMeshFromScene(scene, {
      rotateYDeg: 0,
      budget: 3500,
      smoothNormals: true,
      fit: { mode: 'size', size: 6.0, anchor: 'base', offset: [0, 0, 0] }
    });
    const id = `custom_prop_glb_${Date.now()}_${this._nextUidCounter++}`;
    const name = String(fileName || 'object').replace(/\.[^.]+$/, '') || 'Custom Object';
    const thumbnailDataUrl = renderStaticMeshThumbnailDataUrl(mesh);
    const asset = {
      id,
      name,
      kind: 'glb',
      vertices: mesh.vertices,
      faces: mesh.faces,
      colors: mesh.colors,
      thumbnailDataUrl
    };
    if (!Array.isArray(this.mapState.customPropAssets)) this.mapState.customPropAssets = [];
    this.mapState.customPropAssets.push(asset);
    this.activePropType = id;
    this._renderSidebarInspector?.();
    this._rebuildGhostPreviewMesh?.();
    return asset;
  }

  async importGlbResourceFromBuffer(arrayBuffer, fileName = 'resource.glb', resourceType = this.activeResourceType) {
    const rType = ['wood', 'coins', 'iron', 'stone'].includes(resourceType) ? resourceType : 'wood';
    const { readGlb } = await import('../import/glbReader.js');
    const { buildStaticMeshFromScene } = await import('../import/glbToUnit.js');
    const scene = await readGlb(arrayBuffer);
    const targetSize = rType === 'wood' ? 5.5 : 5.0;
    const mesh = buildStaticMeshFromScene(scene, {
      rotateYDeg: 0,
      budget: 3000,
      smoothNormals: true,
      fit: { mode: 'size', size: targetSize, anchor: 'base', offset: [0, 0, 0] }
    });
    const id = `custom_res_${rType}_${Date.now()}_${this._nextUidCounter++}`;
    const name = String(fileName || 'resource').replace(/\.[^.]+$/, '') || 'Custom Resource';
    const thumbnailDataUrl = renderStaticMeshThumbnailDataUrl(mesh);
    const entry = {
      id,
      name,
      kind: 'glb',
      vertices: mesh.vertices,
      faces: mesh.faces,
      colors: mesh.colors,
      thumbnailDataUrl
    };
    if (!this.mapState.customResourceSkins || typeof this.mapState.customResourceSkins !== 'object') {
      this.mapState.customResourceSkins = { wood: [], coins: [], iron: [], stone: [] };
    }
    if (!Array.isArray(this.mapState.customResourceSkins[rType])) {
      this.mapState.customResourceSkins[rType] = [];
    }
    this.mapState.customResourceSkins[rType].push(entry);
    this.activeResourceSkins[rType] = id;
    this._renderSidebarInspector?.();
    this._rebuildGhostPreviewMesh?.();
    return entry;
  }

  deleteCustomGroundTexture(texId) {
    if (!texId || !Array.isArray(this.mapState.customTextures)) return false;
    const idx = this.mapState.customTextures.findIndex((t) => t.id === texId);
    if (idx < 0) return false;
    this.mapState.customTextures.splice(idx, 1);
    if (this.mapState.activeGroundTextureId === texId) {
      this.mapState.activeGroundTextureId = 'none';
    }
    this._applyGroundTextureMaterial?.();
    this._renderSidebarInspector?.();
    return true;
  }

  placeOrEraseSpawnPointAt(worldX, worldZ) {
    if (!Array.isArray(this.mapState.spawnPoints)) {
      this.mapState.spawnPoints = [];
    }
    if (this.spawnToolMode === 'erase') {
      const r = Math.max(24, this.brushRadius);
      this.mapState.spawnPoints = this.mapState.spawnPoints.filter(
        (sp) => Math.hypot(sp.x - worldX, sp.z - worldZ) > r
      );
      this._syncLegacySpawnsFromPoints();
      this._rebuildSpawnsGroup();
      this._renderSidebarInspector();
      return;
    }

    if (!this.isPlacementLocationValid(worldX, worldZ)) return;

    const idx = this.mapState.spawnPoints.length + 1;
    const facingDir = Math.round(((Number(this.spawnRotDeg) || 0) / 360) * 1024) & 1023;
    this.mapState.spawnPoints.push({
      id: `spawn_${Date.now()}_${idx}`,
      name: `Start Point ${idx}`,
      x: Math.round(worldX),
      z: Math.round(worldZ),
      facingDir
    });
    this._syncLegacySpawnsFromPoints();
    this._rebuildSpawnsGroup();
    this._renderSidebarInspector();
    this._rebuildGhostPreviewMesh();
  }

  // ==========================================================================
  // UI CONSTRUCTION
  // ==========================================================================
  _buildUI() {
    this.container.innerHTML = '';
    this.container.className = 'fixed inset-0 z-40 flex flex-col bg-slate-950 text-slate-100 select-none overflow-hidden';

    const savedMaps = getSavedMapsList();
    const curSize = this.mapState.worldSizeMeters || 4096;
    const topBar = document.createElement('div');
    topBar.className =
      'flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-3 py-2 shadow-xl z-20';
    topBar.innerHTML = `
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-base">🗺️</span>
        <input id="map-editor-name-input" type="text" value="${this.mapState.name || 'Custom Map'}"
          class="w-36 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-bold text-amber-300 focus:border-amber-400 focus:outline-none" />

        <!-- Map Size Selector -->
        <select id="select-map-size" title="Playable Map Size" class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-semibold text-sky-300 cursor-pointer">
          ${MAP_SIZE_PRESETS.map(
            (s) => `<option value="${s.sizeMeters}" ${curSize === s.sizeMeters ? 'selected' : ''}>📐 ${s.label}</option>`
          ).join('')}
        </select>

        <!-- Saved Maps Dropdown + New Blank Flat Map -->
        <select id="select-saved-map" class="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-semibold text-slate-200 cursor-pointer">
          <option value="__current__">📂 Load Map (${savedMaps.length + 1})...</option>
          <option value="default_royal_valley">🏰 Royal Valley Crossroads (Default)</option>
          ${savedMaps.map((m) => `<option value="${m.id}">🗺️ ${m.name}</option>`).join('')}
        </select>

        <button id="btn-new-flat-map" type="button" class="rounded-lg border border-emerald-500/60 bg-emerald-500/15 hover:bg-emerald-500/30 px-2.5 py-1 text-xs font-extrabold text-emerald-300 cursor-pointer transition">
          ✨ + New Flat Map
        </button>
      </div>

      <!-- Main Tool Category Tabs -->
      <div id="map-editor-main-tabs" class="flex flex-wrap items-center gap-1">
        <button data-tab="sculpt" class="map-tab-btn rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer">⛰️ Sculpt</button>
        <button data-tab="paint" class="map-tab-btn rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer">🎨 Paint</button>
        <button data-tab="water" class="map-tab-btn rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer">💧 Water &amp; Bridge</button>
        <button data-tab="resources" class="map-tab-btn rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer">🌲 Resources</button>
        <button data-tab="props" class="map-tab-btn rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer">🗿 Objects</button>
        <button data-tab="world" class="map-tab-btn rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer">🚩 Spawns (${(this.mapState.spawnPoints || []).length})</button>
      </div>

      <!-- Save Only + Export/Import + Back to Main Menu -->
      <div class="flex items-center gap-1.5">
        <button id="btn-map-undo" type="button" title="Undo (Ctrl+Z)" class="rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2 py-1 text-xs font-semibold text-slate-200 cursor-pointer">↩️</button>
        <button id="btn-map-redo" type="button" title="Redo (Ctrl+Y)" class="rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2 py-1 text-xs font-semibold text-slate-200 cursor-pointer">↪️</button>
        <button id="btn-map-export" type="button" class="rounded border border-sky-500/50 bg-sky-500/15 hover:bg-sky-500/30 px-2 py-1 text-xs font-bold text-sky-300 cursor-pointer">Export</button>
        <label class="rounded border border-indigo-500/50 bg-indigo-500/15 hover:bg-indigo-500/30 px-2 py-1 text-xs font-bold text-indigo-300 cursor-pointer">
          Import
          <input id="input-map-import-json" type="file" accept=".json" class="hidden" />
        </label>
        <button id="btn-save-map-library" type="button" class="rounded-lg border border-emerald-400 bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-extrabold text-white shadow cursor-pointer transition">
          💾 שמור מפה (Save)
        </button>
        <button id="btn-map-exit" type="button" class="rounded-lg border border-amber-400/70 bg-amber-500/20 hover:bg-amber-500/35 px-3 py-1 text-xs font-extrabold text-amber-200 cursor-pointer transition">
          ⬅️ לעמוד הראשי
        </button>
      </div>
    `;
    this.container.appendChild(topBar);
    this.topBarEl = topBar;

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'relative flex flex-1 overflow-hidden';

    this.sidebarEl = document.createElement('aside');
    this.sidebarEl.className =
      'w-76 max-w-[300px] min-w-[280px] h-full overflow-y-auto border-r border-slate-800 bg-slate-900/95 p-3.5 flex flex-col gap-3 z-10';
    bodyWrap.appendChild(this.sidebarEl);

    this.viewportEl = document.createElement('div');
    this.viewportEl.className = 'relative flex-1 h-full overflow-hidden bg-slate-950 cursor-crosshair';
    bodyWrap.appendChild(this.viewportEl);

    this.hudPillEl = document.createElement('div');
    this.hudPillEl.className =
      'pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 text-xs';
    this.hudPillEl.innerHTML = `
      <div class="rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 text-slate-300 shadow backdrop-blur">
        <span class="font-bold text-amber-300">Controls:</span>
        Click/Drag = Apply | <span class="text-emerald-300 font-semibold">R / Q / E = Rotate</span> | Right-Drag = Orbit | WASD = Pan
      </div>
      <div class="flex items-center gap-2">
        <div id="map-editor-stats-line" class="mono rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 text-amber-300 shadow backdrop-blur"></div>
        <div id="map-cursor-coords" class="mono rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 text-sky-300 shadow backdrop-blur">
          X: 2048m | Z: 2048m | Y: 1.60m
        </div>
      </div>
    `;
    this.viewportEl.appendChild(this.hudPillEl);

    this.container.appendChild(bodyWrap);

    this._wireTopBarActions(topBar);
    this._updateMainTabStyles();
    this._renderSidebarInspector();
  }

  _refreshSavedMapsDropdown() {
    const sel = this.topBarEl?.querySelector('#select-saved-map');
    if (!sel) return;
    const savedMaps = getSavedMapsList();
    sel.innerHTML = `
      <option value="__current__">📂 Load Map (${savedMaps.length + 1})...</option>
      <option value="default_royal_valley">🏰 Royal Valley Crossroads (Default)</option>
      ${savedMaps.map((m) => `<option value="${m.id}">🗺️ ${m.name}</option>`).join('')}
    `;
  }

  _openNewMapSizeModal() {
    if (typeof document === 'undefined') return;
    document.getElementById('kings-lands-new-map-modal')?.remove();
    const curSize = Number(this.mapState.worldSizeMeters) || 4096;
    const defaultName = `מפה חדשה ${getSavedMapsList().length + 1}`;
    const modal = document.createElement('div');
    modal.id = 'kings-lands-new-map-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm';
    modal.innerHTML = `
      <div class="w-full max-w-sm rounded-2xl border border-amber-400/50 bg-slate-900 p-5 shadow-2xl space-y-4" dir="rtl">
        <h3 class="text-base font-extrabold text-amber-300">✨ יצירת מפה חדשה</h3>
        <div>
          <label class="block text-xs text-slate-300 mb-1">שם המפה:</label>
          <input id="new-map-name-inp" type="text" value="${defaultName}" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-slate-100" />
        </div>
        <div>
          <label class="block text-xs text-slate-300 mb-1">בחר גודל מפה פיזי מראש:</label>
          <select id="new-map-size-sel" class="w-full rounded-lg border border-sky-500/50 bg-slate-950 px-3 py-2 text-sm font-bold text-sky-200 cursor-pointer">
            <option value="1024" ${curSize === 1024 ? 'selected' : ''}>1024m × 1024m (קטנה ומהירה)</option>
            <option value="2048" ${curSize === 2048 ? 'selected' : ''}>2048m × 2048m (בינונית)</option>
            <option value="3072" ${curSize === 3072 ? 'selected' : ''}>3072m × 3072m (גדולה)</option>
            <option value="4096" ${curSize === 4096 ? 'selected' : ''}>4096m × 4096m (ענקית)</option>
          </select>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button id="btn-new-map-cancel" type="button" class="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-bold text-slate-300 cursor-pointer">ביטול</button>
          <button id="btn-new-map-create" type="button" class="rounded-lg border border-emerald-400 bg-emerald-600 hover:bg-emerald-500 px-4 py-1.5 text-xs font-extrabold text-white cursor-pointer">צור מפה</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#btn-new-map-cancel')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#btn-new-map-create')?.addEventListener('click', () => {
      const mName = modal.querySelector('#new-map-name-inp')?.value?.trim() || defaultName;
      const mSize = Number(modal.querySelector('#new-map-size-sel')?.value) || 4096;
      modal.remove();
      const flatMap = createBlankFlatMapState(mName, mSize);
      this._loadMapStateIntoEditor(flatMap);
    });
  }

  _loadMapStateIntoEditor(newState) {
    this.pushUndoSnapshot();
    this.mapState = hydrateMapState(newState);
    const nameInput = this.topBarEl?.querySelector('#map-editor-name-input');
    if (nameInput) nameInput.value = this.mapState.name;
    const sizeSelect = this.topBarEl?.querySelector('#select-map-size');
    if (sizeSelect) sizeSelect.value = String(this.mapState.worldSizeMeters || 4096);
    this._rebuildAllVisuals();
    this._renderSidebarInspector();
  }

  _wireTopBarActions(topBar) {
    const nameInput = topBar.querySelector('#map-editor-name-input');
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        this.mapState.name = nameInput.value.trim() || 'Custom Map';
      });
    }

    const sizeSelect = topBar.querySelector('#select-map-size');
    if (sizeSelect) {
      sizeSelect.addEventListener('change', () => {
        this.pushUndoSnapshot();
        this.mapState.worldSizeMeters = Number(sizeSelect.value) || 4096;
        this._rebuildPhysicalTerrainGeometry();
        this._updateTerrainGeometryAttributes();
        this._updateStatsHud();
      });
    }

    const mapSelect = topBar.querySelector('#select-saved-map');
    if (mapSelect) {
      mapSelect.addEventListener('change', () => {
        const val = mapSelect.value;
        if (val === '__current__') return;
        if (val === 'default_royal_valley') {
          setActiveCustomMapState(null);
          const baseTrees = generateDeterministicTreesFx({}, MAP_WORLD_SIZE);
          const baseMines = generateDeterministicMinesFx(MAP_WORLD_SIZE);
          this._loadMapStateIntoEditor(createDefaultMapState(baseTrees, baseMines));
        } else {
          const found = getSavedMapsList().find((m) => m.id === val);
          if (found) this._loadMapStateIntoEditor(found);
        }
        mapSelect.value = '__current__';
      });
    }

    topBar.querySelector('#btn-new-flat-map')?.addEventListener('click', () => {
      this._openNewMapSizeModal();
    });

    // Dedicated SAVE ONLY button (does not leave the editor!)
    const saveOnlyBtn = topBar.querySelector('#btn-save-map-library');
    if (saveOnlyBtn) {
      saveOnlyBtn.addEventListener('click', () => {
        this._syncLegacySpawnsFromPoints();
        this.mapState.isCustomMapActive = true;
        this.mapState = saveMapToLibrary(this.mapState);
        setActiveCustomMapState(this.mapState);
        this._refreshSavedMapsDropdown();
        this._renderSidebarInspector();
        const origText = saveOnlyBtn.textContent;
        saveOnlyBtn.textContent = '✓ המפה נשמרה!';
        setTimeout(() => {
          if (saveOnlyBtn) saveOnlyBtn.textContent = origText;
        }, 1600);
      });
    }

    topBar.querySelectorAll('.map-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeMainTab = btn.getAttribute('data-tab') || 'sculpt';
        this.bridgeStretchStart = null;
        this._updateMainTabStyles();
        this._renderSidebarInspector();
        this._rebuildGhostPreviewMesh();
      });
    });

    topBar.querySelector('#btn-map-undo')?.addEventListener('click', () => this.undo());
    topBar.querySelector('#btn-map-redo')?.addEventListener('click', () => this.redo());

    topBar.querySelector('#btn-map-export')?.addEventListener('click', () => {
      this._syncLegacySpawnsFromPoints();
      const dataStr = JSON.stringify(serializeMapState({ ...this.mapState, isCustomMapActive: true }), null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(this.mapState.name || 'kings_lands_map').toLowerCase().replace(/\s+/g, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    const importInput = topBar.querySelector('#input-map-import-json');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result || '{}'));
            this._loadMapStateIntoEditor({ ...parsed, isCustomMapActive: true });
          } catch (err) {
            console.error('Failed to import map JSON:', err);
          }
        };
        reader.readAsText(file);
      });
    }

    topBar.querySelector('#btn-map-exit')?.addEventListener('click', () => {
      this._syncLegacySpawnsFromPoints();
      this.mapState.isCustomMapActive = true;
      this.mapState = saveMapToLibrary(this.mapState);
      setActiveCustomMapState(this.mapState);
      if (typeof this.options.onExitMapEditor === 'function') {
        this.options.onExitMapEditor({ saved: true, mapState: this.mapState });
      }
    });
  }

  _updateMainTabStyles() {
    if (!this.container) return;
    this.container.querySelectorAll('.map-tab-btn').forEach((btn) => {
      const tab = btn.getAttribute('data-tab');
      if (tab === 'world') {
        btn.textContent = `🚩 Spawns (${(this.mapState.spawnPoints || []).length})`;
      }
      const isActive = tab === this.activeMainTab;
      btn.className = isActive
        ? 'map-tab-btn rounded-lg border border-amber-400 bg-amber-500/25 px-2.5 py-1 text-xs font-extrabold text-amber-200 shadow cursor-pointer'
        : 'map-tab-btn rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-300 cursor-pointer';
    });
  }

  _updateStatsHud() {
    const el = this.container?.querySelector('#map-editor-stats-line');
    const sz = this.mapState.worldSizeMeters || 4096;
    if (el) {
      el.textContent = `${sz}m×${sz}m | Trees:${this.mapState.trees.length} | Mines:${this.mapState.mines.length} | Bridges:${this.mapState.bridges.length} | Spawns:${(this.mapState.spawnPoints || []).length}`;
    }
    this._updateMainTabStyles();
  }

  // ==========================================================================
  // SIDEBAR INSPECTOR PANELS
  // ==========================================================================
  _renderSidebarInspector() {
    if (!this.sidebarEl) return;
    this._updateStatsHud();

    const brushControlsHtml = `
      <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-amber-400">🖌️ Brush Size &amp; Strength</span>
          <span id="lbl-brush-radius" class="mono text-xs text-sky-300">${this.brushRadius}m</span>
        </div>
        <div>
          <label class="block text-[11px] text-slate-400 mb-1">Radius (8m – 320m)</label>
          <input id="slider-brush-radius" type="range" min="8" max="320" step="4" value="${this.brushRadius}" class="w-full accent-amber-400 cursor-pointer" />
        </div>
        <div>
          <div class="flex justify-between text-[11px] text-slate-400 mb-1">
            <span>Brush Strength (Fade / Speed)</span>
            <span id="lbl-brush-strength" class="mono text-amber-300">${Math.round(this.brushStrength * 100)}%</span>
          </div>
          <input id="slider-brush-strength" type="range" min="5" max="100" step="5" value="${Math.round(this.brushStrength * 100)}" class="w-full accent-amber-400 cursor-pointer" />
        </div>
        <div>
          <label class="block text-[11px] text-slate-400 mb-1">Brush Shape</label>
          <div class="grid grid-cols-5 gap-1">
            ${BRUSH_SHAPES_CATALOG.map(
              (bs) => `
              <button type="button" data-brush-shape="${bs.id}" title="${bs.label}"
                class="brush-shape-btn flex items-center justify-center rounded-lg border p-1 cursor-pointer ${
                  this.brushShape === bs.id
                    ? 'border-amber-400 bg-amber-500/25 shadow'
                    : 'border-slate-800 bg-slate-900 hover:bg-slate-800'
                }">
                ${renderBrushShapeSvg(bs.id)}
              </button>`
            ).join('')}
          </div>
        </div>
        <div>
          <label class="block text-[11px] text-slate-400 mb-1">Falloff Curve</label>
          <select id="select-brush-falloff" class="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-100 cursor-pointer">
            ${BRUSH_FALLOFF_PRESETS.map(
              (f) => `<option value="${f.id}" ${this.brushFalloff === f.id ? 'selected' : ''}>${f.label}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    `;

    if (this.activeMainTab === 'sculpt') {
      const modes = [
        { id: 'raise', label: '⬆️ Raise Terrain' },
        { id: 'lower', label: '⬇️ Lower / Excavate' },
        { id: 'smooth', label: '🌊 Smooth Slopes' },
        { id: 'flatten', label: '📏 Flatten to Target Height' },
        { id: 'ramp', label: '📐 Slope Ramp (Click A then B)' },
        { id: 'noise', label: '🌋 Organic Crag Noise' }
      ];
      this.sidebarEl.innerHTML = `
        <div class="space-y-3">
          <h2 class="text-xs font-extrabold uppercase tracking-wider text-amber-300">⛰️ Terrain Sculpting</h2>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Sculpt Operation</label>
            <select id="select-sculpt-mode" class="w-full rounded-lg border border-amber-500/50 bg-slate-950 px-2.5 py-2 text-xs font-bold text-amber-200 cursor-pointer">
              ${modes.map((m) => `<option value="${m.id}" ${this.sculptMode === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </div>

          <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
            <div class="flex justify-between text-xs">
              <span class="font-semibold text-slate-300">Target Plateau Height</span>
              <span id="lbl-flatten-height" class="mono font-bold text-emerald-300">${this.flattenTargetHeight.toFixed(1)}m</span>
            </div>
            <input id="slider-flatten-height" type="range" min="-4" max="28" step="0.5" value="${this.flattenTargetHeight}" class="w-full accent-emerald-400 cursor-pointer" />
          </div>

          ${brushControlsHtml}
        </div>
      `;
    } else if (this.activeMainTab === 'paint') {
      // Visual Swatch Grid for Paint Brushes & Ground Textures (just like Skins!)
      this.sidebarEl.innerHTML = `
        <div class="space-y-3">
          <h2 class="text-xs font-extrabold uppercase tracking-wider text-amber-300">🎨 Visual Paint &amp; Texture Swatches</h2>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Paint Operation</label>
            <select id="select-paint-mode" class="w-full rounded-lg border border-amber-500/50 bg-slate-950 px-2.5 py-2 text-xs font-bold text-amber-200 cursor-pointer">
              <option value="paint" ${this.paintMode === 'paint' ? 'selected' : ''}>🖌️ Paint Color / Biome</option>
              <option value="blend" ${this.paintMode === 'blend' ? 'selected' : ''}>🌫️ Blend (Smooth Transitions)</option>
            </select>
            ${
              this.paintMode === 'blend'
                ? '<div class="mt-1.5 rounded border border-amber-500/40 bg-amber-950/30 px-2 py-1 text-[10.5px] text-amber-200">Drag across painted edges to smoothly blend color &amp; biome transitions.</div>'
                : ''
            }
          </div>

          <div class="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 space-y-2 ${this.paintMode === 'blend' ? 'opacity-65' : ''}">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-amber-300">🖌️ Paint Color / Biome Swatch</span>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] text-slate-400">Custom:</span>
                <input id="input-custom-paint-hex" type="color" value="${this.customPaintHex}" class="h-6 w-8 rounded border ${this.useCustomPaintHex && this.paintMode === 'paint' ? 'border-amber-400 ring-2 ring-amber-400/50' : 'border-slate-700'} bg-slate-900 cursor-pointer" />
              </div>
            </div>
            <div class="grid grid-cols-4 gap-1.5">
              ${TERRAIN_BIOME_LAYERS.map((b) => {
                const isSel = this.paintMode === 'paint' && !this.useCustomPaintHex && this.activeBiomeLayerId === b.id;
                return `
                <button type="button" data-biome-id="${b.id}" title="${b.label}"
                  class="biome-swatch-btn flex items-center justify-center rounded-xl border p-1 transition cursor-pointer ${
                    isSel
                      ? 'border-amber-400 bg-amber-500/25 shadow-lg scale-105'
                      : 'border-slate-800 bg-slate-900/90 hover:bg-slate-800'
                  }">
                  ${renderPaintBrushThumbnailSvg(b)}
                </button>`;
              }).join('')}
            </div>
          </div>

          <!-- Visual Ground Texture Swatches -->
          <div class="rounded-xl border border-sky-500/40 bg-sky-950/20 p-2.5 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-sky-300">🖼️ Ground Texture Overlay</span>
              <label class="rounded border border-sky-400/70 bg-sky-500/20 hover:bg-sky-500/35 px-2 py-0.5 text-[10px] font-bold text-sky-200 cursor-pointer">
                + Upload PNG/JPG
                <input id="input-upload-ground-tex" type="file" accept="image/*" class="hidden" />
              </label>
            </div>
            <div class="grid grid-cols-4 gap-1.5">
              <button type="button" data-ground-tex="none" title="No Texture Overlay (Colors Only)"
                class="ground-tex-swatch flex items-center justify-center rounded-lg border h-11 cursor-pointer ${
                  this.mapState.activeGroundTextureId === 'none'
                    ? 'border-amber-400 bg-amber-500/25 text-amber-200 font-bold text-xs'
                    : 'border-slate-700 bg-slate-900 text-slate-400 text-xs'
                }">
                ✕
              </button>
              ${this.mapState.customTextures
                .map(
                  (tex) => `
                <div class="relative">
                  <button type="button" data-ground-tex="${tex.id}" title="${tex.name}"
                    class="ground-tex-swatch w-full rounded-lg border overflow-hidden h-11 cursor-pointer ${
                      this.mapState.activeGroundTextureId === tex.id
                        ? 'border-amber-400 ring-2 ring-amber-400/50'
                        : 'border-slate-700'
                    }">
                    <img src="${tex.dataUrl}" class="w-full h-full object-cover" alt="" />
                  </button>
                  <button type="button" data-del-custom-tex="${tex.id}" title="Delete imported texture"
                    class="absolute top-0.5 right-0.5 z-10 flex h-4 w-4 items-center justify-center rounded bg-rose-700 hover:bg-rose-600 text-[10px] font-bold text-white cursor-pointer">✕</button>
                </div>`
                )
                .join('')}
            </div>
            <div>
              <div class="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Texture Repeat Scale</span>
                <span id="lbl-tex-repeat" class="mono text-sky-300">${this.mapState.groundTextureRepeat}×</span>
              </div>
              <input id="slider-tex-repeat" type="range" min="4" max="128" step="4" value="${this.mapState.groundTextureRepeat}" class="w-full accent-sky-400 cursor-pointer" />
            </div>
          </div>

          ${brushControlsHtml}
        </div>
      `;
    } else if (this.activeMainTab === 'water') {
      const waterModes = [
        { id: 'stretch_bridge', label: '🌉 Stretch Bridge (Click Start → Click End)' },
        { id: 'place_bridge', label: '🌉 Place Rotatable Bridge (Single Click)' },
        { id: 'erase_bridge', label: '🗑️ Remove Bridge' },
        { id: 'carve_river', label: '🌊 Carve Deep River / Lake' },
        { id: 'shallow_ford', label: '🦶 Paint Shallow Walkable Ford' }
      ];
      this.sidebarEl.innerHTML = `
        <div class="space-y-3">
          <h2 class="text-xs font-extrabold uppercase tracking-wider text-sky-300">💧 Water &amp; Stretchable Bridges</h2>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Bridge / Water Tool</label>
            <select id="select-water-mode" class="w-full rounded-lg border border-sky-500/50 bg-slate-950 px-2.5 py-2 text-xs font-bold text-sky-200 cursor-pointer">
              ${waterModes.map((m) => `<option value="${m.id}" ${this.waterToolMode === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </div>

          ${
            this.waterToolMode === 'stretch_bridge' || this.waterToolMode === 'place_bridge'
              ? `<!-- Bridge Width, Length & Rotation Controls -->
          <div class="rounded-xl border border-amber-500/40 bg-slate-950/80 p-3 space-y-2.5">
            <div class="text-xs font-bold text-amber-300">🌉 Bridge Dimensions &amp; Angle</div>
            ${
              this.waterToolMode === 'stretch_bridge'
                ? `<div class="rounded bg-emerald-950/60 border border-emerald-500/40 px-2.5 py-1.5 text-[11px] text-emerald-200">
                    ${this.bridgeStretchStart ? '✅ נקודת התחלה נבחרה! לחץ על נקודת הסיום למתיחת הגשר' : '1️⃣ לחץ על נקודת ההתחלה של הגשר ואז על נקודת הסיום'}
                  </div>`
                : ''
            }
            <div>
              <div class="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Bridge Width</span>
                <span id="lbl-bridge-width" class="mono text-amber-300">${this.bridgeWidth}m</span>
              </div>
              <input id="slider-bridge-width" type="range" min="8" max="36" step="2" value="${this.bridgeWidth}" class="w-full accent-amber-400 cursor-pointer" />
            </div>
            ${
              this.waterToolMode === 'place_bridge'
                ? `<div>
                    <div class="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Bridge Length</span>
                      <span id="lbl-bridge-len" class="mono text-amber-300">${this.bridgeLength}m</span>
                    </div>
                    <input id="slider-bridge-len" type="range" min="16" max="160" step="4" value="${this.bridgeLength}" class="w-full accent-amber-400 cursor-pointer" />
                  </div>
                  <div>
                    <div class="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Bridge Rotation (R / Q / E)</span>
                      <span id="lbl-bridge-rot" class="mono text-amber-300">${this.bridgeRotDeg}°</span>
                    </div>
                    <input id="slider-bridge-rot" type="range" min="0" max="360" step="15" value="${this.bridgeRotDeg}" class="w-full accent-amber-400 cursor-pointer" />
                  </div>`
                : ''
            }
          </div>`
              : ''
          }

          <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5">
            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="font-semibold text-slate-300">Water Level</span>
                <span id="lbl-water-level" class="mono text-sky-300">${this.mapState.waterLevelMeters.toFixed(2)}m</span>
              </div>
              <input id="slider-water-level" type="range" min="-3.0" max="6.0" step="0.1" value="${this.mapState.waterLevelMeters}" class="w-full accent-sky-400 cursor-pointer" />
            </div>

            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-300">Water Color</span>
              <input id="input-water-color" type="color" value="${this.mapState.waterColorHex || '#22789b'}" class="h-7 w-14 rounded border border-slate-700 bg-slate-900 cursor-pointer" />
            </div>

            <label class="flex items-center justify-between text-xs font-semibold text-slate-300 cursor-pointer pt-1">
              <span>Default Central River</span>
              <input id="chk-central-river" type="checkbox" ${this.mapState.hasCentralRiver ? 'checked' : ''} class="h-4 w-4 accent-sky-400 cursor-pointer" />
            </label>
          </div>

          ${this.waterToolMode === 'carve_river' || this.waterToolMode === 'shallow_ford' ? brushControlsHtml : ''}
        </div>
      `;
    } else if (this.activeMainTab === 'resources') {
      const resourceOptions = [
        { id: 'wood', label: `🌲 Wood / Trees (${this.mapState.trees.length})` },
        { id: 'coins', label: `🪙 Gold Mines (${this.mapState.mines.filter((m) => m.type === 'coins').length})` },
        { id: 'iron', label: `⚔️ Iron Mines (${this.mapState.mines.filter((m) => m.type === 'iron').length})` },
        { id: 'stone', label: `🪨 Stone Quarries (${this.mapState.mines.filter((m) => m.type === 'stone').length})` }
      ];
      const shippedSkins = (RESOURCE_SKINS_CATALOG[this.activeResourceType] || []).map((s) => ({ ...s, isCustom: false }));
      const customSkins = (this.mapState.customResourceSkins?.[this.activeResourceType] || []).map((s) => ({ ...s, isCustom: true }));
      const skinsForActive = [...shippedSkins, ...customSkins];
      const currentSkinId = this.activeResourceSkins[this.activeResourceType] || skinsForActive[0]?.id;

      this.sidebarEl.innerHTML = `
        <div class="space-y-3">
          <h2 class="text-xs font-extrabold uppercase tracking-wider text-emerald-300">🌲⛏️ Resources &amp; Visual Skins</h2>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Resource Type</label>
            <select id="select-res-type" class="w-full rounded-lg border border-emerald-500/60 bg-slate-950 px-2.5 py-2 text-xs font-bold text-emerald-200 cursor-pointer">
              ${resourceOptions.map((r) => `<option value="${r.id}" ${this.activeResourceType === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Placement Action</label>
            <select id="select-res-mode" class="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-200 cursor-pointer">
              <option value="single" ${this.resourcePlacementMode === 'single' ? 'selected' : ''}>📍 Single Object (Green/Red 3D Ghost)</option>
              <option value="scatter" ${this.resourcePlacementMode === 'scatter' ? 'selected' : ''}>🌲 Brush Scatter Grove</option>
              <option value="erase" ${this.resourcePlacementMode === 'erase' ? 'selected' : ''}>🗑️ Erase Resource at Cursor</option>
            </select>
          </div>

          <div class="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="block text-[11px] font-bold text-amber-300">🎨 Skin Appearance</span>
              <label class="rounded border border-emerald-400/70 bg-emerald-500/20 hover:bg-emerald-500/35 px-2 py-0.5 text-[10px] font-bold text-emerald-200 cursor-pointer">
                + Upload .GLB
                <input id="input-upload-custom-resource" type="file" accept=".glb" class="hidden" />
              </label>
            </div>
            <div class="grid grid-cols-3 gap-2">
              ${skinsForActive
                .map((sk) => {
                  const isSel = sk.id === currentSkinId;
                  const thumb = sk.thumbnailDataUrl
                    ? `<img src="${sk.thumbnailDataUrl}" class="w-12 h-12 object-contain rounded" alt="" />`
                    : renderSkinVisualThumbnailSvg(this.activeResourceType, sk);
                  return `
                  <div class="relative">
                    <button type="button" data-skin-id="${sk.id}" title="${sk.name}"
                      class="res-skin-btn w-full flex flex-col items-center justify-center rounded-xl border p-2 transition cursor-pointer ${
                        isSel
                          ? 'border-amber-400 bg-amber-500/25 shadow-lg scale-105'
                          : 'border-slate-800 bg-slate-900/90 hover:bg-slate-800'
                      }">
                      ${thumb}
                      ${sk.isCustom ? `<span class="mt-0.5 w-full truncate text-center text-[9px] text-slate-200">${sk.name}</span>` : ''}
                    </button>
                    ${sk.isCustom ? `<button type="button" data-del-custom-res="${sk.id}" title="Delete imported resource" class="absolute top-0.5 right-0.5 z-10 flex h-5 w-5 items-center justify-center rounded bg-rose-700 hover:bg-rose-600 text-[11px] font-bold text-white shadow cursor-pointer">✕</button>` : ''}
                  </div>`;
                })
                .join('')}
            </div>
          </div>

          <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5">
            <div>
              <div class="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Scale (Size)</span>
                <span id="lbl-res-scale" class="mono text-emerald-300">${this.resourceScale.toFixed(2)}×</span>
              </div>
              <input id="slider-res-scale" type="range" min="0.4" max="3.0" step="0.05" value="${this.resourceScale}" class="w-full accent-emerald-400 cursor-pointer" />
            </div>
            <div>
              <div class="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Rotation (Or press R / Q / E)</span>
                <span id="lbl-res-rot" class="mono text-emerald-300">${this.resourceRotDeg}°</span>
              </div>
              <input id="slider-res-rot" type="range" min="0" max="360" step="15" value="${this.resourceRotDeg}" class="w-full accent-emerald-400 cursor-pointer" />
            </div>
            <button id="btn-clear-all-resources" type="button" class="w-full rounded-lg border border-rose-500/50 bg-rose-950/40 hover:bg-rose-900/60 py-1.5 text-xs font-bold text-rose-200 cursor-pointer transition">
              🧹 Clear All Resources (Trees &amp; Mines)
            </button>
          </div>

          ${this.resourcePlacementMode !== 'single' ? brushControlsHtml : ''}
        </div>
      `;
    } else if (this.activeMainTab === 'props') {
      const allProps = [
        ...DECORATIVE_PROPS_CATALOG.map((p) => ({ ...p, isCustom: false })),
        ...this.mapState.customPropAssets.map((ca) => ({
          id: ca.id,
          name: ca.name,
          badge: '📦',
          defaultColor: '#38bdf8',
          dataUrl: ca.dataUrl || '',
          thumbnailDataUrl: ca.thumbnailDataUrl || '',
          isCustom: true
        }))
      ];
      this.sidebarEl.innerHTML = `
        <div class="space-y-3">
          <h2 class="text-xs font-extrabold uppercase tracking-wider text-purple-300">🗿 Decorative Objects</h2>

          <div class="rounded-xl border border-slate-800 bg-slate-950/80 p-2.5 space-y-1.5">
            <span class="block text-[11px] font-bold text-purple-300">Object Palette (${allProps.length})</span>
            <div id="props-palette-grid" class="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
              ${allProps
                .map((p) => {
                  const isSel = this.activePropType === p.id;
                  const imgSrc = p.thumbnailDataUrl || p.dataUrl;
                  const preview = imgSrc
                    ? `<img src="${imgSrc}" class="w-11 h-11 object-contain rounded" alt="" />`
                    : renderDecorativePropThumbnailSvg(p);
                  return `
                  <div class="relative">
                    <button type="button" data-prop-id="${p.id}" title="${p.name}"
                      class="prop-palette-btn w-full flex flex-col items-center justify-between rounded-xl border p-1.5 transition cursor-pointer ${
                        isSel
                          ? 'border-amber-400 bg-amber-500/25 shadow-lg'
                          : 'border-slate-800 bg-slate-900/90 hover:bg-slate-800'
                      }">
                      <div class="flex h-12 items-center justify-center">${preview}</div>
                      <span class="mt-0.5 w-full truncate text-center text-[9.5px] font-semibold ${isSel ? 'text-amber-200' : 'text-slate-300'}">${p.name}</span>
                    </button>
                    ${p.isCustom ? `<button type="button" data-del-custom-prop="${p.id}" title="Delete imported object" class="absolute top-0.5 right-0.5 z-10 flex h-5 w-5 items-center justify-center rounded bg-rose-700 hover:bg-rose-600 text-[11px] font-bold text-white shadow cursor-pointer">✕</button>` : ''}
                  </div>`;
                })
                .join('')}
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Action</label>
            <select id="select-prop-mode" class="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-200 cursor-pointer">
              <option value="place" ${this.propPlacementMode === 'place' ? 'selected' : ''}>✨ Place Object (Green/Red 3D Ghost)</option>
              <option value="erase" ${this.propPlacementMode === 'erase' ? 'selected' : ''}>🗑️ Erase Object at Cursor</option>
            </select>
          </div>

          <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5">
            <div>
              <div class="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Object Scale (Size)</span>
                <span id="lbl-prop-scale" class="mono text-purple-300">${this.propScale.toFixed(2)}×</span>
              </div>
              <input id="slider-prop-scale" type="range" min="0.3" max="4.0" step="0.05" value="${this.propScale}" class="w-full accent-purple-400 cursor-pointer" />
            </div>
            <div>
              <div class="flex justify-between text-[11px] text-slate-400 mb-1">
                <span>Rotation (Or press R / Q / E)</span>
                <span id="lbl-prop-rot" class="mono text-purple-300">${this.propRotDeg}°</span>
              </div>
              <input id="slider-prop-rot" type="range" min="0" max="360" step="15" value="${this.propRotDeg}" class="w-full accent-purple-400 cursor-pointer" />
            </div>
            <div class="flex items-center justify-between">
              <span class="text-xs text-slate-300">Object Color</span>
              <input id="input-prop-color" type="color" value="${this.propColorHex}" class="h-7 w-14 rounded border border-slate-700 bg-slate-900 cursor-pointer" />
            </div>
          </div>

          <div class="rounded-xl border border-purple-500/40 bg-purple-950/20 p-3 flex items-center justify-between">
            <span class="text-xs font-bold text-purple-200">📦 Custom 3D File</span>
            <label class="rounded-lg border border-purple-400/70 bg-purple-500/25 hover:bg-purple-500/40 px-2.5 py-1 text-[11px] font-bold text-purple-100 cursor-pointer">
              + Upload .GLB/.OBJ/.JSON/PNG
              <input id="input-upload-custom-prop" type="file" accept=".glb,.obj,.json,image/*" class="hidden" />
            </label>
          </div>

          ${this.propPlacementMode === 'erase' ? brushControlsHtml : ''}
        </div>
      `;
    } else if (this.activeMainTab === 'world') {
      const spawnPoints = this.mapState.spawnPoints || [];
      const savedMaps = getSavedMapsList();
      this.sidebarEl.innerHTML = `
        <div class="space-y-3">
          <h2 class="text-xs font-extrabold uppercase tracking-wider text-amber-300">🚩 Candidate Starting Points</h2>

          <div>
            <label class="block text-[11px] text-slate-400 mb-1">Spawn Point Tool</label>
            <select id="select-spawn-mode" class="w-full rounded-lg border border-amber-500/60 bg-slate-950 px-2.5 py-2 text-xs font-bold text-amber-200 cursor-pointer">
              <option value="place" ${this.spawnToolMode === 'place' ? 'selected' : ''}>🚩 Add Candidate Start Point (3D Ghost)</option>
              <option value="erase" ${this.spawnToolMode === 'erase' ? 'selected' : ''}>🗑️ Remove Start Point on Map</option>
            </select>
          </div>

          <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 space-y-2">
            <div class="flex justify-between text-[11px] text-slate-400">
              <span>Facing Direction (R / Q / E)</span>
              <span id="lbl-spawn-rot" class="mono text-amber-300">${this.spawnRotDeg}°</span>
            </div>
            <input id="slider-spawn-rot" type="range" min="0" max="360" step="15" value="${this.spawnRotDeg}" class="w-full accent-amber-400 cursor-pointer" />

            <div class="text-[11px] font-bold text-slate-300 pt-1">Placed Start Points (${spawnPoints.length}):</div>
            <div class="max-h-36 overflow-y-auto space-y-1 pr-1">
              ${spawnPoints
                .map(
                  (sp, idx) => `
                <div class="flex items-center justify-between rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[11px]">
                  <span class="font-semibold text-sky-300">#${idx + 1} (${Math.round(sp.x)}, ${Math.round(sp.z)})</span>
                  <button type="button" data-del-spawn-idx="${idx}" class="text-rose-400 hover:text-rose-300 font-bold cursor-pointer">✕</button>
                </div>`
                )
                .join('')}
            </div>
          </div>

          <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2">
            <div class="text-xs font-bold text-amber-300">🗺️ Maps &amp; Quick Reset</div>
            <button id="btn-world-new-flat" type="button" class="w-full rounded-lg border border-emerald-500/60 bg-emerald-950/40 hover:bg-emerald-900/60 py-1.5 text-xs font-extrabold text-emerald-200 cursor-pointer">
              ✨ Create New Clean Flat Map
            </button>
            <button id="btn-world-clear-resources" type="button" class="w-full rounded-lg border border-rose-500/50 bg-rose-950/40 hover:bg-rose-900/60 py-1.5 text-xs font-bold text-rose-200 cursor-pointer">
              🧹 Clear All Resources (Trees &amp; Mines)
            </button>
            <button id="btn-world-clear-props" type="button" class="w-full rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 py-1.5 text-xs font-bold text-slate-200 cursor-pointer">
              🗿 Clear All Decorative Objects
            </button>
            <button id="btn-world-reset-default" type="button" class="w-full rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 py-1.5 text-xs font-bold text-slate-300 cursor-pointer">
              🔄 Restore Default Royal Valley Map
            </button>
            ${
              savedMaps.length > 0
                ? `<div class="pt-1 space-y-1 max-h-28 overflow-y-auto">
                    <div class="text-[10px] font-bold uppercase text-slate-400">Saved Maps (${savedMaps.length})</div>
                    ${savedMaps
                      .map(
                        (m) => `
                      <div class="flex items-center justify-between rounded bg-slate-900 px-2 py-1 text-[11px]">
                        <button type="button" data-load-map-id="${m.id}" class="text-amber-300 hover:underline truncate text-left flex-1 cursor-pointer">${m.name}</button>
                        <button type="button" data-del-map-id="${m.id}" class="text-rose-400 hover:text-rose-300 font-bold ml-2 cursor-pointer">🗑️</button>
                      </div>`
                      )
                      .join('')}
                  </div>`
                : ''
            }
          </div>
        </div>
      `;
    }

    this._wireSidebarEvents();
  }

  _wireSidebarEvents() {
    const sb = this.sidebarEl;
    if (!sb) return;

    // Brush Radius & Strength sliders (Purely update numbers & scale — zero DOM rebuild!)
    const radSlider = sb.querySelector('#slider-brush-radius');
    if (radSlider) {
      radSlider.addEventListener('input', () => {
        this.brushRadius = Number(radSlider.value) || 64;
        const lbl = sb.querySelector('#lbl-brush-radius');
        if (lbl) lbl.textContent = `${this.brushRadius}m`;
        this._updateBrushCursorVisual();
      });
    }
    const strSlider = sb.querySelector('#slider-brush-strength');
    if (strSlider) {
      strSlider.addEventListener('input', () => {
        this.brushStrength = (Number(strSlider.value) || 45) / 100;
        const lbl = sb.querySelector('#lbl-brush-strength');
        if (lbl) lbl.textContent = `${Math.round(this.brushStrength * 100)}%`;
      });
    }
    sb.querySelectorAll('.brush-shape-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.brushShape = btn.getAttribute('data-brush-shape') || 'circle_smooth';
        this._updateBrushCursorVisual();
        this._renderSidebarInspector();
      });
    });
    const falloffSelect = sb.querySelector('#select-brush-falloff');
    if (falloffSelect) {
      falloffSelect.addEventListener('change', () => {
        this.brushFalloff = falloffSelect.value || 'smooth';
      });
    }

    // Sculpt controls
    const sculptSelect = sb.querySelector('#select-sculpt-mode');
    if (sculptSelect) {
      sculptSelect.addEventListener('change', () => {
        this.sculptMode = sculptSelect.value || 'raise';
        this.rampStartPoint = null;
      });
    }
    const flatSlider = sb.querySelector('#slider-flatten-height');
    if (flatSlider) {
      flatSlider.addEventListener('input', () => {
        this.flattenTargetHeight = Number(flatSlider.value) || 0;
        const lbl = sb.querySelector('#lbl-flatten-height');
        if (lbl) lbl.textContent = `${this.flattenTargetHeight.toFixed(1)}m`;
      });
    }

    // Visual Paint Mode, Swatches & Custom Color Picker
    const paintModeSelect = sb.querySelector('#select-paint-mode');
    if (paintModeSelect) {
      paintModeSelect.addEventListener('change', () => {
        this.paintMode = paintModeSelect.value === 'blend' ? 'blend' : 'paint';
        this._renderSidebarInspector();
      });
    }
    sb.querySelectorAll('.biome-swatch-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.paintMode = 'paint';
        this.activeBiomeLayerId = Number(btn.getAttribute('data-biome-id')) || 0;
        this.useCustomPaintHex = false;
        this._renderSidebarInspector();
      });
    });
    const customPaintHexInput = sb.querySelector('#input-custom-paint-hex');
    if (customPaintHexInput) {
      customPaintHexInput.addEventListener('input', () => {
        this.paintMode = 'paint';
        this.customPaintHex = customPaintHexInput.value;
        this.useCustomPaintHex = true;
      });
      customPaintHexInput.addEventListener('change', () => {
        this.paintMode = 'paint';
        this.customPaintHex = customPaintHexInput.value;
        this.useCustomPaintHex = true;
        this._renderSidebarInspector();
      });
    }
    sb.querySelectorAll('.ground-tex-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.mapState.activeGroundTextureId = btn.getAttribute('data-ground-tex') || 'none';
        this._applyGroundTextureMaterial();
        this._renderSidebarInspector();
      });
    });
    sb.querySelectorAll('[data-del-custom-tex]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const texId = btn.getAttribute('data-del-custom-tex');
        if (texId) this.deleteCustomGroundTexture(texId);
      });
    });
    const texRepeatSlider = sb.querySelector('#slider-tex-repeat');
    if (texRepeatSlider) {
      texRepeatSlider.addEventListener('input', () => {
        this.mapState.groundTextureRepeat = Number(texRepeatSlider.value) || 24;
        const lbl = sb.querySelector('#lbl-tex-repeat');
        if (lbl) lbl.textContent = `${this.mapState.groundTextureRepeat}×`;
        this._applyGroundTextureMaterial();
      });
    }
    const uploadTexInput = sb.querySelector('#input-upload-ground-tex');
    if (uploadTexInput) {
      uploadTexInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const id = `tex_${Date.now()}`;
          this.mapState.customTextures.push({
            id,
            name: file.name.replace(/\.[^.]+$/, ''),
            dataUrl: String(reader.result)
          });
          this.mapState.activeGroundTextureId = id;
          this._applyGroundTextureMaterial();
          this._renderSidebarInspector();
        };
        reader.readAsDataURL(file);
      });
    }

    // Water & Stretchable Bridge controls
    const waterModeSelect = sb.querySelector('#select-water-mode');
    if (waterModeSelect) {
      waterModeSelect.addEventListener('change', () => {
        this.waterToolMode = waterModeSelect.value || 'stretch_bridge';
        this.bridgeStretchStart = null;
        this._renderSidebarInspector();
        this._rebuildGhostPreviewMesh();
      });
    }
    const bridgeWidthSlider = sb.querySelector('#slider-bridge-width');
    if (bridgeWidthSlider) {
      bridgeWidthSlider.addEventListener('input', () => {
        this.bridgeWidth = Number(bridgeWidthSlider.value) || 20;
        const lbl = sb.querySelector('#lbl-bridge-width');
        if (lbl) lbl.textContent = `${this.bridgeWidth}m`;
        this._rebuildGhostPreviewMesh();
      });
    }
    const bridgeLenSlider = sb.querySelector('#slider-bridge-len');
    if (bridgeLenSlider) {
      bridgeLenSlider.addEventListener('input', () => {
        this.bridgeLength = Number(bridgeLenSlider.value) || 48;
        const lbl = sb.querySelector('#lbl-bridge-len');
        if (lbl) lbl.textContent = `${this.bridgeLength}m`;
        this._rebuildGhostPreviewMesh();
      });
    }
    const bridgeRotSlider = sb.querySelector('#slider-bridge-rot');
    if (bridgeRotSlider) {
      bridgeRotSlider.addEventListener('input', () => {
        this.bridgeRotDeg = Number(bridgeRotSlider.value) || 0;
        const lbl = sb.querySelector('#lbl-bridge-rot');
        if (lbl) lbl.textContent = `${this.bridgeRotDeg}°`;
        this._rebuildGhostPreviewMesh();
      });
    }
    const waterLevelSlider = sb.querySelector('#slider-water-level');
    if (waterLevelSlider) {
      waterLevelSlider.addEventListener('input', () => {
        this.mapState.waterLevelMeters = Number(waterLevelSlider.value) || 0;
        const lbl = sb.querySelector('#lbl-water-level');
        if (lbl) lbl.textContent = `${this.mapState.waterLevelMeters.toFixed(2)}m`;
        if (this.waterMesh) this.waterMesh.position.y = this.mapState.waterLevelMeters;
      });
    }
    const waterColorInput = sb.querySelector('#input-water-color');
    if (waterColorInput) {
      waterColorInput.addEventListener('input', () => {
        this.mapState.waterColorHex = waterColorInput.value;
        if (this.waterMesh?.material) {
          this.waterMesh.material.color.set(this.mapState.waterColorHex);
        }
      });
    }
    const riverChk = sb.querySelector('#chk-central-river');
    if (riverChk) {
      riverChk.addEventListener('change', () => {
        this.pushUndoSnapshot();
        this.mapState.hasCentralRiver = Boolean(riverChk.checked);
        this._updateTerrainGeometryAttributes();
      });
    }

    // Resources controls
    const resTypeSelect = sb.querySelector('#select-res-type');
    if (resTypeSelect) {
      resTypeSelect.addEventListener('change', () => {
        this.activeResourceType = resTypeSelect.value || 'wood';
        this._renderSidebarInspector();
        this._rebuildGhostPreviewMesh();
      });
    }
    const resModeSelect = sb.querySelector('#select-res-mode');
    if (resModeSelect) {
      resModeSelect.addEventListener('change', () => {
        this.resourcePlacementMode = resModeSelect.value || 'single';
        this._renderSidebarInspector();
        this._rebuildGhostPreviewMesh();
      });
    }
    sb.querySelectorAll('.res-skin-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const skinId = btn.getAttribute('data-skin-id');
        if (skinId) {
          this.activeResourceSkins[this.activeResourceType] = skinId;
          this._renderSidebarInspector();
          this._rebuildGhostPreviewMesh();
        }
      });
    });
    sb.querySelectorAll('[data-del-custom-res]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const skinId = btn.getAttribute('data-del-custom-res');
        if (skinId) this.deleteCustomResourceSkin(this.activeResourceType, skinId);
      });
    });
    const uploadResInput = sb.querySelector('#input-upload-custom-resource');
    if (uploadResInput) {
      uploadResInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const buf = await file.arrayBuffer();
          await this.importGlbResourceFromBuffer(buf, file.name, this.activeResourceType);
        } catch (err) {
          console.error('Failed to import resource GLB:', err);
        } finally {
          uploadResInput.value = '';
        }
      });
    }
    const resScaleSlider = sb.querySelector('#slider-res-scale');
    if (resScaleSlider) {
      resScaleSlider.addEventListener('input', () => {
        this.resourceScale = Number(resScaleSlider.value) || 1.0;
        const lbl = sb.querySelector('#lbl-res-scale');
        if (lbl) lbl.textContent = `${this.resourceScale.toFixed(2)}×`;
        this._rebuildGhostPreviewMesh();
      });
    }
    const resRotSlider = sb.querySelector('#slider-res-rot');
    if (resRotSlider) {
      resRotSlider.addEventListener('input', () => {
        this.resourceRotDeg = Number(resRotSlider.value) || 0;
        const lbl = sb.querySelector('#lbl-res-rot');
        if (lbl) lbl.textContent = `${this.resourceRotDeg}°`;
        this._rebuildGhostPreviewMesh();
      });
    }
    sb.querySelector('#btn-clear-all-resources')?.addEventListener('click', () => {
      this.clearAllResources();
    });

    // Decorative Props controls
    sb.querySelectorAll('.prop-palette-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propId = btn.getAttribute('data-prop-id');
        if (!propId) return;
        this.activePropType = propId;
        const def = DECORATIVE_PROPS_CATALOG.find((p) => p.id === this.activePropType);
        if (def?.defaultColor) this.propColorHex = def.defaultColor;
        this._renderSidebarInspector();
        this._rebuildGhostPreviewMesh();
      });
    });
    sb.querySelectorAll('[data-del-custom-prop]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const propId = btn.getAttribute('data-del-custom-prop');
        if (propId) this.deleteCustomPropAsset(propId);
      });
    });
    const propModeSelect = sb.querySelector('#select-prop-mode');
    if (propModeSelect) {
      propModeSelect.addEventListener('change', () => {
        this.propPlacementMode = propModeSelect.value || 'place';
        this._renderSidebarInspector();
        this._rebuildGhostPreviewMesh();
      });
    }
    const propScaleSlider = sb.querySelector('#slider-prop-scale');
    if (propScaleSlider) {
      propScaleSlider.addEventListener('input', () => {
        this.propScale = Number(propScaleSlider.value) || 1.0;
        const lbl = sb.querySelector('#lbl-prop-scale');
        if (lbl) lbl.textContent = `${this.propScale.toFixed(2)}×`;
        this._rebuildGhostPreviewMesh();
      });
    }
    const propRotSlider = sb.querySelector('#slider-prop-rot');
    if (propRotSlider) {
      propRotSlider.addEventListener('input', () => {
        this.propRotDeg = Number(propRotSlider.value) || 0;
        const lbl = sb.querySelector('#lbl-prop-rot');
        if (lbl) lbl.textContent = `${this.propRotDeg}°`;
        this._rebuildGhostPreviewMesh();
      });
    }
    const propColorInput = sb.querySelector('#input-prop-color');
    if (propColorInput) {
      propColorInput.addEventListener('input', () => {
        this.propColorHex = propColorInput.value;
      });
    }
    const uploadPropInput = sb.querySelector('#input-upload-custom-prop');
    if (uploadPropInput) {
      uploadPropInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const ext = file.name.split('.').pop()?.toLowerCase();
        const id = `custom_prop_${Date.now()}`;
        const name = file.name.replace(/\.[^.]+$/, '');
        if (ext === 'glb') {
          try {
            const buf = await file.arrayBuffer();
            await this.importGlbPropFromBuffer(buf, file.name);
          } catch (err) {
            console.error('Failed to import prop GLB:', err);
          } finally {
            uploadPropInput.value = '';
          }
        } else if (ext === 'obj') {
          const reader = new FileReader();
          reader.onload = () => {
            const vertices = parseWavefrontObjToVertices(String(reader.result || ''));
            if (vertices.length >= 9) {
              this.mapState.customPropAssets.push({ id, name, kind: 'obj', vertices });
              this.activePropType = id;
              this._renderSidebarInspector();
              this._rebuildGhostPreviewMesh();
            }
          };
          reader.readAsText(file);
        } else if (ext === 'json') {
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const parsed = JSON.parse(String(reader.result || '{}'));
              this.mapState.customPropAssets.push({
                id,
                name,
                kind: 'json',
                parts: Array.isArray(parsed.parts) ? parsed.parts : [{ shape: 'box', size: [2, 3, 2], pos: [0, 1.5, 0] }]
              });
              this.activePropType = id;
              this._renderSidebarInspector();
              this._rebuildGhostPreviewMesh();
            } catch (_) {}
          };
          reader.readAsText(file);
        } else {
          const reader = new FileReader();
          reader.onload = () => {
            this.mapState.customPropAssets.push({
              id,
              name,
              kind: 'image_billboard',
              dataUrl: String(reader.result)
            });
            this.activePropType = id;
            this._renderSidebarInspector();
            this._rebuildGhostPreviewMesh();
          };
          reader.readAsDataURL(file);
        }
      });
    }

    // World & Spawn Points controls
    const spawnModeSelect = sb.querySelector('#select-spawn-mode');
    if (spawnModeSelect) {
      spawnModeSelect.addEventListener('change', () => {
        this.spawnToolMode = spawnModeSelect.value || 'place';
        this._rebuildGhostPreviewMesh();
      });
    }
    const spawnRotSlider = sb.querySelector('#slider-spawn-rot');
    if (spawnRotSlider) {
      spawnRotSlider.addEventListener('input', () => {
        this.spawnRotDeg = Number(spawnRotSlider.value) || 0;
        const lbl = sb.querySelector('#lbl-spawn-rot');
        if (lbl) lbl.textContent = `${this.spawnRotDeg}°`;
        this._rebuildGhostPreviewMesh();
      });
    }
    sb.querySelectorAll('[data-del-spawn-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-del-spawn-idx'));
        if (Number.isInteger(idx) && idx >= 0) {
          this.pushUndoSnapshot();
          this.mapState.spawnPoints.splice(idx, 1);
          this._syncLegacySpawnsFromPoints();
          this._rebuildSpawnsGroup();
          this._renderSidebarInspector();
        }
      });
    });
    sb.querySelector('#btn-world-new-flat')?.addEventListener('click', () => {
      const chosenSize = this.mapState.worldSizeMeters || 4096;
      const flatMap = createBlankFlatMapState(`Flat Map ${getSavedMapsList().length + 1}`, chosenSize);
      this._loadMapStateIntoEditor(flatMap);
    });
    sb.querySelector('#btn-world-clear-resources')?.addEventListener('click', () => {
      this.clearAllResources();
    });
    sb.querySelector('#btn-world-clear-props')?.addEventListener('click', () => {
      this.pushUndoSnapshot();
      this.mapState.decorativeProps = [];
      this._rebuildPropsGroup();
      this._renderSidebarInspector();
    });
    sb.querySelector('#btn-world-reset-default')?.addEventListener('click', () => {
      setActiveCustomMapState(null);
      const baseTrees = generateDeterministicTreesFx({}, MAP_WORLD_SIZE);
      const baseMines = generateDeterministicMinesFx(MAP_WORLD_SIZE);
      this._loadMapStateIntoEditor(createDefaultMapState(baseTrees, baseMines));
    });
    sb.querySelectorAll('[data-load-map-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-load-map-id');
        const found = getSavedMapsList().find((m) => m.id === id);
        if (found) this._loadMapStateIntoEditor(found);
      });
    });
    sb.querySelectorAll('[data-del-map-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del-map-id');
        if (id) {
          deleteMapFromLibrary(id);
          this._refreshSavedMapsDropdown();
          this._renderSidebarInspector();
        }
      });
    });
  }

  // ==========================================================================
  // 3D SCENE & PERSISTENT MESH RENDERING
  // ==========================================================================
  _initThreeScene() {
    const w = this.viewportEl.clientWidth || 1024;
    const h = this.viewportEl.clientHeight || 768;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1322);
    this.scene.fog = new THREE.FogExp2(0x0b1322, 0.00028);

    this.camera = new THREE.PerspectiveCamera(48, w / h, 2, 6500);
    this.camTarget = new THREE.Vector3(2048, 0, 1950);
    this.camSpherical = { radius: 780, theta: 0, phi: 0.82 };
    this._syncCameraFromSpherical();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.viewportEl.insertBefore(this.renderer.domElement, this.viewportEl.firstChild);

    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.9);
    this.scene.add(hemi);
    const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.3);
    dirLight.position.set(2600, 1400, 1200);
    this.scene.add(dirLight);

    const curWorldSize = this.mapState.worldSizeMeters || MAP_WORLD_SIZE;
    const geom = new THREE.PlaneGeometry(curWorldSize, curWorldSize, MAP_VERTEX_RES - 1, MAP_VERTEX_RES - 1);
    geom.rotateX(-Math.PI / 2);
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) + curWorldSize * 0.5);
      pos.setZ(i, pos.getZ(i) + curWorldSize * 0.5);
    }
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.06
    });
    this.terrainMesh = new THREE.Mesh(geom, this.terrainMat);
    this.scene.add(this.terrainMesh);

    const waterGeom = new THREE.PlaneGeometry(MAP_WORLD_SIZE, MAP_WORLD_SIZE, 16, 16);
    waterGeom.rotateX(-Math.PI / 2);
    this.waterMesh = new THREE.Mesh(
      waterGeom,
      new THREE.MeshStandardMaterial({
        color: this.mapState.waterColorHex || '#22789b',
        roughness: 0.2,
        metalness: 0.35,
        transparent: true,
        opacity: 0.76
      })
    );
    this.waterMesh.position.set(curWorldSize * 0.5, this.mapState.waterLevelMeters, curWorldSize * 0.5);
    this.scene.add(this.waterMesh);

    this.bridgesGroup = new THREE.Group();
    this.resourcesGroup = new THREE.Group();
    this.propsGroup = new THREE.Group();
    this.spawnsGroup = new THREE.Group();
    this.ghostGroup = new THREE.Group();
    this.boundsGroup = new THREE.Group();
    this.scene.add(
      this.bridgesGroup,
      this.resourcesGroup,
      this.propsGroup,
      this.spawnsGroup,
      this.ghostGroup,
      this.boundsGroup
    );

    const ringPts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    this.brushRingMesh = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: 0xfbbf24 })
    );
    this._lastCursorShape = 'circle_smooth';
    this.brushRingMesh.position.set(2048, 2.0, 2048);
    this.scene.add(this.brushRingMesh);
    this._updateBrushCursorVisual();

    this.raycaster = new THREE.Raycaster();
    this.mouseNdc = new THREE.Vector2();

    this._rebuildAllVisuals();
    this._rebuildGhostPreviewMesh();
  }

  _rebuildMapBoundsBorder() {
    if (!this.boundsGroup) return;
    this.boundsGroup.clear();
    return;
    const pts = [
      new THREE.Vector3(0, 6, 0),
      new THREE.Vector3(sz, 6, 0),
      new THREE.Vector3(sz, 6, sz),
      new THREE.Vector3(0, 6, sz),
      new THREE.Vector3(0, 6, 0)
    ];
    const lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xfbbf24 });
    this.boundsGroup.add(new THREE.Line(lineGeom, lineMat));
  }

  _updateBrushCursorVisual() {
    if (!this.brushRingMesh) return;
    const r = Math.max(4, Number(this.brushRadius) || 64);
    if (this._lastCursorShape !== this.brushShape) {
      this._lastCursorShape = this.brushShape;
      let newGeom = null;
      if (this.brushShape === 'square') {
        const pts = [
          new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, -1),
          new THREE.Vector3(1, 0, 1), new THREE.Vector3(-1, 0, 1),
          new THREE.Vector3(-1, 0, -1)
        ];
        newGeom = new THREE.BufferGeometry().setFromPoints(pts);
      } else if (this.brushShape === 'diamond') {
        const pts = [
          new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0),
          new THREE.Vector3(0, 0, -1)
        ];
        newGeom = new THREE.BufferGeometry().setFromPoints(pts);
      } else if (this.brushShape === 'star') {
        const pts = [];
        for (let i = 0; i <= 60; i++) {
          const ang = (i / 60) * Math.PI * 2;
          const sr = 0.68 + 0.32 * Math.cos(ang * 5);
          pts.push(new THREE.Vector3(Math.cos(ang) * sr, 0, Math.sin(ang) * sr));
        }
        newGeom = new THREE.BufferGeometry().setFromPoints(pts);
      } else {
        const pts = [];
        for (let i = 0; i <= 48; i++) {
          const ang = (i / 48) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)));
        }
        newGeom = new THREE.BufferGeometry().setFromPoints(pts);
      }
      if (this.brushRingMesh.geometry) this.brushRingMesh.geometry.dispose();
      this.brushRingMesh.geometry = newGeom;
    }
    this.brushRingMesh.scale.set(r, 1, r);
  }

  _syncCameraFromSpherical() {
    if (!this.camera) return;
    const { radius, theta, phi } = this.camSpherical;
    const sinPhi = Math.sin(phi);
    this.camera.position.set(
      this.camTarget.x + radius * sinPhi * Math.sin(theta),
      this.camTarget.y + radius * Math.cos(phi),
      this.camTarget.z + radius * sinPhi * Math.cos(theta)
    );
    this.camera.lookAt(this.camTarget);
  }

  _rebuildPhysicalTerrainGeometry() {
    if (!this.terrainMesh) return;
    const sz = this.mapState.worldSizeMeters || MAP_WORLD_SIZE;
    const cellM = sz / (MAP_VERTEX_RES - 1);
    const pos = this.terrainMesh.geometry.attributes.position;
    for (let iz = 0; iz < MAP_VERTEX_RES; iz++) {
      const wz = iz * cellM;
      for (let ix = 0; ix < MAP_VERTEX_RES; ix++) {
        const idx = iz * MAP_VERTEX_RES + ix;
        pos.setX(idx, ix * cellM);
        pos.setZ(idx, wz);
      }
    }
    pos.needsUpdate = true;
    this.terrainMesh.geometry.computeBoundingSphere();
    this.terrainMesh.geometry.computeBoundingBox();

    if (this.waterMesh) {
      const wScale = sz / MAP_WORLD_SIZE;
      this.waterMesh.scale.set(wScale, 1, wScale);
      this.waterMesh.position.set(sz * 0.5, this.mapState.waterLevelMeters, sz * 0.5);
    }
    this.camTarget.set(sz * 0.5, 0, sz * 0.5);
    this._syncCameraFromSpherical();
  }

  _rebuildAllVisuals() {
    if (!this.terrainMesh) return;
    this._rebuildPhysicalTerrainGeometry();
    this._updateTerrainGeometryAttributes();
    this._applyGroundTextureMaterial();
    if (this.waterMesh) {
      this.waterMesh.position.y = this.mapState.waterLevelMeters;
      this.waterMesh.material.color.set(this.mapState.waterColorHex || '#22789b');
    }
    this._rebuildMapBoundsBorder();
    this._rebuildBridgesGroup();
    this._rebuildResourcesGroup();
    this._rebuildPropsGroup();
    this._rebuildSpawnsGroup();
  }

  _computeVertexColorInto(vIdx, h, colAttr) {
    const customRgb = this.mapState.colorOverrides?.[vIdx];
    if (Array.isArray(customRgb) && customRgb.length >= 3) {
      colAttr.setXYZ(vIdx, customRgb[0], customRgb[1], customRgb[2]);
      return;
    }

    const biomeId = this.mapState.biomeOverrides?.[vIdx] || 0;
    if (biomeId > 0) {
      const layer = TERRAIN_BIOME_LAYERS.find((x) => x.id === biomeId);
      const c = new THREE.Color(layer ? layer.hex : '#3f6b34');
      colAttr.setXYZ(vIdx, c.r, c.g, c.b);
      return;
    }

    const [r, g, b] = this._getElevationNaturalRgb(h);
    colAttr.setXYZ(vIdx, r, g, b);
  }

  _updateTerrainVertexPatch(minIx, maxIx, minIz, maxIz) {
    if (!this.terrainMesh) return;
    const geom = this.terrainMesh.geometry;
    const pos = geom.attributes.position;
    const col = geom.attributes.color;

    for (let iz = minIz; iz <= maxIz; iz++) {
      const rowOffset = iz * MAP_VERTEX_RES;
      for (let ix = minIx; ix <= maxIx; ix++) {
        const vIdx = rowOffset + ix;
        const h = this.getVertexHeight(vIdx);
        pos.setY(vIdx, h);
        this._computeVertexColorInto(vIdx, h, col);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  _updateTerrainGeometryAttributes() {
    if (!this.terrainMesh) return;
    this._updateTerrainVertexPatch(0, MAP_VERTEX_RES - 1, 0, MAP_VERTEX_RES - 1);
    this.terrainMesh.geometry.computeVertexNormals();
  }

  _syncPlacedObjectsYInRadius(worldX, worldZ, radius) {
    const groups = [this.resourcesGroup, this.propsGroup, this.spawnsGroup, this.bridgesGroup];
    for (const grp of groups) {
      if (!grp) continue;
      const children = grp.children;
      for (let i = 0; i < children.length; i++) {
        const ch = children[i];
        const wx = ch.userData?.wx ?? ch.position.x;
        const wz = ch.userData?.wz ?? ch.position.z;
        if (Math.abs(wx - worldX) <= radius && Math.abs(wz - worldZ) <= radius) {
          ch.position.y = this._sampleEditorGroundY(wx, wz);
        }
      }
    }
  }

  _applyGroundTextureMaterial() {
    if (!this.terrainMat) return;
    const texId = this.mapState.activeGroundTextureId;
    if (!texId || texId === 'none') {
      this.terrainMat.map = null;
      this.terrainMat.needsUpdate = true;
      return;
    }
    const entry = this.mapState.customTextures.find((t) => t.id === texId);
    if (!entry || !entry.dataUrl || typeof Image === 'undefined') return;
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
      const rep = Math.max(1, Number(this.mapState.groundTextureRepeat) || 24);
      tex.repeat.set(rep, rep);
      this.terrainMat.map = tex;
      this.terrainMat.needsUpdate = true;
    };
    img.src = entry.dataUrl;
  }

  _sampleEditorGroundY(wx, wz) {
    const ix = Math.max(0, Math.min(MAP_VERTEX_RES - 1, Math.round(wx / this.getCellMeters())));
    const iz = Math.max(0, Math.min(MAP_VERTEX_RES - 1, Math.round(wz / this.getCellMeters())));
    return this.getVertexHeight(iz * MAP_VERTEX_RES + ix);
  }

  _rebuildBridgesGroup() {
    if (!this.bridgesGroup) return;
    this.bridgesGroup.clear();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a857a, roughness: 0.8 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.85 });
    for (const b of this.mapState.bridges) {
      const g = new THREE.Group();
      const w = b.width || 20;
      const len = b.length || 48;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, len), stoneMat);
      deck.position.y = 1.6;
      g.add(deck);
      for (const s of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, len), railMat);
        wall.position.set(s * (w * 0.5 - 0.45), 2.4, 0);
        g.add(wall);
      }
      const gy = Math.max(this.mapState.waterLevelMeters, this._sampleEditorGroundY(b.x, b.z));
      g.position.set(b.x, gy, b.z);
      g.rotation.y = b.rotY || 0;
      g.userData = { wx: b.x, wz: b.z };
      this.bridgesGroup.add(g);
    }
  }

  _appendSingleTreeMesh(t) {
    if (!this.resourcesGroup) return;
    if (!t.uid) t.uid = `tree_${Date.now()}_${this._nextUidCounter++}`;
    const mesh = createTreeMeshBySkin(t.skinId || 'pine_emerald', t.scale || 1.0, t.rotY || 0, this.mapState.customResourceSkins);
    mesh.position.set(t.x, this._sampleEditorGroundY(t.x, t.z), t.z);
    mesh.userData = { wx: t.x, wz: t.z, uid: t.uid, kind: 'tree' };
    this.resourcesGroup.add(mesh);
    this._treeMeshByUid.set(t.uid, mesh);
  }

  _appendSingleMineMesh(m) {
    if (!this.resourcesGroup) return;
    if (!m.uid) m.uid = `mine_${Date.now()}_${this._nextUidCounter++}`;
    const mesh = createMineMeshBySkin(m.type || 'coins', m.skinId, m.scale || 1.0, m.rotY || 0, this.mapState.customResourceSkins);
    mesh.position.set(m.x, this._sampleEditorGroundY(m.x, m.z), m.z);
    mesh.userData = { wx: m.x, wz: m.z, uid: m.uid, kind: 'mine' };
    this.resourcesGroup.add(mesh);
    this._mineMeshByUid.set(m.uid, mesh);
  }

  _appendSinglePropMesh(p) {
    if (!this.propsGroup) return;
    if (!p.id) p.id = `prop_${Date.now()}_${this._nextUidCounter++}`;
    const mesh = createDecorativePropMesh(p, this.mapState.customPropAssets);
    mesh.position.set(p.x, this._sampleEditorGroundY(p.x, p.z), p.z);
    mesh.userData = { wx: p.x, wz: p.z, id: p.id };
    this.propsGroup.add(mesh);
    this._propMeshById.set(p.id, mesh);
  }

  _rebuildResourcesGroup() {
    if (!this.resourcesGroup) return;
    this.resourcesGroup.clear();
    this._treeMeshByUid.clear();
    this._mineMeshByUid.clear();

    // Render ALL trees without index skipping so erasing a tree never shifts any other tree!
    const trees = this.mapState.trees;
    for (let i = 0; i < trees.length; i++) {
      this._appendSingleTreeMesh(trees[i]);
    }
    for (const m of this.mapState.mines) {
      this._appendSingleMineMesh(m);
    }
  }

  _rebuildPropsGroup() {
    if (!this.propsGroup) return;
    this.propsGroup.clear();
    this._propMeshById.clear();
    for (const p of this.mapState.decorativeProps) {
      this._appendSinglePropMesh(p);
    }
  }

  _rebuildSpawnsGroup() {
    if (!this.spawnsGroup) return;
    this.spawnsGroup.clear();
    const pts = this.mapState.spawnPoints || [];
    for (let i = 0; i < pts.length; i++) {
      const sp = pts[i];
      const beacon = createSpawnBeaconMesh(i + 1, sp.facingDir ?? 256);
      const gy = this._sampleEditorGroundY(sp.x, sp.z);
      beacon.position.set(sp.x, gy, sp.z);
      beacon.userData = { wx: sp.x, wz: sp.z };
      this.spawnsGroup.add(beacon);
    }
  }

  // ==========================================================================
  // INTERACTION & CAMERA CONTROLS
  // ==========================================================================
  _raycastTerrain(clientX, clientY) {
    if (!this.terrainMesh || !this.viewportEl) return null;
    const rect = this.viewportEl.getBoundingClientRect();
    this.mouseNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    const hits = this.raycaster.intersectObject(this.terrainMesh, false);
    return hits.length > 0 ? hits[0].point : null;
  }

  rotateActiveGhostBy(deltaDeg = 15) {
    if (this.activeMainTab === 'props') {
      this.propRotDeg = (this.propRotDeg + deltaDeg + 360) % 360;
      const sl = this.sidebarEl?.querySelector('#slider-prop-rot');
      const lb = this.sidebarEl?.querySelector('#lbl-prop-rot');
      if (sl) sl.value = String(this.propRotDeg);
      if (lb) lb.textContent = `${this.propRotDeg}°`;
    } else if (this.activeMainTab === 'world') {
      this.spawnRotDeg = (this.spawnRotDeg + deltaDeg + 360) % 360;
      const sl = this.sidebarEl?.querySelector('#slider-spawn-rot');
      const lb = this.sidebarEl?.querySelector('#lbl-spawn-rot');
      if (sl) sl.value = String(this.spawnRotDeg);
      if (lb) lb.textContent = `${this.spawnRotDeg}°`;
    } else if (this.activeMainTab === 'water') {
      this.bridgeRotDeg = (this.bridgeRotDeg + deltaDeg + 360) % 360;
      const sl = this.sidebarEl?.querySelector('#slider-bridge-rot');
      const lb = this.sidebarEl?.querySelector('#lbl-bridge-rot');
      if (sl) sl.value = String(this.bridgeRotDeg);
      if (lb) lb.textContent = `${this.bridgeRotDeg}°`;
    } else {
      this.resourceRotDeg = (this.resourceRotDeg + deltaDeg + 360) % 360;
      const sl = this.sidebarEl?.querySelector('#slider-res-rot');
      const lb = this.sidebarEl?.querySelector('#lbl-res-rot');
      if (sl) sl.value = String(this.resourceRotDeg);
      if (lb) lb.textContent = `${this.resourceRotDeg}°`;
    }
    this._rebuildGhostPreviewMesh();
  }

  _handleViewportToolAction(hitPoint, isInitialClick = false) {
    if (!hitPoint) return;
    const maxW = this.mapState.worldSizeMeters || MAP_WORLD_SIZE;
    const wx = Math.max(0, Math.min(maxW, hitPoint.x));
    const wz = Math.max(0, Math.min(maxW, hitPoint.z));

    if (this.activeMainTab === 'sculpt') {
      if (this.sculptMode === 'ramp') {
        if (isInitialClick) {
          if (!this.rampStartPoint) {
            this.rampStartPoint = { x: wx, y: hitPoint.y, z: wz };
          } else {
            this.pushUndoSnapshot();
            this.applyRampBetween(this.rampStartPoint, { x: wx, y: hitPoint.y, z: wz });
            this.rampStartPoint = null;
          }
        }
        return;
      }
      if (isInitialClick) this.pushUndoSnapshot();
      this.applyTerrainBrushAt(wx, wz, 0.06);
    } else if (this.activeMainTab === 'paint') {
      if (isInitialClick) this.pushUndoSnapshot();
      if (this.paintMode === 'blend') {
        this.applyPaintBlendAt(wx, wz);
      } else {
        this.applyBiomePaintAt(wx, wz, this.activeBiomeLayerId);
      }
    } else if (this.activeMainTab === 'water') {
      if (this.waterToolMode === 'stretch_bridge') {
        if (!isInitialClick) return;
        if (!this.bridgeStretchStart) {
          this.bridgeStretchStart = { x: wx, z: wz };
          this._renderSidebarInspector();
        } else {
          this.pushUndoSnapshot();
          this.placeBridgeBetweenPoints(this.bridgeStretchStart, { x: wx, z: wz });
          this.bridgeStretchStart = null;
          this._renderSidebarInspector();
          this._rebuildGhostPreviewMesh();
        }
        return;
      }
      if (isInitialClick) this.pushUndoSnapshot();
      if (this.waterToolMode === 'place_bridge' && !isInitialClick) return;
      this.applyWaterToolAt(wx, wz);
    } else if (this.activeMainTab === 'resources') {
      if (isInitialClick) {
        this.pushUndoSnapshot();
        this._lastScatterPos = { x: wx, z: wz };
        this.placeOrScatterResourceAt(wx, wz);
      } else if (this.resourcePlacementMode === 'erase') {
        this.placeOrScatterResourceAt(wx, wz);
      } else if (this.resourcePlacementMode === 'scatter') {
        if (
          !this._lastScatterPos ||
          Math.hypot(wx - this._lastScatterPos.x, wz - this._lastScatterPos.z) > this.brushRadius * 0.45
        ) {
          this._lastScatterPos = { x: wx, z: wz };
          this.placeOrScatterResourceAt(wx, wz);
        }
      }
    } else if (this.activeMainTab === 'props') {
      if (isInitialClick || this.propPlacementMode === 'erase') {
        if (isInitialClick) this.pushUndoSnapshot();
        this.placeOrEraseDecorativePropAt(wx, wz);
      }
    } else if (this.activeMainTab === 'world') {
      if (isInitialClick) {
        this.pushUndoSnapshot();
        this.placeOrEraseSpawnPointAt(wx, wz);
      }
    }
  }

  _bindEvents() {
    this._onContextMenu = (e) => e.preventDefault();
    this.viewportEl.addEventListener('contextmenu', this._onContextMenu);

    this._onPointerDown = (e) => {
      this._lastMouseX = e.clientX;
      this._lastMouseY = e.clientY;
      if (e.button === 2) {
        this._isRightOrbiting = true;
      } else if (e.button === 1) {
        this._isMiddlePanning = true;
      } else if (e.button === 0) {
        this._isPointerDown = true;
        const pt = this._raycastTerrain(e.clientX, e.clientY);
        if (pt) this._handleViewportToolAction(pt, true);
      }
    };

    this._onPointerMove = (e) => {
      const dx = e.clientX - this._lastMouseX;
      const dy = e.clientY - this._lastMouseY;
      this._lastMouseX = e.clientX;
      this._lastMouseY = e.clientY;

      if (this._isRightOrbiting) {
        this.camSpherical.theta -= dx * 0.006;
        this.camSpherical.phi = Math.max(0.18, Math.min(1.42, this.camSpherical.phi - dy * 0.005));
        this._syncCameraFromSpherical();
        return;
      }
      if (this._isMiddlePanning) {
        const panScale = this.camSpherical.radius * 0.0015;
        const forwardX = -Math.sin(this.camSpherical.theta);
        const forwardZ = -Math.cos(this.camSpherical.theta);
        const rightX = Math.cos(this.camSpherical.theta);
        const rightZ = -Math.sin(this.camSpherical.theta);
        this.camTarget.x -= (rightX * dx - forwardX * dy) * panScale;
        this.camTarget.z -= (rightZ * dx - forwardZ * dy) * panScale;
        this._syncCameraFromSpherical();
        return;
      }

      const pt = this._raycastTerrain(e.clientX, e.clientY);
      if (pt) {
        this._lastHoverWorldPt = pt;
        if (this.brushRingMesh && this.brushRingMesh.visible) {
          this.brushRingMesh.position.set(pt.x, pt.y + 0.45, pt.z);
        }
        if (this.ghostGroup && this.ghostGroup.visible) {
          this._updateGhostTransformAndValidity(pt.x, pt.z);
        }
        const coordsEl = this.viewportEl.querySelector('#map-cursor-coords');
        if (coordsEl) {
          coordsEl.textContent = `X: ${pt.x.toFixed(0)}m | Z: ${pt.z.toFixed(0)}m | Y: ${pt.y.toFixed(2)}m`;
        }
        if (this._isPointerDown) {
          this._handleViewportToolAction(pt, false);
        }
      }
    };

    this._onPointerUp = () => {
      if (this._isPointerDown && this.activeMainTab === 'sculpt' && this.terrainMesh) {
        this.terrainMesh.geometry.computeVertexNormals();
      }
      this._isPointerDown = false;
      this._isRightOrbiting = false;
      this._isMiddlePanning = false;
    };

    this._onWheel = (e) => {
      e.preventDefault();
      if (e.shiftKey && this.isSinglePlacementRequested()) {
        this.rotateActiveGhostBy(e.deltaY > 0 ? 15 : -15);
        return;
      }
      this.camSpherical.radius = Math.max(90, Math.min(3400, this.camSpherical.radius + e.deltaY * 0.65));
      this._syncCameraFromSpherical();
    };

    this._onKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      this._keysDown.add(e.code);
      if (e.code === 'KeyR' || e.code === 'KeyE') {
        e.preventDefault();
        this.rotateActiveGhostBy(15);
      } else if (e.code === 'KeyQ') {
        e.preventDefault();
        this.rotateActiveGhostBy(-15);
      } else if (e.code === 'Escape' && this.bridgeStretchStart) {
        this.bridgeStretchStart = null;
        this._renderSidebarInspector();
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        this.redo();
      }
    };
    this._onKeyUp = (e) => this._keysDown.delete(e.code);

    this._onResize = () => {
      if (!this.viewportEl || !this.renderer || !this.camera) return;
      const w = this.viewportEl.clientWidth || 1024;
      const h = this.viewportEl.clientHeight || 768;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };

    this.viewportEl.addEventListener('mousedown', this._onPointerDown);
    window.addEventListener('mousemove', this._onPointerMove);
    window.addEventListener('mouseup', this._onPointerUp);
    this.viewportEl.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('resize', this._onResize);
  }

  _animate() {
    if (this._destroyed) return;
    this._rafId = requestAnimationFrame(() => this._animate());

    if (this._keysDown.size > 0) {
      const speed = Math.max(6, this.camSpherical.radius * 0.018);
      const forwardX = -Math.sin(this.camSpherical.theta);
      const forwardZ = -Math.cos(this.camSpherical.theta);
      const rightX = Math.cos(this.camSpherical.theta);
      const rightZ = -Math.sin(this.camSpherical.theta);
      let moved = false;
      if (this._keysDown.has('KeyW') || this._keysDown.has('ArrowUp')) {
        this.camTarget.x += forwardX * speed;
        this.camTarget.z += forwardZ * speed;
        moved = true;
      }
      if (this._keysDown.has('KeyS') || this._keysDown.has('ArrowDown')) {
        this.camTarget.x -= forwardX * speed;
        this.camTarget.z -= forwardZ * speed;
        moved = true;
      }
      if (this._keysDown.has('KeyD') || this._keysDown.has('ArrowRight')) {
        this.camTarget.x += rightX * speed;
        this.camTarget.z += rightZ * speed;
        moved = true;
      }
      if (this._keysDown.has('KeyA') || this._keysDown.has('ArrowLeft')) {
        this.camTarget.x -= rightX * speed;
        this.camTarget.z -= rightZ * speed;
        moved = true;
      }
      if (moved) {
        const maxW = this.mapState.worldSizeMeters || MAP_WORLD_SIZE;
        this.camTarget.x = Math.max(0, Math.min(maxW, this.camTarget.x));
        this.camTarget.z = Math.max(0, Math.min(maxW, this.camTarget.z));
        this._syncCameraFromSpherical();
      }
    }

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.viewportEl) {
      this.viewportEl.removeEventListener('contextmenu', this._onContextMenu);
      this.viewportEl.removeEventListener('mousedown', this._onPointerDown);
      this.viewportEl.removeEventListener('wheel', this._onWheel);
    }
    window.removeEventListener('mousemove', this._onPointerMove);
    window.removeEventListener('mouseup', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('resize', this._onResize);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    if (this.container) {
      this.container.className = 'hidden';
      this.container.style.display = 'none';
      this.container.innerHTML = '';
      this.container.remove?.();
    }
  }
}
