import { resolveUnitActiveCapabilities } from '../combatCapabilitiesRegistry.js';
import unitStatsData from '../../data/unitStats.json';
import {
  FX_ONE,
  ANGLE_MASK,
  mulDiv,
  fxAbs,
  fxSin,
  fxCos,
  fxClamp,
  fxAtan2,
  fxHypot
} from '../../core/fx.js';
import {
  FormationTypes,
  sanitizeFormationForUnit,
  computeFormationLocalSlotsFx,
  transformLocalSlotToWorldFx,
  measureChokepointCorridorFx
} from './formations.js';

export const PATROL_LOOP_SNAP_RADIUS_FX = 12 * FX_ONE;
export const RUN_STAMINA_THRESHOLD_PERMILLE = 700;
export const WORKER_FATIGUE_THRESHOLD_PERMILLE = 300;

/**
 * Hooks the movement system fills in every tick, so formation slots can respect things the company does not know about.
 * clampOutsideBuildings(xFx, zFx, marginFx) -> {xFx, zFx}: pushes a point out of every building's no-walk ring.
 */
export const SlotConstraints = { clampOutsideBuildings: null };

export const CompanyOrderType = Object.freeze({
  IDLE: 0,
  MOVE: 1,
  PATROL: 2,
  ATTACK_MOVE: 3,
  HOLD: 4,
  ROUTING: 5,
  RAMPAGE: 6
});

export const CompanyRole = Object.freeze({
  FRONT_MELEE: 'front_melee',
  RANGED_BACK: 'ranged_back',
  FLANK_CAVALRY: 'flank_cavalry',
  SIEGE_REAR: 'siege_rear',
  HERO_CENTER: 'hero_center'
});

export function resolveCompanyRole(unitType) {
  if (unitType === 'cavalry') return CompanyRole.FLANK_CAVALRY;
  if (unitType === 'archer' || unitType === 'worker') return CompanyRole.RANGED_BACK;
  if (unitType === 'siege' || unitType === 'ballista') return CompanyRole.SIEGE_REAR;
  if (unitType === 'hero') return CompanyRole.HERO_CENTER;
  return CompanyRole.FRONT_MELEE;
}

/**
 * All newly recruited/spawned companies (including Cavalry) default to SQUARE (Box) formation.
 */
export function resolveDefaultFormation(_unitType) {
  return FormationTypes.SQUARE;
}

export class Company {
  constructor({
    id,
    name,
    team,
    unitType,
    unitTypeIdx,
    spawnXFx,
    spawnZFx,
    facingDir = 256,
    speedFx = 210,
    formation = null,
    maxMemberCount = 0,
    breakBehavior = 'RETREAT',
    moraleLossMultiplierPermille = 1000
  }) {
    this.id = id | 0;
    this.name = name || `Company #${id}`;
    this.team = team | 0;
    this.unitType = unitType || 'swordsman';
    this.unitTypeIdx = unitTypeIdx | 0;
    this.activeLoadoutIdx = 0;
    const initCaps = resolveUnitActiveCapabilities(this.unitType, 0, unitStatsData);
    this.hasSecondaryLoadout = Boolean(initCaps.hasSecondaryLoadout);
    this.activeWeaponMode = initCaps.isRangedLoadout ? 'ranged' : 'melee';
    this.isCavalry = Boolean(initCaps.isMounted || this.unitType === 'cavalry');
    this.roleCategory = resolveCompanyRole(this.unitType);
    this.formation = sanitizeFormationForUnit(
      this.unitType,
      formation || resolveDefaultFormation(this.unitType),
      this.activeLoadoutIdx,
      initCaps.allowedFormations
    );

    this.anchorXFx = spawnXFx | 0;
    this.anchorZFx = spawnZFx | 0;
    this.targetXFx = spawnXFx | 0;
    this.targetZFx = spawnZFx | 0;

    this.facingDir = (facingDir | 0) & ANGLE_MASK;
    this.desiredFacingDir = this.facingDir;
    this.customWidthFx = 0;
    this.squeezePermille = 1000;
    this.speedFx = speedFx | 0;
    this.activeGroupSpeedFx = 0;
    this.altGroupId = 0;
    this.altGroupCompanyIds = null;

    this.wantsToRun = false;
    this.isRunning = false;
    this._wasMovingForRunReset = false;
    this.staminaPermille = 1000;

    // Phase 6 Morale, Stance, Ammo & Reinforcement State
    this.moralePermille = 1000;
    this.maxMoralePermille = 1000;
    this.isBroken = false;
    this.breakBehavior = breakBehavior || 'RETREAT';
    this.moraleLossMultiplierPermille = (moraleLossMultiplierPermille | 0) || 1000;
    this.maxMemberCount =
      (maxMemberCount | 0) || (this.unitType === 'worker' || this.unitType === 'ballista' ? 3 : this.isCavalry ? 16 : 20);
    this.lastKnownAliveCount = this.maxMemberCount;
    this.ticksSinceLastCombat = 999;
    this.reinforceTickTimer = 0;
    this.hasBannerBuff = false;
    this.isHealing = false;
    this.ammoType = 'STANDARD';
    this.fireAtWill = true;
    this.stanceTransitionTicks = 0;
    this.chargeRunDistFx = 0;
    this.chargeMomentumPermille = 0;

    this.isWorking = false;
    this.activeBuildTargetId = 0;
    this.activeDropoffBuildingId = 0;
    this.pendingGatherOrder = null;
    this.carriedResourceType = null;
    this.carriedResourceAmount = 0;
    this.lastHarvestedNode = null;
    this.garrisonedBuildingId = -1;

    this.isSpearWallLocked =
      this.formation === FormationTypes.SPEAR_WALL ||
      this.formation === FormationTypes.SHIELD_WALL ||
      this.formation === FormationTypes.PIKE_PHALANX;

    this.orderType = CompanyOrderType.IDLE;
    this.pathWaypoints = null;
    this.pathIndex = 0;

    this.commandQueue = [];
    this.patrolWaypoints = [];
    this.patrolWaypointIndex = 0;
    this.patrolDirection = 1;
    this.patrolClosedLoop = false;

    this.engagedTargetEntityId = -1;
    this.engagedTargetBuildingId = -1;
    this.targetEnemyCompanyId = -1;
    this.targetEnemyBuildingId = -1;
    this.interceptedTicks = 0;
    this.memberIds = [];
    this.frontRowCount = 0;
    this.lastLocalSlots = [];
  }

