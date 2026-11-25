/**
 * Kings Lands — Units & Buildings Lab State Manager
 * (src/tools/units_buildings/unitsBuildingsStateManager.js)
 *
 * Thin state manager backed 100% by `dataRegistry` (`src/data/dataRegistry.js`):
 *  - Zero direct `.json` imports and zero `localStorage` reads/writes.
 *  - Base character templates are derived dynamically from `dataRegistry.getBases()`.
 *  - All saves validate cross-references inside `dataRegistry` before committing.
 */

import { dataRegistry, DEFAULT_BASE_CHAR_ID, resolveBaseCharId } from '../../data/dataRegistry.js';
import { computeCapabilitiesForLoadout } from '../../sim/combatCapabilitiesRegistry.js';
import { StudioStateManager } from '../studio/studioStateManager.js';
import { MAIN_LOADOUT, heldItems, loadoutsOf, asLoadout, restow, weaponTypeOf } from '../studio/weaponRules.js';
import { downloadBytes } from '../studio/portraitRenderer.js';
import { listStudioBaseChoices, removeUnitAcrossLabs } from '../labSync.js';

export function getBaseCharacterTemplates(race = null) {
  return dataRegistry.getBases(race);
}

export const MOUNT_TYPES = Object.freeze([
  { id: 'none', label: 'None (On Foot)' },
  { id: 'human_horse', label: 'Warhorse (human_horse)' },
  { id: 'katiler_wolf', label: 'Dire Wolf (katiler_wolf)' },
  { id: 'war_chameleon', label: 'War Chameleon (sisnat_chameleon)' }
]);

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const GEAR_REFERENCE_BASE = Object.freeze({ human: 'human_base_1' });
const NON_BODY_SOCKET_RE = /^(weapon_socket|stow_|cape_|quiver_|arrow_|bowstring)/;

function restWorldPos(tree, name, acc = [0, 0, 0]) {
  for (const [k, n] of Object.entries(tree || {})) {
    const p = Array.isArray(n?.pos) ? n.pos : [0, 0, 0];
    const here = [acc[0] + (p[0] || 0), acc[1] + (p[1] || 0), acc[2] + (p[2] || 0)];
    if (k === name) return here;
    const r = restWorldPos(n?.children, name, here);
    if (r) return r;
  }
  return null;
}

function collectNodeNames(tree, out = new Set()) {
  for (const [k, n] of Object.entries(tree || {})) {
    out.add(k);
    collectNodeNames(n?.children, out);
  }
  return out;
}

function findHierarchyNode(tree, name) {
  for (const [k, n] of Object.entries(tree || {})) {
    if (k === name) return n;
    const r = findHierarchyNode(n?.children, name);
    if (r) return r;
  }
  return null;
}

function gearShift(fromHier, toHier, slot) {
  const a = restWorldPos(fromHier, slot);
  const b = restWorldPos(toHier, slot);
  if (!a || !b) return null;
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  if (slot === 'torso' || slot === 'pelvis') {
    const d = sub(a, b);
    const ha = restWorldPos(fromHier, 'head');
    const hb = restWorldPos(toHier, 'head');
    if (slot === 'torso' && ha && hb) {
      const neckAligned = (hb[1] - b[1]) - (ha[1] - a[1]);
      d[1] = (d[1] + neckAligned) / 2;
    }
    return d;
  }
  if (/^foot_/.test(slot)) return [0, a[1] - b[1], 0];
  return [0, 0, 0];
}

function realignWornGear(unitVis, fromHier, toHier) {
  if (!unitVis || !fromHier || !toHier) return 0;
  const maps = [unitVis.equipment, ...Object.values(unitVis.loadouts || {}).map((l) => l?.equipment)];
  let moved = 0;
  for (const eq of maps) {
    for (const [sock, cfg] of Object.entries(eq || {})) {
      if (!cfg || cfg.auto || NON_BODY_SOCKET_RE.test(sock)) continue;
      const d = gearShift(fromHier, toHier, sock);
      if (!d || Math.hypot(d[0], d[1], d[2]) < 1e-6) continue;
      const g = Array.isArray(cfg.gripOffset) ? cfg.gripOffset : [0, 0, 0];
      cfg.gripOffset = [0, 1, 2].map((i) => +((g[i] || 0) + d[i]).toFixed(4));
      moved++;
    }
  }
  return moved;
}

