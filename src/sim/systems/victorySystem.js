/**
 * Kings Lands — Authoritative Victory, Defeat, Last Stand & Chain-Reaction Collapse System
 * (src/sim/systems/victorySystem.js)
 */

import { FX_ONE, TICKS_PER_SEC, fxHypot } from '../../core/fx.js';
import { FowState, FOW_GRID_SIZE } from './visionSystem.js';

// ============================================================================
// Phase 7: Authoritative Victory, Last Stand & Chain-Reaction Collapse System
// ============================================================================

export const PRODUCTION_BUILDING_TYPES = new Set([
  'citadel',
  'barracks',
  'archery_range',
  'stables',
  'siege_works'
]);

export const COLLAPSE_DURATION_TICKS = (3.5 * TICKS_PER_SEC) | 0; // 70 ticks (3.5 seconds)

export const NO_BUILDING_TIMEOUT_TICKS = (180 * TICKS_PER_SEC) | 0; // 3 minutes (3600 ticks)

export class VictorySystem {
  constructor() {
    this.teamStats = {
      1: {
        workersAlive: 0,
        productionBuildingsAlive: 0,
        buildingsUnderConstruction: 0,
        resourceBuildingsAlive: 0,
        combatUnitsAlive: 0,
        otherBuildingsAlive: 0,
        noBuildingTicks: 0,
        isLastStand: false,
        lastStandAnnounced: false
      },
      2: {
        workersAlive: 0,
        productionBuildingsAlive: 0,
        buildingsUnderConstruction: 0,
        resourceBuildingsAlive: 0,
        combatUnitsAlive: 0,
        otherBuildingsAlive: 0,
        noBuildingTicks: 0,
        isLastStand: false,
        lastStandAnnounced: false
      }
    };

    this.collapseState = {
      active: false,
      losingTeam: 0,
      winningTeam: 0,
      startTick: 0,
      ticksElapsed: 0,
      totalTicks: COLLAPSE_DURATION_TICKS,
      remainingTargetQueue: [],
      nextExplosionTick: 0
    };

    this.eliminatedTeams = new Set();
    this.matchResult = null;
  }

  _ensureTeamStats(t) {
    if (!this.teamStats[t]) {
      this.teamStats[t] = {
        workersAlive: 0, productionBuildingsAlive: 0, buildingsUnderConstruction: 0,
        resourceBuildingsAlive: 0, combatUnitsAlive: 0, otherBuildingsAlive: 0,
        noBuildingTicks: 0, isLastStand: false, lastStandAnnounced: false
      };
    }
    return this.teamStats[t];
  }

  isProductionBuilding(b) {
    if (!b || b.isDestroyed || b.hp <= 0 || b.type === 'citadel_slot') return false;
    return PRODUCTION_BUILDING_TYPES.has(b.type);
  }

  _recountTeamAssets(gameState, UnitTypeIndex) {
    const activeTeams = new Set([1, 2]);
    if (gameState.teamAlliances) {
      for (const k of gameState.teamAlliances.keys()) activeTeams.add(k | 0);
    }
    for (const t of activeTeams) {
      this._ensureTeamStats(t);
      this.teamStats[t].workersAlive = 0;
      this.teamStats[t].productionBuildingsAlive = 0;
      this.teamStats[t].buildingsUnderConstruction = 0;
      this.teamStats[t].resourceBuildingsAlive = 0;
      this.teamStats[t].combatUnitsAlive = 0;
      this.teamStats[t].otherBuildingsAlive = 0;
    }

    const bIds = gameState.constructionSystem?.sortedBuildingIds || [];
    const buildings = gameState.constructionSystem?.buildings;
    if (buildings) {
      for (let i = 0; i < bIds.length; i++) {
        const b = buildings.get(bIds[i]);
        if (!b || b.isDestroyed || b.hp <= 0 || b.type === 'citadel_slot') continue;
        const stats = this.teamStats[b.team];
        if (!stats) continue;
        if (!b.isCompleted) {
          stats.buildingsUnderConstruction++;
        }
        if (PRODUCTION_BUILDING_TYPES.has(b.type)) {
          stats.productionBuildingsAlive++;
        } else {
          stats.otherBuildingsAlive++;
          if (b.type === 'gathering_camp' || b.type === 'house') {
            stats.resourceBuildingsAlive++;
          }
        }
      }
    }

    const ids = gameState.sortedEntityIds;
    const entities = gameState.entities;
    for (let i = 0; i < ids.length; i++) {
      const ent = entities.get(ids[i]);
      if (!ent || ent.hp <= 0) {
        if (ent) ent.isRevealedLastStand = false;
        continue;
      }
      const stats = this.teamStats[ent.team];
      if (!stats) continue;
      if (ent.unitTypeIdx === UnitTypeIndex.worker) {
        stats.workersAlive++;
      } else {
        stats.combatUnitsAlive++;
      }
    }
  }

