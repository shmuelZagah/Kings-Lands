/**
 * Kings Lands — Dedicated 3D Spell Visual Effects, Dynamic Short Serpents & Burning Unit Fire VFX
 * (src/render/spellEffects.js)
 *
 * Centralizes all 3D spell visual effects so they are easy to edit and customize in one place,
 * shared across:
 *   1. In-Game 3D World (`src/render/worldEffectsRenderer.js`)
 *   2. Hall of Heroes 3D Preview (`src/tools/heroes/hallOfHeroesApp.js`)
 *   3. Animation Lab Studio Preview (`src/tools/studio/studioApp.js`)
 *   *(Note: Hero body keyframe animations `spell_<spellId>` and release/projectile timing profiles
 *     live in the companion file `src/render/heroSpellAnimations.js`.)*
 *
 * Key Effects:
 * - `healing_aura` (`self_heal` / `heal`): Two independent, short-bodied 3D slithering serpents
 *   (where the tapered tail follows closely behind the head before a single loop finishes).
 *   Serpent #1 slithers counter-clockwise with rapid S-waves; Serpent #2 starts on a staggered
 *   rhythm, moves in the opposite direction (clockwise), and follows a distinct swooping 3D trajectory!
 * - `sword_trail_slash` / `venom_blade_slash` (`mighty_strike` / `venom_strike` / `vampiric_cleave`):
 *   Curved 3D glowing crescent blade trail sweeping across the Hero's front arc with impact sparks.
 * - `projectile_fireball`: Flies straight (`arcHeight: 0.10`) with a blazing core + flame tail, and on impact
 *   spawns a 3D volumetric fiery explosion (expanding fire spheres + flying 3D lava embers — NO flat ground ring!).
 * - `lightning_staff_charge` / `lightning_arc` / `lightning_arc_jump` (`chain_lightning`):
 *   Electric orb charging at the Wizard's raised staff tip, followed by multi-branch jagged 3D lightning bolts
 *   jumping sequentially from enemy to enemy.
 * - `createBurningUnitFlameCluster` / `updateBurningUnitFlameCluster`:
 *   3D multi-tongue flickering fire + rising sparks attached to burning units (`state.isBurning`).
 */

import * as THREE from 'three';
import { sampleTerrainMeshHeightMeters } from '../sim/gameState.js';

let _cachedVolleyArrowGeom = null;
let _cachedVolleyArrowMat = null;
export function getVolleySculptedArrowMesh(isPreview = false) {
  if (!_cachedVolleyArrowGeom) {
    // Sculpted 3D arrow oriented along +Z (bodkin tip at +Z, shaft in middle, crossed fletching feathers at -Z)
    // so p.mesh.lookAt(nextPos) points the arrowhead straight down toward the ground!
    const parts = [];
    const length = 1.05;
    const shaft = new THREE.CylinderGeometry(0.018, 0.022, length, 6);
    shaft.rotateX(Math.PI * 0.5);
    parts.push({ geom: shaft, color: new THREE.Color(0xd97706) });

    const head = new THREE.ConeGeometry(0.058, 0.24, 4);
    head.rotateY(Math.PI * 0.25);
    head.rotateX(Math.PI * 0.5);
    head.translate(0, 0, length * 0.5 + 0.11);
    parts.push({ geom: head, color: new THREE.Color(0xf8fafc) });

    const collar = new THREE.CylinderGeometry(0.032, 0.026, 0.05, 6);
    collar.rotateX(Math.PI * 0.5);
    collar.translate(0, 0, length * 0.5 - 0.01);
    parts.push({ geom: collar, color: new THREE.Color(0xfacc15) });

    const tailZ = -length * 0.5 + 0.10;
    const finH = new THREE.BoxGeometry(0.16, 0.014, 0.20);
    finH.translate(0, 0, tailZ);
    parts.push({ geom: finH, color: new THREE.Color(0xffffff) });

    const finV = new THREE.BoxGeometry(0.014, 0.16, 0.20);
    finV.translate(0, 0, tailZ);
    parts.push({ geom: finV, color: new THREE.Color(0xffffff) });

    let totalV = 0;
    let totalI = 0;
    for (const p of parts) {
      totalV += p.geom.attributes.position.count;
      totalI += p.geom.index ? p.geom.index.count : p.geom.attributes.position.count;
    }
    const posArr = new Float32Array(totalV * 3);
    const colArr = new Float32Array(totalV * 3);
    const idxArr = new Uint16Array(totalI);
    let vOff = 0;
    let iOff = 0;
    for (const { geom, color } of parts) {
      const pa = geom.attributes.position;
      const ia = geom.index;
      for (let v = 0; v < pa.count; v++) {
        const d = (vOff + v) * 3;
        posArr[d] = pa.getX(v);
        posArr[d + 1] = pa.getY(v);
        posArr[d + 2] = pa.getZ(v);
        colArr[d] = color.r;
        colArr[d + 1] = color.g;
        colArr[d + 2] = color.b;
      }
      if (ia) {
        for (let k = 0; k < ia.count; k++) idxArr[iOff + k] = ia.getX(k) + vOff;
        iOff += ia.count;
      }
      vOff += pa.count;
      geom.dispose();
    }
    _cachedVolleyArrowGeom = new THREE.BufferGeometry();
    _cachedVolleyArrowGeom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    _cachedVolleyArrowGeom.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    _cachedVolleyArrowGeom.setIndex(new THREE.BufferAttribute(idxArr, 1));
    _cachedVolleyArrowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  }
  const m = new THREE.Mesh(_cachedVolleyArrowGeom, _cachedVolleyArrowMat);
  if (isPreview) m.scale.set(0.55, 0.55, 0.55);
  return m;
}

