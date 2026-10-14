/**
 * Pure side-view artwork ("toy figurine" style): (pose, genome) -> SVG path
 * strings, one per fixed slot, in z-order. Slots are rendered once by React;
 * the rAF loop only rewrites `d` attributes (and only when the string
 * changed). Colours come from CSS (--c1/--c2/--c3 = the genome's palette).
 * Geometry is in rig mm, +X forward, +Y up; ToPx mirrors X (faces left).
 */
import type { MorphotypeGenome } from '../genome';
import { dimensions as D, type NodeId, type Rig } from '../rig';
import { PRINT_RULES } from '../print/rules';
import { ellipse, Path, polygon, taper, tube, type ToPx, type XY } from './path';
import type { Pose } from './pose';
import { coatPath } from './coat';
import { insectLimb, legLimb, legSpecOf, limbOutline, octopusLimb, prolegLimb, tailLimb, type Limb } from './limb';

/** skin/skinFar = body colour (c1); accent = c2; white/ink/glint = details; clip = not drawn. */
export type SlotKind =
  | 'shadow' | 'skin' | 'skinFar' | 'belly' | 'pattern' | 'coat' | 'accent' | 'accentFar' | 'accentSoft'
  | 'white' | 'ink' | 'glint' | 'groove' | 'bone' | 'clip'
  /** drawing-only touches of the illustrated style (no geometry): eye colour, cheek blush */
  | 'iris' | 'blush'
  /** the tongue in an open mouth */
  | 'tongue'
  /** eyelids: skin folds over and under the eyeball */
  | 'lid';

export const SLOTS = [
  ['shadow', 'shadow'], ['stand', 'accent'], ['arms', 'skin'], ['wingFar', 'accentFar'], ['tail', 'skin'], ['legBFar', 'skinFar'], ['legFFar', 'skinFar'],
  ['legB', 'skin'], ['torso', 'skin'], ['torsoClip', 'clip'], ['belly', 'belly'], ['pattern', 'pattern'], ['coat', 'coat'], ['coatLegs', 'coat'], ['coatOn', 'clip'], ['coatLegB', 'clip'], ['coatLegF', 'clip'],
  ['saddle', 'accent'], ['spines', 'accent'], ['finD', 'accent'], ['legF', 'skin'], ['finP', 'accent'], ['neck', 'skin'], ['neckDecor', 'skinFar'],
  ['mane', 'accent'], ['collar', 'accent'], ['ear', 'skin'], ['earIn', 'accentSoft'], ['horns', 'accent'], ['antennae', 'accent'], ['tuft', 'accent'],
  ['head', 'skin'], ['snout', 'skin'], ['wingNear', 'accent'], ['nose', 'ink'],
  ['maw', 'ink'], ['tongue', 'tongue'], ['mouth', 'groove'], ['teeth', 'white'], ['whiskers', 'skinFar'], ['stalks', 'skin'], ['blush', 'blush'], ['toes', 'groove'], ['eye', 'white'], ['iris', 'iris'], ['pupil', 'ink'],
  ['glint', 'glint'], ['lids', 'lid'], ['brow', 'groove'], ['wingRibs', 'groove'], ['bones', 'bone'],
] as const satisfies readonly (readonly [string, SlotKind])[];

export type SlotId = (typeof SLOTS)[number][0];
export type Shapes = Record<SlotId, string>;

const p = (pose: Pose, id: NodeId): XY => pose.pos[id];
const R = D.HEAD_RADIUS;

/** Insect legs per slot: the hind pair in legB, the front and middle pairs in legF (see insectLimb). */
export function insectHips(hipB: XY, shF: XY): { legB: { hip: XY; dir: number }[]; legF: { hip: XY; dir: number }[] } {
  const mid: XY = [(hipB[0] + shF[0]) / 2, (hipB[1] + shF[1]) / 2];
  return { legB: [{ hip: hipB, dir: -1 }], legF: [{ hip: shF, dir: 1 }, { hip: mid, dir: 0 }] };
}
/** Round tail (wolf, fluffy) as a 3D chain along the rig's tail curve; null for the flat kinds. */
export function roundTail(g: MorphotypeGenome, bodyG: number, base: XY, mid: XY, tip: XY): Limb | null {
  const type = g.tail!.type!;
  if (type !== 1 && type !== 2) return null;
  const ctrl: XY = [2 * mid[0] - (base[0] + tip[0]) / 2, 2 * mid[1] - (base[1] + tip[1]) / 2];
  const w0 = bodyG * 0.46;
  const width = type === 1 ? (t: number) => Math.max(1.8, w0 * (1 - t * 0.9))
    : (t: number) => Math.max(1.8, w0 * (1 - t) + bodyG * 0.62 * Math.sin(Math.PI * Math.min(0.98, t * 0.95 + 0.04))); // round, so slimmer than the old flat outline
  return tailLimb(base, ctrl, tip, width, DIR_TURN.tail[g.tail!.dir ?? 0] ?? 0);
}
export const insectLegW = (legW: number): number => Math.max(3.2, legW * 0.6);
export const insectRise = (bodyG: number): number => Math.max(5, bodyG * 0.45);
/** x of every caterpillar proleg along the flat belly. */
export function prolegXs(torsoX: number, bodyL: number): number[] {
  const cnt = Math.max(3, Math.round(bodyL / 10));
  return Array.from({ length: cnt }, (_, i) => torsoX - bodyL * 0.4 + (bodyL * 0.8 * i) / (cnt - 1));
}

/** A rib of a wing: a side-view centre line with its radius at both ends (mm). */
export interface WingRib { a: XY; b: XY; ra: number; rb: number }

/**
 * The skeleton of a wing, the same in the drawing and the solid. Bat: an arm along the leading edge to the wrist and
 * three fingers spreading to the tips; feathers: the same arm and four shafts fanning back to the trailing edge.
 * Every end stays ~0.06 of the span inside the outline so a rib never pokes past the membrane.
 */
export function wingRibs(type: number, root: XY, s: number): WingRib[] {
  const [x, y] = root, at = (u: number, v: number): XY => [x + u * s, y + v * s];
  const S: XY = [x + 1.2, y + Math.max(3, s * 0.1)], W = at(0, 0.85); // starts clear of the body: the joint stays in the membrane plane
  const arm = Math.min(1.8, 1 + s * 0.018), fin = Math.max(0.7, arm * 0.5);
  const lerp = (a: XY, b: XY, f: number): XY => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const out: WingRib[] = [{ a: S, b: W, ra: arm, rb: arm * 0.82 }];
  if (type === 2) {
    // finger tips sit in sharp corners of the outline: pulled well back towards the wrist
    for (const [u, v] of [[-0.3, 1.05], [-0.8, 0.8], [-0.4, 0.55]] as const) out.push({ a: W, b: lerp(at(u, v), W, 0.16), ra: arm * 0.75, rb: fin });
  } else {
    // shafts slant back towards the wing tip like the long flight feathers of a folded wing
    const A: XY = [x + 3, y - 1.5], P1 = at(-0.62, 0.78), mid = at(-0.25, 0.7);
    out.push({ a: W, b: lerp(at(-0.35, 1.05), mid, 0.2), ra: arm * 0.7, rb: fin });
    for (const [f, g] of [[1, 1], [0.78, 0.86], [0.56, 0.72], [0.36, 0.58]] as const) {
      out.push({ a: lerp(S, W, f), b: lerp(lerp(A, P1, g), mid, 0.18), ra: arm * 0.6, rb: fin });
    }
  }
  return out;
}

