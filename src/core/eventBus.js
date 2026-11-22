export const EventTypes = Object.freeze({
  SIM_SNAPSHOT: 'SIM_SNAPSHOT',
  WORLD_EVENT: 'WORLD_EVENT',
  MODE_CHANGED: 'MODE_CHANGED',
  CAMERA_FOCUS_EVENT: 'CAMERA_FOCUS_EVENT',
  SELECTION_CHANGED: 'SELECTION_CHANGED',
  ECONOMY_UPDATED: 'ECONOMY_UPDATED',
  BUILDINGS_UPDATED: 'BUILDINGS_UPDATED'
});

export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(eventType, callback) {
    if (!this._listeners.has(eventType)) {
      this._listeners.set(eventType, new Set());
    }
    this._listeners.get(eventType).add(callback);
    return () => this.off(eventType, callback);
  }

  off(eventType, callback) {
    const set = this._listeners.get(eventType);
    if (set) {
      set.delete(callback);
    }
  }

  emit(eventType, payload) {
    const set = this._listeners.get(eventType);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[EventBus] Error in listener for ${eventType}:`, err);
      }
    }
  }
}