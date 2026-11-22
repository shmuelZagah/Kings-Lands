/**
 * Kings Lands — Unit & Company Selection Controller
 * (src/ui/input/unitSelectionController.js)
 *
 * Manages selected company IDs, marquee box selection, double-click & Ctrl+click
 * local-radius class selection (with Shift additive support), and friendly company state aggregation.
 *
 * Pre-Phase 6 Fix (Part 0.1):
 * - Cavalry companies initialize to `FormationTypes.SQUARE` and synchronize their authoritative
 *   formation from `simBridge.getEconomyState().companyStates` on every update.
 */

import * as THREE from 'three';
import { toFx } from '../../core/fx.js';
import { EventTypes } from '../../core/eventBus.js';
import { IndexToUnitType } from '../../sim/gameState.js';
import { FormationTypes, sanitizeFormationForUnit } from '../../sim/formations/formations.js';
import { resolveDefaultFormation } from '../../sim/formations/company.js';
import engineConfig from '../../data/engineConfig.json';

export const SAME_TYPE_SELECT_RADIUS_METERS = 65;

export class UnitSelectionController {
  constructor({ domElement, camera, simBridge, eventBus, worldPicker }) {
    this.domElement = domElement;
    this.camera = camera;
    this.simBridge = simBridge;
    this.eventBus = eventBus;
    this.worldPicker = worldPicker;

    this.selectedCompanyIds = new Set([0]);
    this.companyFormations = new Map([
      [0, FormationTypes.SQUARE],
      [1, FormationTypes.SQUARE],
      [2, FormationTypes.SPEAR_WALL],
      [3, FormationTypes.SQUARE],
      [4, FormationTypes.SQUARE]
    ]);
    this.companyCustomWidths = new Map();
    this.companyGaitRun = new Map();
    this.controlGroups = new Map();

    this.companyNames = new Map();
    this.companyUnitTypes = new Map();
    const squads = engineConfig?.initialSquads || [];
    for (let i = 0; i < squads.length; i++) {
      this.companyNames.set(i, squads[i].name || `Company #${i + 1}`);
      this.companyUnitTypes.set(i, squads[i].unitType || 'swordsman');
    }

    this._lastSelectionSignature = '';
    this._lastClickedUnit = null;
    this._projVec = new THREE.Vector3();
    this._buildMarqueeDom();
  }

  _buildMarqueeDom() {
    const existingMarquee = document.getElementById('marquee-selection-box');
    if (existingMarquee) existingMarquee.remove();

    this.marqueeEl = document.createElement('div');
    this.marqueeEl.id = 'marquee-selection-box';
    this.marqueeEl.className =
      'pointer-events-none fixed z-30 hidden border-2 border-amber-400/90 bg-amber-400/15 rounded-sm shadow-lg';
    document.body.appendChild(this.marqueeEl);
  }

  showMarqueeRect(x0, y0, x1, y1) {
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const width = Math.abs(x1 - x0);
    const height = Math.abs(y1 - y0);
    this.marqueeEl.style.left = `${left}px`;
    this.marqueeEl.style.top = `${top}px`;
    this.marqueeEl.style.width = `${width}px`;
    this.marqueeEl.style.height = `${height}px`;
    this.marqueeEl.classList.remove('hidden');
  }

  hideMarquee() {
    this.marqueeEl.classList.add('hidden');
  }

  isCompanySelected(companyId) {
    return this.selectedCompanyIds.has(companyId | 0);
  }

