import { TICK_MS, TICKS_PER_SEC } from '../core/fx.js';
import { EventTypes } from '../core/eventBus.js';
import { SimulationCore } from './simulationCore.js';
import { SNAPSHOT_STRIDE } from './gameState.js';
import { CommandTypes } from '../core/commandBus.js';
import { loadHeroesDataFromStorage } from '../tools/heroes/heroStateManager.js';
import { loadUnitsBuildingsConfigFromStorage } from '../tools/units_buildings/unitsBuildingsStateManager.js';
import { getActiveCustomMapState, serializeMapState } from '../tools/map_editor/mapStateManager.js';
import { saveLearnedAiModel } from './ai/aiLearningModel.js';

export class SimBridge {
  constructor({ config, commandBus, eventBus }) {
    this.config = config;
    this.commandBus = commandBus;
    this.eventBus = eventBus;

    const urlParams = new URLSearchParams(window.location.search);
    this.isNoWorker = urlParams.has('noworker');

    this.worker = null;
    this.localSim = null;
    this.prevSnapshot = null;
    this.currSnapshot = null;
    this._snapshotCounter = 0;
    this._lastTpsCheckTime = performance.now();
    this._lastInterpolateCallMs = performance.now();
    this._needsInterpolationSnap = false;
    this.measuredTps = TICKS_PER_SEC;
    this.interpolatedEntities = [];

    this.latestEconomy = {
      coins: 1200,
      wood: 800,
      stone: 500,
      iron: 400,
      popUsed: 0,
      popCap: 100,
      companyStates: {}
    };
    this.latestBuildings = [];
    this._pendingSaveResolvers = new Map();
    this._nextSaveReqId = 1;
    this.teamAlliances = {};
    this.isSpectatorMode = Boolean(config?.matchSetup?.isSpectator);
    this.playerTeam = this.isSpectatorMode ? 0 : ((config?.matchSetup?.playerTeam | 0) || 1);
    if (config?.matchSetup?.useMatchSetup && Array.isArray(config.matchSetup.participants)) {
      for (const p of config.matchSetup.participants) {
        if (p && p.role !== 'closed' && p.controller !== 'closed' && (p.team | 0) > 0) {
          this.teamAlliances[p.team | 0] = (p.teamNumber ?? p.team) | 0;
        }
      }
    }

    this._bindVisibilityRecovery();
    if (typeof window !== 'undefined') {
      this._onHeroesUpdated = (e) => {
        const updated = e?.detail || loadHeroesDataFromStorage();
        this.config = { ...this.config, heroesData: updated };
        this.commandBus?.issue?.(CommandTypes.SYNC_HEROES_CONFIG, { heroesData: updated });
      };
      this._onUnitsBuildingsUpdated = () => {
        const ubCfg = loadUnitsBuildingsConfigFromStorage();
        this.config = { ...this.config, ...ubCfg };
        this.commandBus?.issue?.(CommandTypes.SYNC_UNITS_BUILDINGS_CONFIG, ubCfg);
      };
      window.addEventListener('kings_lands_heroes_updated', this._onHeroesUpdated);
      window.addEventListener('kings_lands_units_buildings_updated', this._onUnitsBuildingsUpdated);
    }
  }