export function buildTerrainConformingRing(radiusInner, radiusOuter, centerX, centerZ, baseY, isPreview, segments = 64) {
  const geom = new THREE.RingGeometry(radiusInner, radiusOuter, segments, 1);
  geom.rotateX(-Math.PI * 0.5);
  if (!isPreview) {
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = centerX + pos.getX(i);
      const vz = centerZ + pos.getZ(i);
      const gy = sampleTerrainMeshHeightMeters(vx, vz, true, 4096);
      pos.setY(i, (gy - baseY) + 0.22);
    }
    pos.needsUpdate = true;
  }
  return geom;
}

export const SPELL_VFX_COLOR_MAP = Object.freeze({
  self_heal: 0x10b981,
  iron_blood: 0x94a3b8,
  wind_stride: 0x38bdf8,
  immortal_avatar: 0xfacc15,
  venom_strike: 0x22c55e,
  poison_arrow: 0x22c55e,
  soul_burn: 0xa855f7,
  mighty_strike: 0xef4444,
  piercing_shot: 0xfacc15,
  arcane_bolt: 0x38bdf8,
  repelling_shot: 0xf97316,
  throwing_knife: 0xe2e8f0,
  shockwave_slam: 0xf97316,
  repulse_wave: 0x38bdf8,
  whirlwind_rampage: 0xf43f5e,
  arrow_volley: 0xfacc15,
  arcane_nova: 0x818cf8,
  war_cry: 0xf43f5e,
  heal: 0x10b981,
  aura_of_valor: 0x2dd4bf,
  aegis_banner: 0xfbbf24,
  royal_sanctuary: 0xfde047,
  far_sight: 0x38bdf8,
  fireball: 0xf97316,
  mana_flow: 0x818cf8,
  chain_lightning: 0x38bdf8,
  meteor_storm: 0xff4500,
  vampiric_cleave: 0xe11d48,
  inspiring_onslaught: 0xf59e0b,
  explosive_mark: 0xa855f7,
  switch_weapon: 0x38bdf8,
  summon_warhorse: 0xfacc15,
  azure_blade_fury: 0x38bdf8,
  bloodlust_frenzy: 0xef4444,
  summon_royal_guard: 0xfbbf24,
  kings_decree: 0xfde047,
  unstoppable_charge: 0xf97316,
  chameleon_roar: 0x2dd4bf,
  chameleon_venom_bite: 0x22c55e
});

