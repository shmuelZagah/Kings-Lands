/**
 * Kings Lands — Ballistic Arrow Trajectories, Scatter, Friendly Fire & Hurt Reactions
 * (src/sim/systems/ballisticAndDamageSystem.js)
 */
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


export const ballisticAndDamageMethods = {
  /**
   * Universal Hurt Reaction Rule (חוק המומנטום והפעולה):
   * Any unit that takes damage plays the Hurt animation (hurtVisualTicks = 9, AnimState.HURT)
   * UNLESS it is actively running/charging/routing, mid-attack windup, knocked down, or in post-flinch immunity!
   */
  applyDamageHurtReaction(target, targetComp, AnimState, isMissile = false) {
    if (!target || target.hp <= 0) return;
    if ((target.knockdownTicks | 0) > 0) return;
    if ((target.windupTicks | 0) > 0 || (target.shotWindupTicks | 0) > 0) return;
    // Heroes have heroic poise: arrows/missiles never stagger them into got_hit, and in active combat/movement they never flinch!
    if (target.isHero || target.unitTypeIdx === 5) {
      if (isMissile) return;
      if (
        target.isMoving ||
        (target.actionCooldown | 0) > 0 ||
        target.hasCombatTarget ||
        (targetComp && (targetComp.engagedTargetEntityId > 0 || targetComp.isActivelyMoving()))
      ) {
        return;
      }
    }
    const isRunningOrCharging = Boolean(
      (targetComp && targetComp.isRunning && (targetComp.staminaPermille | 0) > 0) ||
        target.isRouting ||
        target.animState === AnimState.RUN ||
        target.animState === AnimState.CHARGE
    );
    if (isRunningOrCharging) return;
    if ((target.hurtImmunityTicks | 0) > 0) return;

    target.hurtVisualTicks = (target.isHero || target.unitTypeIdx === 5) ? 6 : 9;
    target.hurtImmunityTicks = (target.isHero || target.unitTypeIdx === 5) ? 70 : 28;
    target.animState = AnimState.HURT ?? AnimState.IDLE;
  },

  spawnBallisticProjectile(
    gameState,
    shooter,
    shooterComp,
    shooterProf,
    targetXFx,
    targetZFx,
    extraOpts = {}
  ) {
    const isFireArrow = Boolean(
      extraOpts.isFireArrow ||
        shooterComp?.ammoType === 'FIRE_ARROW' ||
        shooter.ammoType === 'FIRE_ARROW'
    );

    // Archer Company Firing Circle (עיגול הירי של פלוגת הקשתים):
    // 1. Center the circle on the target company (or target building/unit).
    // 2. If the target company is stationary, the circle sits directly on the target company (zero prediction!).
    //    If the target company is moving, shift the circle along the company's movement vector.
    // 3. The circle's minimum radius matches the target company's formation radius so at close range the whole
    //    enemy company is inside the firing zone; as distance grows, the circle radius expands smoothly.
    const targetEnt = extraOpts.targetEnt || null;
    const targetComp = targetEnt ? (gameState.companies?.get(targetEnt.squadIndex) || null) : null;

    let circleCenterXFx = targetXFx | 0;
    let circleCenterZFx = targetZFx | 0;
    let minCompanyRadFx = 4 * FX_ONE; // Default ~4m radius

    if (targetComp && targetComp.memberIds.length > 0) {
      let sumX = 0;
      let sumZ = 0;
      let aliveCount = 0;
      for (let m = 0; m < targetComp.memberIds.length; m++) {
        const me = gameState.entities.get(targetComp.memberIds[m]);
        if (me && me.hp > 0 && !me.isGarrisoned) {
          sumX = (sumX + me.x) | 0;
          sumZ = (sumZ + me.z) | 0;
          aliveCount++;
        }
      }
      if (aliveCount > 0) {
        circleCenterXFx = (sumX / aliveCount) | 0;
        circleCenterZFx = (sumZ / aliveCount) | 0;
        let maxMemberDistFx = 0;
        for (let m = 0; m < targetComp.memberIds.length; m++) {
          const me = gameState.entities.get(targetComp.memberIds[m]);
          if (me && me.hp > 0 && !me.isGarrisoned) {
            const md = fxHypot((me.x - circleCenterXFx) | 0, (me.z - circleCenterZFx) | 0);
            if (md > maxMemberDistFx) maxMemberDistFx = md;
          }
        }
        minCompanyRadFx = fxClamp(maxMemberDistFx + FX_ONE, 4 * FX_ONE, 9 * FX_ONE);
      }
    }

    const shooterOriginXFx = shooterComp ? shooterComp.anchorXFx : shooter.x;
    const shooterOriginZFx = shooterComp ? shooterComp.anchorZFx : shooter.z;
    let rawDistFx = fxHypot(
      (circleCenterXFx - shooterOriginXFx) | 0,
      (circleCenterZFx - shooterOriginZFx) | 0
    );
    const blockedByAllies = this.hasFriendlyUnitsInFiringLine(
      shooter,
      circleCenterXFx,
      circleCenterZFx,
      rawDistFx,
      gameState.entities
    );
    let isHighArc = Boolean(rawDistFx > DIRECT_ARC_MAX_DIST_FX || blockedByAllies);

    // Only predict movement if the target company is actively moving!
    if (targetComp && targetComp.isActivelyMoving()) {
      const vxFx = targetComp.avgVxFx | 0;
      const vzFx = targetComp.avgVzFx | 0;
      if (fxAbs(vxFx) > 20 || fxAbs(vzFx) > 20) {
        const estFlightTicks = isHighArc
          ? fxClamp(((rawDistFx / (3 * FX_ONE)) | 0) + 8, 10, 36)
          : fxClamp(((rawDistFx / (4 * FX_ONE)) | 0) + 4, 4, 15);
        const leadTicks = mulDiv(estFlightTicks, 900, 1000);
        const worldMinFx = 12 * FX_ONE;
        const worldMaxFx = (this.navGrid.worldSizeFx - 12 * FX_ONE) | 0;
        circleCenterXFx = fxClamp((circleCenterXFx + Math.imul(vxFx, leadTicks)) | 0, worldMinFx, worldMaxFx);
        circleCenterZFx = fxClamp((circleCenterZFx + Math.imul(vzFx, leadTicks)) | 0, worldMinFx, worldMaxFx);
        rawDistFx = fxHypot(
          (circleCenterXFx - shooterOriginXFx) | 0,
          (circleCenterZFx - shooterOriginZFx) | 0
        );
        isHighArc = Boolean(rawDistFx > DIRECT_ARC_MAX_DIST_FX || blockedByAllies);
      }
    }

    const distFx = fxHypot((circleCenterXFx - shooter.x) | 0, (circleCenterZFx - shooter.z) | 0);

    // Circle radius: starts at minCompanyRadFx at close range (<= 24m, covering the whole enemy squad)
    // and grows smoothly as distance increases.
    const extraRangeDistFx = Math.max(0, (rawDistFx - 24 * FX_ONE) | 0);
    const rawAccuracy = Number(shooter.accuracy ?? shooterProf?.accuracy ?? 75);
    const clampedAcc = Math.max(10, Math.min(100, Number.isFinite(rawAccuracy) ? rawAccuracy : 75));
    // Accuracy 100 -> 15% scatter; Accuracy 75 -> 78% scatter; Accuracy 40 -> 165% scatter
    const accuracyScatterPermille = Math.round(150 + ((100 - clampedAcc) * 2250) / 90);
    let baseCircleRadiusFx = shooter.isHero
      ? (Math.round(1.6 * FX_ONE) + mulDiv(extraRangeDistFx, 42, 1000)) | 0
      : (minCompanyRadFx + mulDiv(extraRangeDistFx, 75, 1000)) | 0;
    if (!targetComp && !shooter.isHero) {
      // Shooting at a building or single entity without a company
      baseCircleRadiusFx = (2 * FX_ONE + mulDiv(extraRangeDistFx, 55, 1000)) | 0;
    }
    let circleRadiusFx = Math.max(256, mulDiv(baseCircleRadiusFx, accuracyScatterPermille, 1000));

    // Pick a random point inside the Company Firing Circle (uniform disk sampling via isqrt)
    const scatterAngle = fxRandomRange(gameState, 0, 1023) & ANGLE_MASK;
    const randAreaPermille = fxRandomRange(gameState, 0, 1000000);
    const radialFractionPermille = isqrt(randAreaPermille); // 0..1000
    const scatterMag = mulDiv(circleRadiusFx, radialFractionPermille, 1000);

    const impactXFx = (circleCenterXFx + mulDiv(scatterMag, fxCos(scatterAngle), FX_ONE)) | 0;
    const impactZFx = (circleCenterZFx + mulDiv(scatterMag, fxSin(scatterAngle), FX_ONE)) | 0;
    const impactYFx = this.navGrid.sampleHeightAtWorldFx(impactXFx, impactZFx);

    const flightTicks = isHighArc
      ? fxClamp(((distFx / (3 * FX_ONE)) | 0) + 8, 10, 36)
      : fxClamp(((distFx / (4 * FX_ONE)) | 0) + 4, 4, 15);

    const rawDamage = (extraOpts.damage ?? shooter.damage ?? shooterProf.damage ?? 9) | 0;
    const isBallistaProjectile = Boolean(extraOpts.isBallista || shooterProf?.isSiege || shooter?.unitTypeIdx === 6);

    this.activeBallisticProjectiles.push({
      shooterId: shooter.id,
      shooterTeam: shooter.team,
      shooterCompanyId: shooter.squadIndex,
      fromXFx: shooter.x,
      fromYFx: (shooter.y + FX_ONE) | 0,
      fromZFx: shooter.z,
      impactXFx,
      impactYFx,
      impactZFx,
      ticksRemaining: flightTicks,
      damage: rawDamage,
      vsBuildingMultiplierPermille: isBallistaProjectile ? (shooterProf?.vsBuildingPermille || 3500) : isFireArrow ? 850 : (shooterProf.vsBuildingPermille || 300),
      isBallista: isBallistaProjectile,
      isFireArrow,
      isHighArc,
      canHitFlying: true
    });

    gameState.pendingEvents.push({
      tick: gameState.tick,
      kind: 'TOWER_SHOT',
      fromXFx: shooter.x,
      fromYFx: (shooter.y + FX_ONE + 256) | 0,
      fromZFx: shooter.z,
      toXFx: impactXFx,
      toYFx: (impactYFx + 512) | 0,
      toZFx: impactZFx,
      isBallista: isBallistaProjectile,
      isFireArrow,
      isHighArc,
      extraArrows: 0
    });
  },

  stepBallisticProjectiles(gameState, { AnimState }) {
    if (this.activeBallisticProjectiles.length === 0) return;

    const entitiesMap = gameState.entities;
    const companiesMap = gameState.companies;
    const baseHitRadiusFx = 1280;
    const maxQueryRadiusFx = 2200; // Covers large targets like Cavalry (radiusFx 1200)

    for (let i = this.activeBallisticProjectiles.length - 1; i >= 0; i--) {
      const proj = this.activeBallisticProjectiles[i];
      proj.ticksRemaining = (proj.ticksRemaining - 1) | 0;
      if (proj.ticksRemaining > 0) continue;

      this.activeBallisticProjectiles.splice(i, 1);

      const nearbyIds = this.spatialHash.queryRadiusIds(
        proj.impactXFx,
        proj.impactZFx,
        maxQueryRadiusFx,
        entitiesMap,
        this._queryScratch
      );

      let hitEnt = null;
      let bestDist = maxQueryRadiusFx;
      for (let n = 0; n < nearbyIds.length; n++) {
        const cand = entitiesMap.get(nearbyIds[n]);
        if (!cand || cand.hp <= 0 || cand.isGarrisoned || cand.id === proj.shooterId) continue;
        const candAllied = gameState.areTeamsAllied ? gameState.areTeamsAllied(cand.team, proj.shooterTeam) : cand.team === proj.shooterTeam;
        if ((cand.isHero || cand.unitTypeIdx === 5) && candAllied) continue;
        if (cand.isFlying && !proj.canHitFlying) continue;

        const candProf = gameState.movementSystem.getPhysicsProfile(cand.unitTypeIdx);
        const effectiveHitRadFx = (baseHitRadiusFx + ((candProf?.radiusFx || 600) >> 1)) | 0;
        const d = fxHypot((cand.x - proj.impactXFx) | 0, (cand.z - proj.impactZFx) | 0);
        if (d <= effectiveHitRadFx && d <= bestDist) {
          const hitAllied = hitEnt ? (gameState.areTeamsAllied ? gameState.areTeamsAllied(hitEnt.team, proj.shooterTeam) : hitEnt.team === proj.shooterTeam) : false;
          if (!hitEnt || (hitAllied && !candAllied)) {
            bestDist = d;
            hitEnt = cand;
          }
        }
      }

      if (hitEnt) {
        const shooter = entitiesMap.get(proj.shooterId) || null;
        const shooterComp = companiesMap?.get(proj.shooterCompanyId) || null;
        const shooterProf = gameState.movementSystem.getPhysicsProfile(shooter?.unitTypeIdx ?? 3);
        const defProf = gameState.movementSystem.getPhysicsProfile(hitEnt.unitTypeIdx);
        const defComp = companiesMap?.get(hitEnt.squadIndex) || null;

        const blockRes = proj.isBallista
          ? { blocked: false, arcInfo: this.classifyAttackArc(proj.fromXFx, proj.fromZFx, hitEnt) }
          : this.rollDeterministicFrontalBlock(
              gameState,
              shooter,
              shooterProf,
              hitEnt,
              defProf,
              true,
              proj.fromXFx,
              proj.fromZFx
            );

        if (blockRes.blocked) {
          hitEnt.blockVisualTicks = 8;
          hitEnt.animState = AnimState.BLOCK ?? AnimState.IDLE;
          continue;
        }

        const finalDmg = this.computeResolvedDamage(
          proj.damage,
          shooter,
          shooterComp,
          hitEnt,
          defProf,
          defComp,
          blockRes.arcInfo,
          true
        );

        hitEnt.hp = Math.max(0, (hitEnt.hp - finalDmg) | 0);
        hitEnt.ticksSinceLastHit = 0;
        if (proj.isFireArrow) {
          hitEnt.burningTicks = 60;
        }
        if (proj.isBallista && !hitEnt.isHero && hitEnt.unitTypeIdx !== 5 && hitEnt.unitTypeIdx !== 6 && hitEnt.hp > 0) {
          hitEnt.knockdownTicks = Math.max(hitEnt.knockdownTicks | 0, 28);
          hitEnt.animState = AnimState.KNOCKED_DOWN ?? AnimState.HURT;
        }
        if (proj.isBallista) {
          const splashDmg = Math.max(12, mulDiv(proj.damage, 450, 1000));
          for (let sIdx = 0; sIdx < nearbyIds.length; sIdx++) {
            const sEnt = entitiesMap.get(nearbyIds[sIdx]);
            if (!sEnt || sEnt.id === hitEnt.id || sEnt.hp <= 0 || sEnt.isGarrisoned) continue;
            const sAllied = gameState.areTeamsAllied ? gameState.areTeamsAllied(sEnt.team, proj.shooterTeam) : sEnt.team === proj.shooterTeam;
            if (sAllied) continue;
            const sd = fxHypot((sEnt.x - proj.impactXFx) | 0, (sEnt.z - proj.impactZFx) | 0);
            if (sd <= 2458) {
              sEnt.hp = Math.max(0, (sEnt.hp - splashDmg) | 0);
              sEnt.ticksSinceLastHit = 0;
              if (sEnt.hp <= 0) {
                sEnt.animState = AnimState.DIE;
                this.releaseAttackerSlot(sEnt);
              }
            }
          }
        }

        if (defComp) {
          defComp.ticksSinceLastCombat = 0;
          gameState.moraleStaminaSystem?.onUnitDamaged(
            defComp,
            defProf,
            blockRes.arcInfo.arc,
            false,
            proj.isFireArrow
          );
        }

        if (hitEnt.hp <= 0) {
          hitEnt.animState = AnimState.DIE;
          this.releaseAttackerSlot(hitEnt);
        } else {
          this.applyDamageHurtReaction(hitEnt, defComp, AnimState, true);
        }
        if (!proj.isBallista) {
          continue;
        }
      }

      const bIds = gameState.constructionSystem?.sortedBuildingIds || [];
      const buildingsMap = gameState.constructionSystem?.buildings;
      if (buildingsMap && bIds.length > 0) {
        for (let bIdx = 0; bIdx < bIds.length; bIdx++) {
          const b = buildingsMap.get(bIds[bIdx]);
          if (
            !b ||
            b.isDestroyed ||
            b.type === 'citadel_slot' ||
            b.hp <= 0 ||
            (gameState.areTeamsAllied ? gameState.areTeamsAllied(b.team, proj.shooterTeam) : b.team === proj.shooterTeam)
          ) {
            continue;
          }
          const bRadFx = Math.round((b.footprintRadiusMeters + 1.8) * FX_ONE) | 0;
          const dBld = fxHypot((proj.impactXFx - b.xFx) | 0, (proj.impactZFx - b.zFx) | 0);
          if (dBld <= bRadFx) {
            const bDef = gameState.constructionSystem?.buildingDefs?.[b.type];
            const arrowProtPermille = bDef?.arrowProtectionPermille ?? 700;
            const effectiveMultPermille = proj.isBallista
              ? (proj.vsBuildingMultiplierPermille || 3500)
              : proj.isFireArrow
                ? 850
                : Math.min(
                    proj.vsBuildingMultiplierPermille || 300,
                    Math.max(100, (1000 - arrowProtPermille) | 0)
                  );
            const bldDmg = Math.max(
              1,
              mulDiv(proj.damage, effectiveMultPermille, 1000)
            );
            b.hp = Math.max(0, (b.hp - bldDmg) | 0);
            if (b.hp <= 0) {
              gameState.constructionSystem?.handleBuildingDestroyedInCombat?.(b, gameState);
            }
            break;
          }
        }
      }
    }
  },
};
