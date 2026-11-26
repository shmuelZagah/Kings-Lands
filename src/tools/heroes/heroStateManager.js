/**
 * Kings Lands — Dedicated Heroes Data Store, Portrait Auto-Linker & State Manager
 * (src/tools/heroes/heroStateManager.js)
 *
 * Backed 100% by `dataRegistry` (`src/data/dataRegistry.js`) and `modelProvider` (`src/render/modelProvider.js`):
 *  - Zero direct `.json` imports, zero `localStorage` calls, zero `new ModelFactory` instantiations.
 */

import { dataRegistry, DRAFT_STORAGE_KEY } from '../../data/dataRegistry.js';
import { modelProvider } from '../../render/modelProvider.js';
import { createPortraitStudio } from '../studio/portraitRenderer.js';
import { getEquipmentCombatBase } from '../studio/clipResolver.js';

export const HEROES_STORAGE_KEY = DRAFT_STORAGE_KEY;
const SAVE_DELAY_MS = 350;

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

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

const _runtimePortraitCache = new Map();

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

export function getHeroSpellClipBases(heroDef) {
  return getUniqueHeroSpellIds(heroDef).map((spellId) => `spell_${spellId}`);
}

export function getSpellTreesForClass(heroesData, heroClass = 'warrior') {
  const cl = ['warrior', 'archer', 'wizard'].includes(heroClass) ? heroClass : 'warrior';
  const trees = heroesData?.spellTrees || dataRegistry.getHeroesData().spellTrees || {};
  return Object.values(trees).filter((t) => {
    if (!t) return false;
    const allowed = Array.isArray(t.allowedClasses) ? t.allowedClasses : ['all'];
    return allowed.includes('all') || allowed.includes(cl);
  });
}

export function findSpellDef(heroesData, rawSpellId) {
  const spellId = normalizeSpellId(rawSpellId);
  if (!spellId) return null;
  const fallbackHeroes = dataRegistry.getHeroesData();
  const trees = heroesData?.spellTrees || fallbackHeroes.spellTrees || {};
  for (const tree of Object.values(trees)) {
    if (tree?.spells?.[spellId]) return tree.spells[spellId];
  }
  const hybrids = heroesData?.hybridSpells || fallbackHeroes.hybridSpells || {};
  if (hybrids[spellId]) return hybrids[spellId];
  if (fallbackHeroes.hybridSpells?.[spellId]) return fallbackHeroes.hybridSpells[spellId];
  for (const tree of Object.values(fallbackHeroes.spellTrees || {})) {
    if (tree?.spells?.[spellId]) return tree.spells[spellId];
  }
  return null;
}

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

export function getEquipmentWeaponMode(equipment) {
  if (!equipment) return 'melee';
  const r = String(equipment.weapon_socket_R?.prefab || '');
  const l = String(equipment.weapon_socket_L?.prefab || '');
  if (/bow|crossbow/i.test(r) || /bow|crossbow/i.test(l)) {
    return 'ranged';
  }
  return 'melee';
}

