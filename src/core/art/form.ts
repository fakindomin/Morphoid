/**
 * Form rules ("Zasady formy Morphoidów"): what keeps a creature from looking like plasticine.
 *
 * - Shape language: every creature speaks one language of shapes, chosen by its body plan, build and skull. Round
 *   (friendly, soft), square (strong, stable) or triangle (fast, sharp). The language sets how deep the planes on the
 *   head and body are cut and how soft their edges stay.
 * - Planes on a soft mass: the head is not a ball and the muzzle is not a sausage. A few flat cuts (cheeks, temples,
 *   crown, the top and sides of the Pysk, the line between back and flanks) meet the round skin with a rounded edge, so
 *   the light breaks on them like on a sculpture.
 *
 * A cut is a half-space removed from one part with a smooth intersection: the part keeps every point where
 * dot(p - o, n) <= 0, and the edge between the cut and the skin is rounded with radius r.
 */
import type { MorphotypeGenome } from '../genome';
import { dimensions as D, type Rig } from '../rig';
import type { Part3D } from './spec3d';

export type V3 = [number, number, number];
export interface Cut { n: V3; o: V3; r: number }

export const LANG = { round: 0, square: 1, sharp: 2 } as const;
export type Lang = (typeof LANG)[keyof typeof LANG];

/** Per language: how deep the planes go (share of the part's half thickness) and how round their edges are (mm). */
export const LANG_CUT: Record<Lang, { depth: number; r: number }> = {
  [LANG.round]: { depth: 0.14, r: 2.0 },
  [LANG.square]: { depth: 0.2, r: 1.0 },
  [LANG.sharp]: { depth: 0.24, r: 0.7 },
};

/** The creature's shape language: the body plan and build speak first, the skull decides for an ordinary build. */
export function langOf(g: MorphotypeGenome, rig: Rig): Lang {
  const plan = rig.dims.plan, build = rig.dims.build;
  if (build === 3 || plan === D.PLAN.caterpillar || plan === D.PLAN.octopus) return LANG.round;
  if (build === 2) return LANG.square;
  if (build === 1 || build === 4 || plan === D.PLAN.insect || plan === D.PLAN.biped) return LANG.sharp;
  const skull = g.head?.skull ?? 0;
  return skull === 1 ? LANG.sharp : skull === 2 ? LANG.square : LANG.round;
}

const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Smooth maximum (intersection) of two distances with an edge radius r. */
export const smax = (a: number, b: number, r: number): number => {
  const h = Math.max(r - Math.abs(a - b), 0) / r;
  return Math.max(a, b) + h * h * r * 0.25;
};

/** A part's distance with its cuts applied (world point x, y, z). */
export function applyCuts(cuts: readonly Cut[], d: number, x: number, y: number, z: number): number {
  for (const c of cuts) {
    const pd = (x - c.o[0]) * c.n[0] + (y - c.o[1]) * c.n[1] + (z - c.o[2]) * c.n[2];
    if (pd > d - c.r) d = smax(d, pd, c.r);
  }
  return d;
}

function box(p: Part3D): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const poly of p.polys) for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1 };
}

/** Both mirror images of a side plane (n and o given for the +z side). */
const pair = (n: V3, o: V3, r: number): Cut[] => [
  { n: norm(n), o, r },
  { n: norm([n[0], n[1], -n[2]]), o: [o[0], o[1], -o[2]], r },
];

/** Appendages that grow out of the head. */
const ROOTED = new Set<string>(['ear', 'horns', 'antennae', 'tuft', 'stalks']);

/** A point a cut must leave inside the skin by `m` mm: an eye, a painted brow or mouth line. */
interface Keep { p: V3; m: number }

/**
 * Everything already drawn on the head and the Pysk keeps its skin: the eyeballs (a cut must not open the socket
 * behind the lids) and the painted lines (brows, the mouth), which lie at a fixed depth and would float off a cut.
 */
function keepsOf(out: Part3D[]): Keep[] {
  const keep: Keep[] = [];
  for (const p of out) {
    if (p.slot === 'eye') {
      const b = box(p);
      keep.push({ p: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, p.z], m: Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + 0.8 });
    } else if (p.slot === 'earFlop') { // a hanging ear keeps the crown it hangs from
      const top = p.polys.flat().reduce((a, b) => (b[1] > a[1] ? b : a));
      keep.push({ p: [top[0] - 1.5, top[1] - 1.5, p.z], m: 1.2 });
    } else if (ROOTED.has(p.slot) && !p.plane && !p.limb) {
      // an ear or a horn keeps the skin it grows out of: its root (the outline inside the head) stays under the cut
      const h = out.find((q) => q.slot === 'head' && !q.limb);
      if (!h) continue;
      const hb = box(h);
      for (const poly of p.polys) for (const [x, y] of poly) if (x > hb.x0 && x < hb.x1 && y > hb.y0 && y < hb.y1) keep.push({ p: [x, y, p.z], m: 0.6 });
    } else if (p.thickness < 0.8 && !p.plane && (p.slot === 'brow' || p.slot === 'mouth' || p.slot === 'iris' || p.slot === 'pupil')) {
      for (const poly of p.polys) for (let i = 0; i < poly.length; i += 2) keep.push({ p: [poly[i]![0], poly[i]![1], p.z], m: 0.3 });
    }
  }
  return keep;
}