  gatherFriendlyCompanies() {
    const { entities } = this.simBridge.getInterpolatedState(performance.now());
    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
    const companies = new Map();

    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (ent.team !== 1 || ent.hp <= 0 || ent.isGarrisoned) continue;
      const cid = ent.companyId ?? 0;
      if (!companies.has(cid)) {
        const unitType = ecoStates[cid]?.unitType || IndexToUnitType[ent.unitTypeIdx] || 'swordsman';
        this.companyUnitTypes.set(cid, unitType);

        // Synchronize formation from authoritative simulation state (`ecoStates[cid].formation`)
        const simFormation = ecoStates[cid]?.formation;
        const defaultForm = resolveDefaultFormation(unitType);
        if (simFormation) {
          this.companyFormations.set(cid, sanitizeFormationForUnit(unitType, simFormation, ecoStates[cid]?.activeLoadoutIdx || 0, ecoStates[cid]?.allowedFormations));
        } else if (!this.companyFormations.has(cid)) {
          this.companyFormations.set(cid, defaultForm);
        }

        companies.set(cid, {
          companyId: cid,
          name: ecoStates[cid]?.name || this.companyNames.get(cid) || `${unitType.toUpperCase()} CO.`,
          unitType,
          unitTypeIdx: ent.unitTypeIdx | 0,
          heroVisualIdx: (ent.carryType | 0) & 0x07,
          isCavalry: unitType === 'cavalry',
          unitCount: 0,
          movingCount: 0,
          runningCount: 0,
          workingCount: 0,
          totalHp: 0,
          totalMaxHp: 0,
          sumX: 0,
          sumZ: 0,
          leaderX: ent.x,
          leaderZ: ent.z,
          hasLeader: false,
          formation: sanitizeFormationForUnit(unitType, this.companyFormations.get(cid), ecoStates[cid]?.activeLoadoutIdx || 0, ecoStates[cid]?.allowedFormations),
          customWidthFx: this.companyCustomWidths.get(cid) || 0
        });
      }
      const c = companies.get(cid);
      c.unitCount++;
      if (ent.role === 1 || !c.hasLeader) {
        c.leaderX = ent.x;
        c.leaderZ = ent.z;
        if (ent.role === 1) c.hasLeader = true;
      }
      if (ent.animState === 1 || ent.animState === 2) c.movingCount++;
      if (ent.animState === 2) c.runningCount++;
      if (ent.animState === 8 || ent.animState === 9 || ent.animState === 10 || ent.animState === 11) {
        c.workingCount++;
      }
      c.sumX += ent.x;
      c.sumZ += ent.z;
    }

