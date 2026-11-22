/**
 * Kings Lands — Phase 7 HUD Suite:
 * - MinimapHud (Bottom-Left Circular Minimap with 3-State Fog of War, Instant Teleport,
 *   and Protruding Rim Buttons: Reset View, F12 Select All Army, F1 Idle Workers Portrait)
 * - SquadCommandBar (Bottom-Center Selected Squads Panel: 1-3 rows of 10 cards + Arrow Pagination,
 *   Ammo-only indicator bar)
 * - VictoryScreenModal (Victory / Defeat Summary Modal)
 * (src/ui/hud/rtsCursorManager.js)
 */

import { toFx, toFloat } from '../../core/fx.js';
import { CommandTypes } from '../../core/commandBus.js';
import { EventTypes } from '../../core/eventBus.js';
import { sampleTerrainHeightFx, getBridgeCentersMeters } from '../../sim/nav/grid.js';
import { FowState, FOW_GRID_SIZE } from '../../sim/systems/moraleStaminaSystem.js';
import { buildOrbDecorationsSvg } from './hudIcons.js';

const DEFAULT_MINIMAP_ZOOM = 1.0;
const MIN_MINIMAP_ZOOM = 1.0;
const MAX_MINIMAP_ZOOM = 4.5;

export class MinimapHud {
  constructor({
    simBridge,
    cameraController,
    formationPreview,
    commandBus,
    eventBus,
    worldSizeMeters = 4096,
    playerTeam = 1
  }) {
    this.simBridge = simBridge;
    this.cameraController = cameraController;
    this.formationPreview = formationPreview;
    this.commandBus = commandBus;
    this.eventBus = eventBus;
    this.worldSizeMeters = worldSizeMeters;
    this.playerTeam = playerTeam || 1;

    this.zoomFactor = DEFAULT_MINIMAP_ZOOM;
    this.isDraggingCamera = false;
    this._lastRedrawMs = -1000;

    this._worldTerrainColors = new Uint8ClampedArray(FOW_GRID_SIZE * FOW_GRID_SIZE * 4);

    this._buildDom();
    this._precomputeWorldTerrainMap();
    this._bindEvents();
    this.update(typeof performance !== "undefined" ? performance.now() : 100);
  }

  _getBounds() {
    const center = this.worldSizeMeters * 0.5;
    const span = this.worldSizeMeters / Math.max(MIN_MINIMAP_ZOOM, Math.min(MAX_MINIMAP_ZOOM, this.zoomFactor));
    const halfSpan = span * 0.5;
    return {
      minX: Math.max(0, center - halfSpan),
      maxX: Math.min(this.worldSizeMeters, center + halfSpan),
      minZ: Math.max(0, center - halfSpan),
      maxZ: Math.min(this.worldSizeMeters, center + halfSpan)
    };
  }

