// ============================================================
// CameraRig.js — the locked top-down-ish perspective.
//
// Pitch is fixed (CONFIG.CAMERA.pitchDeg). Yaw is fully free 360°.
// One-finger drag rotates, pinch zooms, mouse drag + wheel on desktop.
// The rig smoothly follows a target (the player).
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

export class CameraRig {
  constructor(camera, domElement, cfg) {
    this.camera = camera;
    this.dom = domElement;
    this.cfg = cfg;

    this.yaw = Math.PI * 0.25;
    this.pitch = THREE.MathUtils.degToRad(cfg.pitchDeg); // fixed
    this.distance = cfg.distance;
    this.target = new THREE.Vector3();
    this.followPos = new THREE.Vector3();

    // gesture state
    this._dragging = false;
    this._lastX = 0;
    this._pinchDist = 0;
    this._moved = 0; // px travelled this gesture — distinguishes drag from tap

    this._bind();
    this.updateCamera();
  }

  // Where "camera forward" projects onto the ground — used to make
  // WASD movement camera-relative.
  get yawForward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  follow(pos) {
    this.followPos.copy(pos);
  }

  update(dt) {
    this.target.lerp(this.followPos, Math.min(1, this.cfg.followLerp * dt));
    this.updateCamera();
  }

  updateCamera() {
    const horiz = this.distance * Math.cos(this.pitch);
    const y = this.distance * Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x + horiz * Math.sin(this.yaw),
      this.target.y + y,
      this.target.z + horiz * Math.cos(this.yaw)
    );
    this.camera.lookAt(this.target);
  }

  _zoom(factor) {
    this.distance = THREE.MathUtils.clamp(
      this.distance * factor, this.cfg.minDistance, this.cfg.maxDistance
    );
  }

  /** True if the last pointer gesture was a drag (so main.js can skip tap-to-move). */
  consumeWasDrag() {
    const was = this._moved > 8;
    this._moved = 0;
    return was;
  }

  /** Editor calls this when it claims a drag (moving an object, not the camera). */
  cancelDrag() {
    this._dragging = false;
  }

  _bind() {
    const el = this.dom;

    // ----- mouse -----
    el.addEventListener('mousedown', e => {
      this._dragging = true;
      this._lastX = e.clientX;
      this._moved = 0;
    });
    window.addEventListener('mousemove', e => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      this._lastX = e.clientX;
      this._moved += Math.abs(dx);
      this.yaw -= dx * this.cfg.rotateSpeed;
    });
    window.addEventListener('mouseup', () => { this._dragging = false; });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      this._zoom(e.deltaY > 0 ? 1.1 : 0.9);
    }, { passive: false });

    // ----- touch -----
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        this._dragging = true;
        this._lastX = e.touches[0].clientX;
        this._moved = 0;
      } else if (e.touches.length === 2) {
        this._dragging = false;
        this._pinchDist = this._touchDist(e);
      }
    }, { passive: true });

    el.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && this._dragging) {
        const dx = e.touches[0].clientX - this._lastX;
        this._lastX = e.touches[0].clientX;
        this._moved += Math.abs(dx);
        this.yaw -= dx * this.cfg.rotateSpeed;
      } else if (e.touches.length === 2) {
        const d = this._touchDist(e);
        if (this._pinchDist > 0) this._zoom(this._pinchDist / d);
        this._pinchDist = d;
        this._moved += 10; // pinches never count as taps
      }
    }, { passive: true });

    el.addEventListener('touchend', e => {
      if (e.touches.length === 0) this._dragging = false;
      this._pinchDist = 0;
    });
  }

  _touchDist(e) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    return Math.hypot(dx, dy);
  }
}
