// ============================================================
// Player.js — local player: tap-to-move + WASD, collision, name tag.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { CharacterAnimator } from './CharacterAnimator.js';

export function makeNameTag(text, color = '#e9ddc2') {
  const pad = 12, fs = 34;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `600 ${fs}px sans-serif`;
  canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.height = fs + pad * 1.4;
  ctx.font = `600 ${fs}px sans-serif`;
  ctx.fillStyle = 'rgba(20,16,12,0.55)';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
  } else {
    ctx.rect(0, 0, canvas.width, canvas.height);
  }
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  const scale = 0.011;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.position.y = 2.15;
  return sprite;
}

export class Player {
  constructor(mesh, world, cfg, name) {
    this.mesh = mesh;
    this.world = world;
    this.cfg = cfg;
    this.name = name;

    this.pos = new THREE.Vector3(world.spawn.x, 0, world.spawn.z);
    this.heading = 0;
    this.moveTarget = null;          // Vector3 from tap-to-move
    this._lastDist = null;           // progress tracking for stuck detection
    this._stuckTime = 0;
    this._marker = this._makeMarker();
    this.animator = new CharacterAnimator(mesh);
    this.roleId = '';

    this._tag = makeNameTag(name);
    mesh.add(this._tag);
    mesh.position.copy(this.pos);
  }

  /** Update the nametag to show a profession, e.g. "Wren Ashfoot · Baker". */
  setRole(roleId, roleName) {
    this.roleId = roleId ?? '';
    this._roleName = roleName ?? '';
    this._rebuildTag();
  }

  /** Rename the player, preserving any current profession on the tag. */
  setName(name) {
    if (!name) return;
    this.name = name;
    this._rebuildTag();
  }

  _rebuildTag() {
    this.mesh.remove(this._tag);
    this._tag.material.map?.dispose();
    this._tag.material.dispose();
    this._tag = makeNameTag(this._roleName ? `${this.name} · ${this._roleName}` : this.name);
    this.mesh.add(this._tag);
  }

  _clearTarget() {
    this.moveTarget = null;
    this._lastDist = null;
    this._stuckTime = 0;
    this._marker.material.opacity = 0;
  }

  _makeMarker() {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xc9a24b, transparent: true, opacity: 0 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.04;
    return m;
  }
  get marker() { return this._marker; }

  setMoveTarget(point) {
    this.moveTarget = point.clone();
    this._lastDist = null;
    this._stuckTime = 0;
    this._marker.position.set(point.x, 0.04, point.z);
    this._marker.material.opacity = 0.9;
  }

  get isMoving() { return this._speedNow > 0.01; }

  update(dt) {
    const spd = this.cfg.speed;
    const dir = _dir.set(0, 0, 0);

    if (this.moveTarget) {
      dir.subVectors(this.moveTarget, this.pos).setY(0);
      const dist = dir.length();
      if (dist < 0.15) {
        this._clearTarget();
        dir.set(0, 0, 0);
      } else {
        dir.normalize();
        // no overshoot on the final step
        if (dist < spd * dt) dir.multiplyScalar(dist / (spd * dt));

        // stuck detection: if sliding around obstacles stops making progress
        // toward the target (e.g. it's inside/behind a building), give up
        // rather than orbiting forever
        if (this._lastDist !== null && dist > this._lastDist - 0.005) {
          this._stuckTime += dt;
          if (this._stuckTime > 0.8) {
            this._clearTarget();
            dir.set(0, 0, 0);
          }
        } else {
          this._stuckTime = 0;
        }
        this._lastDist = dist;
      }
    }

    const step = dir.multiplyScalar(spd * dt);
    this._speedNow = step.length() / Math.max(dt, 1e-6);

    if (step.lengthSq() > 0) {
      // slide along obstacle tangents instead of jamming into them
      this.world.slideStep(this.pos, step, this.cfg.radius);
      this.pos.add(step);
      this.world.resolveCollision(this.pos, this.cfg.radius);
      if (step.lengthSq() > 1e-8) {
        const targetHeading = Math.atan2(step.x, step.z);
        this.heading = lerpAngle(this.heading, targetHeading, Math.min(1, this.cfg.turnLerp * dt));
      }
    }

    // animation: rigged GLBs crossfade idle↔walk; placeholders keep the bob
    this.animator.setMoving(this.isMoving);
    this.animator.update(dt);
    const bob = (!this.animator.active && this.isMoving)
      ? Math.abs(Math.sin(performance.now() / 1000 * 9)) * 0.05 : 0;
    this.mesh.position.set(this.pos.x, bob, this.pos.z);
    this.mesh.rotation.y = this.heading;

    // fade the tap marker
    if (this._marker.material.opacity > 0 && !this.moveTarget) {
      this._marker.material.opacity = Math.max(0, this._marker.material.opacity - dt * 2);
    }
  }

  /** Snapshot for the network. */
  state() {
    return {
      x: +this.pos.x.toFixed(2),
      z: +this.pos.z.toFixed(2),
      h: +this.heading.toFixed(2),
      m: this.isMoving ? 1 : 0,
      r: this.roleId,
    };
  }
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// scratch vector reused every frame (perf: no per-frame allocation)
const _dir = new THREE.Vector3();
