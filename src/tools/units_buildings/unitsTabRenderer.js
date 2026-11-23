import {
  renderUnitSlotPreviewInnerHtml,
  renderVisualIconPickerGridHtml,
  BUILT_IN_ICON_KEYS
} from '../../ui/hud/unitIconsCatalog.js';
import { computeCapabilitiesForLoadout } from '../../sim/combatCapabilitiesRegistry.js';
/**
 * Kings Lands — Warriors / Units Tab Renderer for Units & Buildings Lab
 * (src/tools/units_buildings/unitsTabRenderer.js)
 *
 * 100% English, concise labels (1-2 words per field) covering all 11 user fixes + deletion & copy UX:
 * - Fix 1 & Bottom Rule: Left panel has NO weapon selectors in the creation area —
 *   `+ New Unit` (creates a clean unit on the chosen Base Character: `human_base_1`, `human_base_2`, ...) and `⧉ Copy Unit` (duplicates the currently selected unit).
 * - Base Character: the new-unit bar has a base selector, and the Identity panel lets you move an existing unit onto another base of its race.
 * - Delete Combat Unit: Every combat unit (`!uStat.isWorker`) has a clear `Delete Unit` button.
 * - Fix 2: Formation toggle buttons (`Square ↔ Shield Wall`, `Square ↔ Wedge`, etc.) as single clean toggle buttons.
 * - Fix 3: `Vision Range (m)` (`visionRangeMeters`) per unit.
 * - Fix 4: Weapon Sets (`Set 1` / `Set 2`) ONLY hold Hand Weapons (`Right Hand`, `Left Hand`);
 *   Helmets, Chest Armor, Shoulders, Boots & Capes live in a separate **Visual Appearance** section.
 * - Fix 5: Mount Selection Dropdown (`None`, `Warhorse`, `Dire Wolf`, `War Chameleon`) that attaches/removes the 3D mount.
 * - Fix 6: No Hebrew name field (the Base Character selector replaces the old "no base model" rule).
 * - Fix 10: 100% English UI.
 * - Fix 11: Unit only defines `Squad Size`, `Pop Space`, and `Costs` (`Coins`, `Wood`, `Stone`, `Iron`).
 */

import { MAIN_LOADOUT, loadoutsOf } from '../studio/weaponRules.js';
import {
  MOUNT_TYPES,
  BASE_CHARACTER_TEMPLATES,
  computeEligibleFormationsForUnit
} from './unitsBuildingsStateManager.js';
import { DEFAULT_BASE_CHAR_ID } from '../studio/baseUnitsMigration.js';

export const ALL_HAND_EQUIPMENT_OPTIONS = Object.freeze([
  { id: 'none', label: 'None (Empty)' },
  { id: 'sword', label: 'Sword' },
  { id: 'spear', label: 'Spear' },
  { id: 'pike', label: 'Long Pike' },
  { id: 'bow', label: 'Bow' },
  { id: 'crossbow', label: 'Crossbow' },
  { id: 'javelin', label: 'Javelin' },
  { id: 'worker_hammer', label: 'Builder Hammer' },
  { id: 'ballista_crossbow', label: 'Ballista Bow' },
  { id: 'ravan_prince_sword', label: 'Prince Sword' },
  { id: 'king_sovereign_sword', label: 'Sovereign Sword' },
  { id: 'sisnat_double_axe', label: 'Heavy Double Axe' },
  { id: 'wizard_staff', label: 'Arcane Staff' },
  { id: 'shield', label: 'Infantry Shield' },
  { id: 'tower_shield', label: 'Tower Shield' },
  { id: 'kite_shield', label: 'Cavalry Kite Shield' },
  { id: 'round_buckler', label: 'Round Buckler' },
  { id: 'royal_crest_shield', label: 'Royal Crest Shield' },
  { id: 'wizard_tome', label: 'Spell Tome' }
]);

export const WEAPON_R_OPTIONS = ALL_HAND_EQUIPMENT_OPTIONS;
export const WEAPON_L_OPTIONS = ALL_HAND_EQUIPMENT_OPTIONS;

export const BUILTIN_UNIT_ICON_OPTIONS = Object.freeze([
  { id: 'auto', label: 'Auto (By Role)' },
  { id: 'swordsman', label: '⚔️ Sword' },
  { id: 'spearman', label: '🔱 Spear' },
  { id: 'archer', label: '🏹 Bow & Arrow' },
  { id: 'cavalry', label: '🐎 Horseshoe' },
  { id: 'worker', label: '🔨 Hammer' },
  { id: 'ballista', label: '🎯 Ballista' },
  { id: 'hero', label: '👑 Royal Crown' }
]);

export const APPEARANCE_HEAD_OPTIONS = Object.freeze([
  { id: 'none', label: 'None (Bare Head)' },
  { id: 'human_peasant_coif', label: 'Peasant Coif' },
  { id: 'human_ranger_hood', label: 'Ranger Hood' },
  { id: 'human_kettle_helm', label: 'Iron Kettle Helm' },
  { id: 'human_knight_helm', label: 'Knight Visor Helm' },
  { id: 'human_royal_plumed_helm', label: 'Royal Plumed Helm' },
  { id: 'helmet_iron', label: 'Classic Iron Helm' },
  { id: 'helmet_leather', label: 'Leather Cap' },
  { id: 'hood', label: 'Cloth Hood' },
  { id: 'king_engraved_crown', label: 'Royal Crown' },
  { id: 'sisnat_war_helm', label: 'Commander War Helm' },
  { id: 'wizard_hat', label: 'Wizard Hat' },
  { id: 'katiler_war_helm', label: 'Katiler War Helm' }
]);

