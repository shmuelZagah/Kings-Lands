/**
 * Kings Lands — Watchtower Garrison Entry & Exit System
 * (src/sim/systems/garrisonSystem.js)
 *
 * Supports:
 * - Sending companies to an uncompleted tower: they march to the tower doorway, wait until
 *   construction completes, and then automatically enter the tower!
 * - Shift-queued garrisoning (`queue = true`) and Double-Right-Click Run (`isRunning = true`).
 */

import { FX_ONE, fxAtan2, fxHypot } from '../../core/fx.js';
import { CompanyOrderType } from '../formations/company.js';

export class GarrisonSystem {
  constructor(constructionSystem) {
    this.cs = constructionSystem;
    this.pendingGarrisonOrders = new Map();
  }

  orderCompaniesToGarrison(
    companyIds,
    buildingId,
    team,
    gameState,
    queue = false,
    isRunning = false
  ) {
    const b = this.cs.buildings.get(buildingId | 0);
    if (!b || b.team !== (team | 0) || b.isDestroyed || b.hp <= 0) return false;
    if ((b.maxGarrison | 0) <= 0) return false;

    const doorVec = this.cs._getBuildingDoorVectorFx(b, b.footprintRadiusMeters + 1.5);
    const doorXFx = (b.xFx + doorVec.dxFx) | 0;
    const doorZFx = (b.zFx + doorVec.dzFx) | 0;

    let anyOrdered = false;
    for (let i = 0; i < companyIds.length; i++) {
      const cid = companyIds[i] | 0;
      const comp = gameState.companies.get(cid);
      if (!comp || comp.team !== (team | 0)) continue;
      if (comp.isCavalry || comp.unitType === 'siege' || comp.unitType === 'ballista') continue;
      if (comp.garrisonedBuildingId > 0) continue;

      let activeOrPendingForTower = b.garrisonCompanyIds.length;
      for (const [otherCid, order] of this.pendingGarrisonOrders.entries()) {
        if (
          otherCid !== cid &&
          order.buildingId === b.id &&
          !b.garrisonCompanyIds.includes(otherCid)
        ) {
          activeOrPendingForTower++;
        }
      }
      if (activeOrPendingForTower >= b.maxGarrison) break;

      const interruptedPatrol = comp.clearPatrolIfActive?.() || false;
      const effectiveQueue = Boolean(queue) && !interruptedPatrol;

      if (comp.unitType === 'worker' && !effectiveQueue) {
        this.cs.economySystem.cancelGatheringForCompanies(
          [cid],
          gameState.entities,
          gameState.companies
        );
        this.cs.workerBuildQueues.delete(cid);
        comp.activeBuildTargetId = 0;
      }

      this.pendingGarrisonOrders.set(cid, {
        buildingId: b.id,
        enteringDoor: false,
        tickTimer: 0
      });

      this.cs.movementSystem.issueArmyDragOrder(
        [comp],
        gameState.entities,
        { xFx: doorXFx, zFx: doorZFx },
        { xFx: doorXFx, zFx: doorZFx },
        CompanyOrderType.MOVE,
        gameState.tick,
        { queue: effectiveQueue, isRunning: Boolean(isRunning), gameState }
      );

      if (isRunning && comp.canStartRunning()) {
        comp.wantsToRun = true;
        if (comp.isActivelyMoving()) {
          comp.isRunning = true;
        }
      }

      anyOrdered = true;
    }
    return anyOrdered;
  }

