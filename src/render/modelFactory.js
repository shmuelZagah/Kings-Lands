import { buildSculptedArrowGeometry } from './worldEffectsRenderer.js';
/**
 * Kings Lands — Phase 1/5: 3D Procedural Model Factory & High-Visibility Worker Carry Props
 * (src/render/modelFactory.js)
 */

import * as THREE from 'three';

export const REQUIRED_UNIT_SOCKETS = Object.freeze([
  'torso',
  'head',
  'arm_R',
  'arm_L',
  'weapon_socket_R',
  'weapon_socket_L',
  'leg_R',
  'leg_L'
]);

export const MOUNT_SOCKETS = Object.freeze([
  'mount_torso',
  'mount_head',
  'mount_tail',
  'mount_leg_FL',
  'mount_leg_FR',
  'mount_leg_BL',
  'mount_leg_BR'
]);

/**
 * Builds a BufferGeometry from explicit data (shape: 'mesh' | 'custom_mesh').
 *   vertices: [[x,y,z], ...]  (or a flat [x,y,z,x,y,z,...])
 *   faces | indices: triangles [[a,b,c], ...] / flat [a,b,c,...]; polygons with >3 indices are fan-triangulated
 *   uvs (optional): [[u,v], ...] aligned with vertices (needed only for `pattern` textures)
 *   smooth (optional): true keeps shared vertices / smooth normals. Default = flat per-face normals (faceted look).
 *   normals (optional, with smooth:true): per-vertex normals [[x,y,z], ...] aligned with vertices; replaces computeVertexNormals().
 *   colors (optional): per-vertex sRGB colours [[r,g,b], ...] (0-255) aligned with vertices. Multiplied with the part
 *     `color` (use "#ffffff" to take the colours as they are). Lets one skin mesh carry lips, brows, blush, nails...
 */
function colorsHash(cols) {
  if (!Array.isArray(cols) || !cols.length) return '';
  let h = 2166136261 >>> 0;
  for (let i = 0; i < cols.length; i++) {
    const q = cols[i];
    h = Math.imul(h ^ (q[0] | (q[1] << 8) | (q[2] << 16)), 16777619) >>> 0;
  }
  return `c${cols.length}_${h}`;
}

