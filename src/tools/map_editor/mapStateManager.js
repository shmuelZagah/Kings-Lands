/**
 * Kings Lands — 3D Map Editor State Manager, Saved Maps Library, Visual Swatches & Cached 3D Mesh Builders
 * (src/tools/map_editor/mapStateManager.js)
 *
 * Upgraded with:
 * - Smooth per-vertex RGB color blending (`colorOverrides: { [vIdx]: [r, g, b] }`) supporting Brush Strength & Falloff fading
 * - Configurable Map Size (`worldSizeMeters`: 1024, 2048, 3072, 4096)
 * - 2-Point Stretchable & Rotatable Bridges (`{ id, x, z, rotY, width, length }`)
 * - Pure Visual SVG Thumbnails for both Resource Skins AND Paint Biome / Texture Brushes
 * - Numbered 3D Spawn Point Beacons (`#1`, `#2`, `#3`, `#4`...) showing Starting Base + 2 Worker Squads
 */

import * as THREE from 'three';

export const CUSTOM_MAP_STORAGE_KEY = 'kings_lands_custom_map_v1';
export const SAVED_MAPS_LIST_STORAGE_KEY = 'kings_lands_saved_maps_list_v1';
export const MAP_VERTEX_RES = 257; // 256x256 segments -> 257x257 vertices
export const MAP_WORLD_SIZE = 4096;
export const MAP_CELL_METERS = MAP_WORLD_SIZE / (MAP_VERTEX_RES - 1); // 16m at 4096m world

export const MAP_SIZE_PRESETS = Object.freeze([
  { sizeMeters: 1024, tiles: 256, label: 'Small (1024m × 1024m)' },
  { sizeMeters: 2048, tiles: 512, label: 'Medium (2048m × 2048m)' },
  { sizeMeters: 3072, tiles: 768, label: 'Large (3072m × 3072m)' },
  { sizeMeters: 4096, tiles: 1024, label: 'Huge (4096m × 4096m)' }
]);


export const BRUSH_SHAPES_CATALOG = Object.freeze([
  { id: "circle_smooth", label: "Smooth Circle" },
  { id: "circle_flat", label: "Flat Circle" },
  { id: "square", label: "Square Brush" },
  { id: "diamond", label: "Diamond Brush" },
  { id: "star", label: "Star / Burst Brush" }
]);

export function renderBrushShapeSvg(shapeId) {
  if (shapeId === "square") {
    return `<svg viewBox="0 0 40 40" class="w-8 h-8"><rect x="7" y="7" width="26" height="26" rx="2" fill="#fbbf24" fill-opacity="0.3" stroke="#fbbf24" stroke-width="2.5"/></svg>`;
  }
  if (shapeId === "diamond") {
    return `<svg viewBox="0 0 40 40" class="w-8 h-8"><polygon points="20,4 36,20 20,36 4,20" fill="#fbbf24" fill-opacity="0.3" stroke="#fbbf24" stroke-width="2.5"/></svg>`;
  }
  if (shapeId === "star") {
    return `<svg viewBox="0 0 40 40" class="w-8 h-8"><polygon points="20,4 24,14 35,15 26,22 29,34 20,27 11,34 14,22 5,15 16,14" fill="#fbbf24" fill-opacity="0.3" stroke="#fbbf24" stroke-width="2"/></svg>`;
  }
  if (shapeId === "circle_flat") {
    return `<svg viewBox="0 0 40 40" class="w-8 h-8"><circle cx="20" cy="20" r="14" fill="#fbbf24" fill-opacity="0.45" stroke="#fbbf24" stroke-width="2.5"/></svg>`;
  }
  return `<svg viewBox="0 0 40 40" class="w-8 h-8"><defs><radialGradient id="gBell"><stop offset="0%" stop-color="#fbbf24" stop-opacity="0.85"/><stop offset="100%" stop-color="#fbbf24" stop-opacity="0.05"/></radialGradient></defs><circle cx="20" cy="20" r="14" fill="url(#gBell)" stroke="#fbbf24" stroke-width="2" stroke-dasharray="3 2"/></svg>`;
}

// ============================================================================
// 1. TERRAIN BIOME & TEXTURE LAYERS CATALOG
// ============================================================================
export const TERRAIN_BIOME_LAYERS = Object.freeze([
  { id: 0, key: 'auto', label: 'Auto (Erase Paint)', hex: '#4a7038', pattern: 'auto', roughness: 0.86 },
  { id: 1, key: 'grass_lush', label: 'Lush Emerald Meadow', hex: '#3b6e2e', pattern: 'grass', roughness: 0.85 },
  { id: 2, key: 'grass_high', label: 'Golden Highland Savanna', hex: '#6e7b34', pattern: 'savanna', roughness: 0.86 },
  { id: 3, key: 'road_stone', label: 'Imperial Cobblestone Road', hex: '#7c7567', pattern: 'cobble', roughness: 0.76 },
  { id: 4, key: 'rock_cliff', label: 'Mountain Granite Cliff', hex: '#646058', pattern: 'rock', roughness: 0.88 },
  { id: 5, key: 'sand_dune', label: 'Warm Desert & Beach Sand', hex: '#c8b07a', pattern: 'sand', roughness: 0.82 },
  { id: 6, key: 'snow_peak', label: 'Alpine Glacial Snow', hex: '#e2e8f0', pattern: 'snow', roughness: 0.65 },
  { id: 7, key: 'volcanic_mud', label: 'Dark Volcanic Ash & Mud', hex: '#38322e', pattern: 'mud', roughness: 0.92 },
  { id: 8, key: 'forest_floor', label: 'Deep Woodland Moss', hex: '#284b26', pattern: 'moss', roughness: 0.89 },
  { id: 9, key: 'water_bed', label: 'Deep River / Lake Bed', hex: '#162b36', pattern: 'water', roughness: 0.72 },
  { id: 10, key: 'shallow_ford', label: 'Shallow Walkable Ford', hex: '#8c9688', pattern: 'ford', roughness: 0.78 }
]);

/**
 * Generates a pure visual SVG swatch thumbnail for each Paint Biome / Texture Layer
 * so the user sees the visual color & surface pattern directly (like the Skins grid).
 */
