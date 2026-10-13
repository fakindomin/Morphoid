/**
 * Joints between a separately printed part and the piece it mounts on (its host: the body, or the head when the
 * head is printed separately). Everything happens in the SDF domain, before meshing:
 *  - the part loses the volume it shares with the host (it seats flush on the host's surface),
 *  - every contact patch gets a square peg on the part (rounded edges = chamfer for an easy start),
 *  - the host gets a matching socket, larger by the clearance on every side and a bit deeper.
 * Grids are phase-aligned (origins are multiples of h), so sampling one grid at another grid's node is exact.
 */
import type { Grid3 } from './surfacenets';
import { BIG } from './field';

/** Gap between peg and socket on every side (mm). 0.2 mm slides in by hand on a P1S with a 0.4 mm nozzle. */
export const CLEARANCE_MM = 0.2;
/** Socket is deeper than the peg so the part closes flush even with a stringy socket floor (mm). */
export const SOCKET_EXTRA_MM = 0.4;
/** Material that must remain around the socket inside the host (mm). */
export const WALL_MM = 0.8;
/** How far the peg reaches back into the part, so peg and part fuse (mm). */
const ROOT_MM = 1.5;
/** The first mm of the socket below the host surface may break through a curved surface. */
const MOUTH_MM = 2;
/** How far from the contact centre a peg may move to find enough material (mm). */
const SEARCH_MM = 5;
/** Depth of a tab inside the host (mm). */
const TAB_MM = 3;

/** Contact patches smaller than this (mm^3 of shared volume) are grazes, not joints. */
const MIN_CONTACT_MM3 = 1;
/** a cut may chip off a sliver up to this size (it is dropped); anything bigger means the cut is refused */
const CHIP_MM3 = 30;
/** A part closer to the host than this counts as touching it (the whole-model fusion bridges such gaps too). */
const NEAR_MM = 1.2;

export interface PegSize { id: '5x5x8' | '3x3x5' | '2x2x4'; side: number; length: number }
/** Biggest first; the 2 mm pin is for thin parts (ears, whiskers) that cannot root a 3 mm peg. */
export const PEG_SIZES: readonly PegSize[] = [
  { id: '5x5x8', side: 5, length: 8 },
  { id: '3x3x5', side: 3, length: 5 },
  { id: '2x2x4', side: 2, length: 4 },
];

export interface Joint {
  /** where the peg leaves the part (on the host surface), model mm */
  at: [number, number, number];
  /** direction from the host into the part */
  axis: [number, number, number];
  /**
   * a peg size; 'tab' = the part is too thin for a peg, so the piece of it that was inside the host stays on as a tab
   * and the host gets a matching slot; null = only touches the host (glue)
   */
  peg: PegSize['id'] | 'tab' | null;
  /** the peg stands on the host and the socket is in the part (upright parts mounted from above) */
  onHost?: boolean;
  /** index into the hosts the part was joined against */
  host: number;
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

/** Trilinear sample of a grid at a world point; BIG outside. */
export function sample(g: Grid3, x: number, y: number, z: number): number {
  const fx = (x - g.ox) / g.h, fy = (y - g.oy) / g.h, fz = (z - g.oz) / g.h;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  if (i < 0 || j < 0 || k < 0 || i >= g.nx - 1 || j >= g.ny - 1 || k >= g.nz - 1) return BIG;
  const tx = fx - i, ty = fy - j, tz = fz - k;
  const at = (a: number, b: number, c: number): number => g.data[((k + c) * g.ny + j + b) * g.nx + i + a]!;
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(at(0, 0, 0), at(1, 0, 0), tx), l(at(0, 1, 0), at(1, 1, 0), tx), ty),
    l(l(at(0, 0, 1), at(1, 0, 1), tx), l(at(0, 1, 1), at(1, 1, 1), tx), ty), tz);
}

/** Value of grid `g` at node (i, j, k) of grid `of` (same h and phase, so this is an exact lookup); BIG outside `g`. */
function nodeAt(g: Grid3, of: Grid3, i: number, j: number, k: number): number {
  const a = i + Math.round((of.ox - g.ox) / g.h), b = j + Math.round((of.oy - g.oy) / g.h), c = k + Math.round((of.oz - g.oz) / g.h);
  if (a < 0 || b < 0 || c < 0 || a >= g.nx || b >= g.ny || c >= g.nz) return BIG;
  return g.data[(c * g.ny + b) * g.nx + a]!;
}

/** Frame of a joint: axis n plus two sides; one side is kept parallel to the XY plane so flat parts print square. */
function frame(n: V3): { u: V3; v: V3 } {
  const ref: V3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(ref, n));
  return { u, v: cross(n, u) };
}

/** Signed distance to a box in the joint frame: t along the axis in [t0, t1], half side `half`, edges rounded by r. */
function boxSd(p: V3, at: V3, n: V3, u: V3, v: V3, t0: number, t1: number, half: number, r: number): number {
  const d: V3 = [p[0] - at[0], p[1] - at[1], p[2] - at[2]];
  const qa = Math.abs(dot(d, u)) - half + r, qb = Math.abs(dot(d, v)) - half + r;
  const tc = (t0 + t1) / 2, qc = Math.abs(dot(d, n) - tc) - (t1 - t0) / 2 + r;
  const ox = Math.max(qa, 0), oy = Math.max(qb, 0), oz = Math.max(qc, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(qa, qb, qc), 0) - r;
}

/**
 * Add (union) or cut (subtract) a box given in a joint frame: axis n from t0 to t1, half side `half`, edges rounded by r.
 * Only the nodes in the box's own bounding box (plus a small border) are visited.
 */
