/**
 * Kings Lands — Phase 6.9: Unit Boids, Hard Building Obstacle Collisions & Tangential Avoidance
 * (src/sim/systems/unitCollisionSystem.js)
 */

import {
  FX_ONE,
  mulDiv,
  fxAbs,
  fxClamp,
  fxHypot
} from '../../core/fx.js';

const COMPASS_DIRS_FX = Object.freeze([
  { dxFx: 1024, dzFx: 0 },
  { dxFx: 724, dzFx: 724 },
  { dxFx: 0, dzFx: 1024 },
  { dxFx: -724, dzFx: 724 },
  { dxFx: -1024, dzFx: 0 },
  { dxFx: -724, dzFx: -724 },
  { dxFx: 0, dzFx: -1024 },
  { dxFx: 724, dzFx: -724 }
]);

export class UnitCollisionSystem {
  constructor(spatialHash, navGrid, getPhysicsProfileFn) {
    this.spatialHash = spatialHash;
    this.navGrid = navGrid;
    this.getPhysicsProfile = getPhysicsProfileFn;

    this._neighborScratch = [];
    this._escapeScratch = [];
    this._deltaXFx = new Map();
    this._deltaZFx = new Map();
    this._overlapCount = new Map();
  }

  _isFrontlineFighter(ent, comp) {
    if (!ent) return false;
    if (comp && comp.isWorking && !ent.isMoving) return true;
    if ((ent.windupTicks | 0) > 0) return true;
    if ((ent.shotWindupTicks | 0) > 0 && !ent.isMoving) return true;
    if ((ent.windupBuildingId | 0) > 0 && !ent.isMoving) return true;
    if (ent.reservedTargetId > 0 && !ent.isMoving) return true;
    if ((ent.actionCooldown | 0) > 0 && !ent.isMoving && !ent.inCombatStandby) return true;
    return false;
  }

  _isCombatAnchored(ent, comp) {
    if (!ent) return false;
    if (this._isFrontlineFighter(ent, comp)) return true;
    if (ent.inCombatStandby) return true;
    return false;
  }

  computeBuildingAvoidanceSteerFx(
    xFx,
    zFx,
    unitRadiusFx,
    seekVxFx,
    seekVzFx,
    distToGoalFx,
    buildingsMap,
    sortedBuildingIds,
    ignoreBuildingId = -1
  ) {
    if (!buildingsMap || !sortedBuildingIds || distToGoalFx <= 256) {
      return { vxFx: seekVxFx, vzFx: seekVzFx };
    }

    let closestBlockingBld = null;
    let closestForwardProj = 0x7fffffff;
    let closestAvoidRadFx = 0;
    let closestSignedPerp = 0;

    for (let i = 0; i < sortedBuildingIds.length; i++) {
      const b = buildingsMap.get(sortedBuildingIds[i]);
      if (
        !b ||
        b.isDestroyed ||
        b.type === 'citadel_slot' ||
        b.hp <= 0 ||
        b.id === ignoreBuildingId
      ) {
        continue;
      }

      const footprintFx = Math.round((b.footprintRadiusMeters || 4) * FX_ONE) | 0;
      const avoidRadFx = (footprintFx + (unitRadiusFx || 620) + 820) | 0;
      const maxLookAheadFx = Math.min(distToGoalFx, (avoidRadFx + 5 * FX_ONE) | 0);

      const relX = (b.xFx - xFx) | 0;
      const relZ = (b.zFx - zFx) | 0;
      if (fxAbs(relX) > maxLookAheadFx && fxAbs(relZ) > maxLookAheadFx) continue;

      const forwardProjFx =
        (mulDiv(relX, seekVxFx, FX_ONE) + mulDiv(relZ, seekVzFx, FX_ONE)) | 0;
      if (forwardProjFx < -512 || forwardProjFx > maxLookAheadFx) continue;

      const signedPerpFx =
        (mulDiv(relX, -seekVzFx, FX_ONE) + mulDiv(relZ, seekVxFx, FX_ONE)) | 0;
      const absPerpFx = fxAbs(signedPerpFx);

      if (absPerpFx < avoidRadFx && forwardProjFx < closestForwardProj) {
        closestForwardProj = forwardProjFx;
        closestBlockingBld = b;
        closestAvoidRadFx = avoidRadFx;
        closestSignedPerp = signedPerpFx;
      }
    }

    if (!closestBlockingBld) {
      return { vxFx: seekVxFx, vzFx: seekVzFx };
    }

    const fromBldX = (xFx - closestBlockingBld.xFx) | 0;
    const fromBldZ = (zFx - closestBlockingBld.zFx) | 0;
    const distFromBld = Math.max(1, fxHypot(fromBldX, fromBldZ));

    const radialX = mulDiv(fromBldX, FX_ONE, distFromBld);
    const radialZ = mulDiv(fromBldZ, FX_ONE, distFromBld);

    const tan1X = -radialZ;
    const tan1Z = radialX;
    const tan2X = radialZ;
    const tan2Z = -radialX;

    const dot1 = (mulDiv(tan1X, seekVxFx, FX_ONE) + mulDiv(tan1Z, seekVzFx, FX_ONE)) | 0;
    const dot2 = (mulDiv(tan2X, seekVxFx, FX_ONE) + mulDiv(tan2Z, seekVzFx, FX_ONE)) | 0;

    let chosenTanX = dot1 >= dot2 ? tan1X : tan2X;
    let chosenTanZ = dot1 >= dot2 ? tan1Z : tan2Z;
    if (fxAbs(dot1 - dot2) < 80) {
      chosenTanX = closestSignedPerp >= 0 ? tan2X : tan1X;
      chosenTanZ = closestSignedPerp >= 0 ? tan2Z : tan1Z;
    }

    let steerX = chosenTanX;
    let steerZ = chosenTanZ;
    if (distFromBld < closestAvoidRadFx) {
      steerX = (chosenTanX + (radialX >> 1)) | 0;
      steerZ = (chosenTanZ + (radialZ >> 1)) | 0;
    }

    const mag = Math.max(1, fxHypot(steerX, steerZ));
    return {
      vxFx: mulDiv(steerX, FX_ONE, mag),
      vzFx: mulDiv(steerZ, FX_ONE, mag)
    };
  }

