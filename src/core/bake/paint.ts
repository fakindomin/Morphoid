/**
 * Colours for multi-material printing (AMS): every triangle of a baked piece gets one of four filaments,
 * c1 (body), c2 (accents), c3 (details) and white (eye whites, teeth).
 *  - On the solid, a triangle takes the colour of the element it is closest to (an eye on the head, a horn).
 *  - Elements too thin to be geometry (pupils, brows, mouth, inner ear) and the body pattern are painted on the
 *    surface where their outline covers it: colour regions, not relief.
 */
import type { XY } from '../art/path';
import type { ColorKey, Part3D } from '../art/spec3d';
import { edgesOf, partBox, sdPolys, toLocal, type Edge } from './field';
import type { Mesh } from './surfacenets';
import { limbSd } from '../art/limb';

/** AMS slot (0-based) of every colour the drawing uses: shades of a palette colour print in that colour. */
export const FILAMENT_OF: Record<ColorKey, number> = { c1: 0, c1dark: 0, c2: 1, c2soft: 1, c3: 2, ink: 2, white: 3 };
export const FILAMENTS = 4;

/** How far (mm) along Z a colour region may sit from the surface it is painted on. */
const DECAL_Z_MM = 1.5;
/** Solid elements farther than this from a triangle are not considered for its colour. */
const REACH_MM = 2;

interface Shape { part: Part3D; edges: Edge[]; lo: [number, number, number]; hi: [number, number, number] }

function shapeOf(part: Part3D, pad: number): Shape {
  const b = partBox(part);
  const lo = b.lo.map((v) => v - pad) as [number, number, number], hi = b.hi.map((v) => v + pad) as [number, number, number];
  return { part, edges: edgesOf(part.polys), lo, hi };
}

const within = (s: Shape, x: number, y: number, z: number): boolean =>
  x >= s.lo[0] && x <= s.hi[0] && y >= s.lo[1] && y <= s.hi[1] && z >= s.lo[2] && z <= s.hi[2];

/** Signed distance to the rounded slab of a part (the same shape the bake fuses, without the slit closing). */
function partSd(s: Shape, x: number, y: number, z: number): number {
  const { part } = s;
  if (part.limb) return limbSd(part.limb, x, y, z);
  const half = part.thickness / 2, r = Math.min(part.bevel, half - 0.01);
  const [u, v, w] = toLocal(part, x, y, z);
  const wx = sdPolys(s.edges, part.polys, u, v) + r, wy = Math.abs(w - part.z) - half + r;
  const px = Math.max(wx, 0), py = Math.max(wy, 0);
  const d = Math.min(Math.max(wx, wy), 0) + Math.hypot(px, py) - r;
  return part.ribs ? Math.min(d, limbSd(part.ribs, x, y, z)) : d;
}

/**
 * Filament (0-based AMS slot) of every triangle of `mesh` (model coordinates).
 * `solids` are the elements this piece is made of, `decals` the thin ones painted on it, `pattern` the body pattern
 * (painted c3 on the torso).
 */
export function paintMesh(mesh: Mesh, solids: Part3D[], decals: Part3D[], pattern: XY[][] = []): Uint8Array {
  const P = mesh.positions, I = mesh.indices, nt = I.length / 3;
  const out = new Uint8Array(nt);
  const solid = solids.map((p) => shapeOf(p, REACH_MM));
  const decal = decals.map((p) => shapeOf(p, DECAL_Z_MM));
  const patEdges = pattern.length ? edgesOf(pattern) : [];
  for (let t = 0; t < nt; t++) {
    const a = 3 * I[3 * t]!, b = 3 * I[3 * t + 1]!, c = 3 * I[3 * t + 2]!;
    const x = (P[a]! + P[b]! + P[c]!) / 3, y = (P[a + 1]! + P[b + 1]! + P[c + 1]!) / 3, z = (P[a + 2]! + P[b + 2]! + P[c + 2]!) / 3;
    // outward normal (z part only is needed: which side of the model the triangle faces)
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!;
    const ex = P[b + 2]! - P[a + 2]!, ez = P[c + 2]! - P[a + 2]!;
    const nz = ux * vy - uy * vx, nlen = Math.hypot(nz, uy * ez - ex * vy, ex * vx - ux * ez) || 1;
    let color: ColorKey = solids[0]?.color ?? 'c1', best = Infinity, near: Part3D | null = null;
    for (const s of solid) {
      if (!within(s, x, y, z)) continue;
      const d = partSd(s, x, y, z);
      if (d < best) { best = d; color = s.part.color; near = s.part; }
    }
    if (near?.slot === 'torso' && patEdges.length && sdPolys(patEdges, pattern, x, y) < 0) color = 'c3';
    // colour regions: the last one drawn wins (a pupil over the eye), only on the face turned to its side
    for (const s of decal) {
      if (!within(s, x, y, z)) continue;
      const side = s.part.side || Math.sign(s.part.z) || Math.sign(z);
      if (nz * side / nlen < 0.2) continue;
      if (sdPolys(s.edges, s.part.polys, x, y) < 0) color = s.part.color;
    }
    out[t] = FILAMENT_OF[color];
  }
  return out;
}
