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
  budgets: [6000, 1800, 500],     // triangles for LOD0, LOD1, LOD2 (whole character, before the joint skirts)
  skirtRings: 2,                  // overlap rings so joints do not open up when they bend (0 = off)
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

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const STATIC_ALPHA_CUTOFF = 128; // alpha > ~0.5 (128 / 255 = 0.502)

/**
 * Sample vertex colours for static prop/resource/building primitives:
 * For materials with a baseColorTexture, only opaque texels (alpha > ~0.5) are sampled at/near the vertex UVs;
 * transparent texels (such as black RGB=0 padding in alpha-cutout leaf cards) are ignored and fall back to
 * opaque texels inside incident triangles / local UV neighborhood or the material's baseColorFactor.
 */
export function sampleStaticPrimitiveVertexColors(prim) {
  const src = prim?.staticColorSource;
  if (!src || !src.img || !src.uv || !src.img.data || !(src.img.width > 0) || !(src.img.height > 0)) {
    return prim.colors;
  }
  const { factor = [1, 1, 1], col0 = null, uv, img } = src;
  const nv = prim.positions.length / 3;
  const W = img.width;
  const H = img.height;
  const data = img.data;
  const colors = new Uint8Array(nv * 3);

  const wrap01 = (t) => {
    if (!Number.isFinite(t)) return 0;
    const f = t - Math.floor(t);
    return f >= 1 ? 0 : f < 0 ? f + 1 : f;
  };
  const uvToPixel = (uRaw, vRaw) => {
    const u = wrap01(uRaw);
    const v = wrap01(vRaw);
    const px = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
    const py = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
    return [px, py];
  };
  const sampleAtPixel = (px, py) => {
    const o = (py * W + px) * 4;
    return [data[o], data[o + 1], data[o + 2], data[o + 3]];
  };

  // Build incident triangle list per vertex so transparent corners of leaf cards sample inside their own triangles
  const vTris = Array.from({ length: nv }, () => []);
  const indices = prim.indices || [];
  for (let f = 0; f + 2 < indices.length; f += 3) {
    const a = indices[f], b = indices[f + 1], c = indices[f + 2];
    if (a < nv) vTris[a].push(a, b, c);
    if (b < nv) vTris[b].push(b, a, c);
    if (c < nv) vTris[c].push(c, a, b);
  }

  const maxRadius = Math.min(16, Math.max(2, Math.ceil(Math.max(W, H) * 0.1)));

  for (let v = 0; v < nv; v++) {
    let r = factor[0] ?? 1;
    let g = factor[1] ?? 1;
    let b = factor[2] ?? 1;
    if (col0) {
      r *= col0.data[v * col0.size];
      g *= col0.data[v * col0.size + 1];
      b *= col0.data[v * col0.size + 2];
    }

    const u0 = uv[v * 2];
    const v0 = uv[v * 2 + 1];
    const [px0, py0] = uvToPixel(u0, v0);
    const [tr, tg, tb, ta] = sampleAtPixel(px0, py0);

    if (ta >= STATIC_ALPHA_CUTOFF) {
      r *= srgbToLinear(tr / 255);
      g *= srgbToLinear(tg / 255);
      b *= srgbToLinear(tb / 255);
    } else {
      // Sample opaque texels inside the triangles touching this vertex first (safe for texture atlases)
      let sumR = 0, sumG = 0, sumB = 0, count = 0;
      const tris = vTris[v];
      for (let t = 0; t + 2 < tris.length; t += 3) {
        const va = tris[t], vb = tris[t + 1], vc = tris[t + 2];
        const ua = uv[va * 2], wa = uv[va * 2 + 1];
        const ub = uv[vb * 2], wb = uv[vb * 2 + 1];
        const uc = uv[vc * 2], wc = uv[vc * 2 + 1];
        const steps = 4;
        for (let i = 0; i <= steps; i++) {
          for (let j = 0; j <= steps - i; j++) {
            const k = steps - i - j;
            const s = (i * ua + j * ub + k * uc) / steps;
            const q = (i * wa + j * wb + k * wc) / steps;
            const [spx, spy] = uvToPixel(s, q);
            const [sr, sg, sb, sa] = sampleAtPixel(spx, spy);
            if (sa >= STATIC_ALPHA_CUTOFF) {
              sumR += srgbToLinear(sr / 255);
              sumG += srgbToLinear(sg / 255);
              sumB += srgbToLinear(sb / 255);
              count++;
            }
          }
        }
      }

      // If incident triangles had no opaque hits (e.g. tiny isolated leaf island), check immediate local neighborhood
      if (count === 0) {
        for (let rad = 1; rad <= maxRadius && count === 0; rad++) {
          for (let dy = -rad; dy <= rad; dy++) {
            for (let dx = -rad; dx <= rad; dx++) {
              if (Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
              const nx = ((px0 + dx) % W + W) % W;
              const ny = ((py0 + dy) % H + H) % H;
              const [sr, sg, sb, sa] = sampleAtPixel(nx, ny);
              if (sa >= STATIC_ALPHA_CUTOFF) {
                sumR += srgbToLinear(sr / 255);
                sumG += srgbToLinear(sg / 255);
                sumB += srgbToLinear(sb / 255);
                count++;
              }
            }
          }
        }
      }

      if (count > 0) {
        r *= sumR / count;
        g *= sumG / count;
        b *= sumB / count;
      }
      // Otherwise: fall back directly to baseColorFactor (* COLOR_0), never black from transparent texels
    }

    colors[v * 3] = Math.round(255 * linearToSrgb(Math.max(0, Math.min(1, r))));
    colors[v * 3 + 1] = Math.round(255 * linearToSrgb(Math.max(0, Math.min(1, g))));
    colors[v * 3 + 2] = Math.round(255 * linearToSrgb(Math.max(0, Math.min(1, b))));
  }
  return colors;
}

// ------------------------------------------------------------------ gather world-space vertices
function gatherVertices(scene, rotY, staticSampling = false) {
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const rot = (p, o) => { const x = p[o], z = p[o + 2]; p[o] = x * cos + z * sin; p[o + 2] = -x * sin + z * cos; };
  let total = 0;
  for (const p of scene.primitives) total += p.positions.length / 3;
  const pos = new Float32Array(total * 3), col = new Uint8Array(total * 3);
  const idx = [];
  const bone = new Int32Array(total).fill(-1);  // node index of the dominant bone, -1 = none
  const infl = new Int32Array(total * 4).fill(-1);      // up to 4 influencing bone NODES per vertex
  const inflW = new Float32Array(total * 4);
  const primOfVertex = new Int32Array(total);
  let vo = 0;
  const tmp = [0, 0, 0];
  scene.primitives.forEach((p, pi) => {
    const n = p.positions.length / 3;
    const primColors = staticSampling ? sampleStaticPrimitiveVertexColors(p) : p.colors;
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
          infl[(vo + v) * 4 + k] = skin.joints[j]; inflW[(vo + v) * 4 + k] = w;
        }
        if (wsum > 0) { pos[(vo + v) * 3] = ox / wsum; pos[(vo + v) * 3 + 1] = oy / wsum; pos[(vo + v) * 3 + 2] = oz / wsum; }
        else { mat4Apply(nodeWorld, x, y, z, tmp); pos.set(tmp, (vo + v) * 3); }
        bone[vo + v] = bestJ >= 0 ? skin.joints[bestJ] : -1;
      } else {
        mat4Apply(nodeWorld, x, y, z, tmp);
        pos.set(tmp, (vo + v) * 3);
      }
      rot(pos, (vo + v) * 3);
      col[(vo + v) * 3] = primColors[v * 3]; col[(vo + v) * 3 + 1] = primColors[v * 3 + 1]; col[(vo + v) * 3 + 2] = primColors[v * 3 + 2];
      primOfVertex[vo + v] = pi;
    }
    for (let i = 0; i < p.indices.length; i++) idx.push(p.indices[i] + vo);
    vo += n;
  });
  return { pos, col, idx: Uint32Array.from(idx), bone, infl, inflW, primOfVertex, rot };
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
  const sideXCache = new Map();
  const nodeSideX = (node) => {
    let sx = sideXCache.get(node);
    if (sx === undefined) { const w = scene.nodes[node].world; const p = [w[12], w[13], w[14]]; g.rot(p, 0); sx = norm(p)[0]; sideXCache.set(node, sx); }
    return sx;
  };
  const vJoint = new Int16Array(nV);
  const pivotList = partNames.map((n) => pivots[n]);
  const nearestPivot = (x, y, z) => { let b = 0, bd = Infinity; pivotList.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2; if (d < bd) { bd = d; b = i; } }); return b; };
  for (let v = 0; v < nV; v++) {
    const x = g.pos[v * 3], y = g.pos[v * 3 + 1], z = g.pos[v * 3 + 2];
    if (rigMode === 'skeleton') {
      // sum the weights of every bone that belongs to the same game joint (spine + chest + clavicle all count for "torso"),
      // so a vertex goes to the joint that owns most of it, not to whichever single bone happens to be strongest
      const sums = new Map();
      for (let k = 0; k < 4; k++) {
        const node = g.infl[v * 4 + k];
        if (node < 0 || !(g.inflW[v * 4 + k] > 0)) continue;
        const part = partOfNode.get(node);
        if (!part) continue;
        const sideX = nodeSideX(node);
        const name = resolveJoint(jointName(part, sideOf(sideX)));
        sums.set(name, (sums.get(name) || 0) + g.inflW[v * 4 + k]);
      }
      let bestName = null, bw = 0;
      for (const [name, w] of sums) if (w > bw) { bw = w; bestName = name; }
      if (bestName) { vJoint[v] = nameToId.get(bestName); continue; }
      let node = -1;
      { // static prim (or unclassified bones): follow the node ancestry to a classified bone
        let cur = scene.primitives[g.primOfVertex[v]].node;
        while (cur >= 0 && !partOfNode.has(cur)) cur = scene.nodes[cur].parent;
        node = cur;
      }
      const part = node >= 0 ? partOfNode.get(node) : null;
      if (part) vJoint[v] = nameToId.get(resolveJoint(jointName(part, sideOf(nodeSideX(node)))));
      else vJoint[v] = nearestPivot(x, y, z);
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
  // --- label clean-up so the rigid parts are clean, connected pieces (no interleaved triangles / floating shards)
  let reassignedIslands = 0;
  {
    const edge = new Map();
    const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
    const nbr = Array.from({ length: nF }, () => []);
    for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) {
      const kk = key(wd.indices[f * 3 + k], wd.indices[f * 3 + (k + 1) % 3]);
      const l = edge.get(kk); if (l) l.push(f); else edge.set(kk, [f]);
    }
    for (const l of edge.values()) if (l.length === 2) { nbr[l[0]].push(l[1]); nbr[l[1]].push(l[0]); }
    // (a) majority smoothing, 3 passes: adopt the label two of my neighbours share when I disagree with most of them
    for (let pass = 0; pass < 3; pass++) {
      const next = Int16Array.from(triJoint); let changed = 0;
      for (let f = 0; f < nF; f++) {
        const cnt = new Map();
        for (const n of nbr[f]) cnt.set(triJoint[n], (cnt.get(triJoint[n]) || 0) + 1);
        const own = cnt.get(triJoint[f]) || 0;
        for (const [j, n] of cnt) if (j !== triJoint[f] && n >= 2 && n > own) { next[f] = j; changed++; break; }
      }
      triJoint.set(next);
      if (!changed) break;
    }
    // (b) islands: a small connected group of one label that is surrounded by another label belongs to that other label
    const comp = new Int32Array(nF).fill(-1);
    const sizeOfLabel = new Map();
    for (let f = 0; f < nF; f++) sizeOfLabel.set(triJoint[f], (sizeOfLabel.get(triJoint[f]) || 0) + 1);
    let nComp = 0;
    for (let f0 = 0; f0 < nF; f0++) {
      if (comp[f0] >= 0) continue;
      const members = [f0]; comp[f0] = nComp;
      for (let i = 0; i < members.length; i++) for (const n of nbr[members[i]]) if (comp[n] < 0 && triJoint[n] === triJoint[f0]) { comp[n] = nComp; members.push(n); }
      const label = triJoint[f0];
      const limit = Math.max(12, Math.round(0.04 * (sizeOfLabel.get(label) || 0)));
      if (members.length <= limit) {
        const touch = new Map();
        for (const m of members) for (const n of nbr[m]) if (triJoint[n] !== label) touch.set(triJoint[n], (touch.get(triJoint[n]) || 0) + 1);
        let best = -1, bc = 0; for (const [j, c] of touch) if (c > bc) { bc = c; best = j; }
        if (best >= 0) { for (const m of members) triJoint[m] = best; reassignedIslands++; }
      }
      nComp++;
    }
  }
  // vertex usage by joint is no longer needed: seams are handled by the labelled decimation below
  const originalTris = scene.primitives.reduce((s, p) => s + p.indices.length / 3, 0);

  // --- LODs: the WHOLE welded character is decimated at once, with every triangle labelled by its joint part, so the
  //     vertices shared by two parts (the joint seams) are reduced consistently on both sides: no cracks while limbs rotate.
  const sizes0 = new Array(partNames.length).fill(0);
  for (let f = 0; f < nF; f++) sizes0[triJoint[f]]++;
  /**
   * Splits a decimated, labelled mesh into per-joint parts. Rigid parts tear open when a joint bends, so every part also
   * gets a "skirt": the triangles of the neighbouring parts within `skirtRings` rings of the seam. At rest they lie exactly
   * on top of the neighbour's own surface (same position, colour and normal → invisible); when the joint rotates the skirt
   * keeps covering the gap, like the sleeve of a sleeve-joint.
   */
  const splitByPart = (m) => {
    const nFm = m.indices.length / 3;
    const vFaces = new Map();
    for (let f = 0; f < nFm; f++) for (let k = 0; k < 3; k++) { const v = m.indices[f * 3 + k]; (vFaces.get(v) || vFaces.set(v, []).get(v)).push(f); }
    const P = partNames.map(() => ({ gv: new Map(), pos: [], col: [], idx: [], nClean: 0 }));
    const addFace = (Q, f) => {
      for (let k = 0; k < 3; k++) {
        const v = m.indices[f * 3 + k];
        let l = Q.gv.get(v);
        if (l === undefined) { l = Q.pos.length / 3; Q.gv.set(v, l); Q.pos.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); Q.col.push(m.colors[v * 3], m.colors[v * 3 + 1], m.colors[v * 3 + 2]); }
        Q.idx.push(l);
      }
    };
    for (let f = 0; f < nFm; f++) addFace(P[m.labels[f]], f);
    P.forEach((Q) => { Q.nClean = Q.idx.length; });
    const rings = o.skirtRings | 0;
    if (rings > 0) {
      P.forEach((Q, label) => {
        if (!Q.nClean) return;
        const inPart = new Set(Q.gv.keys());
        // seam vertices of this part = its vertices that also touch a face of another part
        let frontier = new Set();
        for (const v of inPart) if (vFaces.get(v).some((f) => m.labels[f] !== label)) frontier.add(v);
        const taken = new Set();
        for (let r = 0; r < rings; r++) {
          const next = new Set();
          for (const v of frontier) for (const f of vFaces.get(v)) {
            if (m.labels[f] === label || taken.has(f)) continue;
            taken.add(f);
            for (let k = 0; k < 3; k++) next.add(m.indices[f * 3 + k]);
          }
          frontier = next;
        }
        for (const f of taken) addFace(Q, f);
      });
    }
    return P.map((Q) => ({ positions: Float32Array.from(Q.pos), colors: Uint8Array.from(Q.col), indices: Uint32Array.from(Q.idx), nClean: Q.nClean }));
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
      for (let f = 0; f < m.nClean; f += 3) { // clean faces only: the skirt duplicates must not double-weight the seam normals
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
  return { unit, report: { rigMode, originalTris, lodTris, perJoint, warnings, joints: partNames, reassignedIslands } };
}

// =====================================================================================================================
// STATIC MODELS (armor / helmets / props / BUILDINGS): no skeleton, no joint cutting — one mesh, normalised and reduced.
// =====================================================================================================================
function ensureSkinMats(scene) {
  if (scene.skinMats) return;
  scene.skinMats = scene.skins.map((s) => s.joints.map((jn, i) => {
    const jw = scene.nodes[jn].world, ib = s.inverseBind[i], m = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let v = 0; for (let k = 0; k < 4; k++) v += jw[k * 4 + r] * ib[c * 4 + k]; m[c * 4 + r] = v; }
    return m;
  }));
}

