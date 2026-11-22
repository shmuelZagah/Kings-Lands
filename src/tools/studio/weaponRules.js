/**
 * Kings Lands — Studio weapon rules (src/tools/studio/weaponRules.js)
 *
 * WHAT A UNIT CAN DO comes from what it carries. A weapon / shield only OPENS an action slot
 * (it never decides how the action looks: the clip itself still belongs to the unit, see clipResolver.js).
 *
 * Rules are defined by TYPE, never per weapon name:
 *
 *   weaponType      opens
 *   --------------  ---------------------------------------------
 *   melee_short     attack_slash                  (sword, knife, axe, hammer ...)
 *   melee_long      attack_thrust                 (spear, pike, polearm ...)
 *   bow             shoot_bow + attack_bash       (bow, crossbow: a launcher can also hit up close)
 *   thrown          throw_javelin                 (javelin, throwing knife)
 *   shield          block
 *
 *   + two-handed weapon (prefab `twoHanded: true`): it also opens `block`, and it LOCKS the other hand.
 *   + two one-handed weapons of the same type: nothing extra is opened; the attack simply uses both hands.
 *   + everyone, always: take_damage, die  (idle / walk / run are movement, handled elsewhere)
 *   + a unit whose gear opens no attack at all still has `defaultAttack` (attack_slash: it hits with its hands)
 *   + a bow in hand brings its quiver on the back (STOW_COMPANIONS)
 *
 * The table lives in data (units.json -> actionRules) so the game and the studio read the same thing.
 * DEFAULT_ACTION_RULES is only the fallback when the data has none.
 */

export const DEFAULT_ACTION_RULES = Object.freeze({
  always: ['take_damage', 'knocked_down', 'victory_cheer', 'die'],
  types: {
    melee_short: { grants: ['attack_slash'] },
    melee_long: { grants: ['attack_thrust'] },
    bow: { grants: ['shoot_bow', 'attack_bash'] },
    thrown: { grants: ['throw_javelin'] },
    shield: { grants: ['block'] },
  },
  twoHandedGrants: ['block'],
  defaultAttack: 'attack_slash',   // every unit can attack with its hands; only used when its gear opens no attack of its own
});

export const WEAPON_TYPES = Object.freeze(Object.keys(DEFAULT_ACTION_RULES.types));
export const HAND_SOCKETS = Object.freeze(['weapon_socket_R', 'weapon_socket_L']);
/** Body points an item is carried on while it is NOT in a hand. They are plain joints of the unit (no meshes). */
export const STOW_SOCKETS = Object.freeze(['stow_back', 'stow_hip_R', 'stow_hip_L']);
export const EQUIPMENT_SOCKETS = Object.freeze([...HAND_SOCKETS, ...STOW_SOCKETS]);

export const rulesOf = (data) => data?.actionRules || DEFAULT_ACTION_RULES;

export const weaponTypeOf = (prefabDef) => (WEAPON_TYPES.includes(prefabDef?.weaponType) ? prefabDef.weaponType : null);
export const isTwoHanded = (prefabDef) => prefabDef?.twoHanded === true;

/**
 * LOADOUTS: a unit can switch between named sets of equipment (shield + sword  <->  spear, bow <-> knife ...).
 *   unit.equipment            = the main loadout (what every unit already has; nothing changes for old data)
 *   unit.loadouts[id].equipment = any additional loadout, same shape as `equipment`
 * Items that are not in a hand in a loadout are carried on a stow socket (back / hip), so the other weapon is visible on the body.
 */
export const MAIN_LOADOUT = 'main';
export function loadoutsOf(unitDef) {
  const out = [{ id: MAIN_LOADOUT, label: 'Main', equipment: unitDef?.equipment || {} }];
  for (const [id, l] of Object.entries(unitDef?.loadouts || {})) out.push({ id, label: l?.label || id, equipment: l?.equipment || {} });
  return out;
}
export const equipmentOf = (unitDef, loadoutId) => (!loadoutId || loadoutId === MAIN_LOADOUT ? (unitDef?.equipment || {}) : (unitDef?.loadouts?.[loadoutId]?.equipment || {}));
/** A unit shaped as if `loadoutId` were its only equipment: lets the single-loadout helpers below work per loadout. */
export const asLoadout = (unitDef, loadoutId) => ({ ...unitDef, equipment: equipmentOf(unitDef, loadoutId) });

