/**
 * Kings Lands — Fixed-Point Navigation Grid (src/sim/nav/grid.js)
 *
 * Upgraded for 16x Expanded Battlefield (4096m x 4096m) & Custom 3D Map Editor Integration:
 * - 100% accessible land across the entire world (no artificial high-altitude BLOCKED walls).
 * - 3 wide Stone Bridges (West at 25%, Central at 50%, East at 75% X) + 4 wide Shallow Fords.
 * - Seamless support for Custom Map height overrides, custom bridges, custom water level, and painted biomes.
 */

import {
  FX_ONE,
  PERMILLE_ONE,
  ANGLE_MASK,
  mulDiv,
  fxAbs,
  fxClamp,
  fxSin,
  fxCos,
  fxSinSub,
  fxCosSub,
  fxSmoothstepPermille
} from '../../core/fx.js';
import { generateDeterministicTreesFx, generateDeterministicMinesFx } from '../world/worldGen.js';
import {
  getActiveCustomMapState,
  sampleCustomMapHeightMeters,
  sampleCustomMapBiomeId
} from '../../tools/map_editor/mapStateManager.js';

export const DEFAULT_WORLD_SIZE_METERS = 4096;
export const DEFAULT_CENTER_METERS = 2048;

export const NavTileType = Object.freeze({
  PLAINS: 0,
  HILL: 1,
  MUD_WATER: 2,
  SHALLOW_WATER: 2,
  FOREST: 3,
  BRIDGE: 4,
  BLOCKED: 5,
  DEEP_RIVER: 5
});

export const TerrainSpeedPermille = Object.freeze({
  PLAINS: 1000,
  BRIDGE: 1000,
  HILL: 880,
  MUD_WATER: 780,
  FOREST_INFANTRY: 1000,
  FOREST_CAVALRY: 750,
  BLOCKED: 0
});

export const TerrainBaseCost = Object.freeze({
  PLAINS: 100,
  BRIDGE: 100,
  HILL: 114,
  MUD_WATER: 128,
  FOREST_INFANTRY: 104,
  FOREST_CAVALRY: 135,
  BLOCKED: 0x3fffffff
});

export function getBridgeCentersMeters(worldCenterMeters = DEFAULT_CENTER_METERS) {
  const c = worldCenterMeters | 0;
  const half = c >> 1;
  return [half, c, (c + half) | 0];
}

export function getFordCentersMeters(worldCenterMeters = DEFAULT_CENTER_METERS) {
  const c = worldCenterMeters | 0;
  const q = c >> 2;
  return [q, (q * 3) | 0, (q * 5) | 0, (q * 7) | 0];
}

function minDistanceToBridgeXFx(fxX, worldCenterMeters = DEFAULT_CENTER_METERS) {
  const customMap = getActiveCustomMapState();
  if (customMap && customMap.isCustomMapActive && Array.isArray(customMap.bridges)) {
    if (customMap.bridges.length === 0) return 0x3fffffff;
    let minD = 0x3fffffff;
    const x = fxX | 0;
    for (let i = 0; i < customMap.bridges.length; i++) {
      const bxFx = Math.round((customMap.bridges[i].x || 0) * FX_ONE) | 0;
      const d = fxAbs(x - bxFx);
      if (d < minD) minD = d;
    }
    return minD;
  }
  const x = fxX | 0;
  const c = worldCenterMeters | 0;
  const half = c >> 1;
  const d1 = fxAbs(x - half * FX_ONE);
  const d2 = fxAbs(x - c * FX_ONE);
  const d3 = fxAbs(x - (c + half) * FX_ONE);
  let m = d1 < d2 ? d1 : d2;
  if (d3 < m) m = d3;
  return m;
}

function minDistanceToFordXFx(fxX, worldCenterMeters = DEFAULT_CENTER_METERS) {
  const x = fxX | 0;
  const c = worldCenterMeters | 0;
  const q = c >> 2;
  const f1 = fxAbs(x - q * FX_ONE);
  const f2 = fxAbs(x - q * 3 * FX_ONE);
  const f3 = fxAbs(x - q * 5 * FX_ONE);
  const f4 = fxAbs(x - q * 7 * FX_ONE);
  let minFord = f1 < f2 ? f1 : f2;
  if (f3 < minFord) minFord = f3;
  if (f4 < minFord) minFord = f4;
  return minFord;
}

