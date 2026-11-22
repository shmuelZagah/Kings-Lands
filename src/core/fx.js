export const FX_SHIFT = 10;
export const FX_ONE = 1024;
export const FX_HALF = 512;
export const TICK_MS = 50;
export const TICKS_PER_SEC = 20;
export const PERMILLE_ONE = 1000;
export const ANGLE_STEPS = 1024;
export const ANGLE_MASK = 1023;
export const ANGLE_QUARTER = 256;
export const ANGLE_HALF = 512;

const QUADRANT_SIN_257 = [
  0, 6, 13, 19, 25, 31, 38, 44, 50, 56, 63, 69, 75, 82, 88, 94,
  100, 107, 113, 119, 125, 131, 138, 144, 150, 156, 162, 169, 175, 181, 187, 193,
  199, 205, 212, 218, 224, 230, 236, 242, 248, 254, 260, 266, 272, 278, 284, 290,
  296, 302, 308, 314, 320, 326, 332, 338, 344, 349, 355, 361, 367, 373, 378, 384,
  390, 396, 401, 407, 413, 418, 424, 430, 435, 441, 447, 452, 458, 463, 469, 474,
  480, 485, 491, 496, 501, 507, 512, 517, 523, 528, 533, 539, 544, 549, 554, 559,
  565, 570, 575, 580, 585, 590, 595, 600, 605, 610, 615, 620, 625, 630, 634, 639,
  644, 649, 653, 658, 663, 668, 672, 677, 681, 686, 690, 695, 699, 704, 708, 713,
  717, 721, 726, 730, 734, 738, 743, 747, 751, 755, 759, 763, 767, 771, 775, 779,
  783, 787, 791, 795, 799, 802, 806, 810, 813, 817, 821, 824, 828, 831, 835, 838,
  842, 845, 849, 852, 855, 859, 862, 865, 868, 871, 875, 878, 881, 884, 887, 890,
  893, 896, 898, 901, 904, 907, 910, 912, 915, 918, 920, 923, 925, 928, 930, 933,
  935, 938, 940, 942, 944, 947, 949, 951, 953, 955, 957, 959, 961, 963, 965, 967,
  969, 971, 972, 974, 976, 978, 979, 981, 982, 984, 986, 987, 989, 990, 991, 993,
  994, 995, 997, 998, 999, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010,
  1011, 1011, 1012, 1013, 1014, 1014, 1015, 1015, 1016, 1016, 1017, 1017, 1018, 1018, 1018, 1019,
  1024
];

const SIN_LUT = new Int32Array(ANGLE_STEPS);
const COS_LUT = new Int32Array(ANGLE_STEPS);
for (let i = 0; i < ANGLE_STEPS; i++) {
  if (i <= 256) SIN_LUT[i] = QUADRANT_SIN_257[i];
  else if (i <= 512) SIN_LUT[i] = QUADRANT_SIN_257[512 - i];
  else if (i <= 768) SIN_LUT[i] = -QUADRANT_SIN_257[i - 512];
  else SIN_LUT[i] = -QUADRANT_SIN_257[1024 - i];
}
for (let i = 0; i < ANGLE_STEPS; i++) {
  COS_LUT[i] = SIN_LUT[(i + ANGLE_QUARTER) & ANGLE_MASK];
}

const OCTANT_TAN_LUT = new Int32Array(129);
for (let i = 0; i <= 128; i++) {
  const c = COS_LUT[i];
  OCTANT_TAN_LUT[i] = c > 0 ? (((SIN_LUT[i] << FX_SHIFT) / c) | 0) : 1024;
}

export function toFx(meters) { return Math.round(meters * FX_ONE) | 0; }
export function toFloat(fxValue) { return (fxValue | 0) / FX_ONE; }

export function mulDiv(a, b, c) {
  const divisor = c | 0;
  if (divisor === 0) return 0;
  const prod = (a | 0) * (b | 0);
  if (prod <= 9007199254740991 && prod >= -9007199254740991) {
    return (prod / divisor) | 0;
  }
  return Number((BigInt(a | 0) * BigInt(b | 0)) / BigInt(divisor)) | 0;
}
export function fxMul(a, b) { return mulDiv(a, b, FX_ONE); }
export function fxDiv(a, b) { return mulDiv(a, FX_ONE, b); }
export function fxPermille(value, permille) { return mulDiv(value, permille, PERMILLE_ONE); }
export function fxAbs(v) { const x = v | 0; return x < 0 ? (-x | 0) : x; }
export function fxClamp(v, minVal, maxVal) {
  const x = v | 0, lo = minVal | 0, hi = maxVal | 0;
  return x < lo ? lo : (x > hi ? hi : x);
}

