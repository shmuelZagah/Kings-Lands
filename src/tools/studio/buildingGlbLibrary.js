/**
 * Reusable GLB part library & Building Primitive catalog for Studio Rig mode.
 *
 * Pure helpers (library persistence, categorization, decimation budget math, primitive catalog)
 * require no DOM globals so they can be verified cleanly in Node.
 */

import * as THREE from 'three';

export const GLB_LIBRARY_STORAGE_KEY = 'kings_lands_studio_glb_library_v1';

export const DEFAULT_GLB_CATEGORIES = Object.freeze([
  'Roofs',
  'Walls',
  'Props',
  'Weapons',
  'General'
]);

/** Matches Skin/Building polygon reduction budgets in `src/tools/studio/studioImport.js`. */
export const BUILDING_DETAIL_BUDGETS = Object.freeze({
  low: 4000,
  medium: 9000,
  high: 16000
});

export const PRIMITIVE_SHAPES = Object.freeze([
  { shape: 'box', label: 'Box', icon: '⬜', defaultSize: [1, 1, 1] },
  { shape: 'sphere', label: 'Sphere', icon: '⚪', defaultSize: [0.55, 16, 12] },
  { shape: 'cylinder', label: 'Cylinder', icon: '🛢', defaultSize: [0.5, 1.2, 16] },
  { shape: 'cone', label: 'Cone', icon: '🔺', defaultSize: [0.6, 1.2, 16] },
  { shape: 'prism', label: 'Triangular Prism', icon: '⛺', defaultSize: [1.1, 0.9, 1.4] },
  { shape: 'pyramid', label: 'Pyramid', icon: '🏛', defaultSize: [0.75, 1.2, 4] }
]);

export function normalizeGlbCategory(raw) {
  const clean = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return clean || 'General';
}

export function resolveBuildingGlbBudget(detail = 'medium', custom = '') {
  const c = Number(custom);
  if (Number.isFinite(c) && c >= 200) {
    return Math.min(40000, Math.round(c));
  }
  return BUILDING_DETAIL_BUDGETS[detail] || BUILDING_DETAIL_BUDGETS.medium;
}

export function getPrimitiveDef(shape) {
  return PRIMITIVE_SHAPES.find((p) => p.shape === shape) || PRIMITIVE_SHAPES[0];
}

export function createPrimitiveGeometry(prim) {
  const shape = prim?.shape || 'box';
  const sz = Array.isArray(prim?.size) ? prim.size : getPrimitiveDef(shape).defaultSize;
  let geo;
  let centerY = 0.5;

  if (shape === 'sphere') {
    const rad = Math.max(0.05, Number(sz[0]) || 0.55);
    geo = new THREE.SphereGeometry(rad, Math.max(8, Number(sz[1]) | 0 || 16), Math.max(6, Number(sz[2]) | 0 || 12));
    centerY = rad;
  } else if (shape === 'cylinder') {
    const rad = Math.max(0.05, Number(sz[0]) || 0.5);
    const h = Math.max(0.05, Number(sz[1]) || 1.2);
    geo = new THREE.CylinderGeometry(rad, rad, h, Math.max(6, Number(sz[2]) | 0 || 16));
    centerY = h * 0.5;
  } else if (shape === 'cone') {
    const rad = Math.max(0.05, Number(sz[0]) || 0.6);
    const h = Math.max(0.05, Number(sz[1]) || 1.2);
    geo = new THREE.ConeGeometry(rad, h, Math.max(6, Number(sz[2]) | 0 || 16));
    centerY = h * 0.5;
  } else if (shape === 'pyramid') {
    const rad = Math.max(0.05, Number(sz[0]) || 0.75);
    const h = Math.max(0.05, Number(sz[1]) || 1.2);
    geo = new THREE.ConeGeometry(rad, h, 4);
    geo.rotateY(Math.PI / 4);
    centerY = h * 0.5;
  } else if (shape === 'prism') {
    const w = Math.max(0.05, Number(sz[0]) || 1.1);
    const h = Math.max(0.05, Number(sz[1]) || 0.9);
    const d = Math.max(0.05, Number(sz[2]) || 1.4);
    const shp = new THREE.Shape();
    shp.moveTo(-w * 0.5, 0);
    shp.lineTo(w * 0.5, 0);
    shp.lineTo(0, h);
    shp.closePath();
    geo = new THREE.ExtrudeGeometry(shp, { depth: d, bevelEnabled: false });
    geo.translate(0, 0, -d * 0.5);
    centerY = 0;
  } else {
    const w = Math.max(0.05, Number(sz[0]) || 1);
    const h = Math.max(0.05, Number(sz[1]) || 1);
    const d = Math.max(0.05, Number(sz[2]) || 1);
    geo = new THREE.BoxGeometry(w, h, d);
    centerY = h * 0.5;
  }

  return { geometry: geo, yOffset: centerY };
}

