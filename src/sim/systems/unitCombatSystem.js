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

export class UnitCombatSystem {
  constructor(spatialHash, navGrid) {
    this.spatialHash = spatialHash;
    this.navGrid = navGrid;
    this.coreCombat = new CombatSystem(spatialHash, navGrid);
    this._neighborScratch = [];
  }

  beginTick(gameState, enums) {
    this._gameState = gameState;
    this.coreCombat.cleanupSlotReservations(gameState.entities);
    this.coreCombat.stepBallisticProjectiles(gameState, enums);
  }

  findNearestEnemyEntity(xFx, zFx, scanRadiusFx, myTeam, entitiesMap, options = {}) {
    const canHitFlying = Boolean(options.canHitFlying);
    const attackAllTeams = Boolean(options.attackAllTeams);
    const excludeEntityId = options.excludeEntityId ?? -1;
    const requireFreeMeleeSlot = Boolean(options.requireFreeMeleeSlot);
    const attackerId = options.attackerId ?? -1;
    const attackerEnt = options.attackerEnt ?? null;
    const attackerProf = options.attackerProf ?? null;
    const anchorXFx = options.anchorXFx ?? null;
    const anchorZFx = options.anchorZFx ?? null;
    const maxDistFromAnchorFx = options.maxDistFromAnchorFx ?? 0;
    const onlySquadIndex =
      options.onlySquadIndex !== undefined && options.onlySquadIndex !== null
        ? options.onlySquadIndex | 0
        : -1;
    const preferUnknocked = Boolean(options.preferUnknocked);
    const preferUnobstructed = Boolean(options.preferUnobstructed);
    const fovFacingDir =
      options.fovFacingDir !== undefined && options.fovFacingDir !== null
        ? options.fovFacingDir & ANGLE_MASK
        : null;
    const fovOriginXFx = options.fovOriginXFx ?? xFx;
    const fovOriginZFx = options.fovOriginZFx ?? zFx;

    const penaltyFree = !preferUnknocked && !requireFreeMeleeSlot && !preferUnobstructed;
    let nearestEnemy = null;
    let bestScoreDist = 0x7fffffff;
    let bestRawDist = 0x7fffffff;

    if (penaltyFree) {
      // Score == plain distance: search ring by ring and stop at the first ring that cannot beat the best (exact same winner).
      const accepts = (cand) => {
        if (!cand || cand.hp <= 0 || cand.isGarrisoned || cand.id === excludeEntityId) return false;
        const isAllied = this._gameState?.areTeamsAllied ? this._gameState.areTeamsAllied(cand.team, myTeam) : cand.team === myTeam;
        if (!attackAllTeams && isAllied) return false;
        if (onlySquadIndex >= 0 && (cand.squadIndex | 0) !== onlySquadIndex) return false;
        if (cand.isFlying && !canHitFlying) return false;
        if (fovFacingDir !== null) {
          const dirToCand = fxAtan2((cand.z - fovOriginZFx) | 0, (cand.x - fovOriginXFx) | 0);
          const rawDiff = ((dirToCand - fovFacingDir + 512) & ANGLE_MASK) - 512;
          if (fxAbs(rawDiff) > 384) {
            // Enemy is in the rear 90° blindspot (> ±135°): unit/company cannot see behind itself!
            return false;
          }
        }
        if (requireFreeMeleeSlot && !this.coreCombat.hasFreeMeleeSlot(cand.id, attackerId)) {
          return false;
        }

        if (anchorXFx !== null && maxDistFromAnchorFx > 0) {
          const dAnchor = fxHypot(
            (cand.x - anchorXFx) | 0,
            (cand.z - anchorZFx) | 0
          );
          if (dAnchor > maxDistFromAnchorFx) return false;
        }

        return true;
      };
      const scanned = this.spatialHash.scanRings(
        xFx,
        zFx,
        scanRadiusFx,
        entitiesMap,
        attackAllTeams ? -1 : myTeam,
        (cand) => {
          if (cand.isGarrisoned || cand.id === excludeEntityId || !accepts(cand)) {
            return nearestEnemy ? bestScoreDist : Infinity;
          }
          const d = fxHypot((cand.x - xFx) | 0, (cand.z - zFx) | 0);
          if (
            d < bestScoreDist ||
            (d === bestScoreDist && nearestEnemy !== null && cand.id < nearestEnemy.id)
          ) {
            bestScoreDist = d;
            bestRawDist = d;
            nearestEnemy = cand;
          }
          return nearestEnemy ? bestScoreDist : Infinity;
        }
      );
      if (scanned) return { enemy: nearestEnemy, distFx: bestRawDist };
    }

    const nearbyIds = this.spatialHash.queryRadiusIds(
      xFx,
      zFx,
      scanRadiusFx,
      entitiesMap,
      this._neighborScratch,
      attackAllTeams ? -1 : myTeam, // same-team units are skipped below anyway: never collect them
      false // unsorted: ties are broken by lowest id below (same result as ascending iteration)
    );

    for (let i = 0; i < nearbyIds.length; i++) {
      const cand = entitiesMap.get(nearbyIds[i]);
      if (!cand || cand.hp <= 0 || cand.isGarrisoned || cand.id === excludeEntityId) continue;
      const isAllied = this._gameState?.areTeamsAllied ? this._gameState.areTeamsAllied(cand.team, myTeam) : cand.team === myTeam;
      if (!attackAllTeams && isAllied) continue;
      if (onlySquadIndex >= 0 && (cand.squadIndex | 0) !== onlySquadIndex) continue;
      if (cand.isFlying && !canHitFlying) continue;
      if (fovFacingDir !== null) {
        const dirToCand = fxAtan2((cand.z - fovOriginZFx) | 0, (cand.x - fovOriginXFx) | 0);
        const rawDiff = ((dirToCand - fovFacingDir + 512) & ANGLE_MASK) - 512;
        if (fxAbs(rawDiff) > 384) {
          // Enemy is in the rear 90° blindspot (> ±135°): unit/company cannot see behind itself!
          continue;
        }
      }
      if (requireFreeMeleeSlot && !this.coreCombat.hasFreeMeleeSlot(cand.id, attackerId)) {
        continue;
      }

      if (anchorXFx !== null && maxDistFromAnchorFx > 0) {
        const dAnchor = fxHypot(
          (cand.x - anchorXFx) | 0,
          (cand.z - anchorZFx) | 0
        );
        if (dAnchor > maxDistFromAnchorFx) continue;
      }

      const d = fxHypot((cand.x - xFx) | 0, (cand.z - zFx) | 0);
      let scoreDist = d;

      if (preferUnknocked && (cand.knockdownTicks | 0) > 0) {
        scoreDist = (scoreDist + 12 * FX_ONE) | 0;
      }

      if (requireFreeMeleeSlot) {
        const occupiedSlots = this.coreCombat.getOccupiedSlotCount(cand.id);
        scoreDist = (scoreDist + occupiedSlots * (2 * FX_ONE)) | 0;
      }

      if (
        preferUnobstructed &&
        attackerEnt &&
        this.coreCombat.hasTeammateBlockingForwardPath(
          attackerEnt,
          cand.x,
          cand.z,
          entitiesMap,
          attackerProf
        )
      ) {
        scoreDist = (scoreDist + 9 * FX_ONE) | 0;
      }

      if (
        scoreDist < bestScoreDist ||
        (scoreDist === bestScoreDist && nearestEnemy !== null && cand.id < nearestEnemy.id)
      ) {
        bestScoreDist = scoreDist;
        bestRawDist = d;
        nearestEnemy = cand;
      }
    }
    return { enemy: nearestEnemy, distFx: bestRawDist };
  }

