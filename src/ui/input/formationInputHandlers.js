/**
 * Kings Lands — Keyboard, Mouse Drag, Order Commit & Per-Frame Sync Handlers for FormationPreview3D
 * (src/ui/input/formationInputHandlers.js)
 */
import * as THREE from 'three';
import { toFx } from '../../core/fx.js';
import { CommandTypes } from '../../core/commandBus.js';
import { FormationTypes } from '../../sim/formations/formations.js';
import { resolveDefaultFormation } from '../../sim/formations/company.js';
import { computeArmyDragLayoutFx } from '../../sim/formations/armyDrag.js';
import { OrderLineRenderer } from '../../render/orderLineRenderer.js';
import { UnitTacticalOrb } from '../hud/unitTacticalOrb.js';
import { OrderQueueEngine } from './orderQueueEngine.js';
import { WorldPicker } from './worldPicker.js';
import { UnitSelectionController } from './unitSelectionController.js';
import { FormationGhostPreview } from './formationGhostPreview.js';
import { RtsCursorManager } from '../hud/hudIcons.js';


export const formationInputHandlerMethods = {
  onKeyDown(e) {
    if (e.code === 'Escape') {
      if (this.isRightDragging) {
        this.cancelRightDrag();
        return true;
      }
      const hadStaged = this.orderQueue.hasStagedPatrol();
      this.orderQueue.clearStagedPatrol();
      if (this.targetingMode !== 'NONE' || hadStaged) {
        this.setTargetingMode('NONE');
        return true;
      }
      return false;
    }

    if (e.code === 'F1') {
      e.preventDefault();
      const matched =
        e.ctrlKey || e.metaKey
          ? this.selection.selectAllIdleWorkers()
          : this.selection.selectNextIdleWorker(true);
      if (matched) {
        if (this.synthAudio) this.synthAudio.playFocusWhoosh();
        this._refreshRadialPanelUI();
      }
      return true;
    }

    if (e.code === 'F2' || e.code === 'F12') {
      e.preventDefault();
      if (this.selection.selectAllCombatUnits()) {
        if (this.synthAudio) this.synthAudio.playHornAlert();
        this._refreshRadialPanelUI();
      }
      return true;
    }

    const digitMatch = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
    if (digitMatch && !e.altKey) {
      const groupNum = Number(digitMatch[1]) | 0;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (this.selection.assignControlGroup(groupNum)) {
          if (this.synthAudio) this.synthAudio.playFocusWhoosh?.();
          this._refreshRadialPanelUI();
        }
        return true;
      } else if (!e.shiftKey) {
        const now = performance.now();
        const isDoubleTap =
          this._lastControlGroupNum === groupNum &&
          now - (this._lastControlGroupTime || 0) < 380;
        this._lastControlGroupNum = groupNum;
        this._lastControlGroupTime = now;
        if (this.selection.selectControlGroup(groupNum, isDoubleTap)) {
          e.preventDefault();
          if (isDoubleTap && this.synthAudio) this.synthAudio.playFocusWhoosh?.();
          this._refreshRadialPanelUI();
          return true;
        }
      }
    }

    if (this.selectedCompanyIds.size === 0) return false;

    if (this.isRightDragging && (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight')) {
      this.dragPreserveRelative = true;
      this._update3DGhostPreview();
    }

    if (e.code === 'KeyA' && e.shiftKey) {
      e.preventDefault();
      this.orderQueue.clearStagedPatrol();
      this._targetingModeShiftSticky = false;
      this.setTargetingMode(this.targetingMode === 'ATTACK_MOVE' ? 'NONE' : 'ATTACK_MOVE');
      return true;
    }

    if (e.code === 'KeyP') {
      e.preventDefault();
      this._targetingModeShiftSticky = false;
      if (this.targetingMode === 'PATROL' && this.orderQueue.hasStagedPatrol()) {
        this._commitStagedPatrolRoute();
      } else {
        this.orderQueue.clearStagedPatrol();
        this.setTargetingMode(this.targetingMode === 'PATROL' ? 'NONE' : 'PATROL');
      }
      return true;
    }

    if (e.code === 'KeyX') {
      e.preventDefault();
      this.issueStopCommand();
      return true;
    }

    return false;
  },

  onKeyUp(e) {
    if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this._targetingModeShiftSticky = false;
      if (this.orderQueue.hasStagedPatrol()) {
        this._commitStagedPatrolRoute();
      }
    }
    if (this.isRightDragging && (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight')) {
      this.dragPreserveRelative = false;
      this._update3DGhostPreview();
    }
  },

  onMouseDown(e) {
    if (e.button === 0 && this.isRightDragging) {
      e.preventDefault();
      this.cancelRightDrag();
      return true;
    }

    // Left-click while in SPELL_TARGET mode: cast the targeted spell at the clicked ground/unit!
    if (
      e.button === 0 &&
      !e.altKey &&
      this.targetingMode === 'SPELL_TARGET' &&
      this.pendingHeroSpell
    ) {
      e.preventDefault();
      const hit = this.worldPicker.raycastTerrain(e);
      if (hit) {
        this.commitPendingSpellAtWorld(hit.x, hit.z, e);
      } else {
        this._hideAllSpellTargetPreviews();
        this.setTargetingMode('NONE');
      }
      return true;
    }

    if (
      e.button === 0 &&
      !e.altKey &&
      this.targetingMode !== 'NONE' &&
      this.selectedCompanyIds.size > 0
    ) {
      const hit = this.worldPicker.raycastTerrain(e);
      if (hit) {
        const effectiveShift = Boolean(e.shiftKey);
        if (this.targetingMode === 'PATROL' && effectiveShift) {
          this._stageShiftPatrolPoint(hit);
        } else {
          this._orderClick = { x: e.clientX, y: e.clientY };
          this._commitRightClickDragOrder(hit, hit, this.targetingMode, effectiveShift, false, false);
          this.setTargetingMode('NONE');
        }
        return true;
      }
    }

    if (e.button === 0 && !e.altKey) {
      e.preventDefault();
      this.isLeftDragging = true;
      this.leftDownX = e.clientX;
      this.leftDownY = e.clientY;
      return true;
    }

    if (e.button === 2) {
      if (this.targetingMode === 'SPELL_TARGET') {
        e.preventDefault();
        this.setTargetingMode('NONE');
        return true;
      }
      if (this.selectedCompanyIds.size === 0) return false;
      const hit = this.worldPicker.raycastTerrain(e);
      if (!hit) return false;
      this.isRightDragging = true;
      this.dragPreserveRelative = Boolean(e.altKey);
      this.dragStartWorld = hit.clone();
      this._rightDownClick = { x: e.clientX, y: e.clientY };
      this.dragCurrentWorld = hit.clone();
      this._update3DGhostPreview();
      return true;
    }

    return false;
  },

  onMouseMove(e) {
    this._lastMouseEvent = e;
    let consumed = false;

    if (this.targetingMode === 'SPELL_TARGET' && this.pendingHeroSpell) {
      const pending = this.pendingHeroSpell;
      if (pending.targetMode === "unit" || pending.targetMode === "unit_or_building") {
        // Unit/Building Target Mode: ONLY target reticle cursor (no 3D ground circle, no range ring!)
        this.spellTargetRingMesh.visible = false;
        this.spellTargetFillMesh.visible = false;
        this.spellLinePlaceholderMesh.visible = false;
      } else {
        // Ground Area / Shape Mode (`targetMode === "ground"`): ONLY the 3D ground circle/shape on the terrain (never snaps to units)
        const hit = this.worldPicker.raycastTerrain(e);
        if (hit) {
          const tx = hit.x;
          const tz = hit.z;
          const rad = Math.max(2.0, Number(pending.radiusMeters) || 7.5);

          if (pending.targetShape === "line") {
            // Anchor vertex v=0 at Sisnat's exact world position (hx, hz), extending straight toward the cursor (tx, tz)!
            const heroPos = this._getHeroAnchorWorldPos(pending.companyId, tx, tz);
            const len = Number(pending.rangeMeters) || 22;
            const width = Number(pending.lineWidthMeters) || 4.4;
            this._conformLineSpellFromHero(this.spellLinePlaceholderMesh, heroPos.x, heroPos.z, tx, tz, width, len, 0.28);
            this.spellLinePlaceholderMesh.visible = true;
            this.spellTargetRingMesh.visible = false;
            this.spellTargetFillMesh.visible = false;
          } else {
            this.spellLinePlaceholderMesh.visible = false;
            this.spellTargetRingMat.color.setHex(0x38bdf8);
            this.spellTargetFillMat.color.setHex(0x38bdf8);
            this._conformGroundSpellMesh(this.spellTargetRingMesh, tx, tz, rad, rad, 0, 0.28);
            this.spellTargetRingMesh.visible = true;
            this._conformGroundSpellMesh(this.spellTargetFillMesh, tx, tz, rad, rad, 0, 0.25);
            this.spellTargetFillMesh.visible = true;
          }
        } else {
          this.spellTargetRingMesh.visible = false;
          this.spellTargetFillMesh.visible = false;
          this.spellLinePlaceholderMesh.visible = false;
        }
      }
    } else if (this.spellTargetRingMesh?.visible || this.spellLinePlaceholderMesh?.visible) {
      this.spellTargetRingMesh.visible = false;
      this.spellTargetFillMesh.visible = false;
      this.spellLinePlaceholderMesh.visible = false;
    }

    if (this.isLeftDragging) {
      const dx = Math.abs(e.clientX - this.leftDownX);
      const dy = Math.abs(e.clientY - this.leftDownY);
      if (dx > 6 || dy > 6) {
        this.selection.showMarqueeRect(this.leftDownX, this.leftDownY, e.clientX, e.clientY);
      }
      consumed = true;
    }

    if (this.isRightDragging && this.selectedCompanyIds.size > 0) {
      this.dragPreserveRelative = Boolean(e.altKey);
      const hit = this.worldPicker.raycastTerrain(e);
      if (hit) {
        this.dragCurrentWorld.copy(hit);
        this._update3DGhostPreview();
      }
      consumed = true;
    }

    this.syncCursorState(e);
    return consumed;
  },

  onMouseUp(e) {
    if (e.button === 0 && this.isLeftDragging) {
      this.isLeftDragging = false;
      this.selection.hideMarquee();
      const dx = Math.abs(e.clientX - this.leftDownX);
      const dy = Math.abs(e.clientY - this.leftDownY);
      if (dx > 6 || dy > 6) {
        this.selection.selectCompaniesInMarquee(
          Math.min(this.leftDownX, e.clientX),
          Math.min(this.leftDownY, e.clientY),
          Math.max(this.leftDownX, e.clientX),
          Math.max(this.leftDownY, e.clientY),
          e.shiftKey
        );
      } else if (e.ctrlKey || e.metaKey) {
        const hadSelection = this.selection.selectAllOfSameUnitType(
          e.clientX,
          e.clientY,
          e.shiftKey
        );
        if (!hadSelection && !e.shiftKey) {
          this.orderQueue.clearStagedPatrol();
          this.setTargetingMode('NONE');
        }
      } else {
        const hadSelection = this.selection.selectCompanyByClick(
          e.clientX,
          e.clientY,
          e.shiftKey
        );
        if (!hadSelection) {
          this.orderQueue.clearStagedPatrol();
          this.setTargetingMode('NONE');
        }
      }
      this._refreshRadialPanelUI();
      this.syncCursorState(e);
      return true;
    }

    if (e.button === 2 && this.isRightDragging) {
      const preserveRelative = Boolean(e.altKey || this.dragPreserveRelative);
      this.isRightDragging = false;
      this.dragPreserveRelative = false;
      this.ghostPreview.triggerCommitFlash();
      if (this.selectedCompanyIds.size === 0) return true;

      const now = performance.now();
      const isDoubleRightClick = now - this._lastRightClickTime <= 340;
      this._lastRightClickTime = now;

      const hit = this.worldPicker.raycastTerrain(e) || this.dragCurrentWorld;
      if (hit && this.dragStartWorld) {
        const activeOrderMode =
          this.targetingMode !== 'NONE' && this.targetingMode !== 'SPELL_TARGET'
            ? this.targetingMode
            : 'MOVE';
        const effectiveShift = Boolean(e.shiftKey);

        if (activeOrderMode === 'PATROL' && effectiveShift) {
          this._stageShiftPatrolPoint(this.dragStartWorld);
        } else {
          this._orderClick = this._rightDownClick || null;
          const screenDragPx =
            this._rightDownClick && e
              ? Math.hypot(e.clientX - this._rightDownClick.x, e.clientY - this._rightDownClick.y)
              : 0;
          const worldDragDist = this.dragStartWorld.distanceTo(hit);
          const effectiveEndPoint =
            screenDragPx >= 26 && worldDragDist >= 5.2 ? hit : this.dragStartWorld;
          this._commitRightClickDragOrder(
            this.dragStartWorld,
            effectiveEndPoint,
            activeOrderMode,
            effectiveShift,
            isDoubleRightClick,
            preserveRelative
          );
          if (this.targetingMode !== 'NONE') {
            this.setTargetingMode('NONE');
          }
        }
      }
      return true;
    }

    return false;
  },

  onDblClick(e) {
    if (e.button !== 0) return false;
    if (this.selection.selectAllOfSameUnitType(e.clientX, e.clientY, e.shiftKey)) {
      this._refreshRadialPanelUI();
      this.syncCursorState(e);
      return true;
    }
    return false;
  },

  _update3DGhostPreview() {
    if (!this.dragStartWorld || !this.dragCurrentWorld || this.selectedCompanyIds.size === 0) {
      this.ghostPreview.hide();
      return;
    }
    const descriptors = this._buildEnrichedSelectedDescriptors();
    this.ghostPreview.update(
      this.dragStartWorld,
      this.dragCurrentWorld,
      descriptors,
      this.dragPreserveRelative
    );
  },

  _commitRightClickDragOrder(
    startPoint,
    endPoint,
    orderMode = 'MOVE',
    queueShift = false,
    isDoubleRightClick = false,
    preserveRelative = false
  ) {
    const descriptors = this._buildEnrichedSelectedDescriptors();
    if (descriptors.length === 0) return;

    const companyIds = descriptors.map((d) => d.companyId);

    const click = this._orderClick;
    this._orderClick = null;
    const enemyEnt =
      (click && this.worldPicker.findEnemyUnitOnScreen(click.x, click.y, 36)) ||
      this.worldPicker.findEnemyEntityNearWorldPoint(startPoint.x, startPoint.z, 1.8);
    let clickedEnemyCompanyId = enemyEnt ? (enemyEnt.companyId ?? 0) : null;
    let clickedEnemyBuildingId = -1;
    let isEnemyTarget = Boolean(enemyEnt);

    const ecoStatesForClick = this.simBridge.getEconomyState?.()?.companyStates || {};
    const clickedBld = !isEnemyTarget
      ? this.worldPicker.findBuildingNear(startPoint.x, startPoint.z, 2.6)
      : null;

    if (clickedBld && clickedBld.type !== 'citadel_slot' && (clickedBld.hp ?? 1) > 0) {
      if (clickedBld.team !== 1) {
        isEnemyTarget = true;
        clickedEnemyBuildingId = clickedBld.id | 0;
        this.onFlashBuilding?.(clickedBld.id, 'attack');
      } else if (clickedBld.isCompleted) {
        let isMeaningfulFriendlyBuildingClick = false;

        if (
          clickedBld.type === 'archery_range' ||
          clickedBld.type === 'blacksmith' ||
          clickedBld.type === 'citadel'
        ) {
          isMeaningfulFriendlyBuildingClick = descriptors.some((d) => {
            const st = ecoStatesForClick[d.companyId];
            return d.unitType === 'archer' || Boolean(st && (st.maxAmmo | 0) > 0);
          });
        } else if (clickedBld.type === 'infirmary') {
          isMeaningfulFriendlyBuildingClick = descriptors.some((d) => d.unitType !== 'worker');
        } else if (clickedBld.type === 'watchtower') {
          isMeaningfulFriendlyBuildingClick = true;
        }

        if (isMeaningfulFriendlyBuildingClick) {
          this.onFlashBuilding?.(clickedBld.id, 'command');
        }
      }
    }

    const effectiveOrderMode = isEnemyTarget ? 'ATTACK_MOVE' : orderMode;
    const rawWantsRun = Boolean(
      isDoubleRightClick ||
        companyIds.every((cid) => this.selection.companyGaitRun.get(cid))
    );

    const anyRunLocked = companyIds.some((cid) => {
      const form =
        ecoStatesForClick[cid]?.formation || this.selection.companyFormations.get(cid);
      return (
        form === FormationTypes.SPEAR_WALL ||
        form === FormationTypes.SHIELD_WALL ||
        form === FormationTypes.PIKE_PHALANX
      );
    });

    const isRunning = Boolean(rawWantsRun && !anyRunLocked);
    for (const cid of companyIds) {
      this.selection.companyGaitRun.set(cid, isRunning);
    }

    this.spawnEphemeralClickMarker(startPoint, effectiveOrderMode, 1.35);
    if (this.synthAudio) this.synthAudio.playHornAlert();

    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
    const buildings = this.simBridge.getInterpolatedBuildings?.() || [];

    const layoutDescriptors = descriptors.map((d) => {
      if (queueShift) {
        const existingQ = this.orderQueue.companyVisualQueues.get(d.companyId);
        if (
          existingQ &&
          existingQ.length > 0 &&
          !existingQ.some((w) => w.orderType === 'PATROL')
        ) {
          const lastWp = existingQ[existingQ.length - 1];
          return {
            ...d,
            anchorXFx: toFx(lastWp.x),
            anchorZFx: toFx(lastWp.z),
            centerX: lastWp.x,
            centerZ: lastWp.z
          };
        }
        const retId = ecoStates[d.companyId]?.returningDropoffBuildingId ?? -1;
        if (retId > 0) {
          const dropBld = buildings.find((b) => b.id === retId);
          if (dropBld) {
            return {
              ...d,
              anchorXFx: toFx(dropBld.x),
              anchorZFx: toFx(dropBld.z),
              centerX: dropBld.x,
              centerZ: dropBld.z
            };
          }
        }
      }
      return d;
    });

    const layout = computeArmyDragLayoutFx(
      layoutDescriptors,
      { xFx: toFx(startPoint.x), zFx: toFx(startPoint.z) },
      { xFx: toFx(endPoint.x), zFx: toFx(endPoint.z) },
      null,
      { preserveRelative }
    );

    for (let i = 0; i < layout.placements.length; i++) {
      const pl = layout.placements[i];
      if (layout.isDragGesture && pl.customWidthFx > 0) {
        this.selection.companyCustomWidths.set(pl.companyId, pl.customWidthFx);
      }
    }

    this.orderQueue.enqueuePlacementOrders(
      layout.placements,
      descriptors,
      effectiveOrderMode,
      clickedEnemyCompanyId,
      queueShift
    );

    const payload = {
      team: 1,
      companyIds,
      dragStartXFx: toFx(startPoint.x),
      dragStartZFx: toFx(startPoint.z),
      dragEndXFx: toFx(endPoint.x),
      dragEndZFx: toFx(endPoint.z),
      targetEnemyCompanyId:
        clickedEnemyCompanyId !== null && clickedEnemyCompanyId !== undefined
          ? clickedEnemyCompanyId | 0
          : -1,
      targetEnemyBuildingId: clickedEnemyBuildingId | 0,
      queue: Boolean(queueShift),
      isRunning,
      preserveRelative: Boolean(preserveRelative),
      label: `${effectiveOrderMode} (${Math.round(startPoint.x)}m, ${Math.round(startPoint.z)}m)`
    };

    if (effectiveOrderMode === 'PATROL') {
      this.commandBus.issue(CommandTypes.PATROL_COMPANIES, payload);
    } else if (effectiveOrderMode === 'ATTACK_MOVE') {
      this.commandBus.issue(CommandTypes.ATTACK_MOVE_COMPANIES, payload);
    } else {
      this.commandBus.issue(CommandTypes.MOVE_COMPANIES, payload);
    }

    this._refreshRadialPanelUI();
  },

  update(dtSeconds, nowMs = performance.now()) {
    this.orderLineRenderer.updateEphemeralMarkers(dtSeconds);
    this.ghostPreview.stepFlash(dtSeconds);

    const friendly = this.selection.gatherFriendlyCompanies();
    const { entities } = this.simBridge.getInterpolatedState(nowMs);
    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
    const buildings = this.simBridge.getInterpolatedBuildings?.() || [];

    const segments = this.orderQueue.syncAndBuildSegments({
      selectedCompanyIds: this.selectedCompanyIds,
      friendlyMap: friendly,
      entities,
      ecoStates,
      buildings,
      nowMs
    });

    // Never show a cast range ring around the Hero while aiming a unit or ground spell (only around-Hero spells show radius)
    if (this.spellCastRangeRingMesh?.visible) {
      this.spellCastRangeRingMesh.visible = false;
    }

    if (this.hoveredHeroSpell) {
      const heroComp = friendly.get(this.hoveredHeroSpell.companyId);
      const rad = Number(this.hoveredHeroSpell.radiusMeters) || 0;
      if (heroComp && rad > 0) {
        this._conformGroundSpellMesh(this.heroHoverRadiusRingMesh, heroComp.centerX, heroComp.centerZ, rad, rad, 0, 0.28);
        this.heroHoverRadiusRingMesh.visible = true;
      } else {
        this.heroHoverRadiusRingMesh.visible = false;
      }
    } else if (this.heroHoverRadiusRingMesh?.visible) {
      this.heroHoverRadiusRingMesh.visible = false;
    }

    this.orderLineRenderer.renderSegments(segments);
    this._refreshRadialPanelUI(friendly);
  },
};
