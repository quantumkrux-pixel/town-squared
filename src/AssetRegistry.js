// ============================================================
// AssetRegistry.js
//
// THE swap point for art. The town map (data/town.json) only ever
// references asset IDs — never geometry. Each ID resolves to either:
//
//   • a procedural placeholder (ships with the scaffold), or
//   • a GLB file, the moment you set `url` below.
//
// To replace a placeholder with your own model:
//   1. Drop the file in assets/models/
//   2. Set url: 'assets/models/house_small.glb' on the entry
//   3. (optional) tweak `fit` so it normalises to the same footprint
//
// No map edits. No re-placement. Every instance on every client swaps.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.128.0/examples/jsm/loaders/DRACOLoader.js';
import { SkeletonUtils } from 'https://unpkg.com/three@0.128.0/examples/jsm/utils/SkeletonUtils.js';

// ---- shared palette for placeholders ----
const C = {
  plaster: 0xe8dcc0,
  plasterDark: 0xd6c6a4,
  wood: 0x7a5230,
  woodDark: 0x5c3d22,
  roofRed: 0xa8503c,
  roofBlue: 0x5a6e8c,
  roofPurple: 0x6e4a7e,
  stone: 0x9aa0a6,
  stoneDark: 0x7c8287,
  leaf: 0x4f7a45,
  leafDark: 0x3e6236,
  gold: 0xc9a24b,
  cloth: 0xb3543f,
};

function mat(color, flat = true) {
  return new THREE.MeshLambertMaterial({ color, ...(flat ? {} : {}) });
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cone(r, h, color, x = 0, y = 0, z = 0, seg = 8) {
  return cyl(0.001, r, h, color, x, y, z, seg);
}

// Prism roof (triangular cross-section) via a scaled, rotated box? No —
// build it properly from a 2D shape so gables look right.
function roof(w, h, d, color, y = 0, overhang = 0.25) {
  const shape = new THREE.Shape();
  const hw = w / 2 + overhang;
  shape.moveTo(-hw, 0); shape.lineTo(hw, 0); shape.lineTo(0, h); shape.lineTo(-hw, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  geo.translate(0, 0, -(d + overhang * 2) / 2);
  const m = new THREE.Mesh(geo, mat(color));
  m.position.y = y;
  m.castShadow = true;
  return m;
}

// ---------------- placeholder builders ----------------
// Each returns a THREE.Group whose origin sits at ground level (y=0),
// sized in world metres. Keep your GLBs to roughly the same footprint
// (or use `fit`) and everything drops in cleanly.

function buildHouseSmall() {
  const g = new THREE.Group();
  g.add(box(3, 2.2, 3, C.plaster, 0, 1.1, 0));
  g.add(roof(3, 1.4, 3, C.roofRed, 2.2));
  g.add(box(0.8, 1.3, 0.1, C.woodDark, 0, 0.65, 1.53));           // door
  g.add(box(0.7, 0.7, 0.1, 0x8fb4c9, 1.0, 1.4, 1.52));            // window
  return g;
}

function buildFarmHouse() {
  // a barn: long, red, with a hay door in the gable
  const g = new THREE.Group();
  g.add(box(6.5, 3.2, 4.6, 0x8c3b32, 0, 1.6, 0));
  g.add(box(6.7, 0.26, 4.8, C.woodDark, 0, 3.2, 0));
  g.add(roof(6.5, 2.0, 4.6, 0x4a3a30, 3.3));
  // big sliding doors
  g.add(box(1.5, 2.3, 0.14, C.woodDark, -0.8, 1.15, 2.36));
  g.add(box(1.5, 2.3, 0.14, C.woodDark, 0.8, 1.15, 2.36));
  g.add(box(3.1, 0.14, 0.16, C.wood, 0, 2.35, 2.42));            // door track
  // hay door up in the gable, with a hoist beam
  g.add(box(0.9, 1.0, 0.12, C.woodDark, 0, 3.9, 2.3));
  g.add(box(0.14, 0.14, 1.0, C.woodDark, 0, 4.6, 2.7));
  // water trough alongside
  g.add(box(2.0, 0.4, 0.7, C.woodDark, 4.4, 0.2, 0.6));
  return g;
}

function buildHouseLarge() {
  const g = new THREE.Group();
  g.add(box(4.5, 2.6, 3.4, C.plasterDark, 0, 1.3, 0));
  g.add(box(4.7, 0.35, 3.6, C.wood, 0, 2.6, 0));                   // beam line
  g.add(roof(4.5, 1.8, 3.4, C.roofBlue, 2.78));
  g.add(box(0.9, 1.4, 0.1, C.woodDark, -1.2, 0.7, 1.73));
  g.add(box(0.7, 0.7, 0.1, 0x8fb4c9, 0.6, 1.6, 1.72));
  g.add(box(0.7, 0.7, 0.1, 0x8fb4c9, 1.7, 1.6, 1.72));
  g.add(cyl(0.28, 0.28, 1.5, C.stoneDark, 1.6, 3.4, -0.8, 6));     // chimney
  return g;
}

function buildTavern() {
  const g = new THREE.Group();
  g.add(box(5.5, 3.0, 4.2, C.wood, 0, 1.5, 0));
  g.add(box(5.7, 0.3, 4.4, C.woodDark, 0, 3.0, 0));
  g.add(roof(5.5, 2.1, 4.2, C.roofPurple, 3.15));
  g.add(box(1.1, 1.6, 0.12, C.woodDark, 0, 0.8, 2.14));
  // hanging sign
  g.add(box(1.4, 0.08, 0.08, C.woodDark, 2.2, 2.5, 2.35));
  g.add(box(0.9, 0.6, 0.06, C.gold, 2.4, 2.05, 2.35));
  g.add(cyl(0.3, 0.3, 1.8, C.stoneDark, -2.0, 4.0, -1.2, 6));
  return g;
}

function buildTower() {
  const g = new THREE.Group();
  g.add(cyl(1.5, 1.8, 6.5, C.stone, 0, 3.25, 0, 10));
  g.add(cyl(1.9, 1.9, 0.5, C.stoneDark, 0, 6.75, 0, 10));
  g.add(cone(1.9, 2.6, C.roofBlue, 0, 8.3, 0, 10));
  g.add(box(0.6, 1.0, 0.1, C.woodDark, 0, 0.5, 1.78));
  return g;
}

function buildWell() {
  const g = new THREE.Group();
  g.add(cyl(0.9, 1.0, 0.8, C.stone, 0, 0.4, 0, 10));
  g.add(box(0.12, 1.6, 0.12, C.wood, -0.75, 1.2, 0));
  g.add(box(0.12, 1.6, 0.12, C.wood, 0.75, 1.2, 0));
  g.add(roof(1.6, 0.6, 1.2, C.roofRed, 2.0, 0.1));
  return g;
}

function buildFenceSegment() {
  const g = new THREE.Group();
  g.add(box(2.4, 0.9, 1.2, C.wood, 0, 0.45, 0));
  g.add(box(0.1, 2.0, 0.1, C.woodDark, -1.1, 1.0, -0.5));
  g.add(box(0.1, 2.0, 0.1, C.woodDark, 1.1, 1.0, -0.5));
  const awn = box(2.8, 0.08, 1.8, C.woodDark, 1.1, 1.0, -0.5);
  awn.rotation.x = -0.18;
  g.add(awn);
  g.add(box(0.4, 0.25, 0.4, 0xc9863b, -0.5, 1.0, 0.1));  // produce
  g.add(box(0.4, 0.3, 0.4, 0x9c3d3d, 0.4, 1.03, -0.1));
  return g;
}

function buildFenceSegment2() {
  // a taller paled fence — distinct from the low rail of `fence`
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.08, 1.5, C.woodDark, -1.2, 0.75, 0, 6));
  g.add(cyl(0.07, 0.08, 1.5, C.woodDark, 1.2, 0.75, 0, 6));
  g.add(box(2.5, 0.1, 0.07, C.wood, 0, 1.25, 0));
  g.add(box(2.5, 0.1, 0.07, C.wood, 0, 0.75, 0));
  for (let i = -2; i <= 2; i++) {
    const pale = box(0.12, 1.35, 0.06, C.wood, i * 0.5, 0.68, 0);
    pale.castShadow = false;
    g.add(pale);
  }
  return g;
}

