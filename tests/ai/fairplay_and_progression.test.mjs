import assert from 'assert';
import fs from 'fs';
import { GameState } from '../../src/sim/gameState.js';
import { CommandTypes } from '../../src/core/commandBus.js';

export async function runAiTests() {
  const config = JSON.parse(fs.readFileSync(new URL('../../src/data/engineConfig.json', import.meta.url), 'utf8'));
  const gs = new GameState(config);

  const placedTypes = [];
  const origProcess = gs.processCommands.bind(gs);
  gs.processCommands = (cmds) => {
    for (const c of cmds) {
      if (c.type === 'PLACE_BUILDING') placedTypes.push(c.payload.buildingType);
    }
    return origProcess(cmds);
  };

  for (let t = 0; t < 2600; t++) {
    gs.stepTick([]);
  }

  assert.ok(placedTypes.includes('house'), 'AI must place Houses');
  assert.ok(placedTypes.includes('barracks'), 'AI must place a Barracks');
  const completedTeam2 = Array.from(gs.constructionSystem.buildings.values()).filter(
    (b) => b.team === 2 && b.isCompleted && (b.type === 'house' || b.type === 'barracks')
  );
  assert.ok(completedTeam2.length >= 2, 'AI worker must complete its House and Barracks without ping-ponging');

  // Edge Cases: AI counter-siege adaptation vs Watchtowers & anti-ballista Cavalry flank boost
  gs.enemyAi._updateAdaptiveCounterWeights(gs, {
    swordsman: 10,
    spearman: 10,
    archer: 10,
    cavalry: 0,
    hero: 0,
    ballista: 6,
    towers: 3,
    totalCombatUnits: 36
  });
  assert.ok(gs.enemyAi.adaptiveWeights.siege >= 40, 'AI must boost siege (ballista) weight when player builds Watchtowers');
  assert.ok(gs.enemyAi.adaptiveWeights.cavalry >= 45, 'AI must boost cavalry weight to flank enemy ballistas');

  // Test '/ai off' and '/ai adaptive' via DEV_CHEAT
  gs.processCommands([{ type: CommandTypes.DEV_CHEAT, payload: { team: 1, code: '/ai off' } }]);
  assert.strictEqual(gs.enemyAi.enabled, false, '/ai off must pause AI');
  assert.strictEqual(gs.enemyAi.generateCommands(gs).length, 0, 'Paused AI must emit 0 commands');
  gs.processCommands([{ type: CommandTypes.DEV_CHEAT, payload: { team: 1, code: '/ai adaptive' } }]);
  assert.strictEqual(gs.enemyAi.enabled, true, '/ai adaptive must resume AI');

  return `PASS: Smart Enemy AI Fair-Play, Counter-Siege Learning & Base Progression (completed: ${completedTeam2.map((b) => b.type).join(', ')})`;
}
