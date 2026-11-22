/**
 * Kings Lands — mesh decimation (quadric edge collapse, Garland–Heckbert). No dependencies.
 * (src/tools/import/meshSimplify.js)
 *
 * Built for rigid-part characters:
 *  - `locked[v] = 1` vertices never move and are never removed → the seam between two joint parts keeps the exact same
 *    vertices in every LOD, so no crack opens when an arm rotates.
 *  - open borders of a part (a cut sleeve, a hem) get extra "border quadrics" so they do not melt inwards.
 *  - collapses that flip a face, or make the surface non-manifold, are rejected.
 *  - per-vertex colour (0..255 rgb) is carried through; a collapse across a strong colour edge costs more.
 */

/** Merge vertices that sit at the same place (glTF duplicates vertices on UV / normal seams). */
export function weldByPosition(positions, colors, indices, tolerance = 1e-5) {
  const n = positions.length / 3;
  const map = new Int32Array(n);
  const grid = new Map();
  const outPos = [], outCol = [];
  const q = 1 / tolerance;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = `${Math.round(x * q)}|${Math.round(y * q)}|${Math.round(z * q)}`;
    let id = grid.get(key);
    if (id === undefined) {
      id = outPos.length / 3;
      grid.set(key, id);
      outPos.push(x, y, z);
      outCol.push(colors ? colors[i * 3] : 200, colors ? colors[i * 3 + 1] : 200, colors ? colors[i * 3 + 2] : 200);
    }
    map[i] = id;
  }
  const outIdx = [];
  for (let f = 0; f < indices.length; f += 3) {
    const a = map[indices[f]], b = map[indices[f + 1]], c = map[indices[f + 2]];
    if (a !== b && b !== c && a !== c) outIdx.push(a, b, c);
  }
  return { positions: Float32Array.from(outPos), colors: Uint8Array.from(outCol), indices: Uint32Array.from(outIdx), map };
}

function planeQuadric(nx, ny, nz, d, w, out) {
  out[0] += w * nx * nx; out[1] += w * nx * ny; out[2] += w * nx * nz; out[3] += w * nx * d;
  out[4] += w * ny * ny; out[5] += w * ny * nz; out[6] += w * ny * d;
  out[7] += w * nz * nz; out[8] += w * nz * d; out[9] += w * d * d;
}
function quadricError(q, x, y, z) {
  return q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
    q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y +
    q[7] * z * z + 2 * q[8] * z + q[9];
}
function solveOptimal(q, out) {
  const a = q[0], b = q[1], c = q[2], d = q[3], e = q[4], f = q[5], g = q[6], h = q[7], i = q[8];
  const det = a * (e * h - f * f) - b * (b * h - f * c) + c * (b * f - e * c);
  if (Math.abs(det) < 1e-12) return false;
  const id = 1 / det;
  out[0] = -id * (d * (e * h - f * f) - b * (g * h - f * i) + c * (g * f - e * i));
  out[1] = -id * (a * (g * h - f * i) - d * (b * h - f * c) + c * (b * i - g * c));
  out[2] = -id * (a * (e * i - g * f) - b * (b * i - g * c) + d * (b * f - e * c));
  return Number.isFinite(out[0] + out[1] + out[2]);
}

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(it) {
    const a = this.a; a.push(it);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost <= a[i].cost) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/**
 * Joint-part awareness (optional): pass `labels` (Int16Array, one label per triangle = the joint part it belongs to). The
 * WHOLE character is then simplified as one welded mesh, so the shared seam vertices between two parts are decimated
 * consistently on both sides (no cracks), and:
 *   - a seam vertex only collapses ALONG its seam edge (the joint ring keeps its round shape, just with fewer vertices),
 *   - vertices where 3+ parts meet are locked,
 *   - `minPerLabel[label]` is a floor of triangles each part keeps (a hand never vanishes).
 *
 * @param {{positions:Float32Array, colors?:Uint8Array, indices:Uint32Array, locked?:Uint8Array, labels?:Int16Array, minPerLabel?:Int32Array}} mesh  (already welded)
 * @param {number} targetTris
 * @returns {{positions:Float32Array, colors:Uint8Array, indices:Uint32Array, locked:Uint8Array, labels:Int16Array|null, triangles:number}}
 */
