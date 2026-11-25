import { applySimSnapshot, simBuildings } from './simConfig.js';
import {
  FX_ONE,
  TICKS_PER_SEC,
  mulDiv,
  fxClamp,
  toFx
} from '../core/fx.js';
import {
  NavGrid,
  NavTileType,
  computeRiverCenterZFx,
  isOnBridgeFx,
  sampleTerrainHeightFx,
  sampleTerrainMeshHeightMeters,
  classifyTileTypeFx
} from './nav/grid.js';
import { AStar } from './nav/astar.js';
import { FlowFieldManager } from './nav/flowField.js';
import { SpatialHash } from './nav/spatialHash.js';
import { MovementSystem } from './systems/movementSystem.js';
import { EconomySystem, GathererState } from './systems/economySystem.js';
import { ConstructionSystem } from './systems/constructionSystem.js';
import {
  MoraleStaminaSystem,
  VisionSystem,
  VictorySystem
} from './systems/moraleStaminaSystem.js';
import { Company, resolveDefaultFormation } from './formations/company.js';
import { HeroSystem } from './systems/heroSystem.js';
import { processSimCommands } from './commandHandlers.js';
import { EnemyAiController } from './ai/enemyAiController.js';

export {
  computeRiverCenterZFx,
  isOnBridgeFx,
  sampleTerrainHeightFx,
  sampleTerrainMeshHeightMeters,
  classifyTileTypeFx
};

export const TileType = Object.freeze({
  PLAINS: NavTileType.PLAINS,
  HILL: NavTileType.HILL,
  SHALLOW_WATER: NavTileType.MUD_WATER,
  MUD_WATER: NavTileType.MUD_WATER,
  FOREST: NavTileType.FOREST,
  BRIDGE: NavTileType.BRIDGE,
  DEEP_RIVER: NavTileType.BLOCKED,
  BLOCKED: NavTileType.BLOCKED
});

export const AnimState = Object.freeze({
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  ATTACK: 3,
  SHOOT: 4,
  THROW: 5,
  HURT: 6,
  DIE: 7,
  SPEAR_WALL_IDLE: 8,
  BUILD: 9,
  GATHER: 10,
  BLOCK: 11,
  KNOCKED_DOWN: 12,
  COMBAT_STANDBY: 13,
  CHARGE: 14,
  CHOP: 15,
  MINE: 16
});

export const UnitTypeIndex = Object.freeze({
  worker: 0,
  swordsman: 1,
  spearman: 2,
  archer: 3,
  cavalry: 4,
  hero: 5,
  ballista: 6
});

export const IndexToUnitType = Object.freeze([
  'worker',
  'swordsman',
  'spearman',
  'archer',
  'cavalry',
  'hero',
  'ballista'
]);

export const SNAPSHOT_STRIDE = 9;
export const CORPSE_DECAY_TICKS = (10 * TICKS_PER_SEC) | 0; // 10 seconds (200 ticks)
const CORPSE_SINK_START_TICKS = (CORPSE_DECAY_TICKS - 30) | 0; // Sink during last 1.5s

export class GameState {
  constructor(config) {
    this.config = config;
    if (config?.simSnapshot) applySimSnapshot(config.simSnapshot);   // the ONLY way lab data reaches a match
    this.tick = 0;
    this.rngState = (config?.simulation?.initialSeed | 0) || 133742069;

    this.tilesX = (config?.map?.tilesX | 0) || 1024;
    this.tilesZ = (config?.map?.tilesZ | 0) || 1024;
    this.tileSizeMeters = (config?.map?.tileSizeMeters | 0) || 4;
    this.worldSizeMeters = (this.tilesX * this.tileSizeMeters) | 0;
    this.worldSizeFx = (this.worldSizeMeters * FX_ONE) | 0;
    this.centerMeters = (this.worldSizeMeters >> 1) | 0;

    this.navGrid = new NavGrid(config);
    this.spatialHash = new SpatialHash(
      this.worldSizeMeters,
      8,
      (config?.simulation?.maxEntities | 0) || 2048
    );
    this.astar = new AStar(this.navGrid);
    this.astar.setBuildingsSource(() => this.constructionSystem?.buildings);
    this.flowFieldManager = new FlowFieldManager(this.navGrid, 16);
    this.moraleStaminaSystem = new MoraleStaminaSystem();
    this.visionSystem = new VisionSystem(this.navGrid, config);
    this.victorySystem = new VictorySystem();
    this.movementSystem = new MovementSystem({
      navGrid: this.navGrid,
      spatialHash: this.spatialHash,
      astar: this.astar,
      flowFieldManager: this.flowFieldManager,
      moraleStaminaSystem: this.moraleStaminaSystem
    });

    this.heroSystem = new HeroSystem(config);
    this.economySystem = new EconomySystem(this.navGrid, config);
    this.constructionSystem = new ConstructionSystem({
      navGrid: this.navGrid,
      economySystem: this.economySystem,
      movementSystem: this.movementSystem
    });
    this.constructionSystem.gameStateRef = this;
    this.teamAlliances = new Map();
    this.isSpectatorMode = Boolean(config?.matchSetup?.isSpectator);
    this.playerTeam = this.isSpectatorMode ? 0 : ((config?.matchSetup?.playerTeam | 0) || 1);
    if (config?.matchSetup?.useMatchSetup && Array.isArray(config.matchSetup.participants)) {
      for (const p of config.matchSetup.participants) {
        if (p && p.role !== 'closed' && p.controller !== 'closed' && (p.team | 0) > 0) {
          this.teamAlliances.set(p.team | 0, (p.teamNumber ?? p.team) | 0);
        }
      }
    }
    if (config?.teamAlliances && typeof config.teamAlliances === 'object') {
      for (const [t, a] of Object.entries(config.teamAlliances)) {
        this.teamAlliances.set(t | 0, a | 0);
      }
    }
    if (config?.matchSetup?.useMatchSetup && Array.isArray(config.matchSetup.participants)) {
      this.aiControllers = config.matchSetup.participants
        .filter((p) => p && p.controller === 'ai' && p.role !== 'closed' && (p.team | 0) > 0)
        .map((p) => new EnemyAiController(config, p.team | 0, p));
      this.enemyAi = this.aiControllers.find((a) => a.team === 2) || this.aiControllers[0] || new EnemyAiController({ ...config, ai: { enabled: false } }, 2);
    } else {
      this.enemyAi = new EnemyAiController(config, 2);
      this.aiControllers = [this.enemyAi];
    }

    this.entities = new Map();
    this.companies = new Map();
    this.entities.companies = this.companies;
    this.sortedEntityIds = [];
    this.nextEntityId = 1;
    this.nextCompanyId = 0;

    const midFx = (this.centerMeters * FX_ONE) | 0;
    this.lastEventFx = {
      x: midFx,
      y: sampleTerrainHeightFx(midFx, midFx, true, this.worldSizeMeters),
      z: midFx,
      label: 'Bridge Vanguard Muster',
      tick: 0
    };

    this.pendingEvents = [];
    this.constructionSystem.spawnStartingCitadels(this.config?.matchSetup || null);
    this._spawnInitialSquads();
    this.victorySystem.update(this, { AnimState, UnitTypeIndex });
    if (config?.loadedSaveState) {
      this.importSaveState(config.loadedSaveState);
    }
    this.visionSystem.update(this, true);
  }


