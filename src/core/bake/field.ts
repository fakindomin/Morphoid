/**
 * Volume field of a model: every 3D part (a rounded extrusion of its 2D outline, see spec3d)
 * is evaluated as an exact signed distance and fused with a smooth minimum, which removes
 * inner walls and sharp seams and grows organic joints. Units: mm, y up.
 */
import type { Part3D } from '../art/spec3d';
import type { XY } from '../art/path';
import type { Grid3 } from './surfacenets';
import { limbBox, limbField, limbSd, type Limb } from '../art/limb';
import { coatDepth, type Coat } from '../art/coat';
import { reliefDepth } from '../art/relief';
import { applyCuts } from '../art/form';

export const BIG = 6; // mm, "far away" distance written into empty space

/**
 * Slits between two parts narrower than about 0.9 mm cannot be printed (they fuse or leave a hairline void). The smooth
 * union closes them on its own: with a blend radius k it fills every gap narrower than about k / 2 between two parts
 * (bake.ts sets k = 2.4 mm, so gaps up to 1.2 mm). An extra hard rule for this left visible ripples in the crevices.
 */
/** Closing radius for slits inside one outline (slits narrower than twice this are filled). */
export const SLIT_CLOSE_MM = 0.5;

/** Polynomial smooth minimum: blends only where the two fields are within k of each other. */
export const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

export interface Edge { ax: number; ay: number; bx: number; by: number }

export function edgesOf(polys: XY[][]): Edge[] {
  const e: Edge[] = [];
  for (const poly of polys) for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    e.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
  }
  return e;
}

/** Signed distance from (x, y) to the union of polygons: negative inside. */
export function sdPolys(edges: Edge[], polys: XY[][], x: number, y: number): number {
  let d2 = Infinity;
  for (const e of edges) {
    const dx = e.bx - e.ax, dy = e.by - e.ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - e.ax) * dx + (y - e.ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = e.ax + t * dx - x, py = e.ay + t * dy - y;
    const d = px * px + py * py;
    if (d < d2) d2 = d;
  }
  let inside = false;
  for (const poly of polys) {
    // non-zero winding, like the SVG fill of the 2D drawing: a self-overlapping outline (a tight tail curl) stays solid
    let wn = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) wn += a[1] > y ? 1 : -1;
    }
    if (wn !== 0) { inside = true; break; }
  }
  const d = Math.sqrt(d2);
  return inside ? -d : d;
}

/** A point in a part's own frame: (outline u, outline v, extrusion w). Side-view parts: (x, y, z); top-view: (x, z, y). */
export const toLocal = (p: Part3D, x: number, y: number, z: number): [number, number, number] =>
  p.plane === 'xz' ? [x, z, y] : [x, y, z];

/** World bounding box of a part's slab (without bevel growth: the slab never leaves its outline and thickness). */
export function partBox(p: Part3D): { lo: [number, number, number]; hi: [number, number, number] } {
  if (p.limb) return limbBox(p.limb);
  const slab = slabBox(p);
  if (!p.ribs) return slab;
  const r = limbBox(p.ribs);
  return { lo: slab.lo.map((v, i) => Math.min(v, r.lo[i]!)) as [number, number, number], hi: slab.hi.map((v, i) => Math.max(v, r.hi[i]!)) as [number, number, number] };
}

function slabBox(p: Part3D): { lo: [number, number, number]; hi: [number, number, number] } {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const poly of p.polys) for (const [u, v] of poly) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const w0 = p.z - p.thickness / 2, w1 = p.z + p.thickness / 2;
  return p.plane === 'xz' ? { lo: [u0, w0, v0], hi: [u1, w1, v1] } : { lo: [u0, v0, w0], hi: [u1, v1, w1] };
}

