/**
 * Kings Lands — Cohesive Multi-Company Tactical Cube & Alt-Relative Formation Layout
 * (src/sim/formations/armyDrag.js)
 *
 * Pure Fixed-Point math (`src/core/fx.js`) — zero floating-point operations.
 *
 * Supports:
 * 1. Normal Click / Drag (`preserveRelative = false`):
 *    - Automatically wraps large selections into a compact tactical cube/block (max 3-4 companies per row
 *      on a normal click, or scaled dynamically by drag line width when dragging).
 *    - Cavalry wings wrap into neat ranks on the Left and Right flanks instead of stretching infinitely.
 * 2. Alt + Right-Click (`preserveRelative = true`, no drag):
 *    - Rigid translation of the exact current relative formation and individual company facing directions.
 * 3. Alt + Right-Click + Drag (`preserveRelative = true`, with drag):
 *    - Preserves the exact relative positions of all selected companies and rotates the entire group
 *      around the click center to face the direction of the unified command arrow.
 */

import {
  FX_ONE,
  ANGLE_MASK,
  ANGLE_QUARTER,
  mulDiv,
  fxClamp,
  fxSin,
  fxCos,
  fxAtan2,
  fxHypot
} from '../../core/fx.js';
import {
  sanitizeFormationForUnit,
  computeFormationLocalSlotsFx,
  transformLocalSlotToWorldFx
} from './formations.js';
import { CompanyRole, resolveCompanyRole, resolveDefaultFormation } from './company.js';

const CORE_LATERAL_GAP_FX = 1280;
const CORE_DEPTH_GAP_FX = 1792;
const FLANK_LATERAL_GAP_FX = 1536;