  clampPointOutsideBuildingsFx(xFx, zFx, clearanceMarginFx, buildingsMap, sortedBuildingIds) {
    if (!buildingsMap || !sortedBuildingIds) return { xFx, zFx };
    let outX = xFx | 0;
    let outZ = zFx | 0;

    for (let i = 0; i < sortedBuildingIds.length; i++) {
      const b = buildingsMap.get(sortedBuildingIds[i]);
      if (!b || b.isDestroyed || b.type === 'citadel_slot' || b.hp <= 0) continue;

      const footprintFx = Math.round((b.footprintRadiusMeters || 4) * FX_ONE) | 0;
      const minClearFx = (footprintFx + (clearanceMarginFx || 800)) | 0;

      let dx = (outX - b.xFx) | 0;
      let dz = (outZ - b.zFx) | 0;
      if (fxAbs(dx) >= minClearFx || fxAbs(dz) >= minClearFx) continue;

      let d = fxHypot(dx, dz);
      if (d < minClearFx) {
        if (d === 0) {
          dx = FX_ONE;
          dz = 0;
          d = FX_ONE;
        }
        outX = (b.xFx + mulDiv(dx, minClearFx, d)) | 0;
        outZ = (b.zFx + mulDiv(dz, minClearFx, d)) | 0;
      }
    }

    return { xFx: outX, zFx: outZ };
  }

