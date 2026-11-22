import { toFx, toFloat } from '../../core/fx.js';

const PATROL_LOOP_CLOSE_RADIUS_METERS = 12.0;

export class OrderQueueEngine {
  constructor() {
    this.companyVisualQueues = new Map();
    this.companyIsMultiStep = new Map();
    this.stagedPatrolPoints = [];
  }

  clearAllForCompanies(companyIds) {
    this.stagedPatrolPoints.length = 0;
    for (const cid of companyIds) {
      const id = cid | 0;
      this.companyVisualQueues.delete(id);
      this.companyIsMultiStep.delete(id);
    }
  }

  clearStagedPatrol() {
    this.stagedPatrolPoints.length = 0;
  }

  hasStagedPatrol() {
    return this.stagedPatrolPoints.length > 0;
  }

  hasActiveVisualOrder(companyId) {
    const q = this.companyVisualQueues.get(companyId | 0);
    return Boolean(q && q.length > 0);
  }

  _hasPatrolInQueue(cid) {
    const q = this.companyVisualQueues.get(cid | 0);
    return Boolean(q && q.some((w) => w.orderType === 'PATROL'));
  }

  _checkAndNormalizePatrolLoopVisuals(patrolItems) {
    if (!Array.isArray(patrolItems) || patrolItems.length < 3) {
      return false;
    }
    const originPt = patrolItems[0];
    const lastPt = patrolItems[patrolItems.length - 1];
    const dist = Math.hypot(lastPt.x - originPt.x, lastPt.z - originPt.z);

    if (dist <= PATROL_LOOP_CLOSE_RADIUS_METERS) {
      if (patrolItems.length >= 4) {
        patrolItems.pop();
      }
      patrolItems[0].isClosedLoop = true;
      return true;
    }

    patrolItems[0].isClosedLoop = false;
    return false;
  }

  enqueueGatherOrder(workerCompanyIds, resourceX, resourceZ, queueShift = false) {
    if (!Array.isArray(workerCompanyIds) || workerCompanyIds.length === 0) return;
    const nowMs = performance.now();

    for (let i = 0; i < workerCompanyIds.length; i++) {
      const cid = workerCompanyIds[i] | 0;
      const wp = {
        orderType: 'GATHER',
        x: resourceX,
        z: resourceZ,
        isGatherOrder: true,
        issuedAt: nowMs
      };

      const interruptedPatrol = this._hasPatrolInQueue(cid);
      if (!queueShift || interruptedPatrol || !this.companyVisualQueues.has(cid)) {
        this.companyVisualQueues.set(cid, [wp]);
        this.companyIsMultiStep.set(cid, Boolean(queueShift && !interruptedPatrol));
      } else {
        const q = this.companyVisualQueues.get(cid);
        q.push(wp);
        this.companyIsMultiStep.set(cid, true);
      }
    }
  }

  enqueueDropoffOrder(workerCompanyIds, campX, campZ, queueShift = false) {
    if (!Array.isArray(workerCompanyIds) || workerCompanyIds.length === 0) return;
    const nowMs = performance.now();

    for (let i = 0; i < workerCompanyIds.length; i++) {
      const cid = workerCompanyIds[i] | 0;
      const wp = {
        orderType: 'GATHER',
        x: campX,
        z: campZ,
        isDropoffOrder: true,
        issuedAt: nowMs
      };

      const interruptedPatrol = this._hasPatrolInQueue(cid);
      if (!queueShift || interruptedPatrol || !this.companyVisualQueues.has(cid)) {
        this.companyVisualQueues.set(cid, [wp]);
        this.companyIsMultiStep.set(cid, Boolean(queueShift && !interruptedPatrol));
      } else {
        const q = this.companyVisualQueues.get(cid);
        q.push(wp);
        this.companyIsMultiStep.set(cid, true);
      }
    }
  }