function buildDock() {
  const g = new THREE.Group();
  // decking
  for (let i = 0; i < 7; i++) {
    const plank = box(2.4, 0.12, 0.42, i % 2 ? C.wood : C.woodDark, 0, 0.6, -1.5 + i * 0.5);
    plank.receiveShadow = true;
    g.add(plank);
  }
  // support posts down into the water
  for (const [x, z] of [[-1.0, -1.4], [1.0, -1.4], [-1.0, 1.4], [1.0, 1.4], [-1.0, 0], [1.0, 0]]) {
    g.add(cyl(0.11, 0.13, 1.5, C.woodDark, x, -0.1, z, 6));
  }
  // a mooring cleat and a coil of rope
  g.add(box(0.16, 0.2, 0.16, C.woodDark, 0.95, 0.75, -1.3));
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 6, 12), mat(0xbfae86));
  coil.rotation.x = -Math.PI / 2;
  coil.position.set(-0.85, 0.7, 1.1);
  g.add(coil);
  return g;
}

function buildStall() {
  const g = new THREE.Group();
  g.add(box(2.4, 0.9, 1.2, C.wood, 0, 0.45, 0));
  g.add(box(0.1, 2.0, 0.1, C.woodDark, -1.1, 1.0, -0.5));
  g.add(box(0.1, 2.0, 0.1, C.woodDark, 1.1, 1.0, -0.5));
  const awn = box(2.8, 0.08, 1.8, C.cloth, 0, 2.05, 0.1);
  awn.rotation.x = -0.18;
  g.add(awn);
  g.add(box(0.4, 0.25, 0.4, 0xc9863b, -0.5, 1.0, 0.1));  // produce
  g.add(box(0.4, 0.3, 0.4, 0x9c3d3d, 0.4, 1.03, -0.1));
  return g;
}

function buildTree() {
  const g = new THREE.Group();
  g.add(cyl(0.16, 0.22, 1.1, C.woodDark, 0, 0.55, 0, 6));
  g.add(cone(1.1, 1.6, C.leaf, 0, 1.8, 0, 7));
  g.add(cone(0.85, 1.3, C.leafDark, 0, 2.7, 0, 7));
  return g;
}

