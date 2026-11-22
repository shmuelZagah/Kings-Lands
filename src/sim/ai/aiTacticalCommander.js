/**
 * Kings Lands — Tactical Army Commander, Scouting, Terrain-Aware Staging & Hero Micro for Enemy AI
 * (src/sim/ai/aiTacticalCommander.js)
 *
 * STRICT FAIR-PLAY RULE:
 * - Never modifies simulation state or unit stats directly.
 * - Emits only standard `CommandTypes` (`MOVE_COMPANIES`, `ATTACK_MOVE_COMPANIES`, `PATROL_COMPANIES`,
 *   `SET_FORMATION`, `SET_COMPANY_GAIT`, `CAST_HERO_SPELL`, `SWITCH_HERO_WEAPON`).
 * - Reacts strictly to enemies that are currently visible in Team 2's Fog of War (`perception.updatePerception`)
 *   or enemy buildings previously discovered in explored cells.
 */

import { FX_ONE, fxClamp, fxHypot, fxRandomRange } from '../../core/fx.js';
import { CommandTypes } from '../../core/commandBus.js';
import { FormationTypes } from '../formations/formations.js';
import { CompanyOrderType } from '../formations/company.js';

export class AiTacticalCommander {
  constructor(team = 2, perception = null) {
    this.team = team | 0;
    this.perception = perception;

    // Order deduplication cache so the AI never spams identical move orders every tick
    this._lastIssuedOrderByCompany = new Map(); // companyId -> { xFx, zFx, orderType, tick }
    this._chosenCrossingIdx = 0; // Default central bridge (2048m), randomized periodically
    this._lastCrossingSwitchTick = 0;
    this._currentAttackObjective = null; // { xFx, zFx, expiresTick }
    this.model = null;
  }

  setModel(model) {
    this.model = model || null;
  }

  _canIssueMoveOrderToCompany(comp, targetXFx, targetZFx, orderType, currentTick, minIntervalTicks = 90) {
    const prev = this._lastIssuedOrderByCompany.get(comp.id);
    if (prev) {
      if (currentTick - prev.tick < minIntervalTicks) return false;
      const distFromPrevOrder = fxHypot((targetXFx - prev.xFx) | 0, (targetZFx - prev.zFx) | 0);
      if (
        distFromPrevOrder <= 16 * FX_ONE &&
        prev.orderType === orderType &&
        comp.isActivelyMoving() &&
        comp.orderType !== CompanyOrderType.PATROL
      ) {
        return false;
      }
    }
    this._lastIssuedOrderByCompany.set(comp.id, {
      xFx: targetXFx | 0,
      zFx: targetZFx | 0,
      orderType,
      tick: currentTick | 0
    });
    return true;
  }

  /**
   * Collects all living Team 2 combat companies (excluding workers and garrisoned squads).
   */
  getCombatCompanies(gameState) {
    const list = [];
    for (const comp of gameState.companies.values()) {
      if (
        !comp ||
        comp.team !== this.team ||
        comp.unitType === 'worker' ||
        comp.garrisonedBuildingId > 0 ||
        comp.isBroken ||
        comp.memberIds.length === 0
      ) {
        continue;
      }
      list.push(comp);
    }
    return list;
  }

