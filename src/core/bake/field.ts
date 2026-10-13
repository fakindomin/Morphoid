/**
 * Volume field of a model: every 3D part (a rounded extrusion of its 2D outline, see spec3d)
 * is evaluated as an exact signed distance and fused with a smooth minimum, which removes
 * inner walls and sharp seams and grows organic joints. Units: mm, y up.
 */
import type { Part3D } from '../art/spec3d';
import type { XY } from '../art/path';
import type { Grid3 } from './surfacenets';
import { limbBox, limbSd } from '../art/limb';

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
  return { ...d, h, data: new Float32Array(d.nx * d.ny * d.nz).fill(BIG) };
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

/** Fuse a part into the grid with a smooth union. */
export function addPart(g: Grid3, part: Part3D, k: number): void {
  const { h, nx, ny, nz } = g;
  if (part.limb) { addLimb(g, part, k); return; }
  const edges = edgesOf(part.polys);
  if (!edges.length) return;
  const pad = k + 2 * h + part.bevel;
  const { lo, hi } = partBox(part);
  const i0 = Math.max(0, Math.floor((lo[0] - pad - g.ox) / h)), i1 = Math.min(nx - 1, Math.ceil((hi[0] + pad - g.ox) / h));
  const j0 = Math.max(0, Math.floor((lo[1] - pad - g.oy) / h)), j1 = Math.min(ny - 1, Math.ceil((hi[1] + pad - g.oy) / h));
  const k0 = Math.max(0, Math.floor((lo[2] - pad - g.oz) / h)), k1 = Math.min(nz - 1, Math.ceil((hi[2] + pad - g.oz) / h));
  const half = part.thickness / 2, r = Math.min(part.bevel, half - 0.01);
  // the outline's 2D distance is computed once on its own plane (i, j) or (i, k), then swept along the third axis
  const top = part.plane === 'xz';
  const [v0, v1, vo] = top ? [k0, k1, g.oz] : [j0, j1, g.oy];
  const [w0, w1, wo] = top ? [j0, j1, g.oy] : [k0, k1, g.oz];
  const w2 = i1 - i0 + 1;
  const far = k + 2 * h; // beyond this distance the field value is irrelevant (only its sign, which stays positive)
  const d2 = new Float32Array(w2 * (v1 - v0 + 1));
  for (let v = v0; v <= v1; v++) for (let i = i0; i <= i1; i++) d2[(v - v0) * w2 + (i - i0)] = sdPolys(edges, part.polys, g.ox + i * h, vo + v * h);
  closeOutline(d2, w2, v1 - v0 + 1, h, SLIT_CLOSE_MM);
  for (let w = w0; w <= w1; w++) {
    const wy = Math.abs(wo + w * h - part.z) - half + r;
    for (let v = v0; v <= v1; v++) for (let i = i0; i <= i1; i++) {
      const sd = d2[(v - v0) * w2 + (i - i0)]!;
      if (sd > far) continue; // farther than the blend radius from this part's outline: cannot matter
      const wx = sd + r;
      const px = wx > 0 ? wx : 0, py = wy > 0 ? wy : 0;
      const d3 = Math.min(Math.max(wx, wy), 0) + Math.sqrt(px * px + py * py) - r;
      const idx = top ? (v * ny + w) * nx + i : (w * ny + v) * nx + i;
      const cur = g.data[idx]!;
      if (d3 > cur + k) continue;
      g.data[idx] = smin(cur, d3, k);
    }
  }
}

/** Fuse a true 3D part (a jointed leg) into the grid with a smooth union. */
function addLimb(g: Grid3, part: Part3D, k: number): void {
  const { h, nx, ny, nz } = g, limb = part.limb!;
  const pad = k + 2 * h;
  const { lo, hi } = limbBox(limb);
  const i0 = Math.max(0, Math.floor((lo[0] - pad - g.ox) / h)), i1 = Math.min(nx - 1, Math.ceil((hi[0] + pad - g.ox) / h));
  const j0 = Math.max(0, Math.floor((lo[1] - pad - g.oy) / h)), j1 = Math.min(ny - 1, Math.ceil((hi[1] + pad - g.oy) / h));
  const k0 = Math.max(0, Math.floor((lo[2] - pad - g.oz) / h)), k1 = Math.min(nz - 1, Math.ceil((hi[2] + pad - g.oz) / h));
  for (let kk = k0; kk <= k1; kk++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const idx = (kk * ny + j) * nx + i, cur = g.data[idx]!;
    const d3 = limbSd(limb, g.ox + i * h, g.oy + j * h, g.oz + kk * h);
    if (d3 > cur + k) continue;
    g.data[idx] = smin(cur, d3, k);
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