  isActivelyMoving() {
    return (
      this.orderType === CompanyOrderType.MOVE ||
      this.orderType === CompanyOrderType.PATROL ||
      this.orderType === CompanyOrderType.ATTACK_MOVE ||
      this.orderType === CompanyOrderType.ROUTING ||
      this.orderType === CompanyOrderType.RAMPAGE
    );
  }

  canStartRunning() {
    return (
      this.formation !== FormationTypes.SPEAR_WALL &&
      this.formation !== FormationTypes.SHIELD_WALL &&
      this.formation !== FormationTypes.PIKE_PHALANX &&
      !this.isSpearWallLocked &&
      (this.staminaPermille | 0) > 0
    );
  }

  clearPatrolIfActive() {
    const hasActiveOrQueuedPatrol =
      this.orderType === CompanyOrderType.PATROL ||
      this.commandQueue.some((q) => q.orderType === CompanyOrderType.PATROL);
    if (!hasActiveOrQueuedPatrol) return false;

    this.commandQueue.length = 0;
    this.patrolWaypoints.length = 0;
    this.patrolWaypointIndex = 0;
    this.patrolDirection = 1;
    this.patrolClosedLoop = false;
    if (this.orderType === CompanyOrderType.PATROL) {
      this.orderType = CompanyOrderType.IDLE;
      this.pathWaypoints = null;
      this.pathIndex = 0;
      this.activeGroupSpeedFx = 0;
    }
    return true;
  }

  syncCasualtiesAndPromoteRear(entitiesMap) {
    const oldFrontCount = this.frontRowCount | 0;
    const aliveIds = [];
    const deadSlotIndices = [];

    for (let i = 0; i < this.memberIds.length; i++) {
      const id = this.memberIds[i];
      const ent = entitiesMap.get(id);
      if (ent && ent.hp > 0) {
        aliveIds.push(id);
      } else {
        deadSlotIndices.push(i);
      }
    }

    if (aliveIds.length === 0) {
      this.memberIds.length = 0;
      return;
    }

    if (deadSlotIndices.length > 0 && oldFrontCount > 0) {
      const updated = this.memberIds.slice();
      for (let d = 0; d < deadSlotIndices.length; d++) {
        const deadIdx = deadSlotIndices[d];
        if (deadIdx < oldFrontCount) {
          for (let rearIdx = updated.length - 1; rearIdx > deadIdx; rearIdx--) {
            const rearEnt = entitiesMap.get(updated[rearIdx]);
            if (rearEnt && rearEnt.hp > 0) {
              updated[deadIdx] = updated[rearIdx];
              updated[rearIdx] = -1;
              break;
            }
          }
        }
      }
      this.memberIds = updated.filter((id) => {
        if (id < 0) return false;
        const ent = entitiesMap.get(id);
        return Boolean(ent && ent.hp > 0);
      });
    } else {
      this.memberIds = aliveIds;
    }

    const noBanner = this.unitType === 'worker' || this.unitType === 'hero' || Boolean(this.isHero);
    let hasBanner = false;
    for (let i = 0; i < this.memberIds.length; i++) {
      const ent = entitiesMap.get(this.memberIds[i]);
      if (!ent) continue;
      if (noBanner || ent.isHero) {
        ent.role = 0;
      } else if (i === 0) {
        ent.role = 1;
        hasBanner = true;
      } else if (ent.role === 1 && hasBanner) {
        ent.role = 0;
      }
    }
  }

  getActiveCapabilities() {
    return resolveUnitActiveCapabilities(this.unitType, this.activeLoadoutIdx | 0, unitStatsData);
  }

  getAllowedFormations() {
    return this.getActiveCapabilities().allowedFormations || [FormationTypes.SQUARE];
  }

  getSecondaryFormation() {
    return this.getActiveCapabilities().secondaryFormation || null;
  }

  getAllowedModes() {
    return this.getActiveCapabilities().allowedModes || [];
  }

