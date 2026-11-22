/**
 * Kings Lands — Phase 7: Authoritative Morale, Stamina & Chain-Reaction Retreat System
 * (src/sim/systems/moraleStaminaSystem.js)
 *
 * Includes:
 * - Directional flank/rear morale shock, charge impact shock, fire arrow shock, and casualty shock.
 * - Phase 7 Regional Morale / Retreat Cascade:
 *   1. When a company breaks and begins to retreat, nearby allied companies within 42m suffer an immediate
 *      morale shockwave.
 *   2. If a regional threshold of allied squads/units within 38m are routing (>= 2 routing squads or >= 38%
 *      of nearby allied soldiers routing with at least 12 routing soldiers), a Chain-Reaction Retreat triggers,
 *      causing nearby allied units in that radius to panic and fall back!
 */

import { FX_ONE, TICKS_PER_SEC, mulDiv, fxClamp, fxAtan2, fxHypot } from '../../core/fx.js';
import { NavTileType } from '../nav/grid.js';
import { FormationTypes } from '../formations/formations.js';
import { CompanyOrderType } from '../formations/company.js';
import { DirectionalArc } from './combatSystem.js';

export const MORALE_BREAK_THRESHOLD_PERMILLE = 200; // 20%
export const MORALE_RALLY_THRESHOLD_PERMILLE = 500; // 50%
export const STAMINA_EXHAUSTION_THRESHOLD_PERMILLE = 300; // 30%
export const REGIONAL_CASCADE_RADIUS_FX = 40 * FX_ONE; // 40m regional panic radius

export class MoraleStaminaSystem {
  constructor() {}

  applyMoraleShock(comp, rawDropPermille, _reason = '') {
    if (!comp || comp.unitType === 'worker' || comp.isHero || comp.unitType === 'hero') return;
    const mult = (comp.moraleLossMultiplierPermille ?? 1000) | 0;
    const scaledDrop = mulDiv(rawDropPermille | 0, mult, 1000);
    comp.moralePermille = fxClamp((comp.moralePermille | 0) - scaledDrop, 0, 1000);
  }

  onUnitDamaged(
    comp,
    unitProf,
    attackArc = DirectionalArc.FRONT,
    isChargeImpact = false,
    isFireArrow = false
  ) {
    if (!comp || comp.unitType === 'worker' || comp.isHero || comp.unitType === 'hero') return;
    let drop = 0;

    if (attackArc === DirectionalArc.SIDE) {
      drop = (drop + 4) | 0;
    } else if (attackArc === DirectionalArc.BACK) {
      drop = (drop + 9) | 0;
    }

    if (isChargeImpact) {
      drop = (drop + 22) | 0;
    }

    if (isFireArrow) {
      const fireShock = unitProf?.isBeast || comp.breakBehavior === 'RAMPAGE' ? 65 : 14;
      drop = (drop + fireShock) | 0;
    }

    if (drop > 0) {
      this.applyMoraleShock(comp, drop, 'COMBAT_SHOCK');
    }
  }

  onMeleeSwing(_comp) {
    // Stamina in combat regenerates slowly (+1/tick in MovementSystem._stepCompanyStamina)
  }

  getExhaustionSpeedMultiplierPermille(comp) {
    if (!comp) return 1000;
    const stam = comp.staminaPermille ?? 1000;
    if (stam >= STAMINA_EXHAUSTION_THRESHOLD_PERMILLE) return 1000;
    return (700 + mulDiv(300, stam, STAMINA_EXHAUSTION_THRESHOLD_PERMILLE)) | 0;
  }

  _findTeamCitadelCoordsFx(gameState, team) {
    const bIds = gameState.constructionSystem?.sortedBuildingIds || [];
    const buildings = gameState.constructionSystem?.buildings;
    if (buildings) {
      for (let i = 0; i < bIds.length; i++) {
        const b = buildings.get(bIds[i]);
        if (b && !b.isDestroyed && b.hp > 0 && b.team === (team | 0) && b.type === 'citadel') {
          return { xFx: b.xFx, zFx: b.zFx };
        }
      }
    }
    return {
      xFx: 2048 * FX_ONE,
      zFx: (team === 1 ? 1660 : 2420) * FX_ONE
    };
  }

