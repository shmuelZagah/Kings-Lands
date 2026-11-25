import { resolveUnitActiveCapabilities } from '../combatCapabilitiesRegistry.js';
import {
  FX_ONE,
  PERMILLE_ONE,
  ANGLE_MASK,
  mulDiv,
  fxAbs,
  fxClamp,
  fxSin,
  fxCos,
  fxAtan2,
  fxHypot
} from '../../core/fx.js';
import { FormationTypes } from '../formations/formations.js';
import { isOnBridgeFx } from '../nav/grid.js';
import { CompanyOrderType, SlotConstraints } from '../formations/company.js';
import { computeArmyDragLayoutFx } from '../formations/armyDrag.js';
import { UnitCombatSystem } from './unitCombatSystem.js';
import { UnitCollisionSystem } from './unitCollisionSystem.js';
import { defaultUnitStats as unitStatsData } from '../../data/defaults.js';
import { CHARGE_MIN_RUN_DIST_FX } from './combatSystem.js';

export const UnitPhysicsProfile = Object.freeze({
  0: {
    name: 'worker',
    radiusFx: 540,
    mass: 80,
    staminaRunDrainPerTick: 3,
    bracingPermille: 200,
    antiChargePermille: 0,
    isCavalry: false,
    isRanged: false,
    canCharge: false,
    attackRangeFx: 1850,
    meleeAttackRangeFx: 1850,
    damage: 2,
    meleeDamage: 2,
    vsBuildingDamage: 4,
    armor: 1,
    attackRating: 10,
    meleeBlockRating: 5,
    missileBlockRating: 5,
    maxAmmo: 0,
    windupTicks: 7,
    reloadMinTicks: 20,
    reloadMaxTicks: 28
  },
  1: {
    name: 'swordsman',
    radiusFx: 620,
    mass: 120,
    staminaRunDrainPerTick: 3,
    bracingPermille: 950,
    antiChargePermille: 0,
    isCavalry: false,
    isRanged: false,
    canCharge: false,
    chargeMass: 120,
    chargeBonusDamage: 2,
    attackRangeFx: 2050,
    meleeAttackRangeFx: 2050,
    damage: 5,
    meleeDamage: 5,
    vsBuildingDamage: 8,
    armor: 4,
    attackRating: 22,
    meleeBlockRating: 28,
    missileBlockRating: 30,
    maxAmmo: 0,
    windupTicks: 6,
    reloadMinTicks: 18,
    reloadMaxTicks: 24
  },
  2: {
    name: 'spearman',
    radiusFx: 640,
    mass: 130,
    staminaRunDrainPerTick: 3,
    bracingPermille: 1250,
    antiChargePermille: 550,
    isCavalry: false,
    isRanged: false,
    canCharge: false,
    chargeMass: 130,
    chargeBonusDamage: 2,
    attackRangeFx: 2500,
    meleeAttackRangeFx: 2500,
    damage: 6,
    meleeDamage: 6,
    vsBuildingDamage: 8,
    armor: 4,
    attackRating: 20,
    meleeBlockRating: 26,
    missileBlockRating: 28,
    maxAmmo: 0,
    windupTicks: 7,
    reloadMinTicks: 20,
    reloadMaxTicks: 26
  },
  3: {
    name: 'archer',
    radiusFx: 580,
    mass: 80,
    staminaRunDrainPerTick: 3,
    bracingPermille: 220,
    antiChargePermille: 0,
    isCavalry: false,
    isRanged: true,
    canHitFlying: true,
    canCharge: false,
    attackRangeFx: 117760,
    meleeAttackRangeFx: 2300,
    scatterRadiusFx: 1350,
    accuracy: 75,
    damage: 22,
    meleeDamage: 5,
    vsBuildingDamage: 10,
    vsBuildingPermille: 850,
    armor: 2,
    attackRating: 44,
    meleeBlockRating: 10,
    missileBlockRating: 8,
    maxAmmo: 48,
    windupTicks: 8,
    reloadMinTicks: 46,
    reloadMaxTicks: 60
  },
  4: {
    name: 'cavalry',
    radiusFx: 1200,
    mass: 340,
    staminaRunDrainPerTick: 1,
    bracingPermille: 1850,
    antiChargePermille: 0,
    isCavalry: true,
    isRanged: false,
    canCharge: true,
    chargeMass: 340,
    chargeBonusDamage: 16,
    attackRangeFx: 2750,
    meleeAttackRangeFx: 2750,
    damage: 7,
    meleeDamage: 7,
    vsBuildingDamage: 11,
    armor: 5,
    attackRating: 26,
    meleeBlockRating: 22,
    missileBlockRating: 22,
    maxAmmo: 0,
    windupTicks: 6,
    reloadMinTicks: 18,
    reloadMaxTicks: 24
  },
  5: {
    name: 'hero',
    radiusFx: 720,
    mass: 240,
    staminaRunDrainPerTick: 2,
    bracingPermille: 1600,
    antiChargePermille: 300,
    isCavalry: false,
    isRanged: false,
    canHitFlying: false,
    canCharge: false,
    chargeMass: 240,
    chargeBonusDamage: 12,
    attackRangeFx: 2662,
    meleeAttackRangeFx: 2662,
    scatterRadiusFx: 450,
    accuracy: 88,
    damage: 48,
    meleeDamage: 35,
    vsBuildingDamage: 28,
    vsBuildingPermille: 1000,
    armor: 15,
    attackRating: 65,
    meleeBlockRating: 35,
    missileBlockRating: 35,
    maxAmmo: 0,
    windupTicks: 7,
    reloadMinTicks: 16,
    reloadMaxTicks: 20
  },
  6: {
    name: 'ballista',
    radiusFx: 1150,
    mass: 380,
    staminaRunDrainPerTick: 4,
    bracingPermille: 1400,
    antiChargePermille: 0,
    isCavalry: false,
    isRanged: true,
    isSiege: true,
    canHitFlying: true,
    canCharge: false,
    attackRangeFx: 158720,
    meleeAttackRangeFx: 2400,
    scatterRadiusFx: 820,
    accuracy: 86,
    damage: 95,
    meleeDamage: 12,
    vsBuildingDamage: 160,
    vsBuildingPermille: 3500,
    armor: 6,
    attackRating: 65,
    meleeBlockRating: 10,
    missileBlockRating: 38,
    maxAmmo: 24,
    windupTicks: 12,
    reloadMinTicks: 66,
    reloadMaxTicks: 82
  }
});