    for (const c of companies.values()) {
      c.centerX = c.sumX / Math.max(1, c.unitCount);
      c.centerZ = c.sumZ / Math.max(1, c.unitCount);
      c.anchorXFx = toFx(c.centerX);
      c.anchorZFx = toFx(c.centerZ);
    }
    return companies;
  }

  getSelectedWorkerCompanyIds(friendlyMap = null) {
    const friendly = friendlyMap || this.gatherFriendlyCompanies();
    const workerIds = [];
    for (const cid of this.selectedCompanyIds) {
      const comp = friendly.get(cid);
      const uType = comp ? comp.unitType : this.companyUnitTypes.get(cid);
      if (uType === 'worker') {
        workerIds.push(cid);
      }
    }
    return workerIds;
  }

  buildSelectedCompanyDescriptors(friendlyMap = null) {
    const friendly = friendlyMap || this.gatherFriendlyCompanies();
    const descriptors = [];
    for (const cid of this.selectedCompanyIds) {
      const c = friendly.get(cid);
      if (c) descriptors.push(c);
    }
    descriptors.sort((a, b) => a.companyId - b.companyId);
    return descriptors;
  }

  emitSelectionChanged(friendlyMap = null) {
    if (!this.eventBus) return;
    const friendly = friendlyMap || this.gatherFriendlyCompanies();
    const selectedIds = Array.from(this.selectedCompanyIds);
    const workerCompanyIds = this.getSelectedWorkerCompanyIds(friendly);

    const sig = `${selectedIds.join(',')}|w:${workerCompanyIds.join(',')}`;
    this._lastSelectionSignature = sig;

    this.eventBus.emit(EventTypes.SELECTION_CHANGED, {
      selectedCompanyIds: selectedIds,
      workerCompanyIds,
      hasWorkerSelected: workerCompanyIds.length > 0
    });
  }

  pruneMissingSelections(friendlyMap) {
    if (!friendlyMap || friendlyMap.size === 0) return false;
    let pruned = false;
    for (const cid of Array.from(this.selectedCompanyIds)) {
      if (!friendlyMap.has(cid)) {
        this.selectedCompanyIds.delete(cid);
        pruned = true;
      }
    }
    if (pruned) {
      this.emitSelectionChanged(friendlyMap);
    }
    return pruned;
  }

  selectCompanyByClick(clientX, clientY, additiveShift = false) {
    const picked = this.worldPicker.findNearestUnitOnScreen(clientX, clientY, 1, 38);
    if (!picked) {
      this._lastClickedUnit = null;
      if (!additiveShift) {
        this.selectedCompanyIds.clear();
        this.emitSelectionChanged();
        return false;
      }
      return true;
    }

    this._lastClickedUnit = {
      id: picked.id,
      companyId: picked.companyId ?? 0,
      unitTypeIdx: picked.unitTypeIdx,
      x: picked.x,
      z: picked.z,
      clientX,
      clientY,
      timeMs: performance.now()
    };

    const cid = picked.companyId ?? 0;
    if (additiveShift) {
      if (this.selectedCompanyIds.has(cid)) this.selectedCompanyIds.delete(cid);
      else this.selectedCompanyIds.add(cid);
    } else {
      this.selectedCompanyIds.clear();
      this.selectedCompanyIds.add(cid);
    }
    this.emitSelectionChanged();
    return true;
  }

  selectCompaniesInMarquee(minX, minY, maxX, maxY, additiveShift = false) {
    const rect = this.domElement.getBoundingClientRect();
    const { entities } = this.simBridge.getInterpolatedState(performance.now());
    const matched = new Set();

    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (ent.team !== 1 || ent.hp <= 0 || ent.isGarrisoned) continue;
      const heights = [0.2, 1.1, 2.0];
      for (let hIdx = 0; hIdx < heights.length; hIdx++) {
        this._projVec.set(ent.x, ent.y + heights[hIdx], ent.z).project(this.camera);
        if (this._projVec.z > 1 || this._projVec.z < -1) continue;
        const sx = ((this._projVec.x + 1) * 0.5) * rect.width + rect.left;
        const sy = ((-this._projVec.y + 1) * 0.5) * rect.height + rect.top;
        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
          matched.add(ent.companyId ?? 0);
          break;
        }
      }
    }

    if (!additiveShift) this.selectedCompanyIds.clear();
    for (const cid of matched) this.selectedCompanyIds.add(cid);
    this.emitSelectionChanged();
  }

  selectAllOfSameUnitType(clientX, clientY, additiveShift = false) {
    const now = performance.now();
    let picked = null;

    // Lock onto the exact unit clicked on the first click of the double-click so a passing
    // unit of another class (e.g. Cavalry near Archers) can never hijack the double-click!
    if (
      this._lastClickedUnit &&
      now - this._lastClickedUnit.timeMs <= 450 &&
      Math.hypot(clientX - this._lastClickedUnit.clientX, clientY - this._lastClickedUnit.clientY) <= 22
    ) {
      picked = this._lastClickedUnit;
    } else {
      picked = this.worldPicker.findNearestUnitOnScreen(clientX, clientY, 1, 38);
    }

    if (!picked) return false;

    const targetClass = picked.unitTypeIdx;
    const expectedUnitType = IndexToUnitType[targetClass] || null;
    const originX = picked.x;
    const originZ = picked.z;
    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};

    if (!additiveShift) {
      this.selectedCompanyIds.clear();
    }

    const { entities } = this.simBridge.getInterpolatedState(now);
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (
        ent.team === 1 &&
        ent.hp > 0 &&
        !ent.isGarrisoned &&
        ent.unitTypeIdx === targetClass
      ) {
        const cid = ent.companyId ?? 0;
        const compType = ecoStates[cid]?.unitType || this.companyUnitTypes.get(cid);
        if (expectedUnitType && compType && compType !== expectedUnitType) {
          continue;
        }
        const dist = Math.hypot(ent.x - originX, ent.z - originZ);
        if (dist <= SAME_TYPE_SELECT_RADIUS_METERS) {
          this.selectedCompanyIds.add(cid);
        }
      }
    }
    this.emitSelectionChanged();
    return true;
  }

  getIdleWorkerCompanies(friendlyMap = null) {
    const friendly = friendlyMap || this.gatherFriendlyCompanies();
    const ecoStates = this.simBridge.getEconomyState?.()?.companyStates || {};
    const idleWorkers = [];

    for (const c of friendly.values()) {
      if (c.unitType !== 'worker') continue;
      const st = ecoStates[c.companyId];
      const isBusy =
        Boolean(st?.isWorking) ||
        (st?.gatherState || 0) !== 0 ||
        Boolean(st?.buildQueueBuildingIds && st.buildQueueBuildingIds.length > 0) ||
        (st?.activeBuildTargetId || 0) > 0 ||
        (st?.activeDropoffBuildingId || 0) > 0 ||
        Boolean(st?.hasPendingGather) ||
        (st?.orderType !== undefined && st.orderType !== 0 && st.orderType !== 4) ||
        (st?.queuedOrders || 0) > 0 ||
        (c.movingCount || 0) > 0 ||
        (c.workingCount || 0) > 0;
      if (!isBusy) {
        idleWorkers.push(c);
      }
    }

    idleWorkers.sort((a, b) => a.companyId - b.companyId);
    return idleWorkers;
  }

  selectNextIdleWorker(focusCamera = true) {
    const idleWorkers = this.getIdleWorkerCompanies();
    if (idleWorkers.length === 0) return false;

    this._lastIdleWorkerIdx = ((this._lastIdleWorkerIdx ?? -1) + 1) % idleWorkers.length;
    const chosen = idleWorkers[this._lastIdleWorkerIdx];

    this.selectedCompanyIds.clear();
    this.selectedCompanyIds.add(chosen.companyId);
    this.emitSelectionChanged();

    if (focusCamera && this.eventBus) {
      this.eventBus.emit(EventTypes.CAMERA_FOCUS_EVENT, {
        x: chosen.centerX,
        z: chosen.centerZ
      });
    }
    return true;
  }

  selectAllIdleWorkers() {
    const idleWorkers = this.getIdleWorkerCompanies();
    if (idleWorkers.length === 0) return false;

    this.selectedCompanyIds.clear();
    for (let i = 0; i < idleWorkers.length; i++) {
      this.selectedCompanyIds.add(idleWorkers[i].companyId);
    }
    this.emitSelectionChanged();
    return true;
  }

  assignControlGroup(groupNumber) {
    if (this.selectedCompanyIds.size === 0) return false;
    const orderedIds = Array.from(this.selectedCompanyIds);
    this.controlGroups.set(groupNumber | 0, orderedIds);
    return true;
  }

  selectControlGroup(groupNumber, focusCameraOnDoubleTap = false) {
    const savedIds = this.controlGroups.get(groupNumber | 0);
    if (!Array.isArray(savedIds) || savedIds.length === 0) return false;

    const friendly = this.gatherFriendlyCompanies();
    const validComps = [];
    const validIds = [];
    for (let i = 0; i < savedIds.length; i++) {
      const cid = savedIds[i] | 0;
      const c = friendly.get(cid);
      if (c && c.unitCount > 0) {
        validComps.push(c);
        validIds.push(cid);
      }
    }

    if (validComps.length === 0) return false;
    this.controlGroups.set(groupNumber | 0, validIds);

    this.selectedCompanyIds.clear();
    for (let i = 0; i < validIds.length; i++) {
      this.selectedCompanyIds.add(validIds[i]);
    }
    this.emitSelectionChanged(friendly);

    if (focusCameraOnDoubleTap && this.eventBus) {
      let sumX = 0;
      let sumZ = 0;
      for (let i = 0; i < validComps.length; i++) {
        sumX += validComps[i].centerX;
        sumZ += validComps[i].centerZ;
      }
      const avgX = sumX / validComps.length;
      const avgZ = sumZ / validComps.length;

      let maxSpread = 0;
      for (let i = 0; i < validComps.length; i++) {
        const d = Math.hypot(validComps[i].centerX - avgX, validComps[i].centerZ - avgZ);
        if (d > maxSpread) maxSpread = d;
      }

      // If the companies in the group are scattered (> 48m apart), focus on the FIRST registered company;
      // otherwise focus on the group's combined center!
      const focusTarget =
        maxSpread > 48
          ? { x: validComps[0].centerX, z: validComps[0].centerZ }
          : { x: avgX, z: avgZ };

      this.eventBus.emit(EventTypes.CAMERA_FOCUS_EVENT, focusTarget);
    }
    return true;
  }

  selectAllCombatUnits() {
    const friendly = this.gatherFriendlyCompanies();
    const combatIds = [];
    for (const c of friendly.values()) {
      if (c.unitType !== 'worker') {
        combatIds.push(c.companyId);
      }
    }
    if (combatIds.length === 0) return false;

    this.selectedCompanyIds.clear();
    for (let i = 0; i < combatIds.length; i++) {
      this.selectedCompanyIds.add(combatIds[i]);
    }
    this.emitSelectionChanged(friendly);
    return true;
  }
}
