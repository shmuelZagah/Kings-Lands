import { BUILTIN_UNIT_ICON_OPTIONS } from "../units_buildings/unitsTabRenderer.js";
import { renderUnitSlotPreviewInnerHtml, renderVisualIconPickerGridHtml } from "../../ui/hud/unitIconsCatalog.js";
/**
 * Kings Lands — Animation Lab Rig, Loadouts, Gear Slots, Hand Curls, Pose & Color Overrides
 * (src/tools/studio/studioGearAndPose.js)
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

import * as THREE from 'three';
import { updateBowstringRig } from '../../render/modelFactory.js';
import { buildSculptedArrowGeometry, spawn3DSpellEffect } from '../../render/worldEffectsRenderer.js';
import { Animator3D } from '../../render/animator3d.js';
import { SynthAudio } from '../../audio/synthAudio.js';
import { GizmoController } from './gizmoController.js';
import { TimelineEditor } from './timelineEditor.js';
import { SandboxArena } from './sandboxArena.js';
import { StudioStateManager } from './studioStateManager.js';
import { HeroStateManager, getHeroSpellClipBases, findSpellDef, invalidateHeroPortraitCache } from '../heroes/heroStateManager.js';
import { InspectorPanel } from './inspectorPanel.js';
import { ACTION_CLIPS, clipNameFor, getCombatBase, resolveClip, resolveClipVariants, variantIndexOf, withVariantIndex } from './clipResolver.js';
import { BUILDING_STUDIO_CLIPS } from '../units_buildings/buildingStudioAdapter.js';
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


export const studioGearAndPoseMethods = {
  _renderRigPanel() {
    const mount = this.rootContainer?.querySelector('#st-rig-mount');
    if (!mount) return;
    const names = Object.keys(this.currentUnitGroup?.userData?.sockets || {});
    const chip = (n) => {
      const on = n === this.selectedSocketName;
      const held = this.currentUnitGroup.userData.attachedPrefabs?.[n];
      return `<button type="button" class="rig-part rounded border px-2.5 py-1 mono font-semibold ${on ? 'border-rose-400 bg-rose-500 text-slate-950' : 'border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'}" data-joint="${n}">${n}${held ? ' ●' : ''}</button>`;
    };
    const body = names.filter((n) => !EQUIPMENT_SOCKETS.includes(n));
    const gear = names.filter((n) => EQUIPMENT_SOCKETS.includes(n));
    mount.innerHTML = `
      <div class="flex flex-col gap-2">
        <div class="font-bold text-rose-300">RIG – character parts <span class="font-normal text-slate-400">· pick a part (or click it in the view), then move / rotate it with the gizmo or the Inspector. There is no animation here.</span></div>
        <div class="flex flex-wrap items-center gap-1.5"><span class="w-24 text-slate-500">Body</span>${body.map(chip).join('')}</div>
        ${gear.length ? `<div class="flex flex-wrap items-center gap-1.5"><span class="w-24 text-slate-500">Held items</span>${gear.map(chip).join('')}<span class="text-slate-500">● = item equipped (its grip is edited)</span></div>` : ''}
      </div>`;
  },

  // ------------------------------------------------------------------ Gear tab (right panel): every body part and what can be put on it

  /** The equipment object of the loadout being edited (created on demand). */
  _eq(create = false) {
    const u = this.unitsData.units[this.currentUnitId];
    if (!u) return {};
    if (this.currentLoadout !== MAIN_LOADOUT && !u.loadouts?.[this.currentLoadout]) this.currentLoadout = MAIN_LOADOUT;
    if (this.currentLoadout === MAIN_LOADOUT) { if (!u.equipment && create) u.equipment = {}; return u.equipment || {}; }
    const l = u.loadouts[this.currentLoadout];
    if (!l.equipment && create) l.equipment = {};
    return l.equipment || {};
  },

  _setLoadout(id) {
    this.currentLoadout = id;
    this.gripJoint = null;
    this._spawnStudioUnit();
    this._renderGearPanel();
    this.timelineEditor?.refreshClipList();
  },

  _newLoadout() {
    const u = this.unitsData.units[this.currentUnitId];
    if (this.entityCategory === 'heroes' && u?.heroClass === 'wizard') {
      this._toast('Wizard has 1 permanent gear set (Staff + optional Sword in Off-Hand L).');
      return;
    }
    if (Object.keys(u.loadouts || {}).length >= 1) { this._toast('A unit has at most two gear sets.'); return; }
    this._beginEdit('loadout');
    if (!u.loadouts) u.loadouts = {};
    let n = Object.keys(u.loadouts).length + 2, id = `loadout${n}`;
    while (u.loadouts[id]) id = `loadout${++n}`;
    const clonedEq = JSON.parse(JSON.stringify(this._eq()));
    if (this.entityCategory === 'heroes') {
      if (u?.heroClass === 'warrior') {
        delete clonedEq.weapon_socket_R;
        clonedEq.weapon_socket_L = { prefab: 'bow', gripOffset: [0, 0.0726, -0.1077], gripRotation: [1.4437, 0, 0] };
        clonedEq.quiver_back = { prefab: 'quiver_royal_gilded', gripOffset: [0, 0.02, -0.06], gripRotation: [0, 0, 0.18] };
      } else if (u?.heroClass === 'archer') {
        delete clonedEq.quiver_back;
        clonedEq.weapon_socket_R = { prefab: 'sword', gripOffset: [0, 0.02, 0.04], gripRotation: [1.32, 0, 0] };
        clonedEq.weapon_socket_L = { prefab: 'round_buckler', gripOffset: [-0.05, -0.02, 0.06], gripRotation: [0.95, -0.35, -0.15] };
      }
    }
    u.loadouts[id] = { label: 'Set 2', equipment: clonedEq };
    this.currentLoadout = id;
    this._restowAll();
    this._markHeroVisualDirty();
    this.stateManager.scheduleSave();
    this._syncUnitsStateToUbLab?.();
    this._spawnStudioUnit();
    this._renderGearPanel();
    this.timelineEditor?.refreshClipList();
    this._toast('Gear set 2 created (a copy of set 1). Change its weapons: the other set\'s weapon is carried on the body automatically (Carried rows, Fit to place it).');
  },

  _deleteLoadout() {
    const u = this.unitsData.units[this.currentUnitId];
    if (this.currentLoadout === MAIN_LOADOUT || !u.loadouts?.[this.currentLoadout]) return;
    this._beginEdit('loadout');
    delete u.loadouts[this.currentLoadout];
    if (!Object.keys(u.loadouts).length) delete u.loadouts;
    this.currentLoadout = MAIN_LOADOUT;
    this._restowAll();
    this._markHeroVisualDirty();
    this.stateManager.scheduleSave();
    this._syncUnitsStateToUbLab?.();
    this._spawnStudioUnit();
    this._renderGearPanel();
    this.timelineEditor?.refreshClipList();
  },

  /** Recompute what every gear set carries on the body (other set's weapon, quiver) and rebuild. */
  _restowAll() {
    const u = this.unitsData.units[this.currentUnitId];
    if (!u) return [];
    return restow(this.unitsData, u);
  },

  _markHeroVisualDirty() {
    if (this.entityCategory !== 'heroes') return;
    invalidateHeroPortraitCache(this.currentUnitId);
    this.heroStateManager?.syncFromStudioView?.();
    this.heroStateManager?.scheduleSave?.();
  },

  _syncUnitsStateToUbLab() {
    if (this.entityCategory !== 'units' || !this.ubStateManager || !this.unitStateManager?.data) return;
    this.ubStateManager.unitsVisualsData = this.unitStateManager.data;
    this.ubStateManager.saveAll?.();
    this.unitStateManager.saveDraft?.();
  },

  _autoStow() {
    const u = this.unitsData.units[this.currentUnitId];
    this._beginEdit('loadout');
    const added = restow(this.unitsData, u).filter((x) => x.loadout === this.currentLoadout);
    this._markHeroVisualDirty();
    this.stateManager.scheduleSave();
    this._syncUnitsStateToUbLab?.();
    this._spawnStudioUnit();
    this._renderGearPanel();
    if (added.length) this._selectJoint(added[0].socket, { fit: true });
    this._toast(added.length ? `Carrying: ${added.map((a) => `${a.id} on ${a.socket}`).join(', ')}` : 'Nothing to stow (the other loadouts hold no other weapon, or no free carry point).');
  },

  /** Actions this unit can play = granted by what it carries (weaponRules.js), plus any it already uses (flagged). */
  /** Actions of the gear set being edited: what the weapons in its hands open (+ default attack). Another set's weapons do not count. */
  _moveList() {
    const data = this.unitsData, u = data.units?.[this.currentUnitId];
    if (this.entityCategory === "buildings" || u?.isBuildingEntity) {
      return Array.isArray(u?.allowedBuildingClips) ? [...u.allowedBuildingClips] : [...BUILDING_STUDIO_CLIPS];
    }
    const isMounted = Boolean(u?.mountHierarchy || u?.locomotionAnim?.includes("gallop"));
    const list = isMounted
      ? ["idle", "gallop", "charge", "retreat_run"]
      : ["idle", "walk", "run", "charge", "retreat_run"];
    const eq = this._eq();
    if (this.currentUnitId === "worker" || eq?.weapon_socket_R?.prefab === "worker_hammer") {
      list.push("worker_build", "worker_chop", "worker_mine");
    }
    return list;
  },

  _actionList() {
    const data = this.unitsData, u = data.units[this.currentUnitId];
    if (this.entityCategory === "buildings" || u?.isBuildingEntity) {
      const bClips = Array.isArray(u?.allowedBuildingClips) ? u.allowedBuildingClips : BUILDING_STUDIO_CLIPS;
      const why = {};
      for (const bClip of bClips) {
        why[bClip] = ["Building animation clip"];
      }
      return { list: [...bClips], notes: {}, why };
    }
    const { actions, why } = grantedActions(data, asLoadout(u, this.currentLoadout), ACTION_CLIPS);
    const set = new Set(actions);
    const notes = {};
    if (this.currentUnitId === 'worker' || u?.equipment?.weapon_socket_R?.prefab === 'worker_hammer') {
      for (const wa of ['worker_build', 'worker_chop', 'worker_mine']) {
        set.add(wa);
        why[wa] = ['worker task animation'];
      }
    }
    if (Object.keys(u?.loadouts || {}).length) { set.add('switch_weapon'); why.switch_weapon = ['two gear sets']; }
    const list = ACTION_CLIPS.filter((b) => set.has(b));

    // Phase 8: Dynamic Spell Animation Slots for Heroes (deduplicated per unique spell in the Hero's Spell Tree)
    if (this.entityCategory === 'heroes' && u) {
      this.heroStateManager.ensureSpellAnimationSlotsForHero(u);
      // Sync newly created spell clips into the active Studio view
      for (const [k, v] of Object.entries(this.heroStateManager.data.animations?.keyframes || {})) {
        if (!data.animations.keyframes[k]) data.animations.keyframes[k] = v;
      }
      const classTrees = Object.values(this.heroStateManager.data?.spellTrees || {}).filter((t) => {
        const allowed = Array.isArray(t?.allowedClasses) ? t.allowedClasses : ["all"];
        return allowed.includes("all") || allowed.includes(u.heroClass || "warrior");
      });
      const classSpellBases = classTrees.flatMap((t) => Object.keys(t.spells || {}).map((sid) => `spell_${sid}`));
      const spellBases = [...new Set([...getHeroSpellClipBases(u), ...classSpellBases])];
      for (const spBase of spellBases) {
        if (!list.includes(spBase)) {
          list.push(spBase);
        }
        const spellId = spBase.replace(/^spell_/, '');
        const spDef = findSpellDef(this.heroStateManager.data, spellId);
        why[spBase] = [`Hero Spell Slot: ${spDef?.name || spellId} (shared across all ranks)`];
      }
    }

    return { list, notes, why };
  },

  /** Is the current unit a standalone mount / animal (horse, dire wolf)? */
  _isStandaloneMountUnit() {
    const sockets = this.currentUnitGroup?.userData?.sockets || {};
    return Boolean(sockets.front_leg_L || sockets.front_shin_L);
  },

  /** Which kind of item fits this joint. null = nothing can be attached there. */
  _slotOf(joint) {
    if (/^weapon_socket_[RL]$/.test(joint)) return 'hand';
    if (joint === 'cape_back') return 'cape';
    if (/^stow_(back|hip_[RL])$/.test(joint)) return 'stow';
    const isMountUnit = this._isStandaloneMountUnit();
    if (joint === 'head') return isMountUnit ? 'mount_head' : 'head';
    if (joint === 'mount_skull') return 'mount_head';
    if (joint === 'torso') return isMountUnit ? 'mount_torso' : 'chest';
    if (joint === 'neck' || joint === 'mount_head') return 'mount_neck';
    if (joint === 'mount_torso') return 'mount_torso';
    if (/^(?:front_shin_[RL]|back_shin_[RL]|mount_shin_(?:FL|FR|BL|BR))$/.test(joint)) return 'mount_greave';
    if (joint === 'pelvis') return 'belt';
    if (/^arm_[RL]$/.test(joint)) return 'shoulder';
    if (/^forearm_[RL]$/.test(joint)) return 'bracer';
    if (/^hand_[RL]$/.test(joint)) return 'glove';
    if (/^leg_[RL]$/.test(joint)) return 'thigh';
    if (/^shin_[RL]$/.test(joint)) return 'greave';
    if (/^foot_[RL]$/.test(joint)) return 'boots';
    return null;
  },

  /** The kind of slot an item fits: its own `slot`, or `hand` for weapons / shields (prefabs made for a weapon socket). */
  _prefabSlot(def) { return def?.slot || (String(def?.defaultSocket || '').startsWith('weapon_socket') ? 'hand' : null); },

  _hasBowEquipped() {
    const eq = this._eq();
    const prefabs = this.unitsData.prefabs || {};
    for (const hs of HAND_SOCKETS) {
      const pid = eq[hs]?.prefab;
      if (pid && (prefabs[pid]?.weaponType === "bow" || /bow/i.test(pid))) return true;
    }
    return false;
  },

  _ensureArrowConfig() {
    if (!this.unitsData.arrowConfig) {
      this.unitsData.arrowConfig = {
        style: "bodkin",
        length: 0.68,
        shaftHex: "#f8fafc",
        headHex: "#ffffff",
        fletchHex: "#e2e8f0"
      };
    }
    return this.unitsData.arrowConfig;
  },

  _refreshStudioArrowPreview() {
    // No floating arrow stand next to the character; the arrow sits inside the quiver as arrow_socket!
  },

  /** Only legs (Trousers, Knees & Shins, Boots) are paired; arms & hands remain independent per side! */
  _pairedCounterpartJoint(joint) {
    if (joint === "leg_R") return "leg_L";
    if (joint === "leg_L") return "leg_R";
    if (joint === "shin_R") return "shin_L";
    if (joint === "shin_L") return "shin_R";
    if (joint === "foot_R") return "foot_L";
    if (joint === "foot_L") return "foot_R";
    return null;
  },

  _pairedCounterpartPrefab(prefabId) {
    if (!prefabId) return "";
    if (prefabId.endsWith("_R")) return prefabId.slice(0, -2) + "_L";
    if (prefabId.endsWith("_L")) return prefabId.slice(0, -2) + "_R";
    return prefabId;
  },

  _friendlyPrefabLabel(id, pf) {
    const FRIENDLY = {
      wizard_staff: "Arcane Crystal Staff",
      wizard_tome: "Grimoire of Stars",
      wizard_hat: "Pointed Archmage Hat",
      ravan_prince_sword: "Prince Ravan Azure Broadsword",
      king_sovereign_sword: "King Sovereign Golden Sword",
      king_engraved_crown: "King Engraved Golden Crown",
      sisnat_double_axe: "Sisnat Double-Bit War Axe",
      sisnat_war_helm: "Sisnat Horned Warlord Helm",
      sisnat_chest_armor: "Sisnat Warlord Plate Cuirass",
      sword: "Sword (Knight Broadsword)",
      spear: "Spear (חנית)",
      pike: "Long Pike (רומח ארוך)",
      bow: "Longbow (קשת ארוכה)",
      crossbow: "Crossbow (רובה קשת)",
      worker_hammer: "Builder Hammer (פטיש בנאים)",
      javelin: "Javelin (כידון הטלה)",
      shield: "Heater Shield (מגן אבירים קלאסי)",
      tower_shield: "Tower Shield (מגן צריח כבד)",
      round_buckler: "Round Shield (מגן עגול מעוטר)",
      kite_shield: "Kite Shield (מגן טיפה מוארך)",
      royal_crest_shield: "Royal Crest Shield (מגן מלכותי מוזהב)",
      quiver: "Leather Quiver (אשפת חצים מעור)",
      quiver_royal_gilded: "Royal Gilded Quiver (אשפת חצים מלכותית)",
      quiver_ranger_bark: "Woodland Twin Quiver (אשפת סיירים כפולה)",
      quiver_ironclad: "Ironclad Siege Quiver (אשפת ברזל משוריינת)",
      cape_royal: "Royal Heraldic Cape (גלימה מלכותית)",
      cape_ranger_cloak: "Ranger Woodland Cloak (גלימת סיירים)",
      cape_commander_fur: "Commander Fur Mantle (גלימת מפקד עם פרווה)",
      human_worn_trousers_R: "Cloth Trousers (מכנס בד מלא)",
      human_padded_breeches_R: "Quilted Trousers (מכנס קרב מרופד)",
      human_royal_hose_R: "Royal Trousers (מכנס בצבעי הצבא)",
      human_chainmail_cuisse_R: "Armored Trousers & Cuisses (מכנס ושריון ירכיים)",
      human_knee_guards_R: "Steel Knee Guards Only (שריון ברכיים בלבד)",
      human_gilded_knee_cops_R: "Royal Gilded Knee Guards (מגיני ברכיים מוזהבים)",
      human_cloth_wraps_R: "Shin Cloth Wraps (חותלות שוקיים)",
      human_steel_greave_R: "Full Steel Greaves & Knees (שריון ברכיים ושוקיים מלא)"
    };
    if (FRIENDLY[id]) return FRIENDLY[id];
    if (pf?.name) return pf.name;
    return id;
  },

  
  _captureCurrentPosedUnitDataUrl({ transparent = false } = {}) {
    if (this.renderer && this.scene && this.camera && this.currentUnitGroup) {
      const hiddenRestore = [];
      const hideObj = (obj) => {
        if (obj && obj.visible) {
          hiddenRestore.push(obj);
          obj.visible = false;
        }
      };
      for (const ch of this.studioPedestalGroup?.children || []) {
        if (ch !== this.currentUnitGroup) hideObj(ch);
      }
      hideObj(this.gizmoController?.gizmoRoot);
      const selRing = this.currentUnitGroup.getObjectByName?.("selection_ring");
      const bannerObj = this.currentUnitGroup.getObjectByName?.("company_banner");
      hideObj(selRing);
      hideObj(bannerObj);

      const prevBg = this.scene.background;
      if (transparent) {
        this.scene.background = null;
        this.renderer.setClearColor?.(0x000000, 0);
      }
      try {
        this.renderer.render(this.scene, this.camera);
        const srcCanvas = this.renderer.domElement;
        const sw = srcCanvas.width || 512;
        const sh = srcCanvas.height || 512;
        const side = Math.min(sw, sh);
        const sx = Math.floor((sw - side) * 0.5);
        const sy = Math.floor((sh - side) * 0.5);
        const outCanvas = document.createElement("canvas");
        outCanvas.width = 256;
        outCanvas.height = 256;
        const ctx = outCanvas.getContext("2d");
        if (ctx && typeof ctx.drawImage === "function") {
          ctx.drawImage(srcCanvas, sx, sy, side, side, 0, 0, 256, 256);
          const url = outCanvas.toDataURL("image/png");
          if (url && url.startsWith("data:image/")) {
            return url;
          }
        }
        if (typeof srcCanvas.toDataURL === "function") {
          const fallbackUrl = srcCanvas.toDataURL("image/png");
          if (fallbackUrl && fallbackUrl.startsWith("data:image/")) {
            return fallbackUrl;
          }
        }
      } catch (_) {
      } finally {
        for (const obj of hiddenRestore) obj.visible = true;
        this.scene.background = prevBg;
        if (transparent && prevBg) {
          this.renderer.setClearColor?.(0x0b1120, 1);
        }
        this.renderer.render(this.scene, this.camera);
      }
    }
    const prevVis = this.modelFactory.visualsData;
    this.modelFactory.visualsData = this.unitsData;
    let studio = null;
    try {
      studio = createPortraitStudio(this.modelFactory, this.unitsData);
      const canvas = studio.render(this.currentUnitId, this.currentFaction, {
        size: 256,
        view: "bust",
        angle: "three_quarter",
        background: transparent ? "transparent" : "dark"
      });
      return canvas.toDataURL("image/png");
    } catch (_) {
      return "";
    } finally {
      studio?.dispose?.();
      this.modelFactory.visualsData = prevVis;
    }
  },

  _renderIconsPanel() {
    const host = this.rootContainer?.querySelector("#insp-icons");
    if (!host) return;

    if (this.entityCategory === "buildings") {
      host.innerHTML = `<div class="rounded-lg border border-slate-700 bg-slate-950/60 p-2.5 text-[11px] text-slate-400">Unit portraits & squad icons apply to Units and Heroes. Switch to a Unit to pose & capture its icons.</div>`;
      return;
    }

    if (this.entityCategory === "heroes") {
      const hDef = this.heroStateManager?.data?.heroes?.[this.currentUnitId] || {};
      const curPortrait = hDef.portraitDataUrl || "";
      host.innerHTML = `
        <div class="rounded-lg border border-amber-500/40 bg-slate-950/75 p-2.5 flex flex-col gap-2 text-left" dir="ltr">
          <div class="text-[11px] font-bold text-amber-300">👑 Hero Posed Portrait Capture</div>
          <div class="text-[10.5px] text-slate-400 leading-snug">
            Pause the timeline on any animation frame or adjust joints in <b>Pose</b> mode, frame with Left-Drag (Orbit) + Right-Drag (Pan), and capture below:
          </div>
          <div class="flex items-center gap-3 py-1">
            <div class="w-16 h-16 rounded-full border-2 border-amber-400 bg-slate-900 overflow-hidden flex items-center justify-center shrink-0">
              ${curPortrait ? `<img src="${curPortrait}" alt="" class="w-full h-full object-cover" />` : `<span class="text-[10px] text-amber-300 font-bold">No Photo</span>`}
            </div>
            <div class="flex flex-col gap-1.5 flex-1">
              <button type="button" id="st-btn-capture-hero-pose" class="rounded-lg bg-amber-500 hover:bg-amber-400 px-2.5 py-1.5 text-[11px] font-black text-slate-950 shadow cursor-pointer">
                📸 Capture Current Pose to Hero
              </button>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const uStat = this.ubStateManager?.unitStatsData?.units?.[this.currentUnitId] || {};
    const customPlaceholders = this.ubStateManager?.unitStatsData?.customPlaceholderIcons || [];
    const transparentBg = Boolean(this._iconsCaptureTransparent);

    host.innerHTML = `
      <div class="flex flex-col gap-2.5 text-left" dir="ltr">
        <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[10.5px] text-amber-200 leading-snug">
          <div class="font-extrabold text-amber-300 mb-0.5">🎬 Pose & Capture Unit Icons</div>
          Scrub/pause the Timeline on any frame or rotate joints in <b>Transforms</b>, frame the camera (Left-Drag Orbit, Right-Drag Pan), then snap your posed 3D shot into the slots below!
          <label class="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold text-sky-200 cursor-pointer">
            <input type="checkbox" id="st-chk-icons-transparent" ${transparentBg ? "checked" : ""} class="accent-amber-400" />
            <span>Transparent PNG Background</span>
          </label>
        </div>

        <!-- Slot 1: Building Recruitment Portrait / Icon -->
        <div class="rounded-lg border border-slate-700 bg-slate-950/85 p-2 flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-extrabold text-amber-300">1. 🏰 Building Recruit Portrait / Icon</span>
            ${uStat.recruitPortraitUrl ? `<span class="text-[9.5px] font-bold text-emerald-300">Custom 3D Pose</span>` : `<span class="text-[9.5px] text-slate-400">Built-In SVG</span>`}
          </div>
          <div class="flex items-center gap-2.5">
            <div class="w-14 h-14 rounded-full border-2 border-amber-400/85 bg-slate-900 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
              ${renderUnitSlotPreviewInnerHtml(uStat, "recruit", customPlaceholders, this.currentUnitId)}
            </div>
            <div class="flex flex-col gap-1 flex-1 min-w-0">
              <div class="flex items-center gap-1">
                <button type="button" id="st-btn-capture-recruit" class="flex-1 rounded bg-amber-500 hover:bg-amber-400 px-2 py-1 text-[10px] font-black text-slate-950 cursor-pointer shadow" title="Capture current 3D pose & camera angle">
                  📸 Capture Pose
                </button>
                <button type="button" id="st-btn-upload-recruit" class="rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 px-2 py-1 text-[10px] font-bold text-slate-200 cursor-pointer" title="Upload PNG/JPG">
                  📁
                </button>
                ${
                  uStat.recruitPortraitUrl
                    ? `<button type="button" id="st-btn-clear-recruit" class="rounded bg-rose-950 hover:bg-rose-800 border border-rose-500/40 px-1.5 py-1 text-[10px] font-bold text-rose-200 cursor-pointer" title="Switch back to Built-in SVG Icon">✕</button>`
                    : ""
                }
                <input id="st-input-upload-recruit" type="file" accept="image/*" class="hidden" />
              </div>
              ${renderVisualIconPickerGridHtml("recruit", uStat.recruitIconKey || "auto", uStat, customPlaceholders, this.currentUnitId, "data-st-pick-icon")}
              <select id="st-select-recruit-icon" class="hidden">
                ${BUILTIN_UNIT_ICON_OPTIONS.map((o) => `<option value="${o.id}" ${(uStat.recruitIconKey || "auto") === o.id ? "selected" : ""}>${o.label}</option>`).join("")}
              </select>
            </div>
          </div>
        </div>

        <!-- Slot 2: Multi-Squad Selection Bar Icon / Portrait -->
        <div class="rounded-lg border border-slate-700 bg-slate-950/85 p-2 flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-extrabold text-sky-300">2. 🛡️ Multi-Squad Bar Icon / Portrait</span>
            ${uStat.squadCardIconUrl ? `<span class="text-[9.5px] font-bold text-emerald-300">Custom 3D Pose</span>` : `<span class="text-[9.5px] text-slate-400">Built-In SVG</span>`}
          </div>
          <div class="flex items-center gap-2.5">
            <div class="w-14 h-14 rounded-xl border-2 border-sky-400/85 bg-slate-900 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
              ${renderUnitSlotPreviewInnerHtml(uStat, "squad", customPlaceholders, this.currentUnitId)}
            </div>
            <div class="flex flex-col gap-1 flex-1 min-w-0">
              <div class="flex items-center gap-1">
                <button type="button" id="st-btn-capture-squad" class="flex-1 rounded bg-sky-500 hover:bg-sky-400 px-2 py-1 text-[10px] font-black text-slate-950 cursor-pointer shadow" title="Capture current 3D pose & camera angle">
                  📸 Capture Pose
                </button>
                <button type="button" id="st-btn-upload-squad" class="rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 px-2 py-1 text-[10px] font-bold text-slate-200 cursor-pointer" title="Upload PNG/JPG">
                  📁
                </button>
                ${
                  uStat.squadCardIconUrl
                    ? `<button type="button" id="st-btn-clear-squad" class="rounded bg-rose-950 hover:bg-rose-800 border border-rose-500/40 px-1.5 py-1 text-[10px] font-bold text-rose-200 cursor-pointer" title="Switch back to Built-in SVG Icon">✕</button>`
                    : ""
                }
                <input id="st-input-upload-squad" type="file" accept="image/*" class="hidden" />
              </div>
              ${renderVisualIconPickerGridHtml("squad", uStat.squadCardIconKey || "auto", uStat, customPlaceholders, this.currentUnitId, "data-st-pick-icon")}
              <select id="st-select-squad-icon" class="hidden">
                ${BUILTIN_UNIT_ICON_OPTIONS.map((o) => `<option value="${o.id}" ${(uStat.squadCardIconKey || "auto") === o.id ? "selected" : ""}>${o.label}</option>`).join("")}
              </select>
            </div>
          </div>
        </div>

        <!-- Slot 3: In-Game Map Placeholder & Banner Symbol -->
        <div class="rounded-lg border border-slate-700 bg-slate-950/85 p-2 flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-extrabold text-emerald-300">3. 🚩 Map Placeholder & Banner Symbol</span>
          </div>
          <div class="flex items-center gap-2.5">
            <div class="w-12 h-12 rounded-full border-2 border-emerald-400/85 bg-slate-900 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
              ${renderUnitSlotPreviewInnerHtml(uStat, "placeholder", customPlaceholders, this.currentUnitId)}
            </div>
            <div class="flex flex-col gap-1 flex-1 min-w-0">
              ${renderVisualIconPickerGridHtml("placeholder", uStat.placeholderIconKey || "auto", uStat, customPlaceholders, this.currentUnitId, "data-st-pick-icon")}
              <select id="st-select-placeholder-icon" class="hidden">
                ${BUILTIN_UNIT_ICON_OPTIONS.map((o) => `<option value="${o.id}" ${(uStat.placeholderIconKey || "auto") === o.id ? "selected" : ""}>${o.label}</option>`).join("")}
                ${customPlaceholders.map((ci) => `<option value="${ci.id}" ${uStat.placeholderIconKey === ci.id ? "selected" : ""}>⭐ ${ci.label}</option>`).join("")}
              </select>
              <button type="button" id="st-btn-upload-placeholder" class="w-full rounded bg-emerald-600 hover:bg-emerald-500 px-2 py-1 text-[10px] font-black text-slate-950 cursor-pointer">
                📁 + Upload New Symbol to Library
              </button>
              <input id="st-input-upload-placeholder" type="file" accept="image/*" class="hidden" />
            </div>
          </div>
        </div>
      </div>
    `;
  },

  _renderGearPanel() {
    const host = this.rootContainer?.querySelector("#insp-gear");
    if (!host || !this.currentUnitGroup) return;
    if (this.entityCategory === "buildings") {
      const bDef = this.ubStateManager?.buildingsData?.buildings?.[this.currentUnitId] || {};
      const maxLv = bDef.canAutoLevel ? Math.max(2, Math.min(10, (bDef.maxLevel | 0) || 3)) : 1;
      const curLv = Math.max(1, Math.min(maxLv, this.buildingPreviewLevel || 1));
      host.innerHTML = `<div class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-200 text-left flex flex-col gap-2">
        <div class="font-bold">Building Parts & Level (${this.currentUnitId})</div>
        ${
          maxLv > 1
            ? `<div class="flex flex-col gap-1">
                <span class="text-[10.5px] text-sky-300 font-bold">Preview & Animate at Level (Cumulative):</span>
                <select id="st-bld-lv-select" class="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs font-bold text-sky-300">
                  ${Array.from({ length: maxLv }, (_, idx) => {
                    const lv = idx + 1;
                    return `<option value="${lv}" ${lv === curLv ? 'selected' : ''}>Level ${lv}${lv === 1 ? ' (Base)' : ''}</option>`;
                  }).join('')}
                </select>
              </div>`
            : ''
        }
        <div class="text-[11px] text-slate-300">Select a building part (roof, hall, turret_socket${this.unitsData.units?.[this.currentUnitId]?.canRecruitUnits ? ', door leaves' : ''}) to animate construction, level-up transitions, and destruction.</div>
      </div>
      ${this._skinsGridHtml()}`;
      const tabBtn = this.rootContainer.querySelector('#tab-gear'); if (tabBtn) tabBtn.textContent = 'Skins';
      this._bindSkinsGrid(host);
      host.querySelector('#st-bld-lv-select')?.addEventListener('change', (e) => {
        this.buildingPreviewLevel = Number(e.target.value) || 1;
        this._spawnStudioUnit();
        this._renderGearPanel();
      });
      return;
    }

    { const tabBtn = this.rootContainer.querySelector('#tab-gear'); if (tabBtn) tabBtn.textContent = 'Gear'; }
    const SLOT_LABEL = {
      hand_R: "Weapon R (יד ימין)",
      hand_L: "Off-Hand L (יד שמאל)",
      cape: "Back Cape (גב - גלימה)",
      stow_back: "Stow Back (נשיאה בגב)",
      stow: "Stow Hip (נשיאה במותן)",
      head: "Head (ראש / קסדה)",
      chest: "Chest (חזה / טוניקה)",
      shoulder: "Shoulder (כתף / שרוול)",
      bracer: "Forearm (מגן אמה)",
      glove: "Glove (כפפה)",
      thigh: "Trousers (מכנסיים)",
      greave: "Knees & Shins (ברכיים / שוקיים)",
      boots: "Boots (נעליים / מגפיים)",
      mount_head: "Mount Head (ראש רמך)",
      mount_neck: "Mount Neck (צוואר רמך)",
      mount_torso: "Mount Body (שריון רמך)",
      mount_greave: "Mount Leg (רגל רמך)"
    };

    const unitDefNow = this.unitsData.units[this.currentUnitId];
    const lds = loadoutsOf(unitDefNow);
    const hasSecondLoadout = lds.length > 1;
    const isBowEquipped = this._hasBowEquipped();

    // Only leg_L, shin_L, foot_L are hidden (merged with leg_R, shin_R, foot_R);
    // arm_R/L, forearm_R/L, hand_R/L stay independent!
    // Stow sockets (stow_back, stow_hip_R, stow_hip_L) only appear as rows when a 2nd weapon set exists!
    const PAIRED_LEG_LEFT_JOINTS = new Set(["leg_L", "shin_L", "foot_L"]);
    const eq = this._eq();
    const prefabs = this.unitsData.prefabs || {};
    const joints = Object.keys(this.currentUnitGroup.userData.sockets || {});
    const order = [
      "hand", "cape", "stow", "head", "chest", "shoulder", "bracer", "glove",
      "thigh", "greave", "boots", "mount_head", "mount_neck", "mount_torso", "mount_greave"
    ];

    // Collect weapons across the unit's loadouts so stow sockets (stow_back, stow_hip_R, stow_hip_L) can place them while stowed!
    const heldInCurrentHands = new Set(HAND_SOCKETS.map((hs) => eq[hs]?.prefab).filter(Boolean));
    const otherSetWeaponIds = new Set();
    for (const l of lds) {
      for (const hs of HAND_SOCKETS) {
        const pid = l.equipment?.[hs]?.prefab;
        if (pid && (l.id !== this.currentLoadout || !heldInCurrentHands.has(pid))) {
          otherSetWeaponIds.add(pid);
        }
      }
    }
    for (const sk of STOW_SOCKETS) {
      if (eq[sk]?.prefab) otherSetWeaponIds.add(eq[sk].prefab);
    }

    const rows = joints
      .filter((j) => {
        if (PAIRED_LEG_LEFT_JOINTS.has(j) || j === "pelvis" || j === "quiver_back") return false;
        return true;
      })
      .map((j) => ({ joint: j, slot: this._slotOf(j) }))
      .filter((r) => r.slot)
      .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot) || a.joint.localeCompare(b.joint));

    const activeRace = unitDefNow?.race || this.currentFaction;
    const sideSuffix = (name) => /_(FL|FR|BL|BR|R|L)$/.exec(String(name || ""))?.[1] || "";

    const items = (slot, joint) => {
      const jSide = sideSuffix(joint);
      return Object.keys(prefabs).filter((id) => {
        const pf = prefabs[id];
        const pfSlot = this._prefabSlot(pf);
        if (slot === "cape") return pfSlot === "cape";
        if (slot === "stow") {
          // Only allow weapons that actually exist in the unit's other gear set!
          return otherSetWeaponIds.has(id);
        }
        if (pfSlot !== slot) return false;
        if (slot === "hand" && this.entityCategory === "heroes" && unitDefNow?.isHero) {
          const hClass = unitDefNow.heroClass || "warrior";
          const isSet1 = this.currentLoadout === MAIN_LOADOUT;
          const isBowItem = pf?.weaponType === "bow" || /bow|crossbow/i.test(id);
          const isShieldItem = pf?.weaponType === "shield" || /shield|buckler|tome/i.test(id);
          const isStaffItem = id === "wizard_staff";
          if (hClass === "wizard") {
            if (joint === "weapon_socket_R") return isStaffItem;
            if (joint === "weapon_socket_L") return id === "wizard_tome" || id === "sword";
          } else if (hClass === "warrior") {
            if (isSet1) {
              // Warrior Set 1 (Main): Melee weapons & shields only (no bows, no wizard staff/tome)
              if (isBowItem || isStaffItem || id === "wizard_tome") return false;
              if (joint === "weapon_socket_R" && isShieldItem) return false;
              return true;
            } else {
              // Warrior Set 2: Bows / Crossbows only!
              return isBowItem;
            }
          } else if (hClass === "archer") {
            if (isSet1) {
              // Archer Set 1 (Main): Bows / Crossbows only!
              return isBowItem;
            } else {
              // Archer Set 2: Melee weapons & shields only!
              if (isBowItem || isStaffItem || id === "wizard_tome") return false;
              if (joint === "weapon_socket_R" && isShieldItem) return false;
              return true;
            }
          }
        }
        if (slot !== "hand") {
          if (pf?.race && activeRace && pf.race !== activeRace) return false;
          if (slot === "mount_greave" && pf?.defaultSocket && pf.defaultSocket !== joint) return false;
          if ((slot === "mount_head" || slot === "mount_neck" || slot === "mount_torso") && pf?.defaultSocket && pf.defaultSocket !== joint) return false;
          const pSide = sideSuffix(pf?.defaultSocket);
          if (jSide && pSide && jSide !== pSide) return false;
        }
        return true;
      });
    };

    const rowLabelFor = (joint, slot) => {
      if (joint === "weapon_socket_R") return SLOT_LABEL.hand_R;
      if (joint === "weapon_socket_L") return SLOT_LABEL.hand_L;
      if (joint === "cape_back") return SLOT_LABEL.cape;
      if (joint === "stow_back") return SLOT_LABEL.stow_back;
      if (joint.startsWith("stow_hip_")) return "Stow Hip " + joint.slice(-1);
      if (joint === "arm_R") return "Shoulder R (כתף ימין)";
      if (joint === "arm_L") return "Shoulder L (כתף שמאל)";
      if (joint === "forearm_R") return "Forearm R (אמה ימין)";
      if (joint === "forearm_L") return "Forearm L (אמה שמאל)";
      if (joint === "hand_R") return "Glove R (כפפה ימין)";
      if (joint === "hand_L") return "Glove L (כפפה שמאל)";
      if (joint.startsWith("front_shin_")) return "Mount F" + joint.slice(-1);
      if (joint.startsWith("back_shin_")) return "Mount B" + joint.slice(-1);
      if (joint.startsWith("mount_shin_")) return "Mount " + joint.slice(-2);
      return SLOT_LABEL[slot] || joint;
    };

    const sel = this.selectedSocketName;
    const locked = lockedHand(this.unitsData, asLoadout(unitDefNow, this.currentLoadout));

    const isUnitMode = this.entityCategory === "units";
    const html = rows.map(({ joint, slot }) => {
      const list = items(slot, joint);
      const cur = eq[joint]?.prefab || "";
      const isHandLockedInUnitMode = isUnitMode && slot === "hand";
      const isLocked = joint === locked || isHandLockedInUnitMode;
      const partner = this._pairedCounterpartJoint(joint);
      const on = joint === sel || partner === sel || (this.gripJoint && (joint === this.gripJoint || partner === this.gripJoint));
      const options = isHandLockedInUnitMode
        ? `<option value="${cur}" selected>${cur ? this._friendlyPrefabLabel(cur, prefabs[cur]) : "(Empty — Set in Units Lab)"}</option>`
        : `<option value="">${list.length ? "(None / Empty)" : "(No items)"}</option>` +
          list
            .map((id) => `<option value="${id}" ${id === cur ? "selected" : ""}>${this._friendlyPrefabLabel(id, prefabs[id])}</option>`)
            .join("");
      const isImportedCur = Boolean(cur && prefabs[cur]?.importInfo);
      return `<div data-gear-row="${joint}" class="flex items-center gap-1.5 rounded px-1 py-0.5 ${on ? "bg-emerald-500/15 ring-1 ring-emerald-500/50" : ""}">
        <button type="button" class="gear-pick w-[116px] shrink-0 truncate text-left ${on ? "text-emerald-300 font-bold" : "text-slate-300 hover:text-white"}" data-joint="${joint}" title="Select ${joint} on timeline">${rowLabelFor(joint, slot)}</button>
        <select class="gear-sel min-w-0 flex-1 rounded bg-slate-800 border border-slate-600 px-1.5 py-1 text-slate-100 ${cur ? "border-amber-500/60 text-amber-200" : ""}" data-joint="${joint}" id="gear-sel-${joint}" ${list.length && !isLocked ? "" : "disabled"} ${isHandLockedInUnitMode ? 'title="Weapons are chosen in the Units Lab; use Fit to adjust grip or Stow rows to place stowed weapons"' : isLocked ? 'title="Held by a two-handed weapon"' : ""}>${joint === locked ? "<option value=\"\">(Two-Handed Locked)</option>" : options}</select>
        <button type="button" class="gear-grip rounded border px-1.5 py-1 ${cur ? (this.gripJoint === joint ? "border-amber-400 bg-amber-500 text-slate-950 font-bold" : "border-slate-600 text-slate-300 hover:bg-slate-800") : "border-slate-800 text-slate-600"}" data-joint="${joint}" ${cur ? "" : "disabled"} title="Adjust grip offset & rotation (Fit)">Fit</button>
        ${isImportedCur ? `<button type="button" class="gear-del-imp flex h-6 w-6 shrink-0 items-center justify-center rounded bg-rose-700 hover:bg-rose-600 text-white text-[11px] font-bold cursor-pointer" data-del-prefab="${cur}" title="Delete this imported item">✕</button>` : ""}
      </div>`;
    }).join("");

    // Contextual Bow -> Quiver + Arrow Type + Movable Arrow section (ONLY shown when a Bow/Crossbow is equipped!)
    const ac = this._ensureArrowConfig();
    const curBack = eq.quiver_back?.prefab || eq.stow_back?.prefab || "quiver";
    const quiverIds = ["quiver", "quiver_royal_gilded", "quiver_ranger_bark", "quiver_ironclad"].filter((k) => prefabs[k]);
    const isArrowSelected = sel === "arrow_socket";
    const isBowstringSelected = sel === "bowstring_mid";
    const arrowWorkshopHtml = isBowEquipped ? `
      <div class="mt-2 rounded-lg border border-amber-500/60 bg-amber-950/20 p-2 flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <span class="font-bold text-amber-300">🏹 קשת, אשפה וחץ לירייה</span>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <button type="button" id="btn-select-arrow-socket" class="rounded px-2 py-1 text-[11px] font-bold transition ${isArrowSelected ? "bg-sky-400 text-slate-950" : "bg-sky-900/80 text-sky-200 border border-sky-500/50 hover:bg-sky-800"}" title="בוחר את החץ שבאשפה (arrow_socket) להזזה והנפשה בציר הזמן">
            ${isArrowSelected ? "● חץ נבחר" : "בחר חץ מהאשפה"}
          </button>
          <button type="button" id="btn-select-bowstring" class="rounded px-2 py-1 text-[11px] font-bold transition ${isBowstringSelected ? "bg-amber-400 text-slate-950" : "bg-amber-900/70 text-amber-200 border border-amber-500/50 hover:bg-amber-800"}" title="בוחר את אמצע חוט הקשת (bowstring_mid) כדי למתוח אותו אחורה באנימציה">
            ${isBowstringSelected ? "● מיתר נבחר" : "מתח חוט קשת"}
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-24 text-slate-300">סוג אשפה:</span>
          <select id="arrow-quiver-sel" class="flex-1 rounded bg-slate-800 border border-slate-600 px-1.5 py-1 text-slate-100">
            ${quiverIds.map((qid) => `<option value="${qid}" ${curBack === qid ? "selected" : ""}>${this._friendlyPrefabLabel(qid, prefabs[qid])}</option>`).join("")}
          </select>
          <button type="button" class="gear-grip rounded border border-slate-600 px-1.5 py-1 text-slate-300 hover:bg-slate-800" data-joint="quiver_back" title="התאם מיקום אשפה על הגב">Fit</button>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-24 text-slate-300">סוג חץ:</span>
          <select id="arrow-style-sel" class="flex-1 rounded bg-slate-800 border border-slate-600 px-1.5 py-1 text-amber-200 font-semibold">
            <option value="bodkin" ${ac.style === "bodkin" ? "selected" : ""}>Bodkin War Arrow (חץ קרב חד)</option>
            <option value="broadhead" ${ac.style === "broadhead" ? "selected" : ""}>Barbed Broadhead (ראש משונן רחב)</option>
            <option value="needle" ${ac.style === "needle" ? "selected" : ""}>Armor Piercer (חודר שריון דק)</option>
            <option value="royal" ${ac.style === "royal" ? "selected" : ""}>Royal Heavy Arrow (חץ מלכותי מוזהב)</option>
          </select>
        </div>
        <div class="grid grid-cols-3 gap-1.5 pt-0.5">
          <label class="flex flex-col items-center rounded border border-slate-700 bg-slate-900 p-1">
            <span class="text-[10px] text-slate-400 mb-0.5">מקל (Shaft)</span>
            <input type="color" id="arrow-col-shaft" value="${ac.shaftHex || "#f8fafc"}" class="h-6 w-full cursor-pointer rounded bg-transparent" />
          </label>
          <label class="flex flex-col items-center rounded border border-slate-700 bg-slate-900 p-1">
            <span class="text-[10px] text-slate-400 mb-0.5">ראש (Tip)</span>
            <input type="color" id="arrow-col-head" value="${ac.headHex || "#ffffff"}" class="h-6 w-full cursor-pointer rounded bg-transparent" />
          </label>
          <label class="flex flex-col items-center rounded border border-slate-700 bg-slate-900 p-1">
            <span class="text-[10px] text-slate-400 mb-0.5">נוצות (Fletch)</span>
            <input type="color" id="arrow-col-fletch" value="${ac.fletchHex || "#e2e8f0"}" class="h-6 w-full cursor-pointer rounded bg-transparent" />
          </label>
        </div>
      </div>` : "";

    const { list: acts, notes, why } = this._actionList();
    const chip = (b) => `<span class="rounded border px-1.5 py-0.5 ${notes[b] ? "border-amber-500/60 text-amber-300" : "border-emerald-500/40 text-emerald-300"}" title="${(why[b] || ["already used by this unit"]).join(", ")}">${b}</span>`;
    const actionsHtml = `<div class="mt-2 border-t border-slate-700/70 pt-2"><div class="mb-1 text-slate-400">Actions of this gear set</div><div class="flex flex-wrap gap-1">${acts.map(chip).join("")}</div>${isDualWield(this.unitsData, asLoadout(unitDefNow, this.currentLoadout)) ? "<div class=\"mt-1 text-slate-500\">Dual wield: attacks use both hands.</div>" : ""}</div>`;
    const untyped = [...new Set(Object.values(eq).map((e) => e?.prefab).filter((id) => id && this._prefabSlot(prefabs[id]) === "hand" && !prefabs[id]?.weaponType))];
    const untypedHtml = untyped.length ? `<div class="mt-2 rounded border border-amber-500/50 bg-amber-500/10 p-1.5 text-amber-200">No weapon type yet: <b>${untyped.join(", ")}</b>. Pick one:
      ${untyped.map((id) => `<select class="gear-type rounded bg-slate-800 border border-slate-600 px-1 py-0.5 text-slate-100" data-prefab="${id}"><option value="">${id}: choose type…</option>${["melee_short","melee_long","bow","thrown","shield"].map((t) => `<option value="${t}">${t}</option>`).join("")}</select>`).join(" ")}</div>` : "";
    const second = lds.find((l) => l.id !== MAIN_LOADOUT);
    const tab = (id, label) => `<button type="button" class="loadout-tab rounded px-2.5 py-1 font-semibold ${id === this.currentLoadout ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}" data-loadout="${id}">${label}</button>`;
    const isWizardHero = this.entityCategory === "heroes" && unitDefNow?.heroClass === "wizard";
    const loadoutBar = `<div class="mb-2 flex flex-wrap items-center gap-1.5 rounded border border-slate-700/70 bg-slate-950/40 px-1.5 py-1">
      <span class="text-slate-400" title="A unit can switch between at most two sets of equipment during the game">Gear set</span>
      ${tab(MAIN_LOADOUT, "1")}
      ${isWizardHero
        ? '<span class="ml-auto text-[10px] text-sky-300 font-semibold">Wizard: Staff + Off-Hand Sword/Tome</span>'
        : second
          ? tab(second.id, "2")
          : '<button type="button" id="loadout-new" class="rounded border border-dashed border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800" title="הוסף סט נשקים שני (לוחם -> קשת, קשת -> חרב)">+ 2nd set</button>'}
      ${!isWizardHero && second ? `<button type="button" id="loadout-del" class="ml-auto rounded border border-rose-500/50 px-1.5 py-1 text-rose-300 hover:bg-rose-500/10" title="Delete set 2">Delete set 2</button>` : ""}
    </div>`;
    const importedGearEntries = Object.entries(prefabs).filter(([, p]) => p?.importInfo);
    const importedGearListHtml = importedGearEntries.length
      ? `<div class="mt-2 border-t border-slate-700/70 pt-2">
          <div class="mb-1 text-[10.5px] font-bold text-rose-300">Imported Armour / Gear (${importedGearEntries.length})</div>
          <div class="flex flex-col gap-1 max-h-32 overflow-y-auto pr-1">
            ${importedGearEntries
              .map(
                ([pid, pf]) => `<div class="flex items-center gap-1.5 rounded bg-slate-950/60 border border-slate-800 px-2 py-1">
                  <div class="min-w-0 flex-1 truncate text-[11px] text-slate-200">${pf.name || pid} <span class="text-[10px] text-slate-500">(${pf.slot || 'gear'})</span></div>
                  <button type="button" class="gear-del-imp flex h-5 w-5 shrink-0 items-center justify-center rounded bg-rose-700 hover:bg-rose-600 text-white text-[11px] font-bold cursor-pointer" data-del-prefab="${pid}" title="Delete this imported item">✕</button>
                </div>`
              )
              .join("")}
          </div>
        </div>`
      : "";
    host.innerHTML = rows.length
      ? `${loadoutBar}<div class="text-slate-400 leading-snug mb-1">לחיצה על שם החלק בוחרת אותו להנפשה בציר הזמן. לחיצה על <b>Fit</b> מכוונת את מיקום האחיזה הקבוע שלו.</div>${html}${arrowWorkshopHtml}${actionsHtml}${untypedHtml}${importedGearListHtml}`
      : `<div class="text-slate-500">This unit has no parts that can carry items.</div>${importedGearListHtml}`;
  },

  /** Put an item on a joint (or empty it). Legs (Trousers, Knees & Shins, Boots) update both R and L together; arms/hands are independent! */
  _equipSlot(joint, prefabId) {
    const unitDef = this.unitsData.units[this.currentUnitId];
    const view = asLoadout(unitDef, this.currentLoadout);
    const pDef0 = prefabId ? this.unitsData.prefabs[prefabId] : null;
    if (prefabId && HAND_SOCKETS.includes(joint) && lockedHand(this.unitsData, view) === joint) {
      this._toast("The other hand holds a two-handed weapon: remove it first.");
      this._renderGearPanel();
      return;
    }
    this._beginEdit("equip");
    const eqObj = this._eq(true);
    const partnerJoint = this._pairedCounterpartJoint(joint);
    const partnerPrefabId = this._pairedCounterpartPrefab(prefabId);

    if (!prefabId) {
      delete eqObj[joint];
      if (partnerJoint) delete eqObj[partnerJoint];
    } else {
      const pDef = pDef0;
      if (isTwoHanded(pDef) && HAND_SOCKETS.includes(joint)) {
        const other = HAND_SOCKETS.find((h) => h !== joint);
        if (eqObj[other]) { delete eqObj[other]; this._toast("Two-handed weapon: the other hand was emptied."); }
      }
      if (STOW_SOCKETS.includes(joint)) {
        for (const otherStow of STOW_SOCKETS) {
          if (otherStow !== joint && eqObj[otherStow]?.prefab === prefabId) {
            delete eqObj[otherStow];
          }
        }
      }
      const wType = weaponTypeOf(pDef);
      const stowDef = STOW_SOCKETS.includes(joint) && wType ? STOW_DEFAULTS[wType] : null;
      eqObj[joint] = {
        prefab: prefabId,
        gripOffset: [...(stowDef?.gripOffset || pDef?.gripOffset || [0, 0, 0])],
        gripRotation: [...(stowDef?.gripRotation || pDef?.gripRotation || [0, 0, 0])]
      };
      if (partnerJoint && partnerPrefabId && this.unitsData.prefabs[partnerPrefabId]) {
        const partnerDef = this.unitsData.prefabs[partnerPrefabId];
        eqObj[partnerJoint] = {
          prefab: partnerPrefabId,
          gripOffset: [...(partnerDef?.gripOffset || [0, 0, 0])],
          gripRotation: [...(partnerDef?.gripRotation || [0, 0, 0])]
        };
      }
    }
    if (this.gripJoint === joint && !prefabId) this.gripJoint = null;
    this._restowAll();
    this._markHeroVisualDirty();
    this._spawnStudioUnit();
    if (prefabId) this._selectJoint(joint, { fit: false });
    this._renderGearPanel();
    this.timelineEditor?.refreshClipList();
    this.stateManager.scheduleSave();
    this._syncUnitsStateToUbLab?.();
  },

  // ================================================================== pose (the one place that decides what the rig looks like)

  _resetJointsToRest() {
    const { sockets, restPoses } = this.currentUnitGroup.userData;
    for (const [name, joint] of Object.entries(sockets)) {
      const rest = restPoses[name];
      if (!rest) continue;
      joint.position.set(...rest.pos);
      joint.rotation.set(...rest.rot);
    }
  },

  /** Show the pose at normalised time t – clean, weight 1, no blending – exactly what the keyframes say. */
  _applyPoseAt(t) {
    if (!this.currentUnitGroup || !this.currentAnimator) return;
    const { sockets, restPoses } = this.currentUnitGroup.userData;
    this._resetJointsToRest();

    const kind = this._previewKind();
    if (kind === 'keys') {
      const clip = this.timelineEditor?.getReadClip();
      if (clip) this.currentAnimator._applyKeyframeClip(clip, t, 1.0, sockets, restPoses);
      this._cleaned = false;
    } else if (kind === 'procedural') {
      this.currentAnimator.lowerLayer.normTime = t;
      this.currentAnimator.update(0);
      this._cleaned = false;
    }
    if (this.currentUnitGroup?.userData?.bowstringRig) {
      updateBowstringRig(this.currentUnitGroup);
    }
    this.inspectorPanel?.syncUI();
    this.gizmoController?.update();
  },

  /** Called right before the user changes a joint (gizmo pointer-down, inspector field, paste, key button). */
  _prepareEdit() {
    this._beginEdit('pose');
    this.timelineEditor?.forcePause();
    // An idle without keys is shown procedurally (bob / sway). Keying on top of that would bake the sway into the key,
    // so the first edit switches to a clean rest pose – once, so the numbers the user already typed are not wiped.
    if (this._previewKind() === 'procedural' && !this._cleaned) {
      this._resetJointsToRest();
      this._cleaned = true;
      this.inspectorPanel?.syncUI();
    }
  },

  /** The live joint's pose relative to its rest pose (what keyframes store). */
  // ------------------------------------------------------------------ hand shortcuts: curl every finger of a hand with one slider

  // ['index', 'middle', 'ring', 'pinky'] moved to StudioApp class

  _handSide() {
    const m = /^(?:hand|index2?|middle2?|ring2?|pinky2?|thumb2?)_([RL])$/.exec(this.selectedSocketName || '');
    return m ? m[1] : null;
  },

  /** Set the curl (0 = open, 1 = full fist) of the four fingers (`which: 'fingers'`) or the thumb of one hand. */
  _setCurl(side, which, t) {
    const sockets = this.currentUnitGroup?.userData?.sockets || {};
    const rests = this.currentUnitGroup?.userData?.restPoses || {};
    const names = which === 'thumb' ? [`thumb_${side}`, `thumb2_${side}`] : ['index', 'middle', 'ring', 'pinky'].flatMap((f) => [`${f}_${side}`, `${f}2_${side}`]);
    this._beginEdit('curl');
    for (const n of names) {
      const joint = sockets[n], rest = rests[n];
      if (!joint || !rest) continue;
      const z = this._jointRules(n).limits?.z || [-90, 0];
      const flex = side === 'R' ? z[0] : z[1];            // the bending direction of this hand
      joint.rotation.z = rest.rot[2] + (flex * 0.9 * t) * Math.PI / 180;
      if (this.editMode === 'rig') this._writeRestPose(n, joint);
      else this._commitPose(n);
    }
    if (this.editMode === 'rig') this.stateManager.scheduleSave();
    this._updateKeyContext();
    this._syncHandControls();
  },

  _curlOf(side, which) {
    const sockets = this.currentUnitGroup?.userData?.sockets || {};
    const rests = this.currentUnitGroup?.userData?.restPoses || {};
    const n = which === 'thumb' ? `thumb_${side}` : `index_${side}`;
    const joint = sockets[n], rest = rests[n];
    if (!joint || !rest) return 0;
    const z = this._jointRules(n).limits?.z || [-90, 0];
    const flex = (side === 'R' ? z[0] : z[1]) * 0.9;
    return flex ? Math.max(0, Math.min(1, ((joint.rotation.z - rest.rot[2]) * 180 / Math.PI) / flex)) : 0;
  },

  _syncHandControls() {
    const host = this.rootContainer?.querySelector('#insp-hand');
    if (!host) return;
    const side = this._handSide();
    const hasFingers = side && this.currentUnitGroup?.userData?.sockets?.[`index_${side}`];
    host.classList.toggle('hidden', !hasFingers);
    if (!hasFingers) return;
    host.dataset.side = side;
    host.querySelector('#hand-title').textContent = `Hand ${side} – all fingers`;
    const f = this._curlOf(side, 'fingers'), th = this._curlOf(side, 'thumb');
    host.querySelector('#hand-curl').value = String(Math.round(f * 100));
    host.querySelector('#hand-thumb').value = String(Math.round(th * 100));
  },

  _getJointPose(jointName) {
    const { sockets, restPoses } = this.currentUnitGroup.userData;
    const joint = sockets[jointName];
    const rest = restPoses[jointName];
    if (!joint || !rest) return null;
    return {
      pos: round3v([joint.position.x - rest.pos[0], joint.position.y - rest.pos[1], joint.position.z - rest.pos[2]]),
      rot: round3v([joint.rotation.x - rest.rot[0], joint.rotation.y - rest.rot[1], joint.rotation.z - rest.rot[2]])
    };
  },

  /** Joint rules live on the hierarchy node: `limits: {x:[min,max], y:[..], z:[..]}` (degrees, relative to the rest pose) and `lockPos: true`. */
  _jointRules(name) {
    const find = (nodes) => {
      for (const [n, def] of Object.entries(nodes || {})) {
        if (n === name) return def;
        const hit = find(def.children);
        if (hit) return hit;
      }
      return null;
    };
    const def = find(this.unitsData.units[this.currentUnitId]?.hierarchy);
    return def ? { limits: def.limits || null, lockPos: Boolean(def.lockPos) } : { limits: null, lockPos: false };
  },

  /** Clamp a hand-edited joint to its rules (joints only rotate inside their allowed range; locked joints cannot be pulled out). */
  _enforceJointRules(name, obj) {
    const { limits, lockPos } = this._jointRules(name);
    const rest = this.currentUnitGroup?.userData?.restPoses?.[name];
    if (!rest) return false;
    let changed = false;
    if (lockPos) {
      for (let i = 0; i < 3; i++) {
        const k = 'xyz'[i];
        if (Math.abs(obj.position[k] - rest.pos[i]) > 1e-6) { obj.position[k] = rest.pos[i]; changed = true; }
      }
    }
    if (limits) {
      for (let i = 0; i < 3; i++) {
        const k = 'xyz'[i], range = limits[k];
        if (!Array.isArray(range)) continue;
        const rel = (obj.rotation[k] - rest.rot[i]) * 180 / Math.PI;
        const clamped = Math.min(range[1], Math.max(range[0], rel));
        if (Math.abs(clamped - rel) > 1e-6) { obj.rotation[k] = rest.rot[i] + clamped * Math.PI / 180; changed = true; }
      }
    }
    if (changed) { this.inspectorPanel.syncUI(); this.gizmoController.update(); this._toast(`${name}: limited by the joint rules`, 1200); }
    return changed;
  },

  /** The selected object was moved (gizmo drag OR inspector). Decide where it is stored. */
  _onPoseEdited() {
    const obj = this.gizmoController.selectedObject;
    if (!obj) return;
    if (this.currentUnitGroup?.userData?.bowstringRig) {
      updateBowstringRig(this.currentUnitGroup);
    }
    this.inspectorPanel.syncUI();
    this.gizmoController.update();

    if (this.gizmoController.gizmoTargetType === 'weapon_grip') {
      const eq = this._eq()[this.selectedSocketName];
      if (eq) {
        eq.gripOffset = round3v([obj.position.x, obj.position.y, obj.position.z]);
        eq.gripRotation = round3v([obj.rotation.x, obj.rotation.y, obj.rotation.z]);
        delete eq.auto;   // fitted by hand: the automatic carry no longer removes or moves it
        this.stateManager.scheduleSave();
      }
      return;
    }

    if (this.editMode === 'rig') {
      this._writeRestPose(this.selectedSocketName, obj);
      this.stateManager.scheduleSave();
      return;
    }

    this._enforceJointRules(this.selectedSocketName, obj);
    this._commitPose(this.selectedSocketName);
  },

  /** Write the joint's current on-screen pose into the clip (keys at the playhead for animated rows, constants for static ones). */
  _commitPose(joint) {
    const tl = this.timelineEditor;
    if (!tl.canKeyframe()) return;
    const pose = this._getJointPose(joint);
    if (!pose) return;

    // Only the properties that really changed are written: animated ones as a key at the playhead,
    // static ones as the constant of the whole clip.
    let wroteStatic = false;
    for (const prop of KT.PROPS) {
      const before = tl.getPropValue(joint, prop);
      const moved = [0, 1, 2].some((i) => Math.abs(before[i] - pose[prop][i]) > 2e-4);
      if (!moved) continue;
      if (!tl.isPropAnimated(joint, prop)) wroteStatic = true;
      tl.editProp(joint, prop, pose[prop]);
    }
    // When rotating weapon_socket_R or weapon_socket_L statically (no keyframes), also sync to restPoses/hierarchy
    // so the sword/weapon rotation updates across Idle, Walk, Hall of Heroes, Portraits, and Main Game!
    if ((joint === "weapon_socket_R" || joint === "weapon_socket_L") && !tl.isPropAnimated(joint, "rot")) {
      const sockObj = this.currentUnitGroup?.userData?.sockets?.[joint];
      if (sockObj) {
        this._writeRestPose(joint, sockObj);
      }
    }
    if (wroteStatic && !this._staticHintShown) {
      this._staticHintShown = true;
      this._toast('Empty diamond (◇) = static: this change applies to the WHOLE clip. Click the ◇ in the timeline to animate it.', 5000);
    }
    this._updateKeyContext();
  },

  /** Rig mode: the joint's current transform becomes its rest pose, in memory and in the hierarchy JSON. */
  _writeRestPose(jointName, obj) {
    const rest = this.currentUnitGroup.userData.restPoses[jointName];
    if (!rest) return;
    rest.pos = [obj.position.x, obj.position.y, obj.position.z];
    rest.rot = [obj.rotation.x, obj.rotation.y, obj.rotation.z];

    const unitDef = this.unitsData.units[this.currentUnitId];
    const pos = round3v(rest.pos);
    const rot = round3v(rest.rot);
    const walk = (nodes) => {
      if (!nodes) return;
      for (const [name, def] of Object.entries(nodes)) {
        if (name === jointName) { def.pos = [...pos]; def.rot = [...rot]; }
        if (def.children) walk(def.children);
      }
    };
    walk(unitDef.hierarchy);
    walk(unitDef.mountHierarchy);
    this._markHeroVisualDirty();
  },

  /** Show the easing editor when the playhead sits on a keyframe of the selected joint. */
  _updateKeyContext() {
    const tl = this.timelineEditor;
    if (!tl || !this.inspectorPanel) return;
    const show = this.view === 'studio' && this.editMode === 'pose' && !tl.isPlaying
      && this.gizmoController.gizmoTargetType === 'joint' && tl.canKeyframe();
    this.inspectorPanel.setKeyContext(show ? tl.keyframeAt(this.selectedSocketName) : null);
  },

  _onProceduralChange(key, value) {
    this._beginEdit('proc');
    const tl = this.timelineEditor;
    const { name, clip, created } = ensureProceduralClip(this.unitsData, this.currentUnitId, this.currentFaction, tl.activeBaseName, tl.scope);
    const prevVal = clip[key];
    clip[key] = value;

    // Also keep the active keyframe clip for this movement in sync with the slider!
    const kfRes = ensureKeyframeClip(this.unitsData, this.currentUnitId, this.currentFaction, tl.activeBaseName, tl.scope);
    const kfClip = kfRes?.clip;
    if (kfClip && kfClip.tracks) {
      if (key === 'frequency' && value > 0.1) {
        kfClip.duration = Math.max(0.2, Math.min(4.0, Math.round((2.0 / value) * 100) / 100));
      } else if (key === 'legSwing' && Number.isFinite(value)) {
        const scale = prevVal > 0.01 ? value / prevVal : 1.0;
        for (const jn of ['leg_L', 'leg_R', 'shin_L', 'shin_R']) {
          for (const k of kfClip.tracks[jn] || []) {
            if (Array.isArray(k.rot)) k.rot[0] = round4(k.rot[0] * scale);
          }
        }
      } else if (key === 'armSwing' && Number.isFinite(value)) {
        const scale = prevVal > 0.01 ? value / prevVal : 1.0;
        for (const jn of ['arm_L', 'arm_R', 'forearm_L', 'forearm_R']) {
          for (const k of kfClip.tracks[jn] || []) {
            if (Array.isArray(k.rot)) k.rot[0] = round4(k.rot[0] * scale);
          }
        }
      } else if (key === 'bobAmplitude' && Number.isFinite(value)) {
        for (const k of kfClip.tracks.torso || []) {
          if (Array.isArray(k.pos) && Math.abs(k.t - 0.25) < 0.05 || Math.abs(k.t - 0.75) < 0.05) {
            k.pos[1] = round4(value);
            k.posKey = true;
          }
        }
      } else if (key === 'torsoSway' && Number.isFinite(value)) {
        const scale = prevVal > 0.005 ? value / prevVal : 1.0;
        for (const k of kfClip.tracks.torso || []) {
          if (Array.isArray(k.rot)) {
            k.rot[1] = round4(k.rot[1] * scale);
            k.rot[2] = round4(k.rot[2] * scale);
          }
        }
      }
    }

    if (created || kfRes?.created) {
      this.currentAnimator.setLocomotion(tl.getClipName());
      tl.refresh();
    }
    this.inspectorPanel.procClip = clip;
    this.stateManager.scheduleSave();
    this._applyPoseAt(tl.scrubNormTime);
    return name;
  },

  // ================================================================== colours

  _jointMeshes(jointName) {
    const out = [];
    const targets = new Set([jointName]);
    const partner = this._pairedCounterpartJoint(jointName);
    if (partner) targets.add(partner);
    if (jointName === "leg_R" || jointName === "leg_L" || jointName === "pelvis") {
      targets.add("pelvis");
      targets.add("leg_R");
      targets.add("leg_L");
    }
    this.currentUnitGroup?.traverse((c) => {
      if (c.isMesh && c.parent && targets.has(c.parent.name) && c.material?.color) out.push(c);
    });
    return out;
  },

  _jointColorHex(jointName) {
    const mesh = this._jointMeshes(jointName)[0];
    return mesh ? `#${mesh.material.color.getHexString()}` : null;
  },

  _applyColorPreview(hex) {
    if (!hex) return;
    this._restoreColorPreview(this.selectedSocketName);
    for (const m of this._jointMeshes(this.selectedSocketName)) {
      if (m.userData._origHex === undefined) m.userData._origHex = m.material.color.getHex();
      ownMaterial(m).color.set(hex);
    }
    this._previewJoint = this.selectedSocketName;
  },

  /** Undo an unsaved colour preview (joint changed, unit respawned, ...). */
  _restoreColorPreview(onlyIfJoint = null) {
    const joint = this._previewJoint;
    if (!joint || (onlyIfJoint && onlyIfJoint !== joint) || !this.currentUnitGroup) return;
    for (const m of this._jointMeshes(joint)) {
      if (m.userData._origHex !== undefined) { m.material.color.setHex(m.userData._origHex); delete m.userData._origHex; }
    }
    this._previewJoint = null;
  },

  _saveColorOverride(hex, scope) {
    this._beginEdit('color');
    const joint = this.selectedSocketName;
    const data = this.unitsData;
    const fac = this.currentFaction;
    const unitDef = data.units[this.currentUnitId];

    const overridesOf = (u, f) => {
      const def = data.units[u];
      if (!def.skins) def.skins = {};
      if (!def.skins[f]) def.skins[f] = {};
      if (!def.skins[f].colorOverrides) def.skins[f].colorOverrides = {};
      return def.skins[f];
    };
    const relatedJoints = [joint];
    const partnerJ = this._pairedCounterpartJoint(joint);
    if (partnerJ && !relatedJoints.includes(partnerJ)) relatedJoints.push(partnerJ);
    if (joint === "leg_R" || joint === "leg_L" || joint === "pelvis") {
      for (const tj of ["pelvis", "leg_R", "leg_L"]) {
        if (!relatedJoints.includes(tj)) relatedJoints.push(tj);
      }
    }
    const setColor = (u, f) => {
      const skin = overridesOf(u, f);
      for (const rj of relatedJoints) {
        if (hex) skin.colorOverrides[rj] = hex;
        else delete skin.colorOverrides[rj];
      }
      if (Object.keys(skin.colorOverrides).length === 0) delete skin.colorOverrides;
    };

    if (!hex && unitDef.colorOverrides && joint in unitDef.colorOverrides) {
      // "Clear" must also remove the unit-wide colour, but the other factions keep what they showed before.
      for (const f of this._factions()) {
        if (f === fac) continue;
        const skin = overridesOf(this.currentUnitId, f);
        if (!(joint in skin.colorOverrides)) skin.colorOverrides[joint] = unitDef.colorOverrides[joint];
      }
      delete unitDef.colorOverrides[joint];
      if (Object.keys(unitDef.colorOverrides).length === 0) delete unitDef.colorOverrides;
    }

    if (scope === 'class') this._factions().forEach((f) => setColor(this.currentUnitId, f));
    else if (scope === 'faction') Object.keys(data.units).forEach((u) => setColor(u, fac));
    else setColor(this.currentUnitId, fac);

    this._previewJoint = null;
    this._markHeroVisualDirty();
    this._spawnStudioUnit();
    this.stateManager.scheduleSave();
    this._syncUnitsStateToUbLab?.();
    this._toast(hex ? `Colour saved (${scope})` : 'Colour cleared');
  },

  // ================================================================== timeline
};