  canFireAtWill() {
    if (this.activeWeaponMode && this.activeWeaponMode !== 'ranged') return false;
    return Boolean(this.getActiveCapabilities().canFireAtWill);
  }

  switchWeaponSet(navGrid, entitiesMap, movementSystem = null) {
    const caps0 = resolveUnitActiveCapabilities(this.unitType, 0, unitStatsData);
    if (!caps0.hasSecondaryLoadout) return false;
    this.activeLoadoutIdx = this.activeLoadoutIdx === 1 ? 0 : 1;
    const nextCaps = this.getActiveCapabilities();
    this.hasSecondaryLoadout = Boolean(nextCaps.hasSecondaryLoadout);
    this.activeWeaponMode = nextCaps.isRangedLoadout ? 'ranged' : 'melee';
    if (!nextCaps.allowedFormations.includes(this.formation)) {
      this.setFormation(FormationTypes.SQUARE, navGrid, entitiesMap);
    }
    if (entitiesMap) {
      for (let i = 0; i < this.memberIds.length; i++) {
        const ent = entitiesMap.get(this.memberIds[i]);
        if (ent && ent.hp > 0) {
          ent.activeLoadoutIdx = this.activeLoadoutIdx;
          ent.isRanged = Boolean(nextCaps.isRangedLoadout);
          if (movementSystem) {
            const prof = movementSystem.getPhysicsProfile(ent.unitTypeIdx, this.unitType, this.activeLoadoutIdx);
            ent.attackRangeFx = prof.attackRangeFx;
            if (nextCaps.isRangedLoadout && (ent.maxAmmo | 0) <= 0) {
              ent.maxAmmo = Math.max(24, prof.maxAmmo || 30);
              ent.ammo = ent.maxAmmo;
            }
          }
        }
      }
    }
    return true;
  }

  setFormation(requestedFormation, navGrid, entitiesMap) {
    if (this.isBroken) return;
    const validFormation = sanitizeFormationForUnit(
      this.unitType,
      requestedFormation,
      this.activeLoadoutIdx | 0,
      this.getAllowedFormations()
    );
    this.formation = validFormation;
    this.customWidthFx = 0;

    if (validFormation === FormationTypes.PIKE_PHALANX) {
      this.stanceTransitionTicks = 40;
    } else {
      this.stanceTransitionTicks = 0;
    }

    if (
      validFormation === FormationTypes.SPEAR_WALL ||
      validFormation === FormationTypes.SHIELD_WALL ||
      validFormation === FormationTypes.PIKE_PHALANX
    ) {
      this.isSpearWallLocked = true;
      this.wantsToRun = false;
      this.isRunning = false;
      this.stopInPlace(navGrid, entitiesMap);
    } else {
      this.isSpearWallLocked = false;
      this.updateSlotTargets(navGrid, entitiesMap);
    }
  }

  _evaluatePatrolLoopClosure() {
    this.patrolClosedLoop = false;
    const len = this.patrolWaypoints.length;
    if (len < 3) return;

    const originPt = this.patrolWaypoints[0];
    const lastPt = this.patrolWaypoints[len - 1];
    const distToOriginFx = fxHypot(
      (lastPt.xFx | 0) - (originPt.xFx | 0),
      (lastPt.zFx | 0) - (originPt.zFx | 0)
    );

    if (distToOriginFx <= PATROL_LOOP_SNAP_RADIUS_FX) {
      this.patrolClosedLoop = true;
      if (len >= 4) {
        this.patrolWaypoints.pop();
      }
    }
  }