export class MovementSystem {
  constructor({ navGrid, spatialHash, astar, flowFieldManager, moraleStaminaSystem = null }) {
    this.navGrid = navGrid;
    this.spatialHash = spatialHash;
    this.astar = astar;
    this.flowFieldManager = flowFieldManager;
    this.moraleStaminaSystem = moraleStaminaSystem;
    this._nextAltGroupId = 1;
    this.combatSystem = new UnitCombatSystem(spatialHash, navGrid);
    this.collisionSystem = new UnitCollisionSystem(
      spatialHash,
      navGrid,
      (unitTypeIdx) => this.getPhysicsProfile(unitTypeIdx)
    );
  }

  getPhysicsProfile(unitTypeIdxOrObj, unitTypeKey = null, activeLoadoutIdx = 0) {
    let unitTypeIdx = unitTypeIdxOrObj;
    let effKey = unitTypeKey;
    let effLoadoutIdx = activeLoadoutIdx | 0;
    if (unitTypeIdxOrObj && typeof unitTypeIdxOrObj === 'object') {
      unitTypeIdx = unitTypeIdxOrObj.unitTypeIdx ?? 1;
      effKey = unitTypeIdxOrObj.unitType || effKey;
      effLoadoutIdx = (unitTypeIdxOrObj.activeLoadoutIdx | 0) || 0;
    } else if (typeof unitTypeIdxOrObj === 'string') {
      effKey = unitTypeIdxOrObj;
      unitTypeIdx = 1;
    }
    const base = UnitPhysicsProfile[unitTypeIdx] || UnitPhysicsProfile[1];
    const key = effKey || base.name;
    const custom = unitStatsData?.units?.[key];
    if (!custom) return base;
    const caps = resolveUnitActiveCapabilities(key, effLoadoutIdx, unitStatsData);
    const isRangedNow = effLoadoutIdx > 0 ? Boolean(caps.isRangedLoadout) : Boolean(custom.isRanged ?? caps.isRangedLoadout ?? base.isRanged);
    return {
      ...base,
      name: custom.id || base.name,
      visionRangeMeters: (custom.visionRangeMeters | 0) || 96,
      blacksmithBonuses: custom.blacksmithBonuses || null,
      radiusFx: Math.round((Number(custom.radiusMeters) || 0.57) * FX_ONE) | 0,
      mass: (custom.mass | 0) || base.mass,
      staminaRunDrainPerTick: (custom.staminaRunDrainPerTick | 0) || base.staminaRunDrainPerTick,
      bracingPermille: (custom.bracingPermille | 0) ?? base.bracingPermille,
      antiChargePermille: (custom.antiChargePermille | 0) ?? base.antiChargePermille,
      isCavalry: Boolean(custom.isMounted ?? base.isCavalry),
      isRanged: isRangedNow,
      isSiege: Boolean(custom.isSiege ?? base.isSiege),
      canHitFlying: Boolean(custom.canHitFlying ?? base.canHitFlying),
      canCharge: Boolean(custom.canCharge ?? base.canCharge),
      chargeMass: (custom.chargeMass | 0) || base.chargeMass,
      chargeBonusDamage: (custom.chargeBonusDamage | 0) ?? base.chargeBonusDamage,
      attackRangeFx: Math.round((Number(isRangedNow ? (custom.attackRangeMeters || 28) : custom.meleeAttackRangeMeters) || 2.0) * FX_ONE) | 0,
      meleeAttackRangeFx: Math.round((Number(custom.meleeAttackRangeMeters) || 2.0) * FX_ONE) | 0,
      scatterRadiusFx: Math.round((Number(custom.scatterRadiusMeters) || 0) * FX_ONE) | 0,
      accuracy: (custom.accuracy | 0) || base.accuracy,
      damage: ( (isRangedNow ? (custom.rangedDamage || custom.meleeDamage) : custom.meleeDamage) | 0 ) || base.damage,
      meleeDamage: (custom.meleeDamage | 0) || base.meleeDamage,
      vsBuildingDamage: (custom.vsBuildingDamage | 0) || base.vsBuildingDamage,
      vsBuildingPermille: (custom.vsBuildingPermille | 0) || base.vsBuildingPermille,
      armor: (custom.armor | 0) ?? base.armor,
      attackRating: (custom.attackRating | 0) || base.attackRating,
      meleeBlockRating: (custom.meleeBlockRating | 0) ?? base.meleeBlockRating,
      missileBlockRating: (custom.missileBlockRating | 0) ?? base.missileBlockRating,
      maxAmmo: (custom.maxAmmo | 0) ?? base.maxAmmo,
      windupTicks: (custom.windupTicks | 0) || base.windupTicks,
      reloadMinTicks: (custom.reloadMinTicks | 0) || base.reloadMinTicks,
      reloadMaxTicks: (custom.reloadMaxTicks | 0) || base.reloadMaxTicks
    };
  }

