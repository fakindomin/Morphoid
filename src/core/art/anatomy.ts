/**
 * An animal's trunk and neck built from anatomical masses, not one extruded side outline.
 *
 * The trunk is a ribcage (deep at the chest, a keel between the front legs), the forechest, a loin drawn in at the
 * waist, the pelvis with the haunches over the hind legs, a pair of shoulder blades standing up at the withers and the
 * long back muscles along the spine. The neck is a tapered column from deep in the chest up to the back of the skull.
 * All of it is one round 3D solid (a Limb whose pieces melt into each other), and the 2D drawing is its side
 * silhouette, so the sketch and the print are one shape.
 *
 * Masses are placed in the torso's own frame as shares of its length L, girth G (height) and width W, then turned
 * with the torso's tilt. Their radii stay axis-aligned: the tilt is a few degrees.
 */
import { limbBox, limbSd, type Cone, type Dome, type Limb, type V3 } from './limb';
import type { XY } from './path';
import { FINE_ZERO, fineScale, type MorphotypeGenome } from '../genome';

export interface TrunkSpec {
  /** the torso node (side view, mm) */
  torso: XY;
  L: number; G: number; W: number;
  /** torso tilt (rad, chest up) */
  tilt: number;
  /** a two-legged animal (a bird, a monkey, a kangaroo): its own masses over hips under the middle */
  biped?: boolean;
  /** deformation sliders: the size of each group of masses (1 = as built) */
  sculpt?: Sculpt;
}

/** Sizes of the trunk's mass groups and the neck's thickness from the deformation sliders (gene I). */
export interface Sculpt { chest: number; waist: number; haunch: number; shoulder: number; neck: number }
export function sculptOf(g: MorphotypeGenome): Sculpt {
  const v = (k: string): number => fineScale(g.sculpt?.[k] ?? FINE_ZERO);
  return { chest: v('chest'), waist: v('waist'), haunch: v('haunch'), shoulder: v('shoulder'), neck: v('neckThick') };
}

/** How softly the masses melt into each other, as a share of the girth. */
const TRUNK_BLEND = 0.13;

/** [x, y, z] centre and [x, y, z] radii as shares of L, G, W; `pair` masses sit on both flanks. */
interface Mass { c: V3; r: V3; pair?: boolean; part: keyof Omit<Sculpt, 'neck'> }
const MASSES: readonly Mass[] = [
  { c: [0.2, -0.12, 0], r: [0.25, 0.53, 0.5], part: 'chest' },                   // ribcage: the deepest part, a keel down between the elbows
  { c: [0.36, -0.05, 0], r: [0.14, 0.36, 0.36], part: 'chest' },                 // forechest, round in front of the shoulders
  { c: [-0.02, 0.04, 0], r: [0.15, 0.34, 0.46], part: 'waist' },                // the last ribs, already shallower
  { c: [-0.12, 0.12, 0], r: [0.2, 0.3, 0.38], part: 'waist' },                  // loin: the waist, the belly tucked up high
  { c: [-0.3, 0.07, 0], r: [0.2, 0.37, 0.44], part: 'haunch' },                   // pelvis and croup
  { c: [-0.27, -0.1, 0.28], r: [0.16, 0.27, 0.2], pair: true, part: 'haunch' },   // haunches: the thigh muscles down to the stifle
  { c: [0.25, 0.15, 0.33], r: [0.1, 0.3, 0.14], pair: true, part: 'shoulder' },     // shoulder blades, standing up at the withers
];
/**
 * A two-legged animal's trunk, in the same frame (the torso is tilted nose-up, the hips sit under its middle): a full
 * breast (a bird's keel, a monkey's chest), a softer belly, a rump tapering back to the tail, thighs over the hips and
 * the shoulders at the top of the chest.
 */
const BIPED_MASSES: readonly Mass[] = [
  { c: [0.17, -0.04, 0], r: [0.3, 0.5, 0.48], part: 'chest' },                   // breast or chest
  { c: [-0.04, -0.1, 0], r: [0.24, 0.42, 0.45], part: 'waist' },                 // belly
  { c: [-0.28, 0.03, 0], r: [0.2, 0.34, 0.4], part: 'haunch' },                   // rump, tapering to the tail
  { c: [0.04, -0.22, 0.3], r: [0.15, 0.3, 0.2], pair: true, part: 'haunch' },     // thighs over the hips
  { c: [0.3, 0.18, 0.32], r: [0.1, 0.24, 0.14], pair: true, part: 'shoulder' },     // shoulders
];
const BIPED_SPINE = { pts: [[0.35, 0.27], [0, 0.3], [-0.38, 0.2]] as XY[], r: 0.17 };

