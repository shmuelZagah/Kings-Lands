/**
 * Kings Lands — Building Unit Production, XP Auto-Leveling, Infirmary Reinforcement & Smart Rally System
 * (src/sim/systems/productionAndRallySystem.js)
 *
 * Updated for Phase 6:
 * - Newly produced Cavalry spawn in Square (`FormationTypes.SQUARE`) via `resolveDefaultFormation` so UI matches 100%.
 * - Initializes all Phase 6 combat/ammo/morale fields on newly spawned and Infirmary-reinforced units.
 */

import { simUnitStats } from '../simConfig.js';
import {
  FX_ONE,
  PERMILLE_ONE,
  ANGLE_MASK,
  mulDiv,
  fxClamp,
  fxAtan2,
  fxHypot
} from '../../core/fx.js';
import { transformLocalSlotToWorldFx } from '../formations/formations.js';
import { Company, CompanyOrderType, resolveDefaultFormation } from '../formations/company.js';

const RALLY_ENEMY_SNAP_RADIUS_FX = 2253; // ~2.2 meters (direct click on enemy unit only)

export class ProductionAndRallySystem {
  constructor(constructionSystem) {
    this.cs = constructionSystem;
    this.pendingLevelUpEvents = [];
  }

  setBuildingRallyPoint(buildingId, rallyXFx, rallyZFx, team = 1, gameState = null) {
    const b = this.cs.buildings.get(buildingId | 0);
    if (!b || b.team !== (team | 0)) return false;

    const worldMinFx = 16 * FX_ONE;
    const worldMaxFx = (this.cs.navGrid.worldSizeFx - 16 * FX_ONE) | 0;
    const clampedX = fxClamp(rallyXFx | 0, worldMinFx, worldMaxFx);
    const clampedZ = fxClamp(rallyZFx | 0, worldMinFx, worldMaxFx);

    b.rallyTargetBuildingId = -1;
    b.rallyTargetEnemyEntityId = -1;

    // 1. Check if placed directly on any Building (Friendly or Enemy, completed or under construction)
    let hitBuilding = null;
    let bestBldDist = 0x7fffffff;
    for (let i = 0; i < this.cs.sortedBuildingIds.length; i++) {
      const other = this.cs.buildings.get(this.cs.sortedBuildingIds[i]);
      if (
        !other ||
        other.id === b.id ||
        other.isDestroyed ||
        other.type === 'citadel_slot' ||
        other.hp <= 0
      ) {
        continue;
      }
      const hitRadiusFx = Math.round((other.footprintRadiusMeters + 1.8) * FX_ONE) | 0;
      const d = fxHypot((clampedX - other.xFx) | 0, (clampedZ - other.zFx) | 0);
      if (d <= hitRadiusFx && d < bestBldDist) {
        bestBldDist = d;
        hitBuilding = other;
      }
    }

    if (hitBuilding) {
      b.rallyXFx = hitBuilding.xFx;
      b.rallyZFx = hitBuilding.zFx;
      b.rallyTargetBuildingId = hitBuilding.id;
      b.hasCustomRallyPoint = true;
      return true;
    }

    // 2. Check if placed directly on an Enemy Unit (strictly within 2.2m tolerance)
    if (gameState?.entities) {
      let bestEnemyEnt = null;
      let bestEnemyDist = RALLY_ENEMY_SNAP_RADIUS_FX;
      for (let i = 0; i < gameState.sortedEntityIds.length; i++) {
        const ent = gameState.entities.get(gameState.sortedEntityIds[i]);
        if (!ent || ent.hp <= 0 || ent.team === (team | 0) || ent.isGarrisoned) continue;
        const d = fxHypot((clampedX - ent.x) | 0, (clampedZ - ent.z) | 0);
        if (d <= bestEnemyDist) {
          bestEnemyDist = d;
          bestEnemyEnt = ent;
        }
      }
      if (bestEnemyEnt) {
        b.rallyXFx = bestEnemyEnt.x;
        b.rallyZFx = bestEnemyEnt.z;
        b.rallyTargetEnemyEntityId = bestEnemyEnt.id;
        b.hasCustomRallyPoint = true;
        return true;
      }
    }

    // 3. Check if placed on a Resource Node (for worker-producing buildings)
    const isWorkerBuilding = b.type === 'citadel' || b.type === 'gathering_camp';
    const nearMine = isWorkerBuilding
      ? this.cs.economySystem?.findNearestMine?.(clampedX, clampedZ, 5120)
      : null;
    const nearTree =
      isWorkerBuilding && !nearMine
        ? this.cs.economySystem?.findNearestGrownTree?.(clampedX, clampedZ, 3584)
        : null;

    if (nearMine || nearTree) {
      b.rallyXFx = nearMine ? nearMine.xFx : nearTree.xFx;
      b.rallyZFx = nearMine ? nearMine.zFx : nearTree.zFx;

      if ((team | 0) === 1 && gameState?.pendingEvents) {
        const resType = nearMine ? nearMine.resourceType : 'wood';
        const nodeYFx = this.cs.navGrid
          ? this.cs.navGrid.sampleHeightAtWorldFx(b.rallyXFx, b.rallyZFx)
          : 0;
        gameState.pendingEvents.push({
          tick: gameState.tick,
          kind: 'RESOURCE_PING',
          resourceType: resType,
          isMine: Boolean(nearMine),
          nodeId: nearMine ? nearMine.id : nearTree.id,
          xFx: b.rallyXFx,
          yFx: nodeYFx,
          zFx: b.rallyZFx,
          label: `Rally Gather ${resType}`
        });
      }
    } else {
      const walkable = this.cs.navGrid.findNearestWalkableTile(
        this.cs.navGrid.worldFxToTileX(clampedX),
        this.cs.navGrid.worldFxToTileZ(clampedZ),
        16
      );
      b.rallyXFx = this.cs.navGrid.tileToWorldCenterFxX(walkable.tx);
      b.rallyZFx = this.cs.navGrid.tileToWorldCenterFxZ(walkable.tz);
    }

    b.hasCustomRallyPoint = true;
    return true;
  }

