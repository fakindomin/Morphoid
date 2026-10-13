import type { Mesh } from './surfacenets';

export interface MeshValidation {
  triangles: number;
  vertices: number;
  /** every edge is shared by exactly two triangles with opposite directions */
  watertight: boolean;
  /** number of edges that are open or used more than twice or inconsistently oriented */
  badEdges: number;
  degenerate: number;
  /** cm^3, positive when the normals point outwards */
  volume: number;
  /** disconnected shells (a monolith should be 1 per fused body) */
  shells: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** vertices on bad edges (capped), used to repair the field locally */
  badVertices: number[];
}

export function validateMesh(m: Mesh): MeshValidation {
  const P = m.positions, I = m.indices;
  const nv = P.length / 3, nt = I.length / 3;
  let degenerate = 0, vol6 = 0;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; } return a; };
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, P[3 * v + a]!); max[a] = Math.max(max[a]!, P[3 * v + a]!); }
  // directed edges as sortable keys p * nv + q (< 2^53 for any realistic mesh)
  const keys = new Float64Array(nt * 3);
  let ne = 0;
  const used = new Uint8Array(nv);
  for (let t = 0; t < nt; t++) {
    const a = I[3 * t]!, b = I[3 * t + 1]!, c = I[3 * t + 2]!;
    if (a === b || b === c || a === c) { degenerate++; continue; }
    const ax = P[3 * a]!, ay = P[3 * a + 1]!, az = P[3 * a + 2]!;
    const bx = P[3 * b]!, by = P[3 * b + 1]!, bz = P[3 * b + 2]!;
    const cx = P[3 * c]!, cy = P[3 * c + 1]!, cz = P[3 * c + 2]!;
    vol6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    keys[ne++] = a * nv + b; keys[ne++] = b * nv + c; keys[ne++] = c * nv + a;
    used[a] = used[b] = used[c] = 1;
    const ra = find(a), rb = find(b), rc = find(c);
    if (ra !== rb) parent[ra] = rb;
    const r2 = find(b); if (r2 !== rc) parent[r2] = rc;
  }
  const sorted = keys.subarray(0, ne).slice().sort();
  const has = (key: number): boolean => {
    let lo = 0, hi = sorted.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1, v = sorted[mid]!; if (v === key) return true; if (v < key) lo = mid + 1; else hi = mid - 1; }
    return false;
  };
  let bad = 0;
  const badVertices: number[] = [];
  for (let e = 0; e < sorted.length; e++) {
    const key = sorted[e]!;
    const dup = (e > 0 && sorted[e - 1] === key) || (e < sorted.length - 1 && sorted[e + 1] === key);
    const p = Math.floor(key / nv), q = key - p * nv;
    if (dup || !has(q * nv + p)) { bad++; if (badVertices.length < 4000) badVertices.push(p, q); }
  }
  const roots = new Set<number>();
  for (let v = 0; v < nv; v++) if (used[v]) roots.add(find(v));
  return {
    triangles: nt, vertices: nv, watertight: bad === 0 && nt > 0, badEdges: bad, degenerate,
    volume: vol6 / 6 / 1000, shells: roots.size, bbox: { min, max }, badVertices,
  };
}

/** Flip all triangles (when the volume came out negative). */
export function flipMesh(m: Mesh): Mesh {
  const I = m.indices.slice();
  for (let t = 0; t < I.length; t += 3) { const b = I[t + 1]!; I[t + 1] = I[t + 2]!; I[t + 2] = b; }
  return { positions: m.positions, indices: I };
}

/** Binary STL (little endian). Coordinates are written as they are (mm). */
export function toBinaryStl(m: Mesh, name = 'Morphoid'): Uint8Array {
  const nt = m.indices.length / 3;
  const buf = new ArrayBuffer(84 + nt * 50);
  const dv = new DataView(buf);
  const header = `${name} - Morphoid Studio`;
  for (let i = 0; i < Math.min(80, header.length); i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, nt, true);
  const P = m.positions, I = m.indices;
  let o = 84;
  for (let t = 0; t < nt; t++) {
    const a = I[3 * t]! * 3, b = I[3 * t + 1]! * 3, c = I[3 * t + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (const v of [a, b, c]) {
      o += 12;
      dv.setFloat32(o, P[v]!, true); dv.setFloat32(o + 4, P[v + 1]!, true); dv.setFloat32(o + 8, P[v + 2]!, true);
    }
    o += 14; // 3 floats of the last vertex were written above; skip to the attribute bytes
    dv.setUint16(o - 2, 0, true);
  }
  return new Uint8Array(buf);
}