  issueArmyDragOrder(
    companies,
    entitiesMap,
    dragStartFx,
    dragEndFx,
    orderType = CompanyOrderType.MOVE,
    currentTick = 0,
    options = {}
  ) {
    if (!Array.isArray(companies) || companies.length === 0) return;
    const appendQueue = Boolean(options.queue);
    const isRunning = Boolean(options.isRunning);
    const preserveRelative = Boolean(options.preserveRelative);
    const patrolWaypointsInput = Array.isArray(options.patrolWaypoints)
      ? options.patrolWaypoints
      : null;
    const gameState = options.gameState || null;
    const targetEnemyCompanyId =
      options.targetEnemyCompanyId !== undefined && options.targetEnemyCompanyId !== null
        ? options.targetEnemyCompanyId | 0
        : -1;
    const targetEnemyBuildingId =
      options.targetEnemyBuildingId !== undefined && options.targetEnemyBuildingId !== null
        ? options.targetEnemyBuildingId | 0
        : -1;

    const descriptors = [];
    let minGroupSpeedFx = 0x7fffffff;

    for (let i = 0; i < companies.length; i++) {
      const comp = companies[i];
      if (comp.garrisonedBuildingId > 0 || comp.isBroken) continue;
      comp.syncCasualtiesAndPromoteRear(entitiesMap);
      if (comp.memberIds.length === 0) continue;

      if (comp.speedFx > 0 && comp.speedFx < minGroupSpeedFx) {
        minGroupSpeedFx = comp.speedFx | 0;
      }

      let originXFx = comp.anchorXFx;
      let originZFx = comp.anchorZFx;
      let originFacingDir = comp.facingDir;

      if (appendQueue) {
        const buildQ = gameState?.constructionSystem?.workerBuildQueues?.get(comp.id);
        const gatherTask = gameState?.economySystem?.companyGatherTasks?.get(comp.id);
        if (comp.commandQueue.length > 0) {
          const lastQ = comp.commandQueue[comp.commandQueue.length - 1];
          originXFx = lastQ.targetXFx;
          originZFx = lastQ.targetZFx;
          originFacingDir = lastQ.facingDir ?? comp.facingDir;
        } else if (buildQ && buildQ.length > 0) {
          const lastBldId = buildQ[buildQ.length - 1];
          const lastBld = gameState.constructionSystem.buildings.get(lastBldId);
          if (lastBld) {
            originXFx = lastBld.xFx;
            originZFx = lastBld.zFx;
          }
        } else if (gatherTask && gatherTask.state !== 3) {
          originXFx = gatherTask.nodeXFx;
          originZFx = gatherTask.nodeZFx;
        } else if (comp.isActivelyMoving()) {
          originXFx = comp.targetXFx;
          originZFx = comp.targetZFx;
          originFacingDir = comp.desiredFacingDir ?? comp.facingDir;
        }
      }

      descriptors.push({
        companyId: comp.id,
        unitType: comp.unitType,
        unitCount: comp.memberIds.length,
        isCavalry: comp.isCavalry,
        formation: comp.formation,
        customWidthFx: comp.customWidthFx,
        roleCategory: comp.roleCategory,
        anchorXFx: originXFx,
        anchorZFx: originZFx,
        facingDir: originFacingDir
      });
    }

    if (descriptors.length === 0) return;

    const synchronizedGroupSpeedFx =
      preserveRelative && descriptors.length > 1 && minGroupSpeedFx < 0x7fffffff
        ? minGroupSpeedFx
        : 0;
    const altGroupId =
      preserveRelative && descriptors.length > 1 ? this._nextAltGroupId++ : 0;
    const altGroupCompanyIds =
      altGroupId > 0 ? descriptors.map((d) => d.companyId | 0) : null;
    const allInGroupCanRun =
      altGroupId > 0
        ? companies.every(
            (c) => c.garrisonedBuildingId > 0 || c.isBroken || c.memberIds.length === 0 || (c.canStartRunning() && isRunning)
          )
        : true;

    const layout = computeArmyDragLayoutFx(
      descriptors,
      dragStartFx,
      dragEndFx,
      this.navGrid,
      { preserveRelative }
    );

    for (let i = 0; i < layout.placements.length; i++) {
      const pl = layout.placements[i];
      const comp = companies.find((c) => c.id === pl.companyId);
      if (!comp) continue;

      let companyPatrolWaypoints = null;
      if (
        orderType === CompanyOrderType.PATROL &&
        patrolWaypointsInput &&
        patrolWaypointsInput.length > 0
      ) {
        const offsetXFx = (pl.targetXFx - (dragStartFx.xFx | 0)) | 0;
        const offsetZFx = (pl.targetZFx - (dragStartFx.zFx | 0)) | 0;
        companyPatrolWaypoints = patrolWaypointsInput.map((pt) => {
          const wx = fxClamp(
            (pt.xFx | 0) + offsetXFx,
            16 * FX_ONE,
            this.navGrid.worldSizeFx - 16 * FX_ONE
          );
          const wz = fxClamp(
            (pt.zFx | 0) + offsetZFx,
            16 * FX_ONE,
            this.navGrid.worldSizeFx - 16 * FX_ONE
          );
          const walkable = this.navGrid.findNearestWalkableTile(
            this.navGrid.worldFxToTileX(wx),
            this.navGrid.worldFxToTileZ(wz),
            12
          );
          return {
            xFx: this.navGrid.tileToWorldCenterFxX(walkable.tx),
            zFx: this.navGrid.tileToWorldCenterFxZ(walkable.tz),
            facingDir: pl.facingDir
          };
        });
      }

      const hasPendingBuildOrGather = Boolean(
        appendQueue &&
          (gameState?.constructionSystem?.workerBuildQueues?.get(comp.id)?.length > 0 ||
            gameState?.economySystem?.companyGatherTasks?.has(comp.id))
      );

      const canCompanyRun = comp.canStartRunning() && isRunning && allInGroupCanRun;

      comp.enqueueOrSetOrder(
        {
          orderType,
          targetXFx: pl.targetXFx,
          targetZFx: pl.targetZFx,
          facingDir: pl.facingDir,
          customWidthFx: layout.isDragGesture ? pl.customWidthFx : comp.customWidthFx,
          isDragGesture: Boolean(layout.isDragGesture || layout.isAltDragGesture),
          isRunning: canCompanyRun,
          groupSpeedFx: synchronizedGroupSpeedFx,
          altGroupId,
          altGroupCompanyIds,
          patrolWaypoints: companyPatrolWaypoints,
          forceQueue: hasPendingBuildOrGather,
          targetEnemyCompanyId,
          targetEnemyBuildingId
        },
        appendQueue,
        this.astar,
        this.navGrid,
        entitiesMap
      );
    }
  }