  getInstantUpgradeCostCoins(building) {
    if (!building || !building.isCompleted) return 0;
    const def = this.cs.buildingDefs[building.type];
    if (!def || !def.canAutoLevel) return 0;

    const baseCost = ((def.baseUpgradeCostCoins | 0) || 300) * (building.level | 0);
    const xpNeeded = Math.max(1, building.xpToNextLevel | 0);
    const remainingXp = fxClamp((xpNeeded - (building.xp | 0)) | 0, 0, xpNeeded);
    return Math.max(25, mulDiv(baseCost, remainingXp, xpNeeded));
  }

  addBuildingXp(building, xpAmount) {
    if (!building || !building.isCompleted) return;
    const def = this.cs.buildingDefs[building.type];
    if (!def || !def.canAutoLevel) return;

    building.xp = (building.xp + Math.max(0, xpAmount | 0)) | 0;
    while (building.xp >= building.xpToNextLevel) {
      building.xp = (building.xp - building.xpToNextLevel) | 0;
      this.levelUpBuilding(building, def);
    }
  }

  levelUpBuilding(building, def) {
    const maxLv = (def?.maxLevel | 0) || 3;
    if ((building.level | 0) >= maxLv) {
      building.xp = 0;
      return;
    }
    building.level = (building.level + 1) | 0;
    building.xpToNextLevel = (((def.xpPerLevel | 0) || 650) * building.level) | 0;
    const hpBonus = (def.hpPerLevelBonus | 0) || 250;
    building.maxHp = (building.maxHp + hpBonus) | 0;
    building.hp = Math.min(building.maxHp, (building.hp + hpBonus) | 0);

    const wtLevel = def.watchtowerLevel !== undefined ? (def.watchtowerLevel | 0) : 3;
    if (def.hasWatchtowerSupport !== false && wtLevel > 0 && building.level >= wtLevel) {
      building.hasWatchtower = true;
    }

    this.pendingLevelUpEvents.push({
      buildingId: building.id,
      level: building.level,
      name: building.name,
      xFx: building.xFx,
      yFx: building.yFx,
      zFx: building.zFx
    });
  }

  instantUpgradeBuilding(buildingId, team = 1) {
    const b = this.cs.buildings.get(buildingId | 0);
    if (!b || b.team !== (team | 0) || !b.isCompleted) return false;
    const def = this.cs.buildingDefs[b.type];
    const maxLv = (def?.maxLevel | 0) || 3;
    if (!def || !def.canAutoLevel || (b.level | 0) >= maxLv) return false;

    if (b.productionQueue.some((item) => item.kind === 'level_upgrade')) {
      return false;
    }

    const coinCost = this.getInstantUpgradeCostCoins(b);
    if (!this.cs.economySystem.spendResources(team, { coins: coinCost }, 'upgrade')) {
      return false;
    }

    b.productionQueue.push({
      optionId: '__instant_upgrade__',
      name: `Upgrade to Lv.${b.level + 1}`,
      kind: 'level_upgrade',
      unitType: null,
      cost: { coins: coinCost, wood: 0, stone: 0, iron: 0 },
      trainTicks: 240,
      xpReward: 0
    });

    if (b.productionQueue.length === 1) {
      b.productionProgressTicks = 0;
      b.productionTotalTicks = b.productionQueue[0].trainTicks;
    }
    return true;
  }