function buildTreeRound() {
  const g = new THREE.Group();
  g.add(cyl(0.18, 0.26, 1.3, C.woodDark, 0, 0.65, 0, 6));
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 0), mat(C.leaf));
  crown.position.y = 2.1; crown.castShadow = true;
  g.add(crown);
  return g;
}

function buildLamp() {
  const g = new THREE.Group();
  g.add(cyl(0.06, 0.09, 2.4, 0x3a3a3f, 0, 1.2, 0, 6));
  const lantern = box(0.3, 0.35, 0.3, C.gold, 0, 2.5, 0);
  // No PointLight: real lights multiply the cost of every lit pixel in a
  // forward renderer. The emissive lantern IS the effect at this camera
  // distance. When a night cycle lands, attach ONE light to the player.
  lantern.material = new THREE.MeshLambertMaterial({ color: C.gold, emissive: 0xffb85c, emissiveIntensity: 1.25 });
  g.add(lantern);
  return g;
}

function buildRock() {
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), mat(C.stone));
  r.position.y = 0.3; r.scale.y = 0.7; r.castShadow = true; r.receiveShadow = true;
  g.add(r);
  return g;
}

function buildRoseBush() {
  const g = new THREE.Group();
  // low tangled foliage
  for (const [x, y, z, r] of [[0, 0.3, 0, 0.42], [0.3, 0.24, 0.2, 0.3],
                              [-0.28, 0.26, -0.18, 0.32], [0.1, 0.45, -0.25, 0.26]]) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(C.leafDark));
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = true;
    g.add(m);
  }
  // blooms
  for (const [x, y, z] of [[0.18, 0.62, 0.1], [-0.24, 0.5, 0.16],
                           [0.02, 0.7, -0.2], [0.34, 0.44, -0.1]]) {
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), mat(0xc23b5a));
    bloom.position.set(x, y, z);
    bloom.castShadow = false;
    g.add(bloom);
  }
  return g;
}

function buildCrate() {
  const g = new THREE.Group();
  g.add(box(0.7, 0.7, 0.7, C.wood, 0, 0.35, 0));
  g.add(box(0.55, 0.55, 0.55, C.woodDark, 0.5, 0.28, -0.3));
  return g;
}

function buildCampfire() {
  const g = new THREE.Group();
  // stone ring
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), mat(C.stoneDark));
    stone.position.set(Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55);
    stone.castShadow = false; stone.receiveShadow = true;
    g.add(stone);
  }
  // crossed logs
  const l1 = cyl(0.07, 0.07, 0.9, C.woodDark, 0, 0.14, 0, 6); l1.rotation.z = Math.PI / 2; l1.rotation.y = 0.5;
  const l2 = cyl(0.07, 0.07, 0.9, C.woodDark, 0, 0.14, 0, 6); l2.rotation.z = Math.PI / 2; l2.rotation.y = -0.7;
  g.add(l1, l2);
  // flame: emissive cones
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 7),
    new THREE.MeshLambertMaterial({ color: 0xff8c2a, emissive: 0xff6a00, emissiveIntensity: 1.3 }));
  flame.position.y = 0.42;
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 6),
    new THREE.MeshLambertMaterial({ color: 0xffd66e, emissive: 0xffc93c, emissiveIntensity: 1.6 }));
  core.position.y = 0.38;
  g.add(flame, core);
  return g;
}

function buildMagickCave() {
  const g = new THREE.Group();
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x4a4356 });
  // mound
  const mound = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 0), rockMat);
  mound.position.y = 1.0; mound.scale.set(1.5, 1.05, 1.15);
  mound.castShadow = false; mound.receiveShadow = true;
  g.add(mound);
  const side = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), rockMat);
  side.position.set(-1.8, 0.5, 0.4); side.castShadow = false;
  g.add(side);
  // the mouth: black void + glowing rim
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.85, 20),
    new THREE.MeshBasicMaterial({ color: 0x0a0612 }));
  mouth.position.set(0.1, 0.95, 1.55);
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 20),
    new THREE.MeshLambertMaterial({ color: 0x8a5cff, emissive: 0x7a3cff, emissiveIntensity: 1.1, side: THREE.DoubleSide }));
  rim.position.set(0.1, 0.95, 1.56);
  rim.name = 'mirage_rim'; // Mirage.js pulses this
  g.add(mouth, rim);
  // crystals
  for (const [x, z, h, r] of [[1.6, 0.9, 0.9, 0.18], [-1.1, 1.3, 0.65, 0.14], [1.1, -1.2, 1.1, 0.2]]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6),
      new THREE.MeshLambertMaterial({ color: 0xa88cff, emissive: 0x6a3cff, emissiveIntensity: 0.9 }));
    c.position.set(x, h / 2, z); c.rotation.z = (x > 0 ? -1 : 1) * 0.15;
    c.castShadow = false;
    g.add(c);
  }
  return g;
}

function buildBookPickup() {
  const g = new THREE.Group();
  const cover = box(0.4, 0.09, 0.3, 0x7a3030, 0, 0, 0);
  cover.castShadow = false;
  const pages = box(0.36, 0.06, 0.26, 0xe6d9b8, 0, 0.02, 0.01);
  pages.castShadow = false;
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14),
    new THREE.MeshLambertMaterial({ color: 0xc9a24b, emissive: 0xd9b45c, emissiveIntensity: 1.2, side: THREE.DoubleSide }));
  rune.rotation.x = -Math.PI / 2;
  rune.position.y = 0.056;
  g.add(cover, pages, rune);
  g.rotation.z = 0.18; // a jaunty hover tilt
  return g;
}

