/**
 * Kings Lands — Fair-Play Economy, Base Construction & Counter-Recruitment Planner for Enemy AI
 * (src/sim/ai/aiEconomyPlanner.js)
 *
 * Strictly issues standard simulation commands (`GATHER_RESOURCE`, `PLACE_BUILDING`, `ASSIGN_BUILDERS`,
 * `QUEUE_PRODUCTION`) using only resources and terrain visible/explored in Team 2's Fog of War.
 * Balanced so the AI mines iron proactively and recruits a combined-arms army (Swordsmen, Spearmen,
 * Cavalry, Ballistas, and Archers) instead of spamming Archers when iron is low.
 */

import { FX_ONE, fxHypot, fxRandomRange } from '../../core/fx.js';
import { CommandTypes } from '../../core/commandBus.js';
import { GathererState } from '../systems/economySystem.js';

export const AiDoctrines = Object.freeze({
  BALANCED_COMMANDER: 'BALANCED_COMMANDER',
  RAIDER_CAVALRY: 'RAIDER_CAVALRY',
  RANGER_SIEGE: 'RANGER_SIEGE',
  IRON_VANGUARD: 'IRON_VANGUARD'
});

export class AiEconomyPlanner {
  constructor(team = 2, perception = null, slotSpec = null) {
    this.team = team | 0;
    this.perception = perception;
    this.slotIndex = slotSpec && slotSpec.slotIndex !== undefined ? slotSpec.slotIndex : null;
    this.homeXFx = slotSpec && typeof slotSpec.x === 'number' ? Math.round(slotSpec.x * FX_ONE) : null;
    this.homeZFx = slotSpec && typeof slotSpec.z === 'number' ? Math.round(slotSpec.z * FX_ONE) : null;
    this._lastPlacementAttemptTick = -999;
    this.model = null;
  }

  setModel(model) {
    this.model = model || null;
  }

  findHomeBaseBuilding(gameState) {
    const cs = gameState.constructionSystem;
    if (!cs) return null;
    let best = null;
    let bestDist = 0x7fffffff;
    for (let i = 0; i < cs.sortedBuildingIds.length; i++) {
      const b = cs.buildings.get(cs.sortedBuildingIds[i]);
      if (!b || b.isDestroyed || b.hp <= 0 || b.team !== this.team || b.type !== 'citadel') continue;
      if (this.slotIndex !== null && b.aiSlotIndex !== undefined && b.aiSlotIndex !== null) {
        if (b.aiSlotIndex === this.slotIndex) return b;
        continue;
      }
      if (this.homeXFx !== null && this.homeZFx !== null) {
        const d = fxHypot((b.xFx - this.homeXFx) | 0, (b.zFx - this.homeZFx) | 0);
        if (d < bestDist) {
          bestDist = d;
          best = b;
        }
      } else {
        return b;
      }
    }
    return best;
  }

  _isWorkerBusyBuilding(cs, wComp) {
    if (!wComp || !cs) return false;
    const buildQ = cs.workerBuildQueues.get(wComp.id);
    if (buildQ && buildQ.length > 0) {
      for (let i = 0; i < buildQ.length; i++) {
        const b = cs.buildings.get(buildQ[i]);
        if (b && !b.isDestroyed && b.hp > 0 && (!b.isCompleted || b.hp < b.maxHp)) {
          return true;
        }
      }
    }
    if (wComp.activeBuildTargetId > 0) {
      const b = cs.buildings.get(wComp.activeBuildTargetId);
      if (b && !b.isDestroyed && b.hp > 0 && (!b.isCompleted || b.hp < b.maxHp)) {
        return true;
      }
    }
    return false;
  }