export const APPEARANCE_CHEST_OPTIONS = Object.freeze([
  { id: 'none', label: 'None' },
  { id: 'human_worn_tunic', label: 'Cloth Tunic' },
  { id: 'human_leather_brigandine', label: 'Leather Brigandine' },
  { id: 'human_chainmail_surcoat', label: 'Chainmail Surcoat' },
  { id: 'human_plate_cuirass', label: 'Steel Plate Cuirass' },
  { id: 'human_cavalry_cuirass', label: 'Cavalry Cuirass' },
  { id: 'surcoat', label: 'Heraldic Surcoat' },
  { id: 'sisnat_chest_armor', label: 'Heavy Commander Plate' },
  { id: 'katiler_heavy_cuirass', label: 'Katiler Heavy Cuirass' }
]);

export const APPEARANCE_CAPE_OPTIONS = Object.freeze([
  { id: 'none', label: 'None' },
  { id: 'cape_royal', label: 'Royal Cape' },
  { id: 'cape_ranger_cloak', label: 'Ranger Cloak' },
  { id: 'cape_commander_fur', label: 'Commander Fur Mantle' }
]);

export const APPEARANCE_SHOULDER_OPTIONS = Object.freeze([
  { id: 'none', label: 'None' },
  { id: 'human_tunic_sleeve', label: 'Cloth Sleeves' },
  { id: 'human_leather_pauldron', label: 'Leather Pauldrons' },
  { id: 'human_steel_pauldron', label: 'Steel Pauldrons' }
]);

export const APPEARANCE_BOOT_OPTIONS = Object.freeze([
  { id: 'none', label: 'None' },
  { id: 'human_worn_shoes', label: 'Simple Shoes' },
  { id: 'human_leather_boots', label: 'Leather Boots' },
  { id: 'human_metal_boots', label: 'Steel Greave Boots' }
]);

export const APPEARANCE_MOUNT_ARMOR_OPTIONS = Object.freeze([
  { id: 'none', label: 'Unarmored Mount' },
  { id: 'horse_war_saddle', label: 'War Saddle' },
  { id: 'horse_plate_barding', label: 'Horse Plate Barding' },
  { id: 'cavalry_plate_barding', label: 'Royal Swan Barding' }
]);

function numInput(id, label, value, step = 1, min = 0, max = 99999) {
  return `
    <label class="flex flex-col gap-0.5">
      <span class="text-[10px] font-semibold text-slate-400 truncate">${label}</span>
      <input
        type="number"
        data-unit-field="${id}"
        value="${value ?? 0}"
        step="${step}"
        min="${min}"
        max="${max}"
        class="w-full rounded bg-slate-900 border border-slate-700 focus:border-amber-400 px-2 py-1 text-xs font-bold text-slate-100 mono outline-none"
      />
    </label>
  `;
}

function selectOptionsHtml(list, currentVal) {
  const cur = currentVal || 'none';
  return list
    .map((item) => `<option value="${item.id}" ${item.id === cur ? 'selected' : ''}>${item.label}</option>`)
    .join('');
}

