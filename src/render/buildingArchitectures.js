/**
 * Kings Lands — Procedural 3D Building Architecture Builders
 * (src/render/buildingArchitectures.js)
 *
 * Extracted from `BuildingModelFactory` in Stage 4.
 * Contains the procedural mesh assemblies for each building type, doorways, and courtyard fences.
 */

import * as THREE from 'three';
import { dataRegistry } from '../data/dataRegistry.js';

export const BUILDINGS_WITH_DOORS = new Set([
  'citadel',
  'gathering_camp',
  'barracks',
  'archery_range',
  'stables',
  'siege_works',
  'watchtower',
  'ballista_tower'
]);

export const STONE_WALL_BUILDINGS = new Set([
  'citadel',
  'barracks',
  'siege_works',
  'blacksmith',
  'watchtower',
  'ballista_tower',
  'banner_house'
]);

export function addCourtyardGateFence(bodyGroup, type, r, mats, doorSign) {
  if (!BUILDINGS_WITH_DOORS.has(type) || type === 'watchtower' || type === 'ballista_tower') {
    return;
  }

  const fenceGroup = new THREE.Group();
  fenceGroup.name = 'CourtyardGateFence';

  const isStone = STONE_WALL_BUILDINGS.has(type);
  const postMat = isStone ? mats.darkStone : mats.darkWood;
  const railMat = isStone ? mats.stone : mats.wood;

  const isWideGate = type === 'stables' || type === 'siege_works' || type === 'citadel';
  const gateHalfW = isWideGate ? 1.95 : 1.45;
  const cornerX = r * 0.56;
  const buildingFrontZ = doorSign * (r * 0.32);
  const gateLineZ = doorSign * (r * 0.78);
  const postH = isStone ? 1.25 : 1.05;

  for (const side of [-1, 1]) {
    const outerX = side * cornerX;
    const innerX = side * gateHalfW;

    const sideDepth = Math.abs(gateLineZ - buildingFrontZ);
    const midZ = (buildingFrontZ + gateLineZ) * 0.5;

    const cornerPost = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, postH, 0.32),
      postMat
    );
    cornerPost.position.set(outerX, postH * 0.5, gateLineZ);
    fenceGroup.add(cornerPost);

    const gatePost = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, postH + 0.3, 0.38),
      postMat
    );
    gatePost.position.set(innerX, (postH + 0.3) * 0.5, gateLineZ);
    fenceGroup.add(gatePost);

    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), mats.gold);
    finial.position.set(innerX, postH + 0.42, gateLineZ);
    fenceGroup.add(finial);

    if (sideDepth > 0.2) {
      if (isStone) {
        const sideWall = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, postH * 0.75, sideDepth),
          railMat
        );
        sideWall.position.set(outerX, postH * 0.38, midZ);
        fenceGroup.add(sideWall);
      } else {
        for (const ry of [0.38, 0.76]) {
          const sideRail = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.12, sideDepth),
            railMat
          );
          sideRail.position.set(outerX, ry, midZ);
          fenceGroup.add(sideRail);
        }
      }
    }

    const frontSpan = Math.abs(outerX - innerX);
    const midX = (outerX + innerX) * 0.5;
    if (frontSpan > 0.2) {
      if (isStone) {
        const frontWall = new THREE.Mesh(
          new THREE.BoxGeometry(frontSpan, postH * 0.75, 0.22),
          railMat
        );
        frontWall.position.set(midX, postH * 0.38, gateLineZ);
        fenceGroup.add(frontWall);
      } else {
        for (const ry of [0.38, 0.76]) {
          const frontRail = new THREE.Mesh(
            new THREE.BoxGeometry(frontSpan, 0.12, 0.1),
            railMat
          );
          frontRail.position.set(midX, ry, gateLineZ);
          fenceGroup.add(frontRail);
        }
      }
    }
  }

  bodyGroup.add(fenceGroup);
}

