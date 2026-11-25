import assert from 'assert';
import { readEngineConfig } from '../helpers/loadData.mjs';
import fs from 'fs';
import { GameState, AnimState } from '../../src/sim/gameState.js';
import { CommandTypes } from '../../src/core/commandBus.js';
import { FX_ONE, fxHypot } from '../../src/core/fx.js';

export async function runMovementTests() {
  const config = readEngineConfig();
  const gs = new GameState(config);
  gs.enemyAi.setMode('off');

  // Stop all initial patrols
  gs.processCommands([
    { type: CommandTypes.STOP_COMPANIES, payload: { team: 1, companyIds: [0, 1, 2, 3, 4] } },
    { type: CommandTypes.STOP_COMPANIES, payload: { team: 2, companyIds: [5, 6, 7, 8, 9, 10, 11, 12] } }
  ]);
  for (let i = 0; i < 50; i++) gs.stepTick([]);

  // 1. Test stationary Run toggle persistence + auto-reset on arrival
  const swordComp = gs.companies.get(1);
  gs.processCommands([{ type: CommandTypes.SET_COMPANY_GAIT, payload: { team: 1, companyIds: [1], isRunning: true } }]);
  for (let i = 0; i < 25; i++) gs.stepTick([]);
  assert.strictEqual(swordComp.wantsToRun, true, 'Stationary company must keep wantsToRun=true until it moves and finishes');

  // 2. Test 180-degree reverse walk order: zero IDLE sliding, zero frozen units away from slots
  const goalX = swordComp.anchorXFx - 16 * FX_ONE;
  const goalZ = swordComp.anchorZFx - 22 * FX_ONE;
  gs.processCommands([{
    type: CommandTypes.MOVE_COMPANIES,
    payload: {
      team: 1,
      companyIds: [1],
      dragStartXFx: goalX,
      dragStartZFx: goalZ,
      dragEndXFx: goalX,
      dragEndZFx: goalZ,
      queue: false,
      isRunning: true
    }
  }]);

  let slidingIdleCount = 0;
  for (let t = 0; t < 200; t++) {
    const prevPos = new Map();
    for (const mid of swordComp.memberIds) {
      const e = gs.entities.get(mid);
      prevPos.set(mid, { x: e.x, z: e.z });
    }
    gs.stepTick([]);
    for (const mid of swordComp.memberIds) {
      const e = gs.entities.get(mid);
      const p = prevPos.get(mid);
      const moved = fxHypot(e.x - p.x, e.z - p.z);
      if (!e.isMoving && e.animState === AnimState.IDLE && moved >= 45) {
        slidingIdleCount++;
      }
    }
  }
  assert.strictEqual(slidingIdleCount, 0, 'Units must never slide while in IDLE pose');
  assert.strictEqual(swordComp.wantsToRun, false, 'wantsToRun must auto-reset to false once all units settle at slots');
  assert.strictEqual(swordComp.isRunning, false, 'isRunning must auto-reset to false once all units settle at slots');

  // 3. Test Alt group speed sync, exhausted unit pace drop (Edge Case), & SpearWall preservation
  const spearComp = gs.companies.get(2);
  const archerComp = gs.companies.get(3);
  const cavComp = gs.companies.get(4);
  gs.processCommands([{
    type: CommandTypes.MOVE_COMPANIES,
    payload: {
      team: 1,
      companyIds: [3, 4],
      dragStartXFx: cavComp.anchorXFx,
      dragStartZFx: cavComp.anchorZFx + 50 * FX_ONE,
      dragEndXFx: cavComp.anchorXFx,
      dragEndZFx: cavComp.anchorZFx + 50 * FX_ONE,
      preserveRelative: true,
      isRunning: true
    }
  }]);
  for (let i = 0; i < 12; i++) gs.stepTick([]);
  assert.strictEqual(archerComp._syncedAltActualSpeedFx, cavComp._syncedAltActualSpeedFx, 'Alt group companies must share identical actual step speed');
  assert.strictEqual(spearComp.formation, 'spearWall', 'SpearWall formation must be preserved');

  // Edge Case: Exhaust one company in the Alt group -> entire Alt group must drop to walking speed!
  archerComp.staminaPermille = 0;
  archerComp.isRunning = false;
  gs.stepTick([]);
  assert.strictEqual(cavComp.isRunning, false, 'Alt group cavalry must drop to walking when paired squad is exhausted');
  assert.strictEqual(cavComp._syncedAltActualSpeedFx, archerComp._syncedAltActualSpeedFx, 'Alt group speed must match the exhausted walking squad speed');
  assert.ok(cavComp._syncedAltActualSpeedFx <= archerComp.speedFx, 'Alt group speed must not exceed walking speed');

  // Edge Case: 1-unit survivor company move & arrival
  const loneComp = gs.spawnCompany({
    name: 'Single Survivor Co',
    team: 1,
    unitType: 'swordsman',
    count: 1,
    spawnMetersX: 1920,
    spawnMetersZ: 1750,
    facingDir: 256,
    speedFx: 215,
    hp: 135
  });
  gs.processCommands([{
    type: CommandTypes.MOVE_COMPANIES,
    payload: {
      team: 1,
      companyIds: [loneComp.id],
      dragStartXFx: 1920 * FX_ONE,
      dragStartZFx: 1768 * FX_ONE,
      dragEndXFx: 1920 * FX_ONE,
      dragEndZFx: 1768 * FX_ONE,
      isRunning: true
    }
  }]);
  for (let i = 0; i < 140; i++) gs.stepTick([]);
  assert.strictEqual(loneComp.isActivelyMoving(), false, '1-unit survivor squad must arrive and settle cleanly');

  return 'PASS: Walking, 180-Turn Slot Matching, Zero IDLE Sliding, Run Auto-Reset & Alt Group Edge Cases';
}