  _bindVisibilityRecovery() {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this._needsInterpolationSnap = true;
        this._lastTpsCheckTime = performance.now();
        this._snapshotCounter = 0;
      }
    });
  }

  _startLocalFallback() {
    this.stop();
    this.isNoWorker = true;
    const activeMap = getActiveCustomMapState();
    this.config = {
      ...this.config,
      heroesData: loadHeroesDataFromStorage(),
      ...loadUnitsBuildingsConfigFromStorage(),
      customMapData: activeMap ? serializeMapState(activeMap) : null
    };
    this.localSim = new SimulationCore(this.config, (packet) => this._handlePacket(packet));
    this.commandBus.setTransport((cmds) => this.localSim && this.localSim.receiveCommands(cmds));
    this.localSim.start();
    this.eventBus.emit(EventTypes.MODE_CHANGED, {
      isNoWorker: true,
      mode: 'MAIN THREAD (?noworker)'
    });
  }

  start() {
    if (typeof window !== 'undefined' && this._onHeroesUpdated) {
      window.removeEventListener('kings_lands_heroes_updated', this._onHeroesUpdated);
      window.addEventListener('kings_lands_heroes_updated', this._onHeroesUpdated);
    }
    if (this.isNoWorker) {
      this._startLocalFallback();
      return;
    }
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._handlePacket(e.data);
      this.worker.onerror = () => this._startLocalFallback();

      this.commandBus.setTransport((cmds) => {
        if (this.worker) this.worker.postMessage({ type: 'COMMANDS', commands: cmds });
        else if (this.localSim) this.localSim.receiveCommands(cmds);
      });

      const activeMap = getActiveCustomMapState();
      this.config = {
        ...this.config,
        heroesData: loadHeroesDataFromStorage(),
        ...loadUnitsBuildingsConfigFromStorage(),
        customMapData: activeMap ? serializeMapState(activeMap) : null
      };
      this.worker.postMessage({ type: 'INIT', config: this.config });
      this.eventBus.emit(EventTypes.MODE_CHANGED, {
        isNoWorker: false,
        mode: 'WEB WORKER (Transferable)'
      });
    } catch (err) {
      this._startLocalFallback();
    }
  }

  setNoWorkerMode(useNoWorker) {
    if (this.isNoWorker === Boolean(useNoWorker)) return;
    this.stop();
    this.isNoWorker = Boolean(useNoWorker);
    this.prevSnapshot = null;
    this.currSnapshot = null;
    this.start();
  }

  setPaused(paused) {
    this.isPaused = Boolean(paused);
    if (this.worker) {
      this.worker.postMessage({ type: 'SET_PAUSED', paused: this.isPaused });
    } else if (this.localSim) {
      this.localSim.setPaused(this.isPaused);
    }
  }

  stop() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.localSim) {
      this.localSim.stop();
      this.localSim = null;
    }
    if (typeof window !== 'undefined' && this._onHeroesUpdated) {
      window.removeEventListener('kings_lands_heroes_updated', this._onHeroesUpdated);
    }
  }

  _handlePacket(packet) {
    if (!packet) return;
    if (packet.type === 'SAVE_STATE_EXPORTED') {
      const res = this._pendingSaveResolvers.get(packet.requestId);
      if (res) {
        this._pendingSaveResolvers.delete(packet.requestId);
        res(packet.saveState || null);
      }
      return;
    }
    if (packet.type !== 'SNAPSHOT') return;
    const now = performance.now();
    this._snapshotCounter++;
    if (now - this._lastTpsCheckTime >= 1000) {
      this.measuredTps = Math.round(
        (this._snapshotCounter * 1000) / (now - this._lastTpsCheckTime)
      );
      this._snapshotCounter = 0;
      this._lastTpsCheckTime = now;
    }

    if (this.prevSnapshot && this.prevSnapshot !== this.currSnapshot) {
      const oldMeta = this.prevSnapshot.meta.buffer;
      const oldEnt = this.prevSnapshot.entities.buffer;
      const isDistinctAndAttached =
        oldMeta.byteLength > 0 &&
        oldEnt.byteLength > 0 &&
        (!this.currSnapshot ||
          (oldMeta !== this.currSnapshot.meta.buffer &&
            oldEnt !== this.currSnapshot.entities.buffer));

      if (isDistinctAndAttached) {
        if (this.isNoWorker && this.localSim) {
          this.localSim.recycleBuffers(oldMeta, oldEnt);
        } else if (this.worker) {
          this.worker.postMessage(
            { type: 'RECYCLE_BUFFERS', metaBuffer: oldMeta, entityBuffer: oldEnt },
            [oldMeta, oldEnt]
          );
        }
      }
    }

    this.prevSnapshot = this.currSnapshot;
    this.currSnapshot = {
      meta: new Int32Array(packet.metaBuffer),
      entities: new Int32Array(packet.entityBuffer),
      receivedAt: now
    };

    if (!this.prevSnapshot || this._needsInterpolationSnap) {
      this.prevSnapshot = {
        meta: new Int32Array(this.currSnapshot.meta),
        entities: new Int32Array(this.currSnapshot.entities),
        receivedAt: now - TICK_MS
      };
      this._needsInterpolationSnap = false;
    }

    if (packet.economy) {
      this.latestEconomy = packet.economy;
      if (packet.economy.teamAlliances) {
        this.teamAlliances = packet.economy.teamAlliances;
      }
      if (typeof packet.economy.playerTeam === 'number') {
        this.playerTeam = packet.economy.playerTeam | 0;
      }
      if (typeof packet.economy.isSpectatorMode === 'boolean') {
        this.isSpectatorMode = packet.economy.isSpectatorMode;
      }
      this.eventBus.emit(EventTypes.ECONOMY_UPDATED, this.latestEconomy);
    }

    if (Array.isArray(packet.buildings)) {
      this.latestBuildings = packet.buildings;
      this.eventBus.emit(EventTypes.BUILDINGS_UPDATED, this.latestBuildings);
    }

    if (Array.isArray(packet.events)) {
      for (const ev of packet.events) {
        if (ev.kind === 'AI_MODEL_LEARNED' && ev.learnedModel) {
          saveLearnedAiModel(ev.learnedModel);
        }
      }
    }
    if (!document.hidden && Array.isArray(packet.events)) {
      for (const ev of packet.events) {
        this.eventBus.emit(EventTypes.WORLD_EVENT, {
          tick: ev.tick,
          kind: ev.kind || 'WORLD_EVENT',
          resourceType: ev.resourceType || null,
          amount: ev.amount || 0,
          x: (ev.xFx || 0) / 1024,
          y: (ev.yFx || 0) / 1024,
          z: (ev.zFx || 0) / 1024,
          fromX: (ev.fromXFx || 0) / 1024,
          fromY: (ev.fromYFx || 0) / 1024,
          fromZ: (ev.fromZFx || 0) / 1024,
          toX: (ev.toXFx || 0) / 1024,
          toY: (ev.toYFx || 0) / 1024,
          toZ: (ev.toZFx || 0) / 1024,
          isBallista: Boolean(ev.isBallista),
          isFireArrow: Boolean(ev.isFireArrow),
          isHighArc: Boolean(ev.isHighArc),
          extraArrows: ev.extraArrows || 0,
          spellId: ev.spellId || null,
          spellName: ev.spellName || null,
          vfxStyle: ev.vfxStyle || null,
          targetShape: ev.targetShape || null,
          radiusMeters: ev.radiusMeters || 0,
          flightDurationSec: ev.flightDurationSec || 0,
          hopIndex: ev.hopIndex || 0,
          heroId: ev.heroId || null,
          level: ev.level || null,
          label: ev.label
        });
      }
    }

    this.eventBus.emit(EventTypes.SIM_SNAPSHOT, {
      tick: this.currSnapshot.meta[0],
      tps: this.measuredTps
    });
  }

  getPlayerTeam() {
    return this.playerTeam | 0;
  }

  areTeamsAllied(teamA, teamB) {
    const a = teamA | 0;
    const b = teamB | 0;
    if (a <= 0 || b <= 0) return false;
    if (a === b) return true;
    const alA = this.teamAlliances[a] ?? a;
    const alB = this.teamAlliances[b] ?? b;
    return alA === alB;
  }

  isAlliedWithPlayer(team) {
    if (this.isSpectatorMode || this.playerTeam <= 0) return false;
    return this.areTeamsAllied(team, this.playerTeam);
  }

  isEnemyOfPlayer(team) {
    const t = team | 0;
    if (t <= 0) return false;
    if (this.isSpectatorMode || this.playerTeam <= 0) return false;
    return !this.areTeamsAllied(t, this.playerTeam);
  }

  requestSaveState() {
    if (this.isNoWorker && this.localSim) {
      return Promise.resolve(this.localSim.exportSaveState());
    }
    if (this.worker) {
      const reqId = this._nextSaveReqId++;
      return new Promise((resolve) => {
        this._pendingSaveResolvers.set(reqId, resolve);
        this.worker.postMessage({ type: 'EXPORT_SAVE_STATE', requestId: reqId });
        setTimeout(() => {
          if (this._pendingSaveResolvers.has(reqId)) {
            this._pendingSaveResolvers.delete(reqId);
            resolve(null);
          }
        }, 2000);
      });
    }
    return Promise.resolve(null);
  }

  getEconomyState() {
    return this.latestEconomy;
  }

  getFowGrid() {
    return this.latestEconomy?.fowGrid || null;
  }

  getVictoryState() {
    return this.latestEconomy?.victory || null;
  }

  getInterpolatedBuildings() {
    return this.latestBuildings;
  }

  getInterpolatedState(nowMs = performance.now()) {
    if (!this.currSnapshot) return { alpha: 0, entities: [] };
    if (
      this._cachedInterpSnapshot === this.currSnapshot &&
      typeof this._cachedInterpNowMs === 'number' &&
      Math.abs(nowMs - this._cachedInterpNowMs) < 4.0 &&
      !this._needsInterpolationSnap
    ) {
      return this._cachedInterpResult;
    }

    const gapMs = nowMs - this._lastInterpolateCallMs;
    this._lastInterpolateCallMs = nowMs;

    if (gapMs > 250 || this._needsInterpolationSnap) {
      this.currSnapshot.receivedAt = nowMs;
      if (this.prevSnapshot && this.prevSnapshot !== this.currSnapshot) {
        this.prevSnapshot.meta.set(this.currSnapshot.meta);
        if (this.prevSnapshot.entities.length === this.currSnapshot.entities.length) {
          this.prevSnapshot.entities.set(this.currSnapshot.entities);
        } else {
          this.prevSnapshot.entities = new Int32Array(this.currSnapshot.entities);
        }
      }
      this._needsInterpolationSnap = false;
    }

    const prev = this.prevSnapshot || this.currSnapshot;
    const curr = this.currSnapshot;
    const alpha = Math.max(0, Math.min(1, (nowMs - curr.receivedAt) / TICK_MS));
    const count = curr.meta[1];
    const prevCount = prev.meta[1];

    if (this.interpolatedEntities.length !== count) {
      this.interpolatedEntities = Array.from({ length: count }, () => ({
        id: 0,
        x: 0,
        y: 0,
        z: 0,
        yawRad: 0,
        hp: 0,
        maxHp: 0,
        animState: 0,
        hasBannerBuff: false,
        isHealing: false,
        isRouting: false,
        isKnockedDown: false,
        team: 1,
        role: 0,
        companyId: 0,
        unitTypeIdx: 0,
        carryType: 0,
        isGarrisoned: false,
        isRevealedLastStand: false,
        isBurning: false,
        isPoisoned: false,
        isFrozen: false,
        heroBuffVisual: 0,
        isWarhorseMounted: false,
        isOutOfAmmo: false,
        windupTicks: 0,
        shotWindupTicks: 0
      }));
    }

    let prevIdx = 0;
    for (let i = 0; i < count; i++) {
      const base = i * SNAPSHOT_STRIDE;
      const id = curr.entities[base + 0];
      let px = curr.entities[base + 1];
      let py = curr.entities[base + 2];
      let pz = curr.entities[base + 3];
      let pDir = curr.entities[base + 4];

      while (prevIdx < prevCount && prev.entities[prevIdx * SNAPSHOT_STRIDE] < id) {
        prevIdx++;
      }
      if (prevIdx < prevCount && prev.entities[prevIdx * SNAPSHOT_STRIDE] === id) {
        const pBase = prevIdx * SNAPSHOT_STRIDE;
        px = prev.entities[pBase + 1];
        py = prev.entities[pBase + 2];
        pz = prev.entities[pBase + 3];
        pDir = prev.entities[pBase + 4];
      }

      const dAngle = ((curr.entities[base + 4] - pDir + 512) & 1023) - 512;
      const out = this.interpolatedEntities[i];
      out.id = id;
      out.x = (px + (curr.entities[base + 1] - px) * alpha) / 1024;
      out.y = (py + (curr.entities[base + 2] - py) * alpha) / 1024;
      out.z = (pz + (curr.entities[base + 3] - pz) * alpha) / 1024;
      out.yawRad = (pDir + dAngle * alpha) * ((Math.PI * 2) / 1024);
      out.hp = curr.entities[base + 5];
      out.maxHp = curr.entities[base + 6];

      const packed = curr.entities[base + 7];
      out.animState = packed & 0x3f;
      out.hasBannerBuff = ((packed >>> 6) & 0x01) === 1;
      out.isHealing = ((packed >>> 7) & 0x01) === 1;
      out.team = (packed >>> 8) & 0x0f;
      out.role = (packed >>> 12) & 0x07;
      out.isRouting = ((packed >>> 15) & 0x01) === 1;
      out.companyId = (packed >>> 16) & 0xff;
      out.unitTypeIdx = (packed >>> 24) & 0x07;
      out.carryType = (packed >>> 27) & 0x07;
      out.isGarrisoned = ((packed >>> 30) & 0x01) === 1;
      out.isKnockedDown = ((packed >>> 31) & 0x01) === 1;

      const windupWord = curr.entities[base + 8] | 0;
      out.isRevealedLastStand = (windupWord & 0x200) !== 0;
      out.activeSpellSlotIdx = (windupWord >>> 10) & 0x07;
      out.isBurning = (windupWord & 0x2000) !== 0;
      out.isPoisoned = (windupWord & 0x4000) !== 0;
      out.isFrozen = (windupWord & 0x8000) !== 0;
      out.heroBuffVisual = (windupWord >>> 16) & 0x03;
      out.isWarhorseMounted = (windupWord & 0x40000) !== 0;
      out.isOutOfAmmo = (windupWord & 0x80000) !== 0;
      out.shotWindupTicks = (windupWord & 0x100) !== 0 ? windupWord & 0xff : 0;
      out.windupTicks = (windupWord & 0x100) === 0 ? windupWord & 0xff : 0;
    }
    this._cachedInterpSnapshot = this.currSnapshot;
    this._cachedInterpNowMs = nowMs;
    this._cachedInterpResult = { alpha, entities: this.interpolatedEntities };
    return this._cachedInterpResult;
  }
}