  queueProductionOption(buildingId, optionId, team = 1) {
    const b = this.cs.buildings.get(buildingId | 0);
    if (!b || b.team !== (team | 0) || !b.isCompleted || !this.cs._isBuildingActive(b)) {
      return false;
    }
    const def = this.cs.buildingDefs[b.type];
    if (!def || !Array.isArray(def.options)) return false;

    if (typeof optionId === 'string' && optionId.startsWith('hero:')) {
      const heroId = optionId.slice(5);
      const gs = this.cs.gameStateRef;
      const heroSystem = gs?.heroSystem;
      if (!heroSystem) return false;
      const status = heroSystem.isHeroActiveOrQueued(gs, team, heroId);
      if (status.active || status.queued) return false;
      const heroOpt = heroSystem.getHeroRecruitmentOption(heroId, team);
      if (!heroOpt) return false;
      if (!this.cs.economySystem.spendResources(team, heroOpt.cost, 'hero', heroOpt.id)) {
        return false;
      }
      b.productionQueue.push({
        optionId: heroOpt.id,
        heroId: heroOpt.heroId,
        name: heroOpt.name,
        kind: 'hero',
        unitType: 'hero',
        cost: { ...heroOpt.cost },
        trainTicks: heroOpt.trainTicks,
        xpReward: heroOpt.xpReward,
        reviveLevel: heroOpt.reviveLevel || 1
      });
      if (b.productionQueue.length === 1) {
        b.productionProgressTicks = 0;
        b.productionTotalTicks = b.productionQueue[0].trainTicks;
      }
      return true;
    }

    const opt = def.options.find((o) => o.id === optionId);
    if (!opt || opt.kind === 'heroes_menu') return false;
    const reqLevel = (opt.unlockLevel | 0) || 1;
    if ((b.level || 1) < reqLevel) return false;

    if (opt.kind === 'slot_upgrade' && opt.targetBuildingType) {
      const targetDef = this.cs.buildingDefs[opt.targetBuildingType];
      if (!targetDef) return false;
      if (!this.cs.economySystem.spendResources(team, opt.cost, 'building')) {
        return false;
      }
      const buildTicks = Math.max(200, (opt.trainTicks | 0) || 900);
      b.type = targetDef.id;
      b.name = targetDef.name;
      b.footprintRadiusMeters = Number(targetDef.footprintRadiusMeters) || 3;
      b.maxHp = targetDef.maxHp | 0;
      b.hp = Math.max(100, (targetDef.maxHp >> 2) | 0);
      b.isCompleted = false;
      b.isAutoConstructingSlot = true;
      b.workDonePermille = 0;
      b.totalWorkPermille = (buildTicks * PERMILLE_ONE) | 0;
      b.hasWatchtower = Boolean(targetDef.hasBuiltInTurret);
      b.maxGarrison = (targetDef.maxGarrison | 0) || 0;
      b.productionQueue.length = 0;
      return true;
    }

    const resolvedUnitType = opt.kind === 'unit' ? (opt.unitType || opt.id || 'swordsman') : null;
    const uStatForCost = resolvedUnitType ? simUnitStats()?.units?.[resolvedUnitType] : null;
    const effectiveCost = (opt.kind === 'unit' && uStatForCost?.cost) ? uStatForCost.cost : (opt.cost || { coins: 0, wood: 0, stone: 0, iron: 0 });
    const category = opt.kind === 'unit' ? 'unit' : 'research';
    if (!this.cs.economySystem.spendResources(team, effectiveCost, category, opt.id)) {
      return false;
    }

    b.productionQueue.push({
      optionId: opt.id,
      name: uStatForCost?.name || opt.name,
      kind: opt.kind,
      unitType: resolvedUnitType || 'swordsman',
      cost: { ...effectiveCost },
      trainTicks: Math.max(20, (opt.trainTicks | 0) || 100),
      xpReward: (opt.xpReward | 0) || 35
    });

    if (b.productionQueue.length === 1) {
      b.productionProgressTicks = 0;
      b.productionTotalTicks = b.productionQueue[0].trainTicks;
    }

    return true;
  }

  cancelProductionOption(buildingId, optionId, team = 1) {
    const b = this.cs.buildings.get(buildingId | 0);
    if (!b || b.team !== (team | 0) || b.productionQueue.length === 0) return false;

    let removeIdx = -1;
    for (let i = b.productionQueue.length - 1; i >= 0; i--) {
      if (b.productionQueue[i].optionId === optionId) {
        removeIdx = i;
        break;
      }
    }
    if (removeIdx === -1) return false;

    const removed = b.productionQueue.splice(removeIdx, 1)[0];
    const category = removed.kind === 'hero' ? 'hero' : removed.kind === 'unit' ? 'unit' : 'research';
    this.cs.economySystem.refundResources(team, removed.cost, category, removed.optionId);

    if (b.productionQueue.length === 0) {
      b.productionProgressTicks = 0;
      b.productionTotalTicks = 0;
      b.isPopHold = false;
    } else if (removeIdx === 0) {
      b.productionProgressTicks = 0;
      b.productionTotalTicks = b.productionQueue[0].trainTicks;
      b.isPopHold = false;
    }

    return true;
  }

