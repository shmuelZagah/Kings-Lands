/**
 * Kings Lands — Individual Unit Locomotion, A* Following, Lookahead Yielding & Mass Collision Step
 * (src/sim/systems/unitLocomotionStepper.js)
 */

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
import { SlotConstraints } from '../formations/company.js';
import { CHARGE_MIN_RUN_DIST_FX } from './combatSystem.js';

export const unitLocomotionStepperMethods = {
  update(gameState, { AnimState, UnitTypeIndex }) {
    const entitiesMap = gameState.entities;
    const sortedIds = gameState.sortedEntityIds;
    const worldMaxFx = (gameState.worldSizeFx - 12 * FX_ONE) | 0;
    const worldMinFx = 12 * FX_ONE;

    this._unitAStarBudget = 80;
    if (!this._tickRouteCache) this._tickRouteCache = new Map();
    else this._tickRouteCache.clear();
    this.spatialHash.rebuild(entitiesMap, sortedIds);
    {
      const bMap = gameState.constructionSystem?.buildings;
      const bIds = gameState.constructionSystem?.sortedBuildingIds;
      SlotConstraints.clampOutsideBuildings =
        bMap && bIds && bIds.length > 0
          ? (x, z, margin) =>
              this.collisionSystem.clampPointOutsideBuildingsFx(x, z, margin, bMap, bIds)
          : null;
    }
    this.combatSystem.beginTick(gameState, { AnimState, UnitTypeIndex });
    this._updateCompanies(gameState);

    for (let i = 0; i < sortedIds.length; i++) {
      const ent = entitiesMap.get(sortedIds[i]);
      if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;

      if ((ent.doorExitTicks | 0) > 0) {
        ent.doorExitTicks = (ent.doorExitTicks - 1) | 0;
        if (ent.doorExitTicks <= 0) {
          ent.doorExitBuildingId = 0;
        }
      }
      ent.preMoveX = ent.x | 0;
      ent.preMoveZ = ent.z | 0;
      ent.avgVxFx = 0;
      ent.avgVzFx = 0;

      const comp = gameState.companies?.get(ent.squadIndex);
      if (comp && comp.garrisonedBuildingId > 0) {
        ent.isGarrisoned = true;
        continue;
      }
      if (comp && comp.activeChargeRush) {
        ent.isMoving = true;
        ent.animState = AnimState.CHARGE ?? AnimState.RUN;
        continue;
      }

      const prof = this.getPhysicsProfile(ent.unitTypeIdx);

      if ((ent.knockbackSlideTicks | 0) > 0) {
        ent.knockbackSlideTicks = (ent.knockbackSlideTicks - 1) | 0;
        const kbX = fxClamp(
          (ent.x + (ent.knockbackVxFx || 0)) | 0,
          worldMinFx,
          worldMaxFx
        );
        const kbZ = fxClamp(
          (ent.z + (ent.knockbackVzFx || 0)) | 0,
          worldMinFx,
          worldMaxFx
        );

        if (this.navGrid.isWalkableWorldFx(kbX, kbZ)) {
          ent.x = kbX;
          ent.z = kbZ;
          ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
          const totalSlide = Math.max(1, ent.knockbackTotalSlideTicks || 8);
          const slideProgress = 1 - ent.knockbackSlideTicks / totalSlide;
          const peakAltFx = ent.knockbackPeakHeightFx || Math.round(1.05 * FX_ONE);
          ent.altitudeFx =
            ent.knockbackSlideTicks > 0
              ? Math.max(0, Math.round(Math.sin(slideProgress * Math.PI) * peakAltFx) | 0)
              : 0;
        } else {
          // Hit an unwalkable obstacle/cliff: land immediately instead of hanging in mid-air!
          ent.knockbackSlideTicks = 0;
          ent.altitudeFx = 0;
        }
        ent.windupTicks = 0;
        ent.shotWindupTicks = 0;
        if ((ent.actionCooldown | 0) > 0) {
          ent.actionCooldown = (ent.actionCooldown - 1) | 0;
        }
        if ((ent.knockdownTicks | 0) > 0) {
          ent.knockdownTicks = (ent.knockdownTicks - 1) | 0;
          ent.animState = AnimState.KNOCKED_DOWN ?? AnimState.HURT;
        } else {
          ent.animState = AnimState.HURT ?? AnimState.IDLE;
        }
        ent.isMoving = false;
        ent.waitTicks = 0;
        continue;
      }

      if (this.combatSystem.stepUnitCombat(ent, comp, prof, gameState, { AnimState, UnitTypeIndex })) {
        ent.avgVxFx = 0;
        ent.avgVzFx = 0;
        ent.waitTicks = 0;
        continue;
      }

      const baseUnitSpeedFx =
        comp && comp.activeGroupSpeedFx > 0 && comp.isActivelyMoving()
          ? Math.min(ent.speedFx | 0, comp.activeGroupSpeedFx | 0)
          : ent.speedFx | 0;

      const speedModPermille = this.navGrid.getSpeedMultiplierAtWorldFx(
        ent.x,
        ent.z,
        prof.isCavalry
      );
      let effectiveSpeedFx = mulDiv(
        baseUnitSpeedFx,
        speedModPermille > 0 ? speedModPermille : 500,
        PERMILLE_ONE
      );

      if (comp && this.moraleStaminaSystem) {
        const exhaustMult = this.moraleStaminaSystem.getExhaustionSpeedMultiplierPermille(comp);
        effectiveSpeedFx = mulDiv(effectiveSpeedFx, exhaustMult, PERMILLE_ONE);
      }

      if (!comp || !comp.isRunning || (comp.staminaPermille | 0) <= 0) {
        ent.chargeMomentumPermille = 0;
        ent.chargeRunDistFx = 0;
      }
      const wantsAndCanRun = Boolean(
        comp &&
          comp.isRunning &&
          (comp.staminaPermille | 0) > 0 &&
          ((comp.altGroupId | 0) > 0 ||
            comp.activeGroupSpeedFx <= 0 ||
            mulDiv(comp.activeGroupSpeedFx | 0, 1450, 1000) > mulDiv(ent.speedFx | 0, 1150, 1000))
      );
      const isUnitActivelyRunning = wantsAndCanRun;
      const isUnitChargingCloseToEnemy = Boolean(
        isUnitActivelyRunning &&
          !prof.isRanged &&
          ent.unitTypeIdx !== 0 &&
          !ent.isRouting &&
          (comp.staminaPermille | 0) >= 250 &&
          (comp.engagedTargetEntityId > 0 ||
            comp.engagedTargetBuildingId > 0 ||
            ent.hasCombatTarget)
      );

      if (isUnitActivelyRunning) {
        const unitRunMult =
          comp?.runSpeedMultPermille ||
          (isUnitChargingCloseToEnemy ? 1680 : 1450);
        effectiveSpeedFx = mulDiv(effectiveSpeedFx, unitRunMult, PERMILLE_ONE);
      }

      // Universal Hurt Reaction: if the unit just took damage and is not running/charging, pause briefly to play AnimState.HURT!
      if ((ent.hurtVisualTicks | 0) > 0 && !ent.isHero && ent.unitTypeIdx !== 5 && !isUnitActivelyRunning && !ent.isRouting) {
        ent.isMoving = false;
        ent.animState = AnimState.HURT ?? AnimState.IDLE;
        continue;
      }

      if (
        !ent.hasCombatTarget &&
        typeof ent.slotTargetXFx === 'number' &&
        typeof ent.slotTargetZFx === 'number' &&
        (!comp || !comp.isWorking)
      ) {
        ent.targetX = ent.slotTargetXFx;
        ent.targetZ = ent.slotTargetZFx;
      }

      const isCompanyEngagedInPlace = Boolean(
        comp && (comp.engagedTargetEntityId > 0 || comp.engagedTargetBuildingId > 0)
      );
      const stationaryAnimState =
        (ent.hurtVisualTicks | 0) > 0
          ? (AnimState.HURT ?? AnimState.IDLE)
          : comp &&
              (comp.formation === FormationTypes.SPEAR_WALL ||
                comp.formation === FormationTypes.PIKE_PHALANX) &&
              ent.unitTypeIdx === UnitTypeIndex.spearman
            ? AnimState.SPEAR_WALL_IDLE
            : isCompanyEngagedInPlace
              ? (AnimState.COMBAT_STANDBY ?? AnimState.IDLE)
              : AnimState.IDLE;

      if ((ent.yieldTicks | 0) > 0) {
        ent.yieldTicks = (ent.yieldTicks - 1) | 0;
        ent.settled = 0;
        ent.atSlot = 0;
        if (!(comp && comp.isActivelyMoving()) && !isCompanyEngagedInPlace && (!comp || !comp.isWorking)) {
          const yVx = ent.yieldVxFx | 0;
          const yVz = ent.yieldVzFx | 0;
          const homeX = typeof ent.slotTargetXFx === "number" ? ent.slotTargetXFx : ent.targetX;
          const homeZ = typeof ent.slotTargetZFx === "number" ? ent.slotTargetZFx : ent.targetZ;
          const dispFromHome = fxHypot((ent.x - homeX) | 0, (ent.z - homeZ) | 0);
          if ((yVx !== 0 || yVz !== 0) && dispFromHome < 2300) {
            const stepSpd = Math.min(effectiveSpeedFx, 165);
            const nx = fxClamp((ent.x + mulDiv(stepSpd, yVx, FX_ONE)) | 0, worldMinFx, worldMaxFx);
            const nz = fxClamp((ent.z + mulDiv(stepSpd, yVz, FX_ONE)) | 0, worldMinFx, worldMaxFx);
            if (this.navGrid.isWalkableWorldFx(nx, nz)) {
              ent.x = nx;
              ent.z = nz;
              ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
              const stepDir = fxAtan2(yVz, yVx);
              let dAng = ((stepDir - ent.dir + 512) & ANGLE_MASK) - 512;
              if (dAng > 64) dAng = 64;
              if (dAng < -64) dAng = -64;
              ent.dir = (ent.dir + dAng) & ANGLE_MASK;
              ent.isMoving = true;
              ent.waitTicks = 0;
              ent.stuckTicks = 0;
              ent.animState = AnimState.WALK;
              continue;
            }
          }
          ent.isMoving = false;
          ent.waitTicks = 0;
          ent.stuckTicks = 0;
          ent.animState = stationaryAnimState;
          continue;
        }
      }

      const dxGoal = (ent.targetX - ent.x) | 0;
      const dzGoal = (ent.targetZ - ent.z) | 0;
      const distToSlot = fxHypot(dxGoal, dzGoal);

      if (!ent.hasCombatTarget && (ent.settled | 0) === 1) {
        const slotMoved = fxHypot(
          (ent.targetX - ent.settledSlotX) | 0,
          (ent.targetZ - ent.settledSlotZ) | 0
        );
        const pushedDist = fxHypot(
          (ent.x - (ent.settledX ?? ent.x)) | 0,
          (ent.z - (ent.settledZ ?? ent.z)) | 0
        );
        if (
          !(comp && (comp.isActivelyMoving() || comp.anchorMovedThisTick)) &&
          slotMoved < 180 &&
          pushedDist < 220 &&
          distToSlot <= 340
        ) {
          const desiredDir =
            typeof ent.desiredFacingDir === "number"
              ? ent.desiredFacingDir
              : comp
                ? comp.facingDir
                : ent.dir;
          let angleDiff = ((desiredDir - ent.dir + 512) & ANGLE_MASK) - 512;
          if (fxAbs(angleDiff) <= 96) {
            ent.dir = desiredDir & ANGLE_MASK;
          } else {
            ent.dir = (ent.dir + (angleDiff > 0 ? 96 : -96)) & ANGLE_MASK;
          }
          ent.isMoving = false;
          ent.waitTicks = 0;
          ent.stuckTicks = 0;
          if (!comp || !comp.isWorking) ent.animState = stationaryAnimState;
          continue;
        }
        ent.settled = 0;
        ent.atSlot = 0;
      }

      if (distToSlot > 3 * FX_ONE && comp?.heroId !== "sisnat") {
        effectiveSpeedFx = mulDiv(effectiveSpeedFx, 1200, PERMILLE_ONE);
      }

      const compActivelyMarching = Boolean(
        comp &&
          !comp.isWorking &&
          (comp.anchorMovedThisTick ||
            (comp.isActivelyMoving() &&
              comp.engagedTargetEntityId <= 0 &&
              comp.engagedTargetBuildingId <= 0 &&
              fxHypot(comp.targetXFx - comp.anchorXFx, comp.targetZFx - comp.anchorZFx) >
                effectiveSpeedFx + 512))
      );

      if (compActivelyMarching || ent.hasCombatTarget) {
        ent.atSlot = 0;
      }

      const arrivalEnterFx = ent.hasCombatTarget
        ? (effectiveSpeedFx | 0)
        : Math.max((effectiveSpeedFx + 80) | 0, 240);
      const arrivalStayFx =
        compActivelyMarching || ent.hasCombatTarget ? (effectiveSpeedFx | 0) : 320;
      const effectiveArrivalFx = (ent.atSlot | 0) === 1 ? arrivalStayFx : arrivalEnterFx;

      if (distToSlot <= effectiveArrivalFx) {
        ent.atSlot = 1;
        let actualStepInFx = 0;
        if (distToSlot > 0) {
          const stepIn = Math.min(distToSlot, effectiveSpeedFx);
          const nx =
            distToSlot <= effectiveSpeedFx
              ? ent.targetX | 0
              : (ent.x + mulDiv(dxGoal, stepIn, distToSlot)) | 0;
          const nz =
            distToSlot <= effectiveSpeedFx
              ? ent.targetZ | 0
              : (ent.z + mulDiv(dzGoal, stepIn, distToSlot)) | 0;
          if (this.navGrid.isWalkableWorldFx(nx, nz)) {
            ent.x = nx;
            ent.z = nz;
            ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
            actualStepInFx = distToSlot <= 90 ? 0 : stepIn;
          }
        }
        ent.pathWaypoints = null;
        ent.pathIndex = 0;
        ent.waitTicks = 0;

        const desiredDir =
          typeof ent.desiredFacingDir === 'number'
            ? ent.desiredFacingDir
            : comp
              ? comp.facingDir
              : ent.dir;
        if (comp && comp.isWorking) {
          ent.dir = desiredDir & ANGLE_MASK;
        } else {
          let angleDiff = ((desiredDir - ent.dir + 512) & ANGLE_MASK) - 512;
          if (angleDiff > 96) angleDiff = 96;
          if (angleDiff < -96) angleDiff = -96;
          ent.dir = (ent.dir + angleDiff) & ANGLE_MASK;
        }

        const remDistFx = fxHypot((ent.targetX - ent.x) | 0, (ent.targetZ - ent.z) | 0);
        const stillPhysicallyMoving = Boolean(
          compActivelyMarching || (remDistFx > 80 && actualStepInFx >= 45)
        );
        if (!stillPhysicallyMoving) {
          ent.chargeRunDistFx = 0;
          ent.chargeMomentumPermille = Math.max(
            0,
            ((ent.chargeMomentumPermille | 0) - 80) | 0
          );
          if (!compActivelyMarching && !ent.hasCombatTarget) {
            ent.settled = 1;
            ent.settledX = ent.x;
            ent.settledZ = ent.z;
            ent.settledSlotX = ent.targetX;
            ent.settledSlotZ = ent.targetZ;
          }
        }

        ent.isMoving = stillPhysicallyMoving;
        if (stillPhysicallyMoving) {
          const walkCeilingFx = mulDiv(baseUnitSpeedFx | 0, 1120, 1000);
          ent.animState =
            isUnitActivelyRunning && actualStepInFx > walkCeilingFx
              ? (isUnitChargingCloseToEnemy ? (AnimState.CHARGE ?? AnimState.RUN) : AnimState.RUN)
              : AnimState.WALK;
        } else if (!comp || !comp.isWorking) {
          ent.animState = stationaryAnimState;
        }
        continue;
      }

      ent.atSlot = 0;
      ent.isMoving = true;

      let steerTargetX = ent.targetX | 0;
      let steerTargetZ = ent.targetZ | 0;

      if (Array.isArray(ent.pathWaypoints) && ent.pathIndex < ent.pathWaypoints.length) {
        const clearNow = this.astar.hasClearLineWorldFx(ent.x, ent.z, ent.targetX, ent.targetZ);
        if (!clearNow) {
          const wpsNow = ent.pathWaypoints;
          const lastWp = wpsNow[wpsNow.length - 1];
          const goalDrift = fxHypot((lastWp.xFx - ent.targetX) | 0, (lastWp.zFx - ent.targetZ) | 0);
          ent.routeAge = ((ent.routeAge | 0) + 1) | 0;
          if (goalDrift > 3 * FX_ONE && ent.routeAge >= 12) {
            const atEnd =
              ent.pathIndex >= wpsNow.length - 1 &&
              fxHypot((lastWp.xFx - ent.x) | 0, (lastWp.zFx - ent.z) | 0) <=
                effectiveSpeedFx + 2 * FX_ONE;
            if (atEnd || goalDrift > 6 * FX_ONE) {
              this.assignUnitAStarRoute(ent, ent.targetX, ent.targetZ, comp);
              ent.routeAge = 0;
            }
          }
        }
        if (clearNow) {
          ent.pathWaypoints = null;
          ent.pathIndex = 0;
        } else {
          const wp = ent.pathWaypoints[ent.pathIndex];
          const wpDist = fxHypot(wp.xFx - ent.x, wp.zFx - ent.z);
          if (wpDist <= effectiveSpeedFx + 1536 && ent.pathIndex < ent.pathWaypoints.length - 1) {
            ent.pathIndex = (ent.pathIndex + 1) | 0;
          }
          const activeWp = ent.pathWaypoints[ent.pathIndex];
          steerTargetX = activeWp.xFx | 0;
          steerTargetZ = activeWp.zFx | 0;
        }
      } else if ((ent.doorExitTicks | 0) <= 0) {
        const stx = this.navGrid.worldFxToTileX(ent.x);
        const stz = this.navGrid.worldFxToTileZ(ent.z);
        const gtx = this.navGrid.worldFxToTileX(ent.targetX);
        const gtz = this.navGrid.worldFxToTileZ(ent.targetZ);
        let clear = true;
        if (
          ent._clearStx === stx &&
          ent._clearStz === stz &&
          ent._clearGtx === gtx &&
          ent._clearGtz === gtz &&
          ent._clearBldSig === this.astar._bSig
        ) {
          clear = ent._clearCached !== false;
        } else {
          clear = this.astar.hasClearLineWorldFx(ent.x, ent.z, ent.targetX, ent.targetZ);
          ent._clearStx = stx;
          ent._clearStz = stz;
          ent._clearGtx = gtx;
          ent._clearGtz = gtz;
          ent._clearBldSig = this.astar._bSig;
          ent._clearCached = clear;
        }
        if (!clear) {
          this.assignUnitAStarRoute(ent, ent.targetX, ent.targetZ, comp);
          if (ent.pathWaypoints && ent.pathWaypoints.length > 0) {
            steerTargetX = ent.pathWaypoints[0].xFx;
            steerTargetZ = ent.pathWaypoints[0].zFx;
          }
        }
      }

      let seekVxFx = 0;
      let seekVzFx = 0;
      const dxSteer = (steerTargetX - ent.x) | 0;
      const dzSteer = (steerTargetZ - ent.z) | 0;
      const distSteer = fxHypot(dxSteer, dzSteer);
      if (distSteer > 0) {
        const rawVxFx = mulDiv(dxSteer, FX_ONE, distSteer);
        const rawVzFx = mulDiv(dzSteer, FX_ONE, distSteer);
        const avoided = this.collisionSystem.computeBuildingAvoidanceSteerFx(
          ent.x,
          ent.z,
          prof.radiusFx,
          rawVxFx,
          rawVzFx,
          distSteer,
          gameState.constructionSystem?.buildings,
          gameState.constructionSystem?.sortedBuildingIds,
          (ent.doorExitTicks | 0) > 0 ? (ent.doorExitBuildingId | 0) : -1
        );
        seekVxFx = avoided.vxFx;
        seekVzFx = avoided.vzFx;
      }

      const onBridge = isOnBridgeFx(ent.x, ent.z, gameState.centerMeters);

      // Human-Eye Lookahead Ray for Multi-Squad Movement & Narrow Chokepoints:
      // Casts a 2.8m forward ray along (seekVxFx, seekVzFx).
      // - If an ally ahead is stationary/slow, checks whether that ally has open lateral space to step into:
      //   * If YES (there is room beside them): signals them to yield sideways (yieldTicks) and advances smoothly!
      //   * If NO (they are boxed in by walls/crowd with nowhere to go): smoothly matches pace or holds without
      //     stop-start animation stuttering!
      if (!ent.hasCombatTarget && distToSlot > 1400 && (seekVxFx !== 0 || seekVzFx !== 0)) {
        const rayLenFx = Math.min(distToSlot, 2850);
        const aheadNeighbors = this.spatialHash.queryRadiusIds(
          ent.x,
          ent.z,
          rayLenFx,
          entitiesMap,
          this.collisionSystem._neighborScratch,
          -1,
          false
        );

        let boxedInBlockersAhead = 0;
        let yieldingBlockersAhead = 0;
        let slowestSameSquadPaceFx = effectiveSpeedFx;
        let gapSteerAccumFx = 0;

        for (let aIdx = 0; aIdx < aheadNeighbors.length; aIdx++) {
          const allyId = aheadNeighbors[aIdx];
          if (allyId === ent.id) continue;
          const ally = entitiesMap.get(allyId);
          if (!ally || ally.hp <= 0 || ally.team !== ent.team || ally.isGarrisoned) continue;

          const relAx = (ally.x - ent.x) | 0;
          const relAz = (ally.z - ent.z) | 0;
          const fwdAx = (mulDiv(relAx, seekVxFx, FX_ONE) + mulDiv(relAz, seekVzFx, FX_ONE)) | 0;
          if (fwdAx < 320 || fwdAx > rayLenFx || fwdAx >= distToSlot) continue;

          const signedPerpAx =
            (mulDiv(relAx, -seekVzFx, FX_ONE) + mulDiv(relAz, seekVxFx, FX_ONE)) | 0;
          const perpAx = fxAbs(signedPerpAx);
          if (perpAx > 740) continue;

          const sameSquad = ally.squadIndex === ent.squadIndex;
          const allyMoved = ally._lastActualMovedFx ?? 200;
          const isAllyAnchored =
            Boolean(ally.inCombatStandby) ||
            (ally.windupTicks | 0) > 0 ||
            (ally.actionCooldown | 0) > 0 ||
            (ally.reservedTargetId > 0 && !ally.isMoving);

          // If this is a unit from ANOTHER friendly squad in open terrain (e.g. passing through another squad):
          // steer into the gap beside them and signal them to actively walk sideways to open a corridor!
          if (!sameSquad && !isAllyAnchored && !onBridge) {
            const allyYieldSign = signedPerpAx > 0 ? 1 : signedPerpAx < 0 ? -1 : ((ally.id & 1) ? 1 : -1);
            ally.yieldTicks = Math.max(ally.yieldTicks | 0, 10);
            ally.yieldVxFx = (-seekVzFx * allyYieldSign) | 0;
            ally.yieldVzFx = (seekVxFx * allyYieldSign) | 0;
            ally.settled = 0;
            ally.atSlot = 0;
            const steerAwaySign = -allyYieldSign;
            gapSteerAccumFx = (gapSteerAccumFx + steerAwaySign * 420) | 0;
            yieldingBlockersAhead++;
            continue;
          }

          if (isAllyAnchored) {
            boxedInBlockersAhead += 2;
            continue;
          }

          if (!ally.isMoving || allyMoved < 28) {
            const latLeftX = (ally.x - mulDiv(1650, seekVzFx, FX_ONE)) | 0;
            const latLeftZ = (ally.z + mulDiv(1650, seekVxFx, FX_ONE)) | 0;
            const latRightX = (ally.x + mulDiv(1650, seekVzFx, FX_ONE)) | 0;
            const latRightZ = (ally.z - mulDiv(1650, seekVxFx, FX_ONE)) | 0;
            const canStepLeft = this.navGrid.isWalkableWorldFx(latLeftX, latLeftZ);
            const canStepRight = this.navGrid.isWalkableWorldFx(latRightX, latRightZ);
            const allyCrowd = (ally._crossOverlaps | 0);

            if ((canStepLeft || canStepRight) && allyCrowd < 3) {
              const stepSign = canStepLeft && canStepRight
                ? (signedPerpAx >= 0 ? 1 : -1)
                : canStepLeft
                  ? 1
                  : -1;
              ally.yieldTicks = Math.max(ally.yieldTicks | 0, 8);
              ally.yieldVxFx = (-seekVzFx * stepSign) | 0;
              ally.yieldVzFx = (seekVxFx * stepSign) | 0;
              ally.settled = 0;
              ally.atSlot = 0;
              yieldingBlockersAhead++;
            } else if (!sameSquad) {
              boxedInBlockersAhead++;
            } else if (!compActivelyMarching) {
              const sideSign = signedPerpAx > 0 ? -1 : signedPerpAx < 0 ? 1 : ((ent.id & 1) ? 1 : -1);
              gapSteerAccumFx = (gapSteerAccumFx + sideSign * 360) | 0;
            } else if (distToSlot <= 2 * FX_ONE) {
              slowestSameSquadPaceFx = Math.min(slowestSameSquadPaceFx, Math.max(85, effectiveSpeedFx >> 1));
            }
          } else if ((sameSquad || onBridge) && distToSlot <= 2 * FX_ONE && allyMoved < slowestSameSquadPaceFx) {
            slowestSameSquadPaceFx = Math.max(75, allyMoved);
          }
        }

        if (gapSteerAccumFx !== 0) {
          const clampedGapSteer = fxClamp(gapSteerAccumFx, -520, 520);
          const rawGx = (seekVxFx + mulDiv(-seekVzFx, clampedGapSteer, FX_ONE)) | 0;
          const rawGz = (seekVzFx + mulDiv(seekVxFx, clampedGapSteer, FX_ONE)) | 0;
          const gMag = Math.max(1, fxHypot(rawGx, rawGz));
          seekVxFx = mulDiv(rawGx, FX_ONE, gMag);
          seekVzFx = mulDiv(rawGz, FX_ONE, gMag);
        }

        if (boxedInBlockersAhead >= 2) {
          ent._rayBlockedTicks = ((ent._rayBlockedTicks | 0) + 1) | 0;
          if (ent._rayBlockedTicks >= 10 && !compActivelyMarching && distToSlot <= 1650) {
            ent.isMoving = false;
            if (!comp || !comp.isWorking) ent.animState = stationaryAnimState;
            continue;
          }
          if (ent._rayBlockedTicks >= 10 && distToSlot > 1650) {
            this.assignUnitAStarRoute(ent, ent.targetX, ent.targetZ, comp, true);
            ent._rayBlockedTicks = 0;
          }
          effectiveSpeedFx = Math.max(85, (effectiveSpeedFx >> 1) | 0);
        } else {
          ent._rayBlockedTicks = Math.max(0, ((ent._rayBlockedTicks | 0) - 2) | 0);
          if (boxedInBlockersAhead === 1) {
            effectiveSpeedFx = Math.min(effectiveSpeedFx, Math.max(65, (effectiveSpeedFx * 3) / 5 | 0));
          } else if (slowestSameSquadPaceFx < effectiveSpeedFx) {
            effectiveSpeedFx = Math.max((effectiveSpeedFx >> 1) | 0, slowestSameSquadPaceFx);
          }
        }
      }
      const boidsWeightPermille =
        ent.inCombatStandby || isCompanyEngagedInPlace
          ? 0
          : comp && comp.isWorking
            ? 150
            : onBridge
              ? 260
              : distToSlot <= 2 * FX_ONE
                ? 120
                : 450;

      const boids =
        boidsWeightPermille > 0
          ? this.collisionSystem.computeBoidsSeparationFx(ent, prof, entitiesMap)
          : { vxFx: 0, vzFx: 0 };
      const combinedVx =
        (seekVxFx + mulDiv(boids.vxFx, boidsWeightPermille, PERMILLE_ONE)) | 0;
      const combinedVz =
        (seekVzFx + mulDiv(boids.vzFx, boidsWeightPermille, PERMILLE_ONE)) | 0;

      const targetAngle =
        combinedVx !== 0 || combinedVz !== 0 ? fxAtan2(combinedVz, combinedVx) : ent.dir;

      // Prevent unicycle turning-radius orbiting when close to the slot (`distToSlot <= 3 * FX_ONE`) or closing into melee:
      // allow sharper turn rate and cap step distance to `distToSlot` so no unit or mounted Hero ever orbits its target in a circle!
      const isMountedUnit = Boolean(prof.isCavalry || comp?.isCavalry || ent.isMountedHero || ent.isWarhorseMounted);
      const maxTurnRate =
        distToSlot <= 2 * FX_ONE
          ? 256
          : ent.hasCombatTarget || distToSlot <= 4 * FX_ONE
            ? 128
            : isMountedUnit
              ? 52
              : 76;
      let angleDiff = ((targetAngle - ent.dir + 512) & ANGLE_MASK) - 512;
      const absTurnDiff = fxAbs(angleDiff);
      if (angleDiff > maxTurnRate) angleDiff = maxTurnRate;
      if (angleDiff < -maxTurnRate) angleDiff = -maxTurnRate;
      ent.dir = (ent.dir + angleDiff) & ANGLE_MASK;

      // Braking physics for mounted units turning sharply (slows down smoothly during U-turn, then accelerates on straightaway)
      const turnBrakePermille = isMountedUnit && absTurnDiff > 48 ? Math.max(420, 1000 - absTurnDiff * 2) : 1000;
      const brakedSpeedFx = turnBrakePermille < 1000 ? mulDiv(effectiveSpeedFx, turnBrakePermille, 1000) : effectiveSpeedFx;
      const clampedStepFx = Math.min(brakedSpeedFx, distToSlot);
      const useDirectSteer = distToSlot <= 2 * FX_ONE + 512;
      const stepVx = useDirectSteer
        ? mulDiv(clampedStepFx, fxCos(targetAngle), FX_ONE)
        : mulDiv(clampedStepFx, fxCos(ent.dir), FX_ONE);
      const stepVz = useDirectSteer
        ? mulDiv(clampedStepFx, fxSin(targetAngle), FX_ONE)
        : mulDiv(clampedStepFx, fxSin(ent.dir), FX_ONE);

      const candX = fxClamp(ent.x + stepVx, worldMinFx, worldMaxFx);
      const candZ = fxClamp(ent.z + stepVz, worldMinFx, worldMaxFx);

      if (this.navGrid.isWalkableWorldFx(candX, candZ)) {
        ent.x = candX;
        ent.z = candZ;
      } else if (this.navGrid.isWalkableWorldFx(candX, ent.z)) {
        ent.x = candX;
      } else if (this.navGrid.isWalkableWorldFx(ent.x, candZ)) {
        ent.z = candZ;
      } else {
        this.assignUnitAStarRoute(ent, ent.targetX, ent.targetZ, comp, true);
      }

      ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);

      const instVxFx = (ent.x - (ent.preMoveX ?? ent.x)) | 0;
      const instVzFx = (ent.z - (ent.preMoveZ ?? ent.z)) | 0;
      const actualMovedFx = fxHypot(instVxFx, instVzFx);
      ent._lastActualMovedFx = actualMovedFx;
      if (actualMovedFx >= 35) {
        ent._smoothVxFx = (((ent._smoothVxFx || 0) * 3 + instVxFx * 5) >> 3) | 0;
        ent._smoothVzFx = (((ent._smoothVzFx || 0) * 3 + instVzFx * 5) >> 3) | 0;
        ent.avgVxFx = ent._smoothVxFx;
        ent.avgVzFx = ent._smoothVzFx;
      } else {
        ent._smoothVxFx = 0;
        ent._smoothVzFx = 0;
        ent.avgVxFx = 0;
        ent.avgVzFx = 0;
      }

      if (prof.canCharge && comp && comp.isRunning && (comp.staminaPermille | 0) > 0 && actualMovedFx >= 90) {
        ent.chargeRunDistFx = ((ent.chargeRunDistFx | 0) + actualMovedFx) | 0;
        if (ent.chargeRunDistFx >= CHARGE_MIN_RUN_DIST_FX) {
          ent.chargeMomentumPermille = Math.max(
            ent.chargeMomentumPermille | 0,
            fxClamp(mulDiv(ent.chargeRunDistFx, 1000, 14 * FX_ONE), 250, 1000)
          );
        }
      } else if (!comp || !comp.isRunning || actualMovedFx < 40) {
        ent.chargeRunDistFx = 0;
        ent.chargeMomentumPermille = 0;
      }

      const walkCeilingFx = mulDiv(baseUnitSpeedFx | 0, 1120, 1000);
      ent.animState =
        (comp?.heroId === "sisnat" && actualMovedFx >= 45 && (comp?.engagedTargetEntityId > 0 || comp?._mountedPassState))
          ? (AnimState.CHARGE ?? AnimState.RUN)
          : isUnitActivelyRunning && actualMovedFx > walkCeilingFx
            ? (isUnitChargingCloseToEnemy ? (AnimState.CHARGE ?? AnimState.RUN) : AnimState.RUN)
            : AnimState.WALK;
    }

    this.collisionSystem.resolveMassCollisions(
      entitiesMap,
      sortedIds,
      worldMinFx,
      worldMaxFx,
      gameState.constructionSystem?.buildings,
      gameState.constructionSystem?.sortedBuildingIds
    );

    for (let i = 0; i < sortedIds.length; i++) {
      const ent = entitiesMap.get(sortedIds[i]);
      if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;

      if (!ent.isMoving) {
        const pushedDx = (ent.x - (ent.preMoveX ?? ent.x)) | 0;
        const pushedDz = (ent.z - (ent.preMoveZ ?? ent.z)) | 0;
        const pushedDistFx = fxHypot(pushedDx, pushedDz);
        if (
          pushedDistFx >= 45 &&
          (ent.knockbackSlideTicks | 0) <= 0 &&
          (ent.windupTicks | 0) <= 0 &&
          (ent.shotWindupTicks | 0) <= 0 &&
          (ent.hurtVisualTicks | 0) <= 0
        ) {
          // Keep ent.isMoving = false so the unit retains its stationary defender bracing on the next tick!
          ent.animState = AnimState.WALK;
          const stepAngle = fxAtan2(pushedDz, pushedDx);
          let diff = ((stepAngle - ent.dir + 512) & ANGLE_MASK) - 512;
          if (diff > 48) diff = 48;
          if (diff < -48) diff = -48;
          ent.dir = (ent.dir + diff) & ANGLE_MASK;
        }
        continue;
      }

      if ((ent.stuckTicks | 0) === 0) {
        ent.stuckRefX = ent.x;
        ent.stuckRefZ = ent.z;
      }
      ent.stuckTicks = ((ent.stuckTicks | 0) + 1) | 0;
      if (ent.stuckTicks >= 16) {
        const comp = gameState.companies?.get(ent.squadIndex);
        const engaged = Boolean(
          comp && (comp.engagedTargetEntityId > 0 || comp.engagedTargetBuildingId > 0)
        );
        const goalDist = fxHypot((ent.targetX - ent.x) | 0, (ent.targetZ - ent.z) | 0);
        const progressed = fxHypot((ent.x - ent.stuckRefX) | 0, (ent.z - ent.stuckRefZ) | 0);
        ent.stuckTicks = 0;
        if (progressed >= 700) {
          ent.wedgeCount = 0;
        } else if (!engaged && (goalDist > 1450 || (comp && comp.isActivelyMoving()))) {
          this.assignUnitAStarRoute(ent, ent.targetX, ent.targetZ, comp, true);
        }
        // Settle cleanly if within 1.45m of slot when company is stationary and unit cannot progress closer
        if (!engaged && !(comp && comp.isActivelyMoving()) && goalDist <= 1450 && progressed < 350) {
          ent.settled = 1;
          ent.atSlot = 1;
          ent.settledX = ent.x;
          ent.settledZ = ent.z;
          ent.settledSlotX = ent.targetX;
          ent.settledSlotZ = ent.targetZ;
          ent.isMoving = false;
          ent.waitTicks = 0;
          if (typeof ent.desiredFacingDir === 'number') {
            ent.dir = ent.desiredFacingDir & ANGLE_MASK;
          }
          ent.animState =
            comp &&
            (comp.formation === FormationTypes.SPEAR_WALL ||
              comp.formation === FormationTypes.PIKE_PHALANX) &&
            ent.unitTypeIdx === UnitTypeIndex.spearman
              ? AnimState.SPEAR_WALL_IDLE
              : AnimState.IDLE;
          continue;
        }
      }

      const netMovedFx = fxHypot(
        (ent.x - (ent.preMoveX ?? ent.x)) | 0,
        (ent.z - (ent.preMoveZ ?? ent.z)) | 0
      );

      if (netMovedFx < 55) {
        ent.waitTicks = ((ent.waitTicks | 0) + 1) | 0;
      } else {
        ent.waitTicks = 0;
      }

      if ((ent.waitTicks | 0) >= 6) {
        const comp = gameState.companies?.get(ent.squadIndex);
        const isCompanyEngaged = Boolean(
          comp && (comp.engagedTargetEntityId > 0 || comp.engagedTargetBuildingId > 0)
        );
        const distToGoal = fxHypot((ent.targetX - ent.x) | 0, (ent.targetZ - ent.z) | 0);

        if (isCompanyEngaged && distToGoal <= 6 * FX_ONE) {
          this.combatSystem.coreCombat.releaseAttackerSlot(ent);
          ent.inCombatStandby = true;
          ent.standbyLockTicks = 24;
          ent.isMoving = false;
          ent.targetX = ent.x;
          ent.targetZ = ent.z;
          ent.chargeMomentumPermille = 0;
          ent.chargeRunDistFx = 0;
          ent.waitTicks = 0;
          const desiredStandbyDir = comp ? comp.facingDir : ent.dir;
          let diffDir = ((desiredStandbyDir - ent.dir + 512) & ANGLE_MASK) - 512;
          if (diffDir > 24) diffDir = 24;
          if (diffDir < -24) diffDir = -24;
          ent.dir = (ent.dir + diffDir) & ANGLE_MASK;
          ent.animState = AnimState.COMBAT_STANDBY ?? AnimState.IDLE;
        } else if (
          !isCompanyEngaged &&
          !(comp && comp.isActivelyMoving()) &&
          distToGoal <= 1450 &&
          ((ent.waitTicks | 0) >= 12)
        ) {
          ent.settled = 1;
          ent.atSlot = 1;
          ent.settledX = ent.x;
          ent.settledZ = ent.z;
          ent.settledSlotX = ent.targetX;
          ent.settledSlotZ = ent.targetZ;
          ent.isMoving = false;
          ent.waitTicks = 0;
          if (typeof ent.desiredFacingDir === 'number') {
            ent.dir = ent.desiredFacingDir & ANGLE_MASK;
          }
          ent.animState =
            comp &&
            (comp.formation === FormationTypes.SPEAR_WALL ||
              comp.formation === FormationTypes.PIKE_PHALANX) &&
            ent.unitTypeIdx === UnitTypeIndex.spearman
              ? AnimState.SPEAR_WALL_IDLE
              : AnimState.IDLE;
        }
      }
    }
  },
};
