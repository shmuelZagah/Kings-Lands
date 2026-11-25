import { simBuildings } from '../simConfig.js';
import {
  FX_ONE,
  ANGLE_MASK,
  mulDiv,
  fxSin,
  fxCos,
  fxAtan2,
  fxHypot
} from '../../core/fx.js';
import { NavTileType } from '../nav/grid.js';
import {
  CompanyOrderType,
  WORKER_FATIGUE_THRESHOLD_PERMILLE
} from '../formations/company.js';
import { generateDeterministicTreesFx, generateDeterministicMinesFx } from '../world/worldGen.js';

export const ResourceTypes = Object.freeze({
  COINS: 'coins',
  WOOD: 'wood',
  STONE: 'stone',
  IRON: 'iron'
});

export const CarryPropCode = Object.freeze({
  NONE: 0,
  WOOD: 1,
  GOLD: 2,
  IRON: 3,
  STONE: 4
});

export function resourceTypeToCarryCode(resType) {
  if (resType === ResourceTypes.WOOD) return CarryPropCode.WOOD;
  if (resType === ResourceTypes.COINS) return CarryPropCode.GOLD;
  if (resType === ResourceTypes.IRON) return CarryPropCode.IRON;
  if (resType === ResourceTypes.STONE) return CarryPropCode.STONE;
  return CarryPropCode.NONE;
}

export const TreeState = Object.freeze({
  GROWN: 0,
  STUMP: 1
});

export const GathererState = Object.freeze({
  IDLE: 0,
  MOVING_TO_NODE: 1,
  HARVESTING: 2,
  RETURNING_TO_BASE: 3
});

export class EconomySystem {
  constructor(navGrid, config = {}) {
    this.navGrid = navGrid;
    this.ecoConfig = simBuildings().economy;
    this.buildingDefs = simBuildings().buildings;

    this.treeMaxWood = (this.ecoConfig.treeMaxWood | 0) || 250;
    this.treeRegrowTicks = (this.ecoConfig.treeRegrowTicks | 0) || 900;
    this.passiveIntervalTicks = (this.ecoConfig.passiveIncomeIntervalTicks | 0) || 20;

    this.teamResources = new Map();
    for (let teamId = 1; teamId <= 8; teamId++) {
      const start = this.ecoConfig.startingResources;
      this.teamResources.set(teamId, {
        coins: start.coins | 0,
        wood: start.wood | 0,
        stone: start.stone | 0,
        iron: start.iron | 0,
        popUsed: 0,
        popCap: (this.ecoConfig.basePopulationCap | 0) || 60
      });
    }

    this.trees = new Map();
    this.sortedTreeIds = [];
    this.mines = new Map();
    this.sortedMineIds = [];
    this.companyGatherTasks = new Map();

    this._initDeterministicForest(config);
    this._initDeterministicMines();
  }

  _initDeterministicForest(config) {
    const worldSizeMeters = this.navGrid?.worldSizeMeters || 4096;
    const treeList = generateDeterministicTreesFx(config, worldSizeMeters);

    for (let i = 0; i < treeList.length; i++) {
      const t = treeList[i];
      const tileX = this.navGrid ? this.navGrid.worldFxToTileX(t.xFx) : 0;
      const tileZ = this.navGrid ? this.navGrid.worldFxToTileZ(t.zFx) : 0;

      this.trees.set(t.id, {
        id: t.id,
        xFx: t.xFx,
        zFx: t.zFx,
        tileX,
        tileZ,
        woodRemaining: this.treeMaxWood,
        state: TreeState.GROWN,
        regrowTimerTicks: 0
      });
      this.sortedTreeIds.push(t.id);
    }
  }

  _initDeterministicMines() {
    const worldSizeMeters = this.navGrid?.worldSizeMeters || 4096;
    const mineList = generateDeterministicMinesFx(worldSizeMeters);

    for (let i = 0; i < mineList.length; i++) {
      const m = mineList[i];
      this.mines.set(m.id, {
        id: m.id,
        resourceType: m.resourceType,
        xFx: m.xFx,
        yFx: m.yFx,
        zFx: m.zFx
      });
      this.sortedMineIds.push(m.id);
    }
  }

