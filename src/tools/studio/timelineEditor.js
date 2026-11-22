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

export class TimelineEditor {
  constructor(containerEl, animationsCatalog, callbacks = {}) {
    this.container = containerEl;
    this.animations = animationsCatalog;
    this.callbacks = callbacks;

    this.animMode = 'keyframes';          // 'keyframes' (actions) | 'procedural' (movement)
    this.activeBaseName = 'attack_slash';
    this.activeVariantIdx = 1;
    this.scope = 'unit';                  // 'unit' = this unit+faction, 'global' = every unit
    this.isPlaying = true;
    this.playbackSpeed = 1.0;
    this.scrubNormTime = 0.0;
    this.selectedJointName = 'torso';
    this.selectedRow = null;              // { joint, prop } or null
    this.selectedEventIdx = null;
    this.selectedKeys = new Set();        // ids made by kid(joint, prop, t)
    this.expanded = new Set(['torso']);   // joints whose Rotation / Position rows are open
    this.onlyAnimated = false;
    this.minimized = false;
    this.zoom = 1;                        // 1 = whole clip fits the width; up to MAX_ZOOM
    this.clipboard = null;
    this.drag = null;
    this.el = {};

    this._onWindowMove = (e) => this._onPointerMove(e);
    this._onWindowUp = (e) => this._onPointerUp(e);
    window.addEventListener('pointermove', this._onWindowMove);
    window.addEventListener('pointerup', this._onWindowUp);
    window.addEventListener('pointercancel', this._onWindowUp);

    this._renderUI();
  }

  // ------------------------------------------------------------------ data access

  get isBuildingSession() {
    return Boolean(this.callbacks.isBuildingMode?.());
  }

  get clipList() {
    if (this.isBuildingSession) {
      this.animMode = 'keyframes';
      const list = this.callbacks.getActionList?.();
      return Array.isArray(list) && list.length ? list : ['build_construct', 'idle', 'level_up', 'recruit_spawn', 'damage_stage_1', 'damage_stage_2', 'collapse_destroy', 'victory_cheer'];
    }
    if (this.animMode !== 'keyframes') {
      const mList = this.callbacks.getMoveList?.();
      return Array.isArray(mList) && mList.length ? mList : MOVE_CLIPS;
    }
    const list = this.callbacks.getActionList?.();
    return Array.isArray(list) && list.length ? list : ACTION_CLIPS;
  }

  /** The unit's equipment changed: the list of actions may have changed too. */
  refreshClipList() {
    if (this.isBuildingSession) this.animMode = 'keyframes';
    const sig = this.clipList.map((n) => n + (this.callbacks.getActionNote?.(n) || '')).join('|') + this.animMode + (this.isBuildingSession ? '|bld' : '|unit');
    if (sig === this._listSig) return;
    this._listSig = sig;
    if (!this.clipList.includes(this.activeBaseName)) {
      this.activeBaseName = this.clipList[0];
      this._afterClipChange();
    } else this._renderUI();
  }

  /** Keyframes exist for actions and for a standalone idle. walk / run / gallop are procedural only. */
  canKeyframe() { return true; }

  getClipName() {
    return this.callbacks.getClipName ? this.callbacks.getClipName(this.activeBaseName) : this.activeBaseName;
  }

  /** Kept for older callers. */
  getResolvedClipName() { return this.getClipName(); }

  getReadClip() { return this.callbacks.getClip ? this.callbacks.getClip(this.activeBaseName) : null; }

  getWriteClip() { return this.callbacks.ensureClip ? this.callbacks.ensureClip(this.activeBaseName) : null; }

  getDuration() {
    const clip = this.getReadClip();
    if (clip && clip.duration > 0) return clip.duration;
    return this.activeBaseName === 'idle' ? IDLE_DURATION : DEFAULT_DURATION;
  }

  _track(joint) { return this.getReadClip()?.tracks?.[joint] || null; }

  _writeTrack(joint) {
    const clip = this.getWriteClip();
    if (!clip) return null;
    if (!clip.tracks) clip.tracks = {};
    if (!clip.tracks[joint]) clip.tracks[joint] = [];
    return clip.tracks[joint];
  }

