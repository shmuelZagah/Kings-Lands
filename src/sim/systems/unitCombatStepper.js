/**
 * Kings Lands — Individual Unit Melee & Ranged Combat Stepper, Standby Positioning & Charge Execution
 * (src/sim/systems/unitCombatStepper.js)
 */
/**
 * Kings Lands — Phase 6.7: Unit Combat, Building Siege Destruction, Calibrated Trample & Flank Wrapping
 * (src/sim/systems/unitCombatSystem.js)
 *
 * Upgrades in Phase 6.7:
 * 1. Full Building Siege & Destruction (Melee & Ranged):
 *    - Companies can target enemy buildings directly via right-click (`comp.targetEnemyBuildingId > 0`)
 *      or automatically engage enemy buildings during `ATTACK_MOVE`, `PATROL`, or when standing near them.
 *    - Melee units surround the building's perimeter (`footprintRadiusFx + prof.radiusFx + 650`) and
 *      strike it down using `prof.vsBuildingDamage`, while Archers fire ballistic volleys at it.
 *    - When a building's HP reaches 0, `constructionSystem.handleBuildingDestroyedInCombat` destroys it.
 * 2. Strict Per-Unit Running Momentum (`ent.chargeMomentumPermille >= 250`):
 *    - Walking units (even heavy cavalry) have 0 momentum and never trigger charge knockback.
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
  fxHypot,
  fxRandomRange
} from '../../core/fx.js';
import { FormationTypes } from '../formations/formations.js';
import { CompanyOrderType } from '../formations/company.js';
import { CombatSystem } from './combatSystem.js';

const COHESIVE_ANCHOR_LEASH_FX = 24 * FX_ONE;


export const unitCombatStepperMethods = {
  _stepRangedShot(ent, comp, prof, gameState, reloadMin, reloadMax, fire, targetEnt = null) {
    let targetSpeedFx = 0;
    if (targetEnt && targetEnt.isMoving) {
      targetSpeedFx = fxHypot(targetEnt.avgVxFx | 0, targetEnt.avgVzFx | 0);
    }
    // Predictive leading costs extra aim time before release and between arrows!
    const extraAimWindup = targetSpeedFx > 25 ? fxClamp((targetSpeedFx / 40) | 0, 2, 7) : 0;
    const extraLeadReload = targetSpeedFx > 25 ? fxClamp((targetSpeedFx / 15) | 0, 6, 20) : 0;

    const shotWindup = ((prof.windupTicks || 9) + extraAimWindup) | 0;
    const recovery = (prof.recoveryTicks == null ? 12 : prof.recoveryTicks) | 0;
    if ((ent.shotWindupTicks | 0) > 0) {
      ent.shotWindupTicks = (ent.shotWindupTicks - 1) | 0;
      if (ent.shotWindupTicks <= 0) {
        ent.ammo = Math.max(0, ((ent.ammo | 0) - 1) | 0);
        if (comp) comp.ticksSinceLastCombat = 0;
        fire();
        const cycle = (fxRandomRange(gameState, reloadMin, reloadMax) + extraLeadReload) | 0;
        const rest = Math.max(0, Math.min(recovery, cycle - shotWindup)) | 0;
        ent.actionCooldown = rest;
        ent.nextShotTicks = Math.max(shotWindup, cycle - rest) | 0;
      }
    } else if ((ent.actionCooldown | 0) <= 0) {
      ent.shotWindupTicks = (Math.max(shotWindup, ent.nextShotTicks | 0) + extraAimWindup) | 0;
      ent.nextShotTicks = 0;
    }
  },

  _computeOrderlyStandbyPositionFx(ent, comp, nearEnemy) {
    const facing = (comp ? comp.facingDir : ent.dir) & ANGLE_MASK;
    const forwardCos = fxCos(facing);
    const forwardSin = fxSin(facing);
    const rightX = -forwardSin;
    const rightZ = forwardCos;

    const relX = (ent.slotTargetXFx - (comp ? comp.anchorXFx : ent.x)) | 0;
    const relZ = (ent.slotTargetZFx - (comp ? comp.anchorZFx : ent.z)) | 0;
    const lateralOffsetFx =
      (mulDiv(relX, rightX, FX_ONE) + mulDiv(relZ, rightZ, FX_ONE)) | 0;
    const forwardOffsetFx =
      (mulDiv(relX, forwardCos, FX_ONE) + mulDiv(relZ, forwardSin, FX_ONE)) | 0;

    // Use the company's own cohesive slot target when available so rear ranks hold a rock-steady
    // company line instead of jittering every time an individual nearEnemy shifts!
    if (typeof ent.slotTargetXFx === "number" && typeof ent.slotTargetZFx === "number") {
      return {
        xFx: ent.slotTargetXFx | 0,
        zFx: ent.slotTargetZFx | 0
      };
    }
    const rearDepthOffsetFx = Math.max(0, Math.min(8 * FX_ONE, -forwardOffsetFx)) | 0;
    const standBackDistFx = (2 * FX_ONE + 700 + rearDepthOffsetFx) | 0;
    const baseLineX = (nearEnemy.x - mulDiv(standBackDistFx, forwardCos, FX_ONE)) | 0;
    const baseLineZ = (nearEnemy.z - mulDiv(standBackDistFx, forwardSin, FX_ONE)) | 0;

    return {
      xFx: (baseLineX + mulDiv(lateralOffsetFx, rightX, FX_ONE)) | 0,
      zFx: (baseLineZ + mulDiv(lateralOffsetFx, rightZ, FX_ONE)) | 0
    };
  },

  /**
   * Executes unit-level siege attack (ranged or melee) against an enemy building `targetBld`.
   */
  _stepUnitSiegeBuilding(
    ent,
    comp,
    prof,
    targetBld,
    hasAmmoForRanged,
    unitAttackRangeFx,
    reloadMin,
    reloadMax,
    gameState,
    AnimState
  ) {
    const footprintFx = Math.round((targetBld.footprintRadiusMeters || 4) * FX_ONE) | 0;
    const centerDistFx = fxHypot((targetBld.xFx - ent.x) | 0, (targetBld.zFx - ent.z) | 0);
    const perimDistFx = Math.max(0, (centerDistFx - footprintFx) | 0);

    if (hasAmmoForRanged) {
      if (perimDistFx <= unitAttackRangeFx) {
        ent.dir = fxAtan2((targetBld.zFx - ent.z) | 0, (targetBld.xFx - ent.x) | 0);
        ent.isMoving = false;
        ent.targetX = ent.x;
        ent.targetZ = ent.z;
        ent.animState = prof.maxAmmo === 1 ? AnimState.THROW : AnimState.SHOOT;

        this._stepRangedShot(ent, comp, prof, gameState, reloadMin, reloadMax, () =>
          this.coreCombat.spawnBallisticProjectile(
            gameState,
            ent,
            comp,
            prof,
            targetBld.xFx,
            targetBld.zFx,
            { damage: (ent.damage || prof.damage || 9) | 0, isBallista: Boolean(prof.isSiege || ent.unitTypeIdx === 6) }
          )
        );
        return true;
      }
      ent.shotWindupTicks = 0;
      ent.targetX = targetBld.xFx;
      ent.targetZ = targetBld.zFx;
      ent.hasCombatTarget = true;
      ent.atSlot = 0;
      ent.settled = 0;
      return false;
    }

    // Melee Building Siege:
    // Units stand right outside the building's solid perimeter (`footprintFx + prof.radiusFx + 360`)
    // and wrap cleanly around the building's circumference!
    const standRadiusFx = (footprintFx + (prof.radiusFx || 620) + 380) | 0;
    const meleeReachFromPerimFx = ((prof.radiusFx || 620) + 1150) | 0;

    if (perimDistFx <= meleeReachFromPerimFx) {
      ent.inCombatStandby = false;
      ent.dir = fxAtan2((targetBld.zFx - ent.z) | 0, (targetBld.xFx - ent.x) | 0);
      ent.isMoving = false;
      ent.targetX = ent.x;
      ent.targetZ = ent.z;

      if ((ent.actionCooldown | 0) <= 0) {
        ent.windupTicks = (prof.windupTicks || 7) | 0;
        ent.windupTargetId = -1;
        ent.windupBuildingId = targetBld.id;
        ent.windupWillBeBlocked = false;
        ent.animState = AnimState.ATTACK;
      } else {
        ent.animState = AnimState.IDLE;
      }
      return true;
    }

    // Distribute squad members in a full 360° ring around the building perimeter anchored on the squad's approach side
    const refX = comp ? comp.anchorXFx : ent.x;
    const refZ = comp ? comp.anchorZFx : ent.z;
    const baseApproachAngle = fxAtan2(
      (refZ - targetBld.zFx) | 0,
      (refX - targetBld.xFx) | 0
    );

    const sIdx = ent.slotIndex | 0;
    const sideSign = (sIdx & 1) === 0 ? 1 : -1;
    const stepIdx = ((sIdx + 1) >> 1) | 0;
    const angleStep = Math.max(28, Math.min(54, ((1600 * 163) / Math.max(2048, standRadiusFx)) | 0));
    const compSectorOffset = comp ? ((((comp.id | 0) * 73) & 255) - 128) : 0;
    const slotAngle = (baseApproachAngle + compSectorOffset + sideSign * stepIdx * angleStep) & ANGLE_MASK;

    const goalXFx = (targetBld.xFx + mulDiv(standRadiusFx, fxCos(slotAngle), FX_ONE)) | 0;
    const goalZFx = (targetBld.zFx + mulDiv(standRadiusFx, fxSin(slotAngle), FX_ONE)) | 0;

    if (
      this.coreCombat.hasTeammateBlockingForwardPath(
        ent,
        goalXFx,
        goalZFx,
        gameState.entities,
        prof
      )
    ) {
      if (perimDistFx <= 10 * FX_ONE && (ent.waitTicks | 0) >= 3) {
        ent.inCombatStandby = true;
        ent.isMoving = false;
        ent.targetX = ent.x;
        ent.targetZ = ent.z;
        ent.dir = fxAtan2((targetBld.zFx - ent.z) | 0, (targetBld.xFx - ent.x) | 0);
        ent.animState =
          (ent.hurtVisualTicks | 0) > 0
            ? (AnimState.HURT ?? AnimState.IDLE)
            : (AnimState.COMBAT_STANDBY ?? AnimState.IDLE);
        return true;
      }

      const wrapStep = this.coreCombat.computeFlankWrapStepFx(
        ent,
        goalXFx,
        goalZFx,
        comp,
        gameState.entities,
        prof
      );
      if (wrapStep) {
        ent.inCombatStandby = false;
        ent.targetX = wrapStep.xFx;
        ent.targetZ = wrapStep.zFx;
        ent.hasCombatTarget = true;
        ent.atSlot = 0;
        ent.settled = 0;
        return false;
      }

      if (perimDistFx <= 10 * FX_ONE) {
        ent.inCombatStandby = true;
        ent.isMoving = false;
        ent.targetX = ent.x;
        ent.targetZ = ent.z;
        ent.dir = fxAtan2((targetBld.zFx - ent.z) | 0, (targetBld.xFx - ent.x) | 0);
        ent.animState =
          (ent.hurtVisualTicks | 0) > 0
            ? (AnimState.HURT ?? AnimState.IDLE)
            : (AnimState.COMBAT_STANDBY ?? AnimState.IDLE);
        return true;
      }
    }

    ent.inCombatStandby = false;
    ent.targetX = goalXFx;
    ent.targetZ = goalZFx;
    ent.hasCombatTarget = true;
    ent.atSlot = 0;
    ent.settled = 0;
    return false;
  },

  stepUnitCombat(ent, comp, prof, gameState, { AnimState, UnitTypeIndex }) {
    const entitiesMap = gameState.entities;

    ent.hasCombatTarget = false;
    ent.ticksSinceLastHit = ((ent.ticksSinceLastHit | 0) + 1) | 0;

    // 1. Burning DoT & Burning Soldier Panic Reaction (חייל שעולה באש בורח ומתרוצץ בבהלה!)
    if ((ent.burningTicks | 0) > 0) {
      ent.burningTicks = (ent.burningTicks - 1) | 0;
      if (ent.burningTicks % 20 === 0) {
        ent.hp = Math.max(0, (ent.hp - 3) | 0);
        ent.ticksSinceLastHit = 0;
        if (ent.hp <= 0) {
          ent.animState = AnimState.DIE;
          this.coreCombat.releaseAttackerSlot(ent);
          return true;
        }
      }
      // Non-hero soldiers caught on fire panic and scramble erratically while flames burn on them
      if (!ent.isHero && (ent.knockdownTicks | 0) <= 0 && (ent.knockbackSlideTicks | 0) <= 0) {
        this.coreCombat.releaseAttackerSlot(ent);
        ent.windupTicks = 0;
        ent.shotWindupTicks = 0;
        ent.inCombatStandby = false;
        if (ent.burningPanicDir === undefined || ent.burningTicks % 12 === 0) {
          const baseDir = (ent.dir + 340 + ((ent.id * 197 + ent.burningTicks * 37) & 383)) & ANGLE_MASK;
          ent.burningPanicDir = baseDir;
        }
        const panicDir = ent.burningPanicDir & ANGLE_MASK;
        const panicStepFx = Math.max(140, mulDiv(ent.speedFx || 180, 1250, 1000));
        const candX = (ent.x + mulDiv(panicStepFx, fxCos(panicDir), FX_ONE)) | 0;
        const candZ = (ent.z + mulDiv(panicStepFx, fxSin(panicDir), FX_ONE)) | 0;
        if (this.navGrid.isWalkableWorldFx(candX, candZ)) {
          ent.x = candX;
          ent.z = candZ;
          ent.y = this.navGrid.sampleHeightAtWorldFx(candX, candZ);
        } else {
          ent.burningPanicDir = (panicDir + 512) & ANGLE_MASK;
        }
        ent.dir = ent.burningPanicDir;
        ent.isMoving = true;
        ent.animState = AnimState.RUN;
        return true;
      }
    }

    // 2. Knockdown State Recovery & Chameleon Roar Freeze State
    if ((ent.knockdownTicks | 0) > 0) {
      ent.altitudeFx = 0;
      ent.knockdownTicks = (ent.knockdownTicks - 1) | 0;
      ent.windupTicks = 0;
      ent.shotWindupTicks = 0;
      ent.isMoving = false;
      ent.inCombatStandby = false;
      ent.animState = AnimState.KNOCKED_DOWN ?? AnimState.HURT;
      return true;
    }
    if ((ent.frozenTicks | 0) > 0) {
      ent.frozenTicks = (ent.frozenTicks - 1) | 0;
      ent.windupTicks = 0;
      ent.shotWindupTicks = 0;
      ent.isMoving = false;
      ent.inCombatStandby = false;
      ent.animState = AnimState.IDLE;
      return true;
    }
    // Universal Hero Cast Lock: a Hero cannot cast a spell and continue fighting/moving at the same time (except Sisnat Unstoppable Charge)!
    if ((ent.activeSpellTimerTicks | 0) > 0 && !(comp && comp.activeChargeRush)) {
      ent.windupTicks = 0;
      ent.shotWindupTicks = 0;
      ent.isMoving = false;
      ent.inCombatStandby = false;
      ent.targetX = ent.x;
      ent.targetZ = ent.z;
      ent.animState = AnimState.IDLE;
      return true;
    }

    // 3. Visual Block & Hurt Pose Timers
    if ((ent.blockVisualTicks | 0) > 0) {
      ent.blockVisualTicks = (ent.blockVisualTicks - 1) | 0;
    }
    if ((ent.hurtVisualTicks | 0) > 0) {
      ent.hurtVisualTicks = (ent.hurtVisualTicks - 1) | 0;
    }
    if ((ent.hurtImmunityTicks | 0) > 0) {
      ent.hurtImmunityTicks = (ent.hurtImmunityTicks - 1) | 0;
    }
    if ((ent.standbyLockTicks | 0) > 0) {
      ent.standbyLockTicks = (ent.standbyLockTicks - 1) | 0;
    }

    // 4. Routing units flee and never engage in combat
    if (comp && comp.orderType === CompanyOrderType.ROUTING) {
      this.coreCombat.releaseAttackerSlot(ent);
      ent.windupTicks = 0;
      ent.shotWindupTicks = 0;
      ent.inCombatStandby = false;
      return false;
    }

    if (ent.actionCooldown > 0) {
      ent.actionCooldown = (ent.actionCooldown - 1) | 0;
    }

    const isSpearWallLocked = Boolean(comp && comp.isSpearWallLocked);
    const isRampaging = Boolean(comp && comp.orderType === CompanyOrderType.RAMPAGE);
    const lockedEnemySquadId =
      comp && !isRampaging ? (comp.targetEnemyCompanyId | 0) : -1;
    const lockedEnemyBldId =
      comp && !isRampaging ? (comp.targetEnemyBuildingId | 0) : -1;
    const hasAmmoForRanged = Boolean((ent.isRanged !== undefined ? ent.isRanged : prof.isRanged) && (ent.ammo | 0) > 0);

    // Phase 6.7 Fix #4: Only use the unit's own running momentum (`ent.chargeMomentumPermille >= 250`)!
    const unitMomentum = ent.chargeMomentumPermille | 0;
    const hasActiveChargeMomentum = unitMomentum >= 250;

    let unitAttackRangeFx = hasAmmoForRanged
      ? (ent.attackRangeFx || prof.attackRangeFx) | 0
      : ((ent.isHero ? (ent.meleeAttackRangeFx || ent.attackRangeFx) : 0) || prof.meleeAttackRangeFx || ent.attackRangeFx || prof.attackRangeFx) | 0;
    if (!hasAmmoForRanged && (ent.isHero || ent.unitTypeIdx === 5)) {
      const minHeroMeleeRangeFx =
        prof.isCavalry || comp?.isCavalry || ent.isMountedHero || ent.isWarhorseMounted
          ? 3650
          : 3150;
      if (unitAttackRangeFx < minHeroMeleeRangeFx) {
        unitAttackRangeFx = minHeroMeleeRangeFx;
      }
    }

    if (
      !hasAmmoForRanged &&
      comp &&
      comp.formation === FormationTypes.PIKE_PHALANX &&
      (comp.stanceTransitionTicks | 0) <= 0
    ) {
      unitAttackRangeFx = (unitAttackRangeFx + 650) | 0;
    }

    const unitBaseDamage = hasAmmoForRanged
      ? (ent.damage || prof.damage) | 0
      : ((ent.isHero ? (ent.meleeDamage || ent.damage) : 0) || prof.meleeDamage || ent.damage || prof.damage) | 0;

    let reloadMin = (ent.reloadMinTicks || prof.reloadMinTicks || 18) | 0;
    let reloadMax = (ent.reloadMaxTicks || prof.reloadMaxTicks || 24) | 0;
    if (hasAmmoForRanged && comp?.ammoType === 'FIRE_ARROW') {
      reloadMin = mulDiv(reloadMin, 1350, 1000);
      reloadMax = mulDiv(reloadMax, 1350, 1000);
    }

    // 5. Resolve Active Melee Windup in Progress (Unit OR Building Target)
    if (
      (ent.windupTicks | 0) > 0 &&
      (ent.windupBuildingId | 0) <= 0 &&
      comp &&
      (comp.activeChargeRush ||
        comp._mountedPassState === "PASS_THROUGH" ||
        comp._mountedPassState === "TURN_AND_RECHARGE" || comp._mountedPassState === "CURVE_TURN_AROUND")
    ) {
      // Mounted Hero swinging weapon on upperLayer while continuing to gallop forward on lowerLayer!
      ent.windupTicks = (ent.windupTicks - 1) | 0;
    } else if ((ent.windupTicks | 0) > 0) {
      if ((ent.windupBuildingId | 0) > 0) {
        const bld = gameState.constructionSystem?.buildings?.get(ent.windupBuildingId | 0);
        if (!bld || bld.isDestroyed || bld.type === 'citadel_slot' || bld.hp <= 0) {
          ent.windupTicks = 0;
          ent.windupBuildingId = -1;
        } else {
          ent.dir = fxAtan2((bld.zFx - ent.z) | 0, (bld.xFx - ent.x) | 0);
          ent.isMoving = false;
          ent.animState = AnimState.ATTACK;
          ent.windupTicks = (ent.windupTicks - 1) | 0;

          if (ent.windupTicks <= 0) {
            ent.windupBuildingId = -1;
            if (comp) comp.ticksSinceLastCombat = 0;
            let bldDmg = (ent.isHero ? Math.max(unitBaseDamage, prof.vsBuildingDamage || 6) : (prof.vsBuildingDamage || unitBaseDamage || 6)) | 0;
            if (ent.isBuffed || comp?.hasBannerBuff) {
              bldDmg = mulDiv(bldDmg, 1200, 1000);
            }
            const bDef = gameState.constructionSystem?.buildingDefs?.[bld.type];
            const meleeProtPermille = bDef?.meleeProtectionPermille ?? 350;
            bldDmg = Math.max(1, mulDiv(bldDmg, Math.max(150, 1000 - meleeProtPermille), 1000));
            bld.hp = Math.max(0, (bld.hp - bldDmg) | 0);
            if (bld.hp <= 0) {
              gameState.constructionSystem?.handleBuildingDestroyedInCombat?.(bld, gameState);
            }
            ent.actionCooldown = fxRandomRange(gameState, reloadMin, reloadMax);
          }
          return true;
        }
      } else {
        const windupTarget = entitiesMap.get(ent.windupTargetId);
        const windupDistFx = windupTarget
          ? fxHypot((windupTarget.x - ent.x) | 0, (windupTarget.z - ent.z) | 0)
          : 0x7fffffff;
        if (
          !windupTarget ||
          windupTarget.hp <= 0 ||
          windupTarget.isGarrisoned ||
          windupDistFx > (unitAttackRangeFx + 1100)
        ) {
          ent.windupTicks = 0;
          ent.windupTargetId = -1;
        } else {
          ent.dir = fxAtan2((windupTarget.z - ent.z) | 0, (windupTarget.x - ent.x) | 0);
          ent.isMoving = false;
          ent.animState = AnimState.ATTACK;
          ent.windupTicks = (ent.windupTicks - 1) | 0;

          if (ent.windupWillBeBlocked && (windupTarget.knockdownTicks | 0) <= 0) {
            windupTarget.blockVisualTicks = Math.max(windupTarget.blockVisualTicks | 0, 4);
            windupTarget.animState = AnimState.BLOCK ?? AnimState.IDLE;
          }

          if (ent.windupTicks <= 0) {
            const defProf = gameState.movementSystem.getPhysicsProfile(windupTarget.unitTypeIdx);
            const defComp = gameState.companies?.get(windupTarget.squadIndex) || null;

            if (comp) {
              comp.ticksSinceLastCombat = 0;
            }

            if (ent.windupWillBeBlocked && (windupTarget.knockdownTicks | 0) <= 0) {
              windupTarget.blockVisualTicks = 6;
              windupTarget.animState = AnimState.BLOCK ?? AnimState.IDLE;
            } else {
              const arcInfo = this.coreCombat.classifyAttackArc(ent.x, ent.z, windupTarget);
              const finalDmg = this.coreCombat.computeResolvedDamage(
                unitBaseDamage,
                ent,
                comp,
                windupTarget,
                defProf,
                defComp,
                arcInfo,
                false
              );
              windupTarget.hp = Math.max(0, (windupTarget.hp - finalDmg) | 0);
              windupTarget.ticksSinceLastHit = 0;

              if (defComp) {
                defComp.ticksSinceLastCombat = 0;
                gameState.moraleStaminaSystem?.onUnitDamaged(
                  defComp,
                  defProf,
                  arcInfo.arc,
                  false,
                  false
                );
              }

              if (windupTarget.hp <= 0) {
                windupTarget.animState = AnimState.DIE;
                this.coreCombat.releaseAttackerSlot(windupTarget);
              } else {
                this.coreCombat.applyDamageHurtReaction(windupTarget, defComp, AnimState);
              }
            }
            ent.actionCooldown = fxRandomRange(gameState, reloadMin, reloadMax);
          }
          return true;
        }
      }
    }

    // 6. Continuous Trample Plow-Through (Strictly for Mounted Cavalry charging lighter infantry!)
    const isHeavyChargerUnit = Boolean(prof.isCavalry && comp && comp.isRunning && unitMomentum >= 250);
    if (!hasAmmoForRanged && hasActiveChargeMomentum && isHeavyChargerUnit) {
      const trampleContactRadFx = ((prof.radiusFx || 620) + 1550) | 0;
      const trampleRes = this.findNearestEnemyEntity(
        ent.x,
        ent.z,
        trampleContactRadFx,
        ent.team,
        entitiesMap,
        {
          canHitFlying: Boolean(ent.isFlying),
          attackAllTeams: isRampaging,
          excludeEntityId: ent.lastTrampledTargetId || -1,
          preferUnknocked: true
        }
      );

      if (trampleRes.enemy && (trampleRes.enemy.knockdownTicks | 0) <= 0) {
        const defProf = gameState.movementSystem.getPhysicsProfile(trampleRes.enemy.unitTypeIdx);
        const defComp = gameState.companies?.get(trampleRes.enemy.squadIndex) || null;
        const chargeRes = this.coreCombat.resolveChargeAndTrampleImpact(
          ent,
          comp,
          prof,
          trampleRes.enemy,
          defComp,
          defProf,
          gameState,
          AnimState
        );

        if (chargeRes && chargeRes.triggered) {
          if (chargeRes.chargerKnockedDownByAntiCharge) {
            return true;
          }

          if (chargeRes.causesDefenderKnockdown && chargeRes.remainingMomentum >= 250) {
            const nextStandingRes = this.findNearestEnemyEntity(
              ent.x,
              ent.z,
              22 * FX_ONE,
              ent.team,
              entitiesMap,
              {
                canHitFlying: Boolean(ent.isFlying),
                attackAllTeams: isRampaging,
                excludeEntityId: trampleRes.enemy.id,
                onlySquadIndex: lockedEnemySquadId,
                preferUnknocked: true
              }
            );

            if (nextStandingRes.enemy && (nextStandingRes.enemy.knockdownTicks | 0) <= 0) {
              ent.inCombatStandby = false;
              ent.targetX = nextStandingRes.enemy.x;
              ent.targetZ = nextStandingRes.enemy.z;
              ent.hasCombatTarget = true;
              ent.atSlot = 0;
              ent.settled = 0;
              ent.isMoving = true;
              return false;
            }
          }

          ent.actionCooldown = fxRandomRange(gameState, reloadMin, reloadMax);
          return true;
        }
      }
    }

    // 7. Explicit or Engaged Building Siege Attack
    if (
      comp &&
      !comp.isWorking &&
      (comp.engagedTargetBuildingId > 0 || lockedEnemyBldId > 0)
    ) {
      const bldId =
        comp.engagedTargetBuildingId > 0 ? comp.engagedTargetBuildingId : lockedEnemyBldId;
      const targetBld = gameState.constructionSystem?.buildings?.get(bldId | 0);
      if (
        targetBld &&
        !targetBld.isDestroyed &&
        targetBld.type !== 'citadel_slot' &&
        targetBld.hp > 0 &&
        targetBld.team !== ent.team
      ) {
        this.coreCombat.releaseAttackerSlot(ent);
        return this._stepUnitSiegeBuilding(
          ent,
          comp,
          prof,
          targetBld,
          hasAmmoForRanged,
          unitAttackRangeFx,
          reloadMin,
          reloadMax,
          gameState,
          AnimState
        );
      }
    }

    if (
      comp &&
      (comp._mountedPassState === "PASS_THROUGH" || comp._mountedPassState === "TURN_AND_RECHARGE" || comp._mountedPassState === "CURVE_TURN_AROUND")
    ) {
      this.coreCombat.releaseAttackerSlot(ent);
      ent.inCombatStandby = false;
      return false;
    }

    if (comp && (comp.engagedTargetEntityId > 0 || isRampaging) && !comp.isWorking) {
      // A. Ranged Combat (Archers — 115m Range, respecting Fire at Will vs Fire by Order)
      if (hasAmmoForRanged) {
        this.coreCombat.releaseAttackerSlot(ent);
        ent.inCombatStandby = false;

        if (comp.fireAtWill === false && lockedEnemySquadId < 0 && lockedEnemyBldId <= 0) {
          return false;
        }

        const res = this.findNearestEnemyEntity(
          ent.x,
          ent.z,
          (unitAttackRangeFx + 14 * FX_ONE) | 0,
          ent.team,
          entitiesMap,
          {
            canHitFlying: true,
            attackAllTeams: isRampaging,
            excludeEntityId: ent.id,
            onlySquadIndex: lockedEnemySquadId
          }
        );

        const enemy = res.enemy;
        if (!enemy || enemy.hp <= 0 || res.distFx > unitAttackRangeFx) ent.shotWindupTicks = 0; // target lost: the draw is abandoned
        if (enemy && enemy.hp > 0) {
          ent.targetEntityId = enemy.id;
          if (res.distFx <= unitAttackRangeFx) {
            ent.dir = fxAtan2((enemy.z - ent.z) | 0, (enemy.x - ent.x) | 0);
            ent.isMoving = false;
            ent.targetX = ent.x;
            ent.targetZ = ent.z;
            ent.animState = prof.maxAmmo === 1 ? AnimState.THROW : AnimState.SHOOT;

            this._stepRangedShot(
              ent,
              comp,
              prof,
              gameState,
              reloadMin,
              reloadMax,
              () =>
                this.coreCombat.spawnBallisticProjectile(
                  gameState,
                  ent,
                  comp,
                  prof,
                  enemy.x,
                  enemy.z,
                  { damage: unitBaseDamage, targetEnt: enemy, isBallista: Boolean(prof.isSiege || ent.unitTypeIdx === 6) }
                ),
              enemy
            );
            return true;
          } else if (!isSpearWallLocked) {
            ent.targetX = enemy.x;
            ent.targetZ = enemy.z;
            ent.hasCombatTarget = true;
            ent.atSlot = 0;
            ent.settled = 0;
            return false;
          }
        }
      } else {
        // B. Melee Combat (3 Slots per Target + Total War Flank-Wrapping + Standby Chain)
        const leashFromAnchorFx = isRampaging ? 40 * FX_ONE : COHESIVE_ANCHOR_LEASH_FX;
        const scanRadFx = isSpearWallLocked ? unitAttackRangeFx : 26 * FX_ONE;

        let targetEnemy = null;
        let distFx = 0x7fffffff;

        if (ent.reservedTargetId > 0) {
          const prev = entitiesMap.get(ent.reservedTargetId);
          if (
            prev &&
            prev.hp > 0 &&
            !prev.isGarrisoned &&
            (isRampaging || prev.team !== ent.team) &&
            (lockedEnemySquadId < 0 || (prev.squadIndex | 0) === lockedEnemySquadId) &&
            (!prev.isFlying || ent.isFlying)
          ) {
            const dFromAnchor = fxHypot(
              (prev.x - comp.anchorXFx) | 0,
              (prev.z - comp.anchorZFx) | 0
            );
            const blockedToReserved = this.coreCombat.hasTeammateBlockingForwardPath(
              ent,
              prev.x,
              prev.z,
              entitiesMap,
              prof
            );
            if (dFromAnchor <= leashFromAnchorFx + 4 * FX_ONE && !blockedToReserved) {
              const slotIdx = this.coreCombat.reserveMeleeSlot(ent, prev, entitiesMap);
              if (slotIdx !== -1) {
                targetEnemy = prev;
                distFx = fxHypot((prev.x - ent.x) | 0, (prev.z - ent.z) | 0);
              }
            }
          }
          if (!targetEnemy) {
            this.coreCombat.releaseAttackerSlot(ent);
          }
        }

        if (!targetEnemy) {
          const resWithSlot = this.findNearestEnemyEntity(
            ent.x,
            ent.z,
            scanRadFx,
            ent.team,
            entitiesMap,
            {
              canHitFlying: Boolean(ent.isFlying),
              attackAllTeams: isRampaging,
              excludeEntityId: ent.id,
              requireFreeMeleeSlot: true,
              attackerId: ent.id,
              attackerEnt: ent,
              attackerProf: prof,
              anchorXFx: comp.anchorXFx,
              anchorZFx: comp.anchorZFx,
              maxDistFromAnchorFx: leashFromAnchorFx,
              onlySquadIndex: lockedEnemySquadId,
              preferUnknocked: true,
              preferUnobstructed: true
            }
          );

          if (resWithSlot.enemy) {
            const slotIdx = this.coreCombat.reserveMeleeSlot(
              ent,
              resWithSlot.enemy,
              entitiesMap
            );
            if (slotIdx !== -1) {
              targetEnemy = resWithSlot.enemy;
              distFx = resWithSlot.distFx;
            }
          }
        }

        if (targetEnemy) {
          const defProf = gameState.movementSystem.getPhysicsProfile(targetEnemy.unitTypeIdx);
          const defComp = gameState.companies?.get(targetEnemy.squadIndex) || null;

          const isHeavyPlowingCharger = Boolean(
            prof.isCavalry &&
              comp &&
              comp.isRunning &&
              unitMomentum >= 350 &&
              (defProf.isRanged || (defProf.mass || 120) <= 95)
          );
          const extraTargetRadFx = Math.max(0, ((defProf?.radiusFx || 620) - 620) | 0);
          const effectiveStrikeRangeFx = (unitAttackRangeFx + extraTargetRadFx) | 0;

          if (distFx <= effectiveStrikeRangeFx && !isHeavyPlowingCharger) {
            ent.inCombatStandby = false;
            ent.targetEntityId = targetEnemy.id;

            if (hasActiveChargeMomentum) {
              const chargeRes = this.coreCombat.resolveChargeAndTrampleImpact(
                ent,
                comp,
                prof,
                targetEnemy,
                defComp,
                defProf,
                gameState,
                AnimState
              );
              if (chargeRes && chargeRes.triggered) {
                ent.actionCooldown = fxRandomRange(gameState, reloadMin, reloadMax);
                return true;
              }
            }

            ent.dir = fxAtan2((targetEnemy.z - ent.z) | 0, (targetEnemy.x - ent.x) | 0);
            ent.isMoving = false;
            ent.targetX = ent.x;
            ent.targetZ = ent.z;

            if ((ent.blockVisualTicks | 0) > 0) {
              ent.animState = AnimState.BLOCK ?? AnimState.IDLE;
              return true;
            }
            if ((ent.hurtVisualTicks | 0) > 0 && !ent.isHero && ent.unitTypeIdx !== 5 && (ent.actionCooldown | 0) > 0) {
              ent.animState = AnimState.HURT ?? AnimState.IDLE;
              return true;
            }

            if ((ent.actionCooldown | 0) <= 0) {
              const blockCheck = this.coreCombat.rollDeterministicFrontalBlock(
                gameState,
                ent,
                prof,
                targetEnemy,
                defProf,
                false
              );
              ent.windupTicks = (prof.windupTicks || 7) | 0;
              ent.windupTargetId = targetEnemy.id;
              ent.windupBuildingId = -1;
              ent.windupWillBeBlocked = blockCheck.blocked;
              ent.animState = AnimState.ATTACK;

              if (blockCheck.blocked && (targetEnemy.knockdownTicks | 0) <= 0) {
                targetEnemy.blockVisualTicks = ent.windupTicks + 2;
                targetEnemy.animState = AnimState.BLOCK ?? AnimState.IDLE;
              }
            } else {
              ent.animState =
                comp.formation === FormationTypes.SPEAR_WALL &&
                ent.unitTypeIdx === UnitTypeIndex.spearman
                  ? AnimState.SPEAR_WALL_IDLE
                  : AnimState.IDLE;
            }
            return true;
          }

          if (
            !isHeavyPlowingCharger &&
            this.coreCombat.hasTeammateBlockingForwardPath(
              ent,
              targetEnemy.x,
              targetEnemy.z,
              entitiesMap,
              prof
            )
          ) {
            if (!isSpearWallLocked && (ent.standbyLockTicks | 0) <= 0 && (ent.waitTicks | 0) < 3) {
              const wrapStep = this.coreCombat.computeFlankWrapStepFx(
                ent,
                targetEnemy.x,
                targetEnemy.z,
                comp,
                entitiesMap,
                prof
              );
              if (wrapStep) {
                ent.inCombatStandby = false;
                ent.targetX = wrapStep.xFx;
                ent.targetZ = wrapStep.zFx;
                ent.hasCombatTarget = true;
                ent.atSlot = 0;
                ent.settled = 0;
                return false;
              }
            }

            this.coreCombat.releaseAttackerSlot(ent);
            ent.inCombatStandby = true;
            ent.standbyLockTicks = 24;
            ent.isMoving = false;
            ent.targetX = ent.x;
            ent.targetZ = ent.z;
            ent.chargeMomentumPermille = 0;
            ent.chargeRunDistFx = 0;
            const targetComp = gameState.companies?.get(targetEnemy.squadIndex) || null;
            const compFrontDir =
              comp && targetComp
                ? fxAtan2(
                    (targetComp.anchorZFx - comp.anchorZFx) | 0,
                    (targetComp.anchorXFx - comp.anchorXFx) | 0
                  )
                : comp
                  ? comp.facingDir
                  : fxAtan2((targetEnemy.z - ent.z) | 0, (targetEnemy.x - ent.x) | 0);
            let diffDir = ((compFrontDir - ent.dir + 512) & ANGLE_MASK) - 512;
            if (diffDir > 24) diffDir = 24;
            if (diffDir < -24) diffDir = -24;
            ent.dir = (ent.dir + diffDir) & ANGLE_MASK;
            ent.animState =
              (ent.hurtVisualTicks | 0) > 0
                ? (AnimState.HURT ?? AnimState.IDLE)
                : (AnimState.COMBAT_STANDBY ?? AnimState.IDLE);
            return true;
          }

          if (!isSpearWallLocked) {
            ent.inCombatStandby = false;
            ent.targetEntityId = targetEnemy.id;

            if (isHeavyPlowingCharger) {
              ent.targetX = targetEnemy.x;
              ent.targetZ = targetEnemy.z;
              ent.hasCombatTarget = true;
              ent.atSlot = 0;
              ent.settled = 0;
              return false;
            }

            const approachAngleIdx = fxAtan2(
              (ent.z - targetEnemy.z) | 0,
              (ent.x - targetEnemy.x) | 0
            );
            const slotPos = this.coreCombat.computeSlotWorldPositionFx(
              targetEnemy,
              ent.reservedSlotIdx >= 0 ? ent.reservedSlotIdx : 0,
              unitAttackRangeFx,
              prof,
              defProf,
              approachAngleIdx
            );
            ent.targetX = slotPos.xFx;
            ent.targetZ = slotPos.zFx;
            ent.hasCombatTarget = true;
            ent.atSlot = 0;
            ent.settled = 0;
            return false;
          }
        } else {
          this.coreCombat.releaseAttackerSlot(ent);
          const anyEnemyRes = this.findNearestEnemyEntity(
            ent.x,
            ent.z,
            scanRadFx,
            ent.team,
            entitiesMap,
            {
              canHitFlying: Boolean(ent.isFlying),
              attackAllTeams: isRampaging,
              excludeEntityId: ent.id,
              requireFreeMeleeSlot: false,
              onlySquadIndex: lockedEnemySquadId
            }
          );

          const nearEnemy = anyEnemyRes.enemy;
          if (nearEnemy) {
            const standbyPos = this._computeOrderlyStandbyPositionFx(ent, comp, nearEnemy);
            const distToStandby = fxHypot(
              (standbyPos.xFx - ent.x) | 0,
              (standbyPos.zFx - ent.z) | 0
            );

            const blockedAhead = this.coreCombat.hasTeammateBlockingForwardPath(
              ent,
              nearEnemy.x,
              nearEnemy.z,
              entitiesMap,
              prof
            );

            if (
              !isSpearWallLocked &&
              (ent.standbyLockTicks | 0) <= 0 &&
              (ent.waitTicks | 0) < 3 &&
              anyEnemyRes.distFx > (4 * FX_ONE + 200)
            ) {
              if (!blockedAhead && distToStandby > (2 * FX_ONE + 256)) {
                ent.inCombatStandby = false;
                ent.targetX = standbyPos.xFx;
                ent.targetZ = standbyPos.zFx;
                ent.hasCombatTarget = true;
                ent.atSlot = 0;
                ent.settled = 0;
                return false;
              }
              const wrapStep = this.coreCombat.computeFlankWrapStepFx(
                ent,
                nearEnemy.x,
                nearEnemy.z,
                comp,
                entitiesMap,
                prof
              );
              if (wrapStep) {
                ent.inCombatStandby = false;
                ent.targetX = wrapStep.xFx;
                ent.targetZ = wrapStep.zFx;
                ent.hasCombatTarget = true;
                ent.atSlot = 0;
                ent.settled = 0;
                return false;
              }
            }

            ent.inCombatStandby = true;
            ent.standbyLockTicks = 24;
            ent.isMoving = false;
            ent.targetX = ent.x;
            ent.targetZ = ent.z;
            ent.chargeMomentumPermille = 0;
            ent.chargeRunDistFx = 0;
            const nearEnemyComp = gameState.companies?.get(nearEnemy.squadIndex) || null;
            const compFrontDir =
              comp && nearEnemyComp
                ? fxAtan2(
                    (nearEnemyComp.anchorZFx - comp.anchorZFx) | 0,
                    (nearEnemyComp.anchorXFx - comp.anchorXFx) | 0
                  )
                : comp
                  ? comp.facingDir
                  : fxAtan2((nearEnemy.z - ent.z) | 0, (nearEnemy.x - ent.x) | 0);
            let diffDir = ((compFrontDir - ent.dir + 512) & ANGLE_MASK) - 512;
            if (diffDir > 24) diffDir = 24;
            if (diffDir < -24) diffDir = -24;
            ent.dir = (ent.dir + diffDir) & ANGLE_MASK;
            ent.animState =
              (ent.hurtVisualTicks | 0) > 0
                ? (AnimState.HURT ?? AnimState.IDLE)
                : (AnimState.COMBAT_STANDBY ?? AnimState.IDLE);
            return true;
          }
        }
      }
    }

    this.coreCombat.releaseAttackerSlot(ent);
    ent.inCombatStandby = false;
    if (typeof ent.slotTargetXFx === 'number' && typeof ent.slotTargetZFx === 'number') {
      ent.targetX = ent.slotTargetXFx;
      ent.targetZ = ent.slotTargetZFx;
    }
    return false;
  },
};