  enqueueGarrisonOrder(companyIds, towerX, towerZ, queueShift = false) {
    if (!Array.isArray(companyIds) || companyIds.length === 0) return;
    const nowMs = performance.now();

    for (let i = 0; i < companyIds.length; i++) {
      const cid = companyIds[i] | 0;
      const wp = {
        orderType: 'GARRISON',
        x: towerX,
        z: towerZ,
        isGarrisonOrder: true,
        issuedAt: nowMs
      };

      const interruptedPatrol = this._hasPatrolInQueue(cid);
      if (!queueShift || interruptedPatrol || !this.companyVisualQueues.has(cid)) {
        this.companyVisualQueues.set(cid, [wp]);
        this.companyIsMultiStep.set(cid, Boolean(queueShift && !interruptedPatrol));
      } else {
        const q = this.companyVisualQueues.get(cid);
        q.push(wp);
        this.companyIsMultiStep.set(cid, true);
      }
    }
  }

  enqueueBuildOrder(workerCompanyIds, targetX, targetZ, queueShift = false) {
    if (!Array.isArray(workerCompanyIds) || workerCompanyIds.length === 0) return;

    let targetCids = [workerCompanyIds[0]];
    if (workerCompanyIds.length > 1) {
      let bestCid = workerCompanyIds[0];
      let bestLen = Infinity;
      for (let i = 0; i < workerCompanyIds.length; i++) {
        const cid = workerCompanyIds[i];
        const qLen = (this.companyVisualQueues.get(cid) || []).length;
        if (qLen < bestLen) {
          bestLen = qLen;
          bestCid = cid;
        }
      }
      targetCids = [bestCid];
    }

    const nowMs = performance.now();
    for (let i = 0; i < targetCids.length; i++) {
      const cid = targetCids[i] | 0;
      const wp = {
        orderType: 'BUILD',
        x: targetX,
        z: targetZ,
        isBuildOrder: true,
        issuedAt: nowMs
      };

      const interruptedPatrol = this._hasPatrolInQueue(cid);
      if (!queueShift || interruptedPatrol || !this.companyVisualQueues.has(cid)) {
        this.companyVisualQueues.set(cid, [wp]);
        this.companyIsMultiStep.set(cid, Boolean(queueShift && !interruptedPatrol));
      } else {
        const q = this.companyVisualQueues.get(cid);
        q.push(wp);
        this.companyIsMultiStep.set(cid, true);
      }
    }
  }

  stageShiftPatrolPoint(worldPoint, descriptors) {
    this.stagedPatrolPoints.push({ x: worldPoint.x, z: worldPoint.z });
    const nowMs = performance.now();

    for (let i = 0; i < descriptors.length; i++) {
      const compDesc = descriptors[i];
      const cid = compDesc.companyId;
      const existingQueue = this.companyVisualQueues.get(cid) || [];

      const preservedPrefix = existingQueue.filter((item) => !item.isStagedPatrol);
      const patrolOriginX =
        preservedPrefix.length > 0
          ? preservedPrefix[preservedPrefix.length - 1].x
          : compDesc.centerX;
      const patrolOriginZ =
        preservedPrefix.length > 0
          ? preservedPrefix[preservedPrefix.length - 1].z
          : compDesc.centerZ;

      const stagedVisuals = [
        {
          orderType: 'PATROL',
          x: patrolOriginX,
          z: patrolOriginZ,
          isPatrolOrigin: true,
          isClosedLoop: false,
          isStagedPatrol: true,
          issuedAt: nowMs
        }
      ];

      for (let p = 0; p < this.stagedPatrolPoints.length; p++) {
        stagedVisuals.push({
          orderType: 'PATROL',
          x: this.stagedPatrolPoints[p].x,
          z: this.stagedPatrolPoints[p].z,
          isStagedPatrol: true,
          issuedAt: nowMs
        });
      }

      this._checkAndNormalizePatrolLoopVisuals(stagedVisuals);
      this.companyVisualQueues.set(cid, [...preservedPrefix, ...stagedVisuals]);
      this.companyIsMultiStep.set(cid, true);
    }
  }