  /** A track that only holds "zero, static" says nothing: drop it. */
  _cleanup(joint) {
    const clip = this.getReadClip();
    const track = clip?.tracks?.[joint];
    if (!track) return;
    const empty = track.length === 0 ||
      (track.length === 1 && !KT.isOwner(track[0], 'pos') && !KT.isOwner(track[0], 'rot') && isZero3(track[0].pos) && isZero3(track[0].rot));
    if (empty) delete clip.tracks[joint];
  }

  /** The keyframe (of either property) of `jointName` that the playhead is on, or null. */
  keyframeAt(jointName, t = this.scrubNormTime) {
    return KT.anyKeyAt(this._track(jointName), t);
  }

  isPropAnimated(joint, prop) { return KT.isAnimated(this._track(joint), prop); }

  getPropValue(joint, prop, t = this.scrubNormTime) { return KT.sampleProp(this._track(joint), prop, t); }

  _before(tag) { this.callbacks.onBeforeEdit?.(tag); }

  _modified() { this.callbacks.onTimelineModified?.(); }

  // ------------------------------------------------------------------ selection

  clearSelection() {
    if (this.selectedKeys.size === 0 && this.selectedEventIdx === null) return;
    this.selectedKeys = new Set();
    this.selectedEventIdx = null;
    this._renderSheet();
  }

  /** The selected keyframes as { joint, prop, t, key } (ids that no longer exist are skipped). */
  _selectedItems() {
    const out = [];
    for (const id of this.selectedKeys) {
      const [joint, prop, ms] = id.split('|');
      const key = KT.ownedKeys(this._track(joint), prop).find((k) => Math.round(k.t * 1000) === Number(ms));
      if (key) out.push({ joint, prop, t: key.t, key });
    }
    return out;
  }

  _applySelectionClasses() {
    if (!this.el.rows) return;
    this.el.rows.querySelectorAll('.kf').forEach((el) => {
      const on = this.selectedKeys.has(kid(el.dataset.joint, el.dataset.prop, Number(el.dataset.t)));
      el.classList.toggle('ring-1', on);
      el.classList.toggle('ring-sky-200', on);
      el.classList.toggle('border-sky-200', on);
      el.classList.toggle('border-slate-950', !on);
    });
  }

  // ------------------------------------------------------------------ public control

  setSelectedJoint(jointName) {
    // picking another joint from outside (viewport click ...) drops the keyframe selection, so Ctrl+C copies what you see
    if (jointName && jointName !== this.selectedJointName) this.selectedKeys = new Set();
    this.selectedJointName = jointName || 'torso';
    this._reveal(this.selectedJointName);
    if (this.selectedRow && this.selectedRow.joint !== this.selectedJointName) this.selectedRow = null;
    this._renderSheet();
  }

  /** Re-draw everything that depends on the data or the resolved clip. */
  refresh() {
    if (this.el.duration && document.activeElement !== this.el.duration) this.el.duration.value = String(this.getDuration());
    this._renderSheet();
    this._syncPlayheadUI();
  }

  setPlaying(playing) {
    if (this.isPlaying === playing) return;
    this.isPlaying = playing;
    this._syncPlayButton();
    this.callbacks.onPlayStateChanged?.(playing);
  }

  togglePlay() { this.setPlaying(!this.isPlaying); }

  forcePause() { this.setPlaying(false); }

  /** Move the playhead and show the pose at that time. */
  seek(t) {
    this.scrubNormTime = clamp01(t);
    this._syncPlayheadUI();
    this.callbacks.onScrub?.(this.scrubNormTime, this.animMode, this.activeBaseName);
  }

  /** One frame (1/30 s) back / forward; `big` = 5 frames. */
  step(direction, big = false) {
    this.forcePause();
    const frame = 1 / (FPS * Math.max(0.05, this.getDuration()));
    this.seek(round3(this.scrubNormTime + direction * (big ? 5 : 1) * frame));
  }

  goToStart() { this.forcePause(); this.seek(0); }

  goToEnd() { this.forcePause(); this.seek(1); }

  /** Called every frame while playing. Does not trigger onScrub. */
  syncPlayhead(normT) {
    this.scrubNormTime = normT;
    this._syncPlayheadUI();
  }

