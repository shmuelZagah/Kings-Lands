import { SimulationCore } from './simulationCore.js';

let sim = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'INIT') {
    if (sim) sim.stop();
    sim = new SimulationCore(msg.config, (packet) => {
      self.postMessage(packet, [packet.metaBuffer, packet.entityBuffer]);
    });
    sim.start();
  } else if (msg.type === 'COMMANDS') {
    if (sim && Array.isArray(msg.commands)) {
      sim.receiveCommands(msg.commands);
    }
  } else if (msg.type === 'SET_PAUSED') {
    if (sim) sim.setPaused(Boolean(msg.paused));
  } else if (msg.type === 'EXPORT_SAVE_STATE') {
    if (sim) self.postMessage({ type: 'SAVE_STATE_EXPORTED', requestId: msg.requestId, saveState: sim.exportSaveState() });
  } else if (msg.type === 'RECYCLE_BUFFERS') {
    if (sim) {
      sim.recycleBuffers(msg.metaBuffer, msg.entityBuffer);
    }
  }
};