  consumeStagedPatrolRoute(descriptors) {
    if (this.stagedPatrolPoints.length === 0 || descriptors.length === 0) {
      this.stagedPatrolPoints.length = 0;
      return null;
    }

    const companyIds = descriptors.map((d) => d.companyId);
    const firstPt = this.stagedPatrolPoints[0];
    const pointCount = this.stagedPatrolPoints.length;
    const patrolWaypointsFx = this.stagedPatrolPoints.map((pt) => ({
      xFx: toFx(pt.x),
      zFx: toFx(pt.z)
    }));

    const hasPrecedingMove = descriptors.some((d) => {
      const q = this.companyVisualQueues.get(d.companyId);
      return (
        (q && q.some((item) => item.orderType !== 'PATROL' && !item.isStagedPatrol)) ||
        d.movingCount > 0
      );
    });

    for (const cid of companyIds) {
      const q = this.companyVisualQueues.get(cid);
      if (q) {
        for (let i = 0; i < q.length; i++) {
          q[i].isStagedPatrol = false;
        }
      }
      this.companyIsMultiStep.set(cid, true);
    }

    this.stagedPatrolPoints.length = 0;
    return {
      companyIds,
      firstPt,
      patrolWaypointsFx,
      hasPrecedingMove,
      pointCount
    };
  }

  enqueuePlacementOrders(
    placements,
    descriptors,
    effectiveOrderMode,
    clickedEnemyCompanyId,
    queueShift
  ) {
    const nowMs = performance.now();

    for (let i = 0; i < placements.length; i++) {
      const pl = placements[i];
      const cid = pl.companyId;
      const destX = toFloat(pl.targetXFx);
      const destZ = toFloat(pl.targetZFx);

      const interruptedPatrol =
        effectiveOrderMode !== 'PATROL' && this._hasPatrolInQueue(cid);

      if (!queueShift || interruptedPatrol || !this.companyVisualQueues.has(cid)) {
        const compDesc = descriptors.find((d) => d.companyId === cid);
        const initialQueue = [];
        if (effectiveOrderMode === 'PATROL' && compDesc) {
          initialQueue.push({
            orderType: 'PATROL',
            x: compDesc.centerX,
            z: compDesc.centerZ,
            isPatrolOrigin: true,
            isClosedLoop: false,
            issuedAt: nowMs
          });
        }
        initialQueue.push({
          orderType: effectiveOrderMode,
          x: destX,
          z: destZ,
          targetEnemyCompanyId: clickedEnemyCompanyId,
          issuedAt: nowMs
        });
        this.companyVisualQueues.set(cid, initialQueue);
        this.companyIsMultiStep.set(
          cid,
          effectiveOrderMode === 'PATROL' || Boolean(queueShift && !interruptedPatrol)
        );
      } else {
        const q = this.companyVisualQueues.get(cid);
        if (
          effectiveOrderMode === 'PATROL' &&
          q.length > 0 &&
          q[q.length - 1].orderType !== 'PATROL'
        ) {
          const prevWp = q[q.length - 1];
          q.push({
            orderType: 'PATROL',
            x: prevWp.x,
            z: prevWp.z,
            isPatrolOrigin: true,
            isClosedLoop: false,
            issuedAt: nowMs
          });
        }
        q.push({
          orderType: effectiveOrderMode,
          x: destX,
          z: destZ,
          targetEnemyCompanyId: clickedEnemyCompanyId,
          issuedAt: nowMs
        });

        if (effectiveOrderMode === 'PATROL') {
          const patrolOriginIdx = q.findIndex((item) => item.isPatrolOrigin);
          if (patrolOriginIdx !== -1) {
            const patrolSublist = q.slice(patrolOriginIdx);
            this._checkAndNormalizePatrolLoopVisuals(patrolSublist);
            q.splice(patrolOriginIdx, q.length - patrolOriginIdx, ...patrolSublist);
          }
        }
        this.companyIsMultiStep.set(cid, true);
      }
    }
  }