  _findFreeMusterSpotNear(gameState, baseXFx, baseZFx, facingDir, comp) {
    const clearanceFx = comp.unitType === 'worker' ? 5 * FX_ONE : 10 * FX_ONE;
    const lateralStepFx = comp.unitType === 'worker' ? 6 * FX_ONE : 12 * FX_ONE;
    const depthStepFx = comp.unitType === 'worker' ? 6 * FX_ONE : 10 * FX_ONE;
    const worldMinFx = 20 * FX_ONE;
    const worldMaxFx = (this.cs.navGrid.worldSizeFx - 20 * FX_ONE) | 0;
    const maxSearchRadFx = 52 * FX_ONE;

    const nearbyFriendlyAnchors = [];
    for (const other of gameState.companies.values()) {
      if (
        !other ||
        other.id === comp.id ||
        other.team !== (comp.team | 0) ||
        other.memberIds.length === 0 ||
        other.garrisonedBuildingId > 0 ||
        other.isWorking
      ) {
        continue;
      }
      const refXFx = other.isActivelyMoving() ? other.targetXFx : other.anchorXFx;
      const refZFx = other.isActivelyMoving() ? other.targetZFx : other.anchorZFx;
      if (
        Math.abs(refXFx - baseXFx) <= maxSearchRadFx &&
        Math.abs(refZFx - baseZFx) <= maxSearchRadFx
      ) {
        nearbyFriendlyAnchors.push({ xFx: refXFx, zFx: refZFx });
      }
    }

    const nearbyBuildings = [];
    const bIds = this.cs.sortedBuildingIds;
    for (let i = 0; i < bIds.length; i++) {
      const b = this.cs.buildings.get(bIds[i]);
      if (!b || b.isDestroyed || b.type === 'citadel_slot' || b.hp <= 0) continue;
      if (
        Math.abs(b.xFx - baseXFx) <= maxSearchRadFx &&
        Math.abs(b.zFx - baseZFx) <= maxSearchRadFx
      ) {
        nearbyBuildings.push({
          xFx: b.xFx,
          zFx: b.zFx,
          minClearFx: Math.round((b.footprintRadiusMeters + 5.5) * FX_ONE) | 0
        });
      }
    }

    const isSpotBlocked = (xFx, zFx) => {
      for (let i = 0; i < nearbyFriendlyAnchors.length; i++) {
        const a = nearbyFriendlyAnchors[i];
        if (fxHypot((a.xFx - xFx) | 0, (a.zFx - zFx) | 0) < clearanceFx) return true;
      }
      for (let i = 0; i < nearbyBuildings.length; i++) {
        const b = nearbyBuildings[i];
        if (fxHypot((b.xFx - xFx) | 0, (b.zFx - zFx) | 0) < b.minClearFx) return true;
      }
      return false;
    };

    if (!isSpotBlocked(baseXFx, baseZFx)) {
      return { xFx: baseXFx, zFx: baseZFx };
    }

    const colOffsets = [0, 1, -1, 2, -2, 3, -3];
    const rowOffsets = [0, 1, -1, 2, -2, 3];

    for (let r = 0; r < rowOffsets.length; r++) {
      const forwardFx = (rowOffsets[r] * depthStepFx) | 0;
      for (let c = 0; c < colOffsets.length; c++) {
        if (r === 0 && c === 0) continue;
        const rightFx = (colOffsets[c] * lateralStepFx) | 0;
        const candWorld = transformLocalSlotToWorldFx(
          baseXFx,
          baseZFx,
          facingDir & ANGLE_MASK,
          forwardFx,
          rightFx
        );
        const clampedX = fxClamp(candWorld.xFx, worldMinFx, worldMaxFx);
        const clampedZ = fxClamp(candWorld.zFx, worldMinFx, worldMaxFx);
        if (!this.cs.navGrid.isWalkableWorldFx(clampedX, clampedZ)) continue;

        if (!isSpotBlocked(clampedX, clampedZ)) {
          return { xFx: clampedX, zFx: clampedZ };
        }
      }
    }

    return { xFx: baseXFx, zFx: baseZFx };
  }

  _pushBackBlockingCompanies(gameState, building, musterXFx, musterZFx) {
    const companies = gameState.companies;
    const clearRadiusFx = 12 * FX_ONE;
    const pushVec = this.cs._getBuildingDoorVectorFx(building, 13);

    for (const comp of companies.values()) {
      if (
        !comp ||
        comp.team !== building.team ||
        comp.memberIds.length === 0 ||
        comp.garrisonedBuildingId > 0
      ) {
        continue;
      }

      if (
        Math.abs(comp.anchorXFx - musterXFx) >= clearRadiusFx ||
        Math.abs(comp.anchorZFx - musterZFx) >= clearRadiusFx
      ) {
        continue;
      }

      if (
        comp.hasPlayerOrder ||
        (comp.orderType !== CompanyOrderType.IDLE && comp.orderType !== CompanyOrderType.HOLD) ||
        comp.isActivelyMoving() ||
        comp.isWorking ||
        comp.isSpearWallLocked ||
        comp.commandQueue.length > 0
      ) {
        continue;
      }

      const d = fxHypot((comp.anchorXFx - musterXFx) | 0, (comp.anchorZFx - musterZFx) | 0);
      if (d >= clearRadiusFx) continue;

      let anyMemberBusy = false;
      for (let m = 0; m < comp.memberIds.length; m++) {
        const ent = gameState.entities.get(comp.memberIds[m]);
        if (ent && ent.hp > 0 && (ent.isMoving || (ent.animState >= 3 && ent.animState <= 6))) {
          anyMemberBusy = true;
          break;
        }
      }
      if (anyMemberBusy) continue;

      const rawPushX = fxClamp(
        (comp.anchorXFx + pushVec.dxFx) | 0,
        20 * FX_ONE,
        this.cs.navGrid.worldSizeFx - 20 * FX_ONE
      );
      const rawPushZ = fxClamp(
        (comp.anchorZFx + pushVec.dzFx) | 0,
        20 * FX_ONE,
        this.cs.navGrid.worldSizeFx - 20 * FX_ONE
      );
      const freeSpot = this._findFreeMusterSpotNear(
        gameState,
        rawPushX,
        rawPushZ,
        pushVec.dir,
        comp
      );

      this.cs.movementSystem.issueArmyDragOrder(
        [comp],
        gameState.entities,
        { xFx: freeSpot.xFx, zFx: freeSpot.zFx },
        { xFx: freeSpot.xFx, zFx: freeSpot.zFx },
        CompanyOrderType.MOVE,
        gameState.tick,
        { queue: false, isRunning: false, gameState }
      );
    }
  }

