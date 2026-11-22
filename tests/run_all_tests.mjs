globalThis.document = {
  createElement: (tag) => ({
    tagName: String(tag).toUpperCase(),
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    appendChild() {},
    remove() {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getContext: () => ({
      fillRect() {}, clearRect() {}, fillText() {}, drawImage() {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      arc() {}, ellipse() {}, fill() {}, stroke() {},
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
      quadraticCurveTo() {}, bezierCurveTo() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}
    }),
    toDataURL: () => 'data:image/png;base64,MOCK'
  }),
  getElementById: () => null,
  querySelectorAll: () => [],
  body: { appendChild() {} },
  head: { appendChild() {} },
  hidden: false,
  addEventListener() {}
};
globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  location: { pathname: '/', search: '' },
  devicePixelRatio: 1
};
const _lsMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (_lsMap.has(k) ? _lsMap.get(k) : null),
  setItem: (k, v) => _lsMap.set(k, String(v)),
  removeItem: (k) => _lsMap.delete(k),
  clear: () => _lsMap.clear()
};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

import { runCoreTests } from './core/fx_and_buses.test.mjs';
import { runMovementTests } from './movement/walking_and_formations.test.mjs';
import { runCombatAndHeroTests } from './combat/melee_ranged_and_heroes.test.mjs';
import { runEconomyTests } from './economy/popcap_and_gathering.test.mjs';
import { runAiTests } from './ai/fairplay_and_progression.test.mjs';
import { runAlliesLearningAndMinimapTests } from './ai/allies_learning_and_minimap.test.mjs';
import { runRenderTests } from './render/animations_and_batching.test.mjs';
import { runUiTests } from './ui/picker_and_cursors.test.mjs';
import { runLiveGameplayBugTests } from './regression/live_gameplay_bugs.test.mjs';
import { runUnitsBuildingsLabAndDoorTests } from './regression/units_buildings_lab_and_door_economy.test.mjs';

const suites = [
  ['tests/core', runCoreTests],
  ['tests/movement', runMovementTests],
  ['tests/combat', runCombatAndHeroTests],
  ['tests/economy', runEconomyTests],
  ['tests/ai', runAiTests],
  ['tests/ai_allies_learning', runAlliesLearningAndMinimapTests],
  ['tests/render', runRenderTests],
  ['tests/ui', runUiTests],
  ['tests/regression', runLiveGameplayBugTests],
  ['tests/units_buildings_lab', runUnitsBuildingsLabAndDoorTests]
];

console.log('==============================================================');
console.log('   KINGS LANDS — MULTI-FOLDER AUTOMATED VERIFICATION SUITE    ');
console.log('==============================================================');

for (const [folder, fn] of suites) {
  const msg = await fn();
  console.log(`[${folder}] ${msg}`);
}
console.log('==============================================================');
console.log('ALL 10 TEST SUITES PASSED 100%!');