function stampBox(g: Grid3, s: V3, n: V3, u: V3, v: V3, t0: number, t1: number, half: number, r: number, mode: 'add' | 'cut'): void {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of [t0, t1]) for (const a of [-half, half]) for (const b of [-half, half]) {
    const q = add(add(add(s, n, t), u, a), v, b);
    for (let x = 0; x < 3; x++) { lo[x] = Math.min(lo[x]!, q[x]!); hi[x] = Math.max(hi[x]!, q[x]!); }
  }
  const pad = 2 * g.h;
  const i0 = Math.max(0, Math.floor((lo[0] - pad - g.ox) / g.h)), i1 = Math.min(g.nx - 1, Math.ceil((hi[0] + pad - g.ox) / g.h));
  const j0 = Math.max(0, Math.floor((lo[1] - pad - g.oy) / g.h)), j1 = Math.min(g.ny - 1, Math.ceil((hi[1] + pad - g.oy) / g.h));
  const k0 = Math.max(0, Math.floor((lo[2] - pad - g.oz) / g.h)), k1 = Math.min(g.nz - 1, Math.ceil((hi[2] + pad - g.oz) / g.h));
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const idx = (k * g.ny + j) * g.nx + i;
    const d = boxSd([g.ox + i * g.h, g.oy + j * g.h, g.oz + k * g.h], s, n, u, v, t0, t1, half, r);
    if (mode === 'add') { if (d < g.data[idx]!) g.data[idx] = d; } else if (-d > g.data[idx]!) g.data[idx] = -d;
  }
}

interface Patch { c: V3; n: V3; nodes: number[]; overlap: boolean; /** counts as touching below this host distance */ near: number; /** index of the host */ host: number }

/** A body of the part farther than this from its host is not joined (mm); closer ones get a tab that bridges the gap. */
const MAX_GAP_MM = 3;

const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

/** Flood fill from `seed` over nodes accepted by `ok`, marking them with `mark` in `tag`. */
function flood(g: Grid3, seed: number, tag: Int32Array, mark: number, ok: (idx: number) => boolean): number[] {
  const { nx, ny, nz } = g;
  const out: number[] = [];
  const stack = [seed];
  tag[seed] = mark;
  while (stack.length) {
    const idx = stack.pop()!;
    out.push(idx);
    const i = idx % nx, j = Math.floor(idx / nx) % ny, k = Math.floor(idx / (nx * ny));
    for (const [di, dj, dk] of NB) {
      const a = i + di, b = j + dj, c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
      const m = (c * ny + b) * nx + a;
      if (tag[m] !== mark && ok(m)) { tag[m] = mark; stack.push(m); }
    }
  }
  return out;
}

/**
 * Contact patches: connected groups of part nodes that are inside the host or within NEAR_MM of it. A body of the part
 * that has no such patch (a thin wing passing just above the back) gets one at its closest approach to the host.
 */
function contacts(part: Grid3, hosts: Grid3[]): Patch[] {
  const { nx, ny, nz, h, data } = part;
  const n = nx * ny * nz;
  const hvs = hosts.map((host) => {
    const hv = new Float32Array(n).fill(BIG);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const idx = (k * ny + j) * nx + i;
      if (data[idx]! < 0) hv[idx] = nodeAt(host, part, i, j, k);
    }
    return hv;
  });
  const body = new Int32Array(n).fill(-1);
  const patchTags = hosts.map(() => new Int32Array(n).fill(-1));
  const out: Patch[] = [];
  const minNodes = MIN_CONTACT_MM3 / h ** 3;
  let bodyId = 0, patchId = 0;
  const makePatch = (nodes: number[], near: number, host: number): void => {
    if (nodes.length < minNodes) return;
    const hv = hvs[host]!;
    // centre: of the shared volume when there is one (that is where a peg has the most host around it)
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    const overlap = nodes.some((idx) => hv[idx]! < 0);
    for (const idx of nodes) {
      if (overlap && hv[idx]! >= 0) continue;
      sx += idx % nx; sy += Math.floor(idx / nx) % ny; sz += Math.floor(idx / (nx * ny)); cnt++;
    }
    const c: V3 = [part.ox + (sx / cnt) * h, part.oy + (sy / cnt) * h, part.oz + (sz / cnt) * h];
    // axis: from the patch towards the part material that is clear of the host nearby
    const R = 12, r2 = R * R, rn = Math.ceil(R / h);
    const ci = Math.round(sx / cnt), cj = Math.round(sy / cnt), ck = Math.round(sz / cnt);
    let ax = 0, ay = 0, az = 0, m = 0;
    for (let k = Math.max(0, ck - rn); k <= Math.min(nz - 1, ck + rn); k++) for (let j = Math.max(0, cj - rn); j <= Math.min(ny - 1, cj + rn); j++) for (let i = Math.max(0, ci - rn); i <= Math.min(nx - 1, ci + rn); i++) {
      const idx = (k * ny + j) * nx + i;
      if (hv[idx]! < near || hv[idx]! >= BIG) continue;
      const dx = part.ox + i * h - c[0], dy = part.oy + j * h - c[1], dz = part.oz + k * h - c[2];
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      ax += dx; ay += dy; az += dz; m++;
    }
    if (m) out.push({ c, n: norm([ax, ay, az]), nodes, overlap, near, host });
  };
  for (let s = 0; s < n; s++) {
    if (data[s]! >= 0 || body[s]! >= 0) continue;
    const nodes = flood(part, s, body, bodyId++, (m) => data[m]! < 0);
    const before = out.length;
    let minHv = BIG, minAt = -1, minHost = 0;
    hosts.forEach((_, hi) => {
      const hv = hvs[hi]!, tag = patchTags[hi]!;
      for (const idx of nodes) if (hv[idx]! < minHv) { minHv = hv[idx]!; minAt = idx; minHost = hi; }
      for (const idx of nodes) {
        if (hv[idx]! >= NEAR_MM || tag[idx]! >= 0) continue;
        makePatch(flood(part, idx, tag, patchId++, (m) => data[m]! < 0 && hv[m]! < NEAR_MM), NEAR_MM, hi);
      }
    });
    if (out.length === before && minAt >= 0 && minHv < MAX_GAP_MM) {
      // not touching anything: join at the closest approach to the nearest host
      const hv = hvs[minHost]!, near = minHv + NEAR_MM;
      const nodes2 = flood(part, minAt, patchTags[minHost]!, patchId++, (m) => data[m]! < 0 && hv[m]! < near);
      makePatch(nodes2.length >= minNodes ? nodes2 : nodes2.concat(Array(Math.ceil(minNodes - nodes2.length)).fill(minAt)), near, minHost);
    }
  }
  return out;
}