  assignUnitAStarRoute(ent, targetXFx, targetZFx, comp = null, forceBypassBudget = false) {
    // 1. Fast O(1) Company Route Inheritance: if the unit can see any waypoint of its company's centered path,
    // inherit the remaining company corridor waypoints (through the bridge/gate center) with zero A* cost!
    const compRoute = !ent.hasCombatTarget ? (comp?.fullRouteWaypoints || comp?.pathWaypoints) : null;
    if (Array.isArray(compRoute) && compRoute.length > 0) {
      const entGoalDist = fxHypot((targetXFx - ent.x) | 0, (targetZFx - ent.z) | 0);
      const minIdx = Math.max(0, (comp?.pathIndex | 0) - 1);
      for (let k = compRoute.length - 1; k >= minIdx; k--) {
        const wp = compRoute[k];
        const wpGoalDist = fxHypot((targetXFx - wp.xFx) | 0, (targetZFx - wp.zFx) | 0);
        if (wpGoalDist + 512 >= entGoalDist) continue;
        if (this.astar.hasClearLineWorldFx(ent.x, ent.z, wp.xFx, wp.zFx)) {
          const inherited = compRoute.slice(k).map((p) => ({ xFx: p.xFx | 0, zFx: p.zFx | 0 }));
          inherited.push({ xFx: targetXFx | 0, zFx: targetZFx | 0 });
          ent.pathWaypoints = inherited;
          ent.pathIndex = 0;
          ent.isMoving = true;
          return true;
        }
      }
    }

    // 2. Shared Regional Path Cache (8m x 8m buckets): if another unit in the same 2x2 tile area
    // already computed a path to the same 2x2 goal area this tick, reuse it in O(1) time!
    const stx = this.navGrid.worldFxToTileX(ent.x) >> 1;
    const stz = this.navGrid.worldFxToTileZ(ent.z) >> 1;
    const gtx = this.navGrid.worldFxToTileX(targetXFx) >> 1;
    const gtz = this.navGrid.worldFxToTileZ(targetZFx) >> 1;
    const prof = this.getPhysicsProfile(ent);
    const cacheKey = `${stx}:${stz}:${gtx}:${gtz}:${prof.isCavalry ? 1 : 0}`;

    if (this._tickRouteCache && this._tickRouteCache.has(cacheKey)) {
      const cached = this._tickRouteCache.get(cacheKey);
      const cloned = cached.slice(0, Math.max(0, cached.length - 1));
      cloned.push({ xFx: targetXFx | 0, zFx: targetZFx | 0 });
      ent.pathWaypoints = cloned;
      ent.pathIndex = 0;
      ent.isMoving = true;
      return true;
    }

    if (!forceBypassBudget && (this._unitAStarBudget | 0) <= 0) return false;
    this._unitAStarBudget = (this._unitAStarBudget - 1) | 0;

    const waypoints = this.astar.findPath(ent.x, ent.z, targetXFx, targetZFx, {
      isCavalry: prof.isCavalry,
      maxIterations: 16384
    });
    if (this._tickRouteCache && waypoints && waypoints.length > 0) {
      this._tickRouteCache.set(cacheKey, waypoints);
    }
    ent.pathWaypoints = waypoints;
    ent.pathIndex = 0;
    ent.isMoving = true;
    return true;
  }

  _stepCompanyStamina(comp, prof, entitiesMap) {
    let movingMembers = 0;
    let fightingMembers = 0;

    for (let m = 0; m < comp.memberIds.length; m++) {
      const ent = entitiesMap.get(comp.memberIds[m]);
      if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;
      if (
        (ent.windupTicks | 0) > 0 ||
        (ent.actionCooldown | 0) > 0 ||
        (ent.reservedTargetId > 0 && !ent.isMoving)
      ) {
        fightingMembers++;
      } else if (ent.isMoving) {
        movingMembers++;
      }
    }

    const isActivelyRunningNow = Boolean(
      comp.isRunning &&
        !comp.isWorking &&
        (comp.isActivelyMoving() || movingMembers > (comp.memberIds.length >> 2)) &&
        fightingMembers <= (comp.memberIds.length >> 1)
    );

    if (isActivelyRunningNow) {
      const drainRate = (prof?.staminaRunDrainPerTick ?? (comp.isCavalry ? 2 : 5)) | 0;
      comp.staminaPermille = Math.max(0, ((comp.staminaPermille ?? 1000) - drainRate) | 0);
      if (comp.staminaPermille <= 0) {
        comp.staminaPermille = 0;
        comp.isRunning = false;
      }
    } else if (
      fightingMembers > 0 ||
      comp.engagedTargetEntityId > 0 ||
      comp.engagedTargetBuildingId > 0
    ) {
      comp.staminaPermille = Math.min(1000, ((comp.staminaPermille ?? 1000) + 1) | 0);
    } else if (comp.isActivelyMoving() || movingMembers > 0 || comp.isWorking) {
      comp.staminaPermille = Math.min(1000, ((comp.staminaPermille ?? 1000) + 6) | 0);
    } else {
      comp.staminaPermille = Math.min(1000, ((comp.staminaPermille ?? 1000) + 12) | 0);
    }
  }

  _computeCompanyRawStepSpeedFx(comp) {
    const baseCompSpeedFx =
      comp.activeGroupSpeedFx > 0
        ? Math.min(comp.speedFx | 0, comp.activeGroupSpeedFx | 0)
        : comp.speedFx | 0;
    const speedModPermille = this.navGrid.getSpeedMultiplierAtWorldFx(
      comp.anchorXFx,
      comp.anchorZFx,
      comp.isCavalry
    );
    let spdFx = mulDiv(
      baseCompSpeedFx,
      speedModPermille > 0 ? speedModPermille : 600,
      PERMILLE_ONE
    );
    if (this.moraleStaminaSystem) {
      const exhaustMult = this.moraleStaminaSystem.getExhaustionSpeedMultiplierPermille(comp);
      spdFx = mulDiv(spdFx, exhaustMult, PERMILLE_ONE);
    }
    if (comp.isRunning && (comp.staminaPermille | 0) > 0) {
      const runMult = comp.runSpeedMultPermille || 1450;
      spdFx = mulDiv(spdFx, runMult, PERMILLE_ONE);
    }
    return spdFx;
  }