  /**
   * Sends 1 fast reconnaissance squad to scout bridges, shallow fords, hills, and unexplored sectors
   * so Team 2 legitimately uncovers the map through its own Fog of War.
   */
  stepScouting(gameState, combatCompanies, visibleEnemies, outCommands) {
    if (!this.perception || combatCompanies.length === 0) return null;

    // Pick a dedicated scout company (prefer Cavalry, otherwise a fast Swordsman/Archer squad not in combat)
    let scout = combatCompanies.find(
      (c) => c.isCavalry && !c.isHero && c.engagedTargetEntityId <= 0 && c.engagedTargetBuildingId <= 0
    );
    if (!scout && combatCompanies.length >= 2) {
      scout = combatCompanies.find(
        (c) => !c.isHero && c.unitType !== 'ballista' && c.engagedTargetEntityId <= 0 && c.engagedTargetBuildingId <= 0
      );
    }
    if (!scout) return null;

    // If the scout spots a stronger enemy force nearby while alone, fall back toward friendly crossing!
    if (visibleEnemies.length >= 2) {
      const nearThreat = visibleEnemies.find(
        (ve) => fxHypot((ve.anchorXFx - scout.anchorXFx) | 0, (ve.anchorZFx - scout.anchorZFx) | 0) <= 44 * FX_ONE
      );
      if (nearThreat && combatCompanies.length <= 2) {
        const safeZFx = Math.min(gameState.worldSizeFx - 64 * FX_ONE, (scout.anchorZFx + 55 * FX_ONE) | 0);
        if (this._canIssueMoveOrderToCompany(scout, scout.anchorXFx, safeZFx, 'MOVE', gameState.tick, 60)) {
          outCommands.push({
            type: CommandTypes.MOVE_COMPANIES,
            payload: {
              team: this.team,
              companyIds: [scout.id],
              dragStartXFx: scout.anchorXFx,
              dragStartZFx: safeZFx,
              dragEndXFx: scout.anchorXFx,
              dragEndZFx: safeZFx,
              queue: false,
              isRunning: (scout.staminaPermille | 0) >= 500
            }
          });
        }
        return scout.id;
      }
    }

    // If scout is idle, on initial default patrol, or finished its previous leg, pick the next unexplored strategic waypoint
    if (
      !scout.isActivelyMoving() ||
      scout.orderType === CompanyOrderType.PATROL ||
      gameState.tick % 240 === 0
    ) {
      const nextPt = this.perception.pickNextScoutingTargetFx(
        gameState,
        scout.anchorXFx,
        scout.anchorZFx
      );
      if (
        nextPt &&
        this._canIssueMoveOrderToCompany(scout, nextPt.xFx, nextPt.zFx, 'ATTACK_MOVE', gameState.tick, 110)
      ) {
        outCommands.push({
          type: CommandTypes.ATTACK_MOVE_COMPANIES,
          payload: {
            team: this.team,
            companyIds: [scout.id],
            dragStartXFx: nextPt.xFx,
            dragStartZFx: nextPt.zFx,
            dragEndXFx: nextPt.xFx,
            dragEndZFx: nextPt.zFx,
            queue: false,
            isRunning: false
          }
        });
      }
    }

    return scout.id;
  }

  /**
   * Tactical Stance & Gait Management:
   * - Spearmen brace in `SPEAR_WALL` when enemy cavalry are spotted nearby, and switch back to `SQUARE` to march!
   * - Cavalry use `WEDGE` when charging into visible enemy archers/infantry.
   * - Units only toggle Run when stamina >= 700 permille and closing in on an active target, conserving stamina on long marches.
   */
  stepFormationAndGaitMicro(gameState, combatCompanies, visibleEnemies, outCommands) {
    for (let i = 0; i < combatCompanies.length; i++) {
      const comp = combatCompanies[i];
      if (comp.isHero) continue;

      let nearestEnemy = null;
      let nearestDistFx = 0x7fffffff;
      let enemyCavalryClose = false;

      for (let e = 0; e < visibleEnemies.length; e++) {
        const ve = visibleEnemies[e];
        const d = fxHypot((ve.anchorXFx - comp.anchorXFx) | 0, (ve.anchorZFx - comp.anchorZFx) | 0);
        if (d < nearestDistFx) {
          nearestDistFx = d;
          nearestEnemy = ve;
        }
        if (ve.isCavalry && d <= 26 * FX_ONE) {
          enemyCavalryClose = true;
        }
      }

      if (comp.unitType === 'spearman') {
        if (enemyCavalryClose && comp.formation !== FormationTypes.SPEAR_WALL && !comp.isActivelyMoving()) {
          outCommands.push({
            type: CommandTypes.SET_FORMATION,
            payload: {
              team: this.team,
              companyIds: [comp.id],
              formation: FormationTypes.SPEAR_WALL
            }
          });
        } else if (!enemyCavalryClose && comp.formation === FormationTypes.SPEAR_WALL && nearestDistFx > 32 * FX_ONE) {
          outCommands.push({
            type: CommandTypes.SET_FORMATION,
            payload: {
              team: this.team,
              companyIds: [comp.id],
              formation: FormationTypes.SQUARE
            }
          });
        }
      } else if (comp.unitType === 'cavalry') {
        const shouldWedge = Boolean(nearestEnemy && nearestDistFx <= 42 * FX_ONE);
        const targetForm = shouldWedge ? FormationTypes.WEDGE : FormationTypes.SQUARE;
        if (comp.formation !== targetForm) {
          outCommands.push({
            type: CommandTypes.SET_FORMATION,
            payload: {
              team: this.team,
              companyIds: [comp.id],
              formation: targetForm
            }
          });
        }
      }

      // Smart Stamina / Gait discipline
      const stam = comp.staminaPermille ?? 1000;
      const inChargeWindow = Boolean(
        nearestEnemy && nearestDistFx >= 10 * FX_ONE && nearestDistFx <= 38 * FX_ONE && stam >= 700
      );
      if (inChargeWindow && !comp.wantsToRun && comp.canStartRunning()) {
        outCommands.push({
          type: CommandTypes.SET_COMPANY_GAIT,
          payload: {
            team: this.team,
            companyIds: [comp.id],
            isRunning: true
          }
        });
      } else if (!inChargeWindow && comp.wantsToRun && (stam < 420 || nearestDistFx > 55 * FX_ONE)) {
        outCommands.push({
          type: CommandTypes.SET_COMPANY_GAIT,
          payload: {
            team: this.team,
            companyIds: [comp.id],
            isRunning: false
          }
        });
      }
    }
  }

