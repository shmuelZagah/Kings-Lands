/**
 * Kings Lands — Single Source of Truth for Deterministic World Resource Generation
 * (src/sim/world/worldGen.js)
 *
 * Unifies deterministic tree and mine generation across `NavGrid`, `EconomySystem`,
 * and `TerrainRenderer` across the 16x expanded 4096m x 4096m battlefield, including
 * Custom Maps authored in the 3D Map Editor (with selectable skins per resource).
 */

import { FX_ONE, fxAbs, mulDiv } from '../../core/fx.js';
import {
  DEFAULT_WORLD_SIZE_METERS,
  NavTileType,
  classifyTileTypeFx,
  sampleTerrainHeightFx
} from '../nav/grid.js';
import { getActiveCustomMapState } from '../../tools/map_editor/mapStateManager.js';

export const AUTHORITATIVE_MINE_SPECS = Object.freeze([
  // Player Home Valley (around 2048, 1660)
  { id: 1, x: 1940, z: 1630, type: 'iron' },
  { id: 2, x: 2140, z: 1610, type: 'coins' },
  { id: 3, x: 1980, z: 1560, type: 'stone' },
  { id: 4, x: 1840, z: 1710, type: 'iron' },
  { id: 5, x: 2220, z: 1710, type: 'stone' },
  { id: 6, x: 2048, z: 1480, type: 'coins' },

  // Southern Expansion & Flanks
  { id: 7, x: 1024, z: 1380, type: 'coins' },
  { id: 8, x: 1140, z: 1460, type: 'iron' },
  { id: 9, x: 920, z: 1480, type: 'stone' },
  { id: 10, x: 3072, z: 1380, type: 'coins' },
  { id: 11, x: 2960, z: 1460, type: 'iron' },
  { id: 12, x: 3180, z: 1480, type: 'stone' },

  // Contested River Valley & Mid-Map Ridges
  { id: 13, x: 1536, z: 1820, type: 'coins' },
  { id: 14, x: 2560, z: 1820, type: 'iron' },
  { id: 15, x: 1536, z: 2280, type: 'iron' },
  { id: 16, x: 2560, z: 2280, type: 'coins' },

  // Enemy Northern Citadel Base (around 2048, 2420)
  { id: 17, x: 1930, z: 2450, type: 'iron' },
  { id: 18, x: 2160, z: 2450, type: 'coins' },
  { id: 19, x: 1970, z: 2540, type: 'stone' },
  { id: 20, x: 2130, z: 2540, type: 'iron' },

  // Far North-West & Outer Corners
  { id: 21, x: 1024, z: 2640, type: 'coins' },
  { id: 22, x: 1140, z: 2690, type: 'stone' },
  { id: 23, x: 910, z: 2690, type: 'iron' },
  { id: 24, x: 3072, z: 2520, type: 'stone' },
  { id: 25, x: 560, z: 720, type: 'coins' },
  { id: 26, x: 3520, z: 720, type: 'stone' },
  { id: 27, x: 560, z: 3360, type: 'stone' },
  { id: 28, x: 3520, z: 3360, type: 'coins' }
]);

/**
 * Generates the exact deterministic list of trees in Fixed-Point coordinates.
 * Used identically by `NavGrid`, `EconomySystem`, and `TerrainRenderer`.
 */