const otherHand = (socket) => (socket === 'weapon_socket_R' ? 'weapon_socket_L' : 'weapon_socket_R');

/** Items currently in the unit's hands: [{ socket, id, def, type, twoHanded }] */
export function heldItems(data, unitDef) {
  const out = [];
  for (const socket of HAND_SOCKETS) {
    const id = unitDef?.equipment?.[socket]?.prefab;
    const def = id ? data?.prefabs?.[id] : null;
    if (def) out.push({ socket, id, def, type: weaponTypeOf(def), twoHanded: isTwoHanded(def) });
  }
  return out;
}

/** The hand that cannot hold anything because the other one holds a two-handed weapon (or null). */
export function lockedHand(_data, _unitDef) {
  return null;
}

/** Two one-handed weapons of the same melee type, one per hand. */
export function isDualWield(data, unitDef) {
  const held = heldItems(data, unitDef);
  return held.length === 2 && !held.some((h) => h.twoHanded) && held[0].type && held[0].type === held[1].type && held[0].type.startsWith('melee');
}

/**
 * Which actions does this unit have, and why?
 * Returns { actions: [base...] (ACTION order), why: { base: ['sword (melee_short)', ...] } }
 */
export function grantedActions(data, unitDef, actionOrder = [], { allLoadouts = false } = {}) {
  const rules = rulesOf(data);
  const why = {};
  const give = (action, reason) => { if (!(why[action] = why[action] || []).includes(reason)) why[action].push(reason); };
  for (const a of rules.always || []) give(a, 'everyone');
  const sets = allLoadouts ? loadoutsOf(unitDef).map((l) => asLoadout(unitDef, l.id)) : [unitDef];
  for (const u of sets) {
    for (const h of heldItems(data, u)) {
      for (const a of rules.types?.[h.type]?.grants || []) give(a, `${h.id} (${h.type})`);
      if (h.twoHanded) for (const a of rules.twoHandedGrants || []) give(a, `${h.id} (two-handed)`);
    }
  }
  const ATTACKS = ['attack_slash', 'attack_thrust', 'shoot_bow', 'throw_javelin', 'attack_bash'];
  const dflt = rules.defaultAttack === undefined ? DEFAULT_ACTION_RULES.defaultAttack : rules.defaultAttack;
  if (dflt && !Object.keys(why).some((a) => ATTACKS.includes(a))) give(dflt, 'default attack');
  if (allLoadouts && loadoutsOf(unitDef).length > 1) for (const a of rules.switchGrants || ['switch_weapon']) give(a, 'several loadouts');
  const keys = Object.keys(why);
  const actions = [...actionOrder.filter((a) => keys.includes(a)), ...keys.filter((a) => !actionOrder.includes(a))];
  return { actions, why };
}

/**
 * Where an item rests on the body when it is not in a hand, by weapon type (start values: the author can fine-tune with Fit).
 * `grip` = offset / rotation of the item inside the stow socket.
 */
export const STOW_DEFAULTS = Object.freeze({
  melee_short: { socket: 'stow_hip_R', gripOffset: [0.02, -0.12, 0.02], gripRotation: [3.1416, 0, 0.12] },
  melee_long: { socket: 'stow_back', gripOffset: [0.06, -0.3, -0.05], gripRotation: [3.1416, 0, 0.42] },
  bow: { socket: 'stow_back', gripOffset: [-0.04, 0.05, -0.03], gripRotation: [0, 0, 0.5] },
  thrown: { socket: 'stow_hip_L', gripOffset: [0, -0.06, 0.02], gripRotation: [3.1416, 0, -0.1] },
  shield: { socket: 'stow_back', gripOffset: [0, 0.08, -0.1], gripRotation: [0, 3.1416, 0] },
});

