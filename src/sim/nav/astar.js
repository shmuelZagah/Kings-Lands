/**
 * Kings Lands — Phase 3 & 6: Deterministic Fixed-Point A* Pathfinder with Generic Corridor Centering
 * (src/sim/nav/astar.js)
 *
 * Upgraded for Generic Chokepoint / Bridge / Gate Synchronization:
 * 1. Wall-Clearance Cost Penalty (+36) during A* expansion so routes naturally prefer the center
 *    of bridges, gates, canyons, and gaps between buildings instead of hugging the unwalkable edge.
 * 2. Clearance-Aware String-Pulling (`_hasClearLineWithMargin`) so smoothed paths never clip river
 *    or wall corners and always preserve an Entrance Funnel Waypoint before any narrow passage.
 * 3. Automatic Corridor Centering (`_centerTileInCorridor`) on intermediate waypoints.
 */

import { fxAbs, fxClamp, FX_ONE } from '../../core/fx.js';

const BUILDING_ROUTE_CLEARANCE_FX = 1050;

const DIR_8_X = new Int32Array([0, 1, 0, -1, 1, 1, -1, -1]);
const DIR_8_Z = new Int32Array([-1, 0, 1, 0, -1, 1, 1, -1]);
const DIR_8_STEP_SCALE = new Int32Array([100, 100, 100, 100, 141, 141, 141, 141]);

export class AStar {
  /**
   * @param {import('./grid.js').NavGrid} navGrid
   */
  constructor(navGrid) {
    this.grid = navGrid;
    const total = this.grid.totalTiles;

    this._gScore = new Int32Array(total);
    this._fScore = new Int32Array(total);
    this._parent = new Int32Array(total);
    this._openStamp = new Int32Array(total);
    this._closedStamp = new Int32Array(total);
    this._heapIndex = new Int32Array(total);

    this._heapNodes = new Int32Array(total);
    this._heapSize = 0;
    this._searchId = 1;

    this._buildingsSource = null;
    this._bMask = new Uint8Array(total);
    this._bSig = 0;
    this._bMaskUsed = false;
  }

  setBuildingsSource(fn) {
    this._buildingsSource = typeof fn === 'function' ? fn : null;
    this._bSig = 0;
  }

  _syncBuildingMask() {
    const src = this._buildingsSource ? this._buildingsSource() : null;
    let sig = 17;
    let n = 0;
    if (src) {
      for (const b of src.values()) {
        if (!b || b.isDestroyed || b.hp <= 0) continue;
        n = (n + 1) | 0;
        sig = (Math.imul(sig, 31) + (b.id | 0)) | 0;
        sig = (Math.imul(sig, 31) + (b.xFx | 0)) | 0;
        sig = (Math.imul(sig, 31) + (b.zFx | 0)) | 0;
        sig = (Math.imul(sig, 31) + Math.round((b.footprintRadiusMeters || 4) * 10)) | 0;
      }
    }
    sig = (sig ^ (n << 20)) | 0;
    if (sig === this._bSig) return;
    this._bSig = sig;
    if (this._bMaskUsed) this._bMask.fill(0);
    this._bMaskUsed = false;
    if (!src) return;

    const g = this.grid;
    for (const b of src.values()) {
      if (!b || b.isDestroyed || b.hp <= 0) continue;
      const radFx = (Math.round((b.footprintRadiusMeters || 4) * FX_ONE) + BUILDING_ROUTE_CLEARANCE_FX) | 0;
      const r2 = radFx * radFx;
      const tx0 = Math.max(0, g.worldFxToTileX((b.xFx - radFx) | 0));
      const tx1 = Math.min(g.tilesX - 1, g.worldFxToTileX((b.xFx + radFx) | 0));
      const tz0 = Math.max(0, g.worldFxToTileZ((b.zFx - radFx) | 0));
      const tz1 = Math.min(g.tilesZ - 1, g.worldFxToTileZ((b.zFx + radFx) | 0));
      for (let tz = tz0; tz <= tz1; tz++) {
        const dz = g.tileToWorldCenterFxZ(tz) - b.zFx;
        for (let tx = tx0; tx <= tx1; tx++) {
          const dx = g.tileToWorldCenterFxX(tx) - b.xFx;
          if (dx * dx + dz * dz <= r2) {
            this._bMask[g.getTileIndex(tx, tz)] = 1;
            this._bMaskUsed = true;
          }
        }
      }
    }
  }

  _walk(tx, tz) {
    if (!this.grid.isWalkable(tx, tz)) return false;
    return this._bMask[this.grid.getTileIndex(tx, tz)] === 0;
  }

  /** True if `(tx, tz)` AND all 4 cardinal neighbors are walkable (safe clearance away from walls/river edges). */
  _walkWithClearance(tx, tz) {
    if (!this._walk(tx, tz)) return false;
    return (
      this._walk(tx + 1, tz) &&
      this._walk(tx - 1, tz) &&
      this._walk(tx, tz + 1) &&
      this._walk(tx, tz - 1)
    );
  }