/**
 * Determines which formations are naturally eligible for a unit given its mount state and equipped weapons
 * across its loadouts, and returns both the eligible list and the user-enabled `allowedFormations`.
 */
export function computeEligibleFormationsForUnit(
  unitStatDef,
  unitVisualDef,
  visualsData,
  formationRules = null
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

  const rules = formationRules || dataRegistry.getUnitStats()?.formationRules || {};
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

export function loadUnitsBuildingsConfigFromStorage() {
  const { stats, visuals } = dataRegistry.getUnits();
  const buildings = dataRegistry.getBuildings();
  return {
    unitStatsData: stats,
    buildingsData: buildings,
    unitsVisualsData: visuals
  };
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
    this._isSavingAll = false;

    this._reloadFromRegistry();

    this._unsubRegistry = dataRegistry.subscribe(() => {
      if (this._isSavingAll) return;
      // Unsaved local edits are written first (three-way merge, they never overwrite what another lab saved), then we reload.
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
        this.saveAll();
        return;
      }
      this._reloadFromRegistry();
    });
  }

  _reloadFromRegistry() {
    this.unitStatsData = dataRegistry.getUnitStats();
    this.buildingsData = dataRegistry.getBuildings();
    this.buildingVisualsData = dataRegistry.getBuildingVisuals();
    this.unitsVisualsData = dataRegistry.getUnitsVisuals();

    const heroPrefabs = dataRegistry.getHeroesData()?.prefabs;
    if (heroPrefabs && this.unitsVisualsData?.prefabs) {
      this.unitsVisualsData.prefabs = {
        ...heroPrefabs,
        ...this.unitsVisualsData.prefabs
      };
      dataRegistry.markClean(this.unitsVisualsData); // the hero-prefab view is not a local edit
    }

    if (this.studioStateManager && !this.studioStateManager._dirty) {
      this.studioStateManager.data = this.unitsVisualsData;
    }
  }

  _buildDireWolfMountHierarchy() {
    const baselineUnits = dataRegistry.getBaselineSnapshot().unitsVisuals;
    const wolfTorso = deepClone(
      baselineUnits?.units?.katiler_wolf?.hierarchy?.torso ||
      this.unitsVisualsData?.units?.katiler_wolf?.hierarchy?.torso
    );
    if (!wolfTorso) {
      return deepClone(baselineUnits.units.cavalry.mountHierarchy);
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

  setUnitMount(unitId, mountType = 'none', { save = true } = {}) {
    const uStat = this.unitStatsData.units?.[unitId];
    const uVis = this.unitsVisualsData.units?.[unitId];
    if (!uStat || !uVis) return false;

    const baseline = dataRegistry.getBaselineSnapshot();
    const baselineUnits = baseline.unitsVisuals;
    const baselineHeroes = baseline.heroes;

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
      const standId = this._standSkeletonId(unitId);
      const standPelvis =
        baselineUnits.units?.[standId]?.hierarchy?.pelvis ||
        this.unitsVisualsData.units?.[standId]?.hierarchy?.pelvis ||
        baselineUnits.units?.[DEFAULT_BASE_CHAR_ID]?.hierarchy?.pelvis;
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
      if (cleanMount === 'war_chameleon' && (dataRegistry.getHero('sisnat')?.mountHierarchy || baselineHeroes?.heroes?.sisnat?.mountHierarchy)) {
        uVis.mountHierarchy = deepClone(
          dataRegistry.getHero('sisnat')?.mountHierarchy || baselineHeroes.heroes.sisnat.mountHierarchy
        );
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
          baselineUnits.units?.cavalry?.mountHierarchy ||
          this.unitsVisualsData.units?.cavalry?.mountHierarchy
        );
        if (uVis.hierarchy?.pelvis) {
          uVis.hierarchy.pelvis.pos = [0, 1.44, 0.02];
        }
      }

      const cavPelvis =
        baselineUnits.units?.cavalry?.hierarchy?.pelvis ||
        this.unitsVisualsData.units?.cavalry?.hierarchy?.pelvis;
      const standId = this._standSkeletonId(unitId);
      const refStand = baselineUnits.units?.[DEFAULT_BASE_CHAR_ID]?.hierarchy?.pelvis;
      const ownStand = standId === DEFAULT_BASE_CHAR_ID ? null : baselineUnits.units?.[standId]?.hierarchy?.pelvis;
      const ridePos = (side) => {
        const ride = cavPelvis?.children?.[`leg_${side}`]?.pos;
        const own = ownStand?.children?.[`leg_${side}`]?.pos;
        const ref = refStand?.children?.[`leg_${side}`]?.pos;
        if (!ride) return null;
        if (!own || !ref) return deepClone(ride);
        return ride.map((v, i) => +(v - ref[i] + own[i]).toFixed(4));
      };
      if (cavPelvis?.children && uVis.hierarchy?.pelvis?.children) {
        if (cavPelvis.children.leg_L && uVis.hierarchy.pelvis.children.leg_L) {
          uVis.hierarchy.pelvis.children.leg_L.pos = ridePos('L');
          uVis.hierarchy.pelvis.children.leg_L.rot = deepClone(cavPelvis.children.leg_L.rot || [-0.65, 0.32, -0.35]);
          if (uVis.hierarchy.pelvis.children.leg_L.children?.shin_L && cavPelvis.children.leg_L.children?.shin_L) {
            uVis.hierarchy.pelvis.children.leg_L.children.shin_L.rot = deepClone(
              cavPelvis.children.leg_L.children.shin_L.rot || [0.85, 0, 0]
            );
          }
        }
        if (cavPelvis.children.leg_R && uVis.hierarchy.pelvis.children.leg_R) {
          uVis.hierarchy.pelvis.children.leg_R.pos = ridePos('R');
          uVis.hierarchy.pelvis.children.leg_R.rot = deepClone(cavPelvis.children.leg_R.rot || [-0.65, -0.32, 0.35]);
          if (uVis.hierarchy.pelvis.children.leg_R.children?.shin_R && cavPelvis.children.leg_R.children?.shin_R) {
            uVis.hierarchy.pelvis.children.leg_R.children.shin_R.rot = deepClone(
              cavPelvis.children.leg_R.children.shin_R.rot || [0.85, 0, 0]
            );
          }
        }
      }
    }

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

    if (save) this.saveAll();
    return true;
  }

  getUnitBaseId(unitId) {
    const uStat = this.unitStatsData.units?.[unitId];
    const uVis = this.unitsVisualsData.units?.[unitId];
    const raw = uStat?.baseCharId || uStat?.baseModel;
    if (raw) return resolveBaseCharId(raw, raw);
    const race = uVis?.race || uStat?.race || 'human';
    return getBaseCharacterTemplates().find((b) => b.race === race)?.id || DEFAULT_BASE_CHAR_ID;
  }

  _standSkeletonId(unitId) {
    const id = this.getUnitBaseId(unitId);
    return getBaseCharacterTemplates().find((b) => b.id === id)?.race === 'human' ? id : DEFAULT_BASE_CHAR_ID;
  }

  _baseVisual(baseId) {
    const baselineUnits = dataRegistry.getBaselineSnapshot().unitsVisuals;
    return (
      this.unitsVisualsData.units?.[baseId] ||
      baselineUnits?.units?.[baseId] ||
      null
    );
  }

  listBasesForUnit(unitId) {
    return listStudioBaseChoices(
      this.unitsVisualsData,
      this.unitStatsData,
      unitId,
      getBaseCharacterTemplates()
    );
  }

  rebaseUnit(unitId, newBaseId) {
    const uStat = this.unitStatsData.units?.[unitId];
    const uVis = this.unitsVisualsData.units?.[unitId];
    const resolvedNewId = resolveBaseCharId(newBaseId, newBaseId);
    const bases = getBaseCharacterTemplates();
    const target = bases.find((b) => b.id === resolvedNewId) || null;
    if (!uStat || !uVis || !target) return { ok: false, reason: 'unknown unit or base character' };

    const oldId = this.getUnitBaseId(unitId);
    if (oldId === target.id) return { ok: true, unchanged: true, from: oldId, to: oldId };
    const oldMeta = bases.find((b) => b.id === oldId) || null;
    if (!oldMeta) return { ok: false, reason: 'this unit is not built on a base character' };
    if (oldMeta.race && target.race && oldMeta.race !== target.race) {
      return { ok: false, reason: 'a unit can only switch between base characters of its own race' };
    }
    const oldBase = this._baseVisual(oldId);
    const newBase = this._baseVisual(target.id);
    if (!oldBase?.hierarchy || !newBase?.hierarchy) return { ok: false, reason: 'base character data is missing' };

    const newHier = deepClone(newBase.hierarchy);
    const baseNames = collectNodeNames(oldBase.hierarchy);
    const shiftOf = (bone) => {
      const a = restWorldPos(oldBase.hierarchy, bone);
      const b = restWorldPos(newBase.hierarchy, bone);
      return a && b ? [a[0] - b[0], a[1] - b[1], a[2] - b[2]] : [0, 0, 0];
    };

    const carried = [];
    const visit = (tree, parentName) => {
      for (const [k, n] of Object.entries(tree || {})) {
        if (baseNames.has(k)) { visit(n?.children, k); continue; }
        const host = parentName ? findHierarchyNode(newHier, parentName) : null;
        if (!host || findHierarchyNode(newHier, k)) continue;
        const node = deepClone(n);
        const d = shiftOf(parentName);
        const p = Array.isArray(node.pos) ? node.pos : [0, 0, 0];
        node.pos = [0, 1, 2].map((i) => +((p[i] || 0) + d[i]).toFixed(4));
        (host.children = host.children || {})[k] = node;
        carried.push(k);
      }
    };
    visit(uVis.hierarchy, null);

    const dressed = [];
    uVis.equipment = uVis.equipment || {};
    if (target.bare && !oldMeta.bare) {
      for (const [slot, id] of [['torso', 'worn_tunic'], ['leg_R', 'worn_trousers_R'], ['leg_L', 'worn_trousers_L'], ['foot_R', 'worn_shoes_R'], ['foot_L', 'worn_shoes_L']]) {
        const prefab = `${target.race}_${id}`;
        if (!uVis.equipment[slot] && this.unitsVisualsData.prefabs?.[prefab]) {
          uVis.equipment[slot] = { prefab, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0], baseDress: true };
          dressed.push(slot);
        }
      }
    } else if (!target.bare && oldMeta.bare) {
      for (const [slot, cfg] of Object.entries(uVis.equipment)) {
        if (cfg?.baseDress) { delete uVis.equipment[slot]; dressed.push(`-${slot}`); }
      }
    }
    const movedGear = realignWornGear(uVis, oldBase.hierarchy, newBase.hierarchy);
    const keepMount = uVis.mountHierarchy;
    const sOld = Number(oldBase.scale) || 1;
    const sNew = Number(newBase.scale) || 1;
    uVis.hierarchy = newHier;
    uVis.scale = +((Number(uVis.scale) || sOld) * (sNew / sOld)).toFixed(4);
    uStat.baseCharId = target.id;
    uVis._gearConfiguredInLab = true;

    if (uStat.mountType && uStat.mountType !== 'none') {
      this.setUnitMount(unitId, uStat.mountType, { save: false });
      if (keepMount) uVis.mountHierarchy = keepMount;
    }
    restow(this.unitsVisualsData, uVis);
    this.saveAll();
    return { ok: true, from: oldId, to: target.id, carried, movedGear, dressed };
  }

  createNewUnit({
    id,
    name,
    baseCharId = DEFAULT_BASE_CHAR_ID,
    mountType = 'none',
    weaponR = 'none',
    weaponL = 'none'
  } = {}) {
    const cleanId =
      String(id || name || `unit_${Date.now().toString(36).slice(-4)}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_') || `unit_${Date.now()}`;

    const bases = getBaseCharacterTemplates();
    const wantedBaseId = resolveBaseCharId(baseCharId);
    const baseTemplateMeta =
      bases.find((b) => b.id === wantedBaseId) ||
      bases[0] || { id: DEFAULT_BASE_CHAR_ID, race: 'human' };
    const baselineUnits = dataRegistry.getBaselineSnapshot().unitsVisuals;
    const baseVis =
      this.unitsVisualsData.units[baseTemplateMeta.id] ||
      baselineUnits.units[baseTemplateMeta.id] ||
      baselineUnits.units[DEFAULT_BASE_CHAR_ID];

    const newVis = deepClone(baseVis);
    newVis.displayName = name || cleanId;
    newVis.race = baseTemplateMeta.race || 'human';
    delete newVis.isBaseTemplate;
    delete newVis.bare;
    newVis.equipment = {
      torso: { prefab: `${newVis.race}_worn_tunic`, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] },
      leg_R: { prefab: `${newVis.race}_worn_trousers_R`, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] },
      leg_L: { prefab: `${newVis.race}_worn_trousers_L`, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] },
      foot_R: { prefab: `${newVis.race}_worn_shoes_R`, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] },
      foot_L: { prefab: `${newVis.race}_worn_shoes_L`, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] }
    };

    const refBaseId = GEAR_REFERENCE_BASE[newVis.race];
    if (refBaseId && refBaseId !== baseTemplateMeta.id) {
      realignWornGear(newVis, this._baseVisual(refBaseId)?.hierarchy, newVis.hierarchy);
    }

    if (weaponR && weaponR !== 'none' && this.unitsVisualsData.prefabs?.[weaponR]) {
      newVis.equipment.weapon_socket_R = { prefab: weaponR, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] };
    }
    if (weaponL && weaponL !== 'none' && this.unitsVisualsData.prefabs?.[weaponL]) {
      newVis.equipment.weapon_socket_L = { prefab: weaponL, gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] };
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
    const opts = typeof arg1 === 'string' ? { label: arg1, dataUrl: maybeDataUrl } : (arg1 || {});
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
    this._isSavingAll = true;
    try {
      const res = dataRegistry.deleteUnit(unitId);
      if (!res.ok) {
        this.onStatus?.('error', res.error || 'Delete rejected');
        return false;
      }
      this._reloadFromRegistry();
      this.onStatus?.('saved', 'Saved');
      return true;
    } finally {
      this._isSavingAll = false;
    }
  }

  saveAll() {
    if (this._isSavingAll) return { ok: true };
    this._isSavingAll = true;
    try {
      const res = dataRegistry.commitWorking({
        unitStats: this.unitStatsData,
        buildings: this.buildingsData,
        buildingVisuals: this.buildingVisualsData,
        unitsVisuals: this.unitsVisualsData
      }, { reason: 'unitsBuildingsSaveAll' });

      if (!res.ok) {
        this.onStatus?.('error', res.error || 'Validation failed');
        return res;
      }

      this._reloadFromRegistry();
      if (this.studioStateManager) {
        this.studioStateManager._dirty = false;
      }
      this.onStatus?.('saved', 'Saved');
      return res;
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
    clearTimeout(this._saveTimer);
    this._isSavingAll = true;
    try {
      const res = dataRegistry.resetToDefaults();
      this._reloadFromRegistry();
      if (this.studioStateManager) {
        this.studioStateManager._dirty = false;
        this.studioStateManager.data = this.unitsVisualsData;
      }
      this.onStatus?.('saved', 'Reset to defaults');
      return res.ok;
    } finally {
      this._isSavingAll = false;
    }
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
      const prevU = deepClone(this.unitStatsData);
      const prevB = deepClone(this.buildingsData);
      const prevBV = deepClone(this.buildingVisualsData);
      const prevUV = deepClone(this.unitsVisualsData);

      if (parsed.unitStats?.units) this.unitStatsData = parsed.unitStats;
      if (parsed.buildings?.buildings) this.buildingsData = parsed.buildings;
      if (parsed.buildingVisuals?.animations) this.buildingVisualsData = parsed.buildingVisuals;
      if (parsed.unitEquipment) {
        for (const [uid, eqObj] of Object.entries(parsed.unitEquipment)) {
          if (this.unitsVisualsData.units[uid]) {
            this.unitsVisualsData.units[uid].equipment = eqObj.equipment || {};
            if (eqObj.loadouts) this.unitsVisualsData.units[uid].loadouts = eqObj.loadouts;
            if (eqObj.mountHierarchy) this.unitsVisualsData.units[uid].mountHierarchy = eqObj.mountHierarchy;
          }
        }
      }
      const res = this.saveAll();
      if (!res?.ok) {
        this.unitStatsData = prevU;
        this.buildingsData = prevB;
        this.buildingVisualsData = prevBV;
        this.unitsVisualsData = prevUV;
        return { ok: false, error: res?.error || 'Validation failed' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || 'Invalid JSON' };
    }
  }

  destroy() {
    clearTimeout(this._saveTimer);
    if (this._unsubRegistry) {
      this._unsubRegistry();
      this._unsubRegistry = null;
    }
  }
}
