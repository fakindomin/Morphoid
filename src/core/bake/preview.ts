/**
 * The 3D preview's solid: the same fused field as the bake, so the studio shows what will be printed (smooth blends,
 * coat relief, an open mouth), but quick enough to follow every change. No print plan: everything is one assembled
 * solid without pegs, sockets or bed cuts, and print-only aids (the whisker pad) are left out.
 */
import type { MorphotypeGenome } from '../genome';
import { solveRig } from '../rig';
import { targetPose } from '../art/pose';
import { buildPaths } from '../art/shapes';
import { buildParts3D, type ColorKey } from '../art/spec3d';
import { BLEND_MM, CARVE_BLEND_MM, INSET_BLEND_MM, MIN_SOLID_MM, SMOOTH_MOVE } from './bake';
import { addPart, makeGrid } from './field';
import { flipMesh, validateMesh } from './mesh';
import { painter } from './paint';
import { smoothMesh } from './smooth';
import { surfaceNets, type Grid3 } from './surfacenets';

/** Voxel size (mm) of the preview: fine enough for teeth and the coat, quick enough for every click. */
export const PREVIEW_VOXEL_MM = 0.4;

export interface PreviewSolid {
  positions: Float32Array;
  /** smooth vertex normals */
  normals: Float32Array;
  /** ambient occlusion of every vertex (1 open, lower in creases, under the chin, between the legs) */
  ao: Float32Array;
  indices: Uint32Array;
  /** colour of every triangle */
  colors: ColorKey[];
  ms: number;
}

export function previewSolid(genome: MorphotypeGenome, h = PREVIEW_VOXEL_MM): PreviewSolid {
  const t0 = performance.now();
  const rig = solveRig(genome);
  const paths = buildPaths(targetPose(rig, genome, 0, false, { x: 0, y: 0 }), genome, rig, false);
  const all = buildParts3D(paths, genome, rig);
  const parts = all.filter((p) => p.thickness >= MIN_SOLID_MM);
  const grid = makeGrid(parts, h, 3);
  for (const p of parts) if (!p.inset && !p.carve) addPart(grid, p, BLEND_MM);
  for (const p of parts) if (p.inset) addPart(grid, p, INSET_BLEND_MM);
  for (const p of parts) if (p.carve) addPart(grid, p, CARVE_BLEND_MM);
  let mesh = surfaceNets(grid);
  if (validateMesh(mesh).volume < 0) mesh = flipMesh(mesh);
  mesh = smoothMesh(mesh, SMOOTH_MOVE * h);
  const colorAt = painter(parts.filter((p) => !p.carve), all.filter((p) => p.thickness < MIN_SOLID_MM), paths.pattern.flatten(8));
  return { ...paintSmooth(mesh.positions, mesh.indices, colorAt, grid), ms: performance.now() - t0 };
}

/** How many times a triangle on a colour border is split in four: the border then steps at a sixteenth of a voxel. */
const BORDER_SPLITS = 2;

/**
 * Paint the mesh triangle by triangle, but split the triangles a colour border runs through (1 -> 4, recursively), so
 * a pupil or a mouth line has a clean edge instead of the voxel staircase. New vertices sit on the flat triangle and
 * take interpolated normals, so the shading stays smooth.
 */