  _syncWorkerBuildQueuePaths(ecoStates, buildings, nowMs) {
    if (!ecoStates) return;
    let bldById = null;

    for (const [cidStr, st] of Object.entries(ecoStates)) {
      const buildIds = st.buildQueueBuildingIds || [];
      const cid = Number(cidStr);
      const currentQueue = this.companyVisualQueues.get(cid);

      if (buildIds.length === 0 && (!currentQueue || !currentQueue.some((w) => w.isBuildOrder))) {
        continue;
      }

      if (!bldById) {
        bldById = new Map();
        for (let i = 0; i < buildings.length; i++) {
          bldById.set(buildings[i].id, buildings[i]);
        }
      }

      const activeQ = currentQueue || [];
      const firstBuildIdx = activeQ.findIndex((w) => w.isBuildOrder);
      const prefixWaypoints = [];
      const suffixWaypoints = [];
      const existingBuildWaypoints = [];

      for (let i = 0; i < activeQ.length; i++) {
        const w = activeQ[i];
        if (w.isBuildOrder) {
          existingBuildWaypoints.push(w);
        } else if (firstBuildIdx === -1 || i < firstBuildIdx) {
          prefixWaypoints.push(w);
        } else {
          suffixWaypoints.push(w);
        }
      }

      const authoritativeBuildWaypoints = [];
      for (let i = 0; i < buildIds.length; i++) {
        const b = bldById.get(buildIds[i]);
        if (b && b.hp > 0 && (!b.isCompleted || b.hp < b.maxHp)) {
          const prevMatch = existingBuildWaypoints.find(
            (eb) => Math.hypot(eb.x - b.x, eb.z - b.z) < 3.5
          );
          authoritativeBuildWaypoints.push({
            orderType: 'BUILD',
            x: b.x,
            z: b.z,
            isBuildOrder: true,
            issuedAt: prevMatch ? prevMatch.issuedAt : nowMs
          });
        }
      }

      for (let i = 0; i < existingBuildWaypoints.length; i++) {
        const eb = existingBuildWaypoints[i];
        if (nowMs - (eb.issuedAt || 0) < 300) {
          const alreadyPresent = authoritativeBuildWaypoints.some(
            (ab) => Math.hypot(ab.x - eb.x, ab.z - eb.z) < 3.5
          );
          if (!alreadyPresent) {
            authoritativeBuildWaypoints.push(eb);
          }
        }
      }

      const combined = [
        ...prefixWaypoints,
        ...authoritativeBuildWaypoints,
        ...suffixWaypoints
      ];

      if (combined.length > 0) {
        this.companyVisualQueues.set(cid, combined);
        if (combined.length >= 2 || st.returningDropoffBuildingId > 0) {
          this.companyIsMultiStep.set(cid, true);
        }
      } else {
        this.companyVisualQueues.delete(cid);
        this.companyIsMultiStep.delete(cid);
      }
    }
  }

  syncAndBuildSegments({
    selectedCompanyIds,
    friendlyMap,
    entities,
    ecoStates,
    buildings,
    nowMs
  }) {
    this._syncWorkerBuildQueuePaths(ecoStates, buildings || [], nowMs);

    if (
      !selectedCompanyIds ||
      selectedCompanyIds.size === 0 ||
      this.companyVisualQueues.size === 0
    ) {
      return [];
    }

    const bldById = new Map();
    if (Array.isArray(buildings)) {
      for (let i = 0; i < buildings.length; i++) {
        bldById.set(buildings[i].id, buildings[i]);
      }
    }

    const enemyCompanyCenters = new Map();
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (ent.team === 1 || ent.hp <= 0 || ent.isGarrisoned) continue;
      const cid = ent.companyId ?? 0;
      if (!enemyCompanyCenters.has(cid)) {
        enemyCompanyCenters.set(cid, { sumX: 0, sumZ: 0, count: 0 });
      }
      const ec = enemyCompanyCenters.get(cid);
      ec.sumX += ent.x;
      ec.sumZ += ent.z;
      ec.count++;
    }

