/**
 * Kings Lands — Adaptive & Persistent AI Learning Model (`src/sim/ai/aiLearningModel.js`)
 *
 * Provides:
 * 1. Calibrated & Pre-Trained Difficulty Profiles (`easy`, `mid`/`normal`, `hard`).
 * 2. `learning` (`adaptive`) mode:
 *    - Online mid-game reinforcement: evaluates economy + combat trade fitness every ~200 ticks
 *      and dynamically shifts counter-sensitivity, expansion aggression, attack thresholds,
 *      tower defense, and unit preferences.
 *    - Cross-game persistent evolution: updates policy weights & doctrine win-rates after every
 *      match (including AI vs AI training matches) and persists via `localStorage` / JSON.
 */

import { fxRandomRange } from '../../core/fx.js';

export const AI_LEARNED_MODEL_STORAGE_KEY = 'kings_lands_ai_learned_model_v1';

export const AI_DIFFICULTY_PROFILES = Object.freeze({
  easy: Object.freeze({
    difficulty: 'easy',
    reactionCadenceTicks: 34,
    counterSensitivity: 0.35,
    targetWorkers: 2,
    expansionAggression: 0.5,
    towerDefenseBias: 0.3,
    heroPriority: 0.4,
    attackThresholdSquads: 5,
    flankAndScoutBias: 0.35,
    spellAggression: 0.35,
    explorationRatePermille: 160,
    mistakeProbPermille: 280, // ~28% chance of suboptimal decision
    unitWeights: { swordsman: 30, spearman: 25, archer: 26, cavalry: 20, siege: 10 },
    doctrineWeights: {
      BALANCED_COMMANDER: 30,
      RAIDER_CAVALRY: 24,
      RANGER_SIEGE: 23,
      IRON_VANGUARD: 23
    }
  }),
  mid: Object.freeze({
    difficulty: 'mid',
    reactionCadenceTicks: 22,
    counterSensitivity: 0.82,
    targetWorkers: 3,
    expansionAggression: 0.8,
    towerDefenseBias: 0.58,
    heroPriority: 0.72,
    attackThresholdSquads: 4,
    flankAndScoutBias: 0.75,
    spellAggression: 0.7,
    explorationRatePermille: 180,
    mistakeProbPermille: 120, // ~12% chance of suboptimal decision
    unitWeights: { swordsman: 28, spearman: 26, archer: 28, cavalry: 24, siege: 14 },
    doctrineWeights: {
      BALANCED_COMMANDER: 28,
      RAIDER_CAVALRY: 25,
      RANGER_SIEGE: 24,
      IRON_VANGUARD: 23
    }
  }),
  hard: Object.freeze({
    difficulty: 'hard',
    reactionCadenceTicks: 13,
    counterSensitivity: 1.42,
    targetWorkers: 4,
    expansionAggression: 1.15,
    towerDefenseBias: 0.85,
    heroPriority: 1.0,
    attackThresholdSquads: 3,
    flankAndScoutBias: 1.25,
    spellAggression: 1.1,
    explorationRatePermille: 200,
    mistakeProbPermille: 30, // ~3% chance of human-like slip
    unitWeights: { swordsman: 26, spearman: 28, archer: 29, cavalry: 27, siege: 18 },
    doctrineWeights: {
      BALANCED_COMMANDER: 24,
      RAIDER_CAVALRY: 28,
      RANGER_SIEGE: 26,
      IRON_VANGUARD: 22
    }
  })
});

export function normalizeDifficultyKey(raw) {
  const m = String(raw || '').trim().toLowerCase();
  if (m === 'easy') return 'easy';
  if (m === 'normal') return 'normal';
  if (m === 'mid' || m === 'medium') return 'mid';
  if (m === 'hard') return 'hard';
  if (m === 'learning' || m === 'adaptive' || m === 'train') return 'learning';
  return 'learning';
}

export function cloneAiModel(model) {
  return JSON.parse(JSON.stringify(model));
}

export function createDefaultLearnedModel() {
  const base = cloneAiModel(AI_DIFFICULTY_PROFILES.hard);
  base.difficulty = 'learning';
  base.generation = 1;
  base.gamesPlayed = 0;
  base.wins = 0;
  base.losses = 0;
  base.explorationRatePermille = 260;
  return base;
}

