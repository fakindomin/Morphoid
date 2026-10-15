/**
 * Turning the sketch between the side, front and top views: every part's outline is resampled to the same number of
 * points (starting at its top), so a part slides from one view's shape into the next. Parts seen in only one of the two
 * views grow out of (or shrink into) their own centre.
 */
import { facetsOf, resample } from '../core/art/facets';
import type { XY } from '../core/art/path';
import { spanAt, type ViewId, type ViewPart, type ViewSet } from '../core/art/views';
import { HEAT, heatAt, type HeatGrid, type HeatLevel } from '../core/print';
import { facetHeat, type ViewPartDraw } from './sketch';

const N = 40;

export interface End { vs: ViewSet; view: ViewId }

interface Prep { id: string; part: ViewPart; ring: XY[]; extra: XY[][]; near: number; salt: number }
interface Prepared { parts: Map<string, Prep>; ext: { x0: number; x1: number; y1: number } }

const salt = (id: string): number => { let h = 7; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 9973; return h; };

const prepCache = new WeakMap<ViewPart[], Prepared>();
/** A view's parts made ready to morph: outlines resampled, the top view lifted to stand on the desk line. */
function prepare(e: End): Prepared {
  const list = e.vs[e.view];
  const hit = prepCache.get(list);
  if (hit) return hit;
  let v0 = Infinity;
  for (const p of list) for (const r of p.rings) for (const q of r) v0 = Math.min(v0, q[1]);
  const lift = e.view === 'top' && Number.isFinite(v0) ? -v0 : 0;
  const n = list.length;
  const parts = new Map<string, Prep>();
  let x0 = Infinity, x1 = -Infinity, y1 = 0;
  list.forEach((p, i) => {
    const rings = p.rings.map((r) => r.map(([u, v]): XY => [u, v + lift]));
    const main = rings[0]!;
    let cx = 0;
    for (const q of main) cx += q[0];
    cx /= main.length;
    for (const r of rings) for (const [u, v] of r) { x0 = Math.min(x0, u); x1 = Math.max(x1, u); y1 = Math.max(y1, v); }
    parts.set(p.id, { id: p.id, part: p, ring: resample(main, N, [cx, -1e4]), extra: rings.slice(1), near: n > 1 ? i / (n - 1) : 1, salt: salt(p.id) });
  });
  const out = { parts, ext: Number.isFinite(x0) ? { x0, x1, y1 } : { x0: -40, x1: 40, y1: 60 } };
  prepCache.set(list, out);
  return out;
}

/** The view's drawn extent (mm), for fitting it to the stage. */
export const extentOfView = (e: End): Prepared['ext'] & { view: ViewId } => ({ ...prepare(e).ext, view: e.view });

/** The worst print heat along a line of sight through the part (its depth span from ahead), side-view heat grids. */
function heatFn(view: ViewId, p: ViewPart, heat: readonly HeatGrid[]): (u: number, v: number) => HeatLevel {
  if (view === 'side') return (u, v) => heatAt(heat, u, v);
  return (u, v) => {
    const span = spanAt(p.map, u, v);
    if (!span) return HEAT.none;
    const a = Math.min(span[0], span[1]), b = Math.max(span[0], span[1]);
    let lv = 0;
    for (let x = a; x <= b + 1e-6; x += Math.max(0.6, (b - a) / 24)) {
      let h: number = heatAt(heat, x, v);
      if (h === HEAT.bed && v >= 1.5) h = HEAT.none; // the bed is seen only along the bottom row
      lv = Math.max(lv, h);
      if (lv === HEAT.attention) break;
    }
    return lv as HeatLevel;
  };
}

const levelCache = new WeakMap<ViewPart, { heat: readonly HeatGrid[]; levels: HeatLevel[] }>();
function levelsOf(e: End, pr: Prep, heat: readonly HeatGrid[]): HeatLevel[] {
  // from above there is nothing to support: the top view shows the shape alone, all of it in the safe blues
  if (e.view === 'top') return [];
  const hit = levelCache.get(pr.part);
  if (hit && hit.heat === heat) return hit.levels;
  const fn = heatFn(e.view, pr.part, heat);
  const levels = facetsOf(pr.ring, pr.salt).map((f) => facetHeat(fn, f.pts, f.edge));
  levelCache.set(pr.part, { heat, levels });
  return levels;
}

const centre = (r: readonly XY[]): XY => [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length];
const lerpRing = (a: readonly XY[], b: readonly XY[], t: number): XY[] => a.map((q, i) => [q[0] + (b[i]![0] - q[0]) * t, q[1] + (b[i]![1] - q[1]) * t]);
const toPoint = (r: readonly XY[], c: XY, t: number): XY[] => r.map((q) => [q[0] + (c[0] - q[0]) * t, q[1] + (c[1] - q[1]) * t]);

/** The parts `t` of the way (0..1) from one view to the other, back to front. */
export function morphParts(from: End, to: End, t: number, heat: readonly HeatGrid[], print: boolean): ViewPartDraw[] {
  const A = prepare(from), B = prepare(to);
  const out: (ViewPartDraw & { key: number })[] = [];
  const ids = new Set([...A.parts.keys(), ...B.parts.keys()]);
  for (const id of ids) {
    const a = A.parts.get(id), b = B.parts.get(id);
    const src = t < 0.5 ? a ?? b! : b ?? a!;
    const ring = a && b ? lerpRing(a.ring, b.ring, t) : a ? toPoint(a.ring, centre(a.ring), t) : toPoint(b!.ring, centre(b!.ring), 1 - t);
    const extra = t < 0.5 ? a?.extra ?? [] : b?.extra ?? [];
    const near = a && b ? a.near + (b.near - a.near) * t : src.near;
    const end = src === a ? from : to;
    out.push({ slot: src.part.slot, color: src.part.color, ring, extra, near, salt: src.salt, levels: print ? levelsOf(end, src, heat) : [], key: near });
  }
  out.sort((p, q) => p.key - q.key);
  return out;
}
