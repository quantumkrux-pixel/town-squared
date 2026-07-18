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

function buildCattleFarm() {
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

function buildShopSmall() {
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

function buildWall() {
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

function buildWallCorner() {
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

function buildDock() {
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

function buildLamp() {
  const g = new THREE.Group();
  g.add(cyl(0.06, 0.09, 2.4, 0x3a3a3f, 0, 1.2, 0, 6));
  const lantern = box(0.3, 0.35, 0.3, C.gold, 0, 2.5, 0);
  lantern.material = new THREE.MeshLambertMaterial({ color: C.gold, emissive: 0xffb85c, emissiveIntensity: 0.9 });
  g.add(lantern);
  const light = new THREE.PointLight(0xffb060, 0.55, 7);
  light.position.set(0, 2.5, 0);
  g.add(light);
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
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), mat(C.leaf));
  r.position.y = 0.3; r.scale.y = 0.7; r.castShadow = true; r.receiveShadow = true;
  g.add(r);
  return g;
}

function buildCrate() {
  const g = new THREE.Group();
  g.add(box(0.7, 0.7, 0.7, C.wood, 0, 0.35, 0));
  g.add(box(0.55, 0.55, 0.55, C.woodDark, 0.5, 0.28, -0.3));
  return g;
}

function buildBook() {
  const g = new THREE.Group();
  g.add(box(0.7, 0.7, 0.7, C.wood, 0, 0.35, 0));
  g.add(box(0.55, 0.55, 0.55, C.woodDark, 0.5, 0.28, -0.3));
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

function buildMirage() {
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


// ---------------- the registry ----------------
// url:null → placeholder. Set url to a GLB path to swap the art everywhere.
// fit: 'footprint' scales the model uniformly so its XZ bounding box matches
//      `footprint` metres — lets you drop in models at any authoring scale.
// collider: radius used for simple movement blocking (null = walk-through).

export const ASSET_DEFS = {
  house_small: { url: 'assets/models/house_small.glb', build: buildHouseSmall, footprint: 3.4,  collider: 2.0 },
  cattle_farm: { url: 'assets/models/cattle_farm.glb', build: buildCattleFarm, footprint: 3.4,  collider: 2.0 },
  house_large: { url: 'assets/models/house_large.glb', build: buildHouseLarge, footprint: 4.8,  collider: 2.6 },
  tavern:      { url: 'assets/models/tavern.glb', build: buildTavern,     footprint: 5.8,  collider: 3.2 },
  shop_small: { url: 'assets/models/shop_small.glb', build: buildShopSmall, footprint: 3.4,  collider: 2.0 },
  tower:       { url: null, build: buildTower,      footprint: 3.8,  collider: 2.0 },
  well:        { url: 'assets/models/well.glb', build: buildWell,       footprint: 2.0,  collider: 1.1 },
  stall:       { url: 'assets/models/shop_stall.glb', build: buildStall,      footprint: 2.8,  collider: 1.4 },
  fence:       { url: 'assets/models/fence_segment.glb', build: buildFenceSegment,      footprint: 2.8,  collider: 1.4 },
  dock:       { url: 'assets/models/dock.glb', build: buildDock,      footprint: 2.8, },
  wall:       { url: 'assets/models/wall.glb', build: buildWall,      footprint: 2.8,  collider: 1.4 },
    wall_corner:  { url: 'assets/models/wall_corner_round.glb', build: buildWallCorner,    footprint: 2.5, collider: 0.55 },
  tree_pine:   { url: null, build: buildTree,       footprint: 2.2,  collider: 0.4 },
  tree_round:  { url: null, build: buildTreeRound,  footprint: 2.3,  collider: 0.4 },
  lamp:        { url: null, build: buildLamp,       footprint: 0.6,  collider: 0.25 },
  rock:        { url: null, build: buildRock,       footprint: 1.1,  collider: 0.6 },
  rosebush:    { url: 'assets/models/rose_bush.glb', build: buildRoseBush,       footprint: 1.1,  collider: 0.6 },
  crate:       { url: 'assets/models/crates.glb', build: buildCrate,      footprint: 1.2,  collider: 0.6 },
  book_pickup:       { url: 'assets/models/book.glb', build: buildBook,      footprint: 1.2,  collider: 0.6 },
  // containers: `container` names the loot table (data/loot.json) —
  // that's the flag that makes an asset openable by players
  chest_wood:  { url: 'assets/models/wooden_chest.glb', build: () => buildChest(0x7a5230, 0x5c3d22), footprint: 1.0, collider: 0.55, container: 'common' },
  chest_iron:  { url: null, build: () => buildChest(0x6a7076, 0xc9a24b), footprint: 1.0, collider: 0.55, container: 'rare' },
  // characters are assets too — swap in a rigged GLB later
  char_player: { url: null, build: () => buildCharacter(0x4a7dbd), footprint: 0.9, collider: null },
  char_remote: { url: null, build: () => buildCharacter(0xbd6a4a), footprint: 0.9, collider: null },
  char_npc:    { url: null, build: () => buildCharacter(0x6a8f5a), footprint: 0.9, collider: null },
  char_guard:  { url: null, build: buildGuard,                     footprint: 0.9, collider: null },
  mirage: { url: 'assets/models/mirage_cave.glb', build: buildMirage, footprint: 4.8,  collider: 2.6 },
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