/**
 * @param scene   result of readGlb()
 * @param opts    {
 *   rotateYDeg, budget (triangles),
 *   fit: { mode:'size', size:m, anchor:'center'|'base', offset:[x,y,z] }      // gear: biggest dimension = size
 *      | { mode:'footprint', radius:m, anchor:'base', scale:1 },               // building: footprint ≈ 1.5 × radius
 *   mirrorX (for the left-hand twin of a pair), smoothNormals
 * }
 * @returns {{ vertices:number[][], faces:number[][], colors:number[][], normals:number[][]|null,
 *             info:{ originalTriangles, triangles, size:[x,y,z], scale } , warnings:string[] }}
 */
export function buildStaticMeshFromScene(scene, opts = {}) {
  const o = { rotateYDeg: 0, budget: 6000, fit: { mode: 'size', size: 0.3, anchor: 'center', offset: [0, 0, 0] }, mirrorX: false, smoothNormals: true, ...opts };
  ensureSkinMats(scene);
  const g = gatherVertices(scene, (o.rotateYDeg * Math.PI) / 180, true);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], g.pos[i + k]); max[k] = Math.max(max[k], g.pos[i + k]); }
  const dim = max.map((v, k) => v - min[k]);
  if (!(Math.max(...dim) > 1e-9)) throw new Error('The model is empty.');
  const f = o.fit || {};
  let S;
  if (f.mode === 'footprint') S = ((1.5 * f.radius) / Math.max(dim[0], dim[2], 1e-9)) * (f.scale ?? 1);
  else S = f.size / Math.max(...dim);
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  const cy = f.anchor === 'base' ? min[1] : (min[1] + max[1]) / 2;
  const off = f.offset || [0, 0, 0];
  for (let i = 0; i < g.pos.length; i += 3) {
    g.pos[i] = (g.pos[i] - cx) * S + off[0];
    g.pos[i + 1] = (g.pos[i + 1] - cy) * S + off[1];
    g.pos[i + 2] = (g.pos[i + 2] - cz) * S + off[2];
  }
  const diag = Math.hypot(...dim) * S;
  const wd = weldByPosition(g.pos, g.col, g.idx, 1e-5 * Math.max(diag, 1e-3));
  const originalTriangles = scene.primitives.reduce((s, p) => s + p.indices.length / 3, 0);
  const res = simplifyMesh({ positions: wd.positions, colors: wd.colors, indices: wd.indices }, Math.min(o.budget, wd.indices.length / 3));
  const nV = res.positions.length / 3;
  const sign = o.mirrorX ? -1 : 1;
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  const vertices = Array.from({ length: nV }, (_, v) => [r4(sign * res.positions[v * 3]), r4(res.positions[v * 3 + 1]), r4(res.positions[v * 3 + 2])]);
  const faces = [];
  for (let t = 0; t < res.indices.length; t += 3) faces.push(o.mirrorX ? [res.indices[t], res.indices[t + 2], res.indices[t + 1]] : [res.indices[t], res.indices[t + 1], res.indices[t + 2]]);
  const colors = Array.from({ length: nV }, (_, v) => [res.colors[v * 3], res.colors[v * 3 + 1], res.colors[v * 3 + 2]]);
  let normals = null;
  if (o.smoothNormals) {
    const acc = Array.from({ length: nV }, () => [0, 0, 0]);
    for (const [a, b, c] of faces) {
      const A = vertices[a], B = vertices[b], C = vertices[c];
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      for (const i of [a, b, c]) { acc[i][0] += n[0]; acc[i][1] += n[1]; acc[i][2] += n[2]; }
    }
    normals = acc.map((e) => { const l = Math.hypot(...e) || 1; return [+(e[0] / l).toFixed(3), +(e[1] / l).toFixed(3), +(e[2] / l).toFixed(3)]; });
  }
  return {
    vertices, faces, colors, normals, warnings: [...(scene.warnings || [])],
    info: { originalTriangles, triangles: faces.length, size: dim.map((d) => r4(d * S)), scale: S }
  };
}