  isOverlappingResourceNode(xFx, zFx, footprintRadiusFx) {
    const mineClearanceFx = (footprintRadiusFx + 4 * FX_ONE) | 0;
    for (let i = 0; i < this.sortedMineIds.length; i++) {
      const m = this.mines.get(this.sortedMineIds[i]);
      if (!m) continue;
      const d = fxHypot((m.xFx - (xFx | 0)) | 0, (m.zFx - (zFx | 0)) | 0);
      if (d < mineClearanceFx) return true;
    }

    const treeClearanceFx = (footprintRadiusFx + 2 * FX_ONE) | 0;
    for (let i = 0; i < this.sortedTreeIds.length; i++) {
      const t = this.trees.get(this.sortedTreeIds[i]);
      if (!t || t.state !== TreeState.GROWN || t.woodRemaining <= 0) continue;
      const d = fxHypot((t.xFx - (xFx | 0)) | 0, (t.zFx - (zFx | 0)) | 0);
      if (d < treeClearanceFx) return true;
    }

    return false;
  }


  computeTeamPopCap(teamId, buildingsMap = null, sortedBuildingIds = null) {
    let popCap = (this.ecoConfig.basePopulationCap | 0) || 60;
    const bMap = buildingsMap;
    const bIds = sortedBuildingIds;
    if (bMap && Array.isArray(bIds)) {
      for (let i = 0; i < bIds.length; i++) {
        const b = bMap.get(bIds[i]);
        if (!b || b.team !== (teamId | 0) || !b.isCompleted || b.hp <= 0) continue;
        const def = this.buildingDefs[b.type];
        if (def && def.popCapBonus) {
          popCap = (popCap + (def.popCapBonus | 0)) | 0;
        }
      }
    }
    return popCap;
  }

  computeTeamPopUsedAndReserved(gameState, teamId) {
    const tid = teamId | 0;
    let aliveCount = 0;
    if (gameState?.entities && Array.isArray(gameState.sortedEntityIds)) {
      const ids = gameState.sortedEntityIds;
      for (let i = 0; i < ids.length; i++) {
        const ent = gameState.entities.get(ids[i]);
        if (ent && ent.team === tid && ent.hp > 0) {
          aliveCount++;
        }
      }
    }
    let reservedDoorRemaining = 0;
    const cs = gameState?.constructionSystem;
    if (cs?.buildings && Array.isArray(cs.sortedBuildingIds)) {
      for (let i = 0; i < cs.sortedBuildingIds.length; i++) {
        const b = cs.buildings.get(cs.sortedBuildingIds[i]);
        if (!b || b.team !== tid || b.isDestroyed || b.hp <= 0) continue;
        if (Array.isArray(b.activeDoorSpawns)) {
          for (let s = 0; s < b.activeDoorSpawns.length; s++) {
            const st = b.activeDoorSpawns[s];
            const rem = Math.max(0, (st.totalUnits | 0) - (st.spawnedCount | 0));
            reservedDoorRemaining = (reservedDoorRemaining + rem) | 0;
          }
        }
      }
    }
    return {
      aliveCount,
      reservedDoorRemaining,
      totalCommitted: (aliveCount + reservedDoorRemaining) | 0
    };
  }

  getTeamLedger(team = 1) {
    const tid = (team | 0) || 1;
    let ledger = this.teamResources.get(tid);
    if (!ledger) {
      const start = this.ecoConfig.startingResources;
      ledger = {
        coins: start.coins | 0,
        wood: start.wood | 0,
        stone: start.stone | 0,
        iron: start.iron | 0,
        popUsed: 0,
        popCap: (this.ecoConfig.basePopulationCap | 0) || 60
      };
      this.teamResources.set(tid, ledger);
    }
    return ledger;
  }

  grantCheatResources(team = 1, amount = 1000) {
    const add = Math.max(0, amount | 0);
    this.addResource(team, ResourceTypes.COINS, add);
    this.addResource(team, ResourceTypes.WOOD, add);
    this.addResource(team, ResourceTypes.STONE, add);
    this.addResource(team, ResourceTypes.IRON, add);
  }

  sanitizeCostForCategory(rawCost, category = 'building', unitId = '') {
    const coins = Math.max(0, rawCost?.coins | 0);
    const stone = Math.max(0, rawCost?.stone | 0);
    const iron = Math.max(0, rawCost?.iron | 0);
    let wood = Math.max(0, rawCost?.wood | 0);

    const isBuilding = category === 'building';
    const isHeroUnit =
      category === 'hero' || (typeof unitId === 'string' && unitId.startsWith('hero:'));
    const isArcherUnit =
      category === 'unit' && (unitId === 'archer' || unitId === 'crossbowman');

    if (!isBuilding && !isArcherUnit && !isHeroUnit) {
      wood = 0;
    }

    return { coins, wood, stone, iron };
  }