  _synchronizeAltGroups(companies, companyIds) {
    const groups = new Map();
    for (let i = 0; i < companyIds.length; i++) {
      const comp = companies.get(companyIds[i]);
      if (
        !comp ||
        comp.garrisonedBuildingId > 0 ||
        comp.isBroken ||
        comp.memberIds.length === 0 ||
        (comp.altGroupId | 0) <= 0 ||
        !comp.isActivelyMoving() ||
        comp.engagedTargetEntityId > 0 ||
        comp.engagedTargetBuildingId > 0
      ) {
        if (comp) comp._syncedAltActualSpeedFx = 0;
        continue;
      }
      const gid = comp.altGroupId | 0;
      let list = groups.get(gid);
      if (!list) {
        list = [];
        groups.set(gid, list);
      }
      list.push(comp);
    }

    for (const list of groups.values()) {
      if (list.length <= 1) {
        if (list.length === 1) list[0]._syncedAltActualSpeedFx = 0;
        continue;
      }
      // If ANY company in the Alt group is walking or exhausted, drop the ENTIRE Alt group to walking!
      const allRunning = list.every(
        (c) => Boolean(c.wantsToRun && c.isRunning && (c.staminaPermille | 0) > 0 && c.canStartRunning())
      );
      if (!allRunning) {
        for (let i = 0; i < list.length; i++) {
          list[i].wantsToRun = false;
          list[i].isRunning = false;
        }
      }
      // Compute the slowest actual step speed across all companies in the Alt group (including run multiplier & terrain/exhaustion)
      let minStepSpeedFx = 0x7fffffff;
      for (let i = 0; i < list.length; i++) {
        const s = this._computeCompanyRawStepSpeedFx(list[i]);
        if (s > 0 && s < minStepSpeedFx) {
          minStepSpeedFx = s;
        }
      }
      const syncedSpeed = minStepSpeedFx < 0x7fffffff ? minStepSpeedFx : 0;
      for (let i = 0; i < list.length; i++) {
        list[i]._syncedAltActualSpeedFx = syncedSpeed;
      }
    }
  }