function paintSmooth(P: Float32Array, I: Uint32Array, colorAt: (x: number, y: number, z: number, nz: number) => ColorKey, grid: Grid3): Omit<PreviewSolid, 'ms'> {
  const nv = P.length / 3;
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const wx = P[c]! - P[a]!, wy = P[c + 1]! - P[a + 1]!, wz = P[c + 2]! - P[a + 2]!;
    const x = uy * wz - uz * wy, y = uz * wx - ux * wz, z = ux * wy - uy * wx;
    for (const v of [a, b, c]) { N[v]! += x; N[v + 1]! += y; N[v + 2]! += z; }
  }
  for (let v = 0; v < nv; v++) { const l = Math.hypot(N[3 * v]!, N[3 * v + 1]!, N[3 * v + 2]!) || 1; N[3 * v]! /= l; N[3 * v + 1]! /= l; N[3 * v + 2]! /= l; }
  const A = new Float32Array(nv);
  for (let v = 0; v < nv; v++) A[v] = occlusion(grid, P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!, N[3 * v]!, N[3 * v + 1]!, N[3 * v + 2]!);
  const vKey: ColorKey[] = new Array(nv);
  for (let v = 0; v < nv; v++) vKey[v] = colorAt(P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!, N[3 * v + 2]!);

  const pos: number[] = [], nor: number[] = [], occ: number[] = [], idx: number[] = [], colors: ColorKey[] = [];
  const keep: number[] = [];
  type V = { p: [number, number, number]; n: [number, number, number]; k: ColorKey; a: number };
  const vert = (v: number): V => ({ p: [P[3 * v]!, P[3 * v + 1]!, P[3 * v + 2]!], n: [N[3 * v]!, N[3 * v + 1]!, N[3 * v + 2]!], k: vKey[v]!, a: A[v]! });
  const mid = (a: V, b: V): V => {
    const p: [number, number, number] = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2];
    const n: [number, number, number] = [a.n[0] + b.n[0], a.n[1] + b.n[1], a.n[2] + b.n[2]];
    const l = Math.hypot(...n) || 1; n[0] /= l; n[1] /= l; n[2] /= l;
    return { p, n, k: colorAt(p[0], p[1], p[2], n[2]), a: (a.a + b.a) / 2 };
  };
  const emit = (a: V, b: V, c: V): void => {
    const base = pos.length / 3 + nv;
    for (const q of [a, b, c]) { pos.push(...q.p); nor.push(...q.n); occ.push(q.a); }
    idx.push(base, base + 1, base + 2);
    const cx = (a.p[0] + b.p[0] + c.p[0]) / 3, cy = (a.p[1] + b.p[1] + c.p[1]) / 3, cz = (a.p[2] + b.p[2] + c.p[2]) / 3;
    colors.push(a.k === b.k && b.k === c.k ? a.k : colorAt(cx, cy, cz, (a.n[2] + b.n[2] + c.n[2]) / 3));
  };
  const split = (a: V, b: V, c: V, depth: number): void => {
    if (depth === 0 || (a.k === b.k && b.k === c.k)) { emit(a, b, c); return; }
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    split(a, ab, ca, depth - 1); split(ab, b, bc, depth - 1); split(ca, bc, c, depth - 1); split(ab, bc, ca, depth - 1);
  };
  const mixed: number[] = [];
  for (let t = 0; t < I.length; t += 3) {
    if (vKey[I[t]!] === vKey[I[t + 1]!] && vKey[I[t + 1]!] === vKey[I[t + 2]!]) keep.push(t); else mixed.push(t);
  }
  // shared-vertex triangles first (their colour is the one their corners agree on), then the split border triangles
  const outIdx: number[] = [], outColors: ColorKey[] = [];
  for (const t of keep) { outIdx.push(I[t]!, I[t + 1]!, I[t + 2]!); outColors.push(vKey[I[t]!]!); }
  for (const t of mixed) split(vert(I[t]!), vert(I[t + 1]!), vert(I[t + 2]!), BORDER_SPLITS);
  const positions = new Float32Array(P.length + pos.length); positions.set(P); positions.set(pos, P.length);
  const normals = new Float32Array(N.length + nor.length); normals.set(N); normals.set(nor, N.length);
  const ao = new Float32Array(nv + occ.length); ao.set(A); ao.set(occ, nv);
  return { positions, normals, ao, indices: Uint32Array.from([...outIdx, ...idx]), colors: [...outColors, ...colors] };
}

/** Trilinear sample of the field; outside the grid counts as open space. */
function sample(g: Grid3, x: number, y: number, z: number): number {
  const fx = (x - g.ox) / g.h, fy = (y - g.oy) / g.h, fz = (z - g.oz) / g.h;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  if (i < 0 || j < 0 || k < 0 || i >= g.nx - 1 || j >= g.ny - 1 || k >= g.nz - 1) return 1e3;
  const tx = fx - i, ty = fy - j, tz = fz - k, d = g.data, sx = 1, sy = g.nx, sz = g.nx * g.ny;
  const o = k * sz + j * sy + i;
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(d[o]!, d[o + sx]!, tx), l(d[o + sy]!, d[o + sy + sx]!, tx), ty),
    l(l(d[o + sz]!, d[o + sz + sx]!, tx), l(d[o + sz + sy]!, d[o + sz + sy + sx]!, tx), ty), tz);
}

/** Distances (mm) along the normal at which the field is probed for nearby solid, and how much each counts. */
const AO_STEPS: readonly [number, number][] = [[0.8, 1], [1.6, 0.8], [2.8, 0.6], [4.4, 0.4]];
const AO_STRENGTH = 1.1;

/**
 * Ambient occlusion from the distance field (the classic SDF trick): a step out along the normal should find the
 * surface that far away; where it finds solid closer (a crease, the gap between leg and belly) the point is shaded.
 */
function occlusion(g: Grid3, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  let occ = 0, total = 0;
  for (const [d, w] of AO_STEPS) {
    const f = Math.min(d, sample(g, x + nx * d, y + ny * d, z + nz * d));
    occ += w * Math.max(0, d - f) / d;
    total += w;
  }
  // the bed shades the underside a little too
  const bed = y < 4 && ny < 0 ? (1 - y / 4) * -ny * 0.5 : 0;
  return Math.max(0.3, 1 - AO_STRENGTH * occ / total - bed);
}
