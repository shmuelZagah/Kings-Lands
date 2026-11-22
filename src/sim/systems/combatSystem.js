/**
 * Kings Lands — Phase 6.7: Pure Physics Anti-Charge, Bracing, Calibrated Knockback & Building Siege
 * (src/sim/systems/combatSystem.js)
 *
 * Fixes & Upgrades in Phase 6.7:
 * 1. Strict Running-Only Momentum: Units only have charge impact if they actually built momentum
 *    by running (`unitMomentum >= 250`). Walking cavalry have 0 momentum and never fling enemies!
 * 2. Calibrated Knockback Distance: Reduced knockback slide distance (`max 2.1m` instead of 4.3m)
 *    so trampled infantry are thrown back realistically without flying across the map.
 * 3. Cavalry vs. Cavalry Frontal Bracing Equilibrium:
 *    - Defender bracing is directional (`100%` Front, `45%` Side, `15%` Rear).
 *    - Two equal-mass cavalry units colliding head-on (Front Arc) match each other's bracing score,
 *      absorbing the charge without knocking each other down! Flanking cavalry hitting from the
 *      Side/Rear (where defender bracing is 45%/15%) can still push/knock down enemy cavalry.
 * 4. Spear Wall Pure Defensive Bonus:
 *    - `SPEAR_WALL` grants massive `antiCharge` reflection (against chargers), `bracing` (stopping power),
 *      and `+40%` incoming damage reduction (`spearWallDefenseBonus`), without boosting normal melee strike damage.
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
  isqrt,
  fxRandomRange
} from '../../core/fx.js';
import { FormationTypes } from '../formations/formations.js';

export const MAX_MELEE_ATTACKERS = 3;
export const FRONT_ARC_MAX_DIFF = 128; // ±45 degrees
export const SIDE_ARC_MAX_DIFF = 384; // 45 to 135 degrees
export const KNOCKDOWN_DURATION_TICKS = 42; // 2.1 seconds at 20 TPS
export const CHARGE_MIN_RUN_DIST_FX = 8 * FX_ONE; // 8m of actual running required to build charge momentum
export const DIRECT_ARC_MAX_DIST_FX = 98 * FX_ONE; // <= 50m uses low curved arc if line of fire is clear

// Physics thresholds (mass * speedFx units)
export const IMPACT_PUSH_THRESHOLD = 18000;
export const IMPACT_KNOCKDOWN_THRESHOLD = 46000;

const SLOT_ANGLE_OFFSETS = new Int32Array([0, -64, 64]);

export const DirectionalArc = Object.freeze({
  FRONT: 'FRONT',
  SIDE: 'SIDE',
  BACK: 'BACK'
});

export class CombatSystem {
  constructor(spatialHash, navGrid) {
    this.spatialHash = spatialHash;
    this.navGrid = navGrid;
    this.targetSlots = new Map();
    this.activeBallisticProjectiles = [];
    this._queryScratch = [];
    this._blockCheckScratch = [];
    this._corridorScratch = [];
  }

  cleanupSlotReservations(entitiesMap) {
    for (const [targetId, slots] of this.targetSlots.entries()) {
      const target = entitiesMap.get(targetId);
      if (!target || target.hp <= 0 || target.isGarrisoned) {
        this.targetSlots.delete(targetId);
        continue;
      }
      let anyOccupied = false;
      for (let s = 0; s < MAX_MELEE_ATTACKERS; s++) {
        const atkId = slots[s];
        if (atkId <= 0) continue;
        const atk = entitiesMap.get(atkId);
        if (
          !atk ||
          atk.hp <= 0 ||
          atk.isGarrisoned ||
          atk.reservedTargetId !== targetId ||
          (atk.knockdownTicks | 0) > 0
        ) {
          slots[s] = 0;
        } else {
          anyOccupied = true;
        }
      }
      if (!anyOccupied) {
        this.targetSlots.delete(targetId);
      }
    }
  }

  releaseAttackerSlot(attacker) {
    if (!attacker) return;
    if (attacker.reservedTargetId > 0) {
      const slots = this.targetSlots.get(attacker.reservedTargetId);
      if (slots) {
        for (let s = 0; s < MAX_MELEE_ATTACKERS; s++) {
          if (slots[s] === attacker.id) {
            slots[s] = 0;
          }
        }
      }
    }
    attacker.reservedTargetId = -1;
    attacker.reservedSlotIdx = -1;
  }

  getOccupiedSlotCount(targetId) {
    const slots = this.targetSlots.get(targetId);
    if (!slots) return 0;
    let c = 0;
    for (let s = 0; s < MAX_MELEE_ATTACKERS; s++) {
      if (slots[s] > 0) c++;
    }
    return c;
  }

  hasFreeMeleeSlot(targetId, attackerId) {
    const slots = this.targetSlots.get(targetId);
    if (!slots) return true;
    for (let s = 0; s < MAX_MELEE_ATTACKERS; s++) {
      if (slots[s] === 0 || slots[s] === attackerId) return true;
    }
    return false;
  }

  reserveMeleeSlot(attacker, target, entitiesMap) {
    if (!attacker || !target || target.hp <= 0) return -1;
    let slots = this.targetSlots.get(target.id);
    if (!slots) {
      slots = new Int32Array(MAX_MELEE_ATTACKERS);
      this.targetSlots.set(target.id, slots);
    }

    for (let s = 0; s < MAX_MELEE_ATTACKERS; s++) {
      if (slots[s] === attacker.id) {
        attacker.reservedTargetId = target.id;
        attacker.reservedSlotIdx = s;
        return s;
      }
    }

    for (let s = 0; s < MAX_MELEE_ATTACKERS; s++) {
      const occId = slots[s];
      if (occId > 0) {
        const occ = entitiesMap.get(occId);
        if (!occ || occ.hp <= 0 || occ.reservedTargetId !== target.id) {
          slots[s] = 0;
        }
      }
      if (slots[s] === 0) {
        if (attacker.reservedTargetId > 0 && attacker.reservedTargetId !== target.id) {
          this.releaseAttackerSlot(attacker);
        }
        slots[s] = attacker.id;
        attacker.reservedTargetId = target.id;
        attacker.reservedSlotIdx = s;
        return s;
      }
    }

    return -1;
  }

  computeSlotWorldPositionFx(
    target,
    slotIdx,
    desiredRangeFx,
    attackerProf = null,
    targetProf = null,
    approachAngleIdx = 0
  ) {
    const offsetAngle = SLOT_ANGLE_OFFSETS[(slotIdx | 0) % MAX_MELEE_ATTACKERS] || 0;
    const angleIdx = ((approachAngleIdx | 0) + offsetAngle) & ANGLE_MASK;

    const rA = (attackerProf?.radiusFx || 620) | 0;
    const rB = (targetProf?.radiusFx || 620) | 0;
    const cavExtraFx = attackerProf?.isCavalry || targetProf?.isCavalry ? 240 : 0;
    const minStandOffFx = (rA + rB + 260 + cavExtraFx) | 0;
    const maxStrikeStandOffFx = Math.max(minStandOffFx, ((desiredRangeFx | 0) - 260) | 0);
    const distFx = Math.min(maxStrikeStandOffFx, (minStandOffFx + 120) | 0);

    return {
      xFx: (target.x + mulDiv(distFx, fxCos(angleIdx), FX_ONE)) | 0,
      zFx: (target.z + mulDiv(distFx, fxSin(angleIdx), FX_ONE)) | 0
    };
  }

  /**
   * Human-Eye Lookahead Ray for Combat:
   * Casts a forward ray up to 4.5m toward (goalXFx, goalZFx).
   * Checks if any teammate in the ray is either:
   *  - Anchored in combat/standby (cannot be pushed at all), OR
   *  - Blocked with nowhere to step aside (another unit or obstacle right behind/beside them).
   */
  hasTeammateBlockingForwardPath(attacker, goalXFx, goalZFx, entitiesMap, attackerProf = null) {
    const toGoalDx = (goalXFx - attacker.x) | 0;
    const toGoalDz = (goalZFx - attacker.z) | 0;
    const distToGoal = fxHypot(toGoalDx, toGoalDz);
    if (distToGoal <= 950) return false;

    const dirXFx = mulDiv(toGoalDx, FX_ONE, distToGoal);
    const dirZFx = mulDiv(toGoalDz, FX_ONE, distToGoal);

    const selfRadiusFx = (attackerProf?.radiusFx || 620) | 0;
    const lookAheadFx = Math.min(distToGoal, (selfRadiusFx * 5 + 1450) | 0); // up to ~4.5m ray!
    const corridorHalfWidthFx = (selfRadiusFx + 420) | 0;

    const nearbyIds = this.spatialHash.queryRadiusIds(
      attacker.x,
      attacker.z,
      lookAheadFx,
      entitiesMap,
      this._blockCheckScratch
    );

    let slowOrStoppedInRay = 0;

    for (let i = 0; i < nearbyIds.length; i++) {
      const ally = entitiesMap.get(nearbyIds[i]);
      if (!ally || ally.id === attacker.id || ally.hp <= 0 || ally.team !== attacker.team) {
        continue;
      }

      const relX = (ally.x - attacker.x) | 0;
      const relZ = (ally.z - attacker.z) | 0;

      const forwardProjFx =
        (mulDiv(relX, dirXFx, FX_ONE) + mulDiv(relZ, dirZFx, FX_ONE)) | 0;
      if (forwardProjFx <= 160 || forwardProjFx > lookAheadFx || forwardProjFx >= distToGoal) {
        continue;
      }

      const perpDistFx = fxAbs(
        (mulDiv(relX, -dirZFx, FX_ONE) + mulDiv(relZ, dirXFx, FX_ONE)) | 0
      );
      if (perpDistFx > corridorHalfWidthFx) continue;

      const isAllyAnchoredInCombat =
        Boolean(ally.inCombatStandby) ||
        (ally.windupTicks | 0) > 0 ||
        (ally.actionCooldown | 0) > 0 ||
        (ally.windupBuildingId | 0) > 0 ||
        (ally.reservedTargetId > 0 && !ally.isMoving);

      if (isAllyAnchoredInCombat) {
        return true;
      }

      if (!ally.isMoving || (ally._lastActualMovedFx ?? 200) < 35) {
        slowOrStoppedInRay++;
        if (slowOrStoppedInRay >= 2) {
          return true;
        }
      }
    }
    return false;
  }

  computeFlankWrapStepFx(attacker, goalXFx, goalZFx, comp, entitiesMap, attackerProf = null) {
    const baseAngle = fxAtan2((goalZFx - attacker.z) | 0, (goalXFx - attacker.x) | 0);
    const stepDistFx = (3 * FX_ONE + 200) | 0;

    let preferSign = (attacker.id & 1) === 0 ? 1 : -1;
    if (comp) {
      const cross =
        Math.imul((attacker.x - comp.anchorXFx) | 0, (goalZFx - comp.anchorZFx) | 0) -
        Math.imul((attacker.z - comp.anchorZFx) | 0, (goalXFx - comp.anchorXFx) | 0);
      if (cross !== 0) {
        preferSign = cross > 0 ? 1 : -1;
      }
    }

    const candidateOffsets = [
      preferSign * 68,
      -preferSign * 68,
      preferSign * 116,
      -preferSign * 116
    ];

    const worldMinFx = 12 * FX_ONE;
    const worldMaxFx = (this.navGrid.worldSizeFx - 12 * FX_ONE) | 0;

    for (let i = 0; i < candidateOffsets.length; i++) {
      const testAngle = (baseAngle + candidateOffsets[i]) & ANGLE_MASK;
      const candX = fxClamp(
        (attacker.x + mulDiv(stepDistFx, fxCos(testAngle), FX_ONE)) | 0,
        worldMinFx,
        worldMaxFx
      );
      const candZ = fxClamp(
        (attacker.z + mulDiv(stepDistFx, fxSin(testAngle), FX_ONE)) | 0,
        worldMinFx,
        worldMaxFx
      );

      if (!this.navGrid.isWalkableWorldFx(candX, candZ)) continue;
      if (this.hasTeammateBlockingForwardPath(attacker, candX, candZ, entitiesMap, attackerProf)) {
        continue;
      }

      // Human-Eye Destination Check: verify the flank destination itself is actually open (not already crowded)
      const destNeighbors = this.spatialHash.queryRadiusIds(
        candX,
        candZ,
        1550,
        entitiesMap,
        this._corridorScratch
      );
      let destCrowdedCount = 0;
      for (let k = 0; k < destNeighbors.length; k++) {
        const nId = destNeighbors[k];
        if (nId === attacker.id) continue;
        const nEnt = entitiesMap.get(nId);
        if (nEnt && nEnt.hp > 0 && !nEnt.isGarrisoned) {
          destCrowdedCount++;
        }
      }
      if (destCrowdedCount <= 1) {
        return { xFx: candX, zFx: candZ };
      }
    }

    return null;
  }

  hasFriendlyUnitsInFiringLine(shooter, targetXFx, targetZFx, distFx, entitiesMap) {
    if (distFx <= 3 * FX_ONE) return false;

    const dx = (targetXFx - shooter.x) | 0;
    const dz = (targetZFx - shooter.z) | 0;
    const dirXFx = mulDiv(dx, FX_ONE, distFx);
    const dirZFx = mulDiv(dz, FX_ONE, distFx);

    const checkLenFx = Math.min(distFx, 28 * FX_ONE);
    const halfLenFx = (checkLenFx >> 1) | 0;
    const midXFx = (shooter.x + mulDiv(dirXFx, halfLenFx, FX_ONE)) | 0;
    const midZFx = (shooter.z + mulDiv(dirZFx, halfLenFx, FX_ONE)) | 0;
    const queryRadFx = (halfLenFx + 2 * FX_ONE) | 0;

    const nearbyIds = this.spatialHash.queryRadiusIds(
      midXFx,
      midZFx,
      queryRadFx,
      entitiesMap,
      this._corridorScratch
    );

    const corridorHalfWidthFx = (2 * FX_ONE + 256) | 0;

    for (let i = 0; i < nearbyIds.length; i++) {
      const ally = entitiesMap.get(nearbyIds[i]);
      if (
        !ally ||
        ally.id === shooter.id ||
        ally.hp <= 0 ||
        ally.team !== shooter.team ||
        ally.isGarrisoned
      ) {
        continue;
      }

      const relX = (ally.x - shooter.x) | 0;
      const relZ = (ally.z - shooter.z) | 0;

      const forwardProjFx =
        (mulDiv(relX, dirXFx, FX_ONE) + mulDiv(relZ, dirZFx, FX_ONE)) | 0;

      if (ally.squadIndex === shooter.squadIndex) continue;
      if (forwardProjFx < (1 * FX_ONE + 512) || forwardProjFx > distFx - FX_ONE) {
        continue;
      }

      const perpDistFx = fxAbs(
        (mulDiv(relX, -dirZFx, FX_ONE) + mulDiv(relZ, dirXFx, FX_ONE)) | 0
      );
      if (perpDistFx <= corridorHalfWidthFx) {
        return true;
      }
    }

    return false;
  }

  classifyAttackArc(attackerXFx, attackerZFx, defender) {
    const dirToAttacker = fxAtan2(
      (attackerZFx - defender.z) | 0,
      (attackerXFx - defender.x) | 0
    );
    const rawDiff = ((dirToAttacker - (defender.dir & ANGLE_MASK) + 512) & ANGLE_MASK) - 512;
    const absDiff = fxAbs(rawDiff);

    if (absDiff <= FRONT_ARC_MAX_DIFF) {
      return {
        arc: DirectionalArc.FRONT,
        damageMultiplierPermille: 1000,
        defenseMultiplierPermille: 1000,
        canBlock: true
      };
    }
    if (absDiff <= SIDE_ARC_MAX_DIFF) {
      return {
        arc: DirectionalArc.SIDE,
        damageMultiplierPermille: 1150,
        defenseMultiplierPermille: 600,
        canBlock: false
      };
    }
    return {
      arc: DirectionalArc.BACK,
      damageMultiplierPermille: 1350,
      defenseMultiplierPermille: 0,
      canBlock: false
    };
  }

  rollDeterministicFrontalBlock(
    gameState,
    attacker,
    attackerProf,
    defender,
    defenderProf,
    isMissile = false,
    sourceXFx = null,
    sourceZFx = null
  ) {
    if (!defender || defender.hp <= 0 || (defender.knockdownTicks | 0) > 0) {
      return {
        blocked: false,
        arcInfo: this.classifyAttackArc(attacker?.x ?? 0, attacker?.z ?? 0, defender)
      };
    }

    const defComp = gameState.companies?.get(defender.squadIndex);
    if (defComp && defComp.isBroken) {
      const arcInfo = this.classifyAttackArc(
        sourceXFx !== null ? sourceXFx : attacker.x,
        sourceZFx !== null ? sourceZFx : attacker.z,
        defender
      );
      return { blocked: false, arcInfo };
    }

    const sx = sourceXFx !== null ? sourceXFx : attacker.x;
    const sz = sourceZFx !== null ? sourceZFx : attacker.z;
    const arcInfo = this.classifyAttackArc(sx, sz, defender);

    if (!arcInfo.canBlock) {
      return { blocked: false, arcInfo };
    }

    const baseBlockPermille = isMissile
      ? (defenderProf.baseMissileBlockPermille ?? 220)
      : (defenderProf.baseMeleeBlockPermille ?? 250);

    let defBlockRating = isMissile
      ? (defender.missileBlockRating ?? defenderProf.missileBlockRating ?? 15)
      : (defender.meleeBlockRating ?? defenderProf.meleeBlockRating ?? 20);

    if (defComp) {
      if ((defComp.staminaPermille | 0) < 300) {
        const stamScale = (750 + mulDiv(250, defComp.staminaPermille | 0, 300)) | 0;
        defBlockRating = mulDiv(defBlockRating, stamScale, 1000);
      }
      if (defComp.formation === FormationTypes.SHIELD_WALL) {
        defBlockRating = (defBlockRating + 35) | 0;
      } else if (defComp.formation === FormationTypes.SPEAR_WALL) {
        defBlockRating = (defBlockRating + 25) | 0;
      }
    }

    const atkRating = attacker
      ? (attacker.attackRating ?? attackerProf?.attackRating ?? 20)
      : 20;

    const blockChancePermille = fxClamp(
      (baseBlockPermille + (defBlockRating - atkRating) * 10) | 0,
      50,
      850
    );

    const roll = fxRandomRange(gameState, 1, 1000);
    return {
      blocked: roll <= blockChancePermille,
      arcInfo
    };
  }

  /**
   * Computes resolved damage.
   * Note (Phase 6.7 Fix #5): `SPEAR_WALL` does NOT boost attacker's damage! Instead, when a unit
   * in `SPEAR_WALL` is defending against a frontal attack, it receives a strong anti-damage defense
   * bonus (-35% incoming frontal damage + +50% armor effectiveness).
   */
  computeResolvedDamage(
    rawDamage,
    attacker,
    attackerComp,
    defender,
    defenderProf,
    defenderComp,
    arcInfo,
    isMissile = false
  ) {
    let dmgPermille = (rawDamage * 1000) | 0;

    if (attacker && (attacker.isBuffed || attackerComp?.hasBannerBuff)) {
      dmgPermille = mulDiv(dmgPermille, 1200, 1000);
    }

    if (!isMissile && attackerComp && (attackerComp.staminaPermille | 0) < 300) {
      const stamScale = (750 + mulDiv(250, attackerComp.staminaPermille | 0, 300)) | 0;
      dmgPermille = mulDiv(dmgPermille, stamScale, 1000);
    }

    dmgPermille = mulDiv(dmgPermille, arcInfo.damageMultiplierPermille, 1000);

    if ((defender.knockdownTicks | 0) > 0) {
      dmgPermille = mulDiv(dmgPermille, 1250, 1000);
    }

    // Shield Wall (-85% missile dmg) & Spear Wall (-35% frontal incoming damage / anti-damage bonus)
    if (isMissile && defenderComp && defenderComp.formation === FormationTypes.SHIELD_WALL) {
      dmgPermille = mulDiv(dmgPermille, 150, 1000);
    } else if (
      defenderComp &&
      defenderComp.formation === FormationTypes.SPEAR_WALL &&
      arcInfo.arc === DirectionalArc.FRONT
    ) {
      dmgPermille = mulDiv(dmgPermille, 650, 1000);
    }

    if (defender.isHero || defender.unitTypeIdx === 5) {
      // Hero armor parameter (e.g. 15 = 15%) is percentage damage reduction; solo Heroes also cap flank/rear multiplier so a crowd cannot burst them instantly
      const armorPct = Math.max(0, Math.min(85, (defender.armor ?? 15) | 0));
      const baseHeroIncoming = (rawDamage * 1000) | 0;
      const cappedArcMult = Math.min(1150, arcInfo?.damageMultiplierPermille || 1000);
      const heroIncomingPermille = mulDiv(baseHeroIncoming, cappedArcMult, 1000);
      const reducedPermille = mulDiv(heroIncomingPermille, 100 - armorPct, 100);
      return Math.max(1, ((reducedPermille + 500) / 1000) | 0);
    }

    let baseArmor = (defender.armor ?? defenderProf.armor ?? 3) | 0;
    if (defender.isBuffed || defenderComp?.hasBannerBuff) {
      baseArmor = mulDiv(baseArmor, 1200, 1000);
    }
    if (
      defenderComp &&
      defenderComp.formation === FormationTypes.SPEAR_WALL &&
      arcInfo.arc === DirectionalArc.FRONT
    ) {
      baseArmor = mulDiv(baseArmor, 1500, 1000);
    }

    const effectiveArmorPermille = mulDiv(
      baseArmor * 1000,
      arcInfo.defenseMultiplierPermille,
      1000
    );

    const netPermille = Math.max(1000, (dmgPermille - effectiveArmorPermille) | 0);
    return Math.max(1, ((netPermille + 500) / 1000) | 0);
  }

  /**
   * Phase 6.7 Calibrated Two-Stage Physics Impact Resolution:
   * - Requires actual running momentum (`charger.chargeMomentumPermille >= 250` AND `chargerComp.isRunning`).
   *   Walking units (even heavy cavalry) have 0 momentum and NEVER trigger charge knockback!
   * - Stage 1 (`antiCharge` — calculated FIRST before any bracing reduction):
   *   Spearmen in `SPEAR_WALL` / `PIKE_PHALANX` reflect incoming frontal kinetic force onto the charger.
   * - Stage 2 (`bracing` — directional stopping power):
   *   - Front Arc: `100%` of `bracingPermille`
   *   - Side Arc:  `45%` of `bracingPermille`
   *   - Back Arc:  `15%` of `bracingPermille`
   *   Thus, Cavalry (mass 340, bracing 1850) hit from the FRONT by enemy Cavalry (mass 340) has
   *   `defenderBracingScore ≈ 150,960`, leaving `netForceOnDefender < IMPACT_KNOCKDOWN_THRESHOLD`
   *   (no frontal cavalry-on-cavalry knockdown!), whereas hitting enemy Cavalry from the SIDE/REAR
   *   reduces their bracing to 45%/15%, allowing a flanking cavalry charge to shove/knock them down!
   */
  resolveChargeAndTrampleImpact(
    charger,
    chargerComp,
    chargerProf,
    target,
    targetComp,
    targetProf,
    gameState,
    AnimState
  ) {
    if (Boolean(target.isFlying) !== Boolean(charger.isFlying)) return null;

    // Must have actual per-unit running momentum (never trigger when walking!)
    const unitMomentum = charger.chargeMomentumPermille | 0;
    if (unitMomentum < 250) return null;

    const chargerMass = (chargerProf.chargeMass || chargerProf.mass || 120) | 0;
    const baseSpeedFx = (charger.speedFx || 215) | 0;
    const effectiveSpeedFx =
      chargerComp && chargerComp.isRunning
        ? mulDiv(baseSpeedFx, 1450, PERMILLE_ONE)
        : baseSpeedFx;

    const incomingKineticScore = mulDiv(
      Math.imul(chargerMass, effectiveSpeedFx),
      unitMomentum,
      PERMILLE_ONE
    );

    if (incomingKineticScore < IMPACT_PUSH_THRESHOLD) return null;

    const arcOnTarget = this.classifyAttackArc(charger.x, charger.z, target);
    const targetFacingChargerFront =
      arcOnTarget.arc === DirectionalArc.FRONT && (target.knockdownTicks | 0) <= 0;

    // =========================================================================
    // STAGE 1: ANTI-CHARGE (מחושב ראשון מול העוצמה והמהירות המלאות של המסתער!)
    // =========================================================================
    let effectiveAntiChargePermille = 0;
    if (targetFacingChargerFront) {
      effectiveAntiChargePermille = (targetProf.antiChargePermille || 0) | 0;
      if (targetComp) {
        if (targetComp.formation === FormationTypes.SPEAR_WALL) {
          effectiveAntiChargePermille = Math.max(1800, effectiveAntiChargePermille * 4);
        } else if (
          targetComp.formation === FormationTypes.PIKE_PHALANX &&
          (targetComp.stanceTransitionTicks | 0) <= 0
        ) {
          effectiveAntiChargePermille = Math.max(2200, effectiveAntiChargePermille * 5);
        }
      }
    }

    let chargerKnockedDownByAntiCharge = false;
    let remainingKineticAfterAntiCharge = incomingKineticScore;

    if (effectiveAntiChargePermille > 0) {
      const reflectedKineticForce = mulDiv(
        incomingKineticScore,
        effectiveAntiChargePermille,
        1000
      );
      const baseDefWeaponDmg = (target.damage || targetProf.damage || 6) | 0;
      const counterDamage = Math.max(
        baseDefWeaponDmg,
        mulDiv(baseDefWeaponDmg, reflectedKineticForce, 18000)
      );

      charger.hp = Math.max(0, (charger.hp - counterDamage) | 0);
      charger.ticksSinceLastHit = 0;
      if (chargerComp) chargerComp.ticksSinceLastCombat = 0;

      const chargerStabilityScore = Math.imul(chargerMass, 150);
      if (reflectedKineticForce >= chargerStabilityScore) {
        chargerKnockedDownByAntiCharge = true;
        charger.chargeMomentumPermille = 0;
        charger.chargeRunDistFx = 0;
        if (chargerComp) {
          chargerComp.chargeMomentumPermille = 0;
          chargerComp.chargeRunDistFx = 0;
          chargerComp.isRunning = false;
          chargerComp.wantsToRun = false;
        }

        const recoilAngle = fxAtan2((charger.z - target.z) | 0, (charger.x - target.x) | 0);
        const recoilSpeedFx = fxClamp(
          mulDiv(reflectedKineticForce, 160, Math.max(80, chargerMass * 100)),
          160,
          320
        );
        charger.knockbackVxFx = mulDiv(recoilSpeedFx, fxCos(recoilAngle), FX_ONE);
        charger.knockbackVzFx = mulDiv(recoilSpeedFx, fxSin(recoilAngle), FX_ONE);
        charger.knockbackSlideTicks = 0;

        if (charger.hp <= 0) {
          charger.animState = AnimState.DIE;
          this.releaseAttackerSlot(charger);
        } else {
          charger.knockdownTicks = KNOCKDOWN_DURATION_TICKS;
          charger.animState = AnimState.KNOCKED_DOWN ?? AnimState.HURT;
          charger.isMoving = false;
          this.releaseAttackerSlot(charger);
        }

        gameState.moraleStaminaSystem?.applyMoraleShock(
          chargerComp,
          55,
          'ANTI_CHARGE_IMPALE'
        );
      }

      remainingKineticAfterAntiCharge = Math.max(
        0,
        (incomingKineticScore - (reflectedKineticForce >> 1)) | 0
      );
    }

    // =========================================================================
    // STAGE 2: DIRECTIONAL BRACING / STOPPING RESISTANCE (בלימה — מחושב שני!)
    // =========================================================================
    const targetMass = (targetProf.mass || 90) | 0;
    let baseBracingPermille = (targetProf.bracingPermille ?? 800) | 0;

    if (targetFacingChargerFront && targetComp) {
      if (targetComp.formation === FormationTypes.SHIELD_WALL) {
        baseBracingPermille = (baseBracingPermille * 8) | 0;
      } else if (targetComp.formation === FormationTypes.SPEAR_WALL) {
        baseBracingPermille = (baseBracingPermille * 3) | 0;
      } else if (
        targetComp.formation === FormationTypes.PIKE_PHALANX &&
        (targetComp.stanceTransitionTicks | 0) <= 0
      ) {
        baseBracingPermille = (baseBracingPermille * 4) | 0;
      }
    }

    // Directional Bracing Factor: Front = 100%, Side = 65%, Back = 45%
    const dirBracingFactorPermille =
      (target.knockdownTicks | 0) > 0
        ? 300
        : arcOnTarget.arc === DirectionalArc.FRONT
          ? 1000
          : arcOnTarget.arc === DirectionalArc.SIDE
            ? 650
            : 450;

    const effectiveBracingPermille = mulDiv(
      baseBracingPermille,
      dirBracingFactorPermille,
      1000
    );

    // Defender Total Stopping Power = Intrinsic Mass Inertia + Active Bracing Stance
    // Light units (Archers/Workers, mass <= 95 or ranged) have low inertia (targetMass * 115) so heavy cavalry
    // can trample through 2-3 ranks of archers, while equal-mass units (Swordsman 120 vs 120, Cavalry 340 vs 340)
    // are strictly blocked by hasMassDominance!
    const isLightOrRangedTarget = Boolean(targetProf.isRanged || targetMass <= 95);
    const inertiaFactor = isLightOrRangedTarget ? 115 : 320;
    const bracingFactor = isLightOrRangedTarget ? 120 : 240;
    const intrinsicMassInertiaScore = Math.imul(targetMass, inertiaFactor);
    const activeBracingScore = mulDiv(
      Math.imul(targetMass, bracingFactor),
      effectiveBracingPermille,
      1000
    );
    const defenderBracingScore = (intrinsicMassInertiaScore + activeBracingScore) | 0;

    // Physical Mass Ratio Law: a charger can only send a defender flying back if its mass is significantly
    // greater than the defender's mass (chargerMass * 10 >= targetMass * 16, e.g. Cavalry 340 vs Infantry 120)
    const hasMassDominance = Math.imul(chargerMass, 10) >= Math.imul(targetMass, 16);
    const rawNetForce = (remainingKineticAfterAntiCharge - defenderBracingScore) | 0;
    const netForceOnDefender = hasMassDominance ? rawNetForce : Math.min(0, rawNetForce);

    if (remainingKineticAfterAntiCharge >= IMPACT_PUSH_THRESHOLD && charger.hp > 0) {
      const bonusChargeDamage = Math.max(2, (remainingKineticAfterAntiCharge / 8500) | 0);
      const totalStrikeDamage =
        ((charger.damage || chargerProf.damage || 5) + bonusChargeDamage) | 0;
      const resolvedDmg = this.computeResolvedDamage(
        totalStrikeDamage,
        charger,
        chargerComp,
        target,
        targetProf,
        targetComp,
        arcOnTarget,
        false
      );

      target.hp = Math.max(0, (target.hp - resolvedDmg) | 0);
      target.ticksSinceLastHit = 0;
      if (targetComp) {
        targetComp.ticksSinceLastCombat = 0;
        gameState.moraleStaminaSystem?.onUnitDamaged(
          targetComp,
          targetProf,
          arcOnTarget.arc,
          netForceOnDefender >= IMPACT_KNOCKDOWN_THRESHOLD,
          false
        );
      }
    }

    const isHeavyMountedCharger = Boolean(
      chargerProf.isCavalry || (chargerProf.chargeMass || chargerProf.mass || 0) >= 260
    );
    const causesDefenderKnockdown =
      isHeavyMountedCharger && hasMassDominance && netForceOnDefender >= IMPACT_KNOCKDOWN_THRESHOLD;

    // Only when a heavy charger (e.g. Cavalry 340) hits a much lighter unbraced unit (e.g. Infantry 80..120)
    // and overcomes its defenderBracingScore does it knock the target back! Equal-mass units never knock each other back.
    if (isHeavyMountedCharger && hasMassDominance && netForceOnDefender > 12000) {
      const pushAngle = fxAtan2((target.z - charger.z) | 0, (target.x - charger.x) | 0);
      const sideSign = ((target.id + charger.id) & 1) === 0 ? 1 : -1;
      const deflectedAngle = (pushAngle + sideSign * 34) & ANGLE_MASK;

      const totalSlideDistFx = fxClamp(
        mulDiv(netForceOnDefender, 85, Math.max(80, targetMass)),
        320,
        1450 // Max ~1.4m realistic knockback slide against lighter infantry
      );
      const slideTicks = causesDefenderKnockdown ? 6 : 4;
      const initialSlideSpeedFx = ((totalSlideDistFx << 1) / (slideTicks + 1)) | 0;

      target.knockbackVxFx = mulDiv(initialSlideSpeedFx, fxCos(deflectedAngle), FX_ONE);
      target.knockbackVzFx = mulDiv(initialSlideSpeedFx, fxSin(deflectedAngle), FX_ONE);
      target.knockbackSlideTicks = slideTicks;
    }

    if (target.hp <= 0) {
      target.animState = AnimState.DIE;
      this.releaseAttackerSlot(target);
    } else if (causesDefenderKnockdown) {
      target.knockdownTicks = KNOCKDOWN_DURATION_TICKS;
      target.windupTicks = 0;
      target.animState = AnimState.KNOCKED_DOWN ?? AnimState.HURT;
      target.isMoving = false;
      this.releaseAttackerSlot(target);
    }

    // Momentum loss on the charger proportional to `defenderBracingScore`:
    // - Against Archer (4,224): ~92 permille loss -> Cavalry plows through ~8-10 archers!
    // - Against Frontal Cavalry (150,960): 1000 permille loss -> Both cavalry units stop and fight in melee!
    let remainingMomentum = 0;
    if (!chargerKnockedDownByAntiCharge) {
      // Against light archers (defenderBracingScore ~ 12,500), cavalry loses ~250 permille per archer -> tramples 3 ranks!
      // Against equal-mass units (!hasMassDominance), loses 1000 permille immediately -> stops cleanly at the line!
      const momentumLossPermille = !hasMassDominance
        ? 1000
        : fxClamp(
            mulDiv(defenderBracingScore, 1000, Math.max(1000, Math.imul(chargerMass, 155))),
            220,
            1000
          );
      remainingMomentum = Math.max(0, (unitMomentum - momentumLossPermille) | 0);
      charger.chargeMomentumPermille = remainingMomentum;
      if (remainingMomentum < 250) {
        charger.chargeRunDistFx = 0;
      }
      charger.lastTrampledTargetId = target.id;
    }

    return {
      triggered: true,
      causesDefenderKnockdown,
      chargerKnockedDownByAntiCharge,
      remainingMomentum
    };
  }

}

import { ballisticAndDamageMethods } from './ballisticAndDamageSystem.js';
Object.assign(CombatSystem.prototype, ballisticAndDamageMethods);