  /**
   * Finds the nearest enemy building within `scanRadiusFx` (measured to the building's outer perimeter).
   */
  findNearestEnemyBuilding(xFx, zFx, scanRadiusFx, myTeam, gameState, onlyBuildingId = -1) {
    const cs = gameState?.constructionSystem;
    if (!cs || !cs.buildings) return { building: null, perimeterDistFx: 0x7fffffff };

    if (onlyBuildingId > 0) {
      const lockedBld = cs.buildings.get(onlyBuildingId | 0);
      if (
        lockedBld &&
        !lockedBld.isDestroyed &&
        lockedBld.type !== 'citadel_slot' &&
        lockedBld.hp > 0 &&
        lockedBld.team !== myTeam
      ) {
        const footprintFx = Math.round((lockedBld.footprintRadiusMeters || 4) * FX_ONE) | 0;
        const centerDistFx = fxHypot((lockedBld.xFx - xFx) | 0, (lockedBld.zFx - zFx) | 0);
        const perimDistFx = Math.max(0, (centerDistFx - footprintFx) | 0);
        return { building: lockedBld, perimeterDistFx: perimDistFx, footprintFx };
      }
      return { building: null, perimeterDistFx: 0x7fffffff, footprintFx: 0 };
    }

    const bIds = cs.sortedBuildingIds;
    let bestBld = null;
    let bestPerimDist = 0x7fffffff;
    let bestFootprintFx = 0;

    for (let i = 0; i < bIds.length; i++) {
      const b = cs.buildings.get(bIds[i]);
      if (!b || b.isDestroyed || b.type === 'citadel_slot' || b.hp <= 0 || b.team === myTeam) {
        continue;
      }
      const footprintFx = Math.round((b.footprintRadiusMeters || 4) * FX_ONE) | 0;
      const centerDistFx = fxHypot((b.xFx - xFx) | 0, (b.zFx - zFx) | 0);
      const perimDistFx = Math.max(0, (centerDistFx - footprintFx) | 0);
      if (perimDistFx <= scanRadiusFx && perimDistFx < bestPerimDist) {
        bestPerimDist = perimDistFx;
        bestBld = b;
        bestFootprintFx = footprintFx;
      }
    }

    return { building: bestBld, perimeterDistFx: bestPerimDist, footprintFx: bestFootprintFx };
  }

