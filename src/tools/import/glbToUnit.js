/**
 * Kings Lands — GLB → units.json converter (+ automatic polygon reduction / LODs).
 * (src/tools/import/glbToUnit.js)
 *
 * What it does, in order:
 *   1. read a rigged (or static) humanoid scene from `readGlb()`;
 *   2. normalise it (height, feet on the floor, centred, facing +Z);
 *   3. map the skeleton to the game joints (pelvis, torso, head, arm/forearm/hand, leg/shin/foot, L/R) — by bone NAME for
 *      Mixamo / Blender / Rigify / VRM / CC4 style rigs, or by BODY PROPORTIONS when the model has no usable skeleton
 *      (a static mesh gets an automatic humanoid rig — pivots can then be fixed in the Studio "Rig" mode);
 *   4. cut the skin into RIGID PARTS (each triangle goes to the joint that owns most of its weight) — this is the same
 *      structure the game already renders (one baked geometry per joint, instanced) so Animator3D / the Studio timeline /
 *      the instancing batcher work unchanged;
 *   5. decimate every part with locked seams → LOD0 (the model) + LOD1 + LOD2 for the game camera;
 *   6. return a `units.json` unit record.
 *
 * Pure data in / pure data out: no three.js, runs in the browser and in node.
 */
import { mat4Apply } from './glbReader.js';
import { weldByPosition, simplifyMesh } from './meshSimplify.js';

export const DEFAULT_IMPORT_OPTIONS = Object.freeze({
  id: 'imported_unit',
  displayName: 'Imported unit',
  race: 'imported',
  targetHeight: 1.9,              // metres of the unit BEFORE `scale`
  scale: 1.0,
  rotateYDeg: 0,                  // 180 if the model comes out facing backwards
  budgets: [3500, 1000, 280],     // triangles for LOD0, LOD1, LOD2 (whole character)
  minPartTris: [24, 10, 4],       // floor per joint part, per LOD
  smoothNormals: true,            // one normal per vertex across all parts (no seams while the arms rotate)
  metalness: 0.08,
  roughness: 0.82,
  forceProportionalRig: false     // ignore the skeleton in the file, rig by body proportions
});

const SIDE_TOKENS = new Set(['left', 'right', 'l', 'r', 'lf', 'rt']);
const IGNORE_TOKENS = new Set(['mixamorig', 'mixamorig1', 'mixamorig2', 'armature', 'bip01', 'bip', 'cc', 'base', 'def', 'org', 'mch', 'j', 'bone']);

/** 'mixamorig:LeftUpLeg' → 'upleg'. Returns { part, compact }. part = game joint base name or null. */
export function classifyBoneName(name, rigHasThigh = false) {
  const d = String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const tokens = d.split('_').filter((t) => t && !SIDE_TOKENS.has(t) && !IGNORE_TOKENS.has(t) && !/^mixamorig\d*$/.test(t));
  const c = tokens.join('');
  let part = null;
  if (/thumb|index|middle|ring|pinky|finger|digit/.test(c)) part = 'hand';
  else if (/toe|ball|foot|ankle/.test(c)) part = 'foot';
  else if (/forearm|lowerarm|lowarm|elbow|radius|ulna/.test(c)) part = 'forearm';
  else if (/hand|wrist|palm/.test(c)) part = 'hand';
  else if (/upperarm|uparm|humerus|^arm\d*$/.test(c)) part = 'arm';
  else if (/shoulder|clavicle|collar|scapula/.test(c)) part = 'torso';
  else if (/lowerleg|lowleg|calf|shin|tibia|knee/.test(c)) part = 'shin';
  else if (/upleg|upperleg|thigh|femur/.test(c)) part = 'leg';
  else if (/^leg\d*$/.test(c)) part = rigHasThigh ? 'shin' : 'leg'; // Mixamo: "Leg" is the shin, "UpLeg" the thigh
  else if (/neck|head|skull|jaw|eye|hair|ear|brow|face|tongue|teeth/.test(c)) part = 'head';
  else if (/hip|pelvis/.test(c)) part = 'pelvis';
  else if (/spine|chest|torso|abdomen|waist|stomach|belly|rib/.test(c)) part = 'torso';
  return { part, compact: c };
}