function buildFarmPlot() {
  const g = new THREE.Group();

  // tilled soil bed — always visible under every stage
  const soil = box(2.2, 0.16, 2.2, 0x5a4632, 0, 0.08, 0);
  soil.receiveShadow = true; soil.castShadow = false;
  g.add(soil);
  // furrows
  for (let i = -1; i <= 1; i++) {
    const f = box(2.0, 0.05, 0.18, 0x4a3826, 0, 0.17, i * 0.6);
    f.castShadow = false;
    g.add(f);
  }

  // --- stage: empty (bare furrows, nothing more) ---
  const empty = new THREE.Group();
  empty.name = 'stage_empty';
  g.add(empty);

  // --- stage: seeded (small sprouts) ---
  const seeded = new THREE.Group();
  seeded.name = 'stage_seeded';
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const sprout = new THREE.Mesh(
        new THREE.ConeGeometry(0.05, 0.22, 4),
        new THREE.MeshLambertMaterial({ color: 0x6f9c4a })
      );
      sprout.position.set(i * 0.6, 0.27, j * 0.6);
      sprout.castShadow = false;
      seeded.add(sprout);
    }
  }
  g.add(seeded);

  // --- stage: grown (tall, heavy, ready) ---
  const grown = new THREE.Group();
  grown.name = 'stage_grown';
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const stalk = cyl(0.045, 0.06, 0.62, 0x7fa855, i * 0.6, 0.47, j * 0.6, 5);
      stalk.castShadow = false;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 6, 5),
        new THREE.MeshLambertMaterial({ color: 0xd9b451 })
      );
      head.position.set(i * 0.6, 0.82, j * 0.6);
      head.scale.y = 1.5;
      head.castShadow = false;
      grown.add(stalk, head);
    }
  }
  g.add(grown);

  return g;
}

function buildRuneStone(symbolColor) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.46, 2.1, 6),
    mat(0x6e6a63)
  );
  body.position.y = 1.05;
  body.rotation.z = 0.04;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  g.add(box(1.0, 0.18, 1.0, 0x5a564f, 0, 0.09, 0));   // base slab

  // the carved face — StonePuzzle.js finds this by name to light it
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.26, 16),
    new THREE.MeshLambertMaterial({
      color: symbolColor, emissive: symbolColor, emissiveIntensity: 0.35,
    })
  );
  face.position.set(0, 1.35, 0.44);
  face.name = 'rune_face';
  g.add(face);
  return g;
}

function buildPedestalBook() {
  const g = new THREE.Group();
  g.add(cyl(0.34, 0.44, 0.16, 0x6a6660, 0, 0.08, 0, 8));      // base
  g.add(cyl(0.20, 0.24, 0.95, 0x77736c, 0, 0.58, 0, 8));      // column
  const top = box(0.86, 0.10, 0.62, 0x6a6660, 0, 1.10, 0);
  top.rotation.x = -0.22;
  g.add(top);
  // the great book, open
  const left = box(0.38, 0.07, 0.5, 0xe8dcc0, -0.19, 1.19, 0);
  const right = box(0.38, 0.07, 0.5, 0xe8dcc0, 0.19, 1.19, 0);
  left.rotation.x = right.rotation.x = -0.22;
  left.rotation.z = 0.05; right.rotation.z = -0.05;
  g.add(left, right);
  // the quill
  const quill = cyl(0.012, 0.02, 0.42, 0xf2eee4, 0.3, 1.4, 0.1, 5);
  quill.rotation.z = 0.5; quill.rotation.x = -0.3;
  g.add(quill);
  return g;
}

function buildHost() {
  // the herald: taller hat than sense
  const g = new THREE.Group();
  g.add(cyl(0.2, 0.26, 0.95, 0x7a2f52, 0, 0.48, 0, 8));        // robe
  const torso = box(0.42, 0.5, 0.26, 0x9c3f68, 0, 1.16, 0);
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat(0xe8c9a0));
  head.position.y = 1.58;
  g.add(head);
  g.add(cyl(0.19, 0.19, 0.06, 0x2e1a34, 0, 1.74, 0, 10));      // brim
  g.add(cyl(0.13, 0.15, 0.44, 0x2e1a34, 0, 1.98, 0, 10));      // stovepipe
  const feather = cyl(0.01, 0.02, 0.36, 0xd9b451, 0.1, 2.22, 0, 5);
  feather.rotation.z = -0.5;
  g.add(feather);
  return g;
}