  _canTeamAffordAnyBuilding(gameState, team) {
    const ledger = gameState.economySystem?.getTeamLedger?.(team);
    if (!ledger) return true;
    const coins = ledger.coins | 0;
    const wood = ledger.wood | 0;
    const stone = ledger.stone | 0;
    // Cheapest buildings: house (100 coins, 60 wood), gathering_camp (150 coins, 100 wood), watchtower (150 coins, 150 stone)
    if (coins >= 100 && wood >= 60) return true;
    if (coins >= 150 && stone >= 150) return true;
    return false;
  }

  startCollapseForTeam(gameState, losingTeam, explicitWinningTeam = null) {
    if (this.collapseState.active || this.matchResult) return;
    const winningTeam = explicitWinningTeam ?? (losingTeam === 1 ? 2 : 1);

    const queue = [];
    const bIds = gameState.constructionSystem?.sortedBuildingIds || [];
    const buildings = gameState.constructionSystem?.buildings;
    if (buildings) {
      for (let i = 0; i < bIds.length; i++) {
        const b = buildings.get(bIds[i]);
        if (b && b.team === losingTeam && !b.isDestroyed && b.hp > 0 && b.type !== 'citadel_slot') {
          queue.push({ kind: 'BUILDING', id: b.id, xFx: b.xFx, yFx: b.yFx, zFx: b.zFx });
        }
      }
    }

    const ids = gameState.sortedEntityIds;
    const entities = gameState.entities;
    for (let i = 0; i < ids.length; i++) {
      const ent = entities.get(ids[i]);
      if (ent && ent.team === losingTeam && ent.hp > 0) {
        queue.push({ kind: 'UNIT', id: ent.id, xFx: ent.x, yFx: ent.y, zFx: ent.z });
      }
    }

    this.collapseState = {
      active: true,
      losingTeam,
      winningTeam,
      startTick: gameState.tick,
      ticksElapsed: 0,
      totalTicks: COLLAPSE_DURATION_TICKS,
      remainingTargetQueue: queue,
      nextExplosionTick: gameState.tick
    };

    if (gameState.visionSystem) {
      gameState.visionSystem.update(gameState, true);
    }
  }

  _stepCollapseSequence(gameState) {
    const cs = this.collapseState;
    cs.ticksElapsed = (gameState.tick - cs.startTick) | 0;

    const totalItems = cs.remainingTargetQueue.length;
    const ticksLeft = Math.max(1, cs.totalTicks - cs.ticksElapsed);
    const itemsToPopNow =
      totalItems > 0 ? Math.max(1, Math.ceil(totalItems / Math.max(1, Math.floor(ticksLeft / 2)))) : 0;

    if (itemsToPopNow > 0 && (cs.ticksElapsed % 2 === 0 || ticksLeft <= 4)) {
      const buildings = gameState.constructionSystem?.buildings;
      const entities = gameState.entities;

      for (let k = 0; k < itemsToPopNow && cs.remainingTargetQueue.length > 0; k++) {
        const item = cs.remainingTargetQueue.shift();
        if (!item) continue;

        if (item.kind === 'BUILDING' && buildings) {
          const b = buildings.get(item.id);
          if (b && !b.isDestroyed && b.hp > 0) {
            b.hp = 0;
            b.isDestroyed = true;
          }
        } else if (item.kind === 'UNIT' && entities) {
          const ent = entities.get(item.id);
          if (ent && ent.hp > 0) {
            // Units simply fall down with their natural death animation (no circle/blast sphere)
            ent.hp = 0;
            ent.deadTicks = 1;
          }
        }
      }
    }

    if (cs.ticksElapsed >= cs.totalTicks) {
      const buildings = gameState.constructionSystem?.buildings;
      const bIds = gameState.constructionSystem?.sortedBuildingIds || [];
      if (buildings) {
        for (let i = 0; i < bIds.length; i++) {
          const b = buildings.get(bIds[i]);
          if (b && b.team === cs.losingTeam && b.type !== 'citadel_slot') {
            b.hp = 0;
            b.isDestroyed = true;
          }
        }
      }
      for (const ent of gameState.entities.values()) {
        if (ent && ent.team === cs.losingTeam && ent.hp > 0) {
          ent.hp = 0;
          ent.deadTicks = 1;
        }
      }

      cs.active = false;
      this.matchResult = {
        outcome: (gameState.playerTeam > 0 && gameState.areTeamsAllied ? gameState.areTeamsAllied(cs.winningTeam, gameState.playerTeam) : cs.winningTeam === 1) ? 'VICTORY' : 'DEFEAT',
        winningTeam: cs.winningTeam,
        losingTeam: cs.losingTeam,
        finishedTick: gameState.tick
      };
    }
  }

