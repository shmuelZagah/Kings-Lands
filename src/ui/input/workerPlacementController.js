import * as THREE from 'three';
import { FX_ONE, ANGLE_STEPS, ANGLE_MASK, mulDiv, fxAtan2, toFx, toFloat } from '../../core/fx.js';
import { CommandTypes } from '../../core/commandBus.js';
import { EventTypes } from '../../core/eventBus.js';
import { sampleTerrainHeightFx, classifyTileTypeFx } from '../../sim/gameState.js';
import { NavTileType } from '../../sim/nav/grid.js';
import { modelProvider } from '../../render/modelProvider.js';
import { dataRegistry } from '../../data/dataRegistry.js';
import { TopResourceBar } from '../hud/topResourceBar.js';
import { WorkerBuildChainMenu } from '../hud/workerBuildChainMenu.js';
import { WorldPicker } from './worldPicker.js';

const MAX_SLOPE_HEIGHT_DIFF_FX = 2252;
const RALLY_ENEMY_SNAP_RADIUS_METERS = 1.4;

export class WorkerPlacementController {
  constructor({
    scene,
    camera,
    domElement,
    simBridge,
    commandBus,
    eventBus,
    terrainRenderer,
    formationPreview,
    buildingRadialMenu,
    onFlashBuilding,
    synthAudio
  }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.simBridge = simBridge;
    this.commandBus = commandBus;
    this.eventBus = eventBus || simBridge?.eventBus || null;
    this.terrainRenderer = terrainRenderer;
    this.formationPreview = formationPreview;
    this.buildingRadialMenu = buildingRadialMenu;
    if (this.formationPreview) {
      this.formationPreview.workerPlacementRef = this;
      this.formationPreview.buildingRadialMenuRef = buildingRadialMenu;
    }
    this.onFlashBuilding = onFlashBuilding || null;
    this.synthAudio = synthAudio;

    this.worldPicker =
      formationPreview?.worldPicker ||
      new WorldPicker({ scene, camera, domElement, simBridge, terrainRenderer });

    this.buildingDefs = dataRegistry.getBuildings().buildings;
    this.buildingModelFactory = modelProvider.getBuildingModelFactory();
    this._unsubRegistry = dataRegistry.subscribe(() => {
      this.buildingDefs = dataRegistry.getBuildings().buildings;
      if (this.buildChainMenu) this.buildChainMenu.buildingDefs = this.buildingDefs;
    });

    this.activePlacementType = null;
    this.placementFacingDir = 256;
    this._isPlacementMouseDown = false;
    this._placementDownWorldPos = new THREE.Vector3();
    this._placementDownClientX = 0;
    this._placementDownClientY = 0;
    this._lastContextualRightClickTime = 0;

    this.cursorWorldPos = new THREE.Vector3(2048, 1, 1300);
    this.isCurrentPlacementValid = false;
    this.lastInvalidReason = '';
    this.hoveredBuildingId = null;
    this._selectedWorkerCompanyIds = [];

    this.previewHolderGroup = new THREE.Group();
    this.previewHolderGroup.name = 'WorkerBuildingPlacementPreview';
    this.previewHolderGroup.visible = false;
    this.scene.add(this.previewHolderGroup);
    this._activePreviewActor = null;

    this.topResourceBar = new TopResourceBar();
    this.buildChainMenu = new WorkerBuildChainMenu({
      buildingDefs: this.buildingDefs,
      canAffordBuildingFn: (def) => this._canAffordBuilding(def),
      onSelectBuildingType: (key) => this.startPlacementMode(key)
    });

    this._bindBusEvents();
    this._syncWorkerSelectionState();
  }

  _bindBusEvents() {
    if (this.eventBus) {
      this.eventBus.on(EventTypes.SELECTION_CHANGED, (payload) => {
        this._syncWorkerSelectionState(payload);
      });
    }
  }

  onWindowBlur() {
    this._isPlacementMouseDown = false;
  }

  _facingDirToThreeYaw(facingDir) {
    return Math.PI * 0.5 - ((facingDir & ANGLE_MASK) * (Math.PI * 2)) / ANGLE_STEPS;
  }

  _canAffordBuilding(def) {
    const eco = this.simBridge.getEconomyState?.() || {
      coins: 0,
      wood: 0,
      stone: 0,
      iron: 0
    };
    const c = def?.cost || {};
    return (
      eco.coins >= (c.coins || 0) &&
      eco.wood >= (c.wood || 0) &&
      eco.stone >= (c.stone || 0) &&
      eco.iron >= (c.iron || 0)
    );
  }

