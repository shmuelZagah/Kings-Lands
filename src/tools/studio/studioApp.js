/**
 * Kings Lands — Studio app (src/tools/studio/studioApp.js)
 *
 * Wires the studio together: viewport, gizmo, inspector, timeline, arena and the saved draft.
 *
 * How editing works
 *   - Everything you do is written straight into the working copy of units.json and auto-saved to a draft
 *     (debounced). There is no "Apply". "Restart Anim" resets one clip, "Restart All" resets everything,
 *     "Export JSON" gives you the file.
 *   - Two edit modes (left panel):
 *       Pose (default)  moving a joint edits the clip – the rest pose is never touched. A property with an EMPTY stopwatch
 *                       (◇) changes for the whole clip; with a FILLED one (◆) every change writes a keyframe at the playhead.
 *       Rig             moving a joint changes its REST pose (and the hierarchy in units.json). Affects every clip.
 *     Weapon grips (a weapon socket with a weapon in it) are always written to unit.equipment, in both modes.
 *   - The gizmo and the Inspector numbers/sliders edit the very same three.js object, so they stay in sync both ways.
 *   - Editing a clip never silently changes other units: the first edit copies the clip into
 *     `${unit}_${faction}_${clip}` (scope "This unit"); scope "Global" edits the shared clip.
 *   - walk / run / gallop are procedural (parameters only). idle may be procedural and/or keyframed.
 */

import { ANIMATION_LAB_NAME } from '../../data/labNames.js';
import { dataRegistry } from '../../data/dataRegistry.js';
import * as THREE from 'three';
import { updateBowstringRig } from '../../render/modelFactory.js';
import { modelProvider } from '../../render/modelProvider.js';
import { buildSculptedArrowGeometry, spawn3DSpellEffect } from '../../render/worldEffectsRenderer.js';
import { Animator3D } from '../../render/animator3d.js';
import { SynthAudio } from '../../audio/synthAudio.js';
import { GizmoController } from './gizmoController.js';
import { TimelineEditor } from './timelineEditor.js';
import { SandboxArena } from './sandboxArena.js';
import { StudioStateManager } from './studioStateManager.js';
import { HeroStateManager, getHeroSpellClipBases, findSpellDef } from '../heroes/heroStateManager.js';
import { UnitsBuildingsStateManager } from '../units_buildings/unitsBuildingsStateManager.js';
import { buildBuildingsStudioViewData, BUILDING_STUDIO_CLIPS } from '../units_buildings/buildingStudioAdapter.js';
import { InspectorPanel } from './inspectorPanel.js';
import { ACTION_CLIPS, clipNameFor, getCombatBase, getLocomotionBase, resolveClip, resolveClipVariants, variantIndexOf, withVariantIndex } from './clipResolver.js';
import { EQUIPMENT_SOCKETS, HAND_SOCKETS, STOW_SOCKETS, STOW_DEFAULTS, MAIN_LOADOUT, asLoadout, restow, equipmentOf, grantedActions, isDualWield, isTwoHanded, loadoutsOf, lockedHand, weaponTypeOf } from './weaponRules.js';
import { runHealthCheck } from './healthCheck.js';
import { createPortraitStudio, canvasToPngBytes, makeZip, downloadBytes, PORTRAIT_DEFAULTS } from './portraitRenderer.js';
import * as KT from './keyTracks.js';
import { createClipVariation, deleteClipVariation, ensureKeyframeClip, ensureProceduralClip, readClipName } from './clipEditing.js';
import { FACTION_TEAM_COLORS, getFactions, getFactionLabel, getFactionColors, isSharedUnitsFaction, applySkinColors, disposeVisual, ownMaterial } from './skinUtils.js';
import { filterStudioEntitiesForFaction } from '../labSync.js';
import { RIG_COLLAPSE_STORAGE_KEY, topLevelSelectedPartIds } from './buildingPartsOutliner.js';
import { isPartEffectivelyActive } from '../../data/buildingParts.js';

const ALLOWED_EQUIPMENT = {
  weapon_socket_R: ['sword', 'ravan_prince_sword', 'king_sovereign_sword', 'sisnat_double_axe', 'spear', 'pike', 'worker_hammer', 'javelin', 'bow', 'crossbow', 'ballista_crossbow', 'wizard_staff'],
  weapon_socket_L: ['shield', 'tower_shield', 'royal_crest_shield', 'round_buckler', 'kite_shield', 'bow', 'wizard_tome'],
  head: ['helmet_iron', 'helmet_leather', 'hood', 'king_engraved_crown', 'sisnat_war_helm', 'wizard_hat'],
  torso: ['cape', 'surcoat', 'sisnat_chest_armor']
};
const MAX_ARENA_GROUPS = 4;   // per side, so the scene stays on screen
const HAND_WEAPONS = ['sword', 'ravan_prince_sword', 'king_sovereign_sword', 'sisnat_double_axe', 'wizard_staff', 'spear', 'pike', 'worker_hammer', 'javelin', 'bow', 'crossbow', 'ballista_crossbow'];
const RANGED_WEAPONS = ['bow', 'crossbow', 'javelin'];

const DELTA_EPS = 1e-4;
const round4 = (v) => Math.round(v * 1e4) / 1e4 + 0;   // "+ 0" turns -0 into 0
const round3v = (a) => [round4(a[0]), round4(a[1]), round4(a[2])];
const hasKeys = (clip) => Object.values(clip?.tracks || {}).some((t) => Array.isArray(t) && t.length > 0);

const TAB_ON = 'rounded-md bg-amber-500 px-3 py-1 text-xs font-bold text-slate-950 transition';
const TAB_OFF = 'rounded-md px-3 py-1 text-xs font-semibold text-slate-300 hover:text-white transition';
const SEG_ON = 'flex-1 rounded bg-sky-500 py-1.5 text-xs font-bold text-slate-950';
const SEG_OFF = 'flex-1 rounded bg-slate-800 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700';
const RIG_ON = 'flex-1 rounded bg-rose-500 py-1.5 text-xs font-bold text-slate-950';

const CHIP = {
  saved: { cls: 'rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300', text: 'Saved' },
  dirty: { cls: 'rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300', text: 'Saving…' },
  error: { cls: 'rounded-full border border-rose-500/50 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300', text: 'Save failed' }
};

export const STUDIO_BUILDING_SCALE = 0.34;

export function resolveBuildingFootprintMeters(bDef) {
  const baseRadius = Math.max(1, Number(bDef?.footprintRadiusMeters) || 5);
  const defaultSpan = baseRadius * 2;
  const rawLength = Number(bDef?.footprintLength);
  const rawWidth = Number(bDef?.footprintWidth);
  const length = Number.isFinite(rawLength) && rawLength > 0 ? rawLength : defaultSpan;
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : defaultSpan;
  return { length, width, radius: baseRadius };
}

export function createBuildingFootprintDisplayGroup(bDef, scale = STUDIO_BUILDING_SCALE) {
  const { length, width } = resolveBuildingFootprintMeters(bDef);
  const plateW = width * scale;
  const plateL = length * scale;

  const group = new THREE.Group();
  group.name = 'studio_building_footprint';

  // Flat rectangle plate on the floor (drawn above GridHelper at y=0.01 without z-fighting)
  const fillGeo = new THREE.PlaneGeometry(plateW, plateL);
  fillGeo.rotateX(-Math.PI / 2);
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x0ea5e9,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.name = 'studio_building_footprint_plate';
  fillMesh.position.y = 0.025;
  fillMesh.renderOrder = 2;
  fillMesh.userData.footprintMeters = { length, width };
  fillMesh.userData.plateSize = { width: plateW, length: plateL };
  group.add(fillMesh);

  // Bold rectangular perimeter strips so the footprint edges are unmistakable at any camera angle
  const borderThickness = 0.06;
  const borderMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  });
  const mkBar = (w, l, x, z, name) => {
    const g = new THREE.PlaneGeometry(w, l);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, borderMat);
    m.name = name;
    m.position.set(x, 0.031, z);
    m.renderOrder = 3;
    return m;
  };
  const halfW = plateW * 0.5;
  const halfL = plateL * 0.5;
  group.add(
    mkBar(plateW + borderThickness, borderThickness, 0, halfL, 'footprint_border_front'),
    mkBar(plateW + borderThickness, borderThickness, 0, -halfL, 'footprint_border_back'),
    mkBar(borderThickness, plateL + borderThickness, -halfW, 0, 'footprint_border_left'),
    mkBar(borderThickness, plateL + borderThickness, halfW, 0, 'footprint_border_right')
  );

  // Facing arrow on the floor in front of the building (+Z is doorway / unit exit front)
  const z0 = halfL + 0.12;
  const z1 = halfL + 0.62;
  const z2 = halfL + 1.12;
  const sw = 0.14;
  const hw = 0.38;
  const buildArrowGeo = (pad = 0) => {
    const aZ0 = z0 - pad;
    const aZ1 = z1;
    const aZ2 = z2 + pad * 1.6;
    const aSw = sw + pad;
    const aHw = hw + pad * 1.4;
    const positions = new Float32Array([
      // Shaft quad (two triangles in XZ plane)
      -aSw, 0, aZ0,   aSw, 0, aZ0,   aSw, 0, aZ1,
      -aSw, 0, aZ0,   aSw, 0, aZ1,  -aSw, 0, aZ1,
      // Arrowhead triangle pointing toward +Z
      -aHw, 0, aZ1,   aHw, 0, aZ1,     0, 0, aZ2
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  };

  const arrowBackMat = new THREE.MeshBasicMaterial({
    color: 0x0f172a,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  });
  const arrowBackMesh = new THREE.Mesh(buildArrowGeo(0.035), arrowBackMat);
  arrowBackMesh.name = 'studio_building_facing_arrow_outline';
  arrowBackMesh.position.y = 0.033;
  arrowBackMesh.renderOrder = 3;
  group.add(arrowBackMesh);

  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  });
  const arrowMesh = new THREE.Mesh(buildArrowGeo(0), arrowMat);
  arrowMesh.name = 'studio_building_facing_arrow';
  arrowMesh.position.y = 0.036;
  arrowMesh.renderOrder = 4;
  arrowMesh.userData.facingAxis = '+Z';
  group.add(arrowMesh);

  return group;
}

