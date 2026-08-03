// ============================================================
// NavGrid.js — pathfinding around obstacles.
//
// Steering straight at a target and sliding along whatever you hit
// works for a glancing corner and fails badly on anything concave:
// walls, fenced yards, the inside of a building cluster. The walker
// slides to a dead end, stops making progress, and gives up.
//
// So: a coarse occupancy grid over the world, rebuilt whenever the
// static scene changes, and A* across it on each click. Obstacles
// are inflated by the walker's radius so a path never hugs a wall
// too closely to actually walk, and the raw grid path is then
// smoothed by line-of-sight so the result reads as a natural
// diagonal rather than a staircase.
//
// Cost is trivial: one search per click over a few thousand cells.
// ============================================================


/** Minimal binary min-heap keyed by score — A*'s open set. */
class MinHeap {
  constructor() { this.items = []; this.score = []; }
  get size() { return this.items.length; }
  push(item, score) {
    this.items.push(item); this.score.push(score);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score[p] <= this.score[i]) break;
      this._swap(i, p); i = p;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop(), lastS = this.score.pop();
    if (this.items.length) {
      this.items[0] = last; this.score[0] = lastS;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.items.length && this.score[l] < this.score[m]) m = l;
        if (r < this.items.length && this.score[r] < this.score[m]) m = r;
        if (m === i) break;
        this._swap(i, m); i = m;
      }
    }
    return top;
  }
  _swap(a, b) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.score[a], this.score[b]] = [this.score[b], this.score[a]];
  }
}

export class NavGrid {
  constructor(world, { cell = 0.8, radius = 0.42 } = {}) {
    this.world = world;
    this.cell = cell;
    this.radius = radius;   // walker radius — obstacles inflate by this
    this.dirty = true;
    this.build();
  }

  build() {
    const b = this.world.bounds;
    const margin = 0.5;
    this.minX = b.minX + margin;
    this.minZ = b.minZ + margin;
    this.cols = Math.max(1, Math.ceil((b.maxX - margin - this.minX) / this.cell));
    this.rows = Math.max(1, Math.ceil((b.maxZ - margin - this.minZ) / this.cell));
    this.blocked = new Uint8Array(this.cols * this.rows);

    // stamp every collider, grown by the walker's radius so the path
    // keeps enough clearance to actually be walkable
    for (const c of this.world.colliders) {
      const r = c.r + this.radius;
      const c0 = Math.max(0, Math.floor((c.x - r - this.minX) / this.cell));
      const c1 = Math.min(this.cols - 1, Math.ceil((c.x + r - this.minX) / this.cell));
      const r0 = Math.max(0, Math.floor((c.z - r - this.minZ) / this.cell));
      const r1 = Math.min(this.rows - 1, Math.ceil((c.z + r - this.minZ) / this.cell));
      const r2 = r * r;
      for (let gz = r0; gz <= r1; gz++) {
        for (let gx = c0; gx <= c1; gx++) {
          const wx = this.minX + (gx + 0.5) * this.cell;
          const wz = this.minZ + (gz + 0.5) * this.cell;
          const dx = wx - c.x, dz = wz - c.z;
          if (dx * dx + dz * dz <= r2) this.blocked[gz * this.cols + gx] = 1;
        }
      }
    }
    this.dirty = false;
  }

  /** Cheap: only rebuilds when the static world actually changed. */
  refreshIfDirty() {
    if (this.dirty) this.build();
  }
  markDirty() { this.dirty = true; }

