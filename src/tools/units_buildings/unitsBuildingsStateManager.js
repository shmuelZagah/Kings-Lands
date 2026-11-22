import { computeCapabilitiesForLoadout } from '../../sim/combatCapabilitiesRegistry.js';
/**
 * Kings Lands — Units & Buildings Lab State Manager
 * (src/tools/units_buildings/unitsBuildingsStateManager.js)
 *
 * Centralizes data management and 100% live synchronization across:
 * 1. Warriors / Units Lab (`src/data/unitStats.json` + `src/data/visuals/units.json` via `StudioStateManager`)
 * 2. Buildings Lab (`src/data/buildings.json` + `src/data/buildingVisuals.json`)
 * 3. Animation Lab (`StudioApp`) & Battlefield Simulation (`GameState`, `MovementSystem`, `ConstructionSystem`, `EconomySystem`, `VisionSystem`)
 */

import defaultUnitStats from '../../data/unitStats.json';
import defaultBuildingsData from '../../data/buildings.json';
import defaultUnitsVisuals from '../../data/visuals/units.json';
import defaultHeroesData from '../../data/heroes.json';
import defaultBuildingVisuals from '../../data/buildingVisuals.json';
import { StudioStateManager } from '../studio/studioStateManager.js';
import { MAIN_LOADOUT, heldItems, loadoutsOf, asLoadout, restow, weaponTypeOf } from '../studio/weaponRules.js';
import { downloadBytes } from '../studio/portraitRenderer.js';

export const UNIT_STATS_STORAGE_KEY = 'kings_lands_unit_stats_v2';
export const BUILDINGS_DATA_STORAGE_KEY = 'kings_lands_buildings_data_v2';
export const BUILDING_VISUALS_STORAGE_KEY = 'kings_lands_building_visuals_v2';
export const UNITS_VISUALS_STORAGE_KEY = 'kings_lands_studio_draft_v3';

export const BASE_CHARACTER_TEMPLATES = Object.freeze([
  { id: 'human_base', race: 'human', label: 'Human Base Character' },
  { id: 'katiler_base', race: 'katiler', label: 'Katiler Base Character' },
  { id: 'mirukenkay_base', race: 'mirukenkay', label: 'Mirukenkay Base Character' },
  { id: 'almasir_base', race: 'almasir', label: 'Almasir Base Character' },
  { id: 'takdik_base', race: 'takdik', label: 'Takdik Base Character' },
  { id: 'nefrolai_base', race: 'nefrolai', label: 'Nefrolai Base Character' }
]);

export const MOUNT_TYPES = Object.freeze([
  { id: 'none', label: 'None (On Foot)' },
  { id: 'human_horse', label: 'Warhorse (human_horse)' },
  { id: 'katiler_wolf', label: 'Dire Wolf (katiler_wolf)' },
  { id: 'war_chameleon', label: 'War Chameleon (sisnat_chameleon)' }
]);

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const INITIAL_UNIT_STATS_SNAPSHOT = deepClone(defaultUnitStats);
const INITIAL_BUILDINGS_DATA_SNAPSHOT = deepClone(defaultBuildingsData);
const INITIAL_BUILDING_VISUALS_SNAPSHOT = deepClone(defaultBuildingVisuals);
const INITIAL_UNITS_VISUALS_SNAPSHOT = deepClone(defaultUnitsVisuals);

/**
 * Determines which formations are naturally eligible for a unit given its mount state and equipped weapons
 * across its loadouts, and returns both the eligible list and the user-enabled `allowedFormations`.
 */
export function computeEligibleFormationsForUnit(
  unitStatDef,
  unitVisualDef,
  visualsData,
  formationRules = defaultUnitStats.formationRules
) {
  const isMounted = Boolean(
    unitStatDef?.isMounted ||
      (unitStatDef?.mountType && unitStatDef.mountType !== 'none') ||
      unitStatDef?.roleType === 'cavalry' ||
      unitVisualDef?.mountHierarchy ||
      unitVisualDef?.locomotionAnim?.includes('gallop')
  );

  const equippedWeaponTypes = new Set();
  if (unitVisualDef && visualsData) {
    const lds = loadoutsOf(unitVisualDef);
    for (const ld of lds) {
      const asLd = asLoadout(unitVisualDef, ld.id);
      for (const item of heldItems(visualsData, asLd)) {
        if (item.type) equippedWeaponTypes.add(item.type);
      }
    }
  }

  if (equippedWeaponTypes.size === 0) {
    if (unitStatDef?.id === 'spearman') equippedWeaponTypes.add('melee_long');
    else if (unitStatDef?.id === 'swordsman' || unitStatDef?.id === 'cavalry') {
      equippedWeaponTypes.add('melee_short');
      equippedWeaponTypes.add('shield');
    } else if (unitStatDef?.isRanged && !unitStatDef?.isSiege) {
      equippedWeaponTypes.add('bow');
    }
  }

  const rules = formationRules || defaultUnitStats.formationRules || {};
  const result = [];

  for (const [fId, rule] of Object.entries(rules)) {
    let eligible = true;
    if (rule.requiresMounted === true && !isMounted) eligible = false;
    if (rule.requiresMounted === false && isMounted) eligible = false;
    if (eligible && Array.isArray(rule.requiresWeaponTypes) && rule.requiresWeaponTypes.length > 0) {
      const hasAny = rule.requiresWeaponTypes.some((wt) => equippedWeaponTypes.has(wt));
      if (!hasAny) eligible = false;
    }
    if (unitStatDef?.isWorker || unitStatDef?.isSiege) {
      eligible = fId === 'square';
    }

    const enabled = Array.isArray(unitStatDef?.allowedFormations)
      ? unitStatDef.allowedFormations.includes(fId)
      : eligible && Boolean(rule.defaultEnabled);

    result.push({
      id: fId,
      labelEn: rule.labelEn || fId,
      toggleLabel: rule.toggleLabel || `Square ↔ ${rule.labelEn || fId}`,
      eligible,
      enabled
    });
  }

  return result;
}

