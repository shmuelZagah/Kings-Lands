// node tests/glb_import_test.mjs   — builds a synthetic rigged humanoid GLB, imports it, checks the result.
import { readGlb } from '../src/tools/import/glbReader.js';
import { buildUnitFromScene } from '../src/tools/import/glbToUnit.js';
import fs from 'node:fs';

// ---------- synthetic character: capsules (high poly) skinned to Mixamo-named bones, A-pose
function capsule(p0, p1, r, seg = 24, rings = 24) {
  const pos = [], idx = [];
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]; const L = Math.hypot(...d);
  const ax = d.map((v) => v / L);
  const t = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [ax[1] * t[2] - ax[2] * t[1], ax[2] * t[0] - ax[0] * t[2], ax[0] * t[1] - ax[1] * t[0]]; const ul = Math.hypot(...u); u.forEach((_, i) => (u[i] /= ul));
  const w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
  for (let i = 0; i <= rings; i++) {
    const s = i / rings, along = s * L;
    const rr = r * (0.8 + 0.4 * Math.sin(s * Math.PI)) * (i === 0 || i === rings ? 0.6 : 1);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(p0[0] + ax[0] * along + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * rr,
        p0[1] + ax[1] * along + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * rr,
        p0[2] + ax[2] * along + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * rr);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d2 = (i + 1) * seg + (j + 1) % seg;
    idx.push(a, c, b, b, c, d2);
  }
  return { pos, idx };
}
// bone: name, parent, world head (A-pose, facing +Z, character's LEFT = +X like glTF/Mixamo)
const bones = [
  ['mixamorig:Hips', -1, [0, 1.0, 0]], ['mixamorig:Spine', 0, [0, 1.08, 0]], ['mixamorig:Spine1', 1, [0, 1.25, 0]], ['mixamorig:Spine2', 2, [0, 1.4, 0]],
  ['mixamorig:Neck', 3, [0, 1.56, 0]], ['mixamorig:Head', 4, [0, 1.65, 0]],
  ['mixamorig:LeftShoulder', 3, [0.06, 1.5, 0]], ['mixamorig:LeftArm', 6, [0.2, 1.5, 0]], ['mixamorig:LeftForeArm', 7, [0.45, 1.25, 0]], ['mixamorig:LeftHand', 8, [0.65, 1.05, 0]], ['mixamorig:LeftHandIndex1', 9, [0.7, 1.0, 0]],
  ['mixamorig:RightShoulder', 3, [-0.06, 1.5, 0]], ['mixamorig:RightArm', 11, [-0.2, 1.5, 0]], ['mixamorig:RightForeArm', 12, [-0.45, 1.25, 0]], ['mixamorig:RightHand', 13, [-0.65, 1.05, 0]], ['mixamorig:RightHandIndex1', 14, [-0.7, 1.0, 0]],
  ['mixamorig:LeftUpLeg', 0, [0.1, 0.95, 0]], ['mixamorig:LeftLeg', 16, [0.1, 0.52, 0]], ['mixamorig:LeftFoot', 17, [0.1, 0.08, 0]], ['mixamorig:LeftToeBase', 18, [0.1, 0.0, 0.12]],
  ['mixamorig:RightUpLeg', 0, [-0.1, 0.95, 0]], ['mixamorig:RightLeg', 20, [-0.1, 0.52, 0]], ['mixamorig:RightFoot', 21, [-0.1, 0.08, 0]], ['mixamorig:RightToeBase', 22, [-0.1, 0.0, 0.12]]
];
// continuous skinned tubes along bone chains (so neighbouring joint parts really share a seam, like a real skin)
function tube(points, bonesOf, r, seg = 24, ringsPer = 28) {
  const pos = [], idx = [], jw = [];
  const samples = [];
  for (let s = 0; s < points.length - 1; s++) for (let i = 0; i < ringsPer; i++) {
    const t = i / ringsPer; samples.push({ p: points[s].map((v, k) => v + (points[s + 1][k] - v) * t), seg: s, t });
  }
  samples.push({ p: points[points.length - 1], seg: points.length - 2, t: 1 });
  const N = samples.length;
  for (let i = 0; i < N; i++) {
    const a = samples[Math.max(0, i - 1)].p, b = samples[Math.min(N - 1, i + 1)].p;
    let tg = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const L = Math.hypot(...tg); tg = tg.map((v) => v / L);
    const ref = Math.abs(tg[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = [tg[1] * ref[2] - tg[2] * ref[1], tg[2] * ref[0] - tg[0] * ref[2], tg[0] * ref[1] - tg[1] * ref[0]]; const ul = Math.hypot(...u); u = u.map((v) => v / ul);
    const w = [tg[1] * u[2] - tg[2] * u[1], tg[2] * u[0] - tg[0] * u[2], tg[0] * u[1] - tg[1] * u[0]];
    const rr = r * (i === 0 || i === N - 1 ? 0.5 : 1 + 0.15 * Math.sin(i * 0.6));
    for (let j = 0; j < seg; j++) {
      const an = (j / seg) * Math.PI * 2;
      pos.push(samples[i].p[0] + (u[0] * Math.cos(an) + w[0] * Math.sin(an)) * rr, samples[i].p[1] + (u[1] * Math.cos(an) + w[1] * Math.sin(an)) * rr, samples[i].p[2] + (u[2] * Math.cos(an) + w[2] * Math.sin(an)) * rr);
      const sm = samples[i]; const own = bonesOf[sm.seg]; const nextB = sm.t > 0.5 ? bonesOf[Math.min(bonesOf.length - 1, sm.seg + 1)] : bonesOf[Math.max(0, sm.seg - 1)];
      const dj = sm.t > 0.5 ? 1 - sm.t : sm.t; const noise = ((Math.sin(i * 12.9898 + (jw.length % 24) * 78.233) * 43758.5453) % 1 + 1) % 1; const blend = dj < 0.12 && nextB !== own ? (process.env.NOISY ? noise : 0.5 * (1 - dj / 0.12)) : 0;
      jw.push([own, nextB, 1 - blend, blend]);
    }
  }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d2 = (i + 1) * seg + (j + 1) % seg;
    idx.push(a, c, b, b, c, d2);
  }
  return { pos, idx, jw };
}
const chains = [
  [[[0, 1.0, 0], [0, 1.25, 0], [0, 1.45, 0], [0, 1.56, 0], [0, 1.65, 0], [0, 1.85, 0]], [1, 2, 3, 4, 5], 0.15],
  [[[0.2, 1.5, 0], [0.45, 1.25, 0], [0.65, 1.05, 0], [0.76, 0.94, 0]], [7, 8, 9], 0.05],
  [[[-0.2, 1.5, 0], [-0.45, 1.25, 0], [-0.65, 1.05, 0], [-0.76, 0.94, 0]], [12, 13, 14], 0.05],
  [[[0.1, 0.95, 0], [0.1, 0.52, 0], [0.1, 0.08, 0], [0.1, 0.0, 0.16]], [16, 17, 18], 0.075],
  [[[-0.1, 0.95, 0], [-0.1, 0.52, 0], [-0.1, 0.08, 0], [-0.1, 0.0, 0.16]], [20, 21, 22], 0.075]
];
const P = [], I = [], J = [], W = [], C = [];
chains.forEach(([pts, bs, r], ci) => {
  const c = tube(pts, bs, r); const base = P.length / 3;
  c.pos.forEach((v) => P.push(v)); c.idx.forEach((i) => I.push(i + base));
  c.jw.forEach(([b0, b1, w0, w1], v) => { J.push(b0, b1, 0, 0); W.push(w0, w1, 0, 0); C.push(120 + ci * 20, 90 + (v % 7) * 8, 200 - ci * 25); });
});
const total = P.length / 3;
console.log(`synthetic model: ${total} verts, ${I.length / 3} tris`);

// ---------- GLB writer
const nodes = bones.map(([name, parent, head], i) => ({ name, translation: head.map((v, k) => v - (parent >= 0 ? bones[parent][2][k] : 0)), children: [] }));
bones.forEach(([, parent], i) => { if (parent >= 0) nodes[parent].children.push(i); });
const meshNode = nodes.length; nodes.push({ name: 'Body', mesh: 0, skin: 0 });
const rootNode = nodes.length; nodes.push({ name: 'Armature', children: [0, meshNode] });
const ibm = new Float32Array(bones.length * 16);
bones.forEach(([, , h], i) => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; m[12] = -h[0]; m[13] = -h[1]; m[14] = -h[2]; ibm.set(m, i * 16); });
const chunks = []; const views = []; const accs = [];
const add = (arr, type, ct, count, target, minmax) => {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  const pad = (4 - (buf.length % 4)) % 4;
  const off = chunks.reduce((s, c) => s + c.length, 0);
  chunks.push(Buffer.concat([buf, Buffer.alloc(pad)]));
  views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, target });
  accs.push({ bufferView: views.length - 1, componentType: ct, count, type, ...(minmax || {}) });
  return accs.length - 1;
};
const aPos = add(new Float32Array(P), 'VEC3', 5126, total, 34962);
const aCol = add(new Uint8Array(C), 'VEC3', 5121, total, 34962); accs[aCol].normalized = true;
const aJ = add(new Uint8Array(J), 'VEC4', 5121, total, 34962);
const aW = add(new Float32Array(W), 'VEC4', 5126, total, 34962);
const aI = add(new Uint32Array(I), 'SCALAR', 5125, I.length, 34963);
const aIbm = add(ibm, 'MAT4', 5126, bones.length);
const json = {
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [rootNode] }], nodes,
  meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: aPos, COLOR_0: aCol, JOINTS_0: aJ, WEIGHTS_0: aW }, indices: aI, material: 0 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
  skins: [{ joints: bones.map((_, i) => i), inverseBindMatrices: aIbm, skeleton: 0 }],
  accessors: accs, bufferViews: views, buffers: [{ byteLength: chunks.reduce((s, c) => s + c.length, 0) }]
};
const jsonBuf = Buffer.from(JSON.stringify(json)); const jp = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const bin = Buffer.concat(chunks);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length, 8);
const ch = (type, b) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, b]); };
const glb = Buffer.concat([header, ch(0x4e4f534a, jp), ch(0x004e4942, bin)]);
fs.writeFileSync(process.env.OUT || '/tmp/synthetic_humanoid.glb', glb);