/** Bat-wing finger tips (t1, t2) and the scallop notch (n1) as fractions of the wing size. */
export const BAT = { t1: [-0.4, 0.55] as [number, number], n1: [-0.2, 0.45] as [number, number], t2: [-0.8, 0.8] as [number, number] };

const TIP = 1.4; // flat tip width of every pointed part (> PRINT_RULES.minFeature)

/** Pointed part with a flat tip: base b0..b1 at the root, tip t0..t1 (both on the same side order). */
function spike(x: number, y: number, bx0: number, bx1: number, tx: number, ty: number): Path {
  return polygon([[x + bx0, y], [tx, ty], [tx + TIP, ty], [x + bx1, y]]);
}

function headShape(hx: number, hy: number, skull: number): { rx: number; ry: number; path: Path } {
  const [rx, ry] = skull === 1 ? [R * 1.12, R * 0.82] : skull === 2 ? [R * 1.1, R * 0.7] : [R, R * 0.96];
  return { rx, ry, path: ellipse(hx, hy, rx, ry) };
}

function earPaths(type: number, e: number, ex: number, ey: number): { outer: Path; inner: Path } {
  if (type === 1) {
    return {
      outer: polygon([[ex - 3.5, ey + 2], [ex - 2.0, ey + 2 + e], [ex - 0.6, ey + 2 + e], [ex + 4.5, ey + 1]]),
      inner: polygon([[ex - 2, ey + 2.8], [ex - 1.2, ey + 2 + e * 0.62], [ex + 2.6, ey + 2]]),
    };
  }
  if (type === 2) {
    return { outer: ellipse(ex, ey + e * 0.45, e * 0.48, e * 0.42), inner: ellipse(ex, ey + e * 0.45, e * 0.26, e * 0.22) };
  }
  return {
    outer: ellipse(ex - 1.5, ey + e * 0.9, e * 0.24, e * 0.9, 0.25),
    inner: ellipse(ex - 1.5, ey + e * 0.9, e * 0.12, e * 0.66, 0.25),
  };
}

/** Eye variants (gene O): radius per size; 'many' = a cluster of small eyes, 'stalks' = one eye per side on a stalk. */
export const EYES = { many: 3, stalks: 4 } as const;

/**
 * The eyelids of an eye with radius r: a heavy fold over the top of the ball and a thin one under it. Each is an arc of
 * samples (angle round the eye, radius of the fold's centre line seen from the side, the fold's half width), thickest
 * in the middle and thinning towards the corners. The 2D sketch draws the band, spec3d rolls a tube along it.
 */
export function eyelids(r: number): { arc: [number, number, number][]; upper: boolean }[] {
  const arc = (a0: number, a1: number, inner: number, outer: number): [number, number, number][] => Array.from({ length: 13 }, (_, i) => {
    const t = i / 12, a = a0 + (a1 - a0) * t, k = 0.3 + 0.7 * Math.sin(Math.PI * t);
    const w = ((outer - inner) / 2) * k; // the outer edge (where the fold meets the head) stays put, the lid edge thins
    return [a, r * (outer - w), r * w];
  });
  return [
    { arc: arc(Math.PI * 1.06, -Math.PI * 0.12, 0.55, 1.2), upper: true },
    { arc: arc(Math.PI * 1.08, Math.PI * 1.94, 0.82, 1.14), upper: false },
  ];
}
const EYE_R = [1.7, 2.4, 3.2, 1.6, 2.6];
/** Eye stalk: width (>= 2 perimeters each side) and where it stands on the head; it leans forward ~20 deg. */
export const STALK_W = 2.4;
const ANT_W = 1.8;
export const eyeStalkRoot = (head: XY, hs: { rx: number; ry: number }): XY => [head[0] + hs.rx * 0.2, head[1] + hs.ry - 1.5];
export const eyeOnStalk = (head: XY, hs: { rx: number; ry: number }): XY => { const [x, y] = eyeStalkRoot(head, hs); return [x + 2.6, y + 7]; };

/** Stand: plate thickness (mm) and how far it reaches beyond the feet. */
export const STAND_MM = 4;
export const STAND_MARGIN_MM = 6;
/** x range of the stand: every foot on the bed, toe to heel, plus the margin. */
export function standSpan(pose: Pose, n: Pose['n']): [number, number] {
  if (D.onBelly(n.plan)) { // lies on its flat belly
    const tx = pose.pos.torso[0], half = (n.bodyL / 2 + 2.5) * 0.85;
    return [tx - half - STAND_MARGIN_MM, tx + half + STAND_MARGIN_MM];
  }
  const feet = (n.plan === 1 ? ['footBL'] : ['footBL', 'footFL']).map((id) => pose.pos[id as NodeId][0]);
  return [Math.min(...feet) - n.soleL * 0.3 - STAND_MARGIN_MM, Math.max(...feet) + n.soleL * 0.7 + 3.4 + STAND_MARGIN_MM];
}

/**
 * Octopus arms seen from above, in (x, z) around the hub at x = cx: eight tapering arms, each curling the same way
 * at its tip, half-way between the axes so none points straight at the viewer.
 */
export function octopusArms(cx: number, len: number, hub: number): XY[][] {
  const polys: XY[][] = [];
  const base = taper([hub * 0.5, 0], [len * 0.7, len * 0.1], [len, len * 0.42], (t) => Math.max(TIP, 6 * (1 - t) + 1.6 * t), 14);
  for (let k = 0; k < D.OCTOPUS.arms; k++) {
    const a = ((k + 0.5) * 2 * Math.PI) / D.OCTOPUS.arms;
    for (const poly of base.rotated(0, 0, a).flatten(6)) polys.push(poly.map(([x, z]) => [cx + x, z] as XY));
  }
  const ring: XY[] = [];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; ring.push([cx + Math.cos(a) * hub, Math.sin(a) * hub]); }
  polys.push(ring);
  return polys;
}

