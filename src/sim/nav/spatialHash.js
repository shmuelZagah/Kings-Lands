/**
 * Kings Lands — Phase 3: 4m-Cell Deterministic Spatial Hash Grid (src/sim/nav/spatialHash.js)
 *
 * Ultra-fast O(1) cell neighbor queries across the 1024m x 1024m world[cite: 1, 29]:
 * - Cell size = 4m (`4 * FX_ONE = 4096`), giving a 256x256 cell grid (65,536 cells).
 * - Uses zero-allocation TypedArray intrusive linked lists (`cellHeads` + `nextInCell`).
 * - Strictly preserves ascending Entity ID iteration order for 100% determinism[cite: 28].
 */

import { FX_ONE, fxClamp } from '../../core/fx.js';

export class SpatialHash {
  /**
   * @param {number} worldSizeMeters Default 1024m
   * @param {number} cellSizeMeters Default 4m
   * @param {number} maxEntities Capacity (default 2048)
   */
  constructor(worldSizeMeters = 1024, cellSizeMeters = 4, maxEntities = 2048) {
    this.worldSizeMeters = worldSizeMeters | 0;
    this.cellSizeMeters = cellSizeMeters | 0;
    this.cellSizeFx = (this.cellSizeMeters * FX_ONE) | 0; // 4096
    this.cellsX = ((this.worldSizeMeters + this.cellSizeMeters - 1) / this.cellSizeMeters) | 0; // 256
    this.cellsZ = this.cellsX;
    this.totalCells = (this.cellsX * this.cellsZ) | 0; // 65536

    this.maxSlots = maxEntities | 0;
    this.cellHeads = new Int32Array(this.totalCells);
    this.cellHeads.fill(-1);

    this.slotEntityIds = new Int32Array(this.maxSlots);
    this.slotNext = new Int32Array(this.maxSlots);
    this.slotEntities = new Array(this.maxSlots).fill(null);   // the entity objects (saves a Map lookup per visited unit)
    this.touchedCells = new Int32Array(this.maxSlots);
    this.touchedCount = 0;
    this.slotCount = 0;
  }

  _ensureCapacity(requiredSlots) {
    if (requiredSlots <= this.maxSlots) return;
    let nextCap = this.maxSlots << 1;
    while (nextCap < requiredSlots) nextCap <<= 1;
    this.maxSlots = nextCap;
    this.slotEntityIds = new Int32Array(this.maxSlots);
    this.slotNext = new Int32Array(this.maxSlots);
    this.slotEntities = new Array(this.maxSlots).fill(null);
    this.touchedCells = new Int32Array(this.maxSlots);
  }

  /**
   * Resets only the cells touched in the previous tick for O(N) instead of O(cellsX * cellsZ) overhead.
   */
  clear() {
    for (let i = 0; i < this.touchedCount; i++) {
      this.cellHeads[this.touchedCells[i]] = -1;
    }
    this.touchedCount = 0;
    this.slotCount = 0;
  }

  worldFxToCellX(fxX) {
    const cx = ((fxX | 0) / this.cellSizeFx) | 0;
    return fxClamp(cx, 0, this.cellsX - 1);
  }

  worldFxToCellZ(fxZ) {
    const cz = ((fxZ | 0) / this.cellSizeFx) | 0;
    return fxClamp(cz, 0, this.cellsZ - 1);
  }

  getCellIndex(cx, cz) {
    return (((cz | 0) * this.cellsX) + (cx | 0)) | 0;
  }