  startPlacementMode(buildingType) {
    const def = this.buildingDefs[buildingType];
    if (!def || !this._canAffordBuilding(def)) return;
    this.activePlacementType = buildingType;
    this.placementFacingDir = 256;
    this._isPlacementMouseDown = false;

    while (this.previewHolderGroup.children.length > 0) {
      this.previewHolderGroup.remove(this.previewHolderGroup.children[0]);
    }

    this._activePreviewActor = this.buildingModelFactory.createBuildingActor(
      {
        type: buildingType,
        team: 1,
        facingDir: this.placementFacingDir,
        footprintRadiusMeters: def.footprintRadiusMeters || 5,
        isCompleted: true,
        hasWatchtower: Boolean(def.hasBuiltInTurret)
      },
      { isGhost: true }
    );
    this.previewHolderGroup.rotation.y = this._facingDirToThreeYaw(this.placementFacingDir);
    this.previewHolderGroup.add(this._activePreviewActor.group);
    this.previewHolderGroup.visible = true;
    this.buildingRadialMenu?.close();
    this.buildChainMenu.refreshStyles(this.activePlacementType);
    this.formationPreview?.syncCursorState?.();
  }

  cancelPlacementMode() {
    this.activePlacementType = null;
    this._isPlacementMouseDown = false;
    this.previewHolderGroup.visible = false;
    this.buildChainMenu.refreshStyles(this.activePlacementType);
    this.formationPreview?.syncCursorState?.();
  }

  _validatePlacementClient(type, xMeters, zMeters) {
    const def = this.buildingDefs[type];
    if (!def || !this._canAffordBuilding(def)) {
      this.lastInvalidReason = 'Insufficient resources';
      return false;
    }

    const r = Number(def.footprintRadiusMeters) || 5;
    const worldSize = this.terrainRenderer?.worldSize || 4096;
    if (xMeters < 20 || xMeters > worldSize - 20 || zMeters < 20 || zMeters > worldSize - 20) {
      this.lastInvalidReason = 'Out of bounds';
      return false;
    }

    if (this.worldPicker.overlapsResourceNodeClient(xMeters, zMeters, r)) {
      this.lastInvalidReason = 'Cannot build on resource nodes';
      return false;
    }

    const xFx = toFx(xMeters);
    const zFx = toFx(zMeters);
    const radiusFx = Math.round(r * FX_ONE) | 0;
    const diagFx = mulDiv(radiusFx, 724, FX_ONE);

    const sampleOffsets = [
      [0, 0],
      [radiusFx, 0],
      [-radiusFx, 0],
      [0, radiusFx],
      [0, -radiusFx],
      [diagFx, diagFx],
      [-diagFx, diagFx],
      [diagFx, -diagFx],
      [-diagFx, -diagFx]
    ];

    let minHeightFx = 0x7fffffff;
    let maxHeightFx = -0x7fffffff;

    for (let i = 0; i < sampleOffsets.length; i++) {
      const sxFx = (xFx + sampleOffsets[i][0]) | 0;
      const szFx = (zFx + sampleOffsets[i][1]) | 0;
      const tileType = classifyTileTypeFx(sxFx, szFx, this.terrainRenderer?.worldSize || 4096);
      if (
        tileType === NavTileType.BLOCKED ||
        tileType === NavTileType.MUD_WATER ||
        tileType === NavTileType.BRIDGE
      ) {
        this.lastInvalidReason = 'Blocked terrain or water';
        return false;
      }

      const hFx = sampleTerrainHeightFx(sxFx, szFx, false, this.terrainRenderer?.worldSize || 4096);
      if (hFx < minHeightFx) minHeightFx = hFx;
      if (hFx > maxHeightFx) maxHeightFx = hFx;
    }

    if (maxHeightFx - minHeightFx > MAX_SLOPE_HEIGHT_DIFF_FX) {
      this.lastInvalidReason = 'Terrain is too steep';
      return false;
    }

    const buildings = this.simBridge.getInterpolatedBuildings?.() || [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.type !== 'citadel_slot' && b.hp <= 0) continue;
      const minSep = r + (b.footprintRadiusMeters || 5) + 2;
      if (Math.hypot(xMeters - b.x, zMeters - b.z) < minSep) {
        this.lastInvalidReason = 'Overlaps another building';
        return false;
      }
    }