export function generateDeterministicTreesFx(
  config = {},
  worldSizeMeters = DEFAULT_WORLD_SIZE_METERS
) {
  const customMap = getActiveCustomMapState();
  if (customMap && customMap.isCustomMapActive && Array.isArray(customMap.trees)) {
    return customMap.trees.map((t, idx) => {
      const xFx = Math.round((Number(t.x) || 0) * FX_ONE) | 0;
      const zFx = Math.round((Number(t.z) || 0) * FX_ONE) | 0;
      const yFx = sampleTerrainHeightFx(xFx, zFx, false, worldSizeMeters);
      const scalePermille = Math.max(400, Math.round((Number(t.scale) || 1.0) * 1000)) | 0;
      return {
        id: idx,
        xFx,
        yFx,
        zFx,
        scalePermille,
        rotY: Number(t.rotY) || 0,
        skinId: t.skinId || 'pine_emerald'
      };
    });
  }

  let seed = 987654321;
  const nextRandFx = (spanFx) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const u = seed >>> 0;
    return Number((BigInt(u) * BigInt(spanFx | 0)) >> 32n) | 0;
  };

  const targetTreeCount = (config?.map?.treeCount | 0) || 1600;
  const worldSizeFx = (worldSizeMeters * FX_ONE) | 0;
  const halfMeters = (worldSizeMeters >> 1) | 0;
  const qMeters = (halfMeters >> 1) | 0;
  const marginFx = 48 * FX_ONE;
  const spanFx = (worldSizeFx - 96 * FX_ONE) | 0;

  const bridgeXsFx = [
    (qMeters * FX_ONE) | 0,
    (halfMeters * FX_ONE) | 0,
    ((halfMeters + qMeters) * FX_ONE) | 0
  ];

  const trees = [];
  let treeId = 0;

  const homeClusterCenters = [
    { cx: 1890, cz: 1600, count: 45, spread: 85 },
    { cx: 2210, cz: 1600, count: 45, spread: 85 },
    { cx: 1850, cz: 1820, count: 40, spread: 80 },
    { cx: 2240, cz: 1820, count: 40, spread: 80 },
    { cx: 1890, cz: 2360, count: 45, spread: 90 },
    { cx: 2210, cz: 2360, count: 45, spread: 90 }
  ];

  for (let c = 0; c < homeClusterCenters.length; c++) {
    const cl = homeClusterCenters[c];
    const spreadFx = (cl.spread * FX_ONE) | 0;
    let added = 0;
    let tries = 0;
    while (added < cl.count && tries < cl.count * 4) {
      tries++;
      const xFx = ((cl.cx * FX_ONE) - (spreadFx >> 1) + nextRandFx(spreadFx)) | 0;
      const zFx = ((cl.cz * FX_ONE) - (spreadFx >> 1) + nextRandFx(spreadFx)) | 0;
      const tileType = classifyTileTypeFx(xFx, zFx, worldSizeMeters);
      if (
        tileType === NavTileType.BLOCKED ||
        tileType === NavTileType.MUD_WATER ||
        tileType === NavTileType.BRIDGE
      ) {
        continue;
      }
      const yFx = sampleTerrainHeightFx(xFx, zFx, false, worldSizeMeters);
      const randScaleFx = nextRandFx(FX_ONE);
      const scalePermille = (920 + mulDiv(randScaleFx, 620, FX_ONE)) | 0;
      trees.push({
        id: treeId++,
        xFx,
        yFx,
        zFx,
        scalePermille,
        skinId: 'pine_emerald'
      });
      added++;
    }
  }

  let attempts = 0;
  const maxAttempts = (targetTreeCount * 6) | 0;

  while (treeId < targetTreeCount && attempts < maxAttempts) {
    attempts = (attempts + 1) | 0;
    const xFx = (marginFx + nextRandFx(spanFx)) | 0;
    const zFx = (marginFx + nextRandFx(spanFx)) | 0;

    let onBridgeRoad = false;
    for (let b = 0; b < 3; b++) {
      if (fxAbs(xFx - bridgeXsFx[b]) < 32 * FX_ONE) {
        onBridgeRoad = true;
        break;
      }
    }
    if (onBridgeRoad) continue;

    if (fxAbs(xFx - 2048 * FX_ONE) < 95 * FX_ONE && fxAbs(zFx - 1700 * FX_ONE) < 95 * FX_ONE) {
      continue;
    }
    if (fxAbs(xFx - 2048 * FX_ONE) < 95 * FX_ONE && fxAbs(zFx - 2380 * FX_ONE) < 95 * FX_ONE) {
      continue;
    }

    const tileType = classifyTileTypeFx(xFx, zFx, worldSizeMeters);
    if (
      tileType === NavTileType.BLOCKED ||
      tileType === NavTileType.MUD_WATER ||
      tileType === NavTileType.BRIDGE
    ) {
      continue;
    }

    const yFx = sampleTerrainHeightFx(xFx, zFx, false, worldSizeMeters);
    if (yFx < 460) continue;

    const randScaleFx = nextRandFx(FX_ONE);
    const scalePermille = (900 + mulDiv(randScaleFx, 650, FX_ONE)) | 0;

    trees.push({
      id: treeId++,
      xFx,
      yFx,
      zFx,
      scalePermille,
      skinId: 'pine_emerald'
    });
  }

  return trees;
}

/**
 * Generates the exact deterministic list of mines in Fixed-Point coordinates.
 */
export function generateDeterministicMinesFx(worldSizeMeters = DEFAULT_WORLD_SIZE_METERS) {
  const customMap = getActiveCustomMapState();
  if (customMap && customMap.isCustomMapActive && Array.isArray(customMap.mines)) {
    return customMap.mines.map((m, idx) => {
      const xFx = Math.round((Number(m.x) || 0) * FX_ONE) | 0;
      const zFx = Math.round((Number(m.z) || 0) * FX_ONE) | 0;
      const yFx = sampleTerrainHeightFx(xFx, zFx, false, worldSizeMeters);
      const resourceType = m.type || m.resourceType || 'coins';
      return {
        id: m.id ?? (idx + 1),
        resourceType,
        xFx,
        yFx,
        zFx,
        skinId: m.skinId || (resourceType === 'iron' ? 'iron_outcrop' : resourceType === 'stone' ? 'stone_granite' : 'gold_vein'),
        rotY: Number(m.rotY) || 0,
        scale: Number(m.scale) || 1.0
      };
    });
  }

  const mines = [];
  for (let i = 0; i < AUTHORITATIVE_MINE_SPECS.length; i++) {
    const spec = AUTHORITATIVE_MINE_SPECS[i];
    const xFx = (spec.x * FX_ONE) | 0;
    const zFx = (spec.z * FX_ONE) | 0;
    const yFx = sampleTerrainHeightFx(xFx, zFx, false, worldSizeMeters);
    mines.push({
      id: spec.id,
      resourceType: spec.type,
      xFx,
      yFx,
      zFx,
      skinId: spec.type === 'iron' ? 'iron_outcrop' : spec.type === 'stone' ? 'stone_granite' : 'gold_vein',
      rotY: 0,
      scale: 1.0
    });
  }
  return mines;
}