function buildGardenBed() {
  const g = new THREE.Group();

  // ---- stage: under construction (shown until Odell's work is done)
  const wip = new THREE.Group();
  wip.name = 'stage_locked';
  // half-laid frame: two rails down, two stacked loose
  const railA = box(2.6, 0.16, 0.16, C.woodDark, 0, 0.08, -1.2);
  const railB = box(0.16, 0.16, 2.4, C.woodDark, -1.3, 0.08, 0);
  wip.add(railA, railB);
  const loose1 = box(2.4, 0.14, 0.14, C.woodDark, 0.3, 0.07, 1.1);
  loose1.rotation.y = 0.22;
  const loose2 = box(2.4, 0.14, 0.14, C.woodDark, 0.5, 0.21, 1.25);
  loose2.rotation.y = 0.3;
  wip.add(loose1, loose2);
  // churned dirt, not yet turned properly
  const rough = box(2.2, 0.08, 2.2, 0x6b5a45, 0, 0.04, 0);
  rough.receiveShadow = true;
  wip.add(rough);
  // a stake with a scrap of plan tied to it
  const stake = cyl(0.05, 0.05, 0.9, C.woodDark, 1.15, 0.45, -1.1, 5);
  const note = box(0.3, 0.24, 0.02, 0xe8dcc0, 1.15, 0.82, -1.05);
  wip.add(stake, note);
  g.add(wip);

  // ---- the finished bed: raised frame + dark, deep soil ----
  const built = new THREE.Group();
  built.name = 'stage_built';
  for (const [x, z, rx] of [[0, -1.2, false], [0, 1.2, false], [-1.2, 0, true], [1.2, 0, true]]) {
    const rail = rx ? box(0.18, 0.34, 2.6, C.woodDark, x, 0.17, z)
                    : box(2.6, 0.34, 0.18, C.woodDark, x, 0.17, z);
    rail.castShadow = true; rail.receiveShadow = true;
    built.add(rail);
  }
  const soil = box(2.3, 0.3, 2.3, 0x40301f, 0, 0.19, 0);   // darker than field dirt
  soil.receiveShadow = true;
  built.add(soil);
  g.add(built);

  // ---- crop stages, same names Farming.js drives ----
  const empty = new THREE.Group();
  empty.name = 'stage_empty';
  g.add(empty);

  const seeded = new THREE.Group();
  seeded.name = 'stage_seeded';
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const sprout = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.28, 4),
        new THREE.MeshLambertMaterial({ color: 0x7fb356 })
      );
      sprout.position.set(i * 0.62, 0.45, j * 0.62);
      sprout.castShadow = false;
      seeded.add(sprout);
    }
  }
  g.add(seeded);

  const grown = new THREE.Group();
  grown.name = 'stage_grown';
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const stalk = cyl(0.05, 0.07, 0.72, 0x8fbf5f, i * 0.62, 0.7, j * 0.62, 5);
      stalk.castShadow = false;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 6, 5),
        new THREE.MeshLambertMaterial({
          color: 0xe4c25c, emissive: 0x6a5320, emissiveIntensity: 0.35,
        })
      );
      head.position.set(i * 0.62, 1.12, j * 0.62);
      head.scale.y = 1.5;
      head.castShadow = false;
      grown.add(stalk, head);
    }
  }
  g.add(grown);

  return g;
}

function buildWall() {
  // a straight run of town wall: capped, with a little batter
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.4, 0.9), mat(C.stone));
  body.position.y = 1.2;
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  g.add(box(3.2, 0.22, 1.1, C.stoneDark, 0, 2.45, 0));           // cap
  // crenellations
  for (const x of [-1.1, -0.35, 0.4, 1.15]) {
    g.add(box(0.5, 0.42, 0.9, C.stone, x, 2.75, 0));
  }
  // a few stones picked out for texture
  g.add(box(0.7, 0.34, 0.94, C.stoneDark, -0.85, 0.6, 0));
  g.add(box(0.6, 0.34, 0.94, C.stoneDark, 0.7, 1.35, 0));
  return g;
}

function buildWallCorner() {
  // an L of wall with a squat tower at the elbow
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 0.9), mat(C.stone));
  a.position.set(1.1, 1.2, 0);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 2.2), mat(C.stone));
  b.position.set(0, 1.2, 1.1);
  for (const m of [a, b]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  // the corner drum
  g.add(cyl(0.85, 0.95, 3.1, C.stoneDark, 0, 1.55, 0, 10));
  g.add(cyl(1.0, 1.0, 0.24, C.stone, 0, 3.2, 0, 10));
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2;
    g.add(box(0.34, 0.4, 0.34, C.stone, Math.cos(t) * 0.78, 3.5, Math.sin(t) * 0.78));
  }
  return g;
}

function buildChest(bodyColor, bandColor) {
  const g = new THREE.Group();
  g.add(box(0.95, 0.5, 0.6, bodyColor, 0, 0.25, 0));                 // body
  const lid = box(0.95, 0.22, 0.6, bodyColor, 0, 0.6, 0);            // lid
  lid.scale.z = 0.98;
  g.add(lid);
  g.add(box(1.0, 0.06, 0.64, bandColor, 0, 0.5, 0));                 // rim band
  g.add(box(0.1, 0.75, 0.64, bandColor, -0.28, 0.37, 0));            // straps
  g.add(box(0.1, 0.75, 0.64, bandColor, 0.28, 0.37, 0));
  g.add(box(0.14, 0.16, 0.06, C.gold, 0, 0.5, 0.33));                // clasp
  return g;
}

function buildCharacter(color = 0x4a7dbd) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.9, 8), bodyMat);
  body.position.y = 0.75; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mat(0xe8c39e));
  head.position.y = 1.45; head.castShadow = true;
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.5, 8), bodyMat);
  hood.position.y = 1.72; hood.castShadow = true;
  g.add(body, head, hood);
  return g;
}