  _nearestFreeTile(tx, tz, maxRadius) {
    const g = this.grid;
    const sx = Math.min(g.tilesX - 1, Math.max(0, tx | 0));
    const sz = Math.min(g.tilesZ - 1, Math.max(0, tz | 0));
    if (this._walk(sx, sz)) return { tx: sx, tz: sz };
    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (fxAbs(dx) !== r && fxAbs(dz) !== r) continue;
          if (this._walk(sx + dx, sz + dz)) return { tx: sx + dx, tz: sz + dz };
        }
      }
    }
    return g.findNearestWalkableTile(tx, tz, maxRadius);
  }

  hasClearLineWorldFx(x0Fx, z0Fx, x1Fx, z1Fx) {
    this._syncBuildingMask();
    return this._hasClearLine(
      this.grid.worldFxToTileX(x0Fx),
      this.grid.worldFxToTileZ(z0Fx),
      this.grid.worldFxToTileX(x1Fx),
      this.grid.worldFxToTileZ(z1Fx)
    );
  }

  _hasClearLine(tx0, tz0, tx1, tz1) {
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
      const nearEndpoint =
        (fxAbs(x0 - tx0) <= 1 && fxAbs(z0 - tz0) <= 1) ||
        (fxAbs(x0 - x1) <= 1 && fxAbs(z0 - z1) <= 1);
      if (nearEndpoint ? !this.grid.isWalkable(x0, z0) : !this._walk(x0, z0)) return false;
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
      if (stepX && stepZ && (!this._walk(x0, prevZ) || !this._walk(prevX, z0))) return false;
    }
    return true;
  }

  /**
   * Used during waypoint string-pulling so smoothed segments never graze 0-clearance corners
   * of rivers, bridges, or gates (preserving clean Entrance and Exit funnel waypoints).
   */
  _hasClearLineWithMargin(tx0, tz0, tx1, tz1) {
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
      if (!this._walk(x0, z0)) return false;
      if ((x0 !== tx0 || z0 !== tz0) && (x0 !== x1 || z0 !== z1)) {
        if (!this._walkWithClearance(x0, z0)) return false;
      }
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
      if (stepX && stepZ && (!this._walk(x0, prevZ) || !this._walk(prevX, z0))) return false;
    }
    return true;
  }

  _octileHeuristic(tx, tz, goalTx, goalTz) {
    const dx = fxAbs((tx | 0) - (goalTx | 0));
    const dz = fxAbs((tz | 0) - (goalTz | 0));
    const minD = dx < dz ? dx : dz;
    const maxD = dx > dz ? dx : dz;
    return ((maxD * 100) + (minD * 41)) | 0;
  }

  _heapPush(nodeIdx) {
    let i = this._heapSize | 0;
    this._heapNodes[i] = nodeIdx | 0;
    this._heapIndex[nodeIdx] = i;
    this._heapSize = (i + 1) | 0;
    this._heapBubbleUp(i);
  }

  _heapPop() {
    if (this._heapSize <= 0) return -1;
    const top = this._heapNodes[0] | 0;
    this._heapSize = (this._heapSize - 1) | 0;
    if (this._heapSize > 0) {
      const last = this._heapNodes[this._heapSize] | 0;
      this._heapNodes[0] = last;
      this._heapIndex[last] = 0;
      this._heapSinkDown(0);
    }
    return top;
  }

  _heapBubbleUp(idx) {
    let i = idx | 0;
    const node = this._heapNodes[i] | 0;
    const nodeF = this._fScore[node] | 0;

    while (i > 0) {
      const parentIdx = (i - 1) >> 1;
      const parentNode = this._heapNodes[parentIdx] | 0;
      const parentF = this._fScore[parentNode] | 0;
      if (nodeF > parentF || (nodeF === parentF && node > parentNode)) break;
      this._heapNodes[i] = parentNode;
      this._heapIndex[parentNode] = i;
      i = parentIdx;
    }
    this._heapNodes[i] = node;
    this._heapIndex[node] = i;
  }

  _heapSinkDown(idx) {
    let i = idx | 0;
    const size = this._heapSize | 0;
    const half = size >> 1;
    const node = this._heapNodes[i] | 0;
    const nodeF = this._fScore[node] | 0;

    while (i < half) {
      let bestChildIdx = (i << 1) + 1;
      let bestChildNode = this._heapNodes[bestChildIdx] | 0;
      let bestChildF = this._fScore[bestChildNode] | 0;

      const rightIdx = (bestChildIdx + 1) | 0;
      if (rightIdx < size) {
        const rightNode = this._heapNodes[rightIdx] | 0;
        const rightF = this._fScore[rightNode] | 0;
        if (rightF < bestChildF || (rightF === bestChildF && rightNode < bestChildNode)) {
          bestChildIdx = rightIdx;
          bestChildNode = rightNode;
          bestChildF = rightF;
        }
      }

      if (nodeF < bestChildF || (nodeF === bestChildF && node <= bestChildNode)) break;
      this._heapNodes[i] = bestChildNode;
      this._heapIndex[bestChildNode] = i;
      i = bestChildIdx;
    }
    this._heapNodes[i] = node;
    this._heapIndex[node] = i;
  }

  /**
   * Shifts an intermediate waypoint tile `(tx, tz)` away from adjacent walls/water into the center
   * of any narrow corridor (bridge, ford, gate, or gap between buildings).
   */
  _centerTileInCorridor(tx, tz) {
    const maxProbe = 4;
    let freeNegX = 0;
    let freePosX = 0;
    for (let d = 1; d <= maxProbe; d++) {
      if (!this._walk(tx - d, tz)) break;
      freeNegX = d;
    }
    for (let d = 1; d <= maxProbe; d++) {
      if (!this._walk(tx + d, tz)) break;
      freePosX = d;
    }

    let freeNegZ = 0;
    let freePosZ = 0;
    for (let d = 1; d <= maxProbe; d++) {
      if (!this._walk(tx, tz - d)) break;
      freeNegZ = d;
    }
    for (let d = 1; d <= maxProbe; d++) {
      if (!this._walk(tx, tz + d)) break;
      freePosZ = d;
    }

    let outTx = tx | 0;
    let outTz = tz | 0;

    const spanX = (freeNegX + freePosX) | 0;
    if (spanX > 0 && (freeNegX < maxProbe || freePosX < maxProbe)) {
      const shiftX = ((freePosX - freeNegX) >> 1) | 0;
      const candTx = fxClamp(outTx + shiftX, 0, this.grid.tilesX - 1);
      if (this._walk(candTx, outTz)) outTx = candTx;
    }

    const spanZ = (freeNegZ + freePosZ) | 0;
    if (spanZ > 0 && (freeNegZ < maxProbe || freePosZ < maxProbe)) {
      const shiftZ = ((freePosZ - freeNegZ) >> 1) | 0;
      const candTz = fxClamp(outTz + shiftZ, 0, this.grid.tilesZ - 1);
      if (this._walk(outTx, candTz)) outTz = candTz;
    }

    return { tx: outTx, tz: outTz };
  }

  findPath(startFxX, startFxZ, goalFxX, goalFxZ, options = {}) {
    const isCavalry = Boolean(options.isCavalry);
    const maxIterations = (options.maxIterations | 0) || 65536;
    const smoothPath = options.smooth !== false;

    const rawStartTx = this.grid.worldFxToTileX(startFxX);
    const rawStartTz = this.grid.worldFxToTileZ(startFxZ);
    const rawGoalTx = this.grid.worldFxToTileX(goalFxX);
    const rawGoalTz = this.grid.worldFxToTileZ(goalFxZ);

    this._syncBuildingMask();
    const startWalkable = this._nearestFreeTile(rawStartTx, rawStartTz, 16);
    const goalWalkable = this._nearestFreeTile(rawGoalTx, rawGoalTz, 24);
    const goalIsRealTarget = this.grid.isWalkable(rawGoalTx, rawGoalTz);

    const startTx = startWalkable.tx | 0;
    const startTz = startWalkable.tz | 0;
    const goalTx = goalWalkable.tx | 0;
    const goalTz = goalWalkable.tz | 0;

    const finalWorldXFx =
      goalIsRealTarget || (goalTx === rawGoalTx && goalTz === rawGoalTz)
        ? (goalFxX | 0)
        : this.grid.tileToWorldCenterFxX(goalTx);
    const finalWorldZFx =
      goalIsRealTarget || (goalTx === rawGoalTx && goalTz === rawGoalTz)
        ? (goalFxZ | 0)
        : this.grid.tileToWorldCenterFxZ(goalTz);

    if (startTx === goalTx && startTz === goalTz) {
      return [{ xFx: finalWorldXFx, zFx: finalWorldZFx }];
    }

    if (smoothPath && this._hasClearLineWithMargin(startTx, startTz, goalTx, goalTz)) {
      return [{ xFx: finalWorldXFx, zFx: finalWorldZFx }];
    }

    this._searchId = (this._searchId + 1) | 0;
    if (this._searchId >= 0x7ffffff0) {
      this._openStamp.fill(0);
      this._closedStamp.fill(0);
      this._searchId = 1;
    }
    const sid = this._searchId;
    this._heapSize = 0;

    const tilesX = this.grid.tilesX;
    const startIdx = this.grid.getTileIndex(startTx, startTz);
    const goalIdx = this.grid.getTileIndex(goalTx, goalTz);

    const startH = this._octileHeuristic(startTx, startTz, goalTx, goalTz);
    this._gScore[startIdx] = 0;
    this._fScore[startIdx] = startH;
    this._parent[startIdx] = -1;
    this._openStamp[startIdx] = sid;
    this._heapPush(startIdx);

    let bestNodeIdx = startIdx;
    let bestNodeH = startH;
    let iterations = 0;

    while (this._heapSize > 0 && iterations < maxIterations) {
      iterations = (iterations + 1) | 0;
      const currIdx = this._heapPop();
      if (currIdx === goalIdx) {
        bestNodeIdx = goalIdx;
        break;
      }

      this._closedStamp[currIdx] = sid;
      const currZ = (currIdx / tilesX) | 0;
      const currX = (currIdx - currZ * tilesX) | 0;
      const currG = this._gScore[currIdx] | 0;

      for (let d = 0; d < 8; d++) {
        const dx = DIR_8_X[d];
        const dz = DIR_8_Z[d];
        const nx = (currX + dx) | 0;
        const nz = (currZ + dz) | 0;

        if (!this._walk(nx, nz)) continue;

        if (d >= 4) {
          if (!this._walk(currX + dx, currZ) || !this._walk(currX, currZ + dz)) {
            continue;
          }
        }

        const nIdx = this.grid.getTileIndex(nx, nz);
        if (this._closedStamp[nIdx] === sid) continue;

        let terrainCost = this.grid.getTraversalCost(nx, nz, isCavalry);
        // Penalize hugging unwalkable edges so routes naturally center inside bridges, gates & passages
        if (!this._walkWithClearance(nx, nz)) {
          terrainCost = (terrainCost + 36) | 0;
        }

        const stepCost = ((terrainCost * DIR_8_STEP_SCALE[d]) / 100) | 0;
        const tentativeG = (currG + stepCost) | 0;

        const isOpen = this._openStamp[nIdx] === sid;
        if (!isOpen || tentativeG < this._gScore[nIdx]) {
          const h = this._octileHeuristic(nx, nz, goalTx, goalTz);
          this._parent[nIdx] = currIdx;
          this._gScore[nIdx] = tentativeG;
          this._fScore[nIdx] = (tentativeG + h) | 0;

          if (h < bestNodeH) {
            bestNodeH = h;
            bestNodeIdx = nIdx;
          }

          if (!isOpen) {
            this._openStamp[nIdx] = sid;
            this._heapPush(nIdx);
          } else {
            this._heapBubbleUp(this._heapIndex[nIdx]);
          }
        }
      }
    }

    const rawTileChain = [];
    let trace = bestNodeIdx;
    let safety = 0;
    while (trace !== -1 && trace !== startIdx && safety < 4096) {
      safety = (safety + 1) | 0;
      const tz = (trace / tilesX) | 0;
      const tx = (trace - tz * tilesX) | 0;
      rawTileChain.push({ tx, tz });
      trace = this._parent[trace];
    }
    rawTileChain.reverse();

    if (rawTileChain.length === 0) {
      return [{ xFx: finalWorldXFx, zFx: finalWorldZFx }];
    }

    const smoothedTiles = smoothPath
      ? this._smoothTileChain(startTx, startTz, rawTileChain)
      : rawTileChain;

    const waypoints = [];
    for (let i = 0; i < smoothedTiles.length; i++) {
      const isLast = i === smoothedTiles.length - 1 && bestNodeIdx === goalIdx;
      if (isLast) {
        waypoints.push({ xFx: finalWorldXFx, zFx: finalWorldZFx });
      } else {
        const centered = this._centerTileInCorridor(smoothedTiles[i].tx, smoothedTiles[i].tz);
        waypoints.push({
          xFx: this.grid.tileToWorldCenterFxX(centered.tx),
          zFx: this.grid.tileToWorldCenterFxZ(centered.tz)
        });
      }
    }
    return waypoints;
  }

  _smoothTileChain(startTx, startTz, tileChain) {
    if (tileChain.length <= 2) return tileChain;
    const out = [];
    let anchorTx = startTx | 0;
    let anchorTz = startTz | 0;
    let idx = 0;

    while (idx < tileChain.length) {
      let furthest = idx;
      const maxLookahead = idx + 14 < tileChain.length ? idx + 14 : tileChain.length - 1;
      for (let probe = maxLookahead; probe > idx; probe--) {
        const cand = tileChain[probe];
        if (this._hasClearLineWithMargin(anchorTx, anchorTz, cand.tx, cand.tz)) {
          furthest = probe;
          break;
        }
      }
      const chosen = tileChain[furthest];
      out.push(chosen);
      anchorTx = chosen.tx;
      anchorTz = chosen.tz;
      idx = (furthest + 1) | 0;
    }
    return out;
  }
}