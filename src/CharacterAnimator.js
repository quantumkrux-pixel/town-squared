// ============================================================
// CharacterAnimator.js — drives animation clips on rigged GLBs.
//
// Attach to any character instance (player, remote, NPC). If the
// model carries AnimationClips, this resolves an idle and a walk
// clip by name and crossfades between them as movement starts and
// stops. If the model has no clips (the procedural placeholders),
// `active` is false and callers keep their procedural bob — so the
// whole system is safe to wire up before any rigged model exists.
//
// Clip resolution is by name, case-insensitive:
//   idle: contains "idle", "stand", or "breath"
//   walk: contains "walk", "run", "move", or "jog"
// Fallbacks: idle → first clip; walk → second clip (or idle).
// Name your Blender/Mixamo actions accordingly and it just works.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';

const FADE = 0.25; // seconds of crossfade between states

export class CharacterAnimator {
  constructor(root) {
    const clips = root.userData.animations ?? [];
    this.active = clips.length > 0;
    if (!this.active) return;

    this.mixer = new THREE.AnimationMixer(root);
    const find = re => clips.find(c => re.test(c.name));

    const idleClip = find(/idle|stand|breath/i) ?? clips[0];
    const walkClip = find(/walk|run|move|jog/i) ?? clips[1] ?? idleClip;

    this.idle = idleClip ? this.mixer.clipAction(idleClip) : null;
    this.walk = walkClip ? this.mixer.clipAction(walkClip) : null;
    this.current = null;
    this._moving = null;

    this.setMoving(false, true); // start in idle, no fade
  }

  /** Switch between idle and walk. Crossfades unless `instant`. */
  setMoving(moving, instant = false) {
    if (!this.active || moving === this._moving) return;
    this._moving = moving;

    const next = moving ? (this.walk ?? this.idle) : (this.idle ?? this.walk);
    if (!next || next === this.current) return;

    if (instant || !this.current) {
      this.current?.stop();
      next.reset().play();
    } else {
      next.reset().fadeIn(FADE).play();
      this.current.fadeOut(FADE);
    }
    this.current = next;
  }

  /** Optionally sync walk-cycle speed to movement speed (1 = authored). */
  setWalkTimeScale(scale) {
    if (this.walk) this.walk.timeScale = scale;
  }

  update(dt) {
    if (this.active) this.mixer.update(dt);
  }
}
