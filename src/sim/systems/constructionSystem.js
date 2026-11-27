import { simBuildings } from '../simConfig.js';
import { isPartEffectivelyActive, resolvePartPosition } from '../../data/buildingParts.js';
import { getActiveCustomMapState } from "../../tools/map_editor/mapStateManager.js";
import {
  FX_ONE,
  PERMILLE_ONE,
  ANGLE_MASK,
  mulDiv,
  fxClamp,
  fxSin,
  fxCos,
  fxAtan2,
  fxHypot
} from '../../core/fx.js';
import { NavTileType } from '../nav/grid.js';
import {
  CompanyOrderType,
  RUN_STAMINA_THRESHOLD_PERMILLE,
  WORKER_FATIGUE_THRESHOLD_PERMILLE
} from '../formations/company.js';
import { GarrisonSystem } from './garrisonSystem.js';
import { ProductionAndRallySystem } from './productionAndRallySystem.js';
import { BuildingCombatSystem } from './buildingCombatSystem.js';

export const MAX_SLOPE_HEIGHT_DIFF_FX = 2252;
export const CITADEL_SLOT_RING_RADIUS_FX = (10 * FX_ONE + 512) | 0;

export class ConstructionSystem {
  constructor({ navGrid, economySystem, movementSystem }) {
    this.navGrid = navGrid;
    this.economySystem = economySystem;
    this.movementSystem = movementSystem;
    this.buildingDefs = simBuildings().buildings;

    this.buildings = new Map();
    this.sortedBuildingIds = [];
    this.nextBuildingId = 1;

    this.workerBuildQueues = new Map();

    this.garrisonSystem = new GarrisonSystem(this);
    this.productionSystem = new ProductionAndRallySystem(this);
    this.combatSystem = new BuildingCombatSystem(this);
  }

  get pendingGarrisonOrders() {
    return this.garrisonSystem.pendingGarrisonOrders;
  }

  _isBuildingActive(b) {
    if (!b || b.isDestroyed) return false;
    if (b.type === 'citadel_slot') return true;
    return b.hp > 0;
  }

  /**
   * Building parts (stage 2): the first part of `kind` ('fire_point' | 'exit_point') that exists at the building's level,
   * from the STORED `parts` of its definition. Buildings without stored parts return null (legacy behaviour).
   */
  _activeStoredParts(building, kind) {
    const parts = this.buildingDefs?.[building.type]?.parts;
    if (!Array.isArray(parts)) return [];
    const lv = Math.max(1, building.level | 0 || 1);
    return parts.filter((p) => p.kind === kind && isPartEffectivelyActive(parts, p, lv)).map((p) => ({ ...p, pos: resolvePartPosition(parts, p) }));
  }

  /** Part offset (metres, building-local: +Z = the facing direction, +X = to its right) -> world offset in fixed point. */
  _localOffsetToWorldFx(building, lx, lz) {
    const dir = (building.facingDir ?? (building.team === 1 ? 256 : 768)) & ANGLE_MASK;
    const c = fxCos(dir);
    const s = fxSin(dir);
    const xFx = Math.round((Number(lx) || 0) * FX_ONE) | 0;
    const zFx = Math.round((Number(lz) || 0) * FX_ONE) | 0;
    return {
      dxFx: (mulDiv(xFx, s, FX_ONE) + mulDiv(zFx, c, FX_ONE)) | 0,
      dzFx: (-mulDiv(xFx, c, FX_ONE) + mulDiv(zFx, s, FX_ONE)) | 0,
      dir
    };
  }

  _getBuildingDoorVectorFx(building, distanceMeters) {
    const distFx = Math.round(distanceMeters * FX_ONE) | 0;
    const dir = (building.facingDir ?? (building.team === 1 ? 256 : 768)) & ANGLE_MASK;
    return {
      dxFx: mulDiv(distFx, fxCos(dir), FX_ONE),
      dzFx: mulDiv(distFx, fxSin(dir), FX_ONE),
      dir
    };
  }

  _spawnCitadelDefensiveSlots(team, cxFx, czFx) {
    for (let s = 0; s < 6; s++) {
      const angleIdx = ((s * 1024) / 6) | 0;
      const sxFx = (cxFx + mulDiv(CITADEL_SLOT_RING_RADIUS_FX, fxCos(angleIdx), FX_ONE)) | 0;
      const szFx = (czFx + mulDiv(CITADEL_SLOT_RING_RADIUS_FX, fxSin(angleIdx), FX_ONE)) | 0;
      this.createBuilding({
        type: 'citadel_slot',
        team,
        xFx: sxFx,
        zFx: szFx,
        facingDir: angleIdx,
        instantComplete: true,
        bypassValidation: true
      });
    }
  }