export function computeArmyDragLayoutFx(
  companyDescriptors,
  dragStartFx,
  dragEndFx,
  navGrid = null,
  options = {}
) {
  if (!Array.isArray(companyDescriptors) || companyDescriptors.length === 0) {
    return {
      facingDir: 256,
      isDragGesture: false,
      preserveRelative: false,
      dragLengthFx: 0,
      placements: []
    };
  }

  const preserveRelative = Boolean(options?.preserveRelative);
  const centerFrontXFx = dragStartFx.xFx | 0;
  const centerFrontZFx = dragStartFx.zFx | 0;
  const endX = dragEndFx.xFx | 0;
  const endZ = dragEndFx.zFx | 0;

  const dxFx = (endX - centerFrontXFx) | 0;
  const dzFx = (endZ - centerFrontZFx) | 0;
  const halfSpanFx = fxHypot(dxFx, dzFx);
  const isDragGesture = halfSpanFx >= 5325; // ~5.2 meters minimum drag to trigger custom line spread
  const totalSpreadFx = (halfSpanFx << 1) | 0;

  const sortedInput = companyDescriptors
    .slice()
    .sort((a, b) => (a.companyId | 0) - (b.companyId | 0));

  if (preserveRelative) {
    let sumX = 0;
    let sumZ = 0;
    let sumCos = 0;
    let sumSin = 0;
    let validOrigins = 0;

    for (let i = 0; i < sortedInput.length; i++) {
      const c = sortedInput[i];
      if (typeof c.anchorXFx === 'number' && typeof c.anchorZFx === 'number') {
        sumX = (sumX + (c.anchorXFx | 0)) | 0;
        sumZ = (sumZ + (c.anchorZFx | 0)) | 0;
        validOrigins++;
      }
      const cDir = (c.facingDir ?? 256) & ANGLE_MASK;
      sumCos = (sumCos + fxCos(cDir)) | 0;
      sumSin = (sumSin + fxSin(cDir)) | 0;
    }

    const groupCenterXFx = validOrigins > 0 ? (sumX / validOrigins) | 0 : centerFrontXFx;
    const groupCenterZFx = validOrigins > 0 ? (sumZ / validOrigins) | 0 : centerFrontZFx;
    const groupBaseFacingDir =
      sumCos !== 0 || sumSin !== 0
        ? fxAtan2(sumSin, sumCos)
        : (sortedInput[0]?.facingDir ?? 256) & ANGLE_MASK;

    let targetGroupFacingDir = groupBaseFacingDir;
    let deltaDir = 0;

    if (isDragGesture) {
      targetGroupFacingDir = fxAtan2(dzFx, dxFx) & ANGLE_MASK;
      deltaDir = (targetGroupFacingDir - groupBaseFacingDir) & ANGLE_MASK;
    }

    const cosDelta = fxCos(deltaDir);
    const sinDelta = fxSin(deltaDir);
    const placements = [];

    for (let i = 0; i < sortedInput.length; i++) {
      const desc = sortedInput[i];
      const origXFx =
        typeof desc.anchorXFx === 'number' ? desc.anchorXFx | 0 : groupCenterXFx;
      const origZFx =
        typeof desc.anchorZFx === 'number' ? desc.anchorZFx | 0 : groupCenterZFx;

      const relXFx = (origXFx - groupCenterXFx) | 0;
      const relZFx = (origZFx - groupCenterZFx) | 0;

      const rotXFx =
        deltaDir === 0
          ? relXFx
          : (mulDiv(relXFx, cosDelta, FX_ONE) - mulDiv(relZFx, sinDelta, FX_ONE)) | 0;
      const rotZFx =
        deltaDir === 0
          ? relZFx
          : (mulDiv(relXFx, sinDelta, FX_ONE) + mulDiv(relZFx, cosDelta, FX_ONE)) | 0;

      const compTargetXFx = (centerFrontXFx + rotXFx) | 0;
      const compTargetZFx = (centerFrontZFx + rotZFx) | 0;
      const baseCompDir = (desc.facingDir ?? groupBaseFacingDir) & ANGLE_MASK;
      const compFacingDir = (baseCompDir + deltaDir) & ANGLE_MASK;

      const formation = sanitizeFormationForUnit(
        desc.unitType,
        desc.formation || resolveDefaultFormation(desc.unitType)
      );
      const customWidthFx = desc.customWidthFx | 0;

      placements.push(
        _buildSingleCompanyPlacement(
          desc,
          formation,
          compTargetXFx,
          compTargetZFx,
          compFacingDir,
          customWidthFx,
          navGrid
        )
      );
    }

    return {
      facingDir: targetGroupFacingDir,
      isDragGesture: false,
      isAltDragGesture: isDragGesture,
      preserveRelative: true,
      dragLengthFx: halfSpanFx,
      placements
    };
  }

  let facingDir = 256;
  if (isDragGesture) {
    const wingAngleIdx = fxAtan2(dzFx, dxFx);
    facingDir = (wingAngleIdx - ANGLE_QUARTER) & ANGLE_MASK;
  } else {
    let avgX = 0;
    let avgZ = 0;
    let validOrigins = 0;
    for (let i = 0; i < companyDescriptors.length; i++) {
      const c = companyDescriptors[i];
      if (typeof c.anchorXFx === 'number' && typeof c.anchorZFx === 'number') {
        avgX = (avgX + (c.anchorXFx | 0)) | 0;
        avgZ = (avgZ + (c.anchorZFx | 0)) | 0;
        validOrigins++;
      }
    }
    if (validOrigins > 0) {
      avgX = (avgX / validOrigins) | 0;
      avgZ = (avgZ / validOrigins) | 0;
      const toClickX = (centerFrontXFx - avgX) | 0;
      const toClickZ = (centerFrontZFx - avgZ) | 0;
      if (toClickX !== 0 || toClickZ !== 0) {
        facingDir = fxAtan2(toClickZ, toClickX);
      }
    }
  }

  if (companyDescriptors.length === 1) {
    const desc = companyDescriptors[0];
    const formation = sanitizeFormationForUnit(
      desc.unitType,
      desc.formation || resolveDefaultFormation(desc.unitType)
    );
    const customWidthFx = isDragGesture
      ? fxClamp(totalSpreadFx, 5 * FX_ONE, 48 * FX_ONE)
      : desc.customWidthFx | 0;

    const placement = _buildSingleCompanyPlacement(
      desc,
      formation,
      centerFrontXFx,
      centerFrontZFx,
      facingDir,
      customWidthFx,
      navGrid
    );

    return {
      facingDir,
      isDragGesture,
      preserveRelative: false,
      dragLengthFx: totalSpreadFx,
      placements: [placement]
    };
  }

  const frontMelee = [];
  const rangedBack = [];
  const flankCavalry = [];
  const siegeRear = [];

  for (let i = 0; i < sortedInput.length; i++) {
    const desc = sortedInput[i];
    const role = desc.roleCategory || resolveCompanyRole(desc.unitType);
    if (role === CompanyRole.FRONT_MELEE) {
      frontMelee.push(desc);
    } else if (role === CompanyRole.FLANK_CAVALRY) {
      flankCavalry.push(desc);
    } else if (role === CompanyRole.RANGED_BACK || role === CompanyRole.HERO_CENTER) {
      rangedBack.push(desc);
    } else {
      siegeRear.push(desc);
    }
  }

  const placements = [];

  const cosF = fxCos(facingDir);
  const sinF = fxSin(facingDir);
  const rightAxisX = -sinF;
  const rightAxisZ = cosF;

  const projectLocal = (desc) => {
    const ax = (desc.anchorXFx ?? centerFrontXFx) | 0;
    const az = (desc.anchorZFx ?? centerFrontZFx) | 0;
    const dx = ((ax - centerFrontXFx) / FX_ONE);
    const dz = ((az - centerFrontZFx) / FX_ONE);
    return {
      fwd: dx * (cosF / FX_ONE) + dz * (sinF / FX_ONE),
      right: dx * (rightAxisX / FX_ONE) + dz * (rightAxisZ / FX_ONE)
    };
  };

  // Sort groups spatially: front-to-back (descending fwd), and then left-to-right within each row!
  const sortGroupSpatially = (arr, colsPerRow) => {
    if (arr.length <= 1) return;
    const step = Math.max(1, colsPerRow | 0);
    const withProj = arr.map((d) => ({ d, ...projectLocal(d) }));
    withProj.sort((a, b) => (b.fwd - a.fwd) || ((a.d.companyId | 0) - (b.d.companyId | 0)));
    for (let i = 0; i < withProj.length; i += step) {
      const slice = withProj.slice(i, i + step);
      slice.sort((a, b) => (a.right - b.right) || ((a.d.companyId | 0) - (b.d.companyId | 0)));
      for (let j = 0; j < slice.length; j++) {
        arr[i + j] = slice[j].d;
      }
    }
  };

  const leftWingCav = [];
  const rightWingCav = [];
  if (flankCavalry.length > 0) {
    const cavWithProj = flankCavalry.map((d) => ({ d, ...projectLocal(d) }));
    cavWithProj.sort((a, b) => (a.right - b.right) || ((a.d.companyId | 0) - (b.d.companyId | 0)));
    const leftCount = (cavWithProj.length + 1) >> 1;
    for (let i = 0; i < cavWithProj.length; i++) {
      if (i < leftCount) leftWingCav.push(cavWithProj[i].d);
      else rightWingCav.push(cavWithProj[i].d);
    }
  }

  // Max cavalry companies side-by-side per wing rank (1 on normal click, up to 2 on wide drag)
  const maxCavColsPerWing = isDragGesture && totalSpreadFx > 45 * FX_ONE ? 2 : 1;

  let estCavWingWidthFx = 0;
  const sampleCavCount = Math.min(flankCavalry.length, maxCavColsPerWing * 2);
  for (let i = 0; i < sampleCavCount; i++) {
    const cavDesc = flankCavalry[i];
    const cavForm = sanitizeFormationForUnit(
      'cavalry',
      cavDesc.formation || resolveDefaultFormation('cavalry')
    );
    const cavLayout = computeFormationLocalSlotsFx(
      cavForm,
      cavDesc.unitCount || 16,
      true,
      0,
      1000
    );
    estCavWingWidthFx = (estCavWingWidthFx + cavLayout.nominalWidthFx + FLANK_LATERAL_GAP_FX) | 0;
  }

  const coreGroup1 = frontMelee.length > 0 ? frontMelee : rangedBack;
  const coreGroup2 = frontMelee.length > 0 ? rangedBack : [];

  const coreTargetWidthFx = isDragGesture
    ? Math.max(10 * FX_ONE, (totalSpreadFx - estCavWingWidthFx) | 0)
    : 0;

  // Determine how many companies fit in a single row so large armies form a tactical cube
  const totalCoreCompanies = (coreGroup1.length + coreGroup2.length) | 0;
  const maxCoreColsPerRow = isDragGesture
    ? fxClamp(((coreTargetWidthFx + CORE_LATERAL_GAP_FX) / (10 * FX_ONE)) | 0, 1, 10)
    : totalCoreCompanies <= 6
      ? 3
      : 4;

  let maxCoreWidthFx = 0;
  let cumulativeCoreForwardFx = 0;

  sortGroupSpatially(coreGroup1, maxCoreColsPerRow);
  sortGroupSpatially(coreGroup2, maxCoreColsPerRow);
  sortGroupSpatially(siegeRear, maxCoreColsPerRow);
  sortGroupSpatially(leftWingCav, maxCavColsPerWing);
  sortGroupSpatially(rightWingCav, maxCavColsPerWing);

  // 1. Layout Core Group 1 (Melee Infantry) in multi-rank rows of up to `maxCoreColsPerRow`
  if (coreGroup1.length > 0) {
    const g1Metrics = _layoutMultiRankGroupFx(
      coreGroup1,
      maxCoreColsPerRow,
      centerFrontXFx,
      centerFrontZFx,
      facingDir,
      cumulativeCoreForwardFx,
      coreTargetWidthFx,
      isDragGesture,
      CORE_LATERAL_GAP_FX,
      CORE_DEPTH_GAP_FX,
      navGrid,
      placements
    );
    if (g1Metrics.maxWidthFx > maxCoreWidthFx) {
      maxCoreWidthFx = g1Metrics.maxWidthFx;
    }
    cumulativeCoreForwardFx = g1Metrics.nextForwardOffsetFx;
  }

  // 2. Layout Core Group 2 (Archers / Workers) in multi-rank rows tucked behind Infantry
  if (coreGroup2.length > 0) {
    const targetSpanForGroup2 = maxCoreWidthFx > 0 ? maxCoreWidthFx : coreTargetWidthFx;
    const g2Metrics = _layoutMultiRankGroupFx(
      coreGroup2,
      maxCoreColsPerRow,
      centerFrontXFx,
      centerFrontZFx,
      facingDir,
      cumulativeCoreForwardFx,
      targetSpanForGroup2,
      isDragGesture,
      CORE_LATERAL_GAP_FX,
      CORE_DEPTH_GAP_FX,
      navGrid,
      placements
    );
    if (g2Metrics.maxWidthFx > maxCoreWidthFx) {
      maxCoreWidthFx = g2Metrics.maxWidthFx;
    }
    cumulativeCoreForwardFx = g2Metrics.nextForwardOffsetFx;
  }

  // 3. Layout Siege Rear Guard behind Core Group 2
  if (siegeRear.length > 0) {
    const siegeMetrics = _layoutMultiRankGroupFx(
      siegeRear,
      maxCoreColsPerRow,
      centerFrontXFx,
      centerFrontZFx,
      facingDir,
      cumulativeCoreForwardFx,
      0,
      false,
      CORE_LATERAL_GAP_FX,
      CORE_DEPTH_GAP_FX,
      navGrid,
      placements
    );
    if (siegeMetrics.maxWidthFx > maxCoreWidthFx) {
      maxCoreWidthFx = siegeMetrics.maxWidthFx;
    }
  }

  // 4. Layout Cavalry Wings (either as a standalone block if only cavalry selected, or wrapped on Left/Right flanks)
  if (flankCavalry.length > 0) {
    if (maxCoreWidthFx === 0) {
      const maxCavOnlyCols = isDragGesture
        ? fxClamp(((totalSpreadFx + FLANK_LATERAL_GAP_FX) / (13 * FX_ONE)) | 0, 1, 8)
        : flankCavalry.length <= 6
          ? 3
          : 4;
      _layoutMultiRankGroupFx(
        flankCavalry,
        maxCavOnlyCols,
        centerFrontXFx,
        centerFrontZFx,
        facingDir,
        0,
        totalSpreadFx,
        isDragGesture,
        FLANK_LATERAL_GAP_FX,
        CORE_DEPTH_GAP_FX,
        navGrid,
        placements
      );
    } else {
      const halfCoreWidthFx = (maxCoreWidthFx >> 1) | 0;

      // Left Flank (multi-rank wing)
      _layoutCavalryWingBlockFx(
        leftWingCav,
        -1,
        halfCoreWidthFx,
        maxCavColsPerWing,
        centerFrontXFx,
        centerFrontZFx,
        facingDir,
        navGrid,
        placements
      );

      // Right Flank (multi-rank wing)
      _layoutCavalryWingBlockFx(
        rightWingCav,
        1,
        halfCoreWidthFx,
        maxCavColsPerWing,
        centerFrontXFx,
        centerFrontZFx,
        facingDir,
        navGrid,
        placements
      );
    }
  }

  return {
    facingDir,
    isDragGesture,
    preserveRelative: false,
    dragLengthFx: totalSpreadFx,
    placements
  };
}