export function gridDims(parts: Part3D[], h: number, margin = 3): { nx: number; ny: number; nz: number; ox: number; oy: number; oz: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of parts) {
    const { lo, hi } = partBox(p);
    x0 = Math.min(x0, lo[0]); y0 = Math.min(y0, lo[1]); z0 = Math.min(z0, lo[2]);
    x1 = Math.max(x1, hi[0]); y1 = Math.max(y1, hi[1]); z1 = Math.max(z1, hi[2]);
  }
  const m = margin;
  // grid phase is fixed in space (multiples of h): two bakes of nearly the same model give comparable meshes
  const ox = Math.floor((x0 - m) / h) * h, oy = Math.floor((y0 - m) / h) * h, oz = Math.floor((z0 - m) / h) * h;
  const nx = Math.ceil((x1 + m - ox) / h) + 1, ny = Math.ceil((y1 + m - oy) / h) + 1, nz = Math.ceil((z1 + m - oz) / h) + 1;
  return { nx, ny, nz, ox, oy, oz };
}

export function makeGrid(parts: Part3D[], h: number, margin = 3): Grid3 {
  const d = gridDims(parts, h, margin);
  const n = d.nx * d.ny * d.nz;
  return { ...d, h, data: new Float32Array(n).fill(BIG), owner: new Uint8Array(n) };
}

/**
 * Appendages each grow out of the body with a soft fillet, but never out of each other: a wing next to an ear,
 * or a horn next to a crest, meets it with a plain (sharp) union, so neighbours stay two separate shapes.
 */
const GROUP: Partial<Record<string, number>> = {
  ear: 1, earIn: 1, wingNear: 2, wingFar: 2, wingRibs: 2, horns: 3, antennae: 4, tuft: 5, mane: 6, finD: 7, finP: 8,
};
export const blendGroup = (slot: string): number => GROUP[slot] ?? 0;

/** Body masses: they melt into each other with the full blend radius (bake BLEND_MM). */
const BODY_MASS = new Set<string>(['legB', 'legF', 'torso', 'neck', 'head', 'snout', 'saddle', 'collar', 'neckDecor', 'arms']);
/** Blend radius of an appendage as a share of its own thickness (rule "hierarchia zlewania"). */
export const BLEND_SHARE = 0.42;
/** The tightest blend of an appendage (mm): tighter leaves hairline slits at its root that a printer cannot close. */
export const BLEND_MIN_MM = 0.7;

/** How thick a part is (mm): a slab's thickness, a round part's mean diameter. */
export function partSize(p: Part3D): number {
  const l = p.limb;
  if (l && (l.cones.length || l.domes.length)) {
    let s = 0, n = 0;
    for (const c of l.cones) { s += c.ra + c.rb; n += 2; }
    for (const d of l.domes) { s += Math.min(d.r[0], d.r[1], d.r[2]); n++; }
    return (2 * s) / n;
  }
  return p.thickness;
}

/**
 * Blend radius of a part: body masses melt into each other softly (`big`), an appendage only as much as its own size
 * allows. An ear or a horn then grows out of the head with a small fillet and stays a readable shape, instead of the
 * thick roll of "plasticine" every joint got with one radius for all.
 */
export function blendOf(p: Part3D, big: number): number {
  // wings hang beside the torso across a gap that only the full blend bridges
  if (BODY_MASS.has(p.slot) || p.slot === 'wingNear' || p.id.startsWith('muscle')) return big;
  return Math.min(big, Math.max(BLEND_MIN_MM, partSize(p) * (p.blendShare ?? BLEND_SHARE)));
}

/**
 * Fuse all parts of a piece: body masses first, then appendages from the biggest blend to the smallest (each union is
 * shaped by the smaller part), then the crisp insets and the cuts.
 */
export function fuseParts(g: Grid3, parts: Part3D[], big: number, inset: number, carve: number): void {
  const solid = parts.filter((p) => !p.inset && !p.carve).map((p) => ({ p, k: blendOf(p, big) }));
  solid.sort((a, b) => b.k - a.k);
  for (const { p, k } of solid) addPart(g, p, k);
  for (const p of parts) if (p.inset) addPart(g, p, inset);
  for (const p of parts) if (p.carve) addPart(g, p, carve);
}

/** Union of the node with a new value: smooth with the body and the part's own group, sharp with another appendage. */
function unite(g: Grid3, idx: number, d3: number, k: number, grp: number): void {
  const cur = g.data[idx]!;
  if (d3 > cur + k) return;
  const o = g.owner ? g.owner[idx]! : 0;
  const sharp = grp !== 0 && o !== 0 && o !== grp;
  g.data[idx] = sharp ? Math.min(cur, d3) : smin(cur, d3, k);
  if (g.owner && d3 < cur) g.owner[idx] = grp;
}