function buildStoneFace() {
  const g = new THREE.Group();
  // a weathered monolith, tilted, with a face cut into it
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.9, 0.9), mat(C.stoneDark));
  slab.position.y = 1.45;
  slab.rotation.z = 0.05;
  slab.castShadow = true; slab.receiveShadow = true;
  g.add(slab);
  g.add(box(2.2, 0.3, 1.3, C.stone, 0, 0.15, 0));                // buried base
  // brow, eyes, mouth — shallow cuts, deliberately crude
  g.add(box(1.3, 0.16, 0.1, 0x5f6469, 0, 2.15, 0.47));
  g.add(box(0.26, 0.2, 0.1, 0x3a3e42, -0.34, 1.88, 0.47));
  g.add(box(0.26, 0.2, 0.1, 0x3a3e42, 0.34, 1.88, 0.47));
  g.add(box(0.16, 0.42, 0.1, 0x5f6469, 0, 1.55, 0.47));          // nose
  g.add(box(0.7, 0.13, 0.1, 0x3a3e42, 0, 1.15, 0.47));           // mouth
  // moss at the foot
  g.add(box(1.9, 0.1, 1.1, C.leafDark, 0.1, 0.32, 0.1));
  return g;
}

function buildShopSmall() {
  const g = new THREE.Group();
  g.add(box(4.4, 2.6, 3.6, C.plaster, 0, 1.3, 0));
  g.add(box(4.6, 0.24, 3.8, C.woodDark, 0, 2.6, 0));
  g.add(roof(4.4, 1.5, 3.6, C.roofPurple, 2.7));
  // wide shop window with a counter ledge
  g.add(box(2.2, 1.1, 0.12, 0x3c4a52, 0, 1.35, 1.84));
  g.add(box(2.6, 0.14, 0.5, C.woodDark, 0, 0.78, 2.0));
  g.add(box(0.9, 1.7, 0.12, C.woodDark, -1.6, 0.85, 1.84));      // door
  // striped awning over the window
  const awn = box(2.8, 0.1, 1.2, 0xb4483c, 0, 2.05, 2.3);
  awn.rotation.x = -0.3;
  g.add(awn);
  // hanging sign on a bracket
  g.add(box(0.9, 0.07, 0.07, C.woodDark, 2.4, 2.3, 1.9));
  g.add(box(0.7, 0.5, 0.06, C.gold, 2.75, 1.98, 1.9));
  return g;
}

function buildBlacksmith() {
  const g = new THREE.Group();
  g.add(box(5.2, 2.6, 4.0, C.stone, 0, 1.3, 0));                 // stone walls
  g.add(box(5.4, 0.28, 4.2, C.woodDark, 0, 2.6, 0));
  g.add(roof(5.2, 1.6, 4.0, 0x4a4a4a, 2.7));                     // slate roof
  // open forge front — a wide dark bay instead of a door
  g.add(box(2.4, 1.8, 0.14, 0x2a2018, 0, 0.9, 2.05));
  const coals = box(1.6, 0.2, 0.5, 0xff6a2a, 0, 0.35, 1.9);
  coals.material = new THREE.MeshLambertMaterial({
    color: 0xff8c3a, emissive: 0xff5a10, emissiveIntensity: 1.4 });
  g.add(coals);
  // chimney with a smoke stack
  g.add(box(1.0, 2.4, 1.0, C.stoneDark, -1.7, 3.4, -1.0));
  g.add(box(1.2, 0.2, 1.2, 0x4a4a4a, -1.7, 4.6, -1.0));
  // anvil out front, on a stump
  g.add(cyl(0.28, 0.32, 0.5, C.woodDark, 2.2, 0.25, 2.6, 8));
  const anvil = box(0.7, 0.22, 0.28, 0x55595e, 2.2, 0.61, 2.6);
  g.add(anvil);
  g.add(box(0.26, 0.16, 0.26, 0x55595e, 1.95, 0.78, 2.6));
  return g;
}
  
function buildGuard() {
  const g = buildCharacter(0x5a6470);                      // steel-grey tabard
  // helmet instead of hood: replace the cone with a rounded cap + plume
  const hood = g.children[2];
  g.remove(hood);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x8a9099));
  helm.position.y = 1.5; helm.castShadow = true;
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 6), mat(0xa8342c));
  plume.position.y = 1.85;
  // spear in hand
  const shaft = cyl(0.03, 0.03, 2.2, C.woodDark, 0.45, 1.1, 0, 6);
  const tip = cone(0.07, 0.25, 0x8a9099, 0.45, 2.3, 0, 6);
  g.add(helm, plume, shaft, tip);
  return g;
}

// ---------------- the registry ----------------
// url:null → placeholder. Set url to a GLB path to swap the art everywhere.
// fit: 'footprint' scales the model uniformly so its XZ bounding box matches
//      `footprint` metres — lets you drop in models at any authoring scale.
// collider: radius used for simple movement blocking (null = walk-through).