export function renderUnitsLeftListHtml(stateManager, selectedUnitId) {
  const units = stateManager.unitStatsData.units || {};
  const selectedUnit = units[selectedUnitId];
  const totalCount = Object.keys(units).length;
  const canDeleteSelected = Boolean(
    selectedUnit && !selectedUnit.isWorker && selectedUnitId !== 'worker' && totalCount > 1
  );

  const rows = Object.values(units)
    .map((u) => {
      const active = u.id === selectedUnitId;
      const canDelRow = !u.isWorker && u.id !== 'worker' && totalCount > 1;
      const badge = u.isWorker
        ? '🔨'
        : u.isSiege
          ? '🎯'
          : u.isMounted
            ? '🐎'
            : u.isRanged
              ? '🏹'
              : '⚔️';
      const thumbHtml = u.recruitPortraitUrl
        ? `<img src="${u.recruitPortraitUrl}" alt="" class="w-6 h-6 rounded-full object-cover border border-amber-400/60 shrink-0" />`
        : `<span class="text-sm shrink-0">${badge}</span>`;
      return `
        <div
          class="w-full flex items-center justify-between gap-1.5 rounded-xl border px-2.5 py-1.5 text-left transition ${
            active
              ? 'border-amber-400 bg-amber-500/20 text-amber-200 font-black shadow'
              : 'border-slate-800 bg-slate-900/70 hover:bg-slate-800 text-slate-200 font-semibold'
          }"
        >
          <button
            type="button"
            data-select-unit="${u.id}"
            class="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
          >
            ${thumbHtml}
            <div class="flex-1 min-w-0 text-left">
              <div class="text-xs truncate">${u.name || u.id}</div>
              <div class="text-[10px] text-slate-400 mono truncate">${u.id}</div>
            </div>
          </button>
          ${
            canDelRow
              ? `<button type="button" data-delete-unit-row="${u.id}" title="Delete ${u.name || u.id}" class="rounded-md bg-rose-950/80 hover:bg-rose-700 border border-rose-500/40 px-1.5 py-1 text-[10px] font-bold text-rose-200 cursor-pointer shrink-0 transition">🗑</button>`
              : ''
          }
        </div>
      `;
    })
    .join('');

  return `
    <div class="flex flex-col gap-1.5 flex-1 overflow-y-auto pr-0.5">
      ${rows}
    </div>

    <!-- Clean Unit Creation / Copy / Delete Bar -->
    <div class="rounded-xl border border-slate-800 bg-slate-950/90 p-2 flex flex-col gap-1.5 mt-2">
      <label class="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
        <span class="shrink-0">Base</span>
        <select id="ub-new-unit-base" class="flex-1 min-w-0 rounded bg-slate-900 border border-slate-700 px-1.5 py-1 text-[11px] font-bold text-amber-200" title="The base character the NEW unit is built on">
          ${BASE_CHARACTER_TEMPLATES.map((b) => `<option value="${b.id}" ${b.id === (stateManager.newUnitBaseId || DEFAULT_BASE_CHAR_ID) ? 'selected' : ''}>${b.label}</option>`).join('')}
        </select>
      </label>
      <button
        type="button"
        id="ub-btn-create-unit"
        class="w-full rounded-lg border border-dashed border-amber-400/80 bg-amber-500/15 hover:bg-amber-500/25 py-1.5 px-2 text-xs font-extrabold text-amber-300 transition cursor-pointer"
        title="Create a new unit starting from the base character chosen above"
      >
        + New Unit
      </button>
      <button
        type="button"
        id="ub-btn-duplicate-unit"
        class="w-full rounded-lg border border-sky-400/70 bg-sky-500/15 hover:bg-sky-500/25 py-1.5 px-2 text-xs font-extrabold text-sky-300 transition cursor-pointer truncate"
        title="Copy the currently selected unit (${selectedUnit?.name || selectedUnitId}) with all its weapons, mount & stats"
      >
        ⧉ Copy "${selectedUnit?.name || selectedUnitId}"
      </button>
      ${
        canDeleteSelected
          ? `<button
              type="button"
              id="ub-btn-delete-unit-left"
              class="w-full rounded-lg border border-rose-500/70 bg-rose-950/80 hover:bg-rose-800 py-1.5 px-2 text-xs font-extrabold text-rose-200 transition cursor-pointer truncate"
              title="Delete ${selectedUnit?.name || selectedUnitId}"
            >
              🗑 Delete "${selectedUnit?.name || selectedUnitId}"
            </button>`
          : ''
      }
    </div>
  `;
}