/** The back muscles: a column along the spine, from the withers over a slight rise at the loin to the croup. Points (x, y) and radius in G. */
const SPINE = { pts: [[0.32, 0.27], [-0.06, 0.3], [-0.37, 0.26]] as XY[], r: 0.19 };

export function trunkLimb(s: TrunkSpec): Limb {
  const { torso, L, G, W, tilt } = s;
  const masses = s.biped ? BIPED_MASSES : MASSES, spinePts = s.biped ? BIPED_SPINE : SPINE;
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  const at = (fx: number, fy: number, z: number): V3 => {
    const lx = fx * L, ly = fy * G;
    return [torso[0] + lx * c - ly * sn, torso[1] + lx * sn + ly * c, z];
  };
  const domes: Dome[] = [];
  for (const m of masses) {
    // a deformed group grows (or shrinks) round its own centre, except the chest, which deepens downwards (its top
    // stays on the back line) and the waist, which keeps its top too
    const k = s.sculpt?.[m.part] ?? 1, down = m.part === 'chest' || m.part === 'waist';
    const r: V3 = [m.r[0] * L * (down ? 1 : k), m.r[1] * G * k, m.r[2] * W * (down ? 1 + (k - 1) * 0.6 : k)];
    const cy = m.c[1] - (down ? (k - 1) * m.r[1] : 0);
    if (m.pair) for (const side of [1, -1]) domes.push({ c: at(m.c[0], cy, side * (m.c[2] * W + (k - 1) * m.r[2] * W * 0.5)), r });
    else domes.push({ c: at(m.c[0], cy, 0), r });
  }
  const spine: Cone[] = spinePts.pts.slice(1).map((b, i) => ({ a: at(spinePts.pts[i]![0], spinePts.pts[i]![1], 0), b: at(b[0], b[1], 0), ra: spinePts.r * G, rb: spinePts.r * G }));
  return { cones: spine, domes, blend: Math.max(1.6, TRUNK_BLEND * G) };
}

/**
 * The neck: thick where it leaves the chest (it is mostly muscle), narrowing to the back of the skull, with the
 * throat a little fuller below. `base` is deep inside the chest, `head` the skull's centre.
 */
export function neckLimb(base: XY, head: XY, G: number, headR: number, thick = 1): Limb {
  const r0 = 0.33 * G * thick, r1 = Math.max(2.4, 0.5 * headR * Math.min(1.2, thick));
  const mid: XY = [base[0] + (head[0] - base[0]) * 0.55, base[1] + (head[1] - base[1]) * 0.55];
  const rm = (r0 + r1) / 2 * 0.96;
  const end: XY = [head[0] - headR * 0.25, head[1] - headR * 0.1];
  return {
    cones: [
      { a: [base[0], base[1], 0], b: [mid[0], mid[1], 0], ra: r0, rb: rm },
      { a: [mid[0], mid[1], 0], b: [end[0], end[1], 0], ra: rm, rb: r1 },
    ],
    domes: [],
    blend: Math.max(1.2, 0.08 * G),
  };
}

/**
 * The side silhouette of a round solid: for every direction from `centre` the outermost point still inside it (the
 * solid is sampled at the depths `zs`, so masses off the centre plane, the shoulder blades, show too).
 */
export function sideOutline(l: Limb, centre: XY, zs: readonly number[] = [0], n = 128): XY[] {
  const { lo, hi } = limbBox(l);
  const R = Math.hypot(Math.max(hi[0] - centre[0], centre[0] - lo[0]), Math.max(hi[1] - centre[1], centre[1] - lo[1])) + 1;
  const f = (x: number, y: number): number => { let d = Infinity; for (const z of zs) d = Math.min(d, limbSd(l, x, y, z)); return d; };
  const pts: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    // walk in from outside until inside, then halve the step to the surface
    let out = R, r = R;
    while (r > 0 && f(centre[0] + dx * r, centre[1] + dy * r) >= 0) { out = r; r -= 0.8; }
    if (r <= 0) { pts.push([centre[0], centre[1]]); continue; }
    let inn = r;
    for (let k = 0; k < 8; k++) { const m = (inn + out) / 2; if (f(centre[0] + dx * m, centre[1] + dy * m) < 0) inn = m; else out = m; }
    pts.push([centre[0] + dx * inn, centre[1] + dy * inn]);
  }
  return pts;
}

/** The depths at which the trunk's silhouette is sampled: the centre plane and the flank masses. */
export const trunkDepths = (W: number): number[] => [0, 0.28 * W, 0.33 * W];
