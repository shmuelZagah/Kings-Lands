/**
 * Kings Lands — Master AI Brain (`src/sim/ai/enemyAiController.js`)
 *
 * STRICT ARCHITECTURAL & FAIR-PLAY GUARANTEES:
 * 1. Pure Thinking Brain: The AI NEVER modifies any game logic, unit stats, cooldowns, resources,
 *    or positions directly. It outputs a list of standard `CommandTypes` that are processed through
 *    `processSimCommands` (`src/sim/commandHandlers.js`) identically to human player commands.
 * 2. Fog of War & Terrain Only: The AI operates strictly on its own Fog of War (`AiPerception.fowGrid`)
 *    and map topography (bridges, shallow fords, hills, forests, mines).
 * 3. Adaptive & Persistent Learning (`aiLearningModel.js`):
 *    - Supports `easy`, `mid` (`normal`), `hard`, and `learning` (`adaptive`) difficulty models.
 *    - In `learning` mode, continuously evaluates battlefield fitness mid-game and evolves policy
 *      weights across matches (including AI vs AI training matches).
 *    - Uses weighted doctrine selection + bounded exploration so no two games play identically.
 */

import { fxRandomRange } from '../../core/fx.js';
import { AiPerception } from './aiPerception.js';
import { AiEconomyPlanner, AiDoctrines } from './aiEconomyPlanner.js';
import { AiTacticalCommander } from './aiTacticalCommander.js';
import {
  normalizeDifficultyKey,
  resolveModelForDifficulty,
  AiLearningSession
} from './aiLearningModel.js';

export { AiDoctrines };

const DOCTRINE_LIST = Object.freeze([
  AiDoctrines.BALANCED_COMMANDER,
  AiDoctrines.RAIDER_CAVALRY,
  AiDoctrines.RANGER_SIEGE,
  AiDoctrines.IRON_VANGUARD
]);

export class EnemyAiController {
  constructor(config = {}, team = 2, slotSpec = null) {
    this.team = team | 0;
    this.slotIndex = slotSpec && slotSpec.slotIndex !== undefined ? slotSpec.slotIndex : null;
    this.enabled = config?.ai?.enabled !== false;
    this.rawDifficulty = slotSpec?.aiDifficulty || config?.ai?.difficulty || 'learning';
    this.difficulty = normalizeDifficultyKey(this.rawDifficulty);
    if (String(this.rawDifficulty).toLowerCase() === 'off') {
      this.difficulty = 'off';
      this.enabled = false;
    }

    this.model = resolveModelForDifficulty(this.difficulty, config?.learnedAiModel || null);
    this.learningSession = new AiLearningSession(this.team, this.model);
    this._matchEvolutionEmitted = false;

    this.perception = new AiPerception(this.team);
    this.economyPlanner = new AiEconomyPlanner(this.team, this.perception, slotSpec);
    this.tacticalCommander = new AiTacticalCommander(this.team, this.perception);
    this.economyPlanner.setModel?.(this.model);
    this.tacticalCommander.setModel?.(this.model);

    this.doctrine = null;
    this._nextThinkTick = 10 + (this.team % 4) * 2;

    // Learned recruitment weights (dynamically adapted from observed enemy units + model weights)
    this.adaptiveWeights = { ...this.model.unitWeights };
  }

  setMode(modeString) {
    const m = String(modeString || '').trim().toLowerCase();
    if (m === 'off' || m === 'disable' || m === 'disabled' || m === '0') {
      this.enabled = false;
      this.difficulty = 'off';
      return;
    }
    this.enabled = true;
    this.difficulty = normalizeDifficultyKey(m);
    this.model = resolveModelForDifficulty(this.difficulty, this.model);
    this.learningSession.model = this.model;
    this.economyPlanner.setModel?.(this.model);
    this.tacticalCommander.setModel?.(this.model);
  }