function _layoutMultiRankGroupFx(
  groupDescs,
  maxColsPerRow,
  armyCenterFrontXFx,
  armyCenterFrontZFx,
  facingDir,
  startForwardOffsetFx,
  targetSpanWidthFx,
  isDragGesture,
  lateralGapFx,
  depthGapFx,
  navGrid,
  outPlacements
) {
  let maxWidthFx = 0;
  let currentForwardFx = startForwardOffsetFx | 0;
  const stepCols = Math.max(1, maxColsPerRow | 0);

  for (let startIdx = 0; startIdx < groupDescs.length; startIdx += stepCols) {
    const rowSlice = groupDescs.slice(startIdx, startIdx + stepCols);
    const rowCount = rowSlice.length;
    const rowGapsFx = ((rowCount - 1) * lateralGapFx) | 0;
    const perCompanyWidthFx =
      isDragGesture && targetSpanWidthFx > 0
        ? fxClamp(((targetSpanWidthFx - rowGapsFx) / rowCount) | 0, 6 * FX_ONE, 32 * FX_ONE)
        : 0;

    const rowMetrics = _layoutTightCenteredRowFx(
      rowSlice,
      armyCenterFrontXFx,
      armyCenterFrontZFx,
      facingDir,
      currentForwardFx,
      perCompanyWidthFx,
      isDragGesture,
      lateralGapFx,
      navGrid,
      outPlacements
    );

    if (rowMetrics.totalRowWidthFx > maxWidthFx) {
      maxWidthFx = rowMetrics.totalRowWidthFx;
    }
    currentForwardFx = (currentForwardFx - rowMetrics.maxRowDepthFx - depthGapFx) | 0;
  }

  return {
    maxWidthFx,
    nextForwardOffsetFx: currentForwardFx
  };
}

