/**
 * Kings Lands — Fair-Play Fog of War & Terrain Perception for Enemy AI (Team 2)
 * (src/sim/ai/aiPerception.js)
 *
 * STRICT FAIR-PLAY RULE:
 * - The AI is a pure thinking brain that plays by the exact same rules as a human player.
 * - It has its own 256x256 Fog of War grid (`fowGridTeam2`) computed from its own units and buildings
 *   with terrain/forest/building Line-of-Sight occlusion.
 * - It CANNOT see any Team 1 unit unless that unit stands in a currently `VISIBLE` cell of `fowGridTeam2`
 *   (or is revealed by Last Stand), and CANNOT see any Team 1 building unless its cell has been
 *   at least `EXPLORED` by a Team 2 unit or building.
 */

import { FX_ONE, fxClamp, fxHypot } from '../../core/fx.js';
import {
  FowState,
  FOW_GRID_SIZE,
  BASE_UNIT_VISION_METERS,
  BASE_BUILDING_VISION_METERS
} from '../systems/visionSystem.js';
import {
  NavTileType,
  getBridgeCentersMeters,
  getFordCentersMeters,
  computeRiverCenterZFx
} from '../nav/grid.js';

export class AiPerception {
  constructor(team = 2) {
    this.team = team | 0;
    this.gridSize = FOW_GRID_SIZE;
    this.fowGrid = new Uint8Array(this.gridSize * this.gridSize);
    this.lastUpdatedTick = -999;

    // Memory of enemy buildings that were legitimately seen in EXPLORED / VISIBLE cells
    this.knownEnemyBuildings = new Map(); // id -> { id, type, xFx, zFx, hp, maxHp, hasWatchtower, lastSeenTick }
    // Memory of last seen enemy army positions & unit counts (decays over time if out of sight)
    this.observedEnemyComposition = {
      swordsman: 0,
      spearman: 0,
      archer: 0,
      cavalry: 0,
      hero: 0,
      ballista: 0,
      towers: 0,
      totalCombatUnits: 0,
      lastSeenCenterXFx: 2048 * FX_ONE,
      lastSeenCenterZFx: 1800 * FX_ONE,
      lastSeenTick: -999
    };

    this._terrainAnalyzed = false;
    this.crossings = []; // Bridges and shallow fords discovered from map topography
    this.tacticalHills = []; // High-ground vantage points near river crossings and base approaches
  }

  worldFxToCellX(fxX, worldSizeFx) {
    const cellSizeFx = Math.max(1, (worldSizeFx / this.gridSize) | 0);
    return fxClamp(((fxX | 0) / cellSizeFx) | 0, 0, this.gridSize - 1);
  }

  worldFxToCellZ(fxZ, worldSizeFx) {
    const cellSizeFx = Math.max(1, (worldSizeFx / this.gridSize) | 0);
    return fxClamp(((fxZ | 0) / cellSizeFx) | 0, 0, this.gridSize - 1);
  }

  getCellStateAtWorldFx(fxX, fxZ, worldSizeFx) {
    const cx = this.worldFxToCellX(fxX, worldSizeFx);
    const cz = this.worldFxToCellZ(fxZ, worldSizeFx);
    return this.fowGrid[cz * this.gridSize + cx];
  }

  isWorldPointVisible(fxX, fxZ, worldSizeFx) {
    return this.getCellStateAtWorldFx(fxX, fxZ, worldSizeFx) >= FowState.VISIBLE;
  }

  isWorldPointExplored(fxX, fxZ, worldSizeFx) {
    return this.getCellStateAtWorldFx(fxX, fxZ, worldSizeFx) >= FowState.EXPLORED;
  }