export function loadLearnedAiModel() {
  try {
    const raw = globalThis.localStorage?.getItem(AI_LEARNED_MODEL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.unitWeights && parsed.doctrineWeights) {
        return {
          ...createDefaultLearnedModel(),
          ...parsed,
          unitWeights: { ...createDefaultLearnedModel().unitWeights, ...parsed.unitWeights },
          doctrineWeights: { ...createDefaultLearnedModel().doctrineWeights, ...parsed.doctrineWeights }
        };
      }
    }
  } catch (_) {}
  return createDefaultLearnedModel();
}

export function saveLearnedAiModel(model) {
  if (!model || typeof model !== 'object') return;
  try {
    globalThis.localStorage?.setItem(AI_LEARNED_MODEL_STORAGE_KEY, JSON.stringify(model));
  } catch (_) {}
}

export function resolveModelForDifficulty(difficulty, learnedModel = null) {
  const key = normalizeDifficultyKey(difficulty);
  if (key === 'learning') {
    if (learnedModel && typeof learnedModel === 'object' && learnedModel.unitWeights) {
      const cloned = cloneAiModel(learnedModel);
      cloned.difficulty = 'learning';
      cloned.mistakeProbPermille = cloned.mistakeProbPermille ?? 40;
      return cloned;
    }
    const def = createDefaultLearnedModel();
    def.mistakeProbPermille = 40;
    return def;
  }

  const profileKey = (key === 'mid' || key === 'normal') ? 'mid' : key === 'easy' ? 'easy' : 'hard';
  const limits = cloneAiModel(AI_DIFFICULTY_PROFILES[profileKey]);
  // All difficulties inherit the trained brain's learned strategy weights,
  // while keeping their own reaction limits, caps, and mistake probability!
  if (learnedModel && typeof learnedModel === 'object' && learnedModel.unitWeights) {
    limits.unitWeights = { ...limits.unitWeights, ...learnedModel.unitWeights };
    if (learnedModel.doctrineWeights) {
      limits.doctrineWeights = { ...limits.doctrineWeights, ...learnedModel.doctrineWeights };
    }
    limits.gamesPlayed = learnedModel.gamesPlayed | 0;
    limits.generation = learnedModel.generation | 0;
  }
  limits.difficulty = key;
  return limits;
}

function clamp(v, minV, maxV) {
  return Math.max(minV, Math.min(maxV, v));
}

/**
 * Tracks live battlefield fitness for an AI team and performs online mid-game adaptation
 * as well as end-of-match policy evolution.
 */
export class AiLearningSession {
  constructor(team, model) {
    this.team = team | 0;
    this.model = model;
    this.lastEvalTick = -999;
    this.prevFitness = null;
    this.lastDoctrine = null;
    this.adaptationCount = 0;
    this.initialUnitsKilled = 0;
    this.history = [];
  }

  computeTeamFitness(gameState) {
    const eco = gameState.economySystem;
    const cs = gameState.constructionSystem;
    const ledger = eco?.getTeamLedger?.(this.team);

    let ecoScore = 0;
    if (ledger) {
      ecoScore += (ledger.coins | 0) * 0.15 + (ledger.wood | 0) * 0.12 + (ledger.iron | 0) * 0.2 + (ledger.stone | 0) * 0.1;
    }

    let ownBuildings = 0;
    let enemyBuildings = 0;
    if (cs?.buildings) {
      for (const b of cs.buildings.values()) {
        if (!b || b.isDestroyed || b.hp <= 0 || b.type === 'citadel_slot') continue;
        const val = b.type === 'citadel' ? 400 : b.isCompleted ? 120 : 50;
        if (b.team === this.team) ownBuildings += val;
        else if (gameState.areTeamsEnemy?.(b.team, this.team)) enemyBuildings += val;
      }
    }

    let ownArmy = 0;
    let enemyArmy = 0;
    for (const ent of gameState.entities.values()) {
      if (!ent || ent.hp <= 0) continue;
      const val = ent.unitTypeIdx === 0 ? 15 : ent.isHero ? 140 : ent.unitTypeIdx === 6 ? 90 : 35;
      if (ent.team === this.team) ownArmy += val;
      else if (gameState.areTeamsEnemy?.(ent.team, this.team)) enemyArmy += val;
    }

    return ecoScore + ownBuildings + ownArmy * 1.4 - enemyArmy * 0.8 - enemyBuildings * 0.4;
  }