function _layoutCavalryWingBlockFx(
  wingDescs,
  sideSign,
  halfCoreWidthFx,
  maxColsPerWing,
  centerFrontXFx,
  centerFrontZFx,
  facingDir,
  navGrid,
  outPlacements
) {
  if (wingDescs.length === 0) return;

  let currentForwardFx = 0;
  const colsPerRank = Math.max(1, maxColsPerWing | 0);

  for (let startIdx = 0; startIdx < wingDescs.length; startIdx += colsPerRank) {
    const rankSlice = wingDescs.slice(startIdx, startIdx + colsPerRank);
    let cursorRightFx =
      sideSign < 0
        ? -(halfCoreWidthFx + FLANK_LATERAL_GAP_FX) | 0
        : (halfCoreWidthFx + FLANK_LATERAL_GAP_FX) | 0;
    let maxRankDepthFx = 4 * FX_ONE;

    for (let i = 0; i < rankSlice.length; i++) {
      const desc = rankSlice[i];
      const formation = sanitizeFormationForUnit(
        desc.unitType,
        desc.formation || resolveDefaultFormation(desc.unitType)
      );
      const customWidthFx = desc.customWidthFx | 0;
      const localLayout = computeFormationLocalSlotsFx(
        formation,
        desc.unitCount || 16,
        true,
        customWidthFx,
        1000
      );
      const halfW = (localLayout.nominalWidthFx >> 1) | 0;
      const companyRightCenterFx =
        sideSign < 0 ? (cursorRightFx - halfW) | 0 : (cursorRightFx + halfW) | 0;

      const worldCenter = transformLocalSlotToWorldFx(
        centerFrontXFx,
        centerFrontZFx,
        facingDir,
        currentForwardFx,
        companyRightCenterFx
      );

      const placement = _buildSingleCompanyPlacement(
        desc,
        formation,
        worldCenter.xFx,
        worldCenter.zFx,
        facingDir,
        customWidthFx,
        navGrid,
        localLayout
      );
      outPlacements.push(placement);

      if (localLayout.nominalDepthFx > maxRankDepthFx) {
        maxRankDepthFx = localLayout.nominalDepthFx;
      }

      if (sideSign < 0) {
        cursorRightFx = (cursorRightFx - localLayout.nominalWidthFx - FLANK_LATERAL_GAP_FX) | 0;
      } else {
        cursorRightFx = (cursorRightFx + localLayout.nominalWidthFx + FLANK_LATERAL_GAP_FX) | 0;
      }
    }

    currentForwardFx = (currentForwardFx - maxRankDepthFx - CORE_DEPTH_GAP_FX) | 0;
  }
}