/**
 * Syncs live in-memory `defaultUnitStats`, `defaultBuildingsData`, and `defaultUnitsVisuals` references
 * so all running systems and `StudioApp` immediately see the updated parameters and equipped weapons!
 */
export function syncLiveConfigObjectsInMemory(unitStatsObj, buildingsDataObj, unitsVisualsObj = null) {
  if (unitStatsObj && unitStatsObj !== defaultUnitStats) {
    if (unitStatsObj.formationRules) {
      defaultUnitStats.formationRules = deepClone(unitStatsObj.formationRules);
    }
    if (unitStatsObj.units) {
      for (const k of Object.keys(defaultUnitStats.units)) {
        if (!unitStatsObj.units[k]) delete defaultUnitStats.units[k];
      }
      for (const [k, v] of Object.entries(unitStatsObj.units)) {
        defaultUnitStats.units[k] = deepClone(v);
      }
    }
  }

  if (buildingsDataObj && buildingsDataObj !== defaultBuildingsData) {
    if (buildingsDataObj.economy) {
      Object.assign(defaultBuildingsData.economy, deepClone(buildingsDataObj.economy));
    }
    if (buildingsDataObj.sharedBuildingWatchtower) {
      defaultBuildingsData.sharedBuildingWatchtower = deepClone(buildingsDataObj.sharedBuildingWatchtower);
    }
    if (buildingsDataObj.buildings) {
      for (const k of Object.keys(defaultBuildingsData.buildings)) {
        if (!buildingsDataObj.buildings[k]) delete defaultBuildingsData.buildings[k];
      }
      for (const [k, v] of Object.entries(buildingsDataObj.buildings)) {
        defaultBuildingsData.buildings[k] = deepClone(v);
      }
    }
  }

  if (unitsVisualsObj && unitsVisualsObj !== defaultUnitsVisuals) {
    if (unitsVisualsObj.units) {
      for (const [k, v] of Object.entries(unitsVisualsObj.units)) {
        defaultUnitsVisuals.units[k] = deepClone(v);
      }
    }
    if (unitsVisualsObj.animations?.keyframes) {
      defaultUnitsVisuals.animations.keyframes = {
        ...(defaultUnitsVisuals.animations.keyframes || {}),
        ...deepClone(unitsVisualsObj.animations.keyframes)
      };
    }
  }
}


export function loadUnitsBuildingsConfigFromStorage() {
  const uBase = deepClone(defaultUnitStats);
  const bBase = deepClone(defaultBuildingsData);
  const vBase = deepClone(defaultUnitsVisuals);
  try {
    const rawU = globalThis.localStorage?.getItem(UNIT_STATS_STORAGE_KEY);
    if (rawU) {
      const parsedU = JSON.parse(rawU);
      if (parsedU && typeof parsedU.units === 'object') {
        for (const k of Object.keys(uBase.units)) {
          if (parsedU._deletedUnits?.includes?.(k)) delete uBase.units[k];
        }
        for (const [uid, uDef] of Object.entries(parsedU.units)) {
          uBase.units[uid] = { ...(uBase.units[uid] || {}), ...uDef };
        }
      }
      if (parsedU?.formationRules) {
        uBase.formationRules = { ...uBase.formationRules, ...parsedU.formationRules };
      }
      if (Array.isArray(parsedU?.customPlaceholderIcons)) {
        uBase.customPlaceholderIcons = parsedU.customPlaceholderIcons;
      }
    }
  } catch (_) {}
  try {
    const rawB = globalThis.localStorage?.getItem(BUILDINGS_DATA_STORAGE_KEY);
    if (rawB) {
      const parsedB = JSON.parse(rawB);
      if (parsedB?.sharedBuildingWatchtower) {
        bBase.sharedBuildingWatchtower = {
          ...bBase.sharedBuildingWatchtower,
          ...parsedB.sharedBuildingWatchtower
        };
      }
      if (parsedB?.economy) {
        bBase.economy = { ...bBase.economy, ...parsedB.economy };
      }
      if (parsedB && typeof parsedB.buildings === 'object') {
        for (const [bid, bDef] of Object.entries(parsedB.buildings)) {
          bBase.buildings[bid] = { ...(bBase.buildings[bid] || {}), ...bDef };
        }
      }
    }
  } catch (_) {}
  try {
    const rawV = globalThis.localStorage?.getItem(UNITS_VISUALS_STORAGE_KEY);
    if (rawV) {
      const parsedV = JSON.parse(rawV);
      const draftData = parsedV?.data || parsedV;
      if (draftData && typeof draftData.units === 'object') {
        for (const [uid, uVis] of Object.entries(draftData.units)) {
          vBase.units[uid] = { ...(vBase.units[uid] || {}), ...uVis };
        }
      }
      if (draftData?.animations?.keyframes) {
        vBase.animations.keyframes = {
          ...(vBase.animations?.keyframes || {}),
          ...draftData.animations.keyframes
        };
      }
    }
  } catch (_) {}
  syncLiveConfigObjectsInMemory(uBase, bBase, vBase);
  return { unitStatsData: uBase, buildingsData: bBase, unitsVisualsData: vBase };
}

export class UnitsBuildingsStateManager {
  constructor({ onStatus = null, studioStateManager = null } = {}) {
    this.onStatus = onStatus;
    this.studioStateManager =
      studioStateManager ||
      new StudioStateManager({
        onStatus: (s, m) => this.onStatus?.(s, m)
      });
    this._saveTimer = null;

    this.unitStatsData = this._loadUnitStats();
    this.buildingsData = this._loadBuildingsData();
    this.buildingVisualsData = this._loadBuildingVisuals();
    this.unitsVisualsData = this.studioStateManager.data;

    // Ensure hero prefabs are also available in unitsVisualsData.prefabs
    if (defaultHeroesData?.prefabs && this.unitsVisualsData?.prefabs) {
      this.unitsVisualsData.prefabs = {
        ...defaultHeroesData.prefabs,
        ...this.unitsVisualsData.prefabs
      };
    }

    this._syncUnitsAndBuildingsCrossReferences();
    syncLiveConfigObjectsInMemory(this.unitStatsData, this.buildingsData, this.unitsVisualsData, this.buildingVisualsData);
  }