export function inferDefaultVfxStyle(spellId, explicitStyle = null) {
  if (explicitStyle) return explicitStyle;
  if (spellId === 'fireball') return 'projectile_fireball';
  if (spellId === 'azure_blade_fury') return 'azure_blade_slash';
  if (spellId === 'mighty_strike' || spellId === 'vampiric_cleave') return 'sword_trail_slash';
  if (spellId === 'summon_royal_guard') return 'summon_portal_ring';
  if (spellId === 'aegis_banner') return 'placed_royal_banner';
  if (spellId === 'far_sight') return 'far_sight_circle';
  if (spellId === 'chameleon_roar') return 'chameleon_roar_freeze';
  if (spellId === 'chameleon_venom_bite') return 'chameleon_bite_fangs';
  if (spellId === 'unstoppable_charge') return 'unstoppable_charge_trail';
  if (spellId === 'venom_strike') return 'venom_blade_slash';
  if (spellId === 'poison_arrow') return 'projectile_poison_arrow';
  if (spellId === 'piercing_shot' || spellId === 'repelling_shot') return 'projectile_piercing_bolt';
  if (spellId === 'throwing_knife') return 'projectile_dagger';
  if (spellId === 'arcane_bolt' || spellId === 'soul_burn' || spellId === 'explosive_mark') return 'projectile_arcane';
  if (spellId === 'self_heal' || spellId === 'heal') return 'healing_aura';
  if (
    spellId === 'royal_sanctuary' ||
    spellId === 'aegis_banner' ||
    spellId === 'immortal_avatar' ||
    spellId === 'far_sight'
  ) {
    return 'sanctuary_pillar';
  }
  if (spellId === 'chain_lightning') return 'lightning_arc';
  if (spellId === 'meteor_storm') return 'meteor_rain';
  if (spellId === 'arrow_volley') return 'arrow_volley';
  if (spellId === 'war_cry') return 'war_cry_roar';
  return 'shockwave_ring';
}

/**
 * Spawns a 3D volumetric fiery explosion (NO flat ground ring!) with an expanding incandescent core,
 * outer rolling flame shell, and 12 flying 3D lava/ember spheres.
 */
export function spawnVolumetric3DFireballExplosion({
  fxGroup,
  activeFxPulses,
  centerPos,
  radiusScale = 7.5,
  isPreview = false
}) {
  const sc = isPreview ? 0.36 : 1.0;
  const maxBlastR = Math.max(2.2, radiusScale * 0.42) * sc;

  const expGroup = new THREE.Group();
  expGroup.position.set(centerPos.x, centerPos.y + 0.55 * sc, centerPos.z);

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.98,
    depthWrite: false
  });
  const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.65 * sc, 14, 12), coreMat);

  const midMat = new THREE.MeshBasicMaterial({
    color: 0xff5500,
    transparent: true,
    opacity: 0.88,
    depthWrite: false
  });
  const midMesh = new THREE.Mesh(new THREE.SphereGeometry(1.05 * sc, 14, 12), midMat);

  const outerMat = new THREE.MeshBasicMaterial({
    color: 0xdc2626,
    transparent: true,
    opacity: 0.68,
    depthWrite: false
  });
  const outerMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1.35 * sc, 1), outerMat);

  expGroup.add(coreMesh, midMesh, outerMesh);

  // Flying 3D molten lava & ember chunks bursting outward in 3D directions
  const embers = [];
  const emberGeom = new THREE.DodecahedronGeometry(0.22 * sc, 0);
  const emberCount = 12;
  for (let i = 0; i < emberCount; i++) {
    const yaw = (i / emberCount) * Math.PI * 2 + (i % 3) * 0.25;
    const speedHoriz = (2.8 + (i % 4) * 1.15) * sc;
    const speedUp = (3.4 + (i % 3) * 1.45) * sc;
    const eMat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0xfde047 : 0xf97316,
      transparent: true,
      opacity: 0.96,
      depthWrite: false
    });
    const eMesh = new THREE.Mesh(emberGeom, eMat);
    expGroup.add(eMesh);
    embers.push({
      mesh: eMesh,
      mat: eMat,
      vx: Math.cos(yaw) * speedHoriz,
      vy: speedUp,
      vz: Math.sin(yaw) * speedHoriz
    });
  }

  fxGroup.add(expGroup);
  activeFxPulses.push({
    mesh: expGroup,
    mat: midMat,
    age: 0,
    maxAge: 0.78,
    customUpdate(_fx, dt, u) {
      const easeOut = 1 - Math.pow(1 - u, 2.4);
      const coreScale = 0.6 + easeOut * (maxBlastR * 0.85);
      const midScale = 0.7 + easeOut * (maxBlastR * 1.25);
      const outerScale = 0.8 + easeOut * (maxBlastR * 1.55);
      coreMesh.scale.setScalar(coreScale);
      midMesh.scale.setScalar(midScale);
      outerMesh.scale.setScalar(outerScale);
      outerMesh.rotation.y += dt * 4.5;
      outerMesh.rotation.x += dt * 3.2;

      coreMat.opacity = Math.max(0, (1 - u * 1.25) * 0.98);
      midMat.opacity = Math.max(0, (1 - u) * 0.88);
      outerMat.opacity = Math.max(0, (1 - Math.pow(u, 0.85)) * 0.68);

      const gravity = 9.8 * sc;
      for (let k = 0; k < embers.length; k++) {
        const em = embers[k];
        em.mesh.position.x += em.vx * dt;
        em.mesh.position.y += em.vy * dt;
        em.mesh.position.z += em.vz * dt;
        em.vy -= gravity * dt;
        em.mesh.rotation.x += dt * 8;
        em.mesh.rotation.z += dt * 6;
        em.mat.opacity = Math.max(0, 1 - u * 1.05);
      }
    }
  });
}