  _updateCompanies(gameState) {
    const companies = gameState.companies;
    const entitiesMap = gameState.entities;
    if (!companies) return;

    const companyIds = Array.from(companies.keys()).sort((a, b) => a - b);

    // Pre-pass: evaluate stamina & run state for all companies so Alt groups can synchronize gait & slowest pace deterministically
    for (let cIdx = 0; cIdx < companyIds.length; cIdx++) {
      const comp = companies.get(companyIds[cIdx]);
      if (!comp || comp.garrisonedBuildingId > 0 || comp.activeChargeRush) continue;
      comp.syncCasualtiesAndPromoteRear(entitiesMap);
      if (comp.memberIds.length === 0) continue;
      const prof = this.getPhysicsProfile(comp);
      const isLockedStance =
        comp.formation === FormationTypes.SPEAR_WALL ||
        comp.formation === FormationTypes.SHIELD_WALL ||
        comp.formation === FormationTypes.PIKE_PHALANX;
      if (isLockedStance) {
        comp.wantsToRun = false;
        comp.isRunning = false;
        if (!comp.isActivelyMoving()) {
          comp.isSpearWallLocked = true;
        }
      }
      this._stepCompanyStamina(comp, prof, entitiesMap);
      if (
        !comp.wantsToRun ||
        isLockedStance ||
        comp.isSpearWallLocked ||
        comp.isWorking ||
        (comp.staminaPermille | 0) <= 0
      ) {
        comp.isRunning = false;
      } else if (comp.wantsToRun && comp.isActivelyMoving()) {
        if (comp.isRunning) {
          comp.isRunning = true;
        } else if ((comp.staminaPermille | 0) >= 450) {
          comp.isRunning = true;
        } else if ((comp.staminaPermille | 0) >= 200 && !prof.isRanged) {
          const nearEnemyCheck = this.combatSystem.findNearestEnemyEntity(
            comp.anchorXFx,
            comp.anchorZFx,
            16 * FX_ONE,
            comp.team,
            entitiesMap,
            {
              canHitFlying: Boolean(prof.canHitFlying || prof.isFlying),
              onlySquadIndex: comp.targetEnemyCompanyId >= 0 ? comp.targetEnemyCompanyId : -1
            }
          );
          if (nearEnemyCheck.enemy && nearEnemyCheck.distFx >= 8 * FX_ONE) {
            comp.isRunning = true;
          }
        }
      }
    }

    this._synchronizeAltGroups(companies, companyIds);

    for (let cIdx = 0; cIdx < companyIds.length; cIdx++) {
      const comp = companies.get(companyIds[cIdx]);
      if (!comp || comp.garrisonedBuildingId > 0) continue;
      if (comp.activeChargeRush) {
        const heroEnt = entitiesMap.get(comp.memberIds[0]);
        if (heroEnt && heroEnt.hp > 0) {
          comp.anchorXFx = heroEnt.x;
          comp.anchorZFx = heroEnt.z;
          comp.targetXFx = heroEnt.x;
          comp.targetZFx = heroEnt.z;
          comp.facingDir = heroEnt.dir;
          comp.desiredFacingDir = heroEnt.dir;
        }
        continue;
      }

      const prevCompAnchorXFx = comp.anchorXFx | 0;
      const prevCompAnchorZFx = comp.anchorZFx | 0;
      comp.anchorMovedThisTick = false;
      comp.avgVxFx = 0;
      comp.avgVzFx = 0;
      comp.syncCasualtiesAndPromoteRear(entitiesMap);
      if (comp.memberIds.length === 0) continue;

      const prof = this.getPhysicsProfile(comp);
      const isLockedStance =
        comp.formation === FormationTypes.SPEAR_WALL ||
        comp.formation === FormationTypes.SHIELD_WALL ||
        comp.formation === FormationTypes.PIKE_PHALANX;

      if (this.combatSystem.evaluateCompanyCombatEngagement(comp, prof, entitiesMap, gameState)) {
        continue;
      }

      const activeBuildQ = gameState.constructionSystem?.workerBuildQueues?.get(comp.id);
      const hasBuildTasksInQueue = Boolean(activeBuildQ && activeBuildQ.length > 0);
      const isActivelyGathering = Boolean(
        gameState.economySystem?.companyGatherTasks?.has(comp.id) ||
          comp.activeDropoffBuildingId > 0
      );

      if (!comp.isActivelyMoving()) {
        comp.chargeRunDistFx = 0;
        comp.chargeMomentumPermille = 0;

        if (
          hasBuildTasksInQueue ||
          isActivelyGathering ||
          !comp.advanceCommandQueue(this.astar, this.navGrid, entitiesMap)
        ) {
          if (!comp.isWorking) {
            comp.updateSlotTargets(this.navGrid, entitiesMap);
          }
          let anyStillMovingToSlot = false;
          let anyMemberUnsettledAtSlot = false;
          for (let m = 0; m < comp.memberIds.length; m++) {
            const mEnt = entitiesMap.get(comp.memberIds[m]);
            if (mEnt && mEnt.hp > 0 && typeof mEnt.slotTargetXFx === "number" && typeof mEnt.slotTargetZFx === "number") {
              const dSlot = fxHypot((mEnt.slotTargetXFx - mEnt.x) | 0, (mEnt.slotTargetZFx - mEnt.z) | 0);
              if (dSlot > 1800) {
                anyStillMovingToSlot = true;
              }
              if (mEnt.isMoving || dSlot > 680) {
                anyMemberUnsettledAtSlot = true;
              }
            }
          }
          if (anyStillMovingToSlot || anyMemberUnsettledAtSlot) {
            comp._wasMovingForRunReset = true;
          }
          comp.activeGroupSpeedFx = 0;
          comp.altGroupId = 0;
          comp.altGroupCompanyIds = null;
          if (anyStillMovingToSlot && comp.wantsToRun && (comp.staminaPermille | 0) > 0 && !isLockedStance) {
            comp.isRunning = true;
          } else {
            comp.isRunning = false;
            if (
              !anyStillMovingToSlot &&
              !anyMemberUnsettledAtSlot &&
              comp._wasMovingForRunReset &&
              !hasBuildTasksInQueue &&
              !isActivelyGathering &&
              comp.commandQueue.length === 0
            ) {
              comp._wasMovingForRunReset = false;
              comp.wantsToRun = false;
            }
          }
          continue;
        }
      }

      let anchorSpeedFx = this._computeCompanyRawStepSpeedFx(comp);
      if ((comp._syncedAltActualSpeedFx | 0) > 0) {
        anchorSpeedFx = Math.min(anchorSpeedFx, comp._syncedAltActualSpeedFx | 0);
      }

      let avgMemberX = 0;
      let avgMemberZ = 0;
      for (let m = 0; m < comp.memberIds.length; m++) {
        const ent = entitiesMap.get(comp.memberIds[m]);
        if (ent) {
          avgMemberX = (avgMemberX + ent.x) | 0;
          avgMemberZ = (avgMemberZ + ent.z) | 0;
        }
      }
      avgMemberX = (avgMemberX / comp.memberIds.length) | 0;
      avgMemberZ = (avgMemberZ / comp.memberIds.length) | 0;
      const lagDistFx = fxHypot(comp.anchorXFx - avgMemberX, comp.anchorZFx - avgMemberZ);
      if (!comp.isBroken) {
        if (lagDistFx > 13 * FX_ONE) {
          if (lagDistFx > 20 * FX_ONE) anchorSpeedFx = 0;
          else anchorSpeedFx = mulDiv(anchorSpeedFx, (22 * FX_ONE - lagDistFx) | 0, 12 * FX_ONE);
          comp.lagStallTicks = ((comp.lagStallTicks | 0) + 1) | 0;
          if (comp.lagStallTicks >= 28) {
            comp.lagStallTicks = 0;
            const wTile = this.navGrid.findNearestWalkableTile(
              this.navGrid.worldFxToTileX(avgMemberX),
              this.navGrid.worldFxToTileZ(avgMemberZ),
              10
            );
            comp.anchorXFx = this.navGrid.tileToWorldCenterFxX(wTile.tx);
            comp.anchorZFx = this.navGrid.tileToWorldCenterFxZ(wTile.tz);
            comp.pathWaypoints = this.astar.findPath(
              comp.anchorXFx,
              comp.anchorZFx,
              comp.targetXFx,
              comp.targetZFx,
              { isCavalry: comp.isCavalry }
            );
            comp.pathIndex = 0;
            comp.updateSlotTargets(this.navGrid, entitiesMap);
            for (let m = 0; m < comp.memberIds.length; m++) {
              const mEnt = entitiesMap.get(comp.memberIds[m]);
              if (mEnt && mEnt.hp > 0) {
                mEnt.settled = 0;
                mEnt.atSlot = 0;
                mEnt.pathWaypoints = null;
                mEnt.isMoving = true;
              }
            }
          }
        } else {
          comp.lagStallTicks = 0;
          if (lagDistFx > 10 * FX_ONE) {
            anchorSpeedFx = mulDiv(anchorSpeedFx, (24 * FX_ONE - lagDistFx) | 0, 14 * FX_ONE);
          }
        }
      }

      if (!comp.isWorking && lagDistFx <= 22 * FX_ONE) {
        if ((comp.anchorWatchTicks | 0) === 0) {
          comp.anchorWatchX = comp.anchorXFx;
          comp.anchorWatchZ = comp.anchorZFx;
        }
        comp.anchorWatchTicks = ((comp.anchorWatchTicks | 0) + 1) | 0;
        if (comp.anchorWatchTicks >= 40) {
          comp.anchorWatchTicks = 0;
          const moved = fxHypot((comp.anchorXFx - comp.anchorWatchX) | 0, (comp.anchorZFx - comp.anchorWatchZ) | 0);
          const toGoal = fxHypot((comp.targetXFx - comp.anchorXFx) | 0, (comp.targetZFx - comp.anchorZFx) | 0);
          if (moved < 1024 && toGoal > 3 * FX_ONE && comp.orderType !== CompanyOrderType.ROUTING) {
            comp.anchorStallCount = ((comp.anchorStallCount | 0) + 1) | 0;
            const wps = comp.pathWaypoints;
            if (comp.anchorStallCount === 1 && Array.isArray(wps) && comp.pathIndex < wps.length - 1) {
              comp.pathIndex = (comp.pathIndex + 1) | 0;
            } else {
              comp.pathWaypoints = this.astar.findPath(comp.anchorXFx, comp.anchorZFx, comp.targetXFx, comp.targetZFx, { isCavalry: comp.isCavalry });
              comp.pathIndex = 0;
              if (comp.anchorStallCount > 6) {
                comp.anchorStallCount = 0;
              }
            }
          } else if (moved >= 1024) {
            comp.anchorStallCount = 0;
          }
        }
      }

      let steerXFx = comp.targetXFx;
      let steerZFx = comp.targetZFx;

      if (Array.isArray(comp.pathWaypoints) && comp.pathIndex < comp.pathWaypoints.length) {
        const ringedWp = (w) =>
          this.collisionSystem.clampPointOutsideBuildingsFx(
            w.xFx | 0,
            w.zFx | 0,
            1700,
            gameState.constructionSystem?.buildings,
            gameState.constructionSystem?.sortedBuildingIds
          );
        const wp = ringedWp(comp.pathWaypoints[comp.pathIndex]);
        const wpDist = fxHypot(wp.xFx - comp.anchorXFx, wp.zFx - comp.anchorZFx);
        if (wpDist <= anchorSpeedFx + 1536 && comp.pathIndex < comp.pathWaypoints.length - 1) {
          comp.pathIndex = (comp.pathIndex + 1) | 0;
        }
        const activeWp = ringedWp(comp.pathWaypoints[comp.pathIndex]);
        steerXFx = activeWp.xFx;
        steerZFx = activeWp.zFx;
      }

      const dxGoal = (comp.targetXFx - comp.anchorXFx) | 0;
      const dzGoal = (comp.targetZFx - comp.anchorZFx) | 0;
      const distGoal = fxHypot(dxGoal, dzGoal);

      // For 1-unit Heroes require lagDistFx <= 1536; for multi-unit squads the anchor snaps to targetXFx/targetZFx and faces desiredFacingDir immediately on arrival!
      const canFinishAnchorArrival = comp.memberIds.length <= 1 ? lagDistFx <= 1536 : true;
      if (distGoal <= anchorSpeedFx + 512 && canFinishAnchorArrival) {
        if (distGoal > 64) {
          comp.anchorMovedThisTick = true;
        }
        comp.anchorXFx = comp.targetXFx;
        comp.anchorZFx = comp.targetZFx;
        comp.facingDir = comp.desiredFacingDir;

        if (comp.orderType === CompanyOrderType.PATROL && comp.patrolWaypoints.length >= 2) {
          const nextPt = comp.advancePatrolWaypoint();
          if (nextPt) {
            comp.targetXFx = nextPt.xFx;
            comp.targetZFx = nextPt.zFx;
            comp.desiredFacingDir = fxAtan2(
              comp.targetZFx - comp.anchorZFx,
              comp.targetXFx - comp.anchorXFx
            );
            comp.pathWaypoints = this.astar.findPath(
              comp.anchorXFx,
              comp.anchorZFx,
              comp.targetXFx,
              comp.targetZFx,
              { isCavalry: comp.isCavalry }
            );
            comp.pathIndex = 0;
          }
        } else if (
          comp.orderType !== CompanyOrderType.ROUTING &&
          (hasBuildTasksInQueue ||
            isActivelyGathering ||
            !comp.advanceCommandQueue(this.astar, this.navGrid, entitiesMap))
        ) {
          if (comp.isExplicitGroundMove) {
            comp.postManualMoveHoldTicks = 90; // Hold position for 4.5s after arriving at a player-clicked MOVE spot
            comp.isExplicitGroundMove = false;
          }
          comp.orderType = CompanyOrderType.IDLE;
          comp.isDragFormationOrder = false;
          comp.anchorMovedThisTick = false;
          comp.pathWaypoints = null;
          comp.pathIndex = 0;
          comp.activeGroupSpeedFx = 0;
          comp.altGroupId = 0;
          comp.altGroupCompanyIds = null;
          if (!comp.isWorking) {
            comp.updateSlotTargets(this.navGrid, entitiesMap);
          }
          let anyUnitStillReachingSlot = false;
          for (let m = 0; m < comp.memberIds.length; m++) {
            const mEnt = entitiesMap.get(comp.memberIds[m]);
            if (mEnt && mEnt.hp > 0 && typeof mEnt.slotTargetXFx === "number" && typeof mEnt.slotTargetZFx === "number") {
              const dSlot = fxHypot((mEnt.slotTargetXFx - mEnt.x) | 0, (mEnt.slotTargetZFx - mEnt.z) | 0);
              if (mEnt.isMoving || dSlot > 680) {
                anyUnitStillReachingSlot = true;
                break;
              }
            }
          }
          if (!anyUnitStillReachingSlot) {
            comp._wasMovingForRunReset = false;
            comp.wantsToRun = false;
            comp.isRunning = false;
          } else {
            comp._wasMovingForRunReset = true;
            if (!comp.wantsToRun) {
              comp.isRunning = false;
            }
          }
          if (isLockedStance) {
            comp.isSpearWallLocked = true;
          }
        }
      } else {
        const dxSteer = (steerXFx - comp.anchorXFx) | 0;
        const dzSteer = (steerZFx - comp.anchorZFx) | 0;
        const distSteer = fxHypot(dxSteer, dzSteer);
        if (distSteer > 0) {
          const rawDirX = mulDiv(dxSteer, FX_ONE, distSteer);
          const rawDirZ = mulDiv(dzSteer, FX_ONE, distSteer);
          const bldSteer = this.collisionSystem.computeBuildingAvoidanceSteerFx(
            comp.anchorXFx,
            comp.anchorZFx,
            2 * FX_ONE,
            rawDirX,
            rawDirZ,
            distSteer,
            gameState.constructionSystem?.buildings,
            gameState.constructionSystem?.sortedBuildingIds,
            comp.targetEnemyBuildingId > 0 ? comp.targetEnemyBuildingId : -1
          );

          const marchAngle = fxAtan2(bldSteer.vzFx, bldSteer.vxFx);
          const targetFacing =
            comp.isDragFormationOrder || distGoal < 10 * FX_ONE ? comp.desiredFacingDir : marchAngle;
          let diff = ((targetFacing - comp.facingDir + 512) & ANGLE_MASK) - 512;

          let maxTurnStep =
            comp.formation === FormationTypes.PIKE_PHALANX
              ? 5
              : comp.isDragFormationOrder || distGoal < 10 * FX_ONE
                ? 64
                : 36;
          if (diff > maxTurnStep) diff = maxTurnStep;
          if (diff < -maxTurnStep) diff = -maxTurnStep;
          comp.facingDir = (comp.facingDir + diff) & ANGLE_MASK;

          // Universal company-level traffic synchronization & overtaking (both in open field and narrow passages):
          // If a faster/running company marches behind a slower/exhausted friendly company:
          // - In open terrain, smoothly bias steering laterally to overtake around their flank.
          // - When directly blocked behind them or in a narrow passage, pace anchor speed to match them.
          let effectiveAnchorSpeedFx = anchorSpeedFx;
          if (comp.engagedTargetEntityId <= 0 && comp.engagedTargetBuildingId <= 0) {
            const onBridgeNow = isOnBridgeFx(comp.anchorXFx, comp.anchorZFx, gameState.centerMeters);
            const inNarrowCorridor = comp.squeezePermille < 920 || onBridgeNow;
            for (let ocIdx = 0; ocIdx < companyIds.length; ocIdx++) {
              const otherCid = companyIds[ocIdx];
              if (otherCid === comp.id) continue;
              const otherComp = companies.get(otherCid);
              if (
                !otherComp ||
                otherComp.team !== comp.team ||
                otherComp.garrisonedBuildingId > 0 ||
                otherComp.memberIds.length === 0
              ) {
                continue;
              }
              const relCx = (otherComp.anchorXFx - comp.anchorXFx) | 0;
              const relCz = (otherComp.anchorZFx - comp.anchorZFx) | 0;
              const distC = fxHypot(relCx, relCz);
              if (distC > 12 * FX_ONE || distC === 0) continue;
              const fwdProj =
                (mulDiv(relCx, bldSteer.vxFx, FX_ONE) + mulDiv(relCz, bldSteer.vzFx, FX_ONE)) | 0;
              const signedLatProj =
                (mulDiv(relCx, -bldSteer.vzFx, FX_ONE) + mulDiv(relCz, bldSteer.vxFx, FX_ONE)) | 0;
              const latProj = fxAbs(signedLatProj);
              if (fwdProj > 2 * FX_ONE && fwdProj <= 11 * FX_ONE && latProj <= 4 * FX_ONE + 512) {
                const otherPaceFx = otherComp.isActivelyMoving()
                  ? (otherComp.isRunning && (otherComp.staminaPermille | 0) > 0
                      ? mulDiv(otherComp.speedFx, 1450, 1000)
                      : otherComp.speedFx)
                  : (anchorSpeedFx >> 1);
                if (!inNarrowCorridor && anchorSpeedFx > otherPaceFx + 20) {
                  // Open field: gently sidestep around the slower company
                  const sideSign = signedLatProj >= 0 ? -1 : 1;
                  const candLatX = (comp.anchorXFx + sideSign * mulDiv(6 * FX_ONE, -bldSteer.vzFx, FX_ONE)) | 0;
                  const candLatZ = (comp.anchorZFx + sideSign * mulDiv(6 * FX_ONE, bldSteer.vxFx, FX_ONE)) | 0;
                  if (this.navGrid.isWalkableWorldFx(candLatX, candLatZ)) {
                    const origVx = bldSteer.vxFx;
                    const origVz = bldSteer.vzFx;
                    const newVx = (mulDiv(origVx, 820, 1000) + sideSign * mulDiv(-origVz, 380, 1000)) | 0;
                    const newVz = (mulDiv(origVz, 820, 1000) + sideSign * mulDiv(origVx, 380, 1000)) | 0;
                    const mag = Math.max(1, fxHypot(newVx, newVz));
                    bldSteer.vxFx = mulDiv(newVx, FX_ONE, mag);
                    bldSteer.vzFx = mulDiv(newVz, FX_ONE, mag);
                  }
                }
                if (inNarrowCorridor) {
                  effectiveAnchorSpeedFx = Math.min(
                    effectiveAnchorSpeedFx,
                    Math.max((anchorSpeedFx * 2) / 5 | 0, otherPaceFx | 0)
                  );
                }
              }
            }
          }

          const stepX = mulDiv(effectiveAnchorSpeedFx, bldSteer.vxFx, FX_ONE);
          const stepZ = mulDiv(effectiveAnchorSpeedFx, bldSteer.vzFx, FX_ONE);
          const clampedAnchor = this.collisionSystem.clampPointOutsideBuildingsFx(
            (comp.anchorXFx + stepX) | 0,
            (comp.anchorZFx + stepZ) | 0,
            1536,
            gameState.constructionSystem?.buildings,
            gameState.constructionSystem?.sortedBuildingIds
          );
          comp.anchorXFx = clampedAnchor.xFx;
          comp.anchorZFx = clampedAnchor.zFx;
          comp.anchorMovedThisTick = true;

          if (prof.canCharge && comp.isRunning && (comp.staminaPermille | 0) > 0) {
            comp.chargeRunDistFx = ((comp.chargeRunDistFx | 0) + anchorSpeedFx) | 0;
            if (comp.chargeRunDistFx >= CHARGE_MIN_RUN_DIST_FX) {
              comp.chargeMomentumPermille = fxClamp(
                mulDiv(comp.chargeRunDistFx, 1000, 14 * FX_ONE),
                250,
                1000
              );
            }
          } else {
            comp.chargeRunDistFx = 0;
            comp.chargeMomentumPermille = Math.max(
              0,
              ((comp.chargeMomentumPermille | 0) - 120) | 0
            );
          }
        }
      }

      const compStepVx = (comp.anchorXFx - prevCompAnchorXFx) | 0;
      const compStepVz = (comp.anchorZFx - prevCompAnchorZFx) | 0;
      if (comp.anchorMovedThisTick && (fxAbs(compStepVx) > 15 || fxAbs(compStepVz) > 15)) {
        comp._smoothVxFx = (((comp._smoothVxFx || 0) * 3 + compStepVx * 5) >> 3) | 0;
        comp._smoothVzFx = (((comp._smoothVzFx || 0) * 3 + compStepVz * 5) >> 3) | 0;
        comp.avgVxFx = comp._smoothVxFx;
        comp.avgVzFx = comp._smoothVzFx;
      } else {
        comp._smoothVxFx = 0;
        comp._smoothVzFx = 0;
        comp.avgVxFx = 0;
        comp.avgVzFx = 0;
      }
      if (!comp.isWorking) {
        comp.updateSlotTargets(this.navGrid, entitiesMap);
      }
    }
  }
}

import { unitLocomotionStepperMethods } from './unitLocomotionStepper.js';
Object.assign(MovementSystem.prototype, unitLocomotionStepperMethods);
