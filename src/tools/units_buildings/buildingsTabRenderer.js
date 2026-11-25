import { dataRegistry } from '../../data/dataRegistry.js';
import { ANIMATION_LAB_NAME } from '../../data/labNames.js';
import { BUILDING_LEVEL_UPGRADE_FEATURES, ensureBuildingLevelUpgradesConfig, getCumulativeBuildingUpgradesAtLevel } from './buildingStudioAdapter.js';
/**
 * Kings Lands — Buildings Tab Renderer for Units & Buildings Lab
 * (src/tools/units_buildings/buildingsTabRenderer.js)
 *
 * 100% English, concise labels (1-2 words per field) covering:
 * 1. Explicit toggle buttons on every building:
 *    - `Has Watchtower` (`hasWatchtowerSupport`)
 *    - `Has Levels` (`canAutoLevel`)
 * 2. Building owns unit recruitment (`options`), including `Unlock Level`, `Train Time (s)`, `XP Reward`, and `Cost`.
 * 3. Editable `Turret / Ballista Socket (X, Y, Z)` (`turretOffset`) on the building roof/tower.
 * 4. Shared Universal Building Watchtower (`sharedBuildingWatchtower`) + Special Buildings (`watchtower`, `ballista_tower`, `infirmary`, `banner_house`).
 */

function bldNumInput(field, label, value, step = 1, min = 0, max = 99999) {
  return `
    <label class="flex flex-col gap-0.5">
      <span class="text-[10px] font-semibold text-slate-400 truncate">${label}</span>
      <input
        type="number"
        data-bld-field="${field}"
        value="${value ?? 0}"
        step="${step}"
        min="${min}"
        max="${max}"
        class="w-full rounded bg-slate-900 border border-slate-700 focus:border-amber-400 px-2 py-1 text-xs font-bold text-slate-100 mono outline-none"
      />
    </label>
  `;
}

export function renderBuildingsLeftListHtml(stateManager, selectedBuildingId) {
  const bMap = stateManager.buildingsData.buildings || {};
  const icons = {
    citadel: '🏰',
    gathering_camp: '⛺',
    house: '🏠',
    barracks: '⚔️',
    archery_range: '🏹',
    stables: '🐎',
    siege_works: '🎯',
    blacksmith: '⚒️',
    watchtower: '🗼',
    ballista_tower: '🏹',
    infirmary: '💚',
    banner_house: '🚩'
  };

  const rows = Object.values(bMap)
    .filter((b) => b.id !== 'citadel_slot')
    .map((b) => {
      const active = b.id === selectedBuildingId;
      return `
        <button
          type="button"
          data-select-building="${b.id}"
          class="w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition cursor-pointer ${
            active
              ? 'border-amber-400 bg-amber-500/20 text-amber-200 font-black shadow'
              : 'border-slate-800 bg-slate-900/70 hover:bg-slate-800 text-slate-200 font-semibold'
          }"
        >
          <div class="flex-1 min-w-0 text-left">
            <div class="text-xs truncate">${b.name || b.id}</div>
            <div class="text-[10px] text-slate-400 mono truncate">${b.id}</div>
          </div>
          <span class="text-sm">${icons[b.id] || '🏛️'}</span>
        </button>
      `;
    })
    .join('');

  return `
    <div class="flex flex-col gap-1.5 flex-1 overflow-y-auto pr-0.5">
      ${rows}
    </div>
  `;
}