  canAfford(team, rawCost, category = 'building', unitId = '') {
    const ledger = this.getTeamLedger(team);
    const cost = this.sanitizeCostForCategory(rawCost, category, unitId);
    return (
      ledger.coins >= cost.coins &&
      ledger.wood >= cost.wood &&
      ledger.stone >= cost.stone &&
      ledger.iron >= cost.iron
    );
  }

  spendResources(team, rawCost, category = 'building', unitId = '') {
    if (!this.canAfford(team, rawCost, category, unitId)) return false;
    const ledger = this.getTeamLedger(team);
    const cost = this.sanitizeCostForCategory(rawCost, category, unitId);
    ledger.coins = (ledger.coins - cost.coins) | 0;
    ledger.wood = (ledger.wood - cost.wood) | 0;
    ledger.stone = (ledger.stone - cost.stone) | 0;
    ledger.iron = (ledger.iron - cost.iron) | 0;
    return true;
  }

  refundResources(team, rawCost, category = 'building', unitId = '') {
    const ledger = this.getTeamLedger(team);
    const cost = this.sanitizeCostForCategory(rawCost, category, unitId);
    ledger.coins = (ledger.coins + cost.coins) | 0;
    ledger.wood = (ledger.wood + cost.wood) | 0;
    ledger.stone = (ledger.stone + cost.stone) | 0;
    ledger.iron = (ledger.iron + cost.iron) | 0;
  }

  addResource(team, resourceType, amount) {
    const ledger = this.getTeamLedger(team);
    const add = Math.max(0, amount | 0);
    if (resourceType === ResourceTypes.COINS) ledger.coins = (ledger.coins + add) | 0;
    else if (resourceType === ResourceTypes.WOOD) ledger.wood = (ledger.wood + add) | 0;
    else if (resourceType === ResourceTypes.STONE) ledger.stone = (ledger.stone + add) | 0;
    else if (resourceType === ResourceTypes.IRON) ledger.iron = (ledger.iron + add) | 0;
  }

  findNearestGrownTree(xFx, zFx, maxRadiusFx = 64 * FX_ONE) {
    let bestTree = null;
    let bestDist = maxRadiusFx | 0;

    for (let i = 0; i < this.sortedTreeIds.length; i++) {
      const tree = this.trees.get(this.sortedTreeIds[i]);
      if (!tree || tree.state !== TreeState.GROWN || tree.woodRemaining <= 0) continue;
      const d = fxHypot((tree.xFx - (xFx | 0)) | 0, (tree.zFx - (zFx | 0)) | 0);
      if (d <= bestDist) {
        bestDist = d;
        bestTree = tree;
      }
    }
    return bestTree;
  }

  findNearestMine(xFx, zFx, maxRadiusFx = 24 * FX_ONE, filterResourceType = null) {
    let bestMine = null;
    let bestDist = maxRadiusFx | 0;

    for (let i = 0; i < this.sortedMineIds.length; i++) {
      const mine = this.mines.get(this.sortedMineIds[i]);
      if (!mine) continue;
      if (filterResourceType && mine.resourceType !== filterResourceType) continue;
      const d = fxHypot((mine.xFx - (xFx | 0)) | 0, (mine.zFx - (zFx | 0)) | 0);
      if (d <= bestDist) {
        bestDist = d;
        bestMine = mine;
      }
    }
    return bestMine;
  }

  _findDropoffBuildingAtPoint(team, xFx, zFx, buildingsMap, sortedBuildingIds) {
    if (!buildingsMap || !Array.isArray(sortedBuildingIds)) return null;
    for (let i = 0; i < sortedBuildingIds.length; i++) {
      const b = buildingsMap.get(sortedBuildingIds[i]);
      if (!b || b.team !== (team | 0) || !b.isCompleted || b.hp <= 0) continue;
      if (b.type !== 'citadel' && b.type !== 'gathering_camp') continue;
      const hitRadFx = Math.round((b.footprintRadiusMeters + 2.6) * FX_ONE) | 0;
      const d = fxHypot((b.xFx - (xFx | 0)) | 0, (b.zFx - (zFx | 0)) | 0);
      if (d <= hitRadFx) return b;
    }
    return null;
  }

  _findNearestDropoffBuilding(team, xFx, zFx, buildingsMap, sortedBuildingIds) {
    if (!buildingsMap || !Array.isArray(sortedBuildingIds)) return null;
    let bestBld = null;
    let bestDist = 0x7fffffff;

    for (let i = 0; i < sortedBuildingIds.length; i++) {
      const b = buildingsMap.get(sortedBuildingIds[i]);
      if (!b || b.team !== (team | 0) || !b.isCompleted || b.hp <= 0) continue;
      if (b.type !== 'citadel' && b.type !== 'gathering_camp') continue;
      const d = fxHypot((b.xFx - (xFx | 0)) | 0, (b.zFx - (zFx | 0)) | 0);
      if (d < bestDist) {
        bestDist = d;
        bestBld = b;
      }
    }
    return bestBld;
  }