function _layoutTightCenteredRowFx(
  rowDescs,
  armyCenterFrontXFx,
  armyCenterFrontZFx,
  facingDir,
  rowForwardOffsetFx,
  perCompanyDragWidthFx,
  applyDragWidth,
  lateralGapFx,
  navGrid,
  outPlacements
) {
  if (rowDescs.length === 0) return { totalRowWidthFx: 0, maxRowDepthFx: 0 };

  const layouts = [];
  let totalRowWidthFx = 0;
  let maxRowDepthFx = 2 * FX_ONE;

  for (let i = 0; i < rowDescs.length; i++) {
    const desc = rowDescs[i];
    const isCav = Boolean(desc.isCavalry || desc.unitType === 'cavalry');
    const formation = sanitizeFormationForUnit(
      desc.unitType,
      desc.formation || resolveDefaultFormation(desc.unitType)
    );
    const effectiveCustomWidthFx =
      applyDragWidth && perCompanyDragWidthFx > 0
        ? perCompanyDragWidthFx
        : desc.customWidthFx | 0;

    const localLayout = computeFormationLocalSlotsFx(
      formation,
      desc.unitCount || 16,
      isCav,
      effectiveCustomWidthFx,
      1000
    );

    layouts.push({ desc, formation, effectiveCustomWidthFx, localLayout });
    totalRowWidthFx = (totalRowWidthFx + localLayout.nominalWidthFx) | 0;
    if (localLayout.nominalDepthFx > maxRowDepthFx) {
      maxRowDepthFx = localLayout.nominalDepthFx;
    }
  }

  totalRowWidthFx = (totalRowWidthFx + (rowDescs.length - 1) * lateralGapFx) | 0;
  let cursorRightFx = -(totalRowWidthFx >> 1) | 0;

  for (let i = 0; i < layouts.length; i++) {
    const { desc, formation, effectiveCustomWidthFx, localLayout } = layouts[i];
    const halfW = (localLayout.nominalWidthFx >> 1) | 0;
    const companyRightCenterFx = (cursorRightFx + halfW) | 0;

    const worldCenter = transformLocalSlotToWorldFx(
      armyCenterFrontXFx,
      armyCenterFrontZFx,
      facingDir,
      rowForwardOffsetFx,
      companyRightCenterFx
    );

    const placement = _buildSingleCompanyPlacement(
      desc,
      formation,
      worldCenter.xFx,
      worldCenter.zFx,
      facingDir,
      effectiveCustomWidthFx,
      navGrid,
      localLayout
    );
    outPlacements.push(placement);

    cursorRightFx = (cursorRightFx + localLayout.nominalWidthFx + lateralGapFx) | 0;
  }

  return { totalRowWidthFx, maxRowDepthFx };
}

