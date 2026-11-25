/**
 * Kings Lands — Worker Resource Gathering, Doorway Entry Dropoff & Passive Economy Stepper
 * (src/sim/systems/workerGatheringStepper.js)
 *
 * Upgrades:
 * - Reads per-resource harvest durations (`harvestTimeSecByResource`: wood, stone, iron, coins),
 *   `carryCapacity`, and `batchYield` dynamically from `src/data/unitStats.json` (`worker.workerGathering`).
 * - Workers returning with resources must walk to the building's FRONT DOORWAY (`_getBuildingDoorVectorFx`)
 *   and physically enter through the door (`enterDoorOnDropoff`, briefly stepping inside the doorway while
 *   the building doors swing open) before depositing resources and exiting back out to harvest!
 */
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
import { defaultBuildingsData as buildingsData } from '../../data/defaults.js';
import { defaultUnitStats as unitStatsData } from '../../data/defaults.js';

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
  RETURNING_TO_BASE: 3,
  ENTERING_DOOR: 4
});

function getWorkerGatheringConfig() {
  const wg = unitStatsData?.units?.worker?.workerGathering || {};
  return {
    carryCapacity: Math.max(5, (wg.carryCapacity | 0) || 45),
    batchYield: Math.max(1, (wg.batchYield | 0) || 15),
    enterDoorOnDropoff: wg.enterDoorOnDropoff !== false,
    doorInsideStayTicks: Math.max(2, (wg.doorInsideStayTicks | 0) || 8),
    allowedResources: {
      wood: wg.allowedResources?.wood !== false,
      stone: wg.allowedResources?.stone !== false,
      iron: wg.allowedResources?.iron !== false,
      coins: wg.allowedResources?.coins !== false
    },
    harvestTimeSecByResource: {
      wood: Number(wg.harvestTimeSecByResource?.wood) || 3.5,
      stone: Number(wg.harvestTimeSecByResource?.stone) || 4.8,
      iron: Number(wg.harvestTimeSecByResource?.iron) || 5.5,
      coins: Number(wg.harvestTimeSecByResource?.coins) || 5.0
    }
  };
}

