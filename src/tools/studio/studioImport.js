/**
 * Kings Lands — Studio "Import" tab + building skins grid (mixed into StudioApp).
 * (src/tools/studio/studioImport.js)
 *
 * Import a .glb as:
 *   • a NEW BASE UNIT   — rigged / cut into rigid joint parts, LOD0-2 (src/tools/import/glbToUnit.js: buildUnitFromScene)
 *   • GEAR              — helmet / armor / boots… as a prefab, attached to the slot you choose (mirrored for L/R pairs)
 *   • a BUILDING SKIN   — a static mesh that replaces the procedural architecture of the building you choose
 * Everything imported can be renamed and deleted again from this tab (building skins: from the Skins grid too).
 */

import { buildBuildingsStudioViewData } from '../units_buildings/buildingStudioAdapter.js';
import { dataRegistry } from '../../data/dataRegistry.js';
import { ensureUnitStatsForVisualUnit, removeUnitAcrossLabs } from '../labSync.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'imported';

/** Gear slots: which joint(s) they attach to, how big the item is by default, and where its centre sits in joint space. */
const GEAR_SLOTS = [
  { slot: 'head',     label: 'Head — helmet / hat',      joints: ['head'],              size: 0.30, offset: [0, 0.14, 0] },
  { slot: 'chest',    label: 'Chest — armor / tunic',     joints: ['torso'],             size: 0.62, offset: [0, 0.30, 0] },
  { slot: 'shoulder', label: 'Shoulder — pauldron',       joints: ['arm_R', 'arm_L'],    size: 0.28, offset: [0, -0.03, 0], paired: true },
  { slot: 'bracer',   label: 'Forearm — bracer',          joints: ['forearm_R', 'forearm_L'], size: 0.28, offset: [0, -0.13, 0], paired: true },
  { slot: 'glove',    label: 'Hand — glove',              joints: ['hand_R', 'hand_L'],  size: 0.14, offset: [0, -0.05, 0], paired: true },
  { slot: 'thigh',    label: 'Thigh — trousers / cuisse', joints: ['leg_R', 'leg_L'],    size: 0.52, offset: [0, -0.24, 0], paired: true },
  { slot: 'greave',   label: 'Shin — greave',             joints: ['shin_R', 'shin_L'],  size: 0.42, offset: [0, -0.20, 0], paired: true },
  { slot: 'boots',    label: 'Foot — boots',              joints: ['foot_R', 'foot_L'],  size: 0.30, offset: [0, -0.04, 0.05], paired: true },
  { slot: 'cape',     label: 'Back — cape',               joints: ['cape_back'],         size: 0.80, offset: [0, -0.30, -0.12] }
];

/** Detail kits = triangle budgets. Lower LODs of a unit are made automatically (30 % and 8 %). */
const DETAIL = {
  unit:     { low: 3000, medium: 6000, high: 10000 },
  gear:     { low: 600,  medium: 1800, high: 4500 },
  building: { low: 4000, medium: 9000, high: 16000 }
};

