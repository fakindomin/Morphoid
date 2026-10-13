/**
 * Skin smoothing. Surface Nets leaves faint voxel steps (most visible where parts blend into each other), and outlines
 * flattened into polylines leave flat bands. Taubin smoothing (a shrink step and an inflate step) irons both out without
 * thinning the model. Every vertex stays within `maxMove` of where the field put it, so dimensions hold, and sharp
 * edges (pegs, sockets, flat cuts) and the footprint on the bed are left exactly as they are.
 */
import type { Mesh } from './surfacenets';

/** A vertex whose faces meet at a sharper angle than this is a real edge, not a voxel step. */
const SHARP_COS = Math.cos((70 * Math.PI) / 180);

export function smoothMesh(mesh: Mesh, maxMove: number, iterations = 10): Mesh {
  const P = mesh.positions, I = mesh.indices, nv = P.length / 3;
  // neighbours (CSR) from the triangle edges
  const deg = new Uint32Array(nv + 1);
  for (let t = 0; t < I.length; t++) deg[I[t]! + 1]! += 2;
  for (let v = 0; v < nv; v++) deg[v + 1]! += deg[v]!;
  const nb = new Uint32Array(deg[nv]!), fill = deg.slice(0, nv);
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = I[t + e]!, b = I[t + ((e + 1) % 3)]!;
    nb[fill[a]!++] = b; nb[fill[b]!++] = a;
  }
  // pin sharp vertices: compare every face normal with the vertex's mean normal
  const fn = new Float32Array(I.length), vn = new Float32Array(nv * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const wx = P[c]! - P[a]!, wy = P[c + 1]! - P[a + 1]!, wz = P[c + 2]! - P[a + 2]!;
    let x = uy * wz - uz * wy, y = uz * wx - ux * wz, z = ux * wy - uy * wx;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    fn[t] = x; fn[t + 1] = y; fn[t + 2] = z;
    for (const v of [I[t]!, I[t + 1]!, I[t + 2]!]) { vn[v * 3]! += x; vn[v * 3 + 1]! += y; vn[v * 3 + 2]! += z; }
  }
  const pinned = new Uint8Array(nv);
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const v = I[t + e]!, l = Math.hypot(vn[v * 3]!, vn[v * 3 + 1]!, vn[v * 3 + 2]!) || 1;
    if ((fn[t]! * vn[v * 3]! + fn[t + 1]! * vn[v * 3 + 1]! + fn[t + 2]! * vn[v * 3 + 2]!) / l < SHARP_COS) pinned[v] = 1;
  }
  // the footprint: vertices on the lowest plane keep their height so the model still stands flat
  let yMin = Infinity;
  for (let v = 0; v < nv; v++) yMin = Math.min(yMin, P[v * 3 + 1]!);
  const onBed = (v: number): boolean => P[v * 3 + 1]! < yMin + 0.05;

  const orig = P.slice(), cur = P.slice(), next = new Float32Array(P.length);
  const step = (f: number): void => {
    for (let v = 0; v < nv; v++) {
      const o = v * 3;
      if (pinned[v]) { next[o] = cur[o]!; next[o + 1] = cur[o + 1]!; next[o + 2] = cur[o + 2]!; continue; }
      let sx = 0, sy = 0, sz = 0;
      const n0 = deg[v]!, n1 = deg[v + 1]!;
      for (let q = n0; q < n1; q++) { const u = nb[q]! * 3; sx += cur[u]!; sy += cur[u + 1]!; sz += cur[u + 2]!; }
      const k = n1 - n0 || 1;
      let x = cur[o]! + f * (sx / k - cur[o]!), y = cur[o + 1]! + f * (sy / k - cur[o + 1]!), z = cur[o + 2]! + f * (sz / k - cur[o + 2]!);
      if (onBed(v)) y = orig[o + 1]!;
      // stay close to the true surface
      const dx = x - orig[o]!, dy = y - orig[o + 1]!, dz = z - orig[o + 2]!, d = Math.hypot(dx, dy, dz);
      if (d > maxMove) { const s = maxMove / d; x = orig[o]! + dx * s; y = orig[o + 1]! + dy * s; z = orig[o + 2]! + dz * s; }
      next[o] = x; next[o + 1] = y; next[o + 2] = z;
    }
    cur.set(next);
  };
  for (let i = 0; i < iterations; i++) { step(0.5); step(-0.53); }
  return { ...mesh, positions: cur };
}