  // ------------------------------------------------------------------ editing

  /**
   * The joint's property was changed at the playhead (gizmo, numbers, paste ...).
   *  - animated property -> write / update the key at the playhead
   *  - static property   -> change the constant for the whole clip
   */
  editProp(joint, prop, value) {
    if (!this.canKeyframe()) return false;
    const clip = this.getWriteClip();
    if (!clip) return false;
    const track = this._writeTrack(joint);
    if (KT.isAnimated(track, prop) || this.scrubNormTime > KT.EPS_T) KT.setKey(track, prop, this.scrubNormTime, value, { clampEnd: Boolean(clip.clampWhenFinished) });
    else KT.setStatic(track, prop, value);
    this._cleanup(joint);
    this._renderSheet();
    this._modified();
    return true;
  }

  /** The stopwatch. Also selects the joint + row so the gizmo is ready to edit it. */
  toggleProp(joint, prop) {
    if (!this.canKeyframe()) return false;
    const t = this.scrubNormTime;
    if (this.isPropAnimated(joint, prop)) {
      const ok = confirm(
        `Turn off animation of ${joint} / ${PROP_LABEL[prop]}?\n\nAll its keyframes are removed. The value at the playhead stays, as a constant for the whole clip.`
      );
      if (!ok) return false;
      this._before('stopwatch');
      const value = this.getPropValue(joint, prop, t);
      KT.clearProp(this._writeTrack(joint), prop, value);
      this._cleanup(joint);
      this.selectedKeys = new Set([...this.selectedKeys].filter((id) => !id.startsWith(`${joint}|${prop}|`)));
    } else {
      this._before('stopwatch');
      const clip = this.getWriteClip();
      if (!clip) return false;
      const value = this.getPropValue(joint, prop, t);
      KT.setKey(this._writeTrack(joint), prop, t, value, { clampEnd: Boolean(clip.clampWhenFinished) });
    }
    this.expanded.add(joint);
    this._selectRow(joint, prop);
    this._modified();
    this.seek(t);
    return true;
  }

  /** Make the last frame equal the first frame for every animated property (a seamless loop). Returns how many properties changed. */
  closeLoop() {
    if (!this.canKeyframe()) return 0;
    const clip = this.getReadClip();
    if (!clip) return 0;
    const todo = [];
    for (const [joint, track] of Object.entries(clip.tracks || {})) {
      for (const prop of KT.PROPS) {
        if (!KT.isAnimated(track, prop)) continue;
        const a = KT.sampleProp(track, prop, 0);
        const b = KT.sampleProp(track, prop, 1);
        if ([0, 1, 2].some((i) => Math.abs(a[i] - b[i]) > 1e-4)) todo.push({ joint, prop, a });
      }
    }
    if (!todo.length) return 0;
    this._before('loop');
    const w = this.getWriteClip();
    for (const { joint, prop, a } of todo) KT.setKey(this._writeTrack(joint), prop, 1, a, { clampEnd: false });
    this.refresh();
    this._modified();
    return todo.length;
  }

  /** 'arm_L' <-> 'arm_R' (also _l/_r). Null when the joint has no side. */
  static counterpart(name) {
    const m = /^(.*_)([LRlr])$/.exec(name || '');
    if (!m) return null;
    const flip = { L: 'R', R: 'L', l: 'r', r: 'l' }[m[2]];
    return m[1] + flip;
  }

  /** Copy one joint's animation onto its other-side twin, mirrored across the body's left/right plane. */
  _mirrorOne(src, dst, clip) {
    const from = clip.tracks?.[src];
    if (!from || !from.length) return false;
    clip.tracks[dst] = from.map((k) => ({
      ...JSON.parse(JSON.stringify(k)),
      pos: [-k.pos[0], k.pos[1], k.pos[2]],
      rot: [k.rot[0], -k.rot[1], -k.rot[2]]
    }));
    return true;
  }

