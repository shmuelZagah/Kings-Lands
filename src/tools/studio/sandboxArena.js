/**
 * Kings Lands — Studio sandbox test arena (src/tools/studio/sandboxArena.js)
 *
 * A tiny auto-battler used to check how your animations look and feel in motion.
 *
 *  - Clip names come from clipResolver.js, the SAME resolver the studio edits with, so what you author in the
 *    timeline is exactly what plays here (unit+faction clip -> unit clip -> global clip).
 *  - Colours come from skinUtils.js, the same helper the studio viewport uses.
 *  - `unitDef.combatStats` in units.json (optional) overrides the built-in test stats of a unit.
 *  - take_damage interrupts an attack on purpose (design decision) – this file does not change that.
 */

import * as THREE from 'three';
import { Animator3D, AnimEventTypes } from '../../render/animator3d.js';
import defaultUnitStatsJson from '../../data/unitStats.json';
import { resolveClip, resolveCombatClip, resolveIdleClip, resolveLocomotionClip } from './clipResolver.js';
import { FACTION_TEAM_COLORS, applySkinColors, disposeVisual } from './skinUtils.js';

const UNIT_COMBAT_STATS = Object.freeze({
  worker: { maxHp: 85, damage: 9, range: 2.1, moveSpeed: 3.8, attackInterval: 1.35 },
  swordsman: { maxHp: 135, damage: 18, range: 2.3, moveSpeed: 4.2, attackInterval: 1.15 },
  spearman: { maxHp: 145, damage: 15, range: 3.1, moveSpeed: 4.0, attackInterval: 1.25 },
  archer: { maxHp: 95, damage: 16, range: 16.5, moveSpeed: 4.5, attackInterval: 1.65 },
  cavalry: { maxHp: 195, damage: 26, range: 2.9, moveSpeed: 7.2, attackInterval: 1.2 }
});

const MIN_SEPARATION = 0.95;   // units closer than this (world units) are pushed apart a little
const HP_COLORS = { good: 0x22c55e, warn: 0xf59e0b, low: 0xef4444 };

