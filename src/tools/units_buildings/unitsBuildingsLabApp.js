/**
 * Kings Lands — Units & Buildings Lab Application (`Units & Buildings Lab`)
 * (src/tools/units_buildings/unitsBuildingsLabApp.js)
 *
 * 100% English UI with:
 * - `Units` tab:
 *   - Clean base character creation (`+ Create Base Unit`) + `Duplicate Selected Unit` (Fix 1)
 *   - Single toggle formation buttons (`Square ↔ Wedge`, `Square ↔ Shield Wall`, etc.) (Fix 2)
 *   - Vision Range (`visionRangeMeters`) (Fix 3)
 *   - Weapon Sets (Hand Weapons ONLY) vs. Visual Appearance (Cosmetic Helmet/Armor/Cape) (Fix 4)
 *   - 3D Mount Dropdown (`None`, `Warhorse`, `Dire Wolf`, `War Chameleon`) (Fix 5)
 *   - Live 1v1 / Squad DPS Duel Simulator in the viewport!
 *   - Contextual jump to Animation Lab (`contextualUnitId`) so only that unit opens and `Back` returns here (Fix 7 & Fix 9)
 * - `Buildings` tab:
 *   - Explicit `Has Levels` and `Has Watchtower` toggle buttons
 *   - Building-owned recruitment options (`Unlock Level`, `Train Time (s)`, `Building XP`, `Coins`) (Fix 11)
 *   - Turret / Ballista Muzzle Socket (`turretOffset` X, Y, Z)
 *   - Contextual jump to Animation Lab (`contextualBuildingId`) with Building Animation Session clips (`build_construct`, `idle`, `level_up`, `recruit_spawn`, `damage_stage_1`, `damage_stage_2`, `collapse_destroy`).
 */

import { loadBuildingSkins, saveBuildingSkins } from '../../data/buildingSkinStore.js';
import * as THREE from 'three';
import { ModelFactory } from '../../render/modelFactory.js';
import { BuildingModelFactory } from '../../render/buildingModelFactory.js';
import { Animator3D } from '../../render/animator3d.js';
import { applySkinColors, disposeVisual } from '../studio/skinUtils.js';
import { createPortraitStudio } from '../studio/portraitRenderer.js';
import { canBuildingRecruitUnits, ensureBuildingLevelUpgradesConfig } from './buildingStudioAdapter.js';
import { computeCapabilitiesForLoadout } from '../../sim/combatCapabilitiesRegistry.js';
import { MAIN_LOADOUT, asLoadout, equipmentOf, restow, grantedActions, weaponTypeOf } from '../studio/weaponRules.js';
import { ACTION_CLIPS, getCombatBase, getLocomotionBase, resolveClip } from '../studio/clipResolver.js';
import {
  UnitsBuildingsStateManager,
  BASE_CHARACTER_TEMPLATES,
  computeEligibleFormationsForUnit
} from './unitsBuildingsStateManager.js';
import { DEFAULT_BASE_CHAR_ID } from '../studio/baseUnitsMigration.js';
import {
  renderUnitsLeftListHtml,
  renderUnitRightInspectorHtml
} from './unitsTabRenderer.js';
import {
  renderBuildingsLeftListHtml,
  renderBuildingRightInspectorHtml
} from './buildingsTabRenderer.js';

function setNestedField(obj, pathStr, val) {
  const parts = String(pathStr).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === undefined || cur[k] === null || typeof cur[k] !== 'object') {
      cur[k] = Number.isInteger(Number(parts[i + 1])) ? [] : {};
    }
    cur = cur[k];
  }
  const lastKey = parts[parts.length - 1];
  cur[Array.isArray(cur) ? Number(lastKey) : lastKey] = val;
}

export class UnitsBuildingsLabApp {
  constructor(rootContainer, options = {}) {
    this.rootContainer = rootContainer;
    this.onExitLab = options.onExitLab || null;
    this.onOpenAnimationLab = options.onOpenAnimationLab || null;
    this.onOpenHallOfHeroes = options.onOpenHallOfHeroes || null;

    this.stateManager =
      options.stateManager ||
      new UnitsBuildingsStateManager({
        onStatus: (state, msg) => this._updateSaveChip(state, msg)
      });

    this.activeTab = options.initialTab === 'buildings' ? 'buildings' : 'units';
    this.selectedUnitId =
      options.initialUnitId && this.stateManager.unitStatsData.units[options.initialUnitId]
        ? options.initialUnitId
        : 'swordsman';
    this.selectedBuildingId =
      options.initialBuildingId && this.stateManager.buildingsData.buildings[options.initialBuildingId]
        ? options.initialBuildingId
        : 'barracks';

    this.activeLoadoutId = options.initialLoadoutIdx === 1 ? 'loadout2' : MAIN_LOADOUT;
    this.activeUnitAnim = options.initialAnim || 'idle';
    this.duelOpponentId = 'spearman';
    this.duelMode = 'squad'; // 'squad' | '1v1'
    this.bldPreviewLevel = 1;
    this.bldPreviewWatchtower = true;
    this.bldPreviewDoorOpen = false;
    this.bldPreviewScaffold = false;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.pedestalGroup = null;
    this.previewActorGroup = null;
    this.buildingActor = null;
    this.unitAnimator = null;
    this.buildingModelFactory = new BuildingModelFactory();

    this.camYaw = 0.42;
    this.camPitch = 0.28;
    this.camDist = 4.2;
    this.camTarget = new THREE.Vector3(0, 1.0, 0);
    this._isDragging = false;
    this._lastX = 0;
    this._lastY = 0;
    this._running = false;
    this._toastTimer = null;

    this._buildDOM();
    this._initThreeScene();
    this._renderWorkspace();
    this._startLoop();
  }

  _updateSaveChip(state, msg = '') {
    const chip = this.rootContainer?.querySelector('#ub-save-chip');
    if (!chip) return;
    if (state === 'dirty') {
      chip.className =
        'rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300';
      chip.textContent = msg || 'Saving…';
    } else {
      chip.className =
        'rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300';
      chip.textContent = msg || 'Saved';
    }
  }

