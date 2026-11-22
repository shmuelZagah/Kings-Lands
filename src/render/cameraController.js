/**
 * Kings Lands — Pure 3D Camera Controller
 * (src/render/cameraController.js)
 *
 * Receives unconsumed input events from `InputRouter` (Priority 10).
 * Completely clean and agnostic of game rules, units, or window blur states.
 */

import * as THREE from 'three';
import { EventTypes } from '../core/eventBus.js';

export class CameraController {
  constructor(camera, domElement, config, eventBus, synthAudio) {
    this.camera = camera;
    this.domElement = domElement;
    this.eventBus = eventBus;
    this.synthAudio = synthAudio;

    const mapCfg = config?.map || {};
    const camCfg = config?.camera || {};

    this.worldSize = (mapCfg.tilesX || 1024) * (mapCfg.tileSizeMeters || 4);
    const center = this.worldSize * 0.5;

    this.target = new THREE.Vector3(
      camCfg.initialTargetX ?? center,
      0,
      camCfg.initialTargetZ ?? center - 40
    );
    this.desiredTarget = this.target.clone();

    this.initialDistance = camCfg.initialDistance ?? 82;
    this.distance = this.initialDistance;
    this.desiredDistance = this.distance;
    this.minDistance = camCfg.minDistance ?? 22;
    this.maxDistance = camCfg.maxDistance ?? 750;

    this.initialYawRad = THREE.MathUtils.degToRad(camCfg.initialYawDegrees ?? 0);
    this.yawRad = this.initialYawRad;
    this.desiredYawRad = this.yawRad;
    this.initialPitchRad = THREE.MathUtils.degToRad(camCfg.initialPitchDegrees ?? 54);
    this.pitchRad = this.initialPitchRad;
    this.desiredPitchRad = this.pitchRad;
    this.minPitchRad = THREE.MathUtils.degToRad(camCfg.minPitchDegrees ?? 24);
    this.maxPitchRad = THREE.MathUtils.degToRad(camCfg.maxPitchDegrees ?? 78);

    this.panSpeed = camCfg.panSpeedMetersPerSec ?? 78;
    this.zoomStep = camCfg.zoomSpeed ?? 12;
    this.edgeMarginPx = camCfg.edgePanMarginPx ?? 8;
    this.damping = camCfg.dampingFactor ?? 0.14;

    this.edgePanEnabled = false;
    this.keysDown = new Set();
    this.mouseClientX = -1;
    this.mouseClientY = -1;
    this.isPointerInside = false;

    this.dragMode = null;
    this.lastDragX = 0;
    this.lastDragY = 0;
    this._lastMiddleClickTime = 0;
    this._lastMiddleClickX = 0;
    this._lastMiddleClickY = 0;

    this.lastEventWorldPos = new THREE.Vector3(center, 1.5, center);

    this._bindWorldEvents();
    this._applyCameraTransform(1.0);
  }

  _bindWorldEvents() {
    if (this.eventBus) {
      this.eventBus.on(EventTypes.WORLD_EVENT, (evt) => {
        if (evt && typeof evt.x === 'number') {
          this.lastEventWorldPos.set(evt.x, evt.y || 1.5, evt.z);
        }
      });
      this.eventBus.on(EventTypes.CAMERA_FOCUS_EVENT, (evt) => {
        if (evt && typeof evt.x === 'number' && typeof evt.z === 'number') {
          this.desiredTarget.x = evt.x;
          this.desiredTarget.z = evt.z;
          if (evt.instant) {
            this.target.x = evt.x;
            this.target.z = evt.z;
            this._applyCameraTransform(1.0);
          }
        }
      });
    }
  }

  resetViewOrientationAndZoom() {
    this.distance = this.initialDistance ?? 82;
    this.desiredDistance = this.distance;
    this.yawRad = this.initialYawRad ?? 0;
    this.desiredYawRad = this.yawRad;
    this.pitchRad = this.initialPitchRad ?? THREE.MathUtils.degToRad(54);
    this.desiredPitchRad = this.pitchRad;
    this._applyCameraTransform(1.0);
  }

  onMouseEnter() {
    this.isPointerInside = true;
  }

  onMouseLeave() {
    this.isPointerInside = false;
    this.dragMode = null;
  }

  onKeyDown(e) {
    this.keysDown.add(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      this.focusOnLastEvent();
      return true;
    }
    return false;
  }

  onKeyUp(e) {
    this.keysDown.delete(e.code);
  }

  onMouseDown(e) {
    if (e.button === 1) {
      e.preventDefault();
      const now = performance.now();
      const dt = now - (this._lastMiddleClickTime || 0);
      const distPx = Math.hypot(
        e.clientX - (this._lastMiddleClickX || 0),
        e.clientY - (this._lastMiddleClickY || 0)
      );
      this._lastMiddleClickTime = now;
      this._lastMiddleClickX = e.clientX;
      this._lastMiddleClickY = e.clientY;
      // Double-clicking the mouse wheel (middle button) resets camera angle & zoom!
      if (dt <= 380 && distPx <= 16) {
        this._lastMiddleClickTime = 0;
        this.dragMode = null;
        this.resetViewOrientationAndZoom();
        if (this.synthAudio) this.synthAudio.playFocusWhoosh?.();
        return true;
      }
      this.dragMode = 'orbit';
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;
      return true;
    }
    if (e.button === 0 && e.altKey) {
      e.preventDefault();
      this.dragMode = 'orbit';
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;
      return true;
    }
    return false;
  }

