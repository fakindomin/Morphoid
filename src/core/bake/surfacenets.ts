/**
 * Naive Surface Nets on a regular grid of signed distances (negative = inside).
 * One vertex per cell that the surface crosses (mean of the edge crossings), one quad per
 * grid edge that changes sign. With a border of positive values the result is a closed
 * surface; `validateMesh` proves it (every directed edge exactly once, reverse present).
 */
export interface Grid3 {
  nx: number; ny: number; nz: number;
  /** node (i, j, k) sits at origin + (i, j, k) * h */
  h: number; ox: number; oy: number; oz: number;
  data: Float32Array; // index = (k * ny + j) * nx + i
  /** which appendage group is nearest at each node (0 = the body); see field.ts blendGroup */
  owner?: Uint8Array;
}

export interface Mesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** linear cell index of each vertex (for local repairs) */
  cells?: Int32Array;
}

export const gridIndex = (g: Pick<Grid3, 'nx' | 'ny'>, i: number, j: number, k: number): number => (k * g.ny + j) * g.nx + i;

const CORNERS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * Sparse scan: the surface touches a tiny fraction of the grid, so instead of testing every cell we walk
 * the nodes once, find the grid edges whose ends have opposite signs, and mark the 4 cells around each.
 * Returns the sign-changing edges (node index * 3 + axis) and the list of crossed cells.
 */
function crossings(g: Grid3): { edges: number[]; cells: Int32Array } {
  const { nx, ny, nz, data } = g;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const mark = new Uint8Array(cx * cy * cz);
  const edges: number[] = [];
  const m = (i: number, j: number, k: number): void => { mark[(k * cy + j) * cx + i] = 1; };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const row = (k * ny + j) * nx;
    for (let i = 0; i < nx; i++) {
      const idx = row + i;
      const neg = data[idx]! < 0;
      if (i < nx - 1 && j >= 1 && j < ny - 1 && k >= 1 && k < nz - 1 && neg !== (data[idx + 1]! < 0)) {
        edges.push(idx * 3);
        m(i, j - 1, k - 1); m(i, j, k - 1); m(i, j, k); m(i, j - 1, k);
      }
      if (j < ny - 1 && i >= 1 && i < nx - 1 && k >= 1 && k < nz - 1 && neg !== (data[idx + nx]! < 0)) {
        edges.push(idx * 3 + 1);
        m(i - 1, j, k - 1); m(i - 1, j, k); m(i, j, k); m(i, j, k - 1);
      }
      if (k < nz - 1 && i >= 1 && i < nx - 1 && j >= 1 && j < ny - 1 && neg !== (data[idx + nx * ny]! < 0)) {
        edges.push(idx * 3 + 2);
        m(i - 1, j - 1, k); m(i, j - 1, k); m(i, j, k); m(i - 1, j, k);
      }
    }
  }
  let n = 0;
  for (let c = 0; c < mark.length; c++) if (mark[c]) n++;
  const cells = new Int32Array(n);
  n = 0;
  for (let c = 0; c < mark.length; c++) if (mark[c]) cells[n++] = c;
  return { edges, cells };
}

export function surfaceNets(g: Grid3): Mesh {
  const { nx, ny, nz, h, data } = g;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const { edges, cells } = crossings(g);
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const positions = new Float32Array(cells.length * 3);
  const val = new Float32Array(8);

  for (let n = 0; n < cells.length; n++) {
    const c = cells[n]!;
    const i = c % cx, j = Math.floor(c / cx) % cy, k = Math.floor(c / (cx * cy));
    for (let q = 0; q < 8; q++) {
      const [di, dj, dk] = CORNERS[q]!;
      val[q] = data[((k + dk) * ny + (j + dj)) * nx + i + di]!;
    }
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of EDGES) {
      const va = val[a]!, vb = val[b]!;
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      const [ai, aj, ak] = CORNERS[a]!, [bi, bj, bk] = CORNERS[b]!;
      sx += ai + (bi - ai) * t; sy += aj + (bj - aj) * t; sz += ak + (bk - ak) * t; cnt++;
    }
    cellVertex[c] = n;
    positions[3 * n] = g.ox + (i + sx / cnt) * h; positions[3 * n + 1] = g.oy + (j + sy / cnt) * h; positions[3 * n + 2] = g.oz + (k + sz / cnt) * h;
  }

  const indices = new Uint32Array(edges.length * 6);
  let ni = 0;
  const d2 = (p: number, q: number): number => (positions[3 * p]! - positions[3 * q]!) ** 2 + (positions[3 * p + 1]! - positions[3 * q + 1]!) ** 2 + (positions[3 * p + 2]! - positions[3 * q + 2]!) ** 2;
  const cv = (i: number, j: number, k: number): number => cellVertex[(k * cy + j) * cx + i]!;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const ac = d2(a, c) <= d2(b, d); // split along the shorter diagonal
    const t = ac ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
    for (let q = 0; q < 6; q += 3) {
      if (flip) { indices[ni++] = t[q]!; indices[ni++] = t[q + 2]!; indices[ni++] = t[q + 1]!; }
      else { indices[ni++] = t[q]!; indices[ni++] = t[q + 1]!; indices[ni++] = t[q + 2]!; }
    }
  };
  for (const e of edges) {
    const axis = e % 3, idx = (e - axis) / 3;
    const i = idx % nx, j = Math.floor(idx / nx) % ny, k = Math.floor(idx / (nx * ny));
    const inside = data[idx]! < 0;
    if (axis === 0) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), !inside);
    else if (axis === 1) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), !inside);
    else quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), !inside);
  }
  return { positions, indices: indices.slice(0, ni), cells: cells.slice() };
}