  /**
   * Rebuilds the spatial hash from `entities` Map and `sortedEntityIds`.
   * Iterating backwards through `sortedEntityIds` while prepending to `cellHeads` guarantees that
   * traversing any cell's linked list yields entities in strict ascending ID order[cite: 28]!
   *
   * @param {Map<number, Object>} entitiesMap
   * @param {number[]} sortedEntityIds
   */
  rebuild(entitiesMap, sortedEntityIds) {
    this.clear();
    const count = sortedEntityIds.length | 0;
    this._ensureCapacity(count + 16);

    for (let i = count - 1; i >= 0; i--) {
      const id = sortedEntityIds[i] | 0;
      const ent = entitiesMap.get(id);
      if (!ent || ent.hp <= 0) continue;

      const cx = this.worldFxToCellX(ent.x);
      const cz = this.worldFxToCellZ(ent.z);
      const cellIdx = this.getCellIndex(cx, cz);

      const slot = this.slotCount++;
      const prevHead = this.cellHeads[cellIdx];
      if (prevHead === -1) {
        this.touchedCells[this.touchedCount++] = cellIdx;
      }
      this.slotEntityIds[slot] = id;
      this.slotEntities[slot] = ent;
      this.slotNext[slot] = prevHead;
      this.cellHeads[cellIdx] = slot;
    }
  }

  /**
   * Inserts a single entity into the spatial hash.
   */
  insert(entityId, xFx, zFx) {
    this._ensureCapacity(this.slotCount + 2);
    const cx = this.worldFxToCellX(xFx);
    const cz = this.worldFxToCellZ(zFx);
    const cellIdx = this.getCellIndex(cx, cz);

    const slot = this.slotCount++;
    const prevHead = this.cellHeads[cellIdx];
    if (prevHead === -1) {
      this.touchedCells[this.touchedCount++] = cellIdx;
    }
    this.slotEntityIds[slot] = entityId | 0;
    this.slotEntities[slot] = null;
    this.slotNext[slot] = prevHead;
    this.cellHeads[cellIdx] = slot;
  }

  /**
   * Queries all entities within `radiusFx` of `(xFx, zFx)` and returns their IDs
   * sorted in strict ascending Entity ID order[cite: 28].
   *
   * @param {number} xFx
   * @param {number} zFx
   * @param {number} radiusFx
   * @param {Map<number, Object>} entitiesMap
   * @param {number[]} [outIds] Optional reusable output array
   * @returns {number[]} Array of entity IDs in ascending order
   */
  queryRadiusIds(xFx, zFx, radiusFx, entitiesMap, outIds = [], skipTeam = -1, sortIds = true) {
    outIds.length = 0;
    const rFx = radiusFx | 0;
    const minCx = this.worldFxToCellX((xFx | 0) - rFx);
    const maxCx = this.worldFxToCellX((xFx | 0) + rFx);
    const minCz = this.worldFxToCellZ((zFx | 0) - rFx);
    const maxCz = this.worldFxToCellZ((zFx | 0) + rFx);

    // Plain doubles: world coordinates are < 2^21 fx units so every square below is exact (< 2^53) - same result as BigInt.
    const rSq = rFx * rFx;
    const bx = xFx | 0;
    const bz = zFx | 0;
    const entities = entitiesMap;
    const cellFx = this.cellSizeFx;
    const lastCx = this.cellsX - 1;

    for (let cz = minCz; cz <= maxCz; cz++) {
      // Skip the corner cells that lie completely outside the circle (never the outermost world cells: they also hold clamped entities).
      let rowMinCx = minCx;
      let rowMaxCx = maxCx;
      if (cz > 0 && cz < this.cellsZ - 1) {
        const rowLo = cz * cellFx;
        const rowHi = rowLo + cellFx;
        // Units move after the grid is rebuilt (start of tick), so keep one full cell of slack on every side.
        let dzMin = bz < rowLo ? rowLo - bz : (bz >= rowHi ? bz - rowHi + 1 : 0);
        dzMin = dzMin > cellFx ? dzMin - cellFx : 0;
        const rem = rSq - dzMin * dzMin;
        if (rem < 0) continue;
        const hw = Math.sqrt(rem) + cellFx;
        if (minCx > 0) { const c = Math.floor((bx - hw) / cellFx); if (c > rowMinCx) rowMinCx = c; }
        if (maxCx < lastCx) { const c = Math.floor((bx + hw) / cellFx); if (c < rowMaxCx) rowMaxCx = c; }
      }
      const rowOffset = (cz * this.cellsX) | 0;
      for (let cx = rowMinCx; cx <= rowMaxCx; cx++) {
        let slot = this.cellHeads[rowOffset + cx];
        while (slot !== -1) {
          const id = this.slotEntityIds[slot];
          const ent = this.slotEntities[slot] || entities.get(id);
          if (ent && ent.hp > 0 && ent.team !== skipTeam) {
            const dx = (ent.x | 0) - bx;
            const dz = (ent.z | 0) - bz;
            if (dx * dx + dz * dz <= rSq) {
              outIds.push(id);
            }
          }
          slot = this.slotNext[slot];
        }
      }
    }

    // Ensure strict ascending ID order across multiple cells (callers that break ties by id themselves pass sortIds=false)
    const n = outIds.length;
    if (sortIds && n > 1) {
      if (n <= 48) {
        // insertion sort: the cells are visited in a near-sorted order and the lists are short
        for (let i = 1; i < n; i++) {
          const v = outIds[i];
          let j = i - 1;
          while (j >= 0 && outIds[j] > v) { outIds[j + 1] = outIds[j]; j--; }
          outIds[j + 1] = v;
        }
      } else {
        outIds.sort((a, b) => (a | 0) - (b | 0));
      }
    }
    return outIds;
  }

