import {
  FX_ONE,
  PERMILLE_ONE,
  ANGLE_MASK,
  mulDiv,
  fxAbs,
  fxClamp,
  fxSin,
  fxCos,
  isqrt
} from '../../core/fx.js';
import { defaultUnitStats as unitStatsData } from '../../data/defaults.js';

export const FormationTypes = Object.freeze({
  SQUARE: 'square',
  WEDGE: 'wedge',
  SPEAR_WALL: 'spearWall',
  SHIELD_WALL: 'shieldWall',
  PIKE_PHALANX: 'pikePhalanx',
  SKIRMISH_CIRCLE: 'skirmishCircle'
});

export const AllowedFormationsByUnitType = Object.freeze({
  worker: Object.freeze([FormationTypes.SQUARE]),
  swordsman: Object.freeze([FormationTypes.SQUARE, FormationTypes.SHIELD_WALL]),
  archer: Object.freeze([FormationTypes.SQUARE]),
  spearman: Object.freeze([
    FormationTypes.SQUARE,
    FormationTypes.SPEAR_WALL,
    FormationTypes.PIKE_PHALANX
  ]),
  cavalry: Object.freeze([FormationTypes.SQUARE, FormationTypes.WEDGE]),
  ballista: Object.freeze([FormationTypes.SQUARE])
});

import { resolveUnitActiveCapabilities } from '../combatCapabilitiesRegistry.js';

export function getAllowedFormationsForUnit(unitType, activeLoadoutIdx = 0) {
  const uStat = unitStatsData?.units?.[unitType];
  if (uStat) {
    const caps = resolveUnitActiveCapabilities(unitType, activeLoadoutIdx, unitStatsData);
    if (Array.isArray(caps?.allowedFormations) && caps.allowedFormations.length > 0) {
      return caps.allowedFormations;
    }
    if (Array.isArray(uStat.allowedFormations) && uStat.allowedFormations.length > 0) {
      return uStat.allowedFormations;
    }
  }
  return AllowedFormationsByUnitType[unitType] || AllowedFormationsByUnitType.swordsman;
}

export function isFormationAllowedForUnit(unitType, formationType, activeLoadoutIdx = 0, allowedListOverride = null) {
  const allowed = Array.isArray(allowedListOverride) && allowedListOverride.length > 0
    ? allowedListOverride
    : getAllowedFormationsForUnit(unitType, activeLoadoutIdx);
  return allowed.includes(formationType);
}

export function sanitizeFormationForUnit(unitType, requestedFormation, activeLoadoutIdx = 0, allowedListOverride = null) {
  if (isFormationAllowedForUnit(unitType, requestedFormation, activeLoadoutIdx, allowedListOverride)) {
    return requestedFormation;
  }
  return FormationTypes.SQUARE;
}

export const FormationSpacingConfigFx = Object.freeze({
  square: {
    infantrySpacingXFx: 2048,
    infantrySpacingZFx: 2048,
    cavalrySpacingXFx: 3520,
    cavalrySpacingZFx: 3620
  },
  wedge: {
    infantrySpacingXFx: 2150,
    infantrySpacingZFx: 2150,
    cavalrySpacingXFx: 3520,
    cavalrySpacingZFx: 3420
  },
  spearWall: {
    infantrySpacingXFx: 1480,
    infantrySpacingZFx: 1580,
    cavalrySpacingXFx: 2662,
    cavalrySpacingZFx: 2867
  },
  shieldWall: {
    infantrySpacingXFx: 1320,
    infantrySpacingZFx: 1420,
    cavalrySpacingXFx: 2662,
    cavalrySpacingZFx: 2867
  },
  pikePhalanx: {
    infantrySpacingXFx: 1400,
    infantrySpacingZFx: 1500,
    cavalrySpacingXFx: 2662,
    cavalrySpacingZFx: 2867
  },
  skirmishCircle: {
    infantrySpacingXFx: 2250,
    infantrySpacingZFx: 2250,
    cavalrySpacingXFx: 3680,
    cavalrySpacingZFx: 3680
  }
});

function buildCenterOutwardColumnOffsetsFx(colsInRank, spacingXFx) {
  const count = colsInRank | 0;
  const offsets = new Int32Array(count);
  if (count <= 0) return offsets;

  const halfSpanFx = (((count - 1) * (spacingXFx | 0)) >> 1) | 0;
  const rawPositions = [];
  for (let c = 0; c < count; c++) {
    const posFx = (c * (spacingXFx | 0) - halfSpanFx) | 0;
    rawPositions.push(posFx);
  }

  rawPositions.sort((a, b) => {
    const da = fxAbs(a);
    const db = fxAbs(b);
    if (da !== db) return da - db;
    return a - b;
  });

  for (let i = 0; i < count; i++) {
    offsets[i] = rawPositions[i] | 0;
  }
  return offsets;
}

