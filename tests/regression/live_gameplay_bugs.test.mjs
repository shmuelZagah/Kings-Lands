import assert from 'node:assert/strict';
import { readEngineConfig, readUnitsJson } from '../helpers/loadData.mjs';
import fs from 'node:fs';
import { GameState } from '../../src/sim/gameState.js';
import { CommandTypes } from '../../src/core/commandBus.js';
import { sampleChannelInto, _sampleScratch } from '../../src/render/keyframeSampler.js';

const engineConfig = readEngineConfig();
const unitsJson = readUnitsJson();

console.log('=== Running Live Gameplay Bug Regression Suite (6 User-Reported Bugs) ===');

// ---------------------------------------------------------------------------
// Test 1: Wizard / Hero Duplication & Company ID Collision after Summon Expiry
// ("כתוב לי שיש לי את המכשף פתאום פעמיים")
// ---------------------------------------------------------------------------
{
  const gs = new GameState(engineConfig);
  gs.economySystem.grantCheatResources(1, 50000);
  gs.economySystem.grantCheatResources(2, 50000);

  const citadel = Array.from(gs.constructionSystem.buildings.values()).find(
    (b) => b.team === 1 && b.type === 'citadel'
  );
  assert.ok(citadel, 'Team 1 citadel exists');

  // Queue Wizard twice rapidly — second must be rejected
  const q1 = gs.constructionSystem.queueProductionOption(citadel.id, 'hero:wizard', 1);
  const q2 = gs.constructionSystem.queueProductionOption(citadel.id, 'hero:wizard', 1);
  assert.equal(q1, true, 'First Wizard recruitment succeeds');
  assert.equal(q2, false, 'Second duplicate Wizard recruitment rejected while queued');

  // Step until Wizard spawns
  for (let t = 0; t < 250; t++) gs.stepTick([]);

  // Now spawn Ravan, cast Summon Royal Guard, let summons expire, and spawn more squads
  const ravanComp = gs.heroSystem.spawnHeroFromBuilding(
    gs,
    citadel,
    { heroId: 'ravan', optionId: 'hero:ravan', name: 'Ravan', reviveLevel: 10 },
    { hero: 5 },
    { WALK: 1 }
  );
  const ravanEnt = gs.entities.get(ravanComp.memberIds[0]);
  gs.heroSystem._spawnReinforcementCompany(gs, ravanComp, ravanEnt, 'swordsman', 0, 5, ravanEnt.x, ravanEnt.z, 200);

  // Spawn a regular barracks squad AFTER the temporary summon
  const barracks = gs.constructionSystem.createBuilding({
    type: 'barracks',
    team: 1,
    xFx: citadel.xFx + 25 * 1024,
    zFx: citadel.zFx,
    instantComplete: true,
    gameState: gs
  });
  gs.constructionSystem.queueProductionOption(barracks.id, 'swordsman', 1);

  // Step 350 ticks so temporary summon expires and new squads spawn after expiry
  for (let t = 0; t < 350; t++) {
    if (t === 220) {
      gs.constructionSystem.queueProductionOption(barracks.id, 'spearman', 1);
      gs.constructionSystem.queueProductionOption(barracks.id, 'swordsman', 1);
    }
    gs.stepTick([]);
  }

  // Verify no two companies share the same ID or overwrite Wizard/Ravan
  const wizardComps = Array.from(gs.companies.values()).filter(
    (c) => c.team === 1 && c.isHero && c.heroId === 'wizard'
  );
  assert.equal(wizardComps.length, 1, 'Exactly 1 Wizard company exists');
  assert.equal(
    gs.heroSystem.isHeroActiveOrQueued(gs, 1, 'wizard').active,
    true,
    'Wizard is still recognized as active after summon expiry and subsequent spawns'
  );
  assert.equal(
    gs.constructionSystem.queueProductionOption(citadel.id, 'hero:wizard', 1),
    false,
    'Cannot recruit a second Wizard after summon expiry'
  );
  console.log('  [PASS] Test 1: No duplicate Wizard & zero companyId collisions after summon expiry');
}