  /** Mirror the selected joint (side 'joint') or every joint of the selected joint's side ('side') onto the other side. Returns count. */
  mirror(scope = 'joint') {
    if (!this.canKeyframe()) return 0;
    const sel = this.selectedJointName;
    const names = this.callbacks.getJointNames ? this.callbacks.getJointNames() : [];
    const jobs = [];
    const sideOf = (n) => /_([LRlr])$/.exec(n)?.[1];
    const pick = scope === 'side' ? names.filter((n) => sideOf(n) && sideOf(n) === sideOf(sel)) : [sel];
    for (const src of pick) {
      const dst = TimelineEditor.counterpart(src);
      if (dst && names.includes(dst)) jobs.push([src, dst]);
    }
    const read = this.getReadClip();
    if (!jobs.length || !jobs.some(([a]) => read?.tracks?.[a]?.length)) return 0;
    this._before('mirror');
    const clip = this.getWriteClip();
    let n = 0;
    for (const [a, b] of jobs) if (this._mirrorOne(a, b, clip)) n++;
    this.selectedKeys = new Set();
    this.refresh();
    this._modified();
    return n;
  }

  setZoom(z, anchorFrac = null) {
    const sheet = this.el.sheet;
    const next = Math.max(1, Math.min(MAX_ZOOM, Math.round(z * 100) / 100));
    if (next === this.zoom) return;
    const frac = anchorFrac ?? (sheet ? (sheet.scrollLeft + sheet.clientWidth / 2) / Math.max(1, sheet.scrollWidth) : 0.5);
    this.zoom = next;
    this._renderSheet();
    if (sheet) sheet.scrollLeft = Math.max(0, frac * sheet.scrollWidth - sheet.clientWidth / 2);
    if (this.el.zoomLabel) this.el.zoomLabel.textContent = `${this.zoom.toFixed(this.zoom % 1 ? 1 : 0)}x`;
  }

  /** Delete the selected keyframes, else the selected event, else the key(s) under the playhead of the selected row/joint. */
  deleteSelection() {
    const items = this._selectedItems();
    if (items.length > 0 && this.canKeyframe()) {
      this._before('delete-keys');
      const clip = this.getWriteClip();
      const joints = new Set();
      for (const it of items) {
        const track = clip.tracks?.[it.joint];
        if (track) { KT.removeKey(track, it.prop, it.t, 0.002); joints.add(it.joint); }
      }
      joints.forEach((j) => this._cleanup(j));
      this.selectedKeys = new Set();
      this._renderSheet();
      this._modified();
      this.seek(this.scrubNormTime);
      return true;
    }

    if (this.selectedEventIdx !== null && this.animMode === 'keyframes') {
      const read = this.getReadClip();
      if (read?.events?.[this.selectedEventIdx]) {
        this._before('delete-event');
        const clip = this.getWriteClip();
        clip.events.splice(this.selectedEventIdx, 1);
        this.selectedEventIdx = null;
        this._renderSheet();
        this._modified();
        return true;
      }
    }
    if (!this.canKeyframe()) return false;
    const joint = this.selectedJointName;
    const track = this._track(joint);
    if (!track) return false;
    const props = this.selectedRow && this.selectedRow.joint === joint && this.selectedRow.prop ? [this.selectedRow.prop] : KT.PROPS;
    const t = this.scrubNormTime;
    if (!props.some((p) => KT.ownedKeyAt(track, p, t, 0.03))) return false;

    this._before('delete-key');
    const writeTrack = this._writeTrack(joint);
    for (const p of props) KT.removeKey(writeTrack, p, t);
    this._cleanup(joint);
    this._renderSheet();
    this._modified();
    this.seek(t);   // re-evaluate the pose without that key
    return true;
  }

  setEasingAtPlayhead(value) {
    const joint = this.selectedJointName;
    const track = this._track(joint);
    const key = KT.anyKeyAt(track, this.scrubNormTime);
    if (!track || !key) return;
    const idx = track.indexOf(key);
    this._before('easing');
    const target = this._writeTrack(joint)?.[idx];
    if (!target) return;
    target.easing = value;
    this._renderSheet();
    this._modified();
  }

