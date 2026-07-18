// ============================================================
// World.js — turns data/town.json into a scene.
//
// The map is *data*: asset IDs + transforms. This class never knows
// what a "house" looks like — it asks the AssetRegistry. That's the
// contract that lets you swap models without re-placing anything.
// Later, town.json's contents move into a Supabase table and this
// class stays identical.
// ============================================================

import * as THREE from 'https://unpkg.com/three@0.128.0/build/three.module.js';
import { CharacterAnimator } from './CharacterAnimator.js';

// scratch objects reused by the batching math (no per-call allocation)
const _tmpMatrix = new THREE.Matrix4();
const _yAxis = new THREE.Vector3(0, 1, 0);

export class World {
  constructor(scene, registry) {
    this.scene = scene;
    this.registry = registry;
    this.colliders = [];   // { x, z, r }
    this.placed = [];      // { data, obj|null, batchIndex } — editable placement records
    this.batches = new Map(); // assetId -> { meshes:[InstancedMesh], recs, childLocals }
    this._staticDirty = true; // shadows re-render on demand, not per frame
    this.npcs = [];        // { name, mesh, path, speed, totalLen, segLens }
    this.groundMesh = null;
    this.waterMesh = null;
    this.water = null;
    this.data = null;
  }

  async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load world: ${url} (${res.status})`);
    this.data = await res.json();

    this._buildGround();
    this._buildWater();
    this._buildRoads();
    await this._buildPlacements();
    await this._buildNPCs();
    return this.data;
  }

  get spawn() {
    return this.data?.spawn ?? { x: 0, z: 0 };
  }

  // ---------- ground ----------
  // town.json controls this:
  //   "ground": { "size": 90, "color": "#86a86b" }                 ← square, centred at origin
  //   "ground": { "size": 90, "width": 180, "centerX": -45, ... }  ← rectangular / offset
  // width/depth default to size; centerX/centerZ default to 0. All systems
  // (collision bounds, water extents, textures) derive from these bounds.
  // NOTE: color MULTIPLIES the texture (it's a tint). Use "#ffffff" for the
  // texture's true colors, or keep a slight tint to unify mismatched art.
  _buildGround() {
    const g = this.data.ground;
    const width = g.width ?? g.size;
    const depth = g.depth ?? g.size;
    const cx = g.centerX ?? 0, cz = g.centerZ ?? 0;
    this.bounds = {
      minX: cx - width / 2, maxX: cx + width / 2,
      minZ: cz - depth / 2, maxZ: cz + depth / 2,
    };

    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(g.color ?? '#ffffff') });
    if (g.texture) {
      const tex = new THREE.TextureLoader().load(
        g.texture, undefined, undefined,
        () => console.warn(`[World] ground texture failed to load: ${g.texture}`)
      );
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      // `repeat` = tiles across the larger dimension; scaled so tiles stay square
      const maxDim = Math.max(width, depth);
      const rep = g.repeat ?? maxDim / 4;
      tex.repeat.set(rep * width / maxDim, rep * depth / maxDim);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = 8;
      mat.map = tex;
    }

    const geo = new THREE.PlaneGeometry(width, depth, 1, 1);
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(cx, 0, cz);
    this.groundMesh.receiveShadow = true;
    this.groundMesh.name = 'ground';
    this.scene.add(this.groundMesh);

    // dark underlay extending past the edges so the world fades into fog
    // instead of ending at a hard line (works for any ground shape)
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 140, depth + 140),
      new THREE.MeshBasicMaterial({ color: 0x2c3a28 })
    );
    under.rotation.x = -Math.PI / 2;
    under.position.set(cx, -0.05, cz);
    this.scene.add(under);
  }

  // ---------- water ----------
  // town.json, top level (omit entirely for no water):
  //   "water": {
  //     "side": "east",              ← east(+x) | west(-x) | north(-z) | south(+z)
  //     "shore": 30,                 ← world coordinate where land ends
  //     "color": "#3d6e8f",          ← tint; "#ffffff" for a texture's true colors
  //     "texture": "assets/textures/water.png",   ← optional, seamless
  //     "tileSize": 4,               ← metres per texture tile
  //     "drift": 0.02,               ← UV scroll speed (texture only); 0 = static
  //     "opacity": 0.92,
  //     "waveHeight": 0.1,           ← metres; 0 = still water
  //     "sand": { "width": 3.5, "color": "#d8c48f",
  //               "texture": "assets/textures/sand.png", "tileSize": 2 }
  //   }
  // Waves are a pure function of wall-clock time — synced on every client
  // for free, like the NPCs. The shoreline also blocks player movement.
  _buildWater() {
    const w = this.data.water;
    if (!w) return;
    this.water = {
      side: w.side ?? 'east',
      shore: w.shore ?? this.data.ground.size / 3,
      waveHeight: w.waveHeight ?? 0.1,
      drift: w.drift ?? 0.02,
      jagged: w.jagged ?? 0,          // metres of coastline meander (0 = straight)
      jaggedDetail: w.jaggedDetail ?? 1, // frequency multiplier (higher = busier coast)
    };

    const b = this.bounds;
    const extend = 30; // reach past the map edge into the fog
    const ew = this.water.side === 'east' || this.water.side === 'west';
    const along = ew ? (b.maxZ - b.minZ) + 2 * extend : (b.maxX - b.minX) + 2 * extend;
    const alongCenter = ew ? (b.minZ + b.maxZ) / 2 : (b.minX + b.maxX) / 2;
    let across;
    switch (this.water.side) {
      case 'east':  across = (b.maxX + extend) - this.water.shore; break;
      case 'west':  across = -(b.minX - extend) - this.water.shore; break;
      case 'north': across = -(b.minZ - extend) - this.water.shore; break;
      case 'south': across = (b.maxZ + extend) - this.water.shore; break;
    }
    this._alongCenter = alongCenter;

    // geometry resolution: finer along the coast when it's jagged
    const segLen = this.water.jagged > 0 ? 1.25 : 2.5;

    // which local-X is the shore edge, and which way "toward land" points
    const sign = (this.water.side === 'east' || this.water.side === 'north') ? 1 : -1;

    // sand strip hugging the shoreline (follows the jag exactly)
    if (w.sand) {
      const sandW = w.sand.width ?? 3;
      const sandMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(w.sand.color ?? (w.sand.texture ? '#ffffff' : '#d8c48f')),
      });
      if (w.sand.texture) {
        sandMat.map = this._tiledTexture(w.sand.texture,
          sandW / (w.sand.tileSize ?? 2), along / (w.sand.tileSize ?? 2));
      }
      const sandGeo = new THREE.PlaneGeometry(sandW, along, 1, Math.ceil(along / segLen));
      sandGeo.rotateX(-Math.PI / 2);
      if (this.water.jagged > 0) {
        // shift the whole cross-section sideways by the jag at that point —
        // constant width, meandering with the waterline
        const pos = sandGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          pos.setX(i, pos.getX(i) + sign * this._coastJag(pos.getZ(i)));
        }
      }
      const sand = new THREE.Mesh(sandGeo, sandMat);
      this._placeCoastal(sand, this.water.shore - sandW / 2, 0.03);
      sand.receiveShadow = true;
      this.scene.add(sand);
    }

    // the sea itself: subdivided so waves have vertices to move
    const geo = new THREE.PlaneGeometry(
      across, along,
      Math.max(8, Math.ceil(across / 2.5)),
      Math.max(8, Math.ceil(along / segLen))
    );
    geo.rotateX(-Math.PI / 2);

    // jag the water's shore edge, fading out over ~10m toward open sea so
    // no triangles fold over each other
    if (this.water.jagged > 0) {
      const pos = geo.attributes.position;
      const edgeX = -sign * (across / 2);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const distFromEdge = (x - edgeX) * sign;
        const falloff = Math.max(0, 1 - distFromEdge / 10);
        if (falloff > 0) {
          pos.setX(i, x + sign * this._coastJag(pos.getZ(i)) * falloff);
        }
      }
    }

    const mat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(w.color ?? (w.texture ? '#ffffff' : '#3d6e8f')),
      transparent: (w.opacity ?? 0.92) < 1,
      opacity: w.opacity ?? 0.92,
      flatShading: true,      // low-poly facets catch the sun as waves move
      shininess: 90,
      specular: 0x557799,
    });
    if (w.texture) {
      this.waterTex = this._tiledTexture(w.texture,
        across / (w.tileSize ?? 4), along / (w.tileSize ?? 4));
      mat.map = this.waterTex;
    }
    this.waterMesh = new THREE.Mesh(geo, mat);
    this._placeCoastal(this.waterMesh, this.water.shore + across / 2, 0.06);
    this.scene.add(this.waterMesh);
  }

  /** Coastline meander: how far the waterline deviates from `shore` at a
   *  point `s` along the coast. Sum of sines at irrational-ish frequency
   *  ratios — organic-looking, fully deterministic, identical everywhere
   *  it's evaluated (geometry, sand, AND collision use this same curve). */
  _coastJag(s) {
    const a = this.water?.jagged ?? 0;
    if (!a) return 0;
    const f = this.water.jaggedDetail;
    return a * (
      0.55 * Math.sin(s * 0.11 * f) +
      0.30 * Math.sin(s * 0.31 * f + 1.7) +
      0.15 * Math.sin(s * 0.83 * f + 4.2)
    );
  }

  /** Load a seamless texture set up for tiling. */
  _tiledTexture(url, repX, repY) {
    const tex = new THREE.TextureLoader().load(
      url, undefined, undefined,
      () => console.warn(`[World] texture failed to load: ${url}`)
    );
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repX, repY);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 8;
    return tex;
  }

  /** Position a coast-aligned strip for whichever side the water is on.
   *  Strips are authored running along z; rotated for north/south coasts. */
  _placeCoastal(mesh, centerAcross, y) {
    const c = this._alongCenter ?? 0;
    switch (this.water.side) {
      case 'east':  mesh.position.set(centerAcross, y, c); break;
      case 'west':  mesh.position.set(-centerAcross, y, c); break;
      case 'north': mesh.position.set(c, y, -centerAcross); mesh.rotation.y = Math.PI / 2; break;
      case 'south': mesh.position.set(c, y, centerAcross);  mesh.rotation.y = Math.PI / 2; break;
    }
  }

  /** Call every frame: gentle deterministic waves + drifting texture.
   *  Perf: writes the position buffer directly (no accessor overhead) and
   *  recomputes lighting normals only every other frame — visually
   *  indistinguishable, halves the most expensive per-frame CPU work. */
  updateWater(nowMs) {
    if (!this.waterMesh) return;
    const t = nowMs / 1000;

    if (this.waterTex && this.water.drift > 0) {
      this.waterTex.offset.set(
        (t * this.water.drift) % 1,
        (t * this.water.drift * 0.6) % 1
      );
    }

    if (this.water.waveHeight <= 0) return;
    const wh = this.water.waveHeight;
    const attr = this.waterMesh.geometry.attributes.position;
    const a = attr.array;
    for (let i = 0; i < a.length; i += 3) {
      a[i + 1] =
        Math.sin(a[i] * 0.35 + t * 1.2) * wh +
        Math.sin(a[i + 2] * 0.22 + t * 0.8) * wh * 0.6;
    }
    attr.needsUpdate = true;
    this._waterTick = !this._waterTick;
    if (this._waterTick) this.waterMesh.geometry.computeVertexNormals();
  }

  // ---------- roads ----------
  // town.json controls this via an optional top-level "roadStyle":
  //   "roadStyle": { "color": "#b09a76" }                                   ← flat color (default)
  //   "roadStyle": { "color": "#ffffff",
  //                  "texture": "assets/textures/road.png",
  //                  "tileSize": 1.5,
  //                  "edgeJitter": 0.35,      ← rough edges: max metres of wobble (0/omit = clean)
  //                  "edgeSegment": 1.0,      ← metres between wobble points (smaller = busier)
  //                  "transparent": true }    ← honor alpha in the texture (ragged-edge PNGs)
  // tileSize = metres each texture tile covers, tiles run ALONG the road.
  // Edge jitter is deterministic (seeded per road) — identical on every
  // client and every reload, so it's safe for multiplayer.
  _buildRoads() {
    const style = this.data.roadStyle ?? {};
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(style.color ?? (style.texture ? '#ffffff' : '#b09a76')),
    });
    if (style.texture) {
      const tex = new THREE.TextureLoader().load(
        style.texture,
        undefined, undefined,
        () => console.warn(`[World] road texture failed to load: ${style.texture}`)
      );
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = 8;
      mat.map = tex;
    }
    if (style.transparent) {
      mat.transparent = true;
      mat.alphaTest = style.alphaTest ?? 0.4; // cut ragged edges cleanly, avoids sort artifacts
    }

    (this.data.roads ?? []).forEach((r, roadIndex) => {
      const [x1, z1] = r.from, [x2, z2] = r.to;
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const fullLen = len + r.width; // slight overrun joins intersections

      // Subdivide along the length so edges have vertices to displace.
      const jitter = style.edgeJitter ?? 0;
      const segLen = style.edgeSegment ?? 1.0;
      const lengthSegs = jitter > 0 ? Math.max(2, Math.round(fullLen / segLen)) : 1;
      const geo = new THREE.PlaneGeometry(r.width, fullLen, 1, lengthSegs);

      // Rough edges: deterministic per-vertex wobble, seeded by road index,
      // so every client generates the exact same silhouette.
      if (jitter > 0) {
        let seed = roadIndex * 7919 + 12345;
        const rand = () => {
          seed = (seed * 16807) % 2147483647;
          return seed / 2147483647;
        };
        const pos = geo.attributes.position;
        const halfW = r.width / 2;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          if (Math.abs(Math.abs(x) - halfW) < 1e-4) {
            // push edge vertices outward by 0..jitter (outward-only keeps
            // the walkable width at least as wide as authored)
            pos.setX(i, x + Math.sign(x) * rand() * jitter);
          }
        }
        geo.computeVertexNormals();
      }

      // Per-road tiling via UV scaling: all roads share ONE texture/material.
      if (style.texture) {
        const tile = style.tileSize ?? r.width;
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * (r.width / tile), uv.getY(i) * (fullLen / tile));
        }
      }
      geo.rotateX(-Math.PI / 2); // lay flat: length now runs along z

      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.y = Math.atan2(dx, dz);
      mesh.position.set((x1 + x2) / 2, 0.02, (z1 + z2) / 2);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    });
  }

  // ---------- placements ----------
  // Two render paths, one data model. Assets flagged `instanced` in the
  // registry render as InstancedMesh batches: ONE draw call per template
  // part for ALL placements of that asset (10 trees = ~3 draws, not 30).
  // Their records stay individually editable — moves update the instance
  // matrix in place; add/remove/model-swap rebuild the batch (cheap at
  // these counts). Interactive assets (containers) are never instanced.

  _isInstanced(assetId) {
    const def = this.registry.defs[assetId];
    return !!def?.instanced && !def?.container;
  }

  /** Mark static geometry changed (shadow map re-renders on demand). */
  staticChanged() { this._staticDirty = true; }
  consumeStaticDirty() {
    const d = this._staticDirty;
    this._staticDirty = false;
    return d;
  }

  async _buildPlacements() {
    for (const p of this.data.placements ?? []) {
      const rec = { data: p, obj: null, batchIndex: -1 };
      this.placed.push(rec);
      if (!this._isInstanced(p.asset)) {
        rec.obj = await this.registry.instance(p.asset);
        this.applyTransform(rec);
        this.scene.add(rec.obj);
      }
    }
    const ids = new Set(this.placed.filter(r => this._isInstanced(r.data.asset)).map(r => r.data.asset));
    for (const id of ids) await this.rebuildBatch(id);
    this.refreshColliders();
  }

  /** Add a placement record + its scene representation. */
  async addPlacement(data, refresh = true) {
    const rec = { data, obj: null, batchIndex: -1 };
    this.placed.push(rec);
    if (this._isInstanced(data.asset)) {
      await this.rebuildBatch(data.asset);
    } else {
      rec.obj = await this.registry.instance(data.asset);
      this.applyTransform(rec);
      this.scene.add(rec.obj);
    }
    if (refresh) this.refreshColliders();
    return rec;
  }

  removePlacement(rec) {
    const i = this.placed.indexOf(rec);
    if (i === -1) return;
    this.placed.splice(i, 1);
    if (rec.obj) {
      this.scene.remove(rec.obj);
      this.refreshColliders();
      this.staticChanged();
    } else {
      this.rebuildBatch(rec.data.asset).then(() => this.refreshColliders());
    }
  }

  _composeMatrix(data) {
    const y = (data.y ?? 0) + this.registry.yOffset(data.asset);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(data.x, y, data.z),
      new THREE.Quaternion().setFromAxisAngle(_yAxis, data.rotY ?? 0),
      new THREE.Vector3().setScalar(data.scale ?? 1)
    );
  }

  /** Sync a record's scene representation to its data. */
  applyTransform(rec) {
    if (rec.obj) {
      const { data, obj } = rec;
      const y = (data.y ?? 0) + this.registry.yOffset(data.asset);
      obj.position.set(data.x, y, data.z);
      obj.rotation.y = data.rotY ?? 0;
      obj.scale.setScalar(data.scale ?? 1);
      this.staticChanged();
      return;
    }
    // batched: update this instance's matrix in every part mesh
    const b = this.batches.get(rec.data.asset);
    if (!b || rec.batchIndex < 0) return;
    const m = this._composeMatrix(rec.data);
    b.meshes.forEach((im, pi) => {
      _tmpMatrix.copy(m).multiply(b.childLocals[pi]);
      im.setMatrixAt(rec.batchIndex, _tmpMatrix);
      im.instanceMatrix.needsUpdate = true;
    });
    this.staticChanged();
  }

  /** (Re)build the InstancedMesh batch for one asset type. */
  async rebuildBatch(assetId) {
    const old = this.batches.get(assetId);
    if (old) {
      for (const m of old.meshes) { this.scene.remove(m); m.dispose(); }
      this.batches.delete(assetId);
    }
    const recs = this.placed.filter(r => r.data.asset === assetId);
    this.staticChanged();
    if (!recs.length) return;

    const template = await this.registry.getTemplate(assetId);
    template.updateMatrixWorld(true);
    const parts = [];
    template.traverse(o => { if (o.isMesh) parts.push(o); });

    const meshes = [], childLocals = [];
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, recs.length);
      im.castShadow = part.castShadow;
      im.receiveShadow = true;
      // instances span the whole map; the template's bounds would mis-cull
      im.frustumCulled = false;
      im.userData.assetId = assetId;
      im.userData.batchRecs = recs;
      const local = part.matrixWorld.clone();
      for (let i = 0; i < recs.length; i++) {
        recs[i].batchIndex = i;
        _tmpMatrix.copy(this._composeMatrix(recs[i].data)).multiply(local);
        im.setMatrixAt(i, _tmpMatrix);
      }
      im.instanceMatrix.needsUpdate = true;
      this.scene.add(im);
      meshes.push(im);
      childLocals.push(local);
    }
    this.batches.set(assetId, { meshes, recs, childLocals });
  }

  refreshColliders() {
    this.colliders = [];
    for (const rec of this.placed) {
      if (rec.obj && !rec.obj.visible) continue; // despawned chests etc.
      const { data } = rec;
      const r = this.registry.colliderRadius(data.asset);
      if (r) this.colliders.push({ x: data.x, z: data.z, r: r * (data.scale ?? 1) });
    }
    this.staticChanged();
  }

  /** Scene objects for raycasting/selection (individuals + batches). */
  get pickables() {
    const out = [];
    for (const rec of this.placed) if (rec.obj) out.push(rec.obj);
    for (const b of this.batches.values()) out.push(...b.meshes);
    return out;
  }

  /** Find the placement record that owns a raycast hit.
   *  For batch hits, pass the intersection's instanceId. */
  recordFor(object3d, instanceId) {
    if (object3d.isInstancedMesh && object3d.userData.batchRecs) {
      return object3d.userData.batchRecs[instanceId ?? 0] ?? null;
    }
    let o = object3d;
    while (o && !o.userData.assetId) o = o.parent;
    return this.placed.find(rec => rec.obj === o) ?? null;
  }

  /** Current world state in town.json format — what the editor exports. */
  serialize() {
    return {
      ...this.data,
      placements: this.placed.map(rec => {
        const { asset, x, z, rotY, scale, y } = rec.data;
        const out = { asset, x: +x.toFixed(2), z: +z.toFixed(2), rotY: +(rotY ?? 0).toFixed(2) };
        if (scale && scale !== 1) out.scale = +scale.toFixed(2);
        if (y) out.y = +y.toFixed(2);
        return out;
      }),
    };
  }

  /** Hot-swap: re-instance every placement (and NPC) using this asset,
   *  after the registry's URL for it changed. Transforms are preserved
   *  because they live in the data records, not the meshes. */
  async reloadAsset(assetId) {
    if (this._isInstanced(assetId)) {
      await this.rebuildBatch(assetId); // template cache already cleared by setUrl
    } else {
      for (const rec of this.placed) {
        if (rec.data.asset !== assetId || !rec.obj) continue;
        const wasVisible = rec.obj.visible;
        this.scene.remove(rec.obj);
        rec.obj = await this.registry.instance(assetId);
        this.applyTransform(rec);
        rec.obj.visible = wasVisible;
        this.scene.add(rec.obj);
      }
    }
    this.staticChanged();
    for (const npc of this.npcs) {
      if (npc.assetId !== assetId) continue;
      const pos = npc.mesh.position.clone();
      const rot = npc.mesh.rotation.y;
      this.scene.remove(npc.mesh);
      npc.mesh = await this.registry.instance(assetId);
      npc.mesh.position.copy(pos);
      npc.mesh.rotation.y = rot;
      npc.animator = new CharacterAnimator(npc.mesh);
      this.scene.add(npc.mesh);
    }
  }

  // ---------- NPCs: deterministic "living town" ----------
  // Position is a pure function of wall-clock time, so every client —
  // and every client that joins later — sees NPCs in the same place
  // with zero network traffic. This is the pattern to extend for
  // shop hours, crops, day cycles, etc.
  async _buildNPCs() {
    for (const def of this.data.npcs ?? []) {
      const mesh = await this.registry.instance(def.asset);
      this.scene.add(mesh);

      const path = def.path.map(([x, z]) => new THREE.Vector2(x, z));
      const segLens = [];
      let totalLen = 0;
      for (let i = 0; i < path.length; i++) {
        const a = path[i], b = path[(i + 1) % path.length];
        const l = a.distanceTo(b);
        segLens.push(l);
        totalLen += l;
      }
      this.npcs.push({
        name: def.name,
        assetId: def.asset,
        mesh, path, segLens, totalLen,
        speed: def.speed,
        role: def.role ?? '',
        dialogue: def.dialogue ?? [],
        interactions: def.interactions ?? ['talk'],
        grantsRole: def.grantsRole ?? null,
        joinDialogue: def.joinDialogue ?? null,
        animator: new CharacterAnimator(mesh),
      });
    }
  }

  /** NPC meshes for raycasting. */
  get npcPickables() {
    return this.npcs.map(n => n.mesh);
  }

  /** Find the NPC that owns a raycast-hit mesh. */
  npcFor(object3d) {
    let o = object3d;
    while (o && !o.userData.assetId) o = o.parent;
    return this.npcs.find(n => n.mesh === o) ?? null;
  }

  updateNPCs(nowMs) {
    const t = nowMs / 1000;
    const dt = this._npcLastT === undefined ? 0.016 : Math.min((nowMs - this._npcLastT) / 1000, 0.1);
    this._npcLastT = nowMs;

    for (const npc of this.npcs) {
      let d = (t * npc.speed) % npc.totalLen;
      for (let i = 0; i < npc.path.length; i++) {
        const l = npc.segLens[i];
        if (d <= l) {
          const a = npc.path[i], b = npc.path[(i + 1) % npc.path.length];
          const f = l > 0 ? d / l : 0;
          const x = a.x + (b.x - a.x) * f;
          const z = a.y + (b.y - a.y) * f;
          npc.mesh.position.set(x, 0, z);
          if (l > 0) npc.mesh.rotation.y = Math.atan2(b.x - a.x, b.y - a.y);
          break;
        }
        d -= l;
      }
      // rigged models play their walk clip; placeholders keep the bob
      if (npc.animator?.active) {
        npc.animator.setMoving(true);
        npc.animator.update(dt);
      } else {
        npc.mesh.position.y = Math.abs(Math.sin(t * 7 + npc.totalLen)) * 0.04;
      }
    }
  }

  // ---------- collision ----------
  /** Redirect a movement step so it slides along blocking colliders instead
   *  of jamming into them: the inward radial component is removed, keeping
   *  the tangential part. Mutates `step`. Call before applying the step. */
  slideStep(pos, step, radius) {
    const nx0 = pos.x + step.x, nz0 = pos.z + step.z;
    for (const c of this.colliders) {
      const dx = nx0 - c.x, dz = nz0 - c.z;
      const min = c.r + radius;
      if (dx * dx + dz * dz < min * min) {
        const rx = pos.x - c.x, rz = pos.z - c.z;
        const rl = Math.hypot(rx, rz) || 1;
        const ux = rx / rl, uz = rz / rl;
        const dot = step.x * ux + step.z * uz;
        if (dot < 0) { // moving inward → keep only the tangential part
          step.x -= dot * ux;
          step.z -= dot * uz;
        }
      }
    }
    return step;
  }

  /** Push a proposed position out of any collider circle. */
  resolveCollision(pos, radius) {
    const b = this.bounds;
    pos.x = Math.max(b.minX + 1, Math.min(b.maxX - 1, pos.x));
    pos.z = Math.max(b.minZ + 1, Math.min(b.maxZ - 1, pos.z));

    // can't walk into the sea (boundary follows the jagged coastline)
    if (this.water) {
      const alongCoord = (this.water.side === 'east' || this.water.side === 'west') ? pos.z : pos.x;
      const edge = this.water.shore + this._coastJag(alongCoord) - radius - 0.2;
      switch (this.water.side) {
        case 'east':  pos.x = Math.min(pos.x, edge); break;
        case 'west':  pos.x = Math.max(pos.x, -edge); break;
        case 'north': pos.z = Math.max(pos.z, -edge); break;
        case 'south': pos.z = Math.min(pos.z, edge); break;
      }
    }

    for (const c of this.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const min = c.r + radius;
      const distSq = dx * dx + dz * dz;
      if (distSq < min * min && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        pos.x = c.x + (dx / dist) * min;
        pos.z = c.z + (dz / dist) * min;
      }
    }
    return pos;
  }
}