export function computeRiverCenterZFx(fxX, worldCenterMeters = DEFAULT_CENTER_METERS) {
  const x = fxX | 0;
  const centerBase = ((worldCenterMeters | 0) * FX_ONE) | 0;
  const distFromBridge = minDistanceToBridgeXFx(x, worldCenterMeters);
  const bridgeFlattenPermille = fxSmoothstepPermille(mulDiv(distFromBridge, 1000, 64 * FX_ONE));
  const wave1 = mulDiv(24 * FX_ONE, fxSinSub(x), FX_ONE);
  const wave2 = mulDiv(10 * FX_ONE, fxCosSub(x << 1), FX_ONE);
  const offset = mulDiv((wave1 + wave2) | 0, bridgeFlattenPermille, PERMILLE_ONE);
  return (centerBase + offset) | 0;
}

function projectOntoCustomBridgeMeters(fxX, fxZ, b, defaultZ = 2048) {
  const wx = (fxX | 0) / FX_ONE;
  const wz = (fxZ | 0) / FX_ONE;
  const dx = wx - (Number(b.x) || 0);
  const dz = wz - (Number(b.z) || defaultZ);
  const rotY = Number(b.rotY) || 0;
  const cosA = Math.cos(-rotY);
  const sinA = Math.sin(-rotY);
  return {
    localX: Math.abs(dx * cosA + dz * sinA),
    localZ: Math.abs(-dx * sinA + dz * cosA)
  };
}

export function isOnBridgeFx(fxX, fxZ, bridgeCenterMeters = DEFAULT_CENTER_METERS) {
  const customMap = getActiveCustomMapState();
  if (customMap && customMap.isCustomMapActive && Array.isArray(customMap.bridges)) {
    for (let i = 0; i < customMap.bridges.length; i++) {
      const b = customMap.bridges[i];
      const hw = (Number(b.width) || 20) * 0.5;
      const hl = (Number(b.length) || 48) * 0.5;
      const { localX, localZ } = projectOntoCustomBridgeMeters(fxX, fxZ, b, bridgeCenterMeters);
      if (localX <= hw && localZ <= hl) return true;
    }
    return false;
  }
  const centerFx = ((bridgeCenterMeters | 0) * FX_ONE) | 0;
  const dx = minDistanceToBridgeXFx(fxX, bridgeCenterMeters);
  const dz = fxAbs((fxZ | 0) - centerFx);
  return dx <= 10 * FX_ONE && dz <= 24 * FX_ONE;
}

export function isOnWalkableBridgeDeckFx(fxX, fxZ, bridgeCenterMeters = DEFAULT_CENTER_METERS) {
  const customMap = getActiveCustomMapState();
  if (customMap && customMap.isCustomMapActive && Array.isArray(customMap.bridges)) {
    for (let i = 0; i < customMap.bridges.length; i++) {
      const b = customMap.bridges[i];
      const hw = Math.max(4, (Number(b.width) || 20) * 0.5 - 1.5);
      const hl = (Number(b.length) || 48) * 0.5;
      const { localX, localZ } = projectOntoCustomBridgeMeters(fxX, fxZ, b, bridgeCenterMeters);
      if (localX <= hw && localZ <= hl) return true;
    }
    return false;
  }
  const centerFx = ((bridgeCenterMeters | 0) * FX_ONE) | 0;
  const dx = minDistanceToBridgeXFx(fxX, bridgeCenterMeters);
  const dz = fxAbs((fxZ | 0) - centerFx);
  return dx <= 8 * FX_ONE && dz <= 24 * FX_ONE;
}

export function isOnBridgeSideWallFx(fxX, fxZ, bridgeCenterMeters = DEFAULT_CENTER_METERS) {
  const customMap = getActiveCustomMapState();
  if (customMap && customMap.isCustomMapActive && Array.isArray(customMap.bridges)) {
    for (let i = 0; i < customMap.bridges.length; i++) {
      const b = customMap.bridges[i];
      const innerHw = Math.max(4, (Number(b.width) || 20) * 0.5 - 1.5);
      const outerHw = (Number(b.width) || 20) * 0.5 + 1.0;
      const hl = (Number(b.length) || 48) * 0.5;
      const { localX, localZ } = projectOntoCustomBridgeMeters(fxX, fxZ, b, bridgeCenterMeters);
      if (localX > innerHw && localX <= outerHw && localZ <= hl) return true;
    }
    return false;
  }
  const centerFx = ((bridgeCenterMeters | 0) * FX_ONE) | 0;
  const dx = minDistanceToBridgeXFx(fxX, bridgeCenterMeters);
  const dz = fxAbs((fxZ | 0) - centerFx);
  return dx > 8 * FX_ONE && dx <= 11 * FX_ONE && dz <= 24 * FX_ONE;
}