  update(gameState, { UnitTypeIndex }) {
    if (gameState.tick < 5) return;

    this._recountTeamAssets(gameState, UnitTypeIndex);

    const activeTeams = Object.keys(this.teamStats).map((k) => k | 0);
    for (const t of activeTeams) {
      const st = this.teamStats[t];
      const inLastStand = st.productionBuildingsAlive === 0 && st.workersAlive > 0;
      st.isLastStand = inLastStand;

      if (inLastStand) {
        if (st.buildingsUnderConstruction > 0) {
          st.noBuildingTicks = 0;
        } else {
          st.noBuildingTicks = ((st.noBuildingTicks | 0) + 1) | 0;
        }
      } else {
        st.noBuildingTicks = 0;
        if (st.productionBuildingsAlive > 0) {
          st.lastStandAnnounced = false;
        }
      }
    }

    const ids = gameState.sortedEntityIds;
    const entities = gameState.entities;
    for (let i = 0; i < ids.length; i++) {
      const ent = entities.get(ids[i]);
      if (!ent || ent.hp <= 0) continue;
      const st = this.teamStats[ent.team];
      ent.isRevealedLastStand = Boolean(
        st && st.isLastStand && ent.unitTypeIdx === UnitTypeIndex.worker
      );
    }

    if (this.matchResult) return;

    if (this.collapseState.active) {
      this._stepCollapseSequence(gameState);
      return;
    }

    const sortedTeams = Object.keys(this.teamStats).map((k) => k | 0).sort((a, b) => b - a);
    for (const t of sortedTeams) {
      if (this.eliminatedTeams.has(t)) continue;
      const st = this.teamStats[t];
      // Ignore teams that never spawned anything (e.g. team 2 in solo or closed slot)
      const hasAnyAsset = st.workersAlive > 0 || st.productionBuildingsAlive > 0 || st.otherBuildingsAlive > 0 || st.combatUnitsAlive > 0;
      if (!hasAnyAsset && t > 2) {
        this.eliminatedTeams.add(t);
        continue;
      }
      if (st.productionBuildingsAlive === 0) {
        const noWorkersLeft = st.workersAlive === 0;
        const timedOutNoBuilding = (st.noBuildingTicks | 0) >= NO_BUILDING_TIMEOUT_TICKS;
        const brokeAndCannotBuild =
          st.buildingsUnderConstruction === 0 &&
          st.resourceBuildingsAlive === 0 &&
          !this._canTeamAffordAnyBuilding(gameState, t);

        if (noWorkersLeft || timedOutNoBuilding || brokeAndCannotBuild) {
          this.eliminatedTeams.add(t);
          // Check how many alliances still have at least one non-eliminated team
          const survivingAlliances = new Set();
          let survivorTeam = 1;
          for (const candT of sortedTeams) {
            if (!this.eliminatedTeams.has(candT)) {
              const al = gameState.teamAlliances?.get(candT) ?? candT;
              survivingAlliances.add(al);
              survivorTeam = candT;
            }
          }
          if (survivingAlliances.size <= 1) {
            this.startCollapseForTeam(gameState, t, survivorTeam);
            break;
          }
        }
      }
    }
  }

  getSnapshotState() {
    return {
      team1LastStand: this.teamStats[1].isLastStand,
      team2LastStand: this.teamStats[2].isLastStand,
      team1Workers: this.teamStats[1].workersAlive,
      team2Workers: this.teamStats[2].workersAlive,
      team1ProdBlds: this.teamStats[1].productionBuildingsAlive,
      team2ProdBlds: this.teamStats[2].productionBuildingsAlive,
      collapseActive: this.collapseState.active,
      collapseLosingTeam: this.collapseState.losingTeam,
      collapseProgressPermille: this.collapseState.active
        ? Math.min(1000, Math.round((this.collapseState.ticksElapsed * 1000) / Math.max(1, this.collapseState.totalTicks)))
        : 0,
      matchResult: this.matchResult
    };
  }
}
