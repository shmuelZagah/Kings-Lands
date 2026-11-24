import * as THREE from 'three';
import { ANGLE_STEPS, ANGLE_MASK, toFx, toFloat } from '../core/fx.js';
import { sampleTerrainHeightFx, sampleTerrainMeshHeightMeters } from '../sim/gameState.js';
import { FowState, FOW_GRID_SIZE } from '../sim/systems/moraleStaminaSystem.js';
import { TerrainRenderer } from './terrainRenderer.js';
import { CameraController } from './cameraController.js';
import { modelProvider } from './modelProvider.js';
import { UnitRenderer } from './unitRenderer.js';
import { WorldEffectsRenderer } from './worldEffectsRenderer.js';
import { InputRouter } from '../ui/input/inputRouter.js';
import { FormationPreview3D } from '../ui/input/formationPreview3D.js';
import { BuildingRadialMenu } from '../ui/hud/buildingRadialMenu.js';
import { WorkerPlacementController } from '../ui/input/workerPlacementController.js';
import { DevConsole } from '../ui/hud/devConsole.js';
import { MinimapHud, SquadCommandBar, VictoryScreenModal } from '../ui/hud/rtsCursorManager.js';

export class SceneManager {
  constructor({ container, config, simBridge, commandBus, eventBus, synthAudio }) {
    this.container = container;
    this.config = config;
    this.simBridge = simBridge;
    this.commandBus = commandBus;
    this.eventBus = eventBus;
    this.synthAudio = synthAudio;

    this.pausedForLab = false;
    this.activeVisualsData = modelProvider.getCombinedVisuals();
    this.modelFactory = modelProvider.getModelFactory();
    this.buildingModelFactory = modelProvider.getBuildingModelFactory();
    this._unsubModelProvider = modelProvider.subscribe(({ combinedVisuals }) => {
      this.activeVisualsData = combinedVisuals;
      this.unitRenderer?.clearVisualCaches?.(this.activeVisualsData.animations);
      if (this.buildingsGroup && this.buildingActors) {
        for (const actor of this.buildingActors.values()) {
          this.buildingsGroup.remove(actor.group);
        }
        this.buildingActors.clear();
      }
    });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);
    this.scene.fog = new THREE.FogExp2(0x162235, 0.0018);

    const initWidth = Math.max(1, container.clientWidth || window.innerWidth || 1024);
    const initHeight = Math.max(1, container.clientHeight || window.innerHeight || 768);

