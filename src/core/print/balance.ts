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
    for (const poly of paths[slot as keyof SlotPaths].flatten(6)) {
      const { a, cx } = area(poly);
      m += a * t; mx += a * t * cx;
    }
  }
  const com = m ? mx / m : 0;
  let lo = Infinity, hi = -Infinity;
  const standPolys = paths.stand.flatten(6);
  if (standPolys.length) for (const poly of standPolys) for (const [x] of poly) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  else for (const slot of ['legB', 'legF'] as const) for (const poly of paths[slot].flatten(6)) for (const [x, y] of poly) if (y < 0.3) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  if (lo > hi) return { com, support: [com, com], outside: 0 };
  return { com, support: [lo, hi], outside: Math.max(0, lo - com, com - hi) };
}