  _buildDom() {
    const existing = document.getElementById('phase7-minimap-orb');
    if (existing) existing.remove();

    this.rootEl = document.createElement('aside');
    this.rootEl.id = 'phase7-minimap-orb';
    // overflow-visible so the circular rim buttons can sit on the border and protrude outward!
    this.rootEl.className =
      'fixed bottom-3 left-3 z-30 w-[216px] h-[216px] rounded-xl select-none origin-bottom-left overflow-visible pointer-events-auto';

    this.rootEl.innerHTML = `
      <div
        class="absolute inset-0 rounded-xl border-2 border-amber-400/70 backdrop-blur-md overflow-hidden pointer-events-none"
        style="background-image: linear-gradient(rgba(8,12,20,0.35), rgba(8,12,20,0.55)), url('/assets/hud_minimap_frame.jpg'); background-size: cover; background-position: center; box-shadow: 0 14px 36px rgba(0, 0, 0, 0.95), inset 0 2px 6px rgba(251, 191, 36, 0.35);"
      >
        ${buildOrbDecorationsSvg('M 38 68 Q 129 56 220 68')}
      </div>

      <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div class="relative w-[192px] h-[192px] rounded-lg border-2 border-amber-400/75 shadow-[0_0_18px_rgba(0,0,0,0.95),inset_0_0_14px_rgba(0,0,0,0.9)] overflow-hidden bg-slate-950 pointer-events-auto">
          <canvas id="phase7-minimap-canvas" width="256" height="256" class="w-full h-full block cursor-crosshair"></canvas>
          <span class="pointer-events-none absolute top-1 left-1/2 -translate-x-1/2 text-[8px] font-black text-amber-300/80 drop-shadow">N</span>
          <span class="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-black text-slate-400/75 drop-shadow">S</span>
          <span class="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] font-black text-slate-400/75 drop-shadow">W</span>
          <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] font-black text-slate-400/75 drop-shadow">E</span>
        </div>
      </div>

      <!-- Rim Button 1: Reset Camera Angle & Zoom (protruding top-right of minimap rim) -->
      <button
        id="minimap-btn-reset"
        type="button"
        title="Reset Camera Angle & Zoom Distance"
        class=" group absolute top-[8px] -right-[18px] z-30 w-9 h-9 rounded-full border-2 border-amber-400/85 bg-slate-950/95 hover:bg-slate-800 hover:border-amber-300 text-amber-300 flex items-center justify-center shadow-[0_4px_14px_rgba(0,0,0,0.9)] cursor-pointer transition-transform active:scale-95"
      >
        <svg class="w-4 h-4 text-amber-300 group-hover:rotate-[-45deg] transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
          <polyline points="3 3 3 8 8 8"/>
        </svg>
      </button>

      <!-- Rim Button 2: Select All Army (F12) protruding on the upper-right rim -->
      <button
        id="minimap-btn-all-army"
        type="button"
        title="Select All Combat Squads (F12 / F2)"
        class=" group absolute top-[54px] -right-[22px] z-30 w-11 h-11 rounded-full border-2 border-amber-400/90 bg-slate-950/95 hover:bg-slate-900 hover:border-sky-300 flex flex-col items-center justify-center shadow-[0_6px_18px_rgba(0,0,0,0.92)] cursor-pointer transition-transform active:scale-95"
      >
        <span
          id="minimap-badge-army-count"
          class="pointer-events-none absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full border border-amber-300/80 bg-sky-950 text-[9px] font-black text-sky-200 flex items-center justify-center shadow mono"
        >
          0
        </span>
        <svg class="w-5 h-5 text-sky-300 group-hover:text-amber-300 transition-colors -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" fill=" rgba(14,116,144,0.28)"/>
          <path d="M8.5 8.5l7 7"/>
          <path d="M15.5 8.5l-7 7"/>
        </svg>
        <span class="pointer-events-none absolute -bottom-1.5 px-1 rounded bg-slate-950 border border-amber-400/70 text-[8px] font-black text-amber-300 leading-tight mono shadow">
          F12
        </span>
      </button>

      <!-- Rim Button 3: Idle Worker Face Button (F1) protruding on the right side of the minimap (hidden when 0 idle workers) -->
      <button
        id="minimap-btn-idle-worker"
        type="button"
        title="Select Next Idle Worker (F1) — Ctrl+Click to Select All Idle Workers"
        style="display: none;"
        class=" group absolute top-[112px] -right-[24px] z-30 w-12 h-12 rounded-full border-2 border-amber-300 bg-slate-950/95 hover:bg-amber-950/80 hover:border-amber-200 flex flex-col items-center justify-center shadow-[0_6px_20px_rgba(0,0,0,0.95),0_0_12px_rgba(251,191,36,0.35)] cursor-pointer transition-transform active:scale-95"
      >
        <span
          id="minimap-badge-worker-count"
          class="pointer-events-none absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full border border-amber-200 bg-amber-500 text-[10px] font-black text-slate-950 flex items-center justify-center shadow-md mono"
        >
          1
        </span>
        <!-- Worker Face with Builder Helmet & Hammer SVG -->
        <svg class="w-6 h-6 text-amber-200 group-hover:scale-105 transition-transform -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <!-- Builder Dome Helmet -->
          <path d="M5 10a7 7 0 0 1 14 0" fill="rgba(245,158,11,0.35)"/>
          <path d="M3.5 10h17"/>
          <!-- Worker Head / Face -->
          <circle cx="12" cy="13.5" r="5" fill="rgba(253,230,138,0.18)"/>
          <circle cx="10.2" cy="13" r="0.7" fill="currentColor"/>
          <circle cx="13.8" cy="13" r="0.7" fill="currentColor"/>
          <path d="M10 15.8c1.1 0.8 2.9 0.8 4 0"/>
        </svg>
        <span class="pointer-events-none absolute -bottom-1.5 px-1.5 rounded bg-slate-950 border border-amber-400/80 text-[8.5px] font-black text-amber-300 leading-tight mono shadow">
          F1
        </span>
      </button>
    `;

    document.body.appendChild(this.rootEl);
    this.canvas = this.rootEl.querySelector('#phase7-minimap-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.resetBtnEl = this.rootEl.querySelector('#minimap-btn-reset');
    this.allArmyBtnEl = this.rootEl.querySelector('#minimap-btn-all-army');
    this.armyCountBadgeEl = this.rootEl.querySelector('#minimap-badge-army-count');
    this.idleWorkerBtnEl = this.rootEl.querySelector('#minimap-btn-idle-worker');
    this.workerCountBadgeEl = this.rootEl.querySelector('#minimap-badge-worker-count');

    this._imgData = this.ctx.createImageData(FOW_GRID_SIZE, FOW_GRID_SIZE);
    this._offscreenCanvas = document.createElement('canvas');
    this._offscreenCanvas.width = FOW_GRID_SIZE;
    this._offscreenCanvas.height = FOW_GRID_SIZE;
    this._offscreenCtx = this._offscreenCanvas.getContext('2d');
  }

  _sampleColorForWorld(wx, wz) {
    const h = toFloat(sampleTerrainHeightFx(toFx(wx), toFx(wz), false, this.worldSizeMeters));
    const bridgeXs = getBridgeCentersMeters(this.worldSizeMeters * 0.5);
    let minRoadDist = Infinity;
    for (let b = 0; b < bridgeXs.length; b++) {
      const d = Math.abs(wx - bridgeXs[b]);
      if (d < minRoadDist) minRoadDist = d;
    }

    if (minRoadDist <= 10 && Math.abs(wz - this.worldSizeMeters * 0.5) <= 24) {
      return [148, 141, 126];
    }
    if (h < -0.45) {
      return [28, 92, 126];
    }
    if (h <= 0.22) {
      return [146, 134, 102];
    }
    if (minRoadDist < 11 && Math.abs(wz - this.worldSizeMeters * 0.5) < 420) {
      return [115, 108, 95];
    }
    if (h < 4.6) {
      return [62, 106, 52];
    }
    if (h < 8.0) {
      return [88, 118, 62];
    }
    return [118, 112, 102];
  }

  _precomputeWorldTerrainMap() {
    const size = FOW_GRID_SIZE;
    for (let cz = 0; cz < size; cz++) {
      const wz = ((cz + 0.5) / size) * this.worldSizeMeters;
      for (let cx = 0; cx < size; cx++) {
        const wx = ((cx + 0.5) / size) * this.worldSizeMeters;
        const idx = (cz * size + cx) * 4;
        const [r, g, b] = this._sampleColorForWorld(wx, wz);
        this._worldTerrainColors[idx + 0] = r;
        this._worldTerrainColors[idx + 1] = g;
        this._worldTerrainColors[idx + 2] = b;
        this._worldTerrainColors[idx + 3] = 255;
      }
    }
  }

  _teleportCameraTo(wx, wz) {
    if (!this.cameraController) return;
    const minCoord = 20;
    const maxCoord = this.worldSizeMeters - 20;
    const cx = Math.max(minCoord, Math.min(maxCoord, wx));
    const cz = Math.max(minCoord, Math.min(maxCoord, wz));
    if (this.cameraController.target) {
      this.cameraController.target.x = cx;
      this.cameraController.target.z = cz;
    }
    if (this.cameraController.desiredTarget) {
      this.cameraController.desiredTarget.x = cx;
      this.cameraController.desiredTarget.z = cz;
    }
    this.cameraController._applyCameraTransform?.(1.0);
  }

  _findHomeBaseCoords() {
    const buildings = this.simBridge.getInterpolatedBuildings?.() || [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (b && b.team === this.playerTeam && b.type === 'citadel' && b.hp > 0) {
        return { x: b.x, z: b.z };
      }
    }
    return { x: this.worldSizeMeters * 0.5, z: this.worldSizeMeters * 0.42 };
  }

  _canvasEventToWorld(e) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const nz = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    const bounds = this._getBounds();
    return {
      x: bounds.minX + nx * (bounds.maxX - bounds.minX),
      z: bounds.minZ + nz * (bounds.maxZ - bounds.minZ)
    };
  }