  enqueueOrSetOrder(orderDescriptor, appendQueue, astar, navGrid, entitiesMap) {
    if (
      this.isBroken &&
      orderDescriptor.orderType !== CompanyOrderType.ROUTING &&
      orderDescriptor.orderType !== CompanyOrderType.RAMPAGE
    ) {
      return;
    }

    const preservedWidthFx =
      orderDescriptor.customWidthFx && orderDescriptor.customWidthFx > 0
        ? orderDescriptor.customWidthFx | 0
        : this.customWidthFx;

    const incomingPatrolPts =
      Array.isArray(orderDescriptor.patrolWaypoints) && orderDescriptor.patrolWaypoints.length > 0
        ? orderDescriptor.patrolWaypoints.map((pt) => ({
            xFx: pt.xFx | 0,
            zFx: pt.zFx | 0,
            facingDir: (pt.facingDir ?? orderDescriptor.facingDir ?? this.facingDir) & ANGLE_MASK
          }))
        : null;

    const allowRun =
      this.formation !== FormationTypes.SPEAR_WALL &&
      this.formation !== FormationTypes.SHIELD_WALL &&
      this.formation !== FormationTypes.PIKE_PHALANX &&
      Boolean(orderDescriptor.isRunning);

    const normalizedOrder = {
      orderType: orderDescriptor.orderType,
      targetXFx: orderDescriptor.targetXFx | 0,
      targetZFx: orderDescriptor.targetZFx | 0,
      facingDir: (orderDescriptor.facingDir | 0) & ANGLE_MASK,
      customWidthFx: preservedWidthFx,
      isDragGesture: Boolean(orderDescriptor.isDragGesture),
      isRunning: allowRun,
      groupSpeedFx: (orderDescriptor.groupSpeedFx | 0) || 0,
      altGroupId: (orderDescriptor.altGroupId | 0) || 0,
      altGroupCompanyIds: Array.isArray(orderDescriptor.altGroupCompanyIds)
        ? orderDescriptor.altGroupCompanyIds.slice()
        : null,
      patrolWaypoints: incomingPatrolPts,
      dropoffBuildingId: orderDescriptor.dropoffBuildingId | 0,
      gatherNodeTask: orderDescriptor.gatherNodeTask || null,
      targetEnemyCompanyId:
        orderDescriptor.targetEnemyCompanyId !== undefined
          ? orderDescriptor.targetEnemyCompanyId | 0
          : -1,
      targetEnemyBuildingId:
        orderDescriptor.targetEnemyBuildingId !== undefined
          ? orderDescriptor.targetEnemyBuildingId | 0
          : -1
    };

    if (normalizedOrder.orderType !== CompanyOrderType.PATROL && this.clearPatrolIfActive()) {
      this._activateOrderDescriptor(normalizedOrder, astar, navGrid, entitiesMap);
      return;
    }

    const isBusyWithTask =
      this.isActivelyMoving() ||
      this.isWorking ||
      this.activeBuildTargetId > 0 ||
      this.activeDropoffBuildingId > 0 ||
      Boolean(orderDescriptor.forceQueue);

    if (appendQueue && isBusyWithTask) {
      if (normalizedOrder.isRunning && this.canStartRunning()) {
        this.wantsToRun = true;
        if (this.isActivelyMoving() && !this.isWorking) {
          this.isRunning = true;
        }
      }

      if (normalizedOrder.orderType === CompanyOrderType.PATROL) {
        if (this.commandQueue.length > 0) {
          const lastQueued = this.commandQueue[this.commandQueue.length - 1];
          if (lastQueued.orderType === CompanyOrderType.PATROL) {
            if (!Array.isArray(lastQueued.patrolWaypoints)) {
              lastQueued.patrolWaypoints = [
                {
                  xFx: lastQueued.targetXFx,
                  zFx: lastQueued.targetZFx,
                  facingDir: lastQueued.facingDir
                }
              ];
            }
            if (incomingPatrolPts) {
              lastQueued.patrolWaypoints.push(...incomingPatrolPts);
            } else {
              lastQueued.patrolWaypoints.push({
                xFx: normalizedOrder.targetXFx,
                zFx: normalizedOrder.targetZFx,
                facingDir: normalizedOrder.facingDir
              });
            }
            return;
          }
        } else if (this.orderType === CompanyOrderType.PATROL && this.patrolWaypoints.length > 0) {
          if (incomingPatrolPts) {
            this.patrolWaypoints.push(...incomingPatrolPts);
          } else {
            this.patrolWaypoints.push({
              xFx: normalizedOrder.targetXFx,
              zFx: normalizedOrder.targetZFx,
              facingDir: normalizedOrder.facingDir
            });
          }
          this._evaluatePatrolLoopClosure();
          return;
        }
      }

      this.commandQueue.push(normalizedOrder);
      return;
    }

    this.commandQueue.length = 0;
    this._activateOrderDescriptor(normalizedOrder, astar, navGrid, entitiesMap);
  }

  advanceCommandQueue(astar, navGrid, entitiesMap) {
    if (this.isBroken || this.commandQueue.length === 0) return false;
    const nextOrder = this.commandQueue.shift();
    this._activateOrderDescriptor(nextOrder, astar, navGrid, entitiesMap, true);
    return true;
  }

