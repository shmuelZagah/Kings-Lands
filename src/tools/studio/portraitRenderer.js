/**
 * Kings Lands — portrait / icon renderer (src/tools/studio/portraitRenderer.js)
 *
 * Takes a picture of any unit (its rest pose, no banner, no selection ring) with its own small WebGL canvas,
 * so it never touches the studio viewport. Used for HUD portraits and radial-menu icons.
 */

import * as THREE from 'three';
import { FACTION_TEAM_COLORS, applySkinColors, disposeVisual } from './skinUtils.js';

export const PORTRAIT_DEFAULTS = Object.freeze({
  size: 256,                    // px, square
  view: 'bust',                 // 'bust' (head + shoulders) | 'full' (whole unit)
  angle: 'three_quarter',       // 'front' | 'three_quarter'
  background: 'transparent'     // 'transparent' | 'dark' | 'light'
});

const BACKGROUNDS = { dark: '#0f172a', light: '#cbd5e1' };

let _sharedPortraitRenderer = null;
function getSharedPortraitRenderer() {
  if (!_sharedPortraitRenderer) {
    _sharedPortraitRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    _sharedPortraitRenderer.setPixelRatio(1);
  }
  return _sharedPortraitRenderer;
}

export function createPortraitStudio(modelFactory, unitsData) {
  const renderer = getSharedPortraitRenderer();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x44505f, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(2.5, 4, 3.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd2ff, 0.7);
  fill.position.set(-3, 1.5, 1);
  scene.add(fill);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);

  function render(unitId, faction, options = {}) {
    const o = { ...PORTRAIT_DEFAULTS, ...options };
    const unitDef = unitsData.units?.[unitId];
    if (!unitDef) throw new Error(`Unknown unit "${unitId}"`);

    const group = modelFactory.createVisual(unitId, {
      teamId: 1,
      isBannerCarrier: false,
      customTeamColors: FACTION_TEAM_COLORS[faction] || null
    });
    applySkinColors(group, unitDef, faction);
    for (const name of ['selection_ring', 'company_banner']) {
      let n;
      while ((n = group.getObjectByName(name))) n.removeFromParent();
    }
    scene.add(group);
    group.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Frame bust generously so tall hats (e.g. Wizard hat) and wide staffs/weapons are never clipped at canvas edges!
    const regionH = o.view === 'full' ? size.y : size.y * 0.62;
    const regionCenterY = o.view === 'full' ? center.y : box.max.y - regionH * 0.46;
    const maxHorizSpan = Math.max(size.x, size.z);
    const reach = o.view === 'full' ? Math.max(size.y, maxHorizSpan) : Math.max(regionH, maxHorizSpan * 0.92);
    const dist = ((reach / 2) / Math.tan(THREE.MathUtils.degToRad(28 / 2))) * (o.view === 'full' ? 1.25 : 1.52);

    if (o.customCamera && o.customCamera.position && o.customCamera.target) {
      camera.fov = o.customCamera.fov || 38;
      camera.position.copy(o.customCamera.position);
      camera.lookAt(o.customCamera.target);
      camera.updateProjectionMatrix();
    } else {
      camera.fov = 28;
      const yaw = o.angle === 'front' ? 0 : THREE.MathUtils.degToRad(28);
      const pitch = THREE.MathUtils.degToRad(o.view === 'full' ? 10 : 7);
      const target = new THREE.Vector3(center.x * 0.35, regionCenterY, center.z * 0.35);
      camera.position.set(
        target.x + dist * Math.sin(yaw) * Math.cos(pitch),
        target.y + dist * Math.sin(pitch),
        target.z + dist * Math.cos(yaw) * Math.cos(pitch)
      );
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    }

    renderer.setSize(o.size, o.size, false);
    const bg = BACKGROUNDS[o.background];
    renderer.setClearColor(bg || 0x000000, bg ? 1 : 0);
    renderer.render(scene, camera);

    const out = document.createElement('canvas');
    out.width = o.size; out.height = o.size;
    out.getContext('2d').drawImage(renderer.domElement, 0, 0);

    scene.remove(group);
    disposeVisual(group);
    return out;
  }

  function dispose() {
    // Keep shared renderer alive to avoid WebGL context exhaustion across multiple portrait renders
  }

  return { render, dispose };
}

export const canvasToPngBytes = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob(async (blob) => {
    if (!blob) { reject(new Error('PNG export failed')); return; }
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, 'image/png');
});

// ---------------------------------------------------------------- zip (stored)

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** files: [{ name: 'a/b.png', data: Uint8Array }] -> Uint8Array of a valid .zip */
export function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const push = (u8) => { chunks.push(u8); offset += u8.length; };
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const dosTime = 0x6000;   // 12:00:00
  const dosDate = 0x5a21;   // 2025-01-01

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const header = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)
    ]);
    central.push({ name, crc, size: f.data.length, offset });
    push(header); push(name); push(f.data);
  }
  const cdStart = offset;
  for (const c of central) {
    push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(c.offset)
    ]));
    push(c.name);
  }
  const cdSize = offset - cdStart;
  push(new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(cdStart), ...u16(0)]));

  const out = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

export function downloadBytes(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
