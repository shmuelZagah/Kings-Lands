import assert from 'assert';
import { readEngineConfig } from '../helpers/loadData.mjs';
import fs from 'fs';
import { GameState } from '../../src/sim/gameState.js';
import { FX_ONE } from '../../src/core/fx.js';

export async function runEconomyTests() {
  const config = readEngineConfig();
  const gs = new GameState(config);
  gs.enemyAi.setMode('off');

  // 1. Build an instant Barracks for Team 1 (Team 1 starts at 81/100 pop; queueing a 20-man swordsman squad requires 101 > 100 popCap!)
  const barracks = gs.constructionSystem.createBuilding({
    type: 'barracks',
    team: 1,
    xFx: 2010 * FX_ONE,
    zFx: 1650 * FX_ONE,
    instantComplete: true,
    bypassValidation: true,
    gameState: gs
  });
  gs.economySystem.addResource(1, 'coins', 5000);
  gs.economySystem.addResource(1, 'wood', 5000);
  gs.economySystem.addResource(1, 'stone', 5000);
  gs.economySystem.addResource(1, 'iron', 5000);

  const queued = gs.constructionSystem.productionSystem.queueProductionOption(barracks.id, 'swordsman', 1);
  assert.strictEqual(queued, true, 'Should queue swordsman at barracks');

  for (let i = 0; i < 350; i++) gs.stepTick([]);
  assert.strictEqual(barracks.isPopHold, true, 'Barracks must hold at 99% (isPopHold=true) when 81 + 20 > 100 popCap');
  assert.strictEqual(barracks.productionQueue.length, 1, 'Squad must remain in queue while held at 99%');

  // 2. Complete a House (+20 popCap -> 120) and verify immediate release on next tick
  gs.constructionSystem.createBuilding({
    type: 'house',
    team: 1,
    xFx: 1980 * FX_ONE,
    zFx: 1650 * FX_ONE,
    instantComplete: true,
    bypassValidation: true,
    gameState: gs
  });
  gs.stepTick([]);
  assert.strictEqual(barracks.isPopHold, false, 'Barracks must release isPopHold as soon as House completes');
  assert.strictEqual(barracks.productionQueue.length, 0, 'Held squad must spawn once popCap increases');

  // 3. Siege Works Ballista Recruitment (3-engine battery, popCost = 3)
  const siegeWorks = gs.constructionSystem.createBuilding({
    type: 'siege_works',
    team: 1,
    xFx: 1950 * FX_ONE,
    zFx: 1650 * FX_ONE,
    instantComplete: true,
    bypassValidation: true,
    gameState: gs
  });
  const queuedBallista = gs.constructionSystem.productionSystem.queueProductionOption(siegeWorks.id, 'ballista', 1);
  assert.strictEqual(queuedBallista, true, 'Should queue ballista at siege_works');
  assert.strictEqual(siegeWorks.productionQueue[0].unitType, 'ballista', 'ballista option must produce unitType=ballista');
  for (let i = 0; i < 185; i++) gs.stepTick([]);
  const spawnedBallista = Array.from(gs.companies.values()).find((c) => c.team === 1 && c.unitType === 'ballista');
  assert.ok(spawnedBallista && spawnedBallista.memberIds.length === 3, 'Siege Works must spawn a 3-engine Field Ballista battery');

  return 'PASS: Economy, Siege Works Ballista Recruitment & Deterministic 99% PopCap Hold/Release';
}