  onMouseMove(e) {
    this.mouseClientX = e.clientX;
    this.mouseClientY = e.clientY;

    if (!this.dragMode) return false;
    const dx = e.clientX - this.lastDragX;
    const dy = e.clientY - this.lastDragY;
    this.lastDragX = e.clientX;
    this.lastDragY = e.clientY;

    if (this.dragMode === 'orbit') {
      this.desiredYawRad -= dx * 0.0065;
      this.desiredPitchRad = THREE.MathUtils.clamp(
        this.desiredPitchRad + dy * 0.0055,
        this.minPitchRad,
        this.maxPitchRad
      );
    } else if (this.dragMode === 'pan') {
      const scale = this.distance * 0.0018;
      this._panByLocalOffsets(-dx * scale, -dy * scale);
    }
    return true;
  }

  onMouseUp() {
    if (this.dragMode) {
      this.dragMode = null;
      return true;
    }
    return false;
  }

  onWheel(e) {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    const factor = Math.max(0.45, this.distance / 90);
    this.desiredDistance = THREE.MathUtils.clamp(
      this.desiredDistance + dir * this.zoomStep * factor,
      this.minDistance,
      this.maxDistance
    );
    return true;
  }

  setEdgePanEnabled(enabled) {
    this.edgePanEnabled = Boolean(enabled);
  }

  _panByLocalOffsets(rightDelta, forwardDelta) {
    const sinY = Math.sin(this.yawRad);
    const cosY = Math.cos(this.yawRad);

    const forwardX = -sinY;
    const forwardZ = -cosY;
    const rightX = cosY;
    const rightZ = -sinY;

    this.desiredTarget.x += rightX * rightDelta + forwardX * forwardDelta;
    this.desiredTarget.z += rightZ * rightDelta + forwardZ * forwardDelta;

    const margin = 24;
    this.desiredTarget.x = THREE.MathUtils.clamp(
      this.desiredTarget.x,
      margin,
      this.worldSize - margin
    );
    this.desiredTarget.z = THREE.MathUtils.clamp(
      this.desiredTarget.z,
      margin,
      this.worldSize - margin
    );
  }

  focusOnLastEvent() {
    this.desiredTarget.x = this.lastEventWorldPos.x;
    this.desiredTarget.z = this.lastEventWorldPos.z;
    if (this.synthAudio) this.synthAudio.playFocusWhoosh();
    if (this.eventBus) {
      this.eventBus.emit(EventTypes.CAMERA_FOCUS_EVENT, {
        x: this.desiredTarget.x,
        z: this.desiredTarget.z
      });
    }
  }

  update(dtSeconds) {
    let moveRight = 0;
    let moveForward = 0;

    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) moveForward += 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) moveForward -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) moveRight += 1;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) moveRight -= 1;

    if (this.edgePanEnabled && this.isPointerInside && !this.dragMode) {
      const rect = this.domElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && this.mouseClientX >= 0 && this.mouseClientY >= 0) {
        if (this.mouseClientX - rect.left < this.edgeMarginPx) moveRight -= 0.65;
        if (rect.right - this.mouseClientX < this.edgeMarginPx) moveRight += 0.65;
        if (this.mouseClientY - rect.top < this.edgeMarginPx) moveForward += 0.65;
        if (rect.bottom - this.mouseClientY < this.edgeMarginPx) moveForward -= 0.65;
      }
    }

    if (moveRight !== 0 || moveForward !== 0) {
      const zoomScale = THREE.MathUtils.clamp(this.distance / 80, 0.45, 4.5);
      const step = this.panSpeed * zoomScale * dtSeconds;
      this._panByLocalOffsets(moveRight * step, moveForward * step);
    }

    const alpha = 1 - Math.pow(1 - this.damping, dtSeconds * 60);
    this._applyCameraTransform(alpha);
  }

  _applyCameraTransform(alpha) {
    if (this.target.distanceToSquared(this.desiredTarget) < 0.0004) {
      this.target.copy(this.desiredTarget);
    } else {
      this.target.lerp(this.desiredTarget, alpha);
    }

    if (Math.abs(this.distance - this.desiredDistance) < 0.015) {
      this.distance = this.desiredDistance;
    } else {
      this.distance = THREE.MathUtils.lerp(this.distance, this.desiredDistance, alpha);
    }

    if (Math.abs(this.yawRad - this.desiredYawRad) < 0.0005) {
      this.yawRad = this.desiredYawRad;
    } else {
      this.yawRad = THREE.MathUtils.lerp(this.yawRad, this.desiredYawRad, alpha);
    }

    if (Math.abs(this.pitchRad - this.desiredPitchRad) < 0.0005) {
      this.pitchRad = this.desiredPitchRad;
    } else {
      this.pitchRad = THREE.MathUtils.lerp(this.pitchRad, this.desiredPitchRad, alpha);
    }

    // Dynamically keep a tight near/far ratio (~35:1) so 24-bit depth buffer precision stays
    // rock-solid at every zoom level (eliminates Z-fighting flicker when zooming or moving camera).
    const idealNear = Math.max(4.5, Math.round(this.distance * 0.14 * 2) * 0.5);
    const idealFar = Math.max(1100, Math.round(this.distance * 5.2));
    if (
      Math.abs(this.camera.near - idealNear) >= 1.0 ||
      Math.abs(this.camera.far - idealFar) >= 80
    ) {
      this.camera.near = idealNear;
      this.camera.far = idealFar;
      this.camera.updateProjectionMatrix();
    }

    const horizDist = Math.cos(this.pitchRad) * this.distance;
    const vertDist = Math.sin(this.pitchRad) * this.distance;

    const camX = this.target.x + Math.sin(this.yawRad) * horizDist;
    const camZ = this.target.z + Math.cos(this.yawRad) * horizDist;
    const camY = this.target.y + vertDist;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(this.target.x, this.target.y + 1.2, this.target.z);
  }
}