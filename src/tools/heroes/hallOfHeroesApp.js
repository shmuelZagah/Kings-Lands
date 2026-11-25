/**
 * Kings Lands — Phase 8: Hall of Heroes (היכל הגיבורים) — Clean Visual UI + Graph Spell Trees & Hybrid Nodes
 * (src/tools/heroes/hallOfHeroesApp.js)
 *
 * Refined UX:
 * - Left Panel: Clean list of Hero names + `+ Create New Hero` with Base Archetype picker (`Warrior`, `Archer`, `Wizard`).
 * - Center 3D Viewport: Interactive 3D Hero preview, Gear Set 1 / Set 2 preview toggle (when Hero has 2 gear sets),
 *   bottom animation bar (`Idle`, `Walk`, `Attack`, spells) with `Edit` button right beside animations,
 *   and `Spells` button on the right side of the viewport.
 * - Right Panel: Clean parameter inputs + Per-Level stat growth (`+HP/Lv`, `+Damage/Lv`, etc.).
 * - Spells View:
 *   - Minimal top bar with the 10 numbered circles, compact `0/5` spells badge, compact `1 PT` / `2 PT` badge,
 *     and minimal `Skip`, `Undo`, `Clear` buttons.
 *   - 4 Visual Graph-Based Spell Trees (`Self Support`, `Offense`, `Area Support`, `Tactical Magic`) with
 *     branching and converging prerequisite lines (`requires: [a, b]`), plus Cross-Tree Hybrid Bridge Spells
 *     sitting between adjacent trees!
 */

import { HEROES_LAB_NAME } from '../../data/labNames.js';
import * as THREE from 'three';
import { modelProvider } from '../../render/modelProvider.js';
import { spawn3DSpellEffect, inferDefaultVfxStyle } from '../../render/worldEffectsRenderer.js';
import { Animator3D } from '../../render/animator3d.js';
import { disposeVisual, getFactionColors } from '../studio/skinUtils.js';
import { createPortraitStudio } from '../studio/portraitRenderer.js';
import { resolveClip, getCombatBase, getLocomotionBase } from '../studio/clipResolver.js';
import {
  HeroStateManager,
  buildCombinedVisualsData,
  getHeroSpellClipBases,
  findSpellDef,
  getSpellTreesForClass,
  getOrRenderHeroPortraitUrl,
  heroHasSecondaryLoadout,
  normalizeSpellId
} from './heroStateManager.js';
import { HERO_SPELL_SVG_ICONS } from '../../ui/hud/hudIcons.js';
import { dataRegistry } from '../../data/dataRegistry.js';

export class HallOfHeroesApp {
  constructor(rootContainer, options = {}) {
    this.rootContainer = rootContainer;
    this.onExitHall = options.onExitHall || null;
    this.onOpenAnimationLabForHero = options.onOpenAnimationLabForHero || null;

    this._ownsHeroStateManager = !options.heroStateManager;
    this._getBaseUnitsData = () => options.ubStateManager?.unitsVisualsData || options.baseUnitsData || dataRegistry.getUnitsVisuals();
    this.heroStateManager =
      options.heroStateManager ||
      new HeroStateManager({
        onStatus: (state, msg) => this._updateSaveChip(state, msg)
      });

    const heroIds = Object.keys(this.heroesMap);
    this.selectedHeroId =
      options.initialHeroId && this.heroesMap[options.initialHeroId]
        ? options.initialHeroId
        : heroIds[0] || 'wizard';

    this.isEditing = Boolean(options.startInEditMode);
    this.activeEditSubmode = options.initialEditSubmode || 'parameters'; // 'parameters' | 'spells'
    this._editSnapshot = this.isEditing ? this.heroStateManager.snapshot() : null;
    this.activePreviewAnim = options.initialAnim || 'idle';
    this.previewLoadoutIdx = options.initialLoadoutIdx === 1 ? 1 : 0; // 0 = Gear Set 1, 1 = Gear Set 2
    this.inspectedSpellId = 'fireball';
    this._running = false;
    this._toastTimer = null;

    // 3D Preview state
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.pedestalGroup = null;
    this.heroMeshGroup = null;
    this.heroAnimator = null;
    this.camYaw = 0.35;
    this.camPitch = 0.22;
    this.camDist = 3.6;
    this.camTarget = new THREE.Vector3(0, 1.05, 0);
    this._isDraggingViewport = false;
    this._dragButton = 0;
    this._lastPtrX = 0;
    this._lastPtrY = 0;

    this._buildDOM();
    this._initThreePreview();
    this._spawnHeroPreviewModel();
    this._renderAllPanels();
    this._startLoop();
  }

  get heroesData() {
    return this.heroStateManager.data;
  }

  get heroesMap() {
    return this.heroStateManager.data.heroes || {};
  }

  get currentHero() {
    return this.heroesMap[this.selectedHeroId] || null;
  }

  _updateSaveChip(state, msg = '') {
    const chip = this.rootContainer?.querySelector('#hh-save-chip');
    if (!chip) return;
    if (state === 'dirty') {
      chip.className =
        'rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300';
      chip.textContent = msg || 'Unsaved';
    } else if (state === 'error') {
      chip.className =
        'rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-300';
      chip.textContent = msg || 'Error';
    } else {
      chip.className =
        'rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300';
      chip.textContent = msg || 'Saved';
    }
  }

