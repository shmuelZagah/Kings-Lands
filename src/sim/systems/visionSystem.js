/**
 * Kings Lands — Authoritative 3-State Fog of War & Line-of-Sight Vision System
 * (src/sim/systems/visionSystem.js)
 */

import { FX_ONE, mulDiv, fxClamp } from '../../core/fx.js';
import { NavTileType } from '../nav/grid.js';

// ============================================================================
// Phase 7: Authoritative Vision & 3-State Fog of War System
// ============================================================================

export const FowState = Object.freeze({
  UNEXPLORED: 0,
  EXPLORED: 1,
  VISIBLE: 2,
  SPELL_VISIBLE: 3
});

export const FOW_GRID_SIZE = 256; // 256x256 cells over 4096m = 16m per cell
export const FOW_UPDATE_INTERVAL_TICKS = 4; // 200ms (5 Hz) throttled authoritative update

export const BASE_UNIT_VISION_METERS = Object.freeze({
  0: 84,  // worker
  1: 96,  // swordsman
  2: 96,  // spearman
  3: 112, // archer
  4: 118  // cavalry
});

export const BASE_BUILDING_VISION_METERS = Object.freeze({
  citadel: 175,
  watchtower: 155,
  ballista_tower: 155,
  barracks: 110,
  archery_range: 110,
  stables: 110,
  siege_works: 110,
  gathering_camp: 96,
  house: 88,
  blacksmith: 92,
  infirmary: 92,
  banner_house: 104
});

export class VisionSystem {
  constructor(navGrid, _config = {}) {
    this.navGrid = navGrid;
    this.playerTeam = (_config?.matchSetup?.playerTeam | 0) || 1;
    this.worldSizeMeters = navGrid?.worldSizeMeters || 4096;
    this.gridSize = FOW_GRID_SIZE;
    this.cellSizeMeters = this.worldSizeMeters / this.gridSize; // 16m
    this.cellSizeFx = (this.cellSizeMeters * FX_ONE) | 0;

    const totalCells = this.gridSize * this.gridSize;
    this.fowGridTeam1 = new Uint8Array(totalCells);
    this.blockerGrid = new Uint8Array(totalCells);
    this.hillCellGrid = new Uint8Array(totalCells);

    const navTotal = (navGrid?.tilesX || 1024) * (navGrid?.tilesZ || 1024);
    this._forestTileGrid = new Uint8Array(navTotal);
    this._tileBlockerGrid = new Uint8Array(navTotal);

    this.revealAllCheat = false;
    this.temporaryReveals = [];
    this._lastUpdateTick = -999;
    this._dirtyBlockerTick = -999;

    this._buildStaticTerrainCaches();
  }

