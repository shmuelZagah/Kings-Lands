/**
 * Kings Lands — Central Combat Capabilities, Formations & Stances Registry
 * (src/sim/combatCapabilitiesRegistry.js)
 *
 * Single source of truth connecting:
 * 1. Equipped Weapons (`Set 1` / `main` vs `Set 2` / `loadout2`) & Mount State
 * 2. Eligible & Enabled Formations per Weapon Set (`square`, `shieldWall`, `spearWall`, `pikePhalanx`, `wedge`, `skirmishCircle`)
 * 3. Eligible & Enabled Combat Modes / Stances per Weapon Set (`fireAtWill`, `holdGround`, `skirmishKite`, `chargeImpact`)
 * 4. Required Animation Clips (`walk`/`gallop`, `attack_slash`, `attack_thrust`, `shoot_bow`, `throw_javelin`, `block`, `switch_weapon`)
 * 5. In-Game HUD (`UnitTacticalOrb`, `FormationPreview3D`), Web Worker Simulation (`GameState`, `Company`, `MovementSystem`, `UnitCombatSystem`),
 *    Units & Buildings Lab (`UnitsBuildingsLabApp`), and Animation Lab (`StudioApp`).
 */

import { simUnitStats, simUnitsVisuals } from './simConfig.js';
import { MAIN_LOADOUT, loadoutsOf, asLoadout, heldItems, weaponTypeOf } from '../tools/studio/weaponRules.js';

export const COMBAT_MODES_CATALOG = Object.freeze({
  autoSwitchWeaponSet: {
    id: 'autoSwitchWeaponSet',
    labelEn: 'Auto-Switch Gear by Range/Ammo',
    shortLabel: 'Auto-Switch Gear',
    icon: '🔄',
    requiresSecondLoadout: true,
    requiresWeaponTypes: [],
    defaultEnabled: true,
    description: 'Automatically switches between Set 1 and Set 2 based on enemy melee proximity and remaining ammo.'
  },
  fireAtWill: {
    id: 'fireAtWill',
    labelEn: 'Fire at Will / By Order',
    shortLabel: 'Fire at Will',
    icon: '🏹',
    requiresWeaponTypes: ['bow', 'thrown'],
    defaultEnabled: true,
    description: 'Allows the squad to automatically fire at enemies in range, or hold fire until ordered.'
  },
  holdGround: {
    id: 'holdGround',
    labelEn: 'Hold Ground',
    shortLabel: 'Hold Ground',
    icon: '🛡️',
    requiresWeaponTypes: ['melee_short', 'melee_long', 'shield', 'bow', 'thrown'],
    defaultEnabled: true,
    description: 'Squad holds its defensive position instead of pursuing enemies out of formation.'
  },
  skirmishKite: {
    id: 'skirmishKite',
    labelEn: 'Skirmish Distance',
    shortLabel: 'Skirmish',
    icon: '🏃',
    requiresWeaponTypes: ['bow', 'thrown'],
    defaultEnabled: false,
    description: 'Ranged skirmishers maintain distance when enemy melee units close in.'
  },
  chargeImpact: {
    id: 'chargeImpact',
    labelEn: 'Shock Charge',
    shortLabel: 'Charge',
    icon: '⚡',
    requiresWeaponTypes: ['melee_short', 'melee_long'],
    defaultEnabled: true,
    description: 'Running into enemies delivers momentum charge bonus damage and knockback.'
  }
});

export const FORMATION_RULES_CATALOG = Object.freeze({
  square: {
    id: 'square',
    labelEn: 'Square',
    toggleLabel: 'Square (Base)',
    requiresMounted: null,
    requiresWeaponTypes: [],
    defaultEnabled: true
  },
  shieldWall: {
    id: 'shieldWall',
    labelEn: 'Shield Wall',
    toggleLabel: 'Square ↔ Shield Wall',
    requiresMounted: false,
    requiresWeaponTypes: ['shield', 'melee_short'],
    defaultEnabled: true
  },
  spearWall: {
    id: 'spearWall',
    labelEn: 'Spear Wall',
    toggleLabel: 'Square ↔ Spear Wall',
    requiresMounted: false,
    requiresWeaponTypes: ['melee_long'],
    defaultEnabled: true
  },
  pikePhalanx: {
    id: 'pikePhalanx',
    labelEn: 'Pike Phalanx',
    toggleLabel: 'Square ↔ Pike Phalanx',
    requiresMounted: false,
    requiresWeaponTypes: ['melee_long'],
    defaultEnabled: false
  },
  wedge: {
    id: 'wedge',
    labelEn: 'Wedge',
    toggleLabel: 'Square ↔ Wedge',
    requiresMounted: true,
    requiresWeaponTypes: ['melee_short', 'melee_long'],
    defaultEnabled: true
  },
  skirmishCircle: {
    id: 'skirmishCircle',
    labelEn: 'Skirmish Circle',
    toggleLabel: 'Square ↔ Skirmish Circle',
    requiresMounted: null,
    requiresWeaponTypes: ['bow', 'thrown'],
    defaultEnabled: false
  }
});