/** Whiskers: fan angles (rad from straight sideways; + = forward), pad half sizes (along x, across z), strand width. */
export const WHISKER_FAN = [-0.42, 0, 0.42] as const;
/** Whisker direction (gene V, last digit): the whole fan turned in the horizontal plane, + = forward (rad). */
export const WHISKER_TURN = [0, 0.6, -0.5] as const;
/**
 * Direction of an element (last digit of its gene), as a turn about its root in the side view (rad, + = backwards).
 * Index 0 is the original direction. A turn that tips an element past 45 deg makes it need supports: the print check
 * says so, as for any other choice.
 */
export const DIR_TURN = {
  ears: [0, 0.75, -0.4],     // up, laid back, forward
  horns: [0, -0.4, 0.3],     // up, forward, back
  antennae: [0, 0.42, 0.84], // forward, straight up, back
  tail: [0, 0.5, -0.22],     // up, straight back (lowered), steeply up; the tail leaves backwards, so + turns it down
} as const;
export const WHISKER_PAD = [3.4, 2.6] as const;
export const WHISKER_W = 1.4;
export const whiskerLength = (type: number): number => (type === 1 ? 6 : 11);
/** Where the whisker pad sits on the muzzle side (x, y), from the muzzle tip. */
export const whiskerRoot = (tipX: number, tip: XY): XY => [tipX - 4.2, tip[1] + 0.6];

/** Slots -> geometry in rig millimetres. THE source for both the 2D art and the print audit. */
export type SlotPaths = Record<SlotId, Path>;

export function buildShapes(pose: Pose, g: MorphotypeGenome, rig: Rig, to: ToPx, showBones: boolean): Shapes {
  const paths = buildPaths(pose, g, rig, showBones);
  const out = {} as Shapes;
  for (const [id] of SLOTS) out[id] = paths[id].empty ? '' : paths[id].d(to);
  return out;
}

/** How far (radians) the lower jaw drops when the mouth is open: fangs gape wider than a row of small teeth. */
export const JAW_OPEN = [0.42, 0.36] as const;