/** Number of separate solid bodies in a grid (6-connected nodes inside). */
function bodies(g: Grid3): number {
  const { nx, ny, nz, data } = g;
  const seen = new Uint8Array(nx * ny * nz);
  const stack: number[] = [];
  let count = 0;
  for (let s = 0; s < seen.length; s++) {
    if (seen[s] || data[s]! >= 0) continue;
    count++; seen[s] = 1; stack.push(s);
    while (stack.length) {
      const idx = stack.pop()!;
      const i = idx % nx, j = Math.floor(idx / nx) % ny, k = Math.floor(idx / (nx * ny));
      for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const a = i + di, b = j + dj, c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        const m = (c * ny + b) * nx + a;
        if (!seen[m] && data[m]! < 0) { seen[m] = 1; stack.push(m); }
      }
    }
  }
  return count;
}

/**
 * A cut left the part in more than `count` bodies: if the extra ones are only slivers (under CHIP_MM3: a horn tip that
 * grazed the head and came out again), drop them. True when the part is back to `count` bodies; fewer means two of its
 * pieces were joined (the tab of one leg running into the peg of the next), which is no good either.
 */
function dropFragments(g: Grid3, count: number): boolean {
  const { data, h } = g;
  const comps = components(g);
  if (comps.length < count) return false;
  if (comps.length === count) return true;
  comps.sort((a, b) => b.length - a.length);
  const extra = comps.slice(count);
  // only slivers next to a real piece: a small leg next to its twin is not one
  if (extra.some((c) => !isSliver(g, c, comps[0]!))) return false;
  for (const c of extra) for (const idx of c) data[idx] = h;
  return true;
}

const isSliver = (g: Grid3, c: number[], biggest: number[]): boolean => c.length <= CHIP_MM3 / g.h ** 3 && c.length <= 0.1 * biggest.length;

/** Drop the specks a part may start with (a wing tip a hair away from its wing); returns how many bodies remain. */
function dropSpecks(g: Grid3): number {
  const comps = components(g).sort((a, b) => b.length - a.length);
  let n = 0;
  for (const c of comps) if (n && isSliver(g, c, comps[0]!)) for (const idx of c) g.data[idx] = g.h; else n++;
  return n;
}

/** Inside nodes of the grid, by 6-connected body. */
function components(g: Grid3): number[][] {
  const { nx, ny, nz, data } = g;
  const seen = new Uint8Array(nx * ny * nz);
  const comps: number[][] = [];
  for (let s = 0; s < seen.length; s++) {
    if (seen[s] || data[s]! >= 0) continue;
    const comp = [s], stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      const i = idx % nx, j = Math.floor(idx / nx) % ny, k = Math.floor(idx / (nx * ny));
      for (const [di, dj, dk] of NB) {
        const a = i + di, b = j + dj, c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        const m = (c * ny + b) * nx + a;
        if (!seen[m] && data[m]! < 0) { seen[m] = 1; stack.push(m); comp.push(m); }
      }
    }
    comps.push(comp);
  }
  return comps;
}

export interface HostSockets {
  /** edits of the host, applied in order; each returns the (possibly enlarged) grid */
  carve: ((g: Grid3) => Grid3)[];
  /** the sockets and slots alone (they only remove material): re-applied if a later repair fills them */
  holes: ((g: Grid3) => void)[];
  /** sockets already planned in this host: a new one keeps WALL_MM away from all of them */
  placed: { s: V3; n: V3; half: number; depth: number }[];
}
export const newHostSockets = (): HostSockets => ({ carve: [], holes: [], placed: [] });

/** Smallest distance between two segments a + na * [-la, 0] and b + nb * [-lb, 0] (sampled). */
function segGap(a: V3, na: V3, la: number, b: V3, nb: V3, lb: number): number {
  let best = Infinity;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const p = add(a, na, -la * i / 8), q = add(b, nb, -lb * j / 8);
    best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
  return best;
}

/**
 * A peg plan. The peg sits on the "male" side and points along `dir` into the "female" side, which gets the socket.
 * Normally the part is male (peg into the host). An upright part whose peg would point down (a head or a leg standing
 * on its flat cut) is female instead: the host carries the peg, so both pieces still print without supports.
 */
interface PegPlan { patch: Patch; s: V3; axis: V3; u: V3; v: V3; peg: PegSize; gap: number; partIsMale: boolean }

/** The biggest peg that fits this patch, at its centre or as close to it as possible. */
function planPeg(part: Grid3, host: Grid3, patch: Patch, placed: HostSockets['placed'], upright: boolean, others: Grid3[]): PegPlan | null {
  const { c } = patch;
  const h = part.h;
  // axes to try: the contact's own axis, then the vertical (pegs print best standing), then halfway between
  const axes: V3[] = [patch.n];
  if (Math.abs(patch.n[1]) > 0.3) {
    const vert: V3 = [0, Math.sign(patch.n[1]), 0];
    axes.push(vert, norm(add(patch.n, vert)));
  }
  const offsets: [number, number][] = [];
  for (let a = -SEARCH_MM; a <= SEARCH_MM; a += 1) for (let b = -SEARCH_MM; b <= SEARCH_MM; b += 1) offsets.push([a, b]);
  offsets.sort((x, y) => x[0] ** 2 + x[1] ** 2 - y[0] ** 2 - y[1] ** 2);
  for (const p of PEG_SIZES) for (const n of axes) {
    const { u, v } = frame(n);
    const partIsMale = !(upright && n[1] > 0.3); // part above the host: the peg stands on the host
    const male = partIsMale ? part : host, female = partIsMale ? host : part;
    const dir: V3 = partIsMale ? [-n[0], -n[1], -n[2]] : n;
    for (const [a, b] of offsets) {
      const c0 = add(add(c, u, a), v, b);
      // where the axis leaves the host: the shoulder; then the gap (if any) to the part
      let s: V3 = c0;
      for (let t = 0; t < 30 && sample(host, s[0], s[1], s[2]) < 0; t += h / 2) s = add(c0, n, t);
      let gap = 0;
      while (gap < patch.near + h && sample(part, ...add(s, n, gap) as V3) >= 0) gap += h / 2;
      // the female mouth starts at its own surface
      const mouth = partIsMale ? s : add(s, n, gap);
      const root = partIsMale ? add(s, n, gap) : s;
      const half = p.side / 2 + CLEARANCE_MM, depth = p.length + SOCKET_EXTRA_MM;
      let ok = true;
      // socket walls and floor keep WALL_MM of material (the first mm may follow a curved surface)
      for (let t = MOUTH_MM; ok && t <= depth; t += Math.min(1, h)) for (const x of [-half, 0, half]) for (const y of [-half, 0, half]) {
        const q = add(add(add(mouth, dir, t), u, x), v, y);
        if (sample(female, q[0], q[1], q[2]) > -WALL_MM) { ok = false; break; }
      }
      if (!ok) continue;
      if (!partIsMale) ok = true; // part sockets are private to the part
      else for (const o of placed) if (segGap(s, n, depth, o.s, o.n, o.depth) < (half + o.half) * Math.SQRT2 + WALL_MM) { ok = false; break; }
      if (!ok) continue;
      // the peg roots in the male side over its whole section
      const hp = p.side / 2;
      for (const x of [-hp, 0, hp]) for (const y of [-hp, 0, hp]) {
        const q = add(add(add(root, dir, -ROOT_MM), u, x), v, y);
        if (sample(male, q[0], q[1], q[2]) >= 0) { ok = false; break; }
      }
      // the peg must stay clear of every other piece (a peg on a crest must not run through the separate head)
      for (let t = -p.length; ok && t <= gap + ROOT_MM; t += Math.min(1, h)) for (const x of [-hp, 0, hp]) for (const y of [-hp, 0, hp]) {
        const q = add(add(add(s, n, t), u, x), v, y);
        if (others.some((o) => sample(o, q[0], q[1], q[2]) < WALL_MM)) { ok = false; break; }
      }
      // the socket must not open a tunnel through the host (a thin belly, a curved rim): try the next spot instead
      if (ok && partIsMale) {
        const [lo, hi] = boxBounds(s, n, u, v, -depth, 2, half, 2 * h);
        ok = cutWithoutTunnel(host, lo, hi, (g) => stampBox(g, s, n, u, v, -depth, 2, half, 0, 'cut'), true);
      }
      if (ok) return { patch, s, axis: n, u, v, peg: p, gap, partIsMale };
    }
  }
  return null;
}