// ---------------------------------------------------------------------------------------------
// Topology-safe field: every cell the surface crosses must have its inside corners connected
// (through cube edges) and its outside corners connected. Then the surface inside a cell is one
// disk and Surface Nets cannot pinch. Cells that break the rule get their weakest corner flipped
// (a change of the field by less than one voxel), neighbours are re-checked.
// ---------------------------------------------------------------------------------------------
const CUBE_EDGES: readonly (readonly [number, number])[] = EDGES;

const SAFE: Uint8Array = (() => {
  const table = new Uint8Array(256);
  const connected = (mask: number, want: 0 | 1): boolean => {
    const nodes: number[] = [];
    for (let c = 0; c < 8; c++) if (((mask >> c) & 1) === want) nodes.push(c);
    if (nodes.length <= 1) return true;
    const seen = new Set<number>([nodes[0]!]);
    const stack = [nodes[0]!];
    while (stack.length) {
      const a = stack.pop()!;
      for (const [u, v] of CUBE_EDGES) {
        const b = u === a ? v : v === a ? u : -1;
        if (b >= 0 && ((mask >> b) & 1) === want && !seen.has(b)) { seen.add(b); stack.push(b); }
      }
    }
    return seen.size === nodes.length;
  };
  for (let m = 0; m < 256; m++) table[m] = connected(m, 1) && connected(m, 0) ? 1 : 0;
  return table;
})();

/** Returns the number of corner flips made. */
export function makeManifoldField(g: Grid3, maxFlips = 400000): number {
  const { nx, ny, nz, data } = g;
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const maskOf = (i: number, j: number, k: number): number => {
    let m = 0;
    for (let c = 0; c < 8; c++) {
      const [di, dj, dk] = CORNERS[c]!;
      if (data[((k + dk) * ny + (j + dj)) * nx + i + di]! < 0) m |= 1 << c;
    }
    return m;
  };
  const queue: number[] = [];
  for (const c of crossings(g).cells) {
    const i = c % cx, j = Math.floor(c / cx) % cy, k = Math.floor(c / (cx * cy));
    const m = maskOf(i, j, k);
    if (m !== 0 && m !== 255 && !SAFE[m]) queue.push(c);
  }
  let flips = 0;
  while (queue.length && flips < maxFlips) {
    const c = queue.pop()!;
    const i = c % cx, j = Math.floor(c / cx) % cy, k = Math.floor(c / (cx * cy));
    const m = maskOf(i, j, k);
    if (m === 0 || m === 255 || SAFE[m]) continue;
    // Monotone repair (outside -> inside only, so it always terminates): flip the outside corner
    // closest to the surface that makes the cell safe; if none does, the closest one anyway.
    const outs: { n: number; v: number }[] = [];
    for (let n = 0; n < 8; n++) if (((m >> n) & 1) === 0) {
      const [di, dj, dk] = CORNERS[n]!;
      outs.push({ n, v: data[((k + dk) * ny + (j + dj)) * nx + i + di]! });
    }
    outs.sort((a, b) => a.v - b.v);
    const pick = outs.find((o) => SAFE[m | (1 << o.n)]) ?? outs[0]!;
    const [pdi, pdj, pdk] = CORNERS[pick.n]!;
    const best = ((k + pdk) * ny + (j + pdj)) * nx + i + pdi;
    const bi = i + pdi, bj = j + pdj, bk = k + pdk;
    data[best] = -1e-4;
    flips++;
    for (let dk = -1; dk <= 0; dk++) for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
      const ci = bi + di, cj = bj + dj, ck = bk + dk;
      if (ci < 0 || cj < 0 || ck < 0 || ci >= cx || cj >= cy || ck >= cz) continue;
      const mm = maskOf(ci, cj, ck);
      if (mm !== 0 && mm !== 255 && !SAFE[mm]) queue.push((ck * cy + cj) * cx + ci);
    }
  }
  return flips;
}
