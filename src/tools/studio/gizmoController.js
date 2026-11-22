/**
 * Kings Lands — Studio gizmo + orbit camera (src/tools/studio/gizmoController.js)
 *
 * Callbacks:
 *   onBeforeDrag()          the pointer went down on a gizmo handle (BEFORE three.js records the drag start) – pause the animation here
 *   onDragStart() / onDragEnd()
 *   onTransformChange(obj)  the attached object changed because of a physical drag
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export class GizmoController {
  constructor(camera, domElement, scene, callbacks = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene;
    this.onTransformChange = callbacks.onTransformChange || null;
    this.onBeforeDrag = callbacks.onBeforeDrag || null;
    this.onDragStart = callbacks.onDragStart || null;
    this.onDragEnd = callbacks.onDragEnd || null;

    /** 'joint' (body joint, animated) | 'weapon_grip' (equipment offset, not animated). Set by the app. */
    this.gizmoTargetType = 'joint';
    this.isDragging = false;
    this._enabled = true;

    this.orbit = new OrbitControls(this.camera, this.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.minDistance = 1.2;
    this.orbit.maxDistance = 120;
    this.orbit.target.set(0, 1.1, 0);

    this.transformControls = new TransformControls(this.camera, this.domElement);
    this.transformControls.setSize(0.85);
    this.transformControls.setSpace('local');
    this.transformControls.setMode('rotate');
    // three r169+: TransformControls is no longer an Object3D – its helper is what goes into the scene.
    this._gizmoRoot = typeof this.transformControls.getHelper === 'function'
      ? this.transformControls.getHelper()
      : this.transformControls;
    this.scene.add(this._gizmoRoot);

    this.selectedObject = null;
    this.selectionHighlight = this._createJointMarker();
    this.scene.add(this.selectionHighlight);

    this._bindEvents();
    this.snapToCloseupView();
  }

  _createJointMarker() {
    const geom = new THREE.OctahedronGeometry(0.065, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, wireframe: true, depthTest: false, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 999;
    mesh.visible = false;
    return mesh;
  }

  _bindEvents() {
    // Capture phase on the same element runs BEFORE TransformControls' own pointerdown handler.
    // TransformControls caches the object's transform when the drag begins, so the animation must already be
    // paused (and the clean pose applied) at this moment – otherwise the first drag frame "jumps".
    this._onPointerDownCapture = () => {
      const tc = this.transformControls;
      if (tc.enabled && tc.object && tc.axis !== null) this.onBeforeDrag?.();
    };
    this.domElement.addEventListener('pointerdown', this._onPointerDownCapture, true);

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
      this.isDragging = Boolean(event.value);
      if (event.value) this.onDragStart?.();
      else this.onDragEnd?.();
    });

    // objectChange fires only for a physical drag (unlike 'change', which also fires on hover).
    this.transformControls.addEventListener('objectChange', () => {
      if (this.selectedObject && this.onTransformChange) {
        this._syncMarkerPosition();
        this.onTransformChange(this.selectedObject);
      }
    });
  }

  _syncMarkerPosition() {
    if (!this.selectedObject) { this.selectionHighlight.visible = false; return; }
    this.selectedObject.getWorldPosition(this.selectionHighlight.position);
    this.selectionHighlight.visible = true;
  }

  attachToObject(object3d, mode = 'rotate') {
    this.selectedObject = object3d || null;
    if (!this.selectedObject) {
      this.transformControls.detach();
      this.selectionHighlight.visible = false;
      return;
    }
    this.transformControls.setMode(mode);
    if (this._enabled) this.transformControls.attach(this.selectedObject);
    else this.transformControls.detach();
    this._syncMarkerPosition();
  }

  /** Hide/show the drag handles while keeping the selection marker (used for procedural movement clips). */
  setEnabled(enabled) {
    this._enabled = Boolean(enabled);
    if (!this._enabled) this.transformControls.detach();
    else if (this.selectedObject) this.transformControls.attach(this.selectedObject);
  }

  getMode() { return this.transformControls.getMode(); }

  setGizmoMode(mode) {
    if (mode === 'rotate' || mode === 'translate') this.transformControls.setMode(mode);
  }

  detach() {
    this.selectedObject = null;
    this.transformControls.detach();
    this.selectionHighlight.visible = false;
  }

  snapToRtsGameView(distance = 18, focusPoint = new THREE.Vector3(0, 0.8, 0)) {
    const tiltRadians = THREE.MathUtils.degToRad(50);
    this.orbit.target.copy(focusPoint);
    this.camera.position.set(
      focusPoint.x,
      focusPoint.y + distance * Math.sin(tiltRadians),
      focusPoint.z + distance * Math.cos(tiltRadians)
    );
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  snapToCloseupView() {
    this.orbit.target.set(0, 1.15, 0);
    this.camera.position.set(2.4, 2.1, 3.2);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  update() {
    this.orbit.update();
    if (this.selectedObject) this._syncMarkerPosition();
  }

  dispose() {
    this.domElement.removeEventListener('pointerdown', this._onPointerDownCapture, true);
    this.transformControls.detach();
    this.scene.remove(this._gizmoRoot);
    this.transformControls.dispose?.();
    this.scene.remove(this.selectionHighlight);
    this.selectionHighlight.geometry.dispose();
    this.selectionHighlight.material.dispose();
    this.orbit.dispose();
  }
}
