import { TICK_MS, TICKS_PER_SEC } from '../core/fx.js';
import { CommandBus } from '../core/commandBus.js';
import { GameState } from './gameState.js';
import { setActiveCustomMapState } from '../tools/map_editor/mapStateManager.js';

export class SimulationCore {
  constructor(config, onSnapshotPacket) {
    if (config && config.customMapData !== undefined) {
      setActiveCustomMapState(config.customMapData);
    }
    this.config = config;
    this.onSnapshotPacket = onSnapshotPacket;
    this.commandBus = new CommandBus();
    this.gameState = new GameState(config);

    this._timerId = null;
    this.isPaused = false;
    this._reusedMetaBuffer = null;
    this._reusedEntityBuffer = null;
    this._tickCounter = 0;
    this._lastMeasureTime = performance.now();
    this._measuredTpsPermille = TICKS_PER_SEC * 1000;
  }

  exportSaveState() {
    return this.gameState.exportSaveState();
  }

  receiveCommands(commands) {
    this.commandBus.enqueueForSim(commands);
  }

  recycleBuffers(metaBuffer, entityBuffer) {
    this._reusedMetaBuffer = metaBuffer;
    this._reusedEntityBuffer = entityBuffer;
  }

  start() {
    if (this._timerId !== null) return;
    this._lastMeasureTime = performance.now();
    this._timerId = setInterval(() => this._step(), TICK_MS);
    this._step();
  }

  setPaused(paused) {
    this.isPaused = Boolean(paused);
    this._lastMeasureTime = performance.now();
  }

  stop() {
    if (this._timerId !== null) {
      clearInterval(this._timerId);
      this._timerId = null;
    this.isPaused = false;
    }
  }

  _step() {
    if (this.isPaused) return;
    const now = performance.now();
    this._tickCounter++;
    const elapsed = now - this._lastMeasureTime;
    if (elapsed >= 1000) {
      this._measuredTpsPermille = Math.round((this._tickCounter * 1000 * 1000) / elapsed);
      this._tickCounter = 0;
      this._lastMeasureTime = now;
    }

    const commands = this.commandBus.drainSimInbox();
    this.gameState.stepTick(commands);

    const { meta, entityData, economy, buildings, events } = this.gameState.packSnapshot(
      this._measuredTpsPermille,
      this._reusedMetaBuffer,
      this._reusedEntityBuffer
    );

    this._reusedMetaBuffer = null;
    this._reusedEntityBuffer = null;

    if (this.onSnapshotPacket) {
      this.onSnapshotPacket({
        type: 'SNAPSHOT',
        metaBuffer: meta.buffer,
        entityBuffer: entityData.buffer,
        economy,
        buildings,
        events
      });
    }
  }
}