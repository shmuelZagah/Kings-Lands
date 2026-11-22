/**
 * Kings Lands — Studio state manager (src/tools/studio/studioStateManager.js)
 *
 *  - Holds the working copy of units.json (`this.data`) and persists it as a draft in localStorage.
 *  - Saves are DEBOUNCED (scheduleSave) so dragging a gizmo does not JSON.stringify the whole file every frame.
 *  - The draft remembers which units.json it was based on. If units.json changed on disk the user is asked
 *    whether to keep the draft (missing units/prefabs/clips from the new file are merged in) or drop it.
 *  - Old drafts (key `kings_lands_studio_draft`) are migrated; stale clips are sanitized on load.
 */

import defaultUnitsJson from '../../data/visuals/units.json';
import { sanitizeUnitsData, resetClip as resetClipData } from './clipEditing.js';

const STORAGE_KEY = 'kings_lands_studio_draft_v3';
const LEGACY_KEY = 'kings_lands_studio_draft';
const SAVE_DELAY_MS = 400;

const deepClone = (o) => JSON.parse(JSON.stringify(o));
const INITIAL_DEFAULT_UNITS_HASH = hashString(JSON.stringify(defaultUnitsJson));

function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export class StudioStateManager {
  /** @param {{ onStatus?: (state: 'saved'|'dirty'|'error', message?: string) => void }} options */
  constructor(options = {}) {
    this.onStatus = options.onStatus || null;
    this._subscribers = new Set();
    this.notice = '';
    this._saveTimer = null;
    this._dirty = false;

    this.defaultHash = INITIAL_DEFAULT_UNITS_HASH;
    const loaded = this._loadDraft();
    this.data = loaded.data;
    if (loaded.needsSave) this.saveDraft();

    this._onUnload = () => this.flush();
    this._onVisibility = () => { if (document.visibilityState === 'hidden') this.flush(); };
    window.addEventListener('beforeunload', this._onUnload);
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  // ---------------------------------------------------------------- load

  _freshDefaults() {
    const data = deepClone(defaultUnitsJson);
    sanitizeUnitsData(data);
    return data;
  }

  /** Add units / prefabs / clips / palettes that exist in the new units.json but not in the draft. */
  _mergeMissingDefaults(data) {
    const added = [];
    const addMissing = (target, source, label) => {
      if (!target || !source) return;
      for (const key of Object.keys(source)) {
        if (!(key in target)) { target[key] = deepClone(source[key]); added.push(`${label}:${key}`); }
      }
    };
    if (!data.factions) data.factions = {};
    if (!data.teamPalettes) data.teamPalettes = {};
    if (!data.prefabs) data.prefabs = {};
    if (!data.units) data.units = {};
    if (!data.animations) data.animations = {};
    if (!data.animations.keyframes) data.animations.keyframes = {};
    if (!data.animations.procedural) data.animations.procedural = {};

    if (!data.arrowConfig && defaultUnitsJson.arrowConfig) {
      data.arrowConfig = deepClone(defaultUnitsJson.arrowConfig);
      added.push("arrowConfig");
    }
    addMissing(data.factions, defaultUnitsJson.factions, 'faction');
    addMissing(data.teamPalettes, defaultUnitsJson.teamPalettes, 'palette');
    addMissing(data.prefabs, defaultUnitsJson.prefabs, 'prefab');
    addMissing(data.units, defaultUnitsJson.units, 'unit');
    addMissing(data.animations.keyframes, defaultUnitsJson.animations?.keyframes, 'clip');
    addMissing(data.animations.procedural, defaultUnitsJson.animations?.procedural, 'move');
    added.push(...this._mergeMissingFields(data));
    return added;
  }

  /**
   * An older draft keeps its own copy of prefabs and units, so fields that were introduced later never reach it
   * (weapon types, action rules, carry points, people). Fill in only what is MISSING; nothing the author set is changed.
   */
  _mergeMissingFields(data) {
    const def = defaultUnitsJson, filled = [];
    if (!data.actionRules && def.actionRules) { data.actionRules = deepClone(def.actionRules); filled.push('actionRules'); }
    for (const [id, p] of Object.entries(data.prefabs || {})) {
      const d = def.prefabs?.[id];
      if (!d) continue;
      for (const k of ['weaponType', 'twoHanded', 'slot', 'race', 'defaultSocket']) if (d[k] !== undefined && p[k] !== d[k]) { p[k] = d[k]; filled.push(`prefab ${id}.${k}`); }
    }
    const findNode = (tree, name, parent = null) => {
      for (const [k, n] of Object.entries(tree || {})) {
        if (k === name) return { node: n, parent, key: k };
        const r = findNode(n?.children, name, n);
        if (r) return r;
      }
      return null;
    };
    const addStow = (dTree, uTree, dParentName) => {
      for (const [k, n] of Object.entries(dTree || {})) {
        if (/^stow_/.test(k) && !findNode(uTree, k)) {
          const host = dParentName ? findNode(uTree, dParentName)?.node : null;
          if (host) { (host.children = host.children || {})[k] = deepClone(n); filled.push(`carry point ${k}`); }
        }
        addStow(n?.children, uTree, k);
      }
    };
    for (const [id, u] of Object.entries(data.units || {})) {
      const d = def.units?.[id];
      if (!d) continue;
      if (u.race === undefined && d.race !== undefined) { u.race = d.race; filled.push(`unit ${id}.race`); }
      if (!u._gearConfiguredInLab && !u.equipment && d.equipment && typeof d.equipment === "object") {
        u.equipment = deepClone(d.equipment);
        filled.push(`unit ${id}.equipment`);
      }
      for (const key of ['hierarchy', 'mountHierarchy']) if (u[key] && d[key]) addStow(d[key], u[key], null);
    }
    return filled;
  }

  _loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const pack = JSON.parse(raw);
        if (pack && pack.v === 2 && pack.data && pack.data.units && pack.data.animations) {
          const data = pack.data;
          let needsSave = false;
          if (pack.baseHash !== this.defaultHash) {
            const added = this._mergeMissingDefaults(data);
            this.notice = added.length ? `Draft updated with ${added.length} new item(s)` : 'Draft loaded';
            needsSave = true;
          }
          // Always: fields / carry points / items added to the tool after the draft was saved (only fills what is missing)
          const filledNow = this._mergeMissingFields(data);
          if (!data.prefabs) data.prefabs = {};
          for (const id of Object.keys(defaultUnitsJson.prefabs || {})) {
            if (!(id in data.prefabs)) { data.prefabs[id] = deepClone(defaultUnitsJson.prefabs[id]); filledNow.push(`prefab ${id}`); }
          }
          if (filledNow.length) { needsSave = true; this.notice = `${this.notice ? this.notice + ' · ' : ''}Completed old draft (${filledNow.length} missing item(s))`; }
          const report = sanitizeUnitsData(data);
          if (report.removed.length || report.migrated.length || report.fixed.length) {
            this.notice = `${this.notice ? this.notice + ' · ' : ''}Cleaned ${report.removed.length} stale clip(s)`
              + (report.migrated.length ? `, migrated ${report.migrated.join(', ')}` : '');
            needsSave = true;
          }
          return { data, needsSave };
        }
        localStorage.removeItem(STORAGE_KEY); // unknown shape
      }

      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      if (legacyRaw) {
        const data = JSON.parse(legacyRaw);
        if (data && data.units && data.animations) {
          const added = this._mergeMissingDefaults(data);
          const report = sanitizeUnitsData(data);
          localStorage.removeItem(LEGACY_KEY);
          this.notice = `Old draft migrated (cleaned ${report.removed.length} stale clip(s)`
            + (report.migrated.length ? `, migrated ${report.migrated.join(', ')}` : '')
            + (added.length ? `, added ${added.length} from units.json` : '') + ')';
          return { data, needsSave: true };
        }
        localStorage.removeItem(LEGACY_KEY);
      }
    } catch (e) {
      console.warn('Draft is corrupted – removing it and loading the default units.json.', e);
      try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_KEY); } catch (_) { /* ignore */ }
      this.notice = 'Draft was corrupted – defaults loaded';
    }
    return { data: this._freshDefaults(), needsSave: false };
  }

  // ---------------------------------------------------------------- save

  subscribe(fn) {
    if (typeof fn === 'function') this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  _emit(state, message = '') {
    if (this.onStatus) this.onStatus(state, message);
    if (state === 'saved' && this._subscribers) {
      for (const fn of this._subscribers) {
        try { fn(this.data); } catch (_) {}
      }
    }
  }

  /** Save right now. */
  saveDraft() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    try {
      const pack = {
        v: 2,
        baseHash: this.defaultHash,
        baseVersion: defaultUnitsJson.version ?? null,
        savedAt: Date.now(),
        data: this.data
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pack));
      this._dirty = false;
      this._emit('saved');
      return true;
    } catch (e) {
      console.error('Failed to save draft.', e);
      this._emit('error', e && e.name === 'QuotaExceededError' ? 'Storage full – Export JSON now!' : 'Save failed');
      return false;
    }
  }

  /** Save soon (debounced). Call this after every edit. */
  scheduleSave(delayMs = SAVE_DELAY_MS) {
    this._dirty = true;
    this._emit('dirty');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveDraft(), delayMs);
  }

  /** Save immediately if something is waiting. */
  flush() {
    if (this._dirty) this.saveDraft();
  }

  // ---------------------------------------------------------------- reset / export / import

  resetToDefault() {
    if (!confirm('Are you sure? This deletes ALL your changes and restores the default units.json.')) return false;
    clearTimeout(this._saveTimer);
    this._dirty = false;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_KEY); } catch (_) { /* ignore */ }
    this.data = this._freshDefaults();
    this.notice = 'Defaults restored';
    this._emit('saved', this.notice);
    return true;
  }

  /**
   * Reset one clip.
   * scope 'unit'   -> removes this unit+faction's own copy of the clip
   * scope 'global' -> restores the global clip from the default units.json
   * @returns {{ ok: boolean, cancelled: boolean }}
   */
  resetClip(unitId, faction, base, scope) {
    const label = scope === 'global'
      ? `the GLOBAL '${base}' clip (affects every unit that has no clip of its own)`
      : `'${base}' for ${unitId} / ${faction}`;
    if (!confirm(`Reset ${label} to default?`)) return { ok: false, cancelled: true };
    const res = resetClipData(this.data, deepClone(defaultUnitsJson), unitId, faction, base, scope);
    if (res.changed) this.saveDraft();
    return { ok: res.changed, cancelled: false };
  }

  exportCustomJson(filename = 'units_export.json') {
    this.flush();
    const blob = new Blob([JSON.stringify(this.data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Replace the working data with the content of a units.json text. */
  importJsonText(text) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !parsed.units || !parsed.animations || !parsed.prefabs) {
        return { ok: false, error: 'Not a units.json (needs units, prefabs and animations).' };
      }
      const report = sanitizeUnitsData(parsed);
      this.data = parsed;
      this.notice = `Imported (cleaned ${report.removed.length} stale clip(s))`;
      this.saveDraft();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${e.message}` };
    }
  }

  /** Undo / Redo: swap in a snapshot of the whole working copy (a JSON string made by `snapshot()`). */
  snapshot() {
    return JSON.stringify(this.data);
  }

  restoreSnapshot(text) {
    this.data = JSON.parse(text);
    this.scheduleSave();
  }

  destroy() {
    this.flush();
    clearTimeout(this._saveTimer);
    window.removeEventListener('beforeunload', this._onUnload);
    document.removeEventListener('visibilitychange', this._onVisibility);
  }
}