  ungarrisonBuilding(buildingId, team, gameState, targetCompanyId = null) {
    const b = this.cs.buildings.get(buildingId | 0);
    if (
      !b ||
      b.team !== (team | 0) ||
      !Array.isArray(b.garrisonCompanyIds) ||
      b.garrisonCompanyIds.length === 0
    ) {
      return false;
    }

    const cidsToEject =
      targetCompanyId !== null && targetCompanyId !== undefined
        ? b.garrisonCompanyIds.filter((id) => id === (targetCompanyId | 0))
        : b.garrisonCompanyIds.slice();

    if (cidsToEject.length === 0) return false;

    const doorRadiusMeters = (Number(b.footprintRadiusMeters) || 5) * (b.type === 'watchtower' ? 0.68 : 0.78);
    const doorVec = this.cs._getBuildingDoorVectorFx(b, doorRadiusMeters);
    const doorXFx = (b.xFx + doorVec.dxFx) | 0;
    const doorZFx = (b.zFx + doorVec.dzFx) | 0;
    const outVec = this.cs._getBuildingDoorVectorFx(b, b.footprintRadiusMeters + 9);

    for (let i = 0; i < cidsToEject.length; i++) {
      const cid = cidsToEject[i];
      b.garrisonCompanyIds = b.garrisonCompanyIds.filter((id) => id !== cid);
      this.pendingGarrisonOrders.delete(cid);

      const comp = gameState.companies.get(cid);
      if (!comp) continue;

      comp.garrisonedBuildingId = -1;
      comp.isWorking = false;

      const defaultOutXFx = (b.xFx + outVec.dxFx + (i === 0 ? -2 : 2) * FX_ONE) | 0;
      const defaultOutZFx = (b.zFx + outVec.dzFx) | 0;
      const destXFx = b.hasCustomRallyPoint ? b.rallyXFx : defaultOutXFx;
      const destZFx = b.hasCustomRallyPoint ? b.rallyZFx : defaultOutZFx;

      const walkable = this.cs.navGrid.findNearestWalkableTile(
        this.cs.navGrid.worldFxToTileX(destXFx),
        this.cs.navGrid.worldFxToTileZ(destZFx),
        16
      );
      const musterXFx = this.cs.navGrid.tileToWorldCenterFxX(walkable.tx);
      const musterZFx = this.cs.navGrid.tileToWorldCenterFxZ(walkable.tz);

      comp.anchorXFx = musterXFx;
      comp.anchorZFx = musterZFx;
      comp.targetXFx = musterXFx;
      comp.targetZFx = musterZFx;
      comp.facingDir = doorVec.dir;
      comp.desiredFacingDir = comp.facingDir;
      comp.updateSlotTargets(this.cs.navGrid, gameState.entities);

      const hiddenMemberIds = [];
      for (let m = 0; m < comp.memberIds.length; m++) {
        const ent = gameState.entities.get(comp.memberIds[m]);
        if (ent && ent.hp > 0) {
          if (ent.isGarrisoned) {
            hiddenMemberIds.push(ent.id);
          } else {
            ent.targetX = ent.slotTargetXFx;
            ent.targetZ = ent.slotTargetZFx;
            ent.isMoving = true;
          }
        }
      }

      if (!Array.isArray(b.activeGarrisonExits)) {
        b.activeGarrisonExits = [];
      }
      b.activeGarrisonExits.push({
        companyId: cid,
        remainingMemberIds: hiddenMemberIds,
        tickTimer: 0,
        spawnIntervalTicks: 4,
        doorXFx,
        doorZFx,
        destXFx: musterXFx,
        destZFx: musterZFx
      });
    }

    return true;
  }

  stepBuildingGarrisonExits(gameState, building, AnimState) {
    if (!Array.isArray(building.activeGarrisonExits) || building.activeGarrisonExits.length === 0) {
      return;
    }

    for (let s = building.activeGarrisonExits.length - 1; s >= 0; s--) {
      const stream = building.activeGarrisonExits[s];
      const comp = gameState.companies.get(stream.companyId);
      if (!comp || stream.remainingMemberIds.length === 0) {
        building.activeGarrisonExits.splice(s, 1);
        continue;
      }

      stream.tickTimer = (stream.tickTimer - 1) | 0;
      if (stream.tickTimer <= 0) {
        stream.tickTimer = stream.spawnIntervalTicks;
        const nextEntId = stream.remainingMemberIds.shift();
        const ent = gameState.entities.get(nextEntId);
        if (ent && ent.hp > 0) {
          ent.isGarrisoned = false;
          ent.x = stream.doorXFx;
          ent.z = stream.doorZFx;
          ent.y = this.cs.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
          ent.doorExitBuildingId = building.id;
          ent.doorExitTicks = 18;
          ent.targetX = ent.slotTargetXFx;
          ent.targetZ = ent.slotTargetZFx;
          ent.isMoving = true;
          ent.animState = AnimState.WALK;
          building.doorOpenTicks = Math.max(building.doorOpenTicks | 0, 18);
        }
      }

      if (stream.remainingMemberIds.length === 0) {
        building.activeGarrisonExits.splice(s, 1);
        this.cs.productionSystem.executeSmartRallyActionForCompany(gameState, building, comp);
      }
    }
  }