export function isInShallowFordZoneFx(fxX, worldCenterMeters = DEFAULT_CENTER_METERS) {
  return minDistanceToFordXFx(fxX, worldCenterMeters) < 20 * FX_ONE;
}

export function sampleTerrainHeightFx(
  fxX,
  fxZ,
  includeBridgeDeck = true,
  worldSizeMeters = DEFAULT_WORLD_SIZE_METERS
) {
  const maxCoordFx = ((worldSizeMeters | 0) * FX_ONE) | 0;
  const halfMeters = (worldSizeMeters >> 1) | 0;
  const centerFx = (halfMeters * FX_ONE) | 0;

  const x = fxClamp(fxX | 0, 0, maxCoordFx);
  const z = fxClamp(fxZ | 0, 0, maxCoordFx);

  const customMap = getActiveCustomMapState();
  if (customMap && customMap.isCustomMapActive) {
    const customHeightMeters = sampleCustomMapHeightMeters(customMap, x / FX_ONE, z / FX_ONE);
    if (customHeightMeters !== null) {
      let customGroundFx = Math.round(customHeightMeters * FX_ONE) | 0;
      if (includeBridgeDeck && isOnBridgeFx(x, z, halfMeters)) {
        const deckFx = Math.max(customGroundFx, 1600) | 0;
        return deckFx;
      }
      return customGroundFx;
    }
  }

  const hasRiver = !customMap || !customMap.isCustomMapActive || customMap.hasCentralRiver !== false;
  const riverZ = computeRiverCenterZFx(x, halfMeters);
  const distRiver = fxAbs(z - riverZ);

  // C1-continuous sub-meter interpolated rolling plains & tactical hills
  const hWaveA = mulDiv(3400, fxSinSub(x + (z >> 1)), FX_ONE);
  const hWaveB = mulDiv(2600, fxCosSub((x >> 1) - z + (180 << 10)), FX_ONE);
  const hWaveC = mulDiv(1600, fxSinSub((x << 1) + (z << 1)), FX_ONE);

  let hillHeight = (((hWaveA + hWaveB + hWaveC) >> 1) + 2100) | 0;
  if (hillHeight < 950) {
    const d = (950 - hillHeight) | 0;
    hillHeight = d >= 800 ? 550 : (950 - d + mulDiv(d, d, 1600)) | 0;
  }

  // Smoothly ramped tactical ridges
  const ridgeRaw = fxSinSub(((x * 3 + z * 2) >> 1) + (90 << 10));
  if (ridgeRaw > 180 && distRiver > 60 * FX_ONE) {
    const rDelta = (ridgeRaw - 180) | 0;
    const rShaped = rDelta < 240 ? mulDiv(rDelta, rDelta, 480) : (rDelta - 120) | 0;
    const ridgeHeight = mulDiv(2800, rShaped, 724);
    const riverT = fxSmoothstepPermille(mulDiv(distRiver - 60 * FX_ONE, 1000, 80 * FX_ONE));
    hillHeight = (hillHeight + mulDiv(ridgeHeight, riverT, 1000)) | 0;
  }

  // Smooth Hermite plateaus around Player Citadel (2048, 1660) and Enemy Citadel (2048, 2420)
  const p1Dx = fxAbs(x - 2048 * FX_ONE);
  const p1Dz = fxAbs(z - 1660 * FX_ONE);
  if (p1Dx < 180 * FX_ONE && p1Dz < 180 * FX_ONE) {
    const d1 = Math.max(p1Dx, p1Dz);
    const blend1 = fxSmoothstepPermille(mulDiv(d1, 1000, 180 * FX_ONE));
    hillHeight = (mulDiv(hillHeight, blend1, 1000) + mulDiv(1600, 1000 - blend1, 1000)) | 0;
  }

  const p2Dx = fxAbs(x - 2048 * FX_ONE);
  const p2Dz = fxAbs(z - 2420 * FX_ONE);
  if (p2Dx < 180 * FX_ONE && p2Dz < 180 * FX_ONE) {
    const d2 = Math.max(p2Dx, p2Dz);
    const blend2 = fxSmoothstepPermille(mulDiv(d2, 1000, 180 * FX_ONE));
    hillHeight = (mulDiv(hillHeight, blend2, 1000) + mulDiv(1600, 1000 - blend2, 1000)) | 0;
  }

  if (!hasRiver) {
    return hillHeight | 0;
  }

  const roadDx = minDistanceToBridgeXFx(x, halfMeters);
  if (roadDx < 28 * FX_ONE) {
    const roadBlend = fxSmoothstepPermille(mulDiv(roadDx, 1000, 28 * FX_ONE));
    hillHeight = (mulDiv(hillHeight, roadBlend, 1000) + mulDiv(820, 1000 - roadBlend, 1000)) | 0;
  }

  const minFordDx = minDistanceToFordXFx(x, halfMeters);
  const fordBlend =
    minFordDx < 26 * FX_ONE
      ? (1000 - fxSmoothstepPermille(mulDiv(Math.max(0, minFordDx - 12 * FX_ONE), 1000, 14 * FX_ONE))) | 0
      : 0;
  const riverHalfWidth = 22 * FX_ONE;
  const bankWidth = 14 * FX_ONE;

  let groundY = hillHeight;
  if (distRiver < riverHalfWidth) {
    const channelRatioPermille = fxSmoothstepPermille(mulDiv(distRiver, 1000, riverHalfWidth));
    const maxDepth = (-2450 + mulDiv(2230, fordBlend, 1000)) | 0;
    groundY = (
      mulDiv(maxDepth, 1000 - channelRatioPermille, 1000) +
      mulDiv(-140, channelRatioPermille, 1000)
    ) | 0;
  } else if (distRiver < riverHalfWidth + bankWidth) {
    const bankT = fxSmoothstepPermille(mulDiv(distRiver - riverHalfWidth, 1000, bankWidth));
    let bankGroundY = (mulDiv(-140, 1000 - bankT, 1000) + mulDiv(hillHeight, bankT, 1000)) | 0;
    if (roadDx < 18 * FX_ONE && distRiver >= 20 * FX_ONE) {
      const abutXPermille = (1000 - fxSmoothstepPermille(mulDiv(Math.max(0, roadDx - 10 * FX_ONE), 1000, 8 * FX_ONE))) | 0;
      const abutZPermille = fxSmoothstepPermille(mulDiv(distRiver - 20 * FX_ONE, 1000, 4 * FX_ONE));
      const abutPermille = mulDiv(abutXPermille, abutZPermille, 1000);
      bankGroundY = (mulDiv(bankGroundY, 1000 - abutPermille, 1000) + mulDiv(820, abutPermille, 1000)) | 0;
    }
    groundY = bankGroundY;
  }

  if (includeBridgeDeck && isOnBridgeFx(x, z, halfMeters)) {
    const dz = fxAbs(z - centerFx);
    const tPermille = fxClamp(1000 - mulDiv(dz, 1000, 24 * FX_ONE), 0, 1000);
    const smoothArchPermille = fxSmoothstepPermille(tPermille);
    const deckY = (820 + mulDiv(1350, smoothArchPermille, 1000)) | 0;
    if (deckY > groundY) return deckY | 0;
  }

  return groundY | 0;
}

