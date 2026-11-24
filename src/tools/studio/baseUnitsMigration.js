/**
 * Kings Lands — base-unit ids and draft migration helpers
 * (folded into src/data/dataRegistry.js; re-exported here for backwards compatibility)
 */

export {
  DEFAULT_BASE_CHAR_ID,
  LEGACY_BASE_ALIASES,
  MANAGED_BASE_IDS,
  RETIRED_UNIT_IDS,
  RETIRED_PREFAB_RE,
  resolveBaseCharId,
  computeManagedHashes,
  migrateDraftData,
  pruneDraftForRuntime
} from '../../data/dataRegistry.js';