  triggerCompanyBreak(gameState, comp, isCascade = false) {
    if (!comp || comp.isBroken || comp.unitType === 'worker' || comp.isHero || comp.unitType === 'hero') return;
    comp.isBroken = true;
    comp.moralePermille = 50;
    comp.minRoutingTicks = 130; // Must flee for at least 6.5s (130 ticks) before rallying is possible
    comp.commandQueue.length = 0;
    comp.patrolWaypoints.length = 0;
    comp.isSpearWallLocked = false;
    comp.formation = FormationTypes.SQUARE;

    if (comp.breakBehavior === 'RAMPAGE') {
      comp.orderType = CompanyOrderType.RAMPAGE;
      comp.wantsToRun = true;
      comp.isRunning = true;
    } else {
      comp.orderType = CompanyOrderType.ROUTING;
      comp.wantsToRun = true;
      comp.isRunning = true;
      const home = this._findTeamCitadelCoordsFx(gameState, comp.team);
      const standOffXFx = (home.xFx + (comp.team === 1 ? -14 : 14) * FX_ONE) | 0;
      const standOffZFx = (home.zFx + (comp.team === 1 ? -14 : 14) * FX_ONE) | 0;
      comp.targetXFx = standOffXFx;
      comp.targetZFx = standOffZFx;
      comp.desiredFacingDir = fxAtan2(
        (standOffZFx - comp.anchorZFx) | 0,
        (standOffXFx - comp.anchorXFx) | 0
      );
      comp.pathWaypoints = gameState.astar.findPath(
        comp.anchorXFx,
        comp.anchorZFx,
        comp.targetXFx,
        comp.targetZFx,
        { isCavalry: comp.isCavalry }
      );
      comp.pathIndex = 0;
    }

    // No floating text popups on rout — white flag + flashing squad selection indicator are sufficient
  }