  _loadUnitStats() {
    const base = deepClone(defaultUnitStats);
    try {
      const raw = globalThis.localStorage?.getItem(UNIT_STATS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.units === 'object') {
          for (const [uid, uDef] of Object.entries(parsed.units)) {
            base.units[uid] = { ...(base.units[uid] || {}), ...uDef };
          }
        }
        if (parsed?.formationRules) {
          base.formationRules = { ...base.formationRules, ...parsed.formationRules };
        }
        if (Array.isArray(parsed?.customPlaceholderIcons)) {
          base.customPlaceholderIcons = parsed.customPlaceholderIcons;
        }
      }
    } catch (_) {}
    return base;
  }

  _loadBuildingsData() {
    const base = deepClone(defaultBuildingsData);
    try {
      const raw = globalThis.localStorage?.getItem(BUILDINGS_DATA_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.sharedBuildingWatchtower) {
          base.sharedBuildingWatchtower = {
            ...base.sharedBuildingWatchtower,
            ...parsed.sharedBuildingWatchtower
          };
        }
        if (parsed?.economy) {
          base.economy = { ...base.economy, ...parsed.economy };
        }
        if (parsed && typeof parsed.buildings === 'object') {
          for (const [bid, bDef] of Object.entries(parsed.buildings)) {
            base.buildings[bid] = { ...(base.buildings[bid] || {}), ...bDef };
          }
        }
      }
    } catch (_) {}
    return base;
  }

  _loadBuildingVisuals() {
    const base = deepClone(defaultBuildingVisuals);
    try {
      const raw = globalThis.localStorage?.getItem(BUILDING_VISUALS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.animations?.keyframes) {
          base.animations.keyframes = {
            ...base.animations.keyframes,
            ...parsed.animations.keyframes
          };
        }
      }
    } catch (_) {}
    return base;
  }

  /**
   * Attaches or removes a 3D mount (`none`, `human_horse`, `katiler_wolf`, `war_chameleon`) on a unit
   * in `unitsVisualsData.units[unitId]` and updates its sitting leg poses and locomotion animation (Fix 5).
   */
  _buildDireWolfMountHierarchy() {
    const wolfTorso = deepClone(
      INITIAL_UNITS_VISUALS_SNAPSHOT.units?.katiler_wolf?.hierarchy?.torso ||
      defaultUnitsVisuals.units?.katiler_wolf?.hierarchy?.torso
    );
    if (!wolfTorso) {
      return deepClone(INITIAL_UNITS_VISUALS_SNAPSHOT.units.cavalry.mountHierarchy);
    }
    const ch = wolfTorso.children || {};
    const mountChildren = {};
    if (ch.neck) {
      const mHead = deepClone(ch.neck);
      if (mHead.children?.head) {
        mHead.children.mount_skull = mHead.children.head;
        delete mHead.children.head;
      }
      mountChildren.mount_head = mHead;
    }
    if (ch.tail) {
      mountChildren.mount_tail = deepClone(ch.tail);
    }
    const legMap = [
      ['front_leg_L', 'mount_leg_FL', 'front_shin_L', 'mount_shin_FL', 'front_paw_L', 'mount_hoof_FL'],
      ['front_leg_R', 'mount_leg_FR', 'front_shin_R', 'mount_shin_FR', 'front_paw_R', 'mount_hoof_FR'],
      ['back_leg_L', 'mount_leg_BL', 'back_shin_L', 'mount_shin_BL', 'back_paw_L', 'mount_hoof_BL'],
      ['back_leg_R', 'mount_leg_BR', 'back_shin_R', 'mount_shin_BR', 'back_paw_R', 'mount_hoof_BR']
    ];
    for (const [srcLeg, dstLeg, srcShin, dstShin, srcPaw, dstPaw] of legMap) {
      if (ch[srcLeg]) {
        const legNode = deepClone(ch[srcLeg]);
        if (legNode.children?.[srcShin]) {
          const shinNode = legNode.children[srcShin];
          delete legNode.children[srcShin];
          if (shinNode.children?.[srcPaw]) {
            shinNode.children[dstPaw] = shinNode.children[srcPaw];
            delete shinNode.children[srcPaw];
          }
          legNode.children[dstShin] = shinNode;
        }
        mountChildren[dstLeg] = legNode;
      }
    }
    return {
      mount_torso: {
        pos: wolfTorso.pos || [0, 1.05, 0],
        rot: wolfTorso.rot || [0, 0, 0],
        meshes: wolfTorso.meshes || [],
        children: mountChildren
      }
    };
  }

  setUnitMount(unitId, mountType = 'none') {
    const uStat = this.unitStatsData.units?.[unitId];
    const uVis = this.unitsVisualsData.units?.[unitId];
    if (!uStat || !uVis) return false;

    const cleanMount = MOUNT_TYPES.some((m) => m.id === mountType) ? mountType : 'none';
    uStat.mountType = cleanMount;
    uStat.isMounted = cleanMount !== 'none';
    uVis.isMounted = cleanMount !== 'none';
    uVis._gearConfiguredInLab = true;

    if (cleanMount === 'none') {
      delete uVis.mountHierarchy;
      uVis.locomotionAnim = 'walk';
      if (uVis.skins) {
        for (const sk of Object.values(uVis.skins)) {
          if (sk && typeof sk === 'object') delete sk.locomotionAnim;
        }
      }
      // Restore standing pelvis height and standing legs
      const standPelvis =
        INITIAL_UNITS_VISUALS_SNAPSHOT.units?.human_base?.hierarchy?.pelvis ||
        defaultUnitsVisuals.units?.human_base?.hierarchy?.pelvis;
      if (uVis.hierarchy?.pelvis) {
        uVis.hierarchy.pelvis.pos = standPelvis?.pos ? deepClone(standPelvis.pos) : [0, 0.92, 0];
      }
      if (standPelvis && uVis.hierarchy?.pelvis?.children) {
        if (standPelvis.children?.leg_L && uVis.hierarchy.pelvis.children.leg_L) {
          uVis.hierarchy.pelvis.children.leg_L.pos = deepClone(standPelvis.children.leg_L.pos);
          uVis.hierarchy.pelvis.children.leg_L.rot = [0, 0, 0];
          if (uVis.hierarchy.pelvis.children.leg_L.children?.shin_L) {
            uVis.hierarchy.pelvis.children.leg_L.children.shin_L.rot = [0, 0, 0];
          }
        }
        if (standPelvis.children?.leg_R && uVis.hierarchy.pelvis.children.leg_R) {
          uVis.hierarchy.pelvis.children.leg_R.pos = deepClone(standPelvis.children.leg_R.pos);
          uVis.hierarchy.pelvis.children.leg_R.rot = [0, 0, 0];
          if (uVis.hierarchy.pelvis.children.leg_R.children?.shin_R) {
            uVis.hierarchy.pelvis.children.leg_R.children.shin_R.rot = [0, 0, 0];
          }
        }
      }
      if (uVis.restPoses) {
        delete uVis.restPoses.leg_L;
        delete uVis.restPoses.leg_R;
        delete uVis.restPoses.shin_L;
        delete uVis.restPoses.shin_R;
      }
    } else {
      uVis.locomotionAnim = 'gallop';
      if (uVis.skins) {
        for (const sk of Object.values(uVis.skins)) {
          if (sk && typeof sk === 'object') sk.locomotionAnim = 'gallop';
        }
      }
      if (cleanMount === 'war_chameleon' && defaultHeroesData?.heroes?.sisnat?.mountHierarchy) {
        uVis.mountHierarchy = deepClone(defaultHeroesData.heroes.sisnat.mountHierarchy);
        if (uVis.hierarchy?.pelvis) {
          uVis.hierarchy.pelvis.pos = [0, 1.62, 0.05];
        }
      } else if (cleanMount === 'katiler_wolf') {
        uVis.mountHierarchy = this._buildDireWolfMountHierarchy();
        if (uVis.hierarchy?.pelvis) {
          uVis.hierarchy.pelvis.pos = [0, 1.38, 0.02];
        }
      } else {
        uVis.mountHierarchy = deepClone(
          INITIAL_UNITS_VISUALS_SNAPSHOT.units?.cavalry?.mountHierarchy ||
          defaultUnitsVisuals.units.cavalry.mountHierarchy
        );
        if (uVis.hierarchy?.pelvis) {
          uVis.hierarchy.pelvis.pos = [0, 1.44, 0.02];
        }
      }

      // Apply cavalry riding leg angles so the rider sits naturally on the mount saddle
      const cavPelvis =
        INITIAL_UNITS_VISUALS_SNAPSHOT.units?.cavalry?.hierarchy?.pelvis ||
        defaultUnitsVisuals.units?.cavalry?.hierarchy?.pelvis;
      if (cavPelvis?.children && uVis.hierarchy?.pelvis?.children) {
        if (cavPelvis.children.leg_L && uVis.hierarchy.pelvis.children.leg_L) {
          uVis.hierarchy.pelvis.children.leg_L.pos = deepClone(cavPelvis.children.leg_L.pos);
          uVis.hierarchy.pelvis.children.leg_L.rot = deepClone(cavPelvis.children.leg_L.rot || [-0.65, 0.32, -0.35]);
          if (uVis.hierarchy.pelvis.children.leg_L.children?.shin_L && cavPelvis.children.leg_L.children?.shin_L) {
            uVis.hierarchy.pelvis.children.leg_L.children.shin_L.rot = deepClone(
              cavPelvis.children.leg_L.children.shin_L.rot || [0.85, 0, 0]
            );
          }
        }
        if (cavPelvis.children.leg_R && uVis.hierarchy.pelvis.children.leg_R) {
          uVis.hierarchy.pelvis.children.leg_R.pos = deepClone(cavPelvis.children.leg_R.pos);
          uVis.hierarchy.pelvis.children.leg_R.rot = deepClone(cavPelvis.children.leg_R.rot || [-0.65, -0.32, 0.35]);
          if (uVis.hierarchy.pelvis.children.leg_R.children?.shin_R && cavPelvis.children.leg_R.children?.shin_R) {
            uVis.hierarchy.pelvis.children.leg_R.children.shin_R.rot = deepClone(
              cavPelvis.children.leg_R.children.shin_R.rot || [0.85, 0, 0]
            );
          }
        }
      }
    }

    // Recompute eligible formations & modes per loadout when mount changes
    delete uStat.loadoutCapabilities;
    delete uStat.allowedFormations;
    delete uStat.allowedModes;
    const elig = computeEligibleFormationsForUnit(
      { ...uStat, allowedFormations: null },
      uVis,
      this.unitsVisualsData,
      this.unitStatsData.formationRules
    );
    uStat.allowedFormations = elig.filter((f) => f.eligible && f.enabled).map((f) => f.id);
    if (!uStat.allowedFormations.includes('square')) uStat.allowedFormations.unshift('square');

    this.saveAll();
    return true;
  }

  /**
   * Ensures every unit in `unitStatsData.units` exists in `unitsVisualsData.units` (with its mount & gear)
   * and syncs unit costs into any building option that references that unit.
   * Note (Fix 11): Units do NOT dictate which building recruits them, unlockLevel, trainTimeSec, or xpReward!
   * Buildings own their `options` list, `unlockLevel`, `trainTicks`, and `xpReward`.
   */
  _syncUnitsAndBuildingsCrossReferences() {
    for (const [uid, uStat] of Object.entries(this.unitStatsData.units || {})) {
      if (!uStat.mountType) {
        uStat.mountType = uStat.isMounted ? 'human_horse' : 'none';
      }
      if (!uStat.visionRangeMeters) {
        uStat.visionRangeMeters = uStat.isRanged ? 112 : uStat.isMounted ? 118 : 96;
      }
      if (!uStat.blacksmithBonuses) {
        uStat.blacksmithBonuses = {
          forged_blades: 20,
          heavy_plate: 20,
          bodkin_arrows: uStat.isRanged ? 25 : 0,
          barding: uStat.isMounted ? 25 : 0
        };
      }

      if (!this.unitsVisualsData.units[uid]) {
        const baseCharId = uStat.baseCharId || uStat.baseModel || 'human_base';
        const templateVis =
          this.unitsVisualsData.units[baseCharId] ||
          defaultUnitsVisuals.units[baseCharId] ||
          this.unitsVisualsData.units.human_base ||
          this.unitsVisualsData.units.swordsman;
        if (templateVis) {
          this.unitsVisualsData.units[uid] = deepClone(templateVis);
          this.unitsVisualsData.units[uid].displayName = uStat.name || uid;
          if (uStat.race) {
            this.unitsVisualsData.units[uid].race = uStat.race;
          }
          if (uStat.mountType && uStat.mountType !== 'none') {
            this.unitsVisualsData.units[uid].mountHierarchy = deepClone(
              defaultUnitsVisuals.units.cavalry.mountHierarchy
            );
            this.unitsVisualsData.units[uid].locomotionAnim = 'gallop';
          }
        }
      } else {
        this.unitsVisualsData.units[uid].displayName = uStat.name || uid;
      }

      const visDef = this.unitsVisualsData.units[uid];
      if (visDef) {
        if (uStat.isMounted || (uStat.mountType && uStat.mountType !== 'none')) {
          visDef.isMounted = true;
          if (!visDef.mountHierarchy) {
            this.setUnitMount(uid, uStat.mountType || 'human_horse');
          }
        }
        restow(this.unitsVisualsData, visDef);
        if (!uStat.loadoutCapabilities) uStat.loadoutCapabilities = {};
        for (const ld of loadoutsOf(visDef)) {
          const caps = computeCapabilitiesForLoadout(uStat, visDef, this.unitsVisualsData, ld.id);
          uStat.loadoutCapabilities[ld.id] = {
            allowedFormations: caps.allowedFormations,
            allowedModes: caps.allowedModes
          };
          if (ld.id === MAIN_LOADOUT) {
            uStat.allowedFormations = caps.allowedFormations;
            uStat.allowedModes = caps.allowedModes;
          }
        }
      }
    }

    // Sync unit intrinsic cost into building options that recruit that unit directly by id
    for (const bDef of Object.values(this.buildingsData.buildings || {})) {
      if (bDef.hasWatchtowerSupport === undefined) {
        bDef.hasWatchtowerSupport = (bDef.watchtowerLevel | 0) > 0 || Boolean(bDef.hasBuiltInTurret);
      }
      if (!Array.isArray(bDef.turretOffset)) {
        bDef.turretOffset = [0, 8.0, 0];
      }
      if (!Array.isArray(bDef.options)) continue;
      for (const opt of bDef.options) {
        if (opt.kind === 'unit' && this.unitStatsData.units[opt.id]) {
          const uStat = this.unitStatsData.units[opt.id];
          opt.name = uStat.name || opt.name;
          if (uStat.cost) {
            opt.cost = deepClone(uStat.cost);
          }
        }
      }
    }
  }

  /**
   * Fix 1 (Part A): Creates a brand-new Warrior unit starting from a clean Base Character (`human_base`, `katiler_base`, etc.)
   * with empty hands and basic clothing so the user builds it up from a base character.
   */
  createNewUnit({
    id,
    name,
    baseCharId = 'human_base',
    mountType = 'none',
    weaponR = 'none',
    weaponL = 'none'
  } = {}) {
    const cleanId =
      String(id || name || `unit_${Date.now().toString(36).slice(-4)}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_') || `unit_${Date.now()}`;

    const baseTemplateMeta =
      BASE_CHARACTER_TEMPLATES.find((b) => b.id === baseCharId) || BASE_CHARACTER_TEMPLATES[0];
    const baseVis =
      this.unitsVisualsData.units[baseTemplateMeta.id] ||
      defaultUnitsVisuals.units[baseTemplateMeta.id] ||
      defaultUnitsVisuals.units.human_base;

    const newVis = deepClone(baseVis);
    newVis.displayName = name || cleanId;
    newVis.race = baseTemplateMeta.race || 'human';
    newVis.equipment = {
      torso: {
        prefab: `${newVis.race}_worn_tunic`,
        gripOffset: [0, 0, 0],
        gripRotation: [0, 0, 0]
      },
      leg_R: {
        prefab: `${newVis.race}_worn_trousers_R`,
        gripOffset: [0, 0, 0],
        gripRotation: [0, 0, 0]
      },
      leg_L: {
        prefab: `${newVis.race}_worn_trousers_L`,
        gripOffset: [0, 0, 0],
        gripRotation: [0, 0, 0]
      },
      foot_R: {
        prefab: `${newVis.race}_worn_shoes_R`,
        gripOffset: [0, 0, 0],
        gripRotation: [0, 0, 0]
      },
      foot_L: {
        prefab: `${newVis.race}_worn_shoes_L`,
        gripOffset: [0, 0, 0],
        gripRotation: [0, 0, 0]
      }
    };

    if (weaponR && weaponR !== 'none' && this.unitsVisualsData.prefabs?.[weaponR]) {
      newVis.equipment.weapon_socket_R = {
        prefab: weaponR,
        gripOffset: [0, 0, 0],
        gripRotation: [0, 0, 0]
      };
    }
    if (weaponL && weaponL !== 'none' && this.unitsVisualsData.prefabs?.[weaponL]) {
      newVis.equipment.weapon_socket_L = {
        prefab: weaponL,
        gripOffset: [0, 0, 0],
        gripRotation: [0, 0, 0]
      };
    }

    restow(this.unitsVisualsData, newVis);
    this.unitsVisualsData.units[cleanId] = newVis;

    const wTypeR = weaponTypeOf(this.unitsVisualsData.prefabs?.[weaponR]);
    const wTypeL = weaponTypeOf(this.unitsVisualsData.prefabs?.[weaponL]);
    const isRangedUnit = wTypeR === 'bow' || wTypeL === 'bow' || wTypeR === 'thrown';
    const isMounted = mountType && mountType !== 'none';

    const baseStat = deepClone(this.unitStatsData.units.swordsman);
    const newStat = {
      ...baseStat,
      id: cleanId,
      name: name || cleanId,
      baseCharId: baseTemplateMeta.id,
      race: newVis.race,
      mountType: isMounted ? mountType : 'none',
      isMounted: Boolean(isMounted),
      isRanged: isRangedUnit,
      isSiege: false,
      isWorker: false,
      roleType: isMounted ? 'cavalry' : isRangedUnit ? 'ranged' : 'infantry',
      squadSize: isMounted ? 16 : 20,
      popCost: isMounted ? 16 : 20,
      visionRangeMeters: isMounted ? 118 : isRangedUnit ? 112 : 96,
      cost: { coins: 150, wood: 0, stone: 0, iron: 30 },
      blacksmithBonuses: {
        forged_blades: 20,
        heavy_plate: 20,
        bodkin_arrows: isRangedUnit ? 25 : 0,
        barding: isMounted ? 25 : 0
      }
    };
    delete newStat.labelHe;
    delete newStat.loadoutCapabilities;
    delete newStat.allowedModes;
    delete newStat.allowedFormations;
    delete newStat.recruitedIn;
    delete newStat.unlockLevel;
    delete newStat.trainTimeSec;
    delete newStat.xpReward;

    this.unitStatsData.units[cleanId] = newStat;
    if (isMounted) {
      this.setUnitMount(cleanId, mountType);
    } else {
      const eligList = computeEligibleFormationsForUnit(
        { ...newStat, allowedFormations: null },
        newVis,
        this.unitsVisualsData,
        this.unitStatsData.formationRules
      );
      newStat.allowedFormations = eligList.filter((f) => f.eligible && f.enabled).map((f) => f.id);
      if (!newStat.allowedFormations.includes('square')) {
        newStat.allowedFormations.unshift('square');
      }
      this.saveAll();
    }
    return cleanId;
  }

  /**
   * Fix 1 (Part B): Duplicates an existing unit (`sourceUnitId`, e.g. `swordsman`) with all its equipped
   * weapons, armor, mount, loadouts, and combat stats!
   */
  duplicateUnit(sourceUnitId, customName = '') {
    const srcStat = this.unitStatsData.units?.[sourceUnitId];
    const srcVis = this.unitsVisualsData.units?.[sourceUnitId];
    if (!srcStat || !srcVis) return null;

    const baseName = customName?.trim() || `${srcStat.name} Copy`;
    const cleanId =
      String(baseName)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_') +
      '_' +
      Date.now().toString(36).slice(-3);

    const clonedVis = deepClone(srcVis);
    clonedVis.displayName = baseName;
    this.unitsVisualsData.units[cleanId] = clonedVis;

    const clonedStat = deepClone(srcStat);
    clonedStat.id = cleanId;
    clonedStat.name = baseName;
    delete clonedStat.labelHe;
    delete clonedStat.recruitedIn;
    delete clonedStat.unlockLevel;
    delete clonedStat.trainTimeSec;
    delete clonedStat.xpReward;

    this.unitStatsData.units[cleanId] = clonedStat;
    this.saveAll();
    return cleanId;
  }

  /**
   * Built-in 1v1 / Full-Squad DPS Duel Simulator for the Units Lab viewport!
   * Calculates exact DPS, effective armor reduction, Time-To-Kill (TTK), winner, and surviving units/HP %.
   */
  simulateUnitDuel(unitAId, unitBId, mode = 'squad') {
    const uA = this.unitStatsData.units?.[unitAId];
    const uB = this.unitStatsData.units?.[unitBId];
    if (!uA || !uB) return null;

    const countA = mode === '1v1' ? 1 : Math.max(1, uA.squadSize | 0);
    const countB = mode === '1v1' ? 1 : Math.max(1, uB.squadSize | 0);

    const calcSingleUnitDpsAgainst = (atk, def) => {
      const isRanged = Boolean(atk.isRanged && (atk.rangedDamage | 0) > 0);
      const rawDmg = isRanged ? Number(atk.rangedDamage) || 8 : Number(atk.meleeDamage) || 10;
      const armor = Number(def.armor) || 0;
      const netHit = Math.max(1, rawDmg - armor * 0.65);
      const avgReloadTicks = Math.max(
        4,
        ((Number(atk.reloadMinTicks) || 15) + (Number(atk.reloadMaxTicks) || 22)) * 0.5 +
          (Number(atk.windupTicks) || 6) * 0.35
      );
      const attacksPerSec = 20 / avgReloadTicks;
      const hitChance = isRanged
        ? Math.min(0.95, Math.max(0.25, ((Number(atk.accuracy) || 75) - (Number(def.missileBlockRating) || 0) * 0.4) / 100))
        : Math.min(0.95, Math.max(0.3, (100 - Math.max(0, (Number(def.meleeBlockRating) || 20) - (Number(atk.attackRating) || 40))) / 100));
      const chargeBurst = atk.canCharge ? (Number(atk.chargeBonusDamage) || 0) * 0.15 : 0;
      return Math.max(0.5, netHit * attacksPerSec * hitChance + chargeBurst);
    };

    const singleDpsA = calcSingleUnitDpsAgainst(uA, uB);
    const singleDpsB = calcSingleUnitDpsAgainst(uB, uA);

    const totalHpA = countA * (Number(uA.hp) || 100);
    const totalHpB = countB * (Number(uB.hp) || 100);

    const totalDpsA = singleDpsA * countA;
    const totalDpsB = singleDpsB * countB;

    const ttkAonB = totalHpB / Math.max(0.1, totalDpsA);
    const ttkBonA = totalHpA / Math.max(0.1, totalDpsB);

    const winnerId = ttkAonB <= ttkBonA ? uA.id : uB.id;
    const winnerName = ttkAonB <= ttkBonA ? uA.name : uB.name;
    const durationSec = Math.min(ttkAonB, ttkBonA);

    const remHpPctA = Math.max(0, Math.round(((totalHpA - totalDpsB * durationSec) / totalHpA) * 100));
    const remHpPctB = Math.max(0, Math.round(((totalHpB - totalDpsA * durationSec) / totalHpB) * 100));

    return {
      mode,
      unitA: { id: uA.id, name: uA.name, count: countA, dps: Math.round(totalDpsA * 10) / 10, ttkSec: Math.round(ttkAonB * 10) / 10, remHpPct: remHpPctA },
      unitB: { id: uB.id, name: uB.name, count: countB, dps: Math.round(totalDpsB * 10) / 10, ttkSec: Math.round(ttkBonA * 10) / 10, remHpPct: remHpPctB },
      winnerId,
      winnerName,
      durationSec: Math.round(durationSec * 10) / 10
    };
  }


  setUnitPortraits(
    unitId,
    {
      recruitPortraitUrl,
      recruitIconKey,
      squadCardIconUrl,
      squadCardIconKey,
      placeholderIconKey,
      placeholderIconUrl,
      placeholderIconKeySet2,
      placeholderIconUrlSet2
    } = {}
  ) {
    const uStat = this.unitStatsData.units?.[unitId];
    if (!uStat) return false;
    if (recruitPortraitUrl !== undefined) {
      if (recruitPortraitUrl) uStat.recruitPortraitUrl = recruitPortraitUrl;
      else delete uStat.recruitPortraitUrl;
    }
    if (recruitIconKey !== undefined) {
      if (recruitIconKey && recruitIconKey !== 'auto') uStat.recruitIconKey = recruitIconKey;
      else delete uStat.recruitIconKey;
    }
    if (squadCardIconUrl !== undefined) {
      if (squadCardIconUrl) uStat.squadCardIconUrl = squadCardIconUrl;
      else delete uStat.squadCardIconUrl;
    }
    if (squadCardIconKey !== undefined) {
      if (squadCardIconKey && squadCardIconKey !== 'auto') uStat.squadCardIconKey = squadCardIconKey;
      else delete uStat.squadCardIconKey;
    }
    if (placeholderIconKey !== undefined) {
      if (placeholderIconKey && placeholderIconKey !== 'auto') uStat.placeholderIconKey = placeholderIconKey;
      else delete uStat.placeholderIconKey;
    }
    if (placeholderIconUrl !== undefined) {
      if (placeholderIconUrl) uStat.placeholderIconUrl = placeholderIconUrl;
      else delete uStat.placeholderIconUrl;
    }
    if (placeholderIconKeySet2 !== undefined) {
      if (placeholderIconKeySet2 && placeholderIconKeySet2 !== 'auto') uStat.placeholderIconKeySet2 = placeholderIconKeySet2;
      else delete uStat.placeholderIconKeySet2;
    }
    if (placeholderIconUrlSet2 !== undefined) {
      if (placeholderIconUrlSet2) uStat.placeholderIconUrlSet2 = placeholderIconUrlSet2;
      else delete uStat.placeholderIconUrlSet2;
    }
    this.saveAll();
    return true;
  }

  addCustomPlaceholderIcon(arg1 = {}, maybeDataUrl = null) {
    const opts = typeof arg1 === "string" ? { label: arg1, dataUrl: maybeDataUrl } : (arg1 || {});
    const { id, label, dataUrl } = opts;
    if (!dataUrl) return null;
    if (!Array.isArray(this.unitStatsData.customPlaceholderIcons)) {
      this.unitStatsData.customPlaceholderIcons = [];
    }
    const cleanId = id || `custom_icon_${Date.now().toString(36).slice(-4)}_${Math.floor(Math.random() * 90 + 10)}`;
    const cleanLabel = label || `Custom Icon #${this.unitStatsData.customPlaceholderIcons.length + 1}`;
    this.unitStatsData.customPlaceholderIcons.push({ id: cleanId, label: cleanLabel, dataUrl });
    this.saveAll();
    return cleanId;
  }

  toggleUnitLoadoutCapability(unitId, loadoutId = MAIN_LOADOUT, kind = 'formation', capId = '') {
    const uStat = this.unitStatsData.units?.[unitId];
    const uVis = this.unitsVisualsData.units?.[unitId];
    if (!uStat || !capId) return false;
    const effLd = loadoutId || MAIN_LOADOUT;
    if (!uStat.loadoutCapabilities) uStat.loadoutCapabilities = {};
    const curCaps = computeCapabilitiesForLoadout(uStat, uVis, this.unitsVisualsData, effLd);
    if (!uStat.loadoutCapabilities[effLd]) {
      uStat.loadoutCapabilities[effLd] = {
        allowedFormations: [...curCaps.allowedFormations],
        allowedModes: [...curCaps.allowedModes]
      };
    }
    const targetEntry = uStat.loadoutCapabilities[effLd];
    if (kind === 'mode') {
      const mSet = new Set(targetEntry.allowedModes || curCaps.allowedModes || []);
      if (mSet.has(capId)) mSet.delete(capId);
      else mSet.add(capId);
      targetEntry.allowedModes = Array.from(mSet);
      if (effLd === MAIN_LOADOUT) {
        uStat.allowedModes = [...targetEntry.allowedModes];
      }
    } else {
      if (capId === 'square') return true;
      const fSet = new Set(targetEntry.allowedFormations || curCaps.allowedFormations || ['square']);
      fSet.add('square');
      if (fSet.has(capId)) fSet.delete(capId);
      else fSet.add(capId);
      targetEntry.allowedFormations = Array.from(fSet);
      if (effLd === MAIN_LOADOUT) {
        uStat.allowedFormations = [...targetEntry.allowedFormations];
      }
    }
    this.saveAll();
    return true;
  }

  deleteUnit(unitId) {
    const unitsObj = this.unitStatsData.units || {};
    const uStat = unitsObj[unitId];
    if (!uStat || uStat.isWorker || unitId === 'worker' || Object.keys(unitsObj).length <= 1) {
      return false;
    }
    delete this.unitStatsData.units[unitId];
    delete this.unitsVisualsData.units[unitId];
    if (!Array.isArray(this.unitStatsData._deletedUnits)) {
      this.unitStatsData._deletedUnits = [];
    }
    if (!this.unitStatsData._deletedUnits.includes(unitId)) {
      this.unitStatsData._deletedUnits.push(unitId);
    }
    for (const bDef of Object.values(this.buildingsData.buildings || {})) {
      if (Array.isArray(bDef.options)) {
        bDef.options = bDef.options.filter((o) => o.id !== unitId && o.unitType !== unitId);
      }
    }
    this.saveAll();
    return true;
  }

  saveAll() {
    if (this._isSavingAll) return;
    this._isSavingAll = true;
    try {
      this._syncUnitsAndBuildingsCrossReferences();
    syncLiveConfigObjectsInMemory(this.unitStatsData, this.buildingsData, this.unitsVisualsData);
    try {
      globalThis.localStorage?.setItem(UNIT_STATS_STORAGE_KEY, JSON.stringify(this.unitStatsData));
      globalThis.localStorage?.setItem(BUILDINGS_DATA_STORAGE_KEY, JSON.stringify(this.buildingsData));
      globalThis.localStorage?.setItem(BUILDING_VISUALS_STORAGE_KEY, JSON.stringify(this.buildingVisualsData));
    } catch (_) {}

    if (this.studioStateManager) {
      this.studioStateManager.data = this.unitsVisualsData;
      this.studioStateManager.saveDraft();
    }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('kings_lands_units_buildings_updated'));
      } catch (_) {}
    }
    this.onStatus?.('saved', 'Saved');
    } finally {
      this._isSavingAll = false;
    }
  }

  scheduleSave(delayMs = 200) {
    this.onStatus?.('dirty', 'Saving…');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveAll(), delayMs);
  }

  resetAllToDefaults() {
    this.unitStatsData = deepClone(INITIAL_UNIT_STATS_SNAPSHOT);
    this.buildingsData = deepClone(INITIAL_BUILDINGS_DATA_SNAPSHOT);
    this.buildingVisualsData = deepClone(INITIAL_BUILDING_VISUALS_SNAPSHOT);
    this.unitsVisualsData = deepClone(INITIAL_UNITS_VISUALS_SNAPSHOT);
    if (defaultHeroesData?.prefabs && this.unitsVisualsData?.prefabs) {
      this.unitsVisualsData.prefabs = {
        ...defaultHeroesData.prefabs,
        ...this.unitsVisualsData.prefabs
      };
    }
    if (this.studioStateManager) {
      this.studioStateManager.data = this.unitsVisualsData;
      try {
        globalThis.localStorage?.removeItem(UNITS_VISUALS_STORAGE_KEY);
      } catch (_) {}
    }
    try {
      globalThis.localStorage?.removeItem(UNIT_STATS_STORAGE_KEY);
      globalThis.localStorage?.removeItem(BUILDINGS_DATA_STORAGE_KEY);
      globalThis.localStorage?.removeItem(BUILDING_VISUALS_STORAGE_KEY);
    } catch (_) {}
    this._syncUnitsAndBuildingsCrossReferences();
    syncLiveConfigObjectsInMemory(this.unitStatsData, this.buildingsData, this.unitsVisualsData);
    this.onStatus?.('saved', 'Reset to defaults');
  }

  exportCombinedBundleJson(filename = 'units_and_buildings_config.json') {
    this.saveAll();
    const payload = {
      version: 2,
      unitStats: this.unitStatsData,
      buildings: this.buildingsData,
      buildingVisuals: this.buildingVisualsData,
      unitEquipment: Object.fromEntries(
        Object.entries(this.unitsVisualsData.units || {}).map(([k, u]) => [
          k,
          {
            equipment: u.equipment || {},
            loadouts: u.loadouts || null,
            race: u.race || null,
            mountHierarchy: u.mountHierarchy || null,
            locomotionAnim: u.locomotionAnim || 'walk'
          }
        ])
      )
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
    downloadBytes(bytes, filename, 'application/json');
  }

  importCombinedBundleText(jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed.unitStats?.units) {
        this.unitStatsData = parsed.unitStats;
      }
      if (parsed.buildings?.buildings) {
        this.buildingsData = parsed.buildings;
      }
      if (parsed.buildingVisuals?.animations) {
        this.buildingVisualsData = parsed.buildingVisuals;
      }
      if (parsed.unitEquipment) {
        for (const [uid, eqObj] of Object.entries(parsed.unitEquipment)) {
          if (this.unitsVisualsData.units[uid]) {
            this.unitsVisualsData.units[uid].equipment = eqObj.equipment || {};
            if (eqObj.loadouts) this.unitsVisualsData.units[uid].loadouts = eqObj.loadouts;
            if (eqObj.mountHierarchy) this.unitsVisualsData.units[uid].mountHierarchy = eqObj.mountHierarchy;
          }
        }
      }
      this.saveAll();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || 'Invalid JSON' };
    }
  }
}