/**
 * Euler characteristics of the inside nodes and of the outside nodes (each as a cubical complex: a cell belongs when all
 * its corners do) restricted to the node box [i0..i1] x [j0..j1] x [k0..k1], as [inside, outside].
 */
export function euler(g: Grid3, i0: number, i1: number, j0: number, j1: number, k0: number, k1: number): [number, number] {
  const { nx, ny, data } = g;
  const W = i1 - i0 + 1, H = j1 - j0 + 1, D = k1 - k0 + 1;
  const m = new Uint8Array(W * H * D);
  for (let k = 0; k < D; k++) for (let j = 0; j < H; j++) {
    const row = ((k + k0) * ny + j + j0) * nx + i0, at = (k * H + j) * W;
    for (let i = 0; i < W; i++) m[at + i] = data[row + i]! < 0 ? 1 : 0;
  }
  const sy = W, sz = W * H;
  let cin = 0, cout = 0;
  for (let k = 0; k < D; k++) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const idx = k * sz + j * sy + i;
    const a = m[idx]!, X = i < W - 1, Y = j < H - 1, Z = k < D - 1;
    // per cell: 1 when all corners inside, -1 when all outside (|c| marks the cell, the sign which side)
    const side = (b: number, c: number): number => (b === c ? (b ? 1 : -1) : 0);
    const x = X ? side(a, m[idx + 1]!) : 0, y = Y ? side(a, m[idx + sy]!) : 0, z = Z ? side(a, m[idx + sz]!) : 0;
    const xy = x && y && m[idx + 1 + sy] === a ? x : 0, xz = x && z && m[idx + 1 + sz] === a ? x : 0, yz = y && z && m[idx + sy + sz] === a ? y : 0;
    const xyz = xy && xz && yz && m[idx + 1 + sy + sz] === a ? xy : 0;
    const sum = 1 - (+(x !== 0) + +(y !== 0) + +(z !== 0)) + (+(xy !== 0) + +(xz !== 0) + +(yz !== 0)) - +(xyz !== 0);
    if (a) cin += sum; else cout += sum;
  }
  return [cin, cout];
}

/** World bounds of the box s + n * [t0, t1] + u, v * [-half, half] (what `stampBox` touches), plus `pad`. */
function boxBounds(s: V3, n: V3, u: V3, v: V3, t0: number, t1: number, half: number, pad: number): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const t of [t0, t1]) for (const a of [-half, half]) for (const b of [-half, half]) {
    const q = add(add(add(s, n, t), u, a), v, b);
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, q[i]! - pad); hi[i] = Math.max(hi[i]!, q[i]! + pad); }
  }
  return [lo, hi];
}

/** Node box around the world box [lo, hi] (plus one node), clamped to the grid; null when they do not meet. */
function nodeBox(g: Grid3, lo: V3, hi: V3): [number, number, number, number, number, number] | null {
  const { h } = g;
  const i0 = Math.max(0, Math.floor((lo[0] - g.ox) / h) - 1), i1 = Math.min(g.nx - 1, Math.ceil((hi[0] - g.ox) / h) + 1);
  const j0 = Math.max(0, Math.floor((lo[1] - g.oy) / h) - 1), j1 = Math.min(g.ny - 1, Math.ceil((hi[1] - g.oy) / h) + 1);
  const k0 = Math.max(0, Math.floor((lo[2] - g.oz) / h) - 1), k1 = Math.min(g.nz - 1, Math.ceil((hi[2] - g.oz) / h) + 1);
  return i0 > i1 || j0 > j1 || k0 > k1 ? null : [i0, i1, j0, j1, k0, k1];
}

/**
 * Small bits a cut has chipped off (a sliver of head between an ear's slot and the surface): inside components of the
 * node box that do not reach its faces (so they are not attached outside it) and are under CHIP_MM3. They are removed.
 */