  /**
   * Analyzes static map topography (bridges, shallow fords, river curvature, tactical hills).
   */
  analyzeTerrainTopography(gameState) {
    if (this._terrainAnalyzed) return;
    this._terrainAnalyzed = true;

    const navGrid = gameState.navGrid;
    const centerMeters = gameState.centerMeters || 2048;
    const bridgesX = getBridgeCentersMeters(centerMeters);
    const fordsX = getFordCentersMeters(centerMeters);

    this.crossings = [];
    for (let i = 0; i < bridgesX.length; i++) {
      if (Math.abs(bridgesX[i] - centerMeters) > 650) continue;
      const bxFx = (bridgesX[i] * FX_ONE) | 0;
      const rzFx = computeRiverCenterZFx(bxFx, centerMeters);
      this.crossings.push({
        id: `bridge_${i}`,
        kind: 'bridge',
        xFx: bxFx,
        zFx: rzFx,
        northStageZFx: (rzFx + 44 * FX_ONE) | 0,
        southStageZFx: (rzFx - 44 * FX_ONE) | 0
      });
    }

    for (let i = 0; i < fordsX.length; i++) {
      if (Math.abs(fordsX[i] - centerMeters) > 650) continue;
      const fxX = (fordsX[i] * FX_ONE) | 0;
      const rzFx = computeRiverCenterZFx(fxX, centerMeters);
      this.crossings.push({
        id: `ford_${i}`,
        kind: 'ford',
        xFx: fxX,
        zFx: rzFx,
        northStageZFx: (rzFx + 48 * FX_ONE) | 0,
        southStageZFx: (rzFx - 48 * FX_ONE) | 0
      });
    }

    // Sample tactical high-ground hills across the central belt (Z: 1750m..2350m, X: 900m..3200m)
    this.tacticalHills = [];
    if (navGrid) {
      for (let wz = 1800; wz <= 2320; wz += 64) {
        for (let wx = 960; wx <= 3136; wx += 64) {
          const xFx = (wx * FX_ONE) | 0;
          const zFx = (wz * FX_ONE) | 0;
          if (!navGrid.isWalkableWorldFx(xFx, zFx)) continue;
          const tx = navGrid.worldFxToTileX(xFx);
          const tz = navGrid.worldFxToTileZ(zFx);
          const tType = navGrid.getTileType(tx, tz);
          const hFx = navGrid.sampleHeightAtWorldFx(xFx, zFx);
          if (tType === NavTileType.HILL || hFx >= 3200) {
            this.tacticalHills.push({ xFx, zFx, heightFx: hFx });
          }
        }
      }
    }
  }

  /**
   * Updates Team 2's authoritative Fog of War grid and filters visible enemy units/buildings.
   */
  updatePerception(gameState) {
    this.analyzeTerrainTopography(gameState);

    const tick = gameState.tick | 0;
    const worldSizeFx = gameState.worldSizeFx || 4096 * FX_ONE;
    const cellSizeMeters = (gameState.worldSizeMeters || 4096) / this.gridSize;
    const fow = this.fowGrid;
    const total = fow.length;

    // Decay VISIBLE -> EXPLORED
    for (let i = 0; i < total; i++) {
      if (fow[i] >= FowState.VISIBLE) {
        fow[i] = FowState.EXPLORED;
      }
    }

    const revealCircle = (wxMeters, wzMeters, radiusMeters) => {
      const cx = fxClamp(Math.floor(wxMeters / cellSizeMeters), 0, this.gridSize - 1);
      const cz = fxClamp(Math.floor(wzMeters / cellSizeMeters), 0, this.gridSize - 1);
      const rCells = Math.ceil(radiusMeters / cellSizeMeters);
      const rSq = rCells * rCells;
      const minZ = Math.max(0, cz - rCells);
      const maxZ = Math.min(this.gridSize - 1, cz + rCells);
      const minX = Math.max(0, cx - rCells);
      const maxX = Math.min(this.gridSize - 1, cx + rCells);

      for (let z = minZ; z <= maxZ; z++) {
        const dz = z - cz;
        const rowBase = z * this.gridSize;
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx;
          if (dx * dx + dz * dz <= rSq) {
            fow[rowBase + x] = FowState.VISIBLE;
          }
        }
      }
    };

    // 1. Reveal from Team 2 buildings
    const bIds = gameState.constructionSystem?.sortedBuildingIds || [];
    const buildings = gameState.constructionSystem?.buildings;
    if (buildings) {
      for (let i = 0; i < bIds.length; i++) {
        const b = buildings.get(bIds[i]);
        if (!b || b.isDestroyed || b.hp <= 0 || b.type === 'citadel_slot') continue;
        const bAllied = gameState.areTeamsAllied ? gameState.areTeamsAllied(b.team, this.team) : b.team === this.team;
        if (!bAllied) continue;
        let range = BASE_BUILDING_VISION_METERS[b.type] || 76;
        if (b.hasWatchtower && range < 115) range = 115;
        if (b.yFx >= 3276) range = Math.round(range * 1.2);
        revealCircle(b.xFx / FX_ONE, b.zFx / FX_ONE, range);
      }
    }