const LIMB = new Set(['arm', 'forearm', 'hand', 'leg', 'shin', 'foot']);
const sideOf = (x) => (x > 0 ? 'R' : 'L'); // the game's convention: +x is the "_R" limb (see units.json)
const jointName = (part, side) => (LIMB.has(part) ? `${part}_${side}` : part);

// ------------------------------------------------------------------ gather world-space vertices
function gatherVertices(scene, rotY) {
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const rot = (p, o) => { const x = p[o], z = p[o + 2]; p[o] = x * cos + z * sin; p[o + 2] = -x * sin + z * cos; };
  let total = 0;
  for (const p of scene.primitives) total += p.positions.length / 3;
  const pos = new Float32Array(total * 3), col = new Uint8Array(total * 3);
  const idx = [];
  const bone = new Int32Array(total).fill(-1);  // node index of the dominant bone, -1 = none
  const primOfVertex = new Int32Array(total);
  let vo = 0;
  const tmp = [0, 0, 0];
  scene.primitives.forEach((p, pi) => {
    const n = p.positions.length / 3;
    const skin = p.skin >= 0 && p.joints && p.weights ? scene.skins[p.skin] : null;
    const nodeWorld = scene.nodes[p.node].world;
    for (let v = 0; v < n; v++) {
      const x = p.positions[v * 3], y = p.positions[v * 3 + 1], z = p.positions[v * 3 + 2];
      if (skin) {
        // rest pose skinning: Σ w · (jointWorld · inverseBind) · v   (== identity for a bind pose, but correct otherwise)
        let ox = 0, oy = 0, oz = 0, wsum = 0, bestW = -1, bestJ = -1;
        for (let k = 0; k < 4; k++) {
          const w = p.weights[v * 4 + k]; if (w <= 0) continue;
          const j = p.joints[v * 4 + k];
          const m = scene.skinMats?.[p.skin]?.[j];
          mat4Apply(m, x, y, z, tmp);
          ox += tmp[0] * w; oy += tmp[1] * w; oz += tmp[2] * w; wsum += w;
          if (w > bestW) { bestW = w; bestJ = j; }
        }
        if (wsum > 0) { pos[(vo + v) * 3] = ox / wsum; pos[(vo + v) * 3 + 1] = oy / wsum; pos[(vo + v) * 3 + 2] = oz / wsum; }
        else { mat4Apply(nodeWorld, x, y, z, tmp); pos.set(tmp, (vo + v) * 3); }
        bone[vo + v] = bestJ >= 0 ? skin.joints[bestJ] : -1;
      } else {
        mat4Apply(nodeWorld, x, y, z, tmp);
        pos.set(tmp, (vo + v) * 3);
      }
      rot(pos, (vo + v) * 3);
      col[(vo + v) * 3] = p.colors[v * 3]; col[(vo + v) * 3 + 1] = p.colors[v * 3 + 1]; col[(vo + v) * 3 + 2] = p.colors[v * 3 + 2];
      primOfVertex[vo + v] = pi;
    }
    for (let i = 0; i < p.indices.length; i++) idx.push(p.indices[i] + vo);
    vo += n;
  });
  return { pos, col, idx: Uint32Array.from(idx), bone, primOfVertex, rot };
}