  /**
   * Called periodically (~every 200 ticks) when in `learning` mode.
   * Shifts policy parameters if the AI is losing trades or falling behind.
   */
  stepOnlineLearning(gameState, intel) {
    const tick = gameState.tick | 0;
    if (tick - this.lastEvalTick < 200) return false;
    this.lastEvalTick = tick;

    const fitness = this.computeTeamFitness(gameState);
    if (this.prevFitness === null) {
      this.prevFitness = fitness;
      return false;
    }

    const delta = fitness - this.prevFitness;
    this.prevFitness = fitness;
    this.history.push({ tick, fitness, delta });

    // If losing momentum (delta < -60), adapt strategy mid-game!
    if (delta < -60) {
      this.adaptationCount++;
      this.model.counterSensitivity = clamp(Number((this.model.counterSensitivity + 0.08).toFixed(2)), 0.4, 2.0);
      this.model.towerDefenseBias = clamp(Number((this.model.towerDefenseBias + 0.07).toFixed(2)), 0.2, 1.3);
      this.model.expansionAggression = clamp(Number((this.model.expansionAggression + 0.05).toFixed(2)), 0.4, 1.5);

      const obs = intel?.observedComposition;
      if (obs && (obs.totalCombatUnits | 0) > 0) {
        if ((obs.cavalry | 0) > (obs.spearman | 0)) {
          this.model.unitWeights.spearman = clamp((this.model.unitWeights.spearman | 0) + 4, 12, 60);
        }
        if ((obs.archer | 0) > 2) {
          this.model.unitWeights.cavalry = clamp((this.model.unitWeights.cavalry | 0) + 4, 12, 60);
        }
        if ((obs.towers | 0) > 0) {
          this.model.unitWeights.siege = clamp((this.model.unitWeights.siege | 0) + 3, 8, 45);
        }
      }
      return true;
    } else if (delta > 120) {
      // Reward current aggression slightly
      this.model.flankAndScoutBias = clamp(Number((this.model.flankAndScoutBias + 0.04).toFixed(2)), 0.4, 1.5);
    }
    return false;
  }

  /**
   * Updates persistent model weights at the end of a match (or training episode)
   * based on whether this AI's alliance won or lost, plus small bounded exploration.
   */
  evolveFromOutcome(gameState, didWin, doctrineUsed) {
    const m = cloneAiModel(this.model);
    m.difficulty = 'learning';
    m.generation = (m.generation | 0) + 1;
    m.gamesPlayed = (m.gamesPlayed | 0) + 1;
    if (didWin) m.wins = (m.wins | 0) + 1;
    else m.losses = (m.losses | 0) + 1;

    const lr = didWin ? 1 : -1;

    if (doctrineUsed && m.doctrineWeights && m.doctrineWeights[doctrineUsed] !== undefined) {
      m.doctrineWeights[doctrineUsed] = clamp((m.doctrineWeights[doctrineUsed] | 0) + lr * 4, 10, 60);
    }

    // Nudge parameters based on outcome + small deterministic exploration
    const jitter = (span) => fxRandomRange(gameState, -span, span);

    m.targetWorkers = clamp((m.targetWorkers | 0) + (didWin ? 0 : 1), 2, 5);
    m.counterSensitivity = clamp(
      Number((m.counterSensitivity + (didWin ? 0.04 : 0.08) + jitter(4) * 0.01).toFixed(2)),
      0.5,
      1.9
    );
    m.expansionAggression = clamp(
      Number((m.expansionAggression + (didWin ? 0.03 : 0.05) + jitter(4) * 0.01).toFixed(2)),
      0.5,
      1.5
    );
    m.attackThresholdSquads = clamp(
      (m.attackThresholdSquads | 0) + (didWin ? 0 : jitter(1)),
      2,
      6
    );
    m.flankAndScoutBias = clamp(
      Number((m.flankAndScoutBias + (didWin ? 0.04 : 0.06) + jitter(4) * 0.01).toFixed(2)),
      0.4,
      1.5
    );
    m.spellAggression = clamp(
      Number((m.spellAggression + (didWin ? 0.03 : 0.05)).toFixed(2)),
      0.4,
      1.4
    );

    // Decay exploration slightly as games increase, never below 120 permille (12%) so it stays non-repetitive
    m.explorationRatePermille = clamp(Math.max(120, (m.explorationRatePermille | 0) - 5), 120, 300);

    for (const k of Object.keys(m.unitWeights)) {
      m.unitWeights[k] = clamp((m.unitWeights[k] | 0) + jitter(2), 10, 55);
    }

    this.model = m;
    return m;
  }
}