function buildMeshGeometry(partDef) {
  const vin = partDef.vertices || [];
  const fin = partDef.faces || partDef.indices || [];
  const pos = vin.length && Array.isArray(vin[0]) ? vin.flat() : vin;
  const idx = [];
  if (fin.length && Array.isArray(fin[0])) {
    for (const f of fin) for (let k = 1; k < f.length - 1; k++) idx.push(f[0], f[k], f[k + 1]);
  } else {
    for (let i = 0; i + 2 < fin.length; i += 3) idx.push(fin[i], fin[i + 1], fin[i + 2]);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (Array.isArray(partDef.uvs) && partDef.uvs.length) {
    const uv = Array.isArray(partDef.uvs[0]) ? partDef.uvs.flat() : partDef.uvs;
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  if (Array.isArray(partDef.colors) && partDef.colors.length) {
    const c = new THREE.Color();
    const col = new Float32Array(partDef.colors.length * 3);
    for (let i = 0; i < partDef.colors.length; i++) {
      const q = partDef.colors[i];
      c.setRGB(q[0] / 255, q[1] / 255, q[2] / 255, THREE.SRGBColorSpace);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.setIndex(idx);
  if (!partDef.smooth) g = g.toNonIndexed();
  const nVerts = vin.length && Array.isArray(vin[0]) ? vin.length : vin.length / 3;
  if (partDef.smooth && Array.isArray(partDef.normals) && partDef.normals.length === nVerts) {
    // explicit per-vertex normals (baked from the sculpt) keep shading continuous across rigid part boundaries
    const nn = Array.isArray(partDef.normals[0]) ? partDef.normals.flat() : partDef.normals;
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
  } else {
    g.computeVertexNormals();
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export class AssetAdapter {
  constructor() {
    this._geometryCache = new Map();
    this._materialCache = new Map();
    this._ringGeometryCache = new Map();
    this._gltfCache = new Map();
    this._externalGltfLoader = null;
  }

  registerGltfLoader(loaderFn) {
    this._externalGltfLoader = loaderFn;
  }

  resolveColor(colorToken, teamPalette) {
    if (!colorToken) return '#cbd5e1';
    if (typeof colorToken === 'string' && colorToken.startsWith('team.')) {
      const key = colorToken.slice(5);
      return teamPalette?.[key] || teamPalette?.primary || '#3b82f6';
    }
    return colorToken;
  }

  getRingGeometry(ringRadius) {
    const key = Number(ringRadius).toFixed(3);
    if (this._ringGeometryCache.has(key)) {
      return this._ringGeometryCache.get(key);
    }
    const geom = new THREE.RingGeometry(ringRadius * 0.78, ringRadius, 20);
    this._ringGeometryCache.set(key, geom);
    return geom;
  }

  getSharedStandardMaterial(resolvedHex, roughness, metalness, cacheScopeKey = 'shared', vertexColors = false) {
    const rKey = Math.round((roughness ?? 0.65) * 100);
    const mKey = Math.round((metalness ?? 0.2) * 100);
    const matKey = `${cacheScopeKey}:${resolvedHex}:${rKey}:${mKey}${vertexColors ? ':vc' : ''}`;

    let mat = this._materialCache.get(matKey);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(resolvedHex),
        roughness: roughness ?? 0.65,
        metalness: metalness ?? 0.2,
        vertexColors: !!vertexColors
      });
      this._materialCache.set(matKey, mat);
    }
    return mat;
  }

  getPrimitiveGeometry(partDef) {
    const shape = (partDef.shape || 'box').toLowerCase();
    const sizeKey = JSON.stringify(partDef.size || partDef.points || []);
    const latheKey = shape === 'lathe' ? `:${JSON.stringify(partDef.points || [])}` : '';
    const meshKey = (shape === 'mesh' || shape === 'custom_mesh')
      ? `:${JSON.stringify(partDef.vertices || [])}:${JSON.stringify(partDef.faces || partDef.indices || [])}:${colorsHash(partDef.colors)}${Array.isArray(partDef.normals) ? ':n' + partDef.normals.length : ''}`
      : '';
    const cacheKey = `${shape}:${sizeKey}:${partDef.depth || 0}:${partDef.noBevel ? 1 : 0}${partDef.smooth ? 's' : ''}${latheKey}${meshKey}`;

    if (this._geometryCache.has(cacheKey)) {
      return this._geometryCache.get(cacheKey);
    }

    let geom = null;
    const sz = partDef.size || [1, 1, 1];

    if (shape === 'box') {
      geom = new THREE.BoxGeometry(sz[0] ?? 1, sz[1] ?? 1, sz[2] ?? 1);
    } else if (shape === 'cylinder') {
      geom = new THREE.CylinderGeometry(
        sz[0] ?? 0.2,
        sz[1] ?? 0.2,
        sz[2] ?? 1,
        Math.min(8, sz[3] ?? 8)
      );
    } else if (shape === 'sphere') {
      const r = sz[0] ?? 0.25;
      geom = new THREE.SphereGeometry(r, Math.min(8, sz[1] ?? 10), Math.min(6, sz[2] ?? 8));
    } else if (shape === 'cone') {
      geom = new THREE.ConeGeometry(sz[0] ?? 0.25, sz[1] ?? 0.5, Math.min(8, sz[2] ?? 8));
    } else if (shape === 'torus') {
      geom = new THREE.TorusGeometry(
        sz[0] ?? 0.15,
        sz[1] ?? 0.02,
        Math.min(6, sz[3] ?? 6),
        Math.min(10, sz[2] ?? 12)
      );
    } else if (shape === 'lathe') {
      // Uniform 10 radial segments across all concentric body/armor lathes so vertex angles align 1-to-1
      // while cutting GPU vertex load by >75% for 1,200+ units.
      const rawProf = Array.isArray(partDef.points) && partDef.points.length >= 2
        ? partDef.points
        : [[0, -0.2], [0.1, -0.1], [0.1, 0.1], [0, 0.2]];
      let prof = rawProf;
      if (rawProf.length > 15) {
        prof = [rawProf[0], rawProf[1]];
        for (let i = 2; i < rawProf.length - 2; i += 2) {
          prof.push(rawProf[i]);
        }
        if (prof[prof.length - 1] !== rawProf[rawProf.length - 2]) {
          prof.push(rawProf[rawProf.length - 2]);
        }
        prof.push(rawProf[rawProf.length - 1]);
      }
      const segs = Math.max(6, Math.min(10, Math.round(sz[0] ?? 10)));
      geom = new THREE.LatheGeometry(
        prof.map((p) => new THREE.Vector2(Math.max(0, p[0]), p[1])),
        segs
      );
    } else if (shape === 'extrude') {
      const pts = Array.isArray(partDef.points) && partDef.points.length >= 3
        ? partDef.points
        : [[-0.1, 0], [0.1, 0], [0, 0.4]];
      const shape2d = new THREE.Shape();
      shape2d.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        shape2d.lineTo(pts[i][0], pts[i][1]);
      }
      shape2d.closePath();
      const useBevel = !partDef.noBevel;
      geom = new THREE.ExtrudeGeometry(shape2d, {
        depth: partDef.depth ?? 0.04,
        bevelEnabled: useBevel,
        bevelThickness: useBevel ? 0.008 : 0,
        bevelSize: useBevel ? 0.006 : 0,
        bevelSegments: 1
      });
    } else if (shape === 'mesh' || shape === 'custom_mesh') {
      geom = buildMeshGeometry(partDef);
    } else {
      geom = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    }

    this._geometryCache.set(cacheKey, geom);
    return geom;
  }

  getPatternTexture(name, repeat) {
    if (typeof document === 'undefined') return null;
    const rep = Array.isArray(repeat) ? repeat : [2, 1];
    const key = `${name}:${rep[0]}x${rep[1]}`;
    this._patternCache = this._patternCache || new Map();
    if (this._patternCache.has(key)) return this._patternCache.get(key);
    let tex = null;
    if (name === 'scales') {
      const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d');
      g.fillStyle = '#7d7d7d'; g.fillRect(0, 0, S, S);
      const n = 8, rows = 16, w = S / n, h = S / rows;
      for (let row = 0; row < rows; row++) {
        for (let col = -1; col <= n; col++) {
          const cx = (col + (row % 2 ? 0.5 : 0)) * w + w * 0.5, cy = row * h + h * 0.5;
          for (const oy of [0, -S, S]) {
            const y = cy + oy; if (y < -h || y > S + h) continue;
            const grd = g.createRadialGradient(cx, y - h * 0.15, 1, cx, y, w * 0.62);
            grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.6, '#d8d8d8'); grd.addColorStop(1, '#6e6e6e');
            g.fillStyle = grd; g.beginPath(); g.ellipse(cx, y, w * 0.6, h * 1.05, 0, 0, Math.PI * 2); g.fill();
          }
        }
      }
      tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rep[0], rep[1]);
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    }
    if (name === 'fur') {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d');
      let seed = 4242; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 3200; i++) {
        const x = rnd() * S, y = rnd() * S, len = 10 + rnd() * 26, v = rnd() < 0.5 ? 0 : 255;
        g.strokeStyle = `rgba(${v},${v},${v},${0.12 + rnd() * 0.22})`; g.lineWidth = 0.8 + rnd() * 1.4;
        for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + (rnd() - 0.5) * 3, y + oy + len); g.stroke(); }
      }
      tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rep[0], rep[1]);
      tex.anisotropy = 4;
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    }
    if (name === 'snake') {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d');
      let seed = 1337; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, S, S);
      const cols = 16, rows = 28, w = S / cols, h = S / rows;
      for (let row = 0; row < rows; row++) {
        for (let col = -1; col <= cols; col++) {
          const cx = (col + (row % 2 ? 0.5 : 0)) * w + w * 0.5, cy = row * h + h * 0.5;
          const v = 0.72 + rnd() * 0.28, b = Math.round(255 * v);
          for (const oy of [0, -S, S]) {
            const y = cy + oy; if (y < -h || y > S + h) continue;
            const grd = g.createRadialGradient(cx, y - h * 0.2, 1, cx, y, w * 0.7);
            grd.addColorStop(0, `rgb(${b},${b},${b})`); grd.addColorStop(0.6, `rgb(${Math.round(b * 0.82)},${Math.round(b * 0.82)},${Math.round(b * 0.82)})`); grd.addColorStop(1, `rgb(${Math.round(b * 0.45)},${Math.round(b * 0.45)},${Math.round(b * 0.45)})`);
            g.fillStyle = grd; g.beginPath(); g.ellipse(cx, y, w * 0.62, h * 1.1, 0, 0, Math.PI * 2); g.fill();
          }
        }
      }
      for (let i = 0; i < 34; i++) {
        const x = rnd() * S, y = rnd() * S, rx = 14 + rnd() * 34, ry = 10 + rnd() * 26, dark = rnd() < 0.65;
        for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) {
          const grd = g.createRadialGradient(x + ox, y + oy, 1, x + ox, y + oy, Math.max(rx, ry));
          grd.addColorStop(0, dark ? 'rgba(0,0,0,0.34)' : 'rgba(255,255,255,0.32)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, rnd() * 3, 0, Math.PI * 2); g.fill();
        }
      }
      tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rep[0], rep[1]);
      tex.anisotropy = 4;
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    }
    if (name === 'crystal') {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d');
      let seed = 9001; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, S, S);
      const pts = [];
      const N = 36;
      for (let i = 0; i < N; i++) pts.push([rnd() * S, rnd() * S, Math.round(135 + rnd() * 115)]);
      const cell = 8;
      for (let y = 0; y < S; y += cell) {
        for (let x = 0; x < S; x += cell) {
          let bestD = 1e9, bestV = 180, secondD = 1e9;
          for (let i = 0; i < N; i++) {
            let dx = Math.abs(x - pts[i][0]); if (dx > S * 0.5) dx = S - dx;
            let dy = Math.abs(y - pts[i][1]); if (dy > S * 0.5) dy = S - dy;
            const d = dx * dx + dy * dy;
            if (d < bestD) { secondD = bestD; bestD = d; bestV = pts[i][2]; }
            else if (d < secondD) { secondD = d; }
          }
          const edge = Math.sqrt(secondD) - Math.sqrt(bestD) < 5.5;
          const v = edge ? Math.max(70, bestV - 65) : bestV;
          g.fillStyle = `rgb(${v},${v},${v})`;
          g.fillRect(x, y, cell, cell);
        }
      }
      tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rep[0], rep[1]);
      tex.anisotropy = 4;
      if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    }
    this._patternCache.set(key, tex);
    return tex;
  }

  createPrimitiveMesh(partDef, teamPalette, materialRegistry = null, cacheScopeKey = 'shared') {
    const geom = this.getPrimitiveGeometry(partDef);
    const resolvedHex = this.resolveColor(partDef.color, teamPalette);
    const isDynamicTeamColor = typeof partDef.color === 'string' && partDef.color.startsWith('team.');

    let mat;
    const patternTex = partDef.pattern ? this.getPatternTexture(partDef.pattern, partDef.patternRepeat) : null;
    if (patternTex) {
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(resolvedHex), roughness: partDef.roughness ?? 0.65, metalness: partDef.metalness ?? 0.2 });
      mat.map = patternTex;
      if (partDef.pattern === 'snake' || partDef.pattern === 'fur' || partDef.pattern === 'crystal') { mat.bumpMap = patternTex; mat.bumpScale = partDef.bumpScale ?? (partDef.pattern === 'fur' ? 0.5 : 0.85); }
      mat.userData.ownMaterial = true;
    } else {
      mat = this.getSharedStandardMaterial(
        resolvedHex,
        partDef.roughness ?? 0.65,
        partDef.metalness ?? 0.2,
        cacheScopeKey,
        Array.isArray(partDef.colors) && partDef.colors.length > 0
      );
    }

    if (isDynamicTeamColor && materialRegistry) {
      const slot = partDef.color.slice(5);
      if (!materialRegistry[slot]) materialRegistry[slot] = [];
      if (!materialRegistry[slot].includes(mat)) {
        materialRegistry[slot].push(mat);
      }
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = partDef.name || 'primitive_part';
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (Array.isArray(partDef.pos)) {
      mesh.position.set(partDef.pos[0] || 0, partDef.pos[1] || 0, partDef.pos[2] || 0);
    }
    if (Array.isArray(partDef.rot)) {
      mesh.rotation.set(partDef.rot[0] || 0, partDef.rot[1] || 0, partDef.rot[2] || 0);
    }
    if (Array.isArray(partDef.scale)) {
      mesh.scale.set(partDef.scale[0] ?? 1, partDef.scale[1] ?? 1, partDef.scale[2] ?? 1);
    }

    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;

    return mesh;
  }

  bindGltfSockets(gltfRootGroup, socketsMap, restPosesMap) {
    gltfRootGroup.traverse((child) => {
      if (REQUIRED_UNIT_SOCKETS.includes(child.name) || MOUNT_SOCKETS.includes(child.name)) {
        socketsMap[child.name] = child;
        restPosesMap[child.name] = {
          pos: [child.position.x, child.position.y, child.position.z],
          rot: [child.rotation.x, child.rotation.y, child.rotation.z],
          scale: [child.scale.x, child.scale.y, child.scale.z]
        };
      }
    });

    for (const reqSocket of REQUIRED_UNIT_SOCKETS) {
      if (!socketsMap[reqSocket]) {
        const fallbackPivot = new THREE.Group();
        fallbackPivot.name = reqSocket;
        gltfRootGroup.add(fallbackPivot);
        socketsMap[reqSocket] = fallbackPivot;
        restPosesMap[reqSocket] = { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };
      }
    }
  }
}