    for (const [cid, queue] of Array.from(this.companyVisualQueues.entries())) {
      const comp = friendlyMap.get(cid);
      if (!comp || !queue || queue.length === 0) {
        this.companyVisualQueues.delete(cid);
        this.companyIsMultiStep.delete(cid);
        continue;
      }

      if (queue.length >= 2) {
        this.companyIsMultiStep.set(cid, true);
      }

      const cState = ecoStates?.[cid];
      const hasActiveSimBuilds = Boolean(cState?.buildQueueBuildingIds?.length > 0);
      const isPatrolHead = queue[0].orderType === 'PATROL';
      const isBuildHead = Boolean(queue[0].isBuildOrder);

      while (queue.length > 0 && queue[0].targetEnemyCompanyId !== null && queue[0].targetEnemyCompanyId !== undefined) {
        const ec = enemyCompanyCenters.get(queue[0].targetEnemyCompanyId);
        if (ec && ec.count > 0) { queue[0].targetSeen = true; break; }
        if (queue[0].targetSeen) queue.shift();
        else break;
      }
      if (queue.length === 0) {
        this.companyVisualQueues.delete(cid);
        this.companyIsMultiStep.delete(cid);
        continue;
      }

      if (cState && cState.queuedOrders !== undefined && !queue.some((it) => it.orderType === 'PATROL' || it.isBuildOrder || it.isGarrisonOrder || it.isGatherOrder || it.isDropoffOrder)) {
        const simOrder = cState.orderType | 0;
        const simActive = simOrder === 1 || simOrder === 3 || simOrder === 6 ? 1 : 0;
        const allowed = simActive + (cState.queuedOrders | 0);
        const newestAge = nowMs - (queue[queue.length - 1].issuedAt || 0);
        if (newestAge > 500 && queue.length > allowed) {
          queue.splice(0, queue.length - allowed);
          if (queue.length === 0) {
            this.companyVisualQueues.delete(cid);
            this.companyIsMultiStep.delete(cid);
            continue;
          }
        }
      }

      if (!isPatrolHead && !isBuildHead) {
        const distLeader = Math.hypot(comp.leaderX - queue[0].x, comp.leaderZ - queue[0].z);
        const distCenter = Math.hypot(comp.centerX - queue[0].x, comp.centerZ - queue[0].z);
        const minReachDist = Math.min(distLeader, distCenter);
        const reachThreshold = queue[0].isDropoffOrder
          ? 7.2
          : queue[0].isGatherOrder
            ? 6.2
            : queue[0].isGarrisonOrder
              ? 6.8
              : 5.5;

        const hasFollowUpAfterGather = queue[0].isGatherOrder && queue.length > 1;

        if (
          (!hasFollowUpAfterGather && minReachDist <= reachThreshold) ||
          (queue[0].isGatherOrder &&
            !hasFollowUpAfterGather &&
            cState?.isWorking &&
            nowMs - (queue[0].issuedAt || 0) > 350) ||
          (hasFollowUpAfterGather &&
            cState?.gatherState === 3 &&
            nowMs - (queue[0].issuedAt || 0) > 350) ||
          (hasFollowUpAfterGather &&
            cState?.gatherState === 0 &&
            minReachDist <= reachThreshold + 1.5 &&
            nowMs - (queue[0].issuedAt || 0) > 350)
        ) {
          queue.shift();
          if (queue.length === 0) {
            this.companyVisualQueues.delete(cid);
            this.companyIsMultiStep.delete(cid);
            continue;
          }
        }

        const hasPersistentTail =
          hasActiveSimBuilds ||
          (cState?.gatherState || 0) > 0 ||
          queue.some(
            (item) =>
              item.orderType === 'PATROL' ||
              item.isBuildOrder ||
              item.isGarrisonOrder ||
              item.isGatherOrder ||
              item.isDropoffOrder
          );
        const newestIssueTime = queue[queue.length - 1]?.issuedAt || 0;
        if (
          !hasPersistentTail &&
          comp.movingCount === 0 &&
          (cState?.orderType || 0) === 0 &&
          !cState?.isWorking &&
          nowMs - newestIssueTime > 650
        ) {
          this.companyVisualQueues.delete(cid);
          this.companyIsMultiStep.delete(cid);
          continue;
        }
      }
    }

