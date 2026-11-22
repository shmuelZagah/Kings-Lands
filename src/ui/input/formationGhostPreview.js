import { resolveUnitActiveCapabilities } from '../../sim/combatCapabilitiesRegistry.js';
import { resolveAutoUnitIconKey } from '../hud/unitIconsCatalog.js';
import unitStatsData from '../../data/unitStats.json';
/**
 * Kings Lands — Total War-Style 2D Ground Tactical Icons & Formation Ghost Preview
 * (src/ui/input/formationGhostPreview.js)
 *
 * Replaces 3D cylinder ghosts with ultra-fast 2D ground decal InstancedMeshes:
 * - `swordsman`: Sword icon (Blue)
 * - `spearman`: Spear icon (Emerald)
 * - `archer`: Bow & Arrow icon (Sky)
 * - `cavalry`: Horseshoe icon (Amber)
 * - `worker`: Hammer icon (Orange/Slate)
 * - `hero`: Crown/Star icon (Gold/Cyan)
 * - `default`: Clean empty tactical circle
 *
 * Drag Line & Arrow Offset Fix:
 * - Offsets the drag line and directional arrows forward in front of the front row along `facingDir`
 *   (and renders unit icons on top of lines/arrows) so the line and arrow never cover the front row
 *   of units or hide a single Hero's circle.
 */

import * as THREE from 'three';
import { toFx, toFloat, ANGLE_STEPS } from '../../core/fx.js';
import { computeArmyDragLayoutFx } from '../../sim/formations/armyDrag.js';

const MAX_INSTANCES_PER_ICON_TYPE = 1200;
const MAX_COMPANY_ARROWS = 64;

const ICON_TYPES = Object.freeze([
  'swordsman',
  'spearman',
  'archer',
  'cavalry',
  'worker',
  'hero',
  'ballista',
  'default'
]);

const ICON_PALETTES = Object.freeze({
  swordsman: { ring: '#3b82f6', fill: 'rgba(30, 58, 138, 0.55)', glyph: '#eff6ff' },
  spearman: { ring: '#10b981', fill: 'rgba(6, 78, 59, 0.55)', glyph: '#ecfdf5' },
  archer: { ring: '#38bdf8', fill: 'rgba(12, 74, 110, 0.55)', glyph: '#f0f9ff' },
  cavalry: { ring: '#fbbf24', fill: 'rgba(120, 53, 15, 0.55)', glyph: '#fef3c7' },
  worker: { ring: '#f59e0b', fill: 'rgba(51, 65, 85, 0.62)', glyph: '#fef3c7' },
  hero: { ring: '#facc15', fill: 'rgba(12, 74, 110, 0.68)', glyph: '#fef08a' },
  ballista: { ring: '#fb923c', fill: 'rgba(124, 45, 18, 0.60)', glyph: '#ffedd5' },
  default: { ring: '#94a3b8', fill: 'rgba(15, 23, 42, 0.45)', glyph: '#f8fafc' }
});

export class FormationGhostPreview {
  constructor(scene, sampleGroundYFn) {
    this.scene = scene;
    this.sampleGroundY = sampleGroundYFn;

    this._dummyObj = new THREE.Object3D();
    this.iconInstancedMeshes = new Map();
    this._flashTimer = 0;
    this._flashDuration = 0.28;

    this._buildMeshes();
  }

  _createUnitIconTexture(unitType) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const pal = ICON_PALETTES[unitType] || ICON_PALETTES.default;