  /**
   * Intelligent Hero Spellcasting & Weapon Stance Switching for Team 2 Heroes.
   * Only targets enemy units or buildings that are legitimately visible in Team 2's Fog of War!
   */
  stepHeroMicro(gameState, combatCompanies, visibleEnemies, outCommands) {
    for (let i = 0; i < combatCompanies.length; i++) {
      const comp = combatCompanies[i];
      if (!comp.isHero || !Array.isArray(comp.heroSpells)) continue;
      const heroEnt = gameState.entities.get(comp.memberIds[0]);
      if (!heroEnt || heroEnt.hp <= 0) continue;

      let nearestEnemyComp = null;
      let nearestDistFx = 0x7fffffff;
      for (let e = 0; e < visibleEnemies.length; e++) {
        const ve = visibleEnemies[e];
        const d = fxHypot((ve.anchorXFx - heroEnt.x) | 0, (ve.anchorZFx - heroEnt.z) | 0);
        if (d < nearestDistFx) {
          nearestDistFx = d;
          nearestEnemyComp = ve;
        }
      }

      // Weapon stance switching if Hero has a secondary weapon set (e.g. Bow at range, Sword in melee)
      if (comp.hasSecondaryLoadout && nearestEnemyComp) {
        const wantRanged = nearestDistFx > 9 * FX_ONE && nearestDistFx <= 32 * FX_ONE;
        const isRangedNow = comp.activeWeaponMode === 'ranged';
        if (wantRanged !== isRangedNow && gameState.tick % 60 === 0) {
          outCommands.push({
            type: CommandTypes.SWITCH_HERO_WEAPON,
            payload: { team: this.team, companyId: comp.id }
          });
          continue;
        }
      }

      const hpRatioPermille = Math.round((heroEnt.hp * 1000) / Math.max(1, heroEnt.maxHp));

      for (let s = 0; s < comp.heroSpells.length; s++) {
        const sp = comp.heroSpells[s];
        if (
          !sp ||
          !sp.unlocked ||
          sp.type !== 'active' ||
          sp.disabledByWeapon ||
          (sp.cooldownTicks | 0) > 0
        ) {
          continue;
        }

        // Self-heal when HP drops below 65%
        if ((sp.spellId === 'self_heal' || sp.spellId === 'heal') && hpRatioPermille <= 650) {
          outCommands.push({
            type: CommandTypes.CAST_HERO_SPELL,
            payload: {
              team: this.team,
              companyId: comp.id,
              spellId: sp.spellId,
              slotIndex: sp.slotIndex
            }
          });
          break;
        }

        if (!nearestEnemyComp || nearestDistFx > 34 * FX_ONE) continue;

        const tMode = sp.targetMode || 'self';
        if (tMode === 'self' || tMode === 'self_aoe' || tMode === 'aura') {
          if (nearestDistFx <= 20 * FX_ONE) {
            outCommands.push({
              type: CommandTypes.CAST_HERO_SPELL,
              payload: {
                team: this.team,
                companyId: comp.id,
                spellId: sp.spellId,
                slotIndex: sp.slotIndex
              }
            });
            break;
          }
        } else if (tMode === 'ground') {
          outCommands.push({
            type: CommandTypes.CAST_HERO_SPELL,
            payload: {
              team: this.team,
              companyId: comp.id,
              spellId: sp.spellId,
              slotIndex: sp.slotIndex,
              targetXFx: nearestEnemyComp.anchorXFx,
              targetZFx: nearestEnemyComp.anchorZFx
            }
          });
          break;
        } else if (tMode === 'unit' || tMode === 'unit_or_building') {
          const targetCompObj = gameState.companies.get(nearestEnemyComp.companyId);
          const firstEntId = targetCompObj?.memberIds?.[0] || -1;
          if (firstEntId > 0) {
            outCommands.push({
              type: CommandTypes.CAST_HERO_SPELL,
              payload: {
                team: this.team,
                companyId: comp.id,
                spellId: sp.spellId,
                slotIndex: sp.slotIndex,
                targetXFx: nearestEnemyComp.anchorXFx,
                targetZFx: nearestEnemyComp.anchorZFx,
                targetEntityId: firstEntId
              }
            });
            break;
          }
        }
      }
    }
  }

