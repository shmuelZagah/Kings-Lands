/**
 * Kings Lands — Animation Lab Timeline Wiring, Undo/Redo, Viewport Picking, Shortcuts & Render Loop
 * (src/tools/studio/studioControlsAndLoop.js)
 */
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

import { modelProvider } from '../../render/modelProvider.js';
import * as THREE from 'three';
import { buildSculptedArrowGeometry, spawn3DSpellEffect } from '../../render/worldEffectsRenderer.js';
import { Animator3D } from '../../render/animator3d.js';
import { SynthAudio } from '../../audio/synthAudio.js';
import { GizmoController } from './gizmoController.js';
import { TimelineEditor } from './timelineEditor.js';
import { SandboxArena } from './sandboxArena.js';
import { StudioStateManager } from './studioStateManager.js';
import { HeroStateManager, getHeroSpellClipBases, findSpellDef } from '../heroes/heroStateManager.js';
import { InspectorPanel } from './inspectorPanel.js';
import { ACTION_CLIPS, clipNameFor, getCombatBase, resolveClip, resolveClipVariants, variantIndexOf, withVariantIndex } from './clipResolver.js';
import { EQUIPMENT_SOCKETS, HAND_SOCKETS, STOW_SOCKETS, STOW_DEFAULTS, MAIN_LOADOUT, asLoadout, restow, equipmentOf, grantedActions, isDualWield, isTwoHanded, loadoutsOf, lockedHand, weaponTypeOf } from './weaponRules.js';
import { runHealthCheck } from './healthCheck.js';
import { createPortraitStudio, canvasToPngBytes, makeZip, downloadBytes, PORTRAIT_DEFAULTS } from './portraitRenderer.js';
import * as KT from './keyTracks.js';
import { createClipVariation, deleteClipVariation, ensureKeyframeClip, ensureProceduralClip, readClipName } from './clipEditing.js';
import { FACTION_TEAM_COLORS, getFactions, getFactionLabel, getFactionColors, isSharedUnitsFaction, applySkinColors, disposeVisual, ownMaterial } from './skinUtils.js';

const ALLOWED_EQUIPMENT = {
  weapon_socket_R: ['sword', 'ravan_prince_sword', 'king_sovereign_sword', 'sisnat_double_axe', 'spear', 'pike', 'worker_hammer', 'javelin', 'bow', 'crossbow', 'wizard_staff'],
  weapon_socket_L: ['shield', 'tower_shield', 'royal_crest_shield', 'round_buckler', 'kite_shield', 'bow', 'wizard_tome'],
  head: ['helmet_iron', 'helmet_leather', 'hood', 'king_engraved_crown', 'sisnat_war_helm', 'wizard_hat'],
  torso: ['cape', 'surcoat', 'sisnat_chest_armor']
};
const MAX_ARENA_GROUPS = 4;   // per side, so the scene stays on screen
const HAND_WEAPONS = ['sword', 'ravan_prince_sword', 'king_sovereign_sword', 'sisnat_double_axe', 'wizard_staff', 'spear', 'pike', 'worker_hammer', 'javelin', 'bow', 'crossbow'];
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
  error: { cls: 'rounded-full border border-rose-500/50 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300', text: 'Save failed' },
};


