/**
 * Will the figurine stand? Its centre of mass (every solid part: side-view area x thickness, mirrored pairs twice)
 * must lie over what it stands on: the soles from heel to toe, or the stand. Only the front-back direction is
 * checked: left and right are symmetric.
 */
import type { Rig } from '../rig';
import type { SlotPaths } from '../art/shapes';
import { ctxFor, SPEC_3D } from '../art/spec3d';
import type { XY } from '../art/path';

const area = (poly: readonly XY[]): { a: number; cx: number } => {
  let a = 0, cx = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x0, y0] = poly[j]!, [x1, y1] = poly[i]!;
    const c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c;
  }
  return a ? { a: Math.abs(a / 2), cx: cx / (3 * a) } : { a: 0, cx: 0 };
};

/**
 * Area and centroid x of the UNION of a slot's polygons: a jointed leg or a round tail is drawn as many overlapping
 * segment outlines, so summing their areas would count the overlaps several times.
 */
const STEP = 0.5;
function unionArea(polys: readonly (readonly XY[])[]): { a: number; cx: number } {
  if (polys.length === 1) return area(polys[0]!);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const poly of polys) for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  let n = 0, sx = 0;
  for (let y = y0 + STEP / 2; y < y1; y += STEP) for (let x = x0 + STEP / 2; x < x1; x += STEP) {
    if (polys.some((poly) => inside(poly, x, y))) { n++; sx += x; }
  }
  return n ? { a: n * STEP * STEP, cx: sx / n } : { a: 0, cx: 0 };
}
const inside = (poly: readonly XY[], x: number, y: number): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

export interface Balance {
  /** x of the centre of mass (mm) */
  com: number;
  /** x range it stands on (mm) */
  support: [number, number];
  /** how far the centre of mass is outside that range (mm, 0 = it stands) */
  outside: number;
}

export function balanceOf(paths: SlotPaths, rig: Rig): Balance {
  const ctx = ctxFor(rig);
  let m = 0, mx = 0;
  for (const [slot, spec] of Object.entries(SPEC_3D)) {
    if (!spec || slot === 'stand') continue;
    const t = spec.t(ctx) * (spec.mirror ? 2 : 1);
    const { a, cx } = unionArea(paths[slot as keyof SlotPaths].flatten(6));
    m += a * t; mx += a * t * cx;
  }
  const com = m ? mx / m : 0;
  let lo = Infinity, hi = -Infinity;
  const standPolys = paths.stand.flatten(6);
  if (standPolys.length) for (const poly of standPolys) for (const [x] of poly) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  else for (const slot of ['legB', 'legF', 'arms'] as const) for (const poly of paths[slot].flatten(6)) for (const [x, y] of poly) if (y < 0.3) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  if (lo > hi) return { com, support: [com, com], outside: 0 };
  return { com, support: [lo, hi], outside: Math.max(0, lo - com, com - hi) };
}