export function addBuildingDoorway(bodyGroup, r, mats, doorSign, type) {
  const gateGroup = new THREE.Group();
  gateGroup.name = 'UnitSpawnDoorway';

  const isWideCavalryGate = type === 'stables' || type === 'siege_works' || type === 'citadel';
  const isTowerDoor = type === 'watchtower' || type === 'ballista_tower';
  const w = isWideCavalryGate ? 3.1 : isTowerDoor ? 1.5 : 2.1;
  const h = isWideCavalryGate ? 3.0 : isTowerDoor ? 2.15 : 2.45;
  const zPos = doorSign * (r * (isTowerDoor ? 0.68 : 0.78));

  const step = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.24, 1.3), mats.whiteStone);
  step.position.set(0, 0.12, doorSign * (r * (isTowerDoor ? 0.76 : 0.86)));
  gateGroup.add(step);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.36, h, 0.58), mats.darkStone);
    pillar.position.set(side * (w * 0.5 + 0.15), h * 0.5 + 0.12, zPos);
    gateGroup.add(pillar);
  }

  const lintel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.38, 0.68), mats.whiteStone);
  lintel.position.set(0, h + 0.24, zPos);
  gateGroup.add(lintel);

  const keystone = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.76), mats.gold);
  keystone.position.set(0, h + 0.28, zPos);
  gateGroup.add(keystone);

  const recess = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, h - 0.1, 0.26), mats.doorRecess);
  recess.position.set(0, h * 0.5 + 0.12, zPos - doorSign * 0.08);
  gateGroup.add(recess);

  const leaves = {};
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * (w * 0.46), h * 0.5 + 0.12, zPos + doorSign * 0.1);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, h - 0.14, 0.11), mats.darkWood);
    leaf.position.set(-side * (w * 0.22), 0, 0);
    hinge.rotation.y = side * doorSign * 0.18;
    hinge.add(leaf);
    if (side === -1) leaves.doorLeafL = hinge;
    else leaves.doorLeafR = hinge;
  }

  bodyGroup.add(gateGroup);
  return leaves;
}