// ------------------------------------------------------------------ humanoid skeleton mapping (by names)
function mapSkeletonByNames(scene, norm, rot) {
  const info = new Map(); // node → { part, x, y, z, depth }
  const used = new Set();
  scene.skins.forEach((s) => s.joints.forEach((j) => used.add(j)));
  const rigHasThigh = [...used].some((n) => /upleg|upperleg|thigh|femur/.test(classifyBoneName(scene.nodes[n].name).compact));
  const depthOf = (n) => { let d = 0; for (let p = scene.nodes[n].parent; p >= 0; p = scene.nodes[p].parent) d++; return d; };
  for (const n of used) {
    const w = scene.nodes[n].world;
    const p = [w[12], w[13], w[14]]; rot(p, 0);
    const q = norm(p);
    info.set(n, { node: n, ...classifyBoneName(scene.nodes[n].name, rigHasThigh), head: q, depth: depthOf(n) });
  }
  // unclassified bones (twist, cloth, tail…) inherit the part of the nearest classified ancestor
  const partOfNode = new Map();
  for (const n of used) {
    let cur = n, part = null;
    while (cur >= 0 && !part) { part = info.get(cur)?.part || null; cur = scene.nodes[cur].parent; }
    partOfNode.set(n, part);
  }
  // pivots
  const cand = new Map(); // jointName → [bone infos]
  for (const n of used) {
    const i = info.get(n);
    if (!i.part) continue; // pivot only from bones that are themselves classified
    const key = jointName(i.part, sideOf(i.head[0]));
    if (!cand.has(key)) cand.set(key, []);
    cand.get(key).push(i);
  }
  const pivots = {};
  for (const [k, list] of cand) { list.sort((a, b) => a.depth - b.depth || b.head[1] - a.head[1]); pivots[k] = list[0].head; }
  const need = ['torso', 'head', 'arm_R', 'arm_L', 'leg_R', 'leg_L'];
  const missing = need.filter((k) => !pivots[k]);
  return { partOfNode, pivots, missing, info };
}

// ------------------------------------------------------------------ automatic humanoid rig from proportions
/** Pivots + capsules for a humanoid of height H standing at y=0. armAngle: 0 = arms down … 90° = T-pose. */
export function proportionalRig(H, armAngleDeg) {
  const th = (armAngleDeg * Math.PI) / 180;
  const pivots = {}, caps = [];
  pivots.pelvis = [0, 0.53 * H, 0];
  pivots.torso = [0, 0.57 * H, 0];
  pivots.head = [0, 0.835 * H, 0];
  const add = (part, a, b, r, side) => caps.push({ key: jointName(part, side), a, b, r: r * H });
  add('pelvis', [0, 0.50 * H, 0], [0, 0.56 * H, 0], 0.10);
  add('torso', [0, 0.57 * H, 0], [0, 0.80 * H, 0], 0.11);
  add('head', [0, 0.835 * H, 0], [0, 0.96 * H, 0], 0.075);
  for (const s of [1, -1]) {
    const side = s > 0 ? 'R' : 'L';
    const dirx = s * Math.sin(th), diry = -Math.cos(th);
    const sh = [s * 0.115 * H, 0.82 * H, 0];
    const el = [sh[0] + dirx * 0.17 * H, sh[1] + diry * 0.17 * H, 0];
    const wr = [el[0] + dirx * 0.15 * H, el[1] + diry * 0.15 * H, 0];
    const hd = [wr[0] + dirx * 0.09 * H, wr[1] + diry * 0.09 * H, 0];
    pivots[`arm_${side}`] = sh; pivots[`forearm_${side}`] = el; pivots[`hand_${side}`] = wr;
    add('arm', sh, el, 0.04, side); add('forearm', el, wr, 0.032, side); add('hand', wr, hd, 0.035, side);
    const hip = [s * 0.06 * H, 0.52 * H, 0], kn = [s * 0.06 * H, 0.28 * H, 0], an = [s * 0.06 * H, 0.045 * H, 0], toe = [s * 0.06 * H, 0.02 * H, 0.07 * H];
    pivots[`leg_${side}`] = hip; pivots[`shin_${side}`] = kn; pivots[`foot_${side}`] = an;
    add('leg', hip, kn, 0.055, side); add('shin', kn, an, 0.045, side); add('foot', an, toe, 0.04, side);
  }
  return { pivots, caps };
}
function distToSeg(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const l2 = abx * abx + aby * aby + abz * abz || 1e-9;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / l2));
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}