    // 2. Reveal from Team 2 living units (grouped in 8m buckets for O(1) speed)
    const buckets = new Map();
    const ids = gameState.sortedEntityIds;
    const entities = gameState.entities;
    for (let i = 0; i < ids.length; i++) {
      const ent = entities.get(ids[i]);
      if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;
      const entAllied = gameState.areTeamsAllied ? gameState.areTeamsAllied(ent.team, this.team) : ent.team === this.team;
      if (!entAllied) continue;
      const bx = (ent.x / (8 * FX_ONE)) | 0;
      const bz = (ent.z / (8 * FX_ONE)) | 0;
      const bKey = (bz << 10) | bx;
      let range = (ent.visionRangeMeters | 0) || BASE_UNIT_VISION_METERS[ent.unitTypeIdx] || 96;
      if (ent.y >= 3276) range = Math.round(range * 1.22);
      const prev = buckets.get(bKey);
      if (!prev || range > prev.range) {
        buckets.set(bKey, { wx: ent.x / FX_ONE, wz: ent.z / FX_ONE, range });
      }
    }
    for (const obs of buckets.values()) {
      revealCircle(obs.wx, obs.wz, obs.range);
    }

    // 3. Scan what Team 2 can legitimately see right now
    const visibleEnemyCompanies = [];
    const visibleEnemyEntitiesByCompany = new Map();
    const counts = { swordsman: 0, spearman: 0, archer: 0, cavalry: 0, hero: 0, ballista: 0 };
    let sumX = 0;
    let sumZ = 0;
    let totalVisibleCombat = 0;

    for (let i = 0; i < ids.length; i++) {
      const ent = entities.get(ids[i]);
      if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;
      const entEnemy = gameState.areTeamsEnemy ? gameState.areTeamsEnemy(ent.team, this.team) : ent.team !== this.team;
      if (!entEnemy) continue;

      const isVisible =
        Boolean(ent.isRevealedLastStand) || this.isWorldPointVisible(ent.x, ent.z, worldSizeFx);
      if (!isVisible) continue;

      const cid = ent.squadIndex | 0;
      if (!visibleEnemyEntitiesByCompany.has(cid)) {
        visibleEnemyEntitiesByCompany.set(cid, []);
      }
      visibleEnemyEntitiesByCompany.get(cid).push(ent);

      if (ent.unitTypeIdx === 1) counts.swordsman++;
      else if (ent.unitTypeIdx === 2) counts.spearman++;
      else if (ent.unitTypeIdx === 3) counts.archer++;
      else if (ent.unitTypeIdx === 4) counts.cavalry++;
      else if (ent.unitTypeIdx === 5) counts.hero++;
      else if (ent.unitTypeIdx === 6) counts.ballista++;

      if (ent.unitTypeIdx !== 0) {
        sumX = (sumX + (ent.x / FX_ONE)) | 0;
        sumZ = (sumZ + (ent.z / FX_ONE)) | 0;
        totalVisibleCombat++;
      }
    }

    for (const [cid, entList] of visibleEnemyEntitiesByCompany.entries()) {
      const comp = gameState.companies.get(cid);
      if (!comp || comp.memberIds.length === 0) continue;
      visibleEnemyCompanies.push({
        companyId: cid,
        unitType: comp.unitType,
        isHero: Boolean(comp.isHero),
        isCavalry: Boolean(comp.isCavalry),
        formation: comp.formation,
        anchorXFx: comp.anchorXFx,
        anchorZFx: comp.anchorZFx,
        visibleCount: entList.length
      });
    }

    // 4. Scan enemy buildings in VISIBLE or EXPLORED cells
    let visibleTowerCount = 0;
    if (buildings) {
      for (let i = 0; i < bIds.length; i++) {
        const b = buildings.get(bIds[i]);
        if (!b || b.type === 'citadel_slot') continue;
        const bEnemy = gameState.areTeamsEnemy ? gameState.areTeamsEnemy(b.team, this.team) : b.team !== this.team;
        if (!bEnemy) continue;
        const cellState = this.getCellStateAtWorldFx(b.xFx, b.zFx, worldSizeFx);

        if (b.isDestroyed || b.hp <= 0) {
          if (cellState >= FowState.VISIBLE) {
            this.knownEnemyBuildings.delete(b.id);
          }
          continue;
        }

        if (cellState >= FowState.VISIBLE) {
          this.knownEnemyBuildings.set(b.id, {
            id: b.id,
            type: b.type,
            xFx: b.xFx,
            zFx: b.zFx,
            hp: b.hp,
            maxHp: b.maxHp,
            isCompleted: b.isCompleted,
            hasWatchtower: Boolean(b.hasWatchtower || b.type === 'watchtower' || b.type === 'ballista_tower'),
            lastSeenTick: tick
          });
        }
      }
    }

