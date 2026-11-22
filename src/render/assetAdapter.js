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

  getSharedStandardMaterial(resolvedHex, roughness, metalness, cacheScopeKey = 'shared') {
    const rKey = Math.round((roughness ?? 0.65) * 100);
    const mKey = Math.round((metalness ?? 0.2) * 100);
    const matKey = `${cacheScopeKey}:${resolvedHex}:${rKey}:${mKey}`;

    let mat = this._materialCache.get(matKey);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(resolvedHex),
        roughness: roughness ?? 0.65,
        metalness: metalness ?? 0.2
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
      ? `:${JSON.stringify(partDef.vertices || [])}:${JSON.stringify(partDef.faces || partDef.indices || [])}`
      : '';
    const cacheKey = `${shape}:${sizeKey}:${partDef.depth || 0}:${partDef.noBevel ? 1 : 0}${latheKey}${meshKey}`;

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
      geom = new THREE.BufferGeometry();
      const rawVerts = Array.isArray(partDef.vertices) ? partDef.vertices : [];
      const flatVerts = Array.isArray(rawVerts[0]) ? rawVerts.flat() : rawVerts;
      const posArr = new Float32Array(flatVerts.length ? flatVerts : [-0.15, -0.15, 0, 0.15, -0.15, 0, 0, 0.2, 0]);
      geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      const rawFaces = partDef.faces || partDef.indices;
      if (Array.isArray(rawFaces) && rawFaces.length > 0) {
        const flatIdx = Array.isArray(rawFaces[0]) ? rawFaces.flat() : rawFaces;
        geom.setIndex(flatIdx);
      }
      geom.computeVertexNormals();
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
      if (tex.repeat?.set) tex.repeat.set(rep[0], rep[1]);
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
      if (tex.repeat?.set) tex.repeat.set(rep[0], rep[1]);
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
      if (tex.repeat?.set) tex.repeat.set(rep[0], rep[1]);
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
      if (tex.repeat?.set) tex.repeat.set(rep[0], rep[1]);
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
      (mat.userData ||= {}).ownMaterial = true;
    } else {
      mat = this.getSharedStandardMaterial(
        resolvedHex,
        partDef.roughness ?? 0.65,
        partDef.metalness ?? 0.2,
        cacheScopeKey
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