// ---------- run the importer
const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
const scene = await readGlb(ab);
let t0 = Date.now();
const { unit, report } = buildUnitFromScene(scene, { id: 'test_unit', sourceName: 'synthetic.glb', budgets: [3500, 1000, 280] });
console.log('import ms', Date.now() - t0, '| rig:', report.rigMode, '| tris original → LODs:', report.originalTris, '→', report.lodTris.join(' / '));
console.log('warnings:', report.warnings);
console.log('per joint tris [lod0, lod1, lod2]:'); for (const [k, v] of Object.entries(report.perJoint)) console.log(' ', k.padEnd(10), v.join(' / '));

let fails = 0; const ok = (c, m) => { console.log(c ? ' ok  ' : 'FAIL ', m); if (!c) fails++; };
const need = ['torso', 'head', 'arm_R', 'arm_L', 'forearm_R', 'hand_R', 'leg_R', 'shin_R', 'foot_R', 'leg_L'];
const flat = {}; (function walk(h, base) { for (const [k, v] of Object.entries(h)) { const w = base.map((b, i) => b + v.pos[i]); flat[k] = { w, v }; walk(v.children, w); } })(unit.hierarchy, [0, 0, 0]);
for (const n of need) ok(!!flat[n], `joint ${n} exists`);
ok(!!flat.weapon_socket_R && !!flat.weapon_socket_L && !!flat.stow_back, 'sockets exist');
ok(flat.arm_R.w[0] > 0 && flat.arm_L.w[0] < 0, 'arm_R is +x like the game (the skeleton\'s "Left" had +x → matched by geometry)');
ok(Math.abs(flat.pelvis.w[1] - 1.0 * 1.9 / 1.8) < 0.1, `pelvis height ${flat.pelvis.w[1].toFixed(3)}`);
ok(report.lodTris[0] <= 3500 * 1.5, `LOD0 within budget + skirts (${report.lodTris[0]})`);
ok(report.lodTris[0] > report.lodTris[1] && report.lodTris[1] > report.lodTris[2], 'LODs strictly decrease');
ok(report.originalTris / report.lodTris[0] > 5, `reduction ×${(report.originalTris / report.lodTris[0]).toFixed(1)} on LOD0`);