  _evaluatePhysicalInterceptionBreak(comp, entitiesMap) {
    const lockedSquadId = comp.targetEnemyCompanyId | 0;
    const lockedBldId = comp.targetEnemyBuildingId | 0;
    if (lockedSquadId < 0 && lockedBldId <= 0) return false;

    if (lockedSquadId >= 0) {
      const targetComp = entitiesMap.companies?.get(lockedSquadId);
      let targetAlive = false;
      if (targetComp && targetComp.team !== comp.team) {
        for (let i = 0; i < targetComp.memberIds.length; i++) {
          const m = entitiesMap.get(targetComp.memberIds[i]);
          if (m && m.hp > 0 && !m.isGarrisoned) {
            targetAlive = true;
            break;
          }
        }
      }

      if (!targetAlive) {
        comp.targetEnemyCompanyId = -1;
        comp.interceptedTicks = 0;
        return true;
      }
    }

    let aliveCount = 0;
    let bodyBlockedCount = 0;
    const contactRadFx = (3 * FX_ONE + 205) | 0;

    for (let i = 0; i < comp.memberIds.length; i++) {
      const mem = entitiesMap.get(comp.memberIds[i]);
      if (!mem || mem.hp <= 0 || mem.isGarrisoned) continue;
      aliveCount++;

      const res = this.findNearestEnemyEntity(
        mem.x,
        mem.z,
        contactRadFx,
        comp.team,
        entitiesMap,
        { canHitFlying: Boolean(mem.isFlying) }
      );
      if (res.enemy && (res.enemy.squadIndex | 0) !== lockedSquadId) {
        bodyBlockedCount++;
      }
    }

    const minBlockedForIntercept = Math.max(2, ((aliveCount * 400) / 1000) | 0);
    if (bodyBlockedCount >= minBlockedForIntercept) {
      comp.interceptedTicks = ((comp.interceptedTicks | 0) + 1) | 0;
      if (comp.interceptedTicks >= 30) {
        comp.targetEnemyCompanyId = -1;
        comp.targetEnemyBuildingId = -1;
        comp.interceptedTicks = 0;
        return true;
      }
    } else {
      comp.interceptedTicks = Math.max(0, ((comp.interceptedTicks | 0) - 1) | 0);
    }

    return false;
  }

