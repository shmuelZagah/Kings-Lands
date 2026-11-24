/**
 * Kings Lands — Studio state manager (src/tools/studio/studioStateManager.js)
 *
 * Thin controller backed by `dataRegistry` (`src/data/dataRegistry.js`):
 *  - Holds a working copy of `unitsVisuals` (`this.data`) for interactive 3D gizmo/timeline edits.
 *  - Saves are DEBOUNCED (scheduleSave) so dragging a gizmo does not serialize on every frame.
 *  - All reads, writes, validation, migrations, and localStorage persistence flow through `dataRegistry`.
 */

import { dataRegistry } from '../../data/dataRegistry.js';
import { sanitizeUnitsData, resetClip as resetClipData } from './clipEditing.js';

const SAVE_DELAY_MS = 400;

export class StudioStateManager {
  /** @param {{ onStatus?: (state: 'saved'|'dirty'|'error', message?: string) => void }} options */
  constructor(options = {}) {
    this.onStatus = options.onStatus || null;
    this._subscribers = new Set();
    this._saveTimer = null;
    this._dirty = false;
    this._isSavingSelf = false;

    this.data = dataRegistry.getUnitsVisuals();
    this.notice = dataRegistry.getNotice();

    this._unsubRegistry = dataRegistry.subscribe(() => {
      if (this._isSavingSelf || this._dirty) return;
      this.data = dataRegistry.getUnitsVisuals();
      for (const fn of this._subscribers) {
        try { fn(this.data); } catch (_) {}
      }
    });

    this._onUnload = () => this.flush();
    this._onVisibility = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.flush(); };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', this._onUnload);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this._onVisibility);
    }
  }

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

  /** Save right now via `dataRegistry` (validates cross-references before committing). */
  saveDraft() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this._isSavingSelf = true;
    try {
      const res = dataRegistry.saveUnitsVisuals(this.data);
      if (!res.ok) {
        this._emit('error', res.error || 'Validation failed');
        return false;
      }
      this._dirty = false;
      this.data = dataRegistry.getUnitsVisuals();
      this._emit('saved');
      return true;
    } catch (e) {
      console.error('Failed to save draft.', e);
      this._emit('error', e && e.name === 'QuotaExceededError' ? 'Storage full – Export JSON now!' : (e?.message || 'Save failed'));
      return false;
    } finally {
      this._isSavingSelf = false;
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
    if (this._dirty) return this.saveDraft();
    return true;
  }

  resetToDefault() {
    if (typeof confirm === 'function' && !confirm('Are you sure? This deletes ALL your changes and restores the default units.json.')) {
      return false;
    }
    clearTimeout(this._saveTimer);
    this._dirty = false;
    this._isSavingSelf = true;
    try {
      const res = dataRegistry.resetToDefaults();
      if (!res.ok) {
        this._emit('error', res.error || 'Reset failed');
        return false;
      }
      this.data = dataRegistry.getUnitsVisuals();
      this.notice = 'Defaults restored';
      this._emit('saved', this.notice);
      return true;
    } finally {
      this._isSavingSelf = false;
    }
  }

  /**
   * Reset one clip.
   * scope 'unit'   -> removes this unit+faction's own copy of the clip
   * scope 'global' -> restores the global clip from shipped baseline
   * @returns {{ ok: boolean, cancelled: boolean }}
   */
  resetClip(unitId, faction, base, scope) {
    const label = scope === 'global'
      ? `the GLOBAL '${base}' clip (affects every unit that has no clip of its own)`
      : `'${base}' for ${unitId} / ${faction}`;
    if (typeof confirm === 'function' && !confirm(`Reset ${label} to default?`)) {
      return { ok: false, cancelled: true };
    }
    const baselineUnits = dataRegistry.getBaselineSnapshot().unitsVisuals;
    const res = resetClipData(this.data, baselineUnits, unitId, faction, base, scope);
    if (res.changed) {
      const ok = this.saveDraft();
      return { ok, cancelled: false };
    }
    return { ok: false, cancelled: false };
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

  /** Replace the working visuals data with the content of a units.json text. */
  importJsonText(text) {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !parsed.units || !parsed.animations || !parsed.prefabs) {
        return { ok: false, error: 'Not a units.json (needs units, prefabs and animations).' };
      }
      const report = sanitizeUnitsData(parsed);
      this._isSavingSelf = true;
      try {
        const res = dataRegistry.saveUnitsVisuals(parsed);
        if (!res.ok) {
          this._emit('error', res.error || 'Import failed validation');
          return { ok: false, error: res.error || 'Import failed validation' };
        }
        this._dirty = false;
        this.data = dataRegistry.getUnitsVisuals();
        this.notice = `Imported (cleaned ${report.removed.length} stale clip(s))`;
        this._emit('saved', this.notice);
        return { ok: true };
      } finally {
        this._isSavingSelf = false;
      }
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${e.message}` };
    }
  }

  /** Undo / Redo: swap in a serialized snapshot from `dataRegistry`. */
  snapshot() {
    return JSON.stringify(dataRegistry.snapshot());
  }

  restoreSnapshot(text) {
    try {
      const parsed = typeof text === 'string' ? JSON.parse(text) : text;
      this._isSavingSelf = true;
      let res;
      if (parsed?.data?.unitsVisuals || parsed?.unitsVisuals) {
        res = dataRegistry.restoreSnapshot(parsed, { reason: 'studioRestoreSnapshot', persist: true });
      } else if (parsed?.units && parsed?.animations) {
        res = dataRegistry.saveUnitsVisuals(parsed);
      } else {
        return false;
      }
      if (!res?.ok) {
        this._emit('error', res?.error || 'Restore failed');
        return false;
      }
      this._dirty = false;
      this.data = dataRegistry.getUnitsVisuals();
      this._emit('saved');
      return true;
    } catch (err) {
      this._emit('error', err?.message || 'Restore failed');
      return false;
    } finally {
      this._isSavingSelf = false;
    }
  }

  destroy() {
    this.flush();
    clearTimeout(this._saveTimer);
    if (this._unsubRegistry) {
      this._unsubRegistry();
      this._unsubRegistry = null;
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('beforeunload', this._onUnload);
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this._onVisibility);
    }
  }
}
