/**
 * The creature seen from the side, the front and from above, made from the same 3D parts the solid is built of.
 *
 * Each part is fused alone into a small distance grid (field.ts), the grid is flattened along each view axis (the
 * nearest surface wins) and the zero line is traced into outlines. Every part keeps its own outlines in every view, so
 * the sketch can morph a part from one view to the next.
 *
 * View coordinates (u, v) follow the side view's: u like rig x (drawn to the left), v like rig y (up).
 *   side   u = x, v = y   (seen from the near side, +z)
 *   front  u = z, v = y   (seen from ahead, +x)
 *   top    u = x, v = -z  (seen from above, +y; the near side at the bottom)
 */
import type { XY } from './path';
import type { SlotId } from './shapes';
import type { ColorKey, Part3D } from './spec3d';
import { addPart, BIG, makeGrid } from '../bake/field';

export type ViewId = 'side' | 'front' | 'top';
export const VIEWS: readonly ViewId[] = ['side', 'front', 'top'];

/**
 * A part seen in one view: per cell, where it starts and ends along the hidden axis (rig mm): `d` the nearest surface,
 * `e` the farthest one (NaN where the part is not).
 */
export interface DepthMap { u0: number; v0: number; cell: number; w: number; h: number; d: Float32Array; e: Float32Array }

export interface ViewPart {
  id: string;
  slot: SlotId;
  color: ColorKey;
  side: -1 | 0 | 1;
  /** outlines in view mm, biggest first */
  rings: XY[][];
  /** how near the viewer the part sits (bigger = nearer): the drawing order */
  depth: number;
  /** where the part's visible surface is along the hidden axis, to look up the side view's print heat */
  map: DepthMap;
}

export type ViewSet = Record<ViewId, ViewPart[]>;

/** Blend radius of a part with itself: only the rounding of its own pieces (a limb's joints). */
const SELF_BLEND = 0.4;

/** Grid step for a part (mm): fine for small parts, coarser for the trunk, about 48 cells across. */
const stepFor = (p: Part3D): number => {
  const pts = p.polys.flat();
  let span = p.thickness;
  if (pts.length) {
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    span = Math.max(span, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }
  return Math.min(1.1, Math.max(0.3, span / 48));
};

/** The three views of every visible part (cut-outs are left out: they only show as the solid's dents). */
export function projectViews(parts: readonly Part3D[]): ViewSet {
  const out: ViewSet = { side: [], front: [], top: [] };
  for (const p of parts) {
    if (p.carve) continue;
    const h = stepFor(p);
    const g = makeGrid([p], h, 1.5);
    addPart(g, p, SELF_BLEND);
    const { nx, ny, nz, ox, oy, oz } = g;
    // flatten along each axis: the smallest distance along the line of sight, and where the first inside cell is
    const side = flatten(nx, ny, (i, j, t) => (Math.max(0, nz - 1 - t) * ny + j) * nx + i, nz, g.data);
    const front = flatten(nz, ny, (k, j, t) => (k * ny + j) * nx + Math.max(0, nx - 1 - t), nx, g.data);
    const top = flatten(nx, nz, (i, k, t) => (k * ny + Math.max(0, ny - 1 - t)) * nx + i, ny, g.data);
    const base = { id: p.id, slot: p.slot, color: p.color, side: p.side };
    // the hidden coordinate of the first inside cell, counted from the viewer
    const sideRings = trace(side.f, nx, ny, (a, b) => [ox + a * h, oy + b * h]);
    if (sideRings.length) out.side.push({ ...base, rings: sideRings, depth: oz + (nz - 1 - side.mean) * h,
      map: depthMap(side, nx, ny, ox, oy, h, (t) => oz + (nz - 1 - t) * h) });
    const frontRings = trace(front.f, nz, ny, (a, b) => [oz + a * h, oy + b * h]);
    if (frontRings.length) out.front.push({ ...base, rings: frontRings, depth: ox + (nx - 1 - front.mean) * h,
      map: depthMap(front, nz, ny, oz, oy, h, (t) => ox + (nx - 1 - t) * h) });
    const topRings = trace(top.f, nx, nz, (a, b) => [ox + a * h, -(oz + b * h)]);
    if (topRings.length) out.top.push({ ...base, rings: topRings, depth: oy + (ny - 1 - top.mean) * h,
      map: flipV(depthMap(top, nx, nz, ox, oz, h, (t) => oy + (ny - 1 - t) * h)) });
  }
  for (const v of VIEWS) out[v] = depthOrder(out[v]);
  return out;
}

/** The exact cell of a depth map under a view point: [near, far], or null. */
function cellAt(m: DepthMap, u: number, v: number): number | null {
  const i = Math.round((u - m.u0) / m.cell), j = Math.round((v - m.v0) / m.cell);
  if (i < 0 || j < 0 || i >= m.w || j >= m.h) return null;
  const z = m.d[j * m.w + i]!;
  return Number.isNaN(z) ? null : z;
}

const boxOf = (p: ViewPart): [number, number, number, number] => {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const r of p.rings) for (const [u, v] of r) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return [u0, u1, v0, v1];
};