  /**
   * Visits the entities inside the circle ring by ring (square rings of cells around the query point), nearest rings first,
   * and stops as soon as no cell of the next ring can hold anything closer than the best distance `visit` reports.
   * Used for "find the nearest X" searches: it touches a handful of cells when a target is close instead of the whole radius.
   *
   *   visit(ent) -> best distance found so far (floor hypot, same unit as fxHypot) or Infinity when nothing accepted yet.
   *
   * The caller must break ties itself (lowest id) because the visiting order is not ascending ids.
   * Units can move up to one cell after the grid was built, hence the 2-cell slack in the stop test.
   * Returns false (and visits nothing) when the point is outside the world; the caller then uses queryRadiusIds.
   */
  scanRings(xFx, zFx, radiusFx, entitiesMap, skipTeam, visit) {
    const bx = xFx | 0, bz = zFx | 0;
    const worldFx = this.cellsX * this.cellSizeFx;
    if (bx < 0 || bz < 0 || bx >= worldFx || bz >= worldFx) return false;
    const rFx = radiusFx | 0;
    const rSq = rFx * rFx;
    const cellFx = this.cellSizeFx;
    const cx0 = (bx / cellFx) | 0;
    const cz0 = (bz / cellFx) | 0;
    const kMax = Math.min(Math.ceil(rFx / cellFx) + 2, Math.max(this.cellsX, this.cellsZ));
    // Same cell box queryRadiusIds uses: both methods consider exactly the same set of entities (identical results).
    const boxMinCx = this.worldFxToCellX(bx - rFx), boxMaxCx = this.worldFxToCellX(bx + rFx);
    const boxMinCz = this.worldFxToCellZ(bz - rFx), boxMaxCz = this.worldFxToCellZ(bz + rFx);
    let best = Infinity;
    for (let k = 0; k <= kMax; k++) {
      if ((k - 2) * cellFx > best) break;
      const zLo = cz0 - k, zHi = cz0 + k;
      for (let cz = zLo < boxMinCz ? boxMinCz : zLo; cz <= zHi && cz <= boxMaxCz; cz++) {
        const fullRow = cz === zLo || cz === zHi;
        const step = fullRow || k === 0 ? 1 : 2 * k;
        for (let cx = cx0 - k; cx <= cx0 + k; cx += step) {
          if (cx < boxMinCx || cx > boxMaxCx) continue;
          let slot = this.cellHeads[cz * this.cellsX + cx];
          while (slot !== -1) {
            const ent = this.slotEntities[slot] || entitiesMap.get(this.slotEntityIds[slot]);
            if (ent && ent.hp > 0 && ent.team !== skipTeam) {
              const dx = (ent.x | 0) - bx;
              const dz = (ent.z | 0) - bz;
              if (dx * dx + dz * dz <= rSq) best = visit(ent);
            }
            slot = this.slotNext[slot];
          }
        }
      }
    }
    return true;
  }
}