  _activateOrderDescriptor(
    orderDescriptor,
    astar,
    navGrid,
    entitiesMap,
    fromQueueTransition = false
  ) {
    this.isWorking = false;
    this._mountedAutoOrder = false;
    this._mountedPassState = null;
    this._lockedCycleVictimId = -1;
    this.moveBlockedTicks = 0;
    this.isExplicitGroundMove = Boolean(
      orderDescriptor.orderType === CompanyOrderType.MOVE &&
        (orderDescriptor.targetEnemyCompanyId ?? -1) < 0 &&
        (orderDescriptor.targetEnemyBuildingId ?? -1) <= 0
    );
    this.activeDropoffBuildingId = orderDescriptor.dropoffBuildingId | 0;
    this.pendingGatherOrder = orderDescriptor.gatherNodeTask || null;
    this.activeGroupSpeedFx = (orderDescriptor.groupSpeedFx | 0) || 0;
    this.altGroupId = (orderDescriptor.altGroupId | 0) || 0;
    this.altGroupCompanyIds = Array.isArray(orderDescriptor.altGroupCompanyIds)
      ? orderDescriptor.altGroupCompanyIds.slice()
      : null;

    if (orderDescriptor.customWidthFx && orderDescriptor.customWidthFx > 0) {
      this.customWidthFx = orderDescriptor.customWidthFx | 0;
    }
    this.isDragFormationOrder = Boolean(orderDescriptor.isDragGesture);
    this.desiredFacingDir = (orderDescriptor.facingDir | 0) & ANGLE_MASK;
    this.targetXFx = orderDescriptor.targetXFx | 0;
    this.targetZFx = orderDescriptor.targetZFx | 0;
    this.orderType = orderDescriptor.orderType;
    if (this.isActivelyMoving()) {
      this._wasMovingForRunReset = true;
    }
    if (this.isDragFormationOrder) {
      this.facingDir = this.desiredFacingDir;
    }

    if (
      SlotConstraints.clampOutsideBuildings &&
      (this.orderType === CompanyOrderType.MOVE || this.orderType === CompanyOrderType.ATTACK_MOVE) &&
      !(orderDescriptor.dropoffBuildingId | 0) &&
      !orderDescriptor.gatherNodeTask
    ) {
      const c = SlotConstraints.clampOutsideBuildings(this.targetXFx, this.targetZFx, 1700);
      this.targetXFx = c.xFx;
      this.targetZFx = c.zFx;
    }

    if (
      this.formation === FormationTypes.SPEAR_WALL ||
      this.formation === FormationTypes.SHIELD_WALL ||
      this.formation === FormationTypes.PIKE_PHALANX
    ) {
      this.isSpearWallLocked = false;
      this.wantsToRun = false;
      this.isRunning = false;
    } else {
      if (fromQueueTransition) {
        this.wantsToRun = Boolean(this.wantsToRun || orderDescriptor.isRunning);
      } else {
        this.wantsToRun = Boolean(orderDescriptor.isRunning);
      }
      this.isRunning = this.wantsToRun && (this.staminaPermille | 0) > 0;
    }

    this.engagedTargetEntityId = -1;
    this.engagedTargetBuildingId = -1;
    this.targetEnemyCompanyId =
      orderDescriptor.targetEnemyCompanyId !== undefined &&
      orderDescriptor.targetEnemyCompanyId !== null
        ? orderDescriptor.targetEnemyCompanyId | 0
        : -1;
    this.targetEnemyBuildingId =
      orderDescriptor.targetEnemyBuildingId !== undefined &&
      orderDescriptor.targetEnemyBuildingId !== null
        ? orderDescriptor.targetEnemyBuildingId | 0
        : -1;
    this.interceptedTicks = 0;

    if (this.orderType === CompanyOrderType.PATROL) {
      const originXFx = this.anchorXFx | 0;
      const originZFx = this.anchorZFx | 0;
      this.patrolDirection = 1;
      this.patrolClosedLoop = false;

      if (Array.isArray(orderDescriptor.patrolWaypoints) && orderDescriptor.patrolWaypoints.length > 0) {
        const firstLeg = orderDescriptor.patrolWaypoints[0];
        const firstDir = fxAtan2(firstLeg.zFx - originZFx, firstLeg.xFx - originXFx);
        this.patrolWaypoints = [
          {
            xFx: originXFx,
            zFx: originZFx,
            facingDir: (firstDir + 512) & ANGLE_MASK
          },
          ...orderDescriptor.patrolWaypoints.map((pt) => ({
            xFx: pt.xFx | 0,
            zFx: pt.zFx | 0,
            facingDir: (pt.facingDir ?? firstDir) & ANGLE_MASK
          }))
        ];
        this._evaluatePatrolLoopClosure();
        this.patrolWaypointIndex = 1;
        this.targetXFx = this.patrolWaypoints[1].xFx;
        this.targetZFx = this.patrolWaypoints[1].zFx;
        this.desiredFacingDir = firstDir;
      } else {
        const legDir = fxAtan2(this.targetZFx - originZFx, this.targetXFx - originXFx);
        this.patrolWaypoints = [
          { xFx: originXFx, zFx: originZFx, facingDir: (legDir + 512) & ANGLE_MASK },
          { xFx: this.targetXFx, zFx: this.targetZFx, facingDir: legDir }
        ];
        this.patrolWaypointIndex = 1;
        this.desiredFacingDir = legDir;
      }
    } else {
      this.patrolWaypoints.length = 0;
      this.patrolWaypointIndex = 0;
      this.patrolDirection = 1;
      this.patrolClosedLoop = false;
    }

    this.pathWaypoints = astar.findPath(
      this.anchorXFx,
      this.anchorZFx,
      this.targetXFx,
      this.targetZFx,
      { isCavalry: this.isCavalry }
    );
    this.fullRouteWaypoints = this.pathWaypoints ? this.pathWaypoints.slice() : null;
    this.pathIndex = 0;

    for (let m = 0; m < this.memberIds.length; m++) {
      const ent = entitiesMap.get(this.memberIds[m]);
      if (ent) {
        ent.pathWaypoints = null;
        ent.pathIndex = 0;
        ent.settled = 0;
        ent.waitTicks = 0;
        ent.stuckTicks = 0;
        ent.isMoving = true;
      }
    }

    const orderMoveDistFx = fxHypot(
      (this.targetXFx - this.anchorXFx) | 0,
      (this.targetZFx - this.anchorZFx) | 0
    );
    if (orderMoveDistFx <= 10 * FX_ONE) {
      this.facingDir = this.desiredFacingDir;
    }
    this._forceNearestSlotMatch = true;
    this.updateSlotTargets(navGrid, entitiesMap);
  }