  stepWorkerGathering(gameState, outCommands) {
    const eco = gameState.economySystem;
    const cs = gameState.constructionSystem;
    if (!eco || !cs) return;

    const homeBld = this.findHomeBaseBuilding(gameState);
    const baseCenterXFx = homeBld ? homeBld.xFx : 2048 * FX_ONE;
    const baseCenterZFx = homeBld ? homeBld.zFx : 2420 * FX_ONE;
    const worldSizeFx = gameState.worldSizeFx || 4096 * FX_ONE;

    const workerComps = [];
    for (const comp of gameState.companies.values()) {
      if (!comp || comp.team !== this.team || comp.unitType !== 'worker' || comp.memberIds.length === 0) {
        continue;
      }
      if (this.slotIndex !== null && comp.aiSlotIndex !== undefined && comp.aiSlotIndex !== this.slotIndex) {
        continue;
      }
      workerComps.push(comp);
    }
    if (workerComps.length === 0) return;

    const ledger = eco.getTeamLedger(this.team);

    for (let i = 0; i < workerComps.length; i++) {
      const wComp = workerComps[i];
      if (this._isWorkerBusyBuilding(cs, wComp)) continue;

      const gatherTask = eco.companyGatherTasks.get(wComp.id);
      const isActivelyGathering =
        gatherTask &&
        gatherTask.state !== GathererState.IDLE &&
        (wComp.isWorking || wComp.isActivelyMoving());
      if (isActivelyGathering) continue;

      // Prioritize iron alongside coins & wood so Barracks/Stables/Siege Works never starve for iron!
      let wantWood = ledger.wood < 200 || (i === 0 && ledger.wood < 340);
      let targetMineType = null;
      if (!wantWood) {
        if (ledger.iron < 160 && (i % 2 === 1 || ledger.coins >= 220)) targetMineType = 'iron';
        else if (ledger.coins < 280) targetMineType = 'coins';
        else if (ledger.stone < 140) targetMineType = 'stone';
        else if (ledger.iron < 220) targetMineType = 'iron';
        else {
          const roll = fxRandomRange(gameState, 0, 99);
          if (roll < 30) wantWood = true;
          else if (roll < 58) targetMineType = 'coins';
          else if (roll < 86) targetMineType = 'iron';
          else targetMineType = 'stone';
        }
      }

      let targetNode = null;
      if (!wantWood) {
        let bestDist = 0x7fffffff;
        for (let mIdx = 0; mIdx < eco.sortedMineIds.length; mIdx++) {
          const m = eco.mines.get(eco.sortedMineIds[mIdx]);
          if (!m) continue;
          if (targetMineType && m.resourceType !== targetMineType) continue;
          if (this.perception && !this.perception.isWorldPointExplored(m.xFx, m.zFx, worldSizeFx)) {
            continue;
          }
          const d = fxHypot((m.xFx - wComp.anchorXFx) | 0, (m.zFx - wComp.anchorZFx) | 0);
          if (d < bestDist && d <= 260 * FX_ONE) {
            bestDist = d;
            targetNode = m;
          }
        }
      }

      if (!targetNode) {
        const tree = eco.findNearestGrownTree(baseCenterXFx, baseCenterZFx, 160 * FX_ONE);
        if (tree && (!this.perception || this.perception.isWorldPointExplored(tree.xFx, tree.zFx, worldSizeFx))) {
          targetNode = tree;
        }
      }

      if (targetNode) {
        outCommands.push({
          type: CommandTypes.GATHER_RESOURCE,
          payload: {
            team: this.team,
            workerCompanyIds: [wComp.id],
            xFx: targetNode.xFx,
            zFx: targetNode.zFx,
            queue: false,
            isRunning: false
          }
        });
      }
    }
  }