    this.lastInvalidReason = '';
    return true;
  }

  _syncWorkerSelectionState(eventPayload = null) {
    let workerIds = [];
    if (eventPayload && Array.isArray(eventPayload.workerCompanyIds)) {
      workerIds = eventPayload.workerCompanyIds;
    } else if (this.formationPreview?.getSelectedWorkerCompanyIds) {
      workerIds = this.formationPreview.getSelectedWorkerCompanyIds();
    }

    this._selectedWorkerCompanyIds = workerIds;

    if (workerIds.length > 0) {
      this.buildChainMenu.setVisible(true);
      this.buildChainMenu.refreshStyles(this.activePlacementType);
    } else {
      this.buildChainMenu.setVisible(false);
      if (this.activePlacementType) {
        this.cancelPlacementMode();
      }
    }
  }

  _commitBuildingPlacement(placePos, shiftKey) {
    if (!this.activePlacementType) return;
    const isValid = this._validatePlacementClient(
      this.activePlacementType,
      placePos.x,
      placePos.z
    );
    if (!isValid) return;

    const workerCompanyIds =
      this._selectedWorkerCompanyIds.length > 0
        ? this._selectedWorkerCompanyIds
        : this.formationPreview?.getSelectedWorkerCompanyIds() || [0];

    this.commandBus.issue(CommandTypes.PLACE_BUILDING, {
      team: 1,
      buildingType: this.activePlacementType,
      xFx: toFx(placePos.x),
      zFx: toFx(placePos.z),
      facingDir: this.placementFacingDir & ANGLE_MASK,
      workerCompanyIds,
      queue: Boolean(shiftKey)
    });

    this.formationPreview?.notifyWorkerBuildOrder?.(
      workerCompanyIds,
      placePos.x,
      placePos.z,
      Boolean(shiftKey)
    );

    if (this.synthAudio) this.synthAudio.playHornAlert();

    if (!shiftKey) {
      this.cancelPlacementMode();
    }
  }

  onKeyDown(e) {
    if (e.code === 'Escape' && this.activePlacementType) {
      this.cancelPlacementMode();
      return true;
    }
    return false;
  }

  onWheel(e) {
    if (!this.activePlacementType) return false;
    e.preventDefault();
    const step = e.deltaY > 0 ? 64 : -64;
    this.placementFacingDir = (this.placementFacingDir + step) & ANGLE_MASK;
    this.previewHolderGroup.rotation.y = this._facingDirToThreeYaw(this.placementFacingDir);
    return true;
  }

  onMouseMove(e) {
    const hit = this.worldPicker.raycastTerrain(e);
    if (!hit) {
      this.hoveredBuildingId = null;
      return false;
    }

    const hoveredBld = this.worldPicker.findBuildingNear(hit.x, hit.z, 0.5);
    this.hoveredBuildingId =
      hoveredBld && hoveredBld.type !== 'citadel_slot' ? hoveredBld.id : null;

    if (!this.activePlacementType) return false;

    if (this._isPlacementMouseDown) {
      const dragPx = Math.hypot(
        e.clientX - this._placementDownClientX,
        e.clientY - this._placementDownClientY
      );
      if (dragPx > 8) {
        const dxFx = toFx(hit.x) - toFx(this._placementDownWorldPos.x);
        const dzFx = toFx(hit.z) - toFx(this._placementDownWorldPos.z);
        if (Math.abs(dxFx) + Math.abs(dzFx) > 256) {
          this.placementFacingDir = fxAtan2(dzFx, dxFx) & ANGLE_MASK;
          this.previewHolderGroup.rotation.y = this._facingDirToThreeYaw(this.placementFacingDir);
        }
      }
      return true;
    }

    const y = toFloat(sampleTerrainHeightFx(toFx(hit.x), toFx(hit.z), false, this.terrainRenderer?.worldSize || 4096));
    this.cursorWorldPos.set(hit.x, y, hit.z);
    this.previewHolderGroup.position.copy(this.cursorWorldPos);

    this.isCurrentPlacementValid = this._validatePlacementClient(
      this.activePlacementType,
      hit.x,
      hit.z
    );
    if (this._activePreviewActor?.ghostMat) {
      this._activePreviewActor.ghostMat.color.setHex(
        this.isCurrentPlacementValid ? 0x22c55e : 0xef4444
      );
    }
    this.formationPreview?.syncCursorState?.(e);
    return false;
  }

  onMouseUp(e) {
    if (e.button === 0 && this._isPlacementMouseDown && this.activePlacementType) {
      e.preventDefault();
      this._isPlacementMouseDown = false;
      this._commitBuildingPlacement(this._placementDownWorldPos, Boolean(e.shiftKey));
      return true;
    }
    return false;
  }

  onDblClick(e) {
    if (e.button !== 0 || this.activePlacementType) return false;
    const directUnit = this.worldPicker.findNearestUnitOnScreen(e.clientX, e.clientY, 1, 24);
    if (directUnit) return false;

    const hit = this.worldPicker.raycastTerrain(e);
    if (!hit) return false;

    const clickedBld = this.worldPicker.findBuildingNear(hit.x, hit.z, 0.5);
    if (
      clickedBld &&
      clickedBld.team === 1 &&
      (clickedBld.type === 'citadel_slot' || clickedBld.hp > 0)
    ) {
      this.formationPreview?.clearSelection?.();
      this.buildingRadialMenu?.selectBuildingsOfSameTypeNear(
        clickedBld.id,
        Boolean(e.shiftKey)
      );
      if (this.onFlashBuilding) {
        const ids = this.buildingRadialMenu?.getSelectedBuildingIds?.() || [clickedBld.id];
        for (let i = 0; i < ids.length; i++) {
          this.onFlashBuilding(ids[i], 'select');
        }
      }
      if (this.synthAudio) this.synthAudio.playFocusWhoosh();
      return true;
    }
    return false;
  }

  onMouseDown(e) {
    if (this.formationPreview?.isRightDragging && e.button === 0) {
      return false;
    }

    if (this.activePlacementType) {
      if (e.button === 2) {
        e.preventDefault();
        this.cancelPlacementMode();
        return true;
      }
      if (e.button === 0 && !e.altKey) {
        e.preventDefault();
        const hit = this.worldPicker.raycastTerrain(e);
        if (hit) {
          const y = toFloat(sampleTerrainHeightFx(toFx(hit.x), toFx(hit.z), false, this.terrainRenderer?.worldSize || 4096));
          this.cursorWorldPos.set(hit.x, y, hit.z);
          this.previewHolderGroup.position.copy(this.cursorWorldPos);
          this.isCurrentPlacementValid = this._validatePlacementClient(
            this.activePlacementType,
            hit.x,
            hit.z
          );
        }
        if (!this.isCurrentPlacementValid) return true;

        this._isPlacementMouseDown = true;
        this._placementDownWorldPos.copy(this.cursorWorldPos);
        this._placementDownClientX = e.clientX;
        this._placementDownClientY = e.clientY;
        return true;
      }
    }

    if (
      this.formationPreview?.targetingMode &&
      this.formationPreview.targetingMode !== 'NONE'
    ) {
      return false;
    }

    if (e.button === 0 && !e.altKey) {
      const directUnit = this.worldPicker.findNearestUnitOnScreen(
        e.clientX,
        e.clientY,
        1,
        24
      );
      if (directUnit) {
        this.buildingRadialMenu?.close();
        return false;
      }

      const hit = this.worldPicker.raycastTerrain(e);
      if (hit) {
        const clickedBld = this.worldPicker.findBuildingNear(hit.x, hit.z, 0.5);
        if (
          clickedBld &&
          clickedBld.team === 1 &&
          (clickedBld.type === 'citadel_slot' || clickedBld.hp > 0)
        ) {
          this.formationPreview?.clearSelection?.();
          if (e.ctrlKey || e.metaKey) {
            this.buildingRadialMenu?.selectBuildingsOfSameTypeNear(
              clickedBld.id,
              Boolean(e.shiftKey)
            );
          } else {
            this.buildingRadialMenu?.openForBuilding(
              clickedBld.id,
              Boolean(e.shiftKey)
            );
          }
          if (this.onFlashBuilding) {
            const ids = this.buildingRadialMenu?.getSelectedBuildingIds?.() || [clickedBld.id];
            for (let i = 0; i < ids.length; i++) {
              this.onFlashBuilding(ids[i], 'select');
            }
          }
          if (this.synthAudio) this.synthAudio.playFocusWhoosh();
          return true;
        } else if (!e.shiftKey) {
          this.buildingRadialMenu?.close();
        }
      }
      return false;
    }

    if (e.button === 2) {
      const terrainHit = this.worldPicker.raycastTerrain(e);
      const resourceNode = this.worldPicker.findResourceNodeAtMouse(e, terrainHit);
      const hit = resourceNode
        ? new THREE.Vector3(resourceNode.x, resourceNode.y, resourceNode.z)
        : terrainHit;
      if (!hit) return false;

      const now = performance.now();
      const isDoubleRightClick = now - this._lastContextualRightClickTime <= 340;
      this._lastContextualRightClickTime = now;

      const selectedBlds = this.buildingRadialMenu?.getSelectedBuildings?.() || [];

      if (selectedBlds.length > 0) {
        const activeWatchtowers = selectedBlds.filter(
          (b) => b.team === 1 && b.isCompleted && b.hasWatchtower
        );

        if (activeWatchtowers.length > 0) {
          const enemyTarget =
            this.worldPicker.findNearestUnitOnScreen(e.clientX, e.clientY, 2, 24) ||
            this.worldPicker.findEnemyEntityNearWorldPoint(hit.x, hit.z, 1.35);
          if (enemyTarget) {
            e.preventDefault();
            this.commandBus.issue(CommandTypes.SET_TOWER_TARGET, {
              team: 1,
              buildingId: activeWatchtowers[0].id,
              buildingIds: activeWatchtowers.map((b) => b.id),
              targetEntityId: enemyTarget.id
            });
            this.formationPreview?.spawnEphemeralClickMarker?.(
              new THREE.Vector3(enemyTarget.x, enemyTarget.y, enemyTarget.z),
              'ATTACK_MOVE',
              1.4
            );
            if (this.synthAudio) this.synthAudio.playHornAlert();
            return true;
          }
        }

        // Allow setting Rally Point on any rally-capable buildings (both completed and under construction!)
        const rallyableBlds = selectedBlds.filter(
          (b) =>
            b.team === 1 &&
            !b.isPassiveAoE &&
            b.type !== 'citadel_slot' &&
            b.type !== 'ballista_tower' &&
            b.type !== 'house'
        );

        if (rallyableBlds.length > 0) {
          e.preventDefault();

          const targetBldAtRally = this.worldPicker.findBuildingNear(hit.x, hit.z, 0.5);
          const enemyEntAtRally = !targetBldAtRally
            ? this.worldPicker.findNearestUnitOnScreen(e.clientX, e.clientY, 2, 22) ||
              this.worldPicker.findEnemyEntityNearWorldPoint(
                hit.x,
                hit.z,
                RALLY_ENEMY_SNAP_RADIUS_METERS
              )
            : null;

          const isSelfTarget =
            targetBldAtRally &&
            rallyableBlds.length === 1 &&
            targetBldAtRally.id === rallyableBlds[0].id;

          const rallyX =
            targetBldAtRally && !isSelfTarget
              ? targetBldAtRally.x
              : enemyEntAtRally
                ? enemyEntAtRally.x
                : hit.x;
          const rallyZ =
            targetBldAtRally && !isSelfTarget
              ? targetBldAtRally.z
              : enemyEntAtRally
                ? enemyEntAtRally.z
                : hit.z;

          this.commandBus.issue(CommandTypes.SET_BUILDING_RALLY, {
            team: 1,
            buildingId: rallyableBlds[0].id,
            buildingIds: rallyableBlds.map((b) => b.id),
            xFx: toFx(rallyX),
            zFx: toFx(rallyZ)
          });

          if (targetBldAtRally && !isSelfTarget) {
            if (this.onFlashBuilding) {
              this.onFlashBuilding(targetBldAtRally.id, 'command');
            }
            if (targetBldAtRally.team !== 1) {
              this.formationPreview?.spawnEphemeralClickMarker?.(
                new THREE.Vector3(targetBldAtRally.x, targetBldAtRally.y, targetBldAtRally.z),
                'ATTACK_MOVE',
                1.45
              );
            }
          } else if (enemyEntAtRally) {
            this.formationPreview?.spawnEphemeralClickMarker?.(
              new THREE.Vector3(enemyEntAtRally.x, enemyEntAtRally.y, enemyEntAtRally.z),
              'ATTACK_MOVE',
              1.35
            );
          } else if (!resourceNode) {
            this.formationPreview?.spawnEphemeralClickMarker?.(hit, 'MOVE', 1.25);
          }

          if (this.synthAudio) this.synthAudio.playFocusWhoosh();
          return true;
        }
      }

      if (resourceNode && this._selectedWorkerCompanyIds.length > 0) {
        e.preventDefault();

        const queueShift = Boolean(e.shiftKey);
        this.commandBus.issue(CommandTypes.GATHER_RESOURCE, {
          team: 1,
          workerCompanyIds: this._selectedWorkerCompanyIds,
          xFx: toFx(resourceNode.x),
          zFx: toFx(resourceNode.z),
          queue: queueShift,
          isRunning: Boolean(isDoubleRightClick)
        });

        this.formationPreview?.notifyWorkerGatherOrder?.(
          this._selectedWorkerCompanyIds,
          resourceNode.x,
          resourceNode.z,
          queueShift,
          Boolean(isDoubleRightClick)
        );

        if (this.synthAudio) this.synthAudio.playFocusWhoosh();
        return true;
      }

      const clickedBld = this.worldPicker.findBuildingNear(hit.x, hit.z, 0.5);
      if (clickedBld && clickedBld.team === 1) {
        const selectedCompanyIds = Array.from(this.formationPreview?.selectedCompanyIds || []);
        const workerCompanyIds = this._selectedWorkerCompanyIds;
        const nonWorkerCompanyIds = selectedCompanyIds.filter(
          (cid) => !workerCompanyIds.includes(cid)
        );

        let handledContextualBldOrder = false;

        if (
          workerCompanyIds.length > 0 &&
          clickedBld.type !== 'citadel_slot' &&
          (!clickedBld.isCompleted || clickedBld.hp < clickedBld.maxHp)
        ) {
          e.preventDefault();
          this.commandBus.issue(CommandTypes.ASSIGN_BUILDERS, {
            team: 1,
            buildingId: clickedBld.id,
            workerCompanyIds,
            queue: Boolean(e.shiftKey),
            isRunning: Boolean(isDoubleRightClick)
          });
          this.formationPreview?.notifyWorkerBuildOrder?.(
            workerCompanyIds,
            clickedBld.x,
            clickedBld.z,
            Boolean(e.shiftKey),
            Boolean(isDoubleRightClick)
          );
          handledContextualBldOrder = true;
        } else if (
          workerCompanyIds.length > 0 &&
          clickedBld.isCompleted &&
          (clickedBld.type === 'citadel' || clickedBld.type === 'gathering_camp')
        ) {
          e.preventDefault();
          const queueShift = Boolean(e.shiftKey);
          this.commandBus.issue(CommandTypes.GATHER_RESOURCE, {
            team: 1,
            workerCompanyIds,
            xFx: toFx(clickedBld.x),
            zFx: toFx(clickedBld.z),
            queue: queueShift,
            isRunning: Boolean(isDoubleRightClick)
          });
          this.formationPreview?.notifyWorkerDropoffOrder?.(
            workerCompanyIds,
            clickedBld.x,
            clickedBld.z,
            queueShift,
            Boolean(isDoubleRightClick)
          );
          handledContextualBldOrder = true;
        }

        // Allow garrisoning both completed towers AND uncompleted towers!
        // (If the tower is still under construction, non-worker companies march to it and wait until built)
        const garrisonCandidates = clickedBld.isCompleted
          ? selectedCompanyIds
          : nonWorkerCompanyIds;

        if (
          garrisonCandidates.length > 0 &&
          (clickedBld.maxGarrison || 0) > 0 &&
          (clickedBld.garrisonCompanyIds?.length || 0) < clickedBld.maxGarrison
        ) {
          e.preventDefault();
          this.commandBus.issue(CommandTypes.GARRISON_BUILDING, {
            team: 1,
            buildingId: clickedBld.id,
            companyIds: garrisonCandidates,
            queue: Boolean(e.shiftKey),
            isRunning: Boolean(isDoubleRightClick)
          });
          this.formationPreview?.notifyGarrisonOrder?.(
            garrisonCandidates,
            clickedBld.x,
            clickedBld.z,
            Boolean(e.shiftKey),
            Boolean(isDoubleRightClick)
          );
          handledContextualBldOrder = true;
        }

        if (handledContextualBldOrder) {
          if (this.onFlashBuilding) {
            this.onFlashBuilding(clickedBld.id, 'command');
          }
          if (this.synthAudio) this.synthAudio.playHornAlert();
          return true;
        }
      }
    }

    return false;
  }

  update() {
    const eco = this.simBridge.getEconomyState?.();
    if (eco) {
      this.topResourceBar.update(eco);
    }
    if (this._selectedWorkerCompanyIds.length > 0) {
      this.buildChainMenu.refreshStyles(this.activePlacementType);
    }
  }
}