export function simplifyMesh(mesh, targetTris, opts = {}) {
  const minDot = opts.minNormalDot ?? 0.15;
  const nV = mesh.positions.length / 3;
  const nF = mesh.indices.length / 3;
  const pos = Float64Array.from(mesh.positions);
  const col = Float32Array.from(mesh.colors || new Uint8Array(nV * 3).fill(200));
  const locked = mesh.locked ? Uint8Array.from(mesh.locked) : new Uint8Array(nV);
  const tri = Int32Array.from(mesh.indices);
  const labels = mesh.labels || null;
  const labelCount = new Map();
  if (labels) for (let f = 0; f < nF; f++) labelCount.set(labels[f], (labelCount.get(labels[f]) || 0) + 1);
  const floorOf = (l) => (mesh.minPerLabel ? mesh.minPerLabel[l] | 0 : 0);
  const alive = new Uint8Array(nF).fill(1);
  let liveFaces = nF;
  if (nF <= targetTris) return compact();

  const vFaces = Array.from({ length: nV }, () => new Set());
  for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) vFaces[tri[f * 3 + k]].add(f);
  const Q = Array.from({ length: nV }, () => new Float64Array(10));
  const version = new Uint32Array(nV);
  const gone = new Uint8Array(nV);

  const faceNormal = (a, b, c, out) => {
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
  };
  const n3 = [0, 0, 0];
  for (let f = 0; f < nF; f++) {
    const a = tri[f * 3], b = tri[f * 3 + 1], c = tri[f * 3 + 2];
    faceNormal(a, b, c, n3);
    const area2 = Math.hypot(n3[0], n3[1], n3[2]);
    if (area2 < 1e-14) continue;
    const nx = n3[0] / area2, ny = n3[1] / area2, nz = n3[2] / area2;
    const d = -(nx * pos[a * 3] + ny * pos[a * 3 + 1] + nz * pos[a * 3 + 2]);
    for (const v of [a, b, c]) planeQuadric(nx, ny, nz, d, area2 * 0.5, Q[v]);
  }
  // border quadrics
  const edgeFaces = new Map();
  const ek = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) {
    const a = tri[f * 3 + k], b = tri[f * 3 + (k + 1) % 3], key = ek(a, b);
    const l = edgeFaces.get(key); if (l) l.push(f); else edgeFaces.set(key, [f]);
  }
  for (const [key, fl] of edgeFaces) {
    if (fl.length !== 1) continue;
    const f = fl[0], a = Math.floor(key / 4294967296), b = key % 4294967296;
    const c = tri[f * 3] !== a && tri[f * 3] !== b ? tri[f * 3] : (tri[f * 3 + 1] !== a && tri[f * 3 + 1] !== b ? tri[f * 3 + 1] : tri[f * 3 + 2]);
    faceNormal(a, b, c, n3);
    const ex = pos[b * 3] - pos[a * 3], ey = pos[b * 3 + 1] - pos[a * 3 + 1], ez = pos[b * 3 + 2] - pos[a * 3 + 2];
    let px = ey * n3[2] - ez * n3[1], py = ez * n3[0] - ex * n3[2], pz = ex * n3[1] - ey * n3[0];
    const pl = Math.hypot(px, py, pz); if (pl < 1e-14) continue;
    px /= pl; py /= pl; pz /= pl;
    const d = -(px * pos[a * 3] + py * pos[a * 3 + 1] + pz * pos[a * 3 + 2]);
    const w = 50 * (ex * ex + ey * ey + ez * ez);
    planeQuadric(px, py, pz, d, w, Q[a]); planeQuadric(px, py, pz, d, w, Q[b]);
  }

  const heap = new MinHeap();
  const tmpQ = new Float64Array(10), opt = [0, 0, 0];

  const labelsOf = (v) => { const set = new Set(); for (const f of vFaces[v]) set.add(labels[f]); return set; };
  /** 0 = interior of one part, 1 = on a seam between two parts, 2 = junction of 3+ parts (never moves) */
  const seamLevel = (v) => (labels ? Math.min(2, labelsOf(v).size - 1) : 0);
  const isSeamEdge = (a, b) => {
    const fs = []; for (const f of vFaces[a]) if (vFaces[b].has(f)) fs.push(f);
    return fs.length === 2 && labels[fs[0]] !== labels[fs[1]];
  };

  /** Where would a–b collapse to, and at what cost? null if forbidden. */
  const evaluate = (a, b) => {
    let lockA = locked[a], lockB = locked[b];
    if (labels) {
      const sa = seamLevel(a), sb = seamLevel(b);
      if (sa === 2) lockA = 1;
      if (sb === 2) lockB = 1;
      if (sa === 1 && sb === 1 && !isSeamEdge(a, b)) return null;    // chord across a part: would pinch the joint ring
      if (sa === 1 && sb === 0) lockA = 1;                            // interior vertex slides into the seam vertex
      if (sb === 1 && sa === 0) lockB = 1;
    }
    if (lockA && lockB) {
      // two seam vertices on the same seam edge may merge (the ring loses a vertex): keep the one with the lower error
      if (!(labels && seamLevel(a) === 1 && seamLevel(b) === 1 && !locked[a] && !locked[b])) return null;
      lockB = 0;
    }
    for (let i = 0; i < 10; i++) tmpQ[i] = Q[a][i] + Q[b][i];
    let keep, px, py, pz;
    if (lockA && lockB === 0 && labels && seamLevel(a) === 1 && seamLevel(b) === 1) {
      // seam-edge merge: endpoint with the lower quadric error wins
      const ea = quadricError(tmpQ, pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]), eb = quadricError(tmpQ, pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]);
      keep = ea <= eb ? a : b; px = pos[keep * 3]; py = pos[keep * 3 + 1]; pz = pos[keep * 3 + 2];
    } else if (lockA) { keep = a; px = pos[a * 3]; py = pos[a * 3 + 1]; pz = pos[a * 3 + 2]; }
    else if (lockB) { keep = b; px = pos[b * 3]; py = pos[b * 3 + 1]; pz = pos[b * 3 + 2]; }
    else {
      keep = a;
      let best = Infinity;
      const cands = [[pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]],
        [(pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2]];
      if (solveOptimal(tmpQ, opt)) cands.unshift([opt[0], opt[1], opt[2]]);
      for (const c of cands) { const e = quadricError(tmpQ, c[0], c[1], c[2]); if (e < best) { best = e; px = c[0]; py = c[1]; pz = c[2]; } }
    }
    let cost = Math.max(0, quadricError(tmpQ, px, py, pz));
    const dc = Math.hypot(col[a * 3] - col[b * 3], col[a * 3 + 1] - col[b * 3 + 1], col[a * 3 + 2] - col[b * 3 + 2]) / 441;
    const len2 = (pos[a * 3] - pos[b * 3]) ** 2 + (pos[a * 3 + 1] - pos[b * 3 + 1]) ** 2 + (pos[a * 3 + 2] - pos[b * 3 + 2]) ** 2;
    cost += dc * dc * len2 * 8;
    return { keep, px, py, pz, cost };
  };
  const pushEdge = (a, b) => {
    const e = evaluate(a, b);
    if (e) heap.push({ cost: e.cost, a, b, va: version[a], vb: version[b] });
  };
  for (const key of edgeFaces.keys()) pushEdge(Math.floor(key / 4294967296), key % 4294967296);

  const nA = [0, 0, 0], nB = [0, 0, 0];
  /** Would moving a & b to (px,py,pz) flip or crush a surrounding face, or break manifoldness? */
  const collapseOk = (a, b, px, py, pz) => {
    const shared = [];
    for (const f of vFaces[a]) if (vFaces[b].has(f)) shared.push(f);
    if (!shared.length || shared.length > 2) return false;
    // link condition
    const na = new Set(), nb = new Set();
    for (const f of vFaces[a]) for (let k = 0; k < 3; k++) { const v = tri[f * 3 + k]; if (v !== a) na.add(v); }
    for (const f of vFaces[b]) for (let k = 0; k < 3; k++) { const v = tri[f * 3 + k]; if (v !== b) nb.add(v); }
    let common = 0; for (const v of na) if (nb.has(v)) common++;
    if (common > shared.length) return false;
    for (const v of [a, b]) {
      for (const f of vFaces[v]) {
        if (shared.includes(f)) continue;
        const i0 = tri[f * 3], i1 = tri[f * 3 + 1], i2 = tri[f * 3 + 2];
        faceNormal(i0, i1, i2, nA);
        const ox = pos[v * 3], oy = pos[v * 3 + 1], oz = pos[v * 3 + 2];
        pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
        faceNormal(i0, i1, i2, nB);
        pos[v * 3] = ox; pos[v * 3 + 1] = oy; pos[v * 3 + 2] = oz;
        const la = Math.hypot(nA[0], nA[1], nA[2]), lb = Math.hypot(nB[0], nB[1], nB[2]);
        if (lb < 1e-12 || la < 1e-12) { if (lb < 1e-12 && la >= 1e-12) return false; continue; }
        if ((nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]) / (la * lb) < minDot) return false;
      }
    }
    return true;
  };

  while (liveFaces > targetTris && heap.size) {
    const e = heap.pop();
    const { a, b } = e;
    if (gone[a] || gone[b] || version[a] !== e.va || version[b] !== e.vb) continue;
    const ev = evaluate(a, b);
    if (!ev) continue;
    if (!collapseOk(a, b, ev.px, ev.py, ev.pz)) continue;
    const keep = ev.keep, rem = keep === a ? b : a;
    if (labels) { // part floors: refuse a collapse that would take a part below its minimum triangle count
      const dying = new Map();
      for (const f of vFaces[a]) if (vFaces[b].has(f)) dying.set(labels[f], (dying.get(labels[f]) || 0) + 1);
      let blocked = false;
      for (const [l, n] of dying) if (labelCount.get(l) - n < floorOf(l)) { blocked = true; break; }
      if (blocked) continue;
      for (const [l, n] of dying) labelCount.set(l, labelCount.get(l) - n);
    }
    pos[keep * 3] = ev.px; pos[keep * 3 + 1] = ev.py; pos[keep * 3 + 2] = ev.pz;
    if (!locked[keep]) { for (let k = 0; k < 3; k++) col[keep * 3 + k] = (col[a * 3 + k] + col[b * 3 + k]) / 2; }
    for (let i = 0; i < 10; i++) Q[keep][i] += Q[rem][i];
    for (const f of [...vFaces[rem]]) {
      if (vFaces[keep].has(f)) { // face contained both → dies
        alive[f] = 0; liveFaces--;
        for (let k = 0; k < 3; k++) vFaces[tri[f * 3 + k]].delete(f);
      } else {
        for (let k = 0; k < 3; k++) if (tri[f * 3 + k] === rem) tri[f * 3 + k] = keep;
        vFaces[keep].add(f);
      }
    }
    vFaces[rem].clear(); gone[rem] = 1; version[keep]++;
    const nbrs = new Set();
    for (const f of vFaces[keep]) for (let k = 0; k < 3; k++) { const v = tri[f * 3 + k]; if (v !== keep) nbrs.add(v); }
    for (const v of nbrs) { version[v]++; }
    for (const v of nbrs) {
      pushEdge(keep, v);
      for (const f of vFaces[v]) for (let k = 0; k < 3; k++) { const w = tri[f * 3 + k]; if (w !== v && w !== keep) pushEdge(v, w); }
    }
  }
  return compact();

  function compact() {
    const remap = new Int32Array(nV).fill(-1);
    const p = [], c = [], l = [], idx = [], fl = [];
    for (let f = 0; f < nF; f++) {
      if (!alive[f]) continue;
      if (labels) fl.push(labels[f]);
      for (let k = 0; k < 3; k++) {
        const v = tri[f * 3 + k];
        if (remap[v] < 0) {
          remap[v] = p.length / 3;
          p.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
          c.push(Math.round(col[v * 3]), Math.round(col[v * 3 + 1]), Math.round(col[v * 3 + 2]));
          l.push(locked[v]);
        }
        idx.push(remap[v]);
      }
    }
    return { positions: Float32Array.from(p), colors: Uint8Array.from(c), indices: Uint32Array.from(idx), locked: Uint8Array.from(l), labels: labels ? Int16Array.from(fl) : null, triangles: idx.length / 3 };
  }
}