  _ensureDoctrineSelected(gameState) {
    if (this.doctrine) return;

    // Weighted random selection using learned doctrineWeights + exploration
    const dw = this.model.doctrineWeights || {};
    if ((this.model.gamesPlayed | 0) === 0) {
      const idx = fxRandomRange(gameState, 0, DOCTRINE_LIST.length - 1);
      this.doctrine = DOCTRINE_LIST[idx];
    } else {
      const exploreRoll = fxRandomRange(gameState, 0, 999);
      if (exploreRoll < (this.model.explorationRatePermille | 0)) {
        const idx = fxRandomRange(gameState, 0, DOCTRINE_LIST.length - 1);
        this.doctrine = DOCTRINE_LIST[idx];
      } else {
        let totalW = 0;
        for (const d of DOCTRINE_LIST) totalW += Math.max(5, dw[d] | 0);
        let roll = fxRandomRange(gameState, 0, Math.max(1, totalW - 1));
        let chosen = DOCTRINE_LIST[0];
        for (const d of DOCTRINE_LIST) {
          const w = Math.max(5, dw[d] | 0);
          if (roll < w) {
            chosen = d;
            break;
          }
          roll -= w;
        }
        this.doctrine = chosen;
      }
    }

    const base = { ...this.model.unitWeights };
    if (this.doctrine === AiDoctrines.RAIDER_CAVALRY) {
      base.cavalry = Math.round(base.cavalry * 1.45);
      base.swordsman = Math.round(base.swordsman * 0.85);
    } else if (this.doctrine === AiDoctrines.RANGER_SIEGE) {
      base.archer = Math.round(base.archer * 1.4);
      base.siege = Math.round(base.siege * 1.45);
    } else if (this.doctrine === AiDoctrines.IRON_VANGUARD) {
      base.swordsman = Math.round(base.swordsman * 1.35);
      base.spearman = Math.round(base.spearman * 1.25);
    }
    this.adaptiveWeights = base;
    this.learningSession.lastDoctrine = this.doctrine;
  }

  /**
   * Updates recruitment weights based on the observed enemy army composition (Counter-Adaptation)
   * scaled by `model.counterSensitivity`, plus deterministic exploration jitter.
   */
  _updateAdaptiveCounterWeights(gameState, observed) {
    const base = { ...this.model.unitWeights };
    if (this.doctrine === AiDoctrines.RAIDER_CAVALRY) {
      base.cavalry = Math.round(base.cavalry * 1.4);
    } else if (this.doctrine === AiDoctrines.RANGER_SIEGE) {
      base.archer = Math.round(base.archer * 1.35);
      base.siege = Math.round(base.siege * 1.4);
    } else if (this.doctrine === AiDoctrines.IRON_VANGUARD) {
      base.swordsman = Math.round(base.swordsman * 1.3);
      base.spearman = Math.round(base.spearman * 1.2);
    }

    const sens = this.model.counterSensitivity ?? 1.0;
    const totalEnemy = Math.max(1, observed.totalCombatUnits | 0);
    if (observed.totalCombatUnits > 0) {
      const cavRatioPermille = Math.round((observed.cavalry * 1000) / totalEnemy);
      if (cavRatioPermille >= 200) {
        base.spearman += Math.round(cavRatioPermille * 0.08 * sens);
      }

      const archerRatioPermille = Math.round((observed.archer * 1000) / totalEnemy);
      if (archerRatioPermille >= 220) {
        base.cavalry += Math.round(archerRatioPermille * 0.07 * sens);
        base.swordsman += Math.round(archerRatioPermille * 0.05 * sens);
      }

      const spearRatioPermille = Math.round((observed.spearman * 1000) / totalEnemy);
      if (spearRatioPermille >= 220) {
        base.archer += Math.round(spearRatioPermille * 0.07 * sens);
        base.swordsman += Math.round(spearRatioPermille * 0.05 * sens);
      }

      const swordRatioPermille = Math.round((observed.swordsman * 1000) / totalEnemy);
      if (swordRatioPermille >= 280) {
        base.archer += Math.round(swordRatioPermille * 0.05 * sens);
        base.cavalry += Math.round(swordRatioPermille * 0.05 * sens);
      }
    }

    if ((observed.towers | 0) > 0) {
      base.siege += Math.round((observed.towers | 0) * 14 * sens);
    }
    if ((observed.ballista | 0) > 0) {
      base.cavalry += Math.round((observed.ballista | 0) * 8 * sens);
    }

    // Probabilistic human-like mistake: occasionally misread counter weights based on difficulty
    const mistakeProb = this.model.mistakeProbPermille | 0;
    if (mistakeProb > 0 && (((Math.imul((gameState.tick | 0) + 17, 2654435761) ^ Math.imul((this.team | 0) + 3, 1013904223)) >>> 0) % 1000) < mistakeProb) {
      const keys = ['swordsman', 'spearman', 'archer', 'cavalry', 'siege'];
      const wrongPick = keys[fxRandomRange(gameState, 0, keys.length - 1)];
      base[wrongPick] = Math.round(base[wrongPick] * 1.45);
    }

    const jitterSpan = this.difficulty === 'easy' ? 4 : 6;
    this.adaptiveWeights.swordsman = Math.max(10, base.swordsman + fxRandomRange(gameState, -jitterSpan, jitterSpan));
    this.adaptiveWeights.spearman = Math.max(10, base.spearman + fxRandomRange(gameState, -jitterSpan, jitterSpan));
    this.adaptiveWeights.archer = Math.max(10, base.archer + fxRandomRange(gameState, -jitterSpan, jitterSpan));
    this.adaptiveWeights.cavalry = Math.max(10, base.cavalry + fxRandomRange(gameState, -jitterSpan, jitterSpan));
    this.adaptiveWeights.siege = Math.max(8, base.siege + fxRandomRange(gameState, -3, 4));
  }