// ------------------------------------------------------------------ main
/**
 * @param {Awaited<ReturnType<import('./glbReader.js').readGlb>>} scene
 * @param {Partial<typeof DEFAULT_IMPORT_OPTIONS>} [options]
 */
export function buildUnitFromScene(scene, options = {}) {
  const o = { ...DEFAULT_IMPORT_OPTIONS, ...options };
  const warnings = [...(scene.warnings || [])];
  // skin matrices (jointWorld · inverseBind), computed once
  scene.skinMats = scene.skins.map((s) => s.joints.map((jn, i) => {
    const jw = scene.nodes[jn].world, ib = s.inverseBind[i], m = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += jw[k * 4 + r] * ib[c * 4 + k]; m[c * 4 + r] = v; }
    return m;
  }));

  const g = gatherVertices(scene, (o.rotateYDeg * Math.PI) / 180);
  // --- normalise: height, feet on the floor, centred
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < g.pos.length; i += 3) {
    minX = Math.min(minX, g.pos[i]); maxX = Math.max(maxX, g.pos[i]);
    minY = Math.min(minY, g.pos[i + 1]); maxY = Math.max(maxY, g.pos[i + 1]);
    minZ = Math.min(minZ, g.pos[i + 2]); maxZ = Math.max(maxZ, g.pos[i + 2]);
  }
  const H0 = maxY - minY;
  if (!(H0 > 1e-6)) throw new Error('The model has no height.');
  const S = o.targetHeight / H0, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const norm = (p) => [(p[0] - cx) * S, (p[1] - minY) * S, (p[2] - cz) * S];
  for (let i = 0; i < g.pos.length; i += 3) {
    g.pos[i] = (g.pos[i] - cx) * S; g.pos[i + 1] = (g.pos[i + 1] - minY) * S; g.pos[i + 2] = (g.pos[i + 2] - cz) * S;
  }
  const H = o.targetHeight;
  const nV = g.pos.length / 3;

  // --- skeleton → game joints
  let rigMode = 'skeleton', pivots, partOfNode = null, caps = null;
  const skel = scene.skins.length && !o.forceProportionalRig ? mapSkeletonByNames(scene, norm, g.rot) : null;
  if (skel && !skel.missing.length) {
    pivots = skel.pivots; partOfNode = skel.partOfNode;
  } else {
    rigMode = 'proportional';
    if (skel) warnings.push(`Skeleton is not a recognised humanoid (missing: ${skel.missing.join(', ')}). Rigged by body proportions instead.`);
    else if (!o.forceProportionalRig) warnings.push('No skeleton in the file: rigged automatically by body proportions. Fix the pivots in the Studio (Rig mode).');
    const width = (maxX - minX) * S;
    const ratio = width / H;
    const armAngle = ratio > 0.75 ? 90 : ratio > 0.45 ? 40 : 8;
    ({ pivots, caps } = proportionalRig(H, armAngle));
    warnings.push(`Arm pose guessed: ${armAngle === 90 ? 'T-pose' : armAngle === 40 ? 'A-pose' : 'arms down'}.`);
  }
  // optional joints missing in a skeleton rig → their vertices fall into the parent joint
  const PARENT = {
    pelvis: null, torso: 'pelvis', head: 'torso',
    arm_R: 'torso', forearm_R: 'arm_R', hand_R: 'forearm_R', arm_L: 'torso', forearm_L: 'arm_L', hand_L: 'forearm_L',
    leg_R: 'pelvis', shin_R: 'leg_R', foot_R: 'shin_R', leg_L: 'pelvis', shin_L: 'leg_L', foot_L: 'shin_L'
  };
  if (!pivots.pelvis) pivots.pelvis = [pivots.torso[0], pivots.torso[1] - 0.06 * H, pivots.torso[2]];
  const present = (k) => !!pivots[k];
  const resolveJoint = (k) => { while (k && !present(k)) k = PARENT[k]; return k || 'pelvis'; };

  // --- vertex → joint
  const partNames = Object.keys(PARENT).filter(present);
  const nameToId = new Map(partNames.map((n, i) => [n, i]));
  const vJoint = new Int16Array(nV);
  const pivotList = partNames.map((n) => pivots[n]);
  const nearestPivot = (x, y, z) => { let b = 0, bd = Infinity; pivotList.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2; if (d < bd) { bd = d; b = i; } }); return b; };
  for (let v = 0; v < nV; v++) {
    const x = g.pos[v * 3], y = g.pos[v * 3 + 1], z = g.pos[v * 3 + 2];
    if (rigMode === 'skeleton') {
      let part = null, node = g.bone[v];
      if (node < 0) { // static prim: follow its node ancestry to a classified bone
        let cur = scene.primitives[g.primOfVertex[v]].node;
        while (cur >= 0 && !partOfNode.has(cur)) cur = scene.nodes[cur].parent;
        node = cur;
      }
      part = node >= 0 ? partOfNode.get(node) : null;
      if (part) {
        const w = scene.nodes[node].world; const p = [w[12], w[13], w[14]]; g.rot(p, 0);
        const side = sideOf(norm(p)[0]);
        vJoint[v] = nameToId.get(resolveJoint(jointName(part, side)));
      } else vJoint[v] = nearestPivot(x, y, z);
    } else {
      let best = 'pelvis', bd = Infinity;
      for (const c of caps) {
        if (!present(c.key)) continue;
        const d = distToSeg([x, y, z], c.a, c.b) / c.r;
        if (d < bd) { bd = d; best = c.key; }
      }
      vJoint[v] = nameToId.get(resolveJoint(best));
    }
  }

  // --- weld (UV / normal seams) and cut into rigid parts
  const wd = weldByPosition(g.pos, g.col, g.idx, 1e-5 * H);
  const wJoint = new Int16Array(wd.positions.length / 3);
  for (let v = 0; v < nV; v++) wJoint[wd.map[v]] = vJoint[v];
  const nF = wd.indices.length / 3;
  const triJoint = new Int16Array(nF);
  for (let f = 0; f < nF; f++) {
    const a = wJoint[wd.indices[f * 3]], b = wJoint[wd.indices[f * 3 + 1]], c = wJoint[wd.indices[f * 3 + 2]];
    triJoint[f] = a === b || a === c ? a : b === c ? b : a;
  }
  // smoothing: a triangle whose neighbours (≥2 edges) all agree on another joint adopts it (kills 1-triangle islands)
  {
    const edge = new Map();
    const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
    for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) {
      const kk = key(wd.indices[f * 3 + k], wd.indices[f * 3 + (k + 1) % 3]);
      const l = edge.get(kk); if (l) l.push(f); else edge.set(kk, [f]);
    }
    const next = Int16Array.from(triJoint);
    for (let f = 0; f < nF; f++) {
      const votes = new Map();
      for (let k = 0; k < 3; k++) for (const nf of edge.get(key(wd.indices[f * 3 + k], wd.indices[f * 3 + (k + 1) % 3])) || []) if (nf !== f) votes.set(triJoint[nf], (votes.get(triJoint[nf]) || 0) + 1);
      for (const [j, n] of votes) if (n >= 2 && j !== triJoint[f] && !votes.has(triJoint[f])) { next[f] = j; break; }
    }
    triJoint.set(next);
  }
  const originalTris = scene.primitives.reduce((s, p) => s + p.indices.length / 3, 0);

  // --- LODs: the WHOLE welded character is decimated at once, with every triangle labelled by its joint part, so the
  //     vertices shared by two parts (the joint seams) are reduced consistently on both sides: no cracks while limbs rotate.
  const sizes0 = new Array(partNames.length).fill(0);
  for (let f = 0; f < nF; f++) sizes0[triJoint[f]]++;
  const splitByPart = (m) => {
    const P = partNames.map(() => ({ gv: new Map(), pos: [], col: [], idx: [] }));
    for (let f = 0; f < m.indices.length / 3; f++) {
      const Q = P[m.labels[f]];
      for (let k = 0; k < 3; k++) {
        const v = m.indices[f * 3 + k];
        let l = Q.gv.get(v);
        if (l === undefined) { l = Q.pos.length / 3; Q.gv.set(v, l); Q.pos.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); Q.col.push(m.colors[v * 3], m.colors[v * 3 + 1], m.colors[v * 3 + 2]); }
        Q.idx.push(l);
      }
    }
    return P.map((Q) => ({ positions: Float32Array.from(Q.pos), colors: Uint8Array.from(Q.col), indices: Uint32Array.from(Q.idx) }));
  };
  // cascade: LOD0 is cut from the original, LOD1 from LOD0, LOD2 from LOD1 (much faster, same quality at these ratios)
  let cursor = { positions: wd.positions, colors: wd.colors, indices: wd.indices, labels: triJoint };
  const lodParts = o.budgets.map((budget, lod) => {
    const minPerLabel = Int32Array.from(sizes0, (n) => Math.min(n, o.minPartTris[lod] ?? 4));
    cursor = simplifyMesh({ ...cursor, minPerLabel }, Math.min(budget, cursor.indices.length / 3));
    return splitByPart(cursor);
  });

  // --- shared normals (identical for seam vertices of neighbouring parts)
  const jointWorld = (name) => pivots[name];
  const normalsFor = (lodIdx) => {
    const acc = new Map(); const q = 1 / (1e-4 * H);
    const k3 = (x, y, z) => `${Math.round(x * q)}|${Math.round(y * q)}|${Math.round(z * q)}`;
    lodParts[lodIdx].forEach((m) => {
      if (!m.indices || !m.indices.length) return;
      for (let f = 0; f < m.indices.length; f += 3) {
        const a = m.indices[f] * 3, b = m.indices[f + 1] * 3, c = m.indices[f + 2] * 3;
        const ux = m.positions[b] - m.positions[a], uy = m.positions[b + 1] - m.positions[a + 1], uz = m.positions[b + 2] - m.positions[a + 2];
        const vx = m.positions[c] - m.positions[a], vy = m.positions[c + 1] - m.positions[a + 1], vz = m.positions[c + 2] - m.positions[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const o3 of [a, b, c]) {
          const kk = k3(m.positions[o3], m.positions[o3 + 1], m.positions[o3 + 2]);
          const e = acc.get(kk) || [0, 0, 0]; e[0] += nx; e[1] += ny; e[2] += nz; acc.set(kk, e);
        }
      }
    });
    return lodParts[lodIdx].map((m) => {
      const out = [];
      for (let v = 0; v < m.positions.length; v += 3) {
        const e = acc.get(k3(m.positions[v], m.positions[v + 1], m.positions[v + 2])) || [0, 1, 0];
        const l = Math.hypot(e[0], e[1], e[2]) || 1;
        out.push([+(e[0] / l).toFixed(3), +(e[1] / l).toFixed(3), +(e[2] / l).toFixed(3)]);
      }
      return out;
    });
  };

  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  const nrm = o.smoothNormals ? o.budgets.map((_, l) => normalsFor(l)) : null;
  const emit = (lod, i) => {
    const m = lodParts[lod][i];
    if (!m.indices.length) return null;
    const pv = jointWorld(partNames[i]);
    const part = {
      name: `${partNames[i]}_import`, shape: 'mesh', pos: [0, 0, 0],
      vertices: Array.from({ length: m.positions.length / 3 }, (_, v) => [r4(m.positions[v * 3] - pv[0]), r4(m.positions[v * 3 + 1] - pv[1]), r4(m.positions[v * 3 + 2] - pv[2])]),
      faces: Array.from({ length: m.indices.length / 3 }, (_, f) => [m.indices[f * 3], m.indices[f * 3 + 1], m.indices[f * 3 + 2]]),
      colors: Array.from({ length: m.colors.length / 3 }, (_, v) => [m.colors[v * 3], m.colors[v * 3 + 1], m.colors[v * 3 + 2]]),
      color: '#ffffff', metalness: o.metalness, roughness: o.roughness
    };
    if (nrm) { part.smooth = true; part.normals = nrm[lod][i]; }
    return part;
  };

  // --- hierarchy (positions are relative to the parent joint, rotations stay 0: animations are relative to rest)
  const rel = (name) => {
    const p = pivots[name], par = PARENT[name] && resolveJoint(PARENT[name]);
    const pp = par ? pivots[par] : [0, 0, 0];
    return [r4(p[0] - pp[0]), r4(p[1] - pp[1]), r4(p[2] - pp[2])];
  };
  const k = H / 1.9;
  const hier = {};
  const nodeOf = {};
  for (const name of partNames) {
    const i = nameToId.get(name), mesh = emit(0, i);
    nodeOf[name] = { pos: rel(name), meshes: mesh ? [mesh] : [], children: {} };
  }
  for (const name of partNames) if (name !== 'pelvis') nodeOf[resolveJoint(PARENT[name])].children[name] = nodeOf[name];
  nodeOf.pelvis.pos = [r4(pivots.pelvis[0]), r4(pivots.pelvis[1]), r4(pivots.pelvis[2])];
  for (const s of ['R', 'L']) {
    const hand = nodeOf[`hand_${s}`] || nodeOf[`forearm_${s}`] || nodeOf[`arm_${s}`];
    if (hand) hand.children[`weapon_socket_${s}`] = { pos: [0, r4(-0.09 * k), r4(0.045 * k)], meshes: [], children: {} };
    nodeOf.pelvis.children[`stow_hip_${s}`] = { pos: [s === 'R' ? 0.2 * k : -0.2 * k, r4(-0.02 * k), 0], meshes: [], children: {} };
  }
  if (nodeOf.torso) nodeOf.torso.children.stow_back = { pos: [0, r4(0.35 * k), r4(-0.17 * k)], meshes: [], children: {} };
  hier.pelvis = nodeOf.pelvis;

  // --- lower LODs: same joints, lighter geometry
  const lods = {};
  for (let lod = 1; lod < o.budgets.length; lod++) {
    const entry = {};
    partNames.forEach((name, i) => { const m = emit(lod, i); if (m) entry[name] = [m]; });
    lods[lod] = entry;
  }
  const lodTris = lodParts.map((L) => L.reduce((s, m) => s + (m.indices ? m.indices.length / 3 : 0), 0));
  const perJoint = {};
  partNames.forEach((n, i) => { perJoint[n] = lodParts.map((L) => (L[i].indices ? L[i].indices.length / 3 : 0)); });

  const unit = {
    id: o.id, race: o.race, displayName: o.displayName,
    type: 'procedural_3d', gltfUrl: null, scale: o.scale,
    selectionRingRadius: Math.max(0.5, r4((maxX - minX) * S * 0.55 + 0.1)),
    bannerStyle: 'royal_standard', locomotionAnim: 'walk', combatAnim: 'attack_slash',
    equipment: {}, hierarchy: hier, colorOverrides: {}, skins: {},
    lods,
    importInfo: { source: o.sourceName || null, rigMode, originalTriangles: originalTris, lodTriangles: lodTris, importedAt: new Date().toISOString() }
  };
  return { unit, report: { rigMode, originalTris, lodTris, perJoint, warnings, joints: partNames } };
}