  _cellOf(x, z) {
    return {
      gx: Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell))),
      gz: Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell))),
    };
  }
  _world(gx, gz) {
    return { x: this.minX + (gx + 0.5) * this.cell, z: this.minZ + (gz + 0.5) * this.cell };
  }
  _isBlocked(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= this.cols || gz >= this.rows) return true;
    return this.blocked[gz * this.cols + gx] === 1;
  }

  /** Nearest walkable cell, spiralling out — used when a tap lands
   *  inside a building or the walker is somehow standing in one. */
  _nearestFree(gx, gz, maxR = 14) {
    if (!this._isBlocked(gx, gz)) return { gx, gz };
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = gx + dx, nz = gz + dz;
          if (!this._isBlocked(nx, nz)) return { gx: nx, gz: nz };
        }
      }
    }
    return null;
  }

  /** Straight-line walkability between two world points. */
  lineOfSight(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const steps = Math.ceil(Math.hypot(dx, dz) / (this.cell * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const { gx, gz } = this._cellOf(ax + dx * t, az + dz * t);
      if (this._isBlocked(gx, gz)) return false;
    }
    return true;
  }

  /**
   * A* from one world point to another.
   * Returns an array of waypoints (excluding the start), or null if
   * there's genuinely no route.
   */
  findPath(from, to) {
    this.refreshIfDirty();

    const s = this._cellOf(from.x, from.z);
    let g = this._cellOf(to.x, to.z);

    // if the walker is inside geometry, get them out first
    const sFree = this._nearestFree(s.gx, s.gz);
    if (!sFree) return null;
    // if the tap landed in a wall, aim for the closest open ground
    const gFree = this._nearestFree(g.gx, g.gz);
    if (!gFree) return null;
    g = gFree;

    // already clear? skip the search entirely
    const goalW = this._world(g.gx, g.gz);
    if (this.lineOfSight(from.x, from.z, to.x, to.z)) return [{ x: to.x, z: to.z }];

    const start = sFree.gz * this.cols + sFree.gx;
    const goal = g.gz * this.cols + g.gx;
    const N = this.cols * this.rows;

    const gScore = new Float32Array(N).fill(Infinity);
    const cameFrom = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open = new MinHeap();
    gScore[start] = 0;

    const h = (i) => {
      const ax = i % this.cols, az = (i / this.cols) | 0;
      const bx = goal % this.cols, bz = (goal / this.cols) | 0;
      const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
      // octile distance, weighted slightly. A pure heuristic explores a
      // huge frontier on long routes; 1.2x makes the search far tighter
      // for paths a player cannot tell apart from optimal.
      return ((dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz)) * 1.2;
    };
    open.push(start, h(start));

    const NEIGH = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
      [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
    ];

    let guard = 0;
    while (open.size && guard++ < 200000) {
      const cur = open.pop();
      if (cur === goal) return this._reconstruct(cameFrom, cur, from, to);
      if (closed[cur]) continue;
      closed[cur] = 1;

      const cx = cur % this.cols, cz = (cur / this.cols) | 0;
      for (const [dx, dz, cost] of NEIGH) {
        const nx = cx + dx, nz = cz + dz;
        if (this._isBlocked(nx, nz)) continue;
        // don't cut corners diagonally through two blocked cells
        if (dx && dz && (this._isBlocked(cx + dx, cz) || this._isBlocked(cx, cz + dz))) continue;
        const ni = nz * this.cols + nx;
        if (closed[ni]) continue;
        const tentative = gScore[cur] + cost;
        if (tentative < gScore[ni]) {
          cameFrom[ni] = cur;
          gScore[ni] = tentative;
          open.push(ni, tentative + h(ni));
        }
      }
    }
    return null;   // no route
  }

  /** Grid path → smoothed world waypoints. */
  _reconstruct(cameFrom, cur, from, to) {
    const cells = [];
    while (cur !== -1) { cells.push(cur); cur = cameFrom[cur]; }
    cells.reverse();

    const pts = cells.map(i => this._world(i % this.cols, (i / this.cols) | 0));
    // the real destination, if it's reachable from the last cell
    const last = pts[pts.length - 1];
    if (this.lineOfSight(last.x, last.z, to.x, to.z)) pts.push({ x: to.x, z: to.z });

    // string-pulling: drop any waypoint we can see past, so the walk
    // reads as long diagonals instead of a staircase
    const out = [];
    let anchor = { x: from.x, z: from.z };
    let i = 0;
    while (i < pts.length) {
      let furthest = i;
      for (let j = pts.length - 1; j > i; j--) {
        if (this.lineOfSight(anchor.x, anchor.z, pts[j].x, pts[j].z)) { furthest = j; break; }
      }
      out.push(pts[furthest]);
      anchor = pts[furthest];
      if (furthest === pts.length - 1) break;
      i = furthest + 1;
    }
    return out;
  }
}