/** Keep the part of polygon `poly` on the side of the line through `a` with normal `nrm` where dot(p - a, nrm) >= 0. */
function clipHalf(poly: readonly XY[], a: XY, nrm: XY): XY[] {
  const out: XY[] = [];
  const side = (q: XY): number => (q[0] - a[0]) * nrm[0] + (q[1] - a[1]) * nrm[1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!, sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

/**
 * An open mouth (with teeth): the muzzle is split along the mouth line into the upper jaw and the lower jaw, and the
 * lower jaw drops by JAW_OPEN about the corner of the mouth `b` (a really open mouth, also in 3D). Between them: the
 * dark inside of the mouth (`maw`, set back from the lips), a tongue lying on the lower jaw, and the teeth along both
 * jaws' edges (fangs: an upper pair; a row: upper and lower), each ending well short of the opposite jaw.
 */
export function openJaw(muzzle: readonly XY[], a: XY, b: XY, teeth: number): { upper: XY[]; lower: XY[]; maw: XY[]; tongue: XY[]; teeth: XY[][] } {
  const L = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const d: XY = [(a[0] - b[0]) / L, (a[1] - b[1]) / L], up: XY = [-d[1], d[0]];
  const th = JAW_OPEN[teeth === 1 ? 0 : 1]!, c = Math.cos(-th), sn = Math.sin(-th);
  const drop = (q: XY): XY => { const x = q[0] - b[0], y = q[1] - b[1]; return [b[0] + x * c - y * sn, b[1] + x * sn + y * c]; };
  const upper = clipHalf(muzzle, b, up), lower = clipHalf(muzzle, b, [-up[0], -up[1]]).map(drop);
  // the front of the mouth: where the mouth line leaves the muzzle
  let reach = 0;
  for (const q of upper) reach = Math.max(reach, (q[0] - b[0]) * d[0] + (q[1] - b[1]) * d[1]);
  const on = (s: number, off = 0): XY => [b[0] + d[0] * s + up[0] * off, b[1] + d[1] * s + up[1] * off]; // s: mm from the corner
  const gap = (s: number): number => s * Math.sin(th); // how far apart the jaws are, s mm from the corner
  const front = reach * 0.9;
  // the inside of the mouth (throat and cheeks): from behind the corner, hidden in the head, half way out; in front of
  // it the mouth is open right through, so the far jaw, the teeth and the tongue show
  const back = front * 0.5;
  const maw: XY[] = [on(-2), on(back, 0.4), drop(on(back * 0.8, -0.4)), drop(on(back, -0.4))];
  // tongue: lies on the lower jaw, from deep in the mouth to two thirds of the way out, bulging a little
  const tongue: XY[] = [];
  const t0 = front * 0.15, t1 = front * 0.78;
  for (let i = 0; i <= 8; i++) { const s = t0 + ((t1 - t0) * i) / 8; tongue.push(drop(on(s, -0.6))); }
  for (let i = 8; i >= 0; i--) { const s = t0 + ((t1 - t0) * i) / 8; tongue.push(drop(on(s, Math.min(1.8, 0.3 * gap(s)) * Math.sin(Math.PI * (0.15 + 0.85 * i / 8))))); }
  const out: XY[][] = [];
  const tooth = (s: number, half: number, len: number, lower: boolean): void => {
    const l = Math.min(len, gap(s) * (teeth === 1 ? 0.75 : 0.42));
    if (l < 0.9) return;
    const sgn = lower ? 1 : -1, root = 0.5; // the root sits in the jaw
    const pts: XY[] = [on(s + half, -sgn * root), on(s, sgn * l), on(s - half, -sgn * root)];
    out.push(lower ? pts.map(drop) : pts);
  };
  if (teeth === 1) for (const k of [0.82, 0.5]) tooth(front * k, 1.15, 3, false); // fangs: an upper pair
  else {
    for (const k of [0.86, 0.68, 0.5, 0.32]) tooth(front * k, 0.75, 1.8, false);
    for (const k of [0.77, 0.59, 0.41]) tooth(front * k, 0.7, 1.5, true);
  }
  return { upper, lower, maw, tongue, teeth: out };
}

export function buildPaths(pose: Pose, g: MorphotypeGenome, rig: Rig, showBones: boolean): SlotPaths {
  const out = {} as SlotPaths;
  for (const [id] of SLOTS) out[id] = new Path();
  const put = (id: SlotId, path: Path): void => { out[id] = path; };

  const n = pose.n;
  const torso = p(pose, 'torso');
  const head = p(pose, 'head');
  const neckBase = p(pose, 'neckBase');
  const muzzle = p(pose, 'muzzle');
  const tailBase = p(pose, 'tailBase');
  const tailMid = p(pose, 'tailMid');
  const tailTip = p(pose, 'tailTip');
  const wingRoot = p(pose, 'wingRoot');
  const legW = n.legW;
  const foot = g.legs!.foot!;
  const tRx = n.bodyL / 2 + 2.5, tRy = n.bodyG / 2 + 1.5;

  // ---- stand (gene Q): a separate plate under the feet, seen from the side ---------------
  const standType = g.stand?.type ?? 0;
  if (standType > 0) {
    const [x0, x1] = standSpan(pose, n);
    const sp = new Path();
    if (standType === 2) { // stone: an uneven top edge
      sp.M(x0, -STAND_MM).L(x1, -STAND_MM).L(x1 + 0.6, -STAND_MM * 0.45).L(x1 - 1.5, 0).L((x0 + x1) / 2 + 3, 0.4).L(x0 + 2, 0).L(x0 - 0.6, -STAND_MM * 0.5).Z();
    } else sp.append(polygon([[x0, -STAND_MM], [x1, -STAND_MM], [x1, 0], [x0, 0]]));
    put('stand', sp);
  }

  // ---- shadow on the bed ------------------------------------------------------
  const sx = n.plan === 1 ? p(pose, 'footBL')[0] : (p(pose, 'footFL')[0] + p(pose, 'footBL')[0]) / 2;
  put('shadow', ellipse(sx, 0, n.bodyL * 0.72, 4.6));

  // ---- legs (far pair is darker and peeks out behind) -------------------------
  const hipB = p(pose, 'hipB'), shF = p(pose, 'shoulderF'), fB = p(pose, 'footBL'), fF = p(pose, 'footFL');
  const muscular = n.build === 2;
  // muscular build: a thigh / shoulder bulge at the top of each leg (inside the torso's lower half, never overhanging)
  // jointed legs: the drawing is the side view of the 3D leg (see limb.ts), so sketch and solid are one shape
  const biped = n.plan === D.PLAN.biped;
  const limb = (slot: 'legB' | 'legF', top: XY, f: XY): Path =>
    limbOutline(legLimb(legSpecOf(slot, biped, top, f, legW, foot, n.soleL, muscular), 0));
  const far = (path: (dx: number) => Path): [Path, Path] => [path(0), path(3.2)];
  if (n.plan === D.PLAN.quadruped || biped) {
    put('legB', limb('legB', hipB, fB));
    put('legBFar', limb('legB', [hipB[0] + 3.2, hipB[1]], [fB[0] + 3.2, fB[1]]));
    if (!biped) { // a biped has no front legs
      put('legF', limb('legF', shF, fF));
      put('legFFar', limb('legF', [shF[0] + 3.2, shF[1]], [fF[0] + 3.2, fF[1]]));
    }
  } else if (n.plan === D.PLAN.insect) {
    // six jointed legs: the thigh rises outwards to a knee above the flank, the shin drops steeply to a round foot
    const lw = insectLegW(legW), rise = insectRise(n.bodyG);
    const [nb, fb] = far((dx) => limbOutline(insectLimb(insectHips([hipB[0] + dx, hipB[1]], [shF[0] + dx, shF[1]]).legB, lw, rise, n.bodyW, 1)));
    const [nf, ff] = far((dx) => limbOutline(insectLimb(insectHips([hipB[0] + dx, hipB[1]], [shF[0] + dx, shF[1]]).legF, lw, rise, n.bodyW, 1)));
    put('legB', nb); put('legBFar', fb); put('legF', nf); put('legFFar', ff);
  } else if (n.plan === D.PLAN.caterpillar) {
    // stubby prolegs along the flat belly, peeking out of the flanks (drawn over the torso)
    const [nf, ff] = far((dx) => limbOutline(prolegLimb(prolegXs(torso[0] + dx, n.bodyL), 1)));
    put('legF', nf); put('legFFar', ff);
  }
  // fish: no legs
  if (n.plan === D.PLAN.octopus) {
    // side view of the eight tentacles lying on the bed (the same chains the solid is made of)
    put('arms', limbOutline(octopusLimb(torso[0], n.armLen, n.hub, D.OCTOPUS.arms)));
  }

  // ---- torso: a plain round ellipsoid; shape is never bent to avoid supports ---------
  // muscular build: chest and haunch lobes fused into it (the bake blends them smoothly)
  // one outline: an ellipse swelling at the shoulders (front, up) and the haunch (back, up), dipping at the waist
  const bump = (a: number, at: number, h: number, wd: number): number => h * Math.exp(-(((Math.atan2(Math.sin(a - at), Math.cos(a - at))) / wd) ** 2));
  const trunkPts: XY[] = [];
  const belly = D.onBelly(n.plan);
  const segs = n.plan === D.PLAN.caterpillar ? Math.max(4, Math.round(n.bodyL / 9)) : n.plan === D.PLAN.insect ? 3 : 1;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const k = muscular ? 1 + bump(a, 0.55, 0.16, 0.45) + bump(a, Math.PI - 0.6, 0.13, 0.45) - bump(a, Math.PI / 2, 0.07, 0.3) : 1;
    let lx = Math.cos(a) * tRx * k, ly = Math.sin(a) * tRy * k; // torso frame, then tilted (biped: nose up)
    if (segs > 1 && ly > 0) ly *= 1 - 0.14 * Math.abs(Math.sin((Math.PI * segs * (lx / tRx + 1)) / 2)) ** 6; // notches between segments
    if (n.plan === D.PLAN.fish) lx *= 1 + 0.12 * Math.sin(a) ** 2 * Math.sign(lx); // a fuller front, a slimmer back
    const wx = torso[0] + lx * Math.cos(n.tilt) - ly * Math.sin(n.tilt), wy = torso[1] + lx * Math.sin(n.tilt) + ly * Math.cos(n.tilt);
    trunkPts.push([wx, belly ? Math.max(0, wy) : wy]); // a belly plan lies flat on the bed
  }
  /** height of the trunk's top outline at x (for parts that stand on the back) */
  const trunkTop = (x: number): number => {
    let top = -Infinity;
    for (let i = 0; i < trunkPts.length; i++) {
      const [ax, ay] = trunkPts[i]!, [bx, by] = trunkPts[(i + 1) % trunkPts.length]!;
      if ((ax - x) * (bx - x) <= 0 && ax !== bx) top = Math.max(top, ay + ((x - ax) / (bx - ax)) * (by - ay));
    }
    return top === -Infinity ? torso[1] : top;
  };
  const trunk = (): Path => (muscular || belly || segs > 1 ? polygon(trunkPts) : ellipse(torso[0], torso[1], tRx, tRy, n.tilt));
  /** a shape drawn in the torso's own (untilted) frame, turned with the torso */
  const tilted = (path: Path): Path => path.rotated(torso[0], torso[1], n.tilt);
  put('torso', trunk());
  put('torsoClip', trunk());
  put('belly', tilted(ellipse(torso[0] - 0.5, torso[1] - tRy * 0.38, tRx * 0.7, tRy * 0.48)));

  const pattern = g.coat!.pattern!;
  const pt = new Path();
  if (n.build === 4) { // skeletal build: ribs painted on the flank (c3), whatever the coat pattern
    for (let i = 0; i < 5; i++) {
      const x = torso[0] + tRx * (0.32 - i * 0.17), top = torso[1] + tRy * 0.55, bot = torso[1] - tRy * (0.45 - Math.abs(i - 2) * 0.05);
      pt.append(taper([x + 1.5, top], [x - 1.6, (top + bot) / 2], [x + 1.2, bot], (t) => 2.2 - t * 0.8, 8));
    }
    pt.append(tube([torso[0] - tRx * 0.45, torso[1] + tRy * 0.58], [torso[0] + tRx * 0.45, torso[1] + tRy * 0.58], 1.8, 1.8));
  }
  if (pattern > 0) {
    if (pattern === 1) {
      for (let i = 0; i < 6; i++) {
        const x = torso[0] + (i - 2.5) * (n.bodyL / 6.2);
        pt.append(polygon([[x - 1.7, torso[1] + tRy + 2], [x + 1.7, torso[1] + tRy + 2], [x + 2.2, torso[1] - tRy - 2], [x - 1.2, torso[1] - tRy - 2]]));
      }
    } else if (pattern === 3) {
      // glowing spots: two rows of round photophores along the flank (c3, made for a glow-in-the-dark filament)
      for (const [fy, cnt, r] of [[0.12, 5, 1.5], [-0.28, 4, 1.25]] as const) {
        for (let i = 0; i < cnt; i++) pt.append(ellipse(torso[0] + ((i - (cnt - 1) / 2) / cnt) * n.bodyL * 0.78, torso[1] + fy * n.bodyG, r, r));
      }
    } else {
      const pts: [number, number, number][] = [[-0.55, 0.35, 2], [-0.2, 0.55, 1.6], [0.2, 0.3, 2.2], [0.5, 0.5, 1.7], [-0.4, -0.1, 1.5], [0, -0.05, 2], [0.4, -0.2, 1.6]];
      for (const [fx, fy, r] of pts) pt.append(ellipse(torso[0] + fx * n.bodyL * 0.9, torso[1] + fy * n.bodyG, r, r * 0.85));
    }
  }
  if (!pt.empty) put('pattern', tilted(pt));
  const acc = g.accessory!.type!;
  if (acc === 2) put('saddle', tilted(ellipse(torso[0] - n.bodyL * 0.02, torso[1] + tRy * 0.62, n.bodyL * 0.2, tRy * 0.3)));

  // ---- fish: fins. A forked tail fin whose lower edge lies on the bed, a dorsal fin raked back, a pectoral fin
  // swept back behind the head. Every free underside slopes >= 45 deg.
  const tailType = g.tail!.type!;
  if (n.plan === D.PLAN.fish) {
    const top = (x: number): number => trunkTop(x);
    const h = n.bodyG * 0.55, xf = torso[0] + tRx * 0.1, xb = torso[0] - tRx * 0.3;
    put('finD', polygon([[xf, top(xf) - 1], [xb - h * 0.3, top(xb) + h], [xb - h * 0.3 + TIP, top(xb) + h], [xb, top(xb) - 1]]));
    // pectoral fin: swept back and down from the flank, its tip clear of the bed (a fin, not a prop)
    const px = torso[0] + tRx * 0.45, py = torso[1] - tRy * 0.15, d = Math.min(6, tRy * 0.5), ty = Math.max(1.5, py - d);
    put('finP', polygon([[px + 2, py + 1.5], [px - d * 1.2, ty], [px - d * 1.2 + 2 * TIP, ty], [px + 3, py - 2]]));
  }
  if (n.plan === D.PLAN.fish && tailType > 0 && n.tailLen > 0.5) {
    const [x0, y0] = tailBase, len = n.tailLen;
    put('tail', polygon([[x0 + 3, y0 + 2], [x0 - len * 0.95, y0 + len * 0.75], [x0 - len * 0.95 + TIP, y0 + len * 0.75],
      [x0 - len * 0.55, y0 + len * 0.2], [x0 - len, 0], [x0 + 3, 0]]));
  } else if (tailType > 0 && n.tailLen > 0.5) {
    // ---- tail: leaves the rump backwards and up (>= 45 deg), tip is never thinner than TIP ----
    const ctrl: XY = [2 * tailMid[0] - (tailBase[0] + tailTip[0]) / 2, 2 * tailMid[1] - (tailBase[1] + tailTip[1]) / 2];
    const w0 = n.bodyG * 0.46;
    if (tailType === 4) {
      // bird tail: three long leaf-shaped feathers fanning up from the rump; the lowest one's lower edge is the spine
      // (>= 45 deg), the others are turned further up, so none overhangs
      const tp = new Path();
      for (const [ang, k] of [[0, 1.1], [0.3, 1], [0.6, 0.85]] as const) {
        const rot = (q: XY): XY => { const dx = (q[0] - tailBase[0]) * k, dy = (q[1] - tailBase[1]) * k; return [tailBase[0] + dx * Math.cos(-ang) - dy * Math.sin(-ang), tailBase[1] + dx * Math.sin(-ang) + dy * Math.cos(-ang)]; };
        tp.append(taper(tailBase, rot(ctrl), rot(tailTip), (t) => Math.max(1.8, 2.4 + n.bodyG * 0.22 * Math.sin(Math.PI * Math.min(0.92, t))), 14, true));
      }
      put('tail', tp.rotated(tailBase[0], tailBase[1], DIR_TURN.tail[g.tail!.dir ?? 0] ?? 0));
    } else if (tailType === 3) { // fan: a flat fan, widest at the tip
      const width = (t: number): number => Math.max(1.8, w0 * (1 - t) + n.bodyG * 1.1 * t * t);
      // (one-sided: widths are the FULL thickness measured upwards from the spine)
      put('tail', taper(tailBase, ctrl, tailTip, width, 14, true).rotated(tailBase[0], tailBase[1], DIR_TURN.tail[g.tail!.dir ?? 0] ?? 0)); // lower edge = spine (>= 45 deg)
    } else put('tail', limbOutline(roundTail(g, n.bodyG, tailBase, tailMid, tailTip)!)); // wolf, fluffy: round in 3D
  }

  // ---- neck ---------------------------------------------------------------------
  const dir: XY = [head[0] - neckBase[0], head[1] - neckBase[1]];
  const dl = Math.hypot(dir[0], dir[1]) || 1;
  const up: XY = [-dir[1] / dl, dir[0] / dl];
  put('neck', tube(neckBase, head, n.bodyG * 0.72, R * 1.15));
  const neckType = g.head!.neck!;
  const at = (t: number, off: number): XY => [neckBase[0] + dir[0] * t + up[0] * off, neckBase[1] + dir[1] * t + up[1] * off];
  const upSign = up[1] >= 0 ? 1 : -1;
  const neckW = (t: number): number => (n.bodyG * 0.72) * (1 - t) + R * 1.15 * t;
  const deco = new Path();
  if (neckType === 1) { // crested: raised zig-zag ridge, 1.6 mm wide
    const pts: XY[] = [];
    for (let i = 0; i <= 6; i++) pts.push(at(i / 6, upSign * (neckW(i / 6) / 2 - 1.2 + (i % 2 ? 1.6 : 0))));
    for (let i = 0; i < pts.length - 1; i++) deco.append(tube(pts[i]!, pts[i + 1]!, 1.6, 1.6));
  } else if (neckType === 2) { // armored: raised bands across the neck
    for (const t of [0.2, 0.4, 0.6, 0.8]) deco.append(tube(at(t, upSign * neckW(t) / 2 - 0.8), at(t, -upSign * neckW(t) / 2 + 0.8), 1.8, 1.8));
  }
  put('neckDecor', deco);
  if (acc === 1) {
    const t = 0.5;
    put('collar', tube(at(t, neckW(t) / 2 + 0.6), at(t, -neckW(t) / 2 - 0.6), 3, 3));
  }

  // ---- head ---------------------------------------------------------------------
  const skull = g.head!.skull!;
  const hs = headShape(head[0], head[1], skull);
  put('head', hs.path);

  const snoutType = g.snout!.type!;
  const topB: XY = [head[0] + hs.rx * 0.5, head[1] + hs.ry * 0.5];
  const botB: XY = [head[0] + hs.rx * 0.45, head[1] - hs.ry * 0.78];
  const tipX = Math.max(muzzle[0], head[0] + hs.rx * 0.95);
  const tip: XY = [tipX, muzzle[1] - 0.5];
  if (snoutType === 0) {
    put('snout', new Path().M(topB[0], topB[1]).Q(tipX + 1, tip[1] + 3, tipX, tip[1] - 1.5).Q(tipX - 0.5, tip[1] - 4, botB[0], botB[1]).Z());
  } else if (snoutType === 1) {
    put('snout', new Path().M(topB[0], topB[1]).Q(tipX - 3, tip[1] + 1.5, tipX, tip[1]).Q(tipX - 2, tip[1] - 4, botB[0], botB[1]).Z());
  } else {
    put('snout', new Path().M(topB[0], topB[1]).Q(tipX - 4, topB[1] + 2, tipX, tip[1] - 1.5)
      .L(tipX - 3.5, tip[1] - 4).L(botB[0], botB[1]).Z());
  }
  if (snoutType !== 2) put('nose', ellipse(tipX - 1.1, tip[1] + 0.7, 1.5, 1.2));


  // ---- ears (behind the head so their base is hidden) -----------------------------
  const er = p(pose, 'earRoot');
  if (n.earS > 0.3) {
    const ep = earPaths(g.ears!.type!, n.earS, er[0], er[1]);
    const turn = DIR_TURN.ears[g.ears!.dir ?? 0] ?? 0; // turned about the ear's root
    put('ear', ep.outer.rotated(er[0], er[1], turn));
    put('earIn', ep.inner.rotated(er[0], er[1], turn));
  }

  // ---- horns: every segment leans <= 45 deg from vertical, tips >= TIP wide -----------
  const hr = p(pose, 'hornRoot');
  const hornType = g.horns!.type!;
  if (n.hornS > 0.3 && hornType > 0) {
    const s = n.hornS, [x, y] = hr;
    const horns = new Path();
    if (hornType === 1) horns.append(taper([x, y], [x + 0.05 * s, y + 0.8 * s], [x - 0.3 * s, y + 1.2 * s], (t) => Math.max(TIP, 5 * (1 - t)), 10));
    else if (hornType === 2) horns.append(taper([x, y], [x - 0.05 * s, y + 0.9 * s], [x - 0.5 * s, y + 1.4 * s], (t) => Math.max(TIP, 5.6 * (1 - t * 0.8)), 12));
    else if (hornType === 3) {
      horns.append(spike(x, y, -2.5, 1.2, x - 0.4 * s, y + s));
      horns.append(spike(x, y, -0.2, 4, x + 0.05 * s, y + 1.25 * s)); // the two bases overlap well: one piece
    } else {
      horns.append(taper([x, y], [x - 0.1 * s, y + 0.6 * s], [x - 0.4 * s, y + 1.05 * s], (t) => Math.max(TIP, 4 * (1 - t * 0.6)), 8));
      horns.append(taper([x - 0.2 * s, y + 0.55 * s], [x + 0.05 * s, y + 0.8 * s], [x + 0.2 * s, y + 1.15 * s], (t) => Math.max(TIP, 2.8 * (1 - t)), 5));
      horns.append(taper([x - 0.3 * s, y + 0.8 * s], [x - 0.45 * s, y + 0.95 * s], [x - 0.65 * s, y + 1.3 * s], (t) => Math.max(TIP, 2.6 * (1 - t)), 5));
    }
    put('horns', horns.rotated(x, y, DIR_TURN.horns[g.horns!.dir ?? 0] ?? 0));
  }

  // ---- antennae (gene K): a pair of thin stalks leaning forward <= 25 deg, a ball or a feathery leaf on top ----------
  const antType = g.antennae?.type ?? 0;
  if (n.antS > 0.3 && antType > 0) {
    const L = n.antS, a0: XY = [head[0] + hs.rx * 0.15, head[1] + hs.ry - 1.2];
    const a1: XY = [a0[0] + L * 0.42, a0[1] + L];
    const ant = taper(a0, [a0[0] + L * 0.1, a0[1] + L * 0.6], a1, () => ANT_W, 10);
    if (antType === 1) ant.append(ellipse(a1[0], a1[1] + 0.6, 2.2, 2.2));
    else ant.append(taper([a0[0] + L * 0.18, a0[1] + L * 0.45], [a0[0] + L * 0.3, a0[1] + L * 0.75], [a1[0] + 0.3, a1[1] + 1.5], (t) => Math.max(TIP, 4.2 * Math.sin(Math.PI * Math.min(0.9, t * 0.9 + 0.1))), 10));
    put('antennae', ant.rotated(a0[0], a0[1], DIR_TURN.antennae[g.antennae!.dir ?? 0] ?? 0));
  }

  const crestType = g.crest!.type!;
  if (n.crestS > 0.3 && crestType > 0) {
    const c = n.crestS;
    if (crestType === 1) {
      const base: XY = [head[0] - 1, head[1] + hs.ry - 0.8];
      put('tuft', spike(base[0], base[1], -2.5, 1.5, base[0] + 0.5, base[1] + c * 1.2)
        .append(spike(base[0], base[1], 1, 5, base[0] + 3.8, base[1] + c)));
    } else if (crestType === 2) {
      const m = new Path();
      // every spike's base is >= 3.6 mm along the neck; a very short neck (a fish) gets one spike reaching past it
      const cnt = Math.max(dl >= 4 ? 2 : 1, Math.min(6, Math.floor(dl / 3.6)));
      const t0s = cnt === 1 && dl < 3.6 ? -(3.6 - dl) / 2 / dl : 0, span = cnt === 1 && dl < 3.6 ? 3.6 / dl : 1;
      for (let i = 0; i < cnt; i++) {
        const t0 = t0s + (span * i) / cnt, t1 = t0s + (span * (i + 1)) / cnt;
        const a = at(t0, upSign * neckW(t0) / 2 - 0.8), d2 = at(t1, upSign * neckW(t1) / 2 - 0.8);
        const b = at((t0 + t1) / 2, upSign * (neckW((t0 + t1) / 2) / 2 + c * 0.9));
        m.append(polygon([a, [b[0] - TIP / 2, b[1]], [b[0] + TIP / 2, b[1]], d2]));
      }
      put('mane', m);
    } else if (crestType === 4) {
      // crystals: clusters of pointed prisms along the back, the side ones leaning <= 30 deg
      const s = new Path();
      const x0 = neckBase[0], x1 = tailBase[0];
      for (let i = 0; i < 3; i++) {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / 3, y = trunkTop(x) - 1;
        const h = c * (1.15 - Math.abs(i - 1) * 0.25);
        s.append(polygon([[x - 2, y], [x - 2, y + h * 0.7], [x - TIP / 2, y + h], [x + TIP / 2, y + h], [x + 2, y + h * 0.7], [x + 2, y]]));
        s.append(spike(x - 1.5, trunkTop(x - 1.5) - 1, -1.6, 1.6, x - 1.5 - h * 0.3, trunkTop(x - 1.5) - 1 + h * 0.55));
        s.append(spike(x + 1.5, trunkTop(x + 1.5) - 1, -1.6, 1.6, x + 1.5 + h * 0.3 - TIP, trunkTop(x + 1.5) - 1 + h * 0.5));
      }
      put('spines', s);
    } else if (crestType === 5) {
      // plume (a bird's crest): three curved feathers raking back from the top of the head, <= 40 deg from vertical
      const base: XY = [head[0] + 0.5, head[1] + hs.ry - 1];
      const pl = new Path();
      for (const [dx, k, lean] of [[1.5, 1, 0.35], [0, 1.25, 0.55], [-1.5, 1.1, 0.75]] as const) {
        const b0: XY = [base[0] + dx, base[1]], h = c * 1.3 * k;
        pl.append(taper(b0, [b0[0] - h * lean * 0.3, b0[1] + h * 0.6], [b0[0] - h * lean, b0[1] + h], (t) => Math.max(TIP, 2.6 * (1 - t * 0.6)), 10));
      }
      put('tuft', pl);
    } else {
      const s = new Path();
      const x0 = neckBase[0], x1 = tailBase[0];
      for (let i = 0; i < 6; i++) {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / 6;
        const y = trunkTop(x) - 0.8;
        s.append(spike(x, y, -2.4, 2.4, x - 0.6, y + c));
      }
      put('spines', s);
    }
  }

  // ---- wings: saw-tooth outline, every lower edge rises >= 45 deg ---------------------------
  const wingType = g.wings!.type!;
  if (n.wingS > 0.5 && wingType > 0) {
    const s = n.wingS, [x, y] = wingRoot;
    const A: XY = [x + 3, y - 1.5];
    // bat: three fingers with WIDE scallops (a notch narrower than ~1 mm cannot be printed); every lower edge rises ~45 deg
    const w = wingType === 2
      ? polygon([A, [x + BAT.t1[0] * s, y + BAT.t1[1] * s], [x + BAT.n1[0] * s, y + BAT.n1[1] * s], [x + BAT.t2[0] * s, y + BAT.t2[1] * s],
        [x - 0.3 * s, y + 1.05 * s], [x + 0.05 * s, y + 0.95 * s]])
      : polygon([A, [x - 0.62 * s, y + 0.78 * s], [x - 0.35 * s, y + 1.05 * s], [x + 0.05 * s, y + 0.95 * s]]);
    put('wingNear', w);
    put('wingFar', w.translated(-3.5, 2.5));
    // bones (bat) or feather shafts: raised ridges on the outer face, drawn as lines along their crests
    const ribs = new Path();
    for (const r of wingRibs(wingType, wingRoot, s)) ribs.append(tube(r.a, r.b, 0.9, 0.7));
    put('wingRibs', ribs);
  }

  // ---- face -------------------------------------------------------------------------
  const face = g.face!;
  const er2 = EYE_R[face.eyes!] ?? 2.4;
  const eye: XY = [head[0] + hs.rx * 0.32, head[1] + hs.ry * 0.25];
  const eyes: [XY, number][] = face.eyes === EYES.many
    ? [[eye, er2], [[head[0] - hs.rx * 0.08, head[1] + hs.ry * 0.5], er2 * 0.8], [[head[0] + hs.rx * 0.62, head[1] + hs.ry * 0.02], er2 * 0.75], [[head[0] + hs.rx * 0.05, head[1] + hs.ry * 0.05], er2 * 0.7]]
    : face.eyes === EYES.stalks ? [[eyeOnStalk(head, hs), er2]] : [[eye, er2]];
  if (face.eyes === EYES.stalks) put('stalks', tube(eyeStalkRoot(head, hs), eyes[0]![0], STALK_W, STALK_W));
  const ew = new Path(), ei = new Path(), ep = new Path(), eg = new Path();
  for (const [[x, y], r] of eyes) {
    ew.append(ellipse(x, y, r, r * 1.08));
    ei.append(ellipse(x + r * 0.2, y - r * 0.04, r * 0.8, r * 0.86)); // drawing only: a coloured iris round the pupil
    ep.append(ellipse(x + r * 0.22, y - r * 0.05, r * 0.62, r * 0.7));
    eg.append(ellipse(x + r * 0.42, y + r * 0.32, r * 0.26, r * 0.26)).append(ellipse(x - r * 0.02, y - r * 0.38, r * 0.12, r * 0.12));
  }
  put('eye', ew); put('iris', ei); put('pupil', ep); put('glint', eg);
  // eyelids: a heavy fold over the top of the eyeball and a thin one under it (the same arcs spec3d rolls round the ball)
  const lids = new Path();
  for (const [c, r] of eyes) for (const lid of eyelids(r)) {
    const at = (a: number, d: number): XY => [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d * 1.08];
    const outer = lid.arc.map(([a, m, w]) => at(a, m + w)), inner = lid.arc.map(([a, m, w]) => at(a, m - w)).reverse();
    lids.append(polygon([...outer, ...inner]));
  }
  put('lids', lids);
  // drawing only: a rosy cheek under the eye, and two toe lines on each near paw
  put('blush', ellipse(head[0] + hs.rx * 0.38, head[1] - hs.ry * 0.3, Math.max(2.2, hs.rx * 0.26), Math.max(1.3, hs.ry * 0.14)));
  if (foot === 0 && (n.plan === D.PLAN.quadruped || n.plan === D.PLAN.biped)) {
    const toes = new Path();
    const feet = n.plan === D.PLAN.biped ? [fB] : [fB, fF];
    for (const f of feet) {
      const toe = f[0] + n.soleL * 0.7;
      for (const dx of [1.4, 3]) toes.append(tube([toe - dx, 0.5], [toe - dx + 0.3, 2.1], 0.7, 0.7));
    }
    put('toes', toes);
  }

  // grooves are real-width ribbons (0.9 mm) so the drawing shows what will be engraved
  const G = PRINT_RULES.grooveWidth + 0.1;
  const mouthA: XY = [tipX - 1.6, tip[1] - 1.6];
  const mouthB: XY = [head[0] + hs.rx * 0.22, head[1] - hs.ry * 0.4];
  const expr = face.expression!;
  // the mouth line as drawn: a smile is a curve, other expressions a straight cut (teeth follow the same line)
  const smile: [XY, XY, XY] = [mouthA, [(mouthA[0] + mouthB[0]) / 2, mouthA[1] - 2.8], [mouthB[0], mouthB[1] + 1.4]];
  const mouthAt = (f: number): XY => {
    if (expr !== 1) return [mouthA[0] + (mouthB[0] - mouthA[0]) * f, mouthA[1] + (mouthB[1] - mouthA[1]) * f];
    const [a, c, b] = smile, u = 1 - f;
    return [u * u * a[0] + 2 * u * f * c[0] + f * f * b[0], u * u * a[1] + 2 * u * f * c[1] + f * f * b[1]];
  };
  if (expr === 2) put('brow', tube([eye[0] - er2 - 1.4, eye[1] + er2 + 3], [eye[0] + er2 + 1.4, eye[1] + er2 + 1], G, G));

  if (face.teeth! > 0) {
    // teeth come with a really open mouth: the muzzle parts into two jaws, see openJaw
    const jaw = openJaw(out.snout.flatten(12)[0] ?? [], mouthA, mouthB, face.teeth!);
    put('snout', new Path().append(polygon(jaw.upper)).append(polygon(jaw.lower)));
    put('maw', polygon(jaw.maw));
    put('tongue', polygon(jaw.tongue));
    const t = new Path();
    for (const tooth of jaw.teeth) t.append(polygon(tooth));
    put('teeth', t);
  } else put('mouth', expr === 1 ? taper(smile[0], smile[1], smile[2], () => G, 8) : tube(mouthA, mouthB, G, G));
  if (face.whiskers! > 0) {
    // Whiskers stick out SIDEWAYS from the muzzle (a flat plate lying in the horizontal plane, see whiskerTop in
    // spec3d). Seen from the side they are foreshortened: the strands that fan back and forward from one root (drawn as
    // the dot where they leave the muzzle; the pad that seats a printed set is not drawn, see buildParts3D `print`).
    const len = whiskerLength(face.whiskers!);
    const wk = new Path();
    const [cx, cy] = whiskerRoot(tipX, tip);
    wk.append(ellipse(cx, cy, 1, 1));
    const off = WHISKER_TURN[face.whiskerDir ?? 0] ?? 0; // a strand pointing straight sideways shows no length here
    for (const a of WHISKER_FAN) if (Math.abs(Math.sin(a + off)) * len > 3) wk.append(tube([cx, cy + Math.sign(a)], [cx + Math.sin(a + off) * len, cy + Math.sign(a)], 1.2, 1.2)); // strands 1 mm apart fuse into one band
    put('whiskers', wk);
  }

  // ---- coat texture ------------------------------------------------------------------
  // the side view of the relief the bake sinks into the solid (coat.ts), masked in the sketch to the parts buildParts3D
  // textures: torso, neck and a round tail ('coat'), jointed legs, whose armour runs in rings ('coatLegs')
  const tex = g.coat!.texture!;
  if (tex > 0) {
    const cs = Math.cos(n.tilt), sn = Math.sin(n.tilt);
    const localBox = (ps: Path[]): [number, number, number, number] => {
      const b: [number, number, number, number] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const path of ps) for (const poly of path.flatten(2)) for (const [x, y] of poly) {
        const dx = x - torso[0], dy = y - torso[1], a = dx * cs + dy * sn, v = -dx * sn + dy * cs;
        b[0] = Math.min(b[0], a); b[1] = Math.max(b[1], a); b[2] = Math.min(b[2], v); b[3] = Math.max(b[3], v);
      }
      return b;
    };
    const body = [out.torso, out.neck, ...(n.plan !== D.PLAN.fish && (tailType === 1 || tailType === 2) ? [out.tail] : [])];
    put('coatOn', body.reduce((acc, x) => acc.append(x), new Path()));
    put('coat', tilted(coatPath(tex as 1 | 2 | 3, localBox(body), torso)));
    if (n.plan === D.PLAN.quadruped || biped) {
      put('coatLegB', new Path().append(out.legB));
      put('coatLegF', new Path().append(out.legF));
      put('coatLegs', tilted(coatPath(tex as 1 | 2 | 3, localBox([out.legB, out.legF]), torso, 'v')));
    }
  }

  // ---- rig overlay (optional, for the curious) ------------------------------------
  if (showBones) {
    const b = new Path();
    for (const id of rig.order) {
      const parent = rig.nodes[id].parent;
      if (!parent) continue;
      const a = p(pose, parent), c = p(pose, id);
      b.M(a[0], a[1]).L(c[0], c[1]);
    }
    put('bones', b);
  }
  return out;
}

/** Axis-aligned extent of the rig in mm (for the HUD readout). */
export function rigSize(rig: Rig): { length: number; height: number; width: number } {
  const { min, max } = rig.bounds;
  return {
    length: max[0] - min[0] + rig.dims.soleLength, height: max[1] - min[1],
    width: Math.max(rig.dims.bodyWidth, max[2] - min[2]),
  };
}