export class StudioApp {
  static FINGERS = ['index', 'middle', 'ring', 'pinky'];
  constructor(rootContainer, options = {}) {
    this.rootContainer = rootContainer;
    this.onExitStudio = options.onExitStudio || null;
    this.onOpenHallOfHeroes = options.onOpenHallOfHeroes || null;
    this.onOpenUnitsBuildingsLab = options.onOpenUnitsBuildingsLab || null;
    this.contextualHeroId = options.contextualHeroId || null;
    this.contextualUnitId = options.contextualUnitId || null;
    this.contextualBuildingId = options.contextualBuildingId || null;
    this.isContextualMode = Boolean(this.contextualHeroId || this.contextualUnitId || this.contextualBuildingId);
    this.entityCategory = this.contextualHeroId
      ? "heroes"
      : this.contextualBuildingId
        ? "buildings"
        : this.contextualUnitId
          ? "units"
          : options.initialCategory === "heroes"
            ? "heroes"
            : options.initialCategory === "buildings"
              ? "buildings"
              : "units";

    this._saveStatus = { state: 'saved', message: '' };
    this._ownsUnitStateManager = !options.ubStateManager?.studioStateManager;
    this._ownsHeroStateManager = !options.heroStateManager;
    this.unitStateManager = options.ubStateManager?.studioStateManager || new StudioStateManager({ onStatus: (s, m) => this._onSaveStatus(s, m) });
    this.unitStateManager.onStatus = (s, m) => this._onSaveStatus(s, m);
    this.heroStateManager = options.heroStateManager || new HeroStateManager({ onStatus: (s, m) => this._onSaveStatus(s, m) });
    this.heroStateManager.onStatus = (s, m) => this._onSaveStatus(s, m);
    if (this.unitStateManager?.data && this.heroStateManager?.data?.prefabs) {
      this.unitStateManager.data.prefabs = {
        ...(this.unitStateManager.data.prefabs || {}),
        ...(this.heroStateManager.data.prefabs || {})
      };
    }
    this.ubStateManager = options.ubStateManager || new UnitsBuildingsStateManager({ studioStateManager: this.unitStateManager });
    if (this.unitStateManager && typeof this.unitStateManager.subscribe === "function") {
      this._unsubUnitState = this.unitStateManager.subscribe((data) => {
        if (this.ubStateManager && this.entityCategory === "units") {
          this.ubStateManager.unitsVisualsData = data;
          this.ubStateManager.saveAll();
        }
      });
    }
    this._heroesStudioView = this.heroStateManager.getStudioViewData(this.unitStateManager.data);
    this._buildingsStudioView = buildBuildingsStudioViewData(this.ubStateManager.buildingsData, this.ubStateManager.buildingVisualsData, this.unitStateManager.data);
    this._buildingsStateAdapter = {
      get data() { return this._view; },
      _view: this._buildingsStudioView,
      notice: "",
      saveDraft: () => { this._pushBuildingRig(); return this.ubStateManager.saveAll(); },
      scheduleSave: (d) => {
        this._pushBuildingRig();
        if (this._buildingsStudioView?.animations?.keyframes) {
          this.ubStateManager.buildingVisualsData.animations.keyframes = {
            ...(this.ubStateManager.buildingVisualsData.animations.keyframes || {}),
            ...this._buildingsStudioView.animations.keyframes
          };
        }
        this.ubStateManager.scheduleSave(d);
      },
      flush: () => { this._pushBuildingRig(); return this.ubStateManager.saveAll(); },
      exportCustomJson: () => this.ubStateManager.exportCombinedBundleJson(),
      importJsonText: (txt) => this.ubStateManager.importCombinedBundleText(txt),
      resetToDefault: () => { this.ubStateManager.resetAllToDefaults(); return true; },
      resetClip: () => ({ ok: false, cancelled: true }),
      snapshot: () => JSON.stringify(this._buildingsStudioView),
      restoreSnapshot: (txt) => {
        try {
          this._buildingsStudioView = JSON.parse(txt);
          this._buildingsStateAdapter._view = this._buildingsStudioView;
          const blds = this.ubStateManager?.buildingsData?.buildings;
          for (const [id, u] of Object.entries(this._buildingsStudioView?.units || {})) {
            if (u?.isBuildingEntity && Array.isArray(u.parts)) {
              u._partsDirty = true;
              const bDef = blds?.[id];
              if (bDef && !bDef.hasBuiltInTurret) {
                const hasWt = u.parts.some((p) => p.id === 'watchtower');
                bDef.hasWatchtowerSupport = hasWt;
                if (!hasWt) bDef.watchtowerLevel = 0;
              }
            }
          }
          this._pushBuildingRig();
          this.ubStateManager?.saveAll?.();
        } catch (_) {}
      },
      destroy: () => {}
    };

    this._heroStateAdapter = {
      get data() { return this._view; },
      _view: this._heroesStudioView,
      notice: '',
      saveDraft: () => this.heroStateManager.saveDraft(),
      scheduleSave: (d) => this.heroStateManager.scheduleSave(d),
      flush: () => this.heroStateManager.flush(),
      exportCustomJson: () => this.heroStateManager.exportHeroesJson('heroes_export.json'),
      importJsonText: (txt) => {
        const res = this.heroStateManager.importHeroesJsonText(txt);
        if (res.ok) {
          this._rebuildCrossLabViews();
        }
        return res;
      },
      resetToDefault: () => {
        if (!confirm('Reset all Heroes data to the default heroes.json?')) return false;
        const ok = this.heroStateManager.resetToDefault();
        if (ok) {
          this._rebuildCrossLabViews();
        }
        return ok;
      },
      resetClip: () => ({ ok: false, cancelled: true }),
      snapshot: () => this.heroStateManager.snapshot(),
      restoreSnapshot: (txt) => {
        this.heroStateManager.restoreSnapshot(txt);
        this._rebuildCrossLabViews();
      },
      destroy: () => {
        if (this._ownsHeroStateManager) this.heroStateManager.destroy();
        else this.heroStateManager.flush();
      }
    };

    this.modelFactory = modelProvider.getModelFactory();
    this._buildingModelFactory = modelProvider.getBuildingModelFactory();
    try { this.synthAudio = new SynthAudio(); } catch (e) { this.synthAudio = null; }

    this.view = 'studio';                 // 'studio' | 'arena'
    this.editMode = 'pose';               // 'pose' | 'rig'
    for (const [id, u] of Object.entries(this.unitStateManager.data.units)) if (/^katiler/.test(id) && !u.race) u.race = 'katiler';
    for (const u of Object.values(this.unitStateManager.data.units)) restow(this.unitStateManager.data, u);
    for (const u of Object.values(this._heroesStudioView.units)) restow(this._heroesStudioView, u);

    if (this.contextualHeroId && this._heroesStudioView.units[this.contextualHeroId]) {
      this.currentUnitId = this.contextualHeroId;
      this.currentFaction = this._heroesStudioView.units[this.contextualHeroId]?.race || 'human';
    } else if (this.contextualBuildingId && this._buildingsStudioView.units[this.contextualBuildingId]) {
      this.currentUnitId = this.contextualBuildingId;
      this.currentFaction = 'human';
    } else if (this.contextualUnitId && this.unitsData.units[this.contextualUnitId]) {
      this.currentUnitId = this.contextualUnitId;
      const unitRace = this._raceOf(this.contextualUnitId) || 'human';
      const desired = options.initialFaction || unitRace;
      this.currentFaction = this._factions().includes(desired) ? desired : unitRace;
    } else if (this.entityCategory === 'heroes') {
      const heroKeys = Object.keys(this._heroesStudioView.units);
      this.currentUnitId = heroKeys[0] || 'wizard';
      this.currentFaction = this._heroesStudioView.units[this.currentUnitId]?.race || 'human';
    } else if (this.entityCategory === "buildings") {
      const bKeys = Object.keys(this._buildingsStudioView.units);
      this.currentUnitId = options.initialUnitId && this._buildingsStudioView.units[options.initialUnitId] ? options.initialUnitId : (bKeys[0] || "barracks");
      this.currentFaction = "human";
    } else {
      this.currentUnitId = options.initialUnitId && this.unitsData.units[options.initialUnitId] ? options.initialUnitId : (this.unitsData.units.swordsman ? "swordsman" : Object.keys(this.unitsData.units)[0]);
      const unitRace = this._raceOf(this.currentUnitId) || 'human';
      const desired = options.initialFaction || unitRace;
      this.currentFaction = this._factions().includes(desired) ? desired : unitRace;
    }
    const initUnitDef = this.unitsData.units?.[this.currentUnitId];
    const secondLdKey = Object.keys(initUnitDef?.loadouts || {}).find((k) => k !== MAIN_LOADOUT);
    this.currentLoadout = options.initialLoadoutIdx === 1 && secondLdKey ? secondLdKey : MAIN_LOADOUT;
    this._initialRequestedAnim = options.initialAnim || null;
    this._initialInspectorTab = options.initialInspectorTab || null;
    this.currentTeamId = 1;
    this.isBannerCarrier = true;
    this.selectedSocketName = 'torso';
    this.selectedPartIds = new Set();
    this._lastClickedPartId = null;
    this._hiddenPartIds = new Set();
    this._collapsedOutlinerNodes = new Set();
    this._renamingPartId = null;
    this._rigRightTab = 'add';
    this._rigAddSubTab = 'primitives';
    this._rigImportSubTab = 'new';
    this._rigTargetParentId = undefined;
    this._rigLibCategoryFilter = 'All';
    this._rigPrimitiveColor = '#94a3b8';
    this._studioBuildingActor = null;
    this._rigPanelCollapsed = (() => {
      try {
        return typeof window !== 'undefined' && window.localStorage?.getItem(RIG_COLLAPSE_STORAGE_KEY) === '1';
      } catch {
        return false;
      }
    })();
    this._multiPivot = new THREE.Group();
    this._multiPivot.name = '__studio_multi_pivot__';
    this._multiDragSnapshot = null;
    this.currentUnitGroup = null;
    this.currentAnimator = null;
    this._buildingFootprintGroup = null;
    this._lastFramedBuildingId = null;

    this._cleaned = false;                // idle without keys: the procedural pose was replaced by a clean rest pose for editing
    this._previewJoint = null;            // joint whose colour is being previewed
    this._keyedSignature = '';
    this._toastTimer = null;
    this._staticHintShown = false;
    this._undoStack = [];
    this._redoStack = [];
    this._undoTag = '';
    this._undoTime = 0;
    this._running = false;
    this._unsubRegistry = dataRegistry.subscribe((evt) => {
      const keys = evt?.changed || evt?.changedKeys || [];
      if (keys.length && !keys.some((k) => k === 'buildings' || k.startsWith('building:'))) return;
      if (this.ubStateManager) {
        this.ubStateManager.buildingsData = dataRegistry.getBuildings();
      }
      this._rebuildCrossLabViews?.();
      if (this.entityCategory === 'buildings' && this.view === 'studio') {
        this._refreshBuildingFootprintDisplay?.();
      }
    });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._onStorageSync = (e) => {
        if (!e || e.storageArea === window.localStorage) {
          dataRegistry.reloadFromStorage();
        }
      };
      window.addEventListener('storage', this._onStorageSync);
    }