  _worldToCanvasPx(wx, wz, bounds) {
    const nx = (wx - bounds.minX) / (bounds.maxX - bounds.minX);
    const nz = (wz - bounds.minZ) / (bounds.maxZ - bounds.minZ);
    return {
      px: nx * FOW_GRID_SIZE,
      py: nz * FOW_GRID_SIZE,
      inBounds: nx >= 0 && nx <= 1 && nz >= 0 && nz <= 1
    };
  }

  _bindEvents() {
    this.rootEl.addEventListener('mousedown', (e) => e.stopPropagation());
    this.rootEl.addEventListener('mouseup', (e) => {
      this.isDraggingCamera = false;
      e.stopPropagation();
    });
    this.rootEl.addEventListener('dblclick', (e) => e.stopPropagation());
    this.rootEl.addEventListener('contextmenu', (e) => e.preventDefault());

    // Disable mouse-wheel zooming on the minimap while blocking wheel propagation to the 3D camera
    this.rootEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      { passive: false }
    );

    // Reset button: resets camera angle (yaw/pitch) & zoom distance to initial defaults at current location
    this.resetBtnEl?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isDraggingCamera = false;
      this.zoomFactor = DEFAULT_MINIMAP_ZOOM;
      this.cameraController?.resetViewOrientationAndZoom?.();
      this._lastRedrawMs = 0;
      this.update(performance.now());
    });

    // F12 All Army button
    this.allArmyBtnEl?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isDraggingCamera = false;
      this.formationPreview?.buildingRadialMenuRef?.close?.();
      if (this.formationPreview?.selection?.selectAllCombatUnits?.()) {
        this.formationPreview?.synthAudio?.playHornAlert?.();
        this.formationPreview?._refreshRadialPanelUI?.();
      }
    });

    // F1 Idle Worker button
    this.idleWorkerBtnEl?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.isDraggingCamera = false;
      this.formationPreview?.buildingRadialMenuRef?.close?.();
      const sel = this.formationPreview?.selection;
      if (!sel) return;
      const matched =
        e.ctrlKey || e.metaKey
          ? sel.selectAllIdleWorkers?.()
          : sel.selectNextIdleWorker?.(true);
      if (matched) {
        this.formationPreview?.synthAudio?.playFocusWhoosh?.();
        this.formationPreview?._refreshRadialPanelUI?.();
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.button === 0) {
        const pos = this._canvasEventToWorld(e);
        if (this.formationPreview?.targetingMode === 'SPELL_TARGET') {
          this.formationPreview.commitPendingSpellAtWorld?.(pos.x, pos.z, null);
          this._lastRedrawMs = 0;
          return;
        }
        if (
          this.formationPreview &&
          (this.formationPreview.targetingMode === 'PATROL' ||
            this.formationPreview.targetingMode === 'ATTACK_MOVE') &&
          this.formationPreview.selectedCompanyIds?.size > 0
        ) {
          this.formationPreview.issueMinimapOrderAtWorld?.(
            pos.x,
            pos.z,
            e,
            this.formationPreview.targetingMode
          );
          this._lastRedrawMs = 0;
          return;
        }
        this.isDraggingCamera = true;
        this._teleportCameraTo(pos.x, pos.z);
        this._lastRedrawMs = 0;
      } else if (e.button === 2) {
        const pos = this._canvasEventToWorld(e);

        // 1. If rally-capable buildings are selected, right-clicking on the minimap sets their Rally Point Flag!
        const selectedBlds = this.formationPreview?.buildingRadialMenuRef?.getSelectedBuildings?.() || [];
        if (selectedBlds.length > 0 && this.commandBus) {
          const rallyableBlds = selectedBlds.filter(
            (b) =>
              b.team === this.playerTeam &&
              !b.isPassiveAoE &&
              b.type !== 'citadel_slot' &&
              b.type !== 'ballista_tower' &&
              b.type !== 'house'
          );
          if (rallyableBlds.length > 0) {
            this.commandBus.issue(CommandTypes.SET_BUILDING_RALLY, {
              team: this.playerTeam,
              buildingId: rallyableBlds[0].id,
              buildingIds: rallyableBlds.map((b) => b.id),
              xFx: toFx(pos.x),
              zFx: toFx(pos.z)
            });
            this.formationPreview?.spawnEphemeralClickMarker?.(
              { x: pos.x, z: pos.z },
              'RALLY',
              1.25
            );
            this.formationPreview?.synthAudio?.playFocusWhoosh?.();
            this._lastRedrawMs = 0;
            this.update(performance.now());
            return;
          }
        }

        // 2. Otherwise, if units/companies are selected, route through FormationPreview3D so Shift-queued dashed lines are rendered!
        const selectedIds = Array.from(this.formationPreview?.selectedCompanyIds || []);
        if (selectedIds.length > 0 && this.formationPreview) {
          this.formationPreview.issueMinimapOrderAtWorld?.(pos.x, pos.z, e, null);
          this._lastRedrawMs = 0;
        }
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isDraggingCamera = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDraggingCamera) return;
      if ((e.buttons & 1) === 0) {
        this.isDraggingCamera = false;
        return;
      }
      const pos = this._canvasEventToWorld(e);
      this._teleportCameraTo(pos.x, pos.z);
    });

    // Capture phase listener guarantees mouseup is NEVER swallowed by stopPropagation!
    window.addEventListener(
      'mouseup',
      () => {
        this.isDraggingCamera = false;
      },
      true
    );

    window.addEventListener('blur', () => {
      this.isDraggingCamera = false;
    });
  }

  _syncRimButtonsState() {
    const sel = this.formationPreview?.selection;
    if (!sel) return;

    const friendly = sel.gatherFriendlyCompanies?.();
    if (!friendly) return;

    const idleWorkerComps = sel.getIdleWorkerCompanies?.(friendly) || [];
    const idleWorkerSquadCount = idleWorkerComps.length;

    if (this.idleWorkerBtnEl) {
      if (idleWorkerSquadCount > 0) {
        this.idleWorkerBtnEl.style.display = 'flex';
        if (this.workerCountBadgeEl) {
          this.workerCountBadgeEl.textContent = String(idleWorkerSquadCount);
        }
      } else {
        this.idleWorkerBtnEl.style.display = 'none';
      }
    }

    let combatSquadCount = 0;
    for (const c of friendly.values()) {
      if (c.unitType !== 'worker' && c.unitCount > 0) {
        combatSquadCount++;
      }
    }
    if (this.armyCountBadgeEl) {
      this.armyCountBadgeEl.textContent = String(combatSquadCount);
    }
  }

  update(nowMs = performance.now()) {
    if (nowMs - this._lastRedrawMs < 65 && !this.isDraggingCamera) return;
    this._lastRedrawMs = nowMs;

    this._syncRimButtonsState();

    const fowGrid = this.simBridge.getFowGrid?.();
    const bounds = this._getBounds();
    const worldColors = this._worldTerrainColors;
    const dst = this._imgData.data;
    const size = FOW_GRID_SIZE;
    const cellMeters = this.worldSizeMeters / size;

    for (let py = 0; py < size; py++) {
      const wz = bounds.minZ + ((py + 0.5) / size) * (bounds.maxZ - bounds.minZ);
      const cz = Math.max(0, Math.min(size - 1, Math.floor(wz / cellMeters)));
      const fowRow = cz * size;

      for (let px = 0; px < size; px++) {
        const idx = (py * size + px) * 4;
        const wx = bounds.minX + ((px + 0.5) / size) * (bounds.maxX - bounds.minX);
        const cx = Math.max(0, Math.min(size - 1, Math.floor(wx / cellMeters)));
        const cellIdx = fowRow + cx;
        const cIdx4 = cellIdx * 4;
        const state = fowGrid ? fowGrid[cellIdx] : FowState.VISIBLE;

        if (state === FowState.UNEXPLORED) {
          dst[idx + 0] = 6;
          dst[idx + 1] = 10;
          dst[idx + 2] = 18;
          dst[idx + 3] = 255;
        } else if (state === FowState.EXPLORED) {
          dst[idx + 0] = (worldColors[cIdx4 + 0] * 0.42) | 0;
          dst[idx + 1] = (worldColors[cIdx4 + 1] * 0.44) | 0;
          dst[idx + 2] = Math.min(255, ((worldColors[cIdx4 + 2] * 0.52) | 0) + 12);
          dst[idx + 3] = 255;
        } else {
          dst[idx + 0] = worldColors[cIdx4 + 0];
          dst[idx + 1] = worldColors[cIdx4 + 1];
          dst[idx + 2] = worldColors[cIdx4 + 2];
          dst[idx + 3] = 255;
        }
      }
    }

    this._offscreenCtx.putImageData(this._imgData, 0, 0);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this._offscreenCanvas, 0, 0);

    const getCellStateAtMeters = (wx, wz) => {
      if (!fowGrid) return FowState.VISIBLE;
      const cx = Math.max(0, Math.min(size - 1, Math.floor(wx / cellMeters)));
      const cz = Math.max(0, Math.min(size - 1, Math.floor(wz / cellMeters)));
      return fowGrid[cz * size + cx];
    };

    const eco = this.simBridge.getEconomyState?.();
    const mines = eco?.mines || [];
    ctx.fillStyle = '#facc15';
    for (let i = 0; i < mines.length; i++) {
      const m = mines[i];
      if (getCellStateAtMeters(m.x, m.z) === FowState.UNEXPLORED) continue;
      const { px, py, inBounds } = this._worldToCanvasPx(m.x, m.z, bounds);
      if (!inBounds) continue;
      ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
    }

    const buildings = this.simBridge.getInterpolatedBuildings?.() || [];
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (!b || b.type === 'citadel_slot' || b.hp <= 0) continue;
      const cellState = getCellStateAtMeters(b.x, b.z);
      const isAlliedB = this.simBridge.isAlliedWithPlayer
        ? this.simBridge.isAlliedWithPlayer(b.team)
        : b.team === this.playerTeam;
      if (!isAlliedB && cellState === FowState.UNEXPLORED) continue;

      const { px, py, inBounds } = this._worldToCanvasPx(b.x, b.z, bounds);
      if (!inBounds) continue;
      const r = b.type === 'citadel' ? 4.5 : 3.0;
      ctx.fillStyle =
        b.team === this.playerTeam
          ? '#38bdf8'
          : isAlliedB
            ? '#10b981'
            : cellState === FowState.VISIBLE
              ? '#ef4444'
              : '#991b1b';
      ctx.strokeStyle = '#020617';
      ctx.lineWidth = 1;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
      ctx.strokeRect(px - r, py - r, r * 2, r * 2);
    }

    // Draw selected buildings' rally lines and flag markers on the minimap
    const selectedBlds = this.formationPreview?.buildingRadialMenuRef?.getSelectedBuildings?.() || [];
    if (selectedBlds.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.fillStyle = '#fbbf24';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([3, 2]);
      for (let i = 0; i < selectedBlds.length; i++) {
        const b = selectedBlds[i];
        if (
          b &&
          b.team === this.playerTeam &&
          !b.isPassiveAoE &&
          b.type !== 'citadel_slot' &&
          b.type !== 'ballista_tower' &&
          b.type !== 'house' &&
          typeof b.rallyX === 'number' &&
          typeof b.rallyZ === 'number'
        ) {
          const bPt = this._worldToCanvasPx(b.x, b.z, bounds);
          const rPt = this._worldToCanvasPx(b.rallyX, b.rallyZ, bounds);
          ctx.beginPath();
          ctx.moveTo(bPt.px, bPt.py);
          ctx.lineTo(rPt.px, rPt.py);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(rPt.px, rPt.py, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    const { entities } = this.simBridge.getInterpolatedState(nowMs);
    const selectedSet = this.formationPreview?.selectedCompanyIds || new Set();

    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;

      const isAlliedU = this.simBridge.isAlliedWithPlayer
        ? this.simBridge.isAlliedWithPlayer(ent.team)
        : ent.team === this.playerTeam;
      if (!isAlliedU) {
        const isVis =
          ent.isRevealedLastStand || getCellStateAtMeters(ent.x, ent.z) === FowState.VISIBLE;
        if (!isVis) continue;
      }

      const { px, py, inBounds } = this._worldToCanvasPx(ent.x, ent.z, bounds);
      if (!inBounds) continue;

      if (ent.team === this.playerTeam) {
        const isSelected = selectedSet.has(ent.companyId);
        ctx.fillStyle = ent.isRouting ? '#fde047' : isSelected ? '#7dd3fc' : '#0284c7';
        ctx.fillRect(px - 1.3, py - 1.3, 2.6, 2.6);
      } else if (isAlliedU) {
        ctx.fillStyle = ent.isRouting ? '#fde047' : '#10b981';
        ctx.fillRect(px - 1.3, py - 1.3, 2.6, 2.6);
      } else {
        // Enemy units (including Last Stand workers): simple red dots without flashing beacon circles
        ctx.fillStyle = ent.isRouting ? '#fca5a5' : '#ef4444';
        ctx.fillRect(px - 1.4, py - 1.4, 2.8, 2.8);
      }
    }

    if (this.cameraController?.target) {
      const camX = this.cameraController.target.x;
      const camZ = this.cameraController.target.z;
      const dist = this.cameraController.distance || 88;
      const { px, py } = this._worldToCanvasPx(camX, camZ, bounds);
      const spanWorld = dist * 1.15;
      const boxW = (spanWorld / (bounds.maxX - bounds.minX)) * size;
      const boxH = (spanWorld * 0.72 / (bounds.maxZ - bounds.minZ)) * size;

      ctx.strokeStyle = 'rgba(251, 191, 36, 0.92)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px - boxW * 0.5, py - boxH * 0.5, boxW, boxH);
    }
  }
}