/**
 * Exact barycentric height on the 512x512 THREE.PlaneGeometry triangles (and exact bridge deck on bridges),
 * guaranteeing 0.000mm visual discrepancy between rendered terrain triangles and unit hooves/feet.
 */
export function sampleTerrainMeshHeightMeters(
  xMeters,
  zMeters,
  includeBridgeDeck = true,
  worldSizeMeters = DEFAULT_WORLD_SIZE_METERS
) {
  const xFx = Math.round(xMeters * FX_ONE) | 0;
  const zFx = Math.round(zMeters * FX_ONE) | 0;
  const halfMeters = (worldSizeMeters >> 1) | 0;
  if (includeBridgeDeck && isOnBridgeFx(xFx, zFx, halfMeters)) {
    return sampleTerrainHeightFx(xFx, zFx, true, worldSizeMeters) / FX_ONE;
  }
  const segs = 256;
  const cell = worldSizeMeters / segs; // 16m
  const gx = Math.max(0, Math.min(segs - 1, Math.floor(xMeters / cell)));
  const gz = Math.max(0, Math.min(segs - 1, Math.floor(zMeters / cell)));
  const x0 = gx * cell;
  const z0 = gz * cell;
  const tx = Math.max(0, Math.min(1, (xMeters - x0) / cell));
  const tz = Math.max(0, Math.min(1, (zMeters - z0) / cell));

  const h00 = sampleTerrainHeightFx((x0 * FX_ONE) | 0, (z0 * FX_ONE) | 0, false, worldSizeMeters) / FX_ONE;
  const h10 = sampleTerrainHeightFx(((x0 + cell) * FX_ONE) | 0, (z0 * FX_ONE) | 0, false, worldSizeMeters) / FX_ONE;
  const h01 = sampleTerrainHeightFx((x0 * FX_ONE) | 0, ((z0 + cell) * FX_ONE) | 0, false, worldSizeMeters) / FX_ONE;
  const h11 = sampleTerrainHeightFx(((x0 + cell) * FX_ONE) | 0, ((z0 + cell) * FX_ONE) | 0, false, worldSizeMeters) / FX_ONE;

  if (tx + tz <= 1) {
    return h00 + tx * (h10 - h00) + tz * (h01 - h00);
  }
  return h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
}