  /**
   * Spawns a single reinforced soldier from the Infirmary door to rejoin an injured company.
   */
  spawnSingleReinforcedUnitFromBuilding(gameState, building, comp, UnitTypeIndex, AnimState) {
    const unitType = comp.unitType || 'swordsman';
    const unitTypeIdx = comp.unitTypeIdx ?? (UnitTypeIndex[unitType] ?? UnitTypeIndex.swordsman);
    const prof = this.cs.movementSystem.getPhysicsProfile(unitTypeIdx, unitType, comp.activeLoadoutIdx | 0);

    const doorVec = this.cs._getBuildingDoorVectorFx(
      building,
      building.footprintRadiusMeters + 1.5
    );
    const doorXFx = (building.xFx + doorVec.dxFx) | 0;
    const doorZFx = (building.zFx + doorVec.dzFx) | 0;
    const doorYFx = this.cs.navGrid.sampleHeightAtWorldFx(doorXFx, doorZFx);

    const maxHp =
      unitType === 'cavalry' ? 190 : unitType === 'archer' ? 95 : unitType === 'worker' ? 85 : 135;
    const speedFx = comp.speedFx || (unitType === 'cavalry' ? 360 : 215);

    const id = gameState.nextEntityId++;
    const slotIdx = comp.memberIds.length;

    const ent = {
      id,
      squadIndex: comp.id,
      unitTypeIdx,
      team: comp.team,
      role: 0,
      carryType: 0,
      isGarrisoned: false,
      isBuffed: Boolean(comp.hasBannerBuff),
      isHealing: true,
      isRouting: false,
      isFlying: Boolean(prof.isFlying),
      altitudeFx: 0,
      x: doorXFx,
      y: doorYFx,
      z: doorZFx,
      targetX: doorXFx,
      targetZ: doorZFx,
      slotTargetXFx: doorXFx,
      slotTargetZFx: doorZFx,
      slotIndex: slotIdx,
      isFrontRow: false,
      isMoving: true,
      flowFieldKey: null,
      pathWaypoints: null,
      pathIndex: 0,
      dir: doorVec.dir,
      desiredFacingDir: comp.facingDir,
      speedFx,
      hp: maxHp,
      maxHp,
      ammo: prof.maxAmmo | 0,
      maxAmmo: prof.maxAmmo | 0,
      visionRangeMeters: (prof.visionRangeMeters | 0) || 96,
      animState: AnimState.WALK,
      actionCooldown: 0,
      windupTicks: 0,
      shotWindupTicks: 0,
      nextShotTicks: 0,
      windupTargetId: -1,
      windupWillBeBlocked: false,
      blockVisualTicks: 0,
      knockdownTicks: 0,
      burningTicks: 0,
      reservedTargetId: -1,
      reservedSlotIdx: -1,
      inCombatStandby: false,
      ticksSinceLastHit: 999,
      waitTicks: 0,
      deadTicks: 0
    };

    gameState.entities.set(id, ent);
    comp.memberIds.push(id);
    comp.lastKnownAliveCount = comp.memberIds.length;
    gameState.sortedEntityIds.push(id);
    // Phase 6.1 Fix: Only assign the newly reinforced unit to its own slot without reshuffling existing members!
    if (typeof comp.assignSingleReinforcedUnitSlot === 'function') {
      comp.assignSingleReinforcedUnitSlot(ent, this.cs.navGrid, gameState.entities);
    } else {
      comp.updateSlotTargets(this.cs.navGrid, gameState.entities);
    }
  }

  startSequentialCompanySpawn(gameState, building, item, UnitTypeIndex) {
    const unitType = item.unitType || 'swordsman';
    const unitTypeIdx = UnitTypeIndex[unitType] ?? UnitTypeIndex.swordsman;
    const uStat = simUnitStats()?.units?.[unitType];
    const totalUnits = (uStat?.squadSize | 0) || (unitType === 'worker' || unitType === 'ballista' ? 3 : unitType === 'cavalry' ? 16 : 20);

    const doorVec = this.cs._getBuildingDoorVectorFx(
      building,
      building.footprintRadiusMeters + 1.8
    );
    const musterForwardMeters =
      unitType === 'cavalry'
        ? building.footprintRadiusMeters + 13.5
        : building.footprintRadiusMeters + 10.5;
    const musterVec = this.cs._getBuildingDoorVectorFx(building, musterForwardMeters);

    let doorXFx = (building.xFx + doorVec.dxFx) | 0;
    let doorZFx = (building.zFx + doorVec.dzFx) | 0;

    let rawMusterX = (building.xFx + musterVec.dxFx) | 0;
    let rawMusterZ = (building.zFx + musterVec.dzFx) | 0;

    // Building parts: a stored exit point replaces the default door spot; the muster spot stays in front of it.
    const exitPt = this.cs._activeStoredParts?.(building, 'exit_point')[0];
    if (exitPt) {
      const off = this.cs._localOffsetToWorldFx(building, exitPt.pos?.[0], exitPt.pos?.[2]);
      doorXFx = (building.xFx + off.dxFx) | 0;
      doorZFx = (building.zFx + off.dzFx) | 0;
      const ahead = this.cs._getBuildingDoorVectorFx(building, musterForwardMeters - (building.footprintRadiusMeters + 1.8));
      rawMusterX = (doorXFx + ahead.dxFx) | 0;
      rawMusterZ = (doorZFx + ahead.dzFx) | 0;
    }

    const walkable = this.cs.navGrid.findNearestWalkableTile(
      this.cs.navGrid.worldFxToTileX(rawMusterX),
      this.cs.navGrid.worldFxToTileZ(rawMusterZ),
      16
    );
    const musterXFx = this.cs.navGrid.tileToWorldCenterFxX(walkable.tx);
    const musterZFx = this.cs.navGrid.tileToWorldCenterFxZ(walkable.tz);

    this._pushBackBlockingCompanies(gameState, building, musterXFx, musterZFx);

    const companyId = typeof gameState.allocateCompanyId === 'function' ? gameState.allocateCompanyId() : gameState.companies.size;
    const initFacing = doorVec.dir;
    const speedFx = uStat?.speedMetersPerSec ? Math.round((Number(uStat.speedMetersPerSec) * FX_ONE) / 20) | 0 : (unitType === 'cavalry' ? 360 : unitType === 'ballista' ? 178 : 215);
    const maxHp = (uStat?.hp | 0) || (unitType === 'ballista' ? 260 : unitType === 'cavalry' ? 190 : unitType === 'archer' ? 95 : 135);

    // Pre-Phase 6 Fix (Part 0.1): All newly recruited companies (including Cavalry) default to Square (`SQUARE`)!
    const initialFormation = resolveDefaultFormation(unitType);

    const company = new Company({
      id: companyId,
      name: item.name || `${unitType.toUpperCase()} CO.`,
      team: building.team,
      unitType,
      unitTypeIdx,
      spawnXFx: musterXFx,
      spawnZFx: musterZFx,
      facingDir: initFacing,
      speedFx,
      formation: initialFormation,
      maxMemberCount: totalUnits
    });

    gameState.companies.set(companyId, company);

    building.doorOpenTicks = Math.max(building.doorOpenTicks | 0, 32);
    building.activeDoorSpawns.push({
      companyId,
      unitType,
      unitTypeIdx,
      totalUnits,
      spawnedCount: 0,
      tickTimer: 0,
      spawnIntervalTicks: 5,
      doorXFx,
      doorZFx,
      initFacing,
      speedFx,
      maxHp
    });
  }

