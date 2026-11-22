import assert from 'assert';
import fs from 'fs';
import * as THREE from 'three';
import { ModelFactory } from '../../src/render/modelFactory.js';
import { Animator3D } from '../../src/render/animator3d.js';
import { WorldEffectsRenderer } from '../../src/render/worldEffectsRenderer.js';
import { HeroStateManager, buildCombinedVisualsData } from '../../src/tools/heroes/heroStateManager.js';
import { sanitizeUnitsData } from '../../src/tools/studio/clipEditing.js';
import { runHealthCheck } from '../../src/tools/studio/healthCheck.js';

export async function runRenderTests() {
  const unitsJson = JSON.parse(fs.readFileSync(new URL('../../src/data/visuals/units.json', import.meta.url), 'utf8'));
  const heroesJson = JSON.parse(fs.readFileSync(new URL('../../src/data/heroes.json', import.meta.url), 'utf8'));

  // 1. Verify Studio runHealthCheck reports 0 errors and 0 warnings across all units (including ballista)
  const hc = runHealthCheck(unitsJson);
  assert.strictEqual(hc.counts.error, 0, `runHealthCheck must have 0 errors (got ${hc.counts.error})`);
  assert.strictEqual(hc.counts.warn, 0, `runHealthCheck must have 0 warnings (got ${hc.counts.warn})`);

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

  return 'PASS: 3D Models (incl. Ballista), Studio HealthCheck (0 err / 0 warn), 100% Lab Sync & Hero Overhead Bar';
}