  _setCompanyCarryProps(comp, carryCode, entitiesMap) {
    if (!comp || !entitiesMap) return;
    if ((carryCode | 0) === CarryPropCode.NONE) {
      comp.carriedResourceType = null;
      comp.carriedResourceAmount = 0;
    }
    for (let i = 0; i < comp.memberIds.length; i++) {
      const ent = entitiesMap.get(comp.memberIds[i]);
      if (ent) {
        ent.carryType = carryCode | 0;
        ent.role = 0;
      }
    }
  }

  _assignCircularHarvestSlots(comp, nodeXFx, nodeZFx, isMine, entitiesMap) {
    comp.isWorking = true;
    const count = comp.memberIds.length;
    if (count === 0) return;

    const ringRadiusFx = isMine ? 4 * FX_ONE + 665 : 1 * FX_ONE + 768;
    const baseAngleOffset = (comp.id * 173) & ANGLE_MASK;

    for (let i = 0; i < count; i++) {
      const ent = entitiesMap.get(comp.memberIds[i]);
      if (!ent || ent.hp <= 0) continue;

      const angleIdx = (baseAngleOffset + (i * 1024) / count) & ANGLE_MASK;
      let slotXFx = (nodeXFx + mulDiv(ringRadiusFx, fxCos(angleIdx), FX_ONE)) | 0;
      let slotZFx = (nodeZFx + mulDiv(ringRadiusFx, fxSin(angleIdx), FX_ONE)) | 0;

      // Ensure harvest slots are always on walkable terrain so workers never get stuck outside blocked tiles
      if (this.navGrid && !this.navGrid.isWalkableWorldFx(slotXFx, slotZFx)) {
        const walkable = this.navGrid.findNearestWalkableTile(
          this.navGrid.worldFxToTileX(slotXFx),
          this.navGrid.worldFxToTileZ(slotZFx),
          6
        );
        slotXFx = this.navGrid.tileToWorldCenterFxX(walkable.tx);
        slotZFx = this.navGrid.tileToWorldCenterFxZ(walkable.tz);
      }

      const faceCenterDir = fxAtan2((nodeZFx - slotZFx) | 0, (nodeXFx - slotXFx) | 0);

      ent.role = 0;
      ent.slotTargetXFx = slotXFx;
      ent.slotTargetZFx = slotZFx;
      ent.targetX = slotXFx;
      ent.targetZ = slotZFx;
      ent.desiredFacingDir = faceCenterDir;

      const distToSlot = fxHypot((ent.x - slotXFx) | 0, (ent.z - slotZFx) | 0);
      if (distToSlot <= 1400) {
        ent.x = slotXFx;
        ent.z = slotZFx;
        ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
        ent.dir = faceCenterDir;
        ent.isMoving = false;
        ent.pathWaypoints = null;
      } else {
        ent.isMoving = true;
      }
    }
  }

  _funnelWorkersToDropoffWall(comp, dropoff, entitiesMap) {
    const wallRadiusFx = Math.round((dropoff.footprintRadiusMeters + 0.85) * FX_ONE) | 0;
    const count = comp.memberIds.length;
    for (let i = 0; i < count; i++) {
      const ent = entitiesMap.get(comp.memberIds[i]);
      if (!ent || ent.hp <= 0) continue;

      const dx = (ent.x - dropoff.xFx) | 0;
      const dz = (ent.z - dropoff.zFx) | 0;
      const dist = Math.max(1, fxHypot(dx, dz));
      const wallXFx = (dropoff.xFx + Math.imul(dx, wallRadiusFx) / dist) | 0;
      const wallZFx = (dropoff.zFx + Math.imul(dz, wallRadiusFx) / dist) | 0;

      ent.slotTargetXFx = wallXFx;
      ent.slotTargetZFx = wallZFx;
      ent.targetX = wallXFx;
      ent.targetZ = wallZFx;
      ent.desiredFacingDir = fxAtan2((dropoff.zFx - ent.z) | 0, (dropoff.xFx - ent.x) | 0);
      ent.isMoving = true;
    }
  }
}

import { workerGatheringStepperMethods } from './workerGatheringStepper.js';
Object.assign(EconomySystem.prototype, workerGatheringStepperMethods);
