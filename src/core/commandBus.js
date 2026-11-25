export const CommandTypes = Object.freeze({
  MOVE_SQUAD: 'MOVE_SQUAD',
  MOVE_COMPANIES: 'MOVE_COMPANIES',
  PATROL_COMPANIES: 'PATROL_COMPANIES',
  ATTACK_MOVE_COMPANIES: 'ATTACK_MOVE_COMPANIES',
  STOP_COMPANIES: 'STOP_COMPANIES',
  SET_FORMATION: 'SET_FORMATION',
  SET_COMPANY_GAIT: 'SET_COMPANY_GAIT',
  PLACE_BUILDING: 'PLACE_BUILDING',
  ASSIGN_BUILDERS: 'ASSIGN_BUILDERS',
  DEMOLISH_BUILDING: 'DEMOLISH_BUILDING',
  QUEUE_PRODUCTION: 'QUEUE_PRODUCTION',
  CANCEL_PRODUCTION: 'CANCEL_PRODUCTION',
  INSTANT_UPGRADE_BUILDING: 'INSTANT_UPGRADE_BUILDING',
  SET_BUILDING_RALLY: 'SET_BUILDING_RALLY',
  GARRISON_BUILDING: 'GARRISON_BUILDING',
  UNGARRISON_BUILDING: 'UNGARRISON_BUILDING',
  SET_TOWER_TARGET: 'SET_TOWER_TARGET',
  DAMAGE_BUILDING_CHEAT: 'DAMAGE_BUILDING_CHEAT',
  GATHER_RESOURCE: 'GATHER_RESOURCE',
  CHOP_TREE: 'CHOP_TREE',
  DEV_CHEAT: 'DEV_CHEAT',
  SPAWN_PATROL_EVENT: 'SPAWN_PATROL_EVENT',
  PING_WORLD: 'PING_WORLD',
  RESET_PATROLS: 'RESET_PATROLS',
  CAST_HERO_SPELL: 'CAST_HERO_SPELL',
  LEVEL_UP_HERO_CHEAT: 'LEVEL_UP_HERO_CHEAT',
  SWITCH_HERO_WEAPON: 'SWITCH_HERO_WEAPON',
  SWITCH_COMPANY_WEAPON: 'SWITCH_COMPANY_WEAPON',
  SET_COMPANY_COMBAT_MODE: 'SET_COMPANY_COMBAT_MODE'
});

export class CommandBus {
  constructor() {
    this._outgoingQueue = [];
    this._simInbox = [];
    this._nextCommandId = 1;
    this._transportFn = null;
  }
  setTransport(fn) {
    this._transportFn = fn;
  }
  issue(type, payload = {}, issuedAtTick = 0) {
    const cleanPayload = JSON.parse(JSON.stringify(payload));
    const cmd = {
      id: this._nextCommandId++,
      type,
      payload: cleanPayload,
      issuedAtTick: issuedAtTick | 0
    };
    this._outgoingQueue.push(cmd);
    this.flushOutgoing();
    return cmd.id;
  }
  flushOutgoing() {
    if (this._outgoingQueue.length === 0 || !this._transportFn) return;
    const batch = this._outgoingQueue.splice(0, this._outgoingQueue.length);
    this._transportFn(batch);
  }
  enqueueForSim(commands) {
    if (!Array.isArray(commands)) return;
    for (let i = 0; i < commands.length; i++) {
      if (commands[i] && typeof commands[i].type === 'string') {
        this._simInbox.push(commands[i]);
      }
    }
  }
  drainSimInbox() {
    if (this._simInbox.length === 0) return [];
    const batch = this._simInbox.splice(0, this._simInbox.length);
    batch.sort((a, b) => (a.id | 0) - (b.id | 0));
    return batch;
  }
}