/**
 * Back to front, the painter's way: where two parts overlap, the one whose surface is nearer over most of the overlap
 * is drawn later (an eye over the head, the Pysk over the chest). Cycles fall back to the mean depth.
 */
function depthOrder(list: ViewPart[]): ViewPart[] {
  const n = list.length, boxes = list.map(boxOf);
  const after: Set<number>[] = list.map(() => new Set()); // after[i]: parts that must be drawn after i
  const blocks = new Array<number>(n).fill(0);
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const A = boxes[a]!, B = boxes[b]!;
    const u0 = Math.max(A[0], B[0]), u1 = Math.min(A[1], B[1]), v0 = Math.max(A[2], B[2]), v1 = Math.min(A[3], B[3]);
    if (u1 <= u0 || v1 <= v0) continue;
    const step = Math.max(0.4, Math.min(u1 - u0, v1 - v0) / 14);
    let va = 0, vb = 0;
    for (let v = v0 + step / 2; v < v1; v += step) for (let u = u0 + step / 2; u < u1; u += step) {
      const za = cellAt(list[a]!.map, u, v), zb = cellAt(list[b]!.map, u, v);
      if (za === null || zb === null) continue;
      if (za > zb + 0.05) va++; else if (zb > za + 0.05) vb++;
    }
    if (va === vb) continue;
    const [back, front] = va > vb ? [b, a] : [a, b];
    after[back]!.add(front);
    blocks[front]!++;
  }
  const out: ViewPart[] = [], done = new Array<boolean>(n).fill(false);
  for (let k = 0; k < n; k++) {
    // of the parts nothing still has to be drawn under, the farthest; a cycle takes the farthest of all that are left
    let pick = -1;
    for (let i = 0; i < n; i++) if (!done[i] && blocks[i] === 0 && (pick < 0 || list[i]!.depth < list[pick]!.depth)) pick = i;
    if (pick < 0) for (let i = 0; i < n; i++) if (!done[i] && (pick < 0 || list[i]!.depth < list[pick]!.depth)) pick = i;
    done[pick] = true;
    out.push(list[pick]!);
    for (const j of after[pick]!) blocks[j]!--;
  }
  return out;
}

/** Min of the field along a line of sight (t = 0 at the viewer) for every (a, b), and the first t inside. */
interface Flat { f: Float32Array; at: Float32Array; last: Float32Array; mean: number }
function flatten(na: number, nb: number, idx: (a: number, b: number, t: number) => number, nt: number, data: Float32Array): Flat {
  const f = new Float32Array(na * nb).fill(BIG), at = new Float32Array(na * nb).fill(-1), last = new Float32Array(na * nb).fill(-1);
  let sum = 0, cnt = 0;
  for (let b = 0; b < nb; b++) for (let a = 0; a < na; a++) {
    let m = BIG, first = -1, end = -1;
    for (let t = 0; t < nt; t++) {
      const d = data[idx(a, b, t)]!;
      if (d < m) m = d;
      if (d < 0) { if (first < 0) first = t; end = t; }
    }
    f[b * na + a] = m;
    at[b * na + a] = first;
    last[b * na + a] = end;
    if (first >= 0) { sum += first; cnt++; }
  }
  return { f, at, last, mean: cnt ? sum / cnt : nt / 2 };
}

function depthMap(fl: Flat, w: number, h: number, u0: number, v0: number, cell: number, hidden: (t: number) => number): DepthMap {
  const d = new Float32Array(w * h).fill(NaN), e = new Float32Array(w * h).fill(NaN);
  for (let i = 0; i < d.length; i++) if (fl.at[i]! >= 0) { d[i] = hidden(fl.at[i]!); e[i] = hidden(fl.last[i]!); }
  return { u0, v0, cell, w, h, d, e };
}