export const workerGatheringStepperMethods = {
  _getBuildingDoorApproachWorldFx(building, gameState, outsideMetersOffset = 1.15) {
    const cs = gameState?.constructionSystem;
    const rMeters = (Number(building.footprintRadiusMeters) || 5) + outsideMetersOffset;
    if (cs && typeof cs._getBuildingDoorVectorFx === 'function') {
      const doorVec = cs._getBuildingDoorVectorFx(building, rMeters);
      return {
        xFx: (building.xFx + doorVec.dxFx) | 0,
        zFx: (building.zFx + doorVec.dzFx) | 0,
        dir: doorVec.dir
      };
    }
    const dir = (building.facingDir ?? (building.team === 1 ? 256 : 768)) & ANGLE_MASK;
    const distFx = Math.round(rMeters * FX_ONE) | 0;
    return {
      xFx: (building.xFx + mulDiv(distFx, fxCos(dir), FX_ONE)) | 0,
      zFx: (building.zFx + mulDiv(distFx, fxSin(dir), FX_ONE)) | 0,
      dir
    };
  },

  _funnelWorkersIntoBuildingDoor(comp, dropoff, gameState) {
    const doorThreshold = this._getBuildingDoorApproachWorldFx(dropoff, gameState, 0.15);
    comp.anchorXFx = doorThreshold.xFx;
    comp.anchorZFx = doorThreshold.zFx;
    comp.targetXFx = doorThreshold.xFx;
    comp.targetZFx = doorThreshold.zFx;
    dropoff.doorOpenTicks = Math.max(dropoff.doorOpenTicks | 0, 24);

    for (let m = 0; m < comp.memberIds.length; m++) {
      const ent = gameState.entities.get(comp.memberIds[m]);
      if (!ent || ent.hp <= 0) continue;
      ent.slotTargetXFx = doorThreshold.xFx;
      ent.slotTargetZFx = doorThreshold.zFx;
      ent.targetX = doorThreshold.xFx;
      ent.targetZ = doorThreshold.zFx;
      ent.desiredFacingDir = (doorThreshold.dir + 512) & ANGLE_MASK;
      ent.settled = 0;
      ent.atSlot = 0;
      const dToDoor = fxHypot((ent.x - doorThreshold.xFx) | 0, (ent.z - doorThreshold.zFx) | 0);
      if (dToDoor <= 1450) {
        ent.x = doorThreshold.xFx;
        ent.z = doorThreshold.zFx;
        ent.isGarrisoned = true;
        ent.isMoving = false;
      } else {
        ent.isMoving = true;
      }
    }
  },

  _ejectWorkersFromBuildingDoor(comp, dropoff, gameState) {
    const doorOut = this._getBuildingDoorApproachWorldFx(dropoff, gameState, 1.35);
    dropoff.doorOpenTicks = Math.max(dropoff.doorOpenTicks | 0, 18);
    comp.anchorXFx = doorOut.xFx;
    comp.anchorZFx = doorOut.zFx;
    comp.targetXFx = doorOut.xFx;
    comp.targetZFx = doorOut.zFx;
    comp.facingDir = doorOut.dir;
    comp.desiredFacingDir = doorOut.dir;

    for (let m = 0; m < comp.memberIds.length; m++) {
      const ent = gameState.entities.get(comp.memberIds[m]);
      if (!ent || ent.hp <= 0) continue;
      const lateralOffset = (m - 1) * 620;
      const outX = (doorOut.xFx - mulDiv(lateralOffset, fxSin(doorOut.dir), FX_ONE)) | 0;
      const outZ = (doorOut.zFx + mulDiv(lateralOffset, fxCos(doorOut.dir), FX_ONE)) | 0;
      ent.isGarrisoned = false;
      ent.x = outX;
      ent.z = outZ;
      if (this.navGrid) {
        ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
      }
      ent.slotTargetXFx = outX;
      ent.slotTargetZFx = outZ;
      ent.targetX = outX;
      ent.targetZ = outZ;
      ent.dir = doorOut.dir;
      ent.desiredFacingDir = doorOut.dir;
      ent.settled = 0;
      ent.atSlot = 0;
    }
  },

  _activateGatherTaskForCompany(comp, gatherSpec, gameState) {
    const cid = comp.id | 0;
    const wgCfg = getWorkerGatheringConfig();
    const existingTask = this.companyGatherTasks.get(cid);
    const keepCarry =
      existingTask?.resourceType === gatherSpec.resourceType
        ? existingTask.carryAmount
        : comp.carriedResourceType === gatherSpec.resourceType
          ? comp.carriedResourceAmount
          : 0;

    const newTask = {
      companyId: cid,
      team: comp.team | 0,
      state: GathererState.MOVING_TO_NODE,
      resourceType: gatherSpec.resourceType,
      isMine: Boolean(gatherSpec.isMine),
      targetNodeId: gatherSpec.targetNodeId,
      nodeXFx: gatherSpec.nodeXFx | 0,
      nodeZFx: gatherSpec.nodeZFx | 0,
      dropoffBuildingId: -1,
      carryAmount: keepCarry,
      carryCapacity: wgCfg.carryCapacity,
      harvestProgressPermille: 0,
      doorStayTicks: 0,
      queuedAfterBuild: false
    };

    this.companyGatherTasks.set(cid, newTask);
    comp.lastHarvestedNode = {
      resourceType: gatherSpec.resourceType,
      isMine: Boolean(gatherSpec.isMine),
      targetNodeId: gatherSpec.targetNodeId,
      nodeXFx: gatherSpec.nodeXFx | 0,
      nodeZFx: gatherSpec.nodeZFx | 0
    };

    if (keepCarry > 0) {
      comp.carriedResourceType = gatherSpec.resourceType;
      comp.carriedResourceAmount = keepCarry;
    }
    this._setCompanyCarryProps(
      comp,
      keepCarry > 0 ? resourceTypeToCarryCode(gatherSpec.resourceType) : CarryPropCode.NONE,
      gameState.entities
    );
  },

  assignWorkerGatheringOrder(
    workerCompanyIds,
    targetXFx,
    targetZFx,
    team,
    gameState,
    queue = false,
    isRunning = false
  ) {
    if (!Array.isArray(workerCompanyIds) || workerCompanyIds.length === 0) return false;

    const buildingsMap = gameState.constructionSystem?.buildings;
    const sortedBuildingIds = gameState.constructionSystem?.sortedBuildingIds;

    // 1. Check if the player explicitly clicked on a friendly completed Citadel or Gathering Camp
    const clickedDropoffBld = this._findDropoffBuildingAtPoint(
      team,
      targetXFx,
      targetZFx,
      buildingsMap,
      sortedBuildingIds
    );

    if (clickedDropoffBld) {
      let assignedDropoff = false;
      const doorPos = this._getBuildingDoorApproachWorldFx(clickedDropoffBld, gameState, 1.15);

      for (let i = 0; i < workerCompanyIds.length; i++) {
        const cid = workerCompanyIds[i] | 0;
        const comp = gameState.companies.get(cid);
        if (!comp || comp.team !== (team | 0) || comp.unitType !== 'worker') continue;

        const interruptedPatrol = comp.clearPatrolIfActive?.() || false;
        const effectiveQueue = Boolean(queue) && !interruptedPatrol;

        if (!effectiveQueue) {
          gameState.constructionSystem?.workerBuildQueues?.delete(cid);
          gameState.constructionSystem?.pendingGarrisonOrders?.delete(cid);
          this.companyGatherTasks.delete(cid);
          comp.activeBuildTargetId = 0;
          comp.pendingGatherOrder = null;
          comp.isWorking = false;
        }

        this._marchCompanyToPoint(
          comp,
          doorPos.xFx,
          doorPos.zFx,
          0,
          gameState,
          effectiveQueue,
          Boolean(isRunning),
          { dropoffBuildingId: clickedDropoffBld.id }
        );
        assignedDropoff = true;
      }
      return assignedDropoff;
    }

    // 2. Otherwise resolve the clicked Mine or Tree
    const mine = this.findNearestMine(targetXFx, targetZFx, 6 * FX_ONE);
    const tree = !mine ? this.findNearestGrownTree(targetXFx, targetZFx, 5 * FX_ONE) : null;

    if (!mine && !tree) return false;

    const resourceType = mine ? mine.resourceType : ResourceTypes.WOOD;
    const nodeId = mine ? mine.id : tree.id;
    const nodeXFx = mine ? mine.xFx : tree.xFx;
    const nodeZFx = mine ? mine.zFx : tree.zFx;
    const isMine = Boolean(mine);

    const gatherSpec = {
      resourceType,
      isMine,
      targetNodeId: nodeId,
      nodeXFx,
      nodeZFx
    };

    const wgCfg = getWorkerGatheringConfig();
    if (wgCfg.allowedResources[gatherSpec.resourceType] === false) {
      return false;
    }

    let assignedAny = false;

    for (let i = 0; i < workerCompanyIds.length; i++) {
      const cid = workerCompanyIds[i] | 0;
      const comp = gameState.companies.get(cid);
      if (!comp || comp.team !== (team | 0) || comp.unitType !== 'worker') continue;

      const interruptedPatrol = comp.clearPatrolIfActive?.() || false;
      const effectiveQueue = Boolean(queue) && !interruptedPatrol;

      const activeBuildQ = gameState.constructionSystem?.workerBuildQueues?.get(cid);
      const hasActiveTaskNow =
        comp.isActivelyMoving() ||
        comp.isWorking ||
        comp.activeBuildTargetId > 0 ||
        comp.activeDropoffBuildingId > 0 ||
        this.companyGatherTasks.has(cid) ||
        Boolean(activeBuildQ && activeBuildQ.length > 0);

      if (!effectiveQueue || !hasActiveTaskNow) {
        gameState.constructionSystem?.workerBuildQueues?.delete(cid);
        gameState.constructionSystem?.pendingGarrisonOrders?.delete(cid);
        comp.activeBuildTargetId = 0;
        comp.activeDropoffBuildingId = 0;
        comp.pendingGatherOrder = null;
        comp.isWorking = false;

        this._activateGatherTaskForCompany(comp, gatherSpec, gameState);

        const standOffFx = isMine ? 5 * FX_ONE : 2 * FX_ONE;
        this._marchCompanyToPoint(
          comp,
          nodeXFx,
          nodeZFx,
          standOffFx,
          gameState,
          false,
          Boolean(isRunning)
        );
      } else {
        const standOffFx = isMine ? 5 * FX_ONE : 2 * FX_ONE;
        this._marchCompanyToPoint(
          comp,
          nodeXFx,
          nodeZFx,
          standOffFx,
          gameState,
          true,
          Boolean(isRunning),
          { gatherNodeTask: gatherSpec }
        );
      }

      assignedAny = true;
    }

    if (assignedAny && (team | 0) === 1 && gameState?.pendingEvents) {
      const nodeYFx = this.navGrid
        ? this.navGrid.sampleHeightAtWorldFx(nodeXFx, nodeZFx)
        : 0;
      gameState.pendingEvents.push({
        tick: gameState.tick,
        kind: 'RESOURCE_PING',
        resourceType,
        isMine,
        nodeId,
        xFx: nodeXFx,
        yFx: nodeYFx,
        zFx: nodeZFx,
        label: `Gathering ${resourceType}`
      });
    }

    return assignedAny;
  },

  cancelGatheringForCompanies(companyIds, entitiesMap = null, companiesMap = null) {
    if (!Array.isArray(companyIds)) return;
    for (let i = 0; i < companyIds.length; i++) {
      const cid = companyIds[i] | 0;
      this.companyGatherTasks.delete(cid);
      if (companiesMap) {
        const comp = companiesMap.get(cid);
        if (comp) {
          comp.isWorking = false;
          comp.pendingGatherOrder = null;
          if (entitiesMap) {
            for (let m = 0; m < comp.memberIds.length; m++) {
              const ent = entitiesMap.get(comp.memberIds[m]);
              if (ent && ent.isGarrisoned && comp.garrisonedBuildingId <= 0) {
                ent.isGarrisoned = false;
              }
            }
          }
        }
      }
    }
  },

  _marchCompanyToPoint(
    comp,
    destXFx,
    destZFx,
    stopStandOffFx,
    gameState,
    queue = false,
    isRunning = false,
    extraTags = {}
  ) {
    if (!queue) {
      comp.isWorking = false;
    }

    let originXFx = comp.anchorXFx;
    let originZFx = comp.anchorZFx;
    const buildQ = gameState?.constructionSystem?.workerBuildQueues?.get(comp.id);
    const gatherTask = this.companyGatherTasks.get(comp.id);

    if (queue && comp.commandQueue.length > 0) {
      const lastQ = comp.commandQueue[comp.commandQueue.length - 1];
      originXFx = lastQ.targetXFx;
      originZFx = lastQ.targetZFx;
    } else if (queue && buildQ && buildQ.length > 0) {
      const lastBld = gameState.constructionSystem.buildings.get(buildQ[buildQ.length - 1]);
      if (lastBld) {
        originXFx = lastBld.xFx;
        originZFx = lastBld.zFx;
      }
    } else if (queue && gatherTask && gatherTask.state !== GathererState.RETURNING_TO_BASE) {
      originXFx = gatherTask.nodeXFx;
      originZFx = gatherTask.nodeZFx;
    } else if (queue && comp.isActivelyMoving()) {
      originXFx = comp.targetXFx;
      originZFx = comp.targetZFx;
    }

    const dx = (originXFx - destXFx) | 0;
    const dz = (originZFx - destZFx) | 0;
    const dist = fxHypot(dx, dz);

    let approachXFx = destXFx;
    let approachZFx = (destZFx + stopStandOffFx) | 0;
    if (stopStandOffFx > 0 && dist > stopStandOffFx && dist > 0) {
      approachXFx = (destXFx + Math.imul(dx, stopStandOffFx) / dist) | 0;
      approachZFx = (destZFx + Math.imul(dz, stopStandOffFx) / dist) | 0;
    } else if (stopStandOffFx <= 0) {
      approachXFx = destXFx;
      approachZFx = destZFx;
    }

    const walkable = this.navGrid.findNearestWalkableTile(
      this.navGrid.worldFxToTileX(approachXFx),
      this.navGrid.worldFxToTileZ(approachZFx),
      12
    );
    const goalXFx = this.navGrid.tileToWorldCenterFxX(walkable.tx);
    const goalZFx = this.navGrid.tileToWorldCenterFxZ(walkable.tz);
    const facingDir = fxAtan2((destZFx - originZFx) | 0, (destXFx - originXFx) | 0);

    const hasPendingBuildOrGather = Boolean(
      queue && ((buildQ && buildQ.length > 0) || Boolean(gatherTask))
    );

    comp.enqueueOrSetOrder(
      {
        orderType: CompanyOrderType.MOVE,
        targetXFx: goalXFx,
        targetZFx: goalZFx,
        facingDir,
        customWidthFx: comp.customWidthFx,
        isRunning: Boolean(isRunning),
        forceQueue: hasPendingBuildOrGather,
        dropoffBuildingId: extraTags.dropoffBuildingId | 0,
        gatherNodeTask: extraTags.gatherNodeTask || null
      },
      Boolean(queue),
      gameState.astar,
      this.navGrid,
      gameState.entities
    );
  },

  _autoResumeGatheringAfterDropoff(comp, deliveredType, dropoffBld, gameState) {
    const lastNode = comp.lastHarvestedNode;
    const resType = deliveredType || lastNode?.resourceType;
    if (!resType) return false;

    const searchXFx = lastNode ? lastNode.nodeXFx : dropoffBld.xFx;
    const searchZFx = lastNode ? lastNode.nodeZFx : dropoffBld.zFx;

    if (resType === ResourceTypes.WOOD) {
      let tree = lastNode?.targetNodeId ? this.trees.get(lastNode.targetNodeId) : null;
      if (!tree || tree.state !== TreeState.GROWN || tree.woodRemaining <= 0) {
        tree = this.findNearestGrownTree(searchXFx, searchZFx, 180 * FX_ONE);
      }
      if (!tree) return false;

      this._activateGatherTaskForCompany(
        comp,
        {
          resourceType: ResourceTypes.WOOD,
          isMine: false,
          targetNodeId: tree.id,
          nodeXFx: tree.xFx,
          nodeZFx: tree.zFx
        },
        gameState
      );
      this._marchCompanyToPoint(comp, tree.xFx, tree.zFx, 2 * FX_ONE, gameState, false, false);
      return true;
    } else {
      let mine = lastNode?.targetNodeId ? this.mines.get(lastNode.targetNodeId) : null;
      if (!mine || mine.resourceType !== resType) {
        mine = this.findNearestMine(searchXFx, searchZFx, 220 * FX_ONE, resType);
      }
      if (!mine) return false;

      this._activateGatherTaskForCompany(
        comp,
        {
          resourceType: mine.resourceType,
          isMine: true,
          targetNodeId: mine.id,
          nodeXFx: mine.xFx,
          nodeZFx: mine.zFx
        },
        gameState
      );
      this._marchCompanyToPoint(comp, mine.xFx, mine.zFx, 5 * FX_ONE, gameState, false, false);
      return true;
    }
  },

  _stepExplicitDropoffOrder(comp, buildingsMap, currentTick, gameState) {
    if (!comp.activeDropoffBuildingId || comp.activeDropoffBuildingId <= 0) return false;

    const dropoff = buildingsMap?.get(comp.activeDropoffBuildingId);
    if (!dropoff || !dropoff.isCompleted || dropoff.hp <= 0) {
      comp.activeDropoffBuildingId = 0;
      comp.isWorking = false;
      return false;
    }

    const wgCfg = getWorkerGatheringConfig();
    const doorPos = this._getBuildingDoorApproachWorldFx(dropoff, gameState, 1.0);
    const doorTriggerFx = 3 * FX_ONE + 512;

    let closestToDoorFx = fxHypot(
      (comp.anchorXFx - doorPos.xFx) | 0,
      (comp.anchorZFx - doorPos.zFx) | 0
    );
    for (let m = 0; m < comp.memberIds.length; m++) {
      const ent = gameState.entities.get(comp.memberIds[m]);
      if (ent && ent.hp > 0) {
        const dEnt = fxHypot((ent.x - doorPos.xFx) | 0, (ent.z - doorPos.zFx) | 0);
        if (dEnt < closestToDoorFx) {
          closestToDoorFx = dEnt;
        }
      }
    }

    if (closestToDoorFx <= doorTriggerFx) {
      comp.isWorking = true;
      comp._explicitDoorTicks = ((comp._explicitDoorTicks | 0) + 1) | 0;
      if (wgCfg.enterDoorOnDropoff && comp._explicitDoorTicks <= wgCfg.doorInsideStayTicks) {
        this._funnelWorkersIntoBuildingDoor(comp, dropoff, gameState);
        return true;
      }

      comp._explicitDoorTicks = 0;
      this._ejectWorkersFromBuildingDoor(comp, dropoff, gameState);
      comp.isWorking = false;
      comp.activeDropoffBuildingId = 0;

      const deliveredAmount = comp.carriedResourceAmount | 0;
      const deliveredType = comp.carriedResourceType || comp.lastHarvestedNode?.resourceType || null;
      if (deliveredAmount > 0 && deliveredType) {
        this.addResource(comp.team, deliveredType, deliveredAmount);
        this._setCompanyCarryProps(comp, CarryPropCode.NONE, gameState.entities);

        if (comp.team === 1) {
          gameState.pendingEvents.push({
            tick: currentTick,
            kind: 'RESOURCE_DROPOFF',
            resourceType: deliveredType,
            amount: deliveredAmount,
            xFx: dropoff.xFx,
            yFx: (dropoff.yFx + 4 * FX_ONE) | 0,
            zFx: dropoff.zFx,
            label: `+${deliveredAmount} ${deliveredType.toUpperCase()}`
          });
        }
      }

      const pendingBuildQ = gameState.constructionSystem?.workerBuildQueues?.get(comp.id);
      const hasBuildFollowUp = Boolean(pendingBuildQ && pendingBuildQ.length > 0);

      if (comp.commandQueue.length > 0 && !hasBuildFollowUp) {
        comp.advanceCommandQueue(gameState.astar, this.navGrid, gameState.entities);
      } else if (!hasBuildFollowUp && comp.commandQueue.length === 0) {
        if (!this._autoResumeGatheringAfterDropoff(comp, deliveredType, dropoff, gameState)) {
          comp.stopInPlace(this.navGrid, gameState.entities);
        }
      }
      return true;
    } else if (!comp.isActivelyMoving()) {
      this._marchCompanyToPoint(
        comp,
        doorPos.xFx,
        doorPos.zFx,
        0,
        gameState,
        false,
        false,
        { dropoffBuildingId: dropoff.id }
      );
      return true;
    }

    return false;
  },

  getDepletedTreeIds() {
    const depleted = [];
    for (let i = 0; i < this.sortedTreeIds.length; i++) {
      const t = this.trees.get(this.sortedTreeIds[i]);
      if (t && t.state === TreeState.STUMP) {
        depleted.push(t.id);
      }
    }
    return depleted;
  },

  update(currentTick, buildingsMap, sortedBuildingIds, gameState = null, enums = null) {
    for (let i = 0; i < this.sortedTreeIds.length; i++) {
      const tree = this.trees.get(this.sortedTreeIds[i]);
      if (!tree || tree.state !== TreeState.STUMP) continue;
      tree.regrowTimerTicks = (tree.regrowTimerTicks - 1) | 0;
      if (tree.regrowTimerTicks <= 0) {
        tree.state = TreeState.GROWN;
        tree.woodRemaining = this.treeMaxWood;
        tree.regrowTimerTicks = 0;
        if (this.navGrid) {
          this.navGrid.setTileType(tree.tileX, tree.tileZ, NavTileType.FOREST);
        }
      }
    }

    if (buildingsMap && Array.isArray(sortedBuildingIds)) {
      for (let i = 0; i < sortedBuildingIds.length; i++) {
        const b = buildingsMap.get(sortedBuildingIds[i]);
        if (b && (b.doorOpenTicks | 0) > 0) {
          b.doorOpenTicks = (b.doorOpenTicks - 1) | 0;
        }
      }
    }

    if (gameState && enums) {
      const { AnimState } = enums;
      const wgCfg = getWorkerGatheringConfig();

      for (const comp of gameState.companies.values()) {
        if (!comp || comp.unitType !== 'worker') continue;
        if (comp.pendingGatherOrder) {
          const spec = comp.pendingGatherOrder;
          comp.pendingGatherOrder = null;
          this._activateGatherTaskForCompany(comp, spec, gameState);
        }
        if (comp.activeDropoffBuildingId > 0) {
          this._stepExplicitDropoffOrder(comp, buildingsMap, currentTick, gameState);
        }
      }

      const taskCids = Array.from(this.companyGatherTasks.keys()).sort((a, b) => a - b);

      for (let i = 0; i < taskCids.length; i++) {
        const cid = taskCids[i];
        const task = this.companyGatherTasks.get(cid);
        const comp = gameState.companies.get(cid);
        if (!comp || comp.memberIds.length === 0) {
          this.companyGatherTasks.delete(cid);
          continue;
        }

        task.carryCapacity = wgCfg.carryCapacity;

        if (task.state === GathererState.MOVING_TO_NODE) {
          if (task.resourceType === ResourceTypes.WOOD) {
            const tree = this.trees.get(task.targetNodeId);
            if (!tree || tree.state !== TreeState.GROWN || tree.woodRemaining <= 0) {
              const nextTree = this.findNearestGrownTree(
                task.nodeXFx,
                task.nodeZFx,
                160 * FX_ONE
              );
              if (!nextTree) {
                comp.isWorking = false;
                this.companyGatherTasks.delete(cid);
                if (comp.commandQueue.length > 0) {
                  comp.advanceCommandQueue(gameState.astar, this.navGrid, gameState.entities);
                } else {
                  comp.stopInPlace(this.navGrid, gameState.entities);
                }
                continue;
              }
              task.targetNodeId = nextTree.id;
              task.nodeXFx = nextTree.xFx;
              task.nodeZFx = nextTree.zFx;
              comp.lastHarvestedNode = {
                resourceType: ResourceTypes.WOOD,
                isMine: false,
                targetNodeId: nextTree.id,
                nodeXFx: nextTree.xFx,
                nodeZFx: nextTree.zFx
              };
              const savedAfterQueue = comp.commandQueue.slice();
              this._marchCompanyToPoint(
                comp,
                task.nodeXFx,
                task.nodeZFx,
                2 * FX_ONE,
                gameState
              );
              comp.commandQueue.push(...savedAfterQueue);
              continue;
            }
          } else {
            const mine = this.mines.get(task.targetNodeId);
            if (!mine) {
              const nextMine = this.findNearestMine(
                task.nodeXFx,
                task.nodeZFx,
                160 * FX_ONE,
                task.resourceType
              );
              if (!nextMine) {
                comp.isWorking = false;
                this.companyGatherTasks.delete(cid);
                if (comp.commandQueue.length > 0) {
                  comp.advanceCommandQueue(gameState.astar, this.navGrid, gameState.entities);
                } else {
                  comp.stopInPlace(this.navGrid, gameState.entities);
                }
                continue;
              }
              task.targetNodeId = nextMine.id;
              task.nodeXFx = nextMine.xFx;
              task.nodeZFx = nextMine.zFx;
              comp.lastHarvestedNode = {
                resourceType: nextMine.resourceType,
                isMine: true,
                targetNodeId: nextMine.id,
                nodeXFx: nextMine.xFx,
                nodeZFx: nextMine.zFx
              };
              const savedAfterQueue = comp.commandQueue.slice();
              this._marchCompanyToPoint(
                comp,
                task.nodeXFx,
                task.nodeZFx,
                5 * FX_ONE,
                gameState
              );
              comp.commandQueue.push(...savedAfterQueue);
              continue;
            }
          }

          let distToNodeFx = fxHypot(
            (comp.anchorXFx - task.nodeXFx) | 0,
            (comp.anchorZFx - task.nodeZFx) | 0
          );
          for (let m = 0; m < comp.memberIds.length; m++) {
            const wEnt = gameState.entities.get(comp.memberIds[m]);
            if (wEnt && wEnt.hp > 0) {
              const dMem = fxHypot((wEnt.x - task.nodeXFx) | 0, (wEnt.z - task.nodeZFx) | 0);
              if (dMem < distToNodeFx) distToNodeFx = dMem;
            }
          }

          const triggerDistFx = task.isMine ? 9 * FX_ONE : 7 * FX_ONE;
          if (distToNodeFx <= triggerDistFx) {
            const savedQueue = comp.commandQueue.slice();
            comp.stopInPlace(this.navGrid, gameState.entities, true);
            comp.commandQueue.push(...savedQueue);
            task.state = GathererState.HARVESTING;
            task.harvestProgressPermille = 0;
            this._assignCircularHarvestSlots(
              comp,
              task.nodeXFx,
              task.nodeZFx,
              task.isMine,
              gameState.entities
            );
          } else if (!comp.isActivelyMoving()) {
            const standOffFx = task.isMine ? 5 * FX_ONE : 2 * FX_ONE;
            const savedQueue = comp.commandQueue.slice();
            this._marchCompanyToPoint(
              comp,
              task.nodeXFx,
              task.nodeZFx,
              standOffFx,
              gameState
            );
            comp.commandQueue.push(...savedQueue);
          }
        } else if (task.state === GathererState.HARVESTING) {
          this._assignCircularHarvestSlots(
            comp,
            task.nodeXFx,
            task.nodeZFx,
            task.isMine,
            gameState.entities
          );

          let activeHarvesters = 0;
          for (let m = 0; m < comp.memberIds.length; m++) {
            const ent = gameState.entities.get(comp.memberIds[m]);
            if (ent && ent.hp > 0 && !ent.isMoving) {
              ent.dir = fxAtan2((task.nodeZFx - ent.z) | 0, (task.nodeXFx - ent.x) | 0);
              ent.desiredFacingDir = ent.dir;
              ent.animState = task.isMine ? (AnimState.MINE ?? AnimState.GATHER) : (AnimState.CHOP ?? AnimState.GATHER);
              activeHarvesters++;
            }
          }

          if (activeHarvesters === 0) continue;

          // Resource-specific harvest time (`harvestTimeSecByResource`: wood, stone, iron, coins)
          const resSec = wgCfg.harvestTimeSecByResource[task.resourceType] || 4.0;
          const batchesNeeded = Math.max(1, Math.ceil(wgCfg.carryCapacity / wgCfg.batchYield));
          const ticksPerBatch = Math.max(8, Math.round((resSec * 20) / batchesNeeded));
          const baseStepPermille = Math.max(4, Math.round(1000 / ticksPerBatch));

          const currentStamina = comp.staminaPermille ?? 1000;
          const staminaFactorPermille = (350 + mulDiv(650, currentStamina, 1000)) | 0;
          let stepPermille = mulDiv(baseStepPermille, staminaFactorPermille, 1000);
          if (currentStamina < WORKER_FATIGUE_THRESHOLD_PERMILLE) {
            stepPermille = mulDiv(stepPermille, 600, 1000);
          }
          task.harvestProgressPermille = (task.harvestProgressPermille + stepPermille) | 0;

          if (task.harvestProgressPermille >= 1000) {
            task.harvestProgressPermille = 0;
            const batchYield = wgCfg.batchYield;

            if (task.resourceType === ResourceTypes.WOOD) {
              const tree = this.trees.get(task.targetNodeId);
              if (!tree || tree.state !== TreeState.GROWN || tree.woodRemaining <= 0) {
                task.state = GathererState.MOVING_TO_NODE;
                comp.isWorking = false;
                continue;
              }
              const take = Math.min(
                batchYield,
                tree.woodRemaining | 0,
                (task.carryCapacity - task.carryAmount) | 0
              );
              tree.woodRemaining = (tree.woodRemaining - take) | 0;
              task.carryAmount = (task.carryAmount + take) | 0;

              if (tree.woodRemaining <= 0) {
                tree.woodRemaining = 0;
                tree.state = TreeState.STUMP;
                tree.regrowTimerTicks = this.treeRegrowTicks;
                if (this.navGrid) {
                  this.navGrid.setTileType(tree.tileX, tree.tileZ, NavTileType.PLAINS);
                }
              }
            } else {
              const take = Math.min(batchYield, (task.carryCapacity - task.carryAmount) | 0);
              task.carryAmount = (task.carryAmount + take) | 0;
            }

            if (task.carryAmount > 0) {
              comp.carriedResourceType = task.resourceType;
              comp.carriedResourceAmount = task.carryAmount;
              this._setCompanyCarryProps(
                comp,
                resourceTypeToCarryCode(task.resourceType),
                gameState.entities
              );
            }

            if (task.carryAmount >= task.carryCapacity) {
              comp.isWorking = false;

              const pendingBuildQ = gameState.constructionSystem?.workerBuildQueues?.get(cid);
              if (
                comp.commandQueue.length > 0 ||
                (pendingBuildQ && pendingBuildQ.length > 0)
              ) {
                this.companyGatherTasks.delete(cid);
                if (comp.commandQueue.length > 0 && (!pendingBuildQ || pendingBuildQ.length === 0)) {
                  comp.advanceCommandQueue(gameState.astar, this.navGrid, gameState.entities);
                }
                continue;
              }

              const dropoff = this._findNearestDropoffBuilding(
                task.team,
                comp.anchorXFx,
                comp.anchorZFx,
                buildingsMap,
                sortedBuildingIds
              );
              if (dropoff) {
                task.dropoffBuildingId = dropoff.id;
                task.state = GathererState.RETURNING_TO_BASE;
                task.doorStayTicks = 0;
                const doorPos = this._getBuildingDoorApproachWorldFx(dropoff, gameState, 1.15);
                this._marchCompanyToPoint(
                  comp,
                  doorPos.xFx,
                  doorPos.zFx,
                  0,
                  gameState
                );
              } else {
                this.addResource(task.team, task.resourceType, task.carryAmount);
                task.carryAmount = 0;
                this._setCompanyCarryProps(comp, CarryPropCode.NONE, gameState.entities);
              }
            }
          }
        } else if (
          task.state === GathererState.RETURNING_TO_BASE ||
          task.state === GathererState.ENTERING_DOOR
        ) {
          comp.carriedResourceType = task.resourceType;
          comp.carriedResourceAmount = task.carryAmount;
          this._setCompanyCarryProps(
            comp,
            resourceTypeToCarryCode(task.resourceType),
            gameState.entities
          );

          let dropoff = buildingsMap.get(task.dropoffBuildingId);
          if (!dropoff || !dropoff.isCompleted || dropoff.hp <= 0) {
            dropoff = this._findNearestDropoffBuilding(
              task.team,
              comp.anchorXFx,
              comp.anchorZFx,
              buildingsMap,
              sortedBuildingIds
            );
            if (!dropoff) {
              this.addResource(task.team, task.resourceType, task.carryAmount);
              task.carryAmount = 0;
              this._setCompanyCarryProps(comp, CarryPropCode.NONE, gameState.entities);
              task.state = GathererState.MOVING_TO_NODE;
              continue;
            }
            task.dropoffBuildingId = dropoff.id;
          }

          const doorPos = this._getBuildingDoorApproachWorldFx(dropoff, gameState, 1.0);
          const doorTriggerFx = 3 * FX_ONE + 512;

          let closestToDoorFx = fxHypot(
            (comp.anchorXFx - doorPos.xFx) | 0,
            (comp.anchorZFx - doorPos.zFx) | 0
          );
          for (let m = 0; m < comp.memberIds.length; m++) {
            const ent = gameState.entities.get(comp.memberIds[m]);
            if (ent && ent.hp > 0) {
              const dEnt = fxHypot((ent.x - doorPos.xFx) | 0, (ent.z - doorPos.zFx) | 0);
              if (dEnt < closestToDoorFx) {
                closestToDoorFx = dEnt;
              }
            }
          }

          if (closestToDoorFx <= doorTriggerFx || task.state === GathererState.ENTERING_DOOR) {
            task.state = GathererState.ENTERING_DOOR;
            comp.isWorking = true;
            task.doorStayTicks = ((task.doorStayTicks | 0) + 1) | 0;

            if (wgCfg.enterDoorOnDropoff && task.doorStayTicks <= wgCfg.doorInsideStayTicks) {
              this._funnelWorkersIntoBuildingDoor(comp, dropoff, gameState);
              continue;
            }

            task.doorStayTicks = 0;
            this._ejectWorkersFromBuildingDoor(comp, dropoff, gameState);
            comp.isWorking = false;

            const deliveredAmount = task.carryAmount | 0;
            this.addResource(task.team, task.resourceType, deliveredAmount);
            task.carryAmount = 0;
            this._setCompanyCarryProps(comp, CarryPropCode.NONE, gameState.entities);

            if (deliveredAmount > 0 && task.team === 1) {
              gameState.pendingEvents.push({
                tick: currentTick,
                kind: 'RESOURCE_DROPOFF',
                resourceType: task.resourceType,
                amount: deliveredAmount,
                xFx: dropoff.xFx,
                yFx: (dropoff.yFx + 4 * FX_ONE) | 0,
                zFx: dropoff.zFx,
                label: `+${deliveredAmount} ${task.resourceType.toUpperCase()}`
              });
            }

            const pendingBuildQ = gameState.constructionSystem?.workerBuildQueues?.get(cid);
            if ((pendingBuildQ && pendingBuildQ.length > 0) || comp.commandQueue.length > 0) {
              this.companyGatherTasks.delete(cid);
              if (!pendingBuildQ || pendingBuildQ.length === 0) {
                comp.advanceCommandQueue(gameState.astar, this.navGrid, gameState.entities);
              }
              continue;
            }

            task.state = GathererState.MOVING_TO_NODE;
            const standOffFx = task.isMine ? 5 * FX_ONE : 2 * FX_ONE;
            this._marchCompanyToPoint(
              comp,
              task.nodeXFx,
              task.nodeZFx,
              standOffFx,
              gameState
            );
          } else if (!comp.isActivelyMoving()) {
            const savedQueue = comp.commandQueue.slice();
            this._marchCompanyToPoint(
              comp,
              doorPos.xFx,
              doorPos.zFx,
              0,
              gameState
            );
            comp.commandQueue.push(...savedQueue);
          }
        }
      }
    }

    const isIncomeTick = (currentTick | 0) % this.passiveIntervalTicks === 0;

    for (let teamId = 1; teamId <= 2; teamId++) {
      const ledger = this.getTeamLedger(teamId);
      let popCap = (this.ecoConfig.basePopulationCap | 0) || 60;
      let passiveCoins = 0;

      if (buildingsMap && Array.isArray(sortedBuildingIds)) {
        for (let i = 0; i < sortedBuildingIds.length; i++) {
          const b = buildingsMap.get(sortedBuildingIds[i]);
          if (!b || b.team !== teamId || !b.isCompleted || b.hp <= 0) continue;
          const def = this.buildingDefs[b.type];
          if (!def) continue;

          if (def.popCapBonus) {
            popCap = (popCap + (def.popCapBonus | 0)) | 0;
          }
          if (isIncomeTick && def.passiveCoinsPerSec > 0) {
            passiveCoins = (passiveCoins + (def.passiveCoinsPerSec | 0)) | 0;
          }
        }
      }

      ledger.popCap = popCap;
      if (gameState) {
        const popInfo = this.computeTeamPopUsedAndReserved(gameState, teamId);
        ledger.popUsed = popInfo.aliveCount;
        ledger.reservedPop = popInfo.reservedDoorRemaining;
      }
      if (isIncomeTick && passiveCoins > 0) {
        ledger.coins = (ledger.coins + passiveCoins) | 0;
      }
    }
  }
};