/**
 * Builds a dynamic, short-bodied articulated 3D serpent (sculpted head + glowing eyes + 16 tapered body/tail segments)
 * whose spine vertices are updated every frame along an organic 3D slithering trajectory!
 * Because its body length is compact (~0.38 of a turn), the tapered tail is already trailing right behind the head
 * before a single circle finishes, rather than forming static rings.
 */
export function buildDynamicShortSerpent({ bodyHex = 0x10b981, bellyHex = 0x6ee7b7, headHex = 0x34d399, sc = 1.0 }) {
  const root = new THREE.Group();
  const segCount = 16;
  const segments = [];

  const bodyMat = new THREE.MeshBasicMaterial({
    color: bodyHex,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });
  const altMat = new THREE.MeshBasicMaterial({
    color: bellyHex,
    transparent: true,
    opacity: 0.92,
    depthWrite: false
  });
  const headMat = new THREE.MeshBasicMaterial({
    color: headHex,
    transparent: true,
    opacity: 0.98,
    depthWrite: false
  });

  // Sculpted Serpent Head + Eyes + Forked Tongue
  const headGroup = new THREE.Group();
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.115 * sc, 0.30 * sc, 6), headMat);
  snout.rotation.x = Math.PI * 0.5;
  snout.scale.set(1.3, 0.72, 1.0);
  headGroup.add(snout);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028 * sc, 6, 6), eyeMat);
    eye.position.set(side * 0.068 * sc, 0.036 * sc, 0.025 * sc);
    headGroup.add(eye);
  }
  root.add(headGroup);

  // 16 Tapered Body-to-Tail Segments (thick behind the neck, tapering to a sharp tail tip)
  const segGeom = new THREE.SphereGeometry(0.088 * sc, 8, 8);
  for (let i = 0; i < segCount; i++) {
    const frac = i / (segCount - 1); // 0 = neck behind head, 1 = tail tip
    const radiusProfile = Math.sin((1 - frac * 0.85) * Math.PI * 0.5) * (1 - frac * 0.68);
    const mesh = new THREE.Mesh(segGeom, i % 3 === 0 ? altMat : bodyMat);
    mesh.scale.set(radiusProfile * 1.05, radiusProfile * 0.88, radiusProfile * 1.45);
    root.add(mesh);
    segments.push(mesh);
  }

  const _ptScratch = new THREE.Vector3();
  const _nextScratch = new THREE.Vector3();

  return {
    root,
    bodyMat,
    altMat,
    headMat,
    setOpacity(op) {
      bodyMat.opacity = op * 0.95;
      altMat.opacity = op * 0.9;
      headMat.opacity = op * 0.98;
    },
    /**
     * Evaluates `sampleFn(s)` along `[headS - bodyLengthS .. headS]` so the short serpent's tail
     * actively follows the head along its organic 3D slithering path!
     */
    updateAlongPath(headS, bodyLengthS, sampleFn) {
      sampleFn(headS, _ptScratch);
      sampleFn(headS + 0.025, _nextScratch);
      headGroup.position.copy(_ptScratch);
      headGroup.lookAt(_nextScratch);

      for (let i = 0; i < segCount; i++) {
        const lag = ((i + 1) / segCount) * bodyLengthS;
        const sSeg = Math.max(0, headS - lag);
        const sAhead = Math.max(0, headS - lag + 0.02);
        sampleFn(sSeg, _ptScratch);
        sampleFn(sAhead, _nextScratch);
        const segMesh = segments[i];
        segMesh.position.copy(_ptScratch);
        segMesh.lookAt(_nextScratch);
      }
    }
  };
}