export function buildCombinedVisualsData(unitsVisualsData = null, heroesData = null) {
  if (!unitsVisualsData && !heroesData) {
    return dataRegistry.getCombinedVisuals();
  }
  const effectiveUnitsData = unitsVisualsData || dataRegistry.getUnitsVisuals();
  const hData = heroesData || dataRegistry.getHeroesData();
  const baselineHeroes = dataRegistry.getBaselineSnapshot().heroes;

  const allPrefabs = {
    ...(effectiveUnitsData.prefabs || {}),
    ...(hData.prefabs || {})
  };
  const allKeyframes = {
    ...(baselineHeroes.animations?.keyframes || {}),
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
    if (secondLd && secondLd.equipment && Object.values(secondLd.equipment).some(Boolean)) {
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

  const mergedKeyframes = {
    ...(baselineHeroes.animations?.keyframes || {}),
    ...(effectiveUnitsData.animations?.keyframes || {})
  };
  for (const [k, v] of Object.entries(hData.animations?.keyframes || {})) {
    if (!v) continue;
    const inUnits = Boolean(effectiveUnitsData.animations?.keyframes?.[k]);
    const origHeroClip = baselineHeroes.animations?.keyframes?.[k];
    const modifiedFromDefault =
      Boolean(v.userModifiedInStudio) ||
      !origHeroClip ||
      JSON.stringify(v) !== JSON.stringify(origHeroClip);
    if (!inUnits || modifiedFromDefault) {
      mergedKeyframes[k] = v;
    }
  }

  return {
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
}

export function getOrRenderHeroPortraitUrl(heroId, heroesData = null, options = {}) {
  const hData = heroesData || dataRegistry.getHeroesData();
  const heroDef = hData?.heroes?.[heroId];
  if (!heroDef) return null;

  if (!options.forceRender && heroDef.portraitDataUrl) {
    return heroDef.portraitDataUrl;
  }
  if (!options.forceRender && _runtimePortraitCache.has(heroId)) {
    return _runtimePortraitCache.get(heroId);
  }
  if (typeof document === 'undefined') return null;

  const factory = modelProvider.getModelFactory();
  const prevVisuals = factory.visualsData;
  try {
    const combinedVisuals = heroesData
      ? buildCombinedVisualsData(dataRegistry.getUnitsVisuals(), hData)
      : modelProvider.getCombinedVisuals();
    factory.visualsData = combinedVisuals;
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
  } finally {
    factory.visualsData = prevVisuals;
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
    this._isSavingSelf = false;
    this.data = dataRegistry.getHeroesData();
    this._studioViewCache = null;

    this._unsubRegistry = dataRegistry.subscribe(() => {
      if (this._isSavingSelf) return;
      if (this._dirty) {
        setTimeout(() => { if (this._dirty) this.saveDraft(); }, 0);
        return;
      }
      this.data = dataRegistry.getHeroesData();
    });
  }

  _emit(state, message = '') {
    if (this.onStatus) this.onStatus(state, message);
  }

  getStudioViewData(baseUnitsData = null) {
    const unitsBase = baseUnitsData || dataRegistry.getUnitsVisuals();
    const baselineHeroes = dataRegistry.getBaselineSnapshot().heroes;

    for (const hero of Object.values(this.data.heroes || {})) {
      hero.isHero = true;
      this.ensureSpellAnimationSlotsForHero(hero);
    }

    const mergedPrefabs = {
      ...(unitsBase.prefabs || {}),
      ...(this.data.prefabs || {})
    };
    const mergedKeyframes = {
      ...(baselineHeroes.animations?.keyframes || {}),
      ...(unitsBase.animations?.keyframes || {})
    };
    for (const [k, v] of Object.entries(this.data.animations?.keyframes || {})) {
      if (!v) continue;
      const inUnits = Boolean(unitsBase.animations?.keyframes?.[k]);
      const origHeroClip = baselineHeroes.animations?.keyframes?.[k];
      const modifiedFromDefault =
        Boolean(v.userModifiedInStudio) ||
        !origHeroClip ||
        JSON.stringify(v) !== JSON.stringify(origHeroClip);
      if (!inUnits || modifiedFromDefault) {
        mergedKeyframes[k] = v;
      }
    }
    const mergedProcedural = {
      ...(unitsBase.animations?.procedural || {}),
      ...(this.data.animations?.procedural || {})
    };

    this._studioViewCache = {
      version: this.data.version || '1.0.0',
      isHeroesStudioView: true,
      spellTrees: this.data.spellTrees,
      hybridSpells: this.data.hybridSpells,
      factions: unitsBase.factions || { human: { displayName: 'Humans (בני אדם)', sharedUnits: true } },
      teamPalettes: unitsBase.teamPalettes || {},
      arrowConfig: unitsBase.arrowConfig || null,
      actionRules: unitsBase.actionRules || null,
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
    const baseline = dataRegistry.getBaselineSnapshot();
    const baselineUnits = baseline.unitsVisuals;
    const baselineHeroes = baseline.heroes;

    const heroIds = Object.keys(this.data.heroes || {});
    const kf = this._studioViewCache.animations?.keyframes || {};
    const proc = this._studioViewCache.animations?.procedural || {};
    const pfs = this._studioViewCache.prefabs || {};

    if (!this.data.animations) this.data.animations = { keyframes: {}, procedural: {} };
    if (!this.data.animations.keyframes) this.data.animations.keyframes = {};
    if (!this.data.animations.procedural) this.data.animations.procedural = {};
    if (!this.data.prefabs) this.data.prefabs = {};

    const isHeroClipName = (clipName) => {
      if (clipName.startsWith('spell_') || clipName.includes('_spell_')) return true;
      return heroIds.some((hid) => clipName === hid || clipName.startsWith(`${hid}_`));
    };

    for (const oldKey of Object.keys(this.data.animations.keyframes)) {
      if (isHeroClipName(oldKey) && !(oldKey in kf)) {
        delete this.data.animations.keyframes[oldKey];
      }
    }
    for (const [k, v] of Object.entries(kf)) {
      const baseUnitOrig = baselineUnits.animations?.keyframes?.[k];
      const baseHeroOrig = baselineHeroes.animations?.keyframes?.[k];
      const changedFromUnits = !baseUnitOrig || JSON.stringify(baseUnitOrig) !== JSON.stringify(v);
      const changedFromHeroes = !baseHeroOrig || JSON.stringify(baseHeroOrig) !== JSON.stringify(v);
      if (isHeroClipName(k)) {
        if (changedFromUnits && changedFromHeroes) v.userModifiedInStudio = true;
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
        const baseOrig = baselineUnits.animations?.procedural?.[k];
        if (!baseOrig || JSON.stringify(baseOrig) !== JSON.stringify(v)) {
          this.data.animations.procedural[k] = v;
        }
      }
    }
    for (const [pid, pval] of Object.entries(pfs)) {
      const basePf = baselineUnits.prefabs?.[pid];
      if (!basePf || JSON.stringify(basePf) !== JSON.stringify(pval)) {
        this.data.prefabs[pid] = pval;
      }
    }
  }

  ensureSpellAnimationSlotsForHero(heroDef) {
    if (!heroDef) return [];
    if (!this.data.animations) this.data.animations = { keyframes: {}, procedural: {} };
    if (!this.data.animations.keyframes) this.data.animations.keyframes = {};

    const baselineHeroes = dataRegistry.getBaselineSnapshot().heroes;
    const kf = this.data.animations.keyframes;
    const bases = getHeroSpellClipBases(heroDef);
    const faction = heroDef.race || 'human';

    for (const base of bases) {
      if (!kf[base]) {
        const defaultClip = baselineHeroes.animations?.keyframes?.[base] ||
          baselineHeroes.animations?.keyframes?.spell_fireball || {
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

  setHeroPortrait(heroId, dataUrl) {
    const hero = this.data.heroes?.[heroId];
    if (!hero || !dataUrl) return false;
    hero.portraitDataUrl = dataUrl;
    hero.portraitVersion = 3;
    _runtimePortraitCache.set(heroId, dataUrl);
    return this.saveDraft();
  }

  applyHeroClassTemplate(heroId, newClass = 'warrior') {
    const hero = this.data.heroes?.[heroId];
    if (!hero) return null;
    const archetype = ['warrior', 'archer', 'wizard'].includes(newClass) ? newClass : 'warrior';
    const baselineHeroes = dataRegistry.getBaselineSnapshot().heroes;
    const template = baselineHeroes.heroes?.[archetype] || baselineHeroes.heroes?.ravan || baselineHeroes.heroes?.wizard;

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
    const baselineHeroes = dataRegistry.getBaselineSnapshot().heroes;
    const effectiveTemplateId = templateId && this.data.heroes?.[templateId] ? templateId : archetype;
    const baseHero =
      baselineHeroes.heroes?.[archetype] ||
      this.data.heroes?.[effectiveTemplateId] ||
      this.data.heroes?.wizard ||
      baselineHeroes.heroes?.ravan ||
      baselineHeroes.heroes?.wizard;

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
    this._isSavingSelf = true;
    try {
      const res = dataRegistry.deleteHero(heroId);
      if (!res.ok) return { ok: false, reason: res.error };
      _runtimePortraitCache.delete(heroId);
      this.data = dataRegistry.getHeroesData();
      this._dirty = false;
      this._emit('saved');
      return { ok: true };
    } finally {
      this._isSavingSelf = false;
    }
  }

  saveDraft() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    this.syncFromStudioView();
    this._isSavingSelf = true;
    try {
      const res = dataRegistry.saveHeroes(this.data);
      if (!res.ok) {
        this._emit('error', res.error || 'Validation failed');
        return false;
      }
      this._dirty = false;
      this.data = dataRegistry.getHeroesData();
      this._emit('saved');
      return true;
    } catch (e) {
      console.error('[HeroStateManager] Failed to save heroes draft:', e);
      this._emit('error', e?.message || 'Save failed');
      return false;
    } finally {
      this._isSavingSelf = false;
    }
  }

  scheduleSave(delayMs = SAVE_DELAY_MS) {
    this._dirty = true;
    this._emit('dirty');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveDraft(), delayMs);
  }

  flush() {
    if (this._dirty) return this.saveDraft();
    return true;
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
      const prev = this.data;
      this.data = data;
      _runtimePortraitCache.clear();
      const ok = this.saveDraft();
      if (!ok) {
        this.data = prev;
        return { ok: false, error: dataRegistry.getLastValidationReport()?.error || 'Imported heroes failed validation.' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${e.message}` };
    }
  }

  resetToDefault() {
    clearTimeout(this._saveTimer);
    this._dirty = false;
    _runtimePortraitCache.clear();
    this._isSavingSelf = true;
    try {
      const res = dataRegistry.resetToDefaults();
      this.data = dataRegistry.getHeroesData();
      this._emit('saved');
      return res.ok;
    } finally {
      this._isSavingSelf = false;
    }
  }

  snapshot() {
    this.syncFromStudioView();
    return dataRegistry.snapshotText();
  }

  restoreSnapshot(text) {
    try {
      const parsed = dataRegistry.parseSnapshot(text);
      this._isSavingSelf = true;
      let res;
      if (parsed?.data?.heroes || parsed?.heroes?.heroes) {
        res = dataRegistry.restoreSnapshot(parsed, { reason: 'heroRestoreSnapshot', persist: true });
      } else if (parsed?.heroes) {
        res = dataRegistry.saveHeroes(parsed);
      } else {
        return false;
      }
      if (!res?.ok) {
        this._emit('error', res?.error || 'Restore failed');
        return false;
      }
      this._dirty = false;
      _runtimePortraitCache.clear();
      this.data = dataRegistry.getHeroesData();
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
  }
}
