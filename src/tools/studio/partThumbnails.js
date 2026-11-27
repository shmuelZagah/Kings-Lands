/**
 * Square 3D thumbnails for the Studio "Add" palette (Primitives + Obj library).
 * Reuses the Map Editor's thumbnail renderer; everything is cached so the palette never re-renders a shape twice.
 */

import * as THREE from 'three';
import { renderStaticMeshThumbnailDataUrl, loadTexturedGlbTemplate } from '../map_editor/mapStateManager.js';
import { createPrimitiveGeometry } from './buildingGlbLibrary.js';

const MAX_TRIANGLES = 6000;
const primCache = new Map();
const glbCache = new Map();

function hexToRgb255(hex) {
  const c = new THREE.Color(hex || '#94a3b8');
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

/** Flatten any three.js object (or bare geometry) into the `{vertices, faces, colors}` shape the thumbnail renderer expects. */
export function meshDataFromObject3D(root, fallbackHex = '#94a3b8') {
  const vertices = [];
  const faces = [];
  const colors = [];
  root.updateWorldMatrix?.(true, true);
  const v = new THREE.Vector3();
  const visit = (o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const colAttr = o.geometry.attributes.color;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const base = mat?.color ? hexToRgb255(`#${mat.color.getHexString()}`) : hexToRgb255(fallbackHex);
    const offset = vertices.length;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      vertices.push([v.x, v.y, v.z]);
      colors.push(colAttr
        ? [Math.round(colAttr.getX(i) * 255), Math.round(colAttr.getY(i) * 255), Math.round(colAttr.getZ(i) * 255)]
        : base);
    }
    const idx = o.geometry.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      faces.push(idx
        ? [offset + idx.getX(t * 3), offset + idx.getX(t * 3 + 1), offset + idx.getX(t * 3 + 2)]
        : [offset + t * 3, offset + t * 3 + 1, offset + t * 3 + 2]);
    }
  };
  if (root.isMesh) visit(root);
  root.traverse?.(visit);
  if (faces.length > MAX_TRIANGLES) faces.length = MAX_TRIANGLES;
  return { vertices, faces, colors };
}

export function primitiveThumbnail(shape, colorHex = '#94a3b8') {
  const key = `${shape}|${colorHex}`;
  if (primCache.has(key)) return primCache.get(key);
  let url = '';
  try {
    const { geometry: geo, yOffset } = createPrimitiveGeometry({ shape });
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colorHex }));
    mesh.position.y = yOffset || 0;
    url = renderStaticMeshThumbnailDataUrl(meshDataFromObject3D(mesh, colorHex));
    geo.dispose();
  } catch (_) { url = ''; }
  primCache.set(key, url);
  return url;
}

/** Async: decodes the saved .glb once and renders its thumbnail. Resolves '' when it cannot be drawn. */
export function glbLibraryThumbnail(item) {
  if (!item?.id) return Promise.resolve('');
  const key = `${item.id}|${item.glbByteLength || 0}`;
  if (glbCache.has(key)) return glbCache.get(key);
  const p = Promise.resolve()
    .then(() => loadTexturedGlbTemplate({ id: `${item.id}__thumb`, glbBase64: item.glbBase64, fitSize: item.fitSize || 4 }))
    .then((tpl) => (tpl ? renderStaticMeshThumbnailDataUrl(meshDataFromObject3D(tpl)) : ''))
    .catch(() => '');
  glbCache.set(key, p);
  return p;
}
