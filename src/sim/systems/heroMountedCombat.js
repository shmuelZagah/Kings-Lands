/**
 * Kings Lands — Mounted Hero Trample, Anti-Charge Spear Counter & Cycle Charge Combat
 * (src/sim/systems/heroMountedCombat.js)
 */
import {
  FX_ONE,
  TICKS_PER_SEC,
  ANGLE_MASK,
  mulDiv,
  fxCos,
  fxSin,
  fxAtan2,
  fxHypot,
  fxClamp,
  toFx
} from '../../core/fx.js';
import { Company, CompanyOrderType, resolveDefaultFormation } from '../formations/company.js';
import { defaultHeroesData as defaultHeroesJson } from '../../data/defaults.js';
import { getSpellCastTimingProfile } from '../../render/heroSpellAnimations.js';

function safeFaceTarget(ent, targetXFx, targetZFx) {
  if (!ent) return;
  const dx = (targetXFx - ent.x) | 0;
  const dz = (targetZFx - ent.z) | 0;
  if (Math.abs(dx) + Math.abs(dz) > 64) {
    ent.dir = fxAtan2(dz, dx) & ANGLE_MASK;
  }
}

export const heroMountedCombatMethods = {
  /**
   * Universal Anti-Charge Counter Rule (`SPEAR_WALL` / `PIKE_PHALANX` / braced Spearman):
   * When any mounted charger (Sisnat on his Chameleon or Ravan on his Warhorse) collides with the front arc
   * of an anti-charge spear formation, the spear wall blocks the charge and converts the charger's attack force
   * into heavy counter-damage (`ANTI_CHARGE_IMPALE`) on the charger!
   */
  /**
   * Universal Anti-Charge Counter Rule (`SPEAR_WALL` / `PIKE_PHALANX` / braced Spearman):
   * - ZERO spell VFX or floating text (pure physics, identical to Cavalry vs. Spear Wall!).
   * - Converts the charger's intended charge attack into counter-damage on the charger (`ent.hp -= counterDamage`),
   *   and knocks the charger backward onto the ground for ~1 second (`knockdownTicks = 20`) before returning to combat.
   * - Because Sisnat's Giant Chameleon is so heavy (`weight 5.6`), his impact penetrates slightly and ALSO knocks down
   *   the front spearman he collided with ("מפיל ונופל"), whereas Mounted Ravan falls back without knocking the spearman down!
   */
  _checkAndApplySpearWallAntiCharge(gameState, comp, ent, foe) {
    if (!foe || foe.hp <= 0 || (foe.knockdownTicks | 0) > 0) return false;
    const foeComp = gameState.companies.get(foe.squadIndex);
    const isSpearWallFormation = Boolean(
      foeComp && (foeComp.formation === "SPEAR_WALL" || foeComp.formation === "PIKE_PHALANX")
    );
    const isBracedSpearman = Boolean(foe.unitTypeIdx === 2 && !foe.isMoving);
    if (!isSpearWallFormation && !isBracedSpearman) return false;

    // Check if the Hero is hitting the defender's front arc (±75 degrees, ~210 angle units)
    const dirToCharger = fxAtan2((ent.z - foe.z) | 0, (ent.x - foe.x) | 0);
    const rawDiff = ((dirToCharger - (foe.dir & ANGLE_MASK) + 512) & ANGLE_MASK) - 512;
    if (Math.abs(rawDiff) > 220) return false;

    const lastCounterTick = comp._lastAntiChargeTick || -999;
    if (gameState.tick - lastCounterTick < 18) return true;
    comp._lastAntiChargeTick = gameState.tick;

    // Convert the Hero's intended charge damage into counter-damage on the Hero!
    const baseHeroAtk = ent.damage || 64;
    const intendedChargeDmg = comp.activeChargeRush
      ? (comp.activeChargeRush.damage || 65) + Math.round(baseHeroAtk * 0.6)
      : Math.round(baseHeroAtk * 1.25);
    const counterDamage = Math.max(55, intendedChargeDmg);

    ent.hp = Math.max(1, (ent.hp - counterDamage) | 0);
    ent.ticksSinceLastHit = 0;
    ent.hurtVisualTicks = 14;
    ent.knockdownTicks = 20; // Falls back for ~1.0 second and then returns to fight!
    ent.chargeMomentumPermille = 0;
    ent.chargeRunDistFx = 0;
    comp._mountedRunDistFx = 0;
    comp.activeChargeRush = null;
    comp.isRunning = false;
    comp.wantsToRun = false;
    comp._mountedPassState = "STUCK_MELEE";
    comp._mountedStuckTicks = 55;
    comp._mountedPassMassAccum = 999;

    // Spearman thrusts his spear
    foe.windupTicks = 6;
    foe.animState = 3; // ATTACK

    // If Sisnat (heavy Chameleon), his sheer weight penetrates slightly and also knocks down the spearman he hit ("מפיל ונופל")!
    if (comp.heroId === "sisnat") {
      const pierceDmg = Math.max(22, Math.round(baseHeroAtk * 0.45));
      foe.hp = Math.max(0, (foe.hp - pierceDmg) | 0);
      foe.ticksSinceLastHit = 0;
      this._applyRadialKnockback(gameState, ent.x, ent.z, foe, 3.6, 26, 4.8);
    }

    // Recoil the Hero backward away from the spear points
    const recoilDir = fxAtan2((ent.z - foe.z) | 0, (ent.x - foe.x) | 0);
    ent.knockbackVxFx = mulDiv(230, fxCos(recoilDir), FX_ONE);
    ent.knockbackVzFx = mulDiv(230, fxSin(recoilDir), FX_ONE);
    ent.knockbackSlideTicks = 6;
    ent.knockbackTotalSlideTicks = 6;
    ent.knockbackPeakHeightFx = Math.round(0.42 * FX_ONE);
    return true;
  },

  /**
   * Unified Mounted Hero Trample, Acceleration, Braking/Turning Cycle-Charge & Mass-Blocking Engine
   * Shared by BOTH Prince Ravan (when mounted on his Royal Warhorse) and Sisnat (on his Giant War Chameleon):
   * 1. Strict Obedience to Manual `MOVE` Orders: if the player ordered a ground `MOVE` (`!comp._mountedAutoOrder`),
   *    never hijack the move order at any distance!
   * 2. Acceleration Required (`comp._mountedRunDistFx >= 4.5m`): cannot perform a charge/trample from 0 range!
   *    Must run for at least 4.5m to build charge momentum.
   * 3. When Stuck (e.g. between enemy Cavalry or dense blockers): stops running (`comp.isRunning = false`),
   *    fights in normal melee, and checks every 3.5 seconds (`70 ticks`) if he can run and return to cycle-charging.
   * 4. Persistent Target Lock (`comp._lockedCycleVictimId`): when enemy soldiers are scattered around Sisnat,
   *    he locks onto one standing soldier until that soldier is dead/knocked down rather than switching targets mid-way!
   */
  _stepMountedHeroTrampleAndCycleCombat(gameState, comp, ent, AnimState) {
    if (!comp || !ent || ent.hp <= 0) return;
    const isSisnat = comp.heroId === "sisnat";
    const isMountedRavan = Boolean(comp.isWarhorseMounted);
    if (!isSisnat && !isMountedRavan) return;
    if (comp.activeChargeRush || comp.pendingSpellCast || (ent.activeSpellTimerTicks | 0) > 0 || (ent.knockdownTicks | 0) > 0) {
      return;
    }

    if (!comp._trampleCooldownByVictim) comp._trampleCooldownByVictim = new Map();

    // Track continuous running distance for charge impact (`_mountedRunDistFx`)
    const actualMoved = ent._lastActualMovedFx ?? 0;
    if (ent.isMoving && comp.isRunning && actualMoved >= 55) {
      comp._mountedRunDistFx = ((comp._mountedRunDistFx | 0) + actualMoved) | 0;
    } else if (!ent.isMoving || !comp.isRunning || actualMoved < 25) {
      comp._mountedRunDistFx = 0;
    }
    // Require ~1.8m of running acceleration so point-blank 0m contact doesn't fling, while any real run-in tramples!
    const hasChargeAcceleration = (comp._mountedRunDistFx | 0) >= Math.round(1.8 * FX_ONE);

    // 1. Strict Obedience to Player's Manual Ground MOVE Orders (at ANY distance!):
    const isPlayerManualGroundMove =
      (comp.orderType === CompanyOrderType.MOVE &&
        !comp._mountedAutoOrder &&
        (comp.targetEnemyCompanyId | 0) < 0 &&
        (comp.targetEnemyBuildingId | 0) <= 0) ||
      (comp.postManualMoveHoldTicks | 0) > 0;
    if (isPlayerManualGroundMove) {
      comp._mountedPassState = null;
      comp._lockedCycleVictimId = -1;
      return;
    }

    const isRavanInWarBuff = isMountedRavan && (comp.heroActiveBuffs?.azureFuryTicks | 0) > 0;
    const maxFlingWeight = isSisnat ? 4.8 : isRavanInWarBuff ? 4.5 : 2.6;
    const maxMassCapacity = isSisnat ? 560 : 380;

    // 2. Trample, Fling & Weapon Swing while Running Forward
    if (ent.isMoving && comp.isRunning && hasChargeAcceleration) {
      const trampleRadFx = Math.round((isSisnat ? 2.85 : 2.55) * FX_ONE);
      const nearIds = gameState.spatialHash.queryRadiusIds(ent.x, ent.z, trampleRadFx, gameState.entities);
      for (let i = 0; i < nearIds.length; i++) {
        const foe = gameState.entities.get(nearIds[i]);
        if (!foe || foe.hp <= 0 || foe.id === ent.id || foe.isGarrisoned) continue;
        if (gameState.areTeamsAllied ? gameState.areTeamsAllied(foe.team, comp.team) : foe.team === comp.team) continue;

        const dirToFoe = fxAtan2((foe.z - ent.z) | 0, (foe.x - ent.x) | 0);
        const angleFromFacing = Math.abs(((dirToFoe - (ent.dir & ANGLE_MASK) + 512) & ANGLE_MASK) - 512);
        if (angleFromFacing > 235) continue;

        // Check Spear Wall / Anti-Charge Counter Strike FIRST!
        if (this._checkAndApplySpearWallAntiCharge(gameState, comp, ent, foe)) {
          return;
        }

        const lastHitTick = comp._trampleCooldownByVictim.get(foe.id) || -999;
        if (gameState.tick - lastHitTick < 22) continue;
        comp._trampleCooldownByVictim.set(foe.id, gameState.tick);

        const foeMass = foe.mass || (foe.unitTypeIdx === 4 ? 340 : foe.unitTypeIdx === 2 ? 130 : 120);
        comp._mountedPassMassAccum = ((comp._mountedPassMassAccum | 0) + foeMass) | 0;

        // Mounted Ravan out of war-buff does not fling enemy Cavalry (unitTypeIdx === 4)
        if (isMountedRavan && !isRavanInWarBuff && foe.unitTypeIdx === 4) {
          comp._mountedPassMassAccum = ((comp._mountedPassMassAccum | 0) + 260) | 0;
          continue;
        }

        const trampleDmg = Math.max(28, Math.round((ent.damage || 64) * (isSisnat ? 0.6 : 0.7)));
        foe.hp = Math.max(0, (foe.hp - trampleDmg) | 0);
        foe.ticksSinceLastHit = 0;
        this._applyRadialKnockback(
          gameState,
          (ent.x - mulDiv(512, fxCos(ent.dir), FX_ONE)) | 0,
          (ent.z - mulDiv(512, fxSin(ent.dir), FX_ONE)) | 0,
          foe,
          isSisnat ? 5.4 : 5.0,
          32,
          maxFlingWeight
        );
        if ((ent.windupTicks | 0) <= 0) {
          ent.windupTicks = 6;
        }
      }
    }

    // 3. Scan nearby standing enemies within 16m and maintain a persistent target lock (`_lockedCycleVictimId`)
    const engageRadFx = Math.round(16.0 * FX_ONE);
    const closeBlockRadFx = Math.round(2.85 * FX_ONE);
    const nearbyIds = gameState.spatialHash.queryRadiusIds(ent.x, ent.z, engageRadFx, gameState.entities);
    let frontStandingBlockers = 0;
    let closeCavalryBlockers = 0;
    let closeStandingMass = 0;
    let nearestStandingFoe = null;
    let nearestDistFx = 0x7fffffff;
    const standingFoes = [];

    for (let i = 0; i < nearbyIds.length; i++) {
      const foe = gameState.entities.get(nearbyIds[i]);
      if (!foe || foe.hp <= 0 || foe.id === ent.id || foe.isGarrisoned) continue;
        if (gameState.areTeamsAllied ? gameState.areTeamsAllied(foe.team, comp.team) : foe.team === comp.team) continue;
      if ((foe.knockdownTicks | 0) > 0) continue;
      const dFx = fxHypot((foe.x - ent.x) | 0, (foe.z - ent.z) | 0);
      standingFoes.push({ foe, dFx });

      if (dFx <= closeBlockRadFx) {
        if (foe.unitTypeIdx === 4) closeCavalryBlockers++;
        const dirToFoe = fxAtan2((foe.z - ent.z) | 0, (foe.x - ent.x) | 0);
        const diff = Math.abs(((dirToFoe - (ent.dir & ANGLE_MASK) + 512) & ANGLE_MASK) - 512);
        if (diff <= 185) {
          frontStandingBlockers++;
          closeStandingMass += foe.mass || (foe.unitTypeIdx === 4 ? 340 : 120);
        }
      }
      if (dFx < nearestDistFx) {
        nearestDistFx = dFx;
        nearestStandingFoe = foe;
      }
    }

    if (!nearestStandingFoe) {
      if (comp._mountedPassState) {
        comp._mountedPassState = null;
        comp._mountedAutoOrder = false;
      }
      comp._lockedCycleVictimId = -1;
      return;
    }

    // Persistent target lock (`_lockedCycleVictimId`) so he never oscillates between scattered enemies!
    let lockedFoe = null;
    if ((comp._lockedCycleVictimId | 0) > 0) {
      const cand = gameState.entities.get(comp._lockedCycleVictimId | 0);
      if (
        cand &&
        cand.hp > 0 &&
        (gameState.areTeamsEnemy ? gameState.areTeamsEnemy(cand.team, comp.team) : cand.team !== comp.team) &&
        !cand.isGarrisoned &&
        (cand.knockdownTicks | 0) <= 0 &&
        fxHypot((cand.x - ent.x) | 0, (cand.z - ent.z) | 0) <= 18 * FX_ONE
      ) {
        lockedFoe = cand;
      }
    }
    if (!lockedFoe) {
      lockedFoe = nearestStandingFoe;
      comp._lockedCycleVictimId = lockedFoe.id;
    }

    const clusterRadFx = Math.round(4.5 * FX_ONE);
    let clusterCount = 0;
    let clusterSumX = 0;
    let clusterSumZ = 0;
    for (let i = 0; i < standingFoes.length; i++) {
      const sf = standingFoes[i].foe;
      if (fxHypot((sf.x - lockedFoe.x) | 0, (sf.z - lockedFoe.z) | 0) <= clusterRadFx) {
        clusterCount++;
        clusterSumX += sf.x;
        clusterSumZ += sf.z;
      }
    }
    const targetXFx = clusterCount >= 2 ? Math.round(clusterSumX / clusterCount) | 0 : lockedFoe.x;
    const targetZFx = clusterCount >= 2 ? Math.round(clusterSumZ / clusterCount) | 0 : lockedFoe.z;

    let closeStandingWithin4m = 0;
    for (let i = 0; i < standingFoes.length; i++) {
      if (standingFoes[i].dFx <= Math.round(4.0 * FX_ONE)) {
        closeStandingWithin4m++;
      }
    }

    // 4. State: STUCK_MELEE (When inside an enemy squad or blocked by enemy mass: fights surrounding enemies directly in melee!)
    if (comp._mountedPassState === "STUCK_MELEE") {
      comp._mountedStuckTicks = ((comp._mountedStuckTicks | 0) - 1) | 0;
      comp._mountedAutoOrder = false;
      comp.isRunning = false;
      comp.wantsToRun = false;
      comp._mountedRunDistFx = 0;
      comp.engagedTargetEntityId = lockedFoe.id;

      // On Sisnat's axe swing while fighting in melee, knock back 1-2 closest foes in front of him
      if (isSisnat && ent.windupTicks === 1) {
        let knocked = 0;
        for (let i = 0; i < standingFoes.length && knocked < 2; i++) {
          const foe = standingFoes[i].foe;
          if (standingFoes[i].dFx <= closeBlockRadFx + 512) {
            this._applyRadialKnockback(gameState, ent.x, ent.z, foe, 4.6, 28, maxFlingWeight);
            knocked++;
          }
        }
      }

      if (comp._mountedStuckTicks <= 0) {
        const stillBoxedByCavalry = isMountedRavan && !isRavanInWarBuff && closeCavalryBlockers >= 2;
        // If still surrounded by standing enemies at melee range, keep fighting in melee or launch a straight breakout pass (NEVER spin in circles inside the squad!)
        if (stillBoxedByCavalry || closeStandingWithin4m >= 3) {
          comp._mountedStuckTicks = 50;
          return;
        }
        comp._mountedPassState = null;
        comp._mountedPassMassAccum = 0;
      }
      return;
    }

    // 5. State: CURVE_TURN_AROUND (Smooth U-turn ONLY when clear outside the enemy squad!)
    if (comp._mountedPassState === "CURVE_TURN_AROUND") {
      // If an enemy is right next to the Hero during a turn, stop turning in circles and fight/plow immediately!
      if (nearestDistFx <= Math.round(3.4 * FX_ONE)) {
        comp._mountedPassState = "STUCK_MELEE";
        comp._mountedStuckTicks = 50;
        comp._mountedAutoOrder = false;
        comp.isRunning = false;
        comp.wantsToRun = false;
        comp.engagedTargetEntityId = lockedFoe.id;
        return;
      }

      comp._mountedTurnTicks = ((comp._mountedTurnTicks | 0) - 1) | 0;
      const totalT = Math.max(1, comp._mountedTurnTotalTicks || 16);
      const prog = 1.0 - comp._mountedTurnTicks / totalT;

      const dirToTarget = fxAtan2((targetZFx - ent.z) | 0, (targetXFx - ent.x) | 0) & ANGLE_MASK;
      const diffToTarget = ((dirToTarget - (ent.dir & ANGLE_MASK) + 512) & ANGLE_MASK) - 512;

      const turnSign = comp._curveTurnSign || (diffToTarget >= 0 ? 1 : -1);
      const stepAngle = Math.round(28 * (0.75 + 0.35 * Math.sin(prog * Math.PI)));
      comp._curveTurnAngle = ((comp._curveTurnAngle ?? ent.dir) + turnSign * stepAngle) & ANGLE_MASK;

      const lookAheadFx = Math.round(4.5 * FX_ONE);
      const arcXFx = fxClamp((ent.x + mulDiv(lookAheadFx, fxCos(comp._curveTurnAngle), FX_ONE)) | 0, 18 * FX_ONE, gameState.worldSizeFx - 18 * FX_ONE);
      const arcZFx = fxClamp((ent.z + mulDiv(lookAheadFx, fxSin(comp._curveTurnAngle), FX_ONE)) | 0, 18 * FX_ONE, gameState.worldSizeFx - 18 * FX_ONE);
      this._setMountedCycleMoveTarget(gameState, comp, ent, arcXFx, arcZFx, comp._curveTurnAngle);

      if (comp._mountedTurnTicks <= 0 || (prog >= 0.35 && Math.abs(diffToTarget) <= 105)) {
        comp._mountedPassState = null;
      }
      return;
    }

    // 6. Start or step PASS_THROUGH (Gallop straight through the enemy squad, trampling & flinging enemies aside!)
    if (!comp._mountedPassState) {
      // If already standing right inside the enemy squad without running speed, fight directly in melee first instead of orbiting!
      if (nearestDistFx <= Math.round(3.2 * FX_ONE) && !hasChargeAcceleration && closeStandingWithin4m >= 2) {
        comp._mountedPassState = "STUCK_MELEE";
        comp._mountedStuckTicks = 50;
        comp._mountedAutoOrder = false;
        comp.isRunning = false;
        comp.wantsToRun = false;
        comp.engagedTargetEntityId = lockedFoe.id;
        return;
      }

      const dx = (targetXFx - ent.x) | 0;
      const dz = (targetZFx - ent.z) | 0;
      const chargeDir = fxAtan2(dz, dx) & ANGLE_MASK;
      const overshootMeters = clusterCount >= 2 ? 8.5 : 6.0;
      const overshootFx = Math.round(overshootMeters * FX_ONE);
      const goalXFx = fxClamp((targetXFx + mulDiv(overshootFx, fxCos(chargeDir), FX_ONE)) | 0, 18 * FX_ONE, gameState.worldSizeFx - 18 * FX_ONE);
      const goalZFx = fxClamp((targetZFx + mulDiv(overshootFx, fxSin(chargeDir), FX_ONE)) | 0, 18 * FX_ONE, gameState.worldSizeFx - 18 * FX_ONE);

      comp._mountedPassState = "PASS_THROUGH";
      comp._mountedPassTicks = 36;
      comp._mountedPassMassAccum = 0;
      comp._mountedLowProgressTicks = 0;
      comp._passGoalXFx = goalXFx;
      comp._passGoalZFx = goalZFx;
      comp._passChargeDir = chargeDir;
      this._setMountedCycleMoveTarget(gameState, comp, ent, goalXFx, goalZFx, chargeDir);
    }

    if (comp._mountedPassState === "PASS_THROUGH") {
      comp._mountedPassTicks = ((comp._mountedPassTicks | 0) - 1) | 0;
      if (actualMoved < 50 && frontStandingBlockers >= 1) {
        comp._mountedLowProgressTicks = ((comp._mountedLowProgressTicks | 0) + 1) | 0;
      } else {
        comp._mountedLowProgressTicks = 0;
      }

      // Check if enemy mass or enemy cavalry has halted the charge -> fight in STUCK_MELEE directly!
      const blockedByCav = isMountedRavan && !isRavanInWarBuff && closeCavalryBlockers >= 2;
      if (
        blockedByCav ||
        (comp._mountedLowProgressTicks | 0) >= 6 ||
        (comp._mountedPassMassAccum | 0) >= maxMassCapacity ||
        (frontStandingBlockers >= 3 && closeStandingMass >= maxMassCapacity * 0.75)
      ) {
        comp._mountedPassState = "STUCK_MELEE";
        comp._mountedStuckTicks = 55;
        comp._mountedAutoOrder = false;
        comp.isRunning = false;
        comp.wantsToRun = false;
        comp.engagedTargetEntityId = lockedFoe.id;
        return;
      }

      const distToGoal = fxHypot((comp.targetXFx - ent.x) | 0, (comp.targetZFx - ent.z) | 0);
      if (comp._mountedPassTicks <= 0 || distToGoal <= Math.round(2.4 * FX_ONE)) {
        // If there are still standing enemies within 4.0m around the Hero, fight them in melee instead of circling inside the squad!
        if (closeStandingWithin4m >= 1 || nearestDistFx <= Math.round(4.0 * FX_ONE)) {
          comp._mountedPassState = "STUCK_MELEE";
          comp._mountedStuckTicks = 50;
          comp._mountedAutoOrder = false;
          comp.isRunning = false;
          comp.wantsToRun = false;
          comp.engagedTargetEntityId = lockedFoe.id;
          return;
        }
        // Emerged clear outside the enemy squad: bank around smoothly for another pass!
        const dirToEnemyNow = fxAtan2((targetZFx - ent.z) | 0, (targetXFx - ent.x) | 0) & ANGLE_MASK;
        const diffNow = ((dirToEnemyNow - (ent.dir & ANGLE_MASK) + 512) & ANGLE_MASK) - 512;
        comp._mountedPassState = "CURVE_TURN_AROUND";
        comp._mountedTurnTicks = 16;
        comp._mountedTurnTotalTicks = 16;
        comp._curveTurnAngle = ent.dir & ANGLE_MASK;
        comp._curveTurnSign = diffNow >= 0 ? 1 : -1;
        comp._mountedPassMassAccum = 0;
      }
    }
  },

  _setMountedCycleMoveTarget(gameState, comp, ent, targetXFx, targetZFx, desiredDir) {
    const nav = gameState.navGrid;
    const walkable = nav.findNearestWalkableTile(
      nav.worldFxToTileX(targetXFx),
      nav.worldFxToTileZ(targetZFx),
      8
    );
    const wxFx = nav.tileToWorldCenterFxX(walkable.tx);
    const wzFx = nav.tileToWorldCenterFxZ(walkable.tz);

    comp._mountedAutoOrder = true;
    comp.isExplicitGroundMove = false;
    comp.orderType = CompanyOrderType.MOVE;
    comp.targetXFx = wxFx;
    comp.targetZFx = wzFx;
    comp.desiredFacingDir = desiredDir & ANGLE_MASK;
    comp.wantsToRun = true;
    comp.isRunning = true;
    comp.staminaPermille = Math.max(comp.staminaPermille | 0, 600);
    comp.pathWaypoints = null;
    comp.pathIndex = 0;

    ent.slotTargetXFx = wxFx;
    ent.slotTargetZFx = wzFx;
    ent.targetX = wxFx;
    ent.targetZ = wzFx;
    ent.desiredFacingDir = desiredDir & ANGLE_MASK;
    ent.pathWaypoints = null;
    ent.pathIndex = 0;
    ent.atSlot = 0;
    ent.settled = 0;
    ent.isMoving = true;
  },
};