export function computeFormationLocalSlotsFx(
  formationType,
  unitCount,
  isCavalry = false,
  customWidthFx = 0,
  squeezePermille = 1000
) {
  const count = Math.max(1, unitCount | 0);
  const cfg = FormationSpacingConfigFx[formationType] || FormationSpacingConfigFx.square;
  const spacingXFx = isCavalry ? cfg.cavalrySpacingXFx : cfg.infantrySpacingXFx;
  const spacingZFx = isCavalry ? cfg.cavalrySpacingZFx : cfg.infantrySpacingZFx;
  const squeeze = fxClamp(squeezePermille | 0, 220, 1000);

  const slots = [];

  if (formationType === FormationTypes.SKIRMISH_CIRCLE) {
    const baseRadiusFx = Math.max(2 * FX_ONE, Math.round((count * spacingXFx) / 6));
    const squeezedRadFx = mulDiv(baseRadiusFx, squeeze, PERMILLE_ONE);
    for (let i = 0; i < count; i++) {
      const ang = ((i * 1024) / count) & ANGLE_MASK;
      const fwdFx = mulDiv(squeezedRadFx, fxCos(ang), FX_ONE);
      const rightFx = mulDiv(squeezedRadFx, fxSin(ang), FX_ONE);
      slots.push({
        slotIndex: i,
        localForwardFx: fwdFx,
        localRightFx: rightFx,
        rank: 0,
        col: i,
        isFrontRow: i < (count >> 1)
      });
    }
    return {
      slots,
      frontRowCount: Math.max(1, count >> 1),
      nominalWidthFx: squeezedRadFx << 1,
      nominalDepthFx: squeezedRadFx << 1
    };
  }

  if (formationType === FormationTypes.WEDGE) {
    let remaining = count;
    let rank = 0;
    const rankCounts = [];
    while (remaining > 0) {
      const wantInRank = (rank + 1) | 0;
      const actualInRank = remaining < wantInRank ? remaining : wantInRank;
      rankCounts.push(actualInRank);
      remaining = (remaining - actualInRank) | 0;
      rank = (rank + 1) | 0;
    }

    const totalRanks = rankCounts.length;
    let maxRankCols = 1;
    let slotIdx = 0;

    const baseMaxCols = rankCounts[rankCounts.length - 1] || 1;
    const defaultBaseWidthFx = (baseMaxCols * spacingXFx) | 0;
    const widthScalePermille =
      customWidthFx > spacingXFx * 2 && defaultBaseWidthFx > 0
        ? fxClamp(mulDiv(customWidthFx, PERMILLE_ONE, defaultBaseWidthFx), 600, 1800)
        : PERMILLE_ONE;

    for (let r = 0; r < totalRanks; r++) {
      const colsInRank = rankCounts[r];
      if (colsInRank > maxRankCols) maxRankCols = colsInRank;
      const effectiveSpacingX = mulDiv(spacingXFx, widthScalePermille, PERMILLE_ONE);
      const colOffsets = buildCenterOutwardColumnOffsetsFx(colsInRank, effectiveSpacingX);
      const baseForwardFx = (-r * spacingZFx) | 0;

      for (let c = 0; c < colsInRank; c++) {
        const squeezedRightFx = mulDiv(colOffsets[c], squeeze, PERMILLE_ONE);
        const elongationPermille = (PERMILLE_ONE + ((PERMILLE_ONE - squeeze) >> 1)) | 0;
        const squeezedForwardFx = mulDiv(baseForwardFx, elongationPermille, PERMILLE_ONE);

        slots.push({
          slotIndex: slotIdx++,
          localForwardFx: squeezedForwardFx,
          localRightFx: squeezedRightFx,
          rank: r,
          col: c,
          isFrontRow: r <= 1
        });
      }
    }

    return {
      slots,
      frontRowCount: Math.min(count, 3),
      nominalWidthFx: mulDiv(maxRankCols * spacingXFx, widthScalePermille, PERMILLE_ONE),
      nominalDepthFx: (totalRanks * spacingZFx) | 0
    };
  }

  let cols = 5;
  if (customWidthFx > spacingXFx * 2) {
    cols = (customWidthFx / spacingXFx) | 0;
    cols = fxClamp(cols, 2, count);
  } else if (
    formationType === FormationTypes.SPEAR_WALL ||
    formationType === FormationTypes.SHIELD_WALL ||
    formationType === FormationTypes.PIKE_PHALANX
  ) {
    cols = Math.max(6, ((count + 1) >> 1) | 0);
  } else {
    cols = Math.max(3, isqrt(count));
  }

  let effectiveCols = cols;
  if (squeeze < 850) {
    const maxChokeCols = isCavalry ? 2 : 3;
    const interpolatedCols = mulDiv(cols, squeeze, PERMILLE_ONE);
    effectiveCols = fxClamp(interpolatedCols, maxChokeCols, cols);
  }

  const totalRanks = ((count + effectiveCols - 1) / effectiveCols) | 0;
  let slotIdx = 0;

  for (let r = 0; r < totalRanks; r++) {
    const remaining = (count - slotIdx) | 0;
    const colsInRank = remaining < effectiveCols ? remaining : effectiveCols;
    const colOffsets = buildCenterOutwardColumnOffsetsFx(colsInRank, spacingXFx);
    const baseForwardFx = (-r * spacingZFx) | 0;

    for (let c = 0; c < colsInRank; c++) {
      const rightFx =
        squeeze < 850 ? colOffsets[c] : mulDiv(colOffsets[c], squeeze, PERMILLE_ONE);

      slots.push({
        slotIndex: slotIdx++,
        localForwardFx: baseForwardFx,
        localRightFx: rightFx,
        rank: r,
        col: c,
        isFrontRow: r === 0
      });
    }
  }

  return {
    slots,
    frontRowCount: Math.min(count, effectiveCols),
    nominalWidthFx: (cols * spacingXFx) | 0,
    nominalDepthFx: (totalRanks * spacingZFx) | 0
  };
}

