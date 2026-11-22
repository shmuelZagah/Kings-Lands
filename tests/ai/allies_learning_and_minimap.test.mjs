import {
  saveGameSnapshot,
  listSavedGames,
  loadGameSettings,
  saveGameSettings
} from '../../src/core/gameSettingsAndSaves.js';
import { DevConsole } from '../../src/ui/hud/devConsole.js';
import assert from 'node:assert/strict';
import engineConfig from '../../src/data/engineConfig.json';
import { GameState, UnitTypeIndex } from '../../src/sim/gameState.js';
import { FowState } from '../../src/sim/systems/visionSystem.js';
import {
  AI_DIFFICULTY_PROFILES,
  AiLearningSession,
  createDefaultLearnedModel
} from '../../src/sim/ai/aiLearningModel.js';
import { normalizeParticipantTeams } from '../../src/ui/lobby/matchSetupManager.js';
import { MinimapHud } from '../../src/ui/hud/minimapHud.js';

export async function runAlliesLearningAndMinimapTests() {
  // 1. Alliance Normalization: unique simulation team IDs + shared teamNumber alliance
  const parts = [
    { slotIndex: 0, controller: 'player', role: 'player', teamNumber: 1, x: 2048, z: 1650 },
    { slotIndex: 1, controller: 'ai', role: 'ai_ally', teamNumber: 1, x: 2150, z: 1650, aiDifficulty: 'hard' },
    { slotIndex: 2, controller: 'ai', role: 'ai_enemy', teamNumber: 2, x: 2048, z: 2450, aiDifficulty: 'mid' },
    { slotIndex: 3, controller: 'ai', role: 'ai_enemy', teamNumber: 2, x: 2150, z: 2450, aiDifficulty: 'easy' }
  ];
  normalizeParticipantTeams(parts);
  assert.equal(parts[0].team, 1);
  assert.equal(parts[1].team, 2, 'Allied AI must have its own economy/unit team ID');
  assert.equal(parts[1].role, 'ai_ally');
  assert.equal(parts[2].team, 3);
  assert.equal(parts[3].team, 4);

  // 2. Shared Fog of War & Non-Hostile Combat between Allies
  const gs = new GameState({
    ...engineConfig,
    matchSetup: {
      useMatchSetup: true,
      playerTeam: 1,
      isSpectator: false,
      participants: parts
    }
  });

  assert.equal(gs.areTeamsAllied(1, 2), true, 'Team 1 and Team 2 share alliance 1');
  assert.equal(gs.areTeamsEnemy(1, 2), false, 'Allies must never be enemies');
  assert.equal(gs.areTeamsEnemy(1, 3), true, 'Alliance 1 and Alliance 2 must be enemies');
  assert.equal(gs.areTeamsAllied(3, 4), true, 'Team 3 and Team 4 share alliance 2');

  // Spawn an allied AI unit (Team 2) far away in unexplored territory (e.g. 800m, 800m)
  const allyComp = gs.spawnCompany({
    name: 'Allied Scout',
    team: 2,
    unitType: 'cavalry',
    count: 16,
    spawnMetersX: 800,
    spawnMetersZ: 800
  });
  assert.ok(allyComp, 'Allied AI company should spawn');

  // Step ticks so VisionSystem updates
  for (let i = 0; i < 8; i++) gs.stepTick();

  const cx = gs.visionSystem.worldFxToCellX(allyComp.anchorXFx);
  const cz = gs.visionSystem.worldFxToCellZ(allyComp.anchorZFx);
  const cellState = gs.visionSystem.fowGridTeam1[cz * gs.visionSystem.gridSize + cx];
  assert.equal(
    cellState,
    FowState.VISIBLE,
    'Allied AI units must reveal Fog of War for the human player'
  );

  // Verify combat units on Team 1 and Team 2 do NOT attack each other when standing next to each other
  const pComp = gs.spawnCompany({
    name: 'Player Guard',
    team: 1,
    unitType: 'swordsman',
    count: 16,
    spawnMetersX: 805,
    spawnMetersZ: 805
  });
  const allyBeforeHp = Array.from(gs.entities.values())
    .filter((e) => e.team === 2)
    .reduce((s, e) => s + e.hp, 0);
  for (let i = 0; i < 40; i++) gs.stepTick();
  const allyAfterHp = Array.from(gs.entities.values())
    .filter((e) => e.team === 2)
    .reduce((s, e) => s + e.hp, 0);
  assert.equal(allyAfterHp, allyBeforeHp, 'Allied units must never damage each other');
  assert.ok(pComp.memberIds.length === 16);

  // 3. AI vs AI (2v2 Spectator Training Mode)
  const aiVsAiParts = [
    { slotIndex: 0, controller: 'ai', role: 'ai_spectator', teamNumber: 1, x: 2000, z: 1700, aiDifficulty: 'learning' },
    { slotIndex: 1, controller: 'ai', role: 'ai_spectator', teamNumber: 1, x: 2120, z: 1700, aiDifficulty: 'hard' },
    { slotIndex: 2, controller: 'ai', role: 'ai_spectator', teamNumber: 2, x: 2000, z: 2400, aiDifficulty: 'mid' },
    { slotIndex: 3, controller: 'ai', role: 'ai_spectator', teamNumber: 2, x: 2120, z: 2400, aiDifficulty: 'easy' }
  ];
  normalizeParticipantTeams(aiVsAiParts);
  const aiGs = new GameState({
    ...engineConfig,
    matchSetup: {
      useMatchSetup: true,
      playerTeam: 0,
      isSpectator: true,
      participants: aiVsAiParts
    }
  });
  assert.equal(aiGs.aiControllers.length, 4, 'All 4 AI controllers should be active in 2v2 AI vs AI');
  for (let i = 0; i < 120; i++) aiGs.stepTick();
  assert.ok(aiGs.tick === 120, '2v2 AI vs AI simulation should run cleanly');

  // 4. Difficulty Profiles (Easy / Mid / Hard) & Learning Evolution
  assert.ok(AI_DIFFICULTY_PROFILES.hard.reactionCadenceTicks < AI_DIFFICULTY_PROFILES.mid.reactionCadenceTicks);
  assert.ok(AI_DIFFICULTY_PROFILES.mid.reactionCadenceTicks < AI_DIFFICULTY_PROFILES.easy.reactionCadenceTicks);
  assert.ok(AI_DIFFICULTY_PROFILES.hard.counterSensitivity > AI_DIFFICULTY_PROFILES.mid.counterSensitivity);

  const learned = createDefaultLearnedModel();
  const session = new AiLearningSession(2, learned);
  const evolved = session.evolveFromOutcome(aiGs, true, 'RAIDER_CAVALRY');
  assert.equal(evolved.generation, 2);
  assert.equal(evolved.wins, 1);
  assert.ok(evolved.doctrineWeights.RAIDER_CAVALRY > learned.doctrineWeights.RAIDER_CAVALRY);
  const easyInherited = (await import('../../src/sim/ai/aiLearningModel.js')).resolveModelForDifficulty('easy', evolved);
  const hardInherited = (await import('../../src/sim/ai/aiLearningModel.js')).resolveModelForDifficulty('hard', evolved);
  assert.equal(easyInherited.doctrineWeights.RAIDER_CAVALRY, evolved.doctrineWeights.RAIDER_CAVALRY, 'Easy inherits learned doctrine weights');
  assert.equal(hardInherited.doctrineWeights.RAIDER_CAVALRY, evolved.doctrineWeights.RAIDER_CAVALRY, 'Hard inherits learned doctrine weights');
  assert.ok(easyInherited.mistakeProbPermille > hardInherited.mistakeProbPermille, 'Easy has higher mistake probability than Hard');

  // 5. Square Minimap Check
  const mockSimBridge = {
    getEconomyState: () => ({ mines: [], companyStates: {} }),
    getInterpolatedBuildings: () => [],
    getInterpolatedState: () => ({ entities: [] }),
    getFowGrid: () => null,
    isAlliedWithPlayer: (t) => t === 1 || t === 2,
    isEnemyOfPlayer: (t) => t === 3,
    getPlayerTeam: () => 1
  };
  const origCreateEl = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => {
    const el = origCreateEl(tag);
    el.querySelector = (sel) => {
      if (sel === '#phase7-minimap-canvas') return origCreateEl('canvas');
      if (sel.startsWith('#minimap-')) return origCreateEl('button');
      return null;
    };
    return el;
  };
  let minimap;
  try {
    minimap = new MinimapHud({
    simBridge: mockSimBridge,
    cameraController: null,
    formationPreview: null,
    commandBus: { issue() {} },
    eventBus: { on() {}, emit() {} },
    worldSizeMeters: 4096,
    playerTeam: 1
  });
  assert.ok(!minimap.rootEl.className.includes('rounded-[50%]'), 'Minimap must be square, not circular');
  assert.ok(minimap.rootEl.innerHTML.includes('rounded-lg'), 'Minimap canvas container must be square (rounded-lg)');
  } finally {
    globalThis.document.createElement = origCreateEl;
  }


  // 6. Save/Load Player vs Dev Separation + GameState Save/Restore + DevConsole Mode Gating
  const snap = gs.exportSaveState();
  assert.ok(snap && snap.buildings.length > 0 && snap.companies.length > 0, 'GameState should export save snapshot');
  saveGameSnapshot('player', { id: 'p1', name: 'Player Save', mapName: 'Royal Valley', tick: snap.tick, simSnapshot: snap });
  saveGameSnapshot('dev', { id: 'd1', name: 'Dev Save', mapName: 'Royal Valley', tick: snap.tick, simSnapshot: snap });
  assert.equal(listSavedGames('player').length, 1);
  assert.equal(listSavedGames('dev').length, 1);
  assert.equal(listSavedGames('player')[0].name, 'Player Save');
  assert.equal(listSavedGames('dev')[0].name, 'Dev Save');

  const restoredGs = new GameState({ ...engineConfig, loadedSaveState: snap });
  assert.equal(restoredGs.tick, snap.tick, 'Restored GameState should preserve tick');

  saveGameSettings({ masterVolume: 55, shadows: false });
  const loadedSettings = loadGameSettings();
  assert.equal(loadedSettings.masterVolume, 55);
  assert.equal(loadedSettings.shadows, false);

  const playerDc = new DevConsole({ commandBus: { issue() {} }, enabled: false });
  playerDc.open(true);
  assert.equal(playerDc.isOpen, false, 'DevConsole must stay closed in Standard Player mode');

  return 'PASS: Allies, 2v2 AI vs AI, Easy/Mid/Hard/Learning, Square Minimap, Save/Load & Player/Dev Gating';

}
