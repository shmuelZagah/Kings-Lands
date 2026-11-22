/**
 * Kings Lands — Phase 3: Deterministic Flow Fields with LRU Caching (src/sim/nav/flowField.js)
 */

import { fxClamp } from '../../core/fx.js';

const INF_COST = 0x3fffffff;

// 8-way neighbor offsets: N, E, S, W, NE, SE, SW, NW
const FF_DX = new Int32Array([0, 1, 0, -1, 1, 1, -1, -1]);
const FF_DZ = new Int32Array([-1, 0, 1, 0, -1, 1, 1, -1]);
const FF_STEP_SCALE = new Int32Array([100, 100, 100, 100, 141, 141, 141, 141]);

// Precomputed Fixed-Point unit vectors (length = FX_ONE = 1024; 724 = round(1024 / sqrt(2)))
const FF_VEC_X_FX = new Int32Array([0, 1024, 0, -1024, 724, 724, -724, -724]);
const FF_VEC_Z_FX = new Int32Array([-1024, 0, 1024, 0, -724, 724, 724, -724]);

export class FlowField {
  constructor(params) {
    this.key = params.key;
    this.goalTx = params.goalTx | 0;
    this.goalTz = params.goalTz | 0;
    this.goalFxX = params.goalFxX | 0;
    this.goalFxZ = params.goalFxZ | 0;
    this.isCavalry = Boolean(params.isCavalry);
    this.minTx = params.minTx | 0;
    this.minTz = params.minTz | 0;
    this.maxTx = params.maxTx | 0;
    this.maxTz = params.maxTz | 0;
    this.width = (this.maxTx - this.minTx + 1) | 0;
    this.height = (this.maxTz - this.minTz + 1) | 0;
    this.dirIndexGrid = params.dirIndexGrid;
    this.grid = params.grid;
    this.gridVersion = params.grid.version | 0;
    this.lastUsedTick = params.createdAtTick | 0;
  }

  containsTile(tx, tz) {
    const x = tx | 0;
    const z = tz | 0;
    return x >= this.minTx && x <= this.maxTx && z >= this.minTz && z <= this.maxTz;
  }

  sampleDirectionFx(fxX, fxZ) {
    const tx = this.grid.worldFxToTileX(fxX);
    const tz = this.grid.worldFxToTileZ(fxZ);
    if (!this.containsTile(tx, tz)) {
      return { vxFx: 0, vzFx: 0, valid: false };
    }
    const localIdx = (((tz - this.minTz) * this.width) + (tx - this.minTx)) | 0;
    const dirIdx = this.dirIndexGrid[localIdx];
    if (dirIdx < 0 || dirIdx > 7) {
      return { vxFx: 0, vzFx: 0, valid: false };
    }
    return {
      vxFx: FF_VEC_X_FX[dirIdx],
      vzFx: FF_VEC_Z_FX[dirIdx],
      valid: true
    };
  }
}

export class FlowFieldManager {
  constructor(navGrid, maxCacheEntries = 16) {
    this.grid = navGrid;
    this.maxCacheEntries = maxCacheEntries | 0;
    this.cache = new Map();

    const maxTiles = this.grid.totalTiles;
    this._integrationCost = new Int32Array(maxTiles);
    // Double capacity to safely handle lazy-deletion Dijkstra pushes
    this._heapNodes = new Int32Array(maxTiles * 2);
    this._heapCosts = new Int32Array(maxTiles * 2);
    this._heapSize = 0;
  }

  clearCache() {
    this.cache.clear();
  }

  _makeKey(goalTx, goalTz, isCavalry) {
    return `${goalTx | 0}:${goalTz | 0}:${isCavalry ? 1 : 0}:${this.grid.version | 0}`;
  }

