/**
 * Closing of tiny through-holes and tunnels (3D morphological closing with an exact Euclidean
 * distance transform). Only the voxels that closing fills are touched, so the smooth surface of the
 * rest of the model stays exactly as it was.
 */
import type { Grid3 } from './surfacenets';

const FAR = 1e9;

/** Squared distance (in voxels) from every voxel to the nearest voxel with mask = 1 (Felzenszwalb, separable). */
export function edtSq(mask: Uint8Array, nx: number, ny: number, nz: number): Float32Array {
  const out = new Float32Array(nx * ny * nz);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 0 : FAR;
  const n = Math.max(nx, ny, nz);
  const f = new Float32Array(n), d = new Float32Array(n), z = new Float32Array(n + 1), v = new Int32Array(n);
  const pass = (len: number, stride: number, starts: number[]): void => {
    for (const s0 of starts) {
      for (let q = 0; q < len; q++) f[q] = out[s0 + q * stride]!;
      let k = 0; v[0] = 0; z[0] = -FAR; z[1] = FAR;
      for (let q = 1; q < len; q++) {
        let s = 0;
        for (;;) {
          const vk = v[k]!;
          s = (f[q]! + q * q - (f[vk]! + vk * vk)) / (2 * q - 2 * vk);
          if (s <= z[k]!) { k--; if (k < 0) { k = 0; break; } } else break;
        }
        k++; v[k] = q; z[k] = s; z[k + 1] = FAR;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1]! < q) k++; const dq = q - v[k]!; d[q] = dq * dq + f[v[k]!]!; }
      for (let q = 0; q < len; q++) out[s0 + q * stride] = d[q]!;
    }
  };
  const starts: number[] = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) starts.push((k * ny + j) * nx);
  pass(nx, 1, starts);
  starts.length = 0;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) starts.push(k * ny * nx + i);
  pass(ny, nx, starts);
  starts.length = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) starts.push(j * nx + i);
  pass(nz, nx * ny, starts);
  return out;
}

/**
 * Fill every empty voxel that is within `rMm` of the solid on all sides (closing). Returns the changed voxels
 * and their previous values so the caller can undo the change.
 */
export function closeSmallHoles(g: Grid3, rMm: number): { index: Int32Array; previous: Float32Array } {
  const { nx, ny, nz, h, data } = g;
  const n = nx * ny * nz;
  const r2 = (rMm / h) ** 2;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = data[i]! < 0 ? 1 : 0;
  const dS = edtSq(solid, nx, ny, nz);
  const notDilated = new Uint8Array(n);
  for (let i = 0; i < n; i++) notDilated[i] = dS[i]! > r2 ? 1 : 0;
  const dOut = edtSq(notDilated, nx, ny, nz);
  const idx: number[] = [], prev: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!solid[i] && !notDilated[i] && dOut[i]! > r2) { idx.push(i); prev.push(data[i]!); data[i] = -0.3 * h; }
  }
  return { index: Int32Array.from(idx), previous: Float32Array.from(prev) };
}

export function restore(g: Grid3, undo: { index: Int32Array; previous: Float32Array }): void {
  for (let i = 0; i < undo.index.length; i++) g.data[undo.index[i]!] = undo.previous[i]!;
}
