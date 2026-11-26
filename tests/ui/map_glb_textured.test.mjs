import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  configureTexturedGlbMaterials,
  createTreeMeshBySkin,
  createMineMeshBySkin,
  createDecorativePropMesh,
  hydrateMapState,
  serializeMapState
} from '../../src/tools/map_editor/mapStateManager.js';
import { GLB_LARGE_FILE_WARN_BYTES, MapEditorApp } from '../../src/tools/map_editor/mapEditorApp.js';

function makeMinimalGlbBuffer(bytePadTo = 0) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]);
  const idx = new Uint16Array([0, 1, 2]);
  const posBuf = Buffer.from(pos.buffer);
  const idxBuf = Buffer.from(idx.buffer);
  const padIdx = (4 - (idxBuf.length % 4)) % 4;
  const rawBin = Buffer.concat([posBuf, idxBuf, Buffer.alloc(padIdx)]);
  const extraPad = bytePadTo > rawBin.length ? bytePadTo - rawBin.length : 0;
  const binPad = (4 - ((rawBin.length + extraPad) % 4)) % 4;
  const bin = Buffer.concat([rawBin, Buffer.alloc(extraPad + binPad)]);

  const jsonObj = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length, byteLength: idxBuf.length, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0
  };
  const jsonStr = JSON.stringify(jsonObj);
  const jsonRaw = Buffer.from(jsonStr, 'utf8');
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonRaw, Buffer.from(' '.repeat(jsonPad), 'utf8')]);

  const totalLen = 12 + 8 + jsonChunk.length + 8 + bin.length;
  const out = Buffer.alloc(totalLen);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  const binOff = 20 + jsonChunk.length;
  out.writeUInt32LE(bin.length, binOff);
  out.writeUInt32LE(0x004e4942, binOff + 4);
  bin.copy(out, binOff + 8);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

test('Task A: base64/ArrayBuffer roundtrip preserves GLB binary payload', () => {
  const buf = makeMinimalGlbBuffer();
  const b64 = arrayBufferToBase64(buf);
  const back = base64ToArrayBuffer(b64);
  assert.deepEqual(new Uint8Array(back), new Uint8Array(buf));
});

test('Task A: configureTexturedGlbMaterials sets SRGBColorSpace, DoubleSide, alphaTest ~0.5 on alpha materials, and preserves roughness/metalness', () => {
  const leafTex = new THREE.Texture();
  const leafAlphaMap = new THREE.Texture();
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafTex,
    roughness: 0.62,
    metalness: 0.04,
    transparent: true
  });
  leafMat.alphaMap = leafAlphaMap;

  const barkTex = new THREE.Texture();
  const barkMat = new THREE.MeshStandardMaterial({
    map: barkTex,
    roughness: 0.91,
    metalness: 0.12,
    transparent: false
  });
  barkMat.alphaTest = 0;

  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), leafMat));
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), barkMat));

  configureTexturedGlbMaterials(root);

  assert.equal(leafMat.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(leafMat.side, THREE.DoubleSide);
  assert.equal(leafMat.alphaTest, 0.5);
  assert.equal(leafMat.transparent, false);
  assert.equal(leafMat.roughness, 0.62);
  assert.equal(leafMat.metalness, 0.04);

  assert.equal(barkMat.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(barkMat.side, THREE.DoubleSide);
  assert.equal(barkMat.alphaTest, 0);
  assert.equal(barkMat.roughness, 0.91);
  assert.equal(barkMat.metalness, 0.12);
});

test('Task A: importGlbPropFromBuffer and importGlbResourceFromBuffer store kind glb_textured + original GLB + vertex fallback and warn > 3 MB', async () => {
  const warnings = [];
  const fakeApp = {
    mapState: hydrateMapState({ isCustomMapActive: true }),
    activeResourceType: 'wood',
    activeResourceSkins: { wood: 'pine_emerald', coins: 'gold_vein', iron: 'iron_outcrop', stone: 'stone_granite' },
    activePropType: 'statue_king',
    _nextUidCounter: 1,
    _showMapEditorWarning(msg) {
      warnings.push(msg);
    },
    importGlbPropFromBuffer: MapEditorApp.prototype.importGlbPropFromBuffer,
    importGlbResourceFromBuffer: MapEditorApp.prototype.importGlbResourceFromBuffer
  };

  const smallGlb = makeMinimalGlbBuffer();
  const propAsset = await fakeApp.importGlbPropFromBuffer(smallGlb, 'OakProp.glb');
  assert.equal(propAsset.kind, 'glb_textured');
  assert.ok(propAsset.glbBase64 && propAsset.glbBase64.length > 10);
  assert.ok(Array.isArray(propAsset.vertices) && propAsset.vertices.length > 0);
  assert.ok(Array.isArray(propAsset.faces) && propAsset.faces.length > 0);
  assert.equal(warnings.length, 0);

  const largeGlb = makeMinimalGlbBuffer(GLB_LARGE_FILE_WARN_BYTES + 1024);
  const treeEntry = await fakeApp.importGlbResourceFromBuffer(largeGlb, 'GiantTree.glb', 'wood');
  assert.equal(treeEntry.kind, 'glb_textured');
  assert.ok(treeEntry.glbBase64 && treeEntry.glbBase64.length > 10);
  assert.ok(treeEntry.sizeWarning && treeEntry.sizeWarning.includes('3 MB'));
  assert.equal(warnings.length, 1);

  // Serialization / hydration roundtrip keeps glb_textured + glbBase64
  const roundtrip = hydrateMapState(serializeMapState(fakeApp.mapState));
  const treeMesh = createTreeMeshBySkin(treeEntry.id, 1.2, 0.5, roundtrip.customResourceSkins);
  assert.equal(treeMesh.userData.skipStaticMerge, true);
  assert.ok(treeMesh.children.length >= 1);

  const propMesh = createDecorativePropMesh({ propType: propAsset.id, scale: 1.0, rotY: 0 }, roundtrip.customPropAssets);
  assert.equal(propMesh.userData.skipStaticMerge, true);
  assert.ok(propMesh.children.length >= 1);

  const mineMesh = createMineMeshBySkin('coins', 'nonexistent_or_fallback', 1.0, 0, roundtrip.customResourceSkins);
  assert.ok(mineMesh.children.length >= 1);
});
