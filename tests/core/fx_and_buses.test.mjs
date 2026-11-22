import assert from 'assert';
import fs from 'fs';
import { FX_ONE, ANGLE_STEPS, mulDiv, isqrt, fxSin, fxCos, fxAtan2, fxHypot, fxClamp, fxRandomRange } from '../../src/core/fx.js';
import { CommandBus, CommandTypes } from '../../src/core/commandBus.js';
import { EventBus, EventTypes } from '../../src/core/eventBus.js';
import { GameState } from '../../src/sim/gameState.js';

export async function runCoreTests() {
  assert.strictEqual(FX_ONE, 1024, 'FX_ONE must be 1024');
  assert.strictEqual(ANGLE_STEPS, 1024, 'ANGLE_STEPS must be 1024');
  assert.strictEqual(fxCos(0), 1024);
  assert.strictEqual(fxSin(256), 1024);
  assert.strictEqual(fxHypot(3072, 4096), 5120);
  assert.strictEqual(mulDiv(1000, 1450, 1000), 1450);
  assert.strictEqual(fxClamp(500, 0, 300), 300);

  // Edge Cases: Zero, negative, and boundary math
  assert.strictEqual(fxHypot(0, 0), 0, 'fxHypot(0, 0) must be 0');
  assert.strictEqual(isqrt(0), 0, 'isqrt(0) must be 0');
  assert.strictEqual(isqrt(-50), 0, 'isqrt(negative) must safely clamp to 0');
  assert.strictEqual(mulDiv(0, 999999, 1024), 0, 'mulDiv(0, ...) must be 0');
  assert.strictEqual(fxRandomRange({ rngState: 42 }, 7, 7), 7, 'fxRandomRange(min===max) must return min');

  const angle = fxAtan2(1024, 0);
  assert.ok(Math.abs(angle - 256) <= 2, 'fxAtan2(1024, 0) should be ~256');

  const rngStateA = { rngState: 133742069 };
  const rngStateB = { rngState: 133742069 };
  for (let i = 0; i < 20; i++) {
    assert.strictEqual(fxRandomRange(rngStateA, 10, 99), fxRandomRange(rngStateB, 10, 99));
  }

  // Edge Cases: Out-of-bounds world coordinates in NavGrid and SpatialHash
  const config = JSON.parse(fs.readFileSync(new URL('../../src/data/engineConfig.json', import.meta.url), 'utf8'));
  const gs = new GameState(config);
  assert.strictEqual(gs.navGrid.isWalkableWorldFx(-50000, -50000), false, 'Negative OOB coords must not be walkable');
  assert.strictEqual(gs.navGrid.isWalkableWorldFx(gs.worldSizeFx + 50000, gs.worldSizeFx + 50000), false, 'Overflow OOB coords must not be walkable');
  assert.ok(gs.navGrid.worldFxToTileX(-999999) >= 0 && gs.navGrid.worldFxToTileX(999999999) < gs.tilesX, 'Tile clamping must hold on extreme coords');
  assert.ok(Array.isArray(gs.spatialHash.queryRadiusIds(-999999, -999999, 5 * FX_ONE, gs.entities)), 'SpatialHash OOB query must not throw');

  let received = null;
  const cBus = new CommandBus();
  cBus.setTransport((cmds) => { received = cmds; });
  cBus.issue(CommandTypes.STOP_COMPANIES, { team: 1, companyIds: [1] });
  assert.strictEqual(received?.length, 1);

  let evtPayload = null;
  const eBus = new EventBus();
  const unsub = eBus.on(EventTypes.SELECTION_CHANGED, (p) => { evtPayload = p; });
  eBus.emit(EventTypes.SELECTION_CHANGED, { count: 3 });
  assert.strictEqual(evtPayload?.count, 3);
  unsub();

  return 'PASS: Core FX Math, PRNG, CommandBus, EventBus & Out-of-Bounds Edge Cases';
}