    const segments = [];

    for (const cid of selectedCompanyIds) {
      const comp = friendlyMap.get(cid);
      const queue = this.companyVisualQueues.get(cid);
      if (!comp || !queue || queue.length === 0) continue;

      const cState = ecoStates?.[cid];
      const returningDropoffId = cState?.returningDropoffBuildingId ?? -1;

      const isMultiStep =
        Boolean(this.companyIsMultiStep.get(cid)) ||
        queue.length >= 2 ||
        returningDropoffId > 0;

      if (!isMultiStep && queue.length === 1 && queue[0].orderType !== 'PATROL') {
        continue;
      }

      let prevX = comp.leaderX ?? comp.centerX;
      let prevZ = comp.leaderZ ?? comp.centerZ;
      let firstPatrolOrigin = null;

      if (returningDropoffId > 0) {
        const dropoffBld = bldById.get(returningDropoffId);
        const headAlreadyAtDropoff =
          dropoffBld &&
          Math.hypot(queue[0].x - dropoffBld.x, queue[0].z - dropoffBld.z) < 3.5;

        if (
          dropoffBld &&
          !headAlreadyAtDropoff &&
          Math.hypot(dropoffBld.x - prevX, dropoffBld.z - prevZ) > 2.5
        ) {
          segments.push({
            fromX: prevX,
            fromZ: prevZ,
            toX: dropoffBld.x,
            toZ: dropoffBld.z,
            orderType: 'GATHER',
            dashSize: 1.4,
            gapSize: 0.9,
            opacity: 0.92
          });
          prevX = dropoffBld.x;
          prevZ = dropoffBld.z;
        }
      }

      for (let q = 0; q < queue.length; q++) {
        const wp = queue[q];
        if (wp.isPatrolOrigin) {
          firstPatrolOrigin = wp;
          if (q === 0) {
            prevX = wp.x;
            prevZ = wp.z;
            continue;
          }
        }

        if (wp.targetEnemyCompanyId !== null && wp.targetEnemyCompanyId !== undefined) {
          const ec = enemyCompanyCenters.get(wp.targetEnemyCompanyId);
          if (ec && ec.count > 0) {
            wp.x = ec.sumX / ec.count;
            wp.z = ec.sumZ / ec.count;
          }
        }

        segments.push({
          fromX: prevX,
          fromZ: prevZ,
          toX: wp.x,
          toZ: wp.z,
          orderType: wp.orderType,
          dashSize: 1.4,
          gapSize: 0.9,
          opacity: 0.92
        });

        prevX = wp.x;
        prevZ = wp.z;
      }

      if (
        firstPatrolOrigin &&
        firstPatrolOrigin.isClosedLoop &&
        queue[queue.length - 1].orderType === 'PATROL'
      ) {
        segments.push({
          fromX: prevX,
          fromZ: prevZ,
          toX: firstPatrolOrigin.x,
          toZ: firstPatrolOrigin.z,
          orderType: 'PATROL',
          dashSize: 1.2,
          gapSize: 0.9,
          opacity: 0.85
        });
      }
    }

    return segments;
  }
}