/**
 * Closes slits and hairline notches inside ONE outline (radius rc): a cell is filled when it is
 * within rc of the shape on every side. A 0.3 mm sliver cannot be printed anyway, and left in the
 * field it ends up as a tiny through-hole once the topology is repaired.
 */
export function closeOutline(d2: Float32Array, w: number, hgt: number, h: number, rc: number): void {
  const r = Math.max(1, Math.round(rc / h));
  const disk: [number, number][] = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r) disk.push([di, dj]);
  const dil = new Uint8Array(w * hgt);
  for (let i = 0; i < d2.length; i++) dil[i] = d2[i]! - rc < 0 ? 1 : 0;
  const fill: number[] = [];
  for (let j = r; j < hgt - r; j++) for (let i = r; i < w - r; i++) {
    const idx = j * w + i;
    if (d2[idx]! <= 0 || !dil[idx]) continue; // only outside cells that dilation covered can be slit cells
    let all = true;
    for (const [di, dj] of disk) if (!dil[(j + dj) * w + i + di]) { all = false; break; }
    if (all) fill.push(idx);
  }
  for (const idx of fill) d2[idx] = Math.min(d2[idx]!, -0.2);
}

/** Width multiplier of a part at x (its anatomy profile: chest, waist, haunches), 1 without one. */
export function widthAt(p: Part3D, x: number): number {
  const w = p.widths;
  if (!w) return 1;
  const f = Math.min(w.k.length - 1, Math.max(0, (x - w.x0) / w.dx)), i = Math.min(w.k.length - 2, Math.floor(f));
  return w.k[i]! + (w.k[i + 1]! - w.k[i]!) * (f - i);
}

/**
 * Signed distance to a part's slab from the 2D distance `sd` to its outline and the offset `w` from its centre plane
 * along the extrusion: a box with rounded edges, or with `dome` a flat inner face and a round outer side.
 */
export function slabDist(p: Part3D, sd: number, w: number, x?: number, y?: number): number {
  const d = slabBase(p, sd, w, x);
  // planes cut into a side-view part (cheeks, temples, the back), see form.ts
  return p.cuts && x !== undefined && y !== undefined && p.plane !== 'xz' ? applyCuts(p.cuts, d, x, y, w + p.z) : d;
}

function slabBase(p: Part3D, sd: number, w: number, x?: number): number {
  const half = (p.thickness / 2) * (x === undefined ? 1 : widthAt(p, x));
  if (p.dome && p.side) {
    // the outer half of a slab grown inwards by R and rounded by R, cut flat at the inner face
    const R = Math.min(p.dome, p.thickness), o = w * (p.domeSide ?? p.side), he = half + R / 2;
    const qx = sd + R, qy = Math.abs(o + R / 2) - he + R;
    const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - R;
    return Math.max(d, -half - o);
  }
  const r = Math.min(p.bevel, half - 0.01);
  const wx = sd + r, wy = Math.abs(w) - half + r;
  const px = Math.max(wx, 0), py = Math.max(wy, 0);
  return Math.min(Math.max(wx, wy), 0) + Math.hypot(px, py) - r;
}