    this._buildStudioDOM();
    this._initThreeScene();

    this.inspectorPanel = new InspectorPanel(this.rootContainer.querySelector('#st-inspector-mount'), {
      onForcePause: () => this._prepareEdit(),
      onTransformChange: () => this._onPoseEdited(),
      onEasingChange: (value) => {
        this.timelineEditor.setEasingAtPlayhead(value);
        this._applyPoseAt(this.timelineEditor.scrubNormTime);
      },
      onProceduralChange: (key, value) => this._onProceduralChange(key, value),
      onColorPreview: (hex) => this._applyColorPreview(hex),
      onColorSave: (hex, scope) => this._saveColorOverride(hex, scope)
    });

    this._spawnStudioUnit();
    this._initTimelineEditor();
    if (this._initialRequestedAnim && this.timelineEditor) {
      const req = this._initialRequestedAnim;
      const uDef = this.unitsData.units?.[this.currentUnitId];
      const ldDef = asLoadout(uDef, this.currentLoadout);
      if (req === "idle") {
        this.timelineEditor.showBase("idle", "unit");
      } else if (req === "walk" || req === "gallop") {
        const lBase = getLocomotionBase(ldDef, this.currentFaction);
        this.timelineEditor.showBase(lBase, "unit");
      } else if (req === "attack") {
        const cBase = getCombatBase(ldDef, this.currentFaction, this.unitsData.prefabs);
        this.timelineEditor.showBase(cBase, "unit");
      } else {
        this.timelineEditor.showBase(req, "unit");
      }
    }
    this._syncClipSelection();
    this._bindSidebarControls();
    if (this._initialInspectorTab && this.inspectorPanel) { this.inspectorPanel.switchTab(this._initialInspectorTab); }
    this._bindKeyboard();
    this._bindViewportPick();
    this._renderStatus();
    this._renderModeHelp();
    this._updateHealthBadge();
    if (this.stateManager.notice) this._toast(this.stateManager.notice, 5000);
    this._startLoop();
  }

  get stateManager() {
    if (this.entityCategory === "heroes") return this._heroStateAdapter;
    if (this.entityCategory === "buildings") return this._buildingsStateAdapter;
    return this.unitStateManager;
  }

  get unitsData() { return this.stateManager.data; }

  /** Kept for older callers that read the previous 'rig' / 'arena' flag. */
  get studioMode() { return this.view === 'arena' ? 'arena' : 'rig'; }

  // ================================================================== save status / toast

  _onSaveStatus(state, message) {
    this._saveStatus = { state, message: message || '' };
    if (state === 'saved') this._updateHealthBadge?.();
    if (state === 'error' && message) this._toast(message, 5000);
    this._renderStatus();
  }

  _renderStatus() {
    const chip = this.rootContainer?.querySelector('#st-save-chip');
    if (!chip) return;
    const def = CHIP[this._saveStatus.state] || CHIP.saved;
    chip.className = def.cls;
    chip.textContent = this._saveStatus.message || def.text;
  }

  _toast(message, ms = 2200) {
    const el = this.rootContainer?.querySelector('#st-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ================================================================== DOM

  /** Dynamically discover all factions from units.json (`data.factions`, `unit.race`, `unit.skins`). */
  _factions() {
    return getFactions(this.unitsData);
  }

  _factionOptions(selected) {
    return this._factions()
      .map((f) => `<option value="${f}" ${f === selected ? 'selected' : ''}>${getFactionLabel(this.unitsData, f)}</option>`)
      .join('');
  }

  _refreshFactionList() {
    const list = this._factions();
    if (!list.includes(this.currentFaction) && list.length) this.currentFaction = list[0];
    const sel = this.rootContainer?.querySelector('#st-faction-select');
    if (sel) sel.innerHTML = this._factionOptions(this.currentFaction);
  }

  _rebuildCrossLabViews() {
    if (this.unitStateManager?.data && this.heroStateManager?.data?.prefabs) {
      this.unitStateManager.data.prefabs = {
        ...(this.unitStateManager.data.prefabs || {}),
        ...(this.heroStateManager.data.prefabs || {})
      };
    }
    this._heroesStudioView = this.heroStateManager.getStudioViewData(this.unitStateManager.data);
    for (const u of Object.values(this._heroesStudioView.units || {})) {
      restow(this._heroesStudioView, u);
    }
    if (this._heroStateAdapter) {
      this._heroStateAdapter._view = this._heroesStudioView;
    }
    this._buildingsStudioView = buildBuildingsStudioViewData(
      this.ubStateManager.buildingsData,
      this.ubStateManager.buildingVisualsData,
      this.unitStateManager.data
    );
    if (this._buildingsStateAdapter) {
      this._buildingsStateAdapter._view = this._buildingsStudioView;
    }
  }

  /** Units/Heroes/Buildings belonging to one faction/people (`עמים`). */
  _unitsOfPeople(people) {
    return filterStudioEntitiesForFaction(this.unitsData.units, this.entityCategory, people, this.unitsData);
  }

  _raceOf(id) {
    const explicit = this.unitsData.units[id]?.race;
    if (explicit) return explicit;
    if (/^katiler/.test(id)) return 'katiler';
    if (/^mirukenkay/.test(id)) return 'mirukenkay';
    return null;
  }

  _refreshUnitList() {
    const ids = this._unitsOfPeople(this.currentFaction);
    if (!ids.includes(this.currentUnitId) && ids.length) { this.currentUnitId = ids[0]; this.currentLoadout = MAIN_LOADOUT; }
    const sel = this.rootContainer.querySelector('#st-unit-select');
    if (sel) sel.innerHTML = this._unitOptions(this.currentUnitId);
    this._refreshImportedDeleteButtons?.();
  }

  _unitOptions(selected) {
    return this._unitsOfPeople(this.currentFaction)
      .map((u) => {
        const def = this.unitsData.units?.[u];
        const label = def?.displayName ? `${def.displayName} (${u})` : u;
        return `<option value="${u}" ${u === selected ? 'selected' : ''}>${label}</option>`;
      })
      .join('');
  }

  /** Rig-mode edits of buildings live in the generated Studio view; copy them onto the building definitions before saving. */
  _pushBuildingRig() {
    const blds = this.ubStateManager?.buildingsData?.buildings;
    if (!blds) return;
    for (const [id, u] of Object.entries(this._buildingsStudioView?.units || {})) {
      if (!blds[id]) continue;
      if (u._partsDirty) blds[id].parts = JSON.parse(JSON.stringify(u.parts || []));
      if (!u.studioRig) continue;
      blds[id].studioRig = JSON.parse(JSON.stringify(u.studioRig));
    }
  }

  _switchEntityCategory(cat) {
    if (this.contextualHeroId) return;
    if (this.entityCategory === cat) return;
    const prevCat = this.entityCategory;
    this.stateManager.flush();
    if (prevCat === 'units' && this.ubStateManager && this.unitStateManager?.data) {
      this.ubStateManager.unitsVisualsData = this.unitStateManager.data;
      this.ubStateManager.saveAll();
    } else if (prevCat === 'heroes' && this.heroStateManager) {
      this.heroStateManager.syncFromStudioView();
      this.heroStateManager.saveDraft();
    }
    this.entityCategory = cat;
    this._rebuildCrossLabViews();
    this.modelFactory.visualsData = this.unitsData;
    this.sandboxArena?.setData(this.unitsData);
    if (this.timelineEditor) this.timelineEditor.animations = this.unitsData.animations;

    const list = this._unitsOfPeople(this.currentFaction);
    this.currentUnitId = list[0] || Object.keys(this.unitsData.units || {})[0];
    this.currentLoadout = MAIN_LOADOUT;
    this.selectedSocketName = 'torso';
    this.selectedPartIds.clear();
    this._lastClickedPartId = null;
    this._renamingPartId = null;
    this._multiDragSnapshot = null;
    this._rigTargetParentId = undefined;
    this._rigRightTab = 'add';
    this._studioBuildingActor = null;

    const tabUnits = this.rootContainer.querySelector("#st-tab-units");
    const tabHeroes = this.rootContainer.querySelector("#st-tab-heroes");
    const tabBuildings = this.rootContainer.querySelector("#st-tab-buildings");
    const lblClass = this.rootContainer.querySelector("#st-class-label");
    const btnExport = this.rootContainer.querySelector("#st-btn-export-json");
    if (tabUnits && tabHeroes) {
      tabUnits.className = cat === "units" ? SEG_ON : SEG_OFF;
      tabHeroes.className = cat === "heroes" ? "flex-1 rounded bg-amber-500 py-1.5 text-xs font-bold text-slate-950 shadow" : SEG_OFF;
      if (tabBuildings) {
        tabBuildings.className = cat === "buildings" ? "flex-1 rounded bg-emerald-500 py-1.5 text-xs font-bold text-slate-950 shadow" : SEG_OFF;
      }
    }
    if (lblClass) {
      lblClass.textContent = cat === "heroes" ? "Hero:" : cat === "buildings" ? "Building:" : "Unit:";
    }
    if (btnExport) {
      btnExport.textContent = cat === 'heroes' ? 'Export Heroes JSON' : cat === 'buildings' ? 'Export Bundle JSON' : 'Export JSON';
    }

    this._refreshUnitList();
    this._updateHealthBadge();
    if (cat !== 'buildings') {
      this._clearBuildingFootprintDisplay();
      this._lastFramedBuildingId = null;
      this.gizmoController?.snapToCloseupView();
    } else {
      this._lastFramedBuildingId = null;
    }
    this._spawnStudioUnit();
    this._renderImportPanel?.();
    this._toast(
      cat === 'heroes'
        ? 'Switched to Heroes (גיבורים) — saves to heroes.json'
        : cat === 'buildings'
          ? 'Switched to Buildings (מבנים) — saves to buildings bundle'
          : 'Switched to Units (יחידות) — saves to units.json'
    );
  }

  _buildStudioDOM() {
    const isContextual = Boolean(this.isContextualMode);
    const activeDef = isContextual ? this.unitsData.units?.[this.currentUnitId] : null;
    const isHeroesCat = this.entityCategory === 'heroes';
    const exitLabel = this.contextualHeroId
      ? '← Back to Heroes Lab'
      : this.contextualUnitId
        ? '← Back to Units Lab'
        : this.contextualBuildingId
          ? '← Back to Buildings Lab'
          : 'Back';
    const headerTitle = this.contextualHeroId
      ? `Kings Lands • Hero ${ANIMATION_LAB_NAME} (${activeDef?.displayName || this.contextualHeroId})`
      : this.contextualUnitId
        ? `Kings Lands • Unit ${ANIMATION_LAB_NAME} (${activeDef?.displayName || this.contextualUnitId})`
        : this.contextualBuildingId
          ? `Kings Lands • Building ${ANIMATION_LAB_NAME} (${activeDef?.displayName || this.contextualBuildingId})`
          : `Kings Lands • ${ANIMATION_LAB_NAME}`;

    this.rootContainer.innerHTML = `
      <div class="fixed inset-0 z-40 flex flex-col bg-slate-950 text-slate-100 select-none overflow-hidden">

        <header class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/95 px-4 py-2">
          <div class="flex items-center gap-3">
            <h1 class="text-sm font-bold uppercase tracking-wider text-amber-400">
              ${headerTitle}
            </h1>
            <div class="flex rounded-lg bg-slate-950 p-0.5 border border-slate-700 ${isContextual ? 'hidden' : ''}">
              <button id="st-mode-rig" class="${TAB_ON}">1. Studio</button>
              <button id="st-mode-arena" class="${TAB_OFF}">2. Arena</button>
            </div>
            ${!isContextual ? `<button id="st-btn-open-units-lab" class="rounded-lg border border-emerald-400/60 bg-emerald-500/15 hover:bg-emerald-500/25 px-3 py-1 text-xs font-bold text-emerald-300 transition">⚔️ Units & Buildings Lab</button><button id="st-btn-open-heroes" class="rounded-lg border border-amber-400/60 bg-amber-500/15 hover:bg-amber-500/25 px-3 py-1 text-xs font-bold text-amber-300 transition">👑 Hall of Heroes</button>` : ''}
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <button id="st-btn-health" class="whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200" title="Scan data for broken references, missing events and other mistakes">Health</button>
            <button id="st-btn-portraits" class="rounded-lg border border-slate-600 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200" title="Render portraits / icons as PNG files">Portraits</button>
            <button id="st-btn-export-json" class="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 shadow" title="Download JSON with all your changes (Ctrl+S saves the draft)">${isHeroesCat ? 'Export Heroes JSON' : 'Export JSON'}</button>
            <button id="st-btn-import-json" class="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200" title="Replace everything with an imported JSON file">Import JSON</button>
            <input id="st-import-file" type="file" accept=".json,application/json" class="hidden" />
            <button id="st-btn-reset-all" class="rounded-lg bg-rose-900 hover:bg-rose-800 px-3 py-1.5 text-xs font-bold text-white shadow" title="Throw away every change and reload defaults">Restart All</button>
            <button id="st-btn-exit" class="rounded-lg ${isContextual ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold shadow-lg' : 'bg-slate-800 hover:bg-slate-700 border border-slate-600 font-semibold text-slate-200'} px-3 py-1.5 text-xs">${exitLabel}</button>
          </div>
        </header>

        <div class="relative flex flex-1 min-h-0 overflow-hidden">
          <aside id="st-left-panel" class="w-72 shrink-0 border-r border-slate-800 bg-slate-900/90 p-3 overflow-y-auto flex flex-col gap-3 text-xs">
            <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
              ${
                isContextual
                  ? `
                    <div class="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 mb-2">
                      <div class="text-sm font-extrabold text-amber-300 truncate">${activeDef?.displayName || this.currentUnitId}</div>
                      <div class="text-[10px] text-slate-400 mono">${this.currentUnitId}</div>
                    </div>
                    <select id="st-faction-select" class="hidden">${this._factionOptions(this.currentFaction)}</select>
                    <select id="st-unit-select" class="hidden">${this._unitOptions(this.currentUnitId)}</select>
                  `
                  : `
                    <label class="block text-slate-400 mb-1">Faction:</label>
                    <select id="st-faction-select" class="w-full rounded bg-slate-800 border border-slate-600 px-2.5 py-1.5 font-semibold text-sky-200 mb-2.5">
                      ${this._factionOptions(this.currentFaction)}
                    </select>

                    <div class="flex gap-1 mb-2.5">
                      <button type="button" id="st-tab-units" class="${this.entityCategory === 'units' ? SEG_ON : SEG_OFF}">Units</button>
                      <button type="button" id="st-tab-heroes" class="${this.entityCategory === 'heroes' ? 'flex-1 rounded bg-amber-500 py-1.5 text-xs font-bold text-slate-950 shadow' : SEG_OFF}">Heroes</button>
                      <button type="button" id="st-tab-buildings" class="${this.entityCategory === 'buildings' ? 'flex-1 rounded bg-emerald-500 py-1.5 text-xs font-bold text-slate-950 shadow' : SEG_OFF}">Buildings</button>
                    </div>

                    <label id="st-class-label" class="block text-slate-400 mb-1">${isHeroesCat ? 'Hero:' : this.entityCategory === 'buildings' ? 'Building:' : 'Unit:'}</label>
                    <div class="flex items-center gap-1 mb-2">
                      <select id="st-unit-select" class="min-w-0 flex-1 rounded bg-slate-800 border border-slate-600 px-2.5 py-1.5 font-semibold text-slate-100">${this._unitOptions(this.currentUnitId)}</select>
                      <button type="button" id="st-btn-del-unit" title="Delete this imported model" class="hidden h-7 w-7 shrink-0 items-center justify-center rounded bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold cursor-pointer">✕</button>
                    </div>
                  `
              }
              <div id="st-base-char-row" class="hidden mt-2 pt-2 border-t border-slate-800">
                <label class="block text-slate-400 mb-1" title="Choose the Base Character body for this unit (weapons, mounts, stats & animations are kept)">Base Character:</label>
                <div class="flex items-center gap-1">
                  <select id="st-base-char-select" class="min-w-0 flex-1 rounded bg-slate-800 border border-slate-600 px-2 py-1 text-xs font-bold text-amber-200"></select>
                  <button type="button" id="st-btn-del-base" title="Delete this imported base model" class="hidden h-7 w-7 shrink-0 items-center justify-center rounded bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold cursor-pointer">✕</button>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2 mt-2">
                <select id="st-team-select" class="w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-slate-100">
                  <option value="1">Team 1</option><option value="2">Team 2</option>
                </select>
                <label id="st-banner-label" class="${this.entityCategory === 'buildings' ? 'hidden' : 'flex'} items-center gap-1.5 cursor-pointer py-1">
                  <input id="st-banner-toggle" type="checkbox" ${this.isBannerCarrier ? 'checked' : ''} class="accent-amber-400" />
                  <span class="text-slate-200">Banner</span>
                </label>
              </div>
            </div>

            <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5 flex flex-col gap-2">
              <span class="font-bold uppercase tracking-wider text-rose-300">Edit Mode</span>
              <div class="flex items-center gap-1">
                <button id="st-edit-pose" class="${SEG_ON}" title="Pose: edit the animation clip. Moving a joint changes the clip without touching the rest pose.">Pose</button>
                <button id="st-edit-rig" class="${SEG_OFF}" title="Rig: edit the character rest pose or building parts (saved with the unit or building).">Rig</button>
                <span class="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded border border-slate-700 bg-slate-900 text-[11px] font-bold text-slate-400 cursor-help" title="RIG: edits the rest pose / building parts (saved with the unit or building), affecting every clip." aria-label="Rig mode info">ⓘ</span>
              </div>
            </div>
          </aside>

          <main class="relative flex-1 h-full min-w-0 bg-slate-950 overflow-hidden flex flex-col">
            <div id="st-viewport" class="w-full flex-1 min-h-0"></div>
            <div id="st-gizmo-tools" class="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1 rounded-lg border border-slate-700 bg-slate-900/90 p-1">
              <button type="button" data-gizmo="translate" class="st-gt flex h-8 w-8 items-center justify-center rounded text-base" title="Move (W)">✥</button>
              <button type="button" data-gizmo="rotate" class="st-gt flex h-8 w-8 items-center justify-center rounded text-base" title="Rotate (E)">⟳</button>
              <button type="button" data-gizmo="scale" class="st-gt flex h-8 w-8 items-center justify-center rounded text-base" style="display:none" title="Scale (R) - Rig mode only: changes the size of the part">⤢</button>
            </div>
            <div id="st-inspector-mount" class="absolute top-3 right-3 bottom-3 z-10 hidden pointer-events-none flex flex-col items-end"></div>

            <div id="st-arena-toolbar" class="hidden absolute top-3 left-3 rounded-xl border border-amber-500/40 bg-slate-900/92 p-3 flex flex-col gap-2 text-xs z-10 w-full max-w-4xl max-h-[70vh] overflow-y-auto">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold uppercase tracking-wide text-amber-400">Arena</span>
                <button id="st-arena-place" class="rounded bg-sky-500 px-3 py-1 font-bold text-slate-950" title="Put the groups on the field. They wait until you press Play">Place</button>
                <button id="st-arena-play" class="rounded bg-emerald-500 px-3 py-1 font-bold text-slate-950" title="Start / pause the battle">▶ Play</button>
                <button id="st-arena-clear" class="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-slate-200">Clear field</button>
                <button id="st-arena-reset-pos" class="rounded border border-slate-600 bg-slate-800 px-3 py-1 text-slate-200" title="Put every group back to its automatic position">Reset positions</button>
                <div class="h-4 w-px bg-slate-700 mx-1"></div>
                <span class="text-slate-500">Quick:</span>
                <button id="st-arena-spawn-1v1" class="rounded bg-amber-500 px-2 py-1 font-bold text-slate-950">1v1 Duel</button>
                <button id="st-arena-spawn-company" class="rounded bg-amber-500 px-2 py-1 font-bold text-slate-950">12v12 Clash</button>
                <button id="st-arena-collapse" class="ml-auto rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200" title="Hide / show the group lists">▾ Groups</button>
              </div>
              <div id="st-arena-lists" class="flex flex-col gap-2">
                <div class="text-slate-400">Press <b class="text-sky-300">Place</b>, then <b class="text-slate-200">drag a group</b> (the coloured ring) anywhere on the field. <b class="text-emerald-300">Play</b> starts the fight. Editing a group while it waits updates the field.</div>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div class="rounded border border-blue-500/40 p-2"><div class="mb-1 flex items-center"><span class="font-bold text-blue-300">Side 1</span><button class="st-arena-add ml-auto rounded bg-slate-800 px-2 py-0.5 text-slate-200 hover:bg-slate-700" data-side="1">+ Add group</button></div><div id="st-arena-list-1" class="flex flex-col gap-1"></div></div>
                  <div class="rounded border border-rose-500/40 p-2"><div class="mb-1 flex items-center"><span class="font-bold text-rose-300">Side 2</span><button class="st-arena-add ml-auto rounded bg-slate-800 px-2 py-0.5 text-slate-200 hover:bg-slate-700" data-side="2">+ Add group</button></div><div id="st-arena-list-2" class="flex flex-col gap-1"></div></div>
                </div>
              </div>
              <div id="st-arena-metrics" class="mono text-xs text-slate-300">Ready</div>
            </div>

            <div id="st-toast" class="hidden absolute bottom-3 left-1/2 -translate-x-1/2 z-20 max-w-xl rounded-lg border border-slate-600 bg-slate-900/95 px-4 py-2 text-xs text-slate-100 shadow-xl pointer-events-none"></div>
          </main>
        </div>
        <footer id="st-timeline-mount" class="shrink-0"></footer>
        <footer id="st-rig-mount" class="hidden shrink-0 border-t border-rose-500/40 bg-slate-900/95 text-xs"></footer>
        <div id="st-modal" class="hidden absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div id="st-modal-card" class="max-h-full w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 p-4 text-xs shadow-2xl"></div></div>
      </div>
    `;
    const faction = this.rootContainer.querySelector('#st-faction-select');
    if (faction) faction.value = this.currentFaction;
  }

  _initThreeScene() {
    this.viewportEl = this.rootContainer.querySelector('#st-viewport');
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1120);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.viewportEl.appendChild(this.renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.85);
    hemi.position.set(0, 20, 0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfffbeb, 1.25);
    dir.position.set(6, 12, 8);
    this.scene.add(dir);

    this.studioPedestalGroup = new THREE.Group();
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.12, 32), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
    pedestal.position.y = -0.06;
    this.studioPedestalGroup.add(pedestal);
    const grid = new THREE.GridHelper(16, 16, 0x38bdf8, 0x1e293b);
    grid.position.y = 0.01;
    this.studioPedestalGroup.add(grid);
    this.studioSpellFxGroup = new THREE.Group();
    this.studioPedestalGroup.add(this.studioSpellFxGroup);
    this.studioFxPulses = [];
    this.studioProjectiles = [];
    this._lastStudioSpellNormT = 0;
    this.scene.add(this.studioPedestalGroup);

    this.scene.add(this._multiPivot);

    this.gizmoController = new GizmoController(this.camera, this.renderer.domElement, this.scene, {
      onBeforeDrag: () => this._prepareEdit(),
      onTransformChange: () => this._onPoseEdited(),
      onDragEnd: () => {
        this._recenterMultiPivotAfterDrag?.();
        this._updateKeyContext();
      }
    });

    this.sandboxArena = new SandboxArena(this.scene, this.modelFactory, this.unitsData.animations, this.synthAudio, this.unitsData);

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
  }

  // ================================================================== clip context (what the timeline edits)

  _base() { return this.timelineEditor?.activeBaseName || 'attack_slash'; }
  _varIdx() { return this.timelineEditor?.activeVariantIdx || 1; }
  _scope() { return this.timelineEditor?.scope || 'unit'; }
  _readName(base = this._base(), varIdx = this._varIdx()) {
    return readClipName(this.unitsData, this.currentUnitId, this.currentFaction, base, this._scope(), varIdx);
  }
  _readKeyframeClip(base = this._base(), varIdx = this._varIdx()) {
    const kf = this.unitsData.animations.keyframes || {};
    return kf[this._readName(base, varIdx)] || kf[withVariantIndex(base, varIdx)] || kf[this._readName(base, 1)] || kf[base] || null;
  }
  _readProceduralClip(base = this._base()) {
    const p = this.unitsData.animations.procedural || {};
    return p[this._readName(base)] || p[base] || null;
  }

  /** 'keys' = the pose comes from keyframes, 'procedural' = animator maths (walk/run/gallop/idle), 'rest' = Rig mode. */
  _previewKind() {
    if (this.editMode === 'rig') return 'rest';
    const tl = this.timelineEditor;
    if (!tl || tl.animMode === 'keyframes') return 'keys';
    if (hasKeys(tl.getReadClip()) || this._cleaned) return 'keys';
    return 'procedural';
  }

  _poseEditable() {
    return this.editMode === 'rig' || Boolean(this.timelineEditor?.canKeyframe());
  }

  _getDefaultEventSocket(type) {
    const equipment = this._eq();
    const prefabs = this.unitsData.prefabs || {};
    const kindOf = (id) => prefabs[id]?.kind || (RANGED_WEAPONS.includes(id) ? 'ranged' : HAND_WEAPONS.includes(id) ? 'melee' : '');
    const pick = (test) => EQUIPMENT_SOCKETS.find((s) => equipment[s]?.prefab && test(kindOf(equipment[s].prefab)));
    if (type === 'release') return pick((k) => k === 'ranged') || 'weapon_socket_R';
    return pick((k) => k === 'melee' || k === 'ranged') || 'weapon_socket_R';
  }

  // ================================================================== unit / joints

  _refreshBaseCharControl() {
    const row = this.rootContainer?.querySelector('#st-base-char-row');
    const sel = this.rootContainer?.querySelector('#st-base-char-select');
    if (!row || !sel) return;
    if (this.entityCategory !== 'units' || !this.ubStateManager) {
      row.classList.add('hidden');
      this._refreshImportedDeleteButtons();
      return;
    }
    const choices = this.ubStateManager.listBasesForUnit(this.currentUnitId) || [];
    if (!choices.length) {
      row.classList.add('hidden');
      this._refreshImportedDeleteButtons();
      return;
    }
    row.classList.remove('hidden');
    sel.disabled = choices.length <= 1;
    sel.classList.toggle('opacity-60', choices.length <= 1);
    sel.innerHTML = choices
      .map((b) => `<option value="${b.id}" ${b.current ? 'selected' : ''}>${b.label}</option>`)
      .join('');
    this._refreshImportedDeleteButtons();
  }

  _refreshImportedDeleteButtons() {
    const delUnitBtn = this.rootContainer?.querySelector('#st-btn-del-unit');
    if (delUnitBtn) {
      const canDelUnit =
        !this.isContextualMode &&
        this.entityCategory !== 'buildings' &&
        Boolean(this.unitsData.units?.[this.currentUnitId]?.importInfo);
      delUnitBtn.classList.toggle('hidden', !canDelUnit);
      delUnitBtn.classList.toggle('flex', canDelUnit);
    }
    const delBaseBtn = this.rootContainer?.querySelector('#st-btn-del-base');
    if (delBaseBtn) {
      const baseSel = this.rootContainer?.querySelector('#st-base-char-select');
      const baseId = baseSel?.value || '';
      const canDelBase =
        this.entityCategory === 'units' &&
        Boolean(baseId && this.unitsData.units?.[baseId]?.importInfo);
      delBaseBtn.classList.toggle('hidden', !canDelBase);
      delBaseBtn.classList.toggle('flex', canDelBase);
    }
  }

  _spawnStudioUnit() {
    this._restoreColorPreview();
    if (this.currentUnitGroup) {
      this.studioPedestalGroup.remove(this.currentUnitGroup);
      disposeVisual(this.currentUnitGroup);
    }
    this.gizmoController.detach();

    const unitDef = this.unitsData.units[this.currentUnitId];
    if (!unitDef) {
      this._refreshBaseCharControl();
      return;
    }
    const mainEq = unitDef.equipment;
    unitDef.equipment = this._eq();      // the factory builds whichever loadout is being edited
    try {
      const commonOpts = {
        visualsOverride: this.unitsData,
        skin: this.currentFaction,
        team: this.currentTeamId,
        isBannerCarrier: this.entityCategory === 'heroes' || this._isBuildingNow() ? false : this.isBannerCarrier,
        customTeamColors: getFactionColors(this.unitsData, this.currentFaction)
      };
      this.currentUnitGroup = this.entityCategory === 'heroes'
        ? modelProvider.createHeroModel(this.currentUnitId, {
            ...commonOpts,
            loadoutId: this.currentLoadout
          })
        : modelProvider.createUnitModel(this.currentUnitId, {
            ...commonOpts,
            equipmentOverride: unitDef.equipment
          });
    } finally { unitDef.equipment = mainEq; }
    if (unitDef?.isBuildingEntity) {
      let bDef = { id: unitDef.buildingId || this.currentUnitId, footprintRadiusMeters: 5, maxHp: 1200 };
      const bId = unitDef.buildingId || this.currentUnitId;
      try {
        this._buildingModelFactory = modelProvider.getBuildingModelFactory();
        const freshBuildingsData = dataRegistry.getBuildings();
        if (this.ubStateManager) this.ubStateManager.buildingsData = freshBuildingsData;
        this._buildingModelFactory.buildingsSource = freshBuildingsData;
        bDef = freshBuildingsData?.buildings?.[bId] || bDef;
        const lvNow = this.buildingPreviewLevel || 1;
        const hasStoredParts = Array.isArray(bDef.parts);
        const hasWt = hasStoredParts
          ? bDef.parts.some((p) => p.id === 'watchtower' && isPartEffectivelyActive(bDef.parts, p, lvNow) && !this._hiddenPartIds?.has(p.id))
          : (bDef.hasWatchtowerSupport !== false && ((bDef.watchtowerLevel | 0) > 0 || Boolean(bDef.hasBuiltInTurret)));
        const bActor = modelProvider.createBuildingModel(bId, {
          buildingDefOverride: { ...bDef, studioRig: undefined },   // the Studio applies the rig through the joints itself
          team: this.currentTeamId || 1,
          level: lvNow,
          footprintRadiusMeters: bDef.footprintRadiusMeters || 5,
          isCompleted: true,
          skipParts: true,   // parts are Studio joints here (drawn as markers)
          hasWatchtower: hasWt,
          hp: bDef.maxHp || 1200,
          maxHp: bDef.maxHp || 1200
        });
        this._studioBuildingActor = bActor;
        const s = STUDIO_BUILDING_SCALE;
        bActor.group.scale.set(s, s, s);
        bActor.group.position.y = -0.20;
        const socks = this.currentUnitGroup.userData?.sockets || {};
        if (socks.pelvis) {
          for (const ch of [...socks.pelvis.children]) {
            if (ch.isMesh) ch.visible = false;
          }
        }
        if (socks.torso) {
          // Hide placeholder box/cone meshes on torso/head so the real 3D building architecture shines!
          for (const ch of [...socks.torso.children]) {
            if (ch.isMesh) ch.visible = false;
          }
          if (socks.head) {
            for (const ch of [...socks.head.children]) {
              if (ch.isMesh) ch.visible = false;
            }
          }
          socks.torso.add(bActor.group);
        }
      } catch (e) {
        console.warn('Building 3D studio preview attach warning:', e);
        this._studioBuildingActor = null;
      }
      this._applyPartLevelVisibility();
      this._attachPartModels();
      this._refreshBuildingFootprintDisplay(bDef);
      if (this.view === 'studio' && this._lastFramedBuildingId !== bId) {
        this._frameBuildingCamera(bDef);
        this._lastFramedBuildingId = bId;
      }
    } else {
      this._studioBuildingActor = null;
      this._clearBuildingFootprintDisplay();
      this._lastFramedBuildingId = null;
    }
    this.studioPedestalGroup.add(this.currentUnitGroup);
    this._refreshStudioArrowPreview();

    this.currentAnimator = new Animator3D(this.currentUnitGroup, this.unitsData.animations);
    this._cleaned = false;
    this._keyedSignature = '';

    if (unitDef?.isBuildingEntity) {
      const partIds = new Set((unitDef.parts || []).map((p) => p.id));
      for (const id of [...(this.selectedPartIds || [])]) {
        if (!partIds.has(id)) this.selectedPartIds.delete(id);
      }
      this._multiDragSnapshot = null;
    } else {
      this.selectedPartIds?.clear?.();
      this._multiDragSnapshot = null;
    }

    if (this.timelineEditor) { this.timelineEditor.refreshClipList(); this._syncClipSelection(); }
    else this._selectJoint(this.selectedSocketName);
    { const bl = this.rootContainer.querySelector('#st-banner-label'); if (bl) bl.style.display = this._isBuildingNow() ? 'none' : ''; }
    this._refreshBaseCharControl();
    this._renderImportPanel();
  }

  _clearBuildingFootprintDisplay() {
    if (this._buildingFootprintGroup) {
      this.studioPedestalGroup?.remove(this._buildingFootprintGroup);
      disposeVisual(this._buildingFootprintGroup);
      this._buildingFootprintGroup = null;
    }
  }

  _refreshBuildingFootprintDisplay(bDefOverride = null) {
    this._clearBuildingFootprintDisplay();
    if (this.entityCategory !== 'buildings' && !this.unitsData.units?.[this.currentUnitId]?.isBuildingEntity) {
      return;
    }
    const unitDef = this.unitsData.units?.[this.currentUnitId];
    const bId = unitDef?.buildingId || this.currentUnitId;
    const bDef = bDefOverride
      || dataRegistry.getBuilding(bId)
      || this.ubStateManager?.buildingsData?.buildings?.[bId]
      || { id: bId, footprintRadiusMeters: 5 };
    this._buildingFootprintGroup = createBuildingFootprintDisplayGroup(bDef, STUDIO_BUILDING_SCALE);
    this.studioPedestalGroup?.add(this._buildingFootprintGroup);
  }

  _frameBuildingCamera(bDefOverride = null) {
    if (!this.gizmoController) return;
    const unitDef = this.unitsData.units?.[this.currentUnitId];
    const bId = unitDef?.buildingId || this.currentUnitId;
    const bDef = bDefOverride
      || dataRegistry.getBuilding(bId)
      || this.ubStateManager?.buildingsData?.buildings?.[bId]
      || { id: bId, footprintRadiusMeters: 5 };
    const { length, width } = resolveBuildingFootprintMeters(bDef);
    const wS = width * STUDIO_BUILDING_SCALE;
    const lS = length * STUDIO_BUILDING_SCALE;
    const span = Math.max(wS, lS + 1.2, 3.2);
    const dist = Math.max(6.2, span * 1.42);
    this.gizmoController.orbit.target.set(0, 0.65, lS * 0.14);
    this.gizmoController.camera.position.set(dist * 0.68, dist * 0.68, dist * 0.94);
    this.gizmoController.camera.lookAt(this.gizmoController.orbit.target);
    this.gizmoController.orbit.update();
  }

  /** Everything that depends on "which clip / scope / unit is showing" is refreshed here. */
  _syncClipSelection() {
    const tl = this.timelineEditor;
    if (!tl || !this.currentAnimator) return;
    const anim = this.currentAnimator;

    if (tl.animMode === 'procedural') anim.setLocomotion(tl.getClipName());
    else anim.setLocomotion('idle');
    anim.lowerLayer.normTime = tl.scrubNormTime;
    this._cleaned = false;

    tl.refresh();
    this._selectJoint(this.selectedSocketName);
    this._applyPoseAt(tl.scrubNormTime);
    this._updateKeyContext();
  }

  _selectJoint(socketName, opts = {}) {
    this.gripJoint = opts.fit ? socketName : null;
    const sockets = this.currentUnitGroup?.userData?.sockets || {};
    const unitDef = this.unitsData?.units?.[this.currentUnitId];
    const isB = Boolean(unitDef?.isBuildingEntity);
    const parts = isB ? (unitDef.parts || []) : [];
    const partIds = new Set(parts.map((p) => p.id));
    const hidden = new Set(isB ? (unitDef.hiddenJoints || []) : []);

    if (isB && this.editMode === 'pose') {
      this.selectedPartIds?.clear?.();
      this._multiDragSnapshot = null;
      if (partIds.has(socketName) || hidden.has(socketName)) {
        socketName = 'torso';
      }
    }

    if (isB && this.editMode === 'rig' && !opts.fit && this.selectedPartIds?.size > 1) {
      const valid = new Set([...this.selectedPartIds].filter((id) => partIds.has(id) && sockets[id]));
      this.selectedPartIds = valid;
      if (valid.size > 1) {
        const topIds = topLevelSelectedPartIds(parts, valid);
        if (topIds.length >= 1) {
          this._restoreColorPreview();
          this.selectedSocketName = topIds[0];
          this._syncMultiPivotToSelection?.(topIds);
          this.gizmoController.gizmoTargetType = 'multi_parts';
          this.gizmoController.setEnabled(true);
          this.gizmoController.attachToObject(this._multiPivot, this.gizmoController.getMode());
          this.inspectorPanel.setTarget(this._multiPivot, `${valid.size} parts selected`, {
            kind: 'multi',
            rest: null,
            procClip: null,
            transformsEnabled: true,
            color: null
          });
          this._renderGearPanel();
          this._renderIconsPanel?.();
          this._syncHandControls();
          this._renderRigPanel();
          this._updateKeyContext();
          return;
        }
      }
    }

    const target = sockets[socketName] || sockets.torso;
    if (!target) return;

    if (!opts.preserveMulti) {
      if (isB && this.editMode === 'rig' && partIds.has(target.name)) {
        this.selectedPartIds = new Set([target.name]);
        this._lastClickedPartId = target.name;
      } else {
        this.selectedPartIds?.clear?.();
      }
      this._multiDragSnapshot = null;
    }

    if (this.selectedSocketName !== target.name) this._restoreColorPreview();
    this.selectedSocketName = target.name;

    const heldHere = this.currentUnitGroup.userData.attachedPrefabs?.[target.name] || null;
    const attachedPrefab = heldHere && this.gripJoint === target.name ? heldHere : null;
    // the game's factory freezes prefab groups (matrixAutoUpdate=false): unfreeze the one being fitted so move/rotate shows
    if (attachedPrefab) { attachedPrefab.matrixAutoUpdate = true; attachedPrefab.updateMatrix(); }
    const focusObj = attachedPrefab || target;
    const kind = attachedPrefab ? 'weapon_grip' : 'joint';
    const transformsEnabled = Boolean(attachedPrefab) || this._poseEditable();

    this.gizmoController.gizmoTargetType = kind;
    this.gizmoController.setEnabled(transformsEnabled);
    this.gizmoController.attachToObject(focusObj, this.gizmoController.getMode());

    const partMatch = isB ? parts.find((p) => p.id === target.name) : null;
    const displayName = isB
      ? (unitDef.jointLabels?.[target.name] || partMatch?.name || target.name)
      : target.name;

    const isMove = this.timelineEditor?.animMode === 'procedural';
    this.inspectorPanel.setTarget(focusObj, displayName, {
      kind,
      rest: attachedPrefab ? null : (this.currentUnitGroup.userData.restPoses?.[target.name] || null),
      procClip: isMove ? this._readProceduralClip() : null,
      transformsEnabled,
      color: this._jointColorHex(target.name)
    });

    this._renderGearPanel();
    this._renderIconsPanel?.();
    this._syncHandControls();
    this._renderRigPanel();
    if (!isB || !partIds.has(target.name)) {
      this.timelineEditor?.setSelectedJoint(target.name);
    }
    this._updateKeyContext();
  }

  _syncGizmoTools() {
    const mode = this.gizmoController?.getMode?.();
    this.rootContainer?.querySelectorAll('.st-gt').forEach((b) => {
      b.className = `st-gt flex h-8 w-8 items-center justify-center rounded text-base ${b.dataset.gizmo === mode ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:bg-slate-700'}`;
    });
  }

  // ================================================================== modal, health check, portraits

  _openModal(html) {
    const m = this.rootContainer.querySelector('#st-modal');
    m.querySelector('#st-modal-card').innerHTML = html;
    m.classList.remove('hidden');
  }

  _closeModal() {
    this.rootContainer?.querySelector('#st-modal')?.classList.add('hidden');
    this._portraitStudio?.dispose();
    this._portraitStudio = null;
  }

  _modalOpen() { return !this.rootContainer.querySelector('#st-modal').classList.contains('hidden'); }

  _updateHealthBadge() {
    const b = this.rootContainer?.querySelector('#st-btn-health');
    if (!b) return;
    const { counts } = runHealthCheck(this.unitsData);
    const base = 'whitespace-nowrap inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ';
    if (counts.error || counts.warn) {
      b.className = base + (counts.error
        ? 'border-rose-500/70 bg-rose-950/60 text-slate-100 hover:bg-rose-900/70'
        : 'border-amber-500/70 bg-amber-950/50 text-slate-100 hover:bg-amber-900/60');
      b.innerHTML = '<span>Health</span><span class="text-rose-500 font-black leading-none">!</span>';
    } else {
      b.className = base + 'border-emerald-600 bg-slate-800 text-emerald-300 hover:bg-slate-700';
      b.innerHTML = '<span>Health</span><span class="text-emerald-400 font-bold leading-none">✓</span>';
    }
  }

  _healthReportText(issues) {
    return issues.map((i) => `[${i.level.toUpperCase()}] ${i.area}: ${i.message}`).join('\n') || 'No problems found.';
  }

  _openHealth() {
    const { issues, counts } = runHealthCheck(this.unitsData);
    this._healthIssues = issues;
    const filters = this._healthFilters || (this._healthFilters = { error: true, warn: true, info: false });
    const color = { error: 'text-rose-300', warn: 'text-amber-300', info: 'text-slate-400' };
    const shown = issues.map((it, i) => ({ it, i })).filter(({ it }) => filters[it.level]);
    const chip = (lvl, label) => `<label class="flex cursor-pointer items-center gap-1 rounded border border-slate-600 px-2 py-1 ${color[lvl]}"><input type="checkbox" class="hc-filter accent-sky-400" data-level="${lvl}" ${filters[lvl] ? 'checked' : ''}/> ${label} ${counts[lvl]}</label>`;
    this._openModal(`
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <span class="text-sm font-bold text-amber-400">Health check</span>
        ${chip('error', 'Errors')}${chip('warn', 'Warnings')}${chip('info', 'Info')}
        <button id="hc-recheck" class="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700">Check again</button>
        <button id="hc-copy" class="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700" title="Copy the whole list as text (for a message or for the AI)">Copy report</button>
        <button id="hc-close" class="ml-auto rounded bg-slate-700 px-3 py-1 font-semibold text-slate-100 hover:bg-slate-600">Close</button>
      </div>
      ${issues.length === 0 ? '<div class="rounded border border-emerald-600/50 bg-emerald-900/20 p-3 text-emerald-200">Everything checks out. No problems found.</div>' : ''}
      <div class="flex flex-col gap-1">${shown.map(({ it, i }) => `
        <button type="button" class="hc-issue flex items-start gap-2 rounded border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-left hover:bg-slate-800" data-i="${i}" ${it.goto ? '' : 'disabled'}>
          <span class="w-12 shrink-0 font-bold uppercase ${color[it.level]}">${it.level}</span>
          <span class="mono w-48 shrink-0 truncate text-slate-400" title="${it.area}">${it.area}</span>
          <span class="flex-1 text-slate-100">${it.message}</span>
          ${it.goto ? '<span class="shrink-0 text-sky-300">Go ›</span>' : ''}
        </button>`).join('')}</div>`);
    const card = this.rootContainer.querySelector('#st-modal-card');
    card.querySelector('#hc-close').onclick = () => this._closeModal();
    card.querySelector('#hc-recheck').onclick = () => this._openHealth();
    card.querySelector('#hc-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(this._healthReportText(issues)); this._toast('Report copied'); } catch (_) { this._toast('Copy failed'); }
    };
    card.querySelectorAll('.hc-filter').forEach((c) => { c.onchange = () => { filters[c.dataset.level] = c.checked; this._openHealth(); }; });
    card.querySelectorAll('.hc-issue').forEach((b) => { b.onclick = () => { this._gotoIssue(issues[Number(b.dataset.i)].goto); }; });
  }

  /** Jump the studio to the unit / faction / clip an issue talks about. */
  _gotoIssue(goto) {
    if (!goto) return;
    const units = Object.keys(this.unitsData.units);
    let { unit, faction, base } = goto;
    let scope = null;
    if (goto.clip) {
      const name = goto.clip;
      base = base || null;
      if (!unit) unit = units.find((u) => name.startsWith(`${u}_`)) || null;
      if (unit) {
        const rest = name.slice(unit.length + 1);
        const fac = this._factions().find((f) => rest.startsWith(`${f}_`));
        if (fac && !faction) faction = fac;
      }
      scope = name === base ? 'global' : 'unit';
    }
    this._closeModal();
    if (this.view !== 'studio') this._showView('studio');
    const qs = (sel) => this.rootContainer.querySelector(sel);
    if (unit && this.unitsData.units[unit]) { this.currentUnitId = unit; qs('#st-unit-select').value = unit; }
    if (faction && this._factions().includes(faction)) { this.currentFaction = faction; qs('#st-faction-select').value = faction; this._refreshUnitList(); }
    this._spawnStudioUnit();
    if (base) this.timelineEditor.showBase(base, scope);
  }

  _openPortraits() {
    const units = Object.keys(this.unitsData.units);
    const o = this._portraitOpts || (this._portraitOpts = { ...PORTRAIT_DEFAULTS, all: false, factions: [this.currentFaction] });
    const sel = (id, label, options, value) => `<label class="flex items-center gap-1 text-slate-300">${label}<select id="${id}" class="rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-slate-100">${options.map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    this._openModal(`
      <div class="mb-3 flex items-center gap-2"><span class="text-sm font-bold text-amber-400">Portraits &amp; icons</span><button id="pt-close" class="ml-auto rounded bg-slate-700 px-3 py-1 font-semibold text-slate-100 hover:bg-slate-600">Close</button></div>
      <div class="flex flex-col gap-3 md:flex-row">
        <div class="flex shrink-0 flex-col items-center gap-1">
          <div class="rounded border border-slate-700" style="width:256px;height:256px;background:repeating-conic-gradient(#1e293b 0% 25%, #0f172a 0% 50%) 50% / 24px 24px"><img id="pt-preview" alt="" width="256" height="256" /></div>
          <div class="mono text-slate-500" id="pt-caption"></div>
        </div>
        <div class="flex flex-1 flex-col gap-2">
          <div class="flex flex-wrap gap-3">
            ${sel('pt-size', 'Size', [[128, '128 px'], [256, '256 px'], [512, '512 px']], o.size)}
            ${sel('pt-view', 'Framing', [['bust', 'Bust (head + shoulders)'], ['full', 'Full body']], o.view)}
            ${sel('pt-angle', 'Angle', [['three_quarter', '3/4 view'], ['front', 'Front']], o.angle)}
            ${sel('pt-bg', 'Background', [['transparent', 'Transparent'], ['dark', 'Dark'], ['light', 'Light']], o.background)}
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-slate-400">Factions:</span>
            ${this._factions().map((f) => `<label class="flex items-center gap-1 text-slate-200"><input type="checkbox" class="pt-fac accent-sky-400" value="${f}" ${o.factions.includes(f) ? 'checked' : ''}/> ${f}</label>`).join('')}
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-slate-400">Units:</span>
            <label class="flex items-center gap-1 text-slate-200"><input type="radio" name="pt-units" id="pt-units-cur" ${o.all ? '' : 'checked'}/> this unit (${this.currentUnitId})</label>
            <label class="flex items-center gap-1 text-slate-200"><input type="radio" name="pt-units" id="pt-units-all" ${o.all ? 'checked' : ''}/> all ${units.length} units</label>
          </div>
          <div class="flex flex-wrap gap-2 pt-1">
            ${this.entityCategory === 'heroes' ? `<button id="pt-save-profile" class="rounded bg-amber-500 hover:bg-amber-400 px-3 py-1.5 font-extrabold text-slate-950 shadow">📸 Save to Hero Profile</button>` : ''}
            <button id="pt-png" class="rounded bg-sky-500 px-3 py-1.5 font-bold text-slate-950">Download this picture (PNG)</button>
            <button id="pt-zip" class="rounded bg-emerald-500 px-3 py-1.5 font-bold text-slate-950">Download set (ZIP)</button>
          </div>
          <div id="pt-status" class="text-slate-400">Files are named <span class="mono">unit_faction.png</span>. The picture shows the rest pose.</div>
        </div>
      </div>`);
    const q = (s) => this.rootContainer.querySelector(`#st-modal-card ${s}`);
    this._portraitStudio?.dispose();
    this.modelFactory.visualsData = this.unitsData;
    this._portraitStudio = createPortraitStudio(this.modelFactory, this.unitsData);
    const read = () => {
      o.size = Number(q('#pt-size').value); o.view = q('#pt-view').value; o.angle = q('#pt-angle').value; o.background = q('#pt-bg').value;
      o.factions = [...this.rootContainer.querySelectorAll('#st-modal-card .pt-fac')].filter((c) => c.checked).map((c) => c.value);
      o.all = q('#pt-units-all').checked;
    };
    const shotOpts = () => ({ size: o.size, view: o.view, angle: o.angle, background: o.background });
    const preview = () => {
      read();
      const fac = o.factions.includes(this.currentFaction) ? this.currentFaction : (o.factions[0] || this.currentFaction);
      try {
        const c = this._portraitStudio.render(this.currentUnitId, fac, { ...shotOpts(), size: 256 });
        q('#pt-preview').src = c.toDataURL('image/png');
        q('#pt-caption').textContent = `${this.currentUnitId}_${fac}`;
      } catch (e) { q('#pt-status').textContent = `Preview failed: ${e.message}`; }
    };
    this.rootContainer.querySelectorAll('#st-modal-card select, #st-modal-card input').forEach((el) => el.addEventListener('change', preview));
    q('#pt-close').onclick = () => this._closeModal();
    if (q('#pt-save-profile')) {
      q('#pt-save-profile').onclick = () => {
        read();
        const fac = o.factions.includes(this.currentFaction) ? this.currentFaction : (o.factions[0] || this.currentFaction);
        const c = this._portraitStudio.render(this.currentUnitId, fac, shotOpts());
        const dataUrl = c.toDataURL('image/png');
        this.heroStateManager.setHeroPortrait(this.currentUnitId, dataUrl);
        q('#pt-status').textContent = `✓ Saved portrait to ${this.currentUnitId} profile!`;
        this._toast('Saved portrait to Hero profile!');
      };
    }
    q('#pt-png').onclick = async () => {
      read();
      const fac = o.factions.includes(this.currentFaction) ? this.currentFaction : (o.factions[0] || this.currentFaction);
      const bytes = await canvasToPngBytes(this._portraitStudio.render(this.currentUnitId, fac, shotOpts()));
      downloadBytes(bytes, `${this.currentUnitId}_${fac}.png`, 'image/png');
    };
    q('#pt-zip').onclick = async () => {
      read();
      if (!o.factions.length) { q('#pt-status').textContent = 'Pick at least one faction.'; return; }
      const list = o.all ? units : [this.currentUnitId];
      const files = [];
      for (const u of list) for (const f of o.factions) {
        files.push({ name: `${u}_${f}.png`, data: await canvasToPngBytes(this._portraitStudio.render(u, f, shotOpts())) });
      }
      downloadBytes(makeZip(files), 'kings_lands_portraits.zip', 'application/zip');
      q('#pt-status').textContent = `${files.length} pictures downloaded.`;
    };
    preview();
  }

  // ================================================================== arena scene builder

  _defaultArenaScene() {
    const units = Object.keys(this.unitsData.units);
    const pick = (u) => (this.unitsData.units[u] ? u : units[0]);
    return {
      1: [{ side: 1, unit: pick('swordsman'), faction: 'human', count: 12 }],
      2: [{ side: 2, unit: pick('spearman'), faction: 'orc', count: 12 }]
    };
  }

  _renderArenaLists() {
    if (!this.arenaScene) this.arenaScene = this._defaultArenaScene();
    const sel = (cls, options, value, extra = '') =>
      `<select class="${cls} rounded bg-slate-800 border border-slate-600 px-1.5 py-1 text-slate-100 ${extra}">${options.map((o) => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    const unitNames = Object.keys(this.unitsData.units);
    for (const side of [1, 2]) {
      const host = this.rootContainer.querySelector(`#st-arena-list-${side}`);
      if (!host) continue;
      const list = this.arenaScene[side];
      const addBtn = this.rootContainer.querySelector(`.st-arena-add[data-side="${side}"]`);
      if (addBtn) { const full = list.length >= MAX_ARENA_GROUPS; addBtn.classList.toggle('opacity-40', full); addBtn.title = full ? `Up to ${MAX_ARENA_GROUPS} groups per side` : ''; }
      const stripe = side === 1 ? 'border-blue-500' : 'border-rose-500';
      host.innerHTML = list.length ? list.map((g, i) => `
        <div class="flex items-center gap-1 rounded border-l-4 ${stripe} bg-slate-800/60 py-1 pl-1.5 pr-1" data-side="${side}" data-i="${i}">
          ${sel('ag-faction', this._factions(), g.faction)}
          ${sel('ag-unit', unitNames, g.unit, 'font-semibold flex-1 min-w-0')}
          <button type="button" class="ag-dec h-6 w-6 rounded bg-slate-700 text-slate-100 hover:bg-slate-600" title="Fewer">−</button>
          <input type="number" min="1" max="200" value="${g.count}" class="ag-count w-12 rounded bg-slate-900 border border-slate-600 px-1 py-1 text-center text-amber-300 font-bold" title="How many" />
          <button type="button" class="ag-inc h-6 w-6 rounded bg-slate-700 text-slate-100 hover:bg-slate-600" title="More">+</button>
          <button type="button" class="ag-del rounded px-1.5 text-slate-400 hover:text-rose-400" title="Remove group">✕</button>
        </div>`).join('') : '<div class="text-slate-500">No groups. Add one.</div>';
    }
  }

  _arenaGroups() { return [...this.arenaScene[1], ...this.arenaScene[2]]; }

  /** Put the scene on the field. `frame` also re-aims the camera. */
  _placeArena({ frame = false, paused = true } = {}) {
    this.sandboxArena.spawnScene(this._arenaGroups(), { paused });
    if (frame) {
      const { x, z } = this.sandboxArena.getExtent();
      this.gizmoController.snapToRtsGameView(Math.max(26, x / 0.5, z / 0.3), new THREE.Vector3(0, 0, 0));
    }
    this._syncPlayLabel();
  }

  _syncPlayLabel() {
    const b = this.rootContainer.querySelector('#st-arena-play');
    if (b) b.textContent = this.sandboxArena.isPaused() ? '▶ Play' : '■ Pause';
  }

  /** A group was edited while waiting on the field: show the change right away (positions are kept). */
  _refreshWaitingArena() {
    if (this.sandboxArena.combatants.length && this.sandboxArena.isPaused()) this._placeArena();
  }

  _bindArenaPanel() {
    const qs = (s) => this.rootContainer.querySelector(s);
    this._renderArenaLists();
    const toolbar = qs('#st-arena-toolbar');
    const groupOf = (row) => this.arenaScene[row.dataset.side][Number(row.dataset.i)];
    const read = (row) => {
      const g = groupOf(row);
      if (!g) return;
      g.faction = row.querySelector('.ag-faction').value;
      g.unit = row.querySelector('.ag-unit').value;
      g.count = Math.max(1, Math.min(200, Math.floor(Number(row.querySelector('.ag-count').value) || 1)));
      row.querySelector('.ag-count').value = g.count;
    };
    toolbar.addEventListener('change', (e) => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const before = groupOf(row)?.unit;
      read(row);
      if (groupOf(row).unit !== before) { delete groupOf(row).x; delete groupOf(row).z; }   // another unit type: let it find its own spot
      this._refreshWaitingArena();
    });
    toolbar.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (row && (e.target.closest('.ag-inc') || e.target.closest('.ag-dec'))) {
        const input = row.querySelector('.ag-count');
        input.value = Number(input.value || 1) + (e.target.closest('.ag-inc') ? 1 : -1) * (e.shiftKey ? 5 : 1);
        read(row);
        this._refreshWaitingArena();
        return;
      }
      const add = e.target.closest('.st-arena-add');
      if (add) {
        const side = add.dataset.side;
        if (this.arenaScene[side].length >= MAX_ARENA_GROUPS) { this._toast(`Up to ${MAX_ARENA_GROUPS} groups per side`); return; }
        const last = this.arenaScene[side][this.arenaScene[side].length - 1] || this._defaultArenaScene()[side][0];
        const g = { ...last, side: Number(side) };
        delete g.x; delete g.z;
        this.arenaScene[side].push(g);
        this._renderArenaLists();
        this._refreshWaitingArena();
        return;
      }
      const del = e.target.closest('.ag-del');
      if (del) {
        const r = del.closest('[data-i]');
        this.arenaScene[r.dataset.side].splice(Number(r.dataset.i), 1);
        this._renderArenaLists();
        this._refreshWaitingArena();
      }
    });

    qs('#st-arena-place').addEventListener('click', () => { this._placeArena({ frame: true }); hideLists(true); });   // free the field so the groups can be dragged
    qs('#st-arena-play').addEventListener('click', () => {
      if (!this.sandboxArena.combatants.length) this._placeArena({ frame: true });
      hideLists(true);
      this.sandboxArena.setPaused(!this.sandboxArena.isPaused());
      this._syncPlayLabel();
    });
    qs('#st-arena-clear').addEventListener('click', () => { this.sandboxArena.clearArena(); this._syncPlayLabel(); });
    qs('#st-arena-reset-pos').addEventListener('click', () => {
      for (const g of this._arenaGroups()) { delete g.x; delete g.z; }
      if (this.sandboxArena.combatants.length) this._placeArena({ frame: true });
    });
    const hideLists = (hide) => {
      qs('#st-arena-lists').classList.toggle('hidden', hide);
      qs('#st-arena-collapse').textContent = hide ? '▸ Groups' : '▾ Groups';
    };
    qs('#st-arena-collapse').addEventListener('click', () => hideLists(!qs('#st-arena-lists').classList.contains('hidden')));
    this._hideArenaLists = hideLists;
    const quick = (count) => {
      const a = this.arenaScene[1][0] || this._defaultArenaScene()[1][0];
      const b = this.arenaScene[2][0] || this._defaultArenaScene()[2][0];
      this.arenaScene = {
        1: [{ side: 1, unit: a.unit, faction: a.faction, count }],
        2: [{ side: 2, unit: b.unit, faction: b.faction, count }]
      };
      this._renderArenaLists();
      this._placeArena({ frame: true, paused: false });
    };
    qs('#st-arena-spawn-1v1').addEventListener('click', () => quick(1));
    qs('#st-arena-spawn-company').addEventListener('click', () => quick(12));
    this._bindArenaDrag();
  }

  /** Drag a placed group over the field with the mouse (only while it waits, before Play). */
  _bindArenaDrag() {
    const canvas = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    let drag = null;

    const aim = (e) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, this.camera);
    };
    const ground = () => (raycaster.ray.intersectPlane(plane, hit) ? hit : null);

    this._onArenaDown = (e) => {
      if (this.view !== 'arena' || e.button !== 0) return;
      aim(e);
      const index = this.sandboxArena.groupAt(raycaster);
      if (index < 0) return;
      const p = ground();
      const a = this.sandboxArena.getGroupAnchor(index);
      if (!p || !a) return;
      e.stopImmediatePropagation();   // do not orbit the camera
      e.preventDefault();
      drag = { index, offX: a.x - p.x, offZ: a.z - p.z };
      this.gizmoController.orbit.enabled = false;
      canvas.setPointerCapture?.(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    this._onArenaMove = (e) => {
      if (this.view !== 'arena') return;
      aim(e);
      if (drag) {
        const p = ground();
        if (p) this.sandboxArena.moveGroup(drag.index, p.x + drag.offX, p.z + drag.offZ);
        return;
      }
      canvas.style.cursor = this.sandboxArena.groupAt(raycaster) >= 0 ? 'grab' : '';
    };
    this._onArenaUp = () => {
      if (!drag) return;
      drag = null;
      this.gizmoController.orbit.enabled = true;
      canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerdown', this._onArenaDown, true);
    canvas.addEventListener('pointermove', this._onArenaMove);
    canvas.addEventListener('pointerup', this._onArenaUp);
    canvas.addEventListener('pointercancel', this._onArenaUp);
  }

  /** Rig mode replaces the keyframe sheet with a plain list of every part that can be shaped. */
}

import { studioGearAndPoseMethods } from './studioGearAndPose.js';
import { studioControlsAndLoopMethods } from './studioControlsAndLoop.js';
import { studioImportMethods } from './studioImport.js';

Object.assign(
  StudioApp.prototype,
  studioGearAndPoseMethods,
  studioControlsAndLoopMethods,
  studioImportMethods
);
