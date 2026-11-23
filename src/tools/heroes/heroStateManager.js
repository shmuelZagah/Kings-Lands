/**
 * Kings Lands — Phase 8: Dedicated Heroes Data Store, Portrait Auto-Linker & State Manager
 * (src/tools/heroes/heroStateManager.js)
 *
 * Manages `src/data/heroes.json` completely separately from `units.json`.
 * - Marks shipped heroes (`wizard`, `warrior`, `archer`) with `isBuiltIn: true` and newly created heroes with `isBuiltIn: false`.
 * - Persists working changes to `localStorage` (`kings_lands_heroes_data_v2`) and supports
 *   exporting/importing standalone `heroes.json` files.
 * - Integrates with `createPortraitStudio` (`src/tools/studio/portraitRenderer.js`) so Hero portraits
 *   can be snapped in the Lab camera, imported from a PNG file, or auto-generated & linked to the Hero profile
 *   for use in the Main Base recruitment bar, Top-Right Hero HUD, and Hall of Heroes.
 */

import defaultHeroesJson from '../../data/heroes.json';
import defaultUnitsJson from '../../data/visuals/units.json';
import { ModelFactory } from '../../render/modelFactory.js';
import { createPortraitStudio } from '../studio/portraitRenderer.js';
import { getEquipmentCombatBase } from '../studio/clipResolver.js';
import { pruneDraftForRuntime } from '../studio/baseUnitsMigration.js';

export const HEROES_STORAGE_KEY = 'kings_lands_heroes_data_v10';
const SAVE_DELAY_MS = 350;

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

// Legacy spell ID migration map so older saved schedules continue working seamlessly
export const LEGACY_SPELL_ID_ALIASES = Object.freeze({
  iron_skin: 'iron_blood',
  cleave_strike: 'shockwave_slam',
  berserk: 'wind_stride',
  arcane_shield: 'self_heal',
  revive_fallen: 'royal_sanctuary'
});

export function normalizeSpellId(spellId) {
  if (!spellId) return null;
  return LEGACY_SPELL_ID_ALIASES[spellId] || spellId;
}

// In-memory cache of rendered portrait data URLs so we only render once per hero if not saved yet
const _runtimePortraitCache = new Map();

function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Extracts unique spell IDs assigned in a Hero's 10-level `spellSchedule` in order of first unlock.
 */
export function getUniqueHeroSpellIds(heroDef) {
  const schedule = Array.isArray(heroDef?.spellSchedule) ? heroDef.spellSchedule : [];
  const seen = new Set();
  const ordered = [];
  for (let i = 0; i < schedule.length; i++) {
    const slot = schedule[i];
    const sid = normalizeSpellId(slot?.spellId);
    if (slot && sid && slot.type !== 'skip' && !seen.has(sid)) {
      seen.add(sid);
      ordered.push(sid);
    }
  }
  return ordered;
}

/**
 * Returns the required animation slot base names (`spell_<spellId>`) for all unique spells assigned to a Hero.
 */
export function getHeroSpellClipBases(heroDef) {
  return getUniqueHeroSpellIds(heroDef).map((spellId) => `spell_${spellId}`);
}

/**
 * Returns the 4 Spell Trees filtered for a specific Hero Class ('warrior' | 'archer' | 'wizard').
 */
export function getSpellTreesForClass(heroesData, heroClass = 'warrior') {
  const cl = ['warrior', 'archer', 'wizard'].includes(heroClass) ? heroClass : 'warrior';
  const trees = heroesData?.spellTrees || defaultHeroesJson.spellTrees || {};
  return Object.values(trees).filter((t) => {
    if (!t) return false;
    const allowed = Array.isArray(t.allowedClasses) ? t.allowedClasses : ['all'];
    return allowed.includes('all') || allowed.includes(cl);
  });
}

/**
 * Lookup spell metadata across all spell trees and cross-tree hybrid spells.
 */
export function findSpellDef(heroesData, rawSpellId) {
  const spellId = normalizeSpellId(rawSpellId);
  if (!spellId) return null;
  const trees = heroesData?.spellTrees || defaultHeroesJson.spellTrees || {};
  for (const tree of Object.values(trees)) {
    if (tree?.spells?.[spellId]) {
      return tree.spells[spellId];
    }
  }
  const hybrids = heroesData?.hybridSpells || defaultHeroesJson.hybridSpells || {};
  if (hybrids[spellId]) {
    return hybrids[spellId];
  }
  if (defaultHeroesJson.hybridSpells?.[spellId]) {
    return defaultHeroesJson.hybridSpells[spellId];
  }
  for (const tree of Object.values(defaultHeroesJson.spellTrees || {})) {
    if (tree?.spells?.[spellId]) {
      return tree.spells[spellId];
    }
  }
  return null;
}

/**
 * Checks whether a Hero has a secondary gear set (`loadout2`) with a valid weapon.
 */