  evaluateCompanyCombatEngagement(comp, prof, entitiesMap, gameState = null) {
    comp.anchorMovedThisTick = false;
    if ((comp.postManualMoveHoldTicks | 0) > 0) {
      comp.postManualMoveHoldTicks = (comp.postManualMoveHoldTicks - 1) | 0;
    }

    if (comp.orderType === CompanyOrderType.ROUTING) {
      comp.engagedTargetEntityId = -1;
      comp.engagedTargetBuildingId = -1;
      return false;
    }

    const isRampaging = comp.orderType === CompanyOrderType.RAMPAGE;
    const isAttackMove = comp.orderType === CompanyOrderType.ATTACK_MOVE;
    const isPatrol = comp.orderType === CompanyOrderType.PATROL;
    const isIdleOrHold = !comp.isActivelyMoving();
    const hasExplicitTarget =
      !isRampaging &&
      ((comp.targetEnemyCompanyId | 0) >= 0 || (comp.targetEnemyBuildingId | 0) > 0);

    if (comp.isWorking || comp.unitType === 'worker') {
      return false;
    }

    // When a ranged/siege company (e.g. Ballista or Archers) just finished a manual ground MOVE order
    // (postManualMoveHoldTicks > 0), let its members finish walking into their formation slots before locking onto distant targets!
    if ((comp.postManualMoveHoldTicks | 0) > 0 && isIdleOrHold && !hasExplicitTarget && Boolean(prof.isRanged || prof.isSiege)) {
      let anyStillWalkingToSlot = false;
      for (let i = 0; i < comp.memberIds.length; i++) {
        const mem = entitiesMap.get(comp.memberIds[i]);
        if (mem && mem.hp > 0 && !mem.isGarrisoned && typeof mem.slotTargetXFx === "number" && typeof mem.slotTargetZFx === "number") {
          const dSlot = fxHypot((mem.slotTargetXFx - mem.x) | 0, (mem.slotTargetZFx - mem.z) | 0);
          if (dSlot > 750) {
            anyStillWalkingToSlot = true;
            break;
          }
        }
      }
      if (anyStillWalkingToSlot) {
        comp.engagedTargetEntityId = -1;
        comp.engagedTargetBuildingId = -1;
        return false;
      }
    }

    // When marching on an explicit ground MOVE order (no enemy target clicked):
    // Keep walking and obey the player's MOVE order UNLESS >70% of the company (or a solo Hero)
    // is physically body-blocked by enemies and unable to make forward progress for 3.0 seconds (60 ticks)!
    if (!isRampaging && !isAttackMove && !isPatrol && !isIdleOrHold && !hasExplicitTarget) {
      let aliveCnt = 0;
      let blockedCnt = 0;
      const blockRadFx = Math.round(2.45 * FX_ONE);
      for (let i = 0; i < comp.memberIds.length; i++) {
        const mem = entitiesMap.get(comp.memberIds[i]);
        if (!mem || mem.hp <= 0 || mem.isGarrisoned) continue;
        aliveCnt++;
        const movedNow = mem._lastActualMovedFx ?? 200;
        if (movedNow < 45) {
          const nearRes = this.findNearestEnemyEntity(mem.x, mem.z, blockRadFx, comp.team, entitiesMap);
          if (nearRes.enemy) {
            blockedCnt++;
          }
        }
      }
      const isSeverelyBlocked = aliveCnt > 0 && blockedCnt * 10 >= aliveCnt * 7;
      if (isSeverelyBlocked) {
        comp.moveBlockedTicks = ((comp.moveBlockedTicks | 0) + 1) | 0;
        if (comp.moveBlockedTicks >= 60) {
          // Physically blocked for 3 full seconds — break MOVE order and fight back!
          comp.moveBlockedTicks = 0;
          comp.isExplicitGroundMove = false;
          comp.stopInPlace(this.navGrid, entitiesMap);
        } else {
          comp.engagedTargetEntityId = -1;
          comp.engagedTargetBuildingId = -1;
          return false;
        }
      } else {
        comp.moveBlockedTicks = Math.max(0, ((comp.moveBlockedTicks | 0) - 2) | 0);
        comp.engagedTargetEntityId = -1;
        comp.engagedTargetBuildingId = -1;
        return false;
      }
    }

    this._evaluatePhysicalInterceptionBreak(comp, entitiesMap);
    const lockedEnemySquadId = isRampaging ? -1 : (comp.targetEnemyCompanyId | 0);
    const lockedEnemyBldId = isRampaging ? -1 : (comp.targetEnemyBuildingId | 0);
    const canAdvanceAnchorInCombat =
      isRampaging || isAttackMove || isPatrol || lockedEnemySquadId >= 0 || lockedEnemyBldId > 0;

    let firstAliveMember = null;
    for (let i = 0; i < comp.memberIds.length; i++) {
      const m = entitiesMap.get(comp.memberIds[i]);
      if (m && m.hp > 0) {
        firstAliveMember = m;
        break;
      }
    }
    const hasRangedAmmo = comp.memberIds.some((id) => {
      const m = entitiesMap.get(id);
      const isRangedUnit = m && m.isRanged !== undefined ? Boolean(m.isRanged) : Boolean(prof.isRanged);
      return Boolean(m && m.hp > 0 && isRangedUnit && (m.ammo | 0) > 0);
    });

    // Phase 6.9 Archer Fire Mode: When `comp.fireAtWill === false` ("Fire by Order"),
    // ranged companies hold their fire unless the player explicitly ordered them onto a specific
    // enemy company (`lockedEnemySquadId >= 0`) or enemy building (`lockedEnemyBldId > 0`)!
    if (
      hasRangedAmmo &&
      comp.fireAtWill === false &&
      lockedEnemySquadId < 0 &&
      lockedEnemyBldId <= 0
    ) {
      comp.engagedTargetEntityId = -1;
      comp.engagedTargetBuildingId = -1;
      return false;
    }

    const memberRangeFx = firstAliveMember?.attackRangeFx || 0;
    const memberMeleeRangeFx = firstAliveMember?.meleeAttackRangeFx || memberRangeFx || 0;
    const effectiveRangeFx =
      comp.formation === FormationTypes.PIKE_PHALANX && (comp.stanceTransitionTicks | 0) <= 0
        ? (prof.attackRangeFx + 1800) | 0
        : hasRangedAmmo
          ? (memberRangeFx || prof.attackRangeFx) | 0
          : ((firstAliveMember?.isHero ? memberMeleeRangeFx : 0) || prof.meleeAttackRangeFx || memberRangeFx || prof.attackRangeFx) | 0;

    // 1. Check Explicit Target Enemy Building Lock (`comp.targetEnemyBuildingId > 0`)
    if (lockedEnemyBldId > 0 && gameState) {
      const bldRes = this.findNearestEnemyBuilding(
        comp.anchorXFx,
        comp.anchorZFx,
        999 * FX_ONE,
        comp.team,
        gameState,
        lockedEnemyBldId
      );
      if (!bldRes.building) {
        comp.targetEnemyBuildingId = -1;
        comp.engagedTargetBuildingId = -1;
        if (!comp.commandQueue || comp.commandQueue.length === 0) {
          comp.stopInPlace(this.navGrid, entitiesMap);
          return false;
        }
      } else {
        const b = bldRes.building;
        const engageBldThresholdFx = hasRangedAmmo
          ? Math.max(12 * FX_ONE, (effectiveRangeFx - 8 * FX_ONE) | 0)
          : (effectiveRangeFx + 5 * FX_ONE) | 0;

        if (bldRes.perimeterDistFx > engageBldThresholdFx && !isIdleOrHold) {
          comp.engagedTargetBuildingId = -1;
          comp.engagedTargetEntityId = -1;
          return false; // Let _updateCompanies march toward the building
        }

        comp.engagedTargetBuildingId = b.id;
        comp.engagedTargetEntityId = -1;
        const dirToBld = fxAtan2((b.zFx - comp.anchorZFx) | 0, (b.xFx - comp.anchorXFx) | 0);
        const angleDiff = fxAbs(((dirToBld - (comp.facingDir & ANGLE_MASK) + 512) & ANGLE_MASK) - 512);
        if (angleDiff > 48) {
          comp.facingDir = dirToBld;
          comp.updateSlotTargets(this.navGrid, entitiesMap);
        }
        return true;
      }
    }

    // 2. Check Explicit Target Enemy Company Lock (`comp.targetEnemyCompanyId >= 0`)
    if (lockedEnemySquadId >= 0) {
      const targetComp = entitiesMap.companies?.get(lockedEnemySquadId);
      if (targetComp && targetComp.memberIds.length > 0) {
        let sumX = 0;
        let sumZ = 0;
        let count = 0;
        let closestTargetEnt = null;
        let closestDistFx = 0x7fffffff;

        for (let i = 0; i < targetComp.memberIds.length; i++) {
          const tEnt = entitiesMap.get(targetComp.memberIds[i]);
          if (tEnt && tEnt.hp > 0 && !tEnt.isGarrisoned) {
            sumX = (sumX + tEnt.x) | 0;
            sumZ = (sumZ + tEnt.z) | 0;
            count++;
            const d = fxHypot((tEnt.x - comp.anchorXFx) | 0, (tEnt.z - comp.anchorZFx) | 0);
            if (d < closestDistFx) {
              closestDistFx = d;
              closestTargetEnt = tEnt;
            }
          }
        }

        if (count > 0 && closestTargetEnt) {
          const avgXFx = (sumX / count) | 0;
          const avgZFx = (sumZ / count) | 0;
          comp.targetXFx = avgXFx;
          comp.targetZFx = avgZFx;

          const engageThresholdFx = hasRangedAmmo
            ? (effectiveRangeFx + 12 * FX_ONE) | 0
            : (18 * FX_ONE) | 0;

          if (closestDistFx > engageThresholdFx) {
            comp.engagedTargetEntityId = -1;
            comp.engagedTargetBuildingId = -1;
            return false;
          }
        }
      }
    }

    const scanRadiusFx = isRampaging
      ? 45 * FX_ONE
      : hasRangedAmmo
        ? (effectiveRangeFx + (comp.isHero ? 4 * FX_ONE : 12 * FX_ONE)) | 0
        : isAttackMove || lockedEnemySquadId >= 0
          ? 34 * FX_ONE
          : isPatrol
            ? 26 * FX_ONE
            : comp.isSpearWallLocked
              ? (effectiveRangeFx + 3 * FX_ONE) | 0
              : (comp.postManualMoveHoldTicks | 0) > 0
                ? Math.round(4.2 * FX_ONE)
                : 15 * FX_ONE;

    // Phase 6.8 Rear-Arc Blindspot: A company only sees enemies in its 270° front/side FOV
    // UNLESS it is actively being hit (`ticksSinceLastCombat <= 6`) or explicitly targeting that squad!
    const enforceRearBlindspot =
      !isRampaging &&
      lockedEnemySquadId < 0 &&
      (comp.ticksSinceLastCombat ?? 999) > 6;

    const { enemy, distFx } = this.findNearestEnemyEntity(
      comp.anchorXFx,
      comp.anchorZFx,
      scanRadiusFx,
      comp.team,
      entitiesMap,
      {
        canHitFlying: Boolean(hasRangedAmmo || prof.canHitFlying || prof.isFlying),
        attackAllTeams: isRampaging,
        onlySquadIndex: lockedEnemySquadId,
        fovFacingDir: enforceRearBlindspot ? comp.facingDir : null,
        fovOriginXFx: comp.anchorXFx,
        fovOriginZFx: comp.anchorZFx
      }
    );

    if (!enemy) {
      comp.engagedTargetEntityId = -1;

      // 3. If no enemy units are in range, check for nearby enemy buildings to siege/destroy!
      if (gameState && lockedEnemySquadId < 0) {
        const bldScanFx = hasRangedAmmo ? effectiveRangeFx : 24 * FX_ONE;
        const nearBldRes = this.findNearestEnemyBuilding(
          comp.anchorXFx,
          comp.anchorZFx,
          bldScanFx,
          comp.team,
          gameState,
          -1
        );
        if (nearBldRes.building) {
          const b = nearBldRes.building;
          comp.engagedTargetBuildingId = b.id;
          const dirToBld = fxAtan2((b.zFx - comp.anchorZFx) | 0, (b.xFx - comp.anchorXFx) | 0);

          const stopDistFx = hasRangedAmmo
            ? Math.max(12 * FX_ONE, (effectiveRangeFx - 8 * FX_ONE) | 0)
            : (effectiveRangeFx + 3 * FX_ONE) | 0;

          if (nearBldRes.perimeterDistFx <= stopDistFx || isIdleOrHold) {
            comp.facingDir = dirToBld;
            return true;
          }

          if (canAdvanceAnchorInCombat) {
            comp.facingDir = dirToBld;
            const cDist = Math.max(1, fxHypot((b.xFx - comp.anchorXFx) | 0, (b.zFx - comp.anchorZFx) | 0));
            const stepSpeed = mulDiv(comp.speedFx, comp.isRunning ? 1450 : 1000, PERMILLE_ONE);
            const stepX = mulDiv(stepSpeed, b.xFx - comp.anchorXFx, cDist);
            const stepZ = mulDiv(stepSpeed, b.zFx - comp.anchorZFx, cDist);
            if (this.navGrid.isWalkableWorldFx(comp.anchorXFx + stepX, comp.anchorZFx + stepZ)) {
              comp.anchorXFx = (comp.anchorXFx + stepX) | 0;
              comp.anchorZFx = (comp.anchorZFx + stepZ) | 0;
              comp.anchorMovedThisTick = true;
            }
            comp.updateSlotTargets(this.navGrid, entitiesMap);
            return true;
          }
        }
      }

      comp.engagedTargetBuildingId = -1;
      return false;
    }

    comp.engagedTargetEntityId = enemy.id;
    comp.engagedTargetBuildingId = -1;

    if (comp._mountedPassState === "PASS_THROUGH" || comp._mountedPassState === "TURN_AND_RECHARGE" || comp._mountedPassState === "CURVE_TURN_AROUND") {
      return false;
    }

    if (comp.isSpearWallLocked && !isRampaging) {
      return true;
    }

    const enemyComp = entitiesMap.companies?.get(enemy.squadIndex);
    let enemyCenterXFx = enemy.x;
    let enemyCenterZFx = enemy.z;
    if (enemyComp && enemyComp.memberIds.length > 0) {
      let sx = 0;
      let sz = 0;
      let cnt = 0;
      for (let i = 0; i < enemyComp.memberIds.length; i++) {
        const em = entitiesMap.get(enemyComp.memberIds[i]);
        if (em && em.hp > 0 && !em.isGarrisoned) {
          sx = (sx + em.x) | 0;
          sz = (sz + em.z) | 0;
          cnt++;
        }
      }
      if (cnt > 0) {
        enemyCenterXFx = (sx / cnt) | 0;
        enemyCenterZFx = (sz / cnt) | 0;
      }
    }

    const distToEnemyCenterFx = fxHypot(
      (enemyCenterXFx - comp.anchorXFx) | 0,
      (enemyCenterZFx - comp.anchorZFx) | 0
    );

    const desiredDirToEnemy = fxAtan2(
      (enemyCenterZFx - comp.anchorZFx) | 0,
      (enemyCenterXFx - comp.anchorXFx) | 0
    );
    const angleDiff = fxAbs(
      ((desiredDirToEnemy - (comp.facingDir & ANGLE_MASK) + 512) & ANGLE_MASK) - 512
    );

    if (hasRangedAmmo) {
      const fullSquadFireRangeFx = Math.max(12 * FX_ONE, (effectiveRangeFx - 10 * FX_ONE) | 0);
      if (distFx <= fullSquadFireRangeFx || isIdleOrHold) {
        if (angleDiff > 32) {
          comp.facingDir = desiredDirToEnemy;
          comp.updateSlotTargets(this.navGrid, entitiesMap);
        }
        return true;
      }

      if (canAdvanceAnchorInCombat) {
        comp.facingDir = desiredDirToEnemy;
        const stepSpeed = mulDiv(
          comp.speedFx,
          comp.isRunning || isRampaging ? 1450 : 1000,
          PERMILLE_ONE
        );
        const stepX = mulDiv(stepSpeed, enemyCenterXFx - comp.anchorXFx, Math.max(1, distToEnemyCenterFx));
        const stepZ = mulDiv(stepSpeed, enemyCenterZFx - comp.anchorZFx, Math.max(1, distToEnemyCenterFx));
        if (this.navGrid.isWalkableWorldFx(comp.anchorXFx + stepX, comp.anchorZFx + stepZ)) {
          comp.anchorXFx = (comp.anchorXFx + stepX) | 0;
          comp.anchorZFx = (comp.anchorZFx + stepZ) | 0;
          comp.anchorMovedThisTick = true;
        }
        comp.updateSlotTargets(this.navGrid, entitiesMap);
        return true;
      }
      return false;
    }

    let activelyFightingCount = 0;
    let chargingMembersCount = 0;
    let aliveCount = 0;
    for (let m = 0; m < comp.memberIds.length; m++) {
      const member = entitiesMap.get(comp.memberIds[m]);
      if (member && member.hp > 0) {
        aliveCount++;
        if ((member.chargeMomentumPermille | 0) >= 250) {
          chargingMembersCount++;
        }
        if (
          (member.windupTicks | 0) > 0 ||
          (member.actionCooldown | 0) > 0 ||
          fxHypot((enemy.x - member.x) | 0, (enemy.z - member.z) | 0) <=
            (effectiveRangeFx + 512)
        ) {
          activelyFightingCount++;
        }
      }
    }

    const enemyIsLightOrUnbraced = Boolean(
      enemyComp &&
        !enemyComp.isCavalry &&
        enemyComp.formation !== FormationTypes.SPEAR_WALL &&
        enemyComp.formation !== FormationTypes.PIKE_PHALANX &&
        enemyComp.formation !== FormationTypes.SHIELD_WALL &&
        (enemyComp.unitType === 'archer' || enemyComp.unitType === 'worker')
    );
    const isPlowingCharge = Boolean(
      prof.isCavalry &&
        comp.isRunning &&
        enemyIsLightOrUnbraced &&
        chargingMembersCount >= Math.max(1, aliveCount >> 2) &&
        distToEnemyCenterFx > 2 * FX_ONE
    );
    const minEngagedToStopAnchor = isPlowingCharge ? Math.max(4, (aliveCount * 3) >> 2) : 1;
    const anchorReachedBattleCenter =
      !isPlowingCharge &&
      (distToEnemyCenterFx <= (effectiveRangeFx + 5 * FX_ONE) ||
        distFx <= (effectiveRangeFx + 1 * FX_ONE) ||
        activelyFightingCount >= minEngagedToStopAnchor);

    if (anchorReachedBattleCenter || isIdleOrHold) {
      // Gradual turn rate toward attackers (never snap 180° in a single tick, and locked Spear Walls hold their direction!)
      if (angleDiff > 56 && !comp.isSpearWallLocked) {
        let signedDiff = ((desiredDirToEnemy - (comp.facingDir & ANGLE_MASK) + 512) & ANGLE_MASK) - 512;
        const maxTurnStep = 28;
        if (signedDiff > maxTurnStep) signedDiff = maxTurnStep;
        if (signedDiff < -maxTurnStep) signedDiff = -maxTurnStep;
        comp.facingDir = (comp.facingDir + signedDiff) & ANGLE_MASK;
        comp.updateSlotTargets(this.navGrid, entitiesMap);
      }
      return true;
    }

    if (canAdvanceAnchorInCombat) {
      comp.facingDir = desiredDirToEnemy;
      const stepSpeed = mulDiv(
        comp.speedFx,
        comp.isRunning || isRampaging ? 1450 : 1000,
        PERMILLE_ONE
      );
      const stepX = mulDiv(
        stepSpeed,
        enemyCenterXFx - comp.anchorXFx,
        Math.max(1, distToEnemyCenterFx)
      );
      const stepZ = mulDiv(
        stepSpeed,
        enemyCenterZFx - comp.anchorZFx,
        Math.max(1, distToEnemyCenterFx)
      );
      if (this.navGrid.isWalkableWorldFx(comp.anchorXFx + stepX, comp.anchorZFx + stepZ)) {
        comp.anchorXFx = (comp.anchorXFx + stepX) | 0;
        comp.anchorZFx = (comp.anchorZFx + stepZ) | 0;
        comp.anchorMovedThisTick = true;
      }
      comp.updateSlotTargets(this.navGrid, entitiesMap);
      return true;
    }

    return false;
  }

  /**
   * Ranged attack = AIM + RELEASE (shared by attacks on units and on buildings).
   * After a shot the unit recovers briefly (`recoveryTicks`, the follow-through), then draws and AIMS (the animation holds
   * at full draw) until the release tick. The reload roll is made on the shot and split into recovery + aim, so one full
   * cycle still lasts reloadMin..reloadMax ticks and the random part of the rhythm is spent aiming instead of idling.
   * The release tick is the animation's hit moment (render/unitRenderer.js lands the clip's release on it).
   */
}

import { unitCombatStepperMethods } from './unitCombatStepper.js';
Object.assign(UnitCombatSystem.prototype, unitCombatStepperMethods);