function dropChips(g: Grid3, [i0, i1, j0, j1, k0, k1]: [number, number, number, number, number, number]): void {
  const { nx, ny, data, h } = g;
  const maxNodes = CHIP_MM3 / h ** 3;
  const seen = new Uint8Array((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1));
  const at = (i: number, j: number, k: number): number => ((k - k0) * (j1 - j0 + 1) + (j - j0)) * (i1 - i0 + 1) + (i - i0);
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (seen[at(i, j, k)] || data[(k * ny + j) * nx + i]! >= 0) continue;
    const comp: number[] = [], stack: [number, number, number][] = [[i, j, k]];
    seen[at(i, j, k)] = 1;
    let open = false;
    while (stack.length) {
      const [a, b, c] = stack.pop()!;
      comp.push((c * ny + b) * nx + a);
      if (a === i0 || a === i1 || b === j0 || b === j1 || c === k0 || c === k1) open = true;
      for (const [di, dj, dk] of NB) {
        const x = a + di, y = b + dj, z = c + dk;
        if (x < i0 || y < j0 || z < k0 || x > i1 || y > j1 || z > k1 || seen[at(x, y, z)] || data[(z * ny + y) * nx + x]! >= 0) continue;
        seen[at(x, y, z)] = 1;
        stack.push([x, y, z]);
      }
    }
    if (!open && comp.length <= maxNodes) for (const idx of comp) data[idx] = h;
  }
}

/** The cut, and the bits it chips off (for re-applying a cut that already passed `cutWithoutTunnel`). */
function cutClean(g: Grid3, lo: V3, hi: V3, cut: (g: Grid3) => void): void {
  cut(g);
  const box = nodeBox(g, lo, hi);
  if (box) dropChips(g, box);
}

/**
 * Remove material with `cut` inside the world box [lo, hi], unless that changes the piece's topology (opens a tunnel,
 * leaves a void, chips off more than a sliver): then the grid is left untouched and false is returned.
 * With `trial` the grid is always restored (a plan checks whether its socket would be accepted).
 */
function cutWithoutTunnel(g: Grid3, lo: V3, hi: V3, cut: (g: Grid3) => void, trial = false): boolean {
  const box = nodeBox(g, lo, hi);
  if (!box) { if (!trial) cut(g); return true; }
  const [i0, i1, j0, j1, k0, k1] = box;
  const w = i1 - i0 + 1, hh = j1 - j0 + 1;
  const keep = new Float32Array(w * hh * (k1 - k0 + 1));
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
    const row = (k * g.ny + j) * g.nx;
    keep.set(g.data.subarray(row + i0, row + i1 + 1), ((k - k0) * hh + j - j0) * w);
  }
  const restore = (): void => {
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
      const row = (k * g.ny + j) * g.nx;
      g.data.set(keep.subarray(((k - k0) * hh + j - j0) * w, ((k - k0) * hh + j - j0 + 1) * w), row + i0);
    }
  };
  // both the solid and the air around it: where a wall gets down to a voxel, the two can disagree, and the mesh may
  // go either way
  const chi = (): number => { const [a, b] = euler(g, i0, i1, j0, j1, k0, k1); return a * 100000 + b; };
  const before = chi();
  cut(g);
  // a socket or slot dug in from the surface leaves the topology as it was; anything else (a tunnel, a chipped-off
  // bit, a hidden void) shows up as a change of the Euler characteristic. Slivers chipped off are simply dropped.
  let ok = chi() === before;
  if (!ok) { dropChips(g, box); ok = chi() === before; }
  if (!ok || trial) restore();
  return ok;
}

/** The part gives up whatever it has inside the host in the world box (a tab or peg that could not be seated). */
function retreat(part: Grid3, host: Grid3, lo: V3, hi: V3): void {
  const { h } = part;
  const i0 = Math.max(0, Math.floor((lo[0] - part.ox) / h)), i1 = Math.min(part.nx - 1, Math.ceil((hi[0] - part.ox) / h));
  const j0 = Math.max(0, Math.floor((lo[1] - part.oy) / h)), j1 = Math.min(part.ny - 1, Math.ceil((hi[1] - part.oy) / h));
  const k0 = Math.max(0, Math.floor((lo[2] - part.oz) / h)), k1 = Math.min(part.nz - 1, Math.ceil((hi[2] - part.oz) / h));
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const idx = (k * part.ny + j) * part.nx + i;
    if (part.data[idx]! >= 0) continue;
    const hv = nodeAt(host, part, i, j, k);
    if (-hv > part.data[idx]!) part.data[idx] = -hv;
  }
}

/** Enlarge a grid in place (same object, so every holder sees the new extent). */
function growInPlace(g: Grid3, lo: V3, hi: V3): void {
  const n = grow(g, lo, hi);
  if (n !== g) Object.assign(g, n);
}

/** Room a separate part's grid needs around it for its tabs (pegs enlarge the grid on demand), in mm. */
export const JOIN_MARGIN_MM = 3 + TAB_MM + NEAR_MM + 1;

/** Enlarge a grid (keeping its phase) so it contains the box [lo, hi]. */
function grow(g: Grid3, lo: V3, hi: V3): Grid3 {
  const { h } = g;
  const ox = Math.min(g.ox, Math.floor(lo[0] / h) * h), oy = Math.min(g.oy, Math.floor(lo[1] / h) * h), oz = Math.min(g.oz, Math.floor(lo[2] / h) * h);
  const ex = Math.max(g.ox + (g.nx - 1) * h, hi[0]), ey = Math.max(g.oy + (g.ny - 1) * h, hi[1]), ez = Math.max(g.oz + (g.nz - 1) * h, hi[2]);
  const nx = Math.ceil((ex - ox) / h - 1e-6) + 1, ny = Math.ceil((ey - oy) / h - 1e-6) + 1, nz = Math.ceil((ez - oz) / h - 1e-6) + 1;
  if (nx === g.nx && ny === g.ny && nz === g.nz) return g;
  const data = new Float32Array(nx * ny * nz).fill(BIG);
  const di = Math.round((g.ox - ox) / h), dj = Math.round((g.oy - oy) / h), dk = Math.round((g.oz - oz) / h);
  for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) {
    const src = (k * g.ny + j) * g.nx, dst = ((k + dk) * ny + j + dj) * nx + di;
    data.set(g.data.subarray(src, src + g.nx), dst);
  }
  return { nx, ny, nz, h, ox, oy, oz, data };
}