/** How deep (mm) the body pattern is sunk, and the half width (mm) of its soft edge. */
const PATTERN_DEPTH = 0.3;
const PATTERN_EDGE = 0.35;
const sstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Fuse a part into the grid with a smooth union. */
export function addPart(g: Grid3, part: Part3D, k: number): void {
  const { h, nx, ny, nz } = g;
  const grp = blendGroup(part.slot);
  if (part.limb) { addLimb(g, part.limb, k, part.coat, part.carve, grp); return; }
  if (part.ribs) addLimb(g, part.ribs, k, undefined, false, grp);
  const edges = edgesOf(part.polys);
  if (!edges.length) return;
  const pad = k + 2 * h + part.bevel;
  const { lo, hi } = slabBox(part);
  const i0 = Math.max(0, Math.floor((lo[0] - pad - g.ox) / h)), i1 = Math.min(nx - 1, Math.ceil((hi[0] + pad - g.ox) / h));
  const j0 = Math.max(0, Math.floor((lo[1] - pad - g.oy) / h)), j1 = Math.min(ny - 1, Math.ceil((hi[1] + pad - g.oy) / h));
  const k0 = Math.max(0, Math.floor((lo[2] - pad - g.oz) / h)), k1 = Math.min(nz - 1, Math.ceil((hi[2] + pad - g.oz) / h));
  const half = part.thickness / 2, r = Math.min(part.bevel, half - 0.01), dome = !!(part.dome && part.side);
  // the outline's 2D distance is computed once on its own plane (i, j) or (i, k), then swept along the third axis
  const top = part.plane === 'xz';
  const [v0, v1, vo] = top ? [k0, k1, g.oz] : [j0, j1, g.oy];
  const [w0, w1, wo] = top ? [j0, j1, g.oy] : [k0, k1, g.oz];
  const w2 = i1 - i0 + 1;
  const far = k + 2 * h; // beyond this distance the field value is irrelevant (only its sign, which stays positive)
  const d2 = new Float32Array(w2 * (v1 - v0 + 1));
  for (let v = v0; v <= v1; v++) for (let i = i0; i <= i1; i++) d2[(v - v0) * w2 + (i - i0)] = sdPolys(edges, part.polys, g.ox + i * h, vo + v * h);
  closeOutline(d2, w2, v1 - v0 + 1, h, SLIT_CLOSE_MM);
  const cuts = top ? undefined : part.cuts;
  const slab = (sd: number, wz: number, x: number, y: number): number => {
    if (cuts) return slabDist(part, sd, wz, x, y);
    if (dome) return slabDist(part, sd, wz);
    if (part.widths) return slabDist(part, sd, wz, x);
    const wx = sd + r, wy = Math.abs(wz) - half + r;
    const px = wx > 0 ? wx : 0, py = wy > 0 ? wy : 0;
    return Math.min(Math.max(wx, wy), 0) + Math.sqrt(px * px + py * py) - r;
  };
  const coat = top ? undefined : part.coat, relief = top ? undefined : part.relief;
  const patE = !top && part.pattern?.length ? edgesOf(part.pattern) : null;
  const vMax = v1 - v0;
  for (let w = w0; w <= w1; w++) {
    const wz = wo + w * h - part.z;
    for (let v = v0; v <= v1; v++) for (let i = i0; i <= i1; i++) {
      const sd = d2[(v - v0) * w2 + (i - i0)]!;
      if (sd > far) continue; // farther than the blend radius from this part's outline: cannot matter
      const x = g.ox + i * h;
      const y = vo + v * h;
      let d3 = slab(sd, wz, x, y);
      if (coat && Math.abs(d3) < 1.5) { // coat relief: sunk along the surface normal (the slab's own gradient)
        const ia = Math.max(i - 1, i0), ib = Math.min(i + 1, i1), va = Math.max(v - 1 - v0, 0), vb = Math.min(v + 1 - v0, vMax);
        const gx = slab(d2[(v - v0) * w2 + (ib - i0)]!, wz, g.ox + ib * h, y) - slab(d2[(v - v0) * w2 + (ia - i0)]!, wz, g.ox + ia * h, y);
        const gy = slab(d2[vb * w2 + (i - i0)]!, wz, x, vo + (vb + v0) * h) - slab(d2[va * w2 + (i - i0)]!, wz, x, vo + (va + v0) * h);
        const gz = slab(sd, wz + h, x, y) - slab(sd, wz - h, x, y);
        const gl = Math.hypot(gx, gy, gz) || 1;
        d3 += coatDepth(coat, x, vo + v * h, wz + part.z, gx / gl, gy / gl, gz / gl);
      }
      if (relief && Math.abs(d3) < 1.2) d3 += reliefDepth(relief, x, vo + v * h);
      if (patE && Math.abs(d3) < 1.2) d3 += PATTERN_DEPTH * (1 - sstep(-PATTERN_EDGE, PATTERN_EDGE, sdPolys(patE, part.pattern!, x, vo + v * h)));
      const idx = top ? (v * ny + w) * nx + i : (w * ny + v) * nx + i;
      const cur = g.data[idx]!;
      if (part.carve) { if (d3 < k) g.data[idx] = -smin(-cur, d3, k); continue; } // a hollow cut into the solid
      unite(g, idx, d3, k, grp);
    }
  }
}