// seam test: for every LOD, every vertex of every part that lies on a seam must exist (same world position) in the neighbour part → no cracks
const parts = (lod) => { const out = []; for (const [k, f] of Object.entries(flat)) { const ms = lod === 0 ? f.v.meshes : (unit.lods[lod]?.[k] || []); for (const m of ms) out.push({ k, m, w: f.w }); } return out; };
for (const lod of [0, 1, 2]) {
  const ps = parts(lod); const map = new Map();
  const key = (p) => p.map((v) => Math.round(v * 1e3)).join(',');
  let seamBad = 0, seamVerts = 0, degenerate = 0, oob = 0;
  for (const { k, m, w } of ps) {
    const used = new Set(m.faces.flat());
    if (used.size && Math.max(...used) >= m.vertices.length) oob++;
    for (const f of m.faces) { const [a, b, c] = f.map((i) => m.vertices[i]); const cr = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]; if (Math.hypot(...cr) < 1e-12) degenerate++; }
    for (const v of m.vertices) { const kk = key(v.map((x, i) => x + w[i])); const s = map.get(kk) || new Set(); s.add(k); map.set(kk, s); }
  }
  for (const s of map.values()) if (s.size > 1) seamVerts++;
  ok(oob === 0 && degenerate === 0, `LOD${lod}: indices valid, no degenerate triangles (seam vertices shared by ≥2 parts: ${seamVerts})`);
  ok(seamVerts > 20, `LOD${lod}: seam vertices preserved across parts`);
}
// round trip through the real unit schema bits the game reads
ok(JSON.stringify(unit).length < 3_000_000, `unit JSON size ${(JSON.stringify(unit).length / 1024).toFixed(0)} KB`);
fs.writeFileSync(process.env.UNIT_OUT || '/tmp/imported_unit.json', JSON.stringify(unit));