  processPendingGarrisonOrders(gameState) {
    if (this.pendingGarrisonOrders.size === 0) return;

    for (const [cid, order] of Array.from(this.pendingGarrisonOrders.entries())) {
      const comp = gameState.companies.get(cid);
      const b = this.cs.buildings.get(order.buildingId);
      if (
        !comp ||
        comp.memberIds.length === 0 ||
        !b ||
        b.isDestroyed ||
        b.hp <= 0 ||
        (b.maxGarrison | 0) <= 0
      ) {
        if (comp) comp.isWorking = false;
        this.pendingGarrisonOrders.delete(cid);
        continue;
      }

      if (!order.enteringDoor && comp.commandQueue.length > 0) {
        continue;
      }

      // If the tower is still under construction, let the company march to the door and wait!
      if (!b.isCompleted) {
        continue;
      }

      const isAlreadyRegistered = b.garrisonCompanyIds.includes(cid);
      if (!isAlreadyRegistered && b.garrisonCompanyIds.length >= b.maxGarrison) {
        comp.isWorking = false;
        this.pendingGarrisonOrders.delete(cid);
        continue;
      }

      const doorVec = this.cs._getBuildingDoorVectorFx(b, b.footprintRadiusMeters + 1.0);
      const doorXFx = (b.xFx + doorVec.dxFx) | 0;
      const doorZFx = (b.zFx + doorVec.dzFx) | 0;

      const distAnchorToDoorFx = fxHypot(
        (comp.anchorXFx - doorXFx) | 0,
        (comp.anchorZFx - doorZFx) | 0
      );
      const startStreamRadiusFx = Math.round((b.footprintRadiusMeters + 6.5) * FX_ONE) | 0;

      if (distAnchorToDoorFx <= startStreamRadiusFx || order.enteringDoor) {
        order.enteringDoor = true;
        if (!isAlreadyRegistered) {
          b.garrisonCompanyIds.push(cid);
        }

        comp.orderType = CompanyOrderType.IDLE;
        comp.pathWaypoints = null;
        comp.wantsToRun = false;
        comp.isRunning = false;
        comp.isWorking = true;

        let remainingOutside = 0;
        let closestEnt = null;
        let closestDistFx = 0x7fffffff;

        for (let m = 0; m < comp.memberIds.length; m++) {
          const ent = gameState.entities.get(comp.memberIds[m]);
          if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;

          remainingOutside++;
          ent.slotTargetXFx = doorXFx;
          ent.slotTargetZFx = doorZFx;
          ent.targetX = doorXFx;
          ent.targetZ = doorZFx;
          ent.desiredFacingDir = fxAtan2((b.zFx - ent.z) | 0, (b.xFx - ent.x) | 0);
          ent.isMoving = true;

          const dDoor = fxHypot((ent.x - doorXFx) | 0, (ent.z - doorZFx) | 0);
          if (dDoor < closestDistFx) {
            closestDistFx = dDoor;
            closestEnt = ent;
          }
        }

        order.tickTimer = (order.tickTimer - 1) | 0;
        if (closestEnt && closestDistFx <= 3 * FX_ONE && order.tickTimer <= 0) {
          order.tickTimer = 4;
          closestEnt.isGarrisoned = true;
          closestEnt.isMoving = false;
          remainingOutside--;
        }

        if (remainingOutside <= 0) {
          comp.garrisonedBuildingId = b.id;
          comp.isWorking = false;
          this.pendingGarrisonOrders.delete(cid);
        }
      }
    }
  }
}