  executeSmartRallyActionForCompany(gameState, building, comp) {
    if (!building.hasCustomRallyPoint) {
      const freeMuster = this._findFreeMusterSpotNear(
        gameState,
        comp.anchorXFx,
        comp.anchorZFx,
        comp.facingDir,
        comp
      );
      if (freeMuster.xFx !== comp.anchorXFx || freeMuster.zFx !== comp.anchorZFx) {
        this.cs.movementSystem.issueArmyDragOrder(
          [comp],
          gameState.entities,
          { xFx: freeMuster.xFx, zFx: freeMuster.zFx },
          { xFx: freeMuster.xFx, zFx: freeMuster.zFx },
          CompanyOrderType.MOVE,
          gameState.tick,
          { queue: false, isRunning: false, gameState }
        );
      }
      return;
    }

    let rallyBld =
      building.rallyTargetBuildingId > 0
        ? this.cs.buildings.get(building.rallyTargetBuildingId)
        : null;

    if (rallyBld && (rallyBld.isDestroyed || rallyBld.hp <= 0)) {
      rallyBld = null;
    }

    if (rallyBld) {
      if (rallyBld.team === building.team) {
        if (
          (rallyBld.maxGarrison | 0) > 0 &&
          !comp.isCavalry &&
          comp.unitType !== 'siege' &&
          comp.unitType !== 'ballista' &&
          rallyBld.garrisonCompanyIds.length < rallyBld.maxGarrison
        ) {
          const ordered = this.cs.garrisonSystem.orderCompaniesToGarrison(
            [comp.id],
            rallyBld.id,
            building.team,
            gameState,
            false,
            false
          );
          if (ordered) return;
        }

        if (
          comp.unitType === 'worker' &&
          (!rallyBld.isCompleted || rallyBld.hp < rallyBld.maxHp)
        ) {
          this.cs.assignWorkerCompaniesToBuilding([comp.id], rallyBld.id, false, gameState);
          return;
        }
      } else {
        const standOffFx = Math.round((rallyBld.footprintRadiusMeters + 2.0) * FX_ONE) | 0;
        const dx = (building.xFx - rallyBld.xFx) | 0;
        const dz = (building.zFx - rallyBld.zFx) | 0;
        const dist = Math.max(1, fxHypot(dx, dz));
        const goalXFx = (rallyBld.xFx + Math.imul(dx, standOffFx) / dist) | 0;
        const goalZFx = (rallyBld.zFx + Math.imul(dz, standOffFx) / dist) | 0;

        this.cs.movementSystem.issueArmyDragOrder(
          [comp],
          gameState.entities,
          { xFx: goalXFx, zFx: goalZFx },
          { xFx: goalXFx, zFx: goalZFx },
          CompanyOrderType.ATTACK_MOVE,
          gameState.tick,
          { queue: false, isRunning: false, gameState }
        );
        return;
      }
    }

    if (building.rallyTargetEnemyEntityId > 0) {
      let targetEnemyEnt = gameState.entities.get(building.rallyTargetEnemyEntityId);
      if (targetEnemyEnt && (targetEnemyEnt.hp <= 0 || targetEnemyEnt.isGarrisoned)) {
        targetEnemyEnt = null;
      }
      if (!targetEnemyEnt) {
        const nearbyIds = gameState.spatialHash.queryRadiusIds(
          building.rallyXFx,
          building.rallyZFx,
          6 * FX_ONE,
          gameState.entities
        );
        for (let n = 0; n < nearbyIds.length; n++) {
          const cand = gameState.entities.get(nearbyIds[n]);
          if (cand && cand.hp > 0 && cand.team !== building.team && !cand.isGarrisoned) {
            targetEnemyEnt = cand;
            break;
          }
        }
      }

      if (targetEnemyEnt) {
        this.cs.movementSystem.issueArmyDragOrder(
          [comp],
          gameState.entities,
          { xFx: targetEnemyEnt.x, zFx: targetEnemyEnt.z },
          { xFx: targetEnemyEnt.x, zFx: targetEnemyEnt.z },
          CompanyOrderType.ATTACK_MOVE,
          gameState.tick,
          { queue: false, isRunning: false, gameState }
        );
        return;
      }
    }

    if (comp.unitType === 'worker') {
      const startedGathering = this.cs.economySystem.assignWorkerGatheringOrder(
        [comp.id],
        building.rallyXFx,
        building.rallyZFx,
        building.team,
        gameState
      );
      if (startedGathering) return;
    }

    const rallyFacingDir = fxAtan2(
      (building.rallyZFx - building.zFx) | 0,
      (building.rallyXFx - building.xFx) | 0
    );
    const freeRallySpot = this._findFreeMusterSpotNear(
      gameState,
      building.rallyXFx,
      building.rallyZFx,
      rallyFacingDir,
      comp
    );

    this.cs.movementSystem.issueArmyDragOrder(
      [comp],
      gameState.entities,
      { xFx: freeRallySpot.xFx, zFx: freeRallySpot.zFx },
      { xFx: freeRallySpot.xFx, zFx: freeRallySpot.zFx },
      CompanyOrderType.MOVE,
      gameState.tick,
      { queue: false, isRunning: false, gameState }
    );
  }