export function classifyTileTypeFx(fxX, fxZ, worldSizeMeters = DEFAULT_WORLD_SIZE_METERS) {
  const halfMeters = (worldSizeMeters >> 1) | 0;
  const x = fxX | 0;
  const z = fxZ | 0;

  if (isOnBridgeSideWallFx(x, z, halfMeters)) {
    return NavTileType.BLOCKED;
  }

  if (isOnWalkableBridgeDeckFx(x, z, halfMeters)) {
    return NavTileType.BRIDGE;
  }

  const customMap = getActiveCustomMapState();
  if (customMap && customMap.isCustomMapActive) {
    const biomeId = sampleCustomMapBiomeId(customMap, x / FX_ONE, z / FX_ONE);
    if (biomeId === 9) return NavTileType.BLOCKED;     // Carved Deep River / Lake Bed
    if (biomeId === 10) return NavTileType.MUD_WATER;  // Painted Shallow Walkable Ford

    const waterLevelFx = Math.round((customMap.waterLevelMeters ?? -0.08) * FX_ONE) | 0;
    const y = sampleTerrainHeightFx(x, z, false, worldSizeMeters);
    if (y < waterLevelFx - 150) return NavTileType.BLOCKED;
    if (y <= waterLevelFx + 220) return NavTileType.MUD_WATER;
    if (y >= 4600) return NavTileType.HILL;
    if (customMap.hasCentralRiver === false) return NavTileType.PLAINS;
  }

  const riverZ = computeRiverCenterZFx(x, halfMeters);
  const distRiver = fxAbs(z - riverZ);
  if (distRiver < 22 * FX_ONE) {
    return isInShallowFordZoneFx(x, halfMeters) ? NavTileType.MUD_WATER : NavTileType.BLOCKED;
  }

  const y = sampleTerrainHeightFx(x, z, false, worldSizeMeters);
  if (y < 0) return NavTileType.BLOCKED;
  if (y <= 220) return NavTileType.MUD_WATER;
  if (y >= 4600) return NavTileType.HILL;
  return NavTileType.PLAINS;
}

export class NavGrid {
  constructor(config = {}) {
    this.tilesX = (config?.map?.tilesX | 0) || 1024;
    this.tilesZ = (config?.map?.tilesZ | 0) || 1024;
    this.tileSizeMeters = (config?.map?.tileSizeMeters | 0) || 4;
    this.tileSizeFx = (this.tileSizeMeters * FX_ONE) | 0;
    this.halfTileFx = (this.tileSizeFx >> 1) | 0;
    this.worldSizeMeters = (this.tilesX * this.tileSizeMeters) | 0;
    this.worldSizeFx = (this.worldSizeMeters * FX_ONE) | 0;
    this.centerMeters = (this.worldSizeMeters >> 1) | 0;

    this.totalTiles = (this.tilesX * this.tilesZ) | 0;
    this.tiles = new Uint8Array(this.totalTiles);
    this.heightCacheFx = new Int32Array(this.totalTiles);
    this.version = 1;

    this._buildInitialGrid(config);
  }