export const studioImportMethods = {
  _impState() {
    if (!this._imp) this._imp = { kind: null, file: null, name: '', detail: 'medium', custom: '', slot: 'head', sides: 'both', size: '', flip: false, skirts: true, buildingId: '', equip: true, scale: 1 };
    const isBld = this._isBuildingNow();
    if (isBld) {
      this._imp.kind = 'building';
    } else if (this._imp.kind !== 'unit' && this._imp.kind !== 'gear') {
      this._imp.kind = 'unit';
    }
    return this._imp;
  },

  _buildingIds() {
    const fromLab = Object.keys(this.ubStateManager?.buildingsData?.buildings || {});
    const fromUnits = Object.entries(this.unitsData.units || {}).filter(([, u]) => u?.isBuildingEntity).map(([id]) => id);
    return [...new Set([...fromLab, ...fromUnits])].filter((id) => !/_slot$/.test(id));
  },

  _isBuildingNow() {
    return this.entityCategory === 'buildings' || Boolean(this.unitsData.units?.[this.currentUnitId]?.isBuildingEntity);
  },

  _budgetFor(st) {
    const custom = Number(st.custom);
    if (custom >= 200) return Math.min(40000, Math.round(custom));
    const bucket = DETAIL[st.kind] || DETAIL.unit;
    return bucket[st.detail] || bucket.medium;
  },

  // ------------------------------------------------------------------------------------------------ the tab
  _renderImportPanel() {
    const host = this.rootContainer?.querySelector('#insp-import');
    if (!host) return;
    const st = this._impState();
    const data = this.unitsData;
    const curId = this.currentUnitId;
    const cur = data.units?.[curId];
    const isBldNow = this._isBuildingNow();
    const seg = (id, label, on) => `<button type="button" data-imp-kind="${id}" class="flex-1 rounded px-1.5 py-1 text-[11px] font-bold ${on ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'}">${label}</button>`;
    const inp = 'w-full rounded bg-slate-950 border border-slate-700 px-2 py-1 text-slate-100';
    const sockets = Object.keys(this.currentUnitGroup?.userData?.sockets || {});
    const slots = GEAR_SLOTS.filter((s) => s.joints.some((j) => sockets.includes(j)) || isBldNow);
    if (!slots.some((s) => s.slot === st.slot)) st.slot = slots[0]?.slot || 'head';
    const slotDef = GEAR_SLOTS.find((s) => s.slot === st.slot) || GEAR_SLOTS[0];
    const blds = this._buildingIds();
    if (!st.buildingId || !blds.includes(st.buildingId)) st.buildingId = blds.includes(curId) ? curId : blds[0] || '';
    const budget = this._budgetFor(st);

    // what the user imported before on Units/Heroes tab (can be deleted; buildings already show their skins grid)
    const myUnits = !isBldNow ? Object.entries(data.units || {}).filter(([, u]) => u?.importInfo) : [];
    const myGear = !isBldNow ? Object.entries(data.prefabs || {}).filter(([, p]) => p?.importInfo) : [];
    const row = (label, sub, attr) => `<div class="flex items-center gap-1.5 rounded bg-slate-950/60 border border-slate-800 px-2 py-1"><div class="min-w-0 flex-1"><div class="truncate text-slate-200">${esc(label)}</div><div class="truncate text-[10px] text-slate-500">${esc(sub)}</div></div><button type="button" ${attr} title="Delete imported model" class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-rose-700 hover:bg-rose-600 text-[11px] font-bold text-white cursor-pointer">✕</button></div>`;
    const kindTabsHtml = isBldNow
      ? seg('building', 'Import building skin', true)
      : `${seg('unit', 'Import base unit', st.kind === 'unit')}${seg('gear', 'Import armour', st.kind === 'gear')}`;

    host.innerHTML = `
      <div class="flex flex-col gap-2">
        ${cur?.importInfo ? `
          <div class="rounded-lg border border-sky-500/40 bg-sky-500/10 p-2 flex flex-col gap-1.5">
            <div class="font-bold text-sky-300">This unit was imported</div>
            <div class="flex gap-1.5"><input id="imp-rename" class="${inp}" value="${esc(cur.displayName || curId)}" /><button type="button" id="imp-rename-btn" class="rounded bg-slate-700 hover:bg-slate-600 px-2 text-slate-100 font-bold">Rename</button></div>
            <div class="text-[10px] text-slate-400">${(cur.importInfo.originalTriangles || 0).toLocaleString()} → ${(cur.importInfo.lodTriangles || []).map((n) => n.toLocaleString()).join(' / ')} triangles (LOD0 / 1 / 2) · rig: ${esc(cur.importInfo.rigMode)}</div>
          </div>` : ''}

        <div class="flex gap-1">${kindTabsHtml}</div>

        <div class="flex gap-1.5 items-center">
          <button type="button" id="imp-pick" class="rounded bg-sky-600 hover:bg-sky-500 px-3 py-1.5 font-bold text-slate-950">Choose .glb…</button>
          <span class="min-w-0 flex-1 truncate ${st.file ? 'text-emerald-300' : 'text-slate-500'}">${st.file ? esc(st.file.name) + ' (' + (st.file.size / 1048576).toFixed(1) + ' MB)' : 'no file chosen'}</span>
          <input id="imp-file" type="file" accept=".glb,model/gltf-binary" class="hidden" />
        </div>

        ${st.kind === 'unit' ? `
          <label class="flex flex-col gap-0.5"><span class="text-slate-400">Name of the new base unit</span><input id="imp-name" class="${inp}" placeholder="${esc(st.file ? st.file.name.replace(/\.[^.]+$/, '') : 'e.g. Royal Guard')}" value="${esc(st.name)}" /></label>
          <div class="text-[10px] text-slate-500">It becomes a NEW unit under <b class="text-slate-300">${esc(this.currentFaction)}</b> (${esc(this.entityCategory)}). It is cut into joints so you can pose, animate and rig it here.</div>
          <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" id="imp-skirts" class="accent-sky-400" ${st.skirts ? 'checked' : ''} /> <span class="text-slate-300">Joint overlap (stops joints opening when they bend)</span></label>
          <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" id="imp-flip" class="accent-sky-400" ${st.flip ? 'checked' : ''} /> <span class="text-slate-300">Model faces backwards → turn it 180°</span></label>
        ` : ''}

        ${st.kind === 'gear' ? `
          <label class="flex flex-col gap-0.5"><span class="text-slate-400">Name</span><input id="imp-name" class="${inp}" placeholder="${esc(st.file ? st.file.name.replace(/\.[^.]+$/, '') : 'e.g. Golden Helm')}" value="${esc(st.name)}" /></label>
          <label class="flex flex-col gap-0.5"><span class="text-slate-400">Where does it go?</span>
            <select id="imp-slot" class="${inp}">${slots.map((s) => `<option value="${s.slot}" ${s.slot === st.slot ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
          ${slotDef.paired ? `<label class="flex flex-col gap-0.5"><span class="text-slate-400">Sides</span>
            <select id="imp-sides" class="${inp}"><option value="both" ${st.sides === 'both' ? 'selected' : ''}>Both (the left one is a mirror copy)</option><option value="R" ${st.sides === 'R' ? 'selected' : ''}>Right only</option><option value="L" ${st.sides === 'L' ? 'selected' : ''}>Left only</option></select></label>` : ''}
          <label class="flex flex-col gap-0.5"><span class="text-slate-400">Size in metres (biggest dimension)</span><input id="imp-size" type="number" step="0.01" min="0.02" class="${inp}" placeholder="${slotDef.size}" value="${esc(st.size)}" /></label>
          <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" id="imp-equip" class="accent-sky-400" ${st.equip ? 'checked' : ''} /> <span class="text-slate-300">Put it on the current unit now</span></label>
          <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" id="imp-flip" class="accent-sky-400" ${st.flip ? 'checked' : ''} /> <span class="text-slate-300">Turn it 180°</span></label>
          <div class="text-[10px] text-slate-500">Fine tuning: Gear tab → <b>Fit</b> moves / rotates the item on the body.</div>
        ` : ''}

        ${st.kind === 'building' ? `
          <label class="flex flex-col gap-0.5"><span class="text-slate-400">Which building gets this skin?</span>
            <select id="imp-building" class="${inp}">${blds.map((b) => `<option value="${esc(b)}" ${b === st.buildingId ? 'selected' : ''}>${esc(this.ubStateManager?.buildingsData?.buildings?.[b]?.name || data.units?.[b]?.displayName || b)}</option>`).join('')}</select></label>
          <label class="flex flex-col gap-0.5"><span class="text-slate-400">Skin name</span><input id="imp-name" class="${inp}" placeholder="${esc(st.file ? st.file.name.replace(/\.[^.]+$/, '') : 'e.g. Winter Barracks')}" value="${esc(st.name)}" /></label>
          <label class="flex flex-col gap-0.5"><span class="text-slate-400">Scale (1 = fills the building's footprint)</span><input id="imp-scale" type="number" step="0.05" min="0.2" max="3" class="${inp}" value="${esc(st.scale)}" /></label>
          <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" id="imp-flip" class="accent-sky-400" ${st.flip ? 'checked' : ''} /> <span class="text-slate-300">Turn it 180° (door side)</span></label>
          <div class="text-[10px] text-slate-500">The skin appears in the <b class="text-slate-300">Skins</b> tab of that building, next to the default look. Create new buildings in the Units & Buildings Lab.</div>
        ` : ''}

        <div class="rounded-lg border border-slate-700 bg-slate-950/50 p-2 flex flex-col gap-1.5">
          <div class="font-bold text-amber-300">Detail kit <span class="font-normal text-slate-500">(polygon budget)</span></div>
          <div class="flex gap-1">${['low', 'medium', 'high'].map((d) => `<button type="button" data-imp-detail="${d}" class="flex-1 rounded px-1 py-1 text-[11px] font-bold ${!st.custom && st.detail === d ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'}">${d[0].toUpperCase() + d.slice(1)} · ${(DETAIL[st.kind] || DETAIL.unit)[d].toLocaleString()}</button>`).join('')}</div>
          <label class="flex items-center gap-1.5"><span class="text-slate-400 shrink-0">Custom triangles</span><input id="imp-custom" type="number" min="200" step="100" class="${inp}" placeholder="auto" value="${esc(st.custom)}" /></label>
          <div class="text-[10px] text-slate-500">${st.kind === 'unit'
            ? `Full detail <b class="text-slate-300">${budget.toLocaleString()}</b> triangles for close zoom; the game switches by itself to ${Math.round(budget * 0.3).toLocaleString()} (normal zoom) and ${Math.round(budget * 0.08).toLocaleString()} (far).`
            : `Reduced automatically to about <b class="text-slate-300">${budget.toLocaleString()}</b> triangles.`}</div>
        </div>

        <button type="button" id="imp-go" class="rounded-lg ${st.file ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-500 cursor-not-allowed'} px-3 py-2 font-extrabold" ${st.file ? '' : 'disabled'}>Import</button>

        ${myUnits.length || myGear.length ? `
          <div class="mt-1 flex flex-col gap-1.5">
            <div class="font-bold text-rose-300">Your imports</div>
            ${myUnits.map(([id, u]) => row(u.displayName || id, `unit · ${id}`, `data-imp-del-unit="${esc(id)}"`)).join('')}
            ${myGear.map(([id, p]) => row(p.name || id, `gear · ${p.slot} · ${id}`, `data-imp-del-gear="${esc(id)}"`)).join('')}
          </div>` : ''}
      </div>`;
    this._bindImportPanel(host);
  },

  _bindImportPanel(host) {
    const st = this._impState();
    const q = (s) => host.querySelector(s);
    const rerender = () => this._renderImportPanel();
    host.querySelectorAll('[data-imp-kind]').forEach((b) => b.addEventListener('click', () => { st.kind = b.dataset.impKind; rerender(); }));
    host.querySelectorAll('[data-imp-detail]').forEach((b) => b.addEventListener('click', () => { st.detail = b.dataset.impDetail; st.custom = ''; rerender(); }));
    q('#imp-pick')?.addEventListener('click', () => q('#imp-file').click());
    q('#imp-file')?.addEventListener('change', (e) => { st.file = e.target.files?.[0] || null; rerender(); });
    const bindInput = (sel, key, num = false) => q(sel)?.addEventListener('input', (e) => { st[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (num) st[key] = e.target.value; });
    bindInput('#imp-name', 'name'); bindInput('#imp-size', 'size', true); bindInput('#imp-scale', 'scale', true);
    q('#imp-custom')?.addEventListener('change', (e) => { st.custom = e.target.value; rerender(); });
    for (const [sel, key] of [['#imp-skirts', 'skirts'], ['#imp-flip', 'flip'], ['#imp-equip', 'equip']]) q(sel)?.addEventListener('change', (e) => { st[key] = e.target.checked; });
    q('#imp-slot')?.addEventListener('change', (e) => { st.slot = e.target.value; st.size = ''; rerender(); });
    q('#imp-sides')?.addEventListener('change', (e) => { st.sides = e.target.value; });
    q('#imp-building')?.addEventListener('change', (e) => { st.buildingId = e.target.value; });
    q('#imp-go')?.addEventListener('click', () => this._runImport());
    q('#imp-rename-btn')?.addEventListener('click', () => {
      const v = q('#imp-rename').value.trim();
      if (!v) return;
      this._beginEdit('rename-unit');
      this.unitsData.units[this.currentUnitId].displayName = v;
      if (this.entityCategory === 'units' && this.ubStateManager?.unitStatsData?.units?.[this.currentUnitId]) {
        this.ubStateManager.unitStatsData.units[this.currentUnitId].name = v;
      }
      this.stateManager.scheduleSave();
      this._flushCurrentCategory?.();
      this._refreshUnitList();
      this._toast(`Renamed to "${v}"`);
    });
    host.querySelectorAll('[data-imp-del-unit]').forEach((b) => b.addEventListener('click', () => this._deleteImportedUnit(b.dataset.impDelUnit)));
    host.querySelectorAll('[data-imp-del-gear]').forEach((b) => b.addEventListener('click', () => this._deleteImportedGear(b.dataset.impDelGear)));
  },

  // ------------------------------------------------------------------------------------------------ import
  async _runImport() {
    const st = this._impState();
    if (!st.file) return;
    const file = st.file;
    const stem = file.name.replace(/\.[^.]+$/, '');
    const name = (st.name || '').trim() || stem;
    const budget = this._budgetFor(st);
    const data = this.unitsData;
    this._toast('Importing… a large model can take several seconds', 12000);
    await new Promise((r) => setTimeout(r, 40));
    try {
      const [{ readGlb }, conv] = await Promise.all([import('../import/glbReader.js'), import('../import/glbToUnit.js')]);
      const scene = await readGlb(await file.arrayBuffer());
      const rotateYDeg = st.flip ? 180 : 0;
      if (st.kind === 'unit') this._importUnit(conv, scene, name, budget, rotateYDeg, st);
      else if (st.kind === 'gear') this._importGear(conv, scene, name, budget, rotateYDeg, st);
      else this._importBuildingSkin(conv, scene, name, budget, rotateYDeg, st);
      st.file = null; st.name = '';
      this.stateManager.scheduleSave();
      this._renderImportPanel();
    } catch (e) {
      console.error(e);
      this._toast(`Import failed: ${e.message}`, 9000);
    }
  },

  _uniqueId(base, taken) {
    let id = base, n = 2;
    while (taken[id]) id = `${base}_${n++}`;
    return id;
  },

  _importUnit(conv, scene, name, budget, rotateYDeg, st) {
    const data = this.unitsData;
    const id = this._uniqueId(slug(name), data.units);
    const { unit, report } = conv.buildUnitFromScene(scene, {
      id, displayName: name, race: this.currentFaction, sourceName: st.file.name, rotateYDeg,
      budgets: [budget, Math.round(budget * 0.3), Math.round(budget * 0.08)], skirtRings: st.skirts ? 2 : 0
    });
    this._beginEdit('import-unit');
    data.units[id] = unit;
    if (this.ubStateManager) {
      this.ubStateManager.unitsVisualsData = data;
      ensureUnitStatsForVisualUnit(this.ubStateManager.unitStatsData, data, id, unit);
      this.ubStateManager.saveAll();
    }
    this.currentUnitId = id;
    this._rebindData();
    const sel = this.rootContainer.querySelector('#st-unit-select'); if (sel) sel.value = id;
    this._toast(`New unit "${name}": ${report.originalTris.toLocaleString()} → ${report.lodTris.map((n) => n.toLocaleString()).join(' / ')} triangles, rig: ${report.rigMode}.` + (report.warnings.length ? ` ⚠ ${report.warnings[report.warnings.length - 1]}` : ''), 10000);
  },

  _importGear(conv, scene, name, budget, rotateYDeg, st) {
    const data = this.unitsData;
    const slotDef = GEAR_SLOTS.find((s) => s.slot === st.slot) || GEAR_SLOTS[0];
    const size = Number(st.size) > 0 ? Number(st.size) : slotDef.size;
    const unit = data.units[this.currentUnitId];
    const race = unit?.race || this.currentFaction;
    this._beginEdit('import-gear');
    data.prefabs = data.prefabs || {};
    const sides = slotDef.paired ? (st.sides === 'both' ? ['R', 'L'] : [st.sides]) : [null];
    const made = [];
    for (const side of sides) {
      const joint = slotDef.paired ? slotDef.joints.find((j) => j.endsWith(`_${side}`)) : slotDef.joints[0];
      const off = slotDef.offset.slice();
      const mesh = conv.buildStaticMeshFromScene(scene, {
        rotateYDeg, budget, mirrorX: side === 'L', smoothNormals: true,
        fit: { mode: 'size', size, anchor: 'center', offset: off }
      });
      const id = this._uniqueId(`imp_${slug(name)}${side ? '_' + side : ''}`, data.prefabs);
      data.prefabs[id] = {
        id, name: side ? `${name} (${side})` : name, type: 'procedural_3d', gltfUrl: null, race, slot: slotDef.slot,
        defaultSocket: joint, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0],
        parts: [{
          name: `${slug(name)}_mesh`, shape: 'mesh', pos: [0, 0, 0], vertices: mesh.vertices, faces: mesh.faces, colors: mesh.colors,
          ...(mesh.normals ? { smooth: true, normals: mesh.normals } : {}), color: '#ffffff', metalness: 0.15, roughness: 0.7
        }],
        importInfo: { source: st.file.name, originalTriangles: mesh.info.originalTriangles, triangles: mesh.info.triangles }
      };
      made.push({ id, joint, tris: mesh.info.triangles });
    }
    if (st.equip) {
      const eq = this._eq(true);
      for (const m of made) eq[m.joint] = { prefab: m.id, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] };
      this._restowAll();
    }
    this._spawnStudioUnit();
    this._toast(`Gear "${name}" → ${slotDef.label}: ${made.map((m) => m.tris.toLocaleString()).join(' + ')} triangles` + (st.equip ? ' · equipped (Gear tab → Fit to adjust)' : ''), 8000);
  },

  _importBuildingSkin(conv, scene, name, budget, rotateYDeg, st) {
    const data = this.unitsData;
    const bid = st.buildingId;
    if (!bid) throw new Error('Choose which building gets the skin.');
    const bDef = this.ubStateManager?.buildingsData?.buildings?.[bid] || {};
    const radius = Number(bDef.footprintRadiusMeters) || 5;
    const mesh = conv.buildStaticMeshFromScene(scene, {
      rotateYDeg, budget, smoothNormals: false,
      fit: { mode: 'footprint', radius, anchor: 'base', scale: Number(st.scale) > 0 ? Number(st.scale) : 1 }
    });
    this._beginEdit('import-building-skin');
    const skinsRoot = dataRegistry.getBuildingSkins();
    const entry = skinsRoot[bid] || { active: 'default', items: {} };
    for (const [k, v] of Object.entries(entry.items)) if (v.isPlaceholderCube) delete entry.items[k];
    const sid = this._uniqueId(slug(name), entry.items);
    entry.items[sid] = {
      name, fitRadius: radius, mesh: { vertices: mesh.vertices, faces: mesh.faces, colors: mesh.colors },
      importInfo: { source: st.file.name, originalTriangles: mesh.info.originalTriangles, triangles: mesh.info.triangles, size: mesh.info.size }
    };
    entry.active = sid;
    this._lastBuildingId = bid;
    const saveRes = dataRegistry.saveBuildingSkin(bid, entry);
    if (!saveRes.ok) {
      this._toast(`Could not save skins (${saveRes.error})`, 6000);
      return;
    }
    this.ubStateManager?.saveAll?.();
    if (!this.isContextualMode && this.entityCategory !== 'buildings') {
      this._switchEntityCategory('buildings');
    }
    this._buildingsStudioView = buildBuildingsStudioViewData(
      this.ubStateManager?.buildingsData,
      this.ubStateManager?.buildingVisualsData,
      this.unitStateManager?.data
    );
    if (this._buildingsStateAdapter) this._buildingsStateAdapter._view = this._buildingsStudioView;
    if (this.entityCategory === 'buildings') {
      this.currentUnitId = bid;
      this._refreshUnitList();
      const sel = this.rootContainer.querySelector('#st-unit-select');
      if (sel) sel.value = bid;
    } else if (data.units?.[bid]) {
      this.currentUnitId = bid;
      const sel = this.rootContainer.querySelector('#st-unit-select');
      if (sel) sel.value = bid;
    }
    this._spawnStudioUnit();
    this._renderGearPanel();
    this._toast(`Skin "${name}" for ${bid}: ${mesh.info.originalTriangles.toLocaleString()} → ${mesh.info.triangles.toLocaleString()} triangles. Pick skins in the Skins tab.`, 9000);
  },

  // ------------------------------------------------------------------------------------------------ delete

  _deleteImportedUnit(id) {
    const u = this.unitsData.units?.[id];
    if (!u || !u.importInfo) return;
    if (!confirm(`Delete the imported unit "${u.displayName || id}"? This cannot be undone (Ctrl+Z may not bring it back).`)) return;
    this._beginEdit('delete-unit');
    removeUnitAcrossLabs(this.ubStateManager?.unitStatsData, this.unitsData, this.ubStateManager?.buildingsData, id);
    if (this.ubStateManager?.unitStatsData?.units) {
      const fallbackBase = dataRegistry.DEFAULT_BASE_CHAR_ID || 'human_base_1';
      for (const stat of Object.values(this.ubStateManager.unitStatsData.units)) {
        if (stat?.baseCharId === id) stat.baseCharId = fallbackBase;
        if (stat?.baseModel === id) stat.baseModel = fallbackBase;
      }
    }
    if (this.ubStateManager) {
      this.ubStateManager.unitsVisualsData = this.unitsData;
      this.ubStateManager.saveAll();
    }
    if (this.currentUnitId === id) this.currentUnitId = this._unitsOfPeople(this.currentFaction)[0] || Object.keys(this.unitsData.units)[0];
    this.stateManager.scheduleSave();
    this._rebindData();
    this._refreshBaseCharControl?.();
    this._renderGearPanel?.();
    this._toast('Unit deleted');
  },

  _deleteImportedGear(id) {
    const p = this.unitsData.prefabs?.[id];
    if (!p || !p.importInfo) return;
    if (!confirm(`Delete the imported item "${p.name || id}" (removed from every unit that wears it)?`)) return;
    this._beginEdit('delete-gear');
    delete this.unitsData.prefabs[id];
    for (const u of Object.values(this.unitsData.units || {})) {
      const lists = [u.equipment, ...Object.values(u.loadouts || {}).map((l) => l.equipment)];
      for (const eq of lists) if (eq) for (const [j, e] of Object.entries(eq)) if (e?.prefab === id) delete eq[j];
    }
    this._restowAll();
    this.stateManager.scheduleSave();
    this._spawnStudioUnit();
    this._renderGearPanel?.();
    this._renderImportPanel();
    this._toast('Item deleted');
  },

  _deleteBuildingSkin(bid, sid) {
    const e = dataRegistry.getBuildingSkin(bid);
    const it = e?.items?.[sid];
    if (!it || !confirm(`Delete the skin "${it.name || sid}"?`)) return;
    this._beginEdit('delete-skin');
    const res = dataRegistry.deleteBuildingSkin(bid, sid);
    if (!res.ok) {
      this._toast(`Could not delete skin (${res.error})`, 6000);
      return;
    }
    this.ubStateManager?.saveAll?.();
    this.stateManager.scheduleSave();
    this._spawnStudioUnit();
    this._renderImportPanel();
    this._toast('Skin deleted');
  },

  // ------------------------------------------------------------------------------------------------ skins grid (buildings)
  /** Small front/side preview of a skin mesh, drawn on a 2D canvas (cached). */
  _skinThumb(skin) {
    this._thumbCache = this._thumbCache || new Map();
    const key = `${skin.name}|${skin.mesh.faces.length}|${skin.mesh.vertices.length}`;
    if (this._thumbCache.has(key)) return this._thumbCache.get(key);
    let url = '';
    try {
      const S = 96, cv = document.createElement('canvas'); cv.width = cv.height = S;
      const g = cv.getContext('2d');
      const { vertices: V, faces: F, colors: C } = skin.mesh;
      const a = 0.65, ca = Math.cos(a), sa = Math.sin(a);
      const P = V.map(([x, y, z]) => [x * ca - z * sa, y, x * sa + z * ca]);
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const p of P) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      const k = (S - 12) / Math.max(maxX - minX, maxY - minY, 1e-6);
      const ox = (S - (maxX - minX) * k) / 2 - minX * k, oy = S - 6 + minY * k;
      const step = Math.max(1, Math.floor(F.length / 5000));
      const order = [];
      for (let i = 0; i < F.length; i += step) order.push(i);
      order.sort((i, j) => (P[F[i][0]][2] + P[F[i][1]][2] + P[F[i][2]][2]) - (P[F[j][0]][2] + P[F[j][1]][2] + P[F[j][2]][2]));
      for (const i of order) {
        const [a0, b0, c0] = F[i];
        const A = P[a0], B = P[b0], Cc = P[c0];
        const nz = (B[0] - A[0]) * (Cc[1] - A[1]) - (B[1] - A[1]) * (Cc[0] - A[0]);
        if (nz <= 0) continue;
        const col = C?.[a0] || [180, 180, 180], sh = 0.55 + 0.45 * Math.min(1, nz * k * k * 0.02 + 0.3);
        g.fillStyle = `rgb(${col[0] * sh | 0},${col[1] * sh | 0},${col[2] * sh | 0})`;
        g.beginPath(); g.moveTo(A[0] * k + ox, oy - A[1] * k); g.lineTo(B[0] * k + ox, oy - B[1] * k); g.lineTo(Cc[0] * k + ox, oy - Cc[1] * k); g.closePath(); g.fill();
      }
      url = cv.toDataURL('image/png');
    } catch (_) { /* no canvas: the square just shows the name */ }
    this._thumbCache.set(key, url);
    return url;
  },

  /** HTML of the skins grid for the building being edited (scrolls like the map editor palettes). */
  _skinsGridHtml() {
    const bid = this.unitsData.units?.[this.currentUnitId]?.buildingId || this.currentUnitId;
    const entry = dataRegistry.getBuildingSkin(bid);
    const active = entry?.active || 'default';
    const sq = (id, label, inner, on, del) => `<div class="relative group">
      <button type="button" data-skin-pick="${esc(id)}" title="${esc(label)}" class="relative w-full aspect-square rounded-lg overflow-hidden border-2 ${on ? 'border-emerald-400 ring-2 ring-emerald-400/40' : 'border-slate-700 hover:border-slate-400'} bg-slate-950 flex flex-col cursor-pointer">
        ${on ? `<span data-skin-check="true" class="pointer-events-none absolute top-1 left-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-slate-950 text-[11px] font-black shadow ring-2 ring-slate-950">✓</span>` : ''}
        <div class="flex-1 min-h-0 w-full flex items-center justify-center">${inner}</div>
        <div class="truncate px-1 py-0.5 text-[10px] ${on ? 'bg-emerald-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-200'}">${esc(label)}</div>
      </button>${del ? `<button type="button" data-skin-del="${esc(id)}" title="Delete this skin" class="absolute top-0.5 right-0.5 z-20 flex h-5 w-5 items-center justify-center rounded bg-rose-700 hover:bg-rose-600 text-white text-[11px] font-bold shadow cursor-pointer">✕</button>` : ''}</div>`;
    const cells = [sq('default', 'Default', '<span class="text-3xl">🏰</span>', active === 'default', false)];
    for (const [sid, it] of Object.entries(entry?.items || {})) {
      const t = this._skinThumb(it);
      cells.push(sq(sid, it.name || sid, t ? `<img src="${t}" class="h-full w-full object-contain" alt="" />` : '<span class="text-2xl">🏠</span>', active === sid, true));
    }
    return `<div class="flex flex-col gap-1">
      <div class="flex items-center justify-between"><span class="text-[10.5px] text-sky-300 font-bold">Skins (${cells.length})</span><button type="button" id="skin-import" class="rounded bg-sky-600 hover:bg-sky-500 px-2 py-0.5 text-[10px] font-bold text-slate-950">+ Import skin</button></div>
      <div class="grid grid-cols-3 gap-1.5 max-h-52 overflow-y-auto pr-1">${cells.join('')}</div>
    </div>`;
  },

  _bindSkinsGrid(host) {
    const bid = this.unitsData.units?.[this.currentUnitId]?.buildingId || this.currentUnitId;
    host.querySelectorAll('[data-skin-pick]').forEach((b) => {
      const id = b.dataset.skinPick;
      const apply = () => {
        const e = dataRegistry.getBuildingSkin(bid);
        if (id !== 'default' && !e?.items?.[id]) return;
        this._beginEdit('pick-skin');
        const r = dataRegistry.setActiveBuildingSkin(bid, id);
        if (r.ok) this._toast(id === 'default' ? 'Default look selected' : 'Skin selected - shown for all peoples');
        else this._toast(`Could not save skins (${r.error})`, 6000);
        this.stateManager.scheduleSave();
        this._spawnStudioUnit();
        this._renderGearPanel();
      };
      b.addEventListener('click', apply);
    });
    host.querySelectorAll('[data-skin-del]').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); this._deleteBuildingSkin(bid, b.dataset.skinDel); }));
    host.querySelector('#skin-import')?.addEventListener('click', () => {
      this._impState().kind = 'building'; this._imp.buildingId = bid;
      this._renderImportPanel();
      this.inspectorPanel.switchTab('import');
    });
  }
};