  stepBuildingDoorSpawns(gameState, building, AnimState) {
    if (!Array.isArray(building.activeDoorSpawns) || building.activeDoorSpawns.length === 0) {
      return;
    }

    for (let s = building.activeDoorSpawns.length - 1; s >= 0; s--) {
      const stream = building.activeDoorSpawns[s];
      const comp = gameState.companies.get(stream.companyId);
      if (!comp) {
        building.activeDoorSpawns.splice(s, 1);
        continue;
      }

      building.doorOpenTicks = Math.max(building.doorOpenTicks | 0, 24);
      stream.tickTimer = (stream.tickTimer - 1) | 0;
      if (stream.tickTimer <= 0 && stream.spawnedCount < stream.totalUnits) {
        stream.tickTimer = stream.spawnIntervalTicks;
        const unitIdxInCompany = stream.spawnedCount;
        stream.spawnedCount = (stream.spawnedCount + 1) | 0;

        const id = gameState.nextEntityId++;
        const doorYFx = this.cs.navGrid.sampleHeightAtWorldFx(stream.doorXFx, stream.doorZFx);
        const isWorker = stream.unitType === 'worker';
        const prof = this.cs.movementSystem.getPhysicsProfile(stream.unitTypeIdx, stream.unitType, comp.activeLoadoutIdx | 0);

        const ent = {
          id,
          squadIndex: stream.companyId,
          unitType: stream.unitType,
          unitTypeIdx: stream.unitTypeIdx,
          activeLoadoutIdx: comp.activeLoadoutIdx | 0,
          team: building.team,
          role: !isWorker && unitIdxInCompany === 0 ? 1 : 0,
          carryType: 0,
          isGarrisoned: false,
          isBuffed: false,
          isHealing: false,
          isRouting: false,
          isFlying: Boolean(prof.isFlying),
          altitudeFx: 0,
          x: stream.doorXFx,
          y: doorYFx,
          z: stream.doorZFx,
          targetX: stream.doorXFx,
          targetZ: stream.doorZFx,
          slotTargetXFx: stream.doorXFx,
          slotTargetZFx: stream.doorZFx,
          slotIndex: unitIdxInCompany,
          isFrontRow: false,
          isMoving: true,
          flowFieldKey: null,
          pathWaypoints: null,
          pathIndex: 0,
          dir: stream.initFacing,
          desiredFacingDir: stream.initFacing,
          speedFx: stream.speedFx,
          hp: stream.maxHp,
          maxHp: stream.maxHp,
          ammo: prof.maxAmmo | 0,
          maxAmmo: prof.maxAmmo | 0,
      visionRangeMeters: (prof.visionRangeMeters | 0) || 96,
          animState: AnimState.WALK,
          actionCooldown: 0,
          windupTicks: 0,
      shotWindupTicks: 0,
      nextShotTicks: 0,
          windupTargetId: -1,
          windupWillBeBlocked: false,
          blockVisualTicks: 0,
          knockdownTicks: 0,
          burningTicks: 0,
          reservedTargetId: -1,
          reservedSlotIdx: -1,
          inCombatStandby: false,
          ticksSinceLastHit: 999,
          waitTicks: 0,
          deadTicks: 0
        };

        gameState.entities.set(id, ent);
        comp.memberIds.push(id);
        comp.lastKnownAliveCount = comp.memberIds.length;
        gameState.sortedEntityIds.push(id);

        comp.updateSlotTargets(this.cs.navGrid, gameState.entities);
      }

      if (stream.spawnedCount >= stream.totalUnits) {
        if (comp.hasPlayerOrder) {
          building.activeDoorSpawns.splice(s, 1);
          continue;
        }

        stream.postSpawnWaitTicks = ((stream.postSpawnWaitTicks | 0) + 1) | 0;
        let allGrouped = true;
        for (let m = 0; m < comp.memberIds.length; m++) {
          const member = gameState.entities.get(comp.memberIds[m]);
          if (member && member.hp > 0) {
            const distSlot = fxHypot(
              (member.x - member.slotTargetXFx) | 0,
              (member.z - member.slotTargetZFx) | 0
            );
            if (distSlot > 2 * FX_ONE) {
              allGrouped = false;
              break;
            }
          }
        }

        if (allGrouped || stream.postSpawnWaitTicks >= 40) {
          building.activeDoorSpawns.splice(s, 1);
          if (!comp.hasPlayerOrder) {
            this.executeSmartRallyActionForCompany(gameState, building, comp);
          }
        }
      }
    }
  }