/**
 * Extracts weapon types held in a specific loadout (`'main'` or `'loadout2'`) of a unit.
 */
export function getLoadoutWeaponTypes(unitStatDef, unitVisualDef, visualsData = simUnitsVisuals(), loadoutId = MAIN_LOADOUT) {
  const types = new Set();
  const prefabs = visualsData?.prefabs || simUnitsVisuals()?.prefabs || {};

  if (unitVisualDef) {
    const view = asLoadout(unitVisualDef, loadoutId);
    for (const item of heldItems({ prefabs }, view)) {
      if (item.type) types.add(item.type);
      if (item.id === 'pike') types.add('pike');
    }
    const eq = view.equipment || {};
    for (const sock of ['weapon_socket_R', 'weapon_socket_L']) {
      const pid = eq[sock]?.prefab;
      if (!pid || pid === 'none') continue;
      const pf = prefabs[pid];
      const wt = weaponTypeOf(pf);
      if (wt) types.add(wt);
      if (/bow|crossbow/i.test(pid)) types.add('bow');
      else if (/javelin|throw/i.test(pid)) types.add('thrown');
      else if (/spear|pike|halberd/i.test(pid)) types.add('melee_long');
      else if (/shield|buckler/i.test(pid)) types.add('shield');
      else if (/sword|axe|mace|hammer/i.test(pid)) types.add('melee_short');
    }
  }

  if (types.size === 0 && loadoutId === MAIN_LOADOUT) {
    if (unitStatDef?.id === 'spearman') types.add('melee_long');
    else if (unitStatDef?.id === 'swordsman' || unitStatDef?.id === 'cavalry') {
      types.add('melee_short');
      types.add('shield');
    } else if (unitStatDef?.isRanged && !unitStatDef?.isSiege) {
      types.add('bow');
    } else if (unitStatDef?.isSiege || unitStatDef?.id === 'ballista') {
      types.add('bow');
    }
  }

  return types;
}

/**
 * Computes eligible & enabled formations AND combat modes for a unit in a specific `loadoutId` (`'main'` or `'loadout2'`).
 */
