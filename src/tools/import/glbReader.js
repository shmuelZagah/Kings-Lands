/**
 * Kings Lands — GLB reader (no dependencies, works in the browser and in node).
 * (src/tools/import/glbReader.js)
 *
 * Reads a binary glTF (.glb) and returns a plain-data "scene":
 *   nodes[]       { name, parent, children, world(Float64Array16) }   world = REST pose (bind pose) matrix
 *   skins[]       { joints:[nodeIndex], inverseBind:[Float64Array16] }
 *   primitives[]  { node, skin, positions, normals, indices, colors(rgb 0..255 sRGB), joints, weights }
 *
 * Colours: baseColorFactor × COLOR_0 × baseColorTexture (sampled at the vertex UV) are baked into ONE sRGB colour per
 * vertex, because the game renders units with vertex colours (see unitInstancingBatcher.mergeBakedJointGeometry).
 * Textures are decoded with the optional `decodeImage` hook (a browser default is provided by `browserDecodeImage`).
 *
 * Not supported (a clear error is thrown): Draco / meshopt compressed meshes, sparse accessors.
 */

const COMPONENT = {
  5120: [Int8Array, 1, 127], 5121: [Uint8Array, 1, 255], 5122: [Int16Array, 2, 32767],
  5123: [Uint16Array, 2, 65535], 5125: [Uint32Array, 4, 1], 5126: [Float32Array, 4, 1]
};
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// ------------------------------------------------------------------ tiny mat4 (column-major, like glTF / three)
export function mat4Identity() { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
export function mat4Mul(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
export function mat4FromTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * s[0]; m[1] = (xy + wz) * s[0]; m[2] = (xz - wy) * s[0];
  m[4] = (xy - wz) * s[1]; m[5] = (1 - (xx + zz)) * s[1]; m[6] = (yz + wx) * s[1];
  m[8] = (xz + wy) * s[2]; m[9] = (yz - wx) * s[2]; m[10] = (1 - (xx + yy)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}
export function mat4Invert(m) {
  const inv = new Float64Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return mat4Identity();
  det = 1 / det;
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return inv;
}
export function mat4Apply(m, x, y, z, out, o = 0) {
  out[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// ------------------------------------------------------------------ container
export function parseGlbContainer(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) {
    throw new Error('Not a .glb file (bad magic). Export as "glTF Binary (.glb)".');
  }
  const total = Math.min(dv.getUint32(8, true), arrayBuffer.byteLength);
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, len)));
    else if (type === 0x004e4942 && !bin) bin = new Uint8Array(arrayBuffer, start, len);
    off = start + ((len + 3) & ~3);
  }
  if (!json) throw new Error('GLB has no JSON chunk.');
  return { json, bin };
}

function unsupported(json) {
  const used = new Set([...(json.extensionsRequired || []), ...(json.extensionsUsed || [])]);
  if (used.has('KHR_draco_mesh_compression')) throw new Error('This GLB uses Draco compression. Re-export it WITHOUT Draco (Blender: uncheck "Compression").');
  if (used.has('EXT_meshopt_compression')) throw new Error('This GLB uses meshopt compression. Re-export it without compression.');
}

function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  if (acc.sparse) throw new Error('Sparse accessors are not supported (morph targets / sparse data). Export without shape keys.');
  const [Ctor, bytes, normDiv] = COMPONENT[acc.componentType];
  const n = TYPE_SIZE[acc.type];
  const out = acc.componentType === 5126 || acc.normalized ? new Float32Array(acc.count * n) : new Ctor(acc.count * n);
  if (acc.bufferView == null) return { data: out, count: acc.count, size: n };
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || n * bytes;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const get = {
    5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true),
    5123: (o) => dv.getUint16(o, true), 5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true)
  }[acc.componentType];
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < n; k++) {
      let v = get(base + i * stride + k * bytes);
      if (acc.normalized && acc.componentType !== 5126) v = Math.max(v / normDiv, -1);
      out[i * n + k] = v;
    }
  }
  return { data: out, count: acc.count, size: n };
}

/** Browser image decoder → { width, height, data:Uint8ClampedArray RGBA }. Pass your own in tests / other hosts. */
export async function browserDecodeImage(bytes, mimeType) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: mimeType || 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const id = g.getImageData(0, 0, bmp.width, bmp.height);
  return { width: id.width, height: id.height, data: id.data };
}

// ------------------------------------------------------------------ main
/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {{ decodeImage?: (bytes:Uint8Array, mime:string)=>Promise<{width,height,data}> }} [opts]
 */