export function joinPart(
  part: Grid3, hosts: { grid: Grid3; sockets: HostSockets }[], upright = false,
  /** receives the sockets cut into the part itself (re-applied after repairs, like the host's) */
  partHoles: ((g: Grid3) => void)[] = [],
  /** sockets planned in the part (when it is itself a host, e.g. the head for the ears), so later ones keep clear */
  partPlaced: HostSockets['placed'] = [],
): Joint[] {
  const before = dropSpecks(part);
  const patches = contacts(part, hosts.map((x) => x.grid));
  const original = part.data.slice();
  const chiOf = (): [number, number] => euler(part, 0, part.nx - 1, 0, part.ny - 1, 0, part.nz - 1);
  const chi0 = chiOf();
  const mark = hosts.map((x) => ({ carve: x.sockets.carve.length, holes: x.sockets.holes.length, placed: x.sockets.placed.length }));
  const partHolesMark = partHoles.length;
  // one patch after the other, so the sockets of one part (four legs) keep clear of each other too
  const planned = hosts.map((x) => [...x.sockets.placed]);
  const plans = patches.map((p) => {
    const pl = planPeg(part, hosts[p.host]!.grid, p, planned[p.host]!, upright, hosts.filter((_, i) => i !== p.host).map((x) => x.grid));
    if (pl?.partIsMale) planned[p.host]!.push({ s: pl.s, n: pl.axis, half: pl.peg.side / 2 + CLEARANCE_MM, depth: pl.peg.length + SOCKET_EXTRA_MM });
    return pl;
  });
  const cut = (pl: PegPlan): void => {
    // the part seats on the host surface: it loses what it shared with the host at this patch
    const { nx, ny, h } = part;
    const host = hosts[pl.patch.host]!.grid;
    for (const idx of pl.patch.nodes) {
      const i = idx % nx, j = Math.floor(idx / nx) % ny, k = Math.floor(idx / (nx * ny));
      const hv = nodeAt(host, part, i, j, k);
      if (-hv > part.data[idx]!) part.data[idx] = -hv;
    }
  };
  for (const pl of plans) if (pl) cut(pl);
  // a cut must not chop the part into loose bits (a horn that pierces the head): then this part uses tabs only
  const pegsOk = dropFragments(part, before);
  if (!pegsOk) part.data.set(original);
  // everything else the part shares with a host goes too (grazes too small for a joint), except what becomes a tab
  const tabNodes = new Set<number>();
  patches.forEach((patch, n) => { if (!(pegsOk && plans[n]) && patch.overlap) for (const idx of patch.nodes) tabNodes.add(idx); });
  {
    const { nx, ny, nz, h } = part;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const idx = (k * ny + j) * nx + i;
      if (part.data[idx]! >= 0 || tabNodes.has(idx)) continue;
      for (const { grid } of hosts) {
        const hv = nodeAt(grid, part, i, j, k);
        if (-hv > part.data[idx]!) part.data[idx] = -hv;
      }
    }
  }

  const joints: Joint[] = [];
  const shape = { nx: part.nx, ny: part.ny, nz: part.nz, ox: part.ox, oy: part.oy, oz: part.oz };
  // tabs first (they work on the part's grid as it is), pegs last (a peg may need the part's grid enlarged)
  const order = patches.map((_, n) => n).sort((a, b) => +(pegsOk && !!plans[a]) - +(pegsOk && !!plans[b]));
  order.forEach((n) => {
    const patch = patches[n]!;
    const pl = pegsOk ? plans[n] : null;
    const host = hosts[patch.host]!.grid, hostSockets = hosts[patch.host]!.sockets;
    if (pl) {
      const { s, axis, u, v, peg, gap, partIsMale } = pl;
      const half = peg.side / 2, edge = Math.min(0.5, half / 3);
      const reach = peg.length + gap + ROOT_MM + peg.side + 2;
      // along the axis (host -> part), with t = 0 at the shoulder s
      if (partIsMale) {
        // peg from ROOT_MM inside the part, across the gap, peg.length into the host
        const tip = add(s, axis, -peg.length), m = half * Math.SQRT2 + 3 * part.h;
        growInPlace(part, [Math.min(s[0], tip[0]) - m, Math.min(s[1], tip[1]) - m, Math.min(s[2], tip[2]) - m],
          [Math.max(s[0], tip[0]) + m, Math.max(s[1], tip[1]) + m, Math.max(s[2], tip[2]) + m]);
        stampBox(part, s, axis, u, v, -peg.length, gap + ROOT_MM, half, edge, 'add');
        hostSockets.placed.push({ s, n: axis, half: half + CLEARANCE_MM, depth: peg.length + SOCKET_EXTRA_MM });
        let seated = true;
        const socket = (g: Grid3): void => { if (seated) stampBox(g, s, axis, u, v, -peg.length - SOCKET_EXTRA_MM, 2, half + CLEARANCE_MM, 0, 'cut'); };
        const [lo, hi] = boxBounds(s, axis, u, v, -peg.length - SOCKET_EXTRA_MM, 2, half + CLEARANCE_MM, 2 * part.h);
        const joint: Joint = { at: s, axis, peg: peg.id, onHost: false, host: patch.host };
        hostSockets.carve.push((g) => {
          if (!cutWithoutTunnel(g, lo, hi, socket)) { seated = false; joint.peg = null; retreat(part, g, lo, hi); }
          return g;
        });
        hostSockets.holes.push((g) => cutClean(g, lo, hi, socket));
        joints.push(joint);
      } else {
        // peg from ROOT_MM inside the host, across the gap, peg.length into the part; socket in the part
        const socket = (g: Grid3): void => stampBox(g, s, axis, u, v, -2, gap + peg.length + SOCKET_EXTRA_MM, half + CLEARANCE_MM, 0, 'cut');
        socket(part);
        partHoles.push(socket);
        partPlaced.push({ s: add(s, axis, gap + peg.length + SOCKET_EXTRA_MM), n: axis, half: half + CLEARANCE_MM, depth: peg.length + SOCKET_EXTRA_MM });
        hostSockets.carve.push((g0) => {
          const tip = add(s, axis, gap + peg.length);
          const g = grow(g0, [Math.min(s[0], tip[0]) - reach, Math.min(s[1], tip[1]) - reach, Math.min(s[2], tip[2]) - reach],
            [Math.max(s[0], tip[0]) + reach, Math.max(s[1], tip[1]) + reach, Math.max(s[2], tip[2]) + reach]);
          stampBox(g, s, axis, u, v, -ROOT_MM, gap + peg.length, half, edge, 'add');
          return g;
        });
      }
      if (!partIsMale) joints.push({ at: s, axis, peg: peg.id, onHost: true, host: patch.host });
    } else {
      // tab + slot: the part's own section at the contact, swept TAB_MM along the axis into the host; the slot is the
      // tab grown by the clearance. A sweep can always be pushed in along the axis, whatever the part's outline.
      const { nx, ny, nz, h } = part;
      const ax = patch.n;
      let ci0 = nx, ci1 = 0, cj0 = ny, cj1 = 0, ck0 = nz, ck1 = 0;
      for (const idx of patch.nodes) {
        const i = idx % nx, j = Math.floor(idx / nx) % ny, k = Math.floor(idx / (nx * ny));
        ci0 = Math.min(ci0, i); ci1 = Math.max(ci1, i); cj0 = Math.min(cj0, j); cj1 = Math.max(cj1, j); ck0 = Math.min(ck0, k); ck1 = Math.max(ck1, k);
      }
      const src = { ...part, data: original };
      /** The tab for a sweep depth: its signed field over the node box around the patch, or null if nothing comes of it. */
      const build = (tabMm: number) => {
        const pad = Math.ceil((tabMm + patch.near + 1) / h);
        const i0 = Math.max(0, ci0 - pad), i1 = Math.min(nx - 1, ci1 + pad), j0 = Math.max(0, cj0 - pad), j1 = Math.min(ny - 1, cj1 + pad);
        const k0 = Math.max(0, ck0 - pad), k1 = Math.min(nz - 1, ck1 + pad);
        const steps = Math.ceil((tabMm + patch.near) / h);
        const W = i1 - i0 + 1, H = j1 - j0 + 1, D = k1 - k0 + 1;
        const tab = new Float32Array(W * H * D).fill(BIG);
        for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = part.ox + i * h, y = part.oy + j * h, z = part.oz + k * h;
          const hv = sample(host, x, y, z);
          if (hv >= patch.near) continue; // the tab only fills the gap and the inside of the host
          const at = ((k - k0) * H + (j - j0)) * W + (i - i0);
          if (hv < -(tabMm + h)) { tab[at] = h; continue; } // deeper than any tab: the part gives way here
          const own = original[(k * ny + j) * nx + i]!;
          // a sweep over D mm lowers the field by at most D: far from the part nothing can come of it
          if (own - steps * h > CLEARANCE_MM + 2 * h) { tab[at] = own - steps * h; continue; }
          let best = own;
          // well inside the part the exact (more negative) sweep value does not matter
          if (own > -2 * h) for (let st = 1; st <= steps; st++) {
            const d = st * h;
            const q: V3 = [x + ax[0] * d, y + ax[1] * d, z + ax[2] * d];
            // only the part's section near this patch is swept (not some other bit of the part further along the axis)
            if (sample(host, q[0], q[1], q[2]) >= patch.near + h) { best = Math.min(best, sample(src, q[0], q[1], q[2])); break; }
            best = Math.min(best, sample(src, q[0], q[1], q[2]));
          }
          // depth along the axis: the tab ends tabMm below the host surface and keeps a wall to the far side
          let depth = 0, rest = 0;
          if (hv < 0 && best < CLEARANCE_MM + 2 * h) {
            while (depth < tabMm + h && sample(host, x + ax[0] * depth, y + ax[1] * depth, z + ax[2] * depth) < 0) depth += h;
            const need = WALL_MM + CLEARANCE_MM;
            while (rest < need && sample(host, x - ax[0] * rest, y - ax[1] * rest, z - ax[2] * rest) < 0) rest += h;
            rest = Math.min(rest, need);
          }
          tab[at] = hv < 0 ? Math.max(best, depth - tabMm, WALL_MM + CLEARANCE_MM - rest) : best;
        }
        // keep only the tab that grows out of the part itself (a sweep can clip a stray corner of the host's inside)
        const keep = new Uint8Array(W * H * D), stack: number[] = [];
        for (let k = 0; k < D; k++) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
          const b = (k * H + j) * W + i;
          if (original[((k + k0) * ny + j + j0) * nx + i + i0]! < 0) { keep[b] = 1; stack.push(b); }
        }
        while (stack.length) {
          const b = stack.pop()!;
          const i = b % W, j = Math.floor(b / W) % H, k = Math.floor(b / (W * H));
          for (const [di, dj, dk] of NB) {
            const a = i + di, c = j + dj, e = k + dk;
            if (a < 0 || c < 0 || e < 0 || a >= W || c >= H || e >= D) continue;
            const m = (e * H + c) * W + a;
            if (!keep[m] && tab[m]! < 0) { keep[m] = 1; stack.push(m); }
          }
        }
        let any = false;
        for (let b = 0; b < tab.length; b++) if (!keep[b] && tab[b]! < 0) tab[b] = h; else if (tab[b]! < 0 && original[((Math.floor(b / (W * H)) + k0) * ny + Math.floor(b / W) % H + j0) * nx + b % W + i0]! >= 0) any = true;
        if (!any && !patch.overlap) return null;
        // the slot (the tab grown by the clearance) goes into every host the tab reaches into (a tuft on the head that
        // also dips into the back)
        const slotFn = (g: Grid3): Grid3 => {
          for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const gi = Math.round((part.ox + i * h - g.ox) / h), gj = Math.round((part.oy + j * h - g.oy) / h), gk = Math.round((part.oz + k * h - g.oz) / h);
            if (gi < 0 || gj < 0 || gk < 0 || gi >= g.nx || gj >= g.ny || gk >= g.nz) continue;
            const slot = tab[((k - k0) * H + (j - j0)) * W + (i - i0)]! - CLEARANCE_MM;
            const idx = (gk * g.ny + gj) * g.nx + gi;
            if (-slot > g.data[idx]!) g.data[idx] = -slot;
          }
          return g;
        };
        const lo: V3 = [part.ox + i0 * h, part.oy + j0 * h, part.oz + k0 * h], hi: V3 = [part.ox + i1 * h, part.oy + j1 * h, part.oz + k1 * h];
        return { tab, slotFn, lo, hi, box: [i0, i1, j0, j1, k0, k1] as const, W, H };
      };
      // a slot that would cut a tunnel through a thin host (a mane along the neck, a horn on a thin crest): try a
      // shallower tab
      let t = build(TAB_MM);
      if (!t) { joints.push({ at: patch.c, axis: ax, peg: null, host: patch.host }); return; }
      for (const mm of [TAB_MM / 2, TAB_MM / 4]) {
        const cur = t;
        if (hosts.every(({ grid }) => cutWithoutTunnel(grid, cur.lo, cur.hi, cur.slotFn, true))) break;
        const next = build(mm);
        if (!next) break;
        t = next;
      }
      const { tab, slotFn, lo, hi, W, H } = t;
      const [i0, i1, j0, j1, k0, k1] = t.box;
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = tab[((k - k0) * H + (j - j0)) * W + (i - i0)]!;
        if (v >= BIG) continue; // clear of the host: the part stays as it is
        // inside the host the part becomes exactly the tab (no deeper than the sweep, so the slot matches it)
        part.data[(k * ny + j) * nx + i] = v;
      }
      let slotted = true;
      const joint: Joint = { at: patch.c, axis: ax, peg: 'tab', host: patch.host };
      for (const { sockets: hs } of hosts) {
        hs.carve.push((g) => {
          // still a tunnel (the host changed since): no tab there, glue instead
          if (slotted && !cutWithoutTunnel(g, lo, hi, slotFn)) {
            slotted = false; joint.peg = null;
            for (const x of hosts) retreat(part, x.grid === host ? g : x.grid, lo, hi);
          }
          return g;
        });
        hs.holes.push((g) => { if (slotted) cutClean(g, lo, hi, slotFn); });
      }
      joints.push(joint);
    }
  });
  // no new handle either (a tab swept along a curled horn that meets its own tip)
  if (dropFragments(part, before)) {
    const [cin, cout] = chiOf();
    if (cin >= chi0[0] && cout >= chi0[1]) return joints;
  }
  // the joints would chop the part into loose bits (a horn whose base dips in and out of the head): undo them and
  // seat the part whole, in a slot of its own shape (plus clearance) in every host it overlaps
  Object.assign(part, shape, { data: original });
  hosts.forEach((x, i) => { x.sockets.carve.length = mark[i]!.carve; x.sockets.holes.length = mark[i]!.holes; x.sockets.placed.length = mark[i]!.placed; });
  partHoles.length = partHolesMark;
  const src = { ...part, data: original };
  const wholeSlot = (g: Grid3): Grid3 => {
    const { nx, ny, nz, h } = part;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = original[(k * ny + j) * nx + i]!;
      if (v >= CLEARANCE_MM + h) continue;
      const gi = Math.round((part.ox + i * h - g.ox) / h), gj = Math.round((part.oy + j * h - g.oy) / h), gk = Math.round((part.oz + k * h - g.oz) / h);
      if (gi < 0 || gj < 0 || gk < 0 || gi >= g.nx || gj >= g.ny || gk >= g.nz) continue;
      const idx = (gk * g.ny + gj) * g.nx + gi;
      const slot = nodeAt(src, part, i, j, k) - CLEARANCE_MM;
      if (-slot > g.data[idx]!) g.data[idx] = -slot;
    }
    return g;
  };
  const lo: V3 = [part.ox, part.oy, part.oz], hi: V3 = [part.ox + (part.nx - 1) * part.h, part.oy + (part.ny - 1) * part.h, part.oz + (part.nz - 1) * part.h];
  // where it only comes near a host (no overlap to seat in), it is glued
  const whole = patches.map((p): Joint => ({ at: p.c, axis: p.n, peg: p.overlap ? 'tab' : null, host: p.host }));
  let slotted = true;
  for (const { sockets } of hosts) {
    sockets.carve.push((g) => {
      if (slotted && !cutWithoutTunnel(g, lo, hi, wholeSlot)) {
        // even that would cut a tunnel: the part only sits on the host (glue)
        slotted = false;
        for (const j of whole) j.peg = null;
        for (const x of hosts) retreat(part, x.grid, lo, hi);
        retreat(part, g, lo, hi);
      }
      return g;
    });
    sockets.holes.push((g) => { if (slotted) cutClean(g, lo, hi, wholeSlot); });
  }
  return whole;
}