  advancePatrolWaypoint() {
    const len = this.patrolWaypoints.length;
    if (len < 2) return null;

    if (this.patrolClosedLoop) {
      this.patrolWaypointIndex = ((this.patrolWaypointIndex + 1) % len) | 0;
    } else {
      const lastIdx = (len - 1) | 0;
      if (this.patrolDirection > 0) {
        if (this.patrolWaypointIndex >= lastIdx) {
          this.patrolDirection = -1;
          this.patrolWaypointIndex = Math.max(0, (lastIdx - 1) | 0);
        } else {
          this.patrolWaypointIndex = (this.patrolWaypointIndex + 1) | 0;
        }
      } else {
        if (this.patrolWaypointIndex <= 0) {
          this.patrolDirection = 1;
          this.patrolWaypointIndex = Math.min(lastIdx, 1);
        } else {
          this.patrolWaypointIndex = (this.patrolWaypointIndex - 1) | 0;
        }
      }
    }

    return this.patrolWaypoints[this.patrolWaypointIndex] || null;
  }

  assignSingleReinforcedUnitSlot(newEnt, navGrid, entitiesMap) {
    if (!newEnt) return;
    const gridCapacity = Math.max(this.memberIds.length, this.maxMemberCount | 0);
    const fullLayout = computeFormationLocalSlotsFx(
      this.formation,
      gridCapacity,
      this.isCavalry,
      this.customWidthFx,
      1000
    );

    const usedSlots = new Set();
    for (let i = 0; i < this.memberIds.length; i++) {
      const id = this.memberIds[i];
      if (id === newEnt.id) continue;
      const ent = entitiesMap.get(id);
      if (ent && ent.hp > 0 && typeof ent.slotIndex === 'number') {
        usedSlots.add(ent.slotIndex | 0);
      }
    }

    let chosenSlotIdx = this.memberIds.length - 1;
    for (let s = 0; s < fullLayout.slots.length; s++) {
      if (!usedSlots.has(s)) {
        chosenSlotIdx = s;
        break;
      }
    }

    const slot = fullLayout.slots[chosenSlotIdx] || fullLayout.slots[fullLayout.slots.length - 1];
    const worldPos = transformLocalSlotToWorldFx(
      this.anchorXFx,
      this.anchorZFx,
      this.facingDir,
      slot.localForwardFx,
      slot.localRightFx
    );

    const worldMinFx = 12 * FX_ONE;
    const worldMaxFx = (navGrid.worldSizeFx - 12 * FX_ONE) | 0;
    let slotXFx = fxClamp(worldPos.xFx, worldMinFx, worldMaxFx);
    let slotZFx = fxClamp(worldPos.zFx, worldMinFx, worldMaxFx);

    if (!navGrid.isWalkableWorldFx(slotXFx, slotZFx)) {
      const walkable = navGrid.findNearestWalkableTile(
        navGrid.worldFxToTileX(slotXFx),
        navGrid.worldFxToTileZ(slotZFx),
        8
      );
      slotXFx = navGrid.tileToWorldCenterFxX(walkable.tx);
      slotZFx = navGrid.tileToWorldCenterFxZ(walkable.tz);
    }

    newEnt.slotIndex = chosenSlotIdx;
    newEnt.isFrontRow = Boolean(slot.isFrontRow);
    newEnt.slotTargetXFx = slotXFx;
    newEnt.slotTargetZFx = slotZFx;
    newEnt.targetX = slotXFx;
    newEnt.targetZ = slotZFx;
    newEnt.desiredFacingDir = this.facingDir;
    newEnt.isMoving = true;
  }