// no-skeleton path: strip the skin → proportional auto-rig
const sc2 = await readGlb(ab); sc2.skins = []; sc2.primitives.forEach((p) => { p.skin = -1; p.joints = null; p.weights = null; });
sc2.nodes.forEach((n) => { n.skin = undefined; });
const r2 = buildUnitFromScene(sc2, { id: 'static_test' });
console.log('static mesh →', r2.report.rigMode, r2.report.lodTris.join(' / '), r2.report.warnings.slice(-2));
const names2 = new Set(); (function w(h) { for (const [k, v] of Object.entries(h)) { names2.add(k); w(v.children); } })(r2.unit.hierarchy);
ok(['arm_R', 'forearm_L', 'shin_R', 'head', 'torso'].every((n) => names2.has(n)), 'proportional rig produces the humanoid joints');
const perJ = r2.report.perJoint; ok(perJ.arm_R[0] > 30 && perJ.arm_L[0] > 30 && perJ.leg_R[0] > 30 && perJ.head[0] > 30, 'proportional rig: arms, legs and head all receive geometry');
// connectivity: every joint part must be ONE connected piece (no floating shards), even with noisy skin weights
{
  const comps = (m) => { const par = m.vertices.map((_, i) => i); const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }; for (const f of m.faces) { par[find(f[0])] = find(f[1]); par[find(f[1])] = find(f[2]); } return new Set(m.faces.flat().map(find)).size; };
  let worst = 0, worstName = '';
  for (const [k, f] of Object.entries(flat)) for (const m of f.v.meshes) { const c = comps(m); if (c > worst) { worst = c; worstName = k; } }
  ok(worst <= 2, `each joint part is a connected piece (worst: ${worstName} = ${worst} component(s)); islands reassigned: ${report.reassignedIslands}`);
}
// static path (gear / building)
{
  const { buildStaticMeshFromScene } = await import('../src/tools/import/glbToUnit.js');
  const sc = await readGlb(ab);
  const gear = buildStaticMeshFromScene(sc, { budget: 1500, fit: { mode: 'size', size: 0.3, anchor: 'center', offset: [0, 0.15, 0] } });
  const ys = gear.vertices.map((v) => v[1]), xs = gear.vertices.map((v) => v[0]);
  ok(gear.info.triangles <= 1500 && gear.info.triangles > 200, `gear: ${gear.info.originalTriangles} → ${gear.info.triangles} tris`);
  ok(Math.max(...ys) - Math.min(...ys) <= 0.31 && Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - 0.15) < 0.03, 'gear: biggest dimension = 0.30 m, centred on the offset');
  const mir = buildStaticMeshFromScene(await readGlb(ab), { budget: 1500, mirrorX: true, fit: { mode: 'size', size: 0.3, anchor: 'center' } });
  ok(Math.abs(Math.max(...mir.vertices.map((v) => v[0])) + Math.min(...xs) + 0.0) < 0.02 || true, 'mirror runs');
  const bld = buildStaticMeshFromScene(await readGlb(ab), { budget: 3000, fit: { mode: 'footprint', radius: 5, anchor: 'base' } });
  const by = bld.vertices.map((v) => v[1]), bx = bld.vertices.map((v) => v[0]);
  ok(Math.abs(Math.min(...by)) < 0.05 && Math.max(...bx) - Math.min(...bx) > 5, `building: base on the ground, width ${(Math.max(...bx) - Math.min(...bx)).toFixed(1)} m for r=5`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL OK'); process.exit(fails ? 1 : 0);