export async function readGlb(arrayBuffer, opts = {}) {
  const { json, bin } = parseGlbContainer(arrayBuffer);
  unsupported(json);
  const decodeImage = opts.decodeImage || (typeof createImageBitmap === 'function' ? browserDecodeImage : null);
  const warnings = [];

  // nodes + rest-pose world matrices
  const nodes = (json.nodes || []).map((n, i) => ({
    index: i, name: n.name || `node_${i}`, parent: -1, children: n.children || [],
    local: n.matrix ? Float64Array.from(n.matrix) : mat4FromTRS(n.translation, n.rotation, n.scale),
    world: null, mesh: n.mesh, skin: n.skin
  }));
  nodes.forEach((n) => n.children.forEach((c) => { nodes[c].parent = n.index; }));
  const computeWorld = (n) => {
    if (n.world) return n.world;
    n.world = n.parent < 0 ? n.local : mat4Mul(computeWorld(nodes[n.parent]), n.local);
    return n.world;
  };
  nodes.forEach(computeWorld);

  const skins = (json.skins || []).map((s) => {
    const ibm = s.inverseBindMatrices != null ? readAccessor(json, bin, s.inverseBindMatrices).data : null;
    return {
      joints: s.joints,
      inverseBind: s.joints.map((_, i) => (ibm ? Float64Array.from(ibm.subarray(i * 16, i * 16 + 16)) : mat4Identity()))
    };
  });

  // textures (decoded lazily, once)
  const imageCache = new Map();
  const getImage = async (texIndex) => {
    if (imageCache.has(texIndex)) return imageCache.get(texIndex);
    let img = null;
    const tex = json.textures?.[texIndex];
    const src = tex && json.images?.[tex.source];
    if (src && src.bufferView != null && decodeImage) {
      const bv = json.bufferViews[src.bufferView];
      try { img = await decodeImage(new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength), src.mimeType); }
      catch (e) { warnings.push(`Texture ${texIndex} could not be decoded: ${e.message}`); }
    } else if (src) warnings.push(`Texture ${texIndex} skipped (no image decoder or external file) — using the material colour.`);
    imageCache.set(texIndex, img);
    return img;
  };

  const primitives = [];
  for (const node of nodes) {
    if (node.mesh == null) continue;
    const mesh = json.meshes[node.mesh];
    for (const prim of mesh.primitives) {
      if ((prim.mode ?? 4) !== 4) { warnings.push(`Mesh "${mesh.name}": non-triangle primitive skipped.`); continue; }
      if (prim.attributes.POSITION == null) continue;
      const pos = readAccessor(json, bin, prim.attributes.POSITION).data;
      const nv = pos.length / 3;
      const idx = prim.indices != null ? Uint32Array.from(readAccessor(json, bin, prim.indices).data) : Uint32Array.from({ length: nv }, (_, i) => i);
      const mat = prim.material != null ? json.materials?.[prim.material] : null;
      const pbr = mat?.pbrMetallicRoughness || {};
      const factor = pbr.baseColorFactor || [1, 1, 1, 1];
      const col0 = prim.attributes.COLOR_0 != null ? readAccessor(json, bin, prim.attributes.COLOR_0) : null;
      let uv = null, img = null;
      if (pbr.baseColorTexture) {
        img = await getImage(pbr.baseColorTexture.index);
        const uvSet = pbr.baseColorTexture.texCoord || 0;
        if (img && prim.attributes[`TEXCOORD_${uvSet}`] != null) uv = readAccessor(json, bin, prim.attributes[`TEXCOORD_${uvSet}`]).data;
      }
      const colors = new Uint8Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        let r = factor[0], g = factor[1], b = factor[2]; // baseColorFactor / COLOR_0 are already linear
        if (col0) { r *= col0.data[v * col0.size]; g *= col0.data[v * col0.size + 1]; b *= col0.data[v * col0.size + 2]; }
        if (img && uv) {
          const u = uv[v * 2] - Math.floor(uv[v * 2]), w = uv[v * 2 + 1] - Math.floor(uv[v * 2 + 1]);
          const px = Math.min(img.width - 1, Math.floor(u * img.width)), py = Math.min(img.height - 1, Math.floor(w * img.height));
          const o = (py * img.width + px) * 4;
          r *= srgbToLinear(img.data[o] / 255); g *= srgbToLinear(img.data[o + 1] / 255); b *= srgbToLinear(img.data[o + 2] / 255);
        }
        colors[v * 3] = Math.round(255 * linearToSrgb(Math.min(1, r)));
        colors[v * 3 + 1] = Math.round(255 * linearToSrgb(Math.min(1, g)));
        colors[v * 3 + 2] = Math.round(255 * linearToSrgb(Math.min(1, b)));
      }
      const j = prim.attributes.JOINTS_0 != null ? readAccessor(json, bin, prim.attributes.JOINTS_0).data : null;
      const w = prim.attributes.WEIGHTS_0 != null ? readAccessor(json, bin, prim.attributes.WEIGHTS_0).data : null;
      primitives.push({
        node: node.index, skin: node.skin ?? -1, name: mesh.name || node.name,
        positions: pos, indices: idx, colors, joints: j, weights: w,
        staticColorSource: {
          factor: [factor[0], factor[1], factor[2]],
          col0: col0 ? { data: col0.data, size: col0.size } : null,
          uv,
          img
        }
      });
    }
  }
  if (!primitives.length) throw new Error('The GLB has no triangle meshes.');
  return { nodes, skins, primitives, warnings };
}