  update(gameState) {
    const companies = gameState.companies;
    const entitiesMap = gameState.entities;
    if (!companies) return;

    const companyIds = Array.from(companies.keys()).sort((a, b) => a - b);
    const activeCompanies = [];
    const newlyBrokenCompanies = [];

    for (let i = 0; i < companyIds.length; i++) {
      const comp = companies.get(companyIds[i]);
      if (!comp || comp.garrisonedBuildingId > 0) continue;

      let aliveCount = 0;
      for (let m = 0; m < comp.memberIds.length; m++) {
        const ent = entitiesMap.get(comp.memberIds[m]);
        if (ent && ent.hp > 0) aliveCount++;
      }
      comp._cachedAliveCount = aliveCount;
      if (aliveCount === 0) continue;
      activeCompanies.push(comp);

      comp.ticksSinceLastCombat = ((comp.ticksSinceLastCombat | 0) + 1) | 0;
      if ((comp.cascadeImmunityTicks | 0) > 0) {
        comp.cascadeImmunityTicks = (comp.cascadeImmunityTicks - 1) | 0;
      }

      if ((comp.stanceTransitionTicks | 0) > 0) {
        comp.stanceTransitionTicks = (comp.stanceTransitionTicks - 1) | 0;
      }

      const prevAlive = comp.lastKnownAliveCount ?? aliveCount;
      if (aliveCount < prevAlive) {
        const lostCount = (prevAlive - aliveCount) | 0;
        const maxCount = Math.max(1, comp.maxMemberCount | 0);
        const casualtyRatioPermille = mulDiv(lostCount, 1000, maxCount);
        this.applyMoraleShock(comp, mulDiv(casualtyRatioPermille, 260, 1000), 'CASUALTIES');
      }
      comp.lastKnownAliveCount = aliveCount;

      if (comp.isBroken) {
        // Enforce a mandatory minimum retreat duration (minRoutingTicks) before the squad can rally
        if ((comp.minRoutingTicks | 0) > 0) {
          comp.minRoutingTicks = (comp.minRoutingTicks - 1) | 0;
          comp.moralePermille = Math.min(380, ((comp.moralePermille ?? 50) + 2) | 0);
        } else {
          const home = this._findTeamCitadelCoordsFx(gameState, comp.team);
          const distHome = fxHypot(
            (home.xFx - comp.anchorXFx) | 0,
            (home.zFx - comp.anchorZFx) | 0
          );
          const distGoal = fxHypot(
            (comp.targetXFx - comp.anchorXFx) | 0,
            (comp.targetZFx - comp.anchorZFx) | 0
          );
          let rallyRegen = 4;
          if ((comp.ticksSinceLastCombat | 0) >= 40) rallyRegen += 5;
          if (distHome <= 55 * FX_ONE || distGoal <= 20 * FX_ONE) rallyRegen += 9;
          if (comp.hasBannerBuff) rallyRegen += 5;
          comp.moralePermille = Math.min(1000, ((comp.moralePermille ?? 380) + rallyRegen) | 0);

          if ((comp.moralePermille | 0) >= MORALE_RALLY_THRESHOLD_PERMILLE) {
            comp.isBroken = false;
            comp.moralePermille = Math.max(comp.moralePermille | 0, 620);
            comp.cascadeImmunityTicks = 300; // 15s immunity after rallying so they never get stuck in panic
            comp.wantsToRun = false;
            comp.isRunning = false;
            comp.stopInPlace(gameState.navGrid, entitiesMap);
          }
        }
      } else {
        const outOfCombat = (comp.ticksSinceLastCombat | 0) >= 35;
        if (outOfCombat || comp.hasBannerBuff) {
          let regenStep = outOfCombat ? 8 : 3;
          if (comp.hasBannerBuff) {
            regenStep = (regenStep + 6) | 0;
          }
          comp.moralePermille = Math.min(1000, ((comp.moralePermille ?? 1000) + regenStep) | 0);
        }

        if (
          comp.unitType !== 'worker' &&
          (comp.moralePermille | 0) < MORALE_BREAK_THRESHOLD_PERMILLE
        ) {
          this.triggerCompanyBreak(gameState, comp, false);
          newlyBrokenCompanies.push(comp);
        }
      }
    }

    // Phase 7 — Balanced Regional Chain-Reaction Retreat:
    // Only triggers in active combat zones when EITHER:
    // (A) Mass Rout: >= 3 allied squads within 34m are routing AND >= 62% of allied soldiers in that radius are routing, OR
    // (B) Overwhelmed Lone Squad: 1+ allied squad routing within 32m, no other non-broken allied squads nearby,
    //     enemy soldiers in radius >= 20 AND outnumber allies by >= 2x, and this squad is already shaken (morale <= 360).
    for (let i = 0; i < activeCompanies.length; i++) {
      const comp = activeCompanies[i];
      if (
        comp.isBroken ||
        comp.unitType === 'worker' ||
        (comp.cascadeImmunityTicks | 0) > 0
      ) {
        continue;
      }

      const home = this._findTeamCitadelCoordsFx(gameState, comp.team);
      const distHome = fxHypot(
        (home.xFx - comp.anchorXFx) | 0,
        (home.zFx - comp.anchorZFx) | 0
      );
      // Units standing near their own starting Citadel are bolstered and immune to chain panic
      if (distHome <= 55 * FX_ONE) continue;

      let nearbyRoutingSquads = 0;
      let nearbyNonBrokenAlliedSquads = 0;
      let nearbyRoutingSoldiers = 0;
      let nearbyAlliedSoldiers = comp._cachedAliveCount || 0;
      let nearbyEnemySoldiers = 0;

      for (let j = 0; j < activeCompanies.length; j++) {
        const other = activeCompanies[j];
        if (other.id === comp.id || other.unitType === 'worker') continue;
        const dist = fxHypot(
          (other.anchorXFx - comp.anchorXFx) | 0,
          (other.anchorZFx - comp.anchorZFx) | 0
        );
        if (dist <= 34 * FX_ONE) {
          const alive = other._cachedAliveCount || 0;
          if (other.team === comp.team) {
            nearbyAlliedSoldiers += alive;
            if (other.isBroken) {
              nearbyRoutingSquads++;
              nearbyRoutingSoldiers += alive;
            } else {
              nearbyNonBrokenAlliedSquads++;
            }
          } else if (!other.isBroken) {
            nearbyEnemySoldiers += alive;
          }
        }
      }

      if (nearbyRoutingSquads === 0 || nearbyEnemySoldiers === 0) continue;

      const routRatioPermille =
        nearbyAlliedSoldiers > 0 ? mulDiv(nearbyRoutingSoldiers, 1000, nearbyAlliedSoldiers) : 0;

      const isMassRout =
        nearbyRoutingSquads >= 3 && routRatioPermille >= 620 && nearbyEnemySoldiers >= 10;
      const isOverwhelmedLoneSquad =
        nearbyRoutingSquads >= 1 &&
        nearbyNonBrokenAlliedSquads === 0 &&
        nearbyEnemySoldiers >= 20 &&
        nearbyEnemySoldiers >= nearbyAlliedSoldiers * 2 &&
        (comp.moralePermille | 0) <= 360;

      if (isMassRout || isOverwhelmedLoneSquad) {
        this.applyMoraleShock(comp, isMassRout ? 16 : 12, 'REGIONAL_CASCADE');
        if ((comp.moralePermille | 0) < MORALE_BREAK_THRESHOLD_PERMILLE && !comp.isBroken) {
          this.triggerCompanyBreak(gameState, comp, true);
        }
      }
    }

    // Sync entity routing flags
    for (let i = 0; i < activeCompanies.length; i++) {
      const comp = activeCompanies[i];
      const unitRoutingFlag = Boolean(comp.isBroken);
      for (let m = 0; m < comp.memberIds.length; m++) {
        const ent = entitiesMap.get(comp.memberIds[m]);
        if (ent && ent.hp > 0) {
          ent.isRouting = unitRoutingFlag;
        }
      }
    }
  }
}

export {
  FowState,
  FOW_GRID_SIZE,
  FOW_UPDATE_INTERVAL_TICKS,
  VisionSystem
} from './visionSystem.js';

export {
  PRODUCTION_BUILDING_TYPES,
  COLLAPSE_DURATION_TICKS,
  NO_BUILDING_TIMEOUT_TICKS,
  VictorySystem
} from './victorySystem.js';