  updateSlotTargets(navGrid, entitiesMap) {
    this.syncCasualtiesAndPromoteRear(entitiesMap);
    const count = this.memberIds.length;
    if (count === 0) return;

    if (this.isWorking) return;

    const isStationary = !this.isActivelyMoving();
    const layoutCount =
      isStationary && this.isHealing
        ? Math.max(count, this.maxMemberCount | 0)
        : count;

    const useWideSpacing = this.isCavalry || this.unitType === 'ballista';
    const baseKey = `${this.formation}:${layoutCount}:${useWideSpacing ? 1 : 0}:${this.customWidthFx}`;
    if (this._cachedBaseKey !== baseKey || !this._cachedBaseLayout) {
      this._cachedBaseKey = baseKey;
      this._cachedBaseLayout = computeFormationLocalSlotsFx(
        this.formation,
        layoutCount,
        useWideSpacing,
        this.customWidthFx,
        1000
      );
    }
    const baseLayout = this._cachedBaseLayout;

    const corridor = isStationary
      ? { squeezePermille: 1000, centerShiftRightFx: 0, maxRightFx: 0x7fffffff, maxLeftFx: 0x7fffffff }
      : measureChokepointCorridorFx(
          navGrid,
          this.anchorXFx,
          this.anchorZFx,
          this.facingDir,
          baseLayout.nominalWidthFx
        );
    const targetSqueeze = corridor.squeezePermille;

    if (this.squeezePermille < targetSqueeze) {
      this.squeezePermille = Math.min(targetSqueeze, (this.squeezePermille + 75) | 0);
    } else if (this.squeezePermille > targetSqueeze) {
      this.squeezePermille = Math.max(targetSqueeze, (this.squeezePermille - 110) | 0);
    }

    const activeLayout =
      this.squeezePermille === 1000
        ? baseLayout
        : computeFormationLocalSlotsFx(
            this.formation,
            layoutCount,
            useWideSpacing,
            this.customWidthFx,
            this.squeezePermille
          );

    this.frontRowCount = activeLayout.frontRowCount;
    this.lastLocalSlots = activeLayout.slots;

    const worldKey = `${baseKey}:${this.squeezePermille}:${corridor.centerShiftRightFx}:${this.anchorXFx}:${this.anchorZFx}:${this.facingDir}:${count}`;
    let worldSlots = this._cachedWorldSlots;
    if (this._cachedWorldKey !== worldKey || !worldSlots || worldSlots.length !== count) {
      this._cachedWorldKey = worldKey;
      let r2 = 0;
      for (let k = 0; k < activeLayout.slots.length; k++) {
        const sl = activeLayout.slots[k];
        const d2 = sl.localForwardFx * sl.localForwardFx + sl.localRightFx * sl.localRightFx;
        if (d2 > r2) r2 = d2;
      }
      this.formationRadiusFx = Math.sqrt(r2) | 0;

      const worldMinFx = 12 * FX_ONE;
      const worldMaxFx = (navGrid.worldSizeFx - 12 * FX_ONE) | 0;
      const minSlotSepFx = useWideSpacing ? 1950 : 1280;

      // Parallel lane offset inside narrow passages so multiple companies share bridge/gate width smoothly
      const laneBucket = (this.id % 3) - 1;
      const laneShiftFx = this.squeezePermille < 850 ? (laneBucket * 1850) | 0 : 0;

      worldSlots = new Array(count);
      for (let i = 0; i < count; i++) {
        const slot = activeLayout.slots[i];
        const shiftedRightFx = fxClamp(
          (slot.localRightFx + corridor.centerShiftRightFx + laneShiftFx) | 0,
          -corridor.maxLeftFx,
          corridor.maxRightFx
        );
        const worldPos = transformLocalSlotToWorldFx(
          this.anchorXFx,
          this.anchorZFx,
          this.facingDir,
          slot.localForwardFx,
          shiftedRightFx
        );

        let slotXFx = fxClamp(worldPos.xFx, worldMinFx, worldMaxFx);
        let slotZFx = fxClamp(worldPos.zFx, worldMinFx, worldMaxFx);

        if (!navGrid.isWalkableWorldFx(slotXFx, slotZFx)) {
          const walkable = navGrid.findNearestWalkableTile(
            navGrid.worldFxToTileX(slotXFx),
            navGrid.worldFxToTileZ(slotZFx),
            8
          );
          slotXFx = navGrid.tileToWorldCenterFxX(walkable.tx);
          slotZFx = navGrid.tileToWorldCenterFxZ(walkable.tz);
        }

        if (SlotConstraints.clampOutsideBuildings) {
          const c = SlotConstraints.clampOutsideBuildings(slotXFx, slotZFx, 1536);
          slotXFx = c.xFx;
          slotZFx = c.zFx;
        }

        // Prevent multiple slots that were pushed off a tree/obstacle tile from collapsing onto the
        // exact same coordinate (which caused the second unit to orbit the first unit in circles!).
        for (let prev = 0; prev < i; prev++) {
          const ps = worldSlots[prev];
          const dx = (slotXFx - ps.xFx) | 0;
          const dz = (slotZFx - ps.zFx) | 0;
          const dist = fxHypot(dx, dz);
          if (dist < minSlotSepFx) {
            const escapeAngle = ((this.facingDir + 512 + ((i & 1) ? 160 : -160) * ((i >> 1) + 1)) & ANGLE_MASK);
            const pushDist = (minSlotSepFx - dist + 180) | 0;
            const candX = fxClamp(
              (slotXFx + mulDiv(pushDist, fxCos(escapeAngle), FX_ONE)) | 0,
              worldMinFx,
              worldMaxFx
            );
            const candZ = fxClamp(
              (slotZFx + mulDiv(pushDist, fxSin(escapeAngle), FX_ONE)) | 0,
              worldMinFx,
              worldMaxFx
            );
            if (navGrid.isWalkableWorldFx(candX, candZ)) {
              slotXFx = candX;
              slotZFx = candZ;
            }
          }
        }

        worldSlots[i] = {
          xFx: slotXFx,
          zFx: slotZFx,
          isFrontRow: slot.isFrontRow
        };
      }
      this._cachedWorldSlots = worldSlots;
    }

    if (this._forceNearestSlotMatch && count > 2) {
      this._forceNearestSlotMatch = false;
      let sumX = 0;
      let sumZ = 0;
      let validCnt = 0;
      for (let i = 1; i < count; i++) {
        const e = entitiesMap.get(this.memberIds[i]);
        if (e) {
          sumX += e.x / FX_ONE;
          sumZ += e.z / FX_ONE;
          validCnt++;
        }
      }
      const centerX = validCnt > 0 ? sumX / validCnt : this.anchorXFx / FX_ONE;
      const centerZ = validCnt > 0 ? sumZ / validCnt : this.anchorZFx / FX_ONE;

      const targetFacing = (this.desiredFacingDir ?? this.facingDir) & ANGLE_MASK;
      const desiredSlots = new Array(count);
      let desSumX = 0;
      let desSumZ = 0;
      for (let s = 1; s < count; s++) {
        const sl = activeLayout.slots[s];
        const wp = transformLocalSlotToWorldFx(
          this.targetXFx,
          this.targetZFx,
          targetFacing,
          sl.localForwardFx,
          sl.localRightFx
        );
        const sx = wp.xFx / FX_ONE;
        const sz = wp.zFx / FX_ONE;
        desiredSlots[s] = { sx, sz, radSq: (sl.localForwardFx * sl.localForwardFx) + (sl.localRightFx * sl.localRightFx) };
        desSumX += sx;
        desSumZ += sz;
      }
      const desCenterX = desSumX / (count - 1);
      const desCenterZ = desSumZ / (count - 1);

      const slotOrder = [];
      for (let s = 1; s < count; s++) slotOrder.push(s);
      slotOrder.sort((a, b) => desiredSlots[b].radSq - desiredSlots[a].radSq);

      const pool = this.memberIds.slice(1, count);
      const used = new Uint8Array(pool.length);
      for (let k = 0; k < slotOrder.length; k++) {
        const s = slotOrder[k];
        const relSlotX = desiredSlots[s].sx - desCenterX;
        const relSlotZ = desiredSlots[s].sz - desCenterZ;
        let bestIdx = -1;
        let bestDistSq = Infinity;
        for (let p = 0; p < pool.length; p++) {
          if (used[p]) continue;
          const candEnt = entitiesMap.get(pool[p]);
          if (!candEnt) continue;
          const relUnitX = (candEnt.x / FX_ONE) - centerX;
          const relUnitZ = (candEnt.z / FX_ONE) - centerZ;
          const dx = relUnitX - relSlotX;
          const dz = relUnitZ - relSlotZ;
          const dSq = dx * dx + dz * dz;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestIdx = p;
          }
        }
        if (bestIdx >= 0) {
          used[bestIdx] = 1;
          this.memberIds[s] = pool[bestIdx];
        }
      }
    }