  computeBoidsSeparationFx(ent, prof, entitiesMap) {
    const queryRadiusFx = (prof.radiusFx * 3) | 0;
    const neighborIds = this.spatialHash.queryRadiusIds(
      ent.x,
      ent.z,
      queryRadiusFx,
      entitiesMap,
      this._neighborScratch,
      -1,
      false
    );

    const toGoalX = (ent.targetX - ent.x) | 0;
    const toGoalZ = (ent.targetZ - ent.z) | 0;
    const distToGoal = fxHypot(toGoalX, toGoalZ);

    let sepX = 0;
    let sepZ = 0;
    let count = 0;

    for (let i = 0; i < neighborIds.length; i++) {
      const otherId = neighborIds[i];
      if (otherId === ent.id) continue;
      const other = entitiesMap.get(otherId);
      if (!other || other.hp <= 0 || other.isGarrisoned) continue;

      const otherProf = this.getPhysicsProfile(other.unitTypeIdx);
      const sameCompany = ent.squadIndex === other.squadIndex;
      const comp = entitiesMap.companies?.get(ent.squadIndex);
      const isTightFormation =
        comp &&
        (comp.formation === 'spearWall' ||
          comp.formation === 'shieldWall' ||
          comp.formation === 'pikePhalanx');
      const desiredSpaceFx = sameCompany
        ? (prof.radiusFx + otherProf.radiusFx + (isTightFormation ? 80 : 280)) | 0
        : (prof.radiusFx + otherProf.radiusFx + 480) | 0;

      let dx = (ent.x - other.x) | 0;
      let dz = (ent.z - other.z) | 0;
      let dist = fxHypot(dx, dz);

      if (dist >= desiredSpaceFx) continue;
      if (dist === 0) {
        const sign = ent.id < other.id ? 1 : -1;
        dx = (sign * 64) | 0;
        dz = (-sign * 64) | 0;
        dist = 90;
      }

      const overlapStrength = mulDiv(desiredSpaceFx - dist, FX_ONE, desiredSpaceFx);
      const massWeight = FX_ONE;
      const weight = mulDiv(overlapStrength, massWeight, FX_ONE);

      const dirX = mulDiv(dx, FX_ONE, dist);
      const dirZ = mulDiv(dz, FX_ONE, dist);

      sepX = (sepX + mulDiv(dirX, weight, FX_ONE)) | 0;
      sepZ = (sepZ + mulDiv(dirZ, weight, FX_ONE)) | 0;

      // Tangential sidestep ONLY when the unit is marching toward a goal further than 2.4m away!
      // Applying tangential sidestep when already near the goal (`distToGoal <= 2450`) causes the unit
      // to orbit in circles around a stationary squadmate standing near its slot!
      if (ent.isMoving && !other.isMoving && ent.team === other.team && distToGoal > 2450) {
        const cross = Math.imul(dirX, toGoalZ) - Math.imul(dirZ, toGoalX);
        const sideSign = cross > 0 ? 1 : cross < 0 ? -1 : ((ent.id & 1) ? 1 : -1);
        const tanX = (-dirZ * sideSign) | 0;
        const tanZ = (dirX * sideSign) | 0;
        const tanWeight = (weight * 3) >> 2;
        sepX = (sepX + mulDiv(tanX, tanWeight, FX_ONE)) | 0;
        sepZ = (sepZ + mulDiv(tanZ, tanWeight, FX_ONE)) | 0;
      }

      count = (count + 1) | 0;
    }

    if (count === 0) return { vxFx: 0, vzFx: 0 };
    const mag = fxHypot(sepX, sepZ);
    if (mag > FX_ONE) {
      sepX = mulDiv(sepX, FX_ONE, mag);
      sepZ = mulDiv(sepZ, FX_ONE, mag);
    }
    return { vxFx: sepX, vzFx: sepZ };
  }

  _computeOpenSpaceEscapeImpulseFx(ent, entitiesMap, worldMinFx, worldMaxFx) {
    const probeDistFx = (3 * FX_ONE) | 0;
    const densityRadiusFx = (2 * FX_ONE) | 0;

    let bestDir = null;
    let bestDensityScore = 0x7fffffff;
    const startIdx = (ent.id * 3) & 7;

    for (let k = 0; k < 8; k++) {
      const dirIdx = (startIdx + k) & 7;
      const dir = COMPASS_DIRS_FX[dirIdx];
      const probeXFx = fxClamp(
        (ent.x + ((dir.dxFx * probeDistFx) >> 10)) | 0,
        worldMinFx,
        worldMaxFx
      );
      const probeZFx = fxClamp(
        (ent.z + ((dir.dzFx * probeDistFx) >> 10)) | 0,
        worldMinFx,
        worldMaxFx
      );

      if (!this.navGrid.isWalkableWorldFx(probeXFx, probeZFx)) continue;

      const nearby = this.spatialHash.queryRadiusIds(
        probeXFx,
        probeZFx,
        densityRadiusFx,
        entitiesMap,
        this._escapeScratch,
        -1,
        false
      );

      const score = (nearby.length * 100) | 0;
      if (score < bestDensityScore) {
        bestDensityScore = score;
        bestDir = dir;
        if (score <= 0) break;
      }
    }

    if (!bestDir) return { vxFx: 0, vzFx: 0 };
    return {
      vxFx: (bestDir.dxFx * 240) >> 10,
      vzFx: (bestDir.dzFx * 240) >> 10
    };
  }

