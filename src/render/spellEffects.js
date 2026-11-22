import * as THREE from 'three';
import { sampleTerrainMeshHeightMeters } from '../sim/gameState.js';
import {
  getVolleySculptedArrowMesh,
  buildTerrainConformingRing,
  SPELL_VFX_COLOR_MAP,
  inferDefaultVfxStyle,
  spawnVolumetric3DFireballExplosion,
  buildDynamicShortSerpent,
  buildCurvedSwordSlashMesh,
  spawnJaggedLightningBolt,
  createBurningUnitFlameCluster,
  updateBurningUnitFlameCluster
} from './spellGeometryBuilders.js';

export {
  getVolleySculptedArrowMesh,
  buildTerrainConformingRing,
  SPELL_VFX_COLOR_MAP,
  inferDefaultVfxStyle,
  spawnVolumetric3DFireballExplosion,
  buildDynamicShortSerpent,
  buildCurvedSwordSlashMesh,
  spawnJaggedLightningBolt,
  createBurningUnitFlameCluster,
  updateBurningUnitFlameCluster
};

export function spawn3DSpellEffect({
  fxGroup,
  activeFxPulses,
  activeProjectiles,
  spellId = 'fireball',
  vfxStyle = null,
  fromPos,
  toPos,
  radiusScale = 1.0,
  flightDurationSec = 0,
  isPreview = false
}) {
  const style = inferDefaultVfxStyle(spellId, vfxStyle);
  const hex = SPELL_VFX_COLOR_MAP[spellId] || 0x38bdf8;
  const sc = isPreview ? 0.42 : 1.0;

  const addImpactRing = (pos, colorHex, maxR = 3.5, maxAge = 0.85) => {
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false
    });
    const ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.35 * sc, maxR * sc, 32), ringMat);
    ringMesh.rotation.x = -Math.PI * 0.5;
    ringMesh.position.set(pos.x, pos.y + 0.08, pos.z);
    fxGroup.add(ringMesh);
    activeFxPulses.push({
      mesh: ringMesh,
      mat: ringMat,
      age: 0,
      maxAge,
      isRingPulse: true
    });
  };

  // ============================================================================
  // 1. SELF HEAL / HEAL (`healing_aura`):
  //    Two independent, short-bodied 3D slithering serpents!
  //    - Each serpent has a short body (`bodyLengthS = 0.24`), so its tapered tail is already
  //      trailing right behind the head long before a circle finishes (no static torus rings!).
  //    - Serpent #1 (Emerald-Jade) starts immediately, slithering counter-clockwise with
  //      fast lateral S-waves and vertical crests/dives.
  //    - Serpent #2 (Turquoise-Gold) starts on a staggered rhythm (`delay = 0.14`), moves in the
  //      OPPOSITE direction (clockwise), and weaves along a completely different figure-8 swooping path!
  // ============================================================================
  if (style === 'healing_aura') {
    const baseGroundY = isPreview ? 0.05 : Math.max(0, fromPos.y - 1.15);
    const baseRadius = isPreview ? 0.58 : 1.05;
    const totalRiseHeight = isPreview ? 1.85 : 2.85;

    const serpent1 = buildDynamicShortSerpent({
      bodyHex: 0x10b981,
      bellyHex: 0x6ee7b7,
      headHex: 0x34d399,
      sc
    });
    const serpent2 = buildDynamicShortSerpent({
      bodyHex: 0x2dd4bf,
      bellyHex: 0xfde047,
      headHex: 0x5eead4,
      sc
    });

    const serpentsHolder = new THREE.Group();
    serpentsHolder.position.set(fromPos.x, baseGroundY, fromPos.z);
    serpentsHolder.add(serpent1.root, serpent2.root);
    fxGroup.add(serpentsHolder);

    activeFxPulses.push({
      mesh: serpentsHolder,
      mat: serpent1.bodyMat,
      age: 0,
      maxAge: 1.55,
      customUpdate(_fx, _dt, u) {
        // Serpent #1: Counter-clockwise (+1), bursty darting pace, rapid S-wave radial & vertical slithering
        const headS1 = Math.min(1.15, u * 1.12 + 0.11 * Math.sin(u * Math.PI * 5));
        serpent1.updateAlongPath(headS1, 0.23, (s, outVec) => {
          const theta = s * Math.PI * 2.85; // ~1.4 turns total, but body is only 0.23 of that (~115 deg arc!)
          const rWave = baseRadius * (0.74 + 0.36 * Math.sin(s * 14.0 - u * 6.0));
          const yWave =
            0.22 * sc +
            s * totalRiseHeight +
            0.24 * sc * Math.sin(s * 16.5 + u * 8.0);
          outVec.set(Math.cos(theta) * rWave, yWave, Math.sin(theta) * rWave);
        });
        const fade1 = u < 0.78 ? 1.0 : Math.max(0, (1 - u) / 0.22);
        serpent1.setOpacity(fade1);

        // Serpent #2: Staggered start (`u > 0.12`), OPPOSITE clockwise direction (-1),
        // completely different diagonal swooping / figure-8 wave movement and rhythm!
        const u2 = Math.max(0, (u - 0.12) / 0.88);
        if (u2 <= 0) {
          serpent2.root.visible = false;
        } else {
          serpent2.root.visible = true;
          const headS2 = Math.min(1.15, u2 * 1.1 + 0.14 * (1 - Math.cos(u2 * Math.PI * 4)));
          serpent2.updateAlongPath(headS2, 0.25, (s, outVec) => {
            const theta = Math.PI * 0.65 - s * Math.PI * 2.55; // Opposite direction (clockwise)!
            const rWave = baseRadius * (0.82 + 0.38 * Math.cos(s * 11.0 + u2 * 7.5));
            const swoopY =
              0.30 * sc +
              Math.pow(s, 0.88) * (totalRiseHeight * 0.96) +
              0.32 * sc * Math.cos(s * 12.5 - u2 * 6.5);
            const tiltX = 0.18 * sc * Math.sin(s * 9.0);
            outVec.set(Math.cos(theta) * rWave + tiltX, swoopY, Math.sin(theta) * rWave - tiltX);
          });
          const fade2 = u2 < 0.78 ? 1.0 : Math.max(0, (1 - u2) / 0.22);
          serpent2.setOpacity(fade2);
        }
      }
    });
    return;
  }

  // ============================================================================
  // 2. MIGHTY STRIKE / VENOM STRIKE / VAMPIRIC CLEAVE (`sword_trail_slash` / `venom_blade_slash`):
  //    3D curved glowing sword slash ribbon sweeping across the Hero's front melee arc!
  // ============================================================================
  if (style === 'sword_trail_slash' || style === 'venom_blade_slash' || style === 'azure_blade_slash') {
    const isAzure = style === 'azure_blade_slash' || spellId === 'azure_blade_fury';
    const isVenom = style === 'venom_blade_slash' || spellId === 'venom_strike';
    const isVamp = spellId === 'vampiric_cleave';
    const trailColor = isAzure ? 0x38bdf8 : isVenom ? 0x22c55e : isVamp ? 0xe11d48 : 0xf97316;
    const coreColor = isAzure ? 0xe0f2fe : isVenom ? 0xbbf7d0 : 0xfef08a;

    const dx = toPos.x - fromPos.x;
    const dz = toPos.z - fromPos.z;
    const facingYaw = Math.abs(dx) + Math.abs(dz) > 0.05 ? Math.atan2(dx, dz) : 0;

    const slash = buildCurvedSwordSlashMesh({
      colorHex: trailColor,
      coreHex: coreColor,
      radius: isPreview ? 1.15 : 2.15,
      sc: 1.0
    });
    slash.group.position.set(fromPos.x, isPreview ? 1.05 : fromPos.y, fromPos.z);
    slash.group.rotation.y = facingYaw - 0.85;
    slash.group.rotation.z = -0.28;
    fxGroup.add(slash.group);

    activeFxPulses.push({
      mesh: slash.group,
      mat: slash.outerMat,
      age: 0,
      maxAge: 0.42,
      customUpdate(_fx, _dt, u) {
        const sweepEase = 1 - Math.pow(1 - u, 2.6);
        slash.group.rotation.y = facingYaw - 0.85 + sweepEase * 1.75;
        const arcScale = 0.82 + sweepEase * 0.42;
        slash.group.scale.set(arcScale, 1.0, arcScale);
        const fade = Math.max(0, 1 - Math.pow(u, 1.4));
        slash.outerMat.opacity = fade * 0.94;
        slash.innerMat.opacity = fade * 0.98;
      }
    });

    const sparkMat = new THREE.MeshBasicMaterial({
      color: trailColor,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    const sparkMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(isPreview ? 0.28 : 0.65, 1),
      sparkMat
    );
    sparkMesh.position.set(toPos.x, isPreview ? 0.9 : toPos.y + 0.9, toPos.z);
    fxGroup.add(sparkMesh);
    activeFxPulses.push({
      mesh: sparkMesh,
      mat: sparkMat,
      age: 0,
      maxAge: 0.38
    });
    return;
  }

  // ============================================================================
  // 3. CHAIN LIGHTNING (`lightning_staff_charge` / `lightning_arc` / `lightning_arc_jump`)
  // ============================================================================
  if (style === 'lightning_staff_charge') {
    const orbGroup = new THREE.Group();
    orbGroup.position.copy(fromPos);

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.98,
      depthWrite: false
    });
    const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.26 * sc, 12, 10), coreMat);

    const shellMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false
    });
    const shellMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.52 * sc, 1), shellMat);

    orbGroup.add(coreMesh, shellMesh);
    fxGroup.add(orbGroup);

    activeFxPulses.push({
      mesh: orbGroup,
      mat: coreMat,
      age: 0,
      maxAge: 0.48,
      customUpdate(_fx, dt, u) {
        const pulse = 0.65 + Math.sin(u * Math.PI) * 0.85;
        orbGroup.scale.setScalar(pulse);
        shellMesh.rotation.y += dt * 12;
        shellMesh.rotation.x += dt * 9;
        coreMat.opacity = Math.max(0, 1 - Math.pow(u, 2.2));
        shellMat.opacity = Math.max(0, (1 - u) * 0.9);
      }
    });
    return;
  }

  if (style === 'lightning_arc_jump') {
    spawnJaggedLightningBolt({
      fxGroup,
      activeFxPulses,
      fromPos,
      toPos,
      isPreview,
      maxAge: 0.42
    });
    return;
  }

  if (style === 'lightning_arc') {
    spawn3DSpellEffect({
      fxGroup,
      activeFxPulses,
      activeProjectiles,
      spellId: 'chain_lightning',
      vfxStyle: 'lightning_staff_charge',
      fromPos,
      toPos: fromPos,
      radiusScale,
      isPreview
    });
    spawnJaggedLightningBolt({
      fxGroup,
      activeFxPulses,
      fromPos,
      toPos,
      isPreview,
      maxAge: 0.55
    });
    if (isPreview) {
      const hop2 = toPos.clone().add(new THREE.Vector3(0.85, 0.25, -0.45));
      const hop3 = toPos.clone().add(new THREE.Vector3(-0.75, 0.3, -0.65));
      spawnJaggedLightningBolt({ fxGroup, activeFxPulses, fromPos: toPos, toPos: hop2, isPreview: true, maxAge: 0.72 });
      spawnJaggedLightningBolt({ fxGroup, activeFxPulses, fromPos: hop2, toPos: hop3, isPreview: true, maxAge: 0.88 });
    }
    return;
  }

  // ============================================================================
  // 4. FIREBALL (`projectile_fireball` / `fireball_explosion_3d`):
  //    Flies STRAIGHT (`arcHeight: 0.10`) over `flightDurationSec` and explodes into a
  //    3D volumetric fireball with flying lava embers (NO flat ground ring!).
  // ============================================================================
  if (style === 'fireball_explosion_3d') {
    spawnVolumetric3DFireballExplosion({
      fxGroup,
      activeFxPulses,
      centerPos: toPos,
      radiusScale,
      isPreview
    });
    return;
  }

  if (style === 'projectile_fireball' || style === 'projectile_fireball_flight') {
    const start = fromPos.clone();
    const end = toPos.clone();
    if (start.distanceTo(end) < 0.5) {
      end.z += isPreview ? 2.6 : 8.0;
    }
    if (!isPreview) {
      end.y += 0.65;
    }

    const projGroup = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(isPreview ? 0.22 : 0.48, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(isPreview ? 0.34 : 0.78, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.78, depthWrite: false })
    );
    const tail = new THREE.Mesh(
      new THREE.ConeGeometry(isPreview ? 0.24 : 0.54, isPreview ? 0.75 : 1.75, 10),
      new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.65, depthWrite: false })
    );
    tail.rotation.x = -Math.PI * 0.5;
    tail.position.z = isPreview ? -0.35 : -0.82;
    projGroup.add(core, halo, tail);
    projGroup.position.copy(start);
    projGroup.lookAt(end);
    fxGroup.add(projGroup);

    const dist = start.distanceTo(end);
    const flightDuration =
      flightDurationSec > 0
        ? flightDurationSec
        : isPreview
          ? 0.36
          : Math.max(0.15, Math.min(0.9, dist / 44.0));

    activeProjectiles.push({
      mesh: projGroup,
      start,
      end,
      arcHeight: isPreview ? 0.04 : 0.1,
      age: 0,
      duration: flightDuration,
      isFireball3D: true,
      onArrival() {
        spawnVolumetric3DFireballExplosion({
          fxGroup,
          activeFxPulses,
          centerPos: end,
          radiusScale,
          isPreview
        });
      }
    });
    return;
  }

  // ============================================================================
  // 5. OTHER PROJECTILES (`projectile_poison_arrow`, `projectile_piercing_bolt`, `projectile_dagger`, `projectile_arcane`)
  //    Synchronized to `flightDurationSec` so bow shots and knockback hit on the exact arrival frame!
  // ============================================================================
  if (style.startsWith('projectile_')) {
    const start = fromPos.clone();
    const end = toPos.clone();
    if (start.distanceTo(end) < 0.5) {
      end.z += isPreview ? 2.8 : 8.0;
    }
    const projGroup = new THREE.Group();
    if (style === 'projectile_dagger') {
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(isPreview ? 0.08 : 0.16, isPreview ? 0.48 : 0.95, 4),
        new THREE.MeshBasicMaterial({ color: 0xe2e8f0 })
      );
      blade.rotation.x = Math.PI * 0.5;
      projGroup.add(blade);
    } else {
      const boltCol =
        style === 'projectile_poison_arrow'
          ? 0x22c55e
          : style === 'projectile_piercing_bolt'
            ? 0xfacc15
            : 0xa855f7;
      const shaft = new THREE.Mesh(
        new THREE.ConeGeometry(isPreview ? 0.11 : 0.24, isPreview ? 0.65 : 1.35, 6),
        new THREE.MeshBasicMaterial({ color: boltCol })
      );
      shaft.rotation.x = Math.PI * 0.5;
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(isPreview ? 0.16 : 0.36, 8, 8),
        new THREE.MeshBasicMaterial({ color: boltCol, transparent: true, opacity: 0.6, depthWrite: false })
      );
      projGroup.add(shaft, glow);
    }
    projGroup.position.copy(start);
    projGroup.lookAt(end);
    fxGroup.add(projGroup);

    const dist = start.distanceTo(end);
    const flightDuration =
      flightDurationSec > 0
        ? flightDurationSec
        : isPreview
          ? 0.36
          : Math.max(0.15, Math.min(0.85, dist / 46.0));

    activeProjectiles.push({
      mesh: projGroup,
      start,
      end,
      arcHeight: isPreview ? 0.14 : Math.min(1.1, dist * 0.045),
      age: 0,
      duration: flightDuration,
      isFireArrow: false,
      impactHex: hex,
      impactRadius: isPreview ? 1.6 : Math.max(2.8, radiusScale * 0.45)
    });
    return;
  }

  if (style === 'placed_royal_banner') {
    const groundY = isPreview ? toPos.y : sampleTerrainMeshHeightMeters(toPos.x, toPos.z, true, 4096);
    const bannerHolder = new THREE.Group();
    bannerHolder.position.set(toPos.x, groundY, toPos.z);
    const poleMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.98 });
    const poleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * sc, 0.09 * sc, 4.4 * sc, 8), poleMat);
    poleMesh.position.y = 2.2 * sc;
    const crossbarMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04 * sc, 0.04 * sc, 1.6 * sc, 8), poleMat);
    crossbarMesh.rotation.z = Math.PI * 0.5;
    crossbarMesh.position.set(0, 4.1 * sc, 0);
    const clothMat = new THREE.MeshBasicMaterial({ color: 0x2563eb, side: THREE.DoubleSide, transparent: true, opacity: 0.96 });
    const clothMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.45 * sc, 2.1 * sc), clothMat);
    clothMesh.position.set(0, 3.0 * sc, 0.05 * sc);
    const crestMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.98 });
    const crestMesh = new THREE.Mesh(new THREE.CircleGeometry(0.38 * sc, 16), crestMat);
    crestMesh.position.set(0, 3.1 * sc, 0.07 * sc);

    const auraRadius = isPreview ? 2.4 : Math.max(22.0, radiusScale);
    const auraRingMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
      depthWrite: false
    });
    const auraRingGeom = buildTerrainConformingRing(auraRadius * 0.96, auraRadius, toPos.x, toPos.z, groundY, isPreview, 72);
    const auraRing = new THREE.Mesh(auraRingGeom, auraRingMat);
    auraRing.renderOrder = 990;
    bannerHolder.add(poleMesh, crossbarMesh, clothMesh, crestMesh, auraRing);
    fxGroup.add(bannerHolder);
    activeFxPulses.push({
      mesh: bannerHolder,
      mat: clothMat,
      age: 0,
      maxAge: isPreview ? 2.5 : 20.0,
      customUpdate(_fx, _dt, u) {
        clothMesh.rotation.y = Math.sin(u * Math.PI * 24) * 0.16;
        crestMesh.rotation.y = clothMesh.rotation.y;
        const fade = u < 0.9 ? 1.0 : Math.max(0, (1 - u) / 0.1);
        poleMat.opacity = fade;
        clothMat.opacity = fade * 0.96;
        crestMat.opacity = fade;
        auraRingMat.opacity = fade * (0.5 + 0.22 * Math.sin(u * Math.PI * 16));
      }
    });
    return;
  }

  if (style === 'far_sight_circle') {
    // The King Spell 3 (Far Sight): Flowing, spiraling 3D wind-stream ribbons ("רוח פרצים")
    // that uncoil from the center point and sweep outward to the perimeter in 0.5s (NO spheres/orbs and NO persistent ring!).
    const groundY = isPreview ? toPos.y : sampleTerrainMeshHeightMeters(toPos.x, toPos.z, true, 4096);
    const revGroup = new THREE.Group();
    revGroup.position.set(toPos.x, groundY, toPos.z);
    const revRad = isPreview ? 2.6 : Math.max(14.0, radiusScale);

    // Build a curved wind-stream ribbon geometry (long thin S-curved wind current)
    const curvePts = [];
    const ribbonLen = isPreview ? 1.25 : 7.5;
    for (let s = 0; s <= 12; s++) {
      const f = s / 12;
      const zOff = (f - 0.5) * ribbonLen;
      const xWave = Math.sin(f * Math.PI * 1.5) * (isPreview ? 0.22 : 1.15);
      const yWave = Math.sin(f * Math.PI) * (isPreview ? 0.12 : 0.45);
      curvePts.push(new THREE.Vector3(xWave, yWave, zOff));
    }
    const windCurve = new THREE.CatmullRomCurve3(curvePts);
    const windRibbonGeom = new THREE.TubeGeometry(windCurve, 18, isPreview ? 0.045 : 0.16, 5, false);
    windRibbonGeom.scale(1.8, 0.22, 1.0); // Flatten into an airy wind ribbon

    const streamCount = 12;
    const streams = [];
    for (let i = 0; i < streamCount; i++) {
      const baseAng = (i / streamCount) * Math.PI * 2;
      const wMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xf8fafc : 0xbae6fd,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.48,
        depthTest: false,
        depthWrite: false
      });
      const wMesh = new THREE.Mesh(windRibbonGeom, wMat);
      wMesh.renderOrder = 991;
      revGroup.add(wMesh);
      streams.push({
        mesh: wMesh,
        mat: wMat,
        baseAng,
        swirl: (i % 2 === 0 ? 1 : -1) * 0.55,
        delay: (i % 3) * 0.035
      });
    }

    fxGroup.add(revGroup);
    activeFxPulses.push({
      mesh: revGroup,
      mat: streams[0].mat,
      age: 0,
      maxAge: 0.52, // Half a second rushing wind streams from center to edge!
      customUpdate(_fx, _dt, u) {
        for (let i = 0; i < streams.length; i++) {
          const st = streams[i];
          const p = Math.min(1, Math.max(0, (u - st.delay) / (1 - st.delay)));
          const easeOut = 1 - Math.pow(1 - p, 1.85);
          const dist = easeOut * revRad * 0.88;
          const ang = st.baseAng + st.swirl * p;
          const cosA = Math.cos(ang);
          const sinA = Math.sin(ang);
          const wx = toPos.x + cosA * dist;
          const wz = toPos.z + sinA * dist;
          const localY = isPreview ? groundY : sampleTerrainMeshHeightMeters(wx, wz, true, 4096);
          st.mesh.position.set(cosA * dist, (localY - groundY) + 0.42, sinA * dist);
          // Orient ribbon tangent to the outward spiral wind flow
          st.mesh.rotation.y = Math.atan2(cosA, sinA) + st.swirl * 0.35;
          const stretchZ = 0.45 + p * 1.35;
          st.mesh.scale.set(1.0 + p * 0.5, 1.0, stretchZ);
          const fade = p < 0.14 ? p / 0.14 : Math.pow(1 - p, 1.5);
          st.mat.opacity = fade * 0.46;
        }
      }
    });
    return;
  }

  if (style === 'kings_decree_wind') {
    // The King Spell 5 (King's Decree): Fast-expanding translucent glowing ring followed by 3 trailing rings
    // that expand rapidly from the center and fade out softly toward the outer edges!
    const groundY = isPreview ? toPos.y : sampleTerrainMeshHeightMeters(toPos.x, toPos.z, true, 4096);
    const maxRad = isPreview ? 3.2 : Math.max(36.0, radiusScale);
    const ringCount = 4; // 1 primary ring + 3 trailing rings
    const baseRingGeom = new THREE.RingGeometry(0.93, 1.0, 72);
    baseRingGeom.rotateX(-Math.PI * 0.5);
    const haloRingGeom = new THREE.RingGeometry(0.82, 1.06, 72);
    haloRingGeom.rotateX(-Math.PI * 0.5);

    for (let r = 0; r < ringCount; r++) {
      const waveHolder = new THREE.Group();
      waveHolder.position.set(toPos.x, groundY + 0.32, toPos.z);

      const coreBaseOp = Math.max(0.16, 0.35 - r * 0.055);
      const haloBaseOp = Math.max(0.08, 0.16 - r * 0.025);

      const coreMat = new THREE.MeshBasicMaterial({
        color: r % 2 === 0 ? 0xfef08a : 0xfbbf24,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false
      });
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false
      });

      const coreMesh = new THREE.Mesh(baseRingGeom, coreMat);
      const haloMesh = new THREE.Mesh(haloRingGeom, haloMat);
      coreMesh.renderOrder = 992;
      haloMesh.renderOrder = 991;
      waveHolder.add(haloMesh, coreMesh);
      fxGroup.add(waveHolder);

      const delaySec = r * 0.13;
      const ringDur = 0.72;
      activeFxPulses.push({
        mesh: waveHolder,
        mat: coreMat,
        age: -delaySec,
        maxAge: ringDur,
        customUpdate(fx) {
          if (fx.age < 0) {
            waveHolder.visible = false;
            return;
          }
          waveHolder.visible = true;
          const prog = Math.min(1, fx.age / fx.maxAge);
          const easeOut = 1 - Math.pow(1 - prog, 2.0);
          const curRad = Math.max(0.4, easeOut * maxRad);
          waveHolder.scale.set(curRad, 1, curRad);

          // Translucent from the start and smoothly fading out toward the outer edges
          const fade = prog < 0.12 ? prog / 0.12 : Math.pow(1 - prog, 1.65);
          coreMat.opacity = fade * coreBaseOp;
          haloMat.opacity = fade * haloBaseOp;
        }
      });
    }
    return;
  }

  if (style === 'royal_banner_drop' || style === 'summon_portal_ring') {
    // Ravan Spell 2 (Summon Royal Army):
    // 1. Center point appears and pulses briefly (0.0s .. 0.22s)
    // 2. Center point splits into 32 glowing points flying outward across `maxSpreadRad` (0.22s .. 1.05s);
    //    as the flying points pass over each soldier's position, that soldier materializes!
    const groundY = isPreview ? toPos.y : sampleTerrainMeshHeightMeters(toPos.x, toPos.z, true, 4096);
    const summonGroup = new THREE.Group();
    summonGroup.position.set(toPos.x, groundY, toPos.z);
    const maxSpreadRad = isPreview ? 2.4 : Math.max(9.5, radiusScale * 1.15);

    const centerCoreMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
      transparent: true,
      opacity: 0.96,
      depthWrite: false
    });
    const centerHaloMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.68,
      depthWrite: false
    });
    const centerOrb = new THREE.Group();
    centerOrb.position.set(0, isPreview ? 0.55 : 1.15, 0);
    centerOrb.add(
      new THREE.Mesh(new THREE.SphereGeometry(isPreview ? 0.22 : 0.52, 14, 12), centerCoreMat),
      new THREE.Mesh(new THREE.SphereGeometry(isPreview ? 0.36 : 0.88, 14, 12), centerHaloMat)
    );
    summonGroup.add(centerOrb);

    const orbCount = 32;
    const dispersingOrbs = [];
    const smallOrbGeom = new THREE.SphereGeometry(isPreview ? 0.085 : 0.22, 8, 8);
    for (let i = 0; i < orbCount; i++) {
      const ang = (i / orbCount) * Math.PI * 2;
      const oMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xfef08a : 0x38bdf8,
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const oMesh = new THREE.Mesh(smallOrbGeom, oMat);
      summonGroup.add(oMesh);
      dispersingOrbs.push({
        mesh: oMesh,
        mat: oMat,
        cosA: Math.cos(ang),
        sinA: Math.sin(ang)
      });
    }

    fxGroup.add(summonGroup);
    activeFxPulses.push({
      mesh: summonGroup,
      mat: centerCoreMat,
      age: 0,
      maxAge: 1.05,
      customUpdate(_fx, _dt, u) {
        if (u < 0.24) {
          const p1 = u / 0.24;
          const pulse = 0.45 + p1 * 0.9;
          centerOrb.scale.setScalar(pulse);
          centerCoreMat.opacity = 0.96;
          centerHaloMat.opacity = 0.68;
          for (let i = 0; i < dispersingOrbs.length; i++) {
            dispersingOrbs[i].mesh.visible = false;
          }
        } else {
          // Uniform radial wave expansion (p2 in 0..1) synchronized 1:1 with soldier materialization!
          const p2 = (u - 0.24) / 0.76;
          centerOrb.scale.setScalar(Math.max(0.01, 1.35 * (1 - p2 * 1.5)));
          centerCoreMat.opacity = Math.max(0, (1 - p2 * 2.0) * 0.96);
          centerHaloMat.opacity = Math.max(0, (1 - p2 * 2.0) * 0.68);

          const dist = p2 * maxSpreadRad;
          for (let i = 0; i < dispersingOrbs.length; i++) {
            const d = dispersingOrbs[i];
            d.mesh.visible = true;
            const wx = toPos.x + d.cosA * dist;
            const wz = toPos.z + d.sinA * dist;
            const localY = isPreview ? groundY : sampleTerrainMeshHeightMeters(wx, wz, true, 4096);
            d.mesh.position.set(
              d.cosA * dist,
              (localY - groundY) + (isPreview ? 0.45 : 0.85) * (1 - p2 * 0.35),
              d.sinA * dist
            );
            d.mat.opacity = Math.max(0, Math.pow(1 - p2, 1.2) * 0.92);
          }
        }
      }
    });
    return;
  }

  if (style === 'chameleon_roar_freeze') {
    // Multi-directional semi-circular sonic soundwave arcs flying outward in staggered bursts and conforming to terrain height!
    const originGroundY = isPreview ? toPos.y : sampleTerrainMeshHeightMeters(toPos.x, toPos.z, true, 4096);
    const maxRoarDist = isPreview ? 2.8 : Math.max(11.0, radiusScale * 0.92);
    const directions = 6;
    const wavesPerDir = 3;
    const arcGeom = new THREE.RingGeometry(0.45, 0.66, 20, 1, -Math.PI * 0.34, Math.PI * 0.68);
    arcGeom.rotateX(-Math.PI * 0.5);
    arcGeom.rotateY(-Math.PI * 0.5);

    for (let w = 0; w < wavesPerDir; w++) {
      for (let d = 0; d < directions; d++) {
        const dirAngle = (d / directions) * Math.PI * 2 + (w % 2) * 0.26;
        const dirCos = Math.cos(dirAngle);
        const dirSin = Math.sin(dirAngle);
        const sonicMat = new THREE.MeshBasicMaterial({
          color: w % 2 === 0 ? 0x2dd4bf : 0x7dd3fc,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.0,
          depthTest: true,
          depthWrite: false
        });
        const sonicMesh = new THREE.Mesh(arcGeom, sonicMat);
        // Orient the semi-circle outward along (dirCos, dirSin)
        sonicMesh.rotation.y = -dirAngle;
        sonicMesh.position.set(toPos.x, originGroundY + 0.55, toPos.z);
        fxGroup.add(sonicMesh);

        const delaySec = w * 0.24 + (d % 2) * 0.06;
        const travelDur = 1.30;
        activeFxPulses.push({
          mesh: sonicMesh,
          mat: sonicMat,
          age: -delaySec,
          maxAge: travelDur,
          customUpdate(fx) {
            if (fx.age < 0) {
              sonicMat.opacity = 0;
              sonicMesh.visible = false;
              return;
            }
            sonicMesh.visible = true;
            const prog = Math.min(1, fx.age / fx.maxAge);
            const curDist = (isPreview ? 0.35 : 1.1) + prog * maxRoarDist;
            const wx = toPos.x + dirCos * curDist;
            const wz = toPos.z + dirSin * curDist;
            const localGroundY = isPreview ? originGroundY : sampleTerrainMeshHeightMeters(wx, wz, true, 4096);
            // If the soundwave hits a steep cliff/mountain wall (> 2.4m height jump), attenuate it so it doesn't clip through terrain
            const heightDiff = Math.abs(localGroundY - originGroundY);
            const terrainBlockFade = isPreview ? 1.0 : Math.max(0, 1.0 - Math.max(0, heightDiff - 1.6) / 1.4);

            sonicMesh.position.set(wx, localGroundY + 0.52, wz);
            const arcScale = (isPreview ? 0.55 : 1.15) + prog * (isPreview ? 1.2 : 2.8);
            sonicMesh.scale.set(arcScale, 1, arcScale);
            const env = prog < 0.18 ? prog / 0.18 : Math.max(0, (1 - prog) / 0.82);
            sonicMat.opacity = env * 0.88 * terrainBlockFade;
          }
        });
      }
    }
    return;
  }

  if (style === 'chameleon_bite_fangs') {
    const biteGroup = new THREE.Group();
    biteGroup.position.set(toPos.x, toPos.y + 1.05 * sc, toPos.z);
    const fangMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.96, depthWrite: false });
    for (let i = -2; i <= 2; i++) {
      const upperFang = new THREE.Mesh(new THREE.ConeGeometry(0.08 * sc, 0.42 * sc, 5), fangMat);
      upperFang.position.set(i * 0.16 * sc, 0.38 * sc, 0);
      upperFang.rotation.x = Math.PI;
      const lowerFang = new THREE.Mesh(new THREE.ConeGeometry(0.08 * sc, 0.42 * sc, 5), fangMat);
      lowerFang.position.set(i * 0.16 * sc, -0.38 * sc, 0);
      biteGroup.add(upperFang, lowerFang);
    }
    fxGroup.add(biteGroup);
    activeFxPulses.push({
      mesh: biteGroup,
      mat: fangMat,
      age: 0,
      maxAge: 0.52,
      customUpdate(_fx, _dt, u) {
        const snap = Math.min(1, u * 2.2);
        biteGroup.scale.set(1.0, 1.0 - snap * 0.65, 1.0);
        fangMat.opacity = Math.max(0, 1 - Math.pow(u, 1.6));
      }
    });
    return;
  }

  if (style === 'unstoppable_charge_trail') {
    // Sisnat Spell 1 (Unstoppable Charge): NO circle at the start and NO circle at the end!
    // Renders a directional ground charge streak trail along the rush vector.
    const trailGroup = new THREE.Group();
    const dx = toPos.x - fromPos.x;
    const dz = toPos.z - fromPos.z;
    const dist = Math.max(0.5, Math.hypot(dx, dz));
    const yaw = Math.atan2(dx, dz);
    const streakCount = 8;
    const streaks = [];
    const streakGeom = new THREE.PlaneGeometry(isPreview ? 0.45 : 1.65, isPreview ? 0.9 : 2.8);
    streakGeom.rotateX(-Math.PI * 0.5);

    for (let i = 0; i < streakCount; i++) {
      const frac = (i + 0.5) / streakCount;
      const sx = fromPos.x + dx * frac;
      const sz = fromPos.z + dz * frac;
      const sy = isPreview ? fromPos.y + 0.08 : sampleTerrainMeshHeightMeters(sx, sz, true, 4096) + 0.16;
      const sMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xf97316 : 0xfbbf24,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const sMesh = new THREE.Mesh(streakGeom, sMat);
      sMesh.position.set(sx, sy, sz);
      sMesh.rotation.y = yaw;
      trailGroup.add(sMesh);
      streaks.push({ mesh: sMesh, mat: sMat, startU: frac * 0.65 });
    }
    fxGroup.add(trailGroup);
    activeFxPulses.push({
      mesh: trailGroup,
      mat: streaks[0].mat,
      age: 0,
      maxAge: isPreview ? 1.0 : 1.85,
      customUpdate(_fx, _dt, u) {
        for (let i = 0; i < streaks.length; i++) {
          const st = streaks[i];
          if (u < st.startU) {
            st.mat.opacity = 0;
          } else {
            const localU = Math.min(1, (u - st.startU) / (1 - st.startU));
            st.mat.opacity = Math.max(0, (1 - localU) * 0.42);
          }
        }
      }
    });
    return;
  }

  // ============================================================================
  // 6. SANCTUARY PILLAR (`sanctuary_pillar`)
  // ============================================================================
  if (style === 'sanctuary_pillar') {
    const pillarMat = new THREE.MeshBasicMaterial({
      color: hex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    const cylR = isPreview ? 0.95 : Math.max(1.8, radiusScale * 0.35);
    const cylH = isPreview ? 3.4 : 11.0;
    const pillarMesh = new THREE.Mesh(new THREE.CylinderGeometry(cylR, cylR, cylH, 24, 1, true), pillarMat);
    pillarMesh.position.set(toPos.x, toPos.y + cylH * 0.5, toPos.z);
    fxGroup.add(pillarMesh);
    activeFxPulses.push({
      mesh: pillarMesh,
      mat: pillarMat,
      age: 0,
      maxAge: 1.15,
      isLevelUpPillar: true
    });
    addImpactRing(toPos, hex, isPreview ? 2.8 : Math.max(4.0, radiusScale * 0.6), 1.1);
    return;
  }

  // ============================================================================
  // 7. METEOR RAIN & ARROW VOLLEY (`meteor_rain`, `arrow_volley`)
  // ============================================================================
  if (style === 'arrow_volley') {
    // Rain down 28 real sculpted 3D arrows from high altitude (+28m) pointing straight downward!
    const arrowCount = isPreview ? 14 : 28;
    const volleyRad = isPreview ? 1.8 : Math.max(6.0, radiusScale * 0.88);
    const baseDur = flightDurationSec > 0 ? flightDurationSec : 0.48;
    for (let m = 0; m < arrowCount; m++) {
      // Golden-angle spiral distribution so arrows cover the entire target circle evenly
      const frac = (m + 0.5) / arrowCount;
      const rOff = Math.sqrt(frac) * volleyRad;
      const ang = m * 2.3999632;
      const tx = toPos.x + Math.cos(ang) * rOff;
      const tz = toPos.z + Math.sin(ang) * rOff;
      const ty = isPreview ? toPos.y : sampleTerrainMeshHeightMeters(tx, tz, true, 4096);
      const start = new THREE.Vector3(
        tx - (isPreview ? 0.35 : 1.6),
        ty + (isPreview ? 6.5 : 54.0),
        tz - (isPreview ? 0.25 : 1.1)
      );
      const end = new THREE.Vector3(tx, ty + 0.15, tz);
      const arrowMesh = getVolleySculptedArrowMesh(isPreview);
      arrowMesh.position.copy(start);
      arrowMesh.lookAt(end);
      fxGroup.add(arrowMesh);
      activeProjectiles.push({
        mesh: arrowMesh,
        start,
        end,
        arcHeight: 0.0, // Straight steep downward drop so arrowheads point straight down!
        age: -(m % 8) * 0.028,
        duration: baseDur,
        isFireball3D: false,
        impactHex: null,
        impactRadius: 0
      });
    }
    return;
  }

  if (style === 'meteor_rain') {
    const count = 4;
    const baseDur = flightDurationSec > 0 ? flightDurationSec : 0.45;
    for (let m = 0; m < count; m++) {
      const ang = (m / count) * Math.PI * 2;
      const rOff = m === 0 ? 0 : isPreview ? 0.7 : 2.8;
      const tx = toPos.x + Math.cos(ang) * rOff;
      const tz = toPos.z + Math.sin(ang) * rOff;
      const start = new THREE.Vector3(
        tx - (isPreview ? 1.2 : 5.0),
        toPos.y + (isPreview ? 3.2 : 14.0),
        tz - (isPreview ? 0.8 : 3.0)
      );
      const end = new THREE.Vector3(tx, toPos.y, tz);
      const pMesh = new THREE.Mesh(
        new THREE.SphereGeometry(isPreview ? 0.22 : 0.65, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xff4500 })
      );
      pMesh.position.copy(start);
      fxGroup.add(pMesh);
      activeProjectiles.push({
        mesh: pMesh,
        start,
        end,
        arcHeight: 0.12,
        age: -m * 0.03,
        duration: baseDur,
        isFireball3D: true,
        onArrival: () =>
          spawnVolumetric3DFireballExplosion({
            fxGroup,
            activeFxPulses,
            centerPos: end,
            radiusScale: radiusScale * 0.65,
            isPreview
          }),
        impactHex: hex,
        impactRadius: isPreview ? 1.6 : 3.8
      });
    }
    return;
  }

  // ============================================================================
  // 8. DEFAULT SHOCKWAVE RING / WAR CRY ROAR (`shockwave_ring`, `war_cry_roar`)
  // ============================================================================
  const waveMat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.82,
    depthWrite: false
  });
  const torusMesh = new THREE.Mesh(
    new THREE.TorusGeometry(isPreview ? 0.55 : 1.2, isPreview ? 0.07 : 0.18, 10, 32),
    waveMat
  );
  torusMesh.rotation.x = Math.PI * 0.5;
  torusMesh.position.set(toPos.x, toPos.y + 0.35, toPos.z);
  fxGroup.add(torusMesh);
  activeFxPulses.push({
    mesh: torusMesh,
    mat: waveMat,
    age: 0,
    maxAge: 0.72
  });
  addImpactRing(toPos, hex, isPreview ? 2.4 : Math.max(4.2, radiusScale * 0.6), 0.9);
}