  _buildStaticTerrainCaches() {
    const nav = this.navGrid;
    if (!nav) return;

    const nx = nav.tilesX;
    const nz = nav.tilesZ;

    // Mark dense forest interior tiles at 4m nav-tile resolution (isolated 1-2 trees do not block wide LOS sectors)
    for (let tz = 1; tz < nz - 1; tz++) {
      const rowOff = tz * nx;
      for (let tx = 1; tx < nx - 1; tx++) {
        if (nav.getTileType(tx, tz) !== NavTileType.FOREST) continue;
        let neighbors = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (nav.getTileType(tx + dx, tz + dz) === NavTileType.FOREST) {
              neighbors++;
            }
          }
        }
        if (neighbors >= 5) {
          this._forestTileGrid[rowOff + tx] = 1;
        }
      }
    }

    const navTilesPerFowCell = Math.max(1, (this.cellSizeMeters / nav.tileSizeMeters) | 0);
    for (let cz = 0; cz < this.gridSize; cz++) {
      for (let cx = 0; cx < this.gridSize; cx++) {
        const idx = cz * this.gridSize + cx;
        let hillCount = 0;
        const baseTx = cx * navTilesPerFowCell;
        const baseTz = cz * navTilesPerFowCell;

        for (let dz = 0; dz < navTilesPerFowCell; dz++) {
          for (let dx = 0; dx < navTilesPerFowCell; dx++) {
            const tx = baseTx + dx;
            const tz = baseTz + dz;
            if (!nav.isValidTile(tx, tz)) continue;
            const tType = nav.getTileType(tx, tz);
            const hFx = nav.heightCacheFx[nav.getTileIndex(tx, tz)];
            if (tType === NavTileType.HILL || hFx >= 3276) {
              hillCount++;
            }
          }
        }
        if (hillCount > 0) {
          this.hillCellGrid[idx] = 1;
        }
      }
    }
  }

  _rebuildBlockerGrid(gameState) {
    this._tileBlockerGrid.set(this._forestTileGrid);
    const nav = this.navGrid;
    if (!nav) return;

    const nx = nav.tilesX;
    const nz = nav.tilesZ;
    const tileMeters = nav.tileSizeMeters || 4;

    const bIds = gameState.constructionSystem?.sortedBuildingIds || [];
    const buildings = gameState.constructionSystem?.buildings;
    if (buildings) {
      for (let i = 0; i < bIds.length; i++) {
        const b = buildings.get(bIds[i]);
        if (!b || b.isDestroyed || b.hp <= 0 || b.type === "citadel_slot") continue;
        const bx = b.xFx / FX_ONE;
        const bz = b.zFx / FX_ONE;
        const radM = Math.max(2.5, (b.footprintRadiusMeters || 4) - 0.5);
        const radSq = radM * radM;
        const minTx = Math.max(0, Math.floor((bx - radM) / tileMeters));
        const maxTx = Math.min(nx - 1, Math.ceil((bx + radM) / tileMeters));
        const minTz = Math.max(0, Math.floor((bz - radM) / tileMeters));
        const maxTz = Math.min(nz - 1, Math.ceil((bz + radM) / tileMeters));
        for (let tz = minTz; tz <= maxTz; tz++) {
          const wz = (tz + 0.5) * tileMeters;
          const rowOff = tz * nx;
          for (let tx = minTx; tx <= maxTx; tx++) {
            const wx = (tx + 0.5) * tileMeters;
            const dx = wx - bx;
            const dz = wz - bz;
            if (dx * dx + dz * dz <= radSq) {
              // Only enemy/neutral buildings or large obstacles block vision behind them; friendly buildings never blind their own sight
              const isAllied = gameState.areTeamsAllied ? gameState.areTeamsAllied(b.team, this.playerTeam) : b.team === this.playerTeam;
              this._tileBlockerGrid[rowOff + tx] = isAllied ? 3 : 2;
            }
          }
        }
      }
    }
  }

  worldFxToCellX(fxX) {
    return fxClamp(((fxX | 0) / this.cellSizeFx) | 0, 0, this.gridSize - 1);
  }

  worldFxToCellZ(fxZ) {
    return fxClamp(((fxZ | 0) / this.cellSizeFx) | 0, 0, this.gridSize - 1);
  }

  /**
   * Reveals a true Euclidean circle around (wxMeters, wzMeters) while casting 4m-resolution
   * line-of-sight rays so buildings, dense forests, and high hill ridges cast realistic shadows
   * without distorting the circle into a polygon!
   */
  _revealObserverWithLos(wxMeters, wzMeters, observerYMeters, radiusMeters, hasHillBonus, isBuildingObserver = false) {
    const effectiveMeters = hasHillBonus ? radiusMeters * 1.15 : radiusMeters;
    const effRadSq = effectiveMeters * effectiveMeters;
    const size = this.gridSize;
    const cellM = this.cellSizeMeters;
    const fow = this.fowGridTeam1;
    const nav = this.navGrid;
    const nx = nav?.tilesX || 1024;
    const nz = nav?.tilesZ || 1024;
    const tileM = nav?.tileSizeMeters || 4;
    const tileBlockers = this._tileBlockerGrid;
    const heightCacheFx = nav?.heightCacheFx;

    const minCx = Math.max(0, Math.floor((wxMeters - effectiveMeters) / cellM));
    const maxCx = Math.min(size - 1, Math.ceil((wxMeters + effectiveMeters) / cellM));
    const minCz = Math.max(0, Math.floor((wzMeters - effectiveMeters) / cellM));
    const maxCz = Math.min(size - 1, Math.ceil((wzMeters + effectiveMeters) / cellM));

    const minClearMeters = isBuildingObserver ? 26.0 : 20.0;
    const eyeHeightMeters = observerYMeters + (isBuildingObserver ? 4.2 : 2.8);

    for (let cz = minCz; cz <= maxCz; cz++) {
      const cellWz = (cz + 0.5) * cellM;
      const dz = cellWz - wzMeters;
      const dzSq = dz * dz;
      const rowOff = cz * size;

      for (let cx = minCx; cx <= maxCx; cx++) {
        const idx = rowOff + cx;
        if (fow[idx] === FowState.VISIBLE) continue;

        const cellWx = (cx + 0.5) * cellM;
        const dx = cellWx - wxMeters;
        const distSq = dx * dx + dzSq;
        if (distSq > effRadSq) continue;

        const dist = Math.sqrt(distSq);
        if (dist <= minClearMeters || !nav) {
          fow[idx] = FowState.VISIBLE;
          continue;
        }

        // Raymarch in 4m nav-tile steps from observer to target cell center
        const invDist = 1.0 / dist;
        const dirX = dx * invDist;
        const dirZ = dz * invDist;
        const maxSampleDist = dist - 6.0;
        let blocked = false;
        let forestHits = 0;

        for (let d = 12.0; d <= maxSampleDist; d += 4.0) {
          const sx = wxMeters + dirX * d;
          const sz = wzMeters + dirZ * d;
          const tx = (sx / tileM) | 0;
          const tz = (sz / tileM) | 0;
          if (tx < 0 || tx >= nx || tz < 0 || tz >= nz) break;

          const tIdx = tz * nx + tx;
          const bCode = tileBlockers[tIdx];
          if (bCode === 2) {
            // Blocked by enemy/obstacle building footprint
            blocked = true;
            break;
          }
          if (bCode === 3 && !isBuildingObserver && d >= 14.0) {
            // Friendly unit looking behind a friendly building
            blocked = true;
            break;
          }
          if (bCode === 1) {
            forestHits++;
            if (forestHits >= 3) {
              blocked = true;
              break;
            }
          }
          if (heightCacheFx) {
            const sampleH = heightCacheFx[tIdx] * 0.0009765625; // / 1024
            if (sampleH > eyeHeightMeters + 2.2) {
              blocked = true;
              break;
            }
          }
        }

        if (!blocked) {
          fow[idx] = FowState.VISIBLE;
        }
      }
    }
  }

  addTemporaryReveal(xFx, zFx, radiusMeters, durationTicks, currentTick = 0) {
    const exactCx = Math.max(0, Math.min(this.gridSize - 0.01, (xFx | 0) / this.cellSizeFx));
    const exactCz = Math.max(0, Math.min(this.gridSize - 0.01, (zFx | 0) / this.cellSizeFx));
    const radM = Number(radiusMeters) || 32;
    const radiusCells = Math.max(1.5, radM / this.cellSizeMeters);
    this.temporaryReveals.push({
      wx: (xFx | 0) / FX_ONE,
      wz: (zFx | 0) / FX_ONE,
      radiusMeters: radM,
      cx: exactCx,
      cz: exactCz,
      radiusCells,
      startTick: currentTick | 0,
      expiresTick: (currentTick | 0) + Math.max(20, durationTicks | 0)
    });
    this._revealCircleUnblocked(exactCx, exactCz, Math.max(0.5, radiusCells * 0.2), true);
  }

  _revealCircleUnblocked(cx, cz, radiusCells, isSpellReveal = false) {
    const size = this.gridSize;
    const fow = this.fowGridTeam1;
    const effR = isSpellReveal ? radiusCells + 0.45 : radiusCells;
    const rSq = effR * effR;
    const minZ = Math.max(0, Math.floor(cz - effR - 1)) | 0;
    const maxZ = Math.min(size - 1, Math.ceil(cz + effR + 1)) | 0;
    const minX = Math.max(0, Math.floor(cx - effR - 1)) | 0;
    const maxX = Math.min(size - 1, Math.ceil(cx + effR + 1)) | 0;

    for (let z = minZ; z <= maxZ; z++) {
      const dz = z + 0.5 - cz;
      const rowOffset = z * size;
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dz * dz <= rSq) {
          const idx = rowOffset + x;
          if (isSpellReveal) {
            if (fow[idx] !== FowState.VISIBLE) {
              fow[idx] = FowState.SPELL_VISIBLE;
            }
          } else {
            fow[idx] = FowState.VISIBLE;
          }
        }
      }
    }
  }

  update(gameState, forceImmediate = false) {
    const tick = gameState.tick | 0;
    if (
      !forceImmediate &&
      this._lastUpdateTick >= 0 &&
      tick - this._lastUpdateTick < FOW_UPDATE_INTERVAL_TICKS
    ) {
      return;
    }
    this._lastUpdateTick = tick;

    const fow = this.fowGridTeam1;
    const total = fow.length;

    if (this.revealAllCheat || gameState.isSpectatorMode) {
      fow.fill(FowState.VISIBLE);
      return;
    }

    if (this._dirtyBlockerTick < 0 || tick - this._dirtyBlockerTick >= 16) {
      this._rebuildBlockerGrid(gameState);
      this._dirtyBlockerTick = tick;
    }

    for (let i = 0; i < total; i++) {
      if (fow[i] === FowState.VISIBLE) {
        fow[i] = FowState.EXPLORED;
      } else if (fow[i] === FowState.SPELL_VISIBLE) {
        fow[i] = FowState.UNEXPLORED;
      }
    }

    const bIds = gameState.constructionSystem?.sortedBuildingIds || [];
    const buildings = gameState.constructionSystem?.buildings;
    if (buildings) {
      for (let i = 0; i < bIds.length; i++) {
        const b = buildings.get(bIds[i]);
        if (!b || b.isDestroyed || b.hp <= 0 || b.type === "citadel_slot") continue;
        const bAllied = gameState.areTeamsAllied ? gameState.areTeamsAllied(b.team, this.playerTeam) : b.team === this.playerTeam;
        if (!bAllied) continue;

        const cx = this.worldFxToCellX(b.xFx);
        const cz = this.worldFxToCellZ(b.zFx);
        let baseRange = BASE_BUILDING_VISION_METERS[b.type] || 76;
        if (b.hasWatchtower && baseRange < 115) baseRange = 115;
        const onHill = this.hillCellGrid[cz * this.gridSize + cx] === 1 || b.yFx >= 3276;
        this._revealObserverWithLos(
          b.xFx / FX_ONE,
          b.zFx / FX_ONE,
          (b.yFx || 0) / FX_ONE,
          baseRange,
          onHill,
          true
        );
      }
    }

    const visitedObserverBuckets = new Map();
    const ids = gameState.sortedEntityIds;
    const entities = gameState.entities;

    for (let i = 0; i < ids.length; i++) {
      const ent = entities.get(ids[i]);
      if (!ent || ent.hp <= 0) continue;

      const entAllied = gameState.areTeamsAllied ? gameState.areTeamsAllied(ent.team, this.playerTeam) : ent.team === this.playerTeam;
      if (entAllied) {
        const cx = this.worldFxToCellX(ent.x);
        const cz = this.worldFxToCellZ(ent.z);
        const cellKey = cz * this.gridSize + cx;
        // Group nearby units in 8m buckets while preserving exact world coordinates for circular vision
        const bx = (ent.x / (8 * FX_ONE)) | 0;
        const bz = (ent.z / (8 * FX_ONE)) | 0;
        const bucketKey = (bz << 10) | bx;
        let range = (ent.visionRangeMeters | 0) || BASE_UNIT_VISION_METERS[ent.unitTypeIdx] || 96;
        const onHill = this.hillCellGrid[cellKey] === 1 || ent.y >= 3276;

        const prev = visitedObserverBuckets.get(bucketKey);
        if (!prev || range > prev.range) {
          visitedObserverBuckets.set(bucketKey, {
            wx: ent.x / FX_ONE,
            wz: ent.z / FX_ONE,
            wy: (ent.y || 0) / FX_ONE,
            range,
            onHill
          });
        }
      } else if (ent.isRevealedLastStand) {
        const exactCx = (ent.x | 0) / this.cellSizeFx;
        const exactCz = (ent.z | 0) / this.cellSizeFx;
        this._revealCircleUnblocked(exactCx, exactCz, 3);
      }
    }

    for (const obs of visitedObserverBuckets.values()) {
      this._revealObserverWithLos(obs.wx, obs.wz, obs.wy, obs.range, obs.onHill, false);
    }

    if (this.temporaryReveals.length > 0) {
      for (let i = this.temporaryReveals.length - 1; i >= 0; i--) {
        const rev = this.temporaryReveals[i];
        if (tick >= rev.expiresTick) {
          this.temporaryReveals.splice(i, 1);
          continue;
        }
        const elapsedTicks = Math.max(1, tick - (rev.startTick ?? tick) + 1);
        const growFrac = Math.min(1.0, elapsedTicks / 10.0);
        this._revealCircleUnblocked(rev.cx, rev.cz, rev.radiusCells * growFrac, true);
      }
    }

    if (gameState.victorySystem?.collapseState?.active) {
      const losingTeam = gameState.victorySystem.collapseState.losingTeam;
      if (buildings) {
        for (let i = 0; i < bIds.length; i++) {
          const b = buildings.get(bIds[i]);
          if (b && b.team === losingTeam && !b.isDestroyed && b.hp > 0) {
            this._revealCircleUnblocked((b.xFx | 0) / this.cellSizeFx, (b.zFx | 0) / this.cellSizeFx, 4);
          }
        }
      }
      for (let i = 0; i < ids.length; i++) {
        const ent = entities.get(ids[i]);
        if (ent && ent.team === losingTeam && ent.hp > 0) {
          this._revealCircleUnblocked((ent.x | 0) / this.cellSizeFx, (ent.z | 0) / this.cellSizeFx, 3);
        }
      }
    }
  }
}