  resolveBuildingCollisions(
    entitiesMap,
    sortedIds,
    buildingsMap,
    sortedBuildingIds,
    worldMinFx,
    worldMaxFx
  ) {
    if (!buildingsMap || !sortedBuildingIds || sortedBuildingIds.length === 0) return;

    for (let bIdx = 0; bIdx < sortedBuildingIds.length; bIdx++) {
      const b = buildingsMap.get(sortedBuildingIds[bIdx]);
      if (!b || b.isDestroyed || b.type === 'citadel_slot' || b.hp <= 0) continue;

      const footprintFx = Math.round((b.footprintRadiusMeters || 4) * FX_ONE) | 0;
      const queryRadFx = (footprintFx + 2 * FX_ONE) | 0;

      const nearbyUnitIds = this.spatialHash.queryRadiusIds(
        b.xFx,
        b.zFx,
        queryRadFx,
        entitiesMap,
        this._neighborScratch,
        -1,
        false
      );

      for (let i = 0; i < nearbyUnitIds.length; i++) {
        const ent = entitiesMap.get(nearbyUnitIds[i]);
        if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;

        const prof = this.getPhysicsProfile(ent.unitTypeIdx);
        const minClearFx = (footprintFx + (prof.radiusFx || 600) + 180) | 0;

        let dx = (ent.x - b.xFx) | 0;
        let dz = (ent.z - b.zFx) | 0;
        let dist = fxHypot(dx, dz);

        if (dist < minClearFx) {
          if (dist === 0) {
            const dirSeed = COMPASS_DIRS_FX[ent.id & 7];
            dx = dirSeed.dxFx;
            dz = dirSeed.dzFx;
            dist = Math.max(1, fxHypot(dx, dz));
          }

          const pushedX = fxClamp(
            (b.xFx + mulDiv(dx, minClearFx, dist)) | 0,
            worldMinFx,
            worldMaxFx
          );
          const pushedZ = fxClamp(
            (b.zFx + mulDiv(dz, minClearFx, dist)) | 0,
            worldMinFx,
            worldMaxFx
          );

          if (this.navGrid.isWalkableWorldFx(pushedX, pushedZ)) {
            ent.x = pushedX;
            ent.z = pushedZ;
            ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
          }

          const tDx = (ent.targetX - b.xFx) | 0;
          const tDz = (ent.targetZ - b.zFx) | 0;
          const tDist = fxHypot(tDx, tDz);
          if (tDist < minClearFx) {
            ent.targetX = ent.x;
            ent.targetZ = ent.z;
          }
          if (typeof ent.slotTargetXFx === 'number' && typeof ent.slotTargetZFx === 'number') {
            const sDx = (ent.slotTargetXFx - b.xFx) | 0;
            const sDz = (ent.slotTargetZFx - b.zFx) | 0;
            if (fxHypot(sDx, sDz) < minClearFx) {
              ent.slotTargetXFx = ent.x;
              ent.slotTargetZFx = ent.z;
            }
          }
        }
      }
    }
  }

