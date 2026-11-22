/**
 * Kings Lands — 3D World Visual Effects, Sculpted 3D Arrows, Parabolic Projectiles & Floating Text
 * (src/render/worldEffectsRenderer.js)
 *
 * Upgraded with:
 * - Sculpted Vertex-Colored 3D Arrow & Ballista Bolt Geometries (tapered wooden shaft + sharp 4-sided
 *   broadhead steel/fire tip + crossed 4-fin tail fletching feathers, baked into 1 BufferGeometry).
 * - Dual Archer Trajectory Rendering (`ev.isHighArc`) with dynamic tangent pitch.
 * - Pure overhead Hero health bar (no level text, zero rotation/pan lag).
 */

import * as THREE from 'three';
import { toFx, toFloat } from '../core/fx.js';
import { EventTypes } from '../core/eventBus.js';
import { sampleTerrainHeightFx, sampleTerrainMeshHeightMeters } from '../sim/gameState.js';
import { FowState, FOW_GRID_SIZE } from '../sim/systems/moraleStaminaSystem.js';

const FIXED_MINE_RING_RADIUS_METERS = 4.4;
const FIXED_TREE_RING_RADIUS_METERS = 1.45;

export function buildSculptedArrowGeometry({
  style = "bodkin",
  length = 0.68,
  shaftRadius = 0.017,
  headRadius = 0.045,
  headLength = 0.15,
  fletchSpan = 0.115,
  fletchLength = 0.15,
  shaftHex = 0xf8fafc,
  headHex = 0xffffff,
  fletchHex = 0xe2e8f0
} = {}) {
  const parts = [];
  const styleMult =
    style === "broadhead"
      ? { hr: 1.45, hl: 1.25, fs: 1.30, fl: 1.20, sr: 1.08 }
      : style === "needle"
        ? { hr: 0.68, hl: 1.85, fs: 0.80, fl: 1.05, sr: 0.88 }
        : style === "royal"
          ? { hr: 1.35, hl: 1.35, fs: 1.40, fl: 1.28, sr: 1.15 }
          : { hr: 1.0, hl: 1.0, fs: 1.0, fl: 1.0, sr: 1.0 };

  const effShaftR = shaftRadius * styleMult.sr;
  const effHeadR = headRadius * styleMult.hr;
  const effHeadL = headLength * styleMult.hl;
  const effFletchSpan = fletchSpan * styleMult.fs;
  const effFletchLen = fletchLength * styleMult.fl;

  const shaftGeom = new THREE.CylinderGeometry(effShaftR * 0.85, effShaftR, length, 6);
  shaftGeom.rotateX(Math.PI * 0.5);
  parts.push({ geom: shaftGeom, color: new THREE.Color(shaftHex) });

  const headRadialSegs = style === "needle" ? 8 : 4;
  const headGeom = new THREE.ConeGeometry(effHeadR, effHeadL, headRadialSegs);
  headGeom.rotateY(Math.PI * 0.25);
  headGeom.rotateX(Math.PI * 0.5);
  if (style === "broadhead") {
    headGeom.scale(1.5, 0.5, 1.0);
  }
  headGeom.translate(0, 0, length * 0.5 + effHeadL * 0.42);
  parts.push({ geom: headGeom, color: new THREE.Color(headHex) });

  if (style === "broadhead") {
    for (const sign of [-1, 1]) {
      const barb = new THREE.BoxGeometry(0.018, 0.012, effHeadL * 0.75);
      barb.rotateY(sign * 0.48);
      barb.translate(sign * effHeadR * 0.72, 0, length * 0.5 - 0.01);
      parts.push({ geom: barb, color: new THREE.Color(headHex) });
    }
  } else if (style === "needle") {
    for (const zOff of [0.0, -0.055]) {
      const ring = new THREE.CylinderGeometry(effShaftR * 1.65, effShaftR * 1.65, 0.022, 8);
      ring.rotateX(Math.PI * 0.5);
      ring.translate(0, 0, length * 0.5 + zOff);
      parts.push({ geom: ring, color: new THREE.Color(headHex) });
    }
  } else if (style === "royal") {
    const collar = new THREE.CylinderGeometry(effShaftR * 1.8, effShaftR * 1.5, 0.045, 8);
    collar.rotateX(Math.PI * 0.5);
    collar.translate(0, 0, length * 0.5 - 0.01);
    parts.push({ geom: collar, color: new THREE.Color(0xfacc15) });
    for (const sign of [-1, 1]) {
      const wing = new THREE.ConeGeometry(effHeadR * 0.52, effHeadL * 0.82, 4);
      wing.rotateX(Math.PI * 0.5);
      wing.rotateY(sign * 0.38);
      wing.translate(sign * effHeadR * 0.85, 0, length * 0.5 + effHeadL * 0.18);
      parts.push({ geom: wing, color: new THREE.Color(headHex) });
    }
  }

  const tailZ = -length * 0.5 + effFletchLen * 0.52;
  const finH = new THREE.BoxGeometry(effFletchSpan, 0.011, effFletchLen);
  finH.translate(0, 0, tailZ);
  parts.push({ geom: finH, color: new THREE.Color(fletchHex) });

  const finV = new THREE.BoxGeometry(0.011, effFletchSpan, effFletchLen);
  finV.translate(0, 0, tailZ);
  parts.push({ geom: finV, color: new THREE.Color(fletchHex) });

  let totalVerts = 0;
  let totalIndices = 0;
  for (let i = 0; i < parts.length; i++) {
    const g = parts[i].geom;
    const p = g.attributes.position;
    totalVerts += p.count;
    totalIndices += g.index ? g.index.count : p.count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const indices = new Uint16Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (let i = 0; i < parts.length; i++) {
    const { geom, color } = parts[i];
    const posAttr = geom.attributes.position;
    const idxAttr = geom.index;
    const vCount = posAttr.count;

    for (let v = 0; v < vCount; v++) {
      const dst = (vOffset + v) * 3;
      positions[dst] = posAttr.getX(v);
      positions[dst + 1] = posAttr.getY(v);
      positions[dst + 2] = posAttr.getZ(v);
      colors[dst] = color.r;
      colors[dst + 1] = color.g;
      colors[dst + 2] = color.b;
    }

    if (idxAttr) {
      for (let k = 0; k < idxAttr.count; k++) {
        indices[iOffset + k] = idxAttr.getX(k) + vOffset;
      }
      iOffset += idxAttr.count;
    } else {
      for (let k = 0; k < vCount; k++) {
        indices[iOffset + k] = vOffset + k;
      }
      iOffset += vCount;
    }
    vOffset += vCount;
    geom.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}


import {
  SPELL_VFX_COLOR_MAP,
  inferDefaultVfxStyle,
  spawn3DSpellEffect,
  spawnVolumetric3DFireballExplosion,
  createBurningUnitFlameCluster,
  updateBurningUnitFlameCluster
} from './spellEffects.js';

export {
  SPELL_VFX_COLOR_MAP,
  inferDefaultVfxStyle,
  spawn3DSpellEffect,
  spawnVolumetric3DFireballExplosion
};

export class WorldEffectsRenderer {
  constructor({ scene, camera, domElement, eventBus, buildingModelFactory, synthAudio, arrowConfig = null }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.eventBus = eventBus;
    this.buildingModelFactory = buildingModelFactory;
    this.synthAudio = synthAudio;

    this.fxGroup = new THREE.Group();
    this.fxGroup.name = 'WorldEffectsGroup';
    this.scene.add(this.fxGroup);

    this.activeFxPulses = [];
    this.activeProjectiles = [];
    this.activeFloatingTexts = [];
    this.burningUnitFlamesMap = new Map();
    this._lastDtSeconds = 0.016;
    this._tangentLookTarget = new THREE.Vector3();

    const ac = arrowConfig || {};
    const arrowStyle = ac.style || "bodkin";
    const arrowLen = Math.max(0.45, Math.min(1.15, Number(ac.length) || 0.68));
    const shaftCol = ac.shaftHex || 0xf8fafc;
    const headCol = ac.headHex || 0xffffff;
    const fletchCol = ac.fletchHex || 0xe2e8f0;

    this._arrowGeomGold = buildSculptedArrowGeometry({
      style: arrowStyle,
      length: arrowLen,
      shaftRadius: 0.017,
      headRadius: 0.045,
      headLength: 0.15,
      fletchSpan: 0.115,
      fletchLength: 0.15,
      shaftHex: shaftCol,
      headHex: headCol,
      fletchHex: fletchCol
    });
    this._arrowGeomBlue = buildSculptedArrowGeometry({
      style: arrowStyle,
      length: arrowLen,
      shaftRadius: 0.017,
      headRadius: 0.045,
      headLength: 0.15,
      fletchSpan: 0.115,
      fletchLength: 0.15,
      shaftHex: shaftCol,
      headHex: headCol,
      fletchHex: fletchCol
    });
    this._fireArrowGeom = buildSculptedArrowGeometry({
      style: arrowStyle,
      length: Math.min(1.15, arrowLen * 1.08),
      shaftRadius: 0.019,
      headRadius: 0.054,
      headLength: 0.18,
      fletchSpan: 0.125,
      fletchLength: 0.16,
      shaftHex: 0x9a3412,
      headHex: 0xff4500,
      fletchHex: 0xfbbf24
    });
    this._ballistaGeom = buildSculptedArrowGeometry({
      style: "bodkin",
      length: 1.12,
      shaftRadius: 0.032,
      headRadius: 0.082,
      headLength: 0.26,
      fletchSpan: 0.19,
      fletchLength: 0.22,
      shaftHex: 0x78350f,
      headHex: 0xf97316,
      fletchHex: 0x94a3b8
    });

    this._emberGeom = new THREE.SphereGeometry(0.32, 8, 8);
    this._pillarGeom = new THREE.CylinderGeometry(3.8, 3.8, 14, 24, 1, true);

    this._matVertexColoredArrow = new THREE.MeshBasicMaterial({ vertexColors: true });
    this._matEmber = new THREE.MeshBasicMaterial({
      color: 0xff4500,
      transparent: true,
      opacity: 0.9
    });

    this._buildFloatingTextOverlay();
    this._bindWorldEvents();
  }

  _sampleGroundHeightFast(x, z) {
    return sampleTerrainMeshHeightMeters(x, z, true, 4096);
  }

  _buildFloatingTextOverlay() {
    const existing = document.getElementById('phase5-floating-text-layer');
    if (existing) existing.remove();
    this.floatingTextLayer = document.createElement('div');
    this.floatingTextLayer.id = 'phase5-floating-text-layer';
    this.floatingTextLayer.className =
      'pointer-events-none fixed inset-0 z-40 overflow-hidden select-none';
    document.body.appendChild(this.floatingTextLayer);

    this.hoverHpBadgeEl = document.createElement('div');
    this.hoverHpBadgeEl.className =
      'pointer-events-none absolute -translate-x-1/2 -translate-y-full hidden rounded-lg border border-amber-400/60 bg-slate-950/90 px-2.5 py-1 text-[10.5px] font-bold text-slate-100 shadow-xl backdrop-blur-sm';
    this.floatingTextLayer.appendChild(this.hoverHpBadgeEl);

    this.heroHpBarsMap = new Map();
    this._heroProjVec = new THREE.Vector3();
  }

  /**
   * Renders a pure health bar directly over each Hero in the 3D world (no level text, zero camera rotation lag).
   */
  updateHeroOverheadHealthBars(entities, companyStates = {}, fowGrid = null) {
    if (!this.floatingTextLayer || !this.camera || !this.domElement) return;
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Ensure camera world & view-projection matrices are 100% up-to-date for this frame so the bar never lags on rotation
    this.camera.updateMatrixWorld();

    const activeHeroEntIds = new Set();
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (!ent || ent.unitTypeIdx !== 5 || ent.hp <= 0 || ent.isGarrisoned) continue;

      const isAlliedE = this.simBridge?.isAlliedWithPlayer ? this.simBridge.isAlliedWithPlayer(ent.team) : ent.team === 1;
      if (!isAlliedE && fowGrid && !ent.isRevealedLastStand) {
        const cx = Math.max(0, Math.min(FOW_GRID_SIZE - 1, Math.floor((ent.x / 4096) * FOW_GRID_SIZE)));
        const cz = Math.max(0, Math.min(FOW_GRID_SIZE - 1, Math.floor((ent.z / 4096) * FOW_GRID_SIZE)));
        if (fowGrid[cz * FOW_GRID_SIZE + cx] < FowState.VISIBLE) continue;
      }

      activeHeroEntIds.add(ent.id);
      let barEl = this.heroHpBarsMap.get(ent.id);
      if (!barEl) {
        barEl = document.createElement('div');
        barEl.className =
          'pointer-events-none absolute top-0 left-0 w-12 h-1.5 rounded-full bg-slate-950/95 border border-slate-800 overflow-hidden shadow-[0_2px_6px_rgba(0,0,0,0.9)]';
        barEl.style.willChange = 'transform';
        barEl.innerHTML = `<div class="hero-ov-fill h-full bg-emerald-400" style="width: 100%;"></div>`;
        this.floatingTextLayer.appendChild(barEl);
        this.heroHpBarsMap.set(ent.id, barEl);
      }

      const exactY = typeof ent.y === 'number' ? ent.y : this._sampleGroundHeightFast(ent.x, ent.z);
      const compState = companyStates?.[ent.companyId];
      const isMountedHero = Boolean(
        ent.isWarhorseMounted ||
          compState?.isWarhorseMounted ||
          compState?.isMounted ||
          compState?.heroId === 'sisnat' ||
          ((ent.carryType | 0) & 0x07) === 3
      );
      const offsetY = isMountedHero ? 3.75 : 2.65;
      this._heroProjVec.set(ent.x, exactY + offsetY, ent.z).project(this.camera);
      if (
        this._heroProjVec.z < -1.0 ||
        this._heroProjVec.z > 0.998 ||
        Math.abs(this._heroProjVec.x) > 1.05 ||
        Math.abs(this._heroProjVec.y) > 1.05
      ) {
        barEl.style.display = 'none';
        continue;
      }

      barEl.style.display = 'block';
      const sx = (this._heroProjVec.x + 1) * 0.5 * rect.width + rect.left;
      const sy = (-this._heroProjVec.y + 1) * 0.5 * rect.height + rect.top;
      barEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;

      const hpPct = Math.max(4, Math.min(100, Math.round((ent.hp / Math.max(1, ent.maxHp)) * 100)));
      const fillDiv = barEl.firstElementChild;
      if (fillDiv) {
        fillDiv.style.width = `${hpPct}%`;
        fillDiv.className =
          hpPct > 55
            ? 'hero-ov-fill h-full bg-emerald-400'
            : hpPct > 25
              ? 'hero-ov-fill h-full bg-amber-400'
              : 'hero-ov-fill h-full bg-rose-500';
      }
    }

    for (const [id, el] of this.heroHpBarsMap.entries()) {
      if (!activeHeroEntIds.has(id)) {
        el.remove();
        this.heroHpBarsMap.delete(id);
      }
    }

    // Update 3D flickering fire flames attached to burning units!
    this.updateBurningUnitsFlames(entities, fowGrid);
  }

  updateBurningUnitsFlames(entities, fowGrid = null) {
    if (!this.fxGroup || !Array.isArray(entities)) return;
    const activeBurningIds = new Set();
    const dt = this._lastDtSeconds || 0.016;

    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (!ent || !ent.isBurning || ent.hp <= 0 || ent.isGarrisoned) continue;

      const isAlliedE = this.simBridge?.isAlliedWithPlayer ? this.simBridge.isAlliedWithPlayer(ent.team) : ent.team === 1;
      if (!isAlliedE && fowGrid && !ent.isRevealedLastStand) {
        const cx = Math.max(0, Math.min(FOW_GRID_SIZE - 1, Math.floor((ent.x / 4096) * FOW_GRID_SIZE)));
        const cz = Math.max(0, Math.min(FOW_GRID_SIZE - 1, Math.floor((ent.z / 4096) * FOW_GRID_SIZE)));
        if (fowGrid[cz * FOW_GRID_SIZE + cx] < FowState.VISIBLE) continue;
      }

      activeBurningIds.add(ent.id);
      let cluster = this.burningUnitFlamesMap.get(ent.id);
      if (!cluster) {
        cluster = createBurningUnitFlameCluster();
        this.fxGroup.add(cluster.group);
        this.burningUnitFlamesMap.set(ent.id, cluster);
      }
      const wy = typeof ent.y === 'number' ? ent.y : this._sampleGroundHeightFast(ent.x, ent.z);
      updateBurningUnitFlameCluster(cluster, ent.x, wy, ent.z, dt);
    }

    for (const [id, cluster] of this.burningUnitFlamesMap.entries()) {
      if (!activeBurningIds.has(id)) {
        this.fxGroup.remove(cluster.group);
        this.burningUnitFlamesMap.delete(id);
      }
    }
  }

  _bindWorldEvents() {
    if (!this.eventBus) return;
    this.eventBus.on(EventTypes.WORLD_EVENT, (ev) => {
      if (!ev) return;
      if (ev.kind === 'RESOURCE_DROPOFF') {
        this.spawnFloatingResourceText(ev);
      } else if (ev.kind === 'RESOURCE_PING') {
        this.spawnResourceGatherPing(ev);
      } else if (ev.kind === 'BUILDING_LEVEL_UP') {
        this.spawnBuildingLevelUpAnimation(ev);
      } else if (ev.kind === 'TOWER_SHOT') {
        this.spawnTowerShotVisuals(ev);
      } else if (ev.kind === 'COLLAPSE_EXPLOSION' && ev.isBuilding) {
        this.spawnCollapseExplosion(ev);
      } else if (ev.kind === 'HERO_SPELL_CAST') {
        this.spawnHeroSpellVisuals(ev);
      } else if (ev.kind === 'HERO_LEVEL_UP' || ev.kind === 'HERO_SPAWNED') {
        this.spawnBuildingLevelUpAnimation(ev);
      }
    });
  }

  spawnHeroSpellVisuals(ev) {
    const wx = typeof ev.x === "number" ? ev.x : (ev.xFx || 0) / 1024;
    const wz = typeof ev.z === "number" ? ev.z : (ev.zFx || 0) / 1024;
    const wy = this._sampleGroundHeightFast(wx, wz);

    const fromX = typeof ev.fromX === "number" ? ev.fromX : ev.fromXFx !== undefined ? ev.fromXFx / 1024 : wx;
    const fromZ = typeof ev.fromZ === "number" ? ev.fromZ : ev.fromZFx !== undefined ? ev.fromZFx / 1024 : wz;
    const fromGroundY = this._sampleGroundHeightFast(fromX, fromZ);
    const fromY = fromGroundY + (ev.vfxStyle === "lightning_staff_charge" || ev.vfxStyle === "lightning_arc_jump" ? 1.85 : 1.15);

    spawn3DSpellEffect({
      fxGroup: this.fxGroup,
      activeFxPulses: this.activeFxPulses,
      activeProjectiles: this.activeProjectiles,
      spellId: ev.spellId || "fireball",
      vfxStyle: ev.vfxStyle || null,
      fromPos: new THREE.Vector3(fromX, fromY, fromZ),
      toPos: new THREE.Vector3(wx, wy, wz),
      radiusScale: Number(ev.radiusMeters) || 7.5,
      flightDurationSec: Number(ev.flightDurationSec) || 0,
      isPreview: false
    });
  }

  spawnResourceGatherPing(ev) {
    const resType = ev.resourceType || 'wood';
    const isMine = Boolean(ev.isMine || (resType && resType !== 'wood'));
    const wx = typeof ev.x === 'number' ? ev.x : (ev.xFx || 0) / 1024;
    const wz = typeof ev.z === 'number' ? ev.z : (ev.zFx || 0) / 1024;
    const wy = this._sampleGroundHeightFast(wx, wz);

    const ringRadius = isMine ? FIXED_MINE_RING_RADIUS_METERS : FIXED_TREE_RING_RADIUS_METERS;
    const colorHex =
      resType === 'wood'
        ? 0x22c55e
        : resType === 'coins'
          ? 0xfacc15
          : resType === 'iron'
            ? 0x38bdf8
            : 0xe2e8f0;

    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
      depthTest: true,
      depthWrite: false
    });

    const ringGroup = this.buildingModelFactory.createOccludedDashedRingMesh(
      ringRadius,
      ringMat,
      isMine ? 24 : 16,
      wx,
      wz,
      wy
    );

    ringGroup.position.set(wx, wy + 0.14, wz);
    this.fxGroup.add(ringGroup);
    this.activeFxPulses.push({
      mesh: ringGroup,
      mat: ringMat,
      age: 0,
      maxAge: 0.95,
      isRingPulse: true
    });
  }

  spawnCollapseExplosion(ev) {
    const isBld = Boolean(ev.isBuilding);
    const wx = typeof ev.x === 'number' ? ev.x : (ev.xFx || 0) / 1024;
    const wz = typeof ev.z === 'number' ? ev.z : (ev.zFx || 0) / 1024;
    const wy = this._sampleGroundHeightFast(wx, wz);

    const blastMat = new THREE.MeshBasicMaterial({
      color: isBld ? 0xff4500 : 0xf97316,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    const blastMesh = new THREE.Mesh(this._emberGeom, blastMat);
    blastMesh.position.set(wx, wy + (isBld ? 2.2 : 1.0), wz);
    const initScale = isBld ? 6.5 : 2.2;
    blastMesh.scale.set(initScale, initScale, initScale);
    this.fxGroup.add(blastMesh);
    this.activeFxPulses.push({
      mesh: blastMesh,
      mat: blastMat,
      age: 0,
      maxAge: isBld ? 0.85 : 0.45
    });

    if (isBld) {
      const pillarMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      });
      const pillarMesh = new THREE.Mesh(this._pillarGeom, pillarMat);
      pillarMesh.position.set(wx, wy + 5.5, wz);
      this.fxGroup.add(pillarMesh);
      this.activeFxPulses.push({
        mesh: pillarMesh,
        mat: pillarMat,
        age: 0,
        maxAge: 1.05,
        isLevelUpPillar: true
      });
    }
  }

  spawnTacticalAlertFloatingText(ev) {
    if (!ev.label) return;
    const wx = typeof ev.x === 'number' ? ev.x : (ev.xFx || 0) / 1024;
    const wz = typeof ev.z === 'number' ? ev.z : (ev.zFx || 0) / 1024;
    const wy = typeof ev.y === 'number' ? ev.y : this._sampleGroundHeightFast(wx, wz);

    const el = document.createElement('div');
    el.className =
      'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-rose-400 bg-slate-950/95 px-3 py-1 text-xs font-extrabold text-amber-200 shadow-2xl mono';
    el.textContent = ev.label;
    this.floatingTextLayer.appendChild(el);

    this.activeFloatingTexts.push({
      el,
      worldPos: new THREE.Vector3(wx, wy + 3.5, wz),
      age: 0,
      maxAge: 2.3
    });
  }

  spawnBuildingLevelUpAnimation(ev) {
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
      depthWrite: false
    });
    const pillarMesh = new THREE.Mesh(this._pillarGeom, pillarMat);
    pillarMesh.position.set(ev.x, ev.y + 5.0, ev.z);
    this.fxGroup.add(pillarMesh);
    this.activeFxPulses.push({
      mesh: pillarMesh,
      mat: pillarMat,
      age: 0,
      maxAge: 1.25,
      isLevelUpPillar: true
    });

    const el = document.createElement('div');
    el.className =
      'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-300 bg-amber-950/95 px-3 py-1 text-xs font-extrabold text-amber-200 shadow-2xl mono';
    el.textContent = `⭐ ${ev.label || `Level ${ev.level}!`}`;
    this.floatingTextLayer.appendChild(el);

    this.activeFloatingTexts.push({
      el,
      worldPos: new THREE.Vector3(ev.x, ev.y + 6.5, ev.z),
      age: 0,
      maxAge: 2.1
    });

    if (this.synthAudio) this.synthAudio.playHornAlert();
  }

  _isWorldPointVisibleInCamera(wx, wy, wz, maxDist = 175) {
    if (!this.camera) return false;
    const worldPos = new THREE.Vector3(wx, wy, wz);
    if (this.camera.position && typeof this.camera.position.distanceTo === "function") {
      if (this.camera.position.distanceTo(worldPos) > maxDist) return false;
    }
    const proj = worldPos.project(this.camera);
    return (
      proj.z >= -1.0 &&
      proj.z <= 0.995 &&
      Math.abs(proj.x) <= 0.95 &&
      Math.abs(proj.y) <= 0.95
    );
  }

  spawnFloatingResourceText(ev) {
    if (!this._isWorldPointVisibleInCamera(ev.x, (ev.y || 0) + 1.5, ev.z, 175)) {
      return;
    }
    const resType = ev.resourceType || 'wood';
    const amount = ev.amount || 75;
    const colorMap = {
      wood: { cls: 'text-emerald-300 border-emerald-400/60', icon: '🪵', name: 'Wood' },
      coins: { cls: 'text-amber-300 border-amber-400/60', icon: '🪙', name: 'Gold' },
      iron: { cls: 'text-sky-300 border-sky-400/60', icon: '⛏️', name: 'Iron' },
      stone: { cls: 'text-slate-200 border-slate-400/60', icon: '🪨', name: 'Stone' }
    };
    const meta = colorMap[resType] || colorMap.wood;

    const el = document.createElement('div');
    el.className = `pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-slate-950/90 px-2.5 py-0.5 text-xs font-extrabold shadow-lg mono ${meta.cls}`;
    el.textContent = `+${amount} ${meta.icon} ${meta.name}`;
    this.floatingTextLayer.appendChild(el);

    this.activeFloatingTexts.push({
      el,
      worldPos: new THREE.Vector3(ev.x, ev.y + 1.5, ev.z),
      age: 0,
      maxAge: 1.65
    });
  }

  spawnTowerShotVisuals(ev) {
    const totalShots = 1 + (ev.extraArrows || 0);
    const isFireArrow = Boolean(ev.isFireArrow);
    const isHighArc = Boolean(ev.isHighArc);

    for (let s = 0; s < totalShots; s++) {
      const spreadX = (s - (totalShots - 1) * 0.5) * 0.45;
      const start = new THREE.Vector3(ev.fromX + spreadX, ev.fromY, ev.fromZ);
      const end = new THREE.Vector3(ev.toX, ev.toY, ev.toZ);

      const horizDist = Math.hypot(end.x - start.x, end.z - start.z);
      let arcHeight = 2.4;
      let duration = 0.45;

      if (ev.isBallista) {
        arcHeight = Math.max(1.2, horizDist * 0.08);
        duration = Math.min(0.75, Math.max(0.22, horizDist / 52.0));
      } else if (isHighArc) {
        arcHeight = Math.max(6.5, horizDist * 0.34);
        duration = Math.min(1.85, Math.max(0.55, horizDist / 36.0)) + s * 0.03;
      } else {
        arcHeight = Math.max(1.4, horizDist * 0.10);
        duration = Math.min(0.85, Math.max(0.24, horizDist / 56.0)) + s * 0.02;
      }

      const geom = ev.isBallista
        ? this._ballistaGeom
        : isFireArrow
          ? this._fireArrowGeom
          : s === 0
            ? this._arrowGeomGold
            : this._arrowGeomBlue;

      const mesh = new THREE.Mesh(geom, this._matVertexColoredArrow);
      mesh.position.copy(start);
      mesh.lookAt(end.x, end.y + arcHeight, end.z);
      this.fxGroup.add(mesh);

      this.activeProjectiles.push({
        mesh,
        start,
        end,
        arcHeight,
        age: 0,
        duration,
        isFireArrow
      });
    }
  }

  spawnAnimatorEventSpark(_evt) {
    // Intentionally empty (no-op) so yellow/blue spheres never appear on units
  }

  updateHoverBuildingBadge(hoveredBuildingObj) {
    if (!this.hoverHpBadgeEl) return;

    if (hoveredBuildingObj) {
      const rect = this.domElement.getBoundingClientRect();
      const hOffset = hoveredBuildingObj.type === 'citadel' ? 13.8 : 10.6;
      const proj = new THREE.Vector3(
        hoveredBuildingObj.x,
        hoveredBuildingObj.y + hOffset,
        hoveredBuildingObj.z
      ).project(this.camera);

      if (proj.z <= 1) {
        const sx = (proj.x + 1) * 0.5 * rect.width + rect.left;
        const sy = (-proj.y + 1) * 0.5 * rect.height + rect.top;
        const hpPct = Math.round(
          (hoveredBuildingObj.hp / Math.max(1, hoveredBuildingObj.maxHp)) * 100
        );
        this.hoverHpBadgeEl.innerHTML = `
          <span class="text-amber-300 uppercase mr-1">${hoveredBuildingObj.name}</span>
          <span class="mono ${hpPct < 100 ? 'text-amber-200' : 'text-emerald-300'}">${hoveredBuildingObj.hp}/${hoveredBuildingObj.maxHp} HP</span>
        `;
        this.hoverHpBadgeEl.style.left = `${Math.round(sx)}px`;
        this.hoverHpBadgeEl.style.top = `${Math.round(sy)}px`;
        this.hoverHpBadgeEl.classList.remove('hidden');
        return;
      }
    }

    this.hoverHpBadgeEl.classList.add('hidden');
  }

  update(dtSeconds) {
    this._lastDtSeconds = dtSeconds;
    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const p = this.activeProjectiles[i];
      p.age += dtSeconds;
      if (p.age < 0) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.visible = true;
      const t = Math.min(1, p.age / p.duration);

      p.mesh.position.lerpVectors(p.start, p.end, t);
      p.mesh.position.y += Math.sin(t * Math.PI) * p.arcHeight;

      const nextT = Math.min(1.0, t + 0.05);
      if (nextT > t) {
        this._tangentLookTarget.lerpVectors(p.start, p.end, nextT);
        this._tangentLookTarget.y += Math.sin(nextT * Math.PI) * p.arcHeight;
        p.mesh.lookAt(this._tangentLookTarget);
      }

      if (t >= 1) {
        if (typeof p.onArrival === 'function') {
          p.onArrival();
        } else if (p.isFireArrow || p.impactHex) {
          const blastMat = new THREE.MeshBasicMaterial({
            color: p.impactHex || 0xff4500,
            transparent: true,
            opacity: 0.82,
            depthWrite: false
          });
          const ember = new THREE.Mesh(this._emberGeom, blastMat);
          ember.position.copy(p.end);
          ember.position.y += 0.45;
          const sc = p.impactRadius ? Math.max(1.2, p.impactRadius * 0.45) : 1.4;
          ember.scale.set(sc, sc, sc);
          this.fxGroup.add(ember);
          this.activeFxPulses.push({ mesh: ember, mat: blastMat, age: 0, maxAge: 0.48 });
        }
        this.fxGroup.remove(p.mesh);
        this.activeProjectiles.splice(i, 1);
      }
    }

    if (this.activeFloatingTexts.length > 0) {
      const rect = this.domElement.getBoundingClientRect();
      const proj = new THREE.Vector3();
      for (let i = this.activeFloatingTexts.length - 1; i >= 0; i--) {
        const ft = this.activeFloatingTexts[i];
        ft.age += dtSeconds;
        if (ft.age >= ft.maxAge) {
          ft.el.remove();
          this.activeFloatingTexts.splice(i, 1);
          continue;
        }
        ft.worldPos.y += dtSeconds * 2.4;
        const tooFar =
          this.camera?.position &&
          typeof this.camera.position.distanceTo === "function" &&
          this.camera.position.distanceTo(ft.worldPos) > 185;
        proj.copy(ft.worldPos).project(this.camera);
        if (
          tooFar ||
          proj.z < -1.0 ||
          proj.z > 0.998 ||
          Math.abs(proj.x) > 1.02 ||
          Math.abs(proj.y) > 1.02
        ) {
          ft.el.style.display = 'none';
          continue;
        }
        ft.el.style.display = 'block';
        const sx = (proj.x + 1) * 0.5 * rect.width + rect.left;
        const sy = (-proj.y + 1) * 0.5 * rect.height + rect.top;
        ft.el.style.left = `${Math.round(sx)}px`;
        ft.el.style.top = `${Math.round(sy)}px`;
        ft.el.style.opacity = String(Math.max(0, 1 - ft.age / ft.maxAge));
      }
    }

    for (let i = this.activeFxPulses.length - 1; i >= 0; i--) {
      const fx = this.activeFxPulses[i];
      fx.age += dtSeconds;
      if (fx.age < 0) {
        fx.mesh.visible = false;
        continue;
      }
      fx.mesh.visible = true;
      if (fx.age >= fx.maxAge) {
        this.fxGroup.remove(fx.mesh);
        this.activeFxPulses.splice(i, 1);
      } else {
        const t = fx.age / fx.maxAge;
        const mat = fx.mat;
        if (typeof fx.customUpdate === 'function') {
          fx.customUpdate(fx, dtSeconds, t);
        } else if (fx.isRisingHealRing) {
          fx.mesh.position.y += dtSeconds * (fx.riseSpeed || 1.8);
          const s = 0.9 + Math.sin(t * Math.PI) * 0.25;
          fx.mesh.scale.set(s, s, 1);
          if (mat) mat.opacity = (1 - t) * 0.92;
        } else if (fx.isRingPulse) {
          const pulseScale = 0.98 + Math.sin(t * Math.PI) * 0.12;
          fx.mesh.scale.set(pulseScale, 1, pulseScale);
          if (mat) mat.opacity = (1 - t) * 0.96;
        } else if (fx.isLevelUpPillar) {
          const s = 0.75 + t * 0.85;
          fx.mesh.scale.set(s, 1 + t * 0.6, s);
          if (mat) mat.opacity = (1 - t) * 0.7;
        } else {
          const s = 1 + t * 2.4;
          fx.mesh.scale.set(s, s, s);
          if (mat) mat.opacity = (1 - t) * 0.85;
        }
      }
    }
  }
}
