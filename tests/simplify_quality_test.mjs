// node tests/simplify_quality_test.mjs — decimation must not create spikes / shards (max deviation from the original surface)
import { weldByPosition, simplifyMesh } from '../src/tools/import/meshSimplify.js';
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function tube(p0, p1, r, seg, rings, noise) {
  const pos = [], idx = []; const d = p1.map((v, i) => v - p0[i]); const L = Math.hypot(...d); const ax = d.map((v) => v / L);
  const ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]]; const ul = Math.hypot(...u); u = u.map((v) => v / ul);
  const w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  for (let i = 0; i <= rings; i++) for (let j = 0; j < seg; j++) {
    const s = i / rings, a = (j / seg) * 6.2832, rr = r * (i === rings ? 0.35 : 1) * (1 + noise * (rnd() - 0.5));
    pos.push(...[0, 1, 2].map((k) => p0[k] + ax[k] * s * L + (u[k] * Math.cos(a) + w[k] * Math.sin(a)) * rr));
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) { const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, e = b + seg; idx.push(a, c, b, b, c, e); }
  return { pos, idx };
}
// a "hand": thick palm + 5 thin fingers, plus noisy skin
const parts = [tube([0, 0, 0], [0, 0.09, 0], 0.045, 20, 12, 0.12)];
for (let f = 0; f < 5; f++) parts.push(tube([-0.035 + f * 0.0175, 0.09, 0], [-0.04 + f * 0.02, 0.17 - Math.abs(f - 2) * 0.01, 0.01], 0.008, 12, 14, 0.1));
const arm = tube([0, 0, 0], [0, -0.3, 0], 0.05, 24, 40, 0.15); parts.push(arm);
const P = [], I = [];
for (const t of parts) { const b = P.length / 3; P.push(...t.pos); t.idx.forEach((i) => I.push(i + b)); }
const w = weldByPosition(Float32Array.from(P), null, Uint32Array.from(I), 1e-6);
const orig = { pos: w.positions, idx: w.indices };
const n0 = orig.idx.length / 3;
function ptTri(p, a, b, c) { // closest-point distance
  const ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]), ap = p.map((v, i) => v - a[i]);
  const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2], d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  let q;
  const bp = p.map((v, i) => v - b[i]), d3 = dot(ab, bp), d4 = dot(ac, bp), cp = p.map((v, i) => v - c[i]), d5 = dot(ab, cp), d6 = dot(ac, cp);
  const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
  if (d1 <= 0 && d2 <= 0) q = a;
  else if (d3 >= 0 && d4 <= d3) q = b;
  else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); q = a.map((v, i) => v + ab[i] * t); }
  else if (d6 >= 0 && d5 <= d6) q = c;
  else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); q = a.map((v, i) => v + ac[i] * t); }
  else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); q = b.map((v, i) => v + (c[i] - b[i]) * t); }
  else { const den = 1 / (va + vb + vc), v = vb * den, ww = vc * den; q = a.map((x, i) => x + ab[i] * v + ac[i] * ww); }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
const V = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
function maxDeviation(out) {
  let worst = 0; const step = Math.max(1, Math.floor(out.positions.length / 3 / 400));
  for (let v = 0; v < out.positions.length / 3; v += step) {
    const p = V(out.positions, v); let best = Infinity;
    for (let f = 0; f < n0; f++) { const d = ptTri(p, V(orig.pos, orig.idx[f * 3]), V(orig.pos, orig.idx[f * 3 + 1]), V(orig.pos, orig.idx[f * 3 + 2])); if (d < best) best = d; if (best < worst) break; }
    if (best > worst) worst = best;
  }
  return worst;
}
let fails = 0;
console.log('source tris', n0);
for (const target of [3000, 1200, 500, 200]) {
  const t0 = Date.now();
  const out = simplifyMesh({ positions: orig.pos, indices: orig.idx }, target);
  const dev = maxDeviation(out);
  const ok = dev < 0.012;   // 1.2 cm on a 1.9 m character
  if (!ok) fails++;
  console.log(ok ? ' ok  ' : 'FAIL ', `target ${target} → ${out.triangles} tris, max deviation ${(dev * 100).toFixed(2)} cm (${Date.now() - t0} ms)`);
}
process.exit(fails ? 1 : 0);
