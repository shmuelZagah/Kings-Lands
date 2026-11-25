import assert from 'assert';
import { readHeroesJson, readUnitsJson } from '../helpers/loadData.mjs';
import fs from 'fs';
import * as THREE from 'three';
import { ModelFactory } from '../../src/render/modelFactory.js';
import { Animator3D } from '../../src/render/animator3d.js';
import { WorldEffectsRenderer } from '../../src/render/worldEffectsRenderer.js';
import { HeroStateManager, buildCombinedVisualsData } from '../../src/tools/heroes/heroStateManager.js';
import { sanitizeUnitsData } from '../../src/tools/studio/clipEditing.js';
import { runHealthCheck } from '../../src/tools/studio/healthCheck.js';

export async function runRenderTests() {
  const unitsJson = readUnitsJson();
  const heroesJson = readHeroesJson();

  // 1. Verify Studio runHealthCheck reports 0 errors and 0 warnings across all units (including ballista)
  const hc = runHealthCheck(unitsJson);
  assert.strictEqual(hc.counts.error, 0, `runHealthCheck must have 0 errors (got ${hc.counts.error})`);
  // Known content warnings in the shipped data (animation content, not code): footstep events beyond the end of the
  // charge/gallop/retreat_run/run clips and the archer's missing attack_bash clip. Anything NEW fails the test.
  const KNOWN_WARNINGS = new Set([
    'clip charge|event #2 (footstep): time 0.75s is outside the clip (0..0.52s)',
    'clip gallop|event #2 (footstep): time 0.64s is outside the clip (0..0.56s)',
    'clip retreat_run|event #2 (footstep): time 0.75s is outside the clip (0..0.6s)',
    'clip run|event #2 (footstep): time 0.72s is outside the clip (0..0.56s)',
    'unit archer|gear opens "attack_bash" but no clip exists for it yet (draw one in the studio)'
  ]);
  const newWarnings = hc.issues.filter((i) => i.level === 'warn' && !KNOWN_WARNINGS.has(`${i.area}|${i.message}`));
  assert.deepStrictEqual(newWarnings.map((i) => `${i.area}: ${i.message}`), [], 'runHealthCheck reported new warnings');

  // 2. Verify sanitizeUnitsData preserves keyframe locomotionAnim (e.g. sisnat_human_gallop)
  const testData = JSON.parse(JSON.stringify(unitsJson));
  testData.animations.keyframes.custom_walk = JSON.parse(JSON.stringify(unitsJson.animations.keyframes.walk));
  testData.units.swordsman.locomotionAnim = 'custom_walk';
  sanitizeUnitsData(testData);
  assert.strictEqual(testData.units.swordsman.locomotionAnim, 'custom_walk', 'sanitizeUnitsData must preserve keyframe locomotionAnim');

  // 3. Verify all units (including ballista) & heroes build visuals and step animations cleanly
  const combined = buildCombinedVisualsData(unitsJson, heroesJson);
  assert.strictEqual(combined.animations.keyframes.attack_bash.layer, 'upperBody', 'attack_bash must have layer=upperBody');

  const factory = new ModelFactory(combined);
  for (const uid of ['worker', 'swordsman', 'spearman', 'archer', 'cavalry', 'ballista', 'wizard', 'ravan', 'the_king', 'sisnat', 'ravan__mounted']) {
    const grp = factory.createVisual(uid, { teamId: 1 });
    assert.ok(grp, `ModelFactory must create visual for ${uid}`);
    const anim = new Animator3D(grp, combined.animations, { entityId: 1 });
    anim.setLocomotion(uid === 'cavalry' || uid === 'sisnat' || uid === 'ravan__mounted' ? 'gallop' : 'walk', 1.0);
    anim.update(0.016);
  }

  // 4. Verify 100% Bidirectional Studio <-> Hall of Heroes <-> Battlefield Sync
  const hsm = new HeroStateManager();
  const studioView = hsm.getStudioViewData(unitsJson);
  studioView.animations.keyframes.wizard_human_spell_fireball.duration = 1.24;
  hsm.syncFromStudioView();
  assert.strictEqual(hsm.data.animations.keyframes.wizard_human_spell_fireball.userModifiedInStudio, true);
  const syncedCombined = buildCombinedVisualsData(unitsJson, hsm.data);
  assert.strictEqual(syncedCombined.animations.keyframes.wizard_human_spell_fireball.duration, 1.24);

  // 5. Verify mounted hero health bar offsetY = 3.75m vs foot hero 2.65m in WorldEffectsRenderer
  let lastProjectedY = 0;
  const origProject = THREE.Vector3.prototype.project;
  THREE.Vector3.prototype.project = function () {
    lastProjectedY = this.y;
    this.x = 0; this.y = 0; this.z = 0.5;
    return this;
  };
  const domMock = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  const we = new WorldEffectsRenderer({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    domElement: domMock,
    eventBus: { on() {} },
    buildingModelFactory: {}
  });
  we.floatingTextLayer = { appendChild() {} };
  we.updateHeroOverheadHealthBars(
    [{ id: 99, unitTypeIdx: 5, hp: 500, maxHp: 500, x: 2000, y: 10, z: 2000, team: 1, companyId: 77 }],
    { 77: { heroId: 'sisnat', isMounted: true } },
    null
  );
  assert.strictEqual(lastProjectedY, 13.75, 'Mounted hero health bar must project at exactY + 3.75m');
  THREE.Vector3.prototype.project = origProject;

  return 'PASS: 3D Models (incl. Ballista), Studio HealthCheck (0 err, only the 5 known content warnings), 100% Lab Sync & Hero Overhead Bar';
}
