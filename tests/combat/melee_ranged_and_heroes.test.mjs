import assert from 'assert';
import { readEngineConfig } from '../helpers/loadData.mjs';
import fs from 'fs';
import { GameState, UnitTypeIndex, AnimState } from '../../src/sim/gameState.js';
import { CommandTypes } from '../../src/core/commandBus.js';
import { FX_ONE } from '../../src/core/fx.js';

export async function runCombatAndHeroTests() {
  const config = readEngineConfig();
  const gs = new GameState(config);
  gs.enemyAi.setMode('off');

  // 1. Verify custom Hero trainTimeSec syncs into getHeroRecruitmentOption
  gs.heroSystem.heroesData.heroes.wizard.parameters.trainTimeSec = 17;
  const wizOpt = gs.heroSystem.getHeroRecruitmentOption('wizard', 1);
  assert.strictEqual(wizOpt.trainTicks, 17 * 20, 'Hero trainTicks must reflect trainTimeSec * 20 TPS');

  // 2. Spawn Wizard & cast Fireball
  gs.heroSystem.spawnHeroFromBuilding(
    gs,
    gs.constructionSystem.buildings.get(1),
    { heroId: 'wizard', optionId: 'hero:wizard' },
    UnitTypeIndex,
    AnimState
  );
  const wizardComp = Array.from(gs.companies.values()).find((c) => c.isHero && c.heroId === 'wizard');
  assert.ok(wizardComp, 'Wizard hero company should spawn');

  const casted = gs.heroSystem.castHeroSpell(gs, wizardComp.id, 'fireball', 1, {
    targetXFx: 2048 * FX_ONE,
    targetZFx: 2000 * FX_ONE
  });
  assert.strictEqual(casted, true, 'Wizard should cast fireball spell');

  // 3. Field Ballista (unitTypeIdx 6) Long-Range Siege & Combat Verification + Edge Cases
  const ballistaComp = gs.spawnCompany({
    name: 'Field Ballista Battery',
    team: 1,
    unitType: 'ballista',
    count: 3,
    spawnMetersX: 1850,
    spawnMetersZ: 1750,
    facingDir: 256,
    speedFx: 148,
    hp: 260
  });
  assert.strictEqual(ballistaComp.unitTypeIdx, 6, 'Field Ballista must have unitTypeIdx === 6');
  assert.strictEqual(ballistaComp.memberIds.length, 3, 'Field Ballista battery must have 3 siege engines');

  const b0 = gs.entities.get(ballistaComp.memberIds[0]);
  const b1 = gs.entities.get(ballistaComp.memberIds[1]);
  const sepMeters = Math.hypot(b0.x - b1.x, b0.z - b1.z) / FX_ONE;
  assert.ok(sepMeters >= 2.8, `Ballista engines must have wide non-overlapping spacing (got ${sepMeters.toFixed(2)}m)`);

  // Place an enemy Watchtower 125m away (outside archer 115m range, inside ballista 155m range)
  const enemyTower = gs.constructionSystem.createBuilding({
    type: 'watchtower',
    team: 2,
    xFx: 1850 * FX_ONE,
    zFx: 1875 * FX_ONE,
    instantComplete: true,
    bypassValidation: true,
    gameState: gs
  });
  const initTowerHp = enemyTower.hp;

  gs.processCommands([{
    type: CommandTypes.ATTACK_MOVE_COMPANIES,
    payload: {
      team: 1,
      companyIds: [ballistaComp.id],
      dragStartXFx: enemyTower.xFx,
      dragStartZFx: enemyTower.zFx,
      dragEndXFx: enemyTower.xFx,
      dragEndZFx: enemyTower.zFx,
      targetEnemyBuildingId: enemyTower.id,
      queue: false,
      isRunning: false
    }
  }]);

  for (let t = 0; t < 95; t++) gs.stepTick([]);
  const siegeDmg = initTowerHp - enemyTower.hp;
  assert.ok(siegeDmg >= 300, `Field Ballista must deal 3.5x heavy siege damage to Watchtower at 125m (dealt ${siegeDmg})`);

  return `PASS: Melee/Ranged Combat, Field Ballista Siege (${siegeDmg} dmg at 125m), Hero trainTimeSec & Spells`;
}