  _buildInitialGrid(config) {
    for (let tz = 0; tz < this.tilesZ; tz++) {
      const worldZFx = (tz * this.tileSizeFx + this.halfTileFx) | 0;
      const rowOffset = (tz * this.tilesX) | 0;
      for (let tx = 0; tx < this.tilesX; tx++) {
        const worldXFx = (tx * this.tileSizeFx + this.halfTileFx) | 0;
        const idx = (rowOffset + tx) | 0;
        const tileType = classifyTileTypeFx(worldXFx, worldZFx, this.worldSizeMeters);
        this.tiles[idx] = tileType;
        this.heightCacheFx[idx] = sampleTerrainHeightFx(
          worldXFx,
          worldZFx,
          tileType === NavTileType.BRIDGE,
          this.worldSizeMeters
        );
      }
    }

    const trees = generateDeterministicTreesFx(config, this.worldSizeMeters);
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const tileX = this.worldFxToTileX(t.xFx);
      const tileZ = this.worldFxToTileZ(t.zFx);
      if (!this.isValidTile(tileX, tileZ)) continue;
      const nIdx = this.getTileIndex(tileX, tileZ);
      if (
        this.tiles[nIdx] === NavTileType.PLAINS ||
        this.tiles[nIdx] === NavTileType.HILL
      ) {
        this.tiles[nIdx] = NavTileType.FOREST;
      }
    }