  findValidBuildingSpotFx(gameState, buildingType, centerXFx, centerZFx, minRadiusMeters = 18, maxRadiusMeters = 62) {
    const cs = gameState.constructionSystem;
    if (!cs) return null;
    const worldSizeFx = gameState.worldSizeFx || 4096 * FX_ONE;

    const anglesDeg = [0, 45, -45, 90, -90, 135, -135, 180, 22, -22, 67, -67, 112, -112, 157, -157];
    const rotOffset = fxRandomRange(gameState, 0, anglesDeg.length - 1);

    for (let rMeters = minRadiusMeters; rMeters <= maxRadiusMeters; rMeters += 7) {
      for (let a = 0; a < anglesDeg.length; a++) {
        const deg = anglesDeg[(a + rotOffset) % anglesDeg.length];
        const rad = (deg * Math.PI) / 180;
        const candXFx = (centerXFx + Math.round(Math.cos(rad) * rMeters * FX_ONE)) | 0;
        const candZFx = (centerZFx + Math.round(Math.sin(rad) * rMeters * FX_ONE)) | 0;

        if (this.perception && !this.perception.isWorldPointExplored(candXFx, candZFx, worldSizeFx)) {
          continue;
        }
        const check = cs.isPlacementValid(buildingType, candXFx, candZFx, this.team, true);
        if (check && check.valid) {
          return { xFx: candXFx, zFx: candZFx };
        }
      }
    }
    return null;
  }

  _cancelPendingGatherCommandForWorker(outCommands, workerCompanyId) {
    for (let i = outCommands.length - 1; i >= 0; i--) {
      const cmd = outCommands[i];
      if (
        cmd.type === CommandTypes.GATHER_RESOURCE &&
        Array.isArray(cmd.payload?.workerCompanyIds) &&
        cmd.payload.workerCompanyIds.includes(workerCompanyId)
      ) {
        outCommands.splice(i, 1);
      }
    }
  }

  stepBaseConstruction(gameState, doctrine, adaptiveWeights, outCommands) {
    const cs = gameState.constructionSystem;
    const eco = gameState.economySystem;
    if (!cs || !eco) return;

    const homeBld = this.findHomeBaseBuilding(gameState);
    if (!homeBld) return;

    const workerComps = [];
    for (const comp of gameState.companies.values()) {
      if (comp && comp.team === this.team && comp.unitType === 'worker' && comp.memberIds.length > 0 && (this.slotIndex === null || comp.aiSlotIndex === undefined || comp.aiSlotIndex === this.slotIndex)) {
        workerComps.push(comp);
      }
    }
    if (workerComps.length === 0) return;

    const teamBlds = [];
    const countsByType = {};
    const completedCountsByType = {};
    for (let i = 0; i < cs.sortedBuildingIds.length; i++) {
      const b = cs.buildings.get(cs.sortedBuildingIds[i]);
      if (!b || b.isDestroyed || b.team !== this.team) continue;
      teamBlds.push(b);
      if (b.type !== 'citadel_slot' && b.hp > 0) {
        countsByType[b.type] = (countsByType[b.type] || 0) + 1;
        if (b.isCompleted) {
          completedCountsByType[b.type] = (completedCountsByType[b.type] || 0) + 1;
        }
      }
    }

    for (let i = 0; i < teamBlds.length; i++) {
      const b = teamBlds[i];
      if (b.type === 'citadel_slot' || b.isAutoConstructingSlot || b.hp <= 0) continue;
      const needsWork = !b.isCompleted || b.hp < ((b.maxHp * 85) / 100);
      if (!needsWork) continue;

      const hasAssignedWorker =
        (b.activeBuildersCount | 0) > 0 ||
        workerComps.some((wc) => {
          const q = cs.workerBuildQueues.get(wc.id) || [];
          return wc.activeBuildTargetId === b.id || q.includes(b.id);
        });

      if (!hasAssignedWorker) {
        const freeWorker = workerComps.find((wc) => !this._isWorkerBusyBuilding(cs, wc));
        const chosenBuilder = freeWorker || workerComps[0];
        const shouldQueue = !freeWorker;
        if (!shouldQueue) {
          this._cancelPendingGatherCommandForWorker(outCommands, chosenBuilder.id);
        }
        outCommands.push({
          type: CommandTypes.ASSIGN_BUILDERS,
          payload: {
            team: this.team,
            workerCompanyIds: [chosenBuilder.id],
            buildingId: b.id,
            queue: shouldQueue,
            isRunning: false
          }
        });
        return;
      }
    }

    if (gameState.tick - this._lastPlacementAttemptTick < 50) return;

    const freeBuilder = workerComps.find((wc) => !this._isWorkerBusyBuilding(cs, wc));
    if (!freeBuilder) return;

    const underConstructionCount = teamBlds.filter(
      (b) => b.type !== 'citadel_slot' && !b.isAutoConstructingSlot && !b.isCompleted && b.hp > 0
    ).length;
    if (underConstructionCount >= workerComps.length) return;

    const ledger = eco.getTeamLedger(this.team);
    const popUsedTotal = (ledger.popUsed || 0) + (ledger.reservedPop || 0);
    const popCap = ledger.popCap || 60;

    let desiredType = null;
    if (!countsByType.house) {
      desiredType = 'house';
    } else if (!countsByType.barracks) {
      desiredType = 'barracks';
    } else if ((countsByType.house || 0) < 2) {
      desiredType = 'house';
    } else if (!countsByType.archery_range) {
      desiredType = 'archery_range';
    } else if ((countsByType.house || 0) < 4 && popUsedTotal + 16 >= popCap) {
      desiredType = 'house';
    } else if (
      !countsByType.stables &&
      (doctrine === AiDoctrines.RAIDER_CAVALRY || adaptiveWeights.cavalry >= 20 || gameState.tick >= 1200)
    ) {
      desiredType = 'stables';
    } else if (popUsedTotal + 20 >= popCap && (countsByType.house || 0) < 8) {
      desiredType = 'house';
    } else if (
      !countsByType.siege_works &&
      (doctrine === AiDoctrines.RANGER_SIEGE ||
        (this.perception?.observedEnemyComposition?.towers || 0) >= 1 ||
        gameState.tick >= 1900)
    ) {
      desiredType = 'siege_works';
    } else if (!countsByType.infirmary && (completedCountsByType.barracks || 0) + (completedCountsByType.archery_range || 0) >= 2) {
      desiredType = 'infirmary';
    } else if (!countsByType.banner_house && gameState.tick >= 2400) {
      desiredType = 'banner_house';
    } else if ((countsByType.house || 0) < 6 && ledger.coins >= 420 && ledger.wood >= 240) {
      desiredType = 'house';
    }

    if (!desiredType) return;
    const def = cs.buildingDefs[desiredType];
    if (!def || !eco.canAfford(this.team, def.cost, 'building')) return;

    const spot = this.findValidBuildingSpotFx(gameState, desiredType, homeBld.xFx, homeBld.zFx, 20, 62);
    if (!spot) return;

    this._lastPlacementAttemptTick = gameState.tick;
    this._cancelPendingGatherCommandForWorker(outCommands, freeBuilder.id);
    outCommands.push({
      type: CommandTypes.PLACE_BUILDING,
      payload: {
        team: this.team,
        buildingType: desiredType,
        xFx: spot.xFx,
        zFx: spot.zFx,
        facingDir: 768,
        workerCompanyIds: [freeBuilder.id],
        queue: false
      }
    });
  }