/**
 * Builds a curved 3D glowing crescent sword slash ribbon (`sword_trail_slash` / `venom_blade_slash`).
 */
export function buildCurvedSwordSlashMesh({ colorHex = 0xef4444, coreHex = 0xfef08a, radius = 2.1, sc = 1.0 }) {
  const group = new THREE.Group();
  const arcPts = [];
  const segs = 22;
  const sweepAngle = Math.PI * 0.92;
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const ang = -sweepAngle * 0.5 + u * sweepAngle;
    const r = radius * sc * (0.85 + 0.2 * Math.sin(u * Math.PI));
    const yOff = (0.35 - u * 0.55) * sc;
    arcPts.push(new THREE.Vector3(Math.sin(ang) * r, yOff, Math.cos(ang) * r));
  }
  const curve = new THREE.CatmullRomCurve3(arcPts);
  const outerGeom = new THREE.TubeGeometry(curve, 24, 0.14 * sc, 6, false);
  const outerMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.92,
    depthWrite: false
  });
  const outerMesh = new THREE.Mesh(outerGeom, outerMat);
  outerMesh.scale.set(1.0, 0.35, 1.0);

  const innerGeom = new THREE.TubeGeometry(curve, 24, 0.065 * sc, 6, false);
  const innerMat = new THREE.MeshBasicMaterial({
    color: coreHex,
    transparent: true,
    opacity: 0.98,
    depthWrite: false
  });
  const innerMesh = new THREE.Mesh(innerGeom, innerMat);
  innerMesh.scale.set(1.02, 0.22, 1.02);

  group.add(outerMesh, innerMesh);
  return { group, outerMat, innerMat };
}

/**
 * Spawns a jagged 3D multi-strand lightning bolt between `fromPos` and `toPos`.
 */