    const camCfg = config?.camera || {};
    this.camera = new THREE.PerspectiveCamera(
      camCfg.fovDegrees ?? 45,
      initWidth / initHeight,
      camCfg.nearPlane ?? 1.0,
      camCfg.farPlane ?? 1800.0
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.setSize(initWidth, initHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    container.appendChild(this.renderer.domElement);

    this._setupLighting();
    this.terrainRenderer = new TerrainRenderer(this.scene, config);
    this.cameraController = new CameraController(
      this.camera,
      this.renderer.domElement,
      config,
      eventBus,
      synthAudio
    );

    this.minesGroup = new THREE.Group();
    this.minesGroup.name = 'MinesGroup';
    this.scene.add(this.minesGroup);
    this.mineActors = new Map();

    this.buildingsGroup = new THREE.Group();
    this.buildingsGroup.name = 'BuildingsGroup';
    this.scene.add(this.buildingsGroup);
    this.buildingActors = new Map();

    this.rangeRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78,
      depthTest: true,
      depthWrite: false
    });
    this.rangeRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1.0, 64),
      this.rangeRingMat
    );
    this.rangeRingMesh.rotation.x = -Math.PI * 0.5;
    this.rangeRingMesh.frustumCulled = false;
    this.rangeRingMesh.visible = false;
    this.scene.add(this.rangeRingMesh);

    this.rallyVisualsGroup = new THREE.Group();
    this.rallyVisualsGroup.name = 'MultiBuildingRallyVisualsGroup';
    this.scene.add(this.rallyVisualsGroup);
    this._rallyFlagPool = [];
    this._rallyLinePool = [];
    this._lastRallyMultiKey = '';

    this.worldEffects = new WorldEffectsRenderer({
      scene: this.scene,
      camera: this.camera,
      domElement: this.renderer.domElement,
      eventBus: this.eventBus,
      buildingModelFactory: this.buildingModelFactory,
      synthAudio: this.synthAudio,
      arrowConfig: this.activeVisualsData?.arrowConfig || null
    });

    this.unitRenderer = new UnitRenderer({
      scene: this.scene,
      camera: this.camera,
      modelFactory: this.modelFactory,
      animationsData: this.activeVisualsData?.animations || { keyframes: {}, procedural: {} },
      onAnimatorEvent: (evt) => this._handleAnimatorEvent(evt),
      simBridge: this.simBridge
    });
    this.unitsGroup = this.unitRenderer.unitsGroup;
    this.unitActors = this.unitRenderer.unitActors;

    this._cachedTreeGroups = [];
    this._lastDepletedTreesKey = '__uninitialized__';

    this.formationPreview = new FormationPreview3D({
      scene: this.scene,
      camera: this.camera,
      domElement: this.renderer.domElement,
      container: this.container,
      simBridge: this.simBridge,
      commandBus: this.commandBus,
      eventBus: this.eventBus,
      terrainRenderer: this.terrainRenderer,
      onFlashBuilding: (bldId, mode) => this.flashBuilding(bldId, mode),
      synthAudio: this.synthAudio
    });

    this.buildingRadialMenu = new BuildingRadialMenu({
      camera: this.camera,
      domElement: this.renderer.domElement,
      simBridge: this.simBridge,
      commandBus: this.commandBus,
      synthAudio: this.synthAudio
    });

    this.workerPlacementController = new WorkerPlacementController({
      scene: this.scene,
      camera: this.camera,
      domElement: this.renderer.domElement,
      simBridge: this.simBridge,
      commandBus: this.commandBus,
      eventBus: this.eventBus,
      terrainRenderer: this.terrainRenderer,
      formationPreview: this.formationPreview,
      buildingRadialMenu: this.buildingRadialMenu,
      onFlashBuilding: (bldId, mode) => this.flashBuilding(bldId, mode),
      synthAudio: this.synthAudio
    });

    this.inputRouter = new InputRouter(this.renderer.domElement);
    this.inputRouter.registerLayer('building_placement', this.workerPlacementController, 100);
    this.inputRouter.registerLayer('unit_selection_orders', this.formationPreview, 50);
    this.inputRouter.registerLayer('camera', this.cameraController, 10);

    this.devConsole = new DevConsole({
      commandBus: this.commandBus,
      buildingRadialMenu: this.buildingRadialMenu,
      synthAudio: this.synthAudio,
      enabled: this.config?.matchSetup ? Boolean(this.config.matchSetup.isDevMode) : true
    });

    this.minimapHud = new MinimapHud({
      simBridge: this.simBridge,
      cameraController: this.cameraController,
      formationPreview: this.formationPreview,
      commandBus: this.commandBus,
      eventBus: this.eventBus,
      worldSizeMeters: this.terrainRenderer?.worldSize || 4096
    });

    this.squadCommandBar = new SquadCommandBar({
      simBridge: this.simBridge,
      formationPreview: this.formationPreview,
      buildingRadialMenu: this.buildingRadialMenu,
      eventBus: this.eventBus,
      synthAudio: this.synthAudio
    });

    this.victoryScreenModal = new VictoryScreenModal({
      simBridge: this.simBridge,
      synthAudio: this.synthAudio
    });

    this.fps = 60;
    this.lastAlpha = 0.5;
    this.lastAnimEventText = 'Ready';
    this._frameCounter = 0;
    this._totalFrames = 0;
    this._lastFpsTime = performance.now();
    this._lastFrameTime = performance.now();

    this.perfStats = {
      fps: 60,
      units: 0,
      drawCalls: 0,
      triangles: 0,
      simInterpMs: 0,
      uiAndBuildingsMs: 0,
      unitRendererMs: 0,
      webglRenderMs: 0,
      totalFrameMs: 0
    };
    if (typeof window !== 'undefined') {
      window.__perf = this.perfStats;
      window.printPerf = () => {
        console.table(this.perfStats);
        return this.perfStats;
      };
    }

    this._bindInteractions();
  }

  _facingDirToThreeYaw(facingDir) {
    return Math.PI * 0.5 - ((facingDir & ANGLE_MASK) * (Math.PI * 2)) / ANGLE_STEPS;
  }

  _sampleGroundHeightFast(x, z) {
    return sampleTerrainMeshHeightMeters(x, z, true, this.terrainRenderer?.worldSize || 4096);
  }

  flashBuilding(buildingId, mode = 'command') {
    const actor = this.buildingActors.get(buildingId | 0);
    if (!actor) return;
    if (mode === 'select') {
      actor.selectFlashTimer = 0.18;
    } else {
      if (actor.flashRingMat?.color) {
        actor.flashRingMat.color.setHex(mode === 'attack' ? 0xef4444 : 0xfbbf24);
      }
      actor.flashTimer = 0.95;
    }
  }

  _setupLighting() {
    const center =
      (this.config?.map?.tilesX || 512) * (this.config?.map?.tileSizeMeters || 2) * 0.5;
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x3f4d36, 0.75);
    hemi.position.set(center, 160, center);
    this.scene.add(hemi);

    const initX = this.config?.camera?.initialTargetX ?? center;
    const initZ = this.config?.camera?.initialTargetZ ?? center;
    const sun = new THREE.DirectionalLight(0xfffbeb, 1.18);
    sun.position.set(initX - 75, 160, initZ - 85);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    sun.shadow.camera.near = 15;
    sun.shadow.camera.far = 460;
    const d = 220;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.target.position.set(initX, 0, initZ);
    this.sunLight = sun;
    this._shadowAnchorX = initX;
    this._shadowAnchorZ = initZ;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  _handleAnimatorEvent(evt) {
    this.lastAnimEventText = `${evt.type.toUpperCase()} (${evt.clipName}) #${evt.entityId}`;
    this.worldEffects.spawnAnimatorEventSpark(evt);
  }

  _getOrCreateRallyFlagAt(index) {
    while (this._rallyFlagPool.length <= index) {
      const flag = this.buildingModelFactory.createRallyFlagMesh();
      flag.traverse((ch) => {
        ch.frustumCulled = false;
      });
      flag.visible = false;
      this.rallyVisualsGroup.add(flag);
      this._rallyFlagPool.push(flag);
    }
    return this._rallyFlagPool[index];
  }

  _getOrCreateRallyLineAt(index) {
    while (this._rallyLinePool.length <= index) {
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3()
      ]);
      const line = new THREE.Line(
        geom,
        new THREE.LineDashedMaterial({
          color: 0xfbbf24,
          dashSize: 1.4,
          gapSize: 0.9,
          transparent: true,
          opacity: 0.88,
          depthTest: false
        })
      );
      line.frustumCulled = false;
      line.renderOrder = 37;
      line.visible = false;
      this.rallyVisualsGroup.add(line);
      this._rallyLinePool.push(line);
    }
    return this._rallyLinePool[index];
  }

  _updateMultiBuildingRallyVisuals(selectedBlds) {
    const rallyableBlds = [];
    for (let i = 0; i < selectedBlds.length; i++) {
      const b = selectedBlds[i];
      if (
        b &&
        b.team === 1 &&
        !b.isPassiveAoE &&
        b.type !== 'citadel_slot' &&
        b.type !== 'ballista_tower' &&
        b.type !== 'house' &&
        typeof b.rallyX === 'number' &&
        typeof b.rallyZ === 'number'
      ) {
        rallyableBlds.push(b);
      }
    }

    if (rallyableBlds.length === 0) {
      if (this._lastRallyMultiKey !== '') {
        this._lastRallyMultiKey = '';
        for (let i = 0; i < this._rallyFlagPool.length; i++) {
          this._rallyFlagPool[i].visible = false;
        }
        for (let i = 0; i < this._rallyLinePool.length; i++) {
          this._rallyLinePool[i].visible = false;
        }
      }
      return;
    }

    const rallyKey = rallyableBlds
      .map(
        (b) =>
          `${b.id}:${b.x.toFixed(1)},${b.z.toFixed(1)}->${b.rallyX.toFixed(1)},${b.rallyZ.toFixed(1)}`
      )
      .join('|');

    if (this._lastRallyMultiKey !== rallyKey) {
      this._lastRallyMultiKey = rallyKey;

      const uniqueFlagPositions = [];
      for (let i = 0; i < rallyableBlds.length; i++) {
        const b = rallyableBlds[i];
        const line = this._getOrCreateRallyLineAt(i);
        const pts = this.formationPreview.orderLineRenderer.buildTerrainConformingSegmentPoints(
          b.x,
          b.z,
          b.rallyX,
          b.rallyZ,
          0.55
        );
        line.geometry.setFromPoints(pts);
        line.computeLineDistances();
        line.frustumCulled = false;
        line.visible = true;

        const alreadyHasFlagAtPos = uniqueFlagPositions.some(
          (pos) => Math.hypot(pos.x - b.rallyX, pos.z - b.rallyZ) < 0.35
        );
        if (!alreadyHasFlagAtPos) {
          uniqueFlagPositions.push({ x: b.rallyX, z: b.rallyZ });
        }
      }

      for (let i = rallyableBlds.length; i < this._rallyLinePool.length; i++) {
        this._rallyLinePool[i].visible = false;
      }

      for (let f = 0; f < uniqueFlagPositions.length; f++) {
        const pos = uniqueFlagPositions[f];
        const flag = this._getOrCreateRallyFlagAt(f);
        const ry = this._sampleGroundHeightFast(pos.x, pos.z);
        flag.position.set(pos.x, ry, pos.z);
        flag.visible = true;
      }

      for (let f = uniqueFlagPositions.length; f < this._rallyFlagPool.length; f++) {
        this._rallyFlagPool[f].visible = false;
      }
    }
  }

  _syncDepletedTreesAndMines() {
    const eco = this.simBridge.getEconomyState?.();
    if (!eco) return;

    if (Array.isArray(eco.mines) && this.mineActors.size === 0) {
      for (let i = 0; i < eco.mines.length; i++) {
        const m = eco.mines[i];
        const mesh = this.buildingModelFactory.createMineOutcropMesh(m);
        mesh.position.set(m.x, m.y, m.z);
        mesh.userData.mineId = m.id;
        mesh.userData.resourceType = m.resourceType;
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        this.minesGroup.add(mesh);
        this.mineActors.set(m.id, mesh);
      }
    }

    if (this.terrainRenderer?.syncDepletedTrees) {
      this.terrainRenderer.syncDepletedTrees(eco.depletedTreeIds || []);
    }
  }

  _updateBuildingsRender(dtSeconds) {
    const buildings = this.simBridge.getInterpolatedBuildings?.() || [];
    const activeBldIds = new Set();
    const hoveredId = this.workerPlacementController?.hoveredBuildingId ?? null;
    let hoveredBuildingObj = null;

    const selectedBlds = this.buildingRadialMenu?.getSelectedBuildings?.() || [];
    const selectedBldIds = new Set(selectedBlds.map((b) => b.id));

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b.type !== 'citadel_slot' && b.hp <= 0) continue;
      activeBldIds.add(b.id);

      if (b.id === hoveredId && b.type !== 'citadel_slot' && b.maxHp > 0) {
        hoveredBuildingObj = b;
      }

      let actor = this.buildingActors.get(b.id);
      if (actor && actor.type !== b.type) {
        this.buildingsGroup.remove(actor.group);
        this.buildingActors.delete(b.id);
        actor = null;
      }

      if (!actor) {
        actor = this.buildingModelFactory.createBuildingActor(b, { isGhost: false });
        if (!b.isCompleted && b.type !== 'citadel_slot') {
          actor.flashTimer = 0.85;
        }
        this.buildingActors.set(b.id, actor);
        this.buildingsGroup.add(actor.group);
      }

      const fowGrid = this.simBridge.getFowGrid?.();
      const isAlliedB = this.simBridge.isAlliedWithPlayer ? this.simBridge.isAlliedWithPlayer(b.team) : b.team === 1;
      if (!isAlliedB && fowGrid) {
        const cx = Math.max(0, Math.min(FOW_GRID_SIZE - 1, Math.floor((b.x / 4096) * FOW_GRID_SIZE)));
        const cz = Math.max(0, Math.min(FOW_GRID_SIZE - 1, Math.floor((b.z / 4096) * FOW_GRID_SIZE)));
        actor.group.visible = fowGrid[cz * FOW_GRID_SIZE + cx] !== FowState.UNEXPLORED;
      } else {
        actor.group.visible = true;
      }

      actor.group.position.set(b.x, b.y, b.z);
      const facingDir = b.facingDir ?? (b.team === 1 ? 256 : 768);
      const buildingYaw = this._facingDirToThreeYaw(facingDir);
      actor.group.rotation.y = buildingYaw;

      const progress = b.isCompleted ? 1.0 : Math.max(0.12, (b.buildProgressPermille || 0) / 1000);
      if (typeof this.buildingModelFactory.updateBuildingLiveState === 'function') {
        this.buildingModelFactory.updateBuildingLiveState(actor, b, null, dtSeconds);
      } else {
        actor.bodyGroup.scale.set(1, progress, 1);
      }

      const isSelected = selectedBldIds.has(b.id);
      let highlightVal = 0;
      if (isSelected || actor.selectFlashTimer > 0) {
        if (actor.selectFlashTimer > 0) {
          actor.selectFlashTimer = Math.max(0, actor.selectFlashTimer - dtSeconds);
          highlightVal = Math.sin((actor.selectFlashTimer / 0.18) * Math.PI);
        } else {
          highlightVal = 0.45;
        }
      }
      if (actor._lastHighlightVal !== highlightVal) {
        actor._lastHighlightVal = highlightVal;
        this.buildingModelFactory.setBuildingSelectHighlight(actor, highlightVal);
      }

      if (actor.flashTimer > 0) {
        actor.flashTimer = Math.max(0, actor.flashTimer - dtSeconds);
        const pulse = Math.sin(actor.flashTimer * 18) * 0.5 + 0.5;
        actor.flashRingGroup.visible = true;
        actor.flashRingGroup.rotation.y = -buildingYaw;
        actor.flashRingMat.opacity = (actor.flashTimer / 0.85) * (0.45 + pulse * 0.5);
      } else if (actor.flashRingGroup?.visible) {
        actor.flashRingGroup.visible = false;
        actor.flashRingMat.opacity = 0;
      }

      actor.scaffoldGroup.visible = !b.isCompleted && b.type !== 'citadel_slot';
      if (actor.progressBarFill && !b.isCompleted) {
        actor.progressBarFill.scale.set(Math.max(0.05, progress), 1, 1);
      }

      if (actor.hpBarGroup && actor.hpBarFill) {
        const isHovered = b.id === hoveredId;
        const isDamaged = b.isCompleted && b.hp < b.maxHp;
        const showHpBar = (isHovered || isDamaged) && b.maxHp > 0 && b.type !== 'citadel_slot';
        actor.hpBarGroup.visible = showHpBar;
        if (showHpBar) {
          const hpRatio = Math.max(0.04, b.hp / Math.max(1, b.maxHp));
          actor.hpBarFill.scale.set(hpRatio, 1, 1);
          actor.hpBarFill.material.color.setHex(
            hpRatio > 0.55 ? 0x22c55e : hpRatio > 0.25 ? 0xf59e0b : 0xef4444
          );
        }
      }

      actor.turretGroup.visible =
        Boolean(b.isCompleted && b.hasWatchtower) &&
        b.type !== 'watchtower' &&
        b.type !== 'ballista_tower';
    }

    for (const [id, actor] of this.buildingActors.entries()) {
      if (!activeBldIds.has(id)) {
        this.buildingsGroup.remove(actor.group);
        this.buildingActors.delete(id);
      }
    }

    this.worldEffects.updateHoverBuildingBadge(hoveredBuildingObj);

    const selectedBld = selectedBlds.length === 1 ? selectedBlds[0] : null;

    if (selectedBld && selectedBld.isCompleted) {
      let ringRadius = 0;
      let ringColor = 0x38bdf8;
      if (selectedBld.type === 'watchtower' || selectedBld.type === 'ballista_tower') {
        ringRadius = selectedBld.turretRangeMeters || 28;
        ringColor = 0xf87171;
      } else if (selectedBld.isPassiveAoE || selectedBld.auraRadiusMeters > 0) {
        ringRadius = selectedBld.auraRadiusMeters || 22;
        ringColor = selectedBld.type === 'infirmary' ? 0x2dd4bf : 0xd97706;
      }

      if (ringRadius > 0) {
        this.rangeRingMesh.position.set(selectedBld.x, selectedBld.y + 0.35, selectedBld.z);
        this.rangeRingMesh.scale.set(ringRadius, ringRadius, 1);
        this.rangeRingMat.color.setHex(ringColor);
        this.rangeRingMesh.visible = true;
      } else {
        this.rangeRingMesh.visible = false;
      }
    } else {
      this.rangeRingMesh.visible = false;
    }

    this._updateMultiBuildingRallyVisuals(selectedBlds);
  }

  _syncViewportSize() {
    const rawW = this.container.clientWidth || window.innerWidth;
    const rawH = this.container.clientHeight || window.innerHeight;
    if (!rawW || !rawH || rawW <= 0 || rawH <= 0) return;

    this.camera.aspect = rawW / rawH;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rawW, rawH);
  }

  _bindInteractions() {
    window.addEventListener('resize', () => {
      this._syncViewportSize();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this._lastFrameTime = performance.now();
        this._syncViewportSize();
        this.buildingRadialMenu?.update();
        this.workerPlacementController?.update();
        this.formationPreview?.update(0.016);
      }
    });

    window.addEventListener('focus', () => {
      this._lastFrameTime = performance.now();
      this._syncViewportSize();
    });
  }

  start() {
    this.isDestroyed = false;
    this._lastFrameTime = performance.now();
    const loop = () => {
      if (this.isDestroyed) return;
      this._rafId = requestAnimationFrame(loop);
      this._renderFrame(performance.now());
    };
    this._rafId = requestAnimationFrame(loop);
  }

  destroy() {
    this.isDestroyed = true;
    this.pausedForLab = true;
    if (this._unsubModelProvider) {
      this._unsubModelProvider();
      this._unsubModelProvider = null;
    }
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.devConsole?.destroy?.();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss?.();
      this.renderer.domElement?.remove?.();
      this.renderer = null;
    }
  }

  _renderFrame(now) {
    if (document.hidden || this.pausedForLab) {
      this._lastFrameTime = now;
      return;
    }

    const t0 = performance.now();
    const dtSeconds = Math.min(Math.max(0.001, (now - this._lastFrameTime) / 1000), 0.1);
    this._lastFrameTime = now;

    this._frameCounter++;
    this._totalFrames++;
    if (now - this._lastFpsTime >= 500) {
      this.fps = Math.round((this._frameCounter * 1000) / (now - this._lastFpsTime));
      this._frameCounter = 0;
      this._lastFpsTime = now;
    }

    const { alpha, entities } = this.simBridge.getInterpolatedState(now);
    this.lastAlpha = alpha;
    const t1 = performance.now();

    const fowGrid = this.simBridge.getFowGrid?.();
    this.cameraController.update(dtSeconds);
    this.terrainRenderer.update(dtSeconds, fowGrid, this.simBridge.getEconomyState?.()?.temporaryReveals || null);
    if (entities.length <= 300 || (this._totalFrames & 1) === 0) {
      this.formationPreview.update(dtSeconds, now);
      this.buildingRadialMenu.update();
      this.workerPlacementController.update();
      this.squadCommandBar?.update();
      this.victoryScreenModal?.update();
      this._syncDepletedTreesAndMines();
    } else {
      this.formationPreview.orderLineRenderer.updateEphemeralMarkers(dtSeconds);
      this.formationPreview.ghostPreview.stepFlash(dtSeconds);
    }
    this.minimapHud?.update(now);
    try {
      this._updateBuildingsRender(dtSeconds);
    } catch (err) {
      console.error("Buildings render step warning:", err);
    }
    try {
      this.worldEffects.update(dtSeconds);
    } catch (err) {
      console.error("World effects step warning:", err);
    }
    const t2 = performance.now();

    this.unitRenderer.update(entities, dtSeconds, this.formationPreview, fowGrid);
    this.worldEffects.updateHeroOverheadHealthBars(
      entities,
      this.simBridge.getEconomyState?.()?.companyStates || {},
      fowGrid
    );
    const t3 = performance.now();

    const shadowInterval = entities.length > 600 ? 4 : entities.length > 300 ? 2 : 1;
    if (this._totalFrames % shadowInterval === 0) {
      if (this.sunLight && this.cameraController?.target) {
        const cx = this.cameraController.target.x;
        const cz = this.cameraController.target.z;
        if (Math.hypot(cx - this._shadowAnchorX, cz - this._shadowAnchorZ) > 75) {
          const sx = Math.round(cx / 32) * 32;
          const sz = Math.round(cz / 32) * 32;
          this._shadowAnchorX = sx;
          this._shadowAnchorZ = sz;
          this.sunLight.position.set(sx - 75, 160, sz - 85);
          this.sunLight.target.position.set(sx, 0, sz);
          this.sunLight.target.updateMatrixWorld();
        }
      }
      this.renderer.shadowMap.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
    const t4 = performance.now();

    const s = this.perfStats;
    s.fps = this.fps;
    s.units = entities.length;
    s.drawCalls = this.renderer.info?.render?.calls ?? 0;
    s.triangles = this.renderer.info?.render?.triangles ?? 0;
    s.simInterpMs = +(s.simInterpMs * 0.85 + (t1 - t0) * 0.15).toFixed(2);
    s.uiAndBuildingsMs = +(s.uiAndBuildingsMs * 0.85 + (t2 - t1) * 0.15).toFixed(2);
    s.unitRendererMs = +(s.unitRendererMs * 0.85 + (t3 - t2) * 0.15).toFixed(2);
    s.webglRenderMs = +(s.webglRenderMs * 0.85 + (t4 - t3) * 0.15).toFixed(2);
    s.totalFrameMs = +(s.totalFrameMs * 0.85 + (t4 - t0) * 0.15).toFixed(2);
  }
}
