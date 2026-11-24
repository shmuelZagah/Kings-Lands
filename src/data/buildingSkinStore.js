/**
 * Building skins store (delegates to the single dataRegistry).
 *
 * Returns deep-cloned data on every read so callers cannot mutate shared state in-place.
 * All writes go through dataRegistry (validated & persisted in the unified draft store).
 */

import { dataRegistry, LEGACY_STORAGE_KEYS } from './dataRegistry.js';

export const BUILDING_SKINS_KEY = LEGACY_STORAGE_KEYS.BUILDING_SKINS;

export function loadBuildingSkins() {
  return dataRegistry.getBuildingSkins();
}

export function saveBuildingSkins(skins = null) {
  if (!skins || typeof skins !== 'object') {
    return { ok: true, bytes: 0 };
  }
  const res = dataRegistry.saveBuildingSkins(skins);
  if (!res.ok) {
    return { ok: false, error: res.error || 'Failed to save building skins' };
  }
  return { ok: true, bytes: 0 };
}