function _buildSingleCompanyPlacement(
  desc,
  formation,
  rawCenterXFx,
  rawCenterZFx,
  facingDir,
  customWidthFx,
  navGrid,
  precomputedLocalLayout = null
) {
  const isCav = Boolean(desc.isCavalry || desc.unitType === 'cavalry');
  const localLayout =
    precomputedLocalLayout ||
    computeFormationLocalSlotsFx(
      formation,
      desc.unitCount || 16,
      isCav,
      customWidthFx,
      1000
    );

  let targetXFx = rawCenterXFx | 0;
  let targetZFx = rawCenterZFx | 0;

  if (navGrid) {
    const worldMinFx = 16 * FX_ONE;
    const worldMaxFx = (navGrid.worldSizeFx - 16 * FX_ONE) | 0;
    targetXFx = fxClamp(targetXFx, worldMinFx, worldMaxFx);
    targetZFx = fxClamp(targetZFx, worldMinFx, worldMaxFx);

    if (!navGrid.isWalkableWorldFx(targetXFx, targetZFx)) {
      const walkable = navGrid.findNearestWalkableTile(
        navGrid.worldFxToTileX(targetXFx),
        navGrid.worldFxToTileZ(targetZFx),
        20
      );
      targetXFx = navGrid.tileToWorldCenterFxX(walkable.tx);
      targetZFx = navGrid.tileToWorldCenterFxZ(walkable.tz);
    }
  }

  const unitSlotsWorldFx = [];
  for (let s = 0; s < localLayout.slots.length; s++) {
    const slot = localLayout.slots[s];
    const worldPos = transformLocalSlotToWorldFx(
      targetXFx,
      targetZFx,
      facingDir,
      slot.localForwardFx,
      slot.localRightFx
    );
    unitSlotsWorldFx.push({
      xFx: worldPos.xFx,
      zFx: worldPos.zFx,
      dir: facingDir,
      isFrontRow: slot.isFrontRow,
      unitType: desc.unitType || 'swordsman'
    });
  }

  return {
    companyId: desc.companyId | 0,
    unitType: desc.unitType || 'swordsman',
    roleCategory: desc.roleCategory || resolveCompanyRole(desc.unitType),
    formation,
    targetXFx,
    targetZFx,
    facingDir,
    customWidthFx: customWidthFx | 0,
    nominalWidthFx: localLayout.nominalWidthFx,
    nominalDepthFx: localLayout.nominalDepthFx,
    unitSlotsWorldFx
  };
}