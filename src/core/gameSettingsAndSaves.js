/**
 * Kings Lands — Settings, User Role & Save/Load Persistence (`src/core/gameSettingsAndSaves.js`)
 *
 * Separates Standard Player saves (`kings_lands_saves_player_v1`) from Developer saves
 * (`kings_lands_saves_dev_v1`), persists game settings, and provides a future-ready
 * `isCurrentUserAdmin()` hook for hiding developer/lab UI from non-admin users.
 */

export const SETTINGS_STORAGE_KEY = 'kings_lands_settings_v1';
export const PLAYER_SAVES_STORAGE_KEY = 'kings_lands_saves_player_v1';
export const DEV_SAVES_STORAGE_KEY = 'kings_lands_saves_dev_v1';
export const USER_ROLE_STORAGE_KEY = 'kings_lands_user_role';

export const DEFAULT_GAME_SETTINGS = Object.freeze({
  masterVolume: 80,
  muted: false,
  shadows: true,
  edgePanSpeed: 100,
  cameraOrbitSens: 100,
  showHealthBars: true,
  minimapZoomDefault: 1.0
});

export function isCurrentUserAdmin() {
  try {
    const role = globalThis.localStorage?.getItem(USER_ROLE_STORAGE_KEY);
    if (role === 'player' || role === 'user') return false;
  } catch (_) {}
  return true;
}

export function loadGameSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_GAME_SETTINGS, ...parsed };
      }
    }
  } catch (_) {}
  return { ...DEFAULT_GAME_SETTINGS };
}

export function saveGameSettings(settings) {
  const merged = { ...DEFAULT_GAME_SETTINGS, ...(settings || {}) };
  try {
    globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
  } catch (_) {}
  return merged;
}

export function applySettingsToRuntime(settings, { synthAudio = null, sceneManager = null } = {}) {
  const s = { ...DEFAULT_GAME_SETTINGS, ...(settings || {}) };
  if (synthAudio) {
    synthAudio.muted = Boolean(s.muted);
    synthAudio.masterVolume = Math.max(0, Math.min(1, (Number(s.masterVolume) || 80) / 100));
  }
  if (sceneManager?.renderer?.shadowMap) {
    sceneManager.renderer.shadowMap.enabled = Boolean(s.shadows);
  }
  if (sceneManager?.cameraController) {
    const panScale = Math.max(0.25, Math.min(2.5, (Number(s.edgePanSpeed) || 100) / 100));
    sceneManager.cameraController.panSpeedScale = panScale;
    sceneManager.cameraController.orbitSensScale = Math.max(0.25, Math.min(2.5, (Number(s.cameraOrbitSens) || 100) / 100));
  }
}

function getSavesStorageKey(mode) {
  return mode === 'dev' ? DEV_SAVES_STORAGE_KEY : PLAYER_SAVES_STORAGE_KEY;
}

export function listSavedGames(mode = 'player') {
  const key = getSavesStorageKey(mode);
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.sort((a, b) => (b.savedAtMs || 0) - (a.savedAtMs || 0));
      }
    }
  } catch (_) {}
  return [];
}

export function saveGameSnapshot(mode = 'player', saveEntry) {
  const m = mode === 'dev' ? 'dev' : 'player';
  const key = getSavesStorageKey(m);
  const existing = listSavedGames(m);
  const id = saveEntry?.id || `save_${m}_${Date.now()}`;
  const entry = {
    ...saveEntry,
    id,
    mode: m,
    savedAtMs: Date.now(),
    savedAtLabel: new Date().toLocaleString('he-IL')
  };
  const next = [entry, ...existing.filter((x) => x.id !== id)].slice(0, 15);
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(next));
  } catch (_) {}
  return entry;
}

export function deleteSavedGame(mode = 'player', saveId) {
  const m = mode === 'dev' ? 'dev' : 'player';
  const key = getSavesStorageKey(m);
  const next = listSavedGames(m).filter((x) => x.id !== saveId);
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(next));
  } catch (_) {}
  return next;
}