export function heroHasSecondaryLoadout(heroDef) {
  const lds = heroDef?.loadouts;
  if (!lds || typeof lds !== 'object') return false;
  for (const [k, ld] of Object.entries(lds)) {
    if (k === 'main') continue;
    const eq = ld?.equipment;
    if (eq && (eq.weapon_socket_R?.prefab || eq.weapon_socket_L?.prefab)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the weapon stance ('ranged' | 'melee') for a given equipment map.
 */
export function getEquipmentWeaponMode(equipment) {
  if (!equipment) return 'melee';
  const r = String(equipment.weapon_socket_R?.prefab || '');
  const l = String(equipment.weapon_socket_L?.prefab || '');
  if (/bow|crossbow/i.test(r) || /bow|crossbow/i.test(l)) {
    return 'ranged';
  }
  return 'melee';
}

/**
 * Load the latest Heroes data (merging any new built-in heroes, spell trees, hybrid spells, prefabs, or animations from `heroes.json`).
 */
export function loadHeroesDataFromStorage() {
  const fresh = deepClone(defaultHeroesJson);
  if (typeof localStorage === 'undefined') return fresh;

  try {
    const raw = localStorage.getItem(HEROES_STORAGE_KEY);
    if (!raw) return fresh;
    const pack = JSON.parse(raw);
    const data = pack?.data || pack;
    if (!data || typeof data !== 'object' || !data.heroes) return fresh;

    // Merge canonical spellTrees and hybridSpells while preserving user-edited spell parameters & ranks
    const applySavedSpellEdits = (sp, oldSp) => {
      if (!sp || !oldSp) return;
      if (typeof oldSp.rangeMeters === "number" && (oldSp.userModifiedRange || oldSp.userModifiedParams)) {
        sp.rangeMeters = oldSp.rangeMeters;
        sp.userModifiedRange = true;
      }
      if (typeof oldSp.radiusMeters === "number" && (oldSp.userModifiedRadius || oldSp.userModifiedParams)) {
        sp.radiusMeters = oldSp.radiusMeters;
        sp.userModifiedRadius = true;
      }
      if (oldSp.vfxStyle && (oldSp.userModifiedVfx || oldSp.userModifiedParams)) {
        sp.vfxStyle = oldSp.vfxStyle;
        sp.userModifiedVfx = true;
      }
      if (oldSp.userModifiedParams) {
        sp.userModifiedParams = true;
        for (const k of ["cooldownSec", "castTimeSec", "maxKnockbackWeight", "knockbackMeters", "lineWidthMeters", "cost", "description"]) {
          if (oldSp[k] !== undefined) sp[k] = deepClone(oldSp[k]);
        }
        if (Array.isArray(oldSp.ranks) && Array.isArray(sp.ranks)) {
          for (let r = 0; r < sp.ranks.length && r < oldSp.ranks.length; r++) {
            sp.ranks[r] = { ...sp.ranks[r], ...deepClone(oldSp.ranks[r]) };
          }
        }
        if (oldSp.weaponVariants && sp.weaponVariants) {
          for (const [wk, wv] of Object.entries(oldSp.weaponVariants)) {
            if (sp.weaponVariants[wk]) {
              sp.weaponVariants[wk] = { ...sp.weaponVariants[wk], ...deepClone(wv) };
            }
          }
        }
      }
    };
    const prevTrees = data.spellTrees || {};
    const prevHybrids = data.hybridSpells || {};
    data.spellTrees = deepClone(fresh.spellTrees);
    for (const [tid, tree] of Object.entries(data.spellTrees)) {
      const oldTree = prevTrees[tid];
      if (!oldTree?.spells) continue;
      for (const [sid, sp] of Object.entries(tree.spells || {})) {
        applySavedSpellEdits(sp, oldTree.spells[sid]);
      }
    }
    data.hybridSpells = deepClone(fresh.hybridSpells || {});
    for (const [sid, sp] of Object.entries(data.hybridSpells)) {
      applySavedSpellEdits(sp, prevHybrids[sid]);
    }

    if (!data.prefabs) data.prefabs = {};
    for (const [pid, pdef] of Object.entries(fresh.prefabs || {})) {
      data.prefabs[pid] = deepClone(pdef);
    }

    if (!data.animations) data.animations = { keyframes: {}, procedural: {} };
    if (!data.animations.keyframes) data.animations.keyframes = {};
    if (!data.animations.procedural) data.animations.procedural = {};
    for (const [k, v] of Object.entries(fresh.animations?.keyframes || {})) {
      if (!data.animations.keyframes[k] || !data.animations.keyframes[k].userModifiedInStudio) {
        data.animations.keyframes[k] = deepClone(v);
      }
    }
    for (const [k, v] of Object.entries(fresh.animations?.procedural || {})) {
      if (!data.animations.procedural[k]) data.animations.procedural[k] = deepClone(v);
    }

    for (const [hid, hdef] of Object.entries(fresh.heroes || {})) {
      if (!data.heroes[hid]) {
        data.heroes[hid] = deepClone(hdef);
      } else {
        data.heroes[hid].isBuiltIn = true;
        data.heroes[hid].isHero = true;
        if (!data.heroes[hid].parameters) {
          data.heroes[hid].parameters = deepClone(hdef.parameters);
        }
        if (hid === 'wizard' && data.heroes[hid].parameters.range === 22) {
          data.heroes[hid].parameters.range = 2.6;
        }
        if (!Array.isArray(data.heroes[hid].spellSchedule)) {
          data.heroes[hid].spellSchedule = deepClone(hdef.spellSchedule);
        }
      }
    }

    for (const h of Object.values(data.heroes)) {
      if (h && typeof h === 'object') {
        h.isHero = true;
        if (h.portraitDataUrl && h.portraitVersion !== 3) {
          delete h.portraitDataUrl;
        }
        if (h.parameters) {
          if (h.parameters.visionRange === undefined) {
            h.parameters.visionRange = h.heroClass === "archer" ? 120 : h.heroClass === "wizard" ? 100 : 96;
          }
          if (h.parameters.accuracy === undefined) {
            h.parameters.accuracy = h.heroClass === "archer" ? 90 : h.heroClass === "wizard" ? 88 : 85;
          }
          if (h.parameters.trainTimeSec === undefined) h.parameters.trainTimeSec = 10;
          if (h.parameters.reviveBaseTimeSec === undefined) h.parameters.reviveBaseTimeSec = 8;
          if (h.parameters.hpPerLevel === undefined) h.parameters.hpPerLevel = 45;
          if (h.parameters.damagePerLevel === undefined) h.parameters.damagePerLevel = 6;
          if (h.parameters.armorPerLevel === undefined) h.parameters.armorPerLevel = 2;
          if (h.parameters.attackSpeedPctPerLevel === undefined) h.parameters.attackSpeedPctPerLevel = 4;
          if (h.parameters.moveSpeedPctPerLevel === undefined) h.parameters.moveSpeedPctPerLevel = 2;
        }
        if (Array.isArray(h.spellSchedule)) {
          for (let i = 0; i < h.spellSchedule.length; i++) {
            const slot = h.spellSchedule[i];
            if (slot && slot.spellId) {
              slot.spellId = normalizeSpellId(slot.spellId);
            }
          }
        }
      }
    }

    return data;
  } catch (err) {
    console.warn('[HeroStateManager] Failed to load heroes draft from localStorage, using defaults:', err);
    return fresh;
  }
}

/**
 * Merges active units visuals data and active heroes data into a unified visuals catalog
 * for `ModelFactory` and `UnitRenderer` at runtime (in-game or preview).
 * Also generates `<heroId>__loadout2` visual variants for Heroes with a secondary weapon set!
 */
/**
 * Loads the active Studio units draft from localStorage (if any) and merges any missing
 * units, prefabs, palettes, or animations from `defaultUnitsJson` so Studio, Hall of Heroes,
 * and Battlefield always see 100% identical unit & animation definitions.
 */
export function loadActiveUnitsVisualsData(baseUnitsData = defaultUnitsJson) {
  const base = baseUnitsData || defaultUnitsJson;
  if (typeof localStorage === 'undefined') return base;
  try {
    const raw = localStorage.getItem('kings_lands_studio_draft_v3');
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const draft = parsed?.data;
    if (!draft || typeof draft !== 'object' || !draft.units) return base;

    // a draft saved before the base characters were renamed / replaced must not shadow the shipped ones (see baseUnitsMigration.js)
    const live = pruneDraftForRuntime(draft, base, parsed.managedHashes || null);
    const merged = {
      ...base,
      ...draft,
      factions: { ...(base.factions || {}), ...(draft.factions || {}) },
      teamPalettes: { ...(base.teamPalettes || {}), ...(draft.teamPalettes || {}) },
      prefabs: { ...(base.prefabs || {}), ...live.prefabs },
      units: { ...(base.units || {}), ...live.units },
      animations: {
        keyframes: { ...(base.animations?.keyframes || {}), ...(draft.animations?.keyframes || {}) },
        procedural: { ...(base.animations?.procedural || {}), ...(draft.animations?.procedural || {}) }
      }
    };
    if (!merged.arrowConfig && base.arrowConfig) {
      merged.arrowConfig = { ...base.arrowConfig };
    }
    return merged;
  } catch (_) {
    return base;
  }
}

export function buildCombinedVisualsData(unitsVisualsData = defaultUnitsJson, heroesData = null) {
  const effectiveUnitsData =
    unitsVisualsData === defaultUnitsJson ? loadActiveUnitsVisualsData(defaultUnitsJson) : (unitsVisualsData || loadActiveUnitsVisualsData(defaultUnitsJson));
  const hData = heroesData || loadHeroesDataFromStorage();

  const allPrefabs = {
    ...(effectiveUnitsData.prefabs || {}),
    ...(hData.prefabs || {})
  };
  const allKeyframes = {
    ...(defaultHeroesJson.animations?.keyframes || {}),
    ...(effectiveUnitsData.animations?.keyframes || {}),
    ...(hData.animations?.keyframes || {})
  };
  const resolveLoadoutCombatAnim = (ownerId, race, ld, fallbackMode) => {
    if (ld?.combatAnim && allKeyframes[ld.combatAnim]) return ld.combatAnim;
    const eqBase =
      getEquipmentCombatBase(ld?.equipment, allPrefabs, ownerId) ||
      (fallbackMode === 'ranged' ? 'shoot_bow' : 'attack_slash');
    const specific = `${ownerId}_${race || 'human'}_${eqBase}`;
    if (allKeyframes[specific]) return specific;
    const humanSpec = `${ownerId}_human_${eqBase}`;
    if (allKeyframes[humanSpec]) return humanSpec;
    return eqBase;
  };

  const regularUnitsWithLoadouts = {};
  for (const [uid, udef] of Object.entries(effectiveUnitsData.units || {})) {
    if (!udef) continue;
    regularUnitsWithLoadouts[uid] = udef;
    const secondKey = Object.keys(udef.loadouts || {}).find((k) => k !== 'main');
    const secondLd = secondKey ? udef.loadouts[secondKey] : null;
    if (secondLd && secondLd.equipment) {
      const mode2 = getEquipmentWeaponMode(secondLd.equipment);
      const race = udef.race || 'human';
      const set2CombatAnim = resolveLoadoutCombatAnim(uid, race, secondLd, mode2);
      const variantId = `${uid}__loadout2`;
      regularUnitsWithLoadouts[variantId] = {
        ...udef,
        id: variantId,
        baseHeroId: uid,
        isMounted: secondLd.isMounted ?? udef.isMounted ?? false,
        locomotionAnim: secondLd.locomotionAnim || udef.locomotionAnim || (udef.isMounted ? 'gallop' : 'walk'),
        mountHierarchy: secondLd.mountHierarchy || udef.mountHierarchy || undefined,
        hierarchy: secondLd.hierarchy || udef.hierarchy,
        combatAnim: set2CombatAnim,
        equipment: secondLd.equipment,
        skins: {
          ...(udef.skins || {}),
          [race]: {
            ...(udef.skins?.[race] || {}),
            combatAnim: set2CombatAnim,
            locomotionAnim: secondLd.locomotionAnim || udef.locomotionAnim || (udef.isMounted ? 'gallop' : 'walk')
          }
        }
      };
    }
  }

  const heroUnitsWithLoadouts = {};

  for (const [hid, hdef] of Object.entries(hData.heroes || {})) {
    if (!hdef) continue;
    heroUnitsWithLoadouts[hid] = hdef;

    // Register virtual visual entry for secondary loadout (`${hid}__loadout2`) so UnitRenderer can switch weapons seamlessly
    const secondKey = Object.keys(hdef.loadouts || {}).find((k) => k !== 'main');
    const secondLd = secondKey ? hdef.loadouts[secondKey] : null;
    if (secondLd && secondLd.equipment) {
      const mode2 = getEquipmentWeaponMode(secondLd.equipment);
      const set2CombatAnim = resolveLoadoutCombatAnim(hid, hdef.race || 'human', secondLd, mode2);
      const variantId = `${hid}__loadout2`;
      heroUnitsWithLoadouts[variantId] = {
        ...hdef,
        id: variantId,
        baseHeroId: hid,
        isMounted: secondLd.isMounted ?? hdef.isMounted ?? false,
        locomotionAnim: secondLd.locomotionAnim || hdef.locomotionAnim || 'walk',
        mountHierarchy: secondLd.mountHierarchy || hdef.mountHierarchy || undefined,
        hierarchy: secondLd.hierarchy || hdef.hierarchy,
        combatAnim: set2CombatAnim,
        equipment: secondLd.equipment,
        skins: {
          ...(hdef.skins || {}),
          [hdef.race || 'human']: {
            ...(hdef.skins?.[hdef.race || 'human'] || {}),
            combatAnim: set2CombatAnim,
            locomotionAnim: secondLd.locomotionAnim || hdef.locomotionAnim || 'walk'
          }
        }
      };
    }

    // Register mounted Warhorse variant (`${hid}__mounted`) for Heroes with a spell-triggered mount (e.g. Ravan)
    if (hdef.mountedConfig && hdef.mountedConfig.equipment) {
      const mc = hdef.mountedConfig;
      const mountedVariant = {
        ...hdef,
        id: `${hid}__mounted`,
        baseHeroId: hid,
        isMounted: true,
        locomotionAnim: mc.locomotionAnim || 'gallop',
        mountHierarchy: mc.mountHierarchy || hdef.mountHierarchy,
        hierarchy: mc.hierarchy || hdef.hierarchy,
        combatAnim: mc.combatAnim || 'attack_slash',
        equipment: mc.equipment,
        skins: {
          ...(hdef.skins || {}),
          [hdef.race || 'human']: {
            ...(hdef.skins?.[hdef.race || 'human'] || {}),
            combatAnim: mc.combatAnim || 'attack_slash',
            locomotionAnim: mc.locomotionAnim || 'gallop'
          }
        }
      };
      heroUnitsWithLoadouts[`${hid}__mounted`] = mountedVariant;
      if (!heroUnitsWithLoadouts[`${hid}__loadout2`]) {
        heroUnitsWithLoadouts[`${hid}__loadout2`] = {
          ...mountedVariant,
          id: `${hid}__loadout2`
        };
      }
    }
  }

  // Also generate <unitId>__loadout2 variants for regular units (e.g. archers) if a 2nd gear set is configured on them
  for (const [uid, udef] of Object.entries(effectiveUnitsData.units || {})) {
    if (!udef || !udef.loadouts) continue;
    const secondKey = Object.keys(udef.loadouts).find((k) => k !== "main");
    const secondLd = secondKey ? udef.loadouts[secondKey] : null;
    const eq2 = secondLd?.equipment;
    const hasEquippedItem = eq2 && Object.values(eq2).some((v) => Boolean(v));
    if (secondLd && hasEquippedItem) {
      const mode2 = getEquipmentWeaponMode(eq2);
      const set2CombatAnim = resolveLoadoutCombatAnim(uid, udef.race || "human", secondLd, mode2);
      const variantId = `${uid}__loadout2`;
      heroUnitsWithLoadouts[variantId] = {
        ...udef,
        id: variantId,
        baseHeroId: uid,
        isMounted: secondLd.isMounted ?? udef.isMounted ?? false,
        locomotionAnim: secondLd.locomotionAnim || udef.locomotionAnim || "walk",
        mountHierarchy: secondLd.mountHierarchy || udef.mountHierarchy || undefined,
        hierarchy: secondLd.hierarchy || udef.hierarchy,
        combatAnim: set2CombatAnim,
        equipment: eq2,
        skins: {
          ...(udef.skins || {}),
          [udef.race || "human"]: {
            ...(udef.skins?.[udef.race || "human"] || {}),
            combatAnim: set2CombatAnim,
            locomotionAnim: secondLd.locomotionAnim || udef.locomotionAnim || "walk"
          }
        }
      };
    }
  }

  const mergedKeyframes = {
    ...(defaultHeroesJson.animations?.keyframes || {}),
    ...(effectiveUnitsData.animations?.keyframes || {})
  };
  for (const [k, v] of Object.entries(hData.animations?.keyframes || {})) {
    if (!v) continue;
    const inUnits = Boolean(effectiveUnitsData.animations?.keyframes?.[k]);
    const origHeroClip = defaultHeroesJson.animations?.keyframes?.[k];
    const modifiedFromDefault =
      Boolean(v.userModifiedInStudio) ||
      !origHeroClip ||
      JSON.stringify(v) !== JSON.stringify(origHeroClip);
    if (!inUnits || modifiedFromDefault) {
      mergedKeyframes[k] = v;
    }
  }

  const combined = {
    ...effectiveUnitsData,
    prefabs: {
      ...(effectiveUnitsData.prefabs || {}),
      ...(hData.prefabs || {})
    },
    units: {
      ...regularUnitsWithLoadouts,
      ...heroUnitsWithLoadouts
    },
    heroes: {
      ...(hData.heroes || {})
    },
    animations: {
      keyframes: mergedKeyframes,
      procedural: {
        ...(hData.animations?.procedural || {}),
        ...(effectiveUnitsData.animations?.procedural || {})
      }
    }
  };
  return combined;
}

/**
 * Renders (or retrieves) a 256x256 portrait data URL (`data:image/png;base64,...`) for `heroId`
 * using the Studio's `createPortraitStudio` camera. If `heroDef.portraitDataUrl` was already captured
 * or imported into the Hero's profile, returns that directly.
 */
export function getOrRenderHeroPortraitUrl(heroId, heroesData = null, options = {}) {
  const hData = heroesData || loadHeroesDataFromStorage();
  const heroDef = hData?.heroes?.[heroId];
  if (!heroDef) return null;

  if (!options.forceRender && heroDef.portraitDataUrl) {
    return heroDef.portraitDataUrl;
  }
  if (!options.forceRender && _runtimePortraitCache.has(heroId)) {
    return _runtimePortraitCache.get(heroId);
  }
  if (typeof document === 'undefined') return null;

  try {
    const combinedVisuals = buildCombinedVisualsData(defaultUnitsJson, hData);
    const factory = new ModelFactory(combinedVisuals);
    const studio = createPortraitStudio(factory, combinedVisuals);
    const faction = heroDef.race || 'human';
    const canvas = studio.render(heroId, faction, {
      size: options.size || 192,
      view: options.view || 'bust',
      angle: options.angle || 'three_quarter',
      background: options.background || 'transparent'
    });
    const dataUrl = canvas.toDataURL('image/png');
    studio.dispose();
    _runtimePortraitCache.set(heroId, dataUrl);
    return dataUrl;
  } catch (err) {
    console.warn('[HeroStateManager] Auto-portrait render failed:', err);
    return null;
  }
}

export function invalidateHeroPortraitCache(heroId = null) {
  if (heroId) _runtimePortraitCache.delete(heroId);
  else _runtimePortraitCache.clear();
}

export class HeroStateManager {
  constructor(options = {}) {
    this.onStatus = options.onStatus || null;
    this.devMode = options.devMode !== false;
    this._saveTimer = null;
    this._dirty = false;
    this.defaultHash = hashString(JSON.stringify(defaultHeroesJson));
    this.data = loadHeroesDataFromStorage();
    this._studioViewCache = null;
  }

  _emit(state, message = '') {
    if (this.onStatus) this.onStatus(state, message);
  }

  /**
   * Builds a Studio-compatible data object where `.units` references `this.data.heroes` directly,
   * while shared prefabs and global base animations from `units.json` remain accessible for previewing.
   */
  getStudioViewData(baseUnitsData = defaultUnitsJson) {
    for (const hero of Object.values(this.data.heroes || {})) {
      hero.isHero = true;
      this.ensureSpellAnimationSlotsForHero(hero);
    }

    const mergedPrefabs = {
      ...(baseUnitsData.prefabs || {}),
      ...(this.data.prefabs || {})
    };
    const mergedKeyframes = {
      ...(defaultHeroesJson.animations?.keyframes || {}),
      ...(baseUnitsData.animations?.keyframes || {})
    };
    for (const [k, v] of Object.entries(this.data.animations?.keyframes || {})) {
      if (!v) continue;
      const inUnits = Boolean(baseUnitsData.animations?.keyframes?.[k]);
      const origHeroClip = defaultHeroesJson.animations?.keyframes?.[k];
      const modifiedFromDefault =
        Boolean(v.userModifiedInStudio) ||
        !origHeroClip ||
        JSON.stringify(v) !== JSON.stringify(origHeroClip);
      if (!inUnits || modifiedFromDefault) {
        mergedKeyframes[k] = v;
      }
    }
    const mergedProcedural = {
      ...(baseUnitsData.animations?.procedural || {}),
      ...(this.data.animations?.procedural || {})
    };

    this._studioViewCache = {
      version: this.data.version || '1.0.0',
      isHeroesStudioView: true,
      spellTrees: this.data.spellTrees,
      hybridSpells: this.data.hybridSpells,
      factions: baseUnitsData.factions || { human: { displayName: 'Humans (בני אדם)', sharedUnits: true } },
      teamPalettes: baseUnitsData.teamPalettes || defaultUnitsJson.teamPalettes,
      arrowConfig: baseUnitsData.arrowConfig || defaultUnitsJson.arrowConfig,
      actionRules: baseUnitsData.actionRules || defaultUnitsJson.actionRules,
      prefabs: mergedPrefabs,
      units: this.data.heroes,
      heroes: this.data.heroes,
      animations: {
        keyframes: mergedKeyframes,
        procedural: mergedProcedural
      }
    };
    return this._studioViewCache;
  }

  syncFromStudioView() {
    if (!this._studioViewCache) return;
    const heroIds = Object.keys(this.data.heroes || {});
    const kf = this._studioViewCache.animations?.keyframes || {};
    const proc = this._studioViewCache.animations?.procedural || {};
    const pfs = this._studioViewCache.prefabs || {};

    if (!this.data.animations) this.data.animations = { keyframes: {}, procedural: {} };
    if (!this.data.animations.keyframes) this.data.animations.keyframes = {};
    if (!this.data.animations.procedural) this.data.animations.procedural = {};
    if (!this.data.prefabs) this.data.prefabs = {};

    const isHeroClipName = (clipName) => {
      if (clipName.startsWith("spell_") || clipName.includes("_spell_")) return true;
      return heroIds.some((hid) => clipName === hid || clipName.startsWith(`${hid}_`));
    };

    for (const oldKey of Object.keys(this.data.animations.keyframes)) {
      if (isHeroClipName(oldKey) && !(oldKey in kf)) {
        delete this.data.animations.keyframes[oldKey];
      }
    }
    for (const [k, v] of Object.entries(kf)) {
      const baseUnitOrig = defaultUnitsJson.animations?.keyframes?.[k];
      const baseHeroOrig = defaultHeroesJson.animations?.keyframes?.[k];
      const changedFromUnits = !baseUnitOrig || JSON.stringify(baseUnitOrig) !== JSON.stringify(v);
      const changedFromHeroes = !baseHeroOrig || JSON.stringify(baseHeroOrig) !== JSON.stringify(v);
      if (isHeroClipName(k)) {
        if (changedFromUnits && changedFromHeroes) {
          v.userModifiedInStudio = true;
        }
        this.data.animations.keyframes[k] = v;
      } else if (changedFromUnits) {
        v.userModifiedInStudio = true;
        this.data.animations.keyframes[k] = v;
      }
    }
    for (const [k, v] of Object.entries(proc)) {
      if (isHeroClipName(k)) {
        this.data.animations.procedural[k] = v;
      } else {
        const baseOrig = defaultUnitsJson.animations?.procedural?.[k];
        if (!baseOrig || JSON.stringify(baseOrig) !== JSON.stringify(v)) {
          this.data.animations.procedural[k] = v;
        }
      }
    }
    for (const [pid, pval] of Object.entries(pfs)) {
      const basePf = defaultUnitsJson.prefabs?.[pid];
      if (!basePf || JSON.stringify(basePf) !== JSON.stringify(pval)) {
        this.data.prefabs[pid] = pval;
      }
    }
  }

  ensureSpellAnimationSlotsForHero(heroDef) {
    if (!heroDef) return [];
    if (!this.data.animations) this.data.animations = { keyframes: {}, procedural: {} };
    if (!this.data.animations.keyframes) this.data.animations.keyframes = {};

    const kf = this.data.animations.keyframes;
    const bases = getHeroSpellClipBases(heroDef);
    const faction = heroDef.race || 'human';

    for (const base of bases) {
      if (!kf[base]) {
        const defaultClip = defaultHeroesJson.animations?.keyframes?.[base] ||
          defaultHeroesJson.animations?.keyframes?.spell_fireball || {
            mode: 'keyframes',
            layer: 'upperBody',
            duration: 0.88,
            loop: false,
            clampWhenFinished: false,
            tracks: {
              torso: [
                { t: 0, rot: [0, 0, 0], pos: [0, 0, 0], easing: 'smooth' },
                { t: 0.4, rot: [-0.14, 0.1, 0], pos: [0, 0.02, 0], easing: 'ease-in-out' },
                { t: 1, rot: [0, 0, 0], pos: [0, 0, 0], easing: 'smooth' }
              ],
              arm_R: [
                { t: 0, rot: [0, 0, 0], pos: [0, 0, 0], easing: 'smooth' },
                { t: 0.4, rot: [-1.45, 0.2, 0.25], pos: [0, 0, 0], easing: 'ease-in-out' },
                { t: 1, rot: [0, 0, 0], pos: [0, 0, 0], easing: 'smooth' }
              ]
            },
            events: [
              { time: 0.45, type: 'effect', payload: { fx: base, socket: 'weapon_socket_R' } },
              { time: 0.48, type: 'hit', payload: { socket: 'weapon_socket_R', damageType: 'magic' } }
            ]
          };
        kf[base] = deepClone(defaultClip);
      }

      const heroSpecific = `${heroDef.id}_${faction}_${base}`;
      if (!kf[heroSpecific]) {
        kf[heroSpecific] = deepClone(kf[base]);
      }
    }
    return bases;
  }

  /**
   * Saves a portrait Data URL (`data:image/png;base64,...`) onto a Hero's profile and persists immediately.
   */
  setHeroPortrait(heroId, dataUrl) {
    const hero = this.data.heroes?.[heroId];
    if (!hero || !dataUrl) return false;
    hero.portraitDataUrl = dataUrl;
    hero.portraitVersion = 3;
    _runtimePortraitCache.set(heroId, dataUrl);
    this.saveDraft();
    return true;
  }

  /**
   * Switches an existing Hero to a new Base Class ('warrior' | 'archer' | 'wizard'),
   * replacing its 3D rig (human_base for warrior/archer, wizard rig for wizard), basic weapon & clothing,
   * base parameters, and starter spell schedule so the 3D preview and Spell Trees update immediately!
   */
  applyHeroClassTemplate(heroId, newClass = 'warrior') {
    const hero = this.data.heroes?.[heroId];
    if (!hero) return null;
    const archetype = ['warrior', 'archer', 'wizard'].includes(newClass) ? newClass : 'warrior';
    const template = defaultHeroesJson.heroes?.[archetype] || defaultHeroesJson.heroes?.ravan || defaultHeroesJson.heroes?.wizard;

    hero.heroClass = archetype;
    hero.scale = template.scale || 1.06;
    hero.selectionRingRadius = template.selectionRingRadius || 1.12;
    hero.locomotionAnim = template.locomotionAnim || 'walk';
    hero.combatAnim = template.combatAnim || (archetype === 'archer' ? 'shoot_bow' : 'attack_slash');
    hero.hierarchy = deepClone(template.hierarchy);
    hero.equipment = deepClone(template.equipment);
    hero.loadouts = deepClone(template.loadouts || {});
    hero.colorOverrides = deepClone(template.colorOverrides || {});
    hero.skins = deepClone(template.skins || {});
    hero.parameters = deepClone(template.parameters);
    delete hero.portraitDataUrl;
    _runtimePortraitCache.delete(heroId);

    const firstSpell =
      archetype === 'archer'
        ? { level: 1, type: 'unlock', spellId: 'poison_arrow', treeId: 'offense_archer', cost: 1, spellLevel: 1 }
        : archetype === 'warrior'
          ? { level: 1, type: 'unlock', spellId: 'mighty_strike', treeId: 'offense_warrior', cost: 1, spellLevel: 1 }
          : { level: 1, type: 'unlock', spellId: 'fireball', treeId: 'tactical_magic', cost: 1, spellLevel: 1 };

    hero.spellSchedule = Array.from({ length: 10 }, (_, i) => (i === 0 ? firstSpell : null));
    this.ensureSpellAnimationSlotsForHero(hero);
    this.scheduleSave();
    return hero;
  }

  createNewHero({ name, heroClass = 'warrior', faction = 'human', templateId = null } = {}) {
    const archetype = ['wizard', 'warrior', 'archer'].includes(heroClass) ? heroClass : 'warrior';
    const effectiveTemplateId = templateId && this.data.heroes?.[templateId] ? templateId : archetype;
    const baseHero =
      defaultHeroesJson.heroes?.[archetype] ||
      this.data.heroes?.[effectiveTemplateId] ||
      this.data.heroes?.wizard ||
      (defaultHeroesJson.heroes?.ravan || defaultHeroesJson.heroes?.wizard);

    let idx = Object.keys(this.data.heroes || {}).length + 1;
    let id = `hero_${archetype}_${idx}`;
    while (this.data.heroes?.[id]) {
      idx++;
      id = `hero_${archetype}_${idx}`;
    }

    const classLabel = archetype.charAt(0).toUpperCase() + archetype.slice(1);
    const displayName = (name && name.trim()) || `${classLabel} #${idx}`;
    const cloned = deepClone(baseHero);
    cloned.id = id;
    cloned.name = displayName;
    cloned.displayName = displayName;
    cloned.heroClass = archetype;
    cloned.race = faction;
    cloned.isBuiltIn = false;
    cloned.isHero = true;
    delete cloned.portraitDataUrl;

    const firstSpell =
      archetype === 'archer'
        ? { level: 1, type: 'unlock', spellId: 'poison_arrow', treeId: 'offense_archer', cost: 1, spellLevel: 1 }
        : archetype === 'warrior'
          ? { level: 1, type: 'unlock', spellId: 'mighty_strike', treeId: 'offense_warrior', cost: 1, spellLevel: 1 }
          : { level: 1, type: 'unlock', spellId: 'fireball', treeId: 'tactical_magic', cost: 1, spellLevel: 1 };

    cloned.spellSchedule = Array.from({ length: 10 }, (_, i) => (i === 0 ? firstSpell : null));

    if (!this.data.heroes) this.data.heroes = {};
    this.data.heroes[id] = cloned;

    this.ensureSpellAnimationSlotsForHero(cloned);
    this.saveDraft();
    return cloned;
  }

  deleteHero(heroId) {
    const hero = this.data.heroes?.[heroId];
    if (!hero) return { ok: false, reason: 'Hero not found' };
    if (Object.keys(this.data.heroes).length <= 1) {
      return { ok: false, reason: 'Cannot delete the last remaining Hero.' };
    }
    delete this.data.heroes[heroId];
    _runtimePortraitCache.delete(heroId);
    this.saveDraft();
    return { ok: true };
  }

  saveDraft() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this.syncFromStudioView();
    try {
      const pack = {
        v: 2,
        baseHash: this.defaultHash,
        savedAt: Date.now(),
        data: this.data
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(HEROES_STORAGE_KEY, JSON.stringify(pack));
      }
      this._dirty = false;
      this._emit('saved');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kings_lands_heroes_updated', { detail: this.data }));
      }
      return true;
    } catch (e) {
      console.error('[HeroStateManager] Failed to save heroes draft:', e);
      this._emit('error', 'Save failed');
      return false;
    }
  }

  scheduleSave(delayMs = SAVE_DELAY_MS) {
    this._dirty = true;
    this._emit('dirty');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveDraft(), delayMs);
  }

  flush() {
    if (this._dirty) this.saveDraft();
  }

  exportHeroesJson(filename = 'heroes.json') {
    this.flush();
    const blob = new Blob([JSON.stringify(this.data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  importHeroesJsonText(text) {
    try {
      const parsed = JSON.parse(text);
      const data = parsed?.data || parsed;
      if (!data || typeof data !== 'object' || !data.heroes) {
        return { ok: false, error: 'Invalid heroes.json file (missing "heroes" object).' };
      }
      this.data = data;
      _runtimePortraitCache.clear();
      this.saveDraft();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${e.message}` };
    }
  }

  resetToDefault() {
    clearTimeout(this._saveTimer);
    this._dirty = false;
    _runtimePortraitCache.clear();
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(HEROES_STORAGE_KEY);
    } catch (_) {}
    this.data = deepClone(defaultHeroesJson);
    this.saveDraft();
    return true;
  }

  snapshot() {
    this.syncFromStudioView();
    return JSON.stringify(this.data);
  }

  restoreSnapshot(text) {
    this.data = JSON.parse(text);
    _runtimePortraitCache.clear();
    this.scheduleSave();
  }

  destroy() {
    this.flush();
    clearTimeout(this._saveTimer);
  }
}