  resolveMassCollisions(
    entitiesMap,
    sortedIds,
    worldMinFx,
    worldMaxFx,
    buildingsMap = null,
    sortedBuildingIds = null
  ) {
    this.spatialHash.rebuild(entitiesMap, sortedIds);

    const companiesMap = entitiesMap.companies;
    const len = sortedIds.length;

    for (let i = 0; i < len; i++) {
      const ent = entitiesMap.get(sortedIds[i]);
      if (ent) {
        ent._pushXFx = 0;
        ent._pushZFx = 0;
        ent._crossOverlaps = 0;
      }
    }

    for (let i = 0; i < len; i++) {
      const idA = sortedIds[i];
      const entA = entitiesMap.get(idA);
      if (!entA || entA.hp <= 0 || entA.isGarrisoned) continue;

      const compA = companiesMap?.get(entA.squadIndex);
      if (compA && compA.isWorking && !entA.isMoving) continue;

      const profA = this.getPhysicsProfile(entA.unitTypeIdx);
      const searchRadFx = (profA.radiusFx + 1200) | 0;
      const neighbors = this.spatialHash.queryRadiusIds(
        entA.x,
        entA.z,
        searchRadFx,
        entitiesMap,
        this._neighborScratch,
        -1,
        false
      );

      for (let j = 0; j < neighbors.length; j++) {
        const idB = neighbors[j];
        if (idB <= idA) continue;
        const entB = entitiesMap.get(idB);
        if (!entB || entB.hp <= 0 || entB.isGarrisoned) continue;

        const compB = companiesMap?.get(entB.squadIndex);
        if (compB && compB.isWorking && !entB.isMoving) continue;

        const profB = this.getPhysicsProfile(entB.unitTypeIdx);
        const sameCompanyCheck = entA.squadIndex === entB.squadIndex;
        const tightA =
          compA &&
          (compA.formation === 'spearWall' ||
            compA.formation === 'shieldWall' ||
            compA.formation === 'pikePhalanx');
        const extraSepFx = sameCompanyCheck
          ? (tightA ? 60 : 210)
          : (entA.team === entB.team ? 340 : 20);
        const minDistFx = (profA.radiusFx + profB.radiusFx + extraSepFx) | 0;

        let dx = (entB.x - entA.x) | 0;
        let dz = (entB.z - entA.z) | 0;
        if (fxAbs(dx) >= minDistFx || fxAbs(dz) >= minDistFx) continue;
        let dist = fxHypot(dx, dz);

        if (dist >= minDistFx) continue;
        if (dist === 0) {
          const angleSeed = (idA * 17 + idB * 31) & 7;
          const seedDir = COMPASS_DIRS_FX[angleSeed];
          dx = (seedDir.dxFx >> 3) | 0;
          dz = (seedDir.dzFx >> 3) | 0;
          dist = Math.max(1, fxHypot(dx, dz));
        }

        const frontlineA = this._isFrontlineFighter(entA, compA);
        const frontlineB = this._isFrontlineFighter(entB, compB);
        const anchoredA = frontlineA || Boolean(entA.inCombatStandby);
        const anchoredB = frontlineB || Boolean(entB.inCombatStandby);

        const sameCompany = entA.squadIndex === entB.squadIndex;
        if (!sameCompany && !anchoredA && !anchoredB) {
          entA._crossOverlaps = ((entA._crossOverlaps | 0) + 1) | 0;
          entB._crossOverlaps = ((entB._crossOverlaps | 0) + 1) | 0;
        }

        const overlapFx = (minDistFx - dist) | 0;

        const aActivelyTransiting = Boolean(
          entA.isMoving &&
            ((compA && compA.isActivelyMoving()) ||
              !sameCompany ||
              fxHypot((entA.targetX - entA.x) | 0, (entA.targetZ - entA.z) | 0) > 2250)
        );
        const bActivelyTransiting = Boolean(
          entB.isMoving &&
            ((compB && compB.isActivelyMoving()) ||
              !sameCompany ||
              fxHypot((entB.targetX - entB.x) | 0, (entB.targetZ - entB.z) | 0) > 2250)
        );

        const waitingA = (entA.trafficWaitTicks | 0) > 0;
        const waitingB = (entB.trafficWaitTicks | 0) > 0;

        let shareAPermille = 500;
        let lateralDirXFx = 0;
        let lateralDirZFx = 0;
        let useLateralYieldOnA = false;
        let useLateralYieldOnB = false;
        let effectiveOverlapFx = overlapFx;

        if (frontlineA && !frontlineB) {
          shareAPermille = 0;
        } else if (!frontlineA && frontlineB) {
          shareAPermille = 1000;
        } else if (anchoredA && !anchoredB) {
          shareAPermille = 0;
        } else if (!anchoredA && anchoredB) {
          shareAPermille = 1000;
        } else if (waitingA && !waitingB) {
          shareAPermille = 150;
        } else if (!waitingA && waitingB) {
          shareAPermille = 850;
        } else if (aActivelyTransiting && !entB.isMoving) {
          if (entA.team === entB.team && sameCompany) {
            effectiveOverlapFx = (overlapFx >> 2) | 0;
            shareAPermille = 1000;
          } else if (entA.team === entB.team && !sameCompany) {
            const homeBX = typeof entB.slotTargetXFx === "number" ? entB.slotTargetXFx : entB.targetX;
            const homeBZ = typeof entB.slotTargetZFx === "number" ? entB.slotTargetZFx : entB.targetZ;
            const dispBFx = fxHypot((entB.x - homeBX) | 0, (entB.z - homeBZ) | 0);
            const mDx = (entA.targetX - entA.x) | 0;
            const mDz = (entA.targetZ - entA.z) | 0;
            const mLen = fxHypot(mDx, mDz);
            if (mLen > 64) {
              const mVx = mulDiv(mDx, FX_ONE, mLen);
              const mVz = mulDiv(mDz, FX_ONE, mLen);
              const crossSide = Math.imul(dx, mVz) - Math.imul(dz, mVx);
              const sideSign = crossSide > 0 ? -1 : crossSide < 0 ? 1 : ((entB.id & 1) ? 1 : -1);
              lateralDirXFx = (-mVz * sideSign) | 0;
              lateralDirZFx = (mVx * sideSign) | 0;
              entB.yieldVxFx = lateralDirXFx;
              entB.yieldVzFx = lateralDirZFx;
              useLateralYieldOnB = true;
            }
            entB.yieldTicks = Math.max(entB.yieldTicks | 0, 10);
            entB.settled = 0;
            entB.atSlot = 0;
            if (dispBFx >= 1950) {
              shareAPermille = 1000;
              effectiveOverlapFx = (overlapFx >> 2) | 0;
            } else {
              shareAPermille = 140;
            }
          } else {
            // Enemy contact: stationary standing defender holds its ground (880/120), unless knocked down on the ground!
            if ((entB.knockdownTicks | 0) > 0 && (entA.chargeMomentumPermille | 0) >= 250) {
              effectiveOverlapFx = (overlapFx >> 2) | 0;
              shareAPermille = 150;
            } else {
              shareAPermille = 880;
            }
          }
        } else if (!entA.isMoving && bActivelyTransiting) {
          if (entA.team === entB.team && sameCompany) {
            effectiveOverlapFx = (overlapFx >> 2) | 0;
            shareAPermille = 0;
          } else if (entA.team === entB.team && !sameCompany) {
            const homeAX = typeof entA.slotTargetXFx === "number" ? entA.slotTargetXFx : entA.targetX;
            const homeAZ = typeof entA.slotTargetZFx === "number" ? entA.slotTargetZFx : entA.targetZ;
            const dispAFx = fxHypot((entA.x - homeAX) | 0, (entA.z - homeAZ) | 0);
            const mDx = (entB.targetX - entB.x) | 0;
            const mDz = (entB.targetZ - entB.z) | 0;
            const mLen = fxHypot(mDx, mDz);
            if (mLen > 64) {
              const mVx = mulDiv(mDx, FX_ONE, mLen);
              const mVz = mulDiv(mDz, FX_ONE, mLen);
              const crossSide = Math.imul(-dx, mVz) - Math.imul(-dz, mVx);
              const sideSign = crossSide > 0 ? -1 : crossSide < 0 ? 1 : ((entA.id & 1) ? 1 : -1);
              lateralDirXFx = (-mVz * sideSign) | 0;
              lateralDirZFx = (mVx * sideSign) | 0;
              entA.yieldVxFx = lateralDirXFx;
              entA.yieldVzFx = lateralDirZFx;
              useLateralYieldOnA = true;
            }
            entA.yieldTicks = Math.max(entA.yieldTicks | 0, 10);
            entA.settled = 0;
            entA.atSlot = 0;
            if (dispAFx >= 1950) {
              shareAPermille = 0;
              effectiveOverlapFx = (overlapFx >> 2) | 0;
            } else {
              shareAPermille = 860;
            }
          } else {
            // Enemy contact: stationary standing defender entA holds its ground (120/880), unless knocked down on the ground!
            if ((entA.knockdownTicks | 0) > 0 && (entB.chargeMomentumPermille | 0) >= 250) {
              effectiveOverlapFx = (overlapFx >> 2) | 0;
              shareAPermille = 850;
            } else {
              shareAPermille = 120;
            }
          }
        } else if (entA.team === entB.team && entA.isMoving && entB.isMoving) {
          const speedA = (entA._lastActualMovedFx ?? entA.speedFx ?? 180) | 0;
          const speedB = (entB._lastActualMovedFx ?? entB.speedFx ?? 180) | 0;
          if (!sameCompany && (profA.isCavalry !== profB.isCavalry || fxAbs(speedA - speedB) >= 45)) {
            // Faster squad (e.g. Cavalry or running infantry) slipping through a slower moving friendly squad:
            // open a lateral lane on the slower unit and reduce overlap resistance so they slip right through!
            effectiveOverlapFx = (overlapFx >> 2) | 0;
            if (speedA >= speedB) {
              shareAPermille = 120;
              const mDx = (entA.targetX - entA.x) | 0;
              const mDz = (entA.targetZ - entA.z) | 0;
              const mLen = fxHypot(mDx, mDz);
              if (mLen > 64) {
                const mVx = mulDiv(mDx, FX_ONE, mLen);
                const mVz = mulDiv(mDz, FX_ONE, mLen);
                const crossSide = Math.imul(dx, mVz) - Math.imul(dz, mVx);
                const sideSign = crossSide > 0 ? -1 : crossSide < 0 ? 1 : ((entB.id & 1) ? 1 : -1);
                lateralDirXFx = (-mVz * sideSign) | 0;
                lateralDirZFx = (mVx * sideSign) | 0;
                useLateralYieldOnB = true;
              }
            } else {
              shareAPermille = 880;
              const mDx = (entB.targetX - entB.x) | 0;
              const mDz = (entB.targetZ - entB.z) | 0;
              const mLen = fxHypot(mDx, mDz);
              if (mLen > 64) {
                const mVx = mulDiv(mDx, FX_ONE, mLen);
                const mVz = mulDiv(mDz, FX_ONE, mLen);
                const crossSide = Math.imul(-dx, mVz) - Math.imul(-dz, mVx);
                const sideSign = crossSide > 0 ? -1 : crossSide < 0 ? 1 : ((entA.id & 1) ? 1 : -1);
                lateralDirXFx = (-mVz * sideSign) | 0;
                lateralDirZFx = (mVx * sideSign) | 0;
                useLateralYieldOnA = true;
              }
            }
          } else {
            if (!sameCompany && ((entA._crossOverlaps | 0) >= 2 || (entB._crossOverlaps | 0) >= 2)) {
              effectiveOverlapFx = (overlapFx >> 2) | 0;
            }
            // Give Right-of-Way to whichever unit is further ahead along their shared movement direction
            const toGoalAx = (entA.targetX - entA.x) | 0;
            const toGoalAz = (entA.targetZ - entA.z) | 0;
            const forwardDot = (Math.imul(dx, toGoalAx) + Math.imul(dz, toGoalAz)) | 0;
            if (forwardDot > 0) {
              shareAPermille = 780;
            } else if (forwardDot < 0) {
              shareAPermille = 220;
            } else {
              shareAPermille = 500;
            }
          }
        } else {
          // Equal 50/50 collision resistance between standing opposing units so cavalry/swordsmen never push standing units around.
          // However, if one unit is already knocked down on the ground ((knockdownTicks | 0) > 0), a charging horse steps past it!
          if (entA.team !== entB.team && ((entA.knockdownTicks | 0) > 0 || (entB.knockdownTicks | 0) > 0)) {
            effectiveOverlapFx = (overlapFx >> 2) | 0;
            shareAPermille = (entA.knockdownTicks | 0) > 0 ? 850 : 150;
          } else if (entA.team === entB.team && sameCompany && (entA.isMoving !== entB.isMoving)) {
            effectiveOverlapFx = (overlapFx >> 2) | 0;
            shareAPermille = entA.isMoving ? 1000 : 0;
          } else {
            shareAPermille = 500;
          }
        }

        const pushAFx = mulDiv(effectiveOverlapFx, shareAPermille, 1000);
        const pushBFx = (effectiveOverlapFx - pushAFx) | 0;

        const nxFx = mulDiv(dx, FX_ONE, dist);
        const nzFx = mulDiv(dz, FX_ONE, dist);

        let dAx = -mulDiv(nxFx, pushAFx, FX_ONE);
        let dAz = -mulDiv(nzFx, pushAFx, FX_ONE);
        let dBx = mulDiv(nxFx, pushBFx, FX_ONE);
        let dBz = mulDiv(nzFx, pushBFx, FX_ONE);

        // Lateral Corridor Parting: push yielding friendly units sideways out of the march line instead of snowplowing them forward!
        if (useLateralYieldOnA) {
          const blendX = ((lateralDirXFx * 4) - nxFx) / 5 | 0;
          const blendZ = ((lateralDirZFx * 4) - nzFx) / 5 | 0;
          dAx = mulDiv(blendX, pushAFx, FX_ONE);
          dAz = mulDiv(blendZ, pushAFx, FX_ONE);
        } else if (useLateralYieldOnB) {
          const blendX = ((lateralDirXFx * 4) + nxFx) / 5 | 0;
          const blendZ = ((lateralDirZFx * 4) + nzFx) / 5 | 0;
          dBx = mulDiv(blendX, pushBFx, FX_ONE);
          dBz = mulDiv(blendZ, pushBFx, FX_ONE);
        }

        entA._pushXFx = ((entA._pushXFx | 0) + dAx) | 0;
        entA._pushZFx = ((entA._pushZFx | 0) + dAz) | 0;
        entB._pushXFx = ((entB._pushXFx | 0) + dBx) | 0;
        entB._pushZFx = ((entB._pushZFx | 0) + dBz) | 0;
      }
    }

    for (let i = 0; i < len; i++) {
      const id = sortedIds[i];
      const ent = entitiesMap.get(id);
      if (!ent || ent.hp <= 0 || ent.isGarrisoned) continue;
      let pushX = ent._pushXFx | 0;
      let pushZ = ent._pushZFx | 0;
      const crossOverlaps = ent._crossOverlaps | 0;

      if (pushX === 0 && pushZ === 0 && crossOverlaps < 4) continue;

      const comp = companiesMap?.get(ent.squadIndex);
      const isFrontline = this._isFrontlineFighter(ent, comp);
      const isAnchored = isFrontline || Boolean(ent.inCombatStandby);

      const isTrafficWaiting = (ent.trafficWaitTicks | 0) > 0;
      const maxPushStep = isFrontline ? 42 : isAnchored ? 90 : isTrafficWaiting ? 48 : 165;
      let clampedPushX = fxClamp(pushX, -maxPushStep, maxPushStep);
      let clampedPushZ = fxClamp(pushZ, -maxPushStep, maxPushStep);

      // Never snap/teleport a unit's position toward slotTargetXFx!
      // Instead, if a non-combat unit is yielding to friendly traffic and is already >= 1.8m from its slot,
      // simply cancel any outward push component so it holds its current position without teleporting!
      const isEngagedInCombat = Boolean(
        ent.hasCombatTarget ||
          (ent.targetEntityId | 0) > 0 ||
          (ent.windupTicks | 0) > 0 ||
          ent.inCombatStandby ||
          (comp && (comp.engagedTargetEntityId > 0 || comp.engagedTargetBuildingId > 0))
      );
      if (
        !isEngagedInCombat &&
        !ent.isMoving &&
        (ent.yieldTicks | 0) > 0 &&
        (!comp || !comp.isActivelyMoving()) &&
        typeof ent.slotTargetXFx === "number" &&
        typeof ent.slotTargetZFx === "number"
      ) {
        const curOffX = (ent.x - ent.slotTargetXFx) | 0;
        const curOffZ = (ent.z - ent.slotTargetZFx) | 0;
        const curOffDist = fxHypot(curOffX, curOffZ);
        if (curOffDist >= 1850) {
          const outwardDot = (Math.imul(curOffX, clampedPushX) + Math.imul(curOffZ, clampedPushZ)) | 0;
          if (outwardDot > 0) {
            clampedPushX = 0;
            clampedPushZ = 0;
          }
        }
      }

      const nextX = fxClamp(ent.x + clampedPushX, worldMinFx, worldMaxFx);
      const nextZ = fxClamp(ent.z + clampedPushZ, worldMinFx, worldMaxFx);

      if (this.navGrid.isWalkableWorldFx(nextX, nextZ)) {
        ent.x = nextX;
        ent.z = nextZ;
        ent.y = this.navGrid.sampleHeightAtWorldFx(ent.x, ent.z);
      }
    }

    if (buildingsMap && sortedBuildingIds) {
      this.resolveBuildingCollisions(
        entitiesMap,
        sortedIds,
        buildingsMap,
        sortedBuildingIds,
        worldMinFx,
        worldMaxFx
      );
    }
  }
}
