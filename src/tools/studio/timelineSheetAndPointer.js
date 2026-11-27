/**
 * Kings Lands — Timeline Editor Dope Sheet Rendering, Scrubbing & Marquee Drag Handlers
 * (src/tools/studio/timelineSheetAndPointer.js)
 */
/**
 * Kings Lands — Studio timeline (src/tools/studio/timelineEditor.js)
 *
 * An After-Effects style dope sheet.
 *
 *   ruler            click / drag to move the playhead (the amber line)
 *   Events row       hit / release / footstep / sound / effect markers (draggable, Delete removes)
 *   per joint        a small header (▸/▾ collapses it) and, when open, a Rotation row and a Position row.
 *                    Each row has a STOPWATCH:
 *                      ◇ empty  = not animated: whatever you change stays for the WHOLE clip (a static value)
 *                      ◆ filled = animated: every change at the playhead writes / updates a keyframe there
 *                    clicking ◇ creates the first keyframe at the playhead; clicking ◆ removes all keyframes of that
 *                    property (the value at the playhead is kept as a static value).
 *                    Clicking a row selects it: Rotation -> rotate gizmo, Position -> move gizmo.
 *   keyframes        click selects (thin light-blue outline), Shift/Ctrl+click adds, drag on empty space draws a box.
 *                    Drag a selected key to move ALL selected keys together. Nothing is "selected" just because the
 *                    playhead stands on it.
 *   Delete           removes the selected keyframes (or the selected event, or the key under the playhead)
 *   Ctrl+C / Ctrl+V  copy the selected keyframes (or the selected row's values at the playhead) and paste them at the playhead
 *   Esc              clears the selection
 *
 * There is no Add/Update button: it is implied by the stopwatch. Nothing is "applied": every edit is written to the data
 * through the callbacks, which also decide which clip it lands on (copy-on-write per unit + faction).
 *
 * Callbacks
 *   getClipName(base) / getClip(base)         what is showing (read only, never creates anything)
 *   ensureClip(base)                          the clip to WRITE (creates the unit/faction copy on first edit)
 *   getProceduralClip(base) / getDefaultEventSocket(type) / getJointNames()
 *   onBeforeEdit(tag)                         called once before a change (undo snapshot)
 *   onRowSelected(joint, prop|null)           a joint / row was picked in the sheet (the app moves the gizmo there)
 *   onClipChanged(mode, base) / onScopeChanged(scope) / onPlayStateChanged(playing) / onScrub(t, mode, base)
 *   onResetJoint() / onRestartAnim(base) / onTimelineModified() / onDurationChanged()
 */

import { ACTION_CLIPS, MOVE_CLIPS } from './clipResolver.js';
import * as KT from './keyTracks.js';

const KEY_EPS = KT.EPS_T;       // playhead "is on" a keyframe when closer than this (normalised time)
const PAD = 7;                  // px of padding inside a track so keys at t=0 / t=1 are not clipped
const IDLE_DURATION = 2.0;
const DEFAULT_DURATION = 0.85;
const MAX_ZOOM = 12;
const TICK_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2];
const FPS = 30;                 // one "frame" of the step buttons

const round2 = (t) => Math.round(t * 100) / 100;
const round3 = (t) => Math.round(t * 1000) / 1000;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const byTime = (a, b) => a.time - b.time;
const clone = (o) => JSON.parse(JSON.stringify(o));
const leftCss = (t) => `calc(${PAD}px + (100% - ${PAD * 2}px) * ${t})`;
const isZero3 = (v) => !v || (Math.abs(v[0] || 0) < 1e-6 && Math.abs(v[1] || 0) < 1e-6 && Math.abs(v[2] || 0) < 1e-6);
const kid = (joint, prop, t) => `${joint}|${prop}|${Math.round(t * 1000)}`;

// Full class names (no string building) so Tailwind's scanner keeps them.
const EVENT_CLASS = {
  hit: 'bg-rose-500 text-white',
  release: 'bg-amber-400 text-slate-950',
  footstep: 'bg-emerald-600 text-white',
  sound: 'bg-violet-500 text-white',
  effect: 'bg-cyan-500 text-slate-950',
  swap: 'bg-fuchsia-500 text-white',
  hold: 'bg-sky-400 text-slate-950'
};
const EASING_CLASS = { 'ease-in-out': 'bg-purple-400', linear: 'bg-slate-400' };
const PROP_LABEL = { rot: 'Rotation', pos: 'Position' };
const BTN_DISABLED = 'disabled:opacity-40 disabled:cursor-not-allowed';
const T_BTN = 'flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700';

const SVG = (inner, extra = '') => `<svg viewBox="0 0 16 16" class="h-4 w-4 ${extra}" fill="currentColor" aria-hidden="true">${inner}</svg>`;
const ICON = {
  play: SVG('<path d="M4 2.5v11l9-5.5z"/>', 'text-emerald-400'),
  stop: SVG('<rect x="3.5" y="3.5" width="9" height="9" rx="1"/>', 'text-rose-500'),
  start: SVG('<path d="M3 2.5h1.7v11H3zM13 2.5v11L5.6 8z"/>'),
  end: SVG('<path d="M11.3 2.5H13v11h-1.7zM3 2.5v11L10.4 8z"/>'),
  prev: SVG('<path d="M10.5 3 5.5 8l5 5" fill="none" stroke="currentColor" stroke-width="2"/>'),
  next: SVG('<path d="M5.5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2"/>')
};