/** Fuse a true 3D part (a jointed leg) into the grid with a smooth union. */
function addLimb(g: Grid3, limb: Limb, k: number, coat?: Coat, carve = false, grp = 0): void {
  const { h, nx, ny, nz } = g;
  const pad = k + 2 * h;
  const { lo, hi } = limbBox(limb);
  const i0 = Math.max(0, Math.floor((lo[0] - pad - g.ox) / h)), i1 = Math.min(nx - 1, Math.ceil((hi[0] + pad - g.ox) / h));
  const j0 = Math.max(0, Math.floor((lo[1] - pad - g.oy) / h)), j1 = Math.min(ny - 1, Math.ceil((hi[1] + pad - g.oy) / h));
  const k0 = Math.max(0, Math.floor((lo[2] - pad - g.oz) / h)), k1 = Math.min(nz - 1, Math.ceil((hi[2] + pad - g.oz) / h));
  if (i1 < i0 || j1 < j0 || k1 < k0) return;
  const bx = i1 - i0 + 1, by = j1 - j0 + 1;
  const field = limbField(limb, g.ox + i0 * h, g.oy + j0 * h, g.oz + k0 * h, h, bx, by, k1 - k0 + 1, pad);
  for (let kk = k0; kk <= k1; kk++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    let d3 = field[((kk - k0) * by + (j - j0)) * bx + (i - i0)]!;
    if (d3 === Infinity) continue;
    const idx = (kk * ny + j) * nx + i, cur = g.data[idx]!;
    if (carve) { // smooth subtraction: the solid minus the limb
      if (d3 < k) g.data[idx] = -smin(-cur, d3, k);
      continue;
    }
    const x = g.ox + i * h, y = g.oy + j * h, z = g.oz + kk * h;
    if (coat && Math.abs(d3) < 1.5) d3 += limbCoat(limb, coat, x, y, z, h);
    unite(g, idx, d3, k, grp);
  }
}

/**
 * The coat relief on a round limb, along its surface normal. It fades out where the limb is thin (a tail's tip), so a
 * groove never eats into the narrow core: the limb's depth below the surface is probed 1.5 mm in.
 */
function limbCoat(limb: Limb, coat: Coat, x: number, y: number, z: number, h: number): number {
  const gx = limbSd(limb, x + h, y, z) - limbSd(limb, x - h, y, z);
  const gy = limbSd(limb, x, y + h, z) - limbSd(limb, x, y - h, z);
  const gz = limbSd(limb, x, y, z + h) - limbSd(limb, x, y, z - h);
  const gl = Math.hypot(gx, gy, gz) || 1, nx = gx / gl, ny = gy / gl, nz = gz / gl;
  const d0 = limbSd(limb, x, y, z), core = -limbSd(limb, x - nx * (1.5 + d0), y - ny * (1.5 + d0), z - nz * (1.5 + d0));
  const thick = Math.min(1, Math.max(0, (core - 0.3) / 1.2));
  return thick * coatDepth(coat, x, y, z, nx, ny, nz);
}

/** Remove the slab |z| < z0 (the gap between a pair of wings: their inner faces stay flat). */
export function clipMid(g: Grid3, z0: number): void {
  const { nx, ny, nz, h } = g;
  for (let k = 0; k < nz; k++) {
    const d = z0 - Math.abs(g.oz + k * h);
    if (d <= 0) continue;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const idx = (k * ny + j) * nx + i; if (d > g.data[idx]!) g.data[idx] = d; }
  }
}

/** Keep only the half-space y >= y0 (flat cut, e.g. the underside of a printed head). */
export function clipBelow(g: Grid3, y0: number): void {
  const { nx, ny, nz, h } = g;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const d = -(g.oy + j * h - y0); // positive below the plane = outside
    for (let i = 0; i < nx; i++) { const idx = (k * ny + j) * nx + i; if (d > g.data[idx]!) g.data[idx] = d; }
  }
}