export const ASSET_DEFS = {
  house_small: { url: null, build: buildHouseSmall, footprint: 3.4,  collider: 2.0 },
  // ---- restored: assets Town~Squared places, whose defs were lost ----
  // (67 placements were falling back to the magenta debug cube)
  wall:        { url: null, build: buildWall,        footprint: 3.0,  collider: 1.4, instanced: true },
  wall_corner: { url: null, build: buildWallCorner,  footprint: 3.0,  collider: 1.4 },
  fence:       { url: null, build: buildFenceSegment,  footprint: 2.5, collider: 0.9, instanced: true, noCastShadow: true },
  fence2:      { url: null, build: buildFenceSegment2, footprint: 2.5, collider: 0.9, instanced: true, noCastShadow: true },
  rosebush:    { url: null, build: buildRoseBush,    footprint: 1.0,  collider: 0.5, instanced: true, noCastShadow: true },
  shop_small:  { url: null, build: buildShopSmall,   footprint: 4.4,  collider: 2.4 },
  blacksmith:  { url: null, build: buildBlacksmith,  footprint: 5.2,  collider: 2.8 },
  cattle_farm: { url: null, build: buildFarmHouse,   footprint: 6.5,  collider: 3.4 },
  dock:        { url: null, build: buildDock,        footprint: 2.6,  collider: null, noCastShadow: true },
  stone_face:  { url: null, build: buildStoneFace,   footprint: 2.2,  collider: 0.9 },
  // `mirage` is the decorative cave you place by hand; `magick_cave` above is
  // the one Mirage.js spawns and despawns on its own schedule
  mirage:      { url: null, build: buildMagickCave,  footprint: 4.6,  collider: null, noCastShadow: true },

  house_large: { url: null, build: buildHouseLarge, footprint: 4.8,  collider: 2.6 },
  tavern:      { url: null, build: buildTavern,     footprint: 5.8,  collider: 3.2 },
  tower:       { url: null, build: buildTower,      footprint: 3.8,  collider: 2.0 },
  well:        { url: null, build: buildWell,       footprint: 2.0,  collider: 1.1 },
  stall:       { url: null, build: buildStall,      footprint: 2.8,  collider: 1.4 },
  // `instanced` — all placements of this asset render as ONE draw call per
  //   part via InstancedMesh (they stay individually editable in the editor).
  // `noCastShadow` — small props skip the shadow pass entirely.
  tree_pine:   { url: null, build: buildTree,       footprint: 2.2,  collider: 0.4, instanced: true },
  tree_round:  { url: null, build: buildTreeRound,  footprint: 2.3,  collider: 0.4, instanced: true },
  lamp:        { url: null, build: buildLamp,       footprint: 0.6,  collider: 0.25, instanced: true, noCastShadow: true },
  rock:        { url: null, build: buildRock,       footprint: 1.1,  collider: 0.6,  instanced: true, noCastShadow: true },
  crate:       { url: null, build: buildCrate,      footprint: 1.2,  collider: 0.6,  instanced: true, noCastShadow: true },
  // containers: `container` names the loot table (data/loot.json) — that's
  // the flag that makes an asset openable by players
  chest_wood:  { url: null, build: () => buildChest(0x7a5230, 0x5c3d22), footprint: 1.0, collider: 0.55, container: 'common' },
  chest_iron:  { url: null, build: () => buildChest(0x6a7076, 0xc9a24b), footprint: 1.0, collider: 0.55, container: 'rare' },
  // cook spot: stand near one to cook raw fish from the inventory
  campfire:    { url: null, build: buildCampfire,   footprint: 1.4,  collider: 0.6,  noCastShadow: true },
  // the mirage: spawned/managed by Mirage.js, walk-through (it isn't quite real)
  magick_cave: { url: null, build: buildMagickCave, footprint: 4.6,  collider: null, noCastShadow: true },
  // lore books: spawned/managed by Bibliofolio.js
  book_pickup: { url: null, build: buildBookPickup, footprint: 0.5,  collider: null, noCastShadow: true },
  // farm plot: one object, three stages toggled by Farming.js
  farm_plot:   { url: null, build: buildFarmPlot,   footprint: 2.4,  collider: null, noCastShadow: true, mapColor: '#7a6034' },
  // Odell's garden bed — richer soil, but half-built until you've done
  // his run of work. Farming.js toggles stage_locked / stage_built.
  garden_bed:  { url: null, build: buildGardenBed,  footprint: 2.8,  collider: null, noCastShadow: true, mapColor: '#4a3a22' },
  // ---- the stone circle ----
  // Six standing stones, each its own asset id so the editor places them
  // individually. `stone` names the symbol the server expects back in
  // submit_stone_order — StonePuzzle.js reads it from here.
  stone_water: { url: null, build: () => buildRuneStone(0x5aa9c9), footprint: 1.2, collider: null, stone: 'water' },
  stone_door:  { url: null, build: () => buildRuneStone(0xc9a24b), footprint: 1.2, collider: null, stone: 'door' },
  stone_ember: { url: null, build: () => buildRuneStone(0xc9603c), footprint: 1.2, collider: null, stone: 'ember' },
  stone_root:  { url: null, build: () => buildRuneStone(0x6f9c4a), footprint: 1.2, collider: null, stone: 'root' },
  stone_eye:   { url: null, build: () => buildRuneStone(0xa88cff), footprint: 1.2, collider: null, stone: 'eye' },
  stone_moon:  { url: null, build: () => buildRuneStone(0xd8d2e8), footprint: 1.2, collider: null, stone: 'moon' },
  // the library's inner room: the Book of Names (see Library.js)
  pedestal_book: { url: null, build: buildPedestalBook, footprint: 1.0, collider: 0.5 },
  // the herald: spawned by StonePuzzle.js on a win, never placed by hand
  char_host:     { url: null, build: buildHost,         footprint: 0.9, collider: null },
  // characters are assets too — swap in a rigged GLB later
  char_player: { url: null, build: () => buildCharacter(0x4a7dbd), footprint: 0.9, collider: null },
  char_remote: { url: null, build: () => buildCharacter(0xbd6a4a), footprint: 0.9, collider: null },
  char_npc:    { url: null, build: () => buildCharacter(0x6a8f5a), footprint: 0.9, collider: null },
  char_guard:  { url: null, build: buildGuard,                     footprint: 0.9, collider: null },
};