  getItemPopulationCost(item) {
    if (!item) return 0;
    if (item.kind === 'hero') return 1;
    if (item.kind !== 'unit') return 0;
    const unitType = item.unitType || 'swordsman';
    const uStat = simUnitStats()?.units?.[unitType];
    if (uStat?.popCost) return uStat.popCost | 0;
    if (item.optionId === 'ballista' || unitType === 'ballista') return 3;
    return unitType === 'worker' ? 3 : unitType === 'cavalry' ? 16 : 20;
  }

  hasPopulationRoomFor(gameState, team, neededPop) {
    if ((neededPop | 0) <= 0) return true;
    const eco = this.cs.economySystem;
    if (!eco) return true;
    const popCap = eco.computeTeamPopCap(team, this.cs.buildings, this.cs.sortedBuildingIds);
    const popInfo = eco.computeTeamPopUsedAndReserved(gameState, team);
    return (popInfo.totalCommitted + (neededPop | 0)) <= popCap;
  }

  stepBuildingProduction(gameState, building, UnitTypeIndex) {
    if (building.productionQueue.length === 0) {
      building.isPopHold = false;
      return;
    }

    const currentItem = building.productionQueue[0];
    const bDef = this.cs.buildingDefs[building.type];
    const speedBonusPctPerLv = Math.max(0, (bDef?.trainSpeedBonusPctPerLevel | 0) || 0);
    const lvAbove1 = Math.max(0, ((building.level || 1) - 1) | 0);
    const speedDivisorPermille = 1000 + lvAbove1 * speedBonusPctPerLv * 10;
    const rawTrainTicks = Math.max(2, currentItem.trainTicks | 0);
    const effectiveTrainTicks =
      currentItem.kind === "unit" && lvAbove1 > 0
        ? Math.max(2, Math.round((rawTrainTicks * 1000) / speedDivisorPermille) | 0)
        : rawTrainTicks;
    building.productionTotalTicks = effectiveTrainTicks;

    const holdThresholdTicks = Math.max(1, (effectiveTrainTicks - 1) | 0);
    const neededPop = this.getItemPopulationCost(currentItem);

    if (neededPop > 0 && building.productionProgressTicks >= holdThresholdTicks) {
      if (!this.hasPopulationRoomFor(gameState, building.team, neededPop)) {
        building.productionProgressTicks = holdThresholdTicks;
        building.isPopHold = true;
        return;
      }
    }

    building.isPopHold = false;
    building.productionProgressTicks = (building.productionProgressTicks + 1) | 0;

    if (building.productionProgressTicks >= effectiveTrainTicks) {
      if (neededPop > 0 && !this.hasPopulationRoomFor(gameState, building.team, neededPop)) {
        building.productionProgressTicks = holdThresholdTicks;
        building.isPopHold = true;
        return;
      }

      building.productionQueue.shift();
      building.productionProgressTicks = 0;
      building.productionTotalTicks =
        building.productionQueue.length > 0 ? (building.productionQueue[0].trainTicks | 0) : 0;

      if (currentItem.kind === 'level_upgrade') {
        const def = this.cs.buildingDefs[building.type];
        building.xp = 0;
        if (def) this.levelUpBuilding(building, def);
      } else if (currentItem.kind === 'hero') {
        gameState.heroSystem?.spawnHeroFromBuilding?.(
          gameState,
          building,
          currentItem,
          UnitTypeIndex,
          { WALK: 1, IDLE: 0 }
        );
        this.addBuildingXp(building, currentItem.xpReward);
      } else if (currentItem.kind === 'unit') {
        this.startSequentialCompanySpawn(gameState, building, currentItem, UnitTypeIndex);
        this.addBuildingXp(building, currentItem.xpReward);
      } else {
        this.addBuildingXp(building, currentItem.xpReward);
      }
    }
  }

  flushPendingLevelUpEvents(gameState) {
    while (this.pendingLevelUpEvents.length > 0) {
      const ev = this.pendingLevelUpEvents.shift();
      gameState.pendingEvents.push({
        tick: gameState.tick,
        kind: 'BUILDING_LEVEL_UP',
        buildingId: ev.buildingId,
        level: ev.level,
        xFx: ev.xFx,
        yFx: (ev.yFx + 3 * FX_ONE) | 0,
        zFx: ev.zFx,
        label: `${ev.name} Reached Level ${ev.level}!`
      });
    }
  }
}