export function computeCapabilitiesForLoadout(
  unitStatDef,
  unitVisualDef = null,
  visualsData = simUnitsVisuals(),
  loadoutId = MAIN_LOADOUT
) {
  const uStat = unitStatDef || {};
  const uVis = unitVisualDef || visualsData?.units?.[uStat.id] || {};
  const isMounted = Boolean(
    uStat.isMounted ||
      (uStat.mountType && uStat.mountType !== 'none') ||
      uStat.roleType === 'cavalry' ||
      uVis?.mountHierarchy
  );

  const lds = loadoutsOf(uVis);
  const hasSecondaryLoadout = lds.length > 1;
  const effectiveLoadoutId =
    loadoutId && lds.some((l) => l.id === loadoutId) ? loadoutId : MAIN_LOADOUT;

  const weaponTypes = getLoadoutWeaponTypes(uStat, uVis, visualsData, effectiveLoadoutId);
  const isRangedLoadout = weaponTypes.has('bow') || weaponTypes.has('thrown') || Boolean(uStat.isSiege);

  const savedLoadoutCaps = uStat.loadoutCapabilities?.[effectiveLoadoutId] || null;
  const savedFormations = Array.isArray(savedLoadoutCaps?.allowedFormations)
    ? savedLoadoutCaps.allowedFormations
    : effectiveLoadoutId === MAIN_LOADOUT && Array.isArray(uStat.allowedFormations)
      ? uStat.allowedFormations
      : null;

  const savedModes = Array.isArray(savedLoadoutCaps?.allowedModes)
    ? savedLoadoutCaps.allowedModes
    : effectiveLoadoutId === MAIN_LOADOUT && Array.isArray(uStat.allowedModes)
      ? uStat.allowedModes
      : null;

  const rulesSource = {
    ...FORMATION_RULES_CATALOG,
    ...(simUnitStats()?.formationRules || {})
  };

  const formations = [];
  for (const [fId, rule] of Object.entries(rulesSource)) {
    let eligible = true;
    if (rule.requiresMounted === true && !isMounted) eligible = false;
    if (rule.requiresMounted === false && isMounted) eligible = false;
    if (eligible && Array.isArray(rule.requiresWeaponTypes) && rule.requiresWeaponTypes.length > 0) {
      const hasAny = rule.requiresWeaponTypes.some((wt) => weaponTypes.has(wt));
      if (!hasAny) eligible = false;
    }
    if (uStat.isWorker || uStat.isSiege) {
      eligible = fId === 'square';
    }

    let defaultOn = eligible && Boolean(rule.defaultEnabled);
    if (fId === 'shieldWall' && !weaponTypes.has('shield')) {
      defaultOn = false;
    }

    const enabled =
      fId === 'square'
        ? true
        : eligible && (savedFormations ? savedFormations.includes(fId) : defaultOn);

    formations.push({
      id: fId,
      labelEn: rule.labelEn || fId,
      toggleLabel: rule.toggleLabel || `Square ↔ ${rule.labelEn || fId}`,
      eligible,
      enabled
    });
  }

  const modes = [];
  for (const [mId, mRule] of Object.entries(COMBAT_MODES_CATALOG)) {
    let eligible = true;
    if (uStat.isWorker) {
      eligible = false;
    } else if (mRule.requiresSecondLoadout) {
      eligible = hasSecondaryLoadout;
    } else if (Array.isArray(mRule.requiresWeaponTypes) && mRule.requiresWeaponTypes.length > 0) {
      eligible = mRule.requiresWeaponTypes.some((wt) => weaponTypes.has(wt));
    }
    if (mId === 'fireAtWill' && uStat.isSiege) {
      eligible = true;
    }

    const enabled =
      eligible &&
      (savedModes ? savedModes.includes(mId) : Boolean(mRule.defaultEnabled));

    modes.push({
      id: mId,
      labelEn: mRule.labelEn,
      shortLabel: mRule.shortLabel,
      icon: mRule.icon,
      description: mRule.description,
      eligible,
      enabled
    });
  }

  const allowedFormations = formations.filter((f) => f.enabled).map((f) => f.id);
  if (!allowedFormations.includes('square')) allowedFormations.unshift('square');
  const secondaryFormation = allowedFormations.find((f) => f !== 'square') || null;
  const allowedModes = modes.filter((m) => m.enabled).map((m) => m.id);

  return {
    loadoutId: effectiveLoadoutId,
    hasSecondaryLoadout,
    isMounted,
    isRangedLoadout,
    weaponTypes: Array.from(weaponTypes),
    formations,
    modes,
    allowedFormations,
    secondaryFormation,
    allowedModes,
    canFireAtWill: Boolean(isRangedLoadout && allowedModes.includes('fireAtWill')),
    canHoldGround: allowedModes.includes('holdGround'),
    canSkirmishKite: allowedModes.includes('skirmishKite'),
    canChargeImpact: allowedModes.includes('chargeImpact'),
    canAutoSwitchWeaponSet: hasSecondaryLoadout && allowedModes.includes('autoSwitchWeaponSet')
  };
}

/**
 * Resolves the active capabilities for a live Company or Unit by `unitType` and `activeLoadoutIdx` (0 = Set 1, 1 = Set 2).
 */
export function resolveUnitActiveCapabilities(
  unitType,
  activeLoadoutIdx = 0,
  unitStatsData = simUnitStats(),
  unitsVisualsData = simUnitsVisuals()
) {
  const uStat = unitStatsData?.units?.[unitType] || simUnitStats()?.units?.[unitType] || simUnitStats()?.units?.swordsman;
  const uVis = unitsVisualsData?.units?.[unitType] || simUnitsVisuals()?.units?.[unitType] || null;
  const lds = uVis ? loadoutsOf(uVis) : [{ id: MAIN_LOADOUT }];
  const targetLd = activeLoadoutIdx === 1 && lds[1] ? lds[1].id : MAIN_LOADOUT;
  return computeCapabilitiesForLoadout(uStat, uVis, unitsVisualsData, targetLd);
}