/** The top view's v is -z: mirror the map's rows to match. */
function flipV(m: DepthMap): DepthMap {
  const flip = (src: Float32Array): Float32Array => {
    const out = new Float32Array(src.length);
    for (let j = 0; j < m.h; j++) out.set(src.subarray((m.h - 1 - j) * m.w, (m.h - j) * m.w), j * m.w);
    return out;
  };
  return { ...m, v0: -(m.v0 + (m.h - 1) * m.cell), d: flip(m.d), e: flip(m.e) };
}

/** Where the part spans along the hidden axis under a view point (near, far), from the nearest filled cell; null if not there. */
export function spanAt(m: DepthMap, u: number, v: number): [number, number] | null {
  const i = Math.round((u - m.u0) / m.cell), j = Math.round((v - m.v0) / m.cell);
  for (let r = 0; r <= 2; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const a = i + di, b = j + dj;
    if (a < 0 || b < 0 || a >= m.w || b >= m.h) continue;
    const z = m.d[b * m.w + a]!;
    if (!Number.isNaN(z)) return [z, m.e[b * m.w + a]!];
  }
  return null;
}

const ringArea = (r: readonly XY[]): number => {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i]!, q = r[(i + 1) % r.length]!; s += p[0] * q[1] - q[0] * p[1]; }
  return s / 2;
};

const inside = (poly: readonly XY[], x: number, y: number): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

/**
 * The zero line of a 2D field (marching squares), as closed outlines in world mm. Holes and specks are dropped: a
 * part's view is one or a few solid shapes.
 */
function trace(f: Float32Array, w: number, h: number, world: (a: number, b: number) => XY): XY[][] {
  // edge ids: horizontal edge from (i, j) to (i + 1, j) = 2 * (j * w + i), vertical from (i, j) to (i, j + 1) = that + 1
  const pt = new Map<number, XY>();
  const point = (e: number): XY => {
    let p = pt.get(e);
    if (p) return p;
    const c = e >> 1, i = c % w, j = (c - i) / w;
    const [i2, j2] = e & 1 ? [i, j + 1] : [i + 1, j];
    const a = f[j * w + i]!, b = f[j2 * w + i2]!, t = a === b ? 0.5 : a / (a - b);
    p = world(i + (i2 - i) * t, j + (j2 - j) * t);
    pt.set(e, p);
    return p;
  };
  const next = new Map<number, number>();
  const H = (i: number, j: number): number => 2 * (j * w + i), V = (i: number, j: number): number => 2 * (j * w + i) + 1;
  for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
    const a = f[j * w + i]! < 0, b = f[j * w + i + 1]! < 0, c = f[(j + 1) * w + i + 1]! < 0, d = f[(j + 1) * w + i]! < 0;
    const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const bot = H(i, j), right = V(i + 1, j), top = H(i, j + 1), left = V(i, j);
    const seg = (s: number, e: number): void => { next.set(s, e); };
    switch (code) {
      case 1: seg(left, bot); break;
      case 2: seg(bot, right); break;
      case 3: seg(left, right); break;
      case 4: seg(right, top); break;
      case 5: seg(left, top); seg(right, bot); break;
      case 6: seg(bot, top); break;
      case 7: seg(left, top); break;
      case 8: seg(top, left); break;
      case 9: seg(top, bot); break;
      case 10: seg(top, right); seg(bot, left); break;
      case 11: seg(top, right); break;
      case 12: seg(right, left); break;
      case 13: seg(right, bot); break;
      case 14: seg(bot, left); break;
    }
  }
  const rings: XY[][] = [];
  const seen = new Set<number>();
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const ring: XY[] = [];
    let e: number | undefined = s;
    while (e !== undefined && !seen.has(e)) { seen.add(e); ring.push(point(e)); e = next.get(e); }
    if (ring.length >= 4) rings.push(ring);
  }
  const size = (r: readonly XY[]): number => Math.abs(ringArea(r));
  const outer = rings.filter((r) => size(r) > 0.6).sort((a, b) => size(b) - size(a));
  // a ring inside a bigger one is a hole (or a speck in one): dropped
  return outer.filter((r, i) => !outer.slice(0, i).some((o) => inside(o, r[0]![0], r[0]![1])));
}