export class SandboxArena {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../../render/modelFactory.js').ModelFactory} modelFactory
   * @param {object} animationsCatalog  unitsData.animations
   * @param {object} synthAudio         (reserved – sound events are not played in the arena yet)
   * @param {object} unitsData          the whole units.json working copy
   */
  constructor(scene, modelFactory, animationsCatalog, synthAudio, unitsData) {
    this.scene = scene;
    this.modelFactory = modelFactory;
    this.animations = animationsCatalog;
    this.synthAudio = synthAudio;
    this.unitsData = unitsData;

    this.arenaGroup = new THREE.Group();
    this.arenaGroup.name = 'SandboxArenaRoot';
    this.arenaGroup.visible = false;
    this.scene.add(this.arenaGroup);

    this.combatants = [];
    this.paused = true;
    this.projectiles = [];
    this.fxSparks = [];
    this._nextCombatantId = 100;

    this.metrics = { elapsedSec: 0, team1DamageDealt: 0, team2DamageDealt: 0, team1Alive: 0, team2Alive: 0, lastEventLog: 'Arena Ready' };

    // Shared by every combatant / projectile / spark (created once, disposed in dispose()).
    this._shared = {
      sparkGeom: new THREE.SphereGeometry(0.22, 8, 8),
      sparkMat: new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.9 }),
      arrowGeom: new THREE.CylinderGeometry(0.02, 0.02, 0.75, 6).rotateX(Math.PI * 0.5),
      arrowMat: new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
      hpBgGeom: new THREE.PlaneGeometry(0.95, 0.12),
      hpBgMat: new THREE.MeshBasicMaterial({ color: 0x0f172a, side: THREE.DoubleSide }),
      // origin on the LEFT edge, so scale.x shrinks the bar towards the left
      hpFillGeom: new THREE.PlaneGeometry(0.9, 0.08).translate(0.45, 0, 0)
    };
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();

    this._buildArenaFloor();
  }

  /** Point the arena at a new working copy of units.json (after Restart All / Import). */
  setData(unitsData) {
    this.clearArena();
    this.unitsData = unitsData;
    this.animations = unitsData.animations;
  }

  _buildArenaFloor() {
    const floorGeom = new THREE.PlaneGeometry(64, 64, 16, 16);
    floorGeom.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2c4c28, roughness: 0.88, metalness: 0.05 });
    const floorMesh = new THREE.Mesh(floorGeom, floorMat);
    floorMesh.receiveShadow = true;
    this.arenaGroup.add(floorMesh);

    const grid = new THREE.GridHelper(64, 32, 0xfbbf24, 0x334155);
    grid.position.y = 0.03;
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    this.arenaGroup.add(grid);
    this._floor = { floorMesh, grid };
  }

  setVisible(visible) {
    this.arenaGroup.visible = Boolean(visible);
    if (!visible) this.clearArena();
  }

  clearArena() {
    for (const c of this.combatants) {
      this.arenaGroup.remove(c.group);
      c.group.remove(c.hpBar);
      c.hpBar.userData.fillMesh.material.dispose();   // the only per-unit material of the bar (the rest is shared)
      disposeVisual(c.group);
    }
    for (const g of this.groupAnchors || []) if (g.ring) { this.arenaGroup.remove(g.ring); g.ring.geometry.dispose(); g.ring.material.dispose(); }
    this.groupAnchors = [];
    for (const p of this.projectiles) this.arenaGroup.remove(p.mesh);
    for (const f of this.fxSparks) this.arenaGroup.remove(f.mesh);
    this.combatants = [];
    this.projectiles = [];
    this.fxSparks = [];
    this.metrics.elapsedSec = 0;
    this.metrics.team1DamageDealt = 0;
    this.metrics.team2DamageDealt = 0;
    this.metrics.team1Alive = 0;
    this.metrics.team2Alive = 0;
    this.paused = true;
    this.metrics.lastEventLog = 'Arena Cleared';
  }

  dispose() {
    this.clearArena();
    this.scene.remove(this.arenaGroup);
    for (const res of Object.values(this._shared)) res.dispose();
    this._floor.floorMesh.geometry.dispose();
    this._floor.floorMesh.material.dispose();
    this._floor.grid.geometry.dispose();
    this._floor.grid.material.dispose();
  }

  _createHpBar() {
    const holder = new THREE.Group();
    holder.position.set(0, 2.55, 0);
    const bg = new THREE.Mesh(this._shared.hpBgGeom, this._shared.hpBgMat);
    const fill = new THREE.Mesh(this._shared.hpFillGeom, new THREE.MeshBasicMaterial({ color: HP_COLORS.good, side: THREE.DoubleSide }));
    fill.position.set(-0.45, 0, 0.01);
    holder.add(bg);
    holder.add(fill);
    holder.userData.fillMesh = fill;
    return holder;
  }

  _statsFor(unitType) {
    const base = UNIT_COMBAT_STATS[unitType] || UNIT_COMBAT_STATS.swordsman;
    const liveStat = defaultUnitStatsJson?.units?.[unitType];
    if (liveStat) {
      const isRanged = Boolean(liveStat.isRanged);
      const reloadTicks = Math.max(8, ((Number(liveStat.reloadMinTicks) || 20) + (Number(liveStat.reloadMaxTicks) || 28)) * 0.5);
      return {
        maxHp: Math.max(10, Number(liveStat.hp) || base.maxHp),
        damage: Math.max(1, Number(isRanged ? (liveStat.rangedDamage || liveStat.meleeDamage) : liveStat.meleeDamage) || base.damage),
        range: isRanged ? Math.max(10, Math.min(24, (Number(liveStat.attackRangeMeters) || 80) * 0.22)) : (Number(liveStat.attackRangeMeters) || base.range),
        moveSpeed: Math.max(1.5, Number(liveStat.speedMetersPerSec) || base.moveSpeed),
        attackInterval: Math.max(0.45, reloadTicks / 20),
        ...(this.unitsData?.units?.[unitType]?.combatStats || {})
      };
    }
    return { ...base, ...(this.unitsData?.units?.[unitType]?.combatStats || {}) };
  }

  /** Pause / resume the battle. While paused the units stand in their idle pose (so you can still look at them). */
  setPaused(paused) { this.paused = Boolean(paused); this._setRingsVisible(this.paused); }

  isPaused() { return this.paused; }

  /** Offsets of each unit of a block, centred on (0,0): dx = depth (away from the enemy), dz = width. */
  _blockLayout(count, spacing) {
    const wide = count === 1 ? 1 : Math.ceil(Math.sqrt(count * 2));
    const deep = Math.ceil(count / wide);
    const items = [];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / wide);
      const col = i % wide;
      const inRow = row === deep - 1 ? count - row * wide : wide;
      items.push({ dx: row * spacing - ((deep - 1) * spacing) / 2, dz: (col - (inRow - 1) / 2) * spacing });
    }
    return { items, width: wide * spacing, depth: deep * spacing };
  }

  /**
   * Build a whole scene.
   * @param {Array<{unit:string, faction:string, side:1|2, count:number, x?:number, z?:number}>} groups
   *        x / z = where the middle of the group stands (world units, the middle line is x = 0). Missing -> placed automatically.
   * @param {{ paused?: boolean }} options  paused (default true): units wait until setPaused(false)
   * @returns {Array<{x:number, z:number}|null>} the anchor of every input group (same order), so the caller can remember them
   */
  spawnScene(groups, options = {}) {
    this.clearArena();
    const data = this.unitsData;
    const list = groups || [];
    const ok = (g) => data.units?.[g.unit] && g.count > 0 && (g.side === 1 || g.side === 2);
    const total = list.filter(ok).reduce((n, g) => n + Math.floor(g.count), 0);
    const startOffset = total <= 2 ? 7.5 : 12.0;
    const anchors = list.map(() => null);
    this.groupAnchors = [];

    for (const teamId of [1, 2]) {
      const mine = list.map((g, i) => ({ g, i })).filter(({ g }) => ok(g) && g.side === teamId);
      const laid = mine.map(({ g, i }) => {
        const unitDef = data.units[g.unit];
        const spacing = (g.unit === 'cavalry' || unitDef?.isMounted || defaultUnitStatsJson?.units?.[g.unit]?.isMounted) ? 3.2 : 2.2;
        return { g, i, unitDef, spacing, layout: this._blockLayout(Math.floor(g.count), spacing) };
      });
      const gap = 3;
      const span = laid.reduce((n, l) => n + l.layout.width, 0) + gap * Math.max(0, laid.length - 1);
      let cursor = -span / 2;

      for (const { g, i, unitDef, spacing, layout } of laid) {
        const laneZ = cursor + layout.width / 2;
        cursor += layout.width + gap;
        const stats = this._statsFor(g.unit);
        const ranged = stats.range > 8;
        const count = Math.floor(g.count);
        const ax = Number.isFinite(g.x) ? g.x : (teamId === 1 ? -1 : 1) * (startOffset + (ranged ? 6 : 0) + layout.depth / 2);
        const az = Number.isFinite(g.z) ? g.z : laneZ;
        anchors[i] = { x: ax, z: az };
        const gIndex = this.groupAnchors.length;
        g.x = ax; g.z = az;   // the caller's group object remembers where it stands
        this.groupAnchors.push({ ref: g, x: ax, z: az, team: teamId, radius: Math.max(layout.width, layout.depth) / 2 + 1.2, ring: null });

        for (let k = 0; k < count; k++) {
          const { dx, dz } = layout.items[k];
          const x = ax + (teamId === 1 ? -1 : 1) * dx;
          const z = az + dz;

          const id = this._nextCombatantId++;
          const group = this.modelFactory.createVisual(g.unit, {
            teamId,
            isBannerCarrier: count > 1 && k === 0,
            customTeamColors: FACTION_TEAM_COLORS[g.faction]
          });
          applySkinColors(group, unitDef, g.faction);

          group.position.set(x, 0, z);
          group.rotation.y = teamId === 1 ? Math.PI * 0.5 : -Math.PI * 0.5;
          group.userData.groupIndex = gIndex;

          const hpBar = this._createHpBar();
          if (g.unit === 'cavalry') hpBar.position.y = 3.25;
          group.add(hpBar);

          const combatant = {
            id, unitType: g.unit, faction: g.faction, team: teamId, group, hpBar, groupIndex: gIndex,
            hp: stats.maxHp, maxHp: stats.maxHp, damage: stats.damage, range: stats.range,
            moveSpeed: stats.moveSpeed, attackInterval: stats.attackInterval,
            cooldown: (k % 4) * 0.18, alive: true, target: null, animator: null,
            // Same resolver the studio uses -> the clip you edit is the clip you see.
            animCombat: resolveCombatClip(data, g.unit, g.faction),
            animWalk: resolveLocomotionClip(data, g.unit, g.faction),
            animIdle: resolveIdleClip(data, g.unit, g.faction),
            animDie: resolveClip(data, g.unit, g.faction, 'die'),
            animTakeDamage: resolveClip(data, g.unit, g.faction, 'take_damage')
          };

          combatant.animator = new Animator3D(group, this.animations, {
            entityId: id,
            onEvent: (evt) => this._onCombatantAnimEvent(combatant, evt)
          });
          combatant.animator.setLocomotion(combatant.animIdle);

          this.arenaGroup.add(group);
          this.combatants.push(combatant);
        }

        // a ring on the ground = "this is one group, drag it"
        const a = this.groupAnchors[gIndex];
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(a.radius - 0.18, a.radius, 48).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: teamId === 1 ? 0x3b82f6 : 0xef4444, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
        );
        ring.position.set(ax, 0.05, az);
        this.arenaGroup.add(ring);
        a.ring = ring;
      }
    }

    this.paused = options.paused !== false;
    this._setRingsVisible(this.paused);
    this.metrics.team1Alive = this.combatants.filter((c) => c.team === 1).length;
    this.metrics.team2Alive = this.combatants.filter((c) => c.team === 2).length;
    this.metrics.lastEventLog = `Placed ${this.metrics.team1Alive} vs ${this.metrics.team2Alive}`;
    return anchors;
  }

  _setRingsVisible(on) {
    for (const a of this.groupAnchors || []) if (a.ring) a.ring.visible = on;
  }

  /** Index of the placed group under the pointer (raycaster already aimed), or -1. Only while the battle has not started. */
  groupAt(raycaster) {
    if (!this.paused || !this.combatants.length) return -1;
    const hits = raycaster.intersectObjects(this.combatants.map((c) => c.group), true);
    for (const hit of hits) {
      let o = hit.object;
      while (o && o.userData.groupIndex === undefined) o = o.parent;
      if (o) return o.userData.groupIndex;
    }
    // no unit under the pointer: anywhere inside a group's ring counts too
    const p = this._tmpGround || (this._tmpGround = new THREE.Vector3());
    if (!raycaster.ray.intersectPlane(this._groundPlane || (this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)), p)) return -1;
    let best = -1; let bestD = Infinity;
    (this.groupAnchors || []).forEach((a, i) => {
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (d <= a.radius && d < bestD) { best = i; bestD = d; }
    });
    return best;
  }

  getGroupAnchor(index) { return this.groupAnchors?.[index] || null; }

  /** Move a whole placed group so that its middle stands at (x, z). Returns the position actually used (kept on the field). */
  moveGroup(index, x, z) {
    const a = this.groupAnchors?.[index];
    if (!a) return null;
    const lim = 30;
    const nx = Math.max(-lim, Math.min(lim, x));
    const nz = Math.max(-lim, Math.min(lim, z));
    const dx = nx - a.x;
    const dz = nz - a.z;
    for (const c of this.combatants) {
      if (c.groupIndex !== index) continue;
      c.group.position.x += dx;
      c.group.position.z += dz;
    }
    a.x = nx; a.z = nz;
    if (a.ref) { a.ref.x = nx; a.ref.z = nz; }
    if (a.ring) a.ring.position.set(nx, 0.05, nz);
    return { x: nx, z: nz };
  }

  /** Largest |x| and |z| any unit stands at (the studio uses it to frame the camera). */
  getExtent() {
    let x = 0; let z = 0;
    for (const c of this.combatants) { x = Math.max(x, Math.abs(c.group.position.x)); z = Math.max(z, Math.abs(c.group.position.z)); }
    return { x, z };
  }

  /** Classic one-group-per-side clash (kept for the quick buttons); starts fighting immediately. */
  spawnMatchup(u1, f1, u2, f2, countPerSide = 1) {
    this.spawnScene([
      { unit: u1, faction: f1, side: 1, count: countPerSide },
      { unit: u2, faction: f2, side: 2, count: countPerSide }
    ], { paused: false });
    this.metrics.lastEventLog = `Spawned ${countPerSide}v${countPerSide}: ${f1} ${u1} vs ${f2} ${u2}`;
  }

  _onCombatantAnimEvent(attacker, evt) {
    if (!attacker.alive || !attacker.target || !attacker.target.alive) return;
    if (evt.type === AnimEventTypes.HIT) {
      this._applyDamage(attacker, attacker.target, evt.worldPosition);
      this.metrics.lastEventLog = `#${attacker.id} (${attacker.unitType}) HIT #${attacker.target.id}`;
    } else if (evt.type === AnimEventTypes.RELEASE) {
      this._spawnArrowProjectile(attacker, attacker.target, evt.worldPosition);
      this.metrics.lastEventLog = `#${attacker.id} (${attacker.unitType}) RELEASED arrow`;
    }
  }

  _spawnArrowProjectile(attacker, target, startWorldPos) {
    const mesh = new THREE.Mesh(this._shared.arrowGeom, this._shared.arrowMat);
    mesh.position.set(startWorldPos.x, startWorldPos.y, startWorldPos.z);
    this.arenaGroup.add(mesh);
    this.projectiles.push({ mesh, attacker, target, speed: 24.0 });
  }

  _applyDamage(attacker, defender, sparkPos) {
    if (!defender.alive) return;
    defender.hp = Math.max(0, defender.hp - attacker.damage);
    if (attacker.team === 1) this.metrics.team1DamageDealt += attacker.damage;
    else this.metrics.team2DamageDealt += attacker.damage;

    const ratio = defender.hp / defender.maxHp;
    const fillMesh = defender.hpBar.userData.fillMesh;
    fillMesh.scale.x = Math.max(0.001, ratio);
    fillMesh.material.color.setHex(ratio > 0.45 ? HP_COLORS.good : ratio > 0.2 ? HP_COLORS.warn : HP_COLORS.low);

    const spark = new THREE.Mesh(this._shared.sparkGeom, this._shared.sparkMat);
    spark.position.set(sparkPos?.x ?? defender.group.position.x, sparkPos?.y ?? 1.2, sparkPos?.z ?? defender.group.position.z);
    this.arenaGroup.add(spark);
    this.fxSparks.push({ mesh: spark, age: 0, maxAge: 0.28 });

    if (defender.hp <= 0) {
      defender.alive = false;
      defender.hpBar.visible = false;
      defender.animator.playAction(defender.animDie, { restart: true });
      if (defender.team === 1) this.metrics.team1Alive = Math.max(0, this.metrics.team1Alive - 1);
      else this.metrics.team2Alive = Math.max(0, this.metrics.team2Alive - 1);
    } else {
      defender.animator.playAction(defender.animTakeDamage, { restart: true });
    }
  }

  /** Keep living units from standing inside each other (a soft push, not a physics engine). */
  _separate() {
    const list = this.combatants;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const dx = b.group.position.x - a.group.position.x;
        const dz = b.group.position.z - a.group.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= MIN_SEPARATION * MIN_SEPARATION) continue;
        const d = Math.sqrt(d2) || 0.0001;
        const push = (MIN_SEPARATION - d) * 0.5;
        const nx = d2 > 1e-8 ? dx / d : 1;
        const nz = d2 > 1e-8 ? dz / d : 0;
        a.group.position.x -= nx * push;
        a.group.position.z -= nz * push;
        b.group.position.x += nx * push;
        b.group.position.z += nz * push;
      }
    }
  }

  /** Make the HP bars face the camera (they are children of a rotating unit, so convert to local space). */
  _billboardBars(camera) {
    for (const c of this.combatants) {
      if (!c.alive) continue;
      c.group.getWorldQuaternion(this._tmpQ).invert().multiply(camera.quaternion);
      c.hpBar.quaternion.copy(this._tmpQ);
    }
  }

  update(dtSeconds, camera = null) {
    if (!this.arenaGroup.visible) return;
    if (this.paused) {
      // placed but not started: idle animations only, no AI, no clock
      for (const unit of this.combatants) unit.animator.update(dtSeconds);
      if (camera) this._billboardBars(camera);
      return;
    }
    if (this.metrics.team1Alive > 0 && this.metrics.team2Alive > 0) this.metrics.elapsedSec += dtSeconds;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.target || !p.target.alive) { this.arenaGroup.remove(p.mesh); this.projectiles.splice(i, 1); continue; }
      const targetPos = this._tmpA.set(p.target.group.position.x, 1.15, p.target.group.position.z);
      const dir = this._tmpB.copy(targetPos).sub(p.mesh.position);
      const dist = dir.length();
      if (dist <= p.speed * dtSeconds + 0.35) {
        this._applyDamage(p.attacker, p.target, targetPos);
        this.arenaGroup.remove(p.mesh);
        this.projectiles.splice(i, 1);
      } else {
        dir.multiplyScalar(1 / dist);
        p.mesh.position.addScaledVector(dir, p.speed * dtSeconds);
        p.mesh.lookAt(targetPos);
      }
    }

    for (let i = this.fxSparks.length - 1; i >= 0; i--) {
      const f = this.fxSparks[i];
      f.age += dtSeconds;
      if (f.age >= f.maxAge) { this.arenaGroup.remove(f.mesh); this.fxSparks.splice(i, 1); }
      else { const s = 1 + (f.age / f.maxAge) * 2.0; f.mesh.scale.set(s, s, s); }
    }

    for (let i = 0; i < this.combatants.length; i++) {
      const unit = this.combatants[i];
      unit.animator.update(dtSeconds);
      if (!unit.alive) continue;

      let nearest = null;
      let bestDist = Infinity;
      for (let j = 0; j < this.combatants.length; j++) {
        const other = this.combatants[j];
        if (!other.alive || other.team === unit.team) continue;
        const d = unit.group.position.distanceTo(other.group.position);
        if (d < bestDist) { bestDist = d; nearest = other; }
      }

      unit.target = nearest;
      if (!nearest) { unit.animator.setLocomotion(unit.animIdle); continue; }

      const dx = nearest.group.position.x - unit.group.position.x;
      const dz = nearest.group.position.z - unit.group.position.z;
      unit.group.rotation.y = Math.atan2(dx, dz);

      if (bestDist > unit.range) {
        const step = Math.min(bestDist - unit.range * 0.9, unit.moveSpeed * dtSeconds);
        const len = Math.hypot(dx, dz) || 1;
        unit.group.position.x += (dx / len) * step;
        unit.group.position.z += (dz / len) * step;
        unit.animator.setLocomotion(unit.animWalk);
      } else {
        unit.animator.setLocomotion(unit.animIdle);
        unit.cooldown -= dtSeconds;
        if (unit.cooldown <= 0) {
          unit.cooldown = unit.attackInterval;
          unit.animator.playAction(unit.animCombat, { restart: true });
        }
      }
    }

    this._separate();
    if (camera) this._billboardBars(camera);
  }

  getDpsSummary() {
    const t = Math.max(0.5, this.metrics.elapsedSec);
    return {
      elapsed: this.metrics.elapsedSec.toFixed(1),
      team1Dps: (this.metrics.team1DamageDealt / t).toFixed(1),
      team2Dps: (this.metrics.team2DamageDealt / t).toFixed(1)
    };
  }
}