  _toast(message, ms = 2000) {
    const el = this.rootContainer?.querySelector('#hh-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  _buildDOM() {
    this.rootContainer.innerHTML = `
      <div class="fixed inset-0 z-40 flex flex-col bg-slate-950 text-slate-100 select-none overflow-hidden">
        <!-- Minimal Header -->
        <header class="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-4 py-2">
          <div class="flex items-center gap-2.5">
            <span class="text-base">👑</span>
            <h1 class="text-sm font-extrabold uppercase tracking-wider text-amber-400">
              ${HEROES_LAB_NAME}
            </h1>
          </div>

          <div class="flex items-center gap-1.5">
            <button type="button" id="hh-btn-export" class="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-bold text-slate-950 shadow cursor-pointer">
              Export JSON
            </button>
            <button type="button" id="hh-btn-import" class="rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 cursor-pointer">
              Import JSON
            </button>
            <input id="hh-import-input" type="file" accept=".json,application/json" class="hidden" />
            <button type="button" id="hh-btn-reset" class="rounded-lg bg-rose-950/90 hover:bg-rose-800 border border-rose-500/40 px-2.5 py-1 text-xs font-bold text-rose-200 cursor-pointer">
              Reset
            </button>
            <button type="button" id="hh-btn-exit" class="rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 cursor-pointer">
              Back
            </button>
          </div>
        </header>

        <!-- Main Body -->
        <div class="relative flex flex-1 min-h-0 overflow-hidden">
          <!-- LEFT PANEL: Hero Names + New Hero Archetype Creator -->
          <aside class="w-56 shrink-0 border-r border-slate-800 bg-slate-900/90 p-3 flex flex-col gap-2 overflow-y-auto">
            <div id="hh-hero-list" class="flex flex-col gap-1.5 flex-1 overflow-y-auto"></div>

            <!-- Base Archetype Selector + Create Button -->
            <div class="rounded-xl border border-slate-800 bg-slate-950/75 p-2 flex flex-col gap-1.5">
              <div class="grid grid-cols-3 gap-1" id="hh-new-archetype-bar">
                <button type="button" data-new-arch="warrior" class="hh-arch-btn rounded-lg border border-amber-400 bg-amber-500/20 py-1 text-[10px] font-black text-amber-300 cursor-pointer">
                  ⚔ Warrior
                </button>
                <button type="button" data-new-arch="archer" class="hh-arch-btn rounded-lg border border-slate-700 bg-slate-900 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-800 cursor-pointer">
                  🏹 Archer
                </button>
                <button type="button" data-new-arch="wizard" class="hh-arch-btn rounded-lg border border-slate-700 bg-slate-900 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-800 cursor-pointer">
                  🔮 Wizard
                </button>
              </div>
              <button
                type="button"
                id="hh-btn-create-hero"
                class="w-full rounded-xl border border-dashed border-amber-400/70 bg-amber-500/10 hover:bg-amber-500/20 py-1.5 px-3 text-xs font-extrabold text-amber-300 flex items-center justify-center transition cursor-pointer"
              >
                + Create New Hero
              </button>
            </div>
          </aside>

          <!-- CENTER + RIGHT WORKSPACE -->
          <div class="relative flex-1 flex min-w-0 min-h-0 overflow-hidden">
            <!-- Standard View: Center 3D Preview + Right Parameters Panel -->
            <div id="hh-standard-workspace" class="flex flex-1 min-w-0 min-h-0 overflow-hidden">
              <!-- Center 3D Interactive Preview -->
              <main class="relative flex-1 min-w-0 h-full bg-slate-950 flex flex-col overflow-hidden">
                <div id="hh-viewport" class="w-full flex-1 min-h-0 cursor-grab active:cursor-grabbing"></div>

                <!-- Hero Portrait + Name + One-Click Transparent Camera Button Top-Left -->
                <div class="absolute top-4 left-4 z-10 flex items-center gap-3 rounded-2xl border border-slate-700/80 bg-slate-900/90 p-2 pr-3.5 backdrop-blur-md shadow-xl">
                  <img
                    id="hh-preview-portrait"
                    alt=""
                    class="w-12 h-12 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.85)]"
                  />
                  <div class="flex items-center gap-2">
                    <div id="hh-preview-title" class="text-sm font-black text-amber-300 leading-none"></div>
                    <button
                      type="button"
                      id="hh-btn-capture-portrait"
                      title="Capture transparent portrait"
                      class="rounded-lg border border-amber-400/70 bg-amber-500/20 hover:bg-amber-500 hover:text-slate-950 px-2.5 py-1 text-xs font-extrabold text-amber-300 transition cursor-pointer"
                    >
                      📷
                    </button>
                  </div>
                </div>

                <!-- Spells & Gear Set Preview Buttons Top-Right -->
                <div class="absolute top-4 right-4 z-10 flex items-center gap-2">
                  <button
                    type="button"
                    id="hh-btn-preview-loadout"
                    class="hidden items-center gap-1.5 rounded-xl border border-sky-400/70 bg-slate-900/90 hover:bg-sky-500 hover:text-slate-950 px-3 py-2 text-xs font-extrabold text-sky-300 shadow-xl backdrop-blur-md transition cursor-pointer"
                  >
                    <span>🔄 Gear Set 1</span>
                  </button>
                  <button
                    type="button"
                    id="hh-btn-open-spells-overlay"
                    class="flex items-center gap-2 rounded-xl border-2 border-amber-400/80 bg-slate-900/90 hover:bg-amber-500 hover:text-slate-950 px-4 py-2 text-xs font-black text-amber-300 shadow-xl backdrop-blur-md transition cursor-pointer"
                  >
                    <span>Spells</span>
                  </button>
                </div>

                <!-- Bottom Animation Bar + "Edit" Button Right Next to Animations -->
                <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 backdrop-blur-md shadow-xl">
                  <div id="hh-anim-buttons" class="flex flex-wrap items-center gap-1"></div>
                  <div class="h-4 w-px bg-slate-700 mx-1"></div>
                  <button
                    type="button"
                    id="hh-btn-anim-edit"
                    class="rounded-lg bg-sky-500 hover:bg-sky-400 px-3 py-1 text-[11px] font-black text-slate-950 shadow transition cursor-pointer"
                  >
                    Edit
                  </button>
                </div>
              </main>

              <!-- Right Panel: In-Game Hero Parameters + Bottom-Right Delete / Cancel / Edit / Save -->
              <aside class="w-80 shrink-0 border-l border-slate-800 bg-slate-900/95 flex flex-col justify-between overflow-hidden">
                <div id="hh-params-scroll" class="p-3.5 overflow-y-auto flex-1 flex flex-col gap-2.5 text-xs"></div>

                <!-- Bottom-Right Action Bar -->
                <div class="border-t border-slate-800 bg-slate-950/90 p-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    id="hh-btn-delete-hero"
                    class="rounded-xl border border-rose-500/60 bg-rose-950/70 hover:bg-rose-800 px-3.5 py-1.5 text-xs font-extrabold text-rose-200 transition cursor-pointer"
                  >
                    Delete
                  </button>

                  <div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      id="hh-btn-cancel-edit"
                      class="hidden rounded-xl border border-slate-600 bg-slate-800 hover:bg-slate-700 px-3.5 py-1.5 text-xs font-bold text-slate-200 transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      id="hh-btn-edit-toggle"
                      class="rounded-xl border-2 border-amber-400 bg-amber-500 hover:bg-amber-400 px-4 py-1.5 text-xs font-black text-slate-950 shadow-lg transition cursor-pointer"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </aside>
            </div>

            <!-- SPELL TREES & 10-LEVEL TIMELINE BUILDER WORKSPACE -->
            <div id="hh-spells-workspace" class="hidden flex-1 flex flex-col min-w-0 min-h-0 bg-slate-950 overflow-hidden">
              <!-- Clean Minimal Top Bar: 10 Circles + Compact Points/Spells Counters + Minimal Skip/Undo/Clear -->
              <div class="border-b border-slate-800 bg-slate-900/95 px-5 py-2.5 flex flex-wrap items-center justify-between gap-4">
                <!-- 10 Numbered Circles -->
                <div id="hh-timeline-circles" class="flex items-center gap-2"></div>

                <!-- Minimal Controls & Counters -->
                <div class="flex items-center gap-2">
                  <div
                    id="hh-spell-points-badge"
                    data-tip="Available Skill Points to spend on the current circle"
                    class="hh-has-tip rounded-lg border border-emerald-400/60 bg-emerald-950/80 px-2.5 py-1 text-xs font-black text-emerald-300 mono cursor-help"
                  >
                    1 PT
                  </div>

                  <div
                    id="hh-distinct-spells-badge"
                    data-tip="Unlocked spells (maximum 5 distinct spells per Hero)"
                    class="hh-has-tip rounded-lg border border-sky-400/60 bg-sky-950/80 px-2.5 py-1 text-xs font-black text-sky-300 mono cursor-help"
                  >
                    0/5
                  </div>

                  <button
                    type="button"
                    id="hh-btn-skip-level"
                    data-tip="Skip this circle and save +1 point for the next level"
                    class="hh-has-tip rounded-lg border border-amber-400 bg-amber-500/20 hover:bg-amber-500/35 px-3 py-1 text-xs font-extrabold text-amber-200 transition cursor-pointer"
                  >
                    Skip
                  </button>

                  <button
                    type="button"
                    id="hh-btn-undo-slot"
                    data-tip="Undo last circle"
                    class="hh-has-tip rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-xs font-bold text-slate-200 cursor-pointer"
                  >
                    ↶
                  </button>

                  <button
                    type="button"
                    id="hh-btn-clear-slots"
                    data-tip="Clear all 10 circles"
                    class="hh-has-tip rounded-lg border border-rose-500/40 bg-rose-950/60 hover:bg-rose-900 px-2.5 py-1 text-xs font-bold text-rose-200 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <!-- 4 Visual Graph Spell Trees + Cross-Tree Hybrid Bridge Bar -->
              <div id="hh-spell-trees-grid" class="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3"></div>

              <!-- Minimal Footer inside Spells View + Selected Spell Range / Radius / VFX Customizer -->
              <div class="border-t border-slate-800 bg-slate-900/95 px-5 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div id="hh-spell-vfx-bar" class="flex flex-wrap items-center gap-2.5 text-[11px]"></div>
                <div class="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    id="hh-btn-spells-to-anim"
                    class="rounded-lg bg-sky-500 hover:bg-sky-400 px-3.5 py-1.5 font-extrabold text-slate-950 shadow cursor-pointer"
                  >
                    Edit Animations
                  </button>
                  <button
                    type="button"
                    id="hh-btn-spells-done"
                    class="rounded-lg bg-amber-500 hover:bg-amber-400 px-4 py-1.5 font-extrabold text-slate-950 shadow cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Floating Hover Tooltip for Spell Nodes & Badges -->
        <div
          id="hh-floating-tooltip"
          class="pointer-events-none fixed z-50 hidden w-80 rounded-xl border border-amber-400/70 bg-slate-950/95 p-3 text-xs text-slate-100 shadow-2xl backdrop-blur-md"
        ></div>

        <!-- Right-Click Context Menu on Spell Nodes -->
        <div
          id="hh-spell-context-menu"
          class="fixed z-50 hidden min-w-[140px] rounded-xl border-2 border-amber-400 bg-slate-950/95 p-1.5 text-xs text-slate-100 shadow-2xl backdrop-blur-md"
        >
          <div id="hh-spell-ctx-title" class="px-2.5 py-1 text-[10.5px] font-black text-amber-300 border-b border-slate-800 mb-1 truncate"></div>
          <button
            type="button"
            id="hh-btn-ctx-edit-spell"
            class="w-full rounded-lg bg-amber-500/20 hover:bg-amber-500 hover:text-slate-950 px-3 py-1.5 text-left font-extrabold text-amber-200 flex items-center justify-between gap-2 transition cursor-pointer"
          >
            <span>✏️ Edit</span>
            <span class="text-[10px] opacity-80">Parameters</span>
          </button>
        </div>

        <!-- Spell Parameter Editor Modal (Opened via Right-Click -> Edit) -->
        <div
          id="hh-spell-edit-modal"
          class="fixed inset-0 z-50 hidden bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div class="w-full max-w-xl max-h-[88vh] rounded-2xl border-2 border-amber-400/80 bg-slate-900 text-slate-100 shadow-2xl flex flex-col overflow-hidden">
            <div class="border-b border-slate-800 bg-slate-950 px-5 py-3 flex items-center justify-between gap-3">
              <div class="flex items-center gap-2.5">
                <div id="hh-modal-spell-icon" class="w-8 h-8 rounded-lg border border-amber-400/60 bg-slate-900 flex items-center justify-center"></div>
                <div>
                  <div id="hh-modal-spell-title" class="text-sm font-black text-amber-300"></div>
                  <div id="hh-modal-spell-sub" class="text-[10.5px] font-bold text-slate-400 mono"></div>
                </div>
              </div>
              <button
                type="button"
                id="hh-modal-btn-close"
                class="rounded-lg border border-slate-700 bg-slate-800 hover:bg-rose-900 px-2.5 py-1 text-xs font-black text-slate-200 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div id="hh-modal-spell-body" class="p-5 overflow-y-auto flex-1 flex flex-col gap-4 text-xs"></div>

            <div class="border-t border-slate-800 bg-slate-950 px-5 py-3 flex items-center justify-end gap-2">
              <button
                type="button"
                id="hh-modal-btn-cancel"
                class="rounded-xl border border-slate-600 bg-slate-800 hover:bg-slate-700 px-4 py-1.5 text-xs font-bold text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                id="hh-modal-btn-save"
                class="rounded-xl border-2 border-emerald-400 bg-emerald-500 hover:bg-emerald-400 px-5 py-1.5 text-xs font-black text-slate-950 shadow-lg cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>

        <div id="hh-toast" class="hidden fixed bottom-5 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-amber-400/60 bg-slate-900/95 px-4 py-2 text-xs font-bold text-amber-200 shadow-2xl pointer-events-none"></div>
      </div>
    `;

    this._selectedNewArchetype = 'warrior';
    this._bindEvents();
  }

  _initThreePreview() {
    this.viewportEl = this.rootContainer.querySelector('#hh-viewport');
    this.scene = new THREE.Scene();
    this._defaultBgColor = new THREE.Color(0x090d16);
    this.scene.background = this._defaultBgColor;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.viewportEl.appendChild(this.renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.9);
    hemi.position.set(0, 15, 0);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xfffbeb, 1.35);
    dir.position.set(5, 10, 7);
    this.scene.add(dir);

    const rim = new THREE.DirectionalLight(0x38bdf8, 0.55);
    rim.position.set(-6, 6, -5);
    this.scene.add(rim);

    this.pedestalGroup = new THREE.Group();
    this.pedestalBaseMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.55, 0.14, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.4 })
    );
    this.pedestalBaseMesh.position.y = -0.07;
    this.pedestalGroup.add(this.pedestalBaseMesh);

    this.pedestalRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(1.22, 1.32, 32),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide })
    );
    this.pedestalRingMesh.rotation.x = -Math.PI * 0.5;
    this.pedestalRingMesh.position.y = 0.01;
    this.pedestalGroup.add(this.pedestalRingMesh);

    this.previewSpellFxGroup = new THREE.Group();
    this.pedestalGroup.add(this.previewSpellFxGroup);
    this.previewFxPulses = [];
    this.previewProjectiles = [];

    this.scene.add(this.pedestalGroup);

    this._resizeHandler = () => {
      if (!this.viewportEl) return;
      const w = this.viewportEl.clientWidth;
      const h = this.viewportEl.clientHeight;
      if (w > 0 && h > 0) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      }
    };
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._resizeHandler());
      this._resizeObserver.observe(this.viewportEl);
    } else {
      window.addEventListener('resize', this._resizeHandler);
    }
    this._resizeHandler();
    this._updateCameraOrbit();

    const dom = this.renderer.domElement;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._isDraggingViewport = true;
      this._dragButton = e.button;
      this._lastPtrX = e.clientX;
      this._lastPtrY = e.clientY;
      dom.setPointerCapture?.(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this._isDraggingViewport) return;
      const dx = e.clientX - this._lastPtrX;
      const dy = e.clientY - this._lastPtrY;
      this._lastPtrX = e.clientX;
      this._lastPtrY = e.clientY;

      if (this._dragButton === 2 || this._dragButton === 1 || (e.buttons & 2) !== 0 || e.shiftKey) {
        const panScale = this.camDist * 0.0022;
        const rightX = Math.cos(this.camYaw);
        const rightZ = -Math.sin(this.camYaw);
        const upX = -Math.sin(this.camYaw) * Math.sin(this.camPitch);
        const upY = Math.cos(this.camPitch);
        const upZ = -Math.cos(this.camYaw) * Math.sin(this.camPitch);

        this.camTarget.x += (-dx * rightX + dy * upX) * panScale;
        this.camTarget.y = Math.max(-0.5, Math.min(3.2, this.camTarget.y + dy * upY * panScale));
        this.camTarget.z += (-dx * rightZ + dy * upZ) * panScale;
        this._updateCameraOrbit();
        return;
      }

      this.camYaw -= dx * 0.01;
      this.camPitch = Math.max(-0.25, Math.min(1.15, this.camPitch + dy * 0.008));
      this._updateCameraOrbit();
    });
    const endDrag = () => {
      this._isDraggingViewport = false;
    };
    dom.addEventListener('pointerup', endDrag);
    dom.addEventListener('pointercancel', endDrag);
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camDist = Math.max(1.1, Math.min(7.5, this.camDist + (e.deltaY > 0 ? 0.24 : -0.24)));
        this._updateCameraOrbit();
      },
      { passive: false }
    );
  }

  _updateCameraOrbit() {
    if (!this.camera) return;
    const tx = this.camTarget ? this.camTarget.x : 0;
    const ty = this.camTarget ? this.camTarget.y : 1.05;
    const tz = this.camTarget ? this.camTarget.z : 0;
    const cx = tx + Math.sin(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    const cy = ty + Math.sin(this.camPitch) * this.camDist;
    const cz = tz + Math.cos(this.camYaw) * Math.cos(this.camPitch) * this.camDist;
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(tx, ty, tz);
  }

  _spawnHeroPreviewModel() {
    if (!this.pedestalGroup) return;
    if (this.heroMeshGroup) {
      this.pedestalGroup.remove(this.heroMeshGroup);
      disposeVisual(this.heroMeshGroup);
      this.heroMeshGroup = null;
    }

    const hero = this.currentHero;
    if (!hero) return;

    this.heroStateManager.ensureSpellAnimationSlotsForHero(hero);
    const combinedVisuals = buildCombinedVisualsData(this._getBaseUnitsData(), this.heroesData);
    const faction = hero.race || 'human';
    const hasSet2 = heroHasSecondaryLoadout(hero);
    if (!hasSet2) this.previewLoadoutIdx = 0;

    this.heroMeshGroup = modelProvider.createHeroModel(hero.id, {
      visualsOverride: combinedVisuals,
      skin: faction,
      team: 1,
      loadoutId: this.previewLoadoutIdx === 1 ? 'loadout2' : null,
      isBannerCarrier: false,
      customTeamColors: getFactionColors(combinedVisuals, faction)
    });
    this.pedestalGroup.add(this.heroMeshGroup);

    this.heroAnimator = new Animator3D(this.heroMeshGroup, combinedVisuals.animations);
    this._playPreviewAnim(this.activePreviewAnim);
  }

  _playPreviewAnim(animKey) {
    this.activePreviewAnim = animKey;
    if (!this.heroAnimator || !this.currentHero) return;
    const hero = this.currentHero;
    const faction = hero.race || 'human';
    const combinedVisuals = buildCombinedVisualsData(this._getBaseUnitsData(), this.heroesData);
    const visualKey =
      this.previewLoadoutIdx === 1 && combinedVisuals.units[`${hero.id}__loadout2`]
        ? `${hero.id}__loadout2`
        : hero.id;
    const unitDef = combinedVisuals.units[visualKey] || hero;

    if (animKey === 'idle') {
      this.heroAnimator.cancelAction();
      this.heroAnimator.setLocomotion(resolveClip(combinedVisuals, hero.id, faction, 'idle'));
    } else if (animKey === 'walk') {
      this.heroAnimator.cancelAction();
      const loco = getLocomotionBase(unitDef, faction);
      this.heroAnimator.setLocomotion(resolveClip(combinedVisuals, hero.id, faction, loco));
    } else if (animKey === 'attack') {
      this.heroAnimator.setLocomotion('idle');
      const combatBase = getCombatBase(unitDef, faction);
      const clip = resolveClip(combinedVisuals, hero.id, faction, combatBase);
      this.heroAnimator.playAction(clip, { restart: true });
    } else if (animKey.startsWith('spell_')) {
      this.heroAnimator.setLocomotion('idle');
      const clip = resolveClip(combinedVisuals, hero.id, faction, animKey);
      this.heroAnimator.playAction(clip, { restart: true });
      const spellId = animKey.replace(/^spell_/, '');
      const spDef = findSpellDef(this.heroesData, spellId);
      if (this.previewSpellFxGroup) {
        spawn3DSpellEffect({
          fxGroup: this.previewSpellFxGroup,
          activeFxPulses: this.previewFxPulses,
          activeProjectiles: this.previewProjectiles,
          spellId,
          vfxStyle: spDef?.vfxStyle || null,
          fromPos: new THREE.Vector3(0, 1.15, 0.25),
          toPos: new THREE.Vector3(0, 0.1, spDef?.targetMode === 'self' || spDef?.targetMode === 'self_aoe' ? 0 : 2.2),
          radiusScale: 2.5,
          isPreview: true
        });
      }
    }
    this._renderAnimButtons();
  }

  _renderAnimButtons() {
    const host = this.rootContainer?.querySelector('#hh-anim-buttons');
    if (!host || !this.currentHero) return;

    const spellBases = getHeroSpellClipBases(this.currentHero);
    const buttons = [
      { id: 'idle', label: 'Idle' },
      { id: 'walk', label: 'Walk' },
      { id: 'attack', label: 'Attack' },
      ...spellBases.map((sb) => {
        const spId = sb.replace(/^spell_/, '');
        const spDef = findSpellDef(this.heroesData, spId);
        return { id: sb, label: spDef?.nameEn || spId };
      })
    ];

    host.innerHTML = buttons
      .map(
        (b) => `
        <button
          type="button"
          data-anim="${b.id}"
          class="hh-anim-btn rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
            this.activePreviewAnim === b.id
              ? 'bg-amber-500 text-slate-950 shadow'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }"
        >
          ${b.label}
        </button>
      `
      )
      .join('');
  }

  _renderAllPanels() {
    this._renderHeroList();
    this._renderEditState();
    this._renderPreviewHeader();
    this._renderAnimButtons();
    this._renderRightParametersPanel();
    this._renderSpellsWorkspace();
  }

  _renderHeroList() {
    const listEl = this.rootContainer?.querySelector('#hh-hero-list');
    if (!listEl) return;

    const entries = Object.values(this.heroesMap);
    listEl.innerHTML = entries
      .map((h) => {
        const isSelected = h.id === this.selectedHeroId;
        const portraitUrl = getOrRenderHeroPortraitUrl(h.id, this.heroesData);
        return `
          <button
            type="button"
            data-hero-id="${h.id}"
            class="hh-hero-card w-full text-left rounded-xl border px-2.5 py-2 flex items-center gap-2.5 font-extrabold text-xs truncate transition cursor-pointer ${
              isSelected
                ? 'border-amber-400 bg-amber-500/15 text-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.18)]'
                : 'border-slate-800/80 bg-slate-950/60 text-slate-200 hover:border-slate-600 hover:bg-slate-900'
            }"
          >
            ${
              portraitUrl
                ? `<img src="${portraitUrl}" alt="" class="w-8 h-8 object-contain shrink-0 pointer-events-none drop-shadow" />`
                : ''
            }
            <span class="truncate">${h.displayName || h.name || h.id}</span>
          </button>
        `;
      })
      .join('');
  }

  _renderPreviewHeader() {
    const hero = this.currentHero;
    if (!hero) return;
    const titleEl = this.rootContainer?.querySelector('#hh-preview-title');
    if (titleEl) titleEl.textContent = hero.displayName || hero.name || hero.id;
    const portraitEl = this.rootContainer?.querySelector('#hh-preview-portrait');
    if (portraitEl) {
      const pUrl = getOrRenderHeroPortraitUrl(hero.id, this.heroesData);
      if (pUrl) portraitEl.src = pUrl;
    }
    const ldBtn = this.rootContainer?.querySelector('#hh-btn-preview-loadout');
    if (ldBtn) {
      const hasSet2 = heroHasSecondaryLoadout(hero);
      ldBtn.classList.toggle('hidden', !hasSet2);
      ldBtn.classList.toggle('flex', hasSet2);
      if (hasSet2) {
        ldBtn.innerHTML = `<span>🔄 Gear Set ${this.previewLoadoutIdx + 1}</span>`;
      }
    }
  }

  _renderEditState() {
    const editBtn = this.rootContainer?.querySelector('#hh-btn-edit-toggle');
    const cancelBtn = this.rootContainer?.querySelector('#hh-btn-cancel-edit');
    const stdWorkspace = this.rootContainer?.querySelector('#hh-standard-workspace');
    const spellsWorkspace = this.rootContainer?.querySelector('#hh-spells-workspace');

    if (editBtn) {
      if (this.isEditing) {
        editBtn.textContent = 'Save';
        editBtn.className =
          'rounded-xl border-2 border-emerald-400 bg-emerald-500 hover:bg-emerald-400 px-4 py-1.5 text-xs font-black text-slate-950 shadow-lg transition cursor-pointer';
      } else {
        editBtn.textContent = 'Edit';
        editBtn.className =
          'rounded-xl border-2 border-amber-400 bg-amber-500 hover:bg-amber-400 px-4 py-1.5 text-xs font-black text-slate-950 shadow-lg transition cursor-pointer';
      }
    }

    if (cancelBtn) {
      cancelBtn.classList.toggle('hidden', !this.isEditing);
    }

    const showSpellsView = this.isEditing && this.activeEditSubmode === 'spells';
    stdWorkspace?.classList.toggle('hidden', showSpellsView);
    spellsWorkspace?.classList.toggle('hidden', !showSpellsView);

    if (!showSpellsView) {
      setTimeout(() => this._resizeHandler?.(), 20);
    }
  }

  _renderRightParametersPanel() {
    const host = this.rootContainer?.querySelector('#hh-params-scroll');
    const hero = this.currentHero;
    if (!host || !hero) return;

    if (!hero.parameters) {
      hero.parameters = {
        cost: { coins: 400, wood: 80, stone: 0, iron: 60 },
        weight: 2.4,
        maxHp: 680,
        hpRegenPerSec: 4,
        attackDamage: 48,
        attackSpeed: 1.2,
        moveSpeed: 4.4,
        range: 2.6,
        armor: 15,
        trainTimeSec: 10,
        reviveBaseCostCoins: 250,
        reviveCostPerLevelCoins: 50,
        reviveBaseTimeSec: 8,
        reviveTimePerLevelSec: 2,
        xpPerLevelBase: 100
      };
    }
    const p = hero.parameters;
    const c = p.cost || (p.cost = { coins: 400, wood: 80, stone: 0, iron: 60 });
    const unlocked = this.isEditing;
    const disAttr = unlocked ? '' : 'disabled';
    const inputCls = unlocked
      ? 'w-20 rounded border border-amber-400/70 bg-slate-950 px-2 py-0.5 text-right font-bold text-amber-200 mono focus:outline-none focus:ring-1 focus:ring-amber-400'
      : 'w-20 rounded border border-slate-800 bg-slate-950/60 px-2 py-0.5 text-right font-bold text-slate-300 mono opacity-75 cursor-not-allowed';

    const numRow = (field, label, val, step = 1, min = 0, max = 99999) => `
      <div class="flex items-center justify-between gap-2 py-1 border-b border-slate-800/50">
        <span class="text-slate-300">${label}</span>
        <input
          type="number"
          data-param="${field}"
          value="${val}"
          step="${step}"
          min="${min}"
          max="${max}"
          ${disAttr}
          class="${inputCls}"
        />
      </div>
    `;

    host.innerHTML = `
      <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-slate-400">Name</span>
          <input
            type="text"
            id="hh-input-name"
            value="${hero.displayName || hero.name || ''}"
            ${disAttr}
            class="flex-1 rounded border ${unlocked ? 'border-amber-400/70 bg-slate-950 text-amber-200' : 'border-slate-800 bg-slate-950/60 text-slate-300 opacity-75'} px-2 py-1 font-bold text-right"
          />
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-slate-400">Base Class</span>
          <select
            id="hh-input-class"
            ${disAttr}
            class="rounded border ${unlocked ? 'border-amber-400/70 bg-slate-950 text-amber-200' : 'border-slate-800 bg-slate-950/60 text-slate-300 opacity-75'} px-2 py-1 font-bold"
          >
            ${[
              ['warrior', '⚔ WARRIOR (לוחם)'],
              ['archer', '🏹 ARCHER (קשת)'],
              ['wizard', '🔮 WIZARD (מכשף)']
            ]
              .map(([cl, label]) => `<option value="${cl}" ${hero.heroClass === cl ? 'selected' : ''}>${label}</option>`)
              .join('')}
          </select>
        </div>
      </div>

      <!-- Cost -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 flex flex-col gap-1.5">
        <div class="text-[10.5px] font-bold uppercase tracking-wider text-amber-300">Cost</div>
        <div class="grid grid-cols-2 gap-1.5">
          <label class="flex items-center justify-between rounded bg-slate-900 px-2 py-1">
            <span class="text-amber-300 font-semibold">Coins</span>
            <input type="number" data-cost="coins" value="${c.coins ?? 400}" min="0" step="10" ${disAttr} class="${unlocked ? 'w-16 rounded border border-amber-400/70 bg-slate-950 px-1.5 py-0.5 text-right font-bold text-amber-200 mono' : 'w-16 bg-transparent text-right font-bold text-amber-200 mono opacity-75 cursor-not-allowed'}" />
          </label>
          <label class="flex items-center justify-between rounded bg-slate-900 px-2 py-1">
            <span class="text-emerald-300 font-semibold">Wood</span>
            <input type="number" data-cost="wood" value="${c.wood ?? 80}" min="0" step="10" ${disAttr} class="${unlocked ? 'w-16 rounded border border-amber-400/70 bg-slate-950 px-1.5 py-0.5 text-right font-bold text-emerald-200 mono' : 'w-16 bg-transparent text-right font-bold text-emerald-200 mono opacity-75 cursor-not-allowed'}" />
          </label>
          <label class="flex items-center justify-between rounded bg-slate-900 px-2 py-1">
            <span class="text-slate-300 font-semibold">Stone</span>
            <input type="number" data-cost="stone" value="${c.stone ?? 0}" min="0" step="10" ${disAttr} class="${unlocked ? 'w-16 rounded border border-amber-400/70 bg-slate-950 px-1.5 py-0.5 text-right font-bold text-slate-100 mono' : 'w-16 bg-transparent text-right font-bold text-slate-100 mono opacity-75 cursor-not-allowed'}" />
          </label>
          <label class="flex items-center justify-between rounded bg-slate-900 px-2 py-1">
            <span class="text-sky-300 font-semibold">Iron</span>
            <input type="number" data-cost="iron" value="${c.iron ?? 60}" min="0" step="10" ${disAttr} class="${unlocked ? 'w-16 rounded border border-amber-400/70 bg-slate-950 px-1.5 py-0.5 text-right font-bold text-sky-200 mono' : 'w-16 bg-transparent text-right font-bold text-sky-200 mono opacity-75 cursor-not-allowed'}" />
          </label>
        </div>
        <div class="mt-1 pt-1 border-t border-slate-800/70">
          ${numRow('trainTimeSec', 'Spawn / Creation Time (s) (זמן התייצרות)', p.trainTimeSec ?? 10, 1, 1, 300)}
        </div>
      </div>

      <!-- Stats -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 flex flex-col gap-0.5">
        <div class="text-[10.5px] font-bold uppercase tracking-wider text-emerald-300 mb-0.5">Stats</div>
        ${numRow('maxHp', 'HP', p.maxHp ?? 680, 10, 50, 20000)}
        ${numRow('hpRegenPerSec', 'HP Regen/s', p.hpRegenPerSec ?? 4, 1, 0, 500)}
        ${numRow('attackDamage', 'Attack Damage', p.attackDamage ?? 48, 2, 1, 5000)}
        ${numRow('attackSpeed', 'Attack Speed', p.attackSpeed ?? 1.2, 0.05, 0.2, 5.0)}
        ${numRow('moveSpeed', 'Walk Speed (מהירות הליכה)', p.moveSpeed ?? 4.4, 0.1, 1.5, 12.0)}
        ${numRow('runSpeed', 'Run / Gallop Speed (מהירות ריצה / דהירה)', p.runSpeed ?? Number(((p.moveSpeed ?? 4.4) * 1.45).toFixed(2)), 0.1, 1.5, 18.0)}
        ${numRow('range', 'Range', p.range ?? (hero.heroClass === 'archer' ? 28 : 2.6), 0.5, 1.5, 160)}
        ${numRow('visionRange', 'Vision Range (שדה ראייה)', p.visionRange ?? (hero.heroClass === 'archer' ? 120 : 96), 2, 30, 260)}
        ${numRow('accuracy', 'Accuracy (% דיוק)', p.accuracy ?? (hero.heroClass === 'archer' ? 90 : 88), 1, 10, 100)}
        ${numRow('armor', 'Armor (%)', p.armor ?? 15, 1, 0, 90)}
        ${numRow('weight', 'Weight', p.weight ?? 2.4, 0.1, 0.5, 20.0)}
      </div>

      <!-- Level Up Bonus (+ per Level) -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 flex flex-col gap-0.5">
        <div class="text-[10.5px] font-bold uppercase tracking-wider text-sky-300 mb-0.5">Level Up (+ / Lv)</div>
        ${numRow('hpPerLevel', '+HP / Lv', p.hpPerLevel ?? 45, 5, 0, 2000)}
        ${numRow('damagePerLevel', '+Damage / Lv', p.damagePerLevel ?? 6, 1, 0, 500)}
        ${numRow('armorPerLevel', '+Armor % / Lv', p.armorPerLevel ?? 2, 1, 0, 20)}
        ${numRow('attackSpeedPctPerLevel', '+Attack Speed % / Lv', p.attackSpeedPctPerLevel ?? 4, 1, 0, 50)}
        ${numRow('moveSpeedPctPerLevel', '+Move Speed % / Lv', p.moveSpeedPctPerLevel ?? 2, 1, 0, 30)}
      </div>

      <!-- Revive & Scaling -->
      <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 flex flex-col gap-0.5">
        <div class="text-[10.5px] font-bold uppercase tracking-wider text-purple-300 mb-0.5">Revive &amp; XP</div>
        ${numRow('reviveBaseCostCoins', 'Revive Cost', p.reviveBaseCostCoins ?? 250, 10, 0, 10000)}
        ${numRow('reviveCostPerLevelCoins', 'Revive +Cost/Lv', p.reviveCostPerLevelCoins ?? 50, 5, 0, 5000)}
        ${numRow('reviveBaseTimeSec', 'Revive Time (s) (זמן החייאה)', p.reviveBaseTimeSec ?? 8, 1, 1, 300)}
        ${numRow('reviveTimePerLevelSec', 'Revive +Time/Lv', p.reviveTimePerLevelSec ?? 2, 1, 0, 60)}
        ${numRow('xpPerLevelBase', 'Base XP/Lv', p.xpPerLevelBase ?? 100, 10, 20, 5000)}
      </div>
    `;
  }
}

import { hallOfHeroesSpellsMethods } from './hallOfHeroesSpellsWorkspace.js';
import { hallOfHeroesEventsMethods } from './hallOfHeroesEvents.js';

Object.assign(
  HallOfHeroesApp.prototype,
  hallOfHeroesSpellsMethods,
  hallOfHeroesEventsMethods
);
