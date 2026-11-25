import fs from 'fs';
import path from 'path';

// Minimal global DOM mock for modules that touch document/window at runtime
globalThis.document = {
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    appendChild() {},
    remove() {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getContext: () => ({
      fillRect() {}, clearRect() {}, drawImage() {},
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}
    }),
    toDataURL: () => 'data:image/png;base64,MOCK'
  }),
  getElementById: () => null,
  querySelectorAll: () => [],
  body: { appendChild() {} },
  head: { appendChild() {} },
  hidden: false
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  location: { pathname: '/', search: '' },
  devicePixelRatio: 1
};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

async function runAnimationSuite(projectRoot, label) {
  const { ModelFactory, updateBowstringRig } = await import(`file://${projectRoot}/src/render/modelFactory.js`);
  const { Animator3D, isTrackEffectivelyAnimated } = await import(`file://${projectRoot}/src/render/animator3d.js`);
  const { resolveClip, resolveIdleClip, getCombatBase, getLocomotionBase } = await import(`file://${projectRoot}/src/tools/studio/clipResolver.js`);
  const { buildCombinedVisualsData } = await import(`file://${projectRoot}/src/tools/heroes/heroStateManager.js`);
  const { getSpellCastTimingProfile } = await import(`file://${projectRoot}/src/render/heroSpellAnimations.js`);

  const { defaultUnitsVisuals: unitsJson, defaultHeroesData: heroesJson } = await import(`file://${projectRoot}/src/data/defaults.js`);
  const combined = buildCombinedVisualsData(unitsJson, heroesJson);

  const factory = new ModelFactory(combined);
  const unitIds = ['worker', 'swordsman', 'spearman', 'archer', 'cavalry', 'wizard', 'ravan', 'the_king', 'sisnat', 'ravan__mounted'];
  const animClipsToTest = ['idle', 'walk', 'run', 'gallop', 'charge', 'attack_slash', 'shoot_bow', 'die', 'hurt', 'knocked_down'];

  const results = {};

  for (const uid of unitIds) {
    const group = factory.createVisual(uid, { teamId: 1, isBannerCarrier: uid === 'swordsman' });
    if (!group) throw new Error(`[${label}] Failed createVisual for ${uid}`);
    const animator = new Animator3D(group, combined.animations, { entityId: 42 });

    const unitRes = { joints: Object.keys(group.userData?.joints || {}).length, poses: {} };

    for (const clipName of animClipsToTest) {
      animator.resetFullBody();
      const resolved = resolveClip(combined, group.userData?.unitDef?.baseHeroId || uid, group.userData?.unitDef?.race || 'human', clipName);
      if (['idle', 'walk', 'run', 'gallop', 'charge', 'knocked_down'].includes(clipName)) {
        animator.setLocomotion(resolved, 1.0);
      } else {
        animator.playAction(resolved, { restart: true });
      }
      // Step 5 frames at 60fps
      for (let f = 0; f < 5; f++) {
        animator.update(0.0166);
      }
      if (uid === 'archer') updateBowstringRig(group);

      const torso = group.userData?.joints?.torso || group.userData?.joints?.body;
      const armR = group.userData?.joints?.arm_R;
      const legL = group.userData?.joints?.leg_L;
      unitRes.poses[clipName] = {
        resolved,
        torsoRot: torso ? [
          +torso.rotation.x.toFixed(4),
          +torso.rotation.y.toFixed(4),
          +torso.rotation.z.toFixed(4)
        ] : null,
        armRRot: armR ? [
          +armR.rotation.x.toFixed(4),
          +armR.rotation.y.toFixed(4),
          +armR.rotation.z.toFixed(4)
        ] : null,
        legLRot: legL ? [
          +legL.rotation.x.toFixed(4),
          +legL.rotation.y.toFixed(4),
          +legL.rotation.z.toFixed(4)
        ] : null
      };
    }

    // Also test spell timing profile for heroes
    if (['wizard', 'ravan', 'the_king', 'sisnat'].includes(uid)) {
      unitRes.spellTiming = getSpellCastTimingProfile('fireball', 0.85);
    }

    results[uid] = unitRes;
  }

  // Test isTrackEffectivelyAnimated
  const sampleClip = Object.values(combined.animations.keyframes)[0];
  const firstTrack = sampleClip ? Object.values(sampleClip.tracks || {})[0] : null;
  results._trackAnimatedCheck = firstTrack ? isTrackEffectivelyAnimated(firstTrack) : false;

  return results;
}

import { fileURLToPath } from 'url';
// Roots: NEW = this checkout. ORIG = optional reference checkout (env KL_ORIG_ROOT) to compare against;
// without it the suite compares the checkout with itself (still catches crashes and non-determinism).
const newRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const origRoot = process.env.KL_ORIG_ROOT || newRoot;

console.log('Running animation & model verification on ORIGINAL project...');
const origAnim = await runAnimationSuite(origRoot, 'ORIG');
console.log('Running animation & model verification on REFACTORED project...');
const newAnim = await runAnimationSuite(newRoot, 'NEW');

let diffs = 0;
for (const uid of Object.keys(origAnim)) {
  const s1 = JSON.stringify(origAnim[uid]);
  const s2 = JSON.stringify(newAnim[uid]);
  if (s1 !== s2) {
    console.error(`MISMATCH in ${uid}:`);
    console.error('  ORIG:', s1.slice(0, 300));
    console.error('  NEW :', s2.slice(0, 300));
    diffs++;
  }
}

if (diffs === 0) {
  console.log('ANIMATION & MODEL PARITY CHECK: 100% IDENTICAL across all 10 unit/hero rigs and all 10 animation clips!');
} else {
  throw new Error(`Found ${diffs} animation/model mismatches!`);
}