  /**
   * Queues unit recruitment, Hero recruitment/revival, and bastion slot watchtowers using `QUEUE_PRODUCTION`.
   * Enforces combined-arms army diversity so the AI never spams only Archers!
   */
  stepUnitAndHeroProduction(gameState, doctrine, adaptiveWeights, outCommands) {
    const cs = gameState.constructionSystem;
    const eco = gameState.economySystem;
    if (!cs || !eco) return;

    const ledger = eco.getTeamLedger(this.team);
    const popUsedTotal = (ledger.popUsed || 0) + (ledger.reservedPop || 0);
    const popCap = ledger.popCap || 60;

    let workerSquads = 0;
    let heroCount = 0;
    const ownSquadCounts = {
      swordsman: 0,
      spearman: 0,
      archer: 0,
      cavalry: 0,
      ballista: 0
    };

    for (const comp of gameState.companies.values()) {
      if (!comp || comp.team !== this.team || comp.memberIds.length === 0) continue;
      if (comp.unitType === 'worker') workerSquads++;
      else if (comp.isHero) heroCount++;
      else if (ownSquadCounts[comp.unitType] !== undefined) {
        ownSquadCounts[comp.unitType]++;
      }
    }

    const completedProdBlds = [];
    const freeBastionSlots = [];
    let completedMilitaryBlds = 0;
    let watchtowerCount = 0;
    let hasBarracksOrStables = false;

    for (let i = 0; i < cs.sortedBuildingIds.length; i++) {
      const b = cs.buildings.get(cs.sortedBuildingIds[i]);
      if (!b || b.isDestroyed || b.team !== this.team) continue;
      if (b.type === 'citadel_slot' && b.isCompleted) {
        freeBastionSlots.push(b);
        continue;
      }
      if (b.type === 'watchtower' && b.hp > 0) {
        watchtowerCount++;
      }
      if (b.isCompleted && b.hp > 0) {
        if (b.type === 'barracks' || b.type === 'stables') {
          hasBarracksOrStables = true;
        }
        if (
          b.type === 'barracks' ||
          b.type === 'archery_range' ||
          b.type === 'stables' ||
          b.type === 'siege_works'
        ) {
          completedMilitaryBlds++;
        }
        if (b.productionQueue.length === 0) {
          completedProdBlds.push(b);
        }
      }
    }

    // 1. Ensure target worker companies (driven by learned model) for steady economy once popCap allows
    const targetWorkers = Math.max(2, Math.min(5, (this.model?.targetWorkers | 0) || 2));
    const effectiveTargetWorkers = completedMilitaryBlds >= 1 || ledger.coins >= 550 ? targetWorkers : 2;
    if (workerSquads < effectiveTargetWorkers && ledger.coins >= 360) {
      const cit = completedProdBlds.find((b) => b.type === 'citadel' || b.type === 'gathering_camp');
      if (cit) {
        const optId = cit.type === 'citadel' ? 'worker' : 'gatherer';
        outCommands.push({
          type: CommandTypes.QUEUE_PRODUCTION,
          payload: { team: this.team, buildingId: cit.id, optionId: optId }
        });
        return;
      }
    }

    // 2. Combined-arms diversity multipliers: prevent Archer over-production when Melee/Cavalry counts are lower!
    const totalFrontlineSquads = ownSquadCounts.swordsman + ownSquadCounts.spearman + ownSquadCounts.cavalry;
    const archerOverflow = ownSquadCounts.archer - Math.max(1, totalFrontlineSquads);

    const effectiveWeights = {
      swordsman: adaptiveWeights.swordsman + (ownSquadCounts.swordsman === 0 ? 22 : 0),
      spearman: adaptiveWeights.spearman + (ownSquadCounts.spearman === 0 ? 18 : 0),
      cavalry: adaptiveWeights.cavalry + (ownSquadCounts.cavalry === 0 ? 24 : 0),
      siege: adaptiveWeights.siege + (ownSquadCounts.ballista === 0 ? 12 : 0),
      archer:
        archerOverflow >= 1
          ? Math.max(3, Math.round(adaptiveWeights.archer * 0.15))
          : ownSquadCounts.archer >= 2
            ? Math.max(8, Math.round(adaptiveWeights.archer * 0.45))
            : adaptiveWeights.archer
    };

    const militaryCandidates = [];
    for (let i = 0; i < completedProdBlds.length; i++) {
      const b = completedProdBlds[i];
      const bLevel = b.level || 1;
      const def = cs.buildingDefs[b.type];
      if (!def || !Array.isArray(def.options)) continue;

      for (const opt of def.options) {
        if (opt.kind !== 'unit') continue;
        if ((opt.unlockLevel || 1) > bLevel) continue;
        const uType = opt.unitType || opt.id;
        let w = effectiveWeights.swordsman;
        let popCost = 20;
        if (uType === 'spearman') {
          w = effectiveWeights.spearman;
          popCost = 20;
        } else if (uType === 'archer') {
          // If the AI already has >= 2 archer squads and has a Barracks/Stables waiting for a tiny bit more iron,
          // hold off on spending coins on yet another Archer squad so Frontline/Cavalry can be recruited!
          if (hasBarracksOrStables && archerOverflow >= 1 && ledger.coins < 360) {
            continue;
          }
          w = effectiveWeights.archer;
          popCost = 20;
        } else if (uType === 'cavalry') {
          w = effectiveWeights.cavalry;
          popCost = 16;
        } else if (uType === 'ballista') {
          w = effectiveWeights.siege;
          popCost = 3;
        }
        militaryCandidates.push({
          bld: b,
          optionId: opt.id,
          popCost,
          weight: w
        });
      }
    }

    if (militaryCandidates.length > 0) {
      const affordable = [];
      let totalWeight = 0;
      const needHouseReserve = popUsedTotal + 20 > popCap;
      for (let i = 0; i < militaryCandidates.length; i++) {
        const c = militaryCandidates[i];
        if (popUsedTotal + c.popCost > popCap && (!needHouseReserve || ledger.coins < 420 || ledger.wood < 220)) {
          continue;
        }
        const def = cs.buildingDefs[c.bld.type];
        const opt = def?.options?.find((o) => o.id === c.optionId);
        if (opt && eco.canAfford(this.team, opt.cost, 'unit', opt.id)) {
          const w = Math.max(3, c.weight | 0);
          affordable.push({ ...c, weight: w });
          totalWeight += w;
        }
      }

      if (affordable.length > 0 && totalWeight > 0) {
        const mistakeProb = this.model?.mistakeProbPermille | 0;
        let chosen = affordable[0];
        if (affordable.length > 1 && mistakeProb > 0 && (((Math.imul((gameState.tick | 0) + 17, 2654435761) ^ Math.imul((this.team | 0) + 3, 1013904223)) >>> 0) % 1000) < mistakeProb) {
          chosen = affordable[fxRandomRange(gameState, 0, affordable.length - 1)];
        } else {
          let roll = fxRandomRange(gameState, 0, totalWeight - 1);
          for (let i = 0; i < affordable.length; i++) {
            if (roll < affordable[i].weight) {
              chosen = affordable[i];
              break;
            }
            roll -= affordable[i].weight;
          }
        }

        outCommands.push({
          type: CommandTypes.QUEUE_PRODUCTION,
          payload: {
            team: this.team,
            buildingId: chosen.bld.id,
            optionId: chosen.optionId
          }
        });
        return;
      }
    }

    // 3. Recruit or revive a Hero at the Citadel ONLY after building at least 1 military production structure
    if (
      heroCount === 0 &&
      completedMilitaryBlds >= 1 &&
      popUsedTotal + 1 <= popCap &&
      ledger.coins >= 520
    ) {
      const cit = completedProdBlds.find((b) => b.type === 'citadel');
      if (cit && gameState.heroSystem) {
        const heroIds = Object.keys(gameState.heroSystem.heroesData?.heroes || {});
        if (heroIds.length > 0) {
          const pickIdx = fxRandomRange(gameState, 0, heroIds.length - 1);
          const hid = heroIds[pickIdx];
          const status = gameState.heroSystem.isHeroActiveOrQueued(gameState, this.team, hid);
          const hOpt = gameState.heroSystem.getHeroRecruitmentOption(hid, this.team);
          if (!status.active && !status.queued && hOpt && eco.canAfford(this.team, hOpt.cost, 'hero', hOpt.id)) {
            outCommands.push({
              type: CommandTypes.QUEUE_PRODUCTION,
              payload: { team: this.team, buildingId: cit.id, optionId: `hero:${hid}` }
            });
            return;
          }
        }
      }
    }

    // 4. Upgrade at most 2 Citadel bastion slots to Watchtowers/Ballista Towers after military buildings are up
    if (
      freeBastionSlots.length > 0 &&
      watchtowerCount < 2 &&
      completedMilitaryBlds >= 2 &&
      ledger.coins >= 650 &&
      ledger.stone >= 220 &&
      gameState.tick >= 2400
    ) {
      const slotBld = freeBastionSlots[0];
      outCommands.push({
        type: CommandTypes.QUEUE_PRODUCTION,
        payload: { team: this.team, buildingId: slotBld.id, optionId: 'watchtower' }
      });
    }
  }
}