  /**
   * Coordinates Base Defense, Bridge/Ford Staging, Tactical Hill Occupation, and Multi-Pronged Attacks!
   */
  stepTacticalOperations(
    gameState,
    combatCompanies,
    scoutCompanyId,
    visibleEnemies,
    knownEnemyBuildings,
    homeBld,
    outCommands
  ) {
    const mainArmy = combatCompanies.filter((c) => c.id !== scoutCompanyId);
    if (mainArmy.length === 0) return;

    const centerWorldFx = ((gameState.centerMeters || 2048) * FX_ONE) | 0;
    const baseCenterXFx = homeBld ? homeBld.xFx : centerWorldFx;
    const baseCenterZFx = homeBld ? homeBld.zFx : 2420 * FX_ONE;
    const isSouthHome = baseCenterZFx >= centerWorldFx;

    // 1. Urgent Base / Territory Defense: Is any visible enemy force on our side of the river or near home base?
    let invaderTarget = null;
    let bestInvaderDist = 0x7fffffff;
    for (let i = 0; i < visibleEnemies.length; i++) {
      const ve = visibleEnemies[i];
      const distToHome = fxHypot((ve.anchorXFx - baseCenterXFx) | 0, (ve.anchorZFx - baseCenterZFx) | 0);
      const onOurRiverSide = isSouthHome ? ve.anchorZFx >= centerWorldFx + 32 * FX_ONE : ve.anchorZFx <= centerWorldFx - 32 * FX_ONE;
      if (onOurRiverSide || distToHome <= 165 * FX_ONE) {
        if (distToHome < bestInvaderDist) {
          bestInvaderDist = distToHome;
          invaderTarget = ve;
        }
      }
    }

    if (invaderTarget) {
      const idleOrFreeDefenders = mainArmy.filter(
        (c) =>
          c.engagedTargetEntityId <= 0 &&
          this._canIssueMoveOrderToCompany(
            c,
            invaderTarget.anchorXFx,
            invaderTarget.anchorZFx,
            'ATTACK_MOVE',
            gameState.tick,
            60
          )
      );
      if (idleOrFreeDefenders.length > 0) {
        outCommands.push({
          type: CommandTypes.ATTACK_MOVE_COMPANIES,
          payload: {
            team: this.team,
            companyIds: idleOrFreeDefenders.map((c) => c.id),
            dragStartXFx: invaderTarget.anchorXFx,
            dragStartZFx: invaderTarget.anchorZFx,
            dragEndXFx: invaderTarget.anchorXFx,
            dragEndZFx: invaderTarget.anchorZFx,
            targetEnemyCompanyId: invaderTarget.companyId,
            queue: false,
            isRunning: true
          }
        });
      }
      return;
    }

    // 2. Periodically rotate or randomize preferred river crossing (West Bridge, Central Bridge, East Bridge, or Fords)
    const crossings = this.perception?.crossings || [];
    if (crossings.length > 0 && gameState.tick - this._lastCrossingSwitchTick >= 700) {
      this._lastCrossingSwitchTick = gameState.tick;
      const flankChance = Math.min(85, Math.round(35 * (this.model?.flankAndScoutBias ?? 1)));
      this._chosenCrossingIdx = fxRandomRange(gameState, 0, 99) < (100 - flankChance) ? 0 : fxRandomRange(gameState, 0, crossings.length - 1);
    }
    const activeCrossing =
      crossings[this._chosenCrossingIdx] || {
        xFx: 2048 * FX_ONE,
        zFx: 2048 * FX_ONE,
        northStageZFx: 2110 * FX_ONE,
        southStageZFx: 1985 * FX_ONE
      };

    // 3. Determine if we should launch a coordinated offensive push across the river:
    //    - During the opening base-buildup phase (tick < 1100, first ~55s), hold bridge defense unless an enemy contests the bridge!
    //    - Once tick >= 1100 (or if an enemy is visibly contesting the crossing), push across in coordinated waves!
    const visibleNearRiver = visibleEnemies.find(
      (ve) => fxHypot((ve.anchorXFx - activeCrossing.xFx) | 0, (ve.anchorZFx - activeCrossing.zFx) | 0) <= 135 * FX_ONE
    );

    const mistakeProb = this.model?.mistakeProbPermille | 0;
    const hesitated = mistakeProb > 0 && (((Math.imul((gameState.tick | 0) + 17, 2654435761) ^ Math.imul((this.team | 0) + 3, 1013904223)) >>> 0) % 1000) < mistakeProb;
    const attackThreshold = Math.max(2, ((this.model?.attackThresholdSquads | 0) || 4) + (hesitated ? 2 : 0));
    const readyToPush =
      Boolean(visibleNearRiver) ||
      (gameState.tick >= 1000 && mainArmy.length >= attackThreshold);

    if (readyToPush) {
      let attackXFx = activeCrossing.xFx;
      let attackZFx = activeCrossing.southStageZFx;
      let targetEnemyCompanyId = -1;
      let targetEnemyBuildingId = -1;

      if (visibleNearRiver) {
        attackXFx = visibleNearRiver.anchorXFx;
        attackZFx = visibleNearRiver.anchorZFx;
        targetEnemyCompanyId = visibleNearRiver.companyId;
      } else if (visibleEnemies.length > 0) {
        // Attack the closest visible enemy squad
        let closestVe = visibleEnemies[0];
        let minDist = 0x7fffffff;
        for (let i = 0; i < visibleEnemies.length; i++) {
          const d = fxHypot(
            (visibleEnemies[i].anchorXFx - activeCrossing.xFx) | 0,
            (visibleEnemies[i].anchorZFx - activeCrossing.zFx) | 0
          );
          if (d < minDist) {
            minDist = d;
            closestVe = visibleEnemies[i];
          }
        }
        attackXFx = closestVe.anchorXFx;
        attackZFx = closestVe.anchorZFx;
        targetEnemyCompanyId = closestVe.companyId;
      } else if (knownEnemyBuildings.length > 0) {
        // Attack a known enemy building that was legitimately discovered in FoW!
        let targetBld = knownEnemyBuildings[0];
        let minDist = 0x7fffffff;
        for (let i = 0; i < knownEnemyBuildings.length; i++) {
          const kb = knownEnemyBuildings[i];
          const d = fxHypot((kb.xFx - activeCrossing.xFx) | 0, (kb.zFx - activeCrossing.zFx) | 0);
          if (d < minDist) {
            minDist = d;
            targetBld = kb;
          }
        }
        attackXFx = targetBld.xFx;
        attackZFx = targetBld.zFx;
        targetEnemyBuildingId = targetBld.id;
      } else {
        // Persist a stable reconnaissance-in-force objective for 360 ticks (18s) so squads march smoothly without resetting paths!
        if (!this._currentAttackObjective || gameState.tick >= this._currentAttackObjective.expiresTick) {
          const centerBaseXFx = centerWorldFx;
          const jitterX = fxRandomRange(gameState, -90, 90) * FX_ONE;
          const targetOppositeZ = isSouthHome
            ? ((gameState.centerMeters || 2048) - 340 + fxRandomRange(gameState, -60, 60))
            : ((gameState.centerMeters || 2048) + 340 + fxRandomRange(gameState, -60, 60));
          this._currentAttackObjective = {
            xFx: fxClamp((centerBaseXFx + jitterX) | 0, 240 * FX_ONE, (gameState.worldSizeFx - 240 * FX_ONE) | 0),
            zFx: fxClamp((targetOppositeZ * FX_ONE) | 0, 240 * FX_ONE, (gameState.worldSizeFx - 240 * FX_ONE) | 0),
            expiresTick: (gameState.tick + 360) | 0
          };
        }
        attackXFx = this._currentAttackObjective.xFx;
        attackZFx = this._currentAttackObjective.zFx;
      }

      const cavSquads = mainArmy.filter(
        (c) => c.isCavalry && !c.isHero && c.engagedTargetEntityId <= 0 && c.engagedTargetBuildingId <= 0
      );
      const coreSquads = mainArmy.filter(
        (c) => (!c.isCavalry || c.isHero) && c.engagedTargetEntityId <= 0 && c.engagedTargetBuildingId <= 0
      );

      const coreReady = coreSquads.filter((c) =>
        this._canIssueMoveOrderToCompany(c, attackXFx, attackZFx, 'ATTACK_MOVE', gameState.tick, 140)
      );
      if (coreReady.length > 0) {
        outCommands.push({
          type: CommandTypes.ATTACK_MOVE_COMPANIES,
          payload: {
            team: this.team,
            companyIds: coreReady.map((c) => c.id),
            dragStartXFx: attackXFx,
            dragStartZFx: attackZFx,
            dragEndXFx: attackXFx,
            dragEndZFx: attackZFx,
            targetEnemyCompanyId,
            targetEnemyBuildingId,
            queue: false,
            isRunning: false
          }
        });
      }

      if (cavSquads.length > 0) {
        const flankOffsetMeters = (this._chosenCrossingIdx & 1) === 0 ? -28 : 28;
        const flankXFx = fxClamp(
          (attackXFx + flankOffsetMeters * FX_ONE) | 0,
          120 * FX_ONE,
          (gameState.worldSizeFx - 120 * FX_ONE) | 0
        );
        const cavReady = cavSquads.filter((c) =>
          this._canIssueMoveOrderToCompany(c, flankXFx, attackZFx, 'ATTACK_MOVE', gameState.tick, 140)
        );
        if (cavReady.length > 0) {
          outCommands.push({
            type: CommandTypes.ATTACK_MOVE_COMPANIES,
            payload: {
              team: this.team,
              companyIds: cavReady.map((c) => c.id),
              dragStartXFx: flankXFx,
              dragStartZFx: attackZFx,
              dragEndXFx: flankXFx,
              dragEndZFx: attackZFx,
              targetEnemyCompanyId,
              targetEnemyBuildingId,
              queue: false,
              isRunning: true
            }
          });
        }
      }
      return;
    }

    // 4. Muster / Staging Phase: Stage idle combat squads on the northern high ground / bridge approach
    for (let i = 0; i < mainArmy.length; i++) {
      const comp = mainArmy[i];
      if (
        (comp.isActivelyMoving() && comp.orderType !== CompanyOrderType.PATROL) ||
        comp.engagedTargetEntityId > 0 ||
        comp.engagedTargetBuildingId > 0
      ) {
        continue;
      }
      const spreadX = (((i % 3) - 1) * 18) * FX_ONE;
      const spreadZ = (((i / 3) | 0) * 14) * FX_ONE;
      const stageXFx = (activeCrossing.xFx + spreadX) | 0;
      const ourStageZFx = isSouthHome ? activeCrossing.northStageZFx : activeCrossing.southStageZFx;
      const stageZFx = (ourStageZFx + (isSouthHome ? spreadZ : -spreadZ)) | 0;
      const distToStage = fxHypot((comp.anchorXFx - stageXFx) | 0, (comp.anchorZFx - stageZFx) | 0);
      if (
        distToStage > 22 * FX_ONE &&
        this._canIssueMoveOrderToCompany(comp, stageXFx, stageZFx, 'ATTACK_MOVE', gameState.tick, 160)
      ) {
        outCommands.push({
          type: CommandTypes.ATTACK_MOVE_COMPANIES,
          payload: {
            team: this.team,
            companyIds: [comp.id],
            dragStartXFx: stageXFx,
            dragStartZFx: stageZFx,
            dragEndXFx: stageXFx,
            dragEndZFx: stageZFx,
            queue: false,
            isRunning: false
          }
        });
      }
    }
  }
}