export function isqrt(n) {
  if (typeof n === 'bigint') {
    if (n <= 0n) return 0;
    if (n < 4n) return 1;
    let x0 = n;
    let x1 = (x0 + 1n) >> 1n;
    while (x1 < x0) { x0 = x1; x1 = (x0 + n / x0) >> 1n; }
    return Number(x0) | 0;
  }
  const val = n | 0;
  if (val <= 0) return 0;
  if (val < 4) return 1;
  let x0 = val;
  let x1 = (x0 + 1) >> 1;
  while (x1 < x0) { x0 = x1; x1 = (x0 + ((val / x0) | 0)) >> 1; }
  return x0 | 0;
}

/**
 * Exact floor(sqrt(n)) for a non-negative integer n <= 2^53 using doubles (no BigInt).
 * Same result as the BigInt isqrt above (including isqrt(1..3) === 1), just ~50x faster.
 */
function isqrtExactNumber(n) {
  if (n <= 0) return 0;
  if (n < 4) return 1;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r | 0;
}

export function fxSqrt(fxVal) {
  const v = fxVal | 0;
  if (v <= 0) return 0;
  return isqrtExactNumber(v * (1 << FX_SHIFT));   // v < 2^31, shift small: the product stays exact in a double
}

// dx*dx + dz*dz is exact in a double while |dx|, |dz| <= 94,906,265 (always true inside the world: ~1e6 fx units)
const HYPOT_SAFE = 94906265;

export function fxHypot(dx, dz) {
  const x = dx | 0, z = dz | 0;
  if (x <= HYPOT_SAFE && x >= -HYPOT_SAFE && z <= HYPOT_SAFE && z >= -HYPOT_SAFE) return isqrtExactNumber(x * x + z * z);
  const bx = BigInt(x), bz = BigInt(z);
  return isqrt(bx * bx + bz * bz);
}

export function fxSin(angleIdx) { return SIN_LUT[(angleIdx | 0) & ANGLE_MASK]; }
export function fxCos(angleIdx) { return COS_LUT[(angleIdx | 0) & ANGLE_MASK]; }

export function fxSinSub(angleSub10) {
  const a = angleSub10 | 0;
  const idx = (a >> 10) & ANGLE_MASK;
  const frac = a & 1023;
  const s0 = SIN_LUT[idx];
  const s1 = SIN_LUT[(idx + 1) & ANGLE_MASK];
  return (s0 + (((s1 - s0) * frac) >> 10)) | 0;
}

export function fxCosSub(angleSub10) {
  return fxSinSub((angleSub10 + (ANGLE_QUARTER << 10)) | 0);
}

export function fxSmoothstepPermille(tPermille) {
  const t = fxClamp(tPermille | 0, 0, 1000);
  const t2 = mulDiv(t, t, 1000);
  return mulDiv(t2, (3000 - (t << 1)) | 0, 1000);
}

export function fxAtan2(dy, dx) {
  const y = dy | 0, x = dx | 0;
  if (x === 0 && y === 0) return 0;
  const absX = x < 0 ? -x : x;
  const absY = y < 0 ? -y : y;
  let ratio = 0, swap = false;
  if (absY <= absX) { ratio = mulDiv(absY, FX_ONE, absX); }
  else { ratio = mulDiv(absX, FX_ONE, absY); swap = true; }
  let lo = 0, hi = 128;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (OCTANT_TAN_LUT[mid] <= ratio) lo = mid;
    else hi = mid - 1;
  }
  let baseAngle = swap ? (256 - lo) : lo;
  if (x < 0 && y >= 0) baseAngle = 512 - baseAngle;
  else if (x < 0 && y < 0) baseAngle = 512 + baseAngle;
  else if (x >= 0 && y < 0) baseAngle = (1024 - baseAngle) & ANGLE_MASK;
  return baseAngle & ANGLE_MASK;
}

export function xorshift32(gameState) {
  if (!gameState || typeof gameState.rngState !== 'number' || (gameState.rngState | 0) === 0) {
    gameState.rngState = 133742069;
  }
  let x = gameState.rngState | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  gameState.rngState = x | 0;
  return x >>> 0;
}

export function fxRandomRange(gameState, minIncl, maxIncl) {
  const lo = minIncl | 0, hi = maxIncl | 0;
  if (hi <= lo) return lo;
  const span = (hi - lo + 1) >>> 0;
  return (lo + (xorshift32(gameState) % span)) | 0;
}