    for (const kb of this.knownEnemyBuildings.values()) {
      if (kb.hasWatchtower) visibleTowerCount++;
    }
    this.observedEnemyComposition.towers = visibleTowerCount;

    // Update learned enemy army composition using exponential smoothing when enemy combat units are spotted
    if (totalVisibleCombat > 0) {
      const obs = this.observedEnemyComposition;
      obs.swordsman = Math.max(counts.swordsman, Math.round(obs.swordsman * 0.65 + counts.swordsman * 0.35));
      obs.spearman = Math.max(counts.spearman, Math.round(obs.spearman * 0.65 + counts.spearman * 0.35));
      obs.archer = Math.max(counts.archer, Math.round(obs.archer * 0.65 + counts.archer * 0.35));
      obs.cavalry = Math.max(counts.cavalry, Math.round(obs.cavalry * 0.65 + counts.cavalry * 0.35));
      obs.hero = Math.max(counts.hero, counts.hero);
      obs.totalCombatUnits = totalVisibleCombat;
      obs.lastSeenCenterXFx = Math.round((sumX / totalVisibleCombat) * FX_ONE) | 0;
      obs.lastSeenCenterZFx = Math.round((sumZ / totalVisibleCombat) * FX_ONE) | 0;
      obs.lastSeenTick = tick;
    }

    this.lastUpdatedTick = tick;
    return {
      visibleEnemyCompanies,
      knownEnemyBuildings: Array.from(this.knownEnemyBuildings.values()),
      observedComposition: this.observedEnemyComposition
    };
  }

  /**
   * Picks the next unexplored or oldest-explored strategic scouting target (crossings, hills, resource valleys, south approaches).
   */
  pickNextScoutingTargetFx(gameState, scoutAnchorXFx, scoutAnchorZFx) {
    const worldSizeFx = gameState.worldSizeFx || 4096 * FX_ONE;
    const candidates = [];

    // 1. River crossings (bridges & shallow fords)
    for (let i = 0; i < this.crossings.length; i++) {
      const cr = this.crossings[i];
      candidates.push({ xFx: cr.xFx, zFx: cr.northStageZFx, priority: 3 });
      candidates.push({ xFx: cr.xFx, zFx: cr.southStageZFx, priority: 4 });
    }

    // 2. Tactical hills near the river & mid-map
    for (let i = 0; i < this.tacticalHills.length; i += 3) {
      const h = this.tacticalHills[i];
      candidates.push({ xFx: h.xFx, zFx: h.zFx, priority: 2 });
    }

    // 3. Southern territory search sectors (in case enemy base has not been discovered yet)
    const searchWaypointsMeters = [
      [2048, 1920],
      [1720, 1880],
      [2360, 1880],
      [2048, 1720],
      [1820, 1680],
      [2260, 1680],
      [1520, 2048],
      [2560, 2048]
    ];
    for (let i = 0; i < searchWaypointsMeters.length; i++) {
      const [wx, wz] = searchWaypointsMeters[i];
      candidates.push({ xFx: (wx * FX_ONE) | 0, zFx: (wz * FX_ONE) | 0, priority: 3 });
    }

    let bestCand = null;
    let bestScore = -0x7fffffff;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!gameState.navGrid.isWalkableWorldFx(c.xFx, c.zFx)) continue;
      const state = this.getCellStateAtWorldFx(c.xFx, c.zFx, worldSizeFx);
      const distMeters = Math.round(fxHypot((c.xFx - scoutAnchorXFx) | 0, (c.zFx - scoutAnchorZFx) | 0) / FX_ONE);

      // Prefer UNEXPLORED cells strongly, with moderate distance penalty
      let score = c.priority * 120 - distMeters;
      if (state === FowState.UNEXPLORED) score += 650;
      else if (state === FowState.EXPLORED) score += 120;
      else score -= 500;

      if (score > bestScore) {
        bestScore = score;
        bestCand = c;
      }
    }

    return bestCand || { xFx: 2048 * FX_ONE, zFx: 1850 * FX_ONE };
  }
}