  /**
   * Ctrl+C. The selected keyframes (several are fine), or – when none is selected – the values of the selected row
   * (both rows of the joint if no row is selected) at the playhead, keyframe or not. Returns how many were copied.
   */
  copyAtPlayhead() {
    if (!this.canKeyframe()) return 0;
    const items = this._selectedItems();
    if (items.length > 0) {
      const t0 = Math.min(...items.map((i) => i.t));
      this.clipboard = {
        items: items.map((i) => ({ joint: i.joint, prop: i.prop, dt: i.t - t0, value: [...i.key[i.prop]], easing: i.key.easing || 'smooth' }))
      };
      return items.length;
    }
    const joint = this.selectedJointName;
    const props = this.selectedRow && this.selectedRow.joint === joint && this.selectedRow.prop ? [this.selectedRow.prop] : KT.PROPS;
    this.clipboard = { items: props.map((p) => ({ joint, prop: p, dt: 0, value: this.getPropValue(joint, p), easing: 'smooth' })) };
    return props.length;
  }

  /**
   * Ctrl+V. Writes the copied keys as keyframes starting at the playhead (their spacing is kept).
   * Keys copied from one joint go to the selected joint; keys copied from several joints go back to their own joints.
   */
  pasteAtPlayhead() {
    if (!this.clipboard || !this.canKeyframe()) return 0;
    const names = this.callbacks.getJointNames ? this.callbacks.getJointNames() : null;
    const joints = new Set(this.clipboard.items.map((i) => i.joint));
    const single = joints.size === 1;

    this._before('paste');
    const clip = this.getWriteClip();
    if (!clip) return 0;
    const pasted = new Set();
    let count = 0;
    for (const item of this.clipboard.items) {
      const joint = single ? this.selectedJointName : item.joint;
      const t = this.scrubNormTime + item.dt;
      if (t > 1 + 1e-6 || (names && !names.includes(joint))) continue;
      const track = this._writeTrack(joint);
      const key = KT.setKey(track, item.prop, t, item.value, { clampEnd: Boolean(clip.clampWhenFinished) });
      key.easing = item.easing;
      pasted.add(kid(joint, item.prop, key.t));
      this.expanded.add(joint);
      count++;
    }
    this.selectedKeys = pasted;
    this._renderSheet();
    this._modified();
    this.seek(this.scrubNormTime);
    return count;
  }

  addEvent(type) {
    if (this.animMode !== 'keyframes') return false;
    const t = round2(this.scrubNormTime);
    const read = this.getReadClip();
    if ((read?.events || []).some((e) => e.type === type && Math.abs(e.time - t) < 0.005)) return false;   // no duplicates

    const socket = this.callbacks.getDefaultEventSocket ? this.callbacks.getDefaultEventSocket(type) : 'weapon_socket_R';
    const base = this.activeBaseName;
    let payload = {};
    if (type === 'hit') payload = { damageType: base === 'attack_thrust' ? 'pierce' : 'slash', socket };
    else if (type === 'release') payload = { projectile: base === 'throw_javelin' ? 'javelin' : 'arrow', socket };
    else if (type === 'footstep') payload = { foot: 'left' };
    else if (type === 'swap') payload = { loadout: 'next' };
    else if (type === 'hold') payload = {};
    else if (type === 'sound' || type === 'effect') {
      const key = type === 'sound' ? 'cue' : 'fx';
      const value = window.prompt(`${type === 'sound' ? 'Sound cue' : 'Effect'} name (e.g. ${type === 'sound' ? 'sword_whoosh' : 'blade_spark'}):`, '');
      if (value === null) return false;
      payload = value.trim() ? { [key]: value.trim() } : {};
    }

    this._before('event');
    const clip = this.getWriteClip();
    if (!clip) return false;
    if (!clip.events) clip.events = [];
    const ev = { time: t, type, payload };
    clip.events.push(ev);
    clip.events.sort(byTime);
    this.selectedEventIdx = clip.events.indexOf(ev);
    this._renderSheet();
    this._modified();
    return true;
  }

  destroy() {
    window.removeEventListener('pointermove', this._onWindowMove);
    window.removeEventListener('pointerup', this._onWindowUp);
    window.removeEventListener('pointercancel', this._onWindowUp);
    this._removeMarquee();
    this.container.innerHTML = '';
  }

  // ------------------------------------------------------------------ rendering
}

import { timelineSheetAndPointerMethods } from './timelineSheetAndPointer.js';
Object.assign(TimelineEditor.prototype, timelineSheetAndPointerMethods);