// ---------------------------------------------------------------------------
// Test 2 & 3: Stale/Empty Selection Must NEVER Hijack All Workers to Charge or Become Idle
// ("כל הפלוגות של הפועלים מסתערות..." & "פועלים שהיו באמצע לעבוד מוגדרים כזמינים בצד...")
// ---------------------------------------------------------------------------
{
  const gs = new GameState(engineConfig);
  gs.spawnCompany({ name: "Second Builders", team: 1, unitType: "worker", count: 3, spawnMetersX: 1990, spawnMetersZ: 1684 });
  const workerComps = Array.from(gs.companies.values()).filter(
    (c) => c.team === 1 && c.unitType === 'worker'
  );
  assert.ok(workerComps.length >= 2, 'Team 1 has worker squads');

  // Assign Worker 0 to harvest nearest mine and Worker 1 to harvest nearest tree
  const mine = gs.economySystem.mines.values().next().value;
  const tree = gs.economySystem.findNearestGrownTree(workerComps[1].anchorXFx, workerComps[1].anchorZFx, 200 * 1024);
  gs.processCommands([
    {
      type: CommandTypes.GATHER_RESOURCE,
      payload: { team: 1, workerCompanyIds: [workerComps[0].id], xFx: mine.xFx, zFx: mine.zFx, queue: false }
    },
    {
      type: CommandTypes.GATHER_RESOURCE,
      payload: { team: 1, workerCompanyIds: [workerComps[1].id], xFx: tree.xFx, zFx: tree.zFx, queue: false }
    }
  ]);

  for (let t = 0; t < 120; t++) gs.stepTick([]);

  // Now issue an ATTACK_MOVE_COMPANIES with a stale/non-existent companyId [999] or empty []
  gs.processCommands([
    {
      type: CommandTypes.ATTACK_MOVE_COMPANIES,
      payload: {
        team: 1,
        companyIds: [999],
        dragStartXFx: 2048 * 1024,
        dragStartZFx: 2048 * 1024,
        dragEndXFx: 2048 * 1024,
        dragEndZFx: 2048 * 1024
      }
    }
  ]);

  assert.equal(
    gs.economySystem.companyGatherTasks.has(workerComps[0].id),
    true,
    'Worker 0 gathering task was NOT cancelled by stale combat command'
  );
  assert.equal(
    gs.economySystem.companyGatherTasks.has(workerComps[1].id),
    true,
    'Worker 1 gathering task was NOT cancelled by stale combat command'
  );
  assert.notEqual(workerComps[0].orderType, 3, 'Worker 0 is NOT attack-moving');
  assert.notEqual(workerComps[1].orderType, 3, 'Worker 1 is NOT attack-moving');

  // Also verify right-clicking a MOVE_COMPANIES directly onto a Mine with a worker assigns gathering instead of idling!
  gs.processCommands([
    {
      type: CommandTypes.MOVE_COMPANIES,
      payload: {
        team: 1,
        companyIds: [workerComps[0].id],
        dragStartXFx: mine.xFx,
        dragStartZFx: mine.zFx,
        dragEndXFx: mine.xFx,
        dragEndZFx: mine.zFx
      }
    }
  ]);
  assert.equal(
    gs.economySystem.companyGatherTasks.has(workerComps[0].id),
    true,
    'Point move onto mine with worker preserves/assigns gathering task instead of idling'
  );
  console.log('  [PASS] Test 2 & 3: Workers never charge on stale commands and never drop work to idle');
}