export function transformLocalSlotToWorldFx(
  anchorXFx,
  anchorZFx,
  facingAngleIdx,
  localForwardFx,
  localRightFx
) {
  const angle = (facingAngleIdx | 0) & ANGLE_MASK;
  const cosA = fxCos(angle);
  const sinA = fxSin(angle);

  const worldXFx =
    ((anchorXFx | 0) +
      mulDiv(localForwardFx | 0, cosA, FX_ONE) -
      mulDiv(localRightFx | 0, sinA, FX_ONE)) |
    0;

  const worldZFx =
    ((anchorZFx | 0) +
      mulDiv(localForwardFx | 0, sinA, FX_ONE) +
      mulDiv(localRightFx | 0, cosA, FX_ONE)) |
    0;

  return { xFx: worldXFx, zFx: worldZFx };
}

export function measureChokepointCorridorFx(
  navGrid,
  anchorXFx,
  anchorZFx,
  facingAngleIdx,
  nominalWidthFx
) {
  const halfNominalFx = Math.max(6 * FX_ONE, (nominalWidthFx >> 1) | 0);
  const angle = (facingAngleIdx | 0) & ANGLE_MASK;
  const cosA = fxCos(angle);
  const sinA = fxSin(angle);

  let minAvailableWidthFx = halfNominalFx << 1;
  let tightestRightFx = halfNominalFx;
  let tightestLeftFx = halfNominalFx;

  const probeOffsetsFx = [-8 * FX_ONE, 0, 8 * FX_ONE, 16 * FX_ONE];

  for (let p = 0; p < probeOffsetsFx.length; p++) {
    const forwardProbeFx = probeOffsetsFx[p];
    const centerXFx = ((anchorXFx | 0) + mulDiv(forwardProbeFx, cosA, FX_ONE)) | 0;
    const centerZFx = ((anchorZFx | 0) + mulDiv(forwardProbeFx, sinA, FX_ONE)) | 0;

    if (!navGrid.isWalkableWorldFx(centerXFx, centerZFx)) continue;

    let freeRightFx = 0;
    let freeLeftFx = 0;
    const stepFx = 2 * FX_ONE;

    for (let distFx = stepFx; distFx <= halfNominalFx; distFx = (distFx + stepFx) | 0) {
      const rxFx = (centerXFx - mulDiv(distFx, sinA, FX_ONE)) | 0;
      const rzFx = (centerZFx + mulDiv(distFx, cosA, FX_ONE)) | 0;
      if (!navGrid.isWalkableWorldFx(rxFx, rzFx)) break;
      freeRightFx = distFx;
    }

    for (let distFx = stepFx; distFx <= halfNominalFx; distFx = (distFx + stepFx) | 0) {
      const lxFx = (centerXFx + mulDiv(distFx, sinA, FX_ONE)) | 0;
      const lzFx = (centerZFx - mulDiv(distFx, cosA, FX_ONE)) | 0;
      if (!navGrid.isWalkableWorldFx(lxFx, lzFx)) break;
      freeLeftFx = distFx;
    }

    const totalClearSpanFx = (freeRightFx + freeLeftFx + stepFx) | 0;
    if (totalClearSpanFx < minAvailableWidthFx) {
      minAvailableWidthFx = totalClearSpanFx;
    }
    if (p === 1 || p === 2) {
      if (freeRightFx < tightestRightFx) tightestRightFx = freeRightFx;
      if (freeLeftFx < tightestLeftFx) tightestLeftFx = freeLeftFx;
    }
  }

  const ratioPermille = mulDiv(minAvailableWidthFx, PERMILLE_ONE, halfNominalFx << 1);
  const squeezePermille = fxClamp(ratioPermille, 260, 1000);
  const centerShiftRightFx =
    tightestRightFx < halfNominalFx || tightestLeftFx < halfNominalFx
      ? ((tightestRightFx - tightestLeftFx) >> 1) | 0
      : 0;

  return {
    squeezePermille,
    centerShiftRightFx,
    maxRightFx: Math.max(1536, (tightestRightFx - 1024) | 0),
    maxLeftFx: Math.max(1536, (tightestLeftFx - 1024) | 0)
  };
}

export function measureChokepointSqueezePermille(
  navGrid,
  anchorXFx,
  anchorZFx,
  facingAngleIdx,
  nominalWidthFx
) {
  return measureChokepointCorridorFx(
    navGrid,
    anchorXFx,
    anchorZFx,
    facingAngleIdx,
    nominalWidthFx
  ).squeezePermille;
}