function getStorage(storageOverride) {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof window !== 'undefined' ? window.localStorage : globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function sanitizeLibraryEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const glbBase64 = typeof raw.glbBase64 === 'string' ? raw.glbBase64 : '';
  if (!glbBase64) return null;
  const id = String(raw.id || `lib_${Date.now().toString(36)}`).trim();
  if (!id) return null;
  return {
    id,
    name: String(raw.name || id).trim() || id,
    category: normalizeGlbCategory(raw.category),
    glbBase64,
    glbByteLength: Math.max(0, Number(raw.glbByteLength) || Math.floor(glbBase64.length * 0.75)),
    fitSize: Math.max(0.1, Number(raw.fitSize) || 4),
    originalTriangles: Math.max(0, Number(raw.originalTriangles) || 0),
    triangles: Math.max(0, Number(raw.triangles) || 0),
    detail: raw.detail || 'medium',
    addedAt: Number(raw.addedAt) || Date.now()
  };
}

export function loadGlbLibrary(storageOverride) {
  const storage = getStorage(storageOverride);
  if (!storage) return [];
  try {
    const raw = storage.getItem(GLB_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeLibraryEntry)
      .filter(Boolean)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  } catch {
    return [];
  }
}

export function saveGlbLibrary(entries, storageOverride) {
  const storage = getStorage(storageOverride);
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(sanitizeLibraryEntry)
    .filter(Boolean);
  if (!storage) return { ok: true, entries: normalized };
  try {
    storage.setItem(GLB_LIBRARY_STORAGE_KEY, JSON.stringify(normalized));
    return { ok: true, entries: normalized };
  } catch (err) {
    return { ok: false, error: err?.message || 'Storage quota exceeded', entries: normalized };
  }
}

export function getGlbLibraryCategories(entries = []) {
  const out = [...DEFAULT_GLB_CATEGORIES];
  const seen = new Set(out.map((c) => c.toLowerCase()));
  for (const item of entries || []) {
    const cat = normalizeGlbCategory(item?.category);
    if (!seen.has(cat.toLowerCase())) {
      seen.add(cat.toLowerCase());
      out.push(cat);
    }
  }
  return out;
}

export function upsertGlbLibraryEntry(rawEntry, storageOverride) {
  const clean = sanitizeLibraryEntry(rawEntry);
  if (!clean) return { ok: false, error: 'Invalid GLB library entry', entries: loadGlbLibrary(storageOverride) };
  const current = loadGlbLibrary(storageOverride);
  const existingIdx = current.findIndex(
    (e) => e.id === clean.id || e.glbBase64 === clean.glbBase64
  );
  let savedEntry = clean;
  if (existingIdx >= 0) {
    const prev = current[existingIdx];
    savedEntry = {
      ...prev,
      ...clean,
      id: prev.id,
      addedAt: Date.now()
    };
    current.splice(existingIdx, 1);
  }
  const next = [savedEntry, ...current];
  const res = saveGlbLibrary(next, storageOverride);
  return { ...res, entry: savedEntry };
}

export function deleteGlbLibraryEntry(id, storageOverride) {
  if (!id) return { ok: false, entries: loadGlbLibrary(storageOverride) };
  const current = loadGlbLibrary(storageOverride);
  const next = current.filter((e) => e.id !== id);
  return saveGlbLibrary(next, storageOverride);
}

/**
 * Discovers any GLB parts already saved inside buildings and ensures they are listed
 * in the reusable GLB library (never duplicates matching glbBase64 or id).
 */
export function syncLibraryFromBuildings(buildingsData, storageOverride) {
  const bMap = buildingsData?.buildings;
  if (!bMap || typeof bMap !== 'object') return loadGlbLibrary(storageOverride);
  const current = loadGlbLibrary(storageOverride);
  const knownB64 = new Set(current.map((e) => e.glbBase64));
  const knownIds = new Set(current.map((e) => e.id));
  let changed = false;

  for (const bDef of Object.values(bMap)) {
    for (const p of bDef?.parts || []) {
      if (p?.kind !== 'model' || p.model?.type !== 'glb' || !p.model?.glbBase64) continue;
      if (knownB64.has(p.model.glbBase64)) continue;
      const baseId = String(p.model.ref || p.id || `glb_${knownIds.size + 1}`);
      let id = baseId;
      for (let i = 2; knownIds.has(id); i++) id = `${baseId}_${i}`;
      const entry = sanitizeLibraryEntry({
        id,
        name: p.model.name || p.name || id,
        category: p.model.category || 'General',
        glbBase64: p.model.glbBase64,
        glbByteLength: p.model.glbByteLength,
        fitSize: p.model.fitSize || 4,
        originalTriangles: p.model.originalTriangles || 0,
        triangles: p.model.triangles || 0,
        detail: p.model.detail || 'medium',
        addedAt: Date.now()
      });
      if (entry) {
        current.push(entry);
        knownB64.add(entry.glbBase64);
        knownIds.add(entry.id);
        changed = true;
      }
    }
  }
  if (changed) {
    const res = saveGlbLibrary(current, storageOverride);
    return res.entries;
  }
  return current;
}