export function spawnJaggedLightningBolt({ fxGroup, activeFxPulses, fromPos, toPos, isPreview = false, maxAge = 0.45 }) {
  const sc = isPreview ? 0.45 : 1.0;
  const boltGroup = new THREE.Group();

  const createStrand = (radius, hex, jitterAmp) => {
    const pts = [];
    const segs = 10;
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const midEnvelope = Math.sin(u * Math.PI);
      const jx = s > 0 && s < segs ? (Math.random() - 0.5) * jitterAmp * midEnvelope : 0;
      const jy = s > 0 && s < segs ? (Math.random() - 0.5) * jitterAmp * 0.85 * midEnvelope : 0;
      const jz = s > 0 && s < segs ? (Math.random() - 0.5) * jitterAmp * midEnvelope : 0;
      const lx = fromPos.x + (toPos.x - fromPos.x) * u + jx;
      const ly = fromPos.y + (toPos.y - fromPos.y) * u + Math.sin(u * Math.PI) * (0.45 * sc) + jy;
      const lz = fromPos.z + (toPos.z - fromPos.z) * u + jz;
      pts.push(new THREE.Vector3(lx, ly, lz));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geom = new THREE.TubeGeometry(curve, 20, radius * sc, 6, false);
    const mat = new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.98,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geom, mat);
    boltGroup.add(mesh);
    return mat;
  };

  const mainMat = createStrand(0.11, 0xe0f2fe, 0.95 * sc);
  const subMat = createStrand(0.055, 0x38bdf8, 1.35 * sc);

  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.9,
    depthWrite: false
  });
  const sparkSphere = new THREE.Mesh(new THREE.OctahedronGeometry(0.48 * sc, 1), sparkMat);
  sparkSphere.position.copy(toPos);
  boltGroup.add(sparkSphere);

  fxGroup.add(boltGroup);
  activeFxPulses.push({
    mesh: boltGroup,
    mat: mainMat,
    age: 0,
    maxAge,
    customUpdate(_fx, dt, u) {
      const flicker = 0.65 + 0.35 * Math.abs(Math.sin(u * Math.PI * 10));
      mainMat.opacity = (1 - u) * flicker;
      subMat.opacity = (1 - u) * 0.85 * flicker;
      sparkMat.opacity = (1 - u) * 0.92;
      sparkSphere.scale.setScalar(1 + u * 1.45);
      sparkSphere.rotation.y += dt * 10;
    }
  });
}

/**
 * Creates a 3D multi-tongue flickering fire cluster attached to a burning unit (`state.isBurning`).
 */
export function createBurningUnitFlameCluster() {
  const group = new THREE.Group();
  const tongues = [];
  const tongueConfigs = [
    { x: 0.0, y: 0.85, z: 0.0, r: 0.28, h: 0.95, hex: 0xfef08a, speed: 14.0, phase: 0.0 },
    { x: 0.18, y: 0.75, z: 0.14, r: 0.34, h: 1.15, hex: 0xf97316, speed: 11.5, phase: 1.4 },
    { x: -0.18, y: 0.78, z: -0.12, r: 0.32, h: 1.10, hex: 0xff4500, speed: 13.0, phase: 2.8 },
    { x: 0.05, y: 1.05, z: -0.16, r: 0.26, h: 0.90, hex: 0xef4444, speed: 15.5, phase: 4.1 }
  ];

  for (let i = 0; i < tongueConfigs.length; i++) {
    const cfg = tongueConfigs[i];
    const mat = new THREE.MeshBasicMaterial({
      color: cfg.hex,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    });
    const geom = new THREE.ConeGeometry(cfg.r, cfg.h, 6);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(cfg.x, cfg.y, cfg.z);
    group.add(mesh);
    tongues.push({ mesh, mat, cfg });
  }

  return { group, tongues, time: Math.random() * 10 };
}

/**
 * Animates a burning unit's 3D flame cluster each frame.
 */
export function updateBurningUnitFlameCluster(cluster, wx, wy, wz, dtSeconds) {
  if (!cluster || !cluster.group) return;
  cluster.time += dtSeconds;
  cluster.group.position.set(wx, wy, wz);
  const t = cluster.time;

  for (let i = 0; i < cluster.tongues.length; i++) {
    const item = cluster.tongues[i];
    const { mesh, mat, cfg } = item;
    const wave = Math.sin(t * cfg.speed + cfg.phase);
    const wave2 = Math.cos(t * (cfg.speed * 0.8) + cfg.phase * 1.7);
    const sx = 0.82 + 0.26 * wave;
    const sy = 0.85 + 0.38 * Math.abs(wave2);
    mesh.scale.set(sx, sy, sx);
    mesh.position.x = cfg.x + 0.07 * wave2;
    mesh.position.z = cfg.z + 0.07 * wave;
    mesh.position.y = cfg.y + 0.08 * Math.abs(wave);
    mesh.rotation.z = 0.18 * wave;
    mesh.rotation.x = 0.15 * wave2;
    mat.opacity = 0.72 + 0.24 * Math.abs(wave);
  }
}

/**
 * Shared 3D Spell Visual Effect Spawner used in-game (`WorldEffectsRenderer`), in Hall of Heroes, and in the Animation Lab.
 */