    const mines = generateDeterministicMinesFx(this.worldSizeMeters);
    for (let i = 0; i < mines.length; i++) {
      const m = mines[i];
      const mtx = this.worldFxToTileX(m.xFx);
      const mtz = this.worldFxToTileZ(m.zFx);
      this.setTileType(mtx, mtz, NavTileType.BLOCKED);
    }
  }

  isValidTile(tx, tz) {
    const x = tx | 0;
    const z = tz | 0;
    return x >= 0 && x < this.tilesX && z >= 0 && z < this.tilesZ;
  }

  getTileIndex(tx, tz) {
    return ((tz | 0) * this.tilesX + (tx | 0)) | 0;
  }

  worldFxToTileX(fxX) {
    const raw = ((fxX | 0) / this.tileSizeFx) | 0;
    return fxClamp(raw, 0, this.tilesX - 1);
  }

  worldFxToTileZ(fxZ) {
    const raw = ((fxZ | 0) / this.tileSizeFx) | 0;
    return fxClamp(raw, 0, this.tilesZ - 1);
  }

  tileToWorldCenterFxX(tx) {
    return ((tx | 0) * this.tileSizeFx + this.halfTileFx) | 0;
  }

  tileToWorldCenterFxZ(tz) {
    return ((tz | 0) * this.tileSizeFx + this.halfTileFx) | 0;
  }

  getTileType(tx, tz) {
    if (!this.isValidTile(tx, tz)) return NavTileType.BLOCKED;
    return this.tiles[this.getTileIndex(tx, tz)];
  }

  getTileTypeAtWorldFx(fxX, fxZ) {
    return this.getTileType(this.worldFxToTileX(fxX), this.worldFxToTileZ(fxZ));
  }

  setTileType(tx, tz, tileType) {
    if (!this.isValidTile(tx, tz)) return;
    this.tiles[this.getTileIndex(tx, tz)] = tileType & 0xff;
    this.version = (this.version + 1) | 0;
  }

  setRectTileType(minTx, minTz, maxTx, maxTz, tileType) {
    const x0 = fxClamp(minTx | 0, 0, this.tilesX - 1);
    const z0 = fxClamp(minTz | 0, 0, this.tilesZ - 1);
    const x1 = fxClamp(maxTx | 0, 0, this.tilesX - 1);
    const z1 = fxClamp(maxTz | 0, 0, this.tilesZ - 1);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        this.tiles[this.getTileIndex(x, z)] = tileType & 0xff;
      }
    }
    this.version = (this.version + 1) | 0;
  }

  isWalkable(tx, tz) {
    if (!this.isValidTile(tx, tz)) return false;
    return this.tiles[this.getTileIndex(tx, tz)] !== NavTileType.BLOCKED;
  }

  isWalkableTile(tx, tz) {
    return this.isWalkable(tx, tz);
  }

  isWalkableWorldFx(fxX, fxZ) {
    if (fxX < 0 || fxZ < 0 || fxX >= this.worldSizeFx || fxZ >= this.worldSizeFx) return false;
    return this.isWalkable(this.worldFxToTileX(fxX), this.worldFxToTileZ(fxZ));
  }

  getSpeedMultiplierPermille(tx, tz, isCavalry = false) {
    const type = this.getTileType(tx, tz);
    if (type === NavTileType.PLAINS || type === NavTileType.BRIDGE) {
      return TerrainSpeedPermille.PLAINS;
    }
    if (type === NavTileType.HILL) return TerrainSpeedPermille.HILL;
    if (type === NavTileType.MUD_WATER) return TerrainSpeedPermille.MUD_WATER;
    if (type === NavTileType.FOREST) {
      return isCavalry
        ? TerrainSpeedPermille.FOREST_CAVALRY
        : TerrainSpeedPermille.FOREST_INFANTRY;
    }
    return TerrainSpeedPermille.BLOCKED;
  }

  getSpeedMultiplierAtWorldFx(fxX, fxZ, isCavalry = false) {
    return this.getSpeedMultiplierPermille(
      this.worldFxToTileX(fxX),
      this.worldFxToTileZ(fxZ),
      isCavalry
    );
  }

  getTraversalCost(tx, tz, isCavalry = false) {
    const type = this.getTileType(tx, tz);
    if (type === NavTileType.PLAINS || type === NavTileType.BRIDGE) {
      return TerrainBaseCost.PLAINS;
    }
    if (type === NavTileType.HILL) return TerrainBaseCost.HILL;
    if (type === NavTileType.MUD_WATER) return TerrainBaseCost.MUD_WATER;
    if (type === NavTileType.FOREST) {
      return isCavalry
        ? TerrainBaseCost.FOREST_CAVALRY
        : TerrainBaseCost.FOREST_INFANTRY;
    }
    return TerrainBaseCost.BLOCKED;
  }

  sampleHeightAtWorldFx(fxX, fxZ) {
    return sampleTerrainHeightFx(fxX, fxZ, true, this.worldSizeMeters);
  }

  findNearestWalkableTile(tx, tz, maxRadius = 24) {
    const startX = fxClamp(tx | 0, 0, this.tilesX - 1);
    const startZ = fxClamp(tz | 0, 0, this.tilesZ - 1);
    if (this.isWalkable(startX, startZ)) return { tx: startX, tz: startZ };

    const limit = maxRadius | 0;
    for (let r = 1; r <= limit; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (fxAbs(dx) !== r && fxAbs(dz) !== r) continue;
          const cx = (startX + dx) | 0;
          const cz = (startZ + dz) | 0;
          if (this.isWalkable(cx, cz)) {
            return { tx: cx, tz: cz };
          }
        }
      }
    }
    return { tx: this.tilesX >> 1, tz: this.tilesZ >> 1 };
  }

  hasClearLine(tx0, tz0, tx1, tz1) {
    let x0 = tx0 | 0;
    let z0 = tz0 | 0;
    const x1 = tx1 | 0;
    const z1 = tz1 | 0;

    const dx = fxAbs(x1 - x0);
    const dz = fxAbs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = (dx - dz) | 0;

    while (true) {
      if (!this.isWalkable(x0, z0)) return false;
      if (x0 === x1 && z0 === z1) break;

      const e2 = (err << 1) | 0;
      let stepX = false;
      let stepZ = false;
      const prevX = x0;
      const prevZ = z0;

      if (e2 > -dz) {
        err = (err - dz) | 0;
        x0 = (x0 + sx) | 0;
        stepX = true;
      }
      if (e2 < dx) {
        err = (err + dx) | 0;
        z0 = (z0 + sz) | 0;
        stepZ = true;
      }

      if (stepX && stepZ) {
        if (!this.isWalkable(x0, prevZ) || !this.isWalkable(prevX, z0)) {
          return false;
        }
      }
    }
    return true;
  }
}