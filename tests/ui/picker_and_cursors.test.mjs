import assert from 'assert';
import { readEngineConfig } from '../helpers/loadData.mjs';
import fs from 'fs';
import * as THREE from 'three';
import { WorldPicker } from '../../src/ui/input/worldPicker.js';
import { RtsCursorTypes, RtsCursorManager } from '../../src/ui/hud/cursorSystem.js';
import { DEV_CONSOLE_COMMANDS } from '../../src/ui/hud/devConsole.js';
import { CommandTypes } from '../../src/core/commandBus.js';
import { GameState } from '../../src/sim/gameState.js';

export async function runUiTests() {
  const origProject = THREE.Vector3.prototype.project;
  THREE.Vector3.prototype.project = function () {
    this.x = (this.x - 2000) * 0.05;
    this.y = (this.y - 1.0) * 0.05;
    this.z = 0.5;
    return this;
  };

  const domMock = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  const wp = new WorldPicker({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    domElement: domMock,
    simBridge: {
      getInterpolatedState: () => ({
        entities: [
          { id: 1, team: 1, hp: 100, x: 2000, y: 0, z: 1700, unitTypeIdx: 1, companyId: 1, isGarrisoned: false },
          { id: 2, team: 2, hp: 100, x: 2000, y: 0, z: 1700, unitTypeIdx: 5, companyId: 9, carryType: 3, isGarrisoned: false }
        ]
      }),
      getFowGrid: () => null
    },
    terrainRenderer: { worldSize: 4096 }
  });

  // Click near feet (y=0.2) and near head (y=1.9) of unit 1
  const hitFeet = wp.findNearestUnitOnScreen(640, 374, 1, 26);
  const hitHead = wp.findNearestUnitOnScreen(640, 344, 1, 26);
  assert.strictEqual(hitFeet?.id, 1, 'Should pick unit at feet');
  assert.strictEqual(hitHead?.id, 1, 'Should pick unit at head');

  // Click at mounted hero head height (y=3.4)
  const hitMountedHead = wp.findEnemyUnitOnScreen(640, 318, 36);
  assert.strictEqual(hitMountedHead?.id, 2, 'Should pick mounted hero at 3.4m head height');

  THREE.Vector3.prototype.project = origProject;

  const cm = new RtsCursorManager({ domElement: domMock, container: domMock, worldPicker: wp, simBridge: {} });
  cm.setCursor(RtsCursorTypes.ATTACK_ENEMY);
  assert.ok(domMock.style.cursor.includes('3 3'), 'Attack enemy sword cursor must use calibrated [3, 3] tip hotspot');

  // Verify '/' DevConsole Command Menu Registry & Slash Command Execution
  assert.ok(Array.isArray(DEV_CONSOLE_COMMANDS) && DEV_CONSOLE_COMMANDS.length >= 12, 'DEV_CONSOLE_COMMANDS must list all console cheat codes');
  for (const rc of ['c', 'q', 'lv', 'ballista', 'd', 'ai adaptive', 'ai hard', 'ai normal', 'ai easy', 'ai off', 'laststand', 'panic', 'win', 'lose']) {
    assert.ok(DEV_CONSOLE_COMMANDS.some((item) => item.code === rc), `DEV_CONSOLE_COMMANDS must include '${rc}'`);
  }

  const config = readEngineConfig();
  const gs = new GameState(config);
  const compsBefore = gs.companies.size;
  gs.processCommands([
    { type: CommandTypes.DEV_CHEAT, payload: { team: 1, code: '/ballista' } },
    { type: CommandTypes.DEV_CHEAT, payload: { team: 1, code: '/c' } }
  ]);
  assert.strictEqual(gs.companies.size, compsBefore + 1, '/ballista console command must spawn a Field Ballista battery');
  assert.strictEqual(gs.visionSystem.revealAllCheat, true, '/c console command must toggle revealAllCheat');

  return `PASS: WorldPicker 3D Bounding Box, SVG Cursor Hotspots & '/' DevConsole (${DEV_CONSOLE_COMMANDS.length} codes)`;
}