export class ModelFactory {
  constructor(visualsJson) {
    this.visualsData = visualsJson || { units: {}, prefabs: {}, teamPalettes: {}, animations: {} };
    this.adapter = new AssetAdapter();
    this._sharedCarryResources = null;
  }

  _ensureSharedCarryResources() {
    if (this._sharedCarryResources) return this._sharedCarryResources;

    this._sharedCarryResources = {
      geoms: {
        logBark: new THREE.CylinderGeometry(0.16, 0.16, 0.96, 8),
        logCap: new THREE.CylinderGeometry(0.13, 0.13, 0.98, 8),
        goldBar: new THREE.BoxGeometry(0.68, 0.24, 0.36),
        goldNugget: new THREE.DodecahedronGeometry(0.28, 0),
        lowerIngot: new THREE.BoxGeometry(0.72, 0.22, 0.36),
        upperIngot: new THREE.BoxGeometry(0.58, 0.22, 0.32),
        steelBand: new THREE.BoxGeometry(0.14, 0.48, 0.38),
        mainStone: new THREE.BoxGeometry(0.68, 0.46, 0.46),
        topSlab: new THREE.BoxGeometry(0.54, 0.16, 0.38)
      },
      mats: {
        bark: new THREE.MeshStandardMaterial({ color: 0x5c2d0c, roughness: 0.9 }),
        core: new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.65 }),
        gold: new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          roughness: 0.15,
          metalness: 0.92,
          emissive: 0xca8a04,
          emissiveIntensity: 0.45
        }),
        iron: new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.25,
          metalness: 0.92,
          emissive: 0x0f172a,
          emissiveIntensity: 0.25
        }),
        ironEdge: new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          roughness: 0.2,
          metalness: 0.85
        }),
        stone: new THREE.MeshStandardMaterial({
          color: 0xf1f5f9,
          roughness: 0.88,
          metalness: 0.05
        }),
        stoneTrim: new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.9
        })
      }
    };

    return this._sharedCarryResources;
  }

  getTeamPalette(teamId = 1) {
    const palettes = this.visualsData.teamPalettes || {};
    return palettes[String(teamId)] || palettes['1'] || {
      primary: teamId === 1 ? '#1d4ed8' : '#b91c1c',
      secondary: teamId === 1 ? '#fbbf24' : '#f59e0b',
      cloth: teamId === 1 ? '#1e3a8a' : '#7f1d1d',
      metal: '#cbd5e1',
      darkMetal: '#475569'
    };
  }

  getFactions() {
    const out = new Set();
    if (this.visualsData?.factions && typeof this.visualsData.factions === 'object') {
      for (const k of Object.keys(this.visualsData.factions)) if (k) out.add(k);
    }
    for (const u of Object.values(this.visualsData?.units || {})) {
      if (u?.race) out.add(u.race);
      for (const k of Object.keys(u?.skins || {})) if (k) out.add(k);
    }
    if (out.size === 0) for (const k of ['human', 'orc', 'elf', 'katiler']) out.add(k);
    return [...out];
  }

  getFactionTeamColors(factionId) {
    if (!factionId) return null;
    return this.visualsData?.factions?.[factionId]?.teamColors || null;
  }

  getUnitsForFaction(factionId) {
    const units = this.visualsData?.units || {};
    const explicitShared = this.visualsData?.factions?.[factionId]?.sharedUnits;
    const hasOwnUnits = Object.values(units).some((u) => u?.race === factionId);
    const usesShared = typeof explicitShared === 'boolean' ? explicitShared : !hasOwnUnits;
    return Object.keys(units).filter((id) => {
      const race = units[id]?.race || null;
      return race ? race === factionId : usesShared;
    });
  }

  createPrefab(prefabId, teamPalette, materialRegistry = null, overrideGrip = null, cacheScopeKey = 'shared') {
    const prefabDef = this.visualsData.prefabs?.[prefabId];
    if (!prefabDef) return null;

    const prefabGroup = new THREE.Group();
    prefabGroup.name = `prefab_${prefabId}`;

    const gripOffset = overrideGrip?.gripOffset || prefabDef.gripOffset || [0, 0, 0];
    const gripRotation = overrideGrip?.gripRotation || prefabDef.gripRotation || [0, 0, 0];

    prefabGroup.position.set(gripOffset[0] || 0, gripOffset[1] || 0, gripOffset[2] || 0);
    prefabGroup.rotation.set(gripRotation[0] || 0, gripRotation[1] || 0, gripRotation[2] || 0);
    prefabGroup.updateMatrix();
    prefabGroup.matrixAutoUpdate = false;

    prefabGroup.userData.prefabId = prefabId;
    prefabGroup.userData.gripOffset = [...gripOffset];
    prefabGroup.userData.gripRotation = [...gripRotation];

    const parts = prefabDef.parts || [];
    for (let i = 0; i < parts.length; i++) {
      const mesh = this.adapter.createPrimitiveMesh(parts[i], teamPalette, materialRegistry, cacheScopeKey);
      prefabGroup.add(mesh);
    }

    return prefabGroup;
  }

  createCompanyBanner(
    bannerStyle,
    teamPalette,
    materialRegistry,
    cacheScopeKey = 'shared',
    visualId = 'swordsman'
  ) {
    const bannerGroup = new THREE.Group();
    bannerGroup.name = 'company_banner';
    bannerGroup.updateMatrix();
    bannerGroup.matrixAutoUpdate = false;

    // Pole sits behind the banner at z = -0.32 so the banner cloth & emblem hang cleanly in front of it!
    const poleMesh = this.adapter.createPrimitiveMesh(
      {
        name: 'banner_pole',
        shape: 'cylinder',
        size: [0.032, 0.038, 3.2, 8],
        pos: [0, 1.55, -0.32],
        color: '#cbd5e1',
        metalness: 0.8
      },
      teamPalette,
      materialRegistry,
      cacheScopeKey
    );
    bannerGroup.add(poleMesh);

    // Forward mounting arm connecting top of pole (z = -0.32) to crossbar (z = -0.19)
    const bracketMesh = this.adapter.createPrimitiveMesh(
      {
        name: 'banner_bracket',
        shape: 'box',
        size: [0.035, 0.035, 0.14],
        pos: [0, 2.95, -0.255],
        color: 'team.secondary',
        metalness: 0.85
      },
      teamPalette,
      materialRegistry,
      cacheScopeKey
    );
    bannerGroup.add(bracketMesh);

    const crossbarMesh = this.adapter.createPrimitiveMesh(
      {
        name: 'banner_crossbar',
        shape: 'cylinder',
        size: [0.028, 0.028, 1.08, 6],
        pos: [0, 2.95, -0.19],
        rot: [0, 0, 1.5708],
        color: 'team.secondary',
        metalness: 0.85
      },
      teamPalette,
      materialRegistry,
      cacheScopeKey
    );
    bannerGroup.add(crossbarMesh);

    // Larger, full symmetric heraldic banners for all unit types (including Cavalry so it is never cut!)
    let clothPoints = [[-0.48, 0], [0.48, 0], [0.48, -1.22], [0, -0.96], [-0.48, -1.22]];
    if (bannerStyle === 'phalanx_gonfalon') {
      clothPoints = [[-0.46, 0], [0.46, 0], [0.36, -1.36], [0, -1.56], [-0.36, -1.36]];
    } else if (bannerStyle === 'ranger_pennon') {
      clothPoints = [[-0.46, 0], [0.46, 0], [0.40, -1.04], [0, -1.36], [-0.40, -1.04]];
    } else if (bannerStyle === 'cavalry_lance_pennon') {
      clothPoints = [[-0.50, 0], [0.50, 0], [0.50, -1.24], [0, -0.98], [-0.50, -1.24]];
    } else if (bannerStyle === 'artisan_pennant') {
      clothPoints = [[-0.40, 0], [0.40, 0], [0.40, -0.88], [-0.40, -0.88]];
    }

    // Thin non-beveled cloth at z = -0.196.. -0.184 (center z = -0.190) so emblems protrude cleanly outside both faces!
    const clothMesh = this.adapter.createPrimitiveMesh(
      {
        name: 'banner_cloth',
        shape: 'extrude',
        noBevel: true,
        points: clothPoints,
        depth: 0.012,
        pos: [0, 2.92, -0.196],
        color: 'team.primary',
        roughness: 0.55
      },
      teamPalette,
      materialRegistry,
      cacheScopeKey
    );
    bannerGroup.add(clothMesh);

    const emblemMesh = this.adapter.createPrimitiveMesh(
      {
        name: 'banner_emblem',
        shape: 'sphere',
        size: [0.14, 8, 8],
        pos: [0, 3.24, -0.32],
        color: 'team.secondary',
        metalness: 0.85
      },
      teamPalette,
      materialRegistry,
      cacheScopeKey
    );
    bannerGroup.add(emblemMesh);

    // Choose White (#f8fafc) if the banner cloth is dark, or Black (#090d16) if the banner cloth is light
    const primaryCol = new THREE.Color(teamPalette?.primary || '#2563eb');
    const clothLuminance = 0.299 * primaryCol.r + 0.587 * primaryCol.g + 0.114 * primaryCol.b;
    const emblemColor = clothLuminance < 0.5 ? '#f8fafc' : '#090d16';

    const addInkPart = (partDef) => {
      const m = this.adapter.createPrimitiveMesh(
        {
          ...partDef,
          noBevel: true,
          color: emblemColor,
          roughness: 0.85,
          metalness: 0.08
        },
        teamPalette,
        materialRegistry,
        cacheScopeKey
      );
      if (m.material) {
        m.material.polygonOffset = true;
        m.material.polygonOffsetFactor = -4;
        m.material.polygonOffsetUnits = -4;
      }
      bannerGroup.add(m);
    };

    if (visualId === 'archer' || bannerStyle === 'ranger_pennon') {
      // Drawn Bow & Arrow emblem (spans z = -0.218 to -0.162, protruding 2.2cm outside both faces of cloth!)
      addInkPart({
        name: 'ink_bow_arc',
        shape: 'extrude',
        points: [
          [-0.11, 0.26],
          [0.05, 0.17],
          [0.13, 0.0],
          [0.05, -0.17],
          [-0.11, -0.26],
          [-0.05, -0.17],
          [0.06, 0.0],
          [-0.05, 0.17]
        ],
        depth: 0.056,
        pos: [0, 2.42, -0.218]
      });
      addInkPart({
        name: 'ink_bow_string',
        shape: 'box',
        size: [0.022, 0.50, 0.056],
        pos: [-0.095, 2.42, -0.190]
      });
      addInkPart({
        name: 'ink_arrow_shaft',
        shape: 'box',
        size: [0.36, 0.028, 0.056],
        pos: [0.02, 2.42, -0.190]
      });
      addInkPart({
        name: 'ink_arrow_head',
        shape: 'extrude',
        points: [
          [0.15, 0.068],
          [0.26, 0.0],
          [0.15, -0.068]
        ],
        depth: 0.056,
        pos: [0, 2.42, -0.218]
      });
    } else if (visualId === 'cavalry' || bannerStyle === 'cavalry_lance_pennon') {
      // Classic Horseshoe emblem centered cleanly on the full banner cloth
      addInkPart({
        name: 'ink_horseshoe',
        shape: 'extrude',
        points: [
          [-0.17, 0.20],
          [-0.22, 0.03],
          [-0.18, -0.16],
          [-0.07, -0.25],
          [0.07, -0.25],
          [0.18, -0.16],
          [0.22, 0.03],
          [0.17, 0.20],
          [0.10, 0.20],
          [0.13, 0.02],
          [0.10, -0.11],
          [0.04, -0.17],
          [-0.04, -0.17],
          [-0.10, -0.11],
          [-0.13, 0.02],
          [-0.10, 0.20]
        ],
        depth: 0.056,
        pos: [0, 2.44, -0.218]
      });
    } else if (visualId === 'spearman' || bannerStyle === 'phalanx_gonfalon') {
      // Spearhead & Crossed Halberd Shafts emblem
      addInkPart({
        name: 'ink_spear_shaft',
        shape: 'box',
        size: [0.040, 0.64, 0.056],
        pos: [0, 2.30, -0.190]
      });
      addInkPart({
        name: 'ink_spear_head',
        shape: 'extrude',
        points: [
          [0.0, 0.28],
          [0.115, 0.07],
          [0.0, -0.05],
          [-0.115, 0.07]
        ],
        depth: 0.056,
        pos: [0, 2.52, -0.218]
      });
      addInkPart({
        name: 'ink_spear_wing_l',
        shape: 'box',
        size: [0.26, 0.038, 0.056],
        pos: [-0.08, 2.34, -0.190],
        rot: [0, 0, 0.52]
      });
      addInkPart({
        name: 'ink_spear_wing_r',
        shape: 'box',
        size: [0.26, 0.038, 0.056],
        pos: [0.08, 2.34, -0.190],
        rot: [0, 0, -0.52]
      });
    } else {
      // Crossed Broadswords emblem (Swordsmen)
      addInkPart({
        name: 'ink_sword_blade_1',
        shape: 'box',
        size: [0.044, 0.54, 0.056],
        pos: [0, 2.42, -0.190],
        rot: [0, 0, 0.62]
      });
      addInkPart({
        name: 'ink_sword_guard_1',
        shape: 'box',
        size: [0.19, 0.038, 0.056],
        pos: [0.08, 2.30, -0.190],
        rot: [0, 0, 0.62]
      });
      addInkPart({
        name: 'ink_sword_blade_2',
        shape: 'box',
        size: [0.044, 0.54, 0.056],
        pos: [0, 2.42, -0.190],
        rot: [0, 0, -0.62]
      });
      addInkPart({
        name: 'ink_sword_guard_2',
        shape: 'box',
        size: [0.19, 0.038, 0.056],
        pos: [-0.08, 2.30, -0.190],
        rot: [0, 0, -0.62]
      });
    }

    return bannerGroup;
  }

  _createWorkerCarryProps(torsoGroup) {
    const shared = this._ensureSharedCarryResources();
    const { geoms, mats } = shared;

    const holder = new THREE.Group();
    holder.name = 'worker_carry_props';
    holder.position.set(0, 0.52, -0.34);
    holder.updateMatrix();
    holder.matrixAutoUpdate = false;

    const freezeStaticMesh = (m) => {
      m.updateMatrix();
      m.matrixAutoUpdate = false;
      return m;
    };

    const logGroup = new THREE.Group();
    logGroup.name = 'carry_wood';
    logGroup.visible = false;
    logGroup.matrixAutoUpdate = false;
    for (const offsetY of [-0.08, 0.14]) {
      const logMesh = new THREE.Mesh(geoms.logBark, mats.bark);
      logMesh.rotation.z = Math.PI * 0.5;
      logMesh.position.y = offsetY;
      logMesh.castShadow = true;
      logGroup.add(freezeStaticMesh(logMesh));

      const endCap = new THREE.Mesh(geoms.logCap, mats.core);
      endCap.rotation.z = Math.PI * 0.5;
      endCap.position.y = offsetY;
      logGroup.add(freezeStaticMesh(endCap));
    }
    holder.add(logGroup);

    const goldGroup = new THREE.Group();
    goldGroup.name = 'carry_gold';
    goldGroup.visible = false;
    goldGroup.matrixAutoUpdate = false;
    const goldBar = new THREE.Mesh(geoms.goldBar, mats.gold);
    goldBar.castShadow = true;
    goldGroup.add(freezeStaticMesh(goldBar));
    const goldNugget = new THREE.Mesh(geoms.goldNugget, mats.gold);
    goldNugget.position.set(0, 0.24, 0);
    goldNugget.scale.set(1.25, 0.95, 1.05);
    goldNugget.castShadow = true;
    goldGroup.add(freezeStaticMesh(goldNugget));
    holder.add(goldGroup);

    const ironGroup = new THREE.Group();
    ironGroup.name = 'carry_iron';
    ironGroup.visible = false;
    ironGroup.matrixAutoUpdate = false;
    const lowerIngot = new THREE.Mesh(geoms.lowerIngot, mats.iron);
    lowerIngot.castShadow = true;
    ironGroup.add(freezeStaticMesh(lowerIngot));
    const upperIngot = new THREE.Mesh(geoms.upperIngot, mats.iron);
    upperIngot.position.set(0, 0.22, 0);
    upperIngot.rotation.y = 0.28;
    upperIngot.castShadow = true;
    ironGroup.add(freezeStaticMesh(upperIngot));
    const steelBand = new THREE.Mesh(geoms.steelBand, mats.ironEdge);
    steelBand.position.set(0, 0.1, 0);
    ironGroup.add(freezeStaticMesh(steelBand));
    holder.add(ironGroup);

    const stoneGroup = new THREE.Group();
    stoneGroup.name = 'carry_stone';
    stoneGroup.visible = false;
    stoneGroup.matrixAutoUpdate = false;
    const mainStone = new THREE.Mesh(geoms.mainStone, mats.stone);
    mainStone.position.y = 0.08;
    mainStone.castShadow = true;
    stoneGroup.add(freezeStaticMesh(mainStone));
    const topSlab = new THREE.Mesh(geoms.topSlab, mats.stoneTrim);
    topSlab.position.y = 0.38;
    topSlab.castShadow = true;
    stoneGroup.add(freezeStaticMesh(topSlab));
    holder.add(stoneGroup);

    torsoGroup.add(holder);
    return {
      1: logGroup,
      2: goldGroup,
      3: ironGroup,
      4: stoneGroup
    };
  }

  setWorkerCarryProp(unitGroup, carryType = 0) {
    const props = unitGroup?.userData?.carryProps;
    if (!props) return;
    if (unitGroup.userData.lastCarryType === carryType) return;
    unitGroup.userData.lastCarryType = carryType;

    for (const [key, mesh] of Object.entries(props)) {
      mesh.visible = Number(key) === (carryType | 0);
    }
  }

  _buildHierarchyNodes(
    nodeDict,
    parentGroup,
    socketsMap,
    restPosesMap,
    teamPalette,
    materialRegistry,
    cacheScopeKey
  ) {
    if (!nodeDict) return;

    for (const [jointName, jointDef] of Object.entries(nodeDict)) {
      const jointGroup = new THREE.Group();
      jointGroup.name = jointName;

      const pos = jointDef.pos || [0, 0, 0];
      const rot = jointDef.rot || [0, 0, 0];
      const scale = jointDef.scale || [1, 1, 1];

      jointGroup.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
      jointGroup.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
      jointGroup.scale.set(scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1);

      socketsMap[jointName] = jointGroup;
      restPosesMap[jointName] = {
        pos: [pos[0] || 0, pos[1] || 0, pos[2] || 0],
        rot: [rot[0] || 0, rot[1] || 0, rot[2] || 0],
        scale: [scale[0] ?? 1, scale[1] ?? 1, scale[2] ?? 1]
      };

      const meshes = jointDef.meshes || [];
      for (let i = 0; i < meshes.length; i++) {
        const mesh = this.adapter.createPrimitiveMesh(
          meshes[i],
          teamPalette,
          materialRegistry,
          cacheScopeKey
        );
        jointGroup.add(mesh);
      }

      parentGroup.add(jointGroup);

      if (jointDef.children) {
        this._buildHierarchyNodes(
          jointDef.children,
          jointGroup,
          socketsMap,
          restPosesMap,
          teamPalette,
          materialRegistry,
          cacheScopeKey
        );
      }
    }
  }

  createVisual(visualId, options = {}) {
    const unitDef = this.visualsData.units?.[visualId] || this.visualsData.units?.swordsman;
    const teamId = options.teamId ?? 1;
    const basePalette = this.getTeamPalette(teamId);
    const hasCustomColors = Boolean(options.customTeamColors);
    const teamPalette = hasCustomColors
      ? { ...basePalette, ...options.customTeamColors }
      : { ...basePalette };
    const cacheScopeKey = hasCustomColors
      ? `custom_${JSON.stringify(options.customTeamColors)}`
      : `team_${teamId}`;

    const rootGroup = new THREE.Group();
    rootGroup.name = `unit_${visualId}`;

    const unitScale = unitDef?.scale ?? 1.0;
    rootGroup.scale.set(unitScale, unitScale, unitScale);

    const socketsMap = {};
    const restPosesMap = {};
    const materialRegistry = { primary: [], secondary: [], cloth: [], metal: [], darkMetal: [] };
    const attachedPrefabs = {};

    const ringRadius = unitDef?.selectionRingRadius ?? 0.75;
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(teamPalette.primary),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: teamId === 1 ? 0.92 : 0.45,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    materialRegistry.primary.push(ringMat);

    const ringMesh = new THREE.Mesh(
      this.adapter.getRingGeometry(ringRadius),
      ringMat
    );
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.06;
    ringMesh.name = 'selection_ring';
    ringMesh.updateMatrix();
    ringMesh.matrixAutoUpdate = false;
    rootGroup.add(ringMesh);

    if (unitDef?.type === 'gltf' && unitDef.gltfUrl && this.adapter._externalGltfLoader) {
      const gltfGroup = this.adapter._externalGltfLoader(unitDef.gltfUrl);
      if (gltfGroup) {
        rootGroup.add(gltfGroup);
        this.adapter.bindGltfSockets(gltfGroup, socketsMap, restPosesMap);
      }
    } else {
      if (unitDef?.isMounted && unitDef.mountHierarchy) {
        this._buildHierarchyNodes(
          unitDef.mountHierarchy,
          rootGroup,
          socketsMap,
          restPosesMap,
          teamPalette,
          materialRegistry,
          cacheScopeKey
        );
      }

      if (unitDef?.hierarchy) {
        this._buildHierarchyNodes(
          unitDef.hierarchy,
          rootGroup,
          socketsMap,
          restPosesMap,
          teamPalette,
          materialRegistry,
          cacheScopeKey
        );
      }
    }

    const requiredSockets = unitDef?.hierarchy ? ['torso'] : REQUIRED_UNIT_SOCKETS;
    for (const socketName of requiredSockets) {
      if (!socketsMap[socketName]) {
        const fallback = new THREE.Group();
        fallback.name = socketName;
        rootGroup.add(fallback);
        socketsMap[socketName] = fallback;
        restPosesMap[socketName] = { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };
      }
    }

    // Ensure cape_back and quiver_back sockets exist on torso so Capes, Quivers, and Stowed Weapons never conflict!
    if (socketsMap.torso && !socketsMap.cape_back) {
      const capeSock = new THREE.Group();
      capeSock.name = "cape_back";
      capeSock.position.set(0, 0.38, -0.14);
      socketsMap.torso.add(capeSock);
      socketsMap.cape_back = capeSock;
      restPosesMap.cape_back = { pos: [0, 0.38, -0.14], rot: [0, 0, 0], scale: [1, 1, 1] };
    }
    if (socketsMap.torso && !socketsMap.quiver_back) {
      const quivSock = new THREE.Group();
      quivSock.name = "quiver_back";
      quivSock.position.set(0, 0.25, -0.14);
      socketsMap.torso.add(quivSock);
      socketsMap.quiver_back = quivSock;
      restPosesMap.quiver_back = { pos: [0, 0.25, -0.14], rot: [0, 0, 0], scale: [1, 1, 1] };
    }

    const equipment = unitDef?.equipment || {};
    for (const [socketName, equipCfg] of Object.entries(equipment)) {
      const socketGroup = socketsMap[socketName];
      if (!socketGroup || !equipCfg?.prefab) continue;

      const prefabGroup = this.createPrefab(
        equipCfg.prefab,
        teamPalette,
        materialRegistry,
        {
          gripOffset: equipCfg.gripOffset,
          gripRotation: equipCfg.gripRotation
        },
        cacheScopeKey
      );
      if (prefabGroup) {
        socketGroup.add(prefabGroup);
        attachedPrefabs[socketName] = prefabGroup;
      }
    }

    // Full-Length Continuous Trousers: when trousers are equipped on leg_R / leg_L,
    // extend the trouser cloth material seamlessly across the hip (pelvis) and lower legs (shin_R/L)
    // so trousers cover the entire leg from waist to ankle, while knee/shin armor sits cleanly on top!
    const trouserPrefabId = equipment.leg_R?.prefab || equipment.leg_L?.prefab;
    const trouserPrefabDef = trouserPrefabId ? this.visualsData.prefabs?.[trouserPrefabId] : null;
    if (trouserPrefabDef && Array.isArray(trouserPrefabDef.parts) && trouserPrefabDef.parts.length > 0) {
      const basePart = trouserPrefabDef.parts[0];
      const trouserHex = this.adapter.resolveColor(basePart.color, teamPalette);
      const trouserMat = this.adapter.getSharedStandardMaterial(
        trouserHex,
        basePart.roughness ?? 0.88,
        basePart.metalness ?? 0.05,
        cacheScopeKey
      );
      const trouserMeshNames = new Set([
        "shorts_hip", "glute_R", "glute_L",
        "thigh_R", "quad_R", "shorts_leg_R",
        "thigh_L", "quad_L", "shorts_leg_L",
        "knee_R", "kneecap_R", "calf_R", "calf_muscle_R",
        "knee_L", "kneecap_L", "calf_L", "calf_muscle_L"
      ]);
      for (const sockName of ["pelvis", "leg_R", "leg_L", "shin_R", "shin_L"]) {
        const sg = socketsMap[sockName];
        if (!sg) continue;
        for (let c = 0; c < sg.children.length; c++) {
          const ch = sg.children[c];
          if (ch.isMesh && trouserMeshNames.has(ch.name)) {
            ch.material = trouserMat;
          }
        }
      }
    }

    // Apply custom arrow colors from arrowConfig to arrows inside any equipped quiver,
    // and attach a movable/animatable arrow_socket inside the quiver whenever a bow/crossbow is equipped!
    const arrowCfg = this.visualsData?.arrowConfig || {
      style: "bodkin",
      length: 0.68,
      shaftHex: "#f8fafc",
      headHex: "#ffffff",
      fletchHex: "#e2e8f0"
    };
    const backPrefab = attachedPrefabs.quiver_back || attachedPrefabs.stow_back;
    if (backPrefab) {
      backPrefab.traverse((ch) => {
        if (!ch.isMesh || !ch.material) return;
        if (/^arrow\d+$/.test(ch.name) && arrowCfg.shaftHex) {
          ch.material = this.adapter.getSharedStandardMaterial(arrowCfg.shaftHex, 0.55, 0.1, cacheScopeKey);
        } else if (/^fletch\d+$/.test(ch.name) && arrowCfg.fletchHex) {
          ch.material = this.adapter.getSharedStandardMaterial(arrowCfg.fletchHex, 0.55, 0.1, cacheScopeKey);
        }
      });
      const staticArrow0 = backPrefab.getObjectByName("arrow0");
      const staticFletch0 = backPrefab.getObjectByName("fletch0");
      if (staticArrow0) staticArrow0.visible = false;
      if (staticFletch0) staticFletch0.visible = false;
    }

    const hasBowEquipped = ["weapon_socket_R", "weapon_socket_L"].some((sk) => {
      const pid = equipment[sk]?.prefab;
      const pDef = pid ? this.visualsData?.prefabs?.[pid] : null;
      return Boolean(pid && (pDef?.weaponType === "bow" || /bow/i.test(pid)));
    });

    if (hasBowEquipped && socketsMap.torso && !socketsMap.arrow_socket) {
      const arrowSock = new THREE.Group();
      arrowSock.name = "arrow_socket";
      // Default rest pose sits prominently at the top of the quiver with tip & feathers visible!
      const defaultArrowPos = [-0.03, 0.52, -0.20];
      const defaultArrowRot = [-1.42, 0.0, 0.18];
      arrowSock.position.set(...defaultArrowPos);
      arrowSock.rotation.set(...defaultArrowRot);

      const aLen = Math.max(0.45, Math.min(1.05, Number(arrowCfg.length) || 0.68));
      const aStyle = arrowCfg.style || "bodkin";
      const sMult =
        aStyle === "broadhead"
          ? { hr: 1.55, hl: 1.30, fs: 1.35, fl: 1.22 }
          : aStyle === "needle"
            ? { hr: 0.68, hl: 1.95, fs: 0.80, fl: 1.05 }
            : aStyle === "royal"
              ? { hr: 1.40, hl: 1.40, fs: 1.42, fl: 1.30 }
              : { hr: 1.0, hl: 1.0, fs: 1.0, fl: 1.0 };
      const shaftMat = this.adapter.getSharedStandardMaterial(arrowCfg.shaftHex || "#f8fafc", 0.55, 0.1, cacheScopeKey);
      const headMat = this.adapter.getSharedStandardMaterial(arrowCfg.headHex || "#ffffff", 0.30, 0.80, cacheScopeKey);
      const fletchMat = this.adapter.getSharedStandardMaterial(arrowCfg.fletchHex || "#e2e8f0", 0.65, 0.05, cacheScopeKey);
      const goldMat = this.adapter.getSharedStandardMaterial("#facc15", 0.25, 0.90, cacheScopeKey);

      const shaftM = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, aLen, 6), shaftMat);
      shaftM.name = "drawn_arrow_shaft";
      shaftM.rotation.x = Math.PI * 0.5;
      shaftM.updateMatrix();
      shaftM.matrixAutoUpdate = false;
      arrowSock.add(shaftM);

      const hLen = 0.14 * sMult.hl;
      const hRad = 0.040 * sMult.hr;
      const headM = new THREE.Mesh(new THREE.ConeGeometry(hRad, hLen, aStyle === "needle" ? 8 : 4), headMat);
      headM.name = "drawn_arrow_head";
      headM.rotation.set(Math.PI * 0.5, Math.PI * 0.25, 0);
      if (aStyle === "broadhead") headM.scale.set(1.5, 1.0, 0.55);
      headM.position.set(0, 0, aLen * 0.5 + hLen * 0.42);
      headM.updateMatrix();
      headM.matrixAutoUpdate = false;
      arrowSock.add(headM);

      if (aStyle === "broadhead") {
        for (const sign of [-1, 1]) {
          const barbM = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, hLen * 0.78), headMat);
          barbM.name = sign < 0 ? "drawn_arrow_barb_L" : "drawn_arrow_barb_R";
          barbM.rotation.y = sign * 0.52;
          barbM.position.set(sign * hRad * 0.75, 0, aLen * 0.5 - 0.01);
          barbM.updateMatrix();
          barbM.matrixAutoUpdate = false;
          arrowSock.add(barbM);
        }
      } else if (aStyle === "needle") {
        for (let rIdx = 0; rIdx < 2; rIdx++) {
          const ringM = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.022, 8), headMat);
          ringM.name = `drawn_arrow_ring_${rIdx}`;
          ringM.rotation.x = Math.PI * 0.5;
          ringM.position.set(0, 0, aLen * 0.5 - rIdx * 0.055);
          ringM.updateMatrix();
          ringM.matrixAutoUpdate = false;
          arrowSock.add(ringM);
        }
      } else if (aStyle === "royal") {
        const collarM = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.045, 8), goldMat);
        collarM.name = "drawn_arrow_collar";
        collarM.rotation.x = Math.PI * 0.5;
        collarM.position.set(0, 0, aLen * 0.5 - 0.01);
        collarM.updateMatrix();
        collarM.matrixAutoUpdate = false;
        arrowSock.add(collarM);
        for (const sign of [-1, 1]) {
          const wingM = new THREE.Mesh(new THREE.ConeGeometry(hRad * 0.55, hLen * 0.85, 4), headMat);
          wingM.name = sign < 0 ? "drawn_arrow_wing_L" : "drawn_arrow_wing_R";
          wingM.rotation.set(Math.PI * 0.5, sign * 0.42, 0);
          wingM.position.set(sign * hRad * 0.88, 0, aLen * 0.5 + hLen * 0.18);
          wingM.updateMatrix();
          wingM.matrixAutoUpdate = false;
          arrowSock.add(wingM);
        }
      }

      const fLen = 0.13 * sMult.fl;
      const fSpan = 0.095 * sMult.fs;
      const tailZ = -aLen * 0.5 + fLen * 0.52;
      const finH = new THREE.Mesh(new THREE.BoxGeometry(fSpan, 0.011, fLen), fletchMat);
      finH.name = "drawn_arrow_fletch_h";
      finH.position.set(0, 0, tailZ);
      finH.updateMatrix();
      finH.matrixAutoUpdate = false;
      arrowSock.add(finH);

      const finV = new THREE.Mesh(new THREE.BoxGeometry(0.011, fSpan, fLen), fletchMat);
      finV.name = "drawn_arrow_fletch_v";
      finV.position.set(0, 0, tailZ);
      finV.updateMatrix();
      finV.matrixAutoUpdate = false;
      arrowSock.add(finV);

      socketsMap.torso.add(arrowSock);
      socketsMap.arrow_socket = arrowSock;
      restPosesMap.arrow_socket = {
        pos: [...defaultArrowPos],
        rot: [...defaultArrowRot],
        scale: [1, 1, 1]
      };
    }

    // Stretchable Bowstring Midpoint Socket (bowstring_mid) for any bow object:
    // Replaces the rigid single cylinder bowstring with two dynamic segments anchored at topTip and botTip
    // that stretch to bowstring_mid.position!
    let bowstringRig = null;
    for (const sk of ["weapon_socket_L", "weapon_socket_R"]) {
      const prefGrp = attachedPrefabs[sk];
      if (!prefGrp) continue;
      const oldStr = prefGrp.getObjectByName("bowstring");
      if (!oldStr || !oldStr.isMesh) continue;

      const pid = equipment[sk]?.prefab;
      const pDef = pid ? this.visualsData?.prefabs?.[pid] : null;
      const strPartDef = (pDef?.parts || []).find((p) => p.name === "bowstring");
      const strHeight = strPartDef?.size?.[2] || 1.12;
      const strRadius = strPartDef?.size?.[0] || 0.006;
      const bx = oldStr.position.x;
      const by = oldStr.position.y;
      const bz = oldStr.position.z;
      const strMat = oldStr.material;

      prefGrp.remove(oldStr);

      const midSock = new THREE.Group();
      midSock.name = "bowstring_mid";
      midSock.position.set(bx, by, bz);

      // Small nocking-point grip bead on bowstring_mid so you can see and click it in the 3D Studio
      const nockBead = new THREE.Mesh(new THREE.SphereGeometry(strRadius * 2.4, 6, 6), strMat);
      nockBead.name = "bowstring_nock_bead";
      nockBead.updateMatrix();
      nockBead.matrixAutoUpdate = false;
      midSock.add(nockBead);
      prefGrp.add(midSock);

      const segGeom = new THREE.CylinderGeometry(strRadius, strRadius, 1.0, 6);
      const upperMesh = new THREE.Mesh(segGeom, strMat);
      upperMesh.name = "bowstring_upper";
      upperMesh.matrixAutoUpdate = false;
      prefGrp.add(upperMesh);

      const lowerMesh = new THREE.Mesh(segGeom, strMat);
      lowerMesh.name = "bowstring_lower";
      lowerMesh.matrixAutoUpdate = false;
      prefGrp.add(lowerMesh);

      socketsMap.bowstring_mid = midSock;
      restPosesMap.bowstring_mid = {
        pos: [bx, by, bz],
        rot: [0, 0, 0],
        scale: [1, 1, 1]
      };

      bowstringRig = {
        midSocket: midSock,
        upperMesh,
        lowerMesh,
        topTip: new THREE.Vector3(bx, by + strHeight * 0.5, bz),
        botTip: new THREE.Vector3(bx, by - strHeight * 0.5, bz)
      };
      break;
    }

    let bannerGroup = null;
    if (options.isBannerCarrier && visualId !== 'worker' && socketsMap.torso) {
      bannerGroup = this.createCompanyBanner(
        unitDef?.bannerStyle || 'royal_standard',
        teamPalette,
        materialRegistry,
        cacheScopeKey,
        visualId
      );
      socketsMap.torso.add(bannerGroup);
    }

    let carryProps = null;
    if (visualId === 'worker' && socketsMap.torso) {
      carryProps = this._createWorkerCarryProps(socketsMap.torso);
    }

    rootGroup.userData = {
      visualId,
      unitDef,
      teamId,
      teamPalette,
      sockets: socketsMap,
      restPoses: restPosesMap,
      materialRegistry,
      attachedPrefabs,
      bannerGroup,
      carryProps,
      bowstringRig,
      lastCarryType: 0,
      isMounted: Boolean(unitDef?.isMounted)
    };

    if (bowstringRig) updateBowstringRig(rootGroup);
    return rootGroup;
  }

  applyTeamColors(unitGroup, teamColors = {}) {
    const reg = unitGroup?.userData?.materialRegistry;
    if (!reg) return;

    if (teamColors.primary && Array.isArray(reg.primary)) {
      const col = new THREE.Color(teamColors.primary);
      for (const mat of reg.primary) mat.color.copy(col);
      unitGroup.userData.teamPalette.primary = teamColors.primary;
    }

    if (teamColors.secondary && Array.isArray(reg.secondary)) {
      const col = new THREE.Color(teamColors.secondary);
      for (const mat of reg.secondary) mat.color.copy(col);
      unitGroup.userData.teamPalette.secondary = teamColors.secondary;
    }
  }

  calibrateWeaponGrip(unitGroup, socketName, gripOffset, gripRotation) {
    const prefab = unitGroup?.userData?.attachedPrefabs?.[socketName];
    if (!prefab) return false;

    if (Array.isArray(gripOffset) && gripOffset.length === 3) {
      prefab.position.set(gripOffset[0], gripOffset[1], gripOffset[2]);
      prefab.userData.gripOffset = [...gripOffset];
    }
    if (Array.isArray(gripRotation) && gripRotation.length === 3) {
      prefab.rotation.set(gripRotation[0], gripRotation[1], gripRotation[2]);
      prefab.userData.gripRotation = [...gripRotation];
    }
    prefab.updateMatrix();
    return true;
  }
}