export function populateArchitectureByType(type, r, mats, body, doorSign) {
  switch (type) {
    case 'citadel_slot': {
      const innerDisc = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.8, r * 0.84, 0.3, 18),
        mats.whiteStone
      );
      innerDisc.position.y = 0.24;
      body.add(innerDisc);

      const goldRing = new THREE.Mesh(new THREE.TorusGeometry(r * 0.65, 0.12, 8, 24), mats.gold);
      goldRing.rotation.x = Math.PI * 0.5;
      goldRing.position.y = 0.4;
      body.add(goldRing);
      break;
    }

    case 'citadel': {
      const baseSlab = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.48, 0.45, r * 1.48),
        mats.darkStone
      );
      baseSlab.position.y = 0.22;
      body.add(baseSlab);

      const keep = new THREE.Mesh(new THREE.BoxGeometry(r * 1.15, 7.4, r * 1.15), mats.whiteStone);
      keep.position.y = 3.9;
      body.add(keep);

      const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(r * 0.92, 3.8, 4), mats.teamRoof);
      keepRoof.position.y = 9.5;
      keepRoof.rotation.y = Math.PI * 0.25;
      body.add(keepRoof);

      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.48, 2.9, 8), mats.gold);
      spire.position.y = 12.0;
      body.add(spire);

      const offsets = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1]
      ];
      for (let i = 0; i < offsets.length; i++) {
        const tx = offsets[i][0] * r * 0.62;
        const tz = offsets[i][1] * r * 0.62;
        const tMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.55, 7.0, 10), mats.stone);
        tMesh.position.set(tx, 3.7, tz);
        body.add(tMesh);

        const tRoof = new THREE.Mesh(new THREE.ConeGeometry(1.75, 2.5, 10), mats.teamRoof);
        tRoof.position.set(tx, 8.4, tz);
        body.add(tRoof);
      }

      const gateHouse = new THREE.Mesh(new THREE.BoxGeometry(3.8, 4.4, 2.4), mats.darkStone);
      gateHouse.position.set(0, 2.4, doorSign * (r * 0.62));
      body.add(gateHouse);
      break;
    }

    case 'stables': {
      const lodge = new THREE.Mesh(new THREE.BoxGeometry(r * 0.72, 5.2, r * 0.92), mats.stone);
      lodge.position.set(-r * 0.42, 2.6, -doorSign * (r * 0.16));
      body.add(lodge);

      const lodgeRoof = new THREE.Mesh(new THREE.ConeGeometry(r * 0.68, 2.9, 4), mats.teamRoof);
      lodgeRoof.position.set(-r * 0.42, 6.65, -doorSign * (r * 0.16));
      lodgeRoof.rotation.y = Math.PI * 0.25;
      body.add(lodgeRoof);

      const wingBackWall = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.18, 3.6, 0.45),
        mats.wood
      );
      wingBackWall.position.set(r * 0.24, 1.8, -doorSign * (r * 0.54));
      body.add(wingBackWall);

      const leanToRoof = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.24, 0.36, r * 0.78),
        mats.thatch
      );
      leanToRoof.position.set(r * 0.24, 3.8, -doorSign * (r * 0.22));
      leanToRoof.rotation.x = doorSign * 0.22;
      body.add(leanToRoof);

      for (let s = 0; s < 5; s++) {
        const sx = -r * 0.25 + s * (r * 0.26);
        const divider = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 3.1, r * 0.64),
          mats.darkWood
        );
        divider.position.set(sx, 1.55, -doorSign * (r * 0.22));
        body.add(divider);
      }

      const trough = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.95), mats.darkStone);
      trough.position.set(r * 0.42, 0.45, doorSign * (r * 0.36));
      body.add(trough);

      for (let h = 0; h < 2; h++) {
        const hayBale = new THREE.Mesh(
          new THREE.CylinderGeometry(0.68, 0.68, 1.15, 10),
          mats.gold
        );
        hayBale.rotation.z = Math.PI * 0.5;
        hayBale.position.set(-r * 0.48 + h * 1.2, 0.68, doorSign * (r * 0.42));
        body.add(hayBale);
      }
      break;
    }

    case 'gathering_camp': {
      const shed = new THREE.Mesh(new THREE.BoxGeometry(r * 1.0, 3.1, r * 0.85), mats.wood);
      shed.position.set(-r * 0.16, 1.55, -doorSign * 0.35);
      body.add(shed);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(r * 1.18, 0.35, r * 1.02), mats.thatch);
      roof.position.set(-r * 0.16, 3.25, -doorSign * 0.35);
      roof.rotation.z = 0.16;
      body.add(roof);

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3 - row; col++) {
          const log = new THREE.Mesh(
            new THREE.CylinderGeometry(0.26, 0.26, 2.2, 8),
            mats.darkWood
          );
          log.rotation.z = Math.PI * 0.5;
          log.position.set(
            r * 0.46,
            0.42 + row * 0.45,
            -doorSign * (0.2 + (col - (2 - row) * 0.5) * 0.55)
          );
          body.add(log);
        }
      }
      break;
    }

    case 'house': {
      const mainWing = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.1, 2.8, r * 0.85),
        mats.whiteStone
      );
      mainWing.position.set(0, 1.4, -doorSign * 0.2);
      body.add(mainWing);

      const mainRoof = new THREE.Mesh(new THREE.ConeGeometry(r * 0.88, 2.2, 4), mats.teamRoof);
      mainRoof.position.set(0, 3.9, -doorSign * 0.2);
      mainRoof.rotation.y = Math.PI * 0.25;
      body.add(mainRoof);

      const porchWing = new THREE.Mesh(
        new THREE.BoxGeometry(r * 0.6, 2.1, r * 0.65),
        mats.wood
      );
      porchWing.position.set(-r * 0.25, 1.05, doorSign * (r * 0.35));
      body.add(porchWing);

      const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.68, 3.8, 0.68), mats.darkStone);
      chimney.position.set(r * 0.38, 3.3, -doorSign * 0.25);
      body.add(chimney);
      break;
    }

    case 'barracks': {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(r * 1.22, 4.1, r * 0.9), mats.stone);
      hall.position.set(0, 2.05, -doorSign * (r * 0.14));
      body.add(hall);

      for (let side = -1; side <= 1; side += 2) {
        const bastion = new THREE.Mesh(
          new THREE.CylinderGeometry(1.15, 1.28, 5.2, 8),
          mats.darkStone
        );
        bastion.position.set(side * (r * 0.56), 2.6, doorSign * (r * 0.24));
        body.add(bastion);

        const bCap = new THREE.Mesh(new THREE.ConeGeometry(1.42, 1.9, 8), mats.teamRoof);
        bCap.position.set(side * (r * 0.56), 6.15, doorSign * (r * 0.24));
        body.add(bCap);
      }

      const dummyPole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 2.0, 6),
        mats.wood
      );
      dummyPole.position.set(r * 0.42, 1.0, doorSign * (r * 0.52));
      body.add(dummyPole);

      const dummyShield = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 0.15, 10),
        mats.teamRoof
      );
      dummyShield.rotation.x = Math.PI * 0.5;
      dummyShield.position.set(r * 0.42, 1.3, doorSign * (r * 0.42));
      body.add(dummyShield);
      break;
    }

    case 'archery_range': {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(r * 1.15, 3.4, r * 0.72), mats.wood);
      hall.position.set(0, 1.7, -doorSign * (r * 0.28));
      body.add(hall);

      const pavilion = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.32, 0.38, r * 0.88),
        mats.teamRoof
      );
      pavilion.position.set(0, 3.55, -doorSign * (r * 0.28));
      body.add(pavilion);

      for (const side of [-1, 1]) {
        const targetDisc = new THREE.Mesh(
          new THREE.CylinderGeometry(0.72, 0.72, 0.2, 14),
          mats.gold
        );
        targetDisc.rotation.x = Math.PI * 0.42;
        targetDisc.position.set(side * (r * 0.48), 1.25, doorSign * (r * 0.4));
        body.add(targetDisc);
      }
      break;
    }

    case 'siege_works': {
      const workshop = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.12, 4.1, r * 0.92),
        mats.darkWood
      );
      workshop.position.set(-r * 0.12, 2.05, -doorSign * 0.25);
      body.add(workshop);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(r * 1.2, 0.42, r * 1.0), mats.iron);
      roof.position.set(-r * 0.12, 4.25, -doorSign * 0.25);
      body.add(roof);

      const craneMast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.35, 6.4, 8),
        mats.wood
      );
      craneMast.position.set(r * 0.48, 3.2, 0);
      body.add(craneMast);

      const craneArm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 4.8), mats.wood);
      craneArm.position.set(r * 0.48, 5.9, doorSign * 1.2);
      craneArm.rotation.x = doorSign * 0.22;
      body.add(craneArm);
      break;
    }

    case 'blacksmith': {
      const smithy = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.05, 3.3, r * 0.95),
        mats.darkStone
      );
      smithy.position.set(-0.35, 1.65, -doorSign * 0.25);
      body.add(smithy);

      const stack = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.95, 5.8, 8),
        mats.stone
      );
      stack.position.set(r * 0.38, 2.9, -doorSign * 0.35);
      body.add(stack);

      const forgeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.65, 8, 8), mats.ember);
      forgeGlow.position.set(r * 0.35, 0.95, doorSign * (r * 0.35));
      body.add(forgeGlow);

      const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 0.55), mats.iron);
      anvil.position.set(-r * 0.25, 0.65, doorSign * (r * 0.48));
      body.add(anvil);
      break;
    }

    case 'watchtower': {
      const wtMaxGar = (dataRegistry.getBuilding('watchtower')?.maxGarrison ?? 2) | 0;
      const baseBlock = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.35, 0.5, r * 1.35),
        mats.darkStone
      );
      baseBlock.position.y = 0.25;
      body.add(baseBlock);

      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.58, r * 0.76, 7.6, 8),
        mats.stone
      );
      shaft.position.y = 3.9;
      body.add(shaft);

      const parapet = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.42, 1.35, r * 1.42),
        mats.darkWood
      );
      parapet.position.y = 8.0;
      body.add(parapet);

      if (wtMaxGar > 0) {
        const slitCount = Math.min(8, wtMaxGar * 2 + 2);
        for (let s = 0; s < slitCount; s++) {
          const ang = (s / slitCount) * Math.PI * 2;
          const slit = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.72, 0.16), mats.doorRecess);
          slit.position.set(Math.sin(ang) * (r * 0.63), 5.2, Math.cos(ang) * (r * 0.63));
          slit.rotation.y = ang;
          body.add(slit);
        }
      }
      const spire = new THREE.Mesh(new THREE.ConeGeometry(r * 1.02, 2.8, 4), mats.teamRoof);
      spire.position.y = 10.0;
      spire.rotation.y = Math.PI * 0.25;
      body.add(spire);
      break;
    }

    case 'ballista_tower': {
      const btMaxGar = (dataRegistry.getBuilding('ballista_tower')?.maxGarrison ?? 0) | 0;
      const baseBlock = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.4, 0.5, r * 1.4),
        mats.darkStone
      );
      baseBlock.position.y = 0.25;
      body.add(baseBlock);

      const bastion = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.78, r * 0.88, 6.4, 8),
        mats.darkStone
      );
      bastion.position.y = 3.3;
      body.add(bastion);

      const deck = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.88, r * 0.82, 0.8, 8),
        mats.stone
      );
      deck.position.y = 6.8;
      body.add(deck);

      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 4.2), mats.wood);
      rail.position.y = 7.6;
      body.add(rail);

      if (btMaxGar > 0) {
        const slitCount = Math.min(8, btMaxGar * 2 + 2);
        for (let s = 0; s < slitCount; s++) {
          const ang = (s / slitCount) * Math.PI * 2;
          const slit = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.68, 0.16), mats.doorRecess);
          slit.position.set(Math.sin(ang) * (r * 0.82), 4.5, Math.cos(ang) * (r * 0.82));
          slit.rotation.y = ang;
          body.add(slit);
        }
      }
      const bowArms = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.28, 0.4), mats.gold);
      bowArms.position.set(0, 7.65, doorSign * 1.4);
      body.add(bowArms);
      break;
    }

    case 'infirmary': {
      const squareCurb = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.25, 0.32, r * 1.25),
        mats.darkStone
      );
      squareCurb.position.y = 0.16;
      body.add(squareCurb);

      const wellWall = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.52, r * 0.58, 1.55, 12),
        mats.whiteStone
      );
      wellWall.position.y = 0.95;
      body.add(wellWall);

      const waterPool = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.44, r * 0.44, 0.2, 12),
        mats.water
      );
      waterPool.position.y = 1.62;
      body.add(waterPool);

      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.18, 3.2, 8),
          mats.darkWood
        );
        post.position.set(sx * (r * 0.48), 2.6, 0);
        body.add(post);
      }

      const crossBeam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, r * 1.1, 8),
        mats.wood
      );
      crossBeam.rotation.z = Math.PI * 0.5;
      crossBeam.position.set(0, 3.4, 0);
      body.add(crossBeam);

      const bucket = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.2, 0.42, 8),
        mats.darkWood
      );
      bucket.position.set(0, 2.2, 0);
      body.add(bucket);

      const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(r * 0.76, 1.85, 4), mats.teamRoof);
      wellRoof.position.y = 4.9;
      wellRoof.rotation.y = Math.PI * 0.25;
      body.add(wellRoof);
      break;
    }

    case 'banner_house':
    default: {
      const squarePedestal = new THREE.Mesh(
        new THREE.BoxGeometry(r * 1.25, 0.9, r * 1.25),
        mats.darkStone
      );
      squarePedestal.position.y = 0.45;
      body.add(squarePedestal);

      const columnShaft = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.3, r * 0.4, 4.8, 10),
        mats.whiteStone
      );
      columnShaft.position.y = 3.3;
      body.add(columnShaft);

      const capital = new THREE.Mesh(
        new THREE.BoxGeometry(r * 0.85, 0.55, r * 0.85),
        mats.gold
      );
      capital.position.y = 5.9;
      body.add(capital);

      const glowingOrb = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 16), mats.orbGlow);
      glowingOrb.position.y = 7.35;
      body.add(glowingOrb);

      const haloRingA = new THREE.Mesh(
        new THREE.TorusGeometry(1.45, 0.09, 8, 28),
        mats.gold
      );
      haloRingA.position.y = 7.35;
      haloRingA.rotation.x = Math.PI * 0.35;
      body.add(haloRingA);

      const haloRingB = new THREE.Mesh(
        new THREE.TorusGeometry(1.45, 0.09, 8, 28),
        mats.gold
      );
      haloRingB.position.y = 7.35;
      haloRingB.rotation.y = Math.PI * 0.35;
      body.add(haloRingB);
      break;
    }
  }
}