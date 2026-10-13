/**
 * Volume field of a model: every 3D part (a rounded extrusion of its 2D outline, see spec3d)
 * is evaluated as an exact signed distance and fused with a smooth minimum, which removes
 * inner walls and sharp seams and grows organic joints. Units: mm, y up.
 */
import type { Part3D } from '../art/spec3d';
import type { XY } from '../art/path';
import type { Grid3 } from './surfacenets';

export const BIG = 6; // mm, "far away" distance written into empty space

/**
 * Slits between two parts narrower than about 0.9 mm cannot be printed (they fuse or leave a hairline void), so the
 * field closes them: where the distances to two different parts add up to less than GAP, the point is filled.
 */
export const GAP_MM = 1.2;
/** Closing radius for slits inside one outline (slits narrower than twice this are filled). */
export const SLIT_CLOSE_MM = 0.5;

/** Polynomial smooth minimum: blends only where the two fields are within k of each other. */
export const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

interface Edge { ax: number; ay: number; bx: number; by: number }

function edgesOf(polys: XY[][]): Edge[] {
  const e: Edge[] = [];
  for (const poly of polys) for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    e.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
  }
  return e;
}

/** Signed distance from (x, y) to the union of polygons: negative inside. */
function sdPolys(edges: Edge[], polys: XY[][], x: number, y: number): number {
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
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    if (c) { inside = true; break; }
  }
  const d = Math.sqrt(d2);
  return inside ? -d : d;
}

export function gridDims(parts: Part3D[], h: number, margin = 3): { nx: number; ny: number; nz: number; ox: number; oy: number; oz: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of parts) {
    for (const poly of p.polys) for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    z0 = Math.min(z0, p.z - p.thickness / 2); z1 = Math.max(z1, p.z + p.thickness / 2);
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
  const edges = edgesOf(part.polys);
  if (!edges.length) return;
  let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity;
  for (const poly of part.polys) for (const [x, y] of poly) { px0 = Math.min(px0, x); px1 = Math.max(px1, x); py0 = Math.min(py0, y); py1 = Math.max(py1, y); }
  const pad = k + 2 * h + part.bevel;
  const i0 = Math.max(0, Math.floor((px0 - pad - g.ox) / h)), i1 = Math.min(nx - 1, Math.ceil((px1 + pad - g.ox) / h));
  const j0 = Math.max(0, Math.floor((py0 - pad - g.oy) / h)), j1 = Math.min(ny - 1, Math.ceil((py1 + pad - g.oy) / h));
  const half = part.thickness / 2, r = Math.min(part.bevel, half - 0.01);
  const k0 = Math.max(0, Math.floor((part.z - half - pad - g.oz) / h)), k1 = Math.min(nz - 1, Math.ceil((part.z + half + pad - g.oz) / h));
  const w2 = i1 - i0 + 1;
  const far = k + 2 * h; // beyond this distance the field value is irrelevant (only its sign, which stays positive)
  const d2 = new Float32Array(w2 * (j1 - j0 + 1));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) d2[(j - j0) * w2 + (i - i0)] = sdPolys(edges, part.polys, g.ox + i * h, g.oy + j * h);
  closeOutline(d2, w2, j1 - j0 + 1, h, SLIT_CLOSE_MM);
  for (let kk = k0; kk <= k1; kk++) {
    const wy = Math.abs(g.oz + kk * h - part.z) - half + r;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const sd = d2[(j - j0) * w2 + (i - i0)]!;
      if (sd > far) continue; // farther than the blend radius from this part's outline: cannot matter
      const wx = sd + r;
      const px = wx > 0 ? wx : 0, py = wy > 0 ? wy : 0;
      const d3 = Math.min(Math.max(wx, wy), 0) + Math.sqrt(px * px + py * py) - r;
      const idx = (kk * ny + j) * nx + i;
      const cur = g.data[idx]!;
      if (d3 > cur + k) continue;
      let v = smin(cur, d3, k);
      if (cur > 0 && d3 > 0 && cur + d3 < GAP_MM) v = Math.min(v, Math.min(cur, d3) - (GAP_MM - cur - d3) * 3); // close hairline slits
      g.data[idx] = v;
    }
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