  getOrCreateFlowField(goalFxX, goalFxZ, sourcePositionsFx = [], options = {}) {
    const isCavalry = Boolean(options.isCavalry);
    const currentTick = (options.tick | 0) || 0;
    const rawGoalTx = this.grid.worldFxToTileX(goalFxX);
    const rawGoalTz = this.grid.worldFxToTileZ(goalFxZ);
    const walkableGoal = this.grid.findNearestWalkableTile(rawGoalTx, rawGoalTz, 24);
    const goalTx = walkableGoal.tx | 0;
    const goalTz = walkableGoal.tz | 0;

    const resolvedGoalFxX = (goalTx === rawGoalTx && goalTz === rawGoalTz)
      ? (goalFxX | 0)
      : this.grid.tileToWorldCenterFxX(goalTx);
    const resolvedGoalFxZ = (goalTx === rawGoalTx && goalTz === rawGoalTz)
      ? (goalFxZ | 0)
      : this.grid.tileToWorldCenterFxZ(goalTz);

    let reqMinTx = goalTx;
    let reqMaxTx = goalTx;
    let reqMinTz = goalTz;
    let reqMaxTz = goalTz;

    for (let i = 0; i < sourcePositionsFx.length; i++) {
      const p = sourcePositionsFx[i];
      const ptx = this.grid.worldFxToTileX(p.xFx);
      const ptz = this.grid.worldFxToTileZ(p.zFx);
      if (ptx < reqMinTx) reqMinTx = ptx;
      if (ptx > reqMaxTx) reqMaxTx = ptx;
      if (ptz < reqMinTz) reqMinTz = ptz;
      if (ptz > reqMaxTz) reqMaxTz = ptz;
    }

    // Ensure central bridge / river crossings are included whenever units are near or crossing the river
    const centerTile = this.grid.tilesZ >> 1;
    if (reqMinTz <= centerTile + 18 && reqMaxTz >= centerTile - 18) {
      if (centerTile < reqMinTx) reqMinTx = centerTile;
      if (centerTile > reqMaxTx) reqMaxTx = centerTile;
      if (centerTile - 20 < reqMinTz) reqMinTz = centerTile - 20;
      if (centerTile + 20 > reqMaxTz) reqMaxTz = centerTile + 20;
    }

    const padding = (options.paddingTiles | 0) || 36;
    const minTx = fxClamp(reqMinTx - padding, 0, this.grid.tilesX - 1);
    const maxTx = fxClamp(reqMaxTx + padding, 0, this.grid.tilesX - 1);
    const minTz = fxClamp(reqMinTz - padding, 0, this.grid.tilesZ - 1);
    const maxTz = fxClamp(reqMaxTz + padding, 0, this.grid.tilesZ - 1);

    const key = this._makeKey(goalTx, goalTz, isCavalry);
    const cached = this.cache.get(key);
    if (
      cached &&
      cached.gridVersion === this.grid.version &&
      cached.minTx <= minTx &&
      cached.maxTx >= maxTx &&
      cached.minTz <= minTz &&
      cached.maxTz >= maxTz
    ) {
      cached.lastUsedTick = currentTick;
      return cached;
    }

    const finalMinTx = cached ? (minTx < cached.minTx ? minTx : cached.minTx) : minTx;
    const finalMaxTx = cached ? (maxTx > cached.maxTx ? maxTx : cached.maxTx) : maxTx;
    const finalMinTz = cached ? (minTz < cached.minTz ? minTz : cached.minTz) : minTz;
    const finalMaxTz = cached ? (maxTz > cached.maxTz ? maxTz : cached.maxTz) : maxTz;

    const field = this._buildField(
      key,
      goalTx,
      goalTz,
      resolvedGoalFxX,
      resolvedGoalFxZ,
      isCavalry,
      finalMinTx,
      finalMinTz,
      finalMaxTx,
      finalMaxTz,
      currentTick
    );

    if (this.cache.size >= this.maxCacheEntries && !this.cache.has(key)) {
      this._evictOldest();
    }
    this.cache.set(key, field);
    return field;
  }

  getFlowFieldByKey(key, currentTick = 0) {
    const field = this.cache.get(key);
    if (!field || field.gridVersion !== this.grid.version) return null;
    field.lastUsedTick = currentTick | 0;
    return field;
  }

