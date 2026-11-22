import { resolveUnitActiveCapabilities } from '../../sim/combatCapabilitiesRegistry.js';
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

export class FormationPreview3D {
  constructor({
    scene,
    camera,
    domElement,
    container,
    simBridge,
    commandBus,
    eventBus,
    terrainRenderer,
    onFlashBuilding,
    synthAudio
  }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.container = container;
    this.simBridge = simBridge;
    this.commandBus = commandBus;
    this.eventBus = eventBus || simBridge?.eventBus || null;
    this.terrainRenderer = terrainRenderer;
    this.onFlashBuilding = onFlashBuilding || null;
    this.synthAudio = synthAudio;

    this.worldPicker = new WorldPicker({
      scene,
      camera,
      domElement,
      simBridge,
      terrainRenderer
    });

    this.selection = new UnitSelectionController({
      domElement,
      camera,
      simBridge,
      eventBus: this.eventBus,
      worldPicker: this.worldPicker
    });

    this.cursorManager = new RtsCursorManager({
      domElement,
      container,
      worldPicker: this.worldPicker,
      simBridge
    });
    this._lastMouseEvent = null;
    this.workerPlacementRef = null;
    this.buildingRadialMenuRef = null;

    this.orderLineRenderer = new OrderLineRenderer(scene);
    this.orderQueue = new OrderQueueEngine();
    this.ghostPreview = new FormationGhostPreview(scene, (x, z) =>
      this.orderLineRenderer.sampleExactGroundY(x, z)
    );

    // 1. 3D Ground AoE / Target Circle + Inner Translucent Fill for Placed Circle Spells & Unit Reticles
    //    Uses terrain-conforming vertex heights + depthTest: false so it NEVER sinks into hills or mountains!
    this.spellTargetRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false
    });
    const ringGeom = new THREE.RingGeometry(0.92, 1.0, 64, 2);
    ringGeom.rotateX(-Math.PI * 0.5);
    ringGeom.userData.baseXZ = Float32Array.from(ringGeom.attributes.position.array);
    this.spellTargetRingMesh = new THREE.Mesh(ringGeom, this.spellTargetRingMat);
    this.spellTargetRingMesh.renderOrder = 995;
    this.spellTargetRingMesh.visible = false;
    this.spellTargetRingMesh.frustumCulled = false;
    this.scene.add(this.spellTargetRingMesh);

    this.spellTargetFillMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.24,
      depthTest: false,
      depthWrite: false
    });
    const fillGeom = new THREE.CircleGeometry(0.92, 64);
    fillGeom.rotateX(-Math.PI * 0.5);
    fillGeom.userData.baseXZ = Float32Array.from(fillGeom.attributes.position.array);
    this.spellTargetFillMesh = new THREE.Mesh(fillGeom, this.spellTargetFillMat);
    this.spellTargetFillMesh.renderOrder = 994;
    this.spellTargetFillMesh.visible = false;
    this.spellTargetFillMesh.frustumCulled = false;
    this.scene.add(this.spellTargetFillMesh);

    // 2. 3D Directional Line / Strip Placeholder for Line Spells (Sisnat Unstoppable Charge anchored at Hero!)
    this.spellLinePlaceholderMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.48,
      depthTest: false,
      depthWrite: false
    });
    const lineGeom = new THREE.PlaneGeometry(1, 1, 4, 24);
    lineGeom.rotateX(-Math.PI * 0.5);
    lineGeom.userData.baseXZ = Float32Array.from(lineGeom.attributes.position.array);
    this.spellLinePlaceholderMesh = new THREE.Mesh(lineGeom, this.spellLinePlaceholderMat);
    this.spellLinePlaceholderMesh.renderOrder = 995;
    this.spellLinePlaceholderMesh.visible = false;
    this.spellLinePlaceholderMesh.frustumCulled = false;
    this.scene.add(this.spellLinePlaceholderMesh);

    // 3. 3D Hero Cast Range Ring (shown around the Hero while aiming a ground/unit spell)
    this.spellCastRangeRingMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false
    });
    this.spellCastRangeRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1.0, 64),
      this.spellCastRangeRingMat
    );
    this.spellCastRangeRingMesh.rotation.x = -Math.PI * 0.5;
    this.spellCastRangeRingMesh.visible = false;
    this.spellCastRangeRingMesh.frustumCulled = false;
    this.scene.add(this.spellCastRangeRingMesh);

    // 4. 3D Hover Effect Radius Ring around the Hero (shown when hovering over a spell on the Tactical Orb!)
    this.heroHoverRadiusRingMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
      depthWrite: false
    });
    const hoverRingGeom = new THREE.RingGeometry(0.96, 1.0, 64);
    hoverRingGeom.rotateX(-Math.PI * 0.5);
    hoverRingGeom.userData.baseXZ = Float32Array.from(hoverRingGeom.attributes.position.array);
    this.heroHoverRadiusRingMesh = new THREE.Mesh(hoverRingGeom, this.heroHoverRadiusRingMat);
    this.heroHoverRadiusRingMesh.renderOrder = 995;
    this.heroHoverRadiusRingMesh.visible = false;
    this.heroHoverRadiusRingMesh.frustumCulled = false;
    this.scene.add(this.heroHoverRadiusRingMesh);

    this.pendingHeroSpell = null;
    this.hoveredHeroSpell = null;

    this.tacticalOrb = new UnitTacticalOrb({
      onToggleGait: () => this.toggleSelectedGait(),
      onCycleFormation: () => this.cycleSelectedFormation(),
      onToggleFireMode: () => this.toggleSelectedFireMode(),
      onSwitchHeroWeapon: (companyId) => {
        const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
        if (ecoStates[companyId]?.isHero) {
          this.commandBus?.issue?.(CommandTypes.SWITCH_HERO_WEAPON, {
            team: 1,
            companyId
          });
        } else {
          const ids = this.selectedCompanyIds.size > 0 ? Array.from(this.selectedCompanyIds) : [companyId];
          this.commandBus?.issue?.(CommandTypes.SWITCH_COMPANY_WEAPON, {
            team: 1,
            companyIds: ids
          });
        }
        this.synthAudio?.playFocusWhoosh?.();
      },
      onHoverHeroSpell: (companyId, spellObj) => {
        if (!spellObj || companyId === null || companyId === undefined) {
          this.hoveredHeroSpell = null;
          if (this.heroHoverRadiusRingMesh) this.heroHoverRadiusRingMesh.visible = false;
          return;
        }
        const tMode = spellObj.targetMode || "self";
        // Strictly show radius around the Hero ONLY for around-Hero spells (`self_aoe` / `aura`)!
        if (tMode === "self_aoe" || tMode === "aura") {
          const rad = Number(spellObj.radiusMeters) || 18;
          this.hoveredHeroSpell = {
            companyId,
            targetMode: tMode,
            radiusMeters: rad
          };
          const sid = spellObj.spellId || "";
          const hoverHex =
            sid === "heal" || sid === "self_heal"
              ? 0x2dd4bf
              : sid === "iron_blood" || sid === "iron_skin"
                ? 0x94a3b8
                : 0xd97706;
          this.heroHoverRadiusRingMat.color.setHex(hoverHex);
        } else {
          this.hoveredHeroSpell = null;
          if (this.heroHoverRadiusRingMesh) this.heroHoverRadiusRingMesh.visible = false;
        }
      },
      onCastHeroSpell: (companyId, spellObjOrId, slotIndex) => {
        const spellObj =
          typeof spellObjOrId === "object" && spellObjOrId !== null
            ? spellObjOrId
            : { spellId: spellObjOrId, targetMode: "self" };
        const tMode = spellObj.targetMode || "self";

        if (tMode === "ground" || tMode === "unit" || tMode === "unit_or_building") {
          // Toggle off if clicking the same spell slot while already targeting
          if (
            this.targetingMode === "SPELL_TARGET" &&
            this.pendingHeroSpell?.slotIndex === slotIndex
          ) {
            this._hideAllSpellTargetPreviews();
            this.setTargetingMode("NONE");
            return;
          }
          const isUnitLock = tMode === "unit" || tMode === "unit_or_building";
          let effRadiusMeters = Number(spellObj.radiusMeters) || (isUnitLock ? 2.8 : 8.5);
          if (spellObj.spellId === "summon_royal_guard") {
            const st = spellObj.stats || {};
            const totalSquads =
              (Number(st.swordsmanSquads) || 0) +
              (Number(st.spearmanSquads) || 0) +
              (Number(st.archerSquads) || 0) +
              (Number(st.cavalrySquads) || 0);
            if (totalSquads > 0) {
              effRadiusMeters = totalSquads <= 2 ? 9.5 : totalSquads <= 4 ? 13.5 : totalSquads === 5 ? 15.5 : 19.5;
            }
          }
          this.pendingHeroSpell = {
            companyId,
            spellId: spellObj.spellId,
            slotIndex,
            targetMode: tMode,
            targetShape: spellObj.targetShape || "circle",
            lineWidthMeters: spellObj.lineWidthMeters || 5.5,
            radiusMeters: effRadiusMeters,
            rangeMeters: spellObj.rangeMeters || 28
          };
          const hexCol = isUnitLock ? 0xf43f5e : spellObj.targetShape === "line" ? 0xf59e0b : 0x38bdf8;
          this.spellTargetRingMat.color.setHex(hexCol);
          this.spellTargetFillMat.color.setHex(hexCol);
          this.setTargetingMode("SPELL_TARGET");
          return;
        }

        // Instant self / self_aoe activation around or on the Hero — cancel previous visual movement/patrol queues!
        this._hideAllSpellTargetPreviews();
        if (this.targetingMode === "SPELL_TARGET" || this.targetingMode === "PATROL" || this.targetingMode === "ATTACK_MOVE") {
          this.setTargetingMode("NONE");
        }
        this.orderQueue?.clearStagedPatrol?.();
        this.orderQueue?.companyVisualQueues?.delete?.(companyId | 0);
        this.commandBus?.issue?.(CommandTypes.CAST_HERO_SPELL, {
          team: 1,
          companyId,
          spellId: spellObj.spellId,
          slotIndex
        });
        this.synthAudio?.playFocusWhoosh?.();
      },
      onLevelUpHeroCheat: (companyId) => {
        this.commandBus?.issue?.(CommandTypes.LEVEL_UP_HERO_CHEAT, {
          team: 1,
          companyId
        });
        this.synthAudio?.playHornAlert?.();
      },
      onClickAttackMove: () => {
        this._targetingModeShiftSticky = false;
        this.pendingHeroSpell = null;
        this.spellTargetRingMesh.visible = false;
        this.setTargetingMode(this.targetingMode === 'ATTACK_MOVE' ? 'NONE' : 'ATTACK_MOVE');
      },
      onClickPatrol: () => {
        this._targetingModeShiftSticky = false;
        this.pendingHeroSpell = null;
        this.spellTargetRingMesh.visible = false;
        if (this.targetingMode === 'PATROL' && this.orderQueue.hasStagedPatrol()) {
          this._commitStagedPatrolRoute();
        } else {
          this.orderQueue.clearStagedPatrol();
          this.setTargetingMode(this.targetingMode === 'PATROL' ? 'NONE' : 'PATROL');
        }
      }
    });

    this.targetingMode = 'NONE';
    this._targetingModeShiftSticky = false;
    this._lastRightClickTime = 0;
    this._lastFormationToggleTime = 0;

    this.isLeftDragging = false;
    this.leftDownX = 0;
    this.leftDownY = 0;

    this.isRightDragging = false;
    this.dragPreserveRelative = false;
    this.dragStartWorld = null;
    this.dragCurrentWorld = null;

    this.selection.emitSelectionChanged();
    this._refreshRadialPanelUI();
  }

  get selectedCompanyIds() {
    return this.selection.selectedCompanyIds;
  }

  get companyVisualQueues() {
    return this.orderQueue.companyVisualQueues;
  }

  onWindowBlur() {
    this.isLeftDragging = false;
    this.selection.hideMarquee();
    this.cancelRightDrag();
    this._targetingModeShiftSticky = false;
  }

  isCompanySelected(companyId) {
    return this.selection.isCompanySelected(companyId);
  }

  isCompanyHovered(companyId) {
    return (
      this.cursorManager?.hoveredFriendlyCompanyId !== null &&
      this.cursorManager?.hoveredFriendlyCompanyId !== undefined &&
      (this.cursorManager.hoveredFriendlyCompanyId | 0) === (companyId | 0)
    );
  }

  isEnemyCompanyHovered(companyId) {
    return (
      this.cursorManager?.hoveredEnemyCompanyId !== null &&
      this.cursorManager?.hoveredEnemyCompanyId !== undefined &&
      (this.cursorManager.hoveredEnemyCompanyId | 0) === (companyId | 0)
    );
  }

  _isActivelyStretchingFormation(e = this._lastMouseEvent) {
    if (!this.isRightDragging || !this.dragStartWorld || !this.dragCurrentWorld) return false;
    const worldDist = this.dragStartWorld.distanceTo(this.dragCurrentWorld);
    if (worldDist < 5.2) return false;
    if (this._rightDownClick && e) {
      const pxDist = Math.hypot(e.clientX - this._rightDownClick.x, e.clientY - this._rightDownClick.y);
      if (pxDist < 26) return false;
    }
    return true;
  }

  syncCursorState(e = this._lastMouseEvent) {
    if (e) this._lastMouseEvent = e;
    const effectiveTargetingCursorMode =
      this.targetingMode === 'SPELL_TARGET' && this.pendingHeroSpell
        ? this.pendingHeroSpell.targetMode === 'ground'
          ? 'SPELL_GROUND'
          : 'SPELL_UNIT'
        : this.targetingMode;
    this.cursorManager?.updateFromMouseEvent(this._lastMouseEvent, {
      selectedCompanyIds: this.selectedCompanyIds,
      selectionController: this.selection,
      targetingMode: effectiveTargetingCursorMode,
      spellTargetMode: this.pendingHeroSpell?.targetMode || null,
      isActivelyStretchingFormation: this._isActivelyStretchingFormation(this._lastMouseEvent),
      isLeftMarqueeDragging:
        this.isLeftDragging &&
        Boolean(
          this._lastMouseEvent &&
            (Math.abs(this._lastMouseEvent.clientX - this.leftDownX) > 6 ||
              Math.abs(this._lastMouseEvent.clientY - this.leftDownY) > 6)
        ),
      activePlacementType: this.workerPlacementRef?.activePlacementType || null,
      isPlacementValid: Boolean(this.workerPlacementRef?.isCurrentPlacementValid),
      selectedBuildings: this.buildingRadialMenuRef?.getSelectedBuildings?.() || []
    });
  }

  getSelectedWorkerCompanyIds() {
    return this.selection.getSelectedWorkerCompanyIds();
  }

  _hideAllSpellTargetPreviews() {
    this.pendingHeroSpell = null;
    if (this.spellTargetRingMesh) this.spellTargetRingMesh.visible = false;
    if (this.spellTargetFillMesh) this.spellTargetFillMesh.visible = false;
    if (this.spellLinePlaceholderMesh) this.spellLinePlaceholderMesh.visible = false;
    if (this.spellCastRangeRingMesh) this.spellCastRangeRingMesh.visible = false;
  }

  clearSelection() {
    if (this.selection.selectedCompanyIds.size === 0) return;
    this.selection.selectedCompanyIds.clear();
    this.orderQueue.clearStagedPatrol();
    this._hideAllSpellTargetPreviews();
    this.hoveredHeroSpell = null;
    if (this.heroHoverRadiusRingMesh) this.heroHoverRadiusRingMesh.visible = false;
    this.setTargetingMode('NONE');
    this.selection.emitSelectionChanged();
    this._refreshRadialPanelUI();
  }

  cancelRightDrag() {
    this.isRightDragging = false;
    this.dragPreserveRelative = false;
    this.dragStartWorld = null;
    this.dragCurrentWorld = null;
    this.ghostPreview.hide();
  }

  spawnEphemeralClickMarker(worldPoint, orderType = 'MOVE', radiusScale = 1.0) {
    this.orderLineRenderer.spawnEphemeralClickMarker(worldPoint, orderType, radiusScale);
  }

  /**
   * Issues a Move / Attack-Move / Patrol order originating from a click on the Minimap,
   * recording waypoints in `orderQueue` so Shift-queued dashed path lines (`הקו המקווקו`) render in 3D!
   */
  issueMinimapOrderAtWorld(wx, wz, mouseEvent = null, explicitMode = null) {
    if (this.selectedCompanyIds.size === 0) return false;
    const wy = this.orderLineRenderer.sampleExactGroundY(wx, wz);
    const pt = new THREE.Vector3(wx, wy, wz);
    const activeOrderMode =
      explicitMode ||
      (this.targetingMode !== 'NONE' && this.targetingMode !== 'SPELL_TARGET'
        ? this.targetingMode
        : 'MOVE');
    const effectiveShift = Boolean(mouseEvent?.shiftKey);

    if (activeOrderMode === 'PATROL' && effectiveShift) {
      this._stageShiftPatrolPoint(pt);
      return true;
    }

    const now = performance.now();
    const isDoubleRightClick = now - (this._lastRightClickTime || 0) <= 340;
    this._lastRightClickTime = now;
    this._orderClick = null;

    this._commitRightClickDragOrder(
      pt,
      pt,
      activeOrderMode,
      effectiveShift,
      Boolean(isDoubleRightClick || mouseEvent?.ctrlKey),
      Boolean(mouseEvent?.altKey)
    );

    if (this.targetingMode !== 'NONE') {
      this.setTargetingMode('NONE');
    }
    return true;
  }

  /**
   * Commits a targeted Hero spell (`targetMode === 'ground' | 'unit'`) at world coordinates `(wx, wz)`.
   * Can be invoked from either a 3D terrain click or a Minimap click!
   */
  _getHeroAnchorWorldPos(companyId, fallbackX = 0, fallbackZ = 0) {
    const interp = this.simBridge.getInterpolatedState?.();
    if (interp && Array.isArray(interp.entities)) {
      for (let i = 0; i < interp.entities.length; i++) {
        const e = interp.entities[i];
        if (e && (e.companyId | 0) === (companyId | 0) && e.hp > 0) {
          return { x: e.x, z: e.z };
        }
      }
    }
    const eco = this.simBridge.getEconomyState?.()?.companyStates?.[companyId];
    if (eco && typeof eco.anchorXFx === "number") {
      return { x: eco.anchorXFx / 1024, z: eco.anchorZFx / 1024 };
    }
    return { x: fallbackX, z: fallbackZ };
  }

  _conformGroundSpellMesh(mesh, centerX, centerZ, scaleX, scaleZ, yawRad = 0, heightOffset = 0.28) {
    const geom = mesh?.geometry;
    const baseXZ = geom?.userData?.baseXZ;
    if (!geom || !baseXZ) return;
    const pos = geom.attributes.position;
    const cosY = Math.cos(yawRad);
    const sinY = Math.sin(yawRad);
    for (let i = 0; i < pos.count; i++) {
      const idx = i * 3;
      const lx = baseXZ[idx] * scaleX;
      const lz = baseXZ[idx + 2] * scaleZ;
      const wx = centerX + lx * cosY + lz * sinY;
      const wz = centerZ - lx * sinY + lz * cosY;
      const wy = this.orderLineRenderer.sampleExactGroundY(wx, wz) + heightOffset;
      pos.setXYZ(i, wx, wy, wz);
    }
    pos.needsUpdate = true;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
  }

  _conformLineSpellFromHero(mesh, hx, hz, tx, tz, width, len, heightOffset = 0.28) {
    const geom = mesh?.geometry;
    const baseXZ = geom?.userData?.baseXZ;
    if (!geom || !baseXZ) return;
    let dx = tx - hx;
    let dz = tz - hz;
    const dist = Math.hypot(dx, dz);
    const fx = dist > 0.05 ? dx / dist : 0;
    const fz = dist > 0.05 ? dz / dist : 1;
    // Perpendicular right vector
    const rx = fz;
    const rz = -fx;
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const idx = i * 3;
      const u = baseXZ[idx]; // [-0.5 .. 0.5] across width
      const v = baseXZ[idx + 2] + 0.5; // [0 .. 1] from Hero (0) to end of line (1)
      const wx = hx + fx * (v * len) + rx * (u * width);
      const wz = hz + fz * (v * len) + rz * (u * width);
      const wy = this.orderLineRenderer.sampleExactGroundY(wx, wz) + heightOffset;
      pos.setXYZ(i, wx, wy, wz);
    }
    pos.needsUpdate = true;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
  }

  commitPendingSpellAtWorld(wx, wz, mouseEvent = null) {
    const pending = this.pendingHeroSpell;
    if (!pending) {
      this.setTargetingMode('NONE');
      return false;
    }

    let targetEntityId = -1;
    let targetBuildingId = -1;
    let finalX = wx;
    let finalZ = wz;

    if (pending.targetMode === "ground" && pending.targetShape === "line") {
      const heroPos = this._getHeroAnchorWorldPos(pending.companyId, wx, wz);
      let dx = wx - heroPos.x;
      let dz = wz - heroPos.z;
      if (Math.hypot(dx, dz) < 0.25) {
        dx = 0;
        dz = 1;
      }
      const yaw = Math.atan2(dx, dz);
      const len = Number(pending.rangeMeters) || 22;
      finalX = heroPos.x + Math.sin(yaw) * len;
      finalZ = heroPos.z + Math.cos(yaw) * len;
    }

    if (pending.targetMode === "unit" || pending.targetMode === "unit_or_building") {
      const enemyEnt =
        (mouseEvent && this.worldPicker.findEnemyUnitOnScreen(mouseEvent.clientX, mouseEvent.clientY, 48)) ||
        this.worldPicker.findEnemyEntityNearWorldPoint(wx, wz, 6.0);
      if (enemyEnt) {
        targetEntityId = enemyEnt.id | 0;
        finalX = enemyEnt.x;
        finalZ = enemyEnt.z;
      } else if (pending.targetMode === "unit_or_building") {
        const bld = this.worldPicker.findBuildingNear(wx, wz, 3.8);
        if (bld && bld.team !== 1 && bld.type !== "citadel_slot" && (bld.hp ?? 1) > 0) {
          targetBuildingId = bld.id | 0;
          finalX = bld.x;
          finalZ = bld.z;
        }
      }
      // Clicking on an invalid object or on empty ground immediately cancels/exits spell targeting mode!
      if (targetEntityId <= 0 && targetBuildingId <= 0) {
        this._hideAllSpellTargetPreviews();
        this.setTargetingMode('NONE');
        return false;
      }
    }

    // Casting a targeted spell cancels any previous Move / Patrol / Attack-Move visual order queue for this Hero!
    this.orderQueue?.clearStagedPatrol?.();
    this.orderQueue?.companyVisualQueues?.delete?.(pending.companyId | 0);

    this.commandBus?.issue?.(CommandTypes.CAST_HERO_SPELL, {
      team: 1,
      companyId: pending.companyId,
      spellId: pending.spellId,
      slotIndex: pending.slotIndex,
      targetXFx: toFx(finalX),
      targetZFx: toFx(finalZ),
      targetEntityId,
      targetBuildingId
    });

    const wy = this.orderLineRenderer.sampleExactGroundY(finalX, finalZ);
    this.spawnEphemeralClickMarker(
      new THREE.Vector3(finalX, wy, finalZ),
      'ATTACK_MOVE',
      1.45
    );
    this.synthAudio?.playFocusWhoosh?.();

    this._hideAllSpellTargetPreviews();
    this.setTargetingMode('NONE');
    return true;
  }

  _buildEnrichedSelectedDescriptors() {
    const raw = this.selection.buildSelectedCompanyDescriptors();
    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};

    for (let i = 0; i < raw.length; i++) {
      const d = raw[i];
      const st = ecoStates[d.companyId];
      if (st) {
        if (typeof st.anchorXFx === 'number') d.anchorXFx = st.anchorXFx | 0;
        if (typeof st.anchorZFx === 'number') d.anchorZFx = st.anchorZFx | 0;
        if (typeof st.facingDir === 'number') d.facingDir = st.facingDir | 0;
        d.activeLoadoutIdx = st.activeLoadoutIdx | 0;
        d.activeWeaponMode = st.activeWeaponMode || null;
      }
    }
    return raw;
  }

  notifyWorkerGatherOrder(
    workerCompanyIds,
    resourceX,
    resourceZ,
    queueShift = false,
    isRunning = false
  ) {
    this.cancelRightDrag();
    if (Array.isArray(workerCompanyIds)) {
      for (const cid of workerCompanyIds) {
        if (!queueShift || isRunning) {
          this.selection.companyGaitRun.set(cid | 0, Boolean(isRunning));
        }
      }
    }
    this.orderQueue.enqueueGatherOrder(workerCompanyIds, resourceX, resourceZ, queueShift);
    this._refreshRadialPanelUI();
  }

  notifyWorkerDropoffOrder(
    workerCompanyIds,
    campX,
    campZ,
    queueShift = false,
    isRunning = false
  ) {
    this.cancelRightDrag();
    if (Array.isArray(workerCompanyIds)) {
      for (const cid of workerCompanyIds) {
        if (!queueShift || isRunning) {
          this.selection.companyGaitRun.set(cid | 0, Boolean(isRunning));
        }
      }
    }
    this.orderQueue.enqueueDropoffOrder(workerCompanyIds, campX, campZ, queueShift);
    this._refreshRadialPanelUI();
  }

  notifyGarrisonOrder(companyIds, towerX, towerZ, queueShift = false, isRunning = false) {
    this.cancelRightDrag();
    if (Array.isArray(companyIds)) {
      for (const cid of companyIds) {
        if (!queueShift || isRunning) {
          this.selection.companyGaitRun.set(cid | 0, Boolean(isRunning));
        }
      }
    }
    this.orderQueue.enqueueGarrisonOrder(companyIds, towerX, towerZ, queueShift);
    this._refreshRadialPanelUI();
  }

  notifyWorkerBuildOrder(workerCompanyIds, targetX, targetZ, queueShift = false, isRunning = false) {
    this.cancelRightDrag();
    if (Array.isArray(workerCompanyIds)) {
      for (const cid of workerCompanyIds) {
        if (!queueShift || isRunning) {
          this.selection.companyGaitRun.set(cid | 0, Boolean(isRunning));
        }
      }
    }
    this.orderQueue.enqueueBuildOrder(workerCompanyIds, targetX, targetZ, queueShift);
    this._refreshRadialPanelUI();
  }

  setTargetingMode(mode) {
    this.targetingMode = mode || 'NONE';
    if (this.targetingMode === 'NONE') {
      this._targetingModeShiftSticky = false;
      this._hideAllSpellTargetPreviews();
    }

    this.syncCursorState();
    this._refreshRadialPanelUI();
  }

  toggleSelectedFireMode() {
    const friendly = this.selection.gatherFriendlyCompanies();
    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
    const archerIds = [];
    for (const cid of this.selectedCompanyIds) {
      const c = friendly.get(cid);
      if (!c) continue;
      const st = ecoStates[cid];
      const canFire = st?.canFireAtWill !== undefined
        ? Boolean(st.canFireAtWill)
        : Boolean(resolveUnitActiveCapabilities(c.unitType, st?.activeLoadoutIdx || 0).canFireAtWill);
      if (canFire) {
        archerIds.push(cid);
      }
    }
    if (archerIds.length === 0) return;
    const anyFireAtWill = archerIds.some(
      (cid) => (ecoStates[cid]?.fireAtWill ?? true) !== false
    );
    const nextFireAtWill = !anyFireAtWill;

    this.commandBus.issue(CommandTypes.SET_COMPANY_GAIT, {
      team: 1,
      companyIds: archerIds,
      fireAtWill: nextFireAtWill
    });

    this._refreshRadialPanelUI();
  }

  toggleSelectedGait(forceRun = null) {
    const friendly = this.selection.gatherFriendlyCompanies();
    const selectedList = [];
    for (const cid of this.selectedCompanyIds) {
      const c = friendly.get(cid);
      if (c) selectedList.push(c);
    }
    if (selectedList.length === 0) return;

    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
    const anyRunLockedStance = selectedList.some((c) => {
      const f =
        ecoStates[c.companyId]?.formation ||
        this.selection.companyFormations.get(c.companyId) ||
        c.formation;
      return (
        f === FormationTypes.SPEAR_WALL ||
        f === FormationTypes.SHIELD_WALL ||
        f === FormationTypes.PIKE_PHALANX ||
        Boolean(ecoStates[c.companyId]?.isBroken)
      );
    });
    const anyExhausted = selectedList.some(
      (c) => (ecoStates[c.companyId]?.staminaPermille ?? 1000) <= 0
    );

    if ((anyRunLockedStance || anyExhausted) && forceRun !== false) {
      return;
    }

    const inGaitGrace = performance.now() - (this._lastGaitToggleTime || 0) < 420;
    const currentWantsToRun = selectedList.every((c) => {
      const simState = ecoStates[c.companyId];
      return inGaitGrace
        ? Boolean(this.selection.companyGaitRun.get(c.companyId))
        : simState !== undefined
          ? Boolean(simState.wantsToRun)
          : Boolean(this.selection.companyGaitRun.get(c.companyId));
    });
    const nextRun = forceRun !== null ? Boolean(forceRun) : !currentWantsToRun;

    const selectedIds = selectedList.map((c) => c.companyId);
    for (const cid of selectedIds) {
      const form =
        ecoStates[cid]?.formation || this.selection.companyFormations.get(cid);
      if (
        form === FormationTypes.SPEAR_WALL ||
        form === FormationTypes.SHIELD_WALL ||
        form === FormationTypes.PIKE_PHALANX
      ) {
        this.selection.companyGaitRun.set(cid, false);
      } else {
        this.selection.companyGaitRun.set(cid, nextRun);
      }
    }

    this._lastGaitToggleTime = performance.now();
    this.commandBus.issue(CommandTypes.SET_COMPANY_GAIT, {
      team: 1,
      companyIds: selectedIds,
      isRunning: nextRun
    });

    this._refreshRadialPanelUI();
  }

  cycleSelectedFormation() {
    const friendly = this.selection.gatherFriendlyCompanies();
    const selectedList = [];
    for (const cid of this.selectedCompanyIds) {
      const comp = friendly.get(cid);
      if (comp) selectedList.push(comp);
    }
    if (selectedList.length === 0) return;

    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
    const getSecForm = (c) => {
      const st = ecoStates[c.companyId];
      if (st?.isHero || c.unitType === 'hero') return null;
      if (st?.secondaryFormation !== undefined) return st.secondaryFormation;
      return resolveUnitActiveCapabilities(c.unitType, st?.activeLoadoutIdx || 0).secondaryFormation;
    };

    const targetSecForm = getSecForm(selectedList[0]);
    if (!targetSecForm || !selectedList.every((c) => getSecForm(c) === targetSecForm)) return;

    this._lastFormationToggleTime = performance.now();

    for (let i = 0; i < selectedList.length; i++) {
      const comp = selectedList[i];
      const cid = comp.companyId;
      const currentForm =
        ecoStates[cid]?.formation ||
        this.selection.companyFormations.get(cid) ||
        resolveDefaultFormation(comp.unitType);
      const nextForm =
        currentForm === targetSecForm ? FormationTypes.SQUARE : targetSecForm;

      this.selection.companyFormations.set(cid, nextForm);
      this.selection.companyCustomWidths.set(cid, 0);
      if (nextForm === FormationTypes.SPEAR_WALL) {
        this.selection.companyGaitRun.set(cid, false);
      }

      this.commandBus.issue(CommandTypes.SET_FORMATION, {
        team: 1,
        companyIds: [cid],
        formation: nextForm
      });
    }

    this._refreshRadialPanelUI();
  }

  issueStopCommand() {
    const companyIds = Array.from(this.selectedCompanyIds);
    if (companyIds.length === 0) return;

    this.orderQueue.clearAllForCompanies(companyIds);
    for (const cid of companyIds) {
      this.selection.companyGaitRun.set(cid, false);
    }

    if (this.synthAudio) this.synthAudio.playHornAlert();
    this.commandBus.issue(CommandTypes.STOP_COMPANIES, {
      team: 1,
      companyIds,
      label: 'Company Halt Order'
    });
    this.setTargetingMode('NONE');
    this._refreshRadialPanelUI();
  }

  _refreshRadialPanelUI(friendlyMap = null) {
    const friendly = friendlyMap || this.selection.gatherFriendlyCompanies();
    this.selection.pruneMissingSelections(friendly);

    const selectedList = [];
    for (const cid of this.selectedCompanyIds) {
      const c = friendly.get(cid);
      if (c) selectedList.push(c);
    }

    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
    const inGaitToggleGrace = performance.now() - (this._lastGaitToggleTime || 0) < 420;
    if (!inGaitToggleGrace) {
      for (const c of selectedList) {
        const simState = ecoStates[c.companyId];
        if (simState && typeof simState.wantsToRun === 'boolean') {
          this.selection.companyGaitRun.set(c.companyId, simState.wantsToRun);
        }
      }
    }

    const inFormationReshuffleGrace = performance.now() - this._lastFormationToggleTime < 1500;
    const hasActiveVisualOrder = selectedList.some((c) =>
      this.orderQueue.hasActiveVisualOrder(c.companyId)
    );
    const isMovingNow =
      selectedList.some((c) => c.movingCount > 0 || (ecoStates[c.companyId]?.orderType || 0) > 0) &&
      (!inFormationReshuffleGrace || hasActiveVisualOrder);

    const wantsToRunNow =
      selectedList.length > 0 &&
      selectedList.every((c) => {
        const simState = ecoStates[c.companyId];
        return inGaitToggleGrace
          ? Boolean(this.selection.companyGaitRun.get(c.companyId))
          : simState !== undefined
            ? Boolean(simState.wantsToRun)
            : Boolean(this.selection.companyGaitRun.get(c.companyId));
      });
    const isActuallyRunningNow =
      selectedList.length > 0 &&
      selectedList.some((c) => {
        const simState = ecoStates[c.companyId];
        return simState !== undefined
          ? Boolean(simState.isRunning)
          : c.runningCount > 0;
      });

    this.tacticalOrb.refresh({
      selectedList,
      ecoStates,
      companyFormations: this.selection.companyFormations,
      targetingMode: this.targetingMode,
      targetingSpellSlotIdx:
        this.targetingMode === 'SPELL_TARGET' && this.pendingHeroSpell
          ? this.pendingHeroSpell.slotIndex
          : -1,
      isMovingNow: isMovingNow || hasActiveVisualOrder,
      wantsToRunNow,
      isActuallyRunningNow
    });
    this.syncCursorState();
  }

  _stageShiftPatrolPoint(worldPoint) {
    this.spawnEphemeralClickMarker(worldPoint, 'PATROL');
    const descriptors = this._buildEnrichedSelectedDescriptors();
    this.orderQueue.stageShiftPatrolPoint(worldPoint, descriptors);
  }

  _commitStagedPatrolRoute() {
    const descriptors = this._buildEnrichedSelectedDescriptors();
    const route = this.orderQueue.consumeStagedPatrolRoute(descriptors);
    if (!route) {
      this.setTargetingMode('NONE');
      return;
    }

    if (this.synthAudio) this.synthAudio.playHornAlert();

    this.commandBus.issue(CommandTypes.PATROL_COMPANIES, {
      team: 1,
      companyIds: route.companyIds,
      dragStartXFx: toFx(route.firstPt.x),
      dragStartZFx: toFx(route.firstPt.z),
      dragEndXFx: toFx(route.firstPt.x),
      dragEndZFx: toFx(route.firstPt.z),
      queue: Boolean(route.hasPrecedingMove),
      isRunning: false,
      patrolWaypoints: route.patrolWaypointsFx,
      label: `Patrol Route (${route.pointCount} pts)`
    });

    this.setTargetingMode('NONE');
    this._refreshRadialPanelUI();
  }
}

import { formationInputHandlerMethods } from './formationInputHandlers.js';
Object.assign(FormationPreview3D.prototype, formationInputHandlerMethods);