/** Two parts printed separately that overlap without joining (a horn across an ear): the later one gives way. */
export function cutAway(part: Grid3, other: Grid3): boolean {
  const { nx, ny, nz, h } = part;
  // only parts that really overlap pay for the check
  let touches = false;
  for (let k = 0; k < nz && !touches; k++) for (let j = 0; j < ny && !touches; j++) for (let i = 0; i < nx; i++) {
    if (part.data[(k * ny + j) * nx + i]! < 0 && nodeAt(other, part, i, j, k) < 0) { touches = true; break; }
  }
  if (!touches) return true;
  const before = bodies(part), keep = part.data.slice();
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const idx = (k * ny + j) * nx + i;
    if (part.data[idx]! >= 0) continue;
    const ov = nodeAt(other, part, i, j, k);
    if (-ov > part.data[idx]!) part.data[idx] = -ov;
  }
  if (bodies(part) <= before) return true;
  part.data.set(keep); // the cut would chop it into loose bits
  return false;
}

/** The smallest grid (same phase) that still holds every inside node plus a border of `pad` nodes. */
export function crop(g: Grid3, pad = 3): Grid3 {
  const { nx, ny, nz, h, data } = g;
  let i0 = nx, i1 = -1, j0 = ny, j1 = -1, k0 = nz, k1 = -1;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const row = (k * ny + j) * nx;
    for (let i = 0; i < nx; i++) if (data[row + i]! < 0) {
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; if (k < k0) k0 = k; if (k > k1) k1 = k;
    }
  }
  if (i1 < 0) return g;
  i0 = Math.max(0, i0 - pad); j0 = Math.max(0, j0 - pad); k0 = Math.max(0, k0 - pad);
  i1 = Math.min(nx - 1, i1 + pad); j1 = Math.min(ny - 1, j1 + pad); k1 = Math.min(nz - 1, k1 + pad);
  const w = i1 - i0 + 1, hh = j1 - j0 + 1, d = k1 - k0 + 1;
  if (w === nx && hh === ny && d === nz) return g;
  const out = new Float32Array(w * hh * d);
  for (let k = 0; k < d; k++) for (let j = 0; j < hh; j++) {
    const src = ((k + k0) * ny + j + j0) * nx + i0;
    out.set(data.subarray(src, src + w), (k * hh + j) * w);
  }
  return { nx: w, ny: hh, nz: d, h, ox: g.ox + i0 * h, oy: g.oy + j0 * h, oz: g.oz + k0 * h, data: out };
}