export const studioControlsAndLoopMethods = {
  _initTimelineEditor() {
    const mount = this.rootContainer.querySelector('#st-timeline-mount');
    const data = () => this.unitsData;

    this.timelineEditor = new TimelineEditor(mount, this.unitsData.animations, {
      isBuildingMode: () => this.entityCategory === 'buildings' || Boolean(this.unitsData.units?.[this.currentUnitId]?.isBuildingEntity),
      getClipLabel: (base) => {
        if (this.entityCategory === 'buildings' || this.unitsData.units?.[this.currentUnitId]?.isBuildingEntity) {
          const map = {
            build_construct: 'Construction (build_construct)',
            idle: 'Standing Idle (idle)',
            level_up: 'Level Up / Upgrade (level_up)',
            recruit_spawn: 'Recruiting / Gate Open (recruit_spawn)',
            damage_stage_1: 'Damaged Stage 1 (damage_stage_1)',
            damage_stage_2: 'Damaged Stage 2 (damage_stage_2)',
            collapse_destroy: 'Collapse / Destroyed (collapse_destroy)',
            victory_cheer: 'Victory Cheer! 🎉 (victory_cheer)'
          };
          return map[base] || base;
        }
        return base;
      },
      getMoveList: () => this._moveList(),
      getActionList: () => this._actionList().list,
      getActionNote: (base) => this._actionList().notes[base] || '',
      getClipName: (base) => this._readName(base),
      getClip: (base) => this._readKeyframeClip(base),
      getVariantIndices: (base) => {
        const vars = resolveClipVariants(data(), this.currentUnitId, this.currentFaction, base, this._scope());
        const indices = vars.map((v) => variantIndexOf(v));
        const activeV = this.timelineEditor?.activeVariantIdx || 1;
        if (!indices.includes(activeV)) indices.push(activeV);
        return [...new Set(indices)].sort((a, b) => a - b);
      },
      getVariantWeight: (base, varIdx) => {
        const clip = this._readKeyframeClip(base, varIdx);
        const w = Number(clip?.weight);
        return w > 0 ? w : (varIdx === 1 ? 70 : 30);
      },
      getVariantProbabilityPct: (base, varIdx) => {
        const vars = resolveClipVariants(data(), this.currentUnitId, this.currentFaction, base, this._scope());
        if (vars.length <= 1) return 100;
        const kf = data().animations?.keyframes || {};
        let totalW = 0;
        let targetW = varIdx === 1 ? 70 : 30;
        for (const vName of vars) {
          const idx = variantIndexOf(vName);
          const w = Number(kf[vName]?.weight);
          const effW = w > 0 ? w : (idx === 1 ? 70 : 30);
          totalW += effW;
          if (idx === varIdx) targetW = effW;
        }
        return totalW > 0 ? Math.round((targetW * 100) / totalW) : 100;
      },
      onVariantWeightChanged: (base, varIdx, newWeight) => {
        this._beginEdit('var-weight');
        const res = ensureKeyframeClip(data(), this.currentUnitId, this.currentFaction, base, this._scope(), varIdx);
        if (res?.clip) {
          res.clip.weight = Math.max(1, Math.min(1000, Math.round(Number(newWeight) || 50)));
          this.stateManager.scheduleSave();
        }
      },
      onAddVariant: (base, fromVarIdx) => {
        this._beginEdit('add-variant');
        const res = createClipVariation(data(), this.currentUnitId, this.currentFaction, base, this._scope(), fromVarIdx || 1);
        this.stateManager.scheduleSave();
        this._toast(`נוצרה וריאציה חדשה: v${res.variantIdx} (${res.name})`);
        return res.variantIdx;
      },
      onDeleteVariant: (base, varIdx) => {
        if ((varIdx | 0) <= 1) return false;
        this._beginEdit('del-variant');
        const ok = deleteClipVariation(data(), this.currentUnitId, this.currentFaction, base, this._scope(), varIdx);
        if (ok) {
          this.stateManager.scheduleSave();
          this._toast(`נמחקה וריאציה v${varIdx}`);
        }
        return ok;
      },
      ensureClip: (base) => {
        const tl = this.timelineEditor;
        const res = ensureKeyframeClip(data(), this.currentUnitId, this.currentFaction, base, tl?.scope || 'unit', tl?.activeVariantIdx || 1);
        if (res.created) {
          this.stateManager.scheduleSave();
          this.timelineEditor?.refresh();
          this._toast(`Created ${res.name}`);
        }
        return res.clip;
      },
      getProceduralClip: (base) => this._readProceduralClip(base),
      getDefaultEventSocket: (type) => this._getDefaultEventSocket(type),
      getJointNames: () => Object.keys(this.currentUnitGroup?.userData?.sockets || {}),
      isPosLocked: (joint) => this._jointRules(joint).lockPos,
      getJointParents: () => {
        const socks = this.currentUnitGroup?.userData?.sockets || {};
        const out = {};
        for (const [n, g] of Object.entries(socks)) { const pn = g.parent?.name; out[n] = pn && socks[pn] && pn !== n ? pn : null; }
        return out;
      },
      getJointPose: (joint) => this._getJointPose(joint),
      onBeforeEdit: (tag) => this._beginEdit(tag),
      onRowSelected: (joint, prop) => {
        if (prop) this.gizmoController.setGizmoMode(prop === 'pos' ? 'translate' : 'rotate');
        this._selectJoint(joint);
      },
      onResetJoint: () => this._resetSelectedJoint(),

      onClipChanged: () => this._syncClipSelection(),
      onScopeChanged: (scope) => {
        const base = this._base();
        const own = clipNameFor(this.currentUnitId, this.currentFaction, base);
        const anims = this.unitsData.animations;
        if (scope === 'global' && (anims.keyframes?.[own] || anims.procedural?.[own])) {
          this._toast(`Editing the GLOBAL ${base}. ${this.currentUnitId}/${this.currentFaction} has its own copy, so it will not show these changes.`, 4500);
        }
        this._syncClipSelection();
      },
      onPlayStateChanged: (playing) => {
        if (playing) {
          this._cleaned = false;
          this.currentAnimator.lowerLayer.normTime = this.timelineEditor.scrubNormTime;
          this.inspectorPanel.setKeyContext(null);
        } else {
          this._applyPoseAt(this.timelineEditor.scrubNormTime);
          this._updateKeyContext();
        }
      },
      onNotice: (msg) => this._toast(msg, 3200),
      onScrub: (t) => {
        this._cleaned = false;
        this._applyPoseAt(t);
        this._updateKeyContext();
      },
      onRestartAnim: (base) => this._onRestartAnim(base),
      onTimelineModified: () => {
        this.stateManager.scheduleSave();
        this._updateKeyContext();
      }
    });
  },

  _keyGuard() {
    if (this.editMode === 'rig') { this._toast('Switch to Pose mode to edit keyframes.'); return false; }
    if (!this.timelineEditor.canKeyframe()) { this._toast('Walk / Run / Gallop are procedural – no keyframes.'); return false; }
    return true;
  },

  // ================================================================== undo / redo (snapshots of the whole working copy)

  /** Call right BEFORE a change. Continuous edits (dragging, typing) are merged into one step. */
  _beginEdit(tag) {
    const now = performance.now();
    const merge = (tag === 'pose' || tag === 'proc') && tag === this._undoTag && now - this._undoTime < 700;
    this._undoTag = tag;
    this._undoTime = now;
    if (merge) return;
    this._undoStack.push(this.stateManager.snapshot());
    if (this._undoStack.length > 60) this._undoStack.shift();
    this._redoStack.length = 0;
  },

  _stepHistory(from, to, label) {
    const current = this.stateManager.snapshot();
    let target;
    do { target = from.pop(); } while (target !== undefined && target === current);   // skip "nothing changed" steps
    if (target === undefined) { this._toast(`Nothing to ${label}.`); return; }
    to.push(current);
    this._undoTag = '';
    this.stateManager.restoreSnapshot(target);
    this._rebindData();
    if (this.ubStateManager && this.entityCategory === 'units' && this.unitStateManager?.data) {
      this.ubStateManager.unitsVisualsData = this.unitStateManager.data;
      this.ubStateManager.saveAll();
    }
    this._toast(label === 'undo' ? 'Undo' : 'Redo');
  },

  _undo() { this.timelineEditor.forcePause(); this._stepHistory(this._undoStack, this._redoStack, 'undo'); },
  _redo() { this.timelineEditor.forcePause(); this._stepHistory(this._redoStack, this._undoStack, 'redo'); },

  _onRestartAnim(base) {
    this._beginEdit('restart-anim');
    const res = this.stateManager.resetClip(this.currentUnitId, this.currentFaction, base, this._scope());
    if (res.cancelled) return;
    this.timelineEditor.selectedEventIdx = null;
    this._syncClipSelection();
    this._toast(res.ok ? `Reset ${base} (${this._scope() === 'global' ? 'global' : 'this unit'})` : 'Nothing to reset – this clip is already the default.');
  },

  // ================================================================== sidebar / header

  _renderModeHelp() {
    const help = this.rootContainer.querySelector('#st-mode-help');
    if (!help) return;
    if (this.editMode === 'rig') {
      help.className = 'rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 leading-snug text-rose-200';
      help.textContent = 'RIG: you are editing the character itself. Moving a joint changes its rest pose (saved in units.json) and every animation of this unit is relative to it.';
    } else {
      help.className = 'leading-snug text-slate-400';
      help.textContent = 'POSE: you are editing the animation. Moving a joint changes the clip (a static value, or a keyframe if the property is animated). The character body is never touched.';
    }
  },

  _setEditMode(mode) {
    if (this.editMode === mode) return;
    if (mode === 'rig' && !confirm(
      'Rig mode edits the CHARACTER, not the animation.\n\n' +
      'Moving a joint changes its rest pose, and every animation of this unit is measured from it.\n' +
      'To animate, stay in Pose mode. Continue to Rig mode?'
    )) return;
    this.editMode = mode;
    const qs = (s) => this.rootContainer.querySelector(s);
    qs('#st-edit-pose').className = mode === 'pose' ? SEG_ON : SEG_OFF;
    qs('#st-edit-rig').className = mode === 'rig' ? RIG_ON : SEG_OFF;
    this._renderModeHelp();
    this._applyBottomPanel();

    this.timelineEditor.forcePause();
    this._cleaned = false;
    this._applyPoseAt(this.timelineEditor.scrubNormTime);
    this._selectJoint(this.selectedSocketName);
    this._toast(mode === 'rig' ? 'Rig mode: you are editing the REST pose.' : 'Pose mode: moving a joint writes keyframes.');
  },

  /** Bottom panel: keyframe sheet in Pose mode, part list in Rig mode, nothing in the arena. */
  _applyBottomPanel() {
    const qs = (s) => this.rootContainer.querySelector(s);
    const arena = this.view === 'arena';
    qs('#st-timeline-mount').classList.toggle('hidden', arena || this.editMode === 'rig');
    qs('#st-rig-mount').classList.toggle('hidden', arena || this.editMode !== 'rig');
  },

  _showView(view) {
    const qs = (s) => this.rootContainer.querySelector(s);
    this.view = view;
    const arena = view === 'arena';
    qs('#st-mode-arena').className = arena ? TAB_ON : TAB_OFF;
    qs('#st-mode-rig').className = arena ? TAB_OFF : TAB_ON;
    qs('#st-left-panel').classList.toggle('hidden', arena);
    qs('#st-arena-toolbar').classList.toggle('hidden', !arena);
    this.studioPedestalGroup.visible = !arena;
    this.sandboxArena.setVisible(arena);

    if (arena) {
      this.timelineEditor.forcePause();
      this._restoreColorPreview();
      this.gizmoController.detach();
      qs('#st-inspector-mount').classList.add('hidden');
      this.gizmoController.snapToRtsGameView(26, new THREE.Vector3(0, 0, 0));
    } else {
      if (this._isBuildingNow?.()) this._frameBuildingCamera?.();
      else this.gizmoController.snapToCloseupView();
      this._selectJoint(this.selectedSocketName);
    }
    this._applyBottomPanel();
    qs('#st-gizmo-tools').classList.toggle('hidden', arena);
    setTimeout(() => this._resizeHandler(), 20);
  },

  /** The working data object was replaced (Restart All / Import). */
  _rebindData() {
    const data = this.unitsData;
    this.modelFactory.visualsData = data;
    this.sandboxArena.setData(data);
    this.timelineEditor.animations = data.animations;
    if (!data.units[this.currentUnitId]) this.currentUnitId = Object.keys(data.units)[0];
    for (const u of Object.values(data.units)) restow(data, u);

    const qs = (s) => this.rootContainer.querySelector(s);
    this._refreshFactionList();
    this._refreshUnitList();
    this._renderArenaLists();

    this.timelineEditor.selectedEventIdx = null;
    this._updateHealthBadge();
    this._spawnStudioUnit();
  },

  _bindSidebarControls() {
    const qs = (sel) => this.rootContainer.querySelector(sel);

    qs('#st-mode-rig').addEventListener('click', () => this._showView('studio'));
    qs('#st-mode-arena').addEventListener('click', () => this._showView('arena'));
    qs("#st-tab-units")?.addEventListener("click", () => this._switchEntityCategory("units"));
    qs("#st-tab-heroes")?.addEventListener("click", () => this._switchEntityCategory("heroes"));
    qs("#st-tab-buildings")?.addEventListener("click", () => this._switchEntityCategory("buildings"));
    qs("#st-btn-open-units-lab")?.addEventListener("click", () => {
      this._flushCurrentCategory();
      if (this.onOpenUnitsBuildingsLab) {
        const bId = this.entityCategory === "buildings" ? this.currentUnitId : (this._lastBuildingId || undefined);
        const tab = this.entityCategory === "buildings" ? "buildings" : "units";
        this.onOpenUnitsBuildingsLab({
          initialTab: tab,
          initialUnitId: tab === "units" ? this.currentUnitId : undefined,
          initialBuildingId: bId
        });
      }
    });
    qs('#st-btn-open-heroes')?.addEventListener('click', () => {
      this._flushCurrentCategory();
      if (this.onOpenHallOfHeroes) this.onOpenHallOfHeroes();
    });

    qs('#st-unit-select').addEventListener('change', (e) => {
      this.currentUnitId = e.target.value;
      this.currentLoadout = MAIN_LOADOUT;
      const race = this._raceOf(this.currentUnitId);
      if (race && this._factions().includes(race)) { this.currentFaction = race; qs('#st-faction-select').value = race; }
      this._spawnStudioUnit();
    });
    qs('#st-btn-del-unit')?.addEventListener('click', () => {
      if (this.unitsData.units?.[this.currentUnitId]?.importInfo) {
        this._deleteImportedUnit(this.currentUnitId);
      }
    });
    qs('#st-btn-del-base')?.addEventListener('click', () => {
      const baseId = qs('#st-base-char-select')?.value;
      if (baseId && this.unitsData.units?.[baseId]?.importInfo) {
        this._deleteImportedUnit(baseId);
      }
    });
    qs('#st-base-char-select')?.addEventListener('change', (e) => {
      const wanted = e.target.value;
      if (!wanted || !this.ubStateManager || this.entityCategory !== 'units') return;
      this._beginEdit('rebase');
      this.ubStateManager.unitsVisualsData = this.unitStateManager.data;
      const res = this.ubStateManager.rebaseUnit(this.currentUnitId, wanted);
      if (!res.ok) {
        this._toast(res.reason || 'Could not switch base character');
        this._refreshBaseCharControl();
        return;
      }
      this.unitStateManager.data = this.ubStateManager.unitsVisualsData;
      this.modelFactory.visualsData = this.unitsData;
      this.unitStateManager.flush?.();
      this._spawnStudioUnit();
      this._renderGearPanel();
      this.timelineEditor?.refreshClipList();
      this._toast(`Updated base character to ${wanted}`);
    });
    qs('#st-faction-select').addEventListener('change', (e) => {
      this.currentFaction = e.target.value;
      this._refreshUnitList();
      this._spawnStudioUnit();
    });
    qs('#st-team-select').addEventListener('change', (e) => { this.currentTeamId = Number(e.target.value) || 1; this._spawnStudioUnit(); });
    qs('#st-banner-toggle').addEventListener('change', (e) => { this.isBannerCarrier = e.target.checked; this._spawnStudioUnit(); });

    qs('#st-gizmo-tools').addEventListener('click', (e) => {
      const b = e.target.closest('.st-gt');
      if (b) this.gizmoController.setGizmoMode(b.dataset.gizmo);
    });
    this.gizmoController.transformControls.addEventListener('mode-changed', () => this._syncGizmoTools());
    this._syncGizmoTools();
    qs('#st-rig-mount').addEventListener('click', (e) => {
      const b = e.target.closest('.rig-part');
      if (b) this._selectJoint(b.dataset.joint);
    });
    qs('#st-edit-pose').addEventListener('click', () => this._setEditMode('pose'));
    qs('#st-edit-rig').addEventListener('click', () => this._setEditMode('rig'));


    const hand = this.rootContainer.querySelector('#insp-hand');
    const handSide = () => hand.dataset.side;
    hand.querySelector('#hand-curl').addEventListener('input', (e) => this._setCurl(handSide(), 'fingers', Number(e.target.value) / 100));
    hand.querySelector('#hand-thumb').addEventListener('input', (e) => this._setCurl(handSide(), 'thumb', Number(e.target.value) / 100));
    for (const [id, v] of [['hand-open', 0], ['hand-relax', 0.3], ['hand-fist', 1]]) {
      hand.querySelector('#' + id).addEventListener('click', () => { this._setCurl(handSide(), 'fingers', v); this._setCurl(handSide(), 'thumb', v * 0.8); });
    }

    const gear = this.rootContainer.querySelector('#insp-gear');
    gear.addEventListener('click', (e) => {
      if (e.target.closest('#btn-select-arrow-socket')) {
        this._selectJoint("arrow_socket", { fit: false });
        return;
      }
      if (e.target.closest('#btn-select-bowstring')) {
        this.gizmoController.setGizmoMode("translate");
        this._selectJoint("bowstring_mid", { fit: false });
        return;
      }
      const presetBtn = e.target.closest('.arrow-preset');
      if (presetBtn) {
        this._beginEdit('arrow-config');
        const ac = this._ensureArrowConfig();
        ac.shaftHex = presetBtn.dataset.shaft || "#f8fafc";
        ac.headHex = presetBtn.dataset.head || "#ffffff";
        ac.fletchHex = presetBtn.dataset.fletch || "#e2e8f0";
        this.stateManager.scheduleSave();
        this._spawnStudioUnit();
        this._renderGearPanel();
        return;
      }
      const delImp = e.target.closest('.gear-del-imp');
      if (delImp && delImp.dataset.delPrefab) {
        e.stopPropagation();
        this._deleteImportedGear(delImp.dataset.delPrefab);
        return;
      }
      const pick = e.target.closest('.gear-pick'), fit = e.target.closest('.gear-grip');
      if (e.target.closest('#loadout-new')) { this._newLoadout(); return; }
      if (e.target.closest('#loadout-stow')) { this._autoStow(); return; }
      if (e.target.closest('#loadout-del')) { this._deleteLoadout(); return; }
      const tabBtn = e.target.closest('.loadout-tab');
      if (tabBtn) { this._setLoadout(tabBtn.dataset.loadout); return; }
      if (pick) this._selectJoint(pick.dataset.joint);
      else if (fit && !fit.disabled) this._selectJoint(fit.dataset.joint, { fit: true });
    });
    gear.addEventListener('input', (e) => {
      const id = e.target.id;
      if (id === 'arrow-len-range' || id === 'arrow-col-shaft' || id === 'arrow-col-head' || id === 'arrow-col-fletch') {
        this._beginEdit('arrow-config');
        const ac = this._ensureArrowConfig();
        if (id === 'arrow-len-range') ac.length = parseFloat(e.target.value) || 0.68;
        if (id === 'arrow-col-shaft') ac.shaftHex = e.target.value;
        if (id === 'arrow-col-head') ac.headHex = e.target.value;
        if (id === 'arrow-col-fletch') ac.fletchHex = e.target.value;
        this.stateManager.scheduleSave();
        this._refreshStudioArrowPreview();
      }
    });
    gear.addEventListener('change', (e) => {
      if (e.target.id === 'arrow-preview-toggle') {
        this._showArrowPreviewForce = e.target.checked;
        this._refreshStudioArrowPreview();
        return;
      }
      if (e.target.id === 'arrow-quiver-sel') {
        this._equipSlot("quiver_back", e.target.value);
        return;
      }
      if (e.target.id === 'arrow-style-sel' || e.target.id === 'arrow-len-range' || e.target.id === 'arrow-col-shaft' || e.target.id === 'arrow-col-head' || e.target.id === 'arrow-col-fletch') {
        this._beginEdit('arrow-config');
        const ac = this._ensureArrowConfig();
        if (e.target.id === 'arrow-style-sel') {
          ac.style = e.target.value;
          const STYLE_PALETTES = {
            bodkin: { shaftHex: "#f8fafc", headHex: "#cbd5e1", fletchHex: "#ffffff" },
            broadhead: { shaftHex: "#d97706", headHex: "#e2e8f0", fletchHex: "#ef4444" },
            needle: { shaftHex: "#334155", headHex: "#38bdf8", fletchHex: "#bae6fd" },
            royal: { shaftHex: "#fefce8", headHex: "#facc15", fletchHex: "#fde047" }
          };
          const pal = STYLE_PALETTES[ac.style];
          if (pal) {
            ac.shaftHex = pal.shaftHex;
            ac.headHex = pal.headHex;
            ac.fletchHex = pal.fletchHex;
          }
        }
        this.stateManager.scheduleSave();
        this._spawnStudioUnit();
        this._renderGearPanel();
        return;
      }
      if (e.target.id === 'loadout-sel') { this._setLoadout(e.target.value); return; }
      const typeSel = e.target.closest('.gear-type');
      if (typeSel) {
        if (typeSel.value) { this._beginEdit('weapon type'); this.unitsData.prefabs[typeSel.dataset.prefab].weaponType = typeSel.value; this.stateManager.scheduleSave(); this._renderGearPanel(); this.timelineEditor?.refreshClipList(); }
        return;
      }
      const sel = e.target.closest('.gear-sel');
      if (sel) this._equipSlot(sel.dataset.joint, sel.value);
    });

    
    const iconsPanelEl = this.rootContainer.querySelector('#insp-icons');
    if (iconsPanelEl) {
      iconsPanelEl.addEventListener('click', (e) => {
        if (e.target.closest('#st-btn-capture-hero-pose')) {
          const dataUrl = this._captureCurrentPosedUnitDataUrl({ transparent: true });
          if (dataUrl) {
            this.heroStateManager.setHeroPortrait(this.currentUnitId, dataUrl);
            this._renderIconsPanel();
            this._toast('Captured posed Hero portrait!');
          }
          return;
        }
        if (e.target.closest('#st-btn-capture-recruit')) {
          const dataUrl = this._captureCurrentPosedUnitDataUrl({ transparent: Boolean(this._iconsCaptureTransparent) });
          if (dataUrl && this.ubStateManager) {
            this.ubStateManager.setUnitPortraits(this.currentUnitId, { recruitPortraitUrl: dataUrl });
            this._renderIconsPanel();
            this._toast('Captured posed 3D portrait for Building Recruitment!');
          }
          return;
        }
        if (e.target.closest('#st-btn-capture-squad')) {
          const dataUrl = this._captureCurrentPosedUnitDataUrl({ transparent: Boolean(this._iconsCaptureTransparent) });
          if (dataUrl && this.ubStateManager) {
            this.ubStateManager.setUnitPortraits(this.currentUnitId, { squadCardIconUrl: dataUrl });
            this._renderIconsPanel();
            this._toast('Captured posed 3D icon for Multi-Squad Selection Bar!');
          }
          return;
        }
        if (e.target.closest('#st-btn-clear-recruit')) {
          this.ubStateManager?.setUnitPortraits(this.currentUnitId, { recruitPortraitUrl: '' });
          this._renderIconsPanel();
          return;
        }
        if (e.target.closest('#st-btn-clear-squad')) {
          this.ubStateManager?.setUnitPortraits(this.currentUnitId, { squadCardIconUrl: '' });
          this._renderIconsPanel();
          return;
        }
        if (e.target.closest('#st-btn-upload-recruit')) {
          iconsPanelEl.querySelector('#st-input-upload-recruit')?.click();
          return;
        }
        if (e.target.closest('#st-btn-upload-squad')) {
          iconsPanelEl.querySelector('#st-input-upload-squad')?.click();
          return;
        }
        if (e.target.closest('#st-btn-upload-placeholder')) {
          iconsPanelEl.querySelector('#st-input-upload-placeholder')?.click();
          return;
        }
      });

      iconsPanelEl.addEventListener('change', (e) => {
        if (e.target.id === 'st-chk-icons-transparent') {
          this._iconsCaptureTransparent = Boolean(e.target.checked);
          return;
        }
        if (e.target.id === 'st-select-recruit-icon') {
          this.ubStateManager?.setUnitPortraits(this.currentUnitId, {
            recruitIconKey: e.target.value,
            recruitPortraitUrl: ''
          });
          this._renderIconsPanel();
          return;
        }
        if (e.target.id === 'st-select-squad-icon') {
          this.ubStateManager?.setUnitPortraits(this.currentUnitId, {
            squadCardIconKey: e.target.value,
            squadCardIconUrl: ''
          });
          this._renderIconsPanel();
          return;
        }
        if (e.target.id === 'st-select-placeholder-icon') {
          const val = e.target.value;
          const customEntry = (this.ubStateManager?.unitStatsData?.customPlaceholderIcons || []).find((c) => c.id === val);
          this.ubStateManager?.setUnitPortraits(this.currentUnitId, {
            placeholderIconKey: val,
            placeholderIconUrl: customEntry ? customEntry.dataUrl : ''
          });
          this._spawnStudioUnit();
          this._renderIconsPanel();
          return;
        }
        if (e.target.id === 'st-input-upload-recruit') {
          const file = e.target.files?.[0];
          if (!file || typeof FileReader === 'undefined') return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              this.ubStateManager?.setUnitPortraits(this.currentUnitId, { recruitPortraitUrl: reader.result });
              this._renderIconsPanel();
            }
          };
          reader.readAsDataURL(file);
          return;
        }
        if (e.target.id === 'st-input-upload-squad') {
          const file = e.target.files?.[0];
          if (!file || typeof FileReader === 'undefined') return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              this.ubStateManager?.setUnitPortraits(this.currentUnitId, { squadCardIconUrl: reader.result });
              this._renderIconsPanel();
            }
          };
          reader.readAsDataURL(file);
          return;
        }
        if (e.target.id === 'st-input-upload-placeholder') {
          const file = e.target.files?.[0];
          if (!file || typeof FileReader === 'undefined') return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              const cleanName = file.name.replace(/.[^.]+$/, '').slice(0, 18) || 'Custom Symbol';
              const newId = this.ubStateManager?.addCustomPlaceholderIcon({ label: cleanName, dataUrl: reader.result });
              const resolvedId = typeof newId === 'object' && newId ? newId.id : newId;
              if (resolvedId) {
                this.ubStateManager?.setUnitPortraits(this.currentUnitId, {
                  placeholderIconKey: resolvedId,
                  placeholderIconUrl: reader.result
                });
                this._spawnStudioUnit();
                this._renderIconsPanel();
              }
            }
          };
          reader.readAsDataURL(file);
        }
      });
    }

    qs('#st-btn-health').addEventListener('click', () => this._openHealth());
    qs('#st-btn-portraits').addEventListener('click', () => {
      if (this.entityCategory === 'units' && this.inspectorPanel) {
        this._renderIconsPanel?.();
        this.inspectorPanel.switchTab('icons');
        this._toast('Switched to 📸 Icons tab — pose the unit on the timeline and click Capture Pose!');
        return;
      }
      if (this.entityCategory === 'heroes') {
        const prevVis = this.modelFactory.visualsData;
        this.modelFactory.visualsData = this.unitsData;
        let dataUrl = '';
        const studio = createPortraitStudio(this.modelFactory, this.unitsData);
        try {
          const canvas = studio.render(this.currentUnitId, this.currentFaction, {
            size: 256,
            view: 'bust',
            angle: 'three_quarter',
            background: 'transparent'
          });
          dataUrl = canvas.toDataURL('image/png');
        } finally {
          studio.dispose();
          this.modelFactory.visualsData = prevVis;
        }
        this.heroStateManager.setHeroPortrait(this.currentUnitId, dataUrl);
        this._toast('Captured transparent portrait');
        return;
      }
      this._openPortraits();
    });
    qs('#st-modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'st-modal') this._closeModal(); });
    qs('#st-btn-export-json').addEventListener('click', () => { this.stateManager.exportCustomJson(); this._toast(this.entityCategory === 'heroes' ? 'heroes_export.json downloaded' : 'units_export.json downloaded'); });

    const fileInput = qs('#st-import-file');
    qs('#st-btn-import-json').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (!confirm(`Replace ALL current data with "${file.name}"?`)) return;
      this._beginEdit('import');
      const res = this.stateManager.importJsonText(await file.text());
      if (!res.ok) { this._toast(res.error, 5000); return; }
      this._rebindData();
      this._flushCurrentCategory();
      this._toast(this.stateManager.notice || 'Imported', 4000);
    });

    qs('#st-btn-reset-all').addEventListener('click', () => {
      this._beginEdit('reset-all');
      if (!this.stateManager.resetToDefault()) return;
      this._rebindData();
      this._flushCurrentCategory();
      this._toast('Everything was reset to the shipped units.json');
    });

    qs('#st-btn-exit').addEventListener('click', () => {
      this._flushCurrentCategory();
      if (this.onExitStudio) {
        const currentLoadoutIdx = this.currentLoadout && this.currentLoadout !== 'main' ? 1 : 0;
        const currentAnim = this.timelineEditor?.activeBaseName || this._initialRequestedAnim || 'idle';
        this.onExitStudio({
          unitId: this.currentUnitId,
          anim: currentAnim,
          loadoutIdx: currentLoadoutIdx,
          loadoutId: this.currentLoadout || 'main'
        });
      } else {
        window.location.href = '/';
      }
    });

    this._bindArenaPanel();

    const factionSel = qs('#st-faction-select');
    factionSel.value = this.currentFaction;
  },

  _resetSelectedJoint() {
    const obj = this.gizmoController.selectedObject;
    if (!obj) return;
    this._beginEdit('pose');
    if (this.gizmoController.gizmoTargetType === 'weapon_grip') {
      const eq = this._eq()[this.selectedSocketName];
      const def = this.unitsData.prefabs[eq?.prefab];
      obj.position.set(...(def?.gripOffset || [0, 0, 0]));
      obj.rotation.set(...(def?.gripRotation || [0, 0, 0]));
      this._onPoseEdited();
      return;
    }
    if (this.editMode === 'rig') { this._toast('In Rig mode the pose IS the rest pose. Use Restart All to get the shipped rig back.'); return; }
    if (!this._poseEditable()) return;
    this._prepareEdit();
    const rest = this.currentUnitGroup.userData.restPoses[this.selectedSocketName];
    obj.position.set(...rest.pos);
    obj.rotation.set(...rest.rot);
    this._onPoseEdited();
  },

  // ================================================================== click a body part to select its joint

  _bindViewportPick() {
    const canvas = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let start = null;

    this._onPickDown = (e) => {
      start = { x: e.clientX, y: e.clientY, button: e.button, onGizmo: this.gizmoController.transformControls.axis !== null };
    };
    this._onPickUp = (e) => {
      const s = start;
      start = null;
      if (!s || s.button !== 0 || s.onGizmo || this.view !== 'studio' || !this.currentUnitGroup) return;
      if (this.gizmoController.isDragging || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5) return;   // a drag orbits the camera

      const rect = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, this.camera);
      const joints = new Set(Object.values(this.currentUnitGroup.userData.sockets));
      const attachedMap = this.currentUnitGroup.userData.attachedPrefabs || {};
      const prefabToSocket = new Map();
      for (const [sockName, pfGroup] of Object.entries(attachedMap)) {
        if (pfGroup) prefabToSocket.set(pfGroup, sockName);
      }
      for (const hit of raycaster.intersectObject(this.currentUnitGroup, true)) {
        if (!hit.object.isMesh || hit.object.name === 'selection_ring') continue;
        let p = hit.object;
        let clickedWeaponSocket = null;
        while (p && p !== this.currentUnitGroup) {
          if (prefabToSocket.has(p)) {
            clickedWeaponSocket = prefabToSocket.get(p);
            break;
          }
          p = p.parent;
        }
        const isFitEligibleSocket =
          clickedWeaponSocket === "weapon_socket_R" ||
          clickedWeaponSocket === "weapon_socket_L" ||
          clickedWeaponSocket === "quiver_back" ||
          clickedWeaponSocket === "hip_L" ||
          clickedWeaponSocket === "back_R" ||
          clickedWeaponSocket === "back_L";
        if (this.editMode === "rig" && isFitEligibleSocket) {
          this._selectJoint(clickedWeaponSocket, { fit: true });
          return;
        }
        let o = hit.object;
        while (o && !joints.has(o)) o = o.parent;
        if (o) { this._selectJoint(o.name); return; }
      }
    };
    canvas.addEventListener('pointerdown', this._onPickDown);
    canvas.addEventListener('pointerup', this._onPickUp);
  },

  // ================================================================== keyboard

  _bindKeyboard() {
    this._onKeyDown = (e) => {
      if (this.view !== 'studio' || e.altKey || e.metaKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
      const tl = this.timelineEditor;

      const ctrl = e.ctrlKey && !e.shiftKey;
      const code = e.code;   // physical key: works with a Hebrew (or any other) keyboard layout

      if (e.ctrlKey && code === 'KeyS') {
        e.preventDefault();
        this.stateManager.saveDraft();
        this._toast('Draft saved');
        return;
      }
      if (typing) return;   // inside a number box the browser's own Ctrl+Z / C / V must keep working

      if (e.ctrlKey && (code === 'KeyY' || (code === 'KeyZ' && e.shiftKey))) { e.preventDefault(); this._redo(); return; }
      if (ctrl && code === 'KeyZ') { e.preventDefault(); this._undo(); return; }
      if (ctrl && code === 'KeyC') {
        if (this.editMode === 'pose') {
          const n = tl.copyAtPlayhead();
          if (n) { e.preventDefault(); this._toast(`Copied ${n} keyframe${n === 1 ? '' : 's'}`); }
        }
        return;
      }
      if (ctrl && code === 'KeyV') {
        if (this.editMode === 'pose' && this._keyGuard()) {
          e.preventDefault();
          this._prepareEdit();
          const n = tl.pasteAtPlayhead();
          this._toast(n ? `Pasted ${n} keyframe${n === 1 ? '' : 's'} at the playhead` : 'Nothing copied yet (Ctrl+C first).');
        }
        return;
      }
      if (e.ctrlKey) return;

      switch (code) {
        case 'Space':
          e.preventDefault();
          if (this.editMode === 'pose') tl.togglePlay();
          break;
        case 'ArrowLeft': if (this.editMode === 'pose') { e.preventDefault(); tl.step(-1, e.shiftKey); } break;
        case 'ArrowRight': if (this.editMode === 'pose') { e.preventDefault(); tl.step(1, e.shiftKey); } break;
        case 'Delete': if (this.editMode === 'pose') { e.preventDefault(); tl.deleteSelection(); } break;
        case 'Escape': if (this._modalOpen()) this._closeModal(); else tl.clearSelection(); break;
        case 'KeyW': this.gizmoController.setGizmoMode('translate'); break;
        case 'KeyE': this.gizmoController.setGizmoMode('rotate'); break;
        default: break;
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  },

  // ================================================================== frame loop

  _tickStudio(dt) {
    const tl = this.timelineEditor;
    const anim = this.currentAnimator;
    if (!tl || !anim || !tl.isPlaying) return;

    const kind = this._previewKind();
    if (kind === 'keys') {
      const prevT = tl.scrubNormTime;
      let t = prevT + (dt * tl.playbackSpeed) / Math.max(0.05, tl.getDuration());
      const wrapped = t >= 1;
      if (wrapped) t %= 1;
      tl.syncPlayhead(t);
      this._applyPoseAt(t);
      const base = this._base();
      if (base.startsWith("spell_") && ((prevT < 0.44 && t >= 0.44) || (wrapped && prevT < 0.44))) {
        const spellId = base.replace(/^spell_/, "");
        const spDef = findSpellDef(this.heroStateManager?.data, spellId);
        spawn3DSpellEffect({
          fxGroup: this.studioSpellFxGroup,
          activeFxPulses: this.studioFxPulses,
          activeProjectiles: this.studioProjectiles,
          spellId,
          vfxStyle: spDef?.vfxStyle || null,
          fromPos: new THREE.Vector3(0, 1.15, 0.25),
          toPos: new THREE.Vector3(0, 0.1, spDef?.targetMode === "self" || spDef?.targetMode === "self_aoe" ? 0 : 2.6),
          radiusScale: 3.0,
          isPreview: true
        });
      }
    } else if (kind === 'procedural') {
      anim.update(dt * tl.playbackSpeed);
      tl.syncPlayhead(anim.lowerLayer.normTime);
      this.inspectorPanel.syncUI();
    }
  },

  _startLoop() {
    this._running = true;
    this._lastTime = performance.now();
    const frame = (now) => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(frame);
      const dt = Math.min((now - this._lastTime) / 1000, 0.1);
      this._lastTime = now;

      this.gizmoController.update();
      if (this.view === 'studio') {
        this._tickStudio(dt);
        for (let i = this.studioProjectiles.length - 1; i >= 0; i--) {
          const p = this.studioProjectiles[i];
          p.age += dt;
          if (p.age < 0) continue;
          const u = Math.min(1, p.age / p.duration);
          p.mesh.position.lerpVectors(p.start, p.end, u);
          p.mesh.position.y += Math.sin(u * Math.PI) * p.arcHeight;
          if (u >= 1) {
            if (typeof p.onArrival === 'function') p.onArrival();
            this.studioSpellFxGroup.remove(p.mesh);
            this.studioProjectiles.splice(i, 1);
          }
        }
        for (let i = this.studioFxPulses.length - 1; i >= 0; i--) {
          const fx = this.studioFxPulses[i];
          fx.age += dt;
          if (fx.age < 0) continue;
          if (fx.age >= fx.maxAge) {
            this.studioSpellFxGroup.remove(fx.mesh);
            this.studioFxPulses.splice(i, 1);
          } else {
            const u = fx.age / fx.maxAge;
            if (typeof fx.customUpdate === 'function') {
              fx.customUpdate(fx, dt, u);
            } else if (fx.isRisingHealRing) {
              fx.mesh.position.y += dt * (fx.riseSpeed || 1.35);
              if (fx.mat) fx.mat.opacity = (1 - u) * 0.88;
            } else {
              const s = 1 + u * 1.6;
              fx.mesh.scale.set(s, s, s);
              if (fx.mat) fx.mat.opacity = (1 - u) * 0.88;
            }
          }
        }
        if (this._arrowPreviewGroup) {
          const arrowMesh = this._arrowPreviewGroup.getObjectByName("studio_arrow_mesh");
          if (arrowMesh) arrowMesh.rotation.y += dt * 0.85;
        }
      } else {
        this.sandboxArena.update(dt, this.camera);
        const el = this.rootContainer.querySelector('#st-arena-metrics');
        if (el) {
          const s = this.sandboxArena.getDpsSummary();
          el.textContent = `Time: ${s.elapsed}s | Team 1 DPS: ${s.team1Dps} | Team 2 DPS: ${s.team2Dps}`;
        }
      }
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(frame);
  },

  _flushCurrentCategory() {
    this.stateManager?.flush?.();
    if (this.entityCategory === 'heroes' && this.heroStateManager) {
      this.heroStateManager.syncFromStudioView();
      this.heroStateManager.saveDraft();
    } else if (this.ubStateManager && this.unitStateManager?.data) {
      this.ubStateManager.unitsVisualsData = this.unitStateManager.data;
      this.ubStateManager.saveAll();
    }
  },

  destroy() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    clearTimeout(this._toastTimer);
    window.removeEventListener('keydown', this._onKeyDown);
    this.renderer?.domElement?.removeEventListener('pointerdown', this._onPickDown);
    this.renderer?.domElement?.removeEventListener('pointerup', this._onPickUp);
    const cv = this.renderer?.domElement;
    cv?.removeEventListener('pointerdown', this._onArenaDown, true);
    cv?.removeEventListener('pointermove', this._onArenaMove);
    cv?.removeEventListener('pointerup', this._onArenaUp);
    cv?.removeEventListener('pointercancel', this._onArenaUp);
    window.removeEventListener('resize', this._resizeHandler);
    this._resizeObserver?.disconnect();

    this._unsubUnitState?.();
    this._unsubUnitState = null;
    this._unsubRegistry?.();
    this._unsubRegistry = null;
    if (typeof window !== 'undefined' && this._onStorageSync) {
      window.removeEventListener('storage', this._onStorageSync);
      this._onStorageSync = null;
    }
    this._flushCurrentCategory();
    if (this._ownsUnitStateManager) this.unitStateManager?.destroy();
    else this.unitStateManager?.flush?.();
    if (this._ownsHeroStateManager) this.heroStateManager?.destroy();
    else this.heroStateManager?.flush?.();

    try { modelProvider.refreshFromRegistry?.(); } catch (_) {} // back to the registry state (a draft building preview may have pointed the shared factory at this lab's copy)
    this.timelineEditor?.destroy();
    this.sandboxArena?.dispose();
    this.gizmoController?.dispose();
    this._clearBuildingFootprintDisplay?.();
    if (this.currentUnitGroup) disposeVisual(this.currentUnitGroup);
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
    this.rootContainer.innerHTML = '';
  },
};
