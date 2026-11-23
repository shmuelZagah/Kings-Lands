// node tests/studio_import_smoke.mjs — runs the Studio import methods against a stub (no browser / three needed)
import fs from 'node:fs';
import { studioImportMethods } from '../src/tools/studio/studioImport.js';
import { readGlb } from '../src/tools/import/glbReader.js';
import * as conv from '../src/tools/import/glbToUnit.js';
process.env.OUT = '/tmp/synthetic_humanoid.glb';
if (!fs.existsSync('/tmp/synthetic_humanoid.glb')) await import('./glb_import_test.mjs');
const buf = fs.readFileSync('/tmp/synthetic_humanoid.glb'); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const host = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
const el = () => ({ value: '', style: {}, classList: { toggle() {} }, textContent: '' });
const toasts = [];
const ctx = Object.assign(Object.create(null), studioImportMethods, {
  unitsData: { units: { barracks: { isBuildingEntity: true, buildingId: 'barracks', displayName: 'Barracks' }, swordsman: { race: 'human', equipment: {} } }, prefabs: {}, animations: {} },
  ubStateManager: { buildingsData: { buildings: { barracks: { name: 'Barracks', footprintRadiusMeters: 6 }, farm: { name: 'Farm', footprintRadiusMeters: 5 } } } },
  entityCategory: 'units', currentUnitId: 'swordsman', currentFaction: 'human', currentLoadout: 'main',
  currentUnitGroup: { userData: { sockets: { head: 1, torso: 1, arm_R: 1, arm_L: 1, forearm_R: 1, forearm_L: 1, hand_R: 1, hand_L: 1, leg_R: 1, leg_L: 1, shin_R: 1, shin_L: 1, foot_R: 1, foot_L: 1 } } },
  rootContainer: { querySelector: (s) => (s === '#insp-import' ? host : el()) },
  stateManager: { scheduleSave() {} }, inspectorPanel: { switchTab() {} },
  _toast: (m) => toasts.push(m), _beginEdit() {}, _spawnStudioUnit() {}, _restowAll() {}, _rebindData() {}, _refreshUnitList() {}, _unitsOfPeople: () => ['swordsman'],
  _eq(create) { const u = this.unitsData.units[this.currentUnitId]; if (!u.equipment) u.equipment = {}; return u.equipment; }
});
let fails = 0; const ok = (c, m) => { console.log(c ? ' ok  ' : 'FAIL ', m); if (!c) fails++; };
const file = { name: 'Golden Helm.glb', size: 1234567 };

for (const kind of ['unit', 'gear', 'building']) {
  ctx._imp = null; ctx._impState(); ctx._imp.kind = kind; ctx._imp.file = file;
  ctx._renderImportPanel();
  ok(host.innerHTML.includes('Detail kit') && host.innerHTML.includes('id="imp-go"'), `panel renders for "${kind}"`);
}
// buildings category defaults to building skin
ctx._imp = null; ctx.entityCategory = 'buildings'; ctx.currentUnitId = 'barracks';
ok(ctx._impState().kind === 'building', 'in the Buildings category the import defaults to "Building skin"');
ctx.entityCategory = 'units'; ctx.currentUnitId = 'swordsman'; ctx._imp = null;

const scene = async () => readGlb(ab);
// gear: both sides, equipped
ctx._imp = null; ctx._impState(); Object.assign(ctx._imp, { kind: 'gear', file, slot: 'shoulder', sides: 'both', equip: true });
ctx._importGear(conv, await scene(), 'Golden Pauldron', 800, 0, ctx._imp);
const pf = ctx.unitsData.prefabs;
ok(pf.imp_golden_pauldron_R && pf.imp_golden_pauldron_L, 'gear: R and L prefabs created');
ok(pf.imp_golden_pauldron_R.defaultSocket === 'arm_R' && pf.imp_golden_pauldron_L.defaultSocket === 'arm_L' && pf.imp_golden_pauldron_R.slot === 'shoulder', 'gear: slot + sockets');
const xr = pf.imp_golden_pauldron_R.parts[0].vertices.map((v) => v[0]), xl = pf.imp_golden_pauldron_L.parts[0].vertices.map((v) => v[0]);
ok(Math.abs(Math.max(...xr) + Math.min(...xl)) < 0.02, 'gear: left copy is a mirror of the right');
ok(ctx.unitsData.units.swordsman.equipment.arm_R?.prefab === 'imp_golden_pauldron_R' && ctx.unitsData.units.swordsman.equipment.arm_L?.prefab === 'imp_golden_pauldron_L', 'gear: equipped on the unit');
// delete gear
globalThis.confirm = () => true;
ctx._deleteImportedGear('imp_golden_pauldron_R');
ok(!pf.imp_golden_pauldron_R && !ctx.unitsData.units.swordsman.equipment.arm_R, 'gear: delete removes the prefab and unequips it');
// building skin
ctx._imp.buildingId = 'barracks'; ctx._imp.scale = 1;
ctx._importBuildingSkin(conv, await scene(), 'Winter Barracks', 2000, 0, ctx._imp);
const e = ctx.unitsData.buildingSkins.barracks;
ok(e.active === 'winter_barracks' && e.items.winter_barracks.mesh.faces.length > 100 && e.items.winter_barracks.fitRadius === 6, 'building skin stored, active, fitRadius = footprint');
ctx.currentUnitId = 'barracks'; ctx.entityCategory = 'buildings';
const gridHtml = ctx._skinsGridHtml();
ok(gridHtml.includes('data-skin-pick="default"') && gridHtml.includes('data-skin-pick="winter_barracks"') && gridHtml.includes('overflow-y-auto'), 'skins grid lists Default + the imported skin, scrollable');
ctx._deleteBuildingSkin('barracks', 'winter_barracks');
ok(!ctx.unitsData.buildingSkins?.barracks, 'skin deleted → back to default');
// unit
ctx.entityCategory = 'units'; ctx.currentUnitId = 'swordsman';
ctx._imp.skirts = true;
ctx._importUnit(conv, await scene(), 'Royal Guard', 3000, 0, ctx._imp);
const u = ctx.unitsData.units.royal_guard;
ok(u && u.displayName === 'Royal Guard' && u.race === 'human' && u.importInfo, 'unit: new base unit "Royal Guard" in the current faction');
ctx._deleteImportedUnit('royal_guard');
ok(!ctx.unitsData.units.royal_guard, 'unit: delete works');
console.log(fails ? `\n${fails} FAILED` : '\nALL OK'); process.exit(fails ? 1 : 0);