export const timelineSheetAndPointerMethods = {
  _renderUI() {
    const keyable = this.canKeyframe();
    const eventsOk = this.animMode === 'keyframes';
    const scopeOn = 'bg-amber-500 text-slate-950';
    const scopeOff = 'bg-slate-800 text-slate-300 hover:bg-slate-700';

    this.container.innerHTML = `
      <div class="flex flex-col gap-2 bg-slate-900/95 border-t border-slate-700/80 px-4 py-2 text-xs">

        <div class="flex flex-wrap items-center gap-2">
          ${this.isBuildingSession
            ? `<span class="rounded bg-emerald-500/20 border border-emerald-400/50 px-2.5 py-1 text-emerald-300 font-extrabold">🏰 Building Animation Session</span><select id="tl-mode-select" class="hidden"><option value="keyframes" selected>Action (Keyframes)</option></select>`
            : `<select id="tl-mode-select" class="rounded bg-slate-800 border border-slate-600 px-2 py-1 text-slate-100 font-bold">
                <option value="keyframes" ${this.animMode === 'keyframes' ? 'selected' : ''}>Action (Keyframes)</option>
                <option value="procedural" ${this.animMode === 'procedural' ? 'selected' : ''}>Movement (Procedural)</option>
              </select>`
          }
          <select id="tl-clip-select" class="rounded bg-slate-800 border border-slate-600 px-2.5 py-1 font-semibold text-sky-300">
            ${this.clipList.map((n) => { const lbl = this.callbacks.getClipLabel?.(n) || n; const note = this.callbacks.getActionNote?.(n) || ''; return `<option value="${n}" ${n === this.activeBaseName ? 'selected' : ''}>${lbl}${note}</option>`; }).join('')}
          </select>

          <div id="tl-variants-bar" class="flex items-center gap-1 rounded border border-slate-700 bg-slate-950/70 px-1.5 py-0.5" title="וריאציות לאנימציה ומשקל ההסתברות של כל וריאציה במשחק">
            <span class="text-[10px] text-slate-400 mr-0.5">Var:</span>
            ${(this.callbacks.getVariantIndices?.(this.activeBaseName) || [1]).map((vIdx) => {
              const pct = this.callbacks.getVariantProbabilityPct?.(this.activeBaseName, vIdx);
              const pctStr = pct !== undefined && pct < 100 ? ` (${pct}%)` : '';
              return `<button type="button" class="tl-var-btn rounded px-1.5 py-0.5 text-[11px] font-bold ${vIdx === this.activeVariantIdx ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}" data-var="${vIdx}">v${vIdx}${pctStr}</button>`;
            }).join('')}
            <button type="button" id="tl-btn-add-var" class="rounded border border-dashed border-emerald-500/60 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/20" title="הוסף וריאציה חדשה לאנימציה הזו (+v2, v3...)">+ Var</button>
            ${(this.callbacks.getVariantIndices?.(this.activeBaseName) || [1]).length > 1 ? `
              <span class="text-[10px] text-slate-400 ml-1" title="משקל יחסי לבחירה רנדומלית (למשל 70 מול 30)">משקל:</span>
              <input id="tl-var-weight" type="number" min="1" max="1000" step="5" value="${this.callbacks.getVariantWeight?.(this.activeBaseName, this.activeVariantIdx) ?? (this.activeVariantIdx === 1 ? 70 : 30)}" class="mono w-12 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-center text-[11px] text-amber-300" title="משקל הסתברות לווריאציה הנוכחית" />
            ` : ''}
            ${this.activeVariantIdx > 1 ? `<button type="button" id="tl-btn-del-var" class="rounded border border-rose-500/50 bg-rose-500/10 px-1.5 py-0.5 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20" title="מחק את הווריאציה הנוכחית (v${this.activeVariantIdx})">×</button>` : ''}
          </div>

          <div class="flex rounded border border-slate-600 overflow-hidden" title="Where your edits are written">
            <button id="tl-scope-unit" class="px-2 py-1 font-semibold ${this.scope === 'unit' ? scopeOn : scopeOff}" title="Edit a copy that belongs to this unit + faction only">This unit</button>
            <button id="tl-scope-global" class="px-2 py-1 font-semibold ${this.scope === 'global' ? scopeOn : scopeOff}" title="Edit the shared clip (affects every unit without its own copy)">Global</button>
          </div>

          <div class="flex items-center gap-1">
            <button id="tl-btn-start" class="${T_BTN}" title="Go to start">${ICON.start}</button>
            <button id="tl-btn-prev" class="${T_BTN}" title="Previous frame (←)">${ICON.prev}</button>
            <button id="tl-btn-play" class="${T_BTN}" title="Play / Stop (Space)">${this.isPlaying ? ICON.stop : ICON.play}</button>
            <button id="tl-btn-next" class="${T_BTN}" title="Next frame (→)">${ICON.next}</button>
            <button id="tl-btn-end" class="${T_BTN}" title="Go to end">${ICON.end}</button>
          </div>
          <select id="tl-speed" class="rounded bg-slate-800 border border-slate-600 px-1.5 py-1 text-slate-200" title="Playback speed">
            ${[0.25, 0.5, 1, 2].map((s) => `<option value="${s}" ${s === this.playbackSpeed ? 'selected' : ''}>${s}x</option>`).join('')}
          </select>

          <span id="tl-time-readout" class="mono ml-auto font-semibold text-sky-300">t = 0.00</span>
          <button id="tl-btn-minimize" class="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700" title="Hide / show the keyframe sheet">${this.minimized ? '▴ Show sheet' : '▾ Hide sheet'}</button>
        </div>

        <div id="tl-body" class="${this.minimized ? 'hidden' : 'flex'} flex-col gap-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <button id="tl-btn-del" ${keyable ? '' : 'disabled'} class="rounded bg-slate-800 hover:bg-rose-900/80 border border-slate-600 px-3 py-1 text-slate-200 ${BTN_DISABLED}" title="Delete the selected keyframes / event (Del)">Delete</button>
            <button id="tl-btn-reset-joint" ${keyable ? '' : 'disabled'} class="rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 px-3 py-1 text-slate-200 ${BTN_DISABLED}" title="Put the selected joint back to its rest pose">Reset Joint</button>
            <div class="h-4 w-px bg-slate-700 mx-1"></div>
            <select id="tl-event-type" ${eventsOk ? '' : 'disabled'} class="rounded bg-slate-800 border border-slate-600 px-2 py-1 text-amber-200 ${BTN_DISABLED}">
              <option value="hit">hit</option><option value="release">release</option><option value="footstep">footstep</option><option value="sound">sound</option><option value="effect">effect</option><option value="swap">swap</option><option value="hold">hold (aim pose)</option>
            </select>
            <button id="tl-btn-add-event" ${eventsOk ? '' : 'disabled'} class="rounded bg-amber-600/90 hover:bg-amber-500 px-2 py-1 font-semibold text-slate-950 ${BTN_DISABLED}">Add Event</button>
            <div class="h-4 w-px bg-slate-700 mx-1"></div>
            <button id="tl-btn-close-loop" ${keyable ? '' : 'disabled'} class="rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 px-2 py-1 text-slate-200 ${BTN_DISABLED}" title="Make the last frame equal the first frame, so the clip loops without a jump">Close loop</button>
            <button id="tl-btn-mirror" ${keyable ? '' : 'disabled'} class="rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 px-2 py-1 text-slate-200 ${BTN_DISABLED}" title="Copy the selected joint's animation to its other side (${this.isBuildingSession ? 'Door leaf L ↔ Door leaf R' : 'arm_L ↔ arm_R'}), mirrored. Shift+click = every joint on that side">Mirror L↔R</button>
            <div class="flex items-center gap-0.5" title="Timeline zoom (Ctrl + mouse wheel)">
              <button id="tl-zoom-out" class="${T_BTN}">−</button>
              <span id="tl-zoom-label" class="mono w-8 text-center text-slate-300">${this.zoom.toFixed(this.zoom % 1 ? 1 : 0)}x</span>
              <button id="tl-zoom-in" class="${T_BTN}">+</button>
              <button id="tl-zoom-fit" class="rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 px-1.5 py-1 text-slate-300">Fit</button>
            </div>
            <div class="h-4 w-px bg-slate-700 mx-1"></div>
            <label class="flex items-center gap-1 cursor-pointer text-slate-300" title="Hide joints that have no animated property">
              <input id="tl-only-animated" type="checkbox" ${this.onlyAnimated ? 'checked' : ''} class="accent-sky-400" /> Show only animated
            </label>
            <button id="tl-btn-restart-anim" class="ml-auto rounded bg-slate-700 hover:bg-slate-600 border border-slate-500 px-3 py-1 font-bold text-slate-200" title="Reset this clip to the default">Restart Anim</button>
          </div>

          <div id="tl-sheet" class="max-h-[30vh] overflow-auto rounded border border-slate-800 bg-slate-950/90">
            <div id="tl-rows" style="width:${this.zoom * 100}%"></div>
          </div>
        </div>
      </div>
    `;

    const q = (sel) => this.container.querySelector(sel);
    this.el = {
      modeSelect: q('#tl-mode-select'), clipSelect: q('#tl-clip-select'),
      scopeUnit: q('#tl-scope-unit'), scopeGlobal: q('#tl-scope-global'),
      duration: q('#tl-duration-input'), playBtn: q('#tl-btn-play'), speed: q('#tl-speed'),
      start: q('#tl-btn-start'), prev: q('#tl-btn-prev'), next: q('#tl-btn-next'), end: q('#tl-btn-end'),
      readout: q('#tl-time-readout'), minimize: q('#tl-btn-minimize'), body: q('#tl-body'),
      del: q('#tl-btn-del'), resetJoint: q('#tl-btn-reset-joint'),
      eventType: q('#tl-event-type'), addEvent: q('#tl-btn-add-event'), restart: q('#tl-btn-restart-anim'),
      onlyAnimated: q('#tl-only-animated'),
      sheet: q('#tl-sheet'), rows: q('#tl-rows'),
      closeLoop: q('#tl-btn-close-loop'), mirror: q('#tl-btn-mirror'),
      zoomIn: q('#tl-zoom-in'), zoomOut: q('#tl-zoom-out'), zoomFit: q('#tl-zoom-fit'), zoomLabel: q('#tl-zoom-label')
    };

    this._bindUIEvents();
    this._renderSheet();
    this._syncPlayheadUI();
  },

  _syncPlayButton() {
    if (this.el.playBtn) this.el.playBtn.innerHTML = this.isPlaying ? ICON.stop : ICON.play;
  },

  _bindUIEvents() {
    const el = this.el;

    el.modeSelect.addEventListener('change', (e) => {
      this.animMode = e.target.value;
      this.activeBaseName = this.clipList[0];
      this.activeVariantIdx = 1;
      this._afterClipChange();
    });
    el.clipSelect.addEventListener('change', (e) => {
      this.activeBaseName = e.target.value;
      this.activeVariantIdx = 1;
      this._afterClipChange();
    });
    const varBar = this.container.querySelector('#tl-variants-bar');
    varBar?.addEventListener('click', (e) => {
      const vBtn = e.target.closest('.tl-var-btn');
      if (vBtn) {
        const nextV = Number(vBtn.dataset.var) || 1;
        if (nextV !== this.activeVariantIdx) {
          this.activeVariantIdx = nextV;
          this._afterClipChange();
        }
        return;
      }
      if (e.target.closest('#tl-btn-add-var')) {
        const createdIdx = this.callbacks.onAddVariant?.(this.activeBaseName, this.activeVariantIdx);
        if (createdIdx) {
          this.activeVariantIdx = createdIdx;
          this._afterClipChange();
        }
        return;
      }
      if (e.target.closest('#tl-btn-del-var')) {
        if (this.callbacks.onDeleteVariant?.(this.activeBaseName, this.activeVariantIdx)) {
          this.activeVariantIdx = 1;
          this._afterClipChange();
        }
      }
    });
    const varWeightInput = this.container.querySelector('#tl-var-weight');
    varWeightInput?.addEventListener('change', (e) => {
      const val = Math.max(1, Math.min(1000, Number(e.target.value) || 50));
      this.callbacks.onVariantWeightChanged?.(this.activeBaseName, this.activeVariantIdx, val);
      this._renderUI();
    });
    el.scopeUnit.addEventListener('click', () => this._setScope('unit'));
    el.scopeGlobal.addEventListener('click', () => this._setScope('global'));

    el.playBtn.addEventListener('click', () => this.togglePlay());
    el.start.addEventListener('click', () => this.goToStart());
    el.end.addEventListener('click', () => this.goToEnd());
    el.prev.addEventListener('click', () => this.step(-1));
    el.next.addEventListener('click', () => this.step(1));
    el.speed.addEventListener('change', (e) => { this.playbackSpeed = parseFloat(e.target.value) || 1; });
    el.duration?.addEventListener('change', (e) => this._onDurationChange(e));

    el.minimize.addEventListener('click', () => {
      this.minimized = !this.minimized;
      el.body.classList.toggle('hidden', this.minimized);
      el.body.classList.toggle('flex', !this.minimized);
      el.minimize.textContent = this.minimized ? '▴ Show sheet' : '▾ Hide sheet';
    });
    el.onlyAnimated.addEventListener('change', (e) => { this.onlyAnimated = e.target.checked; this._renderSheet(); });

    el.closeLoop.addEventListener('click', () => {
      const n = this.closeLoop();
      this.callbacks.onNotice?.(n ? `Loop closed (${n} propert${n === 1 ? 'y' : 'ies'} now end where they start)` : 'Already a clean loop');
    });
    el.mirror.addEventListener('click', (e) => {
      const n = this.mirror(e.shiftKey ? 'side' : 'joint');
      this.callbacks.onNotice?.(n ? `Mirrored ${n} joint${n === 1 ? '' : 's'} to the other side` : 'Nothing to mirror: select an animated joint that ends in _L / _R');
    });
    el.zoomIn.addEventListener('click', () => this.setZoom(this.zoom * 1.5));
    el.zoomOut.addEventListener('click', () => this.setZoom(this.zoom / 1.5));
    el.zoomFit.addEventListener('click', () => this.setZoom(1));
    el.sheet.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.sheet.getBoundingClientRect();
      const frac = (el.sheet.scrollLeft + (e.clientX - r.left)) / Math.max(1, el.sheet.scrollWidth);
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.25 : 0.8), frac);
      // keep the point under the cursor roughly under the cursor
      el.sheet.scrollLeft = Math.max(0, frac * el.sheet.scrollWidth - (e.clientX - r.left));
    }, { passive: false });

    el.del.addEventListener('click', () => this.deleteSelection());
    el.resetJoint.addEventListener('click', () => this.callbacks.onResetJoint?.());
    el.addEvent.addEventListener('click', () => this.addEvent(el.eventType.value));
    el.restart.addEventListener('click', () => this.callbacks.onRestartAnim?.(this.activeBaseName));

    el.rows.addEventListener('pointerdown', (e) => this._onRowsPointerDown(e));
    el.rows.addEventListener('click', (e) => this._onRowsClick(e));
  },

  /** Jump to a clip (used by the health check). `scope` = 'unit' | 'global' | null (keep). */
  showBase(base, scope = null) {
    this.animMode = (!this.isBuildingSession && MOVE_CLIPS.includes(base)) ? 'procedural' : 'keyframes';
    this.activeBaseName = this.clipList.includes(base) ? base : this.clipList[0];
    if (scope === 'unit' || scope === 'global') this.scope = scope;
    this._afterClipChange();
    this.callbacks.onScopeChanged?.(this.scope);
  },

  _afterClipChange() {
    this.selectedEventIdx = null;
    this.selectedRow = null;
    this.selectedKeys = new Set();
    this.scrubNormTime = 0;
    this.drag = null;
    this._renderUI();
    this.callbacks.onClipChanged?.(this.animMode, this.activeBaseName);
  },

  _setScope(scope) {
    if (this.scope === scope) return;
    this.scope = scope;
    this.selectedEventIdx = null;
    this.selectedKeys = new Set();
    this.drag = null;
    this._renderUI();
    this.callbacks.onScopeChanged?.(scope);
  },

  _onDurationChange(e) {
    const val = parseFloat(e.target.value);
    if (!(val > 0)) { e.target.value = String(this.getDuration()); return; }
    const old = this.getDuration();
    if (Math.abs(old - val) < 1e-6) return;

    const stretch = confirm(
      `Change length ${old}s -> ${val}s.\n\n` +
      'OK = stretch/squash the keyframes with it (same animation, just slower/faster)\n' +
      'Cancel = keep every keyframe at its current time in seconds (pad / crop)'
    );
    this._before('duration');
    const clip = this.getWriteClip();
    if (!clip) return;
    if (!stretch) {
      const ratio = old / val;
      for (const track of Object.values(clip.tracks || {})) {
        track.forEach((kf) => { kf.t = clamp01(kf.t * ratio); });
        KT.resync(track);
      }
      (clip.events || []).forEach((ev) => { ev.time = clamp01(ev.time * ratio); });
      this.selectedKeys = new Set();
    }
    clip.duration = val;
    this.refresh();
    this._modified();
    this.callbacks.onDurationChanged?.();
  },

  _eventsForDisplay() {
    if (this.animMode === 'keyframes') return { events: this.getReadClip()?.events || [], editable: true };
    return { events: this.callbacks.getProceduralClip?.(this.activeBaseName)?.events || [], editable: false };
  },

  /** parent map {joint: parent|null} for the shown joints (flat when the app gives no tree). */
  _parents() {
    const all = this.callbacks.getJointNames ? this.callbacks.getJointNames() : [];
    const par = this.callbacks.getJointParents ? this.callbacks.getJointParents() : {};
    const out = {};
    for (const n of all) out[n] = par[n] && all.includes(par[n]) ? par[n] : null;
    return out;
  },

  /** Open a joint and everything above it, so it is visible in the tree. */
  _reveal(joint) {
    if (!joint) return;
    this.expanded.add(joint);
    for (const a of this._ancestors(joint, this._parents())) this.expanded.add(a);
  },

  _ancestors(joint, par) {
    const list = [];
    let p = par[joint];
    while (p) { list.push(p); p = par[p]; }
    return list;
  },

  /** Rows to show, as [{name, depth, hasKids}] in tree order. A joint's children appear only while its tree is open. */
  _visibleJoints() {
    const tracks = this.getReadClip()?.tracks || {};
    const all = this.callbacks.getJointNames ? this.callbacks.getJointNames() : Object.keys(tracks);
    const par = this._parents();
    const kids = {};
    for (const n of all) if (par[n]) (kids[par[n]] = kids[par[n]] || []).push(n);
    const animated = (j) => KT.PROPS.some((p) => KT.isAnimated(tracks[j], p));
    const hasAnimatedBelow = (j) => (kids[j] || []).some((k) => animated(k) || hasAnimatedBelow(k));
    const forceOpen = new Set(this.selectedJointName ? this._ancestors(this.selectedJointName, par) : []);
    const out = [];
    const walk = (n, depth) => {
      const show = !this.onlyAnimated || n === this.selectedJointName || animated(n) || hasAnimatedBelow(n);
      if (show) out.push({ name: n, depth, hasKids: (kids[n] || []).length > 0 });
      const open = this.expanded.has(n) || forceOpen.has(n) || (this.onlyAnimated && hasAnimatedBelow(n));
      if (open || !show) for (const k of kids[n] || []) walk(k, depth + 1);
    };
    for (const n of all) if (!par[n]) walk(n, 0);
    return out;
  },

  _rulerHtml() {
    const dur = this.getDuration();
    let step = TICK_STEPS[TICK_STEPS.length - 1];
    for (const s of TICK_STEPS) { if (dur / s <= 14 * this.zoom) { step = s; break; } }
    const ticks = [];
    for (let s = 0; s <= dur + 1e-6; s += step) {
      const t = clamp01(s / dur);
      const label = `${Number(s.toFixed(2))}s`;
      ticks.push(
        `<div class="absolute top-0 bottom-0 w-px bg-slate-700" style="left:${leftCss(t)}"></div>` +
        `<div class="mono absolute top-0 -translate-x-1/2 text-[9px] text-slate-500 pointer-events-none" style="left:${leftCss(t)}">${label}</div>`
      );
    }
    return ticks.join('');
  },

  _row(labelHtml, innerHtml, { cls = '', phMarker = false, height = 'h-5', kind = 'prop' } = {}) {
    const marker = phMarker ? '<div class="absolute -top-0 -left-1 w-2 h-2 bg-amber-400 rotate-45"></div>' : '';
    return `
      <div class="flex items-stretch border-b border-slate-800/90 ${cls}">
        <div class="tl-label sticky left-0 z-40 w-44 shrink-0 flex items-center gap-1 px-2 border-r border-slate-800 bg-slate-900">${labelHtml}</div>
        <div class="tl-track relative flex-1 ${height} cursor-crosshair touch-none select-none" data-kind="${kind}">
          ${innerHtml}
          <div class="tl-ph absolute top-0 bottom-0 w-px bg-amber-400 pointer-events-none z-20" style="left:${leftCss(this.scrubNormTime)}">${marker}</div>
        </div>
      </div>`;
  },

  _diamond(joint, prop, track, key) {
    const bg = EASING_CLASS[key.easing] || 'bg-sky-400';
    const on = this.selectedKeys.has(kid(joint, prop, key.t));
    const ring = on ? 'border-sky-200 ring-1 ring-sky-200' : 'border-slate-950';
    return `<div class="kf absolute top-1/2 -mt-[5px] -translate-x-1/2 w-2.5 h-2.5 rotate-45 ${bg} border ${ring} cursor-grab hover:scale-125 z-10" data-joint="${joint}" data-prop="${prop}" data-i="${track.indexOf(key)}" data-t="${key.t}" title="${this._jointLabel(joint)} · ${PROP_LABEL[prop]}  t=${key.t.toFixed(2)}" style="left:${leftCss(key.t)}"></div>`;
  },

  /** Rebuild the rows (keeps the scroll position because the scroller itself is not replaced). */
  _renderSheet() {
    const host = this.el.rows;
    if (!host) return;
    host.style.width = `${this.zoom * 100}%`;
    const parts = [];

    parts.push(this._row(
      '<span class="mono text-[10px] text-slate-500 flex-1">Time</span>' +
      '<button type="button" id="tl-btn-collapse" class="tl-collapse-all rounded px-1.5 text-sm leading-none text-slate-300 hover:bg-slate-700" title="Close every joint">⇈</button>' +
      '<button type="button" id="tl-btn-expand" class="tl-expand-all rounded px-1.5 text-sm leading-none text-slate-300 hover:bg-slate-700" title="Open every joint">⇊</button>',
      this._rulerHtml(), {
      cls: 'sticky top-0 z-30 bg-slate-900 border-b border-slate-700', phMarker: true, height: 'h-5', kind: 'ruler'
    }));

    const { events, editable } = this._eventsForDisplay();
    const evHtml = events.map((ev, i) => {
      const color = EVENT_CLASS[ev.type] || 'bg-slate-500 text-white';
      const selected = editable && i === this.selectedEventIdx ? 'ring-1 ring-sky-200' : '';
      const mode = editable ? 'cursor-ew-resize z-10' : 'pointer-events-none opacity-70';
      return `<div class="ev-marker mono absolute top-1 -translate-x-1/2 px-1 rounded text-[9px] font-bold ${color} ${selected} ${mode}" data-i="${i}" data-editable="${editable ? 1 : 0}" title="${ev.type} @ ${Number(ev.time).toFixed(2)}" style="left:${leftCss(ev.time)}">${ev.type}</div>`;
    }).join('');
    parts.push(this._row('<span class="text-[10px] font-bold uppercase tracking-wider text-amber-400">Events</span>', evHtml, { height: 'h-6', kind: 'events' }));

    if (this.canKeyframe()) {
      for (const { name: joint, depth, hasKids } of this._visibleJoints()) {
        const track = this._track(joint) || [];
        const jointSel = joint === this.selectedJointName;
        const open = this.expanded.has(joint);
        const animated = KT.PROPS.some((p) => KT.isAnimated(track, p));

        // compact joint header: ▸/▾ + name; when closed it also shows a faint summary of both properties' keys
        const summaryTimes = new Set();
        let summary = '';
        if (!open) {
          for (const p of KT.PROPS) for (const k of KT.ownedKeys(track, p)) {
            const ms = Math.round(k.t * 1000);
            if (summaryTimes.has(ms)) continue;
            summaryTimes.add(ms);
            summary += `<div class="absolute top-1/2 -mt-[3px] -translate-x-1/2 w-1.5 h-1.5 rotate-45 bg-slate-500 pointer-events-none" style="left:${leftCss(k.t)}"></div>`;
          }
        }
        const head =
          `<span style="width:${depth * 10}px" class="shrink-0"></span>` +
          `<button type="button" class="tl-chev w-3 text-center text-[10px] leading-none text-slate-400 hover:text-white" data-joint="${joint}" title="${open ? 'Close' : 'Open'}${hasKids ? ' (rotation, position and the parts under it)' : ''}">${open ? '▾' : '▸'}</button>` +
          `<button type="button" class="tl-joint mono truncate flex-1 text-left text-[11px] font-bold ${jointSel ? 'text-sky-300' : 'text-slate-300 hover:text-white'}" data-joint="${joint}">${this._jointLabel(joint)}</button>` +
          (animated ? '<span class="text-[9px] text-sky-400" title="Has animated properties">◆</span>' : '');
        parts.push(this._row(head, summary, {
          cls: `${jointSel ? 'bg-sky-500/10' : 'bg-slate-900/60'} border-t border-slate-700`, height: 'h-4', kind: 'joint'
        }));

        if (!open) continue;
        for (const prop of KT.PROPS) {
          if (prop === 'pos' && this.callbacks.isPosLocked?.(joint)) continue;   // joint rules: this joint only rotates
          const isAnim = KT.isAnimated(track, prop);
          const rowSel = this.selectedRow && this.selectedRow.joint === joint && this.selectedRow.prop === prop;
          const glyph = isAnim ? '◆' : '◇';
          const glyphCls = isAnim ? 'text-sky-300' : 'text-slate-500 hover:text-slate-200';
          const label =
            `<span style="width:${depth * 10}px" class="shrink-0"></span><span class="w-3"></span>` +
            `<button type="button" class="tl-sw w-4 text-center text-sm leading-none ${glyphCls}" data-joint="${joint}" data-prop="${prop}" title="${isAnim ? 'Animated – click to remove all keyframes' : 'Static – click to start animating here'}">${glyph}</button>` +
            `<button type="button" class="tl-rowlabel truncate text-left text-[11px] ${rowSel ? 'text-sky-200 font-semibold' : 'text-slate-400'}" data-joint="${joint}" data-prop="${prop}" title="${prop === 'pos' ? 'Move gizmo' : 'Rotate gizmo'}">${PROP_LABEL[prop]}</button>`;
          const inner = isAnim
            ? KT.ownedKeys(track, prop).map((k) => this._diamond(joint, prop, track, k)).join('')
            : '';
          parts.push(this._row(label, inner, { cls: rowSel ? 'bg-sky-500/10' : '', height: 'h-5', kind: 'prop' }));
        }
      }
    } else {
      parts.push('<div class="px-3 py-2 text-slate-500">Walk / Run / Gallop are procedural: tune them in the Inspector, no keyframes.</div>');
    }

    host.innerHTML = parts.join('');
    this._phEls = host.querySelectorAll('.tl-ph');
  },

  _syncPlayheadUI() {
    const left = leftCss(this.scrubNormTime);
    if (this._phEls) this._phEls.forEach((el) => { el.style.left = left; });
    if (this.zoom > 1 && this.isPlaying && this.el.sheet) {
      const sh = this.el.sheet;
      const x = this.scrubNormTime * sh.scrollWidth;
      if (x < sh.scrollLeft + 180 || x > sh.scrollLeft + sh.clientWidth - 20) sh.scrollLeft = Math.max(0, x - 200);
    }
    if (this.el.readout) {
      const sec = this.scrubNormTime * this.getDuration();
      this.el.readout.textContent = `t = ${this.scrubNormTime.toFixed(2)}  ·  ${sec.toFixed(2)}s`;
    }
  },

  // ------------------------------------------------------------------ pointer interaction

  _xToT(clientX) {
    const track = this.el.rows?.querySelector('.tl-track');
    if (!track) return this.scrubNormTime;
    const r = track.getBoundingClientRect();
    return clamp01(round2((clientX - r.left - PAD) / Math.max(1, r.width - PAD * 2)));
  },

  /** Pick a joint (and optionally a row). The app moves the gizmo there; Rotation row = rotate, Position row = move. */
  _selectRow(joint, prop) {
    this.selectedRow = prop ? { joint, prop } : null;
    this.selectedJointName = joint;
    this._reveal(joint);
    this._renderSheet();
    this.callbacks.onRowSelected?.(joint, prop || null);
  },

  _onRowsClick(e) {
    const sw = e.target.closest('.tl-sw');
    if (sw) { this.forcePause(); this.toggleProp(sw.dataset.joint, sw.dataset.prop); return; }
    if (e.target.closest('.tl-collapse-all')) { this.expanded = new Set(); this._renderSheet(); return; }
    if (e.target.closest('.tl-expand-all')) {
      const all = this.callbacks.getJointNames ? this.callbacks.getJointNames() : [];
      all.forEach((j) => this.expanded.add(j));
      this._renderSheet(); return;
    }
    const chev = e.target.closest('.tl-chev');
    if (chev) {
      const j = chev.dataset.joint;
      if (this.expanded.has(j)) this.expanded.delete(j); else this.expanded.add(j);
      this._renderSheet();
      return;
    }
    const label = e.target.closest('.tl-rowlabel');
    if (label) {
      if (label.dataset.joint !== this.selectedJointName) this.selectedKeys = new Set();
      this._selectRow(label.dataset.joint, label.dataset.prop);
      return;
    }
    const jointBtn = e.target.closest('.tl-joint');
    if (jointBtn) {
      if (jointBtn.dataset.joint !== this.selectedJointName) this.selectedKeys = new Set();
      this._selectRow(jointBtn.dataset.joint, null);
    }
  },

  _onRowsPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.tl-sw, .tl-rowlabel, .tl-joint, .tl-chev, .tl-collapse-all, .tl-expand-all')) return;   // handled by click
    const trackEl = e.target.closest('.tl-track');
    if (!trackEl) return;
    e.preventDefault();
    this.forcePause();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    const kfEl = e.target.closest('.kf');
    const evEl = e.target.closest('.ev-marker');

    if (kfEl && this.canKeyframe()) {
      const { joint, prop } = kfEl.dataset;
      const key = this._track(joint)?.[Number(kfEl.dataset.i)];
      if (key) {
        const id = kid(joint, prop, key.t);
        this.selectedEventIdx = null;
        let collapseOnClick = false;
        if (additive) {
          if (this.selectedKeys.has(id)) this.selectedKeys.delete(id); else this.selectedKeys.add(id);
        } else if (!this.selectedKeys.has(id)) {
          this.selectedKeys = new Set([id]);
        } else {
          collapseOnClick = this.selectedKeys.size > 1;   // a plain click inside a group selects just this key on release
        }
        this._selectRow(joint, prop);
        if (!this.selectedKeys.has(id)) return;           // it was toggled off: nothing to drag
        this.drag = {
          type: 'kf', joint, prop, id, startX: e.clientX, startT: this._xToT(e.clientX), moved: false, t0: key.t, curT: key.t,
          items: this._selectedItems().map((i) => ({ joint: i.joint, prop: i.prop, t: i.t })), collapseOnClick
        };
        return;
      }
    }
    if (evEl && evEl.dataset.editable === '1') {
      const idx = Number(evEl.dataset.i);
      const ev = this.getReadClip()?.events?.[idx];
      if (ev) {
        this.selectedEventIdx = idx;
        this.selectedKeys = new Set();
        this.drag = { type: 'ev', idx, startX: e.clientX, moved: false, ev, clip: null };
        this._renderSheet();
        return;
      }
    }

    if (trackEl.dataset.kind === 'prop') {
      // empty space of a property row: a click scrubs, a drag draws a selection box
      this.drag = { type: 'pending', startX: e.clientX, startY: e.clientY, additive, base: additive ? new Set(this.selectedKeys) : new Set(), moved: false };
      return;
    }

    if (this.selectedEventIdx !== null || this.selectedKeys.size) {
      this.selectedEventIdx = null;
      if (!additive) this.selectedKeys = new Set();
      this._renderSheet();
    }
    this.drag = { type: 'scrub' };
    this.seek(this._xToT(e.clientX));
  },

  _marqueeRect(d, e) {
    return {
      left: Math.min(d.startX, e.clientX), right: Math.max(d.startX, e.clientX),
      top: Math.min(d.startY, e.clientY), bottom: Math.max(d.startY, e.clientY)
    };
  },

  _drawMarquee(r) {
    if (!this._marqueeEl) {
      this._marqueeEl = document.createElement('div');
      this._marqueeEl.className = 'pointer-events-none fixed z-50 border border-sky-300 bg-sky-300/10';
      document.body.appendChild(this._marqueeEl);
    }
    Object.assign(this._marqueeEl.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
  },

  _removeMarquee() {
    this._marqueeEl?.remove();
    this._marqueeEl = null;
  },

  _onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (d.type === 'scrub') { this.seek(this._xToT(e.clientX)); return; }

    if (d.type === 'pending') {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
      d.type = 'marquee';
      d.moved = true;
    }
    if (d.type === 'marquee') {
      const r = this._marqueeRect(d, e);
      this._drawMarquee(r);
      const sel = new Set(d.base);
      this.el.rows.querySelectorAll('.kf').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.right >= r.left && b.left <= r.right && b.bottom >= r.top && b.top <= r.bottom) {
          sel.add(kid(el.dataset.joint, el.dataset.prop, Number(el.dataset.t)));
        }
      });
      this.selectedKeys = sel;
      this._applySelectionClasses();
      return;
    }

    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < 3) return;
      d.moved = true;
      this._before(d.type === 'kf' ? 'key-drag' : 'event-drag');
      const clip = this.getWriteClip();            // first real movement: this is where the unit/faction copy is made
      if (!clip) { this.drag = null; return; }
      if (d.type === 'kf') {
        d.orig = {};
        for (const it of d.items) {
          if (!clip.tracks?.[it.joint]) { this.drag = null; return; }
          if (!d.orig[it.joint]) d.orig[it.joint] = clone(clip.tracks[it.joint]);
        }
        d.clip = clip;
      } else {
        d.clip = clip;
        d.ev = clip.events?.[d.idx];
        if (!d.ev) { this.drag = null; return; }
      }
    }

    const t = this._xToT(e.clientX);
    if (d.type === 'kf') {
      this._moveGroup(d, t - d.startT);
      this._renderSheet();
      this.seek(d.curT);
    } else {
      d.ev.time = t;
      d.clip.events.sort(byTime);
      this.selectedEventIdx = d.clip.events.indexOf(d.ev);
      this._renderSheet();
      this.seek(t);
    }
  },

  /** Move every selected key by `delta` (normalised time), always starting again from the untouched copy. */
  _moveGroup(d, rawDelta) {
    const minT = Math.min(...d.items.map((i) => i.t));
    const maxT = Math.max(...d.items.map((i) => i.t));
    const delta = Math.max(-minT, Math.min(1 - maxT, rawDelta));

    for (const joint of Object.keys(d.orig)) d.clip.tracks[joint].splice(0, d.clip.tracks[joint].length, ...clone(d.orig[joint]));

    // the leading edge first, so keys never land on a key that has not moved yet
    const ordered = [...d.items].sort((a, b) => (delta >= 0 ? b.t - a.t : a.t - b.t));
    const ids = new Set();
    for (const it of ordered) {
      const track = d.clip.tracks[it.joint];
      const key = KT.ownedKeyAt(track, it.prop, it.t, 0.002);
      if (!key) continue;
      const target = KT.moveProp(track, key, it.prop, round2(it.t + delta));
      ids.add(kid(it.joint, it.prop, target.t));
      if (it.joint === d.joint && it.prop === d.prop && Math.abs(it.t - d.t0) < 1e-6) d.curT = target.t;
    }
    this.selectedKeys = ids;
  },

  _onPointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;

    if (d.type === 'pending') {
      // a click on empty space: park the playhead there, and drop the selection (unless Shift/Ctrl)
      if (!d.additive && this.selectedKeys.size) { this.selectedKeys = new Set(); this._renderSheet(); }
      this.seek(this._xToT(d.startX));
    } else if (d.type === 'marquee') {
      this._removeMarquee();
    } else if (d.type === 'kf') {
      if (d.moved) { this._modified(); this.seek(d.curT); }
      else {
        if (d.collapseOnClick) { this.selectedKeys = new Set([d.id]); this._renderSheet(); }
        this.seek(d.t0);                           // a plain click only parks the playhead on the key
      }
    } else if (d.type === 'ev') {
      if (d.moved) this._modified();
      this._renderSheet();
    }
  },
};
