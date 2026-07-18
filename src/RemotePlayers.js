// ============================================================
// RemotePlayers.js — renders everyone else.
//
// Standard snapshot-interpolation: each peer keeps a small buffer of
// timestamped states and is rendered CONFIG.NET.interpDelayMs in the
// past, blending between the two snapshots that bracket render time.
// 10Hz updates come out looking like smooth 60fps motion.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { makeNameTag } from './Player.js';
import { CharacterAnimator } from './CharacterAnimator.js';

export class RemotePlayers {
  constructor(scene, registry, cfg, roles = null) {
    this.scene = scene;
    this.registry = registry;
    this.cfg = cfg;
    this.roles = roles;
    this.peers = new Map(); // id -> { mesh, animator, tag, roleId, name, buffer, lastSeen }
    this._lastT = null;     // for animator dt
  }

  _makeTag(peer) {
    if (peer.tag) {
      peer.mesh.remove(peer.tag);
      peer.tag.material.map?.dispose();
      peer.tag.material.dispose();
    }
    const roleName = this.roles?.def(peer.roleId)?.name;
    peer.tag = makeNameTag(roleName ? `${peer.name} · ${roleName}` : peer.name, '#f0c9a0');
    peer.mesh.add(peer.tag);
  }

  async onState(id, name, s, tMs) {
    let peer = this.peers.get(id);
    if (!peer) {
      peer = { mesh: null, animator: null, tag: null, roleId: s.r ?? '', name, buffer: [], lastSeen: tMs, pending: true };
      this.peers.set(id, peer);
      const mesh = await this.registry.instance('char_remote');
      // peer may have left while the mesh loaded
      if (!this.peers.has(id)) return;
      mesh.position.set(s.x, 0, s.z);
      this.scene.add(mesh);
      peer.mesh = mesh;
      peer.animator = new CharacterAnimator(mesh);
      this._makeTag(peer);
    }
    // role change → refresh the tag
    if (peer.mesh && (s.r ?? '') !== peer.roleId) {
      peer.roleId = s.r ?? '';
      this._makeTag(peer);
    }
    peer.lastSeen = tMs;
    peer.buffer.push({ t: tMs, ...s });
    if (peer.buffer.length > 30) peer.buffer.shift();
  }

  onLeave(id) {
    const peer = this.peers.get(id);
    if (peer?.mesh) this.scene.remove(peer.mesh);
    this.peers.delete(id);
  }

  update(nowMs) {
    const renderT = nowMs - this.cfg.interpDelayMs;
    const dt = this._lastT === null ? 0.016 : Math.min((nowMs - this._lastT) / 1000, 0.1);
    this._lastT = nowMs;

    for (const [id, peer] of this.peers) {
      if (nowMs - peer.lastSeen > this.cfg.peerTimeoutMs) {
        this.onLeave(id);
        continue;
      }
      if (!peer.mesh || peer.buffer.length === 0) continue;

      const buf = peer.buffer;
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = buf.length - 1; i > 0; i--) {
        if (buf[i - 1].t <= renderT && buf[i].t >= renderT) {
          a = buf[i - 1]; b = buf[i];
          break;
        }
      }
      const span = b.t - a.t;
      const f = span > 0 ? THREE.MathUtils.clamp((renderT - a.t) / span, 0, 1) : 1;

      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      const h = lerpAngle(a.h, b.h, f);

      const moving = b.m === 1;
      peer.animator?.setMoving(moving);
      peer.animator?.update(dt);
      const bob = (!peer.animator?.active && moving)
        ? Math.abs(Math.sin(nowMs / 1000 * 9)) * 0.05 : 0;
      peer.mesh.position.set(x, bob, z);
      peer.mesh.rotation.y = h;
    }
  }

  count() { return this.peers.size; }
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