  spawnStartingCitadels(matchSetup = null) {
    let teamCenters = null;
    if (matchSetup && matchSetup.useMatchSetup && Array.isArray(matchSetup.participants)) {
      teamCenters = matchSetup.participants
        .filter((p) => p && p.role !== 'closed' && p.controller !== 'closed' && (p.team | 0) > 0)
        .map((p) => ({
          team: p.team | 0,
          x: Number(p.x) || 2048,
          z: Number(p.z) || 1660,
          facingDir: p.facingDir ?? ((p.team | 0) === 1 ? 256 : 768),
          aiSlotIndex: p.controller === 'ai' ? p.slotIndex : null
        }));
    }
    if (!teamCenters || teamCenters.length === 0) {
      const customMap = getActiveCustomMapState();
      const candidatePts = customMap?.isCustomMapActive && Array.isArray(customMap?.spawnPoints) ? customMap.spawnPoints : [];
      const s1 = candidatePts[0] || (customMap?.isCustomMapActive && customMap?.spawns?.team1 ? customMap.spawns.team1 : { x: 2048, z: 1660, facingDir: 256 });
      const s2 = candidatePts[1] || (customMap?.isCustomMapActive && customMap?.spawns?.team2 ? customMap.spawns.team2 : { x: 2048, z: 2420, facingDir: 768 });
      teamCenters = [
        { team: 1, x: s1.x, z: s1.z, facingDir: s1.facingDir ?? 256, aiSlotIndex: null },
        { team: 2, x: s2.x, z: s2.z, facingDir: s2.facingDir ?? 768, aiSlotIndex: 1 }
      ];
    }

    for (let t = 0; t < teamCenters.length; t++) {
      const { team, x, z, facingDir, aiSlotIndex } = teamCenters[t];
      const cxFx = Math.round(x * FX_ONE) | 0;
      const czFx = Math.round(z * FX_ONE) | 0;

      const bld = this.createBuilding({
        type: 'citadel',
        team,
        xFx: cxFx,
        zFx: czFx,
        facingDir,
        instantComplete: true,
        bypassValidation: true,
        skipAutoSlots: true
      });
      if (bld && aiSlotIndex !== undefined && aiSlotIndex !== null) {
        bld.aiSlotIndex = aiSlotIndex;
      }

      this._spawnCitadelDefensiveSlots(team, cxFx, czFx);
    }
  }

  isPlacementValid(type, xFx, zFx, team = 1, checkResources = true) {
    const def = this.buildingDefs[type];
    if (!def) return { valid: false, reason: 'Unknown building type' };

    if (checkResources && !this.economySystem.canAfford(team, def.cost, 'building')) {
      return { valid: false, reason: 'Insufficient resources' };
    }

    const radiusMeters = Number(def.footprintRadiusMeters) || 5;
    const radiusFx = Math.round(radiusMeters * FX_ONE) | 0;
    const worldMinFx = (20 * FX_ONE) | 0;
    const worldMaxFx = (this.navGrid.worldSizeFx - 20 * FX_ONE) | 0;

    if (xFx < worldMinFx || xFx > worldMaxFx || zFx < worldMinFx || zFx > worldMaxFx) {
      return { valid: false, reason: 'Out of bounds' };
    }

    if (this.economySystem?.isOverlappingResourceNode?.(xFx, zFx, radiusFx)) {
      return { valid: false, reason: 'Cannot build on resource nodes' };
    }

    const minTx = this.navGrid.worldFxToTileX(xFx - radiusFx);
    const maxTx = this.navGrid.worldFxToTileX(xFx + radiusFx);
    const minTz = this.navGrid.worldFxToTileZ(zFx - radiusFx);
    const maxTz = this.navGrid.worldFxToTileZ(zFx + radiusFx);

    for (let tz = minTz; tz <= maxTz; tz++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const tileType = this.navGrid.getTileType(tx, tz);
        if (
          tileType === NavTileType.BLOCKED ||
          tileType === NavTileType.MUD_WATER ||
          tileType === NavTileType.BRIDGE
        ) {
          return { valid: false, reason: 'Blocked terrain or water' };
        }
      }
    }

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
    for (let s = 0; s < sampleOffsets.length; s++) {
      const sxFx = (xFx + sampleOffsets[s][0]) | 0;
      const szFx = (zFx + sampleOffsets[s][1]) | 0;
      const hFx = this.navGrid.sampleHeightAtWorldFx(sxFx, szFx);
      if (hFx < minHeightFx) minHeightFx = hFx;
      if (hFx > maxHeightFx) maxHeightFx = hFx;
    }

    if (maxHeightFx - minHeightFx > MAX_SLOPE_HEIGHT_DIFF_FX) {
      return { valid: false, reason: 'Terrain slope is too steep' };
    }

    for (let i = 0; i < this.sortedBuildingIds.length; i++) {
      const other = this.buildings.get(this.sortedBuildingIds[i]);
      if (!this._isBuildingActive(other)) continue;
      const minSepFx = Math.round((radiusMeters + other.footprintRadiusMeters + 2) * FX_ONE) | 0;
      const distFx = fxHypot((xFx - other.xFx) | 0, (zFx - other.zFx) | 0);
      if (distFx < minSepFx) {
        return { valid: false, reason: 'Overlaps another building' };
      }
    }