const _bsDir = new THREE.Vector3();
const _bsMid = new THREE.Vector3();
const _bsUp = new THREE.Vector3(0, 1, 0);
export function updateBowstringRig(unitGroup) {
  const rig = unitGroup?.userData?.bowstringRig;
  if (!rig || !rig.midSocket || !rig.upperMesh || !rig.lowerMesh) return;
  const midPos = rig.midSocket.position;
  // Upper half: topTip -> midPos
  _bsDir.subVectors(midPos, rig.topTip);
  const lenU = Math.max(0.001, _bsDir.length());
  _bsMid.addVectors(rig.topTip, midPos).multiplyScalar(0.5);
  rig.upperMesh.position.copy(_bsMid);
  rig.upperMesh.scale.set(1, lenU, 1);
  rig.upperMesh.quaternion.setFromUnitVectors(_bsUp, _bsDir.divideScalar(lenU));
  rig.upperMesh.updateMatrix();

  // Lower half: botTip -> midPos
  _bsDir.subVectors(midPos, rig.botTip);
  const lenL = Math.max(0.001, _bsDir.length());
  _bsMid.addVectors(rig.botTip, midPos).multiplyScalar(0.5);
  rig.lowerMesh.position.copy(_bsMid);
  rig.lowerMesh.scale.set(1, lenL, 1);
  rig.lowerMesh.quaternion.setFromUnitVectors(_bsUp, _bsDir.divideScalar(lenL));
  rig.lowerMesh.updateMatrix();
}