export function renderBuildingRightInspectorHtml(stateManager, buildingId, previewLevel = 1) {
  const bDef = stateManager.buildingsData.buildings?.[buildingId];
  if (!bDef) return `<div class="p-4 text-xs text-slate-400">Select a building from the list.</div>`;

  const sharedWt = stateManager.buildingsData.sharedBuildingWatchtower || {
    rangeMeters: 28,
    damage: 10,
    reloadMinTicks: 44,
    reloadMaxTicks: 58,
    volleyCount: 1,
    elevationRangeBonusMeters: 6
  };

  const allUnits = Object.values(stateManager.unitStatsData.units || {});
  const buildTimeSec = Math.round(((bDef.buildTimeTicks || 900) / 20) * 10) / 10;
  const arrowProtPct = Math.round((bDef.arrowProtectionPermille ?? 700) / 10);
  const meleeProtPct = Math.round((bDef.meleeProtectionPermille ?? 350) / 10);
  const options = Array.isArray(bDef.options) ? bDef.options : [];
  const hasLevels = Boolean(bDef.canAutoLevel);
  const hasWatchtower =
    bDef.hasWatchtowerSupport !== undefined
      ? Boolean(bDef.hasWatchtowerSupport)
      : (bDef.watchtowerLevel | 0) > 0 || Boolean(bDef.hasBuiltInTurret);
  const tOff = Array.isArray(bDef.turretOffset) ? bDef.turretOffset : [0, 8.0, 0];

  return `
    <div class="flex flex-col gap-3 p-3 text-left" dir="ltr">
      <!-- Construction, HP, Costs & Resource Drop-off -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/70 p-2.5 flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-black text-amber-400">Construction & Stats</span>
          <label class="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" data-bld-bool="isResourceDropoff" ${bDef.isResourceDropoff ? 'checked' : ''} class="accent-amber-400" />
            <span class="text-[10px] font-bold text-slate-300">Resource Drop-off</span>
          </label>
        </div>
        <label class="flex flex-col gap-0.5">
          <span class="text-[10px] font-semibold text-slate-400">Building Name</span>
          <input type="text" data-bld-str="name" value="${bDef.name || buildingId}" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-slate-100" />
        </label>
        <div class="grid grid-cols-3 gap-2">
          ${bldNumInput('buildTimeSec', 'Build Time (s)', buildTimeSec, 1, 1, 600)}
          ${bldNumInput('maxHp', 'Max HP', bDef.maxHp ?? 1200, 50, 100, 20000)}
          ${bldNumInput('footprintRadiusMeters', 'Radius (m)', bDef.footprintRadiusMeters ?? 5, 0.5, 2, 14)}
          ${bldNumInput('arrowProtectionPct', 'Arrow Prot (%)', arrowProtPct, 5, 0, 95)}
          ${bldNumInput('meleeProtectionPct', 'Melee Prot (%)', meleeProtPct, 5, 0, 95)}
          ${bldNumInput('popCapBonus', 'Pop Bonus', bDef.popCapBonus ?? 0, 5, 0, 200)}
          ${bldNumInput('passiveCoinsPerSec', 'Coins / Sec', bDef.passiveCoinsPerSec ?? 0, 1, 0, 200)}
        </div>
        <div class="grid grid-cols-4 gap-1.5 pt-1">
          ${bldNumInput('cost.coins', '🪙 Coins', bDef.cost?.coins ?? 200, 10, 0, 10000)}
          ${bldNumInput('cost.wood', '🪵 Wood', bDef.cost?.wood ?? 100, 10, 0, 10000)}
          ${bldNumInput('cost.stone', '🪨 Stone', bDef.cost?.stone ?? 0, 10, 0, 10000)}
          ${bldNumInput('cost.iron', '⛓️ Iron', bDef.cost?.iron ?? 0, 10, 0, 10000)}
        </div>
      </div>

      <!-- Two Explicit Toggles: Has Levels & Has Watchtower + Leveling / Turret Socket -->
      <div class="rounded-xl border border-sky-500/40 bg-slate-950/75 p-2.5 flex flex-col gap-2">
        <span class="text-xs font-black text-sky-300">Levels & Watchtower Toggles</span>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            id="ub-bld-toggle-has-levels"
            class="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-extrabold transition cursor-pointer ${
              hasLevels
                ? 'border-sky-400 bg-sky-500/20 text-sky-200 shadow'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }"
          >
            <span>⬆ Has Levels</span>
            <span class="rounded px-1.5 py-0.5 text-[10px] ${hasLevels ? 'bg-sky-400 text-slate-950' : 'bg-slate-800 text-slate-400'}">${hasLevels ? 'ON' : 'OFF'}</span>
          </button>
          <button
            type="button"
            id="ub-bld-toggle-has-wt"
            class="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-extrabold transition cursor-pointer ${
              hasWatchtower
                ? 'border-amber-400 bg-amber-500/20 text-amber-200 shadow'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }"
          >
            <span>🗼 Has Watchtower</span>
            <span class="rounded px-1.5 py-0.5 text-[10px] ${hasWatchtower ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-400'}">${hasWatchtower ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        ${
          hasLevels
            ? (() => {
                const maxLv = Math.max(2, Math.min(10, (bDef.maxLevel | 0) || 3));
                const activeLv = Math.max(1, Math.min(maxLv, previewLevel | 0));
                const upgMap = ensureBuildingLevelUpgradesConfig(bDef);
                const cumNow = getCumulativeBuildingUpgradesAtLevel(bDef, activeLv);
                const curStepCfg = activeLv >= 2 ? (upgMap[String(activeLv)] || {}) : {};
                const lvButtonsHtml =
                  `<select id="ub-bld-preview-level-select" class="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-sky-300">
                        ${Array.from({ length: maxLv }, (_, idx) => {
                          const lv = idx + 1;
                          return `<option value="${lv}" ${lv === activeLv ? 'selected' : ''}>Level ${lv} ${lv >= 2 ? `(Upgrade Lv.${lv - 1} → Lv.${lv})` : '(Base Building)'}</option>`;
                        }).join('')}
                      </select>`;

                const featHtml =
                  activeLv === 1
                    ? `<div class="text-[10px] text-slate-400">Level 1 is the base structure. Select <b>Lv.2 .. Lv.${maxLv}</b> above to configure cumulative visual upgrades & animations added at each level.</div>`
                    : `<div class="flex flex-col gap-1 pt-1">
                        <div class="text-[10px] font-bold text-amber-300">Cumulative Upgrades at Lv.${activeLv} (Transition Lv.${activeLv - 1} → Lv.${activeLv}):</div>
                        ${BUILDING_LEVEL_UPGRADE_FEATURES.map((f) => {
                          const unlockedEarlier = cumNow.unlockedAt[f.id] && cumNow.unlockedAt[f.id] < activeLv;
                          const checkedHere = Boolean(curStepCfg[f.id]);
                          return `
                            <label class="flex items-center justify-between rounded border px-2 py-1 text-[10.5px] cursor-pointer ${
                              unlockedEarlier
                                ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-200'
                                : checkedHere
                                  ? 'border-sky-400/60 bg-sky-500/15 text-sky-200 font-bold'
                                  : 'border-slate-800 bg-slate-900/70 text-slate-300'
                            }">
                              <span>${f.label}</span>
                              ${
                                unlockedEarlier
                                  ? `<span class="text-[9.5px] font-bold text-emerald-400">✓ Inherited (Lv.${cumNow.unlockedAt[f.id]})</span>`
                                  : `<input type="checkbox" data-bld-level-feat="${f.id}" data-bld-level-num="${activeLv}" ${checkedHere ? 'checked' : ''} class="accent-sky-400" />`
                              }
                            </label>
                          `;
                        }).join('')}
                      </div>`;

                return `
                  <div class="grid grid-cols-3 gap-2 pt-1">
                    ${bldNumInput('maxLevel', 'Max Level', bDef.maxLevel ?? 3, 1, 1, 10)}
                    ${bldNumInput('trainSpeedBonusPctPerLevel', 'Speed / Lv (%)', bDef.trainSpeedBonusPctPerLevel ?? 15, 5, 0, 100)}
                    ${bldNumInput('baseUpgradeCostCoins', 'Upgrade Gold', bDef.baseUpgradeCostCoins ?? 350, 20, 0, 5000)}
                    ${bldNumInput('xpPerLevel', 'XP / Level', bDef.xpPerLevel ?? 650, 50, 100, 5000)}
                    ${bldNumInput('hpPerLevelBonus', 'HP / Level', bDef.hpPerLevelBonus ?? 250, 50, 0, 2000)}
                  </div>
                  <div class="border-t border-slate-800 pt-2 flex flex-col gap-1.5">
                    <div class="flex items-center justify-between">
                      <span class="text-[10px] font-extrabold text-sky-300">Preview & Configure Building Level</span>
                      <span class="text-[9.5px] text-slate-400">Cumulative Visuals</span>
                    </div>
                    ${lvButtonsHtml}
                    ${featHtml}
                  </div>
                `;
              })()
            : ''
        }

        ${
          hasWatchtower
            ? `
          <div class="border-t border-slate-800 pt-2 flex flex-col gap-1.5">
            <div class="grid grid-cols-3 gap-1.5">
              ${bldNumInput('watchtowerX', 'Tower X (×radius)', bDef.watchtowerX ?? 0.56, 0.05, -1.5, 1.5)}
              ${bldNumInput('watchtowerZ', 'Tower Z (×radius)', bDef.watchtowerZ ?? -0.52, 0.05, -1.5, 1.5)}
              <div class="text-[9.5px] text-slate-400 self-end">Tower appears only from "Tower at Lv"</div>
            </div>
            <div class="grid grid-cols-4 gap-1.5">
              ${bldNumInput('watchtowerLevel', 'Tower at Lv', Math.max(1, bDef.watchtowerLevel || 1), 1, 1, 10)}
              ${bldNumInput('turretOffset.0', 'Muzzle X', tOff[0] ?? 0, 0.2, -10, 10)}
              ${bldNumInput('turretOffset.1', 'Muzzle Y', tOff[1] ?? 8.0, 0.2, 1, 25)}
              ${bldNumInput('turretOffset.2', 'Muzzle Z', tOff[2] ?? 0, 0.2, -10, 10)}
            </div>
          </div>
        `
            : ''
        }
      </div>

      ${(() => {
        const sk = dataRegistry.getBuildingSkin(bDef.id);
        const items = Object.entries(sk?.items || {});
        const activeId = sk?.active || 'default';
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const card = (sid, label, icon, isPlaceholder = false) => {
          const on = activeId === sid;
          return `<button type="button" data-bld-skin-pick="${esc(sid)}" class="relative flex flex-col items-center justify-between gap-1 rounded-lg border-2 p-2 text-center cursor-pointer transition ${
            on
              ? 'border-emerald-400 bg-emerald-500/15 ring-1 ring-emerald-400/50'
              : 'border-slate-700 bg-slate-900/90 hover:border-slate-500'
          }">
            ${on ? `<span data-skin-check="true" class="pointer-events-none absolute top-1 left-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-slate-950 text-[10px] font-black shadow ring-1 ring-slate-950">✓</span>` : ''}
            <span class="text-xl leading-none mt-1">${isPlaceholder ? '📦' : icon}</span>
            <span class="w-full truncate text-[10.5px] font-bold ${on ? 'text-emerald-300' : 'text-slate-200'}">${esc(label)}</span>
          </button>`;
        };
        return `<div class="rounded-xl border border-sky-500/40 bg-slate-950/75 p-2.5 flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-black text-sky-300">Building Skins (From Studio)</span>
            <button type="button" id="ub-btn-edit-bld-skins-studio" class="rounded-lg border border-sky-400/60 bg-sky-500/15 hover:bg-sky-500/25 px-2 py-0.5 text-[10px] font-extrabold text-sky-300 cursor-pointer transition">🎬 Import / Edit Skins in Studio</button>
          </div>
          <div class="grid grid-cols-3 gap-1.5">
            ${card('default', 'Default look', '🏰', false)}
            ${items.map(([sid, it]) => card(sid, it.name || sid, '🏠', Boolean(it.isPlaceholderCube))).join('')}
          </div>
          <select data-bld-skin-select class="hidden">
            <option value="default" ${activeId === 'default' ? 'selected' : ''}>Default look</option>
            ${items.map(([sid, it]) => `<option value="${esc(sid)}" ${activeId === sid ? 'selected' : ''}>${esc(it.name || sid)}</option>`).join('')}
          </select>
          ${!items.length ? `<div class="text-[10.5px] text-slate-400">Import custom .glb skins in ${ANIMATION_LAB_NAME} to add more looks.</div>` : ''}
        </div>`;
      })()}

      <!-- Fix 11: Building Owns Recruited Units, Unlock Level, Train Time (s) & XP Reward -->
      <div class="rounded-xl border border-emerald-500/40 bg-slate-950/75 p-2.5 flex flex-col gap-2">
        <span class="text-xs font-black text-emerald-300">Recruited Units & Research (By Building)</span>
        <div class="flex flex-col gap-1.5">
          ${
            options.length === 0
              ? `<div class="text-[11px] text-slate-400">No units or upgrades recruited in this building.</div>`
              : options
                  .map(
                    (opt, idx) => `
                  <div class="rounded-lg border border-slate-800 bg-slate-900/90 p-2 flex flex-col gap-1.5">
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5 min-w-0">
                        <span class="text-xs font-extrabold text-amber-200 truncate">${opt.name} <span class="text-[10px] text-slate-400 mono">(${opt.id})</span></span>
                      </div>
                      <button type="button" data-bld-del-opt="${idx}" class="rounded bg-rose-950/80 hover:bg-rose-800 px-1.5 py-0.5 text-[10px] font-bold text-rose-300 cursor-pointer">Remove</button>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                      <label class="flex flex-col gap-0.5">
                        <span class="text-[9.5px] text-emerald-300 font-bold">Unlock Lv</span>
                        <input type="number" data-bld-opt-idx="${idx}" data-bld-opt-key="unlockLevel" value="${opt.unlockLevel ?? 1}" min="1" max="10" class="rounded bg-slate-950 border border-slate-700 px-1.5 py-0.5 text-xs font-bold text-emerald-300 mono" />
                      </label>
                      <label class="flex flex-col gap-0.5">
                        <span class="text-[9.5px] text-slate-400">Train (s)</span>
                        <input type="number" data-bld-opt-idx="${idx}" data-bld-opt-key="trainTimeSec" value="${Math.round(((opt.trainTicks || 100) / 20) * 10) / 10}" step="0.5" min="0.5" max="120" class="rounded bg-slate-950 border border-slate-700 px-1.5 py-0.5 text-xs font-bold text-slate-100 mono" />
                      </label>
                      <label class="flex flex-col gap-0.5">
                        <span class="text-[9.5px] text-sky-300 font-bold">Building XP</span>
                        <input type="number" data-bld-opt-idx="${idx}" data-bld-opt-key="xpReward" value="${opt.xpReward ?? 35}" step="5" min="0" max="1000" class="rounded bg-slate-950 border border-slate-700 px-1.5 py-0.5 text-xs font-bold text-sky-300 mono" />
                      </label>
                    </div>
                  </div>
                `
                  )
                  .join('')
          }
        </div>
        <div class="flex items-center gap-1.5 pt-1">
          <select id="ub-bld-add-unit-select" class="flex-1 rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200">
            ${allUnits.map((u) => `<option value="${u.id}">${u.name} (${u.id})</option>`).join('')}
          </select>
          <input id="ub-bld-add-unit-level" type="number" value="1" min="1" max="10" title="Unlock Level" class="w-12 rounded bg-slate-900 border border-slate-700 px-1.5 py-1 text-xs font-bold text-emerald-300 mono text-center" />
          <button type="button" id="ub-btn-add-unit-to-bld" class="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1 text-xs font-black text-slate-950 cursor-pointer">+ Add Unit</button>
        </div>
      </div>

      <!-- Universal Watchtower of All Upgraded Buildings -->
      <div class="rounded-xl border border-amber-400/40 bg-slate-950/75 p-2.5 flex flex-col gap-2">
        <span class="text-xs font-black text-amber-300">Shared Building Watchtower (All Buildings)</span>
        <div class="grid grid-cols-4 gap-1.5">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-slate-400">Range (m)</span>
            <input type="number" data-shared-wt="rangeMeters" value="${sharedWt.rangeMeters ?? 28}" min="5" max="120" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-slate-100 mono" />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-slate-400">Damage</span>
            <input type="number" data-shared-wt="damage" value="${sharedWt.damage ?? 10}" min="1" max="500" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-slate-100 mono" />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-slate-400">Reload (t)</span>
            <input type="number" data-shared-wt="reloadMinTicks" value="${sharedWt.reloadMinTicks ?? 44}" min="5" max="200" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-slate-100 mono" />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-slate-400">Volley</span>
            <input type="number" data-shared-wt="volleyCount" value="${sharedWt.volleyCount ?? 1}" min="1" max="10" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-slate-100 mono" />
          </label>
        </div>
      </div>

      <!-- Special Building Parameters (Watchtower / Ballista Tower / Citadel / Infirmary / Banner House) -->
      ${
        buildingId === 'watchtower' || buildingId === 'ballista_tower' || buildingId === 'citadel'
          ? `
        <div class="rounded-xl border border-amber-500/60 bg-amber-500/10 p-2.5 flex flex-col gap-2">
          <span class="text-xs font-black text-amber-300">
            ${buildingId === 'ballista_tower' ? 'Ballista Tower & Garrison Settings' : buildingId === 'watchtower' ? 'Watchtower & Garrison Settings' : 'Citadel Stronghold Turret'}
          </span>
          <div class="grid grid-cols-3 gap-2">
            ${bldNumInput('turretRangeMeters', 'Range (m)', bDef.turretRangeMeters ?? 28, 1, 5, 180)}
            ${bldNumInput('turretDamage', 'Damage', bDef.turretDamage ?? 12, 1, 1, 500)}
            ${bldNumInput('turretVolleyCount', 'Volley', bDef.turretVolleyCount ?? 1, 1, 1, 12)}
            ${bldNumInput('turretReloadMinTicks', 'Reload Min', bDef.turretReloadMinTicks ?? 40, 2, 4, 200)}
            ${bldNumInput('turretReloadMaxTicks', 'Reload Max', bDef.turretReloadMaxTicks ?? 54, 2, 4, 240)}
            ${
              buildingId !== 'citadel'
                ? bldNumInput('maxGarrison', 'Max Squads (0=No Slits)', bDef.maxGarrison ?? 0, 1, 0, 6)
                : bldNumInput('garrisonElevationRangeBonusMeters', 'Height Bonus (m)', bDef.garrisonElevationRangeBonusMeters ?? 6, 1, 0, 40)
            }
          </div>
          ${
            buildingId === 'ballista_tower'
              ? `
            <label class="flex flex-col gap-0.5 pt-1">
              <span class="text-[10px] font-bold text-amber-200">Mounted Ballista Unit</span>
              <select data-bld-str="mountedBallistaUnitId" class="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-amber-300">
                ${allUnits
                  .filter((u) => u.isSiege || u.isRanged || u.id === 'ballista')
                  .map(
                    (u) =>
                      `<option value="${u.id}" ${(bDef.mountedBallistaUnitId || 'ballista') === u.id ? 'selected' : ''}>${u.name} (${u.id})</option>`
                  )
                  .join('')}
              </select>
            </label>
          `
              : ''
          }
        </div>
      `
          : ''
      }

      ${
        buildingId === 'infirmary'
          ? `
        <div class="rounded-xl border border-emerald-500/60 bg-emerald-500/10 p-2.5 flex flex-col gap-2">
          <span class="text-xs font-black text-emerald-300">Healing Well / Infirmary Settings</span>
          <div class="grid grid-cols-3 gap-2">
            ${bldNumInput('auraRadiusMeters', 'Aura Radius (m)', bDef.auraRadiusMeters ?? 22, 1, 5, 80)}
            ${bldNumInput('healPerTick', 'Heal / Pulse', bDef.healPerTick ?? 3, 1, 1, 100)}
            ${bldNumInput('healPulseIntervalTicks', 'Pulse Ticks', bDef.healPulseIntervalTicks ?? 10, 1, 2, 100)}
            ${bldNumInput('outOfCombatDelaySec', 'Out-of-Combat (s)', bDef.outOfCombatDelaySec ?? 3.0, 0.5, 0, 30)}
            ${bldNumInput('reinforceIntervalTicks', 'Respawn Ticks', bDef.reinforceIntervalTicks ?? 70, 5, 10, 400)}
            ${bldNumInput('reinforceCostPermille', 'Respawn Cost (‰)', bDef.reinforceCostPermille ?? 500, 50, 0, 1000)}
          </div>
        </div>
      `
          : ''
      }

      ${
        buildingId === 'banner_house'
          ? `
        <div class="rounded-xl border border-sky-500/60 bg-sky-500/10 p-2.5 flex flex-col gap-2">
          <span class="text-xs font-black text-sky-300">Banner House / Morale Pillar Settings</span>
          <div class="grid grid-cols-3 gap-2">
            ${bldNumInput('auraRadiusMeters', 'Aura Radius (m)', bDef.auraRadiusMeters ?? 26, 1, 5, 80)}
            ${bldNumInput('damageBonusPermille', 'Dmg Bonus (‰)', bDef.damageBonusPermille ?? 200, 25, 0, 1000)}
            ${bldNumInput('defenseBonusPermille', 'Def Bonus (‰)', bDef.defenseBonusPermille ?? 200, 25, 0, 1000)}
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;
}