    return { valid: true, reason: 'OK' };
  }

  _getLockedBuilderCompanyForBuilding(buildingId, companiesMap) {
    if (!companiesMap) return null;
    const bid = buildingId | 0;
    for (const [cid, q] of this.workerBuildQueues.entries()) {
      const comp = companiesMap.get(cid);
      if (!comp || comp.memberIds.length === 0) continue;
      if (comp.activeBuildTargetId === bid && q.length > 0 && q[0] === bid) {
        return cid;
      }
    }
    return null;
  }

  _pickLeastBusyWorkerCompany(workerCompanyIds) {
    let bestCid = workerCompanyIds[0] | 0;
    let bestQueueLen = 0x7fffffff;

    for (let i = 0; i < workerCompanyIds.length; i++) {
      const cid = workerCompanyIds[i] | 0;
      const q = this.workerBuildQueues.get(cid) || [];
      const activeLen = q.filter((bid) => {
        const b = this.buildings.get(bid);
        return Boolean(b && !b.isDestroyed && b.hp > 0 && (!b.isCompleted || b.hp < b.maxHp));
      }).length;

      if (activeLen < bestQueueLen) {
        bestQueueLen = activeLen;
        bestCid = cid;
      }
    }
    return [bestCid];
  }

  createBuilding({
    type,
    team = 1,
    xFx,
    zFx,
    facingDir = null,
    workerCompanyIds = [],
    queueBuild = false,
    instantComplete = false,
    bypassValidation = false,
    skipAutoSlots = false,
    gameState = null
  }) {
    const def = this.buildingDefs[type];
    if (!def) return null;

    if (!instantComplete && !bypassValidation) {
      const check = this.isPlacementValid(type, xFx, zFx, team, true);
      if (!check.valid) return null;
      this.economySystem.spendResources(team, def.cost, 'building');
    }

    const id = this.nextBuildingId++;
    const buildTimeTicks = Math.max(200, (def.buildTimeTicks | 0) || 900);
    const totalWorkPermille = (buildTimeTicks * PERMILLE_ONE) | 0;
    const yFx = this.navGrid.sampleHeightAtWorldFx(xFx | 0, zFx | 0);
    const radiusMeters = Number(def.footprintRadiusMeters) || 5;
    const resolvedFacingDir =
      facingDir !== null && facingDir !== undefined
        ? facingDir & ANGLE_MASK
        : (team | 0) === 1
          ? 256
          : 768;

    const defaultMusterOffset = type === 'stables' ? radiusMeters + 13.5 : radiusMeters + 10.5;
    const defaultMusterDistFx = Math.round(defaultMusterOffset * FX_ONE) | 0;
    const defaultRallyXFx =
      ((xFx | 0) + mulDiv(defaultMusterDistFx, fxCos(resolvedFacingDir), FX_ONE)) | 0;
    const defaultRallyZFx =
      ((zFx | 0) + mulDiv(defaultMusterDistFx, fxSin(resolvedFacingDir), FX_ONE)) | 0;

    const isCitadelSlot = type === 'citadel_slot';
    const maxHp = isCitadelSlot ? 0 : def.maxHp | 0;
    const initHp = isCitadelSlot
      ? 0
      : instantComplete
        ? maxHp
        : Math.max(50, (maxHp >> 3) | 0);

    const building = {
      id,
      type,
      name: def.name,
      team: team | 0,
      xFx: xFx | 0,
      yFx: yFx | 0,
      zFx: zFx | 0,
      facingDir: resolvedFacingDir,
      footprintRadiusMeters: radiusMeters,
      hp: initHp,
      maxHp,
      isDestroyed: false,
      isCompleted: Boolean(instantComplete),
      isAutoConstructingSlot: false,
      workDonePermille: instantComplete ? totalWorkPermille : 0,
      totalWorkPermille,
      activeBuildersCount: 0,
      level: 1,
      xp: 0,
      xpToNextLevel: (def.xpPerLevel | 0) || 600,
      hasWatchtower: Boolean(def.hasWatchtowerSupport !== false && def.hasBuiltInTurret),
      turretCooldownTicks: 0,
      manualTargetEntityId: -1,
      garrisonCompanyIds: [],
      maxGarrison: (def.maxGarrison | 0) || 0,
      productionQueue: [],
      productionProgressTicks: 0,
      productionTotalTicks: 0,
      hasCustomRallyPoint: false,
      rallyXFx: fxClamp(defaultRallyXFx, 20 * FX_ONE, this.navGrid.worldSizeFx - 20 * FX_ONE),
      rallyZFx: fxClamp(defaultRallyZFx, 20 * FX_ONE, this.navGrid.worldSizeFx - 20 * FX_ONE),
      rallyTargetBuildingId: -1,
      rallyTargetEnemyEntityId: -1,
      activeDoorSpawns: [],
      activeGarrisonExits: []
    };

    this.buildings.set(id, building);
    this.sortedBuildingIds.push(id);
    this.sortedBuildingIds.sort((a, b) => a - b);

    if (instantComplete && type === 'citadel' && !skipAutoSlots) {
      this._spawnCitadelDefensiveSlots(team, xFx | 0, zFx | 0);
    }

    if (!instantComplete && Array.isArray(workerCompanyIds) && workerCompanyIds.length > 0) {
      const singleBuilderSquad = this._pickLeastBusyWorkerCompany(workerCompanyIds);
      const comp = gameState?.companies?.get(singleBuilderSquad[0]);
      const preserveRun = Boolean(comp && comp.wantsToRun);
      this.assignWorkerCompaniesToBuilding(
        singleBuilderSquad,
        id,
        queueBuild,
        gameState,
        preserveRun
      );
    }

    return building;
  }

  assignWorkerCompaniesToBuilding(
    workerCompanyIds,
    buildingId,
    appendQueue = false,
    gameState = null,
    isRunning = false
  ) {
    const b = this.buildings.get(buildingId | 0);
    if (!b || b.isDestroyed || b.type === 'citadel_slot' || b.hp <= 0) return;
    if (b.isCompleted && b.hp >= b.maxHp) return;

    let chosenCids = workerCompanyIds;

    if (!b.isCompleted) {
      const lockedByCid = this._getLockedBuilderCompanyForBuilding(b.id, gameState?.companies);
      if (lockedByCid !== null && !workerCompanyIds.includes(lockedByCid)) {
        return;
      }
      chosenCids = this._pickLeastBusyWorkerCompany(workerCompanyIds);
    }

    for (let i = 0; i < chosenCids.length; i++) {
      const cid = chosenCids[i] | 0;
      const comp = gameState?.companies?.get(cid);
      const interruptedPatrol = comp?.clearPatrolIfActive?.() || false;
      const effectiveAppend = Boolean(appendQueue) && !interruptedPatrol;

      if (!effectiveAppend) {
        this.economySystem.cancelGatheringForCompanies(
          [cid],
          gameState?.entities,
          gameState?.companies
        );
      }

      if (!this.workerBuildQueues.has(cid)) {
        this.workerBuildQueues.set(cid, []);
      }
      const q = this.workerBuildQueues.get(cid);

      if (!effectiveAppend) {
        q.length = 0;
        if (comp) {
          const shouldRun = Boolean(isRunning || comp.wantsToRun);
          comp.commandQueue.length = 0;
          comp.isWorking = false;
          comp.activeDropoffBuildingId = 0;
          comp.activeBuildTargetId = b.id;
          const appDir = fxAtan2((comp.anchorZFx - b.zFx) | 0, (comp.anchorXFx - b.xFx) | 0);
          const appDistFx = Math.round((b.footprintRadiusMeters + 1.6) * FX_ONE) | 0;
          const appXFx = (b.xFx + mulDiv(appDistFx, fxCos(appDir), FX_ONE)) | 0;
          const appZFx = (b.zFx + mulDiv(appDistFx, fxSin(appDir), FX_ONE)) | 0;
          this.movementSystem.issueArmyDragOrder(
            [comp],
            gameState.entities,
            { xFx: appXFx, zFx: appZFx },
            { xFx: appXFx, zFx: appZFx },
            CompanyOrderType.MOVE,
            gameState.tick,
            { queue: false, isRunning: shouldRun, gameState }
          );
        }
      } else if (comp && isRunning) {
        comp.wantsToRun = true;
        if (
          comp.isActivelyMoving() &&
          !comp.isWorking &&
          (comp.staminaPermille | 0) >= RUN_STAMINA_THRESHOLD_PERMILLE
        ) {
          comp.isRunning = true;
        }
      }

      if (!q.includes(b.id)) {
        q.push(b.id);
      }
    }
  }

  _removeCitadelBastionSlots(citadelBuilding) {
    if (!citadelBuilding || citadelBuilding.type !== 'citadel') return;
    const maxRingDistFx = (CITADEL_SLOT_RING_RADIUS_FX + 3 * FX_ONE) | 0;
    const toRemoveIds = [];

    for (let i = 0; i < this.sortedBuildingIds.length; i++) {
      const other = this.buildings.get(this.sortedBuildingIds[i]);
      if (!other || other.id === citadelBuilding.id || other.team !== citadelBuilding.team) continue;
      if (other.type !== 'citadel_slot') continue;
      const d = fxHypot(
        (other.xFx - citadelBuilding.xFx) | 0,
        (other.zFx - citadelBuilding.zFx) | 0
      );
      if (d <= maxRingDistFx) {
        toRemoveIds.push(other.id);
      }
    }

    if (toRemoveIds.length > 0) {
      for (let i = 0; i < toRemoveIds.length; i++) {
        const sid = toRemoveIds[i];
        const slotBld = this.buildings.get(sid);
        if (slotBld) {
          slotBld.isDestroyed = true;
          slotBld.hp = 0;
        }
        this.buildings.delete(sid);
      }
      this.sortedBuildingIds = this.sortedBuildingIds.filter((id) => !toRemoveIds.includes(id));
    }
  }

  handleBuildingDestroyedInCombat(b, gameState) {
    if (!b || b.isDestroyed || b.type === 'citadel_slot') return;

    // Eject any garrisoned companies before removing the building
    if (Array.isArray(b.garrisonCompanyIds) && b.garrisonCompanyIds.length > 0) {
      for (let g = 0; g < b.garrisonCompanyIds.length; g++) {
        const gComp = gameState.companies?.get(b.garrisonCompanyIds[g]);
        if (!gComp) continue;
        gComp.garrisonedBuildingId = -1;
        for (let m = 0; m < gComp.memberIds.length; m++) {
          const ent = gameState.entities.get(gComp.memberIds[m]);
          if (ent && ent.hp > 0) {
            ent.isGarrisoned = false;
            ent.x = b.xFx;
            ent.z = b.zFx;
            ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
          }
        }
        gComp.updateSlotTargets(this.navGrid, gameState.entities);
      }
      b.garrisonCompanyIds.length = 0;
    }

    b.hp = 0;
    b.isDestroyed = true;

    // If this was a tower built on a Citadel defensive bastion slot, revert it back to an empty citadel_slot!
    const citadels = [];
    for (let i = 0; i < this.sortedBuildingIds.length; i++) {
      const other = this.buildings.get(this.sortedBuildingIds[i]);
      if (other && !other.isDestroyed && other.type === 'citadel' && other.team === b.team) {
        citadels.push(other);
      }
    }

    let isCitadelBastion = false;
    for (let c = 0; c < citadels.length; c++) {
      const d = fxHypot((b.xFx - citadels[c].xFx) | 0, (b.zFx - citadels[c].zFx) | 0);
      if (Math.abs(d - CITADEL_SLOT_RING_RADIUS_FX) <= 2 * FX_ONE) {
        isCitadelBastion = true;
        break;
      }
    }

    if (isCitadelBastion) {
      const slotDef = this.buildingDefs.citadel_slot;
      b.type = 'citadel_slot';
      b.name = slotDef?.name || 'Citadel Bastion Slot';
      b.footprintRadiusMeters = Number(slotDef?.footprintRadiusMeters) || 2.4;
      b.hp = 0;
      b.maxHp = 0;
      b.isDestroyed = false;
      b.isCompleted = true;
      b.hasWatchtower = false;
      b.maxGarrison = 0;
      b.productionQueue.length = 0;
    } else {
      if (b.type === 'citadel') {
        this._removeCitadelBastionSlots(b);
      }
      this.buildings.delete(b.id);
      this.sortedBuildingIds = this.sortedBuildingIds.filter((id) => id !== b.id);
    }

    for (const [cid, q] of this.workerBuildQueues.entries()) {
      const idx = q.indexOf(b.id);
      if (idx !== -1) {
        q.splice(idx, 1);
        const comp = gameState?.companies?.get(cid);
        if (comp && comp.activeBuildTargetId === b.id) {
          comp.isWorking = false;
          comp.activeBuildTargetId = 0;
          comp.stopInPlace(this.navGrid, gameState.entities);
        }
      }
    }

    // Settle any attacking companies that were sieging this building so they do not scatter to old drag coordinates!
    if (gameState?.companies) {
      for (const comp of gameState.companies.values()) {
        if (
          comp &&
          !comp.isBroken &&
          (comp.targetEnemyBuildingId === b.id || comp.engagedTargetBuildingId === b.id)
        ) {
          const wasExplicitTarget = comp.targetEnemyBuildingId === b.id;
          comp.targetEnemyBuildingId = -1;
          comp.engagedTargetBuildingId = -1;
          if (wasExplicitTarget && (!comp.commandQueue || comp.commandQueue.length === 0)) {
            comp.stopInPlace(this.navGrid, gameState.entities);
          }
        }
      }
    }

    gameState.recordWorldEvent(b.xFx, b.yFx, b.zFx, `${b.name} Destroyed!`);
  }

  demolishBuilding(buildingId, team = 1, gameState = null) {
    const b = this.buildings.get(buildingId | 0);
    if (!b || b.team !== (team | 0) || b.isDestroyed || b.type === 'citadel_slot') return false;

    const def = this.buildingDefs[b.type];
    if (def && def.cost) {
      const refund = {
        coins: mulDiv(def.cost.coins | 0, 450, 1000),
        wood: mulDiv(def.cost.wood | 0, 450, 1000),
        stone: mulDiv(def.cost.stone | 0, 450, 1000),
        iron: mulDiv(def.cost.iron | 0, 450, 1000)
      };
      this.economySystem.refundResources(team, refund, 'building');
    }

    if (b.productionQueue && b.productionQueue.length > 0) {
      for (const item of b.productionQueue) {
        if (item.cost) {
          const category = item.kind === 'unit' ? 'unit' : 'research';
          this.economySystem.refundResources(team, item.cost, category, item.optionId);
        }
      }
    }

    if (b.type === 'citadel') {
      this._removeCitadelBastionSlots(b);
    }
    b.hp = 0;
    b.isDestroyed = true;
    this.buildings.delete(b.id);
    this.sortedBuildingIds = this.sortedBuildingIds.filter((id) => id !== b.id);

    for (const [cid, q] of this.workerBuildQueues.entries()) {
      const idx = q.indexOf(b.id);
      if (idx !== -1) {
        q.splice(idx, 1);
        const comp = gameState?.companies?.get(cid);
        if (comp) {
          comp.isWorking = false;
          if (comp.activeBuildTargetId === b.id) {
            comp.activeBuildTargetId = 0;
            comp.stopInPlace(this.navGrid, gameState.entities);
          }
        }
      }
    }

    return true;
  }

  orderCompaniesToGarrison(companyIds, buildingId, team, gameState, queue = false, isRunning = false) {
    return this.garrisonSystem.orderCompaniesToGarrison(
      companyIds,
      buildingId,
      team,
      gameState,
      queue,
      isRunning
    );
  }

  ungarrisonBuilding(buildingId, team, gameState, targetCompanyId = null) {
    return this.garrisonSystem.ungarrisonBuilding(buildingId, team, gameState, targetCompanyId);
  }

  setTowerManualTarget(buildingId, targetEntityId, team = 1) {
    return this.combatSystem.setTowerManualTarget(buildingId, targetEntityId, team);
  }

  setBuildingRallyPoint(buildingId, rallyXFx, rallyZFx, team = 1, gameState = null) {
    return this.productionSystem.setBuildingRallyPoint(
      buildingId,
      rallyXFx,
      rallyZFx,
      team,
      gameState
    );
  }

  getInstantUpgradeCostCoins(building) {
    return this.productionSystem.getInstantUpgradeCostCoins(building);
  }

  addBuildingXp(building, xpAmount) {
    return this.productionSystem.addBuildingXp(building, xpAmount);
  }

  instantUpgradeBuilding(buildingId, team = 1) {
    return this.productionSystem.instantUpgradeBuilding(buildingId, team);
  }

  queueProductionOption(buildingId, optionId, team = 1) {
    return this.productionSystem.queueProductionOption(buildingId, optionId, team);
  }

  cancelProductionOption(buildingId, optionId, team = 1) {
    return this.productionSystem.cancelProductionOption(buildingId, optionId, team);
  }

  _assignCircularPerimeterSlotsToBuilders(building, assignedComps, entitiesMap) {
    const allWorkerIds = [];
    for (let c = 0; c < assignedComps.length; c++) {
      const comp = assignedComps[c];
      comp.isWorking = true;
      for (let m = 0; m < comp.memberIds.length; m++) {
        const id = comp.memberIds[m];
        const ent = entitiesMap.get(id);
        if (ent && ent.hp > 0) allWorkerIds.push(ent);
      }
    }
    if (allWorkerIds.length === 0) return;

    const ringRadiusFx = (Math.round(building.footprintRadiusMeters * FX_ONE) + 870) | 0;
    const total = allWorkerIds.length;
    const firstEnt = allWorkerIds[0];
    const baseApproachAngle = fxAtan2(
      ((firstEnt ? firstEnt.z : building.zFx + FX_ONE) - building.zFx) | 0,
      ((firstEnt ? firstEnt.x : building.xFx) - building.xFx) | 0
    );

    for (let i = 0; i < total; i++) {
      const ent = allWorkerIds[i];
      const offsetSteps = i === 0 ? 0 : ((i & 1) === 1 ? 1 : -1) * (((i + 1) >> 1) * 76);
      const angleIdx = (baseApproachAngle + offsetSteps) & ANGLE_MASK;
      const slotXFx = (building.xFx + mulDiv(ringRadiusFx, fxCos(angleIdx), FX_ONE)) | 0;
      const slotZFx = (building.zFx + mulDiv(ringRadiusFx, fxSin(angleIdx), FX_ONE)) | 0;
      const faceCenterDir = fxAtan2((building.zFx - slotZFx) | 0, (building.xFx - slotXFx) | 0);

      ent.role = 0;
      ent.slotTargetXFx = slotXFx;
      ent.slotTargetZFx = slotZFx;
      ent.targetX = slotXFx;
      ent.targetZ = slotZFx;
      ent.desiredFacingDir = faceCenterDir;

      const distToPerimeterSlot = fxHypot((ent.x - slotXFx) | 0, (ent.z - slotZFx) | 0);
      if (distToPerimeterSlot <= 850) {
        ent.x = slotXFx;
        ent.z = slotZFx;
        ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
        ent.dir = faceCenterDir;
        ent.isMoving = false;
        ent.pathWaypoints = null;
      } else {
        ent.isMoving = true;
      }
    }
  }

  _isCompanyStillExecutingPriorTask(comp, targetBldId, gameState) {
    if (comp.activeBuildTargetId === targetBldId) return false;
    if (comp.activeDropoffBuildingId > 0) return true;

    const gatherTask = this.economySystem?.companyGatherTasks?.get(comp.id);
    if (gatherTask) {
      if (!gatherTask.queuedAfterBuild) {
        return true;
      }
      return false;
    }

    if (comp.isActivelyMoving()) return true;
    return false;
  }

  _completeBuildingForAssignedBuilders(buildingId, assignedComps, gameState) {
    const entitiesMap = gameState.entities;
    for (let c = 0; c < assignedComps.length; c++) {
      const comp = assignedComps[c];
      comp.isWorking = false;
      comp.activeBuildTargetId = 0;

      const bq = this.workerBuildQueues.get(comp.id);
      if (bq) {
        const idx = bq.indexOf(buildingId);
        if (idx !== -1) bq.splice(idx, 1);
        if (bq.length === 0) {
          this.workerBuildQueues.delete(comp.id);
        }
      }

      const remainingBuilds = this.workerBuildQueues.get(comp.id);
      if ((!remainingBuilds || remainingBuilds.length === 0) && comp.commandQueue.length > 0) {
        comp.advanceCommandQueue(gameState.astar, this.navGrid, entitiesMap);
      }
    }
  }

  update(gameState, { AnimState, UnitTypeIndex }) {
    const entitiesMap = gameState.entities;
    const companiesMap = gameState.companies;

    this.garrisonSystem.processPendingGarrisonOrders(gameState);

    for (let i = 0; i < gameState.sortedEntityIds.length; i++) {
      const ent = entitiesMap.get(gameState.sortedEntityIds[i]);
      if (ent) {
        ent.isBuffed = false;
        ent.isHealing = false;
      }
    }
    for (const comp of companiesMap.values()) {
      if (comp) {
        comp.hasBannerBuff = false;
        comp.isHealing = false;
      }
    }

    const arrivedBuildersMap = new Map();
    const assignedCountPerBuilding = new Map();

    for (const [cid, buildQueue] of Array.from(this.workerBuildQueues.entries())) {
      const comp = companiesMap.get(cid);
      if (!comp || comp.memberIds.length === 0) {
        this.workerBuildQueues.delete(cid);
        continue;
      }

      while (buildQueue.length > 0) {
        const headBld = this.buildings.get(buildQueue[0]);
        const needsWork =
          headBld &&
          !headBld.isDestroyed &&
          headBld.type !== 'citadel_slot' &&
          headBld.hp > 0 &&
          (!headBld.isCompleted || headBld.hp < headBld.maxHp);

        if (!needsWork) {
          buildQueue.shift();
          comp.isWorking = false;
          comp.activeBuildTargetId = 0;
          continue;
        }

        if (!headBld.isCompleted) {
          const lockedByOther = this._getLockedBuilderCompanyForBuilding(headBld.id, companiesMap);
          if (lockedByOther !== null && lockedByOther !== cid) {
            buildQueue.shift();
            if (comp.activeBuildTargetId === headBld.id) {
              comp.activeBuildTargetId = 0;
            }
            comp.isWorking = false;
            continue;
          }
        }
        break;
      }

      if (buildQueue.length === 0) {
        comp.isWorking = false;
        comp.activeBuildTargetId = 0;
        this.workerBuildQueues.delete(cid);
        if (comp.commandQueue.length > 0 && !comp.isActivelyMoving()) {
          comp.advanceCommandQueue(gameState.astar, this.navGrid, entitiesMap);
        }
        continue;
      }

      const targetBld = this.buildings.get(buildQueue[0]);

      if (this._isCompanyStillExecutingPriorTask(comp, targetBld.id, gameState)) {
        continue;
      }

      const alreadyAssignedCount = assignedCountPerBuilding.get(targetBld.id) || 0;
      if (!targetBld.isCompleted && alreadyAssignedCount >= 1) {
        buildQueue.shift();
        comp.isWorking = false;
        comp.activeBuildTargetId = 0;
        continue;
      }
      assignedCountPerBuilding.set(targetBld.id, alreadyAssignedCount + 1);

      const interactRadiusFx = Math.round((targetBld.footprintRadiusMeters + 4.8) * FX_ONE) | 0;
      let distToSiteFx = fxHypot(
        (comp.anchorXFx - targetBld.xFx) | 0,
        (comp.anchorZFx - targetBld.zFx) | 0
      );
      for (let m = 0; m < comp.memberIds.length; m++) {
        const wEnt = entitiesMap.get(comp.memberIds[m]);
        if (wEnt && wEnt.hp > 0) {
          const dMem = fxHypot((wEnt.x - targetBld.xFx) | 0, (wEnt.z - targetBld.zFx) | 0);
          if (dMem < distToSiteFx) distToSiteFx = dMem;
        }
      }

      if (comp.activeBuildTargetId !== targetBld.id) {
        comp.activeBuildTargetId = targetBld.id;
        comp.isWorking = false;
        const appDir = fxAtan2((comp.anchorZFx - targetBld.zFx) | 0, (comp.anchorXFx - targetBld.xFx) | 0);
        const appDistFx = Math.round((targetBld.footprintRadiusMeters + 1.6) * FX_ONE) | 0;
        const appXFx = (targetBld.xFx + mulDiv(appDistFx, fxCos(appDir), FX_ONE)) | 0;
        const appZFx = (targetBld.zFx + mulDiv(appDistFx, fxSin(appDir), FX_ONE)) | 0;
        const savedAfterBuildQueue = comp.commandQueue.slice();
        this.movementSystem.issueArmyDragOrder(
          [comp],
          entitiesMap,
          { xFx: appXFx, zFx: appZFx },
          { xFx: appXFx, zFx: appZFx },
          CompanyOrderType.MOVE,
          gameState.tick,
          { queue: false, isRunning: Boolean(comp.wantsToRun), gameState }
        );
        comp.commandQueue.push(...savedAfterBuildQueue);
      } else if (distToSiteFx <= interactRadiusFx) {
        // Only set `comp.isWorking = true` and fan workers around the perimeter once they ARRIVE at the site!
        comp.orderType = CompanyOrderType.IDLE;
        comp.pathWaypoints = null;
        comp.pathIndex = 0;
        comp.wantsToRun = false;
        comp.isRunning = false;
        comp.isWorking = true;
        if (!arrivedBuildersMap.has(targetBld.id)) {
          arrivedBuildersMap.set(targetBld.id, []);
        }
        arrivedBuildersMap.get(targetBld.id).push(comp);
      } else {
        // Still marching to the building site: keep `comp.isWorking = false` so they can RUN!
        comp.isWorking = false;
        if (!comp.isActivelyMoving()) {
          const appDir = fxAtan2((comp.anchorZFx - targetBld.zFx) | 0, (comp.anchorXFx - targetBld.xFx) | 0);
          const appDistFx = Math.round((targetBld.footprintRadiusMeters + 1.6) * FX_ONE) | 0;
          const appXFx = (targetBld.xFx + mulDiv(appDistFx, fxCos(appDir), FX_ONE)) | 0;
          const appZFx = (targetBld.zFx + mulDiv(appDistFx, fxSin(appDir), FX_ONE)) | 0;
          const savedAfterBuildQueue = comp.commandQueue.slice();
          this.movementSystem.issueArmyDragOrder(
            [comp],
            entitiesMap,
            { xFx: appXFx, zFx: appZFx },
            { xFx: appXFx, zFx: appZFx },
            CompanyOrderType.MOVE,
            gameState.tick,
            { queue: false, isRunning: Boolean(comp.wantsToRun), gameState }
          );
          comp.commandQueue.push(...savedAfterBuildQueue);
        }
      }
    }

    const activeIdsSnapshot = this.sortedBuildingIds.slice();
    for (let i = 0; i < activeIdsSnapshot.length; i++) {
      const b = this.buildings.get(activeIdsSnapshot[i]);
      if (!b || b.isDestroyed) continue;
      if (b.type !== 'citadel_slot' && b.hp <= 0) {
        this.handleBuildingDestroyedInCombat(b, gameState);
        continue;
      }
      if (!this._isBuildingActive(b)) continue;
      if (b.type === 'citadel_slot') continue;

      const arrivedComps = arrivedBuildersMap.get(b.id) || [];

      if (!b.isCompleted) {
        const singleSquadComps = arrivedComps.slice(0, 1);
        let arrivedWorkerUnits = 0;
        let totalStaminaPermille = 0;

        if (singleSquadComps.length > 0) {
          this._assignCircularPerimeterSlotsToBuilders(b, singleSquadComps, entitiesMap);

          const comp = singleSquadComps[0];
          for (let m = 0; m < comp.memberIds.length; m++) {
            const ent = entitiesMap.get(comp.memberIds[m]);
            if (ent && ent.hp > 0 && !ent.isMoving) {
              arrivedWorkerUnits = (arrivedWorkerUnits + 1) | 0;
              totalStaminaPermille = (totalStaminaPermille + (comp.staminaPermille ?? 1000)) | 0;
              ent.dir = fxAtan2((b.zFx - ent.z) | 0, (b.xFx - ent.x) | 0);
              ent.desiredFacingDir = ent.dir;
              ent.animState = AnimState.BUILD ?? AnimState.ATTACK;
            }
          }
        }

        b.activeBuildersCount = arrivedWorkerUnits;
        let workStepPermille = b.isAutoConstructingSlot ? PERMILLE_ONE : 0;

        if (arrivedWorkerUnits > 0) {
          const avgStamina = (totalStaminaPermille / arrivedWorkerUnits) | 0;
          const staminaEfficiencyPermille = (350 + mulDiv(650, avgStamina, 1000)) | 0;
          const presenceFactorPermille = fxClamp(
            mulDiv(arrivedWorkerUnits, 1000, 3),
            333,
            1000
          );
          let builderContribution = Math.max(
            200,
            mulDiv(presenceFactorPermille, staminaEfficiencyPermille, PERMILLE_ONE)
          );
          if (avgStamina < WORKER_FATIGUE_THRESHOLD_PERMILLE) {
            builderContribution = mulDiv(builderContribution, 600, 1000);
          }
          workStepPermille = (workStepPermille + builderContribution) | 0;
        }

        if (workStepPermille > 0) {
          b.workDonePermille = Math.min(
            b.totalWorkPermille,
            (b.workDonePermille + workStepPermille) | 0
          );

          const progressRatioPermille = mulDiv(
            b.workDonePermille,
            PERMILLE_ONE,
            b.totalWorkPermille
          );
          b.hp = Math.max(50, mulDiv(b.maxHp, progressRatioPermille, PERMILLE_ONE));

          if (b.workDonePermille >= b.totalWorkPermille) {
            b.isCompleted = true;
            b.isAutoConstructingSlot = false;
            b.hp = b.maxHp;
            b.activeBuildersCount = 0;
            this._completeBuildingForAssignedBuilders(b.id, singleSquadComps, gameState);
            if (b.type === 'citadel') {
              this._spawnCitadelDefensiveSlots(b.team, b.xFx, b.zFx);
            }
            gameState.recordWorldEvent(b.xFx, b.yFx, b.zFx, `${b.name} Completed`);
          }
        }
        continue;
      }

      if (b.hp < b.maxHp && arrivedComps.length > 0) {
        this._assignCircularPerimeterSlotsToBuilders(b, arrivedComps, entitiesMap);

        let repairingWorkers = 0;
        let totalStaminaPermille = 0;
        for (let c = 0; c < arrivedComps.length; c++) {
          const comp = arrivedComps[c];
          for (let m = 0; m < comp.memberIds.length; m++) {
            const ent = entitiesMap.get(comp.memberIds[m]);
            if (ent && ent.hp > 0 && !ent.isMoving) {
              repairingWorkers++;
              totalStaminaPermille += comp.staminaPermille ?? 1000;
              ent.dir = fxAtan2((b.zFx - ent.z) | 0, (b.xFx - ent.x) | 0);
              ent.desiredFacingDir = ent.dir;
              ent.animState = AnimState.BUILD ?? AnimState.ATTACK;
            }
          }
        }

        b.activeBuildersCount = repairingWorkers;
        if (repairingWorkers > 0) {
          const avgStamina = (totalStaminaPermille / repairingWorkers) | 0;
          const staminaEff = (350 + mulDiv(650, avgStamina, 1000)) | 0;
          let healStep = Math.max(1, mulDiv(repairingWorkers * 2, staminaEff, 1000));
          if (avgStamina < WORKER_FATIGUE_THRESHOLD_PERMILLE) {
            healStep = Math.max(1, mulDiv(healStep, 600, 1000));
          }
          b.hp = Math.min(b.maxHp, (b.hp + healStep) | 0);
          if (b.hp >= b.maxHp) {
            b.activeBuildersCount = 0;
            this._completeBuildingForAssignedBuilders(b.id, arrivedComps, gameState);
          }
        }
      } else {
        b.activeBuildersCount = 0;
      }

      this.productionSystem.stepBuildingDoorSpawns(gameState, b, AnimState);
      this.garrisonSystem.stepBuildingGarrisonExits(gameState, b, AnimState);
      this.productionSystem.stepBuildingProduction(gameState, b, UnitTypeIndex);
      this.combatSystem.stepBuildingTurretAndAuras(gameState, b, AnimState, UnitTypeIndex);
    }

    this.productionSystem.flushPendingLevelUpEvents(gameState);
  }
}