  /**
   * Deterministically allocates a unique companyId (0..254) that is never in use by any active company or entity.
   */
  allocateCompanyId() {
    while (this.companies.has(this.nextCompanyId) && this.nextCompanyId < 250) {
      this.nextCompanyId++;
    }
    if (this.nextCompanyId < 250 && !this.companies.has(this.nextCompanyId)) {
      return this.nextCompanyId++;
    }
    const usedByEntities = new Set();
    for (let i = 0; i < this.sortedEntityIds.length; i++) {
      const e = this.entities.get(this.sortedEntityIds[i]);
      if (e) usedByEntities.add(e.squadIndex | 0);
    }
    for (let cid = 1; cid < 254; cid++) {
      if (!this.companies.has(cid) && !usedByEntities.has(cid)) {
        return cid;
      }
    }
    return this.nextCompanyId++;
  }

  /**
   * Spawns a new company and its member entities at `(spawnMetersX, spawnMetersZ)` deterministically.
   */
  spawnCompany({
    name,
    team = 1,
    unitType = 'swordsman',
    count = 20,
    spawnMetersX = 2048,
    spawnMetersZ = 1750,
    facingDir = 256,
    speedFx = 215,
    hp = 135,
    formation = null
  } = {}) {
    const nextCompId = this.allocateCompanyId();

    const unitTypeIdx = UnitTypeIndex[unitType] ?? UnitTypeIndex.swordsman;
    const baseSpawnX = Math.round(spawnMetersX * FX_ONE) | 0;
    const baseSpawnZ = Math.round(spawnMetersZ * FX_ONE) | 0;
    const walkableAnchor = this.navGrid.findNearestWalkableTile(
      this.navGrid.worldFxToTileX(baseSpawnX),
      this.navGrid.worldFxToTileZ(baseSpawnZ),
      16
    );
    const anchorXFx = this.navGrid.tileToWorldCenterFxX(walkableAnchor.tx);
    const anchorZFx = this.navGrid.tileToWorldCenterFxZ(walkableAnchor.tz);
    const initFacing = (facingDir | 0) & 1023;

    const company = new Company({
      id: nextCompId,
      name: name || `${unitType.toUpperCase()} CO. #${nextCompId + 1}`,
      team: team | 0,
      unitType,
      unitTypeIdx,
      spawnXFx: anchorXFx,
      spawnZFx: anchorZFx,
      facingDir: initFacing,
      speedFx: speedFx | 0,
      formation: formation || resolveDefaultFormation(unitType),
      maxMemberCount: count | 0
    });

    const prof = this.movementSystem.getPhysicsProfile(unitTypeIdx, unitType);
    const maxHpVal = (hp | 0) || 135;

    for (let i = 0; i < (count | 0); i++) {
      const id = this.nextEntityId++;
      const ent = {
        id,
        squadIndex: nextCompId,
        unitTypeIdx,
        team: team | 0,
        role: unitType !== 'worker' && unitType !== 'ballista' && i === 0 ? 1 : 0,
        carryType: 0,
        isGarrisoned: false,
        isBuffed: false,
        isHealing: false,
        isRouting: false,
        isFlying: Boolean(prof.isFlying),
        altitudeFx: 0,
        x: anchorXFx,
        y: 0,
        z: anchorZFx,
        targetX: anchorXFx,
        targetZ: anchorZFx,
        slotTargetXFx: anchorXFx,
        slotTargetZFx: anchorZFx,
        slotIndex: i,
        isFrontRow: false,
        isMoving: false,
        flowFieldKey: null,
        pathWaypoints: null,
        pathIndex: 0,
        dir: initFacing,
        desiredFacingDir: initFacing,
        speedFx: speedFx | 0,
        hp: maxHpVal,
        maxHp: maxHpVal,
        ammo: prof.maxAmmo | 0,
        maxAmmo: prof.maxAmmo | 0,
        visionRangeMeters: (prof.visionRangeMeters | 0) || 96,
        animState: AnimState.IDLE,
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
      this.entities.set(id, ent);
      company.memberIds.push(id);
      this.sortedEntityIds.push(id);
    }

    company.updateSlotTargets(this.navGrid, this.entities);
    for (let i = 0; i < company.memberIds.length; i++) {
      const ent = this.entities.get(company.memberIds[i]);
      if (ent) {
        ent.x = ent.slotTargetXFx;
        ent.z = ent.slotTargetZFx;
        ent.targetX = ent.slotTargetXFx;
        ent.targetZ = ent.slotTargetZFx;
        ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
      }
    }

    this.companies.set(nextCompId, company);
    this.sortedEntityIds.sort((a, b) => a - b);
    this.spatialHash.rebuild(this.entities, this.sortedEntityIds);
    this.economySystem?.recalculatePopulation?.(this);
    return company;
  }

  _spawnInitialSquads() {
    let squads = this.config?.initialSquads || [];
    if (this.config?.matchSetup?.useMatchSetup && Array.isArray(this.config.matchSetup.participants)) {
      squads = [];
      const activeParts = this.config.matchSetup.participants.filter(
        (p) => p && p.role !== 'closed' && p.controller !== 'closed' && (p.team | 0) > 0
      );
      for (let pIdx = 0; pIdx < activeParts.length; pIdx++) {
        const p = activeParts[pIdx];
        const doorZSign = ((p.facingDir ?? 256) >= 512) ? -1 : 1;
        for (let wIdx = 0; wIdx < 2; wIdx++) {
          const offsetX = wIdx === 0 ? -16 : 16;
          squads.push({
            name: `Royal Builders #${wIdx + 1}`,
            unitType: 'worker',
            formation: 'square',
            team: p.team | 0,
            count: 3,
            spawnX: Math.round((Number(p.x) || 2048) + offsetX),
            spawnZ: Math.round((Number(p.z) || 1660) + doorZSign * 22),
            facingDir: p.facingDir ?? ((p.team | 0) === 1 ? 256 : 768),
            speedMetersPerSec: 3.8,
            maxHp: 85,
            aiSlotIndex: p.controller === 'ai' ? p.slotIndex : null
          });
        }
      }
    }
    for (let s = 0; s < squads.length; s++) {
      const sq = squads[s];
      const isWorkerSquad = sq.unitType === 'worker';
      const count = isWorkerSquad ? 3 : fxClamp((sq.count | 0) || 16, 16, 30);
      const baseSpawnX = ((sq.spawnX | 0) * FX_ONE) | 0;
      const baseSpawnZ = ((sq.spawnZ | 0) * FX_ONE) | 0;
      const speedPerTickFx = ((toFx(sq.speedMetersPerSec || 4.0) / TICKS_PER_SEC) | 0) || 210;
      const unitTypeIdx = UnitTypeIndex[sq.unitType] ?? UnitTypeIndex.swordsman;
      const initFacing = (sq.team | 0) === 1 ? 256 : 768;

      const walkableAnchor = this.navGrid.findNearestWalkableTile(
        this.navGrid.worldFxToTileX(baseSpawnX),
        this.navGrid.worldFxToTileZ(baseSpawnZ),
        16
      );
      const anchorXFx = this.navGrid.tileToWorldCenterFxX(walkableAnchor.tx);
      const anchorZFx = this.navGrid.tileToWorldCenterFxZ(walkableAnchor.tz);

      const initialFormation =
        sq.unitType === 'cavalry'
          ? resolveDefaultFormation('cavalry')
          : sq.formation || resolveDefaultFormation(sq.unitType);

      const company = new Company({
        id: s,
        name: sq.name || `Company #${s + 1}`,
        team: sq.team | 0,
        unitType: sq.unitType,
        unitTypeIdx,
        spawnXFx: anchorXFx,
        spawnZFx: anchorZFx,
        facingDir: initFacing,
        speedFx: speedPerTickFx,
        formation: initialFormation,
        maxMemberCount: count
      });

      const prof = this.movementSystem.getPhysicsProfile(unitTypeIdx, sq.unitType);
      const initAnim =
        company.formation === 'spearWall' && unitTypeIdx === UnitTypeIndex.spearman
          ? AnimState.SPEAR_WALL_IDLE
          : AnimState.IDLE;

      for (let i = 0; i < count; i++) {
        const id = this.nextEntityId++;
        const ent = {
          id,
          squadIndex: s,
          unitType: sq.unitType,
          unitTypeIdx,
          activeLoadoutIdx: 0,
          team: sq.team | 0,
          role: !isWorkerSquad && i === 0 ? 1 : 0,
          carryType: 0,
          isGarrisoned: false,
          isBuffed: false,
          isHealing: false,
          isRouting: false,
          isFlying: Boolean(prof.isFlying),
          altitudeFx: 0,
          x: anchorXFx,
          y: 0,
          z: anchorZFx,
          targetX: anchorXFx,
          targetZ: anchorZFx,
          slotTargetXFx: anchorXFx,
          slotTargetZFx: anchorZFx,
          slotIndex: i,
          isFrontRow: false,
          isMoving: false,
          flowFieldKey: null,
          pathWaypoints: null,
          pathIndex: 0,
          dir: initFacing,
          desiredFacingDir: initFacing,
          speedFx: speedPerTickFx,
          hp: sq.maxHp | 0,
          maxHp: sq.maxHp | 0,
          ammo: prof.maxAmmo | 0,
          maxAmmo: prof.maxAmmo | 0,
        visionRangeMeters: (prof.visionRangeMeters | 0) || 96,
          animState: initAnim,
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

        this.entities.set(id, ent);
        company.memberIds.push(id);
      }

      company.updateSlotTargets(this.navGrid, this.entities);
      for (let i = 0; i < company.memberIds.length; i++) {
        const ent = this.entities.get(company.memberIds[i]);
        if (ent) {
          ent.x = ent.slotTargetXFx;
          ent.z = ent.slotTargetZFx;
          ent.targetX = ent.slotTargetXFx;
          ent.targetZ = ent.slotTargetZFx;
          ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
        }
      }

      if (sq.aiSlotIndex !== undefined && sq.aiSlotIndex !== null) {
        company.aiSlotIndex = sq.aiSlotIndex;
      }
      this.companies.set(s, company);
      if (s >= this.nextCompanyId) this.nextCompanyId = s + 1;
    }

    this.sortedEntityIds = Array.from(this.entities.keys()).sort((a, b) => a - b);
    this.spatialHash.rebuild(this.entities, this.sortedEntityIds);
  }

  areTeamsAllied(teamA, teamB) {
    const a = teamA | 0;
    const b = teamB | 0;
    if (a <= 0 || b <= 0) return false;
    if (a === b) return true;
    const alA = this.teamAlliances.get(a) ?? a;
    const alB = this.teamAlliances.get(b) ?? b;
    return alA === alB;
  }

  areTeamsEnemy(teamA, teamB) {
    const a = teamA | 0;
    const b = teamB | 0;
    if (a <= 0 || b <= 0) return false;
    return !this.areTeamsAllied(a, b);
  }

  getTeamAlliancesObject() {
    const obj = {};
    for (const [k, v] of this.teamAlliances.entries()) {
      obj[k] = v;
    }
    return obj;
  }


  exportSaveState() {
    const teamResources = [];
    for (const [tid, ledger] of this.economySystem.teamResources.entries()) {
      teamResources.push([tid, { ...ledger }]);
    }
    const buildings = [];
    for (const b of this.constructionSystem.buildings.values()) {
      if (!b || b.isDestroyed || b.hp <= 0) continue;
      buildings.push({
        ...b,
        productionQueue: Array.isArray(b.productionQueue) ? b.productionQueue.map((q) => ({ ...q })) : [],
        garrisonCompanyIds: Array.isArray(b.garrisonCompanyIds) ? [...b.garrisonCompanyIds] : []
      });
    }
    const companies = [];
    for (const c of this.companies.values()) {
      if (!c || c.memberIds.length === 0) continue;
      companies.push({
        id: c.id,
        name: c.name,
        team: c.team,
        unitType: c.unitType,
        unitTypeIdx: c.unitTypeIdx,
        formation: c.formation,
        anchorXFx: c.anchorXFx,
        anchorZFx: c.anchorZFx,
        facingDir: c.facingDir,
        isHero: Boolean(c.isHero),
        heroId: c.heroId || null,
        heroLevel: c.heroLevel || 1,
        heroXp: c.heroXp || 0,
        activeLoadoutIdx: c.activeLoadoutIdx || 0,
        wantsToRun: Boolean(c.wantsToRun),
        staminaPermille: c.staminaPermille ?? 1000,
        moralePermille: c.moralePermille ?? 1000,
        aiSlotIndex: c.aiSlotIndex ?? null,
        memberIds: [...c.memberIds]
      });
    }
    const entities = [];
    for (const ent of this.entities.values()) {
      if (!ent || ent.hp <= 0) continue;
      entities.push({ ...ent, routeWaypoints: [] });
    }
    return {
      tick: this.tick | 0,
      rngState: this.rngState | 0,
      nextEntityId: this.nextEntityId | 0,
      nextCompanyId: this.nextCompanyId | 0,
      nextBuildingId: this.constructionSystem.nextBuildingId | 0,
      teamResources,
      depletedTreeIds: this.economySystem.getDepletedTreeIds(),
      buildings,
      companies,
      entities,
      fowGridTeam1: Array.from(this.visionSystem.fowGridTeam1)
    };
  }

  importSaveState(save) {
    if (!save || typeof save !== 'object') return;
    this.tick = save.tick | 0;
    this.rngState = (save.rngState | 0) || this.rngState;
    this.nextEntityId = Math.max(1, save.nextEntityId | 0);
    this.nextCompanyId = Math.max(0, save.nextCompanyId | 0);

    if (Array.isArray(save.teamResources)) {
      this.economySystem.teamResources.clear();
      for (const [tid, ledger] of save.teamResources) {
        this.economySystem.teamResources.set(tid | 0, { ...ledger });
      }
    }

    if (Array.isArray(save.depletedTreeIds)) {
      for (const treeId of save.depletedTreeIds) {
        const t = this.economySystem.trees.get(treeId);
        if (t) {
          t.woodRemaining = 0;
          t.isChopped = true;
        }
      }
    }

    if (Array.isArray(save.buildings)) {
      this.constructionSystem.buildings.clear();
      this.constructionSystem.sortedBuildingIds = [];
      this.constructionSystem.nextBuildingId = Math.max(1, save.nextBuildingId | 0);
      for (const b of save.buildings) {
        this.constructionSystem.buildings.set(b.id | 0, {
          ...b,
          productionQueue: Array.isArray(b.productionQueue) ? b.productionQueue.map((q) => ({ ...q })) : [],
          garrisonCompanyIds: Array.isArray(b.garrisonCompanyIds) ? [...b.garrisonCompanyIds] : []
        });
        this.constructionSystem.sortedBuildingIds.push(b.id | 0);
      }
      this.constructionSystem.sortedBuildingIds.sort((a, b) => a - b);
    }

    if (Array.isArray(save.companies) && Array.isArray(save.entities)) {
      this.entities.clear();
      this.companies.clear();
      this.sortedEntityIds = [];
      for (const ent of save.entities) {
        this.entities.set(ent.id | 0, { ...ent, routeWaypoints: [] });
        this.sortedEntityIds.push(ent.id | 0);
      }
      this.sortedEntityIds.sort((a, b) => a - b);

      for (const c of save.companies) {
        const comp = new Company({
          id: c.id | 0,
          name: c.name,
          team: c.team | 0,
          unitType: c.unitType,
          formation: c.formation,
          anchorXFx: c.anchorXFx | 0,
          anchorZFx: c.anchorZFx | 0,
          facingDir: c.facingDir | 0,
          isHero: Boolean(c.isHero),
          heroId: c.heroId || null
        });
        comp.heroLevel = c.heroLevel || 1;
        comp.heroXp = c.heroXp || 0;
        comp.activeLoadoutIdx = c.activeLoadoutIdx || 0;
        comp.wantsToRun = Boolean(c.wantsToRun);
        comp.staminaPermille = c.staminaPermille ?? 1000;
        comp.moralePermille = c.moralePermille ?? 1000;
        comp.aiSlotIndex = c.aiSlotIndex ?? null;
        comp.memberIds = (c.memberIds || []).filter((id) => this.entities.has(id));
        if (comp.memberIds.length > 0) {
          this.companies.set(comp.id, comp);
        }
      }
      this.spatialHash.rebuild(this.entities, this.sortedEntityIds);
      this.economySystem.recalculatePopulation?.(this);
    }

    if (Array.isArray(save.fowGridTeam1) && save.fowGridTeam1.length === this.visionSystem.fowGridTeam1.length) {
      this.visionSystem.fowGridTeam1.set(save.fowGridTeam1);
    }
  }

  processCommands(commands) {
    processSimCommands(this, commands);
  }

  recordWorldEvent(fxX, fxY, fxZ, label) {
    this.lastEventFx = {
      x: fxX | 0,
      y: fxY | 0,
      z: fxZ | 0,
      label: String(label || 'World Event'),
      tick: this.tick
    };
    this.pendingEvents.push({
      tick: this.tick,
      kind: 'WORLD_EVENT',
      xFx: this.lastEventFx.x,
      yFx: this.lastEventFx.y,
      zFx: this.lastEventFx.z,
      label: this.lastEventFx.label
    });
  }

  _stepCorpseDecay() {
    let anyRemoved = false;
    for (let i = 0; i < this.sortedEntityIds.length; i++) {
      const id = this.sortedEntityIds[i];
      const ent = this.entities.get(id);
      if (!ent || ent.hp > 0) continue;

      ent.animState = AnimState.DIE;
      ent.role = 0;
      ent.carryType = 0;
      ent.isBuffed = false;
      ent.isHealing = false;
      ent.isRouting = false;
      ent.knockdownTicks = 0;
      ent.isMoving = false;
      ent.deadTicks = ((ent.deadTicks | 0) + 1) | 0;

      if (ent.deadTicks > CORPSE_SINK_START_TICKS) {
        const groundYFx = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
        const sinkProgress = (ent.deadTicks - CORPSE_SINK_START_TICKS) | 0;
        ent.y = (groundYFx - sinkProgress * 28) | 0;
      }

      if (ent.deadTicks >= CORPSE_DECAY_TICKS) {
        this.entities.delete(id);
        anyRemoved = true;
      }
    }

    if (anyRemoved) {
      this.sortedEntityIds = this.sortedEntityIds.filter((id) => this.entities.has(id));
    }
  }

  stepTick(commands = []) {
    this.tick = (this.tick + 1) | 0;
    this.pendingEvents.length = 0;
    if (commands && commands.length > 0) this.processCommands(commands);

    if (Array.isArray(this.aiControllers) && this.aiControllers.length > 0) {
      for (let a = 0; a < this.aiControllers.length; a++) {
        const ctrl = this.aiControllers[a];
        if (!ctrl) continue;
        const aiCommands = ctrl.generateCommands(this);
        if (aiCommands && aiCommands.length > 0) {
          this.processCommands(aiCommands);
        }
      }
    } else if (this.enemyAi) {
      const aiCommands = this.enemyAi.generateCommands(this);
      if (aiCommands && aiCommands.length > 0) {
        this.processCommands(aiCommands);
      }
    }

    this.constructionSystem.update(this, { AnimState, UnitTypeIndex });
    this.heroSystem.update(this, { AnimState, UnitTypeIndex });
    this.moraleStaminaSystem.update(this, { AnimState, UnitTypeIndex });
    this.movementSystem.update(this, { AnimState, UnitTypeIndex });
    this.economySystem.update(
      this.tick,
      this.constructionSystem.buildings,
      this.constructionSystem.sortedBuildingIds,
      this,
      { AnimState, UnitTypeIndex }
    );
    this._stepCorpseDecay();
    this.victorySystem.update(this, { AnimState, UnitTypeIndex });
    this.visionSystem.update(this);
  }

  computeStateHash() {
    let hash = (2166136261 ^ this.tick ^ this.rngState) | 0;
    const ids = this.sortedEntityIds;
    for (let i = 0; i < ids.length; i++) {
      const e = this.entities.get(ids[i]);
      if (!e) continue;
      hash = Math.imul(hash ^ e.id, 16777619);
      hash = Math.imul(hash ^ e.x, 16777619);
      hash = Math.imul(hash ^ e.y, 16777619);
      hash = Math.imul(hash ^ e.z, 16777619);
      hash = Math.imul(hash ^ e.dir, 16777619);
      hash = Math.imul(hash ^ e.hp, 16777619);
    }
    return hash >>> 0;
  }


  /**
   * Re-reads the sim data from a snapshot (tests / explicit "apply now"). The live game never calls this:
   * a match keeps the snapshot it started with.
   */
  applySimConfig(snapshot) {
    applySimSnapshot(snapshot);
    if (this.constructionSystem && simBuildings()?.buildings) {
      this.constructionSystem.buildingDefs = simBuildings().buildings;
    }
    if (this.economySystem && simBuildings()?.buildings) {
      this.economySystem.buildingDefs = simBuildings().buildings;
      if (simBuildings().economy) this.economySystem.ecoConfig = simBuildings().economy;
    }
    for (const comp of this.companies.values()) {
      if (!comp || comp.isHero) continue;
      const caps = comp.getActiveCapabilities?.();
      if (caps) {
        comp.hasSecondaryLoadout = Boolean(caps.hasSecondaryLoadout);
        comp.activeWeaponMode = caps.isRangedLoadout ? 'ranged' : 'melee';
      }
    }
  }

  packSnapshot(measuredTpsPermille = 20000, reusedMetaBuffer = null, reusedEntityBuffer = null) {
    const count = this.sortedEntityIds.length;
    const meta =
      reusedMetaBuffer && reusedMetaBuffer.byteLength === 32
        ? new Int32Array(reusedMetaBuffer)
        : new Int32Array(8);
    const requiredBytes = count * SNAPSHOT_STRIDE * 4;
    const entityData =
      reusedEntityBuffer && reusedEntityBuffer.byteLength === requiredBytes
        ? new Int32Array(reusedEntityBuffer)
        : new Int32Array(count * SNAPSHOT_STRIDE);

    meta[0] = this.tick | 0;
    meta[1] = count | 0;
    meta[2] = this.rngState | 0;
    meta[3] = this.lastEventFx.x | 0;
    meta[4] = this.lastEventFx.y | 0;
    meta[5] = this.lastEventFx.z | 0;
    meta[6] = this.computeStateHash() | 0;
    meta[7] = measuredTpsPermille | 0;

    let team1PopUsed = 0;
    for (let i = 0; i < count; i++) {
      const ent = this.entities.get(this.sortedEntityIds[i]);
      if (ent.team === 1 && ent.hp > 0) team1PopUsed++;
      const base = i * SNAPSHOT_STRIDE;
      entityData[base + 0] = ent.id | 0;
      entityData[base + 1] = ent.x | 0;
      entityData[base + 2] = (ent.y + (ent.altitudeFx | 0)) | 0;
      entityData[base + 3] = ent.z | 0;
      entityData[base + 4] = ent.dir | 0;
      entityData[base + 5] = ent.hp | 0;
      entityData[base + 6] = ent.maxHp | 0;

      // Bit-packed flags in entityData[base + 7]:
      // bits 0..5: animState (0..63)
      // bit 6: hasBannerBuff (isBuffed)
      // bit 7: isHealing
      // bits 8..11: team
      // bits 12..14: role
      // bit 15: isRouting
      // bits 16..23: companyId
      // bits 24..26: unitTypeIdx
      // bits 27..29: carryType
      // bit 30: isGarrisoned
      // bit 31: isKnockedDown
      entityData[base + 7] =
        ((ent.animState & 0x3f) |
          ((ent.isBuffed ? 1 : 0) << 6) |
          ((ent.isHealing ? 1 : 0) << 7) |
          ((ent.team & 0x0f) << 8) |
          ((ent.role & 0x07) << 12) |
          ((ent.isRouting ? 1 : 0) << 15) |
          ((ent.squadIndex & 0xff) << 16) |
          ((ent.unitTypeIdx & 0x07) << 24) |
          (((ent.carryType | 0) & 0x07) << 27) |
          ((ent.isGarrisoned ? 1 : 0) << 30) |
          (((ent.knockdownTicks | 0) > 0 ? 1 : 0) << 31)) |
        0;

      // entityData[base + 8]: attack windup for the renderer (animation <-> simulation sync)
      // bits 0..7: ticks left until the hit / release; bit 8: 1 = ranged shot (draw / throw), 0 = melee swing
      const shotLeft = ent.shotWindupTicks | 0;
      const swingLeft = ent.windupTicks | 0;
      const lastStandBit = ent.isRevealedLastStand ? 0x200 : 0;
      const spellSlotBits = ((ent.activeSpellSlotIdx | 0) & 0x07) << 10;
      const burningBit = (ent.burningTicks | 0) > 0 ? 0x2000 : 0;
      const poisonBit = (ent.poisonTicks | 0) > 0 ? 0x4000 : 0;
      const frozenBit = (ent.frozenTicks | 0) > 0 ? 0x8000 : 0;
      const heroBuffBits = ((ent.heroBuffVisual | 0) & 0x03) << 16;
      const mountedBit = ent.isWarhorseMounted ? 0x40000 : 0;
      const outOfAmmoBit = (ent.maxAmmo | 0) > 0 && (ent.ammo | 0) <= 0 ? 0x80000 : 0;
      entityData[base + 8] =
        (shotLeft > 0 ? ((shotLeft & 0xff) | 0x100) : (swingLeft & 0xff)) |
        lastStandBit |
        spellSlotBits |
        burningBit |
        poisonBit |
        frozenBit |
        heroBuffBits |
        mountedBit |
        outOfAmmoBit;
    }

    const ledger1 = this.economySystem.getTeamLedger(1);
    ledger1.popUsed = team1PopUsed;

    const companyStates = {};
    for (const [cid, comp] of this.companies.entries()) {
      if (!comp) continue;
      const buildQ = this.constructionSystem.workerBuildQueues.get(cid) || [];
      const gatherTask = this.economySystem.companyGatherTasks.get(cid);

      let dropoffBuildingId = -1;
      if (gatherTask) {
        if (gatherTask.dropoffBuildingId > 0) {
          dropoffBuildingId = gatherTask.dropoffBuildingId | 0;
        } else {
          const nearestDropoff = this.economySystem._findNearestDropoffBuilding(
            1,
            gatherTask.nodeXFx,
            gatherTask.nodeZFx,
            this.constructionSystem.buildings,
            this.constructionSystem.sortedBuildingIds
          );
          if (nearestDropoff) {
            dropoffBuildingId = nearestDropoff.id | 0;
          }
        }
      }

      let totalAmmo = 0;
      let maxAmmo = 0;
      for (let m = 0; m < comp.memberIds.length; m++) {
        const memberEnt = this.entities.get(comp.memberIds[m]);
        if (memberEnt && memberEnt.hp > 0) {
          totalAmmo += memberEnt.ammo | 0;
          maxAmmo += memberEnt.maxAmmo | 0;
        }
      }

      const heroEnt = comp.isHero ? this.entities.get(comp.memberIds[0]) : null;
      const activeCaps = !comp.isHero && typeof comp.getActiveCapabilities === 'function' ? comp.getActiveCapabilities() : null;
      companyStates[cid] = {
        team: comp.team | 0,
        name: comp.name,
        unitType: comp.unitType,
        isHero: Boolean(comp.isHero),
        allowedFormations: activeCaps ? activeCaps.allowedFormations : [comp.formation],
        secondaryFormation: activeCaps ? activeCaps.secondaryFormation : null,
        allowedModes: activeCaps ? activeCaps.allowedModes : [],
        canFireAtWill: activeCaps ? Boolean(activeCaps.canFireAtWill) : comp.unitType === 'archer',
        holdGround: Boolean(comp.holdGround),
        skirmishKite: Boolean(comp.skirmishKite),
        heroId: comp.heroId || null,
        heroClass: comp.heroClass || null,
        hasSecondaryLoadout: Boolean(comp.hasSecondaryLoadout),
        activeLoadoutIdx: comp.activeLoadoutIdx | 0,
        isWarhorseMounted: Boolean(comp.isWarhorseMounted),
        heroBuffVisual: heroEnt ? (heroEnt.heroBuffVisual | 0) : 0,
        activeWeaponMode: comp.activeWeaponMode || "melee",
        heroLevel: comp.heroLevel || 1,
        heroXp: comp.heroXp || 0,
        heroXpFloor: comp.heroXpFloor || 0,
        heroXpToNext: comp.heroXpToNext || 100,
        heroHp: heroEnt ? heroEnt.hp | 0 : 0,
        heroMaxHp: heroEnt ? heroEnt.maxHp | 0 : 0,
        heroVisionRangeMeters: heroEnt ? heroEnt.visionRangeMeters || 96 : 96,
        heroAttackRangeMeters: heroEnt ? Math.round((heroEnt.attackRangeFx || 2662) / FX_ONE) : 3,
        heroSpells: Array.isArray(comp.heroSpells)
          ? comp.heroSpells.map((s) => ({
              slotIndex: s.slotIndex,
              spellId: s.spellId,
              name: s.name,
              nameEn: s.nameEn,
              type: s.type,
              targetMode: s.targetMode || "self",
              targetShape: s.targetShape || "circle",
              lineWidthMeters: s.lineWidthMeters || 5.5,
              vfxStyle: s.vfxStyle || "shockwave_ring",
              rangeMeters: s.rangeMeters || 0,
              radiusMeters: s.radiusMeters || 0,
              requiredWeaponMode: s.requiredWeaponMode || null,
              disabledByWeapon: Boolean(s.disabledByWeapon),
              unlocked: Boolean(s.unlocked ?? (s.level > 0)),
              unlockAtHeroLevel: s.unlockAtHeroLevel || 1,
              level: s.level,
              maxLevel: s.maxLevel,
              stats: s.stats || null,
              cooldownTicks: s.cooldownTicks | 0,
              maxCooldownTicks: s.maxCooldownTicks | 0,
              icon: s.icon,
              description: s.description
            }))
          : [],
        anchorXFx: comp.anchorXFx | 0,
        anchorZFx: comp.anchorZFx | 0,
        facingDir: comp.facingDir | 0,
        formation: comp.formation,
        staminaPermille: comp.staminaPermille ?? 1000,
        moralePermille: comp.moralePermille ?? 1000,
        isBroken: Boolean(comp.isBroken),
        breakBehavior: comp.breakBehavior || 'RETREAT',
        hasBannerBuff: Boolean(comp.hasBannerBuff),
        isHealing: Boolean(comp.isHealing),
        ammo: totalAmmo,
        maxAmmo,
        ammoType: comp.ammoType || 'STANDARD',
        fireAtWill: comp.fireAtWill !== false,
        wantsToRun: Boolean(comp.wantsToRun),
        isRunning: Boolean(comp.isRunning),
        orderType: comp.orderType | 0,
        queuedOrders: comp.commandQueue ? comp.commandQueue.length | 0 : 0,   // orders waiting behind the current one (UI path arrows)
        isWorking: Boolean(comp.isWorking),
        activeBuildTargetId: comp.activeBuildTargetId | 0,
        activeDropoffBuildingId: comp.activeDropoffBuildingId | 0,
        hasPendingGather: Boolean(comp.pendingGatherOrder),
        garrisonedBuildingId: comp.garrisonedBuildingId,
        buildQueueBuildingIds: buildQ.slice(),
        gatherState: gatherTask ? gatherTask.state | 0 : 0,
        gatherQueuedAfterBuild: Boolean(gatherTask && gatherTask.queuedAfterBuild),
        gatherNodeX: gatherTask ? gatherTask.nodeXFx / FX_ONE : 0,
        gatherNodeZ: gatherTask ? gatherTask.nodeZFx / FX_ONE : 0,
        returningDropoffBuildingId:
          gatherTask && gatherTask.state === GathererState.RETURNING_TO_BASE
            ? dropoffBuildingId
            : -1,
        plannedDropoffBuildingId: dropoffBuildingId
      };
    }

    const buildingsSnapshot = [];
    const bIds = this.constructionSystem.sortedBuildingIds;
    for (let i = 0; i < bIds.length; i++) {
      const b = this.constructionSystem.buildings.get(bIds[i]);
      if (!b || b.isDestroyed) continue;
      if (b.type !== 'citadel_slot' && b.hp <= 0) continue;

      const def = this.constructionSystem.buildingDefs[b.type] || {};

      const queueCounts = {};
      for (let q = 0; q < b.productionQueue.length; q++) {
        const oid = b.productionQueue[q].optionId;
        queueCounts[oid] = (queueCounts[oid] || 0) + 1;
      }
      const activeOptionId =
        b.productionQueue.length > 0 ? b.productionQueue[0].optionId : null;
      const rawProgressPermille =
        b.productionTotalTicks > 0
          ? mulDiv(b.productionProgressTicks, 1000, b.productionTotalTicks)
          : 0;
      const progressPermille = b.isPopHold ? 990 : rawProgressPermille;

      let garrisonArcherCount = 0;
      const garrisonSlots = [];
      if (Array.isArray(b.garrisonCompanyIds)) {
        for (let g = 0; g < b.garrisonCompanyIds.length; g++) {
          const gc = this.companies.get(b.garrisonCompanyIds[g]);
          if (gc) {
            if (gc.unitType === 'archer') garrisonArcherCount++;
            garrisonSlots.push({
              companyId: gc.id,
              unitType: gc.unitType,
              name: gc.name
            });
          }
        }
      }

      if ((b.doorOpenTicks | 0) > 0 && (!Array.isArray(b.activeDoorSpawns) || b.activeDoorSpawns.length === 0)) {
        b.doorOpenTicks = (b.doorOpenTicks - 1) | 0;
      }
      const isDoorOpenNow = Boolean(
        (Array.isArray(b.activeDoorSpawns) && b.activeDoorSpawns.length > 0) ||
        (b.doorOpenTicks | 0) > 0
      );
      buildingsSnapshot.push({
        id: b.id,
        type: b.type,
        name: b.name,
        team: b.team,
        x: b.xFx / FX_ONE,
        y: b.yFx / FX_ONE,
        z: b.zFx / FX_ONE,
        facingDir: b.facingDir ?? (b.team === 1 ? 256 : 768),
        footprintRadiusMeters: b.footprintRadiusMeters,
        hp: b.hp,
        maxHp: b.maxHp,
        isCompleted: b.isCompleted,
        isDoorOpen: isDoorOpenNow,
        buildProgressPermille: mulDiv(b.workDonePermille, 1000, b.totalWorkPermille),
        activeBuildersCount: b.activeBuildersCount || 0,
        level: b.level,
        xp: b.xp,
        xpToNextLevel: b.xpToNextLevel,
        hasWatchtower: b.hasWatchtower,
        turretRangeMeters: def.turretRangeMeters || (b.hasWatchtower ? 26 : 0),
        isPassiveAoE: Boolean(def.isPassiveAoE),
        auraRadiusMeters: def.auraRadiusMeters || 0,
        maxGarrison: b.maxGarrison || 0,
        garrisonCompanyIds: Array.isArray(b.garrisonCompanyIds)
          ? b.garrisonCompanyIds.slice()
          : [],
        garrisonSlots,
        garrisonArcherCount,
        manualTargetEntityId: b.manualTargetEntityId || -1,
        upgradeCostCoins: this.constructionSystem.getInstantUpgradeCostCoins(b),
        queueCounts,
        activeOptionId,
        progressPermille,
        isPopHold: Boolean(b.isPopHold),
        hasCustomRallyPoint: b.hasCustomRallyPoint,
        rallyX: b.rallyXFx / FX_ONE,
        rallyZ: b.rallyZFx / FX_ONE
      });
    }

    const minesSnapshot = [];
    for (let i = 0; i < this.economySystem.sortedMineIds.length; i++) {
      const m = this.economySystem.mines.get(this.economySystem.sortedMineIds[i]);
      if (m) {
        minesSnapshot.push({
          id: m.id,
          resourceType: m.resourceType,
          x: m.xFx / FX_ONE,
          y: m.yFx / FX_ONE,
          z: m.zFx / FX_ONE
        });
      }
    }

    return {
      meta,
      entityData,
      economy: {
        ...ledger1,
        depletedTreeIds: this.economySystem.getDepletedTreeIds(),
        mines: minesSnapshot,
        companyStates,
        fallenHeroes: Object.fromEntries(this.heroSystem?.fallenHeroesByTeam?.[1] || []),
        heroRecruitmentOptions: (() => {
          const out = {};
          const hMap = this.heroSystem?.heroesData?.heroes || {};
          for (const hid of Object.keys(hMap)) {
            const opt = this.heroSystem.getHeroRecruitmentOption(hid, 1);
            if (opt) out[hid] = opt;
          }
          return out;
        })(),
        fowGrid: this.visionSystem.fowGridTeam1,
        temporaryReveals: (this.visionSystem.temporaryReveals || []).map((r) => ({
          wx: r.wx,
          wz: r.wz,
          radiusMeters: r.radiusMeters
        })),
        victory: this.victorySystem.getSnapshotState(),
        teamAlliances: this.getTeamAlliancesObject(),
        playerTeam: this.playerTeam,
        isSpectatorMode: this.isSpectatorMode
      },
      buildings: buildingsSnapshot,
      events: this.pendingEvents.slice()
    };
  }
}