    for (let i = 0; i < count; i++) {
      const ent = entitiesMap.get(this.memberIds[i]);
      if (!ent) continue;

      const ws = worldSlots[i];
      ent.slotIndex = i;
      ent.isFrontRow = ws.isFrontRow;
      ent.slotTargetXFx = ws.xFx;
      ent.slotTargetZFx = ws.zFx;
      ent.targetX = ws.xFx;
      ent.targetZ = ws.zFx;
      ent.desiredFacingDir = this.facingDir;
    }
  }

  stopInPlace(navGrid, entitiesMap, preserveWorkSlots = false) {
    this.syncCasualtiesAndPromoteRear(entitiesMap);
    if (this.memberIds.length > 0 && !preserveWorkSlots) {
      let sumX = 0;
      let sumZ = 0;
      const sampleCount = Math.min(this.memberIds.length, Math.max(1, this.frontRowCount));
      for (let i = 0; i < sampleCount; i++) {
        const ent = entitiesMap.get(this.memberIds[i]);
        if (ent) {
          sumX = (sumX + ent.x) | 0;
          sumZ = (sumZ + ent.z) | 0;
        }
      }
      const avgX = (sumX / sampleCount) | 0;
      const avgZ = (sumZ / sampleCount) | 0;
      const walkable = navGrid.findNearestWalkableTile(
        navGrid.worldFxToTileX(avgX),
        navGrid.worldFxToTileZ(avgZ),
        8
      );
      this.anchorXFx = navGrid.tileToWorldCenterFxX(walkable.tx);
      this.anchorZFx = navGrid.tileToWorldCenterFxZ(walkable.tz);
    }

    this.targetXFx = this.anchorXFx;
    this.targetZFx = this.anchorZFx;
    this.desiredFacingDir = this.facingDir;
    this.orderType = CompanyOrderType.HOLD;
    this.commandQueue.length = 0;
    this.patrolWaypoints.length = 0;
    this.patrolWaypointIndex = 0;
    this.patrolDirection = 1;
    this.patrolClosedLoop = false;
    this.pathWaypoints = null;
    this.pathIndex = 0;
    this.activeGroupSpeedFx = 0;
    this.altGroupId = 0;
    this.altGroupCompanyIds = null;
    this.wantsToRun = false;
    this.isRunning = false;
    this._wasMovingForRunReset = false;
    this.engagedTargetEntityId = -1;
    this.engagedTargetBuildingId = -1;
    this.targetEnemyCompanyId = -1;
    this.targetEnemyBuildingId = -1;
    this.interceptedTicks = 0;
    if (!preserveWorkSlots) {
      this.isWorking = false;
      this.activeDropoffBuildingId = 0;
      this.pendingGatherOrder = null;
    }
    if (
      this.formation === FormationTypes.SPEAR_WALL ||
      this.formation === FormationTypes.SHIELD_WALL ||
      this.formation === FormationTypes.PIKE_PHALANX
    ) {
      this.isSpearWallLocked = true;
    }

    if (!preserveWorkSlots) {
      this.updateSlotTargets(navGrid, entitiesMap);

      for (let i = 0; i < this.memberIds.length; i++) {
        const ent = entitiesMap.get(this.memberIds[i]);
        if (ent) {
          ent.targetX = ent.slotTargetXFx;
          ent.targetZ = ent.slotTargetZFx;
          ent.pathWaypoints = null;
          ent.flowFieldKey = null;
        }
      }
    }
  }
}
