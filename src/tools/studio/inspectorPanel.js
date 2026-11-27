/**
 * Kings Lands — Studio inspector (src/tools/studio/inspectorPanel.js)
 *
 * Includes Transforms, Gear (Armor, Quivers & Stowed Weapons), 📸 Icons (Pose-based Unit Portraits,
 * Squad Bar Icons & Map Placeholder Symbols), and Colors tabs.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const AXES = ['x', 'y', 'z'];

const AXIS_STYLE = [
  { label: 'X', text: 'text-rose-400', num: 'text-rose-300', accent: 'accent-rose-500' },
  { label: 'Y', text: 'text-emerald-400', num: 'text-emerald-300', accent: 'accent-emerald-500' },
  { label: 'Z', text: 'text-sky-400', num: 'text-sky-300', accent: 'accent-sky-500' }
];

const FIELDS = [];
for (let i = 0; i < 3; i++) FIELDS.push({ id: `insp-p${AXES[i]}`, group: 'pos', axis: i });
for (let i = 0; i < 3; i++) FIELDS.push({ id: `insp-r${AXES[i]}`, group: 'rot', axis: i });
for (let i = 0; i < 3; i++) FIELDS.push({ id: `insp-s${AXES[i]}`, group: 'scl', axis: i });

const PROC_FIELDS = [
  { id: 'insp-proc-freq', key: 'frequency', fallback: 2.0 },
  { id: 'insp-proc-bob', key: 'bobAmplitude', fallback: 0.04 },
  { id: 'insp-proc-sway', key: 'torsoSway', fallback: 0.04 },
  { id: 'insp-proc-leg', key: 'legSwing', fallback: 0.0 },
  { id: 'insp-proc-arm', key: 'armSwing', fallback: 0.05 }
];

export class InspectorPanel {
  constructor(containerEl, callbacks = {}) {
    this.container = containerEl;
    this.onTransformChange = callbacks.onTransformChange;
    this.onTabChange = callbacks.onTabChange;
    this.onColorPreview = callbacks.onColorPreview;
    this.onColorSave = callbacks.onColorSave;
    this.onEasingChange = callbacks.onEasingChange;
    this.onForcePause = callbacks.onForcePause;
    this.onProceduralChange = callbacks.onProceduralChange;

    this.activeTarget = null;
    this.kind = 'joint';
    this.rest = null;
    this.transformsEnabled = true;
    this.procClip = null;
    this.keyContext = null;
    this.copied = null;
    this.activeTab = 'transform';

    this._renderUI();
    this._bindEvents();
  }

  _el(id) {
    return this.container.querySelector(`#${id}`);
  }

  setTarget(target, name, opts = {}) {
    const {
      kind = 'joint',
      rest = null,
      procClip = null,
      transformsEnabled = true,
      color = null
    } = opts;
    this.activeTarget = target || null;
    this.kind = kind;
    this.rest = rest;
    this.transformsEnabled = Boolean(transformsEnabled);

    const title = this._el('insp-title');
    title.textContent = kind === 'multi' ? name : kind === 'weapon_grip' ? `Grip: ${name}` : `Joint: ${name}`;
    title.className =
      (kind === 'weapon_grip' ? 'text-amber-400' : kind === 'multi' ? 'text-amber-300' : 'text-sky-400') +
      ' font-bold truncate max-w-[150px]';

    this._el('insp-note').classList.toggle('hidden', this.transformsEnabled);
    this._el('insp-fields').classList.toggle('opacity-40', !this.transformsEnabled);
    this._el('insp-fields').classList.toggle('pointer-events-none', !this.transformsEnabled);
    for (const f of FIELDS) {
      this._el(f.id).disabled = !this.transformsEnabled;
      this._el(`${f.id}-range`).disabled = !this.transformsEnabled;
    }
    this._el('insp-btn-copy').disabled = !this.activeTarget;
    this._el('insp-btn-paste').disabled = !this.activeTarget || !this.transformsEnabled;

    if (color) this._el('insp-color-picker').value = color;

    this.setKeyContext(null);
    this.setProcedural(procClip);
    this.container.classList.remove('hidden');
    this.syncUI();
  }

  setKeyContext(kf) {
    this.keyContext = kf || null;
    const box = this._el('insp-key-container');
    if (!kf) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    this._el('insp-key-title').textContent = `Keyframe @ t=${kf.t.toFixed(2)}`;
    this._el('insp-easing').value = kf.easing || 'smooth';
  }

  setProcedural(clip) {
    this.procClip = clip || null;
    this._el('insp-procedural-container').classList.toggle('hidden', !clip);
    this._fillProcedural();
  }

  _fillProcedural() {
    if (!this.procClip) return;
    for (const f of PROC_FIELDS) {
      const el = this._el(f.id);
      if (el && document.activeElement !== el) el.value = this.procClip[f.key] ?? f.fallback;
    }
  }

  _values() {
    const t = this.activeTarget;
    if (!t) return { pos: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] };
    return {
      pos: [t.position.x, t.position.y, t.position.z],
      rot: [t.rotation.x, t.rotation.y, t.rotation.z],
      scl: [t.scale.x, t.scale.y, t.scale.z]
    };
  }

  syncUI() {
    if (!this.activeTarget) return;
    const v = this._values();
    for (const f of FIELDS) {
      let val = f.group === 'pos' ? v.pos[f.axis] : f.group === 'scl' ? v.scl[f.axis] : v.rot[f.axis] * DEG;
      if (f.group !== 'scl' && Math.abs(val) < 5e-4) val = 0;
      const num = this._el(f.id);
      const rng = this._el(`${f.id}-range`);
      if (document.activeElement !== num) num.value = val.toFixed(f.group === 'rot' ? 1 : 3);
      if (document.activeElement !== rng) rng.value = String(val);
    }
    const su = this._el('insp-su');
    if (su && document.activeElement !== su) {
      const avg = (v.scl[0] + v.scl[1] + v.scl[2]) / 3;
      su.value = avg.toFixed(3);
      this._el('insp-su-range').value = String(avg);
    }
    this._fillProcedural();
  }

  /** The scale fields only make sense in Rig mode (they resize the part itself, not an animation). */
  setScaleVisible(visible) {
    this._el('insp-scale-group')?.classList.toggle('hidden', !visible);
  }

  switchTab(tab) {
    this.activeTab = tab;
    const TABS = { transform: 'sky', gear: 'emerald', icons: 'amber', color: 'amber', import: 'sky' };
    const ON = {
      sky: 'flex-1 py-1 text-sky-400 border-b-2 border-sky-400 font-bold transition-all cursor-pointer',
      emerald: 'flex-1 py-1 text-emerald-400 border-b-2 border-emerald-400 font-bold transition-all cursor-pointer',
      amber: 'flex-1 py-1 text-amber-400 border-b-2 border-amber-400 font-bold transition-all cursor-pointer'
    };
    const OFF = 'flex-1 py-1 text-slate-500 font-bold hover:text-slate-300 transition-all cursor-pointer';
    for (const [name, col] of Object.entries(TABS)) {
      const btn = this._el(`tab-${name}`),
        panel = this._el(`panel-${name}`);
      if (!btn || !panel) continue;
      btn.className = name === tab ? ON[col] : OFF;
      panel.classList.toggle('hidden', name !== tab);
    }
    this.onTabChange?.(tab);
  }

  _renderUI() {
    const row = (group, i) => {
      const s = AXIS_STYLE[i];
      const id = `insp-${group === 'pos' ? 'p' : group === 'scl' ? 's' : 'r'}${AXES[i]}`;
      const range =
        group === 'pos' ? { min: -2, max: 2, step: 0.01 }
          : group === 'scl' ? { min: 0.1, max: 4, step: 0.01 }
            : { min: -180, max: 180, step: 1 };
      return `
        <div class="flex items-center gap-2 mb-1">
          <span class="w-4 ${s.text} font-bold">${s.label}</span>
          <input id="${id}-range" type="range" min="${range.min}" max="${range.max}" step="${range.step}" value="0" class="flex-1 ${s.accent}">
          <input id="${id}" type="number" step="${range.step}" value="0" class="w-16 bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-center ${s.num}">
        </div>`;
    };
    const procRow = (id, label, step) =>
      `<div class="flex justify-between mb-1"><span>${label}:</span><input id="${id}" type="number" step="${step}" class="w-16 bg-slate-950 border border-slate-700 rounded text-center"></div>`;

    this.container.innerHTML = `
      <div class="pointer-events-auto rounded-xl border border-slate-700 bg-slate-900/95 p-3 flex flex-col gap-3 text-xs w-72 max-h-full overflow-y-auto shadow-xl">
        <div class="flex justify-between items-center pb-1">
          <span class="uppercase tracking-wider">Inspector</span>
          <span id="insp-title" class="text-sky-400 font-bold truncate max-w-[150px]">None</span>
        </div>

        <div class="flex mb-1 border-b border-slate-700">
          <button id="tab-transform" class="flex-1 py-1 text-sky-400 border-b-2 border-sky-400 font-bold transition-all cursor-pointer">Transforms</button>
          <button id="tab-gear" class="flex-1 py-1 text-slate-500 font-bold hover:text-slate-300 transition-all cursor-pointer">Gear</button>
          <button id="tab-icons" class="flex-1 py-1 text-slate-500 font-bold hover:text-slate-300 transition-all cursor-pointer">📸 Icons</button>
          <button id="tab-color" class="flex-1 py-1 text-slate-500 font-bold hover:text-slate-300 transition-all cursor-pointer">Colors</button>
          <button id="tab-import" class="flex-1 py-1 text-slate-500 font-bold hover:text-slate-300 transition-all cursor-pointer">Import</button>
        </div>

        <!-- TRANSFORMS TAB -->
        <div id="panel-transform" class="flex flex-col gap-2">
          <div id="insp-note" class="hidden rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">
            Procedural movement clip: tune the parameters below. Joint poses are not stored for walk / run / gallop.
          </div>

          <div id="insp-hand" class="hidden rounded border border-emerald-500/40 bg-emerald-500/10 p-2 flex flex-col gap-1.5">
            <div id="hand-title" class="font-bold text-emerald-300">Hand – all fingers</div>
            <label class="flex items-center gap-2"><span class="w-16 text-slate-300">Fingers</span><input id="hand-curl" type="range" min="0" max="100" value="0" class="flex-1 accent-emerald-400"></label>
            <label class="flex items-center gap-2"><span class="w-16 text-slate-300">Thumb</span><input id="hand-thumb" type="range" min="0" max="100" value="0" class="flex-1 accent-emerald-400"></label>
            <div class="flex gap-1"><button id="hand-open" type="button" class="flex-1 rounded border border-slate-600 bg-slate-800 py-1 text-slate-200 hover:bg-slate-700">Open</button><button id="hand-relax" type="button" class="flex-1 rounded border border-slate-600 bg-slate-800 py-1 text-slate-200 hover:bg-slate-700">Relaxed</button><button id="hand-fist" type="button" class="flex-1 rounded border border-slate-600 bg-slate-800 py-1 text-slate-200 hover:bg-slate-700">Fist</button></div>
            <div class="text-slate-500 leading-snug">One move for the whole hand. Each finger joint is still editable on its own in the timeline.</div>
          </div>

          <div class="flex gap-1">
            <button id="insp-btn-copy" class="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-1 rounded border border-slate-600">Copy Pose</button>
            <button id="insp-btn-paste" class="flex-1 bg-sky-900 hover:bg-sky-800 text-sky-200 py-1 rounded border border-sky-700 disabled:opacity-40">Paste Pose</button>
          </div>

          <div id="insp-fields" class="flex flex-col gap-1">
            <div class="flex flex-col mt-1">
              <div class="text-slate-400 font-semibold mb-1">Position (XYZ)</div>
              ${row('pos', 0)}${row('pos', 1)}${row('pos', 2)}
            </div>
            <div class="flex flex-col mt-1">
              <div class="text-slate-400 font-semibold mb-1">Rotation (degrees)</div>
              ${row('rot', 0)}${row('rot', 1)}${row('rot', 2)}
            </div>
            <div id="insp-scale-group" class="hidden flex flex-col mt-1">
              <div class="text-slate-400 font-semibold mb-1">Scale (Rig mode: size of the part)</div>
              <label class="flex items-center gap-2 mb-1"><span class="w-16 text-sky-300">All (X+Y+Z)</span>
                <input id="insp-su-range" type="range" min="0.1" max="4" step="0.01" value="1" class="flex-1 accent-sky-400">
                <input id="insp-su" type="number" min="0.1" max="4" step="0.01" value="1" class="w-16 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-slate-100"></label>
              ${row('scl', 0)}${row('scl', 1)}${row('scl', 2)}
            </div>
          </div>

          <div id="insp-key-container" class="hidden mt-1 rounded border border-rose-500/40 bg-rose-500/5 p-2">
            <div id="insp-key-title" class="text-rose-300 font-semibold mb-1">Keyframe</div>
            <div class="text-slate-400 mb-1">Easing (interpolation to the next key)</div>
            <select id="insp-easing" class="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-amber-300">
              <option value="smooth">Smooth (Default)</option>
              <option value="ease-in-out">Ease In / Out</option>
              <option value="linear">Linear</option>
            </select>
          </div>

          <div id="insp-procedural-container" class="hidden mt-1 border-t border-slate-700 pt-2">
            <div class="text-amber-400 font-semibold mb-1">Procedural Movement Params</div>
            ${procRow('insp-proc-freq', 'Speed', 0.1)}
            ${procRow('insp-proc-bob', 'Bounce', 0.01)}
            ${procRow('insp-proc-sway', 'Torso Sway', 0.01)}
            ${procRow('insp-proc-leg', 'Leg Swing', 0.01)}
            ${procRow('insp-proc-arm', 'Arm Swing', 0.01)}
          </div>
        </div>

        <!-- GEAR TAB (Armor, Clothing, Quivers & Stowed Weapon Placement; Hand Weapons are read-only for Units) -->
        <div id="panel-gear" class="hidden flex flex-col gap-1.5">
          <div id="insp-gear" class="flex flex-col gap-1.5"></div>
        </div>

        <!-- ICONS & PORTRAITS TAB (Pose-based 3D Portrait Capture, Built-in Icons & Map Placeholder Symbols) -->
        <div id="panel-icons" class="hidden flex flex-col gap-1.5">
          <div id="insp-icons" class="flex flex-col gap-1.5"></div>
        </div>

        <!-- COLORS TAB -->
        <!-- IMPORT TAB (GLB → unit / gear / building skin) -->
        <div id="panel-import" class="hidden flex flex-col gap-2">
          <div id="insp-import" class="flex flex-col gap-2"></div>
        </div>

        <div id="panel-color" class="hidden flex flex-col gap-2">
          <div class="text-slate-400 font-semibold mb-1">Pick Color Override (selected joint)</div>
          <input id="insp-color-picker" type="color" value="#888888" class="w-full h-10 rounded cursor-pointer bg-slate-950 border border-slate-700 mb-2">

          <button id="btn-col-current" class="rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold py-1.5 transition">Apply to Current (Skin + Class)</button>
          <button id="btn-col-class" class="rounded bg-sky-600 hover:bg-sky-500 text-slate-950 font-bold py-1.5 transition">Apply to Class (All Skins)</button>
          <button id="btn-col-faction" class="rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-1.5 transition">Apply to Faction (All Classes)</button>

          <button id="btn-col-clear" class="mt-2 rounded bg-slate-800 hover:bg-rose-900/80 text-white font-bold py-1.5 border border-slate-600 transition">Clear Color from Current</button>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    this._el('tab-transform').addEventListener('click', () => this.switchTab('transform'));
    this._el('tab-gear').addEventListener('click', () => this.switchTab('gear'));
    this._el('tab-icons').addEventListener('click', () => this.switchTab('icons'));
    this._el('tab-color').addEventListener('click', () => this.switchTab('color'));
    this._el('tab-import').addEventListener('click', () => this.switchTab('import'));

    const uni = (value) => {
      if (!this.activeTarget || !this.transformsEnabled || !(value > 0.01)) return;
      this.onForcePause?.();
      this.activeTarget.scale.set(value, value, value);
      this._el('insp-su').value = value.toFixed(3);
      this._el('insp-su-range').value = String(value);
      this.syncUI();
      const v = this._values();
      this.onTransformChange?.(v.pos, v.rot);
    };
    this._el('insp-su').addEventListener('input', (e) => uni(parseFloat(e.target.value)));
    this._el('insp-su-range').addEventListener('input', (e) => uni(parseFloat(e.target.value)));

    for (const f of FIELDS) {
      const num = this._el(f.id);
      const rng = this._el(`${f.id}-range`);
      num.addEventListener('input', () => this._onField(f, parseFloat(num.value), 'num'));
      rng.addEventListener('input', () => this._onField(f, parseFloat(rng.value), 'range'));
    }

    for (const f of PROC_FIELDS) {
      this._el(f.id).addEventListener('input', (e) => {
        if (!this.procClip) return;
        const v = parseFloat(e.target.value);
        if (Number.isNaN(v)) return;
        this.onProceduralChange?.(f.key, v);
      });
    }

    this._el('insp-easing').addEventListener('change', (e) => {
      if (this.keyContext) this.onEasingChange?.(e.target.value);
    });

    this._el('insp-btn-copy').addEventListener('click', () => {
      if (!this.activeTarget) return;
      const v = this._values();
      this.copied = this.rest
        ? {
            relative: true,
            pos: v.pos.map((x, i) => x - this.rest.pos[i]),
            rot: v.rot.map((x, i) => x - this.rest.rot[i])
          }
        : { relative: false, pos: v.pos, rot: v.rot };
      this._flash('insp-btn-copy', 'Copied');
    });

    this._el('insp-btn-paste').addEventListener('click', () => {
      if (!this.copied || !this.activeTarget || !this.transformsEnabled) return;
      this.onForcePause?.();
      const c = this.copied;
      const basePos = c.relative && this.rest ? this.rest.pos : [0, 0, 0];
      const baseRot = c.relative && this.rest ? this.rest.rot : [0, 0, 0];
      const pos = c.pos.map((x, i) => x + basePos[i]);
      const rot = c.rot.map((x, i) => x + baseRot[i]);
      this.activeTarget.position.set(...pos);
      this.activeTarget.rotation.set(...rot);
      this.syncUI();
      this.onTransformChange?.(pos, rot);
      this._flash('insp-btn-paste', 'Pasted');
    });

    const colorPicker = this._el('insp-color-picker');
    colorPicker.addEventListener('input', (e) => this.onColorPreview?.(e.target.value));
    this._el('btn-col-current').addEventListener('click', () =>
      this.onColorSave?.(colorPicker.value, 'current')
    );
    this._el('btn-col-class').addEventListener('click', () =>
      this.onColorSave?.(colorPicker.value, 'class')
    );
    this._el('btn-col-faction').addEventListener('click', () =>
      this.onColorSave?.(colorPicker.value, 'faction')
    );
    this._el('btn-col-clear').addEventListener('click', () => this.onColorSave?.(null, 'current'));
  }

  _onField(field, value, source) {
    if (!this.activeTarget || !this.transformsEnabled || Number.isNaN(value)) return;
    this.onForcePause?.();

    const key = AXES[field.axis];
    if (field.group === 'pos') this.activeTarget.position[key] = value;
    else if (field.group === 'scl') { if (value > 0.01) this.activeTarget.scale[key] = value; else return; }
    else this.activeTarget.rotation[key] = value * RAD;

    const twin = this._el(source === 'num' ? `${field.id}-range` : field.id);
    twin.value = source === 'num' ? String(value) : value.toFixed(field.group === 'rot' ? 1 : 3);

    const v = this._values();
    this.onTransformChange?.(v.pos, v.rot);
  }

  _flash(buttonId, text) {
    const btn = this._el(buttonId);
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = text;
    clearTimeout(btn._flashTimer);
    btn._flashTimer = setTimeout(() => {
      btn.textContent = original;
    }, 700);
  }
}