export function renderUnitRightInspectorHtml(stateManager, unitId, activeLoadoutId = MAIN_LOADOUT) {
  const unitsMap = stateManager.unitStatsData.units || {};
  const uStat = unitsMap[unitId];
  if (!uStat) return `<div class="p-4 text-xs text-slate-400">Select a unit from the list.</div>`;

  const uVis = stateManager.unitsVisualsData.units?.[unitId] || {};
  const baseEq = uVis.equipment || {};
  const lds = loadoutsOf(uVis);
  const currentLd = lds.find((l) => l.id === activeLoadoutId) || lds[0];
  const ldEq = currentLd?.equipment || {};

  // Fix 4: Weapon Sets ONLY contain Hand Weapons (`weapon_socket_R`, `weapon_socket_L`).
  const curWeaponR = ldEq.weapon_socket_R?.prefab || 'none';
  const curWeaponL = ldEq.weapon_socket_L?.prefab || 'none';

  // Fix 4: Visual Appearance (Helmet, Chest, Shoulders, Boots, Cape, Mount Armor) is cosmetic only!
  const curHead = baseEq.head?.prefab || 'none';
  const curTorso = baseEq.torso?.prefab || 'none';
  const curCape = baseEq.cape_back?.prefab || 'none';
  const curShoulder = baseEq.arm_R?.prefab ? baseEq.arm_R.prefab.replace(/_R$/, '') : 'none';
  const curBoots = baseEq.foot_R?.prefab ? baseEq.foot_R.prefab.replace(/_R$/, '') : 'none';
  const curMountArmor = baseEq.mount_torso?.prefab || 'none';

  const curMountType = uStat.mountType || (uStat.isMounted ? 'human_horse' : 'none');
  const baseChoices = stateManager.listBasesForUnit(unitId);
  const curBaseId = stateManager.getUnitBaseId(unitId);

  const activeLdCaps = computeCapabilitiesForLoadout(
    uStat,
    uVis,
    stateManager.unitsVisualsData,
    currentLd.id
  );
  const toggleableFormations = activeLdCaps.formations.filter((f) => f.id !== 'square');
  const combatModesList = activeLdCaps.modes;
  const activeSetLabel = currentLd.id === MAIN_LOADOUT ? 'Set 1' : 'Set 2';

  const bs = uStat.blacksmithBonuses || {
    forged_blades: 20,
    heavy_plate: 20,
    bodkin_arrows: uStat.isRanged ? 25 : 0,
    barding: uStat.isMounted ? 25 : 0
  };

  const wg = uStat.workerGathering || {
    carryCapacity: 45,
    batchYield: 15,
    enterDoorOnDropoff: true,
    doorInsideStayTicks: 8,
    harvestTimeSecByResource: { wood: 3.5, stone: 4.8, iron: 5.5, coins: 5.0 }
  };

  // Every combat unit can be deleted (keep only the builder worker or if only 1 unit remains)
  const canDelete = !uStat.isWorker && unitId !== 'worker' && Object.keys(unitsMap).length > 1;

  return `
    <div class="flex flex-col gap-3 p-3 text-left" dir="ltr">
      <!-- Fix 5 & Fix 6: Unit Name & Mount Dropdown (No Base Model Dropdown, No Hebrew Name) + Delete Button -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-black text-amber-400">Identity & Mount</span>
          ${
            canDelete
              ? `<button type="button" id="ub-btn-delete-unit" class="rounded-lg bg-rose-950 hover:bg-rose-800 border border-rose-500/60 px-2.5 py-1 text-[10px] font-extrabold text-rose-200 cursor-pointer transition">🗑 Delete Unit</button>`
              : ''
          }
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold text-slate-400">Unit Name</span>
            <input type="text" data-unit-str="name" value="${uStat.name || unitId}" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-slate-100" />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold text-slate-400">Mount</span>
            <select id="ub-unit-mount-select" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-amber-200">
              ${MOUNT_TYPES.map((m) => `<option value="${m.id}" ${m.id === curMountType ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
          </label>
          <label class="flex flex-col gap-0.5 col-span-2">
            <span class="text-[10px] font-semibold text-slate-400">Base Character</span>
            <select id="ub-unit-base-select" ${baseChoices.length > 1 ? '' : 'disabled'} class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-amber-200 ${baseChoices.length > 1 ? '' : 'opacity-60'}" title="The body this unit is built on. Switching replaces the body only — gear, weapons, stats, mount and animations are kept.">
              ${
                baseChoices.length
                  ? baseChoices.map((b) => `<option value="${b.id}" ${b.current ? 'selected' : ''}>${b.label}</option>`).join('')
                  : `<option value="">${curBaseId} (fixed)</option>`
              }
            </select>
          </label>
        </div>
      </div>

      <!-- Fix 4: Weapon Sets (ONLY Hand Weapons — No Helmets or Armor in Sets!) -->
      <div class="rounded-xl border border-sky-500/40 bg-slate-950/75 p-2.5 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-1">
          <span class="text-xs font-black text-sky-300">Weapon Sets (Hands Only)</span>
          <div class="flex items-center gap-1">
            ${lds
              .map(
                (l, idx) => `
              <button type="button" data-unit-loadout="${l.id}" class="rounded px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                l.id === currentLd.id ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }">Set ${idx + 1}</button>
            `
              )
              .join('')}
            ${
              lds.length < 2
                ? `<button type="button" id="ub-btn-add-loadout" class="rounded border border-sky-400/50 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-300 cursor-pointer">+ Set 2</button>`
                : `<button type="button" id="ub-btn-del-loadout" class="rounded border border-rose-400/50 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 cursor-pointer">✕ Set 2</button>`
            }
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold text-slate-400">Right Hand</span>
            <select data-unit-weapon="weapon_socket_R" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-semibold text-amber-200">
              ${selectOptionsHtml(WEAPON_R_OPTIONS, curWeaponR)}
            </select>
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold text-slate-400">Left Hand / Shield</span>
            <select data-unit-weapon="weapon_socket_L" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-semibold text-amber-200">
              ${selectOptionsHtml(WEAPON_L_OPTIONS, curWeaponL)}
            </select>
          </label>
        </div>
      </div>

      <!-- Fix 4: Visual Appearance (Cosmetic Helmet, Armor, Shoulders, Boots, Cape) -->
      <div class="rounded-xl border border-violet-500/40 bg-slate-950/75 p-2.5 flex flex-col gap-2">
        <span class="text-xs font-black text-violet-300">Visual Appearance (Cosmetic)</span>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold text-slate-400">Helmet / Head</span>
            <select data-unit-appearance="head" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200">
              ${selectOptionsHtml(APPEARANCE_HEAD_OPTIONS, curHead)}
            </select>
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold text-slate-400">Chest Armor</span>
            <select data-unit-appearance="torso" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200">
              ${selectOptionsHtml(APPEARANCE_CHEST_OPTIONS, curTorso)}
            </select>
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold text-slate-400">Shoulders</span>
            <select data-unit-appearance-pair="shoulder" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200">
              ${selectOptionsHtml(APPEARANCE_SHOULDER_OPTIONS, curShoulder)}
            </select>
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold text-slate-400">Boots</span>
            <select data-unit-appearance-pair="boots" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200">
              ${selectOptionsHtml(APPEARANCE_BOOT_OPTIONS, curBoots)}
            </select>
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] font-semibold text-slate-400">Cape / Cloak</span>
            <select data-unit-appearance="cape_back" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200">
              ${selectOptionsHtml(APPEARANCE_CAPE_OPTIONS, curCape)}
            </select>
          </label>
          ${
            curMountType !== 'none'
              ? `
            <label class="flex flex-col gap-0.5">
              <span class="text-[10px] font-semibold text-slate-400">Mount Barding</span>
              <select data-unit-appearance="mount_torso" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200">
                ${selectOptionsHtml(APPEARANCE_MOUNT_ARMOR_OPTIONS, curMountArmor)}
              </select>
            </label>
          `
              : ''
          }
        </div>
      </div>

      <!-- Three Separate Unit Icon / Portrait Cells (1: Building Recruit, 2: Multi-Squad Bar, 3: In-Game Placeholder Symbol) -->
      <div class="rounded-xl border border-amber-500/40 bg-slate-950/75 p-2.5 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-1.5 flex-wrap">
          <span class="text-xs font-black text-amber-300">Unit Portraits, Icons &amp; Default Icon Library</span>
          <div class="flex items-center gap-1">
            <button type="button" id="ub-btn-add-default-library-icon" class="rounded-lg bg-emerald-500 hover:bg-emerald-400 px-2 py-1 text-[10px] font-black text-slate-950 shadow cursor-pointer transition" title="Add a custom icon image to the shared Default Icon Library for all 3 slots">+ Add Icon to Library</button>
            <input id="ub-input-add-default-library-icon" type="file" accept="image/*" class="hidden" />
            <button type="button" id="ub-btn-pose-capture-studio" class="rounded-lg bg-amber-500 hover:bg-amber-400 px-2 py-1 text-[10px] font-black text-slate-950 shadow cursor-pointer transition" title="Open Animation Lab on the 📸 Icons tab so you can pose the unit on any frame before capturing!">
              🎬 Pose &amp; Capture
            </button>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <!-- Cell 1: Building Recruitment Icon / Portrait -->
          <div class="rounded-lg border border-slate-800 bg-slate-900/90 p-1.5 flex flex-col items-center gap-1">
            <span class="text-[9.5px] font-bold text-amber-200 text-center truncate w-full">🏰 Building Recruit</span>
            <div class="w-12 h-12 rounded-full border-2 border-amber-400/80 bg-slate-950 overflow-hidden flex items-center justify-center shadow-inner">
              ${renderUnitSlotPreviewInnerHtml(uStat, 'recruit', stateManager.unitStatsData.customPlaceholderIcons || [], uStat.id)}
            </div>
            <div class="w-full">
              ${renderVisualIconPickerGridHtml('recruit', uStat.recruitIconKey || 'auto', uStat, stateManager.unitStatsData.customPlaceholderIcons || [], uStat.id, 'data-ub-pick-icon')}
            </div>
            <select id="ub-select-recruit-icon" class="hidden">
              ${BUILTIN_UNIT_ICON_OPTIONS.map((o) => `<option value="${o.id}" ${(uStat.recruitIconKey || 'auto') === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
              ${(stateManager.unitStatsData.customPlaceholderIcons || []).map((ci) => `<option value="${ci.id}" ${uStat.recruitIconKey === ci.id ? 'selected' : ''}>⭐ ${ci.label}</option>`).join('')}
            </select>
            <div class="flex items-center justify-center gap-1 w-full">
              <button type="button" id="ub-btn-capture-recruit-portrait" class="flex-1 rounded bg-amber-500 hover:bg-amber-400 px-1 py-0.5 text-[9px] font-black text-slate-950 cursor-pointer" title="Capture Live 3D View">📸 3D</button>
              <button type="button" id="ub-btn-upload-recruit-portrait" class="flex-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 px-1 py-0.5 text-[9px] font-bold text-slate-200 cursor-pointer" title="Upload Image">📁</button>
              ${
                uStat.recruitPortraitUrl
                  ? `<button type="button" id="ub-btn-clear-recruit-portrait" class="rounded bg-rose-950 hover:bg-rose-800 px-1 py-0.5 text-[9px] font-bold text-rose-300 cursor-pointer" title="Use Default Icon">✕</button>`
                  : ''
              }
              <input id="ub-input-upload-recruit-portrait" type="file" accept="image/*" class="hidden" />
            </div>
          </div>

          <!-- Cell 2: Multi-Squad Selection Bar Icon / Portrait -->
          <div class="rounded-lg border border-slate-800 bg-slate-900/90 p-1.5 flex flex-col items-center gap-1">
            <span class="text-[9.5px] font-bold text-sky-200 text-center truncate w-full">🛡️ Multi-Squad Bar</span>
            <div class="w-12 h-12 rounded-xl border-2 border-sky-400/80 bg-slate-950 overflow-hidden flex items-center justify-center shadow-inner">
              ${renderUnitSlotPreviewInnerHtml(uStat, 'squad', stateManager.unitStatsData.customPlaceholderIcons || [], uStat.id)}
            </div>
            <div class="w-full">
              ${renderVisualIconPickerGridHtml('squad', uStat.squadCardIconKey || 'auto', uStat, stateManager.unitStatsData.customPlaceholderIcons || [], uStat.id, 'data-ub-pick-icon')}
            </div>
            <select id="ub-select-squad-icon" class="hidden">
              ${BUILTIN_UNIT_ICON_OPTIONS.map((o) => `<option value="${o.id}" ${(uStat.squadCardIconKey || 'auto') === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
              ${(stateManager.unitStatsData.customPlaceholderIcons || []).map((ci) => `<option value="${ci.id}" ${uStat.squadCardIconKey === ci.id ? 'selected' : ''}>⭐ ${ci.label}</option>`).join('')}
            </select>
            <div class="flex items-center justify-center gap-1 w-full">
              <button type="button" id="ub-btn-capture-squad-icon" class="flex-1 rounded bg-sky-500 hover:bg-sky-400 px-1 py-0.5 text-[9px] font-black text-slate-950 cursor-pointer" title="Capture Live 3D View">📸 3D</button>
              <button type="button" id="ub-btn-upload-squad-icon" class="flex-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 px-1 py-0.5 text-[9px] font-bold text-slate-200 cursor-pointer" title="Upload Image">📁</button>
              ${
                uStat.squadCardIconUrl
                  ? `<button type="button" id="ub-btn-clear-squad-icon" class="rounded bg-rose-950 hover:bg-rose-800 px-1 py-0.5 text-[9px] font-bold text-rose-300 cursor-pointer" title="Use Default Icon">✕</button>`
                  : ''
              }
              <input id="ub-input-upload-squad-icon" type="file" accept="image/*" class="hidden" />
            </div>
          </div>

          <!-- Cell 3: In-Game Ground Placeholder & Banner Symbol (Per Active Weapon Set!) -->
          <div class="rounded-lg border border-slate-800 bg-slate-900/90 p-1.5 flex flex-col items-center gap-1">
            <span class="text-[9.5px] font-bold text-emerald-200 text-center truncate w-full" title="Map placement &amp; flag icon for ${activeSetLabel}">🚩 Map (${activeLoadoutId === MAIN_LOADOUT ? 'Set 1' : 'Set 2'})</span>
            <div class="w-12 h-12 rounded-full border-2 border-emerald-400/80 bg-slate-950 overflow-hidden flex items-center justify-center shadow-inner">
              ${renderUnitSlotPreviewInnerHtml({ ...uStat, _activeWeaponTypes: activeLdCaps.weaponTypes }, activeLoadoutId === MAIN_LOADOUT ? 'placeholder' : 'placeholder_set2', stateManager.unitStatsData.customPlaceholderIcons || [], uStat.id)}
            </div>
            <div class="w-full">
              ${renderVisualIconPickerGridHtml('placeholder', (activeLoadoutId === MAIN_LOADOUT ? uStat.placeholderIconKey : uStat.placeholderIconKeySet2) || 'auto', { ...uStat, _activeWeaponTypes: activeLdCaps.weaponTypes }, stateManager.unitStatsData.customPlaceholderIcons || [], uStat.id, 'data-ub-pick-icon')}
            </div>
            <select id="ub-select-placeholder-icon" class="hidden">
              ${BUILTIN_UNIT_ICON_OPTIONS.map((o) => `<option value="${o.id}" ${(uStat.placeholderIconKey || 'auto') === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
              ${(stateManager.unitStatsData.customPlaceholderIcons || []).map((ci) => `<option value="${ci.id}" ${uStat.placeholderIconKey === ci.id ? 'selected' : ''}>⭐ ${ci.label}</option>`).join('')}
            </select>
            <div class="flex items-center justify-center gap-1 w-full">
              <button type="button" id="ub-btn-upload-placeholder-icon" class="w-full rounded bg-emerald-600 hover:bg-emerald-500 px-1.5 py-0.5 text-[9px] font-black text-slate-950 cursor-pointer" title="Upload a new custom symbol to the Default Icon Library">📁 + Add Icon</button>
              <input id="ub-input-upload-placeholder-icon" type="file" accept="image/*" class="hidden" />
            </div>
          </div>
        </div>
      </div>

            <!-- Fix 2 & Dynamic Stances: Formations & Combat Modes synced to Active Weapon Set (${activeSetLabel}) -->
      <div class="rounded-xl border border-emerald-500/40 bg-slate-950/75 p-2.5 flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-black text-emerald-300">Formations (${activeSetLabel} • Base: Square)</span>
          <span class="text-[10px] font-bold text-slate-400">Synced to ${activeSetLabel}</span>
        </div>
        <div class="grid grid-cols-1 gap-1.5">
          ${toggleableFormations
            .map(
              (f) => `
            <button
              type="button"
              data-unit-formation-toggle="${f.id}"
              class="w-full flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left transition cursor-pointer ${
                f.enabled
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200 font-extrabold shadow'
                  : f.eligible
                    ? 'border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-800 bg-slate-950/60 text-slate-500 hover:bg-slate-900'
              }"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-xs truncate">${f.toggleLabel}</span>
                ${f.eligible ? `<span class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] text-emerald-300">Weapon Match</span>` : ''}
              </div>
              <span class="rounded px-2 py-0.5 text-[10px] font-black ${
                f.enabled ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-400'
              }">${f.enabled ? 'ON' : 'OFF'}</span>
            </button>
          `
            )
            .join('')}
        </div>

        <div class="border-t border-slate-800 pt-2 mt-1 flex items-center justify-between">
          <span class="text-xs font-black text-sky-300">Combat Modes & Stances (${activeSetLabel})</span>
          <span class="text-[10px] font-bold text-slate-400">HUD & Sim Synced</span>
        </div>
        <div class="grid grid-cols-1 gap-1.5">
          ${combatModesList
            .map(
              (m) => `
            <button
              type="button"
              data-unit-mode-toggle="${m.id}"
              title="${m.description}"
              class="w-full flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-left transition cursor-pointer ${
                m.enabled
                  ? 'border-sky-400 bg-sky-500/20 text-sky-200 font-extrabold shadow'
                  : m.eligible
                    ? 'border-slate-700 bg-slate-900/90 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-800 bg-slate-950/60 text-slate-500 hover:bg-slate-900'
              }"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-xs truncate">${m.icon} ${m.labelEn}</span>
                ${m.eligible ? `<span class="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] text-sky-300">Weapon Match</span>` : ''}
              </div>
              <span class="rounded px-2 py-0.5 text-[10px] font-black ${
                m.enabled ? 'bg-sky-400 text-slate-950' : 'bg-slate-800 text-slate-400'
              }">${m.enabled ? 'ON' : 'OFF'}</span>
            </button>
          `
            )
            .join('')}
        </div>
      </div>

      <!-- Fix 11: Unit Squad Size, Pop Space & Intrinsic Costs ONLY -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 flex flex-col gap-2">
        <span class="text-xs font-black text-amber-400">Squad Size & Resource Cost</span>
        <div class="grid grid-cols-2 gap-2">
          ${numInput('squadSize', 'Squad Size', uStat.squadSize ?? 20, 1, 1, 60)}
          ${numInput('popCost', 'Pop Space', uStat.popCost ?? 20, 1, 1, 60)}
        </div>
        <div class="grid grid-cols-4 gap-1.5 pt-1">
          ${numInput('cost.coins', '🪙 Coins', uStat.cost?.coins ?? 150, 10, 0, 5000)}
          ${numInput('cost.wood', '🪵 Wood', uStat.cost?.wood ?? 0, 10, 0, 5000)}
          ${numInput('cost.stone', '🪨 Stone', uStat.cost?.stone ?? 0, 10, 0, 5000)}
          ${numInput('cost.iron', '⛓️ Iron', uStat.cost?.iron ?? 0, 10, 0, 5000)}
        </div>
      </div>

      <!-- Fix 3: Mobility, Vision Range & Combat Stats -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 flex flex-col gap-2">
        <span class="text-xs font-black text-amber-400">Vision, Mobility & Combat</span>
        <div class="grid grid-cols-3 gap-2">
          ${numInput('visionRangeMeters', '👁️ Vision (m)', uStat.visionRangeMeters ?? 96, 2, 16, 260)}
          ${numInput('hp', 'HP', uStat.hp ?? 135, 5, 10, 5000)}
          ${numInput('mass', 'Mass', uStat.mass ?? 90, 5, 20, 2000)}
          ${numInput('speedMetersPerSec', 'Speed (m/s)', uStat.speedMetersPerSec ?? 4.2, 0.1, 1.0, 15.0)}
          ${numInput('runSpeedMultPermille', 'Run Mult (‰)', uStat.runSpeedMultPermille ?? 1450, 25, 1000, 2500)}
          ${numInput('staminaRunDrainPerTick', 'Stamina Drain', uStat.staminaRunDrainPerTick ?? 2, 1, 0, 20)}
          ${numInput('radiusMeters', 'Radius (m)', uStat.radiusMeters ?? 0.57, 0.05, 0.25, 2.5)}
          ${numInput('meleeDamage', 'Melee Dmg', uStat.meleeDamage ?? 15, 1, 0, 500)}
          ${numInput('meleeAttackRangeMeters', 'Melee Range', uStat.meleeAttackRangeMeters ?? 2.0, 0.1, 0.5, 8.0)}
          ${numInput('vsBuildingDamage', 'Siege Dmg', uStat.vsBuildingDamage ?? 10, 1, 0, 1000)}
          ${numInput('armor', 'Armor', uStat.armor ?? 10, 1, 0, 95)}
          ${numInput('meleeBlockRating', 'Melee Block', uStat.meleeBlockRating ?? 35, 5, 0, 100)}
          ${numInput('missileBlockRating', 'Arrow Block', uStat.missileBlockRating ?? 35, 5, 0, 100)}
          ${numInput('windupTicks', 'Windup (t)', uStat.windupTicks ?? 6, 1, 1, 60)}
          ${numInput('reloadMinTicks', 'Reload Min', uStat.reloadMinTicks ?? 14, 1, 2, 200)}
          ${numInput('reloadMaxTicks', 'Reload Max', uStat.reloadMaxTicks ?? 22, 1, 2, 240)}
          ${numInput('bracingPermille', 'Bracing (‰)', uStat.bracingPermille ?? 1000, 100, 0, 6000)}
          ${numInput('antiChargePermille', 'Anti-Charge', uStat.antiChargePermille ?? 0, 100, 0, 6000)}
          ${numInput('chargeBonusDamage', 'Charge Bonus', uStat.chargeBonusDamage ?? 8, 2, 0, 300)}
        </div>
      </div>

      <!-- Ranged Parameters -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-black text-amber-400">Ranged & Ammo</span>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" data-unit-bool="isRanged" ${uStat.isRanged ? 'checked' : ''} class="accent-amber-400" />
            <span class="text-[11px] font-bold text-slate-300">Ranged Unit</span>
          </label>
        </div>
        <div class="grid grid-cols-3 gap-2">
          ${numInput('rangedDamage', 'Ranged Dmg', uStat.rangedDamage ?? 0, 1, 0, 500)}
          ${numInput('attackRangeMeters', 'Fire Range (m)', uStat.attackRangeMeters ?? 2.0, 1, 1, 250)}
          ${numInput('maxAmmo', 'Max Ammo', uStat.maxAmmo ?? 0, 2, 0, 200)}
          ${numInput('accuracy', 'Accuracy (%)', uStat.accuracy ?? 78, 2, 10, 100)}
          ${numInput('scatterRadiusMeters', 'Scatter (m)', uStat.scatterRadiusMeters ?? 1.2, 0.1, 0, 10)}
        </div>
      </div>

      <!-- Enhancement 1: Blacksmith Upgrade Bonuses (%) per Unit -->
      <div class="rounded-xl border border-amber-500/35 bg-slate-950/75 p-2.5 flex flex-col gap-2">
        <span class="text-xs font-black text-amber-300">⚒️ Blacksmith Upgrade Bonuses (%)</span>
        <div class="grid grid-cols-4 gap-1.5">
          ${numInput('blacksmithBonuses.forged_blades', 'Blades %', bs.forged_blades ?? 20, 5, 0, 200)}
          ${numInput('blacksmithBonuses.heavy_plate', 'Plate %', bs.heavy_plate ?? 20, 5, 0, 200)}
          ${numInput('blacksmithBonuses.bodkin_arrows', 'Arrows %', bs.bodkin_arrows ?? 0, 5, 0, 200)}
          ${numInput('blacksmithBonuses.barding', 'Barding %', bs.barding ?? 0, 5, 0, 200)}
        </div>
      </div>

      <!-- Worker Resource Gathering & Doorway Entry -->
      ${
        uStat.isWorker || unitId === 'worker'
          ? `
        <div class="rounded-xl border border-amber-400/50 bg-amber-500/10 p-2.5 flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-black text-amber-300">Worker Gathering & Door Entry</span>
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" data-worker-bool="enterDoorOnDropoff" ${wg.enterDoorOnDropoff !== false ? 'checked' : ''} class="accent-amber-400" />
              <span class="text-[10px] font-bold text-amber-200">Enter Door on Drop-off</span>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            ${numInput('workerGathering.carryCapacity', 'Carry Capacity (Max)', wg.carryCapacity ?? 45, 5, 5, 300)}
            ${numInput('workerGathering.batchYield', 'Batch Yield', wg.batchYield ?? 15, 5, 1, 100)}
          </div>
          <div class="text-[10px] font-bold text-amber-200 pt-1">Allowed Resources to Gather:</div>
          <div class="grid grid-cols-4 gap-1.5">
            ${[
              ['wood', '🪵 Wood'],
              ['stone', '🪨 Stone'],
              ['iron', '⛓️ Iron'],
              ['coins', '🪙 Gold']
            ]
              .map(([resKey, resLabel]) => {
                const enabled = wg.allowedResources?.[resKey] !== false;
                return `
                  <label class="flex items-center justify-center gap-1 rounded-lg border ${enabled ? 'border-amber-400/70 bg-amber-500/20 text-amber-100' : 'border-slate-700 bg-slate-900/60 text-slate-500'} px-1.5 py-1 text-[10px] font-bold cursor-pointer select-none transition">
                    <input type="checkbox" data-worker-resource="${resKey}" ${enabled ? 'checked' : ''} class="accent-amber-400" />
                    <span>${resLabel}</span>
                  </label>
                `;
              })
              .join('')}
          </div>
          <div class="text-[10px] font-bold text-amber-200 pt-1">Harvest Time (sec) &amp; Rate / sec:</div>
          <div class="grid grid-cols-4 gap-1.5">
            ${[
              ['wood', '🪵 Wood (s)', wg.harvestTimeSecByResource?.wood ?? 3.5],
              ['stone', '🪨 Stone (s)', wg.harvestTimeSecByResource?.stone ?? 4.8],
              ['iron', '⛓️ Iron (s)', wg.harvestTimeSecByResource?.iron ?? 5.5],
              ['coins', '🪙 Gold (s)', wg.harvestTimeSecByResource?.coins ?? 5.0]
            ]
              .map(([resKey, label, secVal]) => {
                const batch = Number(wg.batchYield ?? 15) || 15;
                const sec = Math.max(0.5, Number(secVal) || 3.5);
                const rate = (batch / sec).toFixed(1);
                return `
                  <div class="flex flex-col gap-0.5">
                    ${numInput(`workerGathering.harvestTimeSecByResource.${resKey}`, label, secVal, 0.5, 0.5, 60)}
                    <span class="text-[9px] text-emerald-300/90 font-bold text-center mono">${rate}/s</span>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;
}
