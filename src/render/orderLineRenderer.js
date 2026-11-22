/**
 * Kings Lands — Pure 3D Order Line & Click Marker Renderer
 * (src/render/orderLineRenderer.js)
 *
 * Pure presentation module: knows ONLY how to draw terrain-conforming dashed lines
 * and ephemeral click rings given start/end coordinates and an action type.
 */

import * as THREE from 'three';
import { toFx, toFloat } from '../core/fx.js';
import { sampleTerrainHeightFx } from '../sim/gameState.js';

export const ORDER_LINE_COLORS = Object.freeze({
  MOVE: 0x22c55e,
  GATHER: 0x22c55e,
  GARRISON: 0x22c55e,
  BUILD: 0xfbbf24,
  RALLY: 0xfbbf24,
  ATTACK_MOVE: 0xef4444,
  PATROL: 0x3b82f6
});

export class OrderLineRenderer {
  constructor(scene) {
    this.scene = scene;

    this.ephemeralMarkers = [];
    this.ephemeralGroup = new THREE.Group();
    this.ephemeralGroup.name = 'EphemeralClickMarkers';
    this.scene.add(this.ephemeralGroup);

    this.dashedLinesGroup = new THREE.Group();
    this.dashedLinesGroup.name = 'SelectedCompanyDashedPaths';
    this.scene.add(this.dashedLinesGroup);
    this._activeDashedLineMeshes = [];
  }

  sampleExactGroundY(xMeters, zMeters) {
    const hCenter = toFloat(sampleTerrainHeightFx(toFx(xMeters), toFx(zMeters), true));
    const hN = toFloat(sampleTerrainHeightFx(toFx(xMeters), toFx(zMeters - 1.0), true));
    const hS = toFloat(sampleTerrainHeightFx(toFx(xMeters), toFx(zMeters + 1.0), true));
    const hE = toFloat(sampleTerrainHeightFx(toFx(xMeters + 1.0), toFx(zMeters), true));
    const hW = toFloat(sampleTerrainHeightFx(toFx(xMeters - 1.0), toFx(zMeters), true));
    return Math.max(hCenter, (hN + hS + hE + hW) * 0.25);
  }

  buildTerrainConformingSegmentPoints(x0, z0, x1, z1, yOffset = 0.35) {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(2, Math.min(32, Math.ceil(dist / 4.0)));
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const y = this.sampleExactGroundY(x, z) + yOffset;
      pts.push(new THREE.Vector3(x, y, z));
    }
    return pts;
  }

  spawnEphemeralClickMarker(worldPoint, orderType = 'MOVE', radiusScale = 1.0) {
    if (!worldPoint) return;
    const colorHex = ORDER_LINE_COLORS[orderType] || ORDER_LINE_COLORS.MOVE;
    const y = this.sampleExactGroundY(worldPoint.x, worldPoint.z) + 0.22;

    const holder = new THREE.Group();
    holder.position.set(worldPoint.x, y, worldPoint.z);
    holder.renderOrder = 45;

    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.65 * radiusScale, 0.98 * radiusScale, 28),
      ringMat
    );
    ring.rotation.x = -Math.PI / 2;
    ring.frustumCulled = false;
    holder.add(ring);

    const dotMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false
    });
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.28 * radiusScale, 16), dotMat);
    dot.rotation.x = -Math.PI / 2;
    dot.frustumCulled = false;
    holder.add(dot);

    this.ephemeralGroup.add(holder);
    this.ephemeralMarkers.push({
      group: holder,
      ringMat,
      dotMat,
      age: 0,
      maxAge: 0.55
    });
  }

  updateEphemeralMarkers(dtSeconds) {
    for (let i = this.ephemeralMarkers.length - 1; i >= 0; i--) {
      const m = this.ephemeralMarkers[i];
      m.age += dtSeconds;
      if (m.age >= m.maxAge) {
        this.ephemeralGroup.remove(m.group);
        this.ephemeralMarkers.splice(i, 1);
      } else {
        const progress = m.age / m.maxAge;
        const scale = 1.25 - progress * 0.75;
        m.group.scale.set(scale, 1, scale);
        m.ringMat.opacity = (1 - progress) * 0.95;
        m.dotMat.opacity = (1 - progress) * 0.85;
      }
    }
  }

  clearLines() {
    for (let i = 0; i < this._activeDashedLineMeshes.length; i++) {
      const mesh = this._activeDashedLineMeshes[i];
      this.dashedLinesGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._activeDashedLineMeshes.length = 0;
  }

  /**
   * Renders a list of declarative line segments:
   * `[{ fromX, fromZ, toX, toZ, orderType, dashSize, gapSize, opacity }]`
   */
  renderSegments(segments) {
    if (!Array.isArray(segments) || segments.length === 0) {
      if (this._activeDashedLineMeshes.length > 0) {
        this.clearLines();
      }
      this._lastSegmentsSig = "";
      return;
    }
    let sig = "";
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      sig += `${s.orderType}:${Math.round(s.fromX * 4)},${Math.round(s.fromZ * 4)}->${Math.round(s.toX * 4)},${Math.round(s.toZ * 4)}|`;
    }
    if (sig === this._lastSegmentsSig) return;
    this._lastSegmentsSig = sig;
    this.clearLines();

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const pts = this.buildTerrainConformingSegmentPoints(
        seg.fromX,
        seg.fromZ,
        seg.toX,
        seg.toZ,
        seg.yOffset ?? 0.35
      );
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineDashedMaterial({
        color: ORDER_LINE_COLORS[seg.orderType] || ORDER_LINE_COLORS.MOVE,
        dashSize: seg.dashSize ?? 1.4,
        gapSize: seg.gapSize ?? 0.9,
        transparent: true,
        opacity: seg.opacity ?? 0.92,
        depthTest: false
      });

      const line = new THREE.Line(geom, mat);
      line.computeLineDistances();
      line.frustumCulled = false;
      line.renderOrder = 38;
      this.dashedLinesGroup.add(line);
      this._activeDashedLineMeshes.push(line);
    }
  }
}