  _evictOldest() {
    let oldestKey = null;
    let oldestTick = 0x7fffffff;
    for (const [k, v] of this.cache.entries()) {
      if (v.lastUsedTick < oldestTick) {
        oldestTick = v.lastUsedTick;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) this.cache.delete(oldestKey);
  }

  _heapPush(localIdx, cost) {
    let i = this._heapSize | 0;
    if (i >= this._heapNodes.length) return;
    const node = localIdx | 0;
    const c = cost | 0;
    this._heapSize = (i + 1) | 0;

    while (i > 0) {
      const parentIdx = (i - 1) >> 1;
      const parentNode = this._heapNodes[parentIdx] | 0;
      const parentCost = this._heapCosts[parentIdx] | 0;
      if (c > parentCost || (c === parentCost && node > parentNode)) break;
      this._heapNodes[i] = parentNode;
      this._heapCosts[i] = parentCost;
      i = parentIdx;
    }
    this._heapNodes[i] = node;
    this._heapCosts[i] = c;
  }

  _heapPopNode() {
    const topNode = this._heapNodes[0] | 0;
    this._heapSize = (this._heapSize - 1) | 0;
    const size = this._heapSize | 0;
    if (size > 0) {
      const lastNode = this._heapNodes[size] | 0;
      const lastCost = this._heapCosts[size] | 0;
      let i = 0;
      const half = size >> 1;

      while (i < half) {
        let bestChild = (i << 1) + 1;
        let bestNode = this._heapNodes[bestChild] | 0;
        let bestCost = this._heapCosts[bestChild] | 0;

        const right = (bestChild + 1) | 0;
        if (right < size) {
          const rightNode = this._heapNodes[right] | 0;
          const rightCost = this._heapCosts[right] | 0;
          if (rightCost < bestCost || (rightCost === bestCost && rightNode < bestNode)) {
            bestChild = right;
            bestNode = rightNode;
            bestCost = rightCost;
          }
        }

        if (lastCost < bestCost || (lastCost === bestCost && lastNode <= bestNode)) break;
        this._heapNodes[i] = bestNode;
        this._heapCosts[i] = bestCost;
        i = bestChild;
      }
      this._heapNodes[i] = lastNode;
      this._heapCosts[i] = lastCost;
    }
    return topNode;
  }

  _buildField(
    key,
    goalTx,
    goalTz,
    resolvedGoalFxX,
    resolvedGoalFxZ,
    isCavalry,
    minTx,
    minTz,
    maxTx,
    maxTz,
    tick
  ) {
    const width = (maxTx - minTx + 1) | 0;
    const height = (maxTz - minTz + 1) | 0;
    const count = (width * height) | 0;

    for (let i = 0; i < count; i++) {
      this._integrationCost[i] = INF_COST;
    }

    const goalLocalIdx = (((goalTz - minTz) * width) + (goalTx - minTx)) | 0;
    this._integrationCost[goalLocalIdx] = 0;
    this._heapSize = 0;
    this._heapPush(goalLocalIdx, 0);

    // 1. Dijkstra Integration Pass
    while (this._heapSize > 0) {
      const poppedCost = this._heapCosts[0] | 0;
      const currLocal = this._heapPopNode();
      const currCost = this._integrationCost[currLocal] | 0;

      // Skip stale heap entries
      if (poppedCost > currCost) continue;

      const localZ = (currLocal / width) | 0;
      const localX = (currLocal - localZ * width) | 0;
      const tx = (minTx + localX) | 0;
      const tz = (minTz + localZ) | 0;

      for (let d = 0; d < 8; d++) {
        const dx = FF_DX[d];
        const dz = FF_DZ[d];
        const ntx = (tx + dx) | 0;
        const ntz = (tz + dz) | 0;

        if (ntx < minTx || ntx > maxTx || ntz < minTz || ntz > maxTz) continue;
        if (!this.grid.isWalkable(ntx, ntz)) continue;

        if (d >= 4) {
          if (!this.grid.isWalkable(tx + dx, tz) || !this.grid.isWalkable(tx, tz + dz)) {
            continue;
          }
        }

        const nLocal = (((ntz - minTz) * width) + (ntx - minTx)) | 0;
        const baseTileCost = this.grid.getTraversalCost(ntx, ntz, isCavalry);
        const stepCost = ((baseTileCost * FF_STEP_SCALE[d]) / 100) | 0;
        const nextCost = (currCost + stepCost) | 0;

        if (nextCost < this._integrationCost[nLocal]) {
          this._integrationCost[nLocal] = nextCost;
          this._heapPush(nLocal, nextCost);
        }
      }
    }

    // 2. Vector Direction Pass
    const dirIndexGrid = new Int8Array(count);
    dirIndexGrid.fill(-1);

    for (let localZ = 0; localZ < height; localZ++) {
      const tz = (minTz + localZ) | 0;
      const rowBase = (localZ * width) | 0;
      for (let localX = 0; localX < width; localX++) {
        const tx = (minTx + localX) | 0;
        const idx = (rowBase + localX) | 0;
        const selfCost = this._integrationCost[idx] | 0;
        if (selfCost === INF_COST || (tx === goalTx && tz === goalTz)) continue;

        let bestDir = -1;
        let bestCost = selfCost;

        for (let d = 0; d < 8; d++) {
          const dx = FF_DX[d];
          const dz = FF_DZ[d];
          const ntx = (tx + dx) | 0;
          const ntz = (tz + dz) | 0;
          if (ntx < minTx || ntx > maxTx || ntz < minTz || ntz > maxTz) continue;

          if (d >= 4) {
            if (!this.grid.isWalkable(tx + dx, tz) || !this.grid.isWalkable(tx, tz + dz)) {
              continue;
            }
          }

          const nIdx = (((ntz - minTz) * width) + (ntx - minTx)) | 0;
          const nCost = this._integrationCost[nIdx] | 0;
          if (nCost < bestCost) {
            bestCost = nCost;
            bestDir = d;
          }
        }
        dirIndexGrid[idx] = bestDir;
      }
    }

    return new FlowField({
      key,
      goalTx,
      goalTz,
      goalFxX: resolvedGoalFxX,
      goalFxZ: resolvedGoalFxZ,
      isCavalry,
      minTx,
      minTz,
      maxTx,
      maxTz,
      dirIndexGrid,
      grid: this.grid,
      createdAtTick: tick
    });
  }
}