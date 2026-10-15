/**
 * The 2D sketch cut into flat facets, like the Morphoid logo. Every outline is resampled to the same number of points
 * and cut with the same pattern (a zigzag strip from its tip to its root, with a jittered spine down the middle), so a
 * shape that changes keeps its facets: they slide and stretch instead of jumping, and one creature morphs into another.
 */
import type { XY } from './path';

/** points on every outline; even */
export const FACET_N = 28;
/** light from the upper front (rig mm: +x forward, +y up), as on the logo */
const LIGHT: XY = [0.6, 0.8];

export interface Facet {
  pts: [XY, XY, XY];
  /** -1..1: how much the facet turns towards the light (0 for the inner ones) */
  light: number;
  /** 0..1, stable for the same facet of the same part */
  seed: number;
  /** the facet's corners on the outline (where print problems show) */
  edge: XY[];
}

const hash = (i: number, p: number): number => { const s = Math.sin(i * 12.9898 + p * 78.233) * 43758.5453; return s - Math.floor(s); };

const area2 = (poly: readonly XY[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i]!, q = poly[(i + 1) % poly.length]!; a += p[0] * q[1] - q[0] * p[1]; }
  return a;
};

/**
 * `poly` as `n` points evenly spaced along its outline, counter-clockwise, starting at the point farthest from `away`
 * (a leg starts at its foot, a tail at its tip, a horn at its point: the cut runs from the tip back to the body).
 */
export function resample(poly: readonly XY[], n: number, away: XY): XY[] {
  const p = area2(poly) < 0 ? [...poly].reverse() : [...poly];
  let s0 = 0, best = -1;
  p.forEach(([x, y], i) => { const d = (x - away[0]) ** 2 + (y - away[1]) ** 2; if (d > best) { best = d; s0 = i; } });
  const ring = [...p.slice(s0), ...p.slice(0, s0)];
  const cum = [0];
  for (let i = 1; i <= ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i % ring.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[ring.length]!;
  const out: XY[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * total;
    while (k < ring.length - 1 && cum[k + 1]! < t) k++;
    const a = ring[k]!, b = ring[(k + 1) % ring.length]!, seg = cum[k + 1]! - cum[k]!;
    const u = seg > 1e-9 ? (t - cum[k]!) / seg : 0;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}

/** Facets of an outline already resampled to FACET_N points (index 0 = tip, FACET_N / 2 = root). */
export function facetsOf(ring: readonly XY[], salt: number): Facet[] {
  const n = ring.length, h = n / 2;
  const P = (i: number): XY => ring[(i + n) % n]!;
  // the spine: a point between each pair of opposite sides, a little off the middle so the cut looks hand-made
  const M: XY[] = [];
  for (let k = 1; k < h; k++) {
    const a = P(k), b = P(n - k), f = 0.5 + (hash(k, salt) - 0.5) * 0.36;
    M[k] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  const tris: [XY, XY, XY][] = [];
  tris.push([P(0), P(1), M[1]!], [P(0), M[1]!, P(n - 1)]);
  for (let k = 1; k < h - 1; k++) {
    const a = P(k), a1 = P(k + 1), m = M[k]!, m1 = M[k + 1]!, b = P(n - k), b1 = P(n - k - 1);
    if (k % 2) tris.push([a, a1, m1], [a, m1, m], [m, m1, b], [m1, b1, b]);
    else tris.push([a, a1, m], [a1, m1, m], [m, m1, b1], [m, b1, b]);
  }
  const ml = M[h - 1]!;
  tris.push([ml, P(h - 1), P(h)], [ml, P(h), P(h + 1)]);

  const onEdge = new Set(ring);
  const [lx, ly] = LIGHT, ll = Math.hypot(lx, ly);
  return tris.map((pts, i) => {
    const edge = pts.filter((q) => onEdge.has(q));
    const inner = pts.filter((q) => !onEdge.has(q));
    let light = 0;
    if (edge.length && inner.length) {
      const avg = (qs: XY[]): XY => [qs.reduce((s, q) => s + q[0], 0) / qs.length, qs.reduce((s, q) => s + q[1], 0) / qs.length];
      const [ex, ey] = avg(edge), [ix, iy] = avg(inner);
      const dx = ex - ix, dy = ey - iy, d = Math.hypot(dx, dy) || 1;
      light = (dx * lx + dy * ly) / (d * ll);
    }
    return { pts, light, seed: hash(i, salt + 7), edge };
  });
}