export function countGlbSceneTriangles(scene) {
  let tris = 0;
  for (const p of scene?.primitives || []) {
    tris += Math.floor((p?.indices?.length || 0) / 3);
  }
  return tris;
}

/**
 * Converts a simplified static mesh (vertices/faces/colors/normals) into a binary `.glb` ArrayBuffer
 * via Three.js `GLTFExporter`.
 */
export async function exportStaticMeshToGlbBuffer(mesh) {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const { vertices = [], faces = [], colors = [], normals = null } = mesh || {};
  const nV = vertices.length;
  const positions = new Float32Array(nV * 3);
  const colArr = new Float32Array(nV * 3);
  const tmp = new THREE.Color();

  for (let i = 0; i < nV; i++) {
    const v = vertices[i] || [0, 0, 0];
    positions[i * 3] = Number(v[0]) || 0;
    positions[i * 3 + 1] = Number(v[1]) || 0;
    positions[i * 3 + 2] = Number(v[2]) || 0;

    const c = colors[i] || [200, 200, 200];
    tmp.setRGB((c[0] ?? 200) / 255, (c[1] ?? 200) / 255, (c[2] ?? 200) / 255, THREE.SRGBColorSpace);
    colArr[i * 3] = tmp.r;
    colArr[i * 3 + 1] = tmp.g;
    colArr[i * 3 + 2] = tmp.b;
  }

  const indices = nV > 65535
    ? new Uint32Array(faces.length * 3)
    : new Uint16Array(faces.length * 3);
  for (let f = 0; f < faces.length; f++) {
    const tri = faces[f] || [0, 0, 0];
    indices[f * 3] = tri[0];
    indices[f * 3 + 1] = tri[1];
    indices[f * 3 + 2] = tri[2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  if (Array.isArray(normals) && normals.length === nV) {
    const normArr = new Float32Array(nV * 3);
    for (let i = 0; i < nV; i++) {
      const n = normals[i] || [0, 1, 0];
      normArr[i * 3] = n[0];
      normArr[i * 3 + 1] = n[1];
      normArr[i * 3 + 2] = n[2];
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
  } else {
    geo.computeVertexNormals();
  }
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05
  });
  const threeMesh = new THREE.Mesh(geo, mat);
  threeMesh.name = 'imported_building_part';

  const exporter = new GLTFExporter();
  const out = await exporter.parseAsync(threeMesh, { binary: true });
  geo.dispose();
  mat.dispose();

  if (out instanceof ArrayBuffer) return out;
  if (ArrayBuffer.isView(out)) return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  throw new Error('GLTFExporter did not return binary GLB output');
}

/**
 * Reads a `.glb` File, applies polygon reduction if it exceeds the chosen Detail Kit budget
 * (preserving full original PBR textures when already within budget), and returns ready-to-store data.
 */
export async function prepareGlbAssetForImport(file, {
  name = '',
  category = 'General',
  detail = 'medium',
  customBudget = '',
  fitSize = 4
} = {}) {
  if (!file) throw new Error('No .glb file provided');
  const buf = await file.arrayBuffer();
  const [{ readGlb }, { buildStaticMeshFromScene }, { arrayBufferToBase64 }] = await Promise.all([
    import('../import/glbReader.js'),
    import('../import/glbToUnit.js'),
    import('../map_editor/mapStateManager.js')
  ]);

  const scene = await readGlb(buf);
  const originalTriangles = countGlbSceneTriangles(scene);
  const budget = resolveBuildingGlbBudget(detail, customBudget);
  const effFitSize = Math.max(0.1, Number(fitSize) || 4);
  const cleanName = String(name || file.name || 'Model').replace(/\.[^.]+$/, '').trim() || 'Model';
  const cleanCategory = normalizeGlbCategory(category);

  let finalBuf = buf;
  let finalTriangles = originalTriangles;
  let decimated = false;

  if (originalTriangles > budget) {
    const mesh = buildStaticMeshFromScene(scene, {
      rotateYDeg: 0,
      budget,
      smoothNormals: true,
      fit: { mode: 'size', size: effFitSize, anchor: 'base', offset: [0, 0, 0] }
    });
    finalBuf = await exportStaticMeshToGlbBuffer(mesh);
    finalTriangles = mesh.info.triangles;
    decimated = true;
  }

  return {
    id: `glb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    category: cleanCategory,
    glbBase64: arrayBufferToBase64(finalBuf),
    glbByteLength: finalBuf.byteLength,
    fitSize: effFitSize,
    originalTriangles,
    triangles: finalTriangles,
    detail: Number(customBudget) >= 200 ? 'custom' : detail,
    decimated
  };
}