    ctx.clearRect(0, 0, 128, 128);

    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.fillStyle = pal.fill;
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.85)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.lineWidth = 6.5;
    ctx.strokeStyle = pal.ring;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(64, 3);
    ctx.lineTo(73, 15);
    ctx.lineTo(55, 15);
    ctx.closePath();
    ctx.fillStyle = pal.ring;
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = pal.glyph;
    ctx.fillStyle = pal.glyph;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (unitType === 'swordsman') {
      ctx.beginPath();
      ctx.moveTo(64, 21);
      ctx.lineTo(71, 34);
      ctx.lineTo(69, 74);
      ctx.lineTo(59, 74);
      ctx.lineTo(57, 34);
      ctx.closePath();
      ctx.fill();

      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(44, 75);
      ctx.lineTo(84, 75);
      ctx.stroke();

      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(64, 75);
      ctx.lineTo(64, 95);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(64, 99, 5.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (unitType === 'spearman') {
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(64, 42);
      ctx.lineTo(64, 103);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(64, 19);
      ctx.lineTo(76, 46);
      ctx.lineTo(64, 40);
      ctx.lineTo(52, 46);
      ctx.closePath();
      ctx.fill();

      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(53, 52);
      ctx.lineTo(75, 52);
      ctx.stroke();
    } else if (unitType === 'archer') {
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(64, 70, 32, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();

      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(35, 56);
      ctx.lineTo(64, 84);
      ctx.lineTo(93, 56);
      ctx.stroke();

      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(64, 86);
      ctx.lineTo(64, 26);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(64, 19);
      ctx.lineTo(73, 33);
      ctx.lineTo(55, 33);
      ctx.closePath();
      ctx.fill();
    } else if (unitType === 'cavalry') {
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.arc(64, 62, 24, Math.PI * 0.82, Math.PI * 0.18, false);
      ctx.stroke();

      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(39, 74);
      ctx.lineTo(50, 80);
      ctx.moveTo(89, 74);
      ctx.lineTo(78, 80);
      ctx.stroke();
    } else if (unitType === 'worker') {
      ctx.lineWidth = 7.5;
      ctx.beginPath();
      ctx.moveTo(64, 46);
      ctx.lineTo(64, 98);
      ctx.stroke();

      ctx.beginPath();
      ctx.roundRect(38, 32, 52, 18, 4);
      ctx.fill();
    } else if (unitType === 'hero') {
      ctx.beginPath();
      ctx.moveTo(36, 82);
      ctx.lineTo(92, 82);
      ctx.lineTo(86, 46);
      ctx.lineTo(72, 60);
      ctx.lineTo(64, 38);
      ctx.lineTo(56, 60);
      ctx.lineTo(42, 46);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(64, 64, 24, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.needsUpdate = true;

    const ASSET_ICON_TYPES = new Set([
      'swordsman',
      'spearman',
      'archer',
      'cavalry',
      'worker',
      'hero',
      'ballista'
    ]);
    if (typeof Image !== 'undefined' && ASSET_ICON_TYPES.has(unitType)) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, 128, 128);
        ctx.save();
        ctx.beginPath();
        ctx.arc(64, 64, 55, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, 4, 4, 120, 120);
        ctx.restore();

        // Crisp tactical team/class rim & facing arrow
        ctx.beginPath();
        ctx.arc(64, 64, 54, 0, Math.PI * 2);
        ctx.lineWidth = 5;
        ctx.strokeStyle = pal.ring;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(64, 1);
        ctx.lineTo(74, 14);
        ctx.lineTo(54, 14);
        ctx.closePath();
        ctx.fillStyle = pal.ring;
        ctx.fill();

        texture.needsUpdate = true;
      };
      img.src = `/assets/tactical_icon_${unitType}.jpg`;
    }

    return texture;
  }

  _ensureCustomPlaceholderInstancedMesh(iconKey, dataUrl) {
    if (this.iconInstancedMeshes.has(iconKey)) {
      return this.iconInstancedMeshes.get(iconKey);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const pal = ICON_PALETTES.default;
    if (ctx && typeof ctx.arc === 'function') {
      ctx.clearRect(0, 0, 128, 128);
      ctx.beginPath();
      ctx.arc(64, 64, 54, 0, Math.PI * 2);
      ctx.fillStyle = pal.fill;
      ctx.fill();
      ctx.lineWidth = 6.5;
      ctx.strokeStyle = '#34d399';
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    if (typeof Image !== 'undefined' && dataUrl) {
      const img = new Image();
      img.onload = () => {
        if (ctx && typeof ctx.drawImage === 'function') {
          ctx.drawImage(img, 26, 26, 76, 76);
          tex.needsUpdate = true;
        }
      };
      img.src = dataUrl;
    }
    const planeGeom = new THREE.PlaneGeometry(1.28, 1.28);
    planeGeom.rotateX(-Math.PI / 2);
    planeGeom.rotateY(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const instMesh = new THREE.InstancedMesh(planeGeom, mat, MAX_INSTANCES_PER_ICON_TYPE);
    instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instMesh.frustumCulled = false;
    instMesh.renderOrder = 45;
    instMesh.count = 0;
    this.previewGroup.add(instMesh);
    this.iconInstancedMeshes.set(iconKey, instMesh);
    return instMesh;
  }

  _buildMeshes() {
    this.previewGroup = new THREE.Group();
    this.previewGroup.name = 'FormationPreview3DGroup';
    this.previewGroup.visible = false;
    this.scene.add(this.previewGroup);

    const planeGeom = new THREE.PlaneGeometry(1.28, 1.28);
    planeGeom.rotateX(-Math.PI / 2);
    planeGeom.rotateY(-Math.PI / 2);

    for (let i = 0; i < ICON_TYPES.length; i++) {
      const typeKey = ICON_TYPES[i];
      const tex = this._createUnitIconTexture(typeKey);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.94,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      });

      const instMesh = new THREE.InstancedMesh(planeGeom, mat, MAX_INSTANCES_PER_ICON_TYPE);
      instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      instMesh.frustumCulled = false;
      // Render unit circles ABOVE the drag line and arrows so no unit or Hero slot is ever hidden
      instMesh.renderOrder = 45;
      instMesh.count = 0;
      this.previewGroup.add(instMesh);
      this.iconInstancedMeshes.set(typeKey, instMesh);
    }

    this.companyArrows = [];
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 1.15);
    arrowShape.lineTo(0.68, 0.12);
    arrowShape.lineTo(0.24, 0.12);
    arrowShape.lineTo(0.24, -0.75);
    arrowShape.lineTo(-0.24, -0.75);
    arrowShape.lineTo(-0.24, 0.12);
    arrowShape.lineTo(-0.68, 0.12);
    arrowShape.closePath();

    const arrowGeom = new THREE.ShapeGeometry(arrowShape);
    arrowGeom.rotateX(-Math.PI / 2);
    arrowGeom.rotateY(-Math.PI / 2);

    for (let i = 0; i < MAX_COMPANY_ARROWS; i++) {
      const arrowMat = new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(arrowGeom, arrowMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 41;
      this.previewGroup.add(mesh);
      this.companyArrows.push(mesh);
    }

    const unifiedArrowMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    this.unifiedArmyArrow = new THREE.Mesh(arrowGeom, unifiedArrowMat);
    this.unifiedArmyArrow.scale.set(2.1, 1.0, 2.1);
    this.unifiedArmyArrow.visible = false;
    this.unifiedArmyArrow.frustumCulled = false;
    this.unifiedArmyArrow.renderOrder = 41;
    this.previewGroup.add(this.unifiedArmyArrow);

    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ]);
    this.dragLineMesh = new THREE.Line(
      lineGeom,
      new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false })
    );
    this.dragLineMesh.frustumCulled = false;
    this.dragLineMesh.renderOrder = 40;
    this.previewGroup.add(this.dragLineMesh);
  }

  hide() {
    this._flashTimer = 0;
    if (this.previewGroup) {
      this.previewGroup.visible = false;
    }
    this._restoreNormalAppearance();
  }

  _restoreNormalAppearance() {
    if (this.dragLineMesh) this.dragLineMesh.visible = true;
    for (const instMesh of this.iconInstancedMeshes.values()) {
      instMesh.material.color.setRGB(1, 1, 1);
      instMesh.material.opacity = 0.94;
    }
    for (let i = 0; i < this.companyArrows.length; i++) {
      this.companyArrows[i].material.opacity = 0.9;
    }
    if (this.unifiedArmyArrow) {
      this.unifiedArmyArrow.material.opacity = 0.94;
    }
  }

  triggerCommitFlash() {
    if (!this.previewGroup || !this.previewGroup.visible) return;
    this._flashTimer = this._flashDuration;
    if (this.dragLineMesh) this.dragLineMesh.visible = false;
    for (const instMesh of this.iconInstancedMeshes.values()) {
      instMesh.material.color.setRGB(1.9, 1.9, 1.6);
      instMesh.material.opacity = 1.0;
    }
  }

  stepFlash(dtSeconds) {
    if (this._flashTimer <= 0) return;
    this._flashTimer -= dtSeconds;
    if (this._flashTimer <= 0) {
      this.hide();
      return;
    }
    const t = Math.max(0, this._flashTimer / this._flashDuration);
    const boost = 1.0 + 0.95 * t;
    for (const instMesh of this.iconInstancedMeshes.values()) {
      instMesh.material.color.setRGB(boost, boost, 1.0 + 0.65 * t);
      instMesh.material.opacity = t * 0.98;
    }
    for (let i = 0; i < this.companyArrows.length; i++) {
      this.companyArrows[i].material.opacity = t * 0.9;
    }
    if (this.unifiedArmyArrow) {
      this.unifiedArmyArrow.material.opacity = t * 0.94;
    }
  }

  update(dragStartWorld, dragCurrentWorld, descriptors, preserveRelative = false) {
    if (!dragStartWorld || !dragCurrentWorld || !descriptors || descriptors.length === 0) {
      this.hide();
      return;
    }

    const dragDist = dragStartWorld.distanceTo(dragCurrentWorld);
    if (dragDist < 5.2) {
      this.hide();
      return;
    }

    const layout = computeArmyDragLayoutFx(
      descriptors,
      { xFx: toFx(dragStartWorld.x), zFx: toFx(dragStartWorld.z) },
      { xFx: toFx(dragCurrentWorld.x), zFx: toFx(dragCurrentWorld.z) },
      null,
      { preserveRelative }
    );

    this._flashTimer = 0;
    this._restoreNormalAppearance();
    this.previewGroup.visible = true;

    const facingAngleRad = (layout.facingDir * (Math.PI * 2)) / ANGLE_STEPS;
    const fwdX = Math.cos(facingAngleRad);
    const fwdZ = Math.sin(facingAngleRad);

    // Offset the drag line and directional arrows forward in front of the front row so they NEVER sit on top of unit/Hero circles!
    const lineForwardMeters = 1.15;
    const arrowForwardMeters = 1.85;

    const linePos = this.dragLineMesh.geometry.attributes.position;
    if (preserveRelative) {
      const startOffX = dragStartWorld.x + fwdX * lineForwardMeters;
      const startOffZ = dragStartWorld.z + fwdZ * lineForwardMeters;
      const midY = this.sampleGroundY(startOffX, startOffZ) + 0.22;
      const tipY = this.sampleGroundY(dragCurrentWorld.x, dragCurrentWorld.z) + 0.22;
      linePos.setXYZ(0, startOffX, midY, startOffZ);
      linePos.setXYZ(1, startOffX, midY, startOffZ);
      linePos.setXYZ(2, dragCurrentWorld.x, tipY, dragCurrentWorld.z);
      linePos.needsUpdate = true;
      this.dragLineMesh.material.color.setHex(0x38bdf8);

      const arrowX = dragStartWorld.x + fwdX * (arrowForwardMeters + 0.6);
      const arrowZ = dragStartWorld.z + fwdZ * (arrowForwardMeters + 0.6);
      const arrowY = this.sampleGroundY(arrowX, arrowZ) + 0.24;
      this.unifiedArmyArrow.position.set(arrowX, arrowY, arrowZ);
      this.unifiedArmyArrow.rotation.y = -facingAngleRad;
      this.unifiedArmyArrow.visible = true;

      for (let a = 0; a < this.companyArrows.length; a++) {
        this.companyArrows[a].visible = false;
      }
    } else {
      this.unifiedArmyArrow.visible = false;
      this.dragLineMesh.material.color.setHex(0xfbbf24);

      const dx = dragCurrentWorld.x - dragStartWorld.x;
      const dz = dragCurrentWorld.z - dragStartWorld.z;
      const leftWingX = dragStartWorld.x - dx + fwdX * lineForwardMeters;
      const leftWingZ = dragStartWorld.z - dz + fwdZ * lineForwardMeters;
      const midWingX = dragStartWorld.x + fwdX * lineForwardMeters;
      const midWingZ = dragStartWorld.z + fwdZ * lineForwardMeters;
      const rightWingX = dragCurrentWorld.x + fwdX * lineForwardMeters;
      const rightWingZ = dragCurrentWorld.z + fwdZ * lineForwardMeters;

      const leftY = this.sampleGroundY(leftWingX, leftWingZ) + 0.22;
      const midY = this.sampleGroundY(midWingX, midWingZ) + 0.22;
      const rightY = this.sampleGroundY(rightWingX, rightWingZ) + 0.22;

      linePos.setXYZ(0, leftWingX, leftY, leftWingZ);
      linePos.setXYZ(1, midWingX, midY, midWingZ);
      linePos.setXYZ(2, rightWingX, rightY, rightWingZ);
      linePos.needsUpdate = true;
    }

    const countsByType = new Map();
    for (let i = 0; i < ICON_TYPES.length; i++) {
      countsByType.set(ICON_TYPES[i], 0);
    }

    for (let p = 0; p < layout.placements.length; p++) {
      const pl = layout.placements[p];

      if (!preserveRelative && p < this.companyArrows.length) {
        const arrow = this.companyArrows[p];
        const plRad = (pl.facingDir * (Math.PI * 2)) / ANGLE_STEPS;
        const plFwdX = Math.cos(plRad);
        const plFwdZ = Math.sin(plRad);
        const cx = toFloat(pl.targetXFx) + plFwdX * arrowForwardMeters;
        const cz = toFloat(pl.targetZFx) + plFwdZ * arrowForwardMeters;
        const cy = this.sampleGroundY(cx, cz);
        arrow.position.set(cx, cy + 0.22, cz);
        arrow.rotation.y = -plRad;
        arrow.visible = true;
      }

      const uStat = unitStatsData?.units?.[pl.unitType];
      const descForPl = descriptors.find((d) => (d.companyId | 0) === (pl.companyId | 0));
      const activeLoadoutIdx = (descForPl?.activeLoadoutIdx | 0) || 0;
      const isSet2 = activeLoadoutIdx === 1;
      const activeCaps = uStat ? resolveUnitActiveCapabilities(pl.unitType, activeLoadoutIdx, unitStatsData) : null;
      const weaponBasedRole = uStat
        ? resolveAutoUnitIconKey(uStat, pl.unitType, activeCaps?.weaponTypes || null)
        : pl.unitType;
      const explicitPhKey = isSet2 ? uStat?.placeholderIconKeySet2 : uStat?.placeholderIconKey;
      const explicitPhUrl = isSet2 ? uStat?.placeholderIconUrlSet2 : uStat?.placeholderIconUrl;
      const desiredKey = explicitPhKey && explicitPhKey !== 'auto'
        ? explicitPhKey
        : (this.iconInstancedMeshes.has(weaponBasedRole) ? weaponBasedRole : (this.iconInstancedMeshes.has(pl.unitType) ? pl.unitType : 'swordsman'));
      const customLibUrl = desiredKey && Array.isArray(unitStatsData?.customPlaceholderIcons)
        ? unitStatsData.customPlaceholderIcons.find((c) => c && c.id === desiredKey)?.dataUrl
        : null;
      const effCustomUrl = explicitPhUrl || customLibUrl || null;
      if (effCustomUrl && !this.iconInstancedMeshes.has(desiredKey)) {
        this._ensureCustomPlaceholderInstancedMesh(desiredKey, effCustomUrl);
        if (!countsByType.has(desiredKey)) countsByType.set(desiredKey, 0);
      }
      const typeKey = this.iconInstancedMeshes.has(desiredKey) ? desiredKey : 'default';
      const instMesh = this.iconInstancedMeshes.get(typeKey);
      let cursor = countsByType.get(typeKey) || 0;
      const isCav = pl.unitType === 'cavalry';
      const scaleVal = isCav ? 1.28 : pl.unitType === 'hero' ? 1.18 : 1.0;

      for (let s = 0; s < pl.unitSlotsWorldFx.length; s++) {
        if (cursor >= MAX_INSTANCES_PER_ICON_TYPE) break;
        const slot = pl.unitSlotsWorldFx[s];
        const wx = toFloat(slot.xFx);
        const wz = toFloat(slot.zFx);
        const wy = this.sampleGroundY(wx, wz);

        const slotDir = slot.dir ?? pl.facingDir;
        const slotYawRad = -(slotDir * ((Math.PI * 2) / ANGLE_STEPS));

        this._dummyObj.position.set(wx, wy + 0.18, wz);
        this._dummyObj.rotation.set(0, slotYawRad, 0);
        this._dummyObj.scale.set(scaleVal, 1.0, scaleVal);
        this._dummyObj.updateMatrix();

        instMesh.setMatrixAt(cursor, this._dummyObj.matrix);
        cursor++;
      }

      countsByType.set(typeKey, cursor);
    }

    if (!preserveRelative) {
      for (let a = layout.placements.length; a < this.companyArrows.length; a++) {
        this.companyArrows[a].visible = false;
      }
    }

    for (const [typeKey, instMesh] of this.iconInstancedMeshes.entries()) {
      instMesh.count = countsByType.get(typeKey) || 0;
      instMesh.instanceMatrix.needsUpdate = true;
    }
  }
}