/** Move a cut outwards (along its normal) until every kept point is at least its margin inside it. */
function clear(c: Cut, keep: readonly Keep[]): Cut {
  let push = 0;
  for (const k of keep) push = Math.max(push, (k.p[0] - c.o[0]) * c.n[0] + (k.p[1] - c.o[1]) * c.n[1] + (k.p[2] - c.o[2]) * c.n[2] + k.m);
  return push > 0 ? { ...c, o: [c.o[0] + c.n[0] * push, c.o[1] + c.n[1] * push, c.o[2] + c.n[2] * push] } : c;
}

/**
 * The planes of the head, the Pysk and the torso. Set before anything is mounted on them (eyes, lips, whiskers ask
 * the cut skin where to sit, see mounts.ts).
 */
export function cutPlanes(out: Part3D[], lang: Lang, plan: number): void {
  const { depth, r } = LANG_CUT[lang];
  const keep = keepsOf(out);
  const head = out.find((p) => p.slot === 'head' && !p.limb);
  if (head) {
    const b = box(head), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2;
    const half = head.thickness / 2, d = half * depth;
    head.cuts = ([
      // cheeks: below the eyes the side of the head turns down and in, towards the jaw
      ...pair([0.2, -0.8, 1], [cx, cy - 0.12 * ry, half - d], r),
      // temples: behind the eyes the skull is flat, turning back towards the neck
      ...pair([-0.65, 0.3, 1], [cx - 0.15 * rx, cy + 0.15 * ry, half - d], r),
      // the crown: a broad plane over the forehead, sloping down to the Pysk
      { n: norm([0.45, 1, 0]), o: [cx, cy + ry * (1 - depth * 1.4), 0], r: r * 1.4 },
    ] as Cut[]).map((c) => clear(c, keep));
  }
  const snout = out.find((p) => p.slot === 'snout' && !p.limb);
  if (snout) {
    const b = box(snout), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, ry = (b.y1 - b.y0) / 2;
    const half = snout.thickness / 2, d = half * depth;
    snout.cuts = ([
      // the bridge of the nose: a flat top running down to the nose
      { n: norm([0.25, 1, 0]), o: [cx, b.y1 - ry * depth * 1.2, 0], r },
      // the sides of the Pysk: flat, leaning in towards the top
      ...pair([0, 0.45, 1], [cx, cy, half - d], r),
    ] as Cut[]).map((c) => clear(c, keep));
  }
  if (plan === D.PLAN.quadruped) {
    const torso = out.find((p) => p.slot === 'torso' && !p.limb);
    if (torso) {
      const b = box(torso), cy = (b.y0 + b.y1) / 2, ry = (b.y1 - b.y0) / 2;
      const half = torso.thickness / 2, d = half * depth * 0.8;
      // the back is a plane of its own, meeting the flanks along a soft edge
      torso.cuts = pair([0, 0.9, 1], [0, cy + 0.35 * ry, half - d], r * 1.6);
    }
  }
}

/**
 * Per language: how much of an appendage's thickness its edges round off (1 = as drawn), how much of the body masses'
 * thickness (1 = as drawn), and the appendage blend as a share of its thickness (see blendOf in field.ts).
 */
export const LANG_EDGE: Record<Lang, { app: number; body: number; blend: number }> = {
  [LANG.round]: { app: 1, body: 1, blend: 0.5 },
  [LANG.square]: { app: 0.6, body: 0.78, blend: 0.4 },
  [LANG.sharp]: { app: 0.45, body: 0.88, blend: 0.3 },
};

/** Flat appendages whose edges follow the language (a square creature's fins are slabs, a sharp one's crest is keen). */
const EDGED = new Set<string>(['ear', 'horns', 'antennae', 'tuft', 'mane', 'finD', 'finP', 'spines', 'wingNear', 'tail']);
const BODY = new Set<string>(['torso', 'head', 'snout', 'neck']);

/** Apply the shape language to the edges of the parts (call before anything is mounted on them). */
export function speakLanguage(out: Part3D[], lang: Lang): void {
  const e = LANG_EDGE[lang];
  for (const p of out) {
    if (p.limb || p.carve) continue;
    if (EDGED.has(p.slot)) { p.bevel = Math.max(0.3, p.bevel * e.app); p.blendShare = e.blend; }
    else if (BODY.has(p.slot)) p.bevel = p.bevel * e.body;
  }
}