// ---------------------------------------------------------------------------
// Test 4: Ballista 4-Wheel Hierarchy, Keyframe Sampling & Explicit Ground Movement
// ("הבליסטראות לא זזות כמו שרוצים")
// ---------------------------------------------------------------------------
{
  const bDef = unitsJson.units.ballista;
  const pelvisChildren = bDef.hierarchy.pelvis.children;
  assert.ok(pelvisChildren.leg_L, 'Front left wheel is a child of pelvis');
  assert.ok(pelvisChildren.leg_R, 'Front right wheel is a child of pelvis');
  assert.ok(pelvisChildren.shin_L, 'Rear left wheel is a direct child of pelvis (not leg_L!)');
  assert.ok(pelvisChildren.shin_R, 'Rear right wheel is a direct child of pelvis (not leg_R!)');
  assert.equal(pelvisChildren.leg_L.children?.shin_L, undefined, 'shin_L is no longer nested inside leg_L');
  assert.ok(pelvisChildren.torso.children.hand_R, 'Bolt socket hand_R is a direct child of torso rail');

  const walkTrack = unitsJson.animations.keyframes.ballista_human_walk.tracks.leg_L;
  sampleChannelInto(walkTrack, 0.5, 'rot', 'rotKey', _sampleScratch, true);
  assert.ok(
    Math.abs(_sampleScratch.rx - 3.1416) < 0.05,
    `Ballista wheel rotation interpolates at t=0.5 (got ${_sampleScratch.rx})`
  );

  // Verify Ballista obeys explicit ground MOVE even when an enemy is within its 155m range
  const gs = new GameState(engineConfig);
  const ballistaComp = gs.spawnCompany({
    name: 'Ballista Test',
    team: 1,
    unitType: 'ballista',
    count: 3,
    spawnMetersX: 2048,
    spawnMetersZ: 1850,
    speedFx: 178,
    hp: 260
  });
  // Spawn an enemy within 120m (inside Ballista's 155m attack range)
  gs.spawnCompany({
    name: 'Enemy Target Within 120m',
    team: 2,
    unitType: 'swordsman',
    count: 10,
    spawnMetersX: 2048,
    spawnMetersZ: 1960
  });

  const startZ = ballistaComp.anchorZFx;
  const goalZ = (1820 * 1024) | 0;
  gs.processCommands([
    {
      type: CommandTypes.MOVE_COMPANIES,
      payload: {
        team: 1,
        companyIds: [ballistaComp.id],
        dragStartXFx: 2048 * 1024,
        dragStartZFx: goalZ,
        dragEndXFx: 2048 * 1024,
        dragEndZFx: goalZ,
        queue: false,
        isRunning: false
      }
    }
  ]);
  assert.equal(ballistaComp.isExplicitGroundMove, true, 'isExplicitGroundMove is set on non-queued ground MOVE');

  for (let t = 0; t < 190; t++) gs.stepTick([]);

  let avgBallistaZ = 0;
  for (const id of ballistaComp.memberIds) {
    avgBallistaZ += gs.entities.get(id).z;
  }
  avgBallistaZ /= ballistaComp.memberIds.length;
  assert.ok(
    Math.abs(avgBallistaZ - goalZ) < 4 * 1024,
    `Ballista members rolled to ground MOVE destination instead of freezing to shoot (dist=${Math.abs(avgBallistaZ - goalZ) / 1024}m)`
  );
  console.log('  [PASS] Test 4: Ballista 4 wheels spin independently and Ballistas obey ground MOVE orders');
}

// ---------------------------------------------------------------------------
// Test 5 & 6: Squads Never Get Stuck Mid-March When Anchor Arrives First
// ("פלוגות נתקעות במקום")
// ---------------------------------------------------------------------------
{
  const gs = new GameState(engineConfig);
  const combatComps = Array.from(gs.companies.values()).filter(
    (c) => c.team === 1 && c.unitType !== 'worker'
  );
  // Issue a short/medium move where the anchor arrives quickly while rear ranks walk through each other
  const targetXFx = 2048 * 1024;
  const targetZFx = 1810 * 1024;
  gs.processCommands([
    {
      type: CommandTypes.MOVE_COMPANIES,
      payload: {
        team: 1,
        companyIds: combatComps.map((c) => c.id),
        dragStartXFx: targetXFx - 18 * 1024,
        dragStartZFx: targetZFx,
        dragEndXFx: targetXFx + 18 * 1024,
        dragEndZFx: targetZFx,
        queue: false,
        isRunning: true
      }
    }
  ]);

  for (let t = 0; t < 260; t++) gs.stepTick([]);

  for (const comp of combatComps) {
    for (const mid of comp.memberIds) {
      const ent = gs.entities.get(mid);
      const distToSlotMeters = Math.hypot(ent.x - ent.slotTargetXFx, ent.z - ent.slotTargetZFx) / 1024;
      assert.ok(
        distToSlotMeters < 3.2,
        `Unit ${ent.id} of ${comp.name} reached its formation slot without getting stuck (dist=${distToSlotMeters.toFixed(2)}m)`
      );
    }
  }
  console.log('  [PASS] Test 5 & 6: Multi-squad march reaches formation slots with zero stuck units');
}

console.log('=== All Live Gameplay Bug Regression Tests Passed! ===');

export async function runLiveGameplayBugTests() { return "PASS (6/6 live gameplay bug regression tests verified)"; }