  _toast(msg, ms = 2200) {
    const el = this.rootContainer?.querySelector('#ub-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  _buildDOM() {
    const isUnits = this.activeTab === 'units';
    this.rootContainer.innerHTML = `
      <div class="fixed inset-0 z-40 flex flex-col bg-slate-950 text-slate-100 select-none overflow-hidden">
        <!-- Header (100% English — Fix 10) -->
        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-4 py-2">
          <div class="flex items-center gap-3">
            <h1 class="text-sm font-black uppercase tracking-wider text-amber-400">
              ⚔️ Kings Lands • Units & Buildings Lab
            </h1>
            <div class="flex rounded-lg bg-slate-950 p-0.5 border border-slate-700">
              <button type="button" id="ub-tab-units" class="rounded-md px-3.5 py-1 text-xs font-extrabold transition cursor-pointer ${
                this.activeTab === 'units' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-300 hover:text-white'
              }">
                ⚔️ Units
              </button>
              <button type="button" id="ub-tab-buildings" class="rounded-md px-3.5 py-1 text-xs font-extrabold transition cursor-pointer ${
                this.activeTab === 'buildings' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-300 hover:text-white'
              }">
                🏰 Buildings
              </button>
              <button type="button" id="ub-tab-simulation" class="rounded-md px-3.5 py-1 text-xs font-extrabold transition cursor-pointer ${
                this.activeTab === 'simulation' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-300 hover:text-white'
              }">
                📊 Simulation
              </button>
            </div>
            <span id="ub-save-chip" class="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
              Saved
            </span>
          </div>

          <div class="flex items-center gap-1.5">
            <button type="button" id="ub-btn-open-studio" class="rounded-lg border border-sky-400/60 bg-sky-500/15 hover:bg-sky-500/25 px-3 py-1 text-xs font-bold text-sky-300 cursor-pointer">
              🎬 Animation Lab
            </button>
            <button type="button" id="ub-btn-open-heroes" class="rounded-lg border border-amber-400/60 bg-amber-500/15 hover:bg-amber-500/25 px-3 py-1 text-xs font-bold text-amber-300 cursor-pointer">
              👑 Hall of Heroes
            </button>
            <button type="button" id="ub-btn-export" class="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-bold text-slate-950 shadow cursor-pointer">
              Export JSON
            </button>
            <button type="button" id="ub-btn-import" class="rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 cursor-pointer">
              Import JSON
            </button>
            <input id="ub-import-input" type="file" accept=".json,application/json" class="hidden" />
            <button type="button" id="ub-btn-reset" class="rounded-lg bg-rose-950/90 hover:bg-rose-800 border border-rose-500/40 px-2.5 py-1 text-xs font-bold text-rose-200 cursor-pointer">
              Reset
            </button>
            <button type="button" id="ub-btn-exit" class="rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 cursor-pointer">
              Back to Game
            </button>
          </div>
        </header>

        <!-- Main Workspace -->
        <div class="relative flex flex-1 min-h-0 overflow-hidden">
          <!-- Left List Sidebar -->
          <aside id="ub-left-sidebar" class="w-64 shrink-0 border-r border-slate-800 bg-slate-900/90 p-3 flex flex-col gap-2 overflow-y-auto"></aside>

          <!-- Center 3D Viewport -->
          <main class="relative flex-1 min-w-0 h-full bg-slate-950 flex flex-col overflow-hidden">
            <div id="ub-viewport" class="w-full flex-1 min-h-0 cursor-grab active:cursor-grabbing"></div>

            <!-- Top Title, Required Animations & Duel Simulator Bar -->
            <div id="ub-viewport-top-bar" class="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-start justify-between gap-2 pointer-events-none"></div>

            <!-- Bottom 3D Preview Controls & Edit Animations Button -->
            <div id="ub-viewport-bottom-bar" class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-slate-700/80 bg-slate-900/90 px-3.5 py-2 backdrop-blur-md shadow-xl"></div>

            <div id="ub-toast" class="hidden absolute top-20 left-1/2 -translate-x-1/2 z-30 rounded-xl border border-amber-400/60 bg-slate-900/95 px-4 py-2 text-xs font-bold text-amber-200 shadow-2xl"></div>
          </main>

          <!-- Right Inspector Sidebar -->
          <aside id="ub-right-inspector" class="w-96 shrink-0 border-l border-slate-800 bg-slate-900/95 flex flex-col overflow-y-auto"></aside>
        </div>
      </div>
    `;

    this.rootContainer.querySelector('#ub-tab-units')?.addEventListener('click', () => {
      this.activeTab = 'units';
      this._syncTabButtons();
      this._renderWorkspace();
    });
    this.rootContainer.querySelector('#ub-tab-buildings')?.addEventListener('click', () => {
      this.activeTab = 'buildings';
      this._syncTabButtons();
      this._renderWorkspace();
    });
    this.rootContainer.querySelector('#ub-tab-simulation')?.addEventListener('click', () => {
      this.activeTab = 'simulation';
      this._syncTabButtons();
      this._renderWorkspace();
    });
    this.rootContainer.querySelector('#ub-btn-open-studio')?.addEventListener('click', () => {
      this._openContextualAnimationLab();
    });
    this.rootContainer.querySelector('#ub-btn-open-heroes')?.addEventListener('click', () => {
      this.stateManager.saveAll();
      this.onOpenHallOfHeroes?.();
    });
    this.rootContainer.querySelector('#ub-btn-export')?.addEventListener('click', () => {
      this.stateManager.exportCombinedBundleJson();
    });
    const impInput = this.rootContainer.querySelector('#ub-import-input');
    this.rootContainer.querySelector('#ub-btn-import')?.addEventListener('click', () => {
      impInput?.click();
    });
    impInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const txt = await file.text();
      const res = this.stateManager.importCombinedBundleText(txt);
      if (res.ok) {
        this._renderWorkspace();
        this._toast('Configuration imported!');
      } else {
        this._toast(`Import error: ${res.error}`);
      }
    });
    this.rootContainer.querySelector('#ub-btn-reset')?.addEventListener('click', () => {
      this.stateManager.resetAllToDefaults();
      this._renderWorkspace();
      this._toast('All units & buildings reset to default');
    });
    this.rootContainer.querySelector('#ub-btn-exit')?.addEventListener('click', () => {
      this.stateManager.saveAll();
      this.onExitLab?.();
    });
  }

  _openContextualAnimationLab() {
    this.stateManager.saveAll();
    if (this.activeTab === 'buildings') {
      this.onOpenAnimationLab?.({
        contextualBuildingId: this.selectedBuildingId,
        initialCategory: 'buildings',
        initialUnitId: this.selectedBuildingId
      });
    } else {
      const ldIdx = this.activeLoadoutId && this.activeLoadoutId !== MAIN_LOADOUT ? 1 : 0;
      this.onOpenAnimationLab?.({
        contextualUnitId: this.selectedUnitId,
        initialCategory: 'units',
        initialUnitId: this.selectedUnitId,
        initialAnim: this.activeUnitAnim || 'idle',
        initialLoadoutIdx: ldIdx
      });
    }
  }

  _syncTabButtons() {
    const bU = this.rootContainer.querySelector('#ub-tab-units');
    const bB = this.rootContainer.querySelector('#ub-tab-buildings');
    const bS = this.rootContainer.querySelector('#ub-tab-simulation');
    if (bU) {
      bU.className = `rounded-md px-3.5 py-1 text-xs font-extrabold transition cursor-pointer ${
        this.activeTab === 'units' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-300 hover:text-white'
      }`;
    }
    if (bB) {
      bB.className = `rounded-md px-3.5 py-1 text-xs font-extrabold transition cursor-pointer ${
        this.activeTab === 'buildings' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-300 hover:text-white'
      }`;
    }
    if (bS) {
      bS.className = `rounded-md px-3.5 py-1 text-xs font-extrabold transition cursor-pointer ${
        this.activeTab === 'simulation' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-300 hover:text-white'
      }`;
    }
  }

  _initThreeScene() {
    this.viewportEl = this.rootContainer.querySelector('#ub-viewport');
    if (!this.viewportEl) return;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090f1d);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.viewportEl.appendChild(this.renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.9);
    hemi.position.set(0, 22, 0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfffbeb, 1.3);
    dir.position.set(8, 14, 10);
    this.scene.add(dir);

    this.pedestalGroup = new THREE.Group();
    const grid = new THREE.GridHelper(18, 18, 0x38bdf8, 0x1e293b);
    grid.position.y = 0.01;
    this.pedestalGroup.add(grid);
    this.scene.add(this.pedestalGroup);

    this.viewportEl.addEventListener('contextmenu', (e) => e.preventDefault());
    this.viewportEl.addEventListener('mousedown', (e) => {
      this._isDragging = true;
      this._dragButton = e.button;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => {
      this._isDragging = false;
      this._dragButton = 0;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this._isDragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      if (this._dragButton === 2 || (e.buttons & 2) !== 0) {
        // Right Mouse Drag: Pan camera left/right and up/down (same as Animation Lab!)
        const panScale = Math.max(0.002, this.camDist * 0.0018);
        const rightX = Math.cos(this.camYaw);
        const rightZ = -Math.sin(this.camYaw);
        this.camTarget.x -= dx * panScale * rightX;
        this.camTarget.z -= dx * panScale * rightZ;
        this.camTarget.y = Math.max(-2.0, Math.min(12.0, this.camTarget.y + dy * panScale));
      } else {
        // Left Mouse Drag: Orbit camera
        this.camYaw -= dx * 0.008;
        this.camPitch = Math.max(0.08, Math.min(1.35, this.camPitch + dy * 0.006));
      }
      this._updateCameraOrbit();
    });
    this.viewportEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camDist = Math.max(1.8, Math.min(34, this.camDist + (e.deltaY > 0 ? 0.9 : -0.9)));
        this._updateCameraOrbit();
      },
      { passive: false }
    );

    this._resizeHandler = () => {
      if (!this.viewportEl || !this.renderer) return;
      const w = this.viewportEl.clientWidth || 800;
      const h = this.viewportEl.clientHeight || 600;
      if (w > 0 && h > 0) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      }
    };
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._resizeHandler());
      this._ro.observe(this.viewportEl);
    }
    this._resizeHandler();
  }

  _updateCameraOrbit() {
    if (!this.camera) return;
    const cx = this.camTarget.x + this.camDist * Math.cos(this.camPitch) * Math.sin(this.camYaw);
    const cy = this.camTarget.y + this.camDist * Math.sin(this.camPitch);
    const cz = this.camTarget.z + this.camDist * Math.cos(this.camPitch) * Math.cos(this.camYaw);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(this.camTarget);
  }

  _renderWorkspace({ preserveCamera = true } = {}) {
    const leftEl = this.rootContainer.querySelector('#ub-left-sidebar');
    const rightEl = this.rootContainer.querySelector('#ub-right-inspector');
    if (!leftEl || !rightEl) return;

    const prevLeftScroll = leftEl.scrollTop || 0;
    const prevRightScroll = rightEl.scrollTop || 0;

    if (this.activeTab === 'units') {
      leftEl.innerHTML = renderUnitsLeftListHtml(this.stateManager, this.selectedUnitId);
      rightEl.innerHTML = renderUnitRightInspectorHtml(
        this.stateManager,
        this.selectedUnitId,
        this.activeLoadoutId
      );
      this._bindUnitsEvents();
      this._spawnPreview3D({ preserveCamera });
    } else if (this.activeTab === 'buildings') {
      leftEl.innerHTML = renderBuildingsLeftListHtml(this.stateManager, this.selectedBuildingId);
      rightEl.innerHTML = renderBuildingRightInspectorHtml(
        this.stateManager,
        this.selectedBuildingId,
        this.bldPreviewLevel || 1
      );
      this._bindBuildingsEvents();
      this._spawnPreview3D({ preserveCamera });
    } else {
      this._renderSimulationWorkspace(leftEl, rightEl);
      this._spawnPreview3D({ preserveCamera });
    }

    leftEl.scrollTop = prevLeftScroll;
    rightEl.scrollTop = prevRightScroll;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        leftEl.scrollTop = prevLeftScroll;
        rightEl.scrollTop = prevRightScroll;
      });
    }
  }

  _renderSimulationWorkspace(leftEl, rightEl) {
    const allUnits = Object.values(this.stateManager.unitStatsData.units || {});
    const uA = this.stateManager.unitStatsData.units?.[this.selectedUnitId] || allUnits[0];
    const uB = this.stateManager.unitStatsData.units?.[this.duelOpponentId] || allUnits[1] || allUnits[0];
    if (!uA || !uB) return;

    leftEl.innerHTML = `
      <div class="flex flex-col gap-3">
        <div class="rounded-xl border border-sky-500/50 bg-slate-950/85 p-3 flex flex-col gap-2">
          <span class="text-xs font-black text-sky-300 uppercase">🔵 Challenger A (Blue)</span>
          <select id="ub-sim-select-a" class="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-100">
            ${allUnits.map((u) => `<option value="${u.id}" ${u.id === uA.id ? 'selected' : ''}>${u.name} (${u.id})</option>`).join('')}
          </select>
          <div class="grid grid-cols-2 gap-1.5 text-[10px] text-slate-300 mono pt-1">
            <span>HP: <b class="text-sky-300">${uA.hp}</b></span>
            <span>Squad: <b class="text-sky-300">${uA.squadSize}</b></span>
            <span>Armor: <b class="text-sky-300">${uA.armor}</b></span>
            <span>Speed: <b class="text-sky-300">${uA.speedMetersPerSec}m/s</b></span>
          </div>
        </div>

        <div class="rounded-xl border border-rose-500/50 bg-slate-950/85 p-3 flex flex-col gap-2">
          <span class="text-xs font-black text-rose-300 uppercase">🔴 Opponent B (Red)</span>
          <select id="ub-sim-select-b" class="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs font-bold text-slate-100">
            ${allUnits.map((u) => `<option value="${u.id}" ${u.id === uB.id ? 'selected' : ''}>${u.name} (${u.id})</option>`).join('')}
          </select>
          <div class="grid grid-cols-2 gap-1.5 text-[10px] text-slate-300 mono pt-1">
            <span>HP: <b class="text-rose-300">${uB.hp}</b></span>
            <span>Squad: <b class="text-rose-300">${uB.squadSize}</b></span>
            <span>Armor: <b class="text-rose-300">${uB.armor}</b></span>
            <span>Speed: <b class="text-rose-300">${uB.speedMetersPerSec}m/s</b></span>
          </div>
        </div>

        <div class="rounded-xl border border-slate-800 bg-slate-950/85 p-3 flex flex-col gap-2">
          <span class="text-xs font-black text-amber-300 uppercase">⚙️ Simulation Mode</span>
          <button type="button" id="ub-sim-left-squad" class="w-full rounded-lg py-1.5 text-xs font-extrabold cursor-pointer ${
            this.duelMode === 'squad' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'
          }">⚔️ Full Squad vs Squad</button>
          <button type="button" id="ub-sim-left-1v1" class="w-full rounded-lg py-1.5 text-xs font-extrabold cursor-pointer ${
            this.duelMode === '1v1' ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'
          }">🤺 1v1 Single Soldier</button>
        </div>
      </div>
    `;

    const duelRes = this.stateManager.simulateUnitDuel(uA.id, uB.id, this.duelMode);
    const matrixRows = allUnits
      .map((opp) => {
        const res = this.stateManager.simulateUnitDuel(uA.id, opp.id, this.duelMode);
        if (!res) return '';
        const won = res.winnerId === uA.id;
        return `
          <tr class="border-b border-slate-800/80 hover:bg-slate-900/60 cursor-pointer" data-sim-pick-opp="${opp.id}">
            <td class="py-1.5 px-2 font-bold text-slate-200">${opp.name}</td>
            <td class="py-1.5 px-2 text-center font-black ${won ? 'text-emerald-400' : 'text-rose-400'}">${won ? 'WIN' : 'LOSS'}</td>
            <td class="py-1.5 px-2 text-right mono text-slate-300">${res.durationSec}s</td>
            <td class="py-1.5 px-2 text-right mono ${won ? 'text-emerald-300' : 'text-rose-300'}">${won ? res.unitA.remHpPct : res.unitB.remHpPct}%</td>
          </tr>
        `;
      })
      .join('');

    rightEl.innerHTML = `
      <div class="flex flex-col gap-3 p-3 text-left" dir="ltr">
        ${
          duelRes
            ? `
          <div class="rounded-xl border border-emerald-500/50 bg-emerald-950/20 p-3 flex flex-col gap-1.5">
            <div class="text-xs font-black uppercase text-emerald-300">🏆 Matchup Outcome (${this.duelMode === '1v1' ? '1v1 Duel' : 'Full Squad Battle'})</div>
            <div class="text-sm font-black text-amber-200">${duelRes.winnerName} Wins in ${duelRes.durationSec}s</div>
            <div class="grid grid-cols-2 gap-2 pt-1 text-xs mono">
              <div class="rounded bg-slate-950/90 border border-sky-500/40 p-2">
                <div class="font-bold text-sky-300">${duelRes.unitA.name}</div>
                <div>Total DPS: <b>${duelRes.unitA.dps}</b></div>
                <div>Time to Kill B: <b>${duelRes.unitA.ttkSec}s</b></div>
                <div>Remaining HP: <b>${duelRes.unitA.remHpPct}%</b></div>
              </div>
              <div class="rounded bg-slate-950/90 border border-rose-500/40 p-2">
                <div class="font-bold text-rose-300">${duelRes.unitB.name}</div>
                <div>Total DPS: <b>${duelRes.unitB.dps}</b></div>
                <div>Time to Kill A: <b>${duelRes.unitB.ttkSec}s</b></div>
                <div>Remaining HP: <b>${duelRes.unitB.remHpPct}%</b></div>
              </div>
            </div>
          </div>
        `
            : ''
        }

        <div class="rounded-xl border border-slate-800 bg-slate-950/80 p-3 flex flex-col gap-2">
          <span class="text-xs font-black text-amber-300">📊 Full Roster Matchup Matrix (${uA.name} vs All Units)</span>
          <table class="w-full text-[11px] border-collapse">
            <thead>
              <tr class="border-b border-slate-700 text-slate-400">
                <th class="py-1 px-2 text-left">Opponent</th>
                <th class="py-1 px-2 text-center">Result</th>
                <th class="py-1 px-2 text-right">TTK</th>
                <th class="py-1 px-2 text-right">Winner HP</th>
              </tr>
            </thead>
            <tbody>
              ${matrixRows}
            </tbody>
          </table>
        </div>
      </div>
    `;

    leftEl.querySelector('#ub-sim-select-a')?.addEventListener('change', (e) => {
      this.selectedUnitId = e.target.value;
      this._renderWorkspace();
    });
    leftEl.querySelector('#ub-sim-select-b')?.addEventListener('change', (e) => {
      this.duelOpponentId = e.target.value;
      this._renderWorkspace();
    });
    leftEl.querySelector('#ub-sim-left-squad')?.addEventListener('click', () => {
      this.duelMode = 'squad';
      this._renderWorkspace();
    });
    leftEl.querySelector('#ub-sim-left-1v1')?.addEventListener('click', () => {
      this.duelMode = '1v1';
      this._renderWorkspace();
    });
    rightEl.querySelectorAll('[data-sim-pick-opp]').forEach((row) => {
      row.addEventListener('click', () => {
        this.duelOpponentId = row.getAttribute('data-sim-pick-opp');
        this._renderWorkspace();
      });
    });
  }

  _captureUnit3DPortraitDataUrl(unitId, viewMode = 'bust') {
    if (this.renderer && this.scene && this.camera) {
      const gridChild = this.pedestalGroup?.children?.find((c) => c.type === 'GridHelper' || c.isGridHelper);
      const prevGridVis = gridChild ? gridChild.visible : true;
      if (gridChild) gridChild.visible = false;
      try {
        this.renderer.render(this.scene, this.camera);
        const srcCanvas = this.renderer.domElement;
        const sw = srcCanvas.width || 512;
        const sh = srcCanvas.height || 512;
        const side = Math.min(sw, sh);
        const sx = Math.floor((sw - side) * 0.5);
        const sy = Math.floor((sh - side) * 0.5);
        const outCanvas = document.createElement('canvas');
        outCanvas.width = 256;
        outCanvas.height = 256;
        const ctx = outCanvas.getContext('2d');
        if (ctx && typeof ctx.drawImage === 'function') {
          ctx.drawImage(srcCanvas, sx, sy, side, side, 0, 0, 256, 256);
          const url = outCanvas.toDataURL('image/png');
          if (url && url.startsWith('data:image/')) {
            return url;
          }
        }
        if (typeof srcCanvas.toDataURL === 'function') {
          const fallbackUrl = srcCanvas.toDataURL('image/png');
          if (fallbackUrl && fallbackUrl.startsWith('data:image/')) {
            return fallbackUrl;
          }
        }
      } catch (_) {
      } finally {
        if (gridChild) gridChild.visible = prevGridVis;
        this.renderer.render(this.scene, this.camera);
      }
    }
    try {
      const uStat = this.stateManager.unitStatsData.units?.[unitId];
      const faction = uStat?.race || 'human';
      const factory = new ModelFactory(this.stateManager.unitsVisualsData);
      const studio = createPortraitStudio(factory, this.stateManager.unitsVisualsData);
      const canvas = studio.render(unitId, faction, {
        size: 256,
        view: viewMode,
        angle: 'three_quarter',
        background: 'transparent'
      });
      const dataUrl = canvas.toDataURL('image/png');
      studio.dispose();
      return dataUrl;
    } catch (_) {
      return null;
    }
  }

  _spawnPreview3D({ preserveCamera = true } = {}) {
    const camCtxKey = `${this.activeTab}:${this.selectedUnitId}:${this.selectedBuildingId}`;
    const shouldResetCam = !preserveCamera || this._lastCameraContextKey !== camCtxKey;
    this._lastCameraContextKey = camCtxKey;
    if (!this.pedestalGroup) return;
    if (this.previewActorGroup) {
      this.pedestalGroup.remove(this.previewActorGroup);
      disposeVisual(this.previewActorGroup);
      this.previewActorGroup = null;
    }
    this.unitAnimator = null;
    this.buildingActor = null;

    const topBar = this.rootContainer.querySelector('#ub-viewport-top-bar');
    const bottomBar = this.rootContainer.querySelector('#ub-viewport-bottom-bar');

    if (this.activeTab === 'units') {
      const uStat = this.stateManager.unitStatsData.units?.[this.selectedUnitId];
      const uVis = this.stateManager.unitsVisualsData.units?.[this.selectedUnitId];
      if (!uStat || !uVis) return;

      const factory = new ModelFactory(this.stateManager.unitsVisualsData);
      const savedMainEq = uVis.equipment;
      uVis.equipment = equipmentOf(uVis, this.activeLoadoutId);
      let grp;
      try {
        grp = factory.createVisual(this.selectedUnitId, {
          teamId: 1,
          isBannerCarrier: false
        });
      } finally {
        uVis.equipment = savedMainEq;
      }
      applySkinColors(grp, uVis, uStat.race || 'human');
      this.previewActorGroup = grp;
      this.pedestalGroup.add(grp);

      this.unitAnimator = new Animator3D(grp, this.stateManager.unitsVisualsData.animations, {
        entityId: 1
      });
      this._applyUnitPreviewAnim(this.activeUnitAnim);

      if (shouldResetCam) {
        this.camDist = uStat.isMounted || uStat.isSiege ? 5.2 : 3.8;
        this.camTarget.set(0, uStat.isMounted ? 1.35 : 1.0, 0);
      }
      this._updateCameraOrbit();

      const asLd = asLoadout(uVis, this.activeLoadoutId);
      const { actions } = grantedActions(this.stateManager.unitsVisualsData, asLd, ACTION_CLIPS);
      const reqAnims = ['idle', uStat.isMounted ? 'gallop' : 'walk', ...actions];

      const activeCaps = computeCapabilitiesForLoadout(
        uStat,
        uVis,
        this.stateManager.unitsVisualsData,
        this.activeLoadoutId
      );

      if (topBar) {
        topBar.innerHTML = `
          <div class="pointer-events-auto rounded-2xl border border-slate-700/80 bg-slate-900/90 px-3.5 py-2 backdrop-blur-md shadow-xl">
            <div class="text-sm font-black text-amber-300">${uStat.name} <span class="text-xs text-slate-400 mono">(${uStat.id})</span></div>
            <div class="text-[10px] text-sky-300 mt-0.5">Weapon Clips: <span class="mono font-bold text-slate-200">${reqAnims.join(' • ')}</span></div>
            <div class="text-[10px] text-emerald-300 mt-0.5">Active Set Capabilities: <span class="mono font-bold text-slate-200">${[...activeCaps.allowedFormations, ...activeCaps.allowedModes].join(' • ')}</span></div>
          </div>

          <button type="button" id="ub-btn-open-sim-tab" class="pointer-events-auto rounded-xl border border-amber-400/70 bg-amber-500/20 hover:bg-amber-500/30 px-3 py-1.5 text-xs font-extrabold text-amber-200 shadow-lg cursor-pointer transition">
            📊 Open Battle Simulation Page →
          </button>
        `;
        topBar.querySelector('#ub-btn-open-sim-tab')?.addEventListener('click', () => {
          this.activeTab = 'simulation';
          this._syncTabButtons();
          this._renderWorkspace();
        });
      }

      if (bottomBar) {
        const previewAnims = [
          { id: 'idle', label: 'Idle' },
          { id: 'walk', label: uStat.isMounted ? 'Gallop' : 'Walk' },
          { id: 'run', label: 'Run' },
          { id: 'attack', label: 'Attack' },
          { id: 'switch_weapon', label: 'Switch Weapon' },
          { id: 'block', label: 'Block' },
          { id: 'die', label: 'Die' }
        ];
        bottomBar.innerHTML = `
          ${previewAnims
            .map(
              (a) => `
            <button type="button" data-preview-unit-anim="${a.id}" class="rounded-lg px-2.5 py-1 text-xs font-bold transition cursor-pointer ${
              this.activeUnitAnim === a.id
                ? 'bg-amber-500 text-slate-950 shadow'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }">${a.label}</button>
          `
            )
            .join('')}
          <div class="h-4 w-px bg-slate-700 mx-1"></div>
          <button type="button" id="ub-btn-jump-unit-anim" class="rounded-lg bg-sky-500 hover:bg-sky-400 px-3.5 py-1 text-xs font-black text-slate-950 shadow cursor-pointer">
            🎬 Edit Unit Animations
          </button>
        `;
        bottomBar.querySelectorAll('[data-preview-unit-anim]').forEach((btn) => {
          btn.addEventListener('click', () => {
            this.activeUnitAnim = btn.getAttribute('data-preview-unit-anim');
            this._spawnPreview3D();
          });
        });
        bottomBar.querySelector('#ub-btn-jump-unit-anim')?.addEventListener('click', () => {
          this._openContextualAnimationLab();
        });
      }
    } else if (this.activeTab === 'simulation') {
      const uStatA = this.stateManager.unitStatsData.units?.[this.selectedUnitId];
      const uVisA = this.stateManager.unitsVisualsData.units?.[this.selectedUnitId];
      const uStatB = this.stateManager.unitStatsData.units?.[this.duelOpponentId];
      const uVisB = this.stateManager.unitsVisualsData.units?.[this.duelOpponentId];
      if (!uStatA || !uVisA || !uStatB || !uVisB) return;

      const factory = new ModelFactory(this.stateManager.unitsVisualsData);
      const duelGroup = new THREE.Group();

      const asLdA = asLoadout(uVisA, this.activeLoadoutId);
      const savedMainEqA = uVisA.equipment;
      uVisA.equipment = asLdA.equipment || uVisA.equipment;
      let grpA;
      try {
        grpA = factory.createVisual(this.selectedUnitId, { teamId: 1, isBannerCarrier: false });
      } finally {
        uVisA.equipment = savedMainEqA;
      }
      applySkinColors(grpA, uVisA, uStatA.race || 'human');
      grpA.position.set(-1.35, 0, 0);
      grpA.rotation.y = Math.PI * 0.5;
      duelGroup.add(grpA);

      const grpB = factory.createVisual(this.duelOpponentId, { teamId: 2, isBannerCarrier: false });
      applySkinColors(grpB, uVisB, uStatB.race || 'human');
      grpB.position.set(1.35, 0, 0);
      grpB.rotation.y = -Math.PI * 0.5;
      duelGroup.add(grpB);

      this.previewActorGroup = duelGroup;
      this.pedestalGroup.add(duelGroup);

      this.unitAnimator = new Animator3D(grpA, this.stateManager.unitsVisualsData.animations, { entityId: 1 });
      this.simOpponentAnimator = new Animator3D(grpB, this.stateManager.unitsVisualsData.animations, { entityId: 2 });
      const data = this.stateManager.unitsVisualsData;
      const raceA = uStatA.race || 'human';
      const raceB = uStatB.race || 'human';
      this.unitAnimator.setLocomotion(resolveClip(data, this.selectedUnitId, raceA, 'idle'), 1.0);
      this.simOpponentAnimator.setLocomotion(resolveClip(data, this.duelOpponentId, raceB, 'idle'), 1.0);
      const cBaseA = getCombatBase(asLdA, raceA, data.prefabs);
      const cBaseB = getCombatBase(uVisB, raceB, data.prefabs);
      this.unitAnimator.playAction(resolveClip(data, this.selectedUnitId, raceA, cBaseA), { restart: true, loop: true });
      this.simOpponentAnimator.playAction(resolveClip(data, this.duelOpponentId, raceB, cBaseB), { restart: true, loop: true });

      this.camDist = 5.4;
      this.camTarget.set(0, 1.15, 0);
      this._updateCameraOrbit();

      const duelRes = this.stateManager.simulateUnitDuel(this.selectedUnitId, this.duelOpponentId, this.duelMode);
      if (topBar && duelRes) {
        topBar.innerHTML = `
          <div class="pointer-events-auto rounded-2xl border border-amber-400/60 bg-slate-900/95 px-4 py-2.5 backdrop-blur-md shadow-2xl flex items-center gap-4">
            <div class="text-xs font-black text-sky-300">🔵 ${duelRes.unitA.name} (${duelRes.unitA.count}x • ${duelRes.unitA.dps} DPS)</div>
            <span class="text-xs font-extrabold text-amber-400">VS</span>
            <div class="text-xs font-black text-rose-300">🔴 ${duelRes.unitB.name} (${duelRes.unitB.count}x • ${duelRes.unitB.dps} DPS)</div>
          </div>
          <div class="pointer-events-auto rounded-2xl border border-emerald-400/60 bg-slate-900/95 px-4 py-2.5 backdrop-blur-md shadow-2xl">
            <span class="text-xs font-black text-emerald-300">🏆 Winner: ${duelRes.winnerName} in ${duelRes.durationSec}s (${duelRes.winnerId === this.selectedUnitId ? duelRes.unitA.remHpPct : duelRes.unitB.remHpPct}% HP remaining)</span>
          </div>
        `;
      }
      if (bottomBar) {
        bottomBar.innerHTML = `
          <button type="button" id="ub-sim-mode-squad" class="rounded-lg px-3.5 py-1 text-xs font-extrabold cursor-pointer ${
            this.duelMode === 'squad' ? 'bg-amber-500 text-slate-950 shadow' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }">⚔️ Full Squad vs Squad</button>
          <button type="button" id="ub-sim-mode-1v1" class="rounded-lg px-3.5 py-1 text-xs font-extrabold cursor-pointer ${
            this.duelMode === '1v1' ? 'bg-amber-500 text-slate-950 shadow' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }">🤺 1v1 Single Soldier</button>
          <button type="button" id="ub-sim-swap-btn" class="rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1 text-xs font-black text-slate-950 cursor-pointer">⇄ Swap Units</button>
        `;
        bottomBar.querySelector('#ub-sim-mode-squad')?.addEventListener('click', () => {
          this.duelMode = 'squad';
          this._renderWorkspace();
        });
        bottomBar.querySelector('#ub-sim-mode-1v1')?.addEventListener('click', () => {
          this.duelMode = '1v1';
          this._renderWorkspace();
        });
        bottomBar.querySelector('#ub-sim-swap-btn')?.addEventListener('click', () => {
          const tmp = this.selectedUnitId;
          this.selectedUnitId = this.duelOpponentId;
          this.duelOpponentId = tmp;
          this._renderWorkspace();
        });
      }
    } else {
      const bDef = this.stateManager.buildingsData.buildings?.[this.selectedBuildingId];
      if (!bDef) return;
      const canRecruit = canBuildingRecruitUnits(bDef);
      if (!canRecruit) {
        this.bldPreviewDoorOpen = false;
      }

      const hasWt =
        this.bldPreviewWatchtower &&
        bDef.hasWatchtowerSupport !== false &&
        ((bDef.watchtowerLevel | 0) > 0 || Boolean(bDef.hasBuiltInTurret));
      const previewLv = bDef.canAutoLevel ? Math.max(1, Math.min((bDef.maxLevel | 0) || 3, this.bldPreviewLevel || 1)) : 1;
      const effHasWt =
        hasWt &&
        (Boolean(bDef.hasBuiltInTurret) || previewLv >= Math.max(1, (bDef.watchtowerLevel | 0) || 3));
      this.buildingModelFactory.buildingsSource = this.stateManager.buildingsData;
      const actor = this.buildingModelFactory.createBuildingActor(
        {
          id: 1,
          type: bDef.id,
          team: 1,
          level: previewLv,
          footprintRadiusMeters: bDef.footprintRadiusMeters || 5,
          isCompleted: !this.bldPreviewScaffold,
          hasWatchtower: effHasWt,
          hp: bDef.maxHp || 1200,
          maxHp: bDef.maxHp || 1200
        },
        { isGhost: false }
      );
      this.buildingModelFactory.updateBuildingLiveState?.(
        actor,
        {
          isCompleted: !this.bldPreviewScaffold,
          level: previewLv,
          hasWatchtower: effHasWt,
          isDoorOpen: this.bldPreviewDoorOpen,
          hp: bDef.maxHp || 1200,
          maxHp: bDef.maxHp || 1200
        },
        bDef,
        0.05
      );
      this.buildingActor = actor;
      this.previewActorGroup = actor.group;
      this.pedestalGroup.add(actor.group);

      const r = Number(bDef.footprintRadiusMeters) || 5;
      if (shouldResetCam) {
        this.camDist = Math.max(12, r * 2.5);
        this.camTarget.set(0, 2.8, 0);
      }
      this._updateCameraOrbit();

      if (topBar) {
        const garrisonNote =
          bDef.id === 'watchtower' || bDef.id === 'ballista_tower'
            ? ` • Arrow Slits: ${(bDef.maxGarrison | 0) > 0 ? `Active (${bDef.maxGarrison} squads)` : 'Hidden (0 squads)'}`
            : '';
        topBar.innerHTML = `
          <div class="pointer-events-auto rounded-2xl border border-slate-700/80 bg-slate-900/90 px-3.5 py-2 backdrop-blur-md shadow-xl">
            <div class="text-sm font-black text-amber-300">${bDef.name} <span class="text-xs text-slate-400 mono">(${bDef.id})</span></div>
            <div class="text-[10px] text-emerald-300 mt-0.5">Levels: ${bDef.canAutoLevel ? `1–${bDef.maxLevel ?? 3} (+${bDef.trainSpeedBonusPctPerLevel ?? 0}% speed/lv)` : 'Fixed Lv.1'} • Watchtower: ${bDef.hasWatchtowerSupport !== false ? 'Enabled' : 'Disabled'}${garrisonNote}</div>
          </div>
        `;
      }

      if (bottomBar) {
        bottomBar.innerHTML = `
          ${
            canRecruit
              ? `<button type="button" id="ub-bld-toggle-door" class="rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer ${
                  this.bldPreviewDoorOpen ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }">🚪 ${this.bldPreviewDoorOpen ? 'Gate Open' : 'Gate Closed'}</button>`
              : ''
          }
          <button type="button" id="ub-bld-toggle-wt" class="rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer ${
            this.bldPreviewWatchtower ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }">🗼 Watchtower Preview</button>
          <button type="button" id="ub-bld-toggle-scaf" class="rounded-lg px-3 py-1 text-xs font-bold transition cursor-pointer ${
            this.bldPreviewScaffold ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }">🏗️ Construction View</button>
          <div class="h-4 w-px bg-slate-700 mx-1"></div>
          <button type="button" id="ub-btn-jump-bld-anim" class="rounded-lg bg-sky-500 hover:bg-sky-400 px-3.5 py-1 text-xs font-black text-slate-950 shadow cursor-pointer">
            🎬 Edit Building Animations
          </button>
        `;
        bottomBar.querySelector('#ub-bld-toggle-door')?.addEventListener('click', () => {
          this.bldPreviewDoorOpen = !this.bldPreviewDoorOpen;
          this._spawnPreview3D();
        });
        bottomBar.querySelector('#ub-bld-toggle-wt')?.addEventListener('click', () => {
          this.bldPreviewWatchtower = !this.bldPreviewWatchtower;
          this._spawnPreview3D();
        });
        bottomBar.querySelector('#ub-bld-toggle-scaf')?.addEventListener('click', () => {
          this.bldPreviewScaffold = !this.bldPreviewScaffold;
          this._spawnPreview3D();
        });
        bottomBar.querySelector('#ub-btn-jump-bld-anim')?.addEventListener('click', () => {
          this._openContextualAnimationLab();
        });
      }
    }
  }

  _applyUnitPreviewAnim(animMode) {
    if (!this.unitAnimator) return;
    const uStat = this.stateManager.unitStatsData.units?.[this.selectedUnitId];
    const uVis = this.stateManager.unitsVisualsData.units?.[this.selectedUnitId];
    const faction = uStat?.race || uVis?.race || 'human';
    const data = this.stateManager.unitsVisualsData;
    const asLd = asLoadout(uVis, this.activeLoadoutId);
    if (animMode === 'walk' || animMode === 'gallop') {
      this.unitAnimator.cancelAction?.();
      const locoBase = uStat?.isMounted || uVis?.mountHierarchy ? 'gallop' : getLocomotionBase(asLd, faction);
      const clip = resolveClip(data, this.selectedUnitId, faction, locoBase);
      this.unitAnimator.setLocomotion(clip, 1.0);
    } else if (animMode === 'run' || animMode === 'charge' || animMode === 'retreat_run') {
      this.unitAnimator.cancelAction?.();
      const moveBase = uStat?.isMounted || uVis?.mountHierarchy ? 'gallop' : animMode;
      const clip = resolveClip(data, this.selectedUnitId, faction, moveBase);
      this.unitAnimator.setLocomotion(clip, 1.0);
    } else if (animMode === 'attack') {
      const idleClip = resolveClip(data, this.selectedUnitId, faction, 'idle');
      this.unitAnimator.setLocomotion(idleClip, 1.0);
      const cBase = getCombatBase(asLd, faction, data.prefabs);
      const clip = resolveClip(data, this.selectedUnitId, faction, cBase);
      this.unitAnimator.playAction(clip, { restart: true, loop: true });
    } else if (
      animMode === 'switch_weapon' ||
      animMode === 'block' ||
      animMode === 'die' ||
      animMode === 'take_damage' ||
      animMode === 'victory_cheer'
    ) {
      const idleClip = resolveClip(data, this.selectedUnitId, faction, 'idle');
      this.unitAnimator.setLocomotion(idleClip, 1.0);
      const clip = resolveClip(data, this.selectedUnitId, faction, animMode);
      this.unitAnimator.playAction(clip, { restart: true, loop: true });
    } else {
      this.unitAnimator.cancelAction?.();
      const idleClip = resolveClip(data, this.selectedUnitId, faction, 'idle');
      this.unitAnimator.setLocomotion(idleClip, 1.0);
    }
  }

  _bindUnitsEvents() {
    const leftEl = this.rootContainer.querySelector('#ub-left-sidebar');
    const rightEl = this.rootContainer.querySelector('#ub-right-inspector');

    leftEl?.querySelectorAll('[data-select-unit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedUnitId = btn.getAttribute('data-select-unit');
        this.activeLoadoutId = MAIN_LOADOUT;
        this._renderWorkspace();
      });
    });

    // Base chosen for the NEXT new unit (kept on the state manager so it survives re-rendering the left bar)
    leftEl?.querySelector('#ub-new-unit-base')?.addEventListener('change', (e) => {
      this.stateManager.newUnitBaseId = e.target.value;
    });

    // Fix 1 (Part A): Create New Unit starting from a clean Base Character (chosen in the selector above the button, unarmed)
    leftEl?.querySelector('#ub-btn-create-unit')?.addEventListener('click', () => {
      const count = Object.keys(this.stateManager.unitStatsData.units || {}).length + 1;
      const newId = this.stateManager.createNewUnit({
        name: `New Unit #${count}`,
        baseCharId: leftEl.querySelector('#ub-new-unit-base')?.value || this.stateManager.newUnitBaseId || DEFAULT_BASE_CHAR_ID,
        mountType: 'none',
        weaponR: 'none',
        weaponL: 'none'
      });
      this.selectedUnitId = newId;
      this.activeLoadoutId = MAIN_LOADOUT;
      this._renderWorkspace();
      this._toast(`Created new base unit "${newId}"`);
    });

    // Fix 1 (Part B): Copy Selected Unit (e.g. `swordsman`) with all its gear, mount & stats
    leftEl?.querySelector('#ub-btn-duplicate-unit')?.addEventListener('click', () => {
      const dupId = this.stateManager.duplicateUnit(this.selectedUnitId);
      if (dupId) {
        this.selectedUnitId = dupId;
        this.activeLoadoutId = MAIN_LOADOUT;
        this._renderWorkspace();
        this._toast(`Copied unit as "${dupId}"`);
      }
    });

    const handleDeleteUnitById = (delId) => {
      if (!this.stateManager.deleteUnit(delId)) return;
      const remainingKeys = Object.keys(this.stateManager.unitStatsData.units);
      if (!this.stateManager.unitStatsData.units[this.selectedUnitId]) {
        this.selectedUnitId = remainingKeys.find((k) => k !== 'worker') || remainingKeys[0] || 'worker';
      }
      this._renderWorkspace();
      this._toast(`Deleted unit "${delId}"`);
    };

    rightEl?.querySelector('#ub-btn-delete-unit')?.addEventListener('click', () => {
      handleDeleteUnitById(this.selectedUnitId);
    });
    leftEl?.querySelector('#ub-btn-delete-unit-left')?.addEventListener('click', () => {
      handleDeleteUnitById(this.selectedUnitId);
    });
    leftEl?.querySelectorAll('[data-delete-unit-row]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteUnitById(btn.getAttribute('data-delete-unit-row'));
      });
    });

    // Portrait 1: Building Recruitment Portrait (Capture 3D / Upload / Clear)
    rightEl?.querySelector('#ub-btn-pose-capture-studio')?.addEventListener('click', () => {
      this.stateManager.saveAll();
      if (this.onOpenAnimationLab) {
        this.onOpenAnimationLab({
          contextualUnitId: this.selectedUnitId,
          initialCategory: 'units',
          initialAnim: this.previewAnimBase || 'idle',
          initialLoadoutIdx: this.activeLoadoutId && this.activeLoadoutId !== 'main' ? 1 : 0,
          initialInspectorTab: 'icons'
        });
      }
    });
    rightEl?.querySelector('#ub-btn-capture-recruit-portrait')?.addEventListener('click', () => {
      const dataUrl = this._captureUnit3DPortraitDataUrl(this.selectedUnitId, 'bust');
      if (dataUrl) {
        this.stateManager.setUnitPortraits(this.selectedUnitId, { recruitPortraitUrl: dataUrl });
        this._renderWorkspace();
        this._toast('Captured 3D Building Recruitment Portrait!');
      }
    });
    const recUploadInp = rightEl?.querySelector('#ub-input-upload-recruit-portrait');
    rightEl?.querySelector('#ub-btn-upload-recruit-portrait')?.addEventListener('click', () => recUploadInp?.click());
    recUploadInp?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        this.stateManager.setUnitPortraits(this.selectedUnitId, { recruitPortraitUrl: String(reader.result) });
        this._renderWorkspace();
        this._toast('Uploaded Building Recruitment Portrait!');
      };
      reader.readAsDataURL(file);
    });
    rightEl?.querySelector('#ub-btn-clear-recruit-portrait')?.addEventListener('click', () => {
      this.stateManager.setUnitPortraits(this.selectedUnitId, { recruitPortraitUrl: null });
      this._renderWorkspace();
    });

    // Portrait 2: Multi-Squad Selection Bar Icon (Capture 3D / Upload / Clear)
    rightEl?.querySelector('#ub-btn-capture-squad-icon')?.addEventListener('click', () => {
      const dataUrl = this._captureUnit3DPortraitDataUrl(this.selectedUnitId, 'bust');
      if (dataUrl) {
        this.stateManager.setUnitPortraits(this.selectedUnitId, { squadCardIconUrl: dataUrl });
        this._renderWorkspace();
        this._toast('Captured 3D Multi-Squad Selection Icon!');
      }
    });
    const sqUploadInp = rightEl?.querySelector('#ub-input-upload-squad-icon');
    rightEl?.querySelector('#ub-btn-upload-squad-icon')?.addEventListener('click', () => sqUploadInp?.click());
    sqUploadInp?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        this.stateManager.setUnitPortraits(this.selectedUnitId, { squadCardIconUrl: String(reader.result) });
        this._renderWorkspace();
        this._toast('Uploaded Multi-Squad Selection Icon!');
      };
      reader.readAsDataURL(file);
    });
    rightEl?.querySelector('#ub-btn-clear-squad-icon')?.addEventListener('click', () => {
      this.stateManager.setUnitPortraits(this.selectedUnitId, { squadCardIconUrl: null });
      this._renderWorkspace();
    });

    // Visual Icon Picker Grid Buttons (Recruit, Squad Bar, Map & Flag Placeholder)
    rightEl?.querySelectorAll('[data-ub-pick-icon-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = btn.getAttribute('data-ub-pick-icon-slot');
        const key = btn.getAttribute('data-ub-pick-icon-key') || 'auto';
        const customEntry = (this.stateManager.unitStatsData.customPlaceholderIcons || []).find((c) => c.id === key);
        if (slot === 'recruit') {
          this.stateManager.setUnitPortraits(this.selectedUnitId, {
            recruitIconKey: key,
            recruitPortraitUrl: customEntry ? customEntry.dataUrl : null
          });
        } else if (slot === 'squad') {
          this.stateManager.setUnitPortraits(this.selectedUnitId, {
            squadCardIconKey: key,
            squadCardIconUrl: customEntry ? customEntry.dataUrl : null
          });
        } else if (slot === 'placeholder') {
          if (this.activeLoadoutId && this.activeLoadoutId !== MAIN_LOADOUT) {
            this.stateManager.setUnitPortraits(this.selectedUnitId, {
              placeholderIconKeySet2: key,
              placeholderIconUrlSet2: customEntry ? customEntry.dataUrl : null
            });
          } else {
            this.stateManager.setUnitPortraits(this.selectedUnitId, {
              placeholderIconKey: key,
              placeholderIconUrl: customEntry ? customEntry.dataUrl : null
            });
          }
        }
        this._renderWorkspace();
      });
    });

    const addLibInp = rightEl?.querySelector('#ub-input-add-default-library-icon');
    rightEl?.querySelector('#ub-btn-add-default-library-icon')?.addEventListener('click', () => addLibInp?.click());
    addLibInp?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        const baseLabel = file.name.replace(/\.[^.]+$/, '') || 'Custom Icon';
        const iconId = this.stateManager.addCustomPlaceholderIcon({ label: baseLabel, dataUrl });
        if (iconId) {
          this._renderWorkspace();
          this._toast(`Added "${baseLabel}" to Default Icon Library!`);
        }
      };
      reader.readAsDataURL(file);
    });

    rightEl?.querySelector('#ub-select-recruit-icon')?.addEventListener('change', (e) => {
      this.stateManager.setUnitPortraits(this.selectedUnitId, {
        recruitIconKey: e.target.value,
        recruitPortraitUrl: null
      });
      this._renderWorkspace();
    });

    rightEl?.querySelector('#ub-select-squad-icon')?.addEventListener('change', (e) => {
      this.stateManager.setUnitPortraits(this.selectedUnitId, {
        squadCardIconKey: e.target.value,
        squadCardIconUrl: null
      });
      this._renderWorkspace();
    });

    rightEl?.querySelector('#ub-select-placeholder-icon')?.addEventListener('change', (e) => {
      const val = e.target.value;
      const customEntry = (this.stateManager.unitStatsData.customPlaceholderIcons || []).find((c) => c.id === val);
      this.stateManager.setUnitPortraits(this.selectedUnitId, {
        placeholderIconKey: val,
        placeholderIconUrl: customEntry ? customEntry.dataUrl : null
      });
      this._renderWorkspace();
    });

    const phUploadInp = rightEl?.querySelector('#ub-input-upload-placeholder-icon');
    rightEl?.querySelector('#ub-btn-upload-placeholder-icon')?.addEventListener('click', () => phUploadInp?.click());
    phUploadInp?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        const baseLabel = file.name.replace(/\.[^.]+$/, '') || 'Custom Symbol';
        const iconId = this.stateManager.addCustomPlaceholderIcon({ label: baseLabel, dataUrl });
        if (iconId) {
          this.stateManager.setUnitPortraits(this.selectedUnitId, {
            placeholderIconKey: iconId,
            placeholderIconUrl: dataUrl
          });
          this._renderWorkspace();
          this._toast(`Added "${baseLabel}" to Placeholder Symbols!`);
        }
      };
      reader.readAsDataURL(file);
    });

    // Base Character: move the selected unit onto another base of its race (body replaced; gear, weapons, stats, mount, animations kept)
    rightEl?.querySelector('#ub-unit-base-select')?.addEventListener('change', (e) => {
      const wanted = e.target.value;
      const cur = this.stateManager.getUnitBaseId(this.selectedUnitId);
      const label = (id) => BASE_CHARACTER_TEMPLATES.find((b) => b.id === id)?.label || id;
      if (!wanted || wanted === cur) return;
      const ok = globalThis.confirm?.(
        `Switch "${this.selectedUnitId}" from ${label(cur)} to ${label(wanted)}?\n\n` +
        'The body (bones and meshes) is replaced by the new base.\n' +
        'Kept: stats, weapons, armour/clothing, loadouts, mount, animations. Worn gear is re-fitted to the new skeleton, ' +
        'but may need touching up because the bodies are shaped differently. A bare base gets basic clothing in empty clothing slots.\n\n' +
        'Any hand-edits made to this unit\'s own body or skeleton are lost.'
      );
      if (ok === false) {
        e.target.value = cur;
        return;
      }
      const res = this.stateManager.rebaseUnit(this.selectedUnitId, wanted);
      this._renderWorkspace();
      this._toast(
        res.ok
          ? `"${this.selectedUnitId}" now uses ${label(wanted)}${res.dressed?.some((x) => !x.startsWith('-')) ? ' (basic clothing added)' : ''}`
          : `Could not switch base: ${res.reason}`
      );
    });

    // Fix 5: Mount dropdown (`None`, `Warhorse`, `Dire Wolf`, `War Chameleon`)
    rightEl?.querySelector('#ub-unit-mount-select')?.addEventListener('change', (e) => {
      const mountType = e.target.value;
      this.stateManager.setUnitMount(this.selectedUnitId, mountType);
      this._renderWorkspace();
    });

    // Loadout switch / add / delete
    rightEl?.querySelectorAll('[data-unit-loadout]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeLoadoutId = btn.getAttribute('data-unit-loadout') || MAIN_LOADOUT;
        this._renderWorkspace();
      });
    });

    rightEl?.querySelector('#ub-btn-add-loadout')?.addEventListener('click', () => {
      const uVis = this.stateManager.unitsVisualsData.units[this.selectedUnitId];
      if (!uVis) return;
      if (!uVis.loadouts) uVis.loadouts = {};
      uVis.loadouts.loadout2 = {
        label: 'Set 2',
        equipment: JSON.parse(JSON.stringify(uVis.equipment || {}))
      };
      this.activeLoadoutId = 'loadout2';
      restow(this.stateManager.unitsVisualsData, uVis);
      this.stateManager.saveAll();
      this._renderWorkspace();
    });

    rightEl?.querySelector('#ub-btn-del-loadout')?.addEventListener('click', () => {
      const uVis = this.stateManager.unitsVisualsData.units[this.selectedUnitId];
      if (!uVis?.loadouts) return;
      delete uVis.loadouts;
      this.activeLoadoutId = MAIN_LOADOUT;
      restow(this.stateManager.unitsVisualsData, uVis);
      this.stateManager.saveAll();
      this._renderWorkspace();
    });

    // Fix 4: Equip Hand Weapons (`weapon_socket_R`, `weapon_socket_L`) on the active Weapon Set
    rightEl?.querySelectorAll('[data-unit-weapon]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const socket = sel.getAttribute('data-unit-weapon');
        const prefabId = sel.value;
        const uVis = this.stateManager.unitsVisualsData.units[this.selectedUnitId];
        const uStat = this.stateManager.unitStatsData.units[this.selectedUnitId];
        if (!uVis || !uStat) return;

        let targetEq = uVis.equipment || (uVis.equipment = {});
        if (this.activeLoadoutId !== MAIN_LOADOUT && uVis.loadouts?.[this.activeLoadoutId]) {
          targetEq =
            uVis.loadouts[this.activeLoadoutId].equipment ||
            (uVis.loadouts[this.activeLoadoutId].equipment = {});
        }

        if (!prefabId || prefabId === 'none') {
          delete targetEq[socket];
        } else {
          const pDef = this.stateManager.unitsVisualsData.prefabs?.[prefabId];
          const isBowL = socket === 'weapon_socket_L' && (prefabId === 'bow' || pDef?.weaponType === 'bow');
          const defaultOffset = isBowL
            ? [0, 0.0726, -0.1077]
            : Array.isArray(pDef?.gripOffset)
              ? [...pDef.gripOffset]
              : [0, 0, 0];
          const defaultRot = isBowL
            ? [1.4437, 0, 0]
            : Array.isArray(pDef?.gripRotation)
              ? [...pDef.gripRotation]
              : [0, 0, 0];
          targetEq[socket] = {
            prefab: prefabId,
            gripOffset: defaultOffset,
            gripRotation: defaultRot
          };
        }

        restow(this.stateManager.unitsVisualsData, uVis);

        const dataVis = this.stateManager.unitsVisualsData;
        const wTypeR = weaponTypeOf(dataVis.prefabs?.[targetEq.weapon_socket_R?.prefab]);
        const wTypeL = weaponTypeOf(dataVis.prefabs?.[targetEq.weapon_socket_L?.prefab]);
        const resolvedCombatBase =
          getEquipmentCombatBase(targetEq, dataVis.prefabs, this.selectedUnitId) || 'attack_slash';
        const faction = uStat.race || uVis.race || 'human';
        const customClipName = `${this.selectedUnitId}_${faction}_${resolvedCombatBase}`;
        const effectiveCombatClip = dataVis.animations?.keyframes?.[customClipName]
          ? customClipName
          : resolvedCombatBase;
        uVis._gearConfiguredInLab = true;
        if (this.activeLoadoutId === MAIN_LOADOUT) {
          uVis.combatAnim = effectiveCombatClip;
          if (uVis.skins && uVis.skins[faction]) {
            uVis.skins[faction].combatAnim = effectiveCombatClip;
          }
          if (wTypeR === 'bow' || wTypeL === 'bow' || wTypeR === 'thrown') {
            uStat.isRanged = true;
            if ((uStat.maxAmmo | 0) <= 0) uStat.maxAmmo = 30;
            if ((uStat.attackRangeMeters | 0) <= 5) uStat.attackRangeMeters = 90;
            if ((uStat.rangedDamage | 0) <= 0) uStat.rangedDamage = 9;
          } else {
            uStat.isRanged = false;
          }
        } else if (uVis.loadouts?.[this.activeLoadoutId]) {
          uVis.loadouts[this.activeLoadoutId].combatAnim = effectiveCombatClip;
        }

        if (uStat.loadoutCapabilities) {
          delete uStat.loadoutCapabilities[this.activeLoadoutId];
        }
        const elig = computeEligibleFormationsForUnit(
          { ...uStat, allowedFormations: null },
          uVis,
          this.stateManager.unitsVisualsData,
          this.stateManager.unitStatsData.formationRules
        );
        uStat.allowedFormations = elig.filter((f) => f.eligible && f.enabled).map((f) => f.id);
        if (!uStat.allowedFormations.includes('square')) uStat.allowedFormations.unshift('square');

        this.stateManager.saveAll();
        this._renderWorkspace();
      });
    });

    // Fix 4: Equip Cosmetic Visual Appearance (Helmet, Chest, Cape, Mount Armor) across all loadouts
    const applyCosmeticSocket = (uVis, socket, prefabId) => {
      for (const eqObj of [
        uVis.equipment || (uVis.equipment = {}),
        ...Object.values(uVis.loadouts || {}).map((l) => l.equipment || (l.equipment = {}))
      ]) {
        if (!prefabId || prefabId === 'none') {
          delete eqObj[socket];
        } else {
          eqObj[socket] = {
            prefab: prefabId,
            gripOffset: eqObj[socket]?.gripOffset || [0, 0, 0],
            gripRotation: eqObj[socket]?.gripRotation || [0, 0, 0]
          };
        }
      }
    };

    rightEl?.querySelectorAll('[data-unit-appearance]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const socket = sel.getAttribute('data-unit-appearance');
        const prefabId = sel.value;
        const uVis = this.stateManager.unitsVisualsData.units[this.selectedUnitId];
        if (!uVis) return;
        applyCosmeticSocket(uVis, socket, prefabId);
        this.stateManager.saveAll();
        this._renderWorkspace();
      });
    });

    rightEl?.querySelectorAll('[data-unit-appearance-pair]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const pairKind = sel.getAttribute('data-unit-appearance-pair');
        const basePrefab = sel.value;
        const uVis = this.stateManager.unitsVisualsData.units[this.selectedUnitId];
        if (!uVis) return;
        const sockR = pairKind === 'shoulder' ? 'arm_R' : 'foot_R';
        const sockL = pairKind === 'shoulder' ? 'arm_L' : 'foot_L';
        if (!basePrefab || basePrefab === 'none') {
          applyCosmeticSocket(uVis, sockR, 'none');
          applyCosmeticSocket(uVis, sockL, 'none');
        } else {
          applyCosmeticSocket(uVis, sockR, `${basePrefab}_R`);
          applyCosmeticSocket(uVis, sockL, `${basePrefab}_L`);
        }
        this.stateManager.saveAll();
        this._renderWorkspace();
      });
    });

    // Fix 2 & Per-Set Capabilities: Single toggle button for each secondary formation & combat mode
    rightEl?.querySelectorAll('[data-unit-formation-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fId = btn.getAttribute('data-unit-formation-toggle');
        this.stateManager.toggleUnitLoadoutCapability(this.selectedUnitId, this.activeLoadoutId, 'formation', fId);
        this._renderWorkspace();
      });
    });

    rightEl?.querySelectorAll('[data-unit-mode-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mId = btn.getAttribute('data-unit-mode-toggle');
        this.stateManager.toggleUnitLoadoutCapability(this.selectedUnitId, this.activeLoadoutId, 'mode', mId);
        this._renderWorkspace();
      });
    });

    rightEl?.querySelectorAll('[data-unit-bool]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const key = chk.getAttribute('data-unit-bool');
        const uStat = this.stateManager.unitStatsData.units[this.selectedUnitId];
        if (!uStat) return;
        uStat[key] = Boolean(chk.checked);
        this.stateManager.saveAll();
        this._renderWorkspace();
      });
    });

    rightEl?.querySelectorAll('[data-worker-bool]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const key = chk.getAttribute('data-worker-bool');
        const uStat = this.stateManager.unitStatsData.units[this.selectedUnitId];
        if (!uStat) return;
        if (!uStat.workerGathering) uStat.workerGathering = {};
        uStat.workerGathering[key] = Boolean(chk.checked);
        this.stateManager.scheduleSave();
      });
    });

    rightEl?.querySelectorAll('[data-worker-resource]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const resKey = chk.getAttribute('data-worker-resource');
        const uStat = this.stateManager.unitStatsData.units[this.selectedUnitId];
        if (!uStat) return;
        if (!uStat.workerGathering) uStat.workerGathering = {};
        if (!uStat.workerGathering.allowedResources) {
          uStat.workerGathering.allowedResources = { wood: true, stone: true, iron: true, coins: true };
        }
        uStat.workerGathering.allowedResources[resKey] = Boolean(chk.checked);
        this.stateManager.saveAll();
        this._renderWorkspace();
      });
    });

    rightEl?.querySelectorAll('[data-unit-str]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.getAttribute('data-unit-str');
        const uStat = this.stateManager.unitStatsData.units[this.selectedUnitId];
        if (!uStat) return;
        uStat[key] = inp.value;
        this.stateManager.scheduleSave();
      });
    });

    rightEl?.querySelectorAll('[data-unit-field]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const pathStr = inp.getAttribute('data-unit-field');
        const val = Number(inp.value);
        if (!Number.isFinite(val)) return;
        const uStat = this.stateManager.unitStatsData.units[this.selectedUnitId];
        if (!uStat) return;
        setNestedField(uStat, pathStr, val);
        this.stateManager.scheduleSave();
      });
    });
  }

  _bindBuildingsEvents() {
    const leftEl = this.rootContainer.querySelector('#ub-left-sidebar');
    const rightEl = this.rootContainer.querySelector('#ub-right-inspector');

    leftEl?.querySelectorAll('[data-select-building]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedBuildingId = btn.getAttribute('data-select-building');
        this.bldPreviewLevel = 1;
        this._renderWorkspace({ preserveCamera: false });
      });
    });

    rightEl?.querySelectorAll('[data-bld-preview-level]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.bldPreviewLevel = Number(btn.getAttribute('data-bld-preview-level')) || 1;
        this._renderWorkspace();
      });
    });

    rightEl?.querySelector('[data-bld-skin-select]')?.addEventListener('change', (e) => {
      const sk = loadBuildingSkins()[this.selectedBuildingId];
      if (!sk) return;
      sk.active = e.target.value;
      saveBuildingSkins();
      this._spawnPreview3D();
    });

    rightEl?.querySelector('#ub-bld-preview-level-select')?.addEventListener('change', (e) => {
      this.bldPreviewLevel = Number(e.target.value) || 1;
      this._renderWorkspace();
    });

    rightEl?.querySelectorAll('[data-bld-level-feat]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const featId = chk.getAttribute('data-bld-level-feat');
        const lvNum = String(chk.getAttribute('data-bld-level-num') || this.bldPreviewLevel || 2);
        const bDef = this.stateManager.buildingsData.buildings[this.selectedBuildingId];
        if (!bDef || !featId) return;
        const upgMap = ensureBuildingLevelUpgradesConfig(bDef);
        if (!upgMap[lvNum]) upgMap[lvNum] = {};
        upgMap[lvNum][featId] = Boolean(chk.checked);
        this.stateManager.saveAll();
        this._renderWorkspace();
      });
    });

    // Two Explicit Toggles: Has Levels & Has Watchtower
    rightEl?.querySelector('#ub-bld-toggle-has-levels')?.addEventListener('click', () => {
      const bDef = this.stateManager.buildingsData.buildings[this.selectedBuildingId];
      if (!bDef) return;
      bDef.canAutoLevel = !bDef.canAutoLevel;
      if (bDef.canAutoLevel && (bDef.maxLevel | 0) < 2) {
        bDef.maxLevel = 3;
      }
      this.stateManager.saveAll();
      this._renderWorkspace();
    });

    rightEl?.querySelector('#ub-bld-toggle-has-wt')?.addEventListener('click', () => {
      const bDef = this.stateManager.buildingsData.buildings[this.selectedBuildingId];
      if (!bDef) return;
      const cur =
        bDef.hasWatchtowerSupport !== undefined
          ? Boolean(bDef.hasWatchtowerSupport)
          : (bDef.watchtowerLevel | 0) > 0 || Boolean(bDef.hasBuiltInTurret);
      bDef.hasWatchtowerSupport = !cur;
      if (!bDef.hasWatchtowerSupport) {
        bDef.watchtowerLevel = 0;
        bDef.hasBuiltInTurret = false;
      } else if ((bDef.watchtowerLevel | 0) <= 0) {
        bDef.watchtowerLevel = bDef.canAutoLevel ? 3 : 1;
      }
      this.stateManager.saveAll();
      this._renderWorkspace();
    });

    rightEl?.querySelectorAll('[data-bld-str]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.getAttribute('data-bld-str');
        const bDef = this.stateManager.buildingsData.buildings[this.selectedBuildingId];
        if (!bDef) return;
        bDef[key] = inp.value;
        this.stateManager.scheduleSave();
        if (key === 'mountedBallistaUnitId') {
          this._spawnPreview3D();
        }
      });
    });

    rightEl?.querySelectorAll('[data-bld-bool]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const key = chk.getAttribute('data-bld-bool');
        const bDef = this.stateManager.buildingsData.buildings[this.selectedBuildingId];
        if (!bDef) return;
        bDef[key] = Boolean(chk.checked);
        this.stateManager.scheduleSave();
      });
    });

    rightEl?.querySelectorAll('[data-bld-field]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const field = inp.getAttribute('data-bld-field');
        const val = Number(inp.value);
        if (!Number.isFinite(val)) return;
        const bDef = this.stateManager.buildingsData.buildings[this.selectedBuildingId];
        if (!bDef) return;

        if (field === 'buildTimeSec') {
          bDef.buildTimeTicks = Math.max(20, Math.round(val * 20));
        } else if (field === 'arrowProtectionPct') {
          bDef.arrowProtectionPermille = Math.max(0, Math.min(950, Math.round(val * 10)));
        } else if (field === 'meleeProtectionPct') {
          bDef.meleeProtectionPermille = Math.max(0, Math.min(950, Math.round(val * 10)));
        } else {
          setNestedField(bDef, field, val);
        }

        this.stateManager.scheduleSave();
        if (
          field === 'footprintRadiusMeters' ||
          field === 'watchtowerLevel' ||
          field === 'watchtowerX' ||
          field === 'watchtowerZ' ||
          field === 'maxGarrison' ||
          field.startsWith('turretOffset')
        ) {
          this._spawnPreview3D();
        }
      });
    });

    // Shared universal building watchtower fields
    rightEl?.querySelectorAll('[data-shared-wt]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.getAttribute('data-shared-wt');
        const val = Number(inp.value);
        if (!Number.isFinite(val)) return;
        if (!this.stateManager.buildingsData.sharedBuildingWatchtower) {
          this.stateManager.buildingsData.sharedBuildingWatchtower = {};
        }
        this.stateManager.buildingsData.sharedBuildingWatchtower[key] = val;
        if (key === 'reloadMinTicks') {
          this.stateManager.buildingsData.sharedBuildingWatchtower.reloadMaxTicks = val + 14;
        }
        this.stateManager.scheduleSave();
      });
    });

    // Per-option unlockLevel / trainTimeSec / xpReward / cost.coins edits
    rightEl?.querySelectorAll('[data-bld-opt-idx]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.getAttribute('data-bld-opt-idx'));
        const key = inp.getAttribute('data-bld-opt-key');
        const val = Number(inp.value);
        const bDef = this.stateManager.buildingsData.buildings[this.selectedBuildingId];
        const opt = bDef?.options?.[idx];
        if (!opt || !Number.isFinite(val)) return;

        if (key === 'unlockLevel') {
          opt.unlockLevel = Math.max(1, val | 0);
        } else if (key === 'trainTimeSec') {
          opt.trainTicks = Math.max(20, Math.round(val * 20));
        } else if (key === 'xpReward') {
          opt.xpReward = Math.max(0, val | 0);
        } else if (key === 'cost.coins') {
          if (!opt.cost) opt.cost = { coins: 0, wood: 0, stone: 0, iron: 0 };
          opt.cost.coins = Math.max(0, val | 0);
        }
        this.stateManager.scheduleSave();
      });
    });

    // Remove recruitment option from building
    rightEl?.querySelectorAll('[data-bld-del-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-bld-del-opt'));
        const bDef = this.stateManager.buildingsData.buildings[this.selectedBuildingId];
        if (!bDef || !Array.isArray(bDef.options)) return;
        bDef.options.splice(idx, 1);
        this.stateManager.saveAll();
        this._renderWorkspace();
      });
    });

    // Add unit recruitment option to this building at chosen unlock level
    rightEl?.querySelector('#ub-btn-add-unit-to-bld')?.addEventListener('click', () => {
      const uid = rightEl.querySelector('#ub-bld-add-unit-select')?.value;
      const unlockLv = Number(rightEl.querySelector('#ub-bld-add-unit-level')?.value) || 1;
      const bDef = this.stateManager.buildingsData.buildings[this.selectedBuildingId];
      const uStat = this.stateManager.unitStatsData.units?.[uid];
      if (!bDef || !uStat) return;

      if (!Array.isArray(bDef.options)) bDef.options = [];
      bDef.options.push({
        id: uid,
        name: uStat.name || uid,
        kind: 'unit',
        unitType: uid,
        unlockLevel: Math.max(1, unlockLv | 0),
        cost: JSON.parse(JSON.stringify(uStat.cost || { coins: 150, wood: 0, stone: 0, iron: 30 })),
        trainTicks: 120,
        xpReward: 40
      });
      this.stateManager.saveAll();
      this._renderWorkspace();
      this._toast(`Added ${uStat.name} to ${bDef.name} at Level ${unlockLv}`);
    });
  }

  _startLoop() {
    this._running = true;
    let last = performance.now();
    const step = (now) => {
      if (!this._running) return;
      const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
      last = now;

      try {
        if (this.viewportEl && this.renderer) {
          const cw = this.viewportEl.clientWidth;
          const ch = this.viewportEl.clientHeight;
          if (cw > 0 && ch > 0 && (this.renderer.domElement.width !== Math.floor(cw * this.renderer.getPixelRatio()) || this.renderer.domElement.height !== Math.floor(ch * this.renderer.getPixelRatio()))) {
            this._resizeHandler();
          }
        }
        if ((this.activeTab === 'units' || this.activeTab === 'simulation') && this.unitAnimator) {
          this.unitAnimator.update(dt);
          if (this.activeTab === 'simulation' && this.simOpponentAnimator) {
            this.simOpponentAnimator.update(dt);
          }
        } else if (this.activeTab === 'buildings' && this.buildingActor) {
          this.buildingModelFactory.updateDoorAnimation?.(
            this.buildingActor,
            this.bldPreviewDoorOpen,
            dt
          );
        }
      } catch (err) {
        console.warn('UnitsBuildingsLab preview update error:', err);
      }

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(step);
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(step);
    }
  }

  destroy() {
    this._running = false;
    clearTimeout(this._toastTimer);
    this._ro?.disconnect?.();
    if (this.previewActorGroup) {
      disposeVisual(this.previewActorGroup);
      this.previewActorGroup = null;
    }
    this.renderer?.dispose?.();
    if (this.rootContainer) {
      this.rootContainer.innerHTML = '';
    }
  }
}