export function renderPaintBrushThumbnailSvg(biomeLayer) {
  if (!biomeLayer) return '';
  const bg = biomeLayer.hex || '#3b6e2e';
  const p = biomeLayer.pattern || 'grass';
  if (p === 'auto') {
    return `<svg viewBox="0 0 56 56" class="w-11 h-11 rounded-lg overflow-hidden">
      <rect width="56" height="56" fill="#334155"/>
      <path d="M14 42 L42 14 M18 14 H42 V38" stroke="#f8fafc" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    </svg>`;
  }
  if (p === 'cobble') {
    return `<svg viewBox="0 0 56 56" class="w-11 h-11 rounded-lg overflow-hidden">
      <rect width="56" height="56" fill="${bg}"/>
      <rect x="6" y="8" width="18" height="12" rx="4" fill="#948e80"/>
      <rect x="28" y="8" width="20" height="12" rx="4" fill="#8a8375"/>
      <rect x="12" y="24" width="22" height="12" rx="4" fill="#8f887a"/>
      <rect x="6" y="40" width="20" height="10" rx="4" fill="#948e80"/>
      <rect x="30" y="38" width="18" height="12" rx="4" fill="#686154"/>
    </svg>`;
  }
  if (p === 'sand') {
    return `<svg viewBox="0 0 56 56" class="w-11 h-11 rounded-lg overflow-hidden">
      <rect width="56" height="56" fill="${bg}"/>
      <path d="M6 20 Q18 14 28 20 T50 20" stroke="#e2cca0" stroke-width="3" fill="none"/>
      <path d="M6 36 Q18 30 28 36 T50 36" stroke="#b09660" stroke-width="3" fill="none"/>
    </svg>`;
  }
  if (p === 'snow') {
    return `<svg viewBox="0 0 56 56" class="w-11 h-11 rounded-lg overflow-hidden">
      <rect width="56" height="56" fill="${bg}"/>
      <circle cx="18" cy="18" r="3" fill="#ffffff"/>
      <circle cx="38" cy="24" r="4" fill="#ffffff"/>
      <circle cx="24" cy="38" r="3.5" fill="#cbd5e1"/>
    </svg>`;
  }
  if (p === 'water' || p === 'ford') {
    return `<svg viewBox="0 0 56 56" class="w-11 h-11 rounded-lg overflow-hidden">
      <rect width="56" height="56" fill="${bg}"/>
      <path d="M8 22 Q18 16 28 22 T48 22" stroke="#38bdf8" stroke-width="3" fill="none"/>
      <path d="M8 36 Q18 30 28 36 T48 36" stroke="#7dd3fc" stroke-width="2.5" fill="none"/>
    </svg>`;
  }
  if (p === 'rock' || p === 'mud') {
    return `<svg viewBox="0 0 56 56" class="w-11 h-11 rounded-lg overflow-hidden">
      <rect width="56" height="56" fill="${bg}"/>
      <polygon points="10,44 22,16 36,44" fill="#4b4741" opacity="0.65"/>
      <polygon points="26,44 38,20 50,44" fill="#7c776e" opacity="0.65"/>
    </svg>`;
  }
  // grass / savanna / moss
  return `<svg viewBox="0 0 56 56" class="w-11 h-11 rounded-lg overflow-hidden">
    <rect width="56" height="56" fill="${bg}"/>
    <path d="M16 42 L14 26 M20 42 L22 24 M36 44 L34 28 M40 44 L43 26" stroke="#86efac" stroke-opacity="0.45" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
}

// ============================================================================
// 2. RESOURCE SKINS CATALOG (Visual-First Thumbnails per Resource Type)
// ============================================================================
export const RESOURCE_SKINS_CATALOG = Object.freeze({
  wood: [
    {
      id: 'pine_emerald',
      name: 'Royal Emerald Pine',
      badge: '🌲',
      shape: 'pine',
      trunkColor: '#5c4028',
      crownColorA: '#264e26',
      crownColorB: '#325e2c'
    },
    {
      id: 'oak_round',
      name: 'Ancient Broadleaf Oak',
      badge: '🌳',
      shape: 'oak',
      trunkColor: '#4a321e',
      crownColorA: '#3d6b2c',
      crownColorB: '#4d7c36'
    },
    {
      id: 'cypress_tall',
      name: 'Mediterranean Cypress',
      badge: '🌲',
      shape: 'cypress',
      trunkColor: '#523a24',
      crownColorA: '#1e3f24',
      crownColorB: '#274e2e'
    },
    {
      id: 'autumn_gold',
      name: 'Golden Mallorn Oak',
      badge: '🍂',
      shape: 'oak',
      trunkColor: '#6b4c35',
      crownColorA: '#d97706',
      crownColorB: '#f59e0b'
    },
    {
      id: 'palm_oasis',
      name: 'Southern Oasis Palm',
      badge: '🌴',
      shape: 'palm',
      trunkColor: '#785536',
      crownColorA: '#4d7c2b',
      crownColorB: '#65a30d'
    },
    {
      id: 'deadwood_spooky',
      name: 'Weathered Deadwood',
      badge: '🪵',
      shape: 'deadwood',
      trunkColor: '#47423c',
      crownColorA: '#645c53',
      crownColorB: '#524b44'
    }
  ],
  coins: [
    {
      id: 'gold_vein',
      name: 'Imperial Gold Outcrop',
      badge: '🪙',
      shape: 'outcrop',
      rockColor: '#57534e',
      veinColor: '#fbbf24',
      emissive: '#b45309'
    },
    {
      id: 'gold_crystals',
      name: 'Sunstone Spire Cluster',
      badge: '✨',
      shape: 'crystals',
      rockColor: '#44403c',
      veinColor: '#fde047',
      emissive: '#ca8a04'
    },
    {
      id: 'gold_ruin_mine',
      name: 'Ancient Treasury Shaft',
      badge: '🏛️',
      shape: 'shaft',
      rockColor: '#64748b',
      veinColor: '#f59e0b',
      emissive: '#92400e'
    }
  ],
  iron: [
    {
      id: 'iron_outcrop',
      name: 'Blue-Steel Iron Crag',
      badge: '⚔️',
      shape: 'outcrop',
      rockColor: '#334155',
      veinColor: '#38bdf8',
      emissive: '#0284c7'
    },
    {
      id: 'iron_meteoric',
      name: 'Meteoric Star-Iron Crater',
      badge: '☄️',
      shape: 'crystals',
      rockColor: '#1e293b',
      veinColor: '#7dd3fc',
      emissive: '#0369a1'
    },
    {
      id: 'iron_forge_pit',
      name: 'Deep Ironstone Quarry',
      badge: '⛏️',
      shape: 'shaft',
      rockColor: '#475569',
      veinColor: '#94a3b8',
      emissive: '#334155'
    }
  ],
  stone: [
    {
      id: 'stone_granite',
      name: 'White Granite Monoliths',
      badge: '🪨',
      shape: 'outcrop',
      rockColor: '#94a3b8',
      veinColor: '#f8fafc',
      emissive: '#475569'
    },
    {
      id: 'stone_basalt',
      name: 'Hexagonal Basalt Columns',
      badge: '🧱',
      shape: 'basalt',
      rockColor: '#475569',
      veinColor: '#cbd5e1',
      emissive: '#1e293b'
    },
    {
      id: 'stone_sandstone',
      name: 'Ochre Sandstone Formation',
      badge: '🏜️',
      shape: 'outcrop',
      rockColor: '#b48a5a',
      veinColor: '#fde68a',
      emissive: '#78350f'
    }
  ]
});

export function renderSkinVisualThumbnailSvg(resourceType, skin) {
  if (!skin) return '';
  if (resourceType === 'wood') {
    const trunk = skin.trunkColor || '#5c4028';
    const cA = skin.crownColorA || '#264e26';
    const cB = skin.crownColorB || '#325e2c';
    if (skin.shape === 'oak') {
      return `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow">
        <rect x="27" y="34" width="10" height="22" rx="2" fill="${trunk}"/>
        <circle cx="32" cy="26" r="16" fill="${cA}"/>
        <circle cx="23" cy="29" r="11" fill="${cA}"/>
        <circle cx="40" cy="28" r="12" fill="${cB}"/>
        <circle cx="34" cy="18" r="11" fill="${cB}"/>
      </svg>`;
    }
    if (skin.shape === 'cypress') {
      return `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow">
        <rect x="29" y="42" width="6" height="14" rx="1.5" fill="${trunk}"/>
        <polygon points="32,6 19,44 45,44" fill="${cA}"/>
        <polygon points="32,6 24,38 40,38" fill="${cB}"/>
      </svg>`;
    }
    if (skin.shape === 'palm') {
      return `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow">
        <path d="M28 56 Q34 38 32 22" stroke="${trunk}" stroke-width="6" stroke-linecap="round" fill="none"/>
        <path d="M32 22 Q14 16 10 28" stroke="${cA}" stroke-width="5" stroke-linecap="round" fill="none"/>
        <path d="M32 22 Q50 16 54 28" stroke="${cB}" stroke-width="5" stroke-linecap="round" fill="none"/>
        <path d="M32 22 Q18 8 14 16" stroke="${cB}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
        <path d="M32 22 Q46 8 50 16" stroke="${cA}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
      </svg>`;
    }
    if (skin.shape === 'deadwood') {
      return `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow">
        <path d="M32 56 L32 26 M32 38 L18 24 M32 32 L46 18 M24 30 L16 16 M39 25 L48 12" stroke="${trunk}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
      </svg>`;
    }
    return `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow">
      <rect x="28" y="42" width="8" height="14" rx="1.5" fill="${trunk}"/>
      <polygon points="32,16 14,44 50,44" fill="${cA}"/>
      <polygon points="32,6 18,30 46,30" fill="${cB}"/>
    </svg>`;
  }

  const rock = skin.rockColor || '#57534e';
  const vein = skin.veinColor || '#fbbf24';
  if (skin.shape === 'crystals') {
    return `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow">
      <ellipse cx="32" cy="48" rx="22" ry="8" fill="${rock}"/>
      <polygon points="32,10 23,46 41,46" fill="${vein}"/>
      <polygon points="18,20 12,46 26,46" fill="${vein}" opacity="0.88"/>
      <polygon points="46,18 38,46 52,46" fill="${vein}" opacity="0.92"/>
    </svg>`;
  }
  if (skin.shape === 'shaft') {
    return `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow">
      <rect x="12" y="20" width="40" height="32" rx="5" fill="${rock}"/>
      <rect x="20" y="28" width="5" height="24" fill="${vein}"/>
      <rect x="39" y="28" width="5" height="24" fill="${vein}"/>
      <rect x="18" y="24" width="28" height="6" rx="1.5" fill="${vein}"/>
      <rect x="25" y="34" width="14" height="18" fill="#0f172a"/>
    </svg>`;
  }
  if (skin.shape === 'basalt') {
    return `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow">
      <rect x="14" y="26" width="10" height="26" rx="2" fill="${rock}"/>
      <rect x="26" y="14" width="12" height="38" rx="2" fill="${vein}"/>
      <rect x="40" y="22" width="10" height="30" rx="2" fill="${rock}"/>
      <rect x="20" y="32" width="10" height="20" rx="2" fill="${vein}" opacity="0.85"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow">
    <polygon points="10,48 18,24 34,18 48,24 54,48" fill="${rock}"/>
    <polygon points="22,36 28,22 33,36" fill="${vein}"/>
    <polygon points="36,40 42,26 47,40" fill="${vein}"/>
    <polygon points="16,44 21,34 25,44" fill="${vein}"/>
  </svg>`;
}

// ============================================================================
// 3. DECORATIVE SCENERY PROPS CATALOG
// ============================================================================
export const DECORATIVE_PROPS_CATALOG = Object.freeze([
  { id: 'statue_king', name: 'Colossal King Statue', badge: '🗽', defaultColor: '#cbd5e1', defaultScale: 1.0 },
  { id: 'ruined_arch', name: 'Ancient Ruined Archway', badge: '🏛️', defaultColor: '#94a3b8', defaultScale: 1.0 },
  { id: 'watch_brazier', name: 'Flaming Beacon Brazier', badge: '🔥', defaultColor: '#475569', defaultScale: 1.0 },
  { id: 'obelisk_rune', name: 'Runic Monolith Obelisk', badge: '🔮', defaultColor: '#38bdf8', defaultScale: 1.0 },
  { id: 'rock_arch', name: 'Natural Cliff Stone Arch', badge: '⛰️', defaultColor: '#64748b', defaultScale: 1.0 },
  { id: 'camp_tents', name: 'Mercenary Pavilion & Fire', badge: '⛺', defaultColor: '#d97706', defaultScale: 1.0 },
  { id: 'wooden_cart', name: 'Abandoned Supply Wagon', badge: '🛒', defaultColor: '#92400e', defaultScale: 1.0 },
  { id: 'flower_patch', name: 'Wildflower & Shrub Patch', badge: '🌺', defaultColor: '#22c55e', defaultScale: 1.0 },
  { id: 'fence_wall', name: 'Low Stone Country Wall', badge: '🧱', defaultColor: '#78716c', defaultScale: 1.0 },
  { id: 'dock_pier', name: 'Wooden River Pier', badge: '⚓', defaultColor: '#78350f', defaultScale: 1.0 }
]);

// ============================================================================
// 4. IN-MEMORY ACTIVE CUSTOM MAP & SAVED MAPS LIBRARY
// ============================================================================
let _activeCustomMapState = null;

export function getActiveCustomMapState() {
  if (_activeCustomMapState !== null) return _activeCustomMapState;
  try {
    const raw = globalThis.localStorage?.getItem(CUSTOM_MAP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.isCustomMapActive) {
        _activeCustomMapState = hydrateMapState(parsed);
        return _activeCustomMapState;
      }
    }
  } catch (_) {}
  return null;
}

export function setActiveCustomMapState(mapState) {
  if (!mapState || !mapState.isCustomMapActive) {
    _activeCustomMapState = null;
    try {
      globalThis.localStorage?.removeItem(CUSTOM_MAP_STORAGE_KEY);
    } catch (_) {}
  } else {
    _activeCustomMapState = hydrateMapState(mapState);
    try {
      globalThis.localStorage?.setItem(
        CUSTOM_MAP_STORAGE_KEY,
        JSON.stringify(serializeMapState(_activeCustomMapState))
      );
    } catch (_) {}
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('kings_lands_custom_map_updated'));
    } catch (_) {}
  }
  return _activeCustomMapState;
}

let _sessionSavedMapsCache = null;

export function getSavedMapsList() {
  if (Array.isArray(_sessionSavedMapsCache)) {
    return _sessionSavedMapsCache.map((m) => hydrateMapState(m));
  }
  try {
    const raw = globalThis.localStorage?.getItem(SAVED_MAPS_LIST_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        _sessionSavedMapsCache = parsed;
        return parsed.map((m) => hydrateMapState(m));
      }
    }
  } catch (_) {}
  return [];
}

export function saveMapToLibrary(mapState) {
  const hydrated = hydrateMapState({ ...mapState, isCustomMapActive: true });
  if (!hydrated.id || hydrated.id === 'default_royal_valley') {
    hydrated.id = `map_${Date.now()}`;
  }
  const list = getSavedMapsList();
  const existingIdx = list.findIndex((m) => m.id === hydrated.id);
  const serialized = serializeMapState(hydrated);
  if (existingIdx >= 0) {
    list[existingIdx] = serialized;
  } else {
    list.push(serialized);
  }
  _sessionSavedMapsCache = list;
  try {
    globalThis.localStorage?.setItem(SAVED_MAPS_LIST_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    while (list.length > 1) {
      const dropIdx = list[0].id === hydrated.id ? 1 : 0;
      list.splice(dropIdx, 1);
      try {
        globalThis.localStorage?.setItem(SAVED_MAPS_LIST_STORAGE_KEY, JSON.stringify(list));
        break;
      } catch (_) {}
    }
    console.warn('localStorage quota warning while saving map library:', err);
  }
  return hydrated;
}

export function deleteMapFromLibrary(mapId) {
  const list = getSavedMapsList().filter((m) => m.id !== mapId);
  _sessionSavedMapsCache = list;
  try {
    globalThis.localStorage?.setItem(SAVED_MAPS_LIST_STORAGE_KEY, JSON.stringify(list));
  } catch (_) {}
  return list;
}

export function createDefaultMapState(baseTrees = [], baseMines = []) {
  const totalVerts = MAP_VERTEX_RES * MAP_VERTEX_RES;
  return {
    id: 'default_royal_valley',
    version: 1,
    isCustomMapActive: false,
    isBlankFlatBase: false,
    worldSizeMeters: 4096,
    baseFlatHeightMeters: 1.6,
    name: 'Royal Valley Crossroads',
    waterLevelMeters: -0.08,
    waterColorHex: '#22789b',
    hasCentralRiver: true,
    activeGroundTextureId: 'none',
    groundTextureRepeat: 24,
    customTextures: [],
    heightOverrides: {},
    biomeOverrides: {},
    colorOverrides: {}, // vertexIndex -> [r, g, b] for smooth Brush Strength fading
    totalVerts,
    trees: baseTrees.map((t, idx) => ({
      uid: `tree_${idx}`,
      id: t.id ?? idx,
      x: typeof t.x === 'number' ? t.x : (t.xFx || 0) / 1024,
      z: typeof t.z === 'number' ? t.z : (t.zFx || 0) / 1024,
      scale: typeof t.scale === 'number' ? t.scale : (t.scalePermille || 1000) / 1000,
      rotY: t.rotY || 0,
      skinId: t.skinId || (idx % 3 === 0 ? 'oak_round' : 'pine_emerald')
    })),
    mines: baseMines.map((m, idx) => ({
      uid: `mine_${idx + 1}`,
      id: m.id ?? (idx + 1),
      x: typeof m.x === 'number' ? m.x : (m.xFx || 0) / 1024,
      z: typeof m.z === 'number' ? m.z : (m.zFx || 0) / 1024,
      type: m.type || m.resourceType || 'coins',
      skinId:
        m.skinId ||
        ((m.type || m.resourceType) === 'iron'
          ? 'iron_outcrop'
          : (m.type || m.resourceType) === 'stone'
            ? 'stone_granite'
            : 'gold_vein'),
      rotY: m.rotY || 0,
      scale: m.scale || 1.0
    })),
    bridges: [
      { id: 'bridge_west', x: 1024, z: 2048, rotY: 0, width: 20, length: 48 },
      { id: 'bridge_center', x: 2048, z: 2048, rotY: 0, width: 20, length: 48 },
      { id: 'bridge_east', x: 3072, z: 2048, rotY: 0, width: 20, length: 48 }
    ],
    decorativeProps: [],
    customPropAssets: [],
    spawnPoints: [
      { id: 'spawn_1', name: 'Start Point 1 (South)', x: 2048, z: 1660, facingDir: 256 },
      { id: 'spawn_2', name: 'Start Point 2 (North)', x: 2048, z: 2420, facingDir: 768 }
    ],
    spawns: {
      team1: { x: 2048, z: 1660, facingDir: 256 },
      team2: { x: 2048, z: 2420, facingDir: 768 }
    }
  };
}

export function createBlankFlatMapState(name = 'New Clean Flat Map', worldSizeMeters = 4096) {
  const totalVerts = MAP_VERTEX_RES * MAP_VERTEX_RES;
  const center = Math.round(worldSizeMeters * 0.5);
  const offset = Math.round(worldSizeMeters * 0.1);
  return {
    id: `map_flat_${Date.now()}`,
    version: 1,
    isCustomMapActive: true,
    isBlankFlatBase: true,
    worldSizeMeters: Number(worldSizeMeters) || 4096,
    baseFlatHeightMeters: 1.6,
    name,
    waterLevelMeters: -1.5,
    waterColorHex: '#22789b',
    hasCentralRiver: false,
    activeGroundTextureId: 'none',
    groundTextureRepeat: 24,
    customTextures: [],
    heightOverrides: {},
    biomeOverrides: {},
    colorOverrides: {},
    totalVerts,
    trees: [],
    mines: [],
    bridges: [],
    decorativeProps: [],
    customPropAssets: [],
    spawnPoints: [
      { id: 'spawn_1', name: 'Start Point 1', x: center, z: center - offset, facingDir: 256 },
      { id: 'spawn_2', name: 'Start Point 2', x: center, z: center + offset, facingDir: 768 }
    ],
    spawns: {
      team1: { x: center, z: center - offset, facingDir: 256 },
      team2: { x: center, z: center + offset, facingDir: 768 }
    }
  };
}

export function hydrateMapState(raw) {
  if (!raw || typeof raw !== 'object') return createDefaultMapState();
  const worldSizeMeters = [1024, 2048, 3072, 4096].includes(Number(raw.worldSizeMeters))
    ? Number(raw.worldSizeMeters)
    : 4096;
  const spawnPoints =
    Array.isArray(raw.spawnPoints) && raw.spawnPoints.length > 0
      ? raw.spawnPoints.map((sp, idx) => ({
          id: sp.id || `spawn_${idx + 1}`,
          name: sp.name || `Start Point ${idx + 1}`,
          x: Number(sp.x) || 2048,
          z: Number(sp.z) || 2048,
          facingDir: Number(sp.facingDir ?? (idx % 2 === 0 ? 256 : 768))
        }))
      : [
          {
            id: 'spawn_1',
            name: 'Start Point 1',
            x: Number(raw.spawns?.team1?.x) || 2048,
            z: Number(raw.spawns?.team1?.z) || 1660,
            facingDir: Number(raw.spawns?.team1?.facingDir ?? 256)
          },
          {
            id: 'spawn_2',
            name: 'Start Point 2',
            x: Number(raw.spawns?.team2?.x) || 2048,
            z: Number(raw.spawns?.team2?.z) || 2420,
            facingDir: Number(raw.spawns?.team2?.facingDir ?? 768)
          }
        ];

  const t1 = spawnPoints[0] || { x: 2048, z: 1660, facingDir: 256 };
  const t2 = spawnPoints[1] || { x: 2048, z: 2420, facingDir: 768 };

  return {
    id: raw.id || 'custom_map',
    version: 1,
    isCustomMapActive: Boolean(raw.isCustomMapActive),
    isBlankFlatBase: Boolean(raw.isBlankFlatBase),
    worldSizeMeters,
    baseFlatHeightMeters: Number.isFinite(Number(raw.baseFlatHeightMeters)) ? Number(raw.baseFlatHeightMeters) : 1.6,
    name: raw.name || 'Custom Map',
    waterLevelMeters: Number.isFinite(Number(raw.waterLevelMeters)) ? Number(raw.waterLevelMeters) : -0.08,
    waterColorHex: raw.waterColorHex || '#22789b',
    hasCentralRiver: raw.hasCentralRiver !== false,
    activeGroundTextureId: raw.activeGroundTextureId || 'none',
    groundTextureRepeat: Math.max(1, Number(raw.groundTextureRepeat) || 24),
    customTextures: Array.isArray(raw.customTextures) ? raw.customTextures : [],
    heightOverrides: raw.heightOverrides && typeof raw.heightOverrides === 'object' ? { ...raw.heightOverrides } : {},
    biomeOverrides: raw.biomeOverrides && typeof raw.biomeOverrides === 'object' ? { ...raw.biomeOverrides } : {},
    colorOverrides: raw.colorOverrides && typeof raw.colorOverrides === 'object' ? { ...raw.colorOverrides } : {},
    trees: Array.isArray(raw.trees)
      ? raw.trees.map((t, i) => ({
          uid: t.uid || `tree_${t.id ?? i}_${i}`,
          id: t.id ?? i,
          x: Number(t.x) || 2048,
          z: Number(t.z) || 2048,
          scale: Number(t.scale) || 1.0,
          rotY: Number(t.rotY) || 0,
          skinId: t.skinId || 'pine_emerald'
        }))
      : [],
    mines: Array.isArray(raw.mines)
      ? raw.mines.map((m, i) => ({
          uid: m.uid || `mine_${m.id ?? (i + 1)}_${i}`,
          id: m.id ?? (i + 1),
          x: Number(m.x) || 2048,
          z: Number(m.z) || 2048,
          type: m.type || m.resourceType || 'coins',
          skinId: m.skinId || 'gold_vein',
          rotY: Number(m.rotY) || 0,
          scale: Number(m.scale) || 1.0
        }))
      : [],
    bridges: Array.isArray(raw.bridges)
      ? raw.bridges.map((b, i) => ({
          id: b.id || `bridge_${i}`,
          x: Number(b.x) || 2048,
          z: Number(b.z) || 2048,
          rotY: Number(b.rotY) || 0,
          width: Math.max(8, Number(b.width) || 20),
          length: Math.max(14, Number(b.length) || 48)
        }))
      : [],
    decorativeProps: Array.isArray(raw.decorativeProps) ? raw.decorativeProps : [],
    customPropAssets: Array.isArray(raw.customPropAssets) ? raw.customPropAssets : [],
    spawnPoints,
    spawns: {
      team1: { x: t1.x, z: t1.z, facingDir: t1.facingDir ?? 256 },
      team2: { x: t2.x, z: t2.z, facingDir: t2.facingDir ?? 768 }
    }
  };
}

export function serializeMapState(state) {
  const h = hydrateMapState(state);
  const compactHeights = {};
  for (const [k, v] of Object.entries(h.heightOverrides || {})) {
    compactHeights[k] = Math.round(Number(v) * 100) / 100;
  }
  const compactColors = {};
  for (const [k, v] of Object.entries(h.colorOverrides || {})) {
    compactColors[k] = Array.isArray(v) ? v.map((c) => Math.round(Number(c) * 1000) / 1000) : v;
  }
  return { ...h, heightOverrides: compactHeights, colorOverrides: compactColors };
}

export function sampleCustomMapHeightMeters(mapState, worldX, worldZ) {
  if (!mapState || !mapState.isCustomMapActive) return null;
  const ho = mapState.heightOverrides || {};
  const isFlatBase = Boolean(mapState.isBlankFlatBase);
  const flatDefault = Number.isFinite(Number(mapState.baseFlatHeightMeters))
    ? Number(mapState.baseFlatHeightMeters)
    : 1.6;
  const cellMeters = (mapState.worldSizeMeters || MAP_WORLD_SIZE) / (MAP_VERTEX_RES - 1);

  const gx = Math.max(0, Math.min(MAP_VERTEX_RES - 1.0001, worldX / cellMeters));
  const gz = Math.max(0, Math.min(MAP_VERTEX_RES - 1.0001, worldZ / cellMeters));
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;

  const idx00 = iz * MAP_VERTEX_RES + ix;
  const idx10 = iz * MAP_VERTEX_RES + Math.min(MAP_VERTEX_RES - 1, ix + 1);
  const idx01 = Math.min(MAP_VERTEX_RES - 1, iz + 1) * MAP_VERTEX_RES + ix;
  const idx11 = Math.min(MAP_VERTEX_RES - 1, iz + 1) * MAP_VERTEX_RES + Math.min(MAP_VERTEX_RES - 1, ix + 1);

  const h00 = ho[idx00];
  const h10 = ho[idx10];
  const h01 = ho[idx01];
  const h11 = ho[idx11];

  if (!isFlatBase && h00 === undefined && h10 === undefined && h01 === undefined && h11 === undefined) {
    return null;
  }

  const v00 = h00 !== undefined ? Number(h00) : (isFlatBase ? flatDefault : null);
  const v10 = h10 !== undefined ? Number(h10) : (isFlatBase ? flatDefault : null);
  const v01 = h01 !== undefined ? Number(h01) : (isFlatBase ? flatDefault : null);
  const v11 = h11 !== undefined ? Number(h11) : (isFlatBase ? flatDefault : null);
  const fallback = v00 ?? v10 ?? v01 ?? v11 ?? flatDefault;

  const a = (v00 ?? fallback) * (1 - fx) + (v10 ?? fallback) * fx;
  const b = (v01 ?? fallback) * (1 - fx) + (v11 ?? fallback) * fx;
  return a * (1 - fz) + b * fz;
}

export function sampleCustomMapBiomeId(mapState, worldX, worldZ) {
  if (!mapState || !mapState.isCustomMapActive || !mapState.biomeOverrides) return 0;
  const cellMeters = (mapState.worldSizeMeters || MAP_WORLD_SIZE) / (MAP_VERTEX_RES - 1);
  const ix = Math.max(0, Math.min(MAP_VERTEX_RES - 1, Math.round(worldX / cellMeters)));
  const iz = Math.max(0, Math.min(MAP_VERTEX_RES - 1, Math.round(worldZ / cellMeters)));
  return mapState.biomeOverrides[iz * MAP_VERTEX_RES + ix] || 0;
}

export function sampleCustomMapVertexRgb(mapState, vertexIndex) {
  const rgb = mapState?.colorOverrides?.[vertexIndex];
  if (Array.isArray(rgb) && rgb.length >= 3) {
    return rgb;
  }
  return null;
}

// ============================================================================
// 5. CACHED GEOMETRIES & MATERIALS + 3D MESH BUILDERS
// ============================================================================
const _matCache = new Map();
const _geomCache = new Map();

function getCachedStandardMat(colorHex, roughness = 0.8, metalness = 0.1, emissiveHex = null) {
  const key = `${colorHex}_${roughness}_${metalness}_${emissiveHex || ''}`;
  let m = _matCache.get(key);
  if (!m) {
    const opts = { color: colorHex, roughness, metalness };
    if (emissiveHex) {
      opts.emissive = emissiveHex;
      opts.emissiveIntensity = 0.28;
    }
    m = new THREE.MeshStandardMaterial(opts);
    _matCache.set(key, m);
  }
  return m;
}

function getCachedGeom(key, factoryFn) {
  let g = _geomCache.get(key);
  if (!g) {
    g = factoryFn();
    _geomCache.set(key, g);
  }
  return g;
}

export function createTreeMeshBySkin(skinId = 'pine_emerald', scale = 1.0, rotY = 0) {
  const skin =
    RESOURCE_SKINS_CATALOG.wood.find((s) => s.id === skinId) ||
    RESOURCE_SKINS_CATALOG.wood[0];
  const group = new THREE.Group();
  const trunkMat = getCachedStandardMat(skin.trunkColor, 0.9, 0.05);
  const crownMatA = getCachedStandardMat(skin.crownColorA, 0.8, 0.05);
  const crownMatB = getCachedStandardMat(skin.crownColorB, 0.8, 0.05);

  if (skinId === 'oak_round' || skinId === 'autumn_gold') {
    const trunk = new THREE.Mesh(
      getCachedGeom('oak_trunk', () => new THREE.CylinderGeometry(0.28, 0.44, 2.2, 7)),
      trunkMat
    );
    trunk.position.y = 1.1;
    group.add(trunk);

    const mainCrown = new THREE.Mesh(
      getCachedGeom('oak_crown1', () => new THREE.DodecahedronGeometry(1.85, 1)),
      crownMatA
    );
    mainCrown.scale.set(1.15, 0.88, 1.15);
    mainCrown.position.y = 3.1;
    group.add(mainCrown);

    const topPuff = new THREE.Mesh(
      getCachedGeom('oak_crown2', () => new THREE.DodecahedronGeometry(1.35, 1)),
      crownMatB
    );
    topPuff.position.set(0.35, 4.1, -0.25);
    group.add(topPuff);
  } else if (skinId === 'cypress_tall') {
    const trunk = new THREE.Mesh(
      getCachedGeom('cyp_trunk', () => new THREE.CylinderGeometry(0.18, 0.28, 1.8, 6)),
      trunkMat
    );
    trunk.position.y = 0.9;
    group.add(trunk);

    const spire1 = new THREE.Mesh(
      getCachedGeom('cyp_spire1', () => new THREE.ConeGeometry(0.95, 4.6, 8)),
      crownMatA
    );
    spire1.position.y = 3.4;
    group.add(spire1);

    const spire2 = new THREE.Mesh(
      getCachedGeom('cyp_spire2', () => new THREE.ConeGeometry(0.68, 3.2, 8)),
      crownMatB
    );
    spire2.position.y = 4.8;
    group.add(spire2);
  } else if (skinId === 'palm_oasis') {
    const trunk = new THREE.Mesh(
      getCachedGeom('palm_trunk', () => new THREE.CylinderGeometry(0.18, 0.30, 3.6, 7)),
      trunkMat
    );
    trunk.position.y = 1.8;
    trunk.rotation.z = 0.08;
    group.add(trunk);

    const frondGeom = getCachedGeom('palm_frond', () => new THREE.ConeGeometry(0.45, 2.2, 5));
    for (let f = 0; f < 6; f++) {
      const ang = (f * Math.PI * 2) / 6;
      const frond = new THREE.Mesh(frondGeom, f % 2 === 0 ? crownMatA : crownMatB);
      frond.position.set(Math.cos(ang) * 0.9 - 0.14, 3.55, Math.sin(ang) * 0.9);
      frond.rotation.z = Math.PI * 0.38;
      frond.rotation.y = -ang;
      group.add(frond);
    }
  } else if (skinId === 'deadwood_spooky') {
    const trunk = new THREE.Mesh(
      getCachedGeom('dead_trunk', () => new THREE.CylinderGeometry(0.22, 0.42, 3.0, 6)),
      trunkMat
    );
    trunk.position.y = 1.5;
    group.add(trunk);
    const branchGeom = getCachedGeom('dead_branch', () => new THREE.CylinderGeometry(0.08, 0.14, 1.6, 5));
    for (let b = 0; b < 3; b++) {
      const branch = new THREE.Mesh(branchGeom, crownMatA);
      branch.position.set((b - 1) * 0.45, 2.4 + b * 0.3, (b % 2 === 0 ? 1 : -1) * 0.3);
      branch.rotation.z = b === 0 ? 0.65 : -0.58;
      group.add(branch);
    }
  } else {
    const trunk = new THREE.Mesh(
      getCachedGeom('pine_trunk', () => new THREE.CylinderGeometry(0.22, 0.35, 2.1, 6)),
      trunkMat
    );
    trunk.position.y = 1.05;
    group.add(trunk);

    const lower = new THREE.Mesh(
      getCachedGeom('pine_lower', () => new THREE.ConeGeometry(1.5, 3.3, 7)),
      crownMatA
    );
    lower.position.y = 2.8;
    group.add(lower);

    const upper = new THREE.Mesh(
      getCachedGeom('pine_upper', () => new THREE.ConeGeometry(1.1, 2.5, 7)),
      crownMatB
    );
    upper.position.y = 4.4;
    group.add(upper);
  }

  group.scale.set(scale, scale, scale);
  group.rotation.y = rotY;
  return group;
}

export function createMineMeshBySkin(type = 'coins', skinId = 'gold_vein', scale = 1.0, rotY = 0) {
  const catalog = RESOURCE_SKINS_CATALOG[type] || RESOURCE_SKINS_CATALOG.coins;
  const skin = catalog.find((s) => s.id === skinId) || catalog[0];
  const group = new THREE.Group();

  const rockMat = getCachedStandardMat(skin.rockColor, 0.78, type === 'iron' ? 0.45 : 0.15);
  const veinMat = getCachedStandardMat(skin.veinColor, 0.24, 0.82, skin.emissive);

  if (skinId === 'gold_crystals' || skinId === 'iron_meteoric') {
    const base = new THREE.Mesh(
      getCachedGeom('mine_crys_base', () => new THREE.CylinderGeometry(3.2, 3.8, 0.9, 9)),
      rockMat
    );
    base.position.y = 0.45;
    group.add(base);
    for (let c = 0; c < 7; c++) {
      const ang = (c / 7) * Math.PI * 2;
      const dist = c === 0 ? 0 : 1.55;
      const h = c === 0 ? 3.8 : 2.5 + (c % 3) * 0.45;
      const spire = new THREE.Mesh(
        getCachedGeom(`mine_spire_${h}`, () => new THREE.ConeGeometry(0.65, h, 6)),
        veinMat
      );
      spire.position.set(Math.cos(ang) * dist, h * 0.5 + 0.4, Math.sin(ang) * dist);
      if (c > 0) {
        spire.rotation.z = Math.cos(ang) * 0.22;
        spire.rotation.x = Math.sin(ang) * 0.22;
      }
      group.add(spire);
    }
  } else if (skinId === 'stone_basalt') {
    for (let c = 0; c < 8; c++) {
      const ang = (c / 7) * Math.PI * 2;
      const dist = c === 0 ? 0 : 1.65;
      const h = c === 0 ? 3.4 : 1.6 + (c % 4) * 0.45;
      const col = new THREE.Mesh(
        getCachedGeom(`basalt_col_${h}`, () => new THREE.CylinderGeometry(0.75, 0.78, h, 6)),
        c % 2 === 0 ? rockMat : veinMat
      );
      col.position.set(Math.cos(ang) * dist, h * 0.5, Math.sin(ang) * dist);
      group.add(col);
    }
  } else if (skinId === 'gold_ruin_mine' || skinId === 'iron_forge_pit') {
    const mound = new THREE.Mesh(
      getCachedGeom('mine_shaft_mound', () => new THREE.BoxGeometry(4.8, 2.6, 4.2)),
      rockMat
    );
    mound.position.y = 1.3;
    group.add(mound);
    const archGeom = getCachedGeom('mine_shaft_arch', () => new THREE.BoxGeometry(0.45, 2.4, 0.45));
    const archL = new THREE.Mesh(archGeom, veinMat);
    archL.position.set(-1.2, 1.2, 2.15);
    const archR = new THREE.Mesh(archGeom, veinMat);
    archR.position.set(1.2, 1.2, 2.15);
    const archTop = new THREE.Mesh(
      getCachedGeom('mine_shaft_top', () => new THREE.BoxGeometry(2.9, 0.45, 0.55)),
      veinMat
    );
    archTop.position.set(0, 2.4, 2.15);
    group.add(archL, archR, archTop);
  } else {
    const baseMound = new THREE.Mesh(
      getCachedGeom('mine_outcrop_base', () => new THREE.DodecahedronGeometry(3.0, 1)),
      rockMat
    );
    baseMound.scale.set(1.2, 0.78, 1.1);
    baseMound.position.y = 1.15;
    group.add(baseMound);

    const crystalGeom = getCachedGeom('mine_outcrop_crys', () => new THREE.OctahedronGeometry(0.9, 0));
    for (let c = 0; c < 5; c++) {
      const angle = (c / 5) * Math.PI * 2;
      const crystal = new THREE.Mesh(crystalGeom, veinMat);
      crystal.scale.set(0.7, 1.55, 0.7);
      crystal.position.set(Math.cos(angle) * 1.65, 2.0, Math.sin(angle) * 1.65);
      crystal.rotation.set(Math.sin(angle) * 0.35, angle, Math.cos(angle) * 0.35);
      group.add(crystal);
    }
  }

  group.scale.set(scale, scale, scale);
  group.rotation.y = rotY;
  return group;
}

export function createDecorativePropMesh(propRecord, customPropAssets = []) {
  const { propType, scale = 1.0, rotY = 0, colorHex = '#cbd5e1', customAssetId = null } = propRecord || {};
  const group = new THREE.Group();
  const mainMat = getCachedStandardMat(colorHex || '#cbd5e1', 0.72, 0.18);
  const accentMat = getCachedStandardMat('#fbbf24', 0.35, 0.75);
  const woodMat = getCachedStandardMat('#78350f', 0.88, 0.05);

  const customAsset = customAssetId
    ? (customPropAssets || []).find((a) => a.id === customAssetId)
    : (customPropAssets || []).find((a) => a.id === propType);

  if (customAsset) {
    if (customAsset.kind === 'obj' && Array.isArray(customAsset.vertices) && customAsset.vertices.length >= 9) {
      const geom = getCachedGeom(`obj_${customAsset.id}`, () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(customAsset.vertices), 3));
        g.computeVertexNormals();
        return g;
      });
      const mesh = new THREE.Mesh(geom, mainMat);
      group.add(mesh);
    } else if (customAsset.kind === 'json' && Array.isArray(customAsset.parts)) {
      for (const pt of customAsset.parts) {
        const sz = pt.size || [1, 1, 1];
        const g = pt.shape === 'cylinder'
          ? new THREE.CylinderGeometry(sz[0] || 0.5, sz[1] || 0.5, sz[2] || 2, 10)
          : pt.shape === 'cone'
            ? new THREE.ConeGeometry(sz[0] || 0.8, sz[1] || 2, 10)
            : pt.shape === 'sphere'
              ? new THREE.SphereGeometry(sz[0] || 0.8, 10, 8)
              : new THREE.BoxGeometry(sz[0] || 1, sz[1] || 1, sz[2] || 1);
        const m = new THREE.Mesh(g, getCachedStandardMat(pt.color || colorHex || '#cbd5e1', 0.7, 0.1));
        if (Array.isArray(pt.pos)) m.position.set(pt.pos[0] || 0, pt.pos[1] || 0, pt.pos[2] || 0);
        if (Array.isArray(pt.rot)) m.rotation.set(pt.rot[0] || 0, pt.rot[1] || 0, pt.rot[2] || 0);
        group.add(m);
      }
    } else if (customAsset.kind === 'image_billboard' && customAsset.dataUrl && typeof Image !== 'undefined') {
      const ped = new THREE.Mesh(getCachedGeom('bb_ped', () => new THREE.CylinderGeometry(1.1, 1.3, 0.35, 12)), mainMat);
      ped.position.y = 0.18;
      group.add(ped);
      const planeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true });
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 256;
        const ctx = c.getContext('2d');
        ctx?.drawImage?.(img, 0, 0, 256, 256);
        planeMat.map = new THREE.CanvasTexture(c);
        planeMat.needsUpdate = true;
      };
      img.src = customAsset.dataUrl;
      const plane = new THREE.Mesh(getCachedGeom('bb_plane', () => new THREE.PlaneGeometry(3.4, 3.4)), planeMat);
      plane.position.y = 2.05;
      group.add(plane);
    }
  } else if (propType === 'statue_king') {
    const ped = new THREE.Mesh(getCachedGeom('st_ped', () => new THREE.BoxGeometry(2.6, 1.8, 2.6)), mainMat);
    ped.position.y = 0.9;
    const body = new THREE.Mesh(getCachedGeom('st_body', () => new THREE.CylinderGeometry(0.65, 0.85, 3.6, 8)), mainMat);
    body.position.y = 3.6;
    const head = new THREE.Mesh(getCachedGeom('st_head', () => new THREE.SphereGeometry(0.55, 8, 8)), mainMat);
    head.position.y = 5.8;
    const crown = new THREE.Mesh(getCachedGeom('st_crown', () => new THREE.CylinderGeometry(0.48, 0.42, 0.35, 6)), accentMat);
    crown.position.y = 6.35;
    const sword = new THREE.Mesh(getCachedGeom('st_sword', () => new THREE.BoxGeometry(0.16, 3.2, 0.08)), accentMat);
    sword.position.set(0, 3.4, 0.95);
    group.add(ped, body, head, crown, sword);
  } else if (propType === 'ruined_arch') {
    const colL = new THREE.Mesh(getCachedGeom('ra_colL', () => new THREE.CylinderGeometry(0.45, 0.55, 4.2, 8)), mainMat);
    colL.position.set(-2.1, 2.1, 0);
    const colR = new THREE.Mesh(getCachedGeom('ra_colR', () => new THREE.CylinderGeometry(0.45, 0.55, 3.6, 8)), mainMat);
    colR.position.set(2.1, 1.8, 0);
    const beam = new THREE.Mesh(getCachedGeom('ra_beam', () => new THREE.BoxGeometry(5.2, 0.65, 0.9)), mainMat);
    beam.position.set(0, 4.1, 0);
    beam.rotation.z = -0.08;
    group.add(colL, colR, beam);
  } else if (propType === 'watch_brazier') {
    const stand = new THREE.Mesh(getCachedGeom('wb_stand', () => new THREE.CylinderGeometry(0.55, 0.85, 2.2, 8)), mainMat);
    stand.position.y = 1.1;
    const flame = new THREE.Mesh(
      getCachedGeom('wb_flame', () => new THREE.ConeGeometry(0.65, 1.4, 7)),
      getCachedStandardMat('#f97316', 0.3, 0.1, '#ea580c')
    );
    flame.position.y = 2.8;
    group.add(stand, flame);
  } else if (propType === 'obelisk_rune') {
    const base = new THREE.Mesh(getCachedGeom('ob_base', () => new THREE.BoxGeometry(2.2, 0.8, 2.2)), mainMat);
    base.position.y = 0.4;
    const shaft = new THREE.Mesh(getCachedGeom('ob_shaft', () => new THREE.CylinderGeometry(0.35, 0.75, 5.4, 4)), mainMat);
    shaft.position.y = 3.5;
    const tip = new THREE.Mesh(getCachedGeom('ob_tip', () => new THREE.ConeGeometry(0.5, 1.1, 4)), accentMat);
    tip.position.y = 6.75;
    group.add(base, shaft, tip);
  } else if (propType === 'rock_arch') {
    const rGeom = getCachedGeom('rk_arch', () => new THREE.DodecahedronGeometry(2.2, 0));
    const leftRock = new THREE.Mesh(rGeom, mainMat);
    leftRock.scale.set(1.0, 1.8, 1.0);
    leftRock.position.set(-2.6, 2.2, 0);
    const rightRock = new THREE.Mesh(rGeom, mainMat);
    rightRock.scale.set(1.0, 1.8, 1.0);
    rightRock.position.set(2.6, 2.2, 0);
    const spanRock = new THREE.Mesh(rGeom, mainMat);
    spanRock.scale.set(1.9, 0.7, 0.9);
    spanRock.position.set(0, 4.4, 0);
    group.add(leftRock, rightRock, spanRock);
  } else if (propType === 'camp_tents') {
    const tent = new THREE.Mesh(getCachedGeom('ct_tent', () => new THREE.ConeGeometry(2.1, 2.6, 4)), mainMat);
    tent.position.set(-1.4, 1.3, 0);
    tent.rotation.y = Math.PI * 0.25;
    const fire = new THREE.Mesh(
      getCachedGeom('ct_fire', () => new THREE.ConeGeometry(0.45, 0.85, 6)),
      getCachedStandardMat('#f97316', 0.3, 0.1, '#ea580c')
    );
    fire.position.set(1.5, 0.45, 0.8);
    group.add(tent, fire);
  } else if (propType === 'wooden_cart') {
    const bed = new THREE.Mesh(getCachedGeom('wc_bed', () => new THREE.BoxGeometry(2.6, 0.6, 1.6)), woodMat);
    bed.position.y = 0.85;
    group.add(bed);
    const wGeom = getCachedGeom('wc_wheel', () => new THREE.CylinderGeometry(0.55, 0.55, 0.16, 10));
    for (const side of [-0.9, 0.9]) {
      const wheel = new THREE.Mesh(wGeom, accentMat);
      wheel.rotation.x = Math.PI * 0.5;
      wheel.position.set(0, 0.55, side);
      group.add(wheel);
    }
  } else if (propType === 'fence_wall') {
    const wall = new THREE.Mesh(getCachedGeom('fw_wall', () => new THREE.BoxGeometry(6.0, 1.2, 0.75)), mainMat);
    wall.position.y = 0.6;
    group.add(wall);
  } else if (propType === 'dock_pier') {
    const deck = new THREE.Mesh(getCachedGeom('dp_deck', () => new THREE.BoxGeometry(3.2, 0.28, 8.5)), woodMat);
    deck.position.y = 0.85;
    group.add(deck);
    const pGeom = getCachedGeom('dp_post', () => new THREE.CylinderGeometry(0.18, 0.18, 2.4, 6));
    for (const pz of [-3.5, 0, 3.5]) {
      for (const px of [-1.3, 1.3]) {
        const post = new THREE.Mesh(pGeom, woodMat);
        post.position.set(px, 0.3, pz);
        group.add(post);
      }
    }
  } else {
    const bGeom = getCachedGeom('fp_bush', () => new THREE.DodecahedronGeometry(0.65, 1));
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const bush = new THREE.Mesh(bGeom, i % 2 === 0 ? mainMat : accentMat);
      bush.position.set(Math.cos(ang) * 1.1, 0.45, Math.sin(ang) * 1.1);
      group.add(bush);
    }
  }

  group.scale.set(scale, scale, scale);
  group.rotation.y = rotY;
  return group;
}

export function createSpawnBeaconMesh(index = 1, facingDir = 256) {
  const group = new THREE.Group();
  const keepMat = getCachedStandardMat('#cbd5e1', 0.6, 0.2);
  const roofMat = getCachedStandardMat('#38bdf8', 0.4, 0.3, '#0284c7');
  const goldMat = getCachedStandardMat('#fbbf24', 0.3, 0.8, '#b45309');

  const baseKeep = new THREE.Mesh(
    getCachedGeom('sp_keep_box', () => new THREE.BoxGeometry(11, 6.5, 11)),
    keepMat
  );
  baseKeep.position.y = 3.25;
  const roof = new THREE.Mesh(
    getCachedGeom('sp_keep_roof', () => new THREE.ConeGeometry(8.5, 4.5, 4)),
    roofMat
  );
  roof.position.y = 8.75;
  roof.rotation.y = Math.PI * 0.25;
  group.add(baseKeep, roof);

  const workerGeom = getCachedGeom('sp_worker_cyl', () => new THREE.CylinderGeometry(0.45, 0.5, 1.8, 8));
  for (const side of [-1, 1]) {
    for (let w = -1; w <= 1; w++) {
      const workerMesh = new THREE.Mesh(workerGeom, goldMat);
      workerMesh.position.set(side * 6.5 + w * 1.4, 0.9, 10.5);
      group.add(workerMesh);
    }
  }

  // Floating 3D Number Badge (#1, #2, #3...)
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx && typeof ctx.arc === 'function') {
      ctx.beginPath();
      ctx.arc(64, 64, 54, 0, Math.PI * 2);
      ctx.fillStyle = '#0ea5e9';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#fef08a';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 54px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`#${index}`, 64, 66);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
      sprite.scale.set(12, 12, 1);
      sprite.position.set(0, 17.5, 0);
      group.add(sprite);
    }
  }

  const yawRad = ((facingDir & 1023) / 1024) * Math.PI * 2;
  group.rotation.y = Math.PI * 0.5 - yawRad;
  return group;
}

export function parseWavefrontObjToVertices(objText) {
  const posList = [];
  const outVerts = [];
  const lines = String(objText || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      posList.push([parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0]);
    } else if (parts[0] === 'f' && parts.length >= 4) {
      const faceIndices = parts.slice(1).map((tok) => {
        const idx = parseInt(tok.split('/')[0], 10);
        return idx < 0 ? posList.length + idx : idx - 1;
      });
      for (let t = 1; t < faceIndices.length - 1; t++) {
        const p0 = posList[faceIndices[0]];
        const p1 = posList[faceIndices[t]];
        const p2 = posList[faceIndices[t + 1]];
        if (p0 && p1 && p2) {
          outVerts.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
        }
      }
    }
  }
  return outVerts;
}