  _handleMatchOutcomeEvolution(gameState) {
    if (this._matchEvolutionEmitted) return;
    const res = gameState.victorySystem?.matchResult;
    if (!res) return;
    if (this.difficulty !== 'learning') return;

    this._matchEvolutionEmitted = true;
    const didWin = gameState.areTeamsAllied
      ? gameState.areTeamsAllied(this.team, res.winningTeam)
      : this.team === res.winningTeam;

    const evolved = this.learningSession.evolveFromOutcome(gameState, didWin, this.doctrine);
    this.model = evolved;
    if (Array.isArray(gameState.pendingEvents)) {
      gameState.pendingEvents.push({
        tick: gameState.tick | 0,
        kind: 'AI_MODEL_LEARNED',
        team: this.team,
        didWin,
        learnedModel: evolved
      });
    }
  }

  /**
   * Evaluates the battlefield and returns an array of standard commands (`{ type, payload }`)
   * for `gameState.processCommands(aiCommands)`.
   */
  generateCommands(gameState) {
    if (!this.enabled || this.difficulty === 'off') return [];
    if (gameState.victorySystem?.matchResult) {
      this._handleMatchOutcomeEvolution(gameState);
      return [];
    }
    if (gameState.victorySystem?.collapseState?.active) return [];

    const tick = gameState.tick | 0;
    if (tick < this._nextThinkTick) return [];

    this._ensureDoctrineSelected(gameState);

    const baseCadence = this.model.reactionCadenceTicks || 20;
    this._nextThinkTick = (tick + baseCadence + fxRandomRange(gameState, 0, 7)) | 0;

    // 1. Update this AI's Fog of War (shared with allies) & gather only visible/explored intelligence
    const intel = this.perception.updatePerception(gameState);

    // 1b. Online mid-game learning when in `learning` mode
    if (this.difficulty === 'learning') {
      const adapted = this.learningSession.stepOnlineLearning(gameState, intel);
      if (adapted) {
        this.model = this.learningSession.model;
        this.economyPlanner.setModel?.(this.model);
        this.tacticalCommander.setModel?.(this.model);
      }
    }

    this._updateAdaptiveCounterWeights(gameState, intel.observedComposition);

    const outCommands = [];

    // 2. Step Economy (assign idle workers to visible/explored trees & mines)
    this.economyPlanner.stepWorkerGathering(gameState, outCommands);

    // 3. Step Base Construction & Repair
    this.economyPlanner.stepBaseConstruction(
      gameState,
      this.doctrine,
      this.adaptiveWeights,
      outCommands
    );

    // 4. Step Unit & Hero Recruitment
    this.economyPlanner.stepUnitAndHeroProduction(
      gameState,
      this.doctrine,
      this.adaptiveWeights,
      outCommands
    );

    // 5. Step Tactical Army Operations
    const combatCompanies = this.tacticalCommander.getCombatCompanies(gameState);
    if (combatCompanies.length > 0) {
      const scoutId = this.tacticalCommander.stepScouting(
        gameState,
        combatCompanies,
        intel.visibleEnemyCompanies,
        outCommands
      );

      this.tacticalCommander.stepFormationAndGaitMicro(
        gameState,
        combatCompanies,
        intel.visibleEnemyCompanies,
        outCommands
      );

      this.tacticalCommander.stepHeroMicro(
        gameState,
        combatCompanies,
        intel.visibleEnemyCompanies,
        outCommands
      );

      const homeBld = this.economyPlanner.findHomeBaseBuilding(gameState);
      this.tacticalCommander.stepTacticalOperations(
        gameState,
        combatCompanies,
        scoutId,
        intel.visibleEnemyCompanies,
        intel.knownEnemyBuildings,
        homeBld,
        outCommands
      );
    }

    return outCommands;
  }
}