/** Items that always travel with a weapon type held in a hand (a bow brings its quiver, carried on the back). */
export const STOW_COMPANIONS = Object.freeze({ bow: 'quiver' });
const QUIVER_DEFAULT = { socket: 'quiver_back', gripOffset: [0, 0.02, -0.06], gripRotation: [0, 0, 0.18] };

/**
 * Work out what each loadout carries on its body (back / hips) and write it into the equipment as `auto: true` entries:
 *   - the weapons the OTHER loadout holds in its hands, and
 *   - the companion of a weapon in hand (bow -> quiver).
 * Auto entries that are no longer needed are removed; a position the author already fitted is kept; an entry that was
 * fitted by hand (no `auto`) is never touched. Returns the entries that are new: [{ loadout, socket, id }].
 */
/** Does the unit's body already have a mesh whose name matches (e.g. an archer's built-in quiver)? */
export function bodyHasMesh(unitDef, re) {
  const walk = (tree) => Object.values(tree || {}).some((n) => n && ((n.meshes || []).some((m) => re.test(m?.name || '')) || walk(n.children)));
  return walk(unitDef?.hierarchy) || walk(unitDef?.mountHierarchy);
}

export function restow(data, unitDef) {
  const added = [];
  const lds = loadoutsOf(unitDef);
  for (const l of lds) {
    const eq = l.equipment;
    const prev = {};
    for (const sk of [...STOW_SOCKETS, "quiver_back"]) if (eq[sk]?.auto) { prev[`${sk}|${eq[sk].prefab}`] = eq[sk]; delete eq[sk]; }
    // Migrate any old auto quiver on stow_back to quiver_back so stow_back is free for weapons!
    if (eq.stow_back && /^quiver/i.test(eq.stow_back.prefab || "")) {
      if (!eq.quiver_back) eq.quiver_back = { ...eq.stow_back };
      delete eq.stow_back;
    }
    const wanted = [];
    const isBowPrefab = (pid) => Boolean(pid && (weaponTypeOf(data?.prefabs?.[pid]) === "bow" || /^(?:bow|longbow|shortbow|crossbow)/i.test(pid)));
    const hasBowInHand = HAND_SOCKETS.some((hs) => isBowPrefab(eq[hs]?.prefab)) || lds.some((anyLd) => HAND_SOCKETS.some((hs) => isBowPrefab(anyLd.equipment?.[hs]?.prefab)));
    if (hasBowInHand) {
      const existingQuiver = eq.quiver_back?.prefab || "";
      if (!existingQuiver && data?.prefabs?.quiver) {
        eq.quiver_back = {
          prefab: "quiver",
          gripOffset: [...QUIVER_DEFAULT.gripOffset],
          gripRotation: [...QUIVER_DEFAULT.gripRotation],
          auto: true
        };
      }
    } else if (eq.quiver_back?.auto) {
      delete eq.quiver_back;
    }
    for (const o of lds) {
      if (o.id === l.id) continue;
      for (const hs of HAND_SOCKETS) {
        const id = o.equipment?.[hs]?.prefab, def = id && data?.prefabs?.[id];
        if (def) wanted.push({ id, d: STOW_DEFAULTS[weaponTypeOf(def)] || { socket: 'stow_back', gripOffset: [0, 0, 0], gripRotation: [0, 0, 0] } });
      }
    }
    const have = new Set(Object.values(eq).map((e) => e?.prefab).filter(Boolean));
    for (const w of wanted) {
      if (have.has(w.id)) continue;
      const socket = [w.d.socket, ...STOW_SOCKETS].find((sk) => !eq[sk]);
      if (!socket) continue;
      const old = prev[`${socket}|${w.id}`];
      eq[socket] = { prefab: w.id, gripOffset: [...(old?.gripOffset || w.d.gripOffset)], gripRotation: [...(old?.gripRotation || w.d.gripRotation)], auto: true };
      have.add(w.id);
      if (!old) added.push({ loadout: l.id, socket, id: w.id });
    }
  }
  return added;
}

/** Kept for older callers: re-stow everything, report what was added to `loadoutId`. */
export function autoStow(data, unitDef, loadoutId) {
  return restow(data, unitDef).filter((a) => a.loadout === (loadoutId || MAIN_LOADOUT));
}