export class AssetRegistry {
  constructor(defs = ASSET_DEFS) {
    this.defs = defs;
    this.templates = new Map();   // id -> Promise<Object3D>
    this.loader = new GLTFLoader();

    // Draco: geometry compression is a 5–10x download-size win on real
    // models (gltf-transform optimize model.glb out.glb --compress draco).
    // Decoding runs in a Web Worker via Google's hosted decoder, so it
    // costs nothing on the main thread. Uncompressed GLBs still load fine
    // through the same loader — this only activates when a model actually
    // carries the Draco extension.
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.loader.setDRACOLoader(draco);
  }

  /** Resolve an asset id to a template Object3D (cached). */
  async getTemplate(id) {
    if (!this.templates.has(id)) {
      this.templates.set(id, this._loadTemplate(id));
    }
    return this.templates.get(id);
  }

  async _loadTemplate(id) {
    const def = this.defs[id];
    if (!def) {
      console.warn(`[AssetRegistry] Unknown asset "${id}" — using fallback cube`);
      return box(1, 1, 1, 0xff00ff, 0, 0.5, 0);
    }
    let template = null;
    if (def.url) {
      try {
        const gltf = await this.loader.loadAsync(def.url);
        const model = gltf.scene;
        model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this._normalise(model, def);
        // Wrap in a group: scale/grounding live on the child, so World can
        // freely set the root's position/rotation without wiping them.
        const wrapper = new THREE.Group();
        wrapper.add(model);
        wrapper.userData.animations = gltf.animations || [];
        template = wrapper;
      } catch (err) {
        console.warn(`[AssetRegistry] Failed to load ${def.url} for "${id}", falling back to placeholder`, err);
      }
    }
    if (!template) template = def.build();
    if (def.noCastShadow) {
      template.traverse(o => { if (o.isMesh) o.castShadow = false; });
    }
    return template;
  }

  /** Scale a loaded GLB so its XZ footprint matches the placeholder's, and
   *  rest its base on y=0 — this is what makes swapping painless. */
  _normalise(model, def) {
    const bbox = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); bbox.getSize(size);
    if (def.footprint && size.x > 0 && size.z > 0) {
      const s = def.footprint / Math.max(size.x, size.z);
      model.scale.setScalar(s);
      bbox.setFromObject(model);
    }
    model.position.y -= bbox.min.y; // feet on the ground
  }

  /** New instance of an asset for placing in the scene.
   *  Uses SkeletonUtils.clone — plain Object3D.clone() breaks SkinnedMesh
   *  rigs (bones aren't retargeted to the clone's skeleton). Also reattaches
   *  the template's AnimationClips AFTER cloning: Object3D.copy() deep-clones
   *  userData via JSON, which silently destroys clip objects. */
  async instance(id) {
    const template = await this.getTemplate(id);
    const animations = template.userData.animations ?? [];
    const clone = SkeletonUtils.clone(template);
    clone.userData.assetId = id;
    clone.userData.animations = animations; // the real clips, shared by all instances

    // Characters move every frame, but the shadow map is now static
    // (rendered on demand). They skip the shadow pass and carry a cheap
    // blob shadow instead — visually right at this camera distance.
    if (id.startsWith('char_')) {
      clone.traverse(o => { if (o.isMesh) o.castShadow = false; });
      const blob = new THREE.Mesh(
        new THREE.CircleGeometry(0.42, 16),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
      );
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.025;
      clone.add(blob);
    }
    return clone;
  }

  colliderRadius(id) {
    return this.defs[id]?.collider ?? null;
  }

  /** Point an asset at a (new) model URL at runtime. Clears the cached
   *  template so the next instance() loads the new model. Pass null to
   *  revert to the placeholder. */
  setUrl(id, url) {
    if (!this.defs[id]) return;
    this.defs[id].url = url;
    this.templates.delete(id);
  }

  /** Apply overrides from data/models.json. Entries can be either
   *    "house_small": "assets/models/house.glb"
   *  or, when a model needs a vertical correction for every instance:
   *    "house_small": { "url": "assets/models/house.glb", "yOffset": 0.15 }
   */
  applyOverrides(map) {
    for (const [id, v] of Object.entries(map ?? {})) {
      if (!this.defs[id]) continue;
      if (typeof v === 'string') {
        this.setUrl(id, v);
      } else if (v && typeof v === 'object') {
        this.defs[id].yOffset = v.yOffset ?? 0;
        this.setUrl(id, v.url ?? this.defs[id].url);
      }
    }
  }

  /** Asset-wide vertical correction (applied on top of per-placement y). */
  yOffset(id) {
    return this.defs[id]?.yOffset ?? 0;
  }

  /** True if this asset currently resolves to a GLB (vs placeholder). */
  usesModel(id) {
    return !!this.defs[id]?.url;
  }
}
