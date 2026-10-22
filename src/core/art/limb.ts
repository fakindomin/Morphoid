/**
 * Jointed legs built as real 3D solids, not extruded side outlines.
 *
 * A leg is a chain of round cones (tapered capsules) from the hip or shoulder through the knee, hock and ankle down to
 * a paw. The paw is the upper half of an ellipsoid, so its sole is a flat ellipse on the bed; a hoof is a short flat-
 * bottomed cone, claws are three low ridges running forward on the bed. Everything is clipped at y = 0.
 *
 * Every segment stays within LEAN_MAX of vertical and the radii shrink downwards, so no surface of a leg faces the bed
 * at more than 45 deg: legs print without supports, like the old straight ones.
 *
 * The side view of the same chain (the convex hull of the two end circles of every cone) is the 2D drawing, so the
 * sketch and the solid are one shape.
 */
import { Path, polygon, type XY } from './path';

export type V3 = [number, number, number];
export interface Cone { a: V3; b: V3; ra: number; rb: number }
/** Upper half of an ellipsoid centred on the bed (c[1] = 0): radii along x, y, z. */
export interface Dome { c: V3; r: V3 }
export interface Limb {
  cones: Cone[]; domes: Dome[];
  /** claws or a hoof at the foot: a separate, darker part of the same leg (spec3d makes them the 'claws' slot) */
  tips?: Cone[];
  /** blend radius (mm) between all of its pieces: an anatomical trunk melts its masses together (a leg's cones meet sharply) */
  blend?: number;
}

/** The narrowest a leg may get (mm radius): 3.2 mm across is two perimeters a side and still stiff. */
export const LIMB_MIN_R = 1.6;
/** Blend radius between the paw and the leg (mm). */
const PAW_BLEND = 1.4;

export type LegKind = 'hind' | 'fore' | 'bird';

/**
 * Joint positions as (forward offset, height) fractions of the leg height H, top to bottom (the paw is added below).
 * hind: the knee forward, the hock back (a dog's or cat's back leg); fore: an elbow slightly back, a straight wrist;
 * bird: a long shin and a backward "knee" (really the ankle), as on a bird or a raptor.
 */
const JOINTS: Record<LegKind, [number, number][]> = {
  hind: [[0.15, 0.6], [-0.05, 0.3]],
  fore: [[-0.07, 0.62], [0.03, 0.26]],
  bird: [[0.14, 0.66], [-0.1, 0.34]],
};
/** Radius at the top, at each joint above and at the ankle, as fractions of the leg width. */
const RADII: Record<LegKind, number[]> = {
  hind: [0.56, 0.42, 0.31, 0.3],
  fore: [0.5, 0.38, 0.32, 0.3],
  bird: [0.52, 0.36, 0.28, 0.27],
};

/** Muscle bellies per segment (top-knee, knee-hock): where along it (0..1) and how full, times its wider end. */
const BELLY: readonly ([number, number] | null)[] = [[0.42, 1.06], [0.3, 1.1], null];
/** Joints are drawn in to this share of their radius. */
const PINCH = 0.86;

export interface LegSpec {
  kind: LegKind;
  /** hip or shoulder (side view, mm) and the foot node on the bed */
  top: XY; foot: XY;
  legW: number;
  /** foot gene: 0 paw, 1 claws, 2 hoof, 3 cat's paw, 4 bear's paw, 5 webbed, 6 cloven hoof, 7 a monkey's hand */
  footType: number;
  soleL: number;
  /** muscular build: a fuller thigh */
  muscular: boolean;
}

/** The leg at depth z (its side-view position is the same on both sides). */
export function legLimb(s: LegSpec, z: number): Limb {
  const [tx, ty] = s.top, [fx] = s.foot;
  const H = Math.max(1, ty);
  const w = s.legW, R = RADII[s.kind];
  // the thigh keeps a 3 mm gap to its pair across the body (z = 0 is the side view: nothing to keep apart)
  const r = (i: number): number => {
    const v = Math.max(LIMB_MIN_R, w * R[i]! * (i === 0 && s.muscular ? 1.15 : 1));
    return z === 0 ? v : Math.max(LIMB_MIN_R, Math.min(v, Math.abs(z) - 1.5));
  };
  // short legs bend less: the joints need room between them
  const bend = Math.min(1, Math.max(0, (H - 1.2 * w) / (1.6 * w)));
  const paw = pawOf(s, z);
  const ankle: V3 = [fx + (isHoof(s.footType) ? 0 : -s.soleL * 0.04), paw.ankleY, z];
  const pts: { p: V3; r: number }[] = [{ p: [tx, ty, z], r: r(0) }];
  JOINTS[s.kind].forEach(([dx, fy], i) => {
    const x = fx + (tx - fx) * fy + dx * H * bend;
    pts.push({ p: [x, Math.max(paw.ankleY + 0.5, H * fy), z], r: r(i + 1) });
  });
  pts.push({ p: ankle, r: r(3) });
  // pinch and bulge (rule "zwężenia i nabrzmienia"): narrow at every joint, full in the thigh and the calf
  const shaped: { p: V3; r: number }[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, belly = BELLY[i - 1];
    if (belly) {
      const [t, k] = belly, lerp = (u: number, v: number): number => u + (v - u) * t;
      shaped.push({ p: [lerp(a.p[0], b.p[0]), lerp(a.p[1], b.p[1]), z], r: Math.max(a.r, b.r) * k });
    }
    shaped.push(i < pts.length - 1 ? { p: b.p, r: Math.max(LIMB_MIN_R, b.r * PINCH) } : b);
  }
  pts.splice(0, pts.length, ...shaped);
  // drop joints too close to the next one (very short legs): the chain then runs straight
  const chain = pts.filter((q, i) => i === 0 || i === pts.length - 1 || dist(q.p, pts[i - 1]!.p) > Math.abs(q.r - pts[i - 1]!.r) + 1);
  const cones: Cone[] = [];
  for (let i = 0; i + 1 < chain.length; i++) cones.push({ a: chain[i]!.p, b: chain[i + 1]!.p, ra: chain[i]!.r, rb: chain[i + 1]!.r });
  return { cones: [...cones, ...paw.cones], domes: paw.domes, tips: paw.tips };
}

function pawOf(s: LegSpec, z: number): { ankleY: number; cones: Cone[]; domes: Dome[]; tips: Cone[] } {
  const fx = s.foot[0], w = s.legW;
  if (isHoof(s.footType)) { // hoof: a flat-bottomed horn cone, a little wider at the bed, under a short pastern
    const rb = Math.max(2.6, Math.min(w * 0.62, Math.abs(z) - 1.5)), rt = Math.max(LIMB_MIN_R, w * 0.4);
    const pastern: Cone[] = [{ a: [fx, 3.4, z], b: [fx, 4.6, z], ra: rt * 1.05, rb: rt }];
    if (s.footType === FOOT.cloven) { // a cloven hoof (a deer's, a goat's, a cow's): two toes side by side, split in front
      const rh = Math.max(1.5, rb * 0.56), dz = rb - rh;
      const toe = (k: number): Cone => ({ a: [fx + 0.5, 0, z + k * dz], b: [fx - 0.2, 3.6, z + k * dz * 0.4], ra: rh, rb: rt * 0.62 });
      return { ankleY: 4.6, cones: pastern, domes: [], tips: [toe(1), toe(-1)] };
    }
    return { ankleY: 4.6, cones: pastern, domes: [], tips: [{ a: [fx, 0, z], b: [fx, 3.8, z], ra: rb, rb: rt * 1.08 }] };
  }
  if (s.footType === FOOT.webbed) { // webbed foot (a duck's, a frog's): three long toes fanned forward, a thin web between them
    const rz = Math.max(LIMB_MIN_R + 0.4, Math.min(w * 0.6, Math.abs(z) - 1.5)), len = Math.max(4, s.soleL * 0.62), tr = Math.max(0.9, Math.min(1.4, w * 0.2));
    const cx = fx + s.soleL * 0.05, heel: V3 = [cx, tr, z];
    const tips: Cone[] = [], cones: Cone[] = [];
    for (const k of [-1, 0, 1]) cones.push({ a: heel, b: [cx + len * (1 - Math.abs(k) * 0.12), tr * 0.9, z + k * rz * 0.95], ra: tr * 1.25, rb: tr });
    for (const k of [-1, 0, 1]) { const t = cones[k + 1]!.b; tips.push({ a: t, b: [t[0] + 1.6, 0.25, t[2]], ra: tr * 0.7, rb: 0.25 }); }
    const domes: Dome[] = [{ c: [cx + len * 0.45, 0, z], r: [len * 0.55, 0.9, rz * 0.9] }, { c: [cx - 0.5, 0, z], r: [Math.max(2.6, tr * 2.4), Math.max(2.4, w * 0.36), Math.min(rz, w * 0.45)] }];
    return { ankleY: Math.max(2.4, w * 0.36) * 0.8, cones, domes, tips };
  }
  if (s.footType === FOOT.hand) { // a monkey's hand (or hand-like foot): a long flat palm on the bed, four fingers lying forward, a thumb inside
    const side = Math.sign(z) || 1;
    const rz = Math.max(LIMB_MIN_R + 0.4, Math.min(w * 0.55, Math.abs(z) - 1.5)), ry = Math.max(1.8, w * 0.28);
    const palmL = Math.max(4, s.soleL * 0.45), fingL = Math.max(3.5, s.soleL * 0.42), fr = Math.max(0.8, Math.min(1.5, rz * 0.3));
    const cx = fx + palmL * 0.3;
    const heel = Math.max(2.4, w * 0.4);
    const domes: Dome[] = [{ c: [cx, 0, z], r: [palmL * 0.6, ry, rz] }, { c: [fx - 0.4, 0, z], r: [heel, Math.max(2.2, w * 0.36), rz * 0.85] }];
    const cones: Cone[] = [];
    for (const k of [-1.5, -0.5, 0.5, 1.5]) { // fingers: two segments each, the middle ones longest, spreading a little
      const dz = k * rz * 0.5, l = fingL * (1 - Math.abs(k) * 0.12);
      const a: V3 = [cx + palmL * 0.45, fr, z + dz], m: V3 = [a[0] + l * 0.55, fr, z + dz * 1.12], e: V3 = [a[0] + l, fr * 0.9, z + dz * 1.2];
      cones.push({ a, b: m, ra: fr, rb: fr * 0.92 }, { a: m, b: e, ra: fr * 0.92, rb: fr * 0.8 });
    }
    const t0: V3 = [cx, fr, z - side * rz * 0.75], t1: V3 = [cx + fingL * 0.45, fr, z - side * rz * 0.9];
    cones.push({ a: t0, b: t1, ra: fr * 1.05, rb: fr * 0.85 });
    return { ankleY: heel * 0.75, cones, domes, tips: [] };
  }
  // the paw is a little wider than the ankle, but keeps a 3 mm gap to its pair (a narrower gap fuses on the bed)
  // a cat's paw is short and round, a bear's broad and flat with five toes
  const cat = s.footType === FOOT.cat, bear = s.footType === FOOT.bear;
  const rx = Math.max(3, s.soleL / 2), rz = Math.max(LIMB_MIN_R + 0.4, Math.min(w * (bear ? 0.68 : cat ? 0.5 : 0.55), Math.abs(z) - 1.5)), ry = Math.max(2.4, w * (bear ? 0.34 : cat ? 0.46 : 0.4));
  const cx = fx + s.soleL * (cat ? 0.12 : 0.2);
  const domes: Dome[] = [{ c: [cx, 0, z], r: [rx, ry, rz] }];
  // toes: round knuckles along the front of the paw (four, or three on a narrow paw; a bear has five)
  const n = rz < 2.2 ? 3 : bear && rz >= 3 ? 5 : 4, tr = Math.min(rz * (n === 5 ? 0.3 : n === 4 ? 0.36 : 0.44), ry * (cat ? 0.6 : 0.55));
  const cones: Cone[] = [], tips: Cone[] = [];
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2, dz = k * rz * (n === 5 ? 0.38 : n === 4 ? 0.46 : 0.58);
    const t: V3 = [cx + rx * Math.sqrt(Math.max(0.25, 1 - (dz / rz) ** 2)) - tr * 0.35 - Math.abs(k) * 0.25, tr * 1.05, z + dz]; // half out of the paw's front
    cones.push({ a: t, b: t, ra: tr, rb: tr });
    // claws: a curved point out of every toe, down to the bed
    if (s.footType === FOOT.claws) tips.push({ a: [t[0] + tr * 0.4, t[1], t[2]], b: [t[0] + tr + 2.2, 0.25, t[2] + dz * 0.15], ra: tr * 0.7, rb: 0.2 });
    else if (bear) tips.push({ a: [t[0] + tr * 0.4, t[1], t[2]], b: [t[0] + tr + 1.4, 0.3, t[2] + dz * 0.1], ra: tr * 0.6, rb: 0.25 }); // short, blunt claws
  }
  return { ankleY: ry * 0.8, cones, domes, tips };
}

/** Foot types (gene L). */
export const FOOT = { paw: 0, claws: 1, hoof: 2, cat: 3, bear: 4, webbed: 5, cloven: 6, hand: 7 } as const;
export const isHoof = (t: number): boolean => t === FOOT.hoof || t === FOOT.cloven;

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Polynomial smooth minimum. */
const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** Exact signed distance to a round cone (Inigo Quilez). */
export function sdRoundCone(x: number, y: number, z: number, c: Cone): number {
  const bax = c.b[0] - c.a[0], bay = c.b[1] - c.a[1], baz = c.b[2] - c.a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = c.ra - c.rb;
  if (l2 <= rr * rr + 1e-9) { // one sphere swallows the other
    return c.ra >= c.rb ? Math.hypot(x - c.a[0], y - c.a[1], z - c.a[2]) - c.ra : Math.hypot(x - c.b[0], y - c.b[1], z - c.b[2]) - c.rb;
  }
  const a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = x - c.a[0], pay = y - c.a[1], paz = z - c.a[2];
  const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
  const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - c.rb;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - c.ra;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - c.ra;
}

/** Signed distance to an ellipsoid (a close bound, exact on the axes). */
function sdEllipsoid(x: number, y: number, z: number, d: Dome): number {
  const px = (x - d.c[0]) / d.r[0], py = (y - d.c[1]) / d.r[1], pz = (z - d.c[2]) / d.r[2];
  const k0 = Math.hypot(px, py, pz);
  const k1 = Math.hypot(px / d.r[0], py / d.r[1], pz / d.r[2]) || 1e-9;
  return (k0 * (k0 - 1)) / k1;
}

/** Signed distance to the whole limb, flat on the bed (nothing below y = 0). */
export function limbSd(l: Limb, x: number, y: number, z: number): number {
  let d = Infinity;
  const k = l.blend ?? PAW_BLEND;
  for (const c of l.cones) d = l.blend ? smin(d, sdRoundCone(x, y, z, c), k) : Math.min(d, sdRoundCone(x, y, z, c));
  for (const m of l.domes) d = smin(d, sdEllipsoid(x, y, z, m), k);
  return Math.max(d, -y);
}

/**
 * limbSd sampled on a block of grid points (x = ox + i h, i in [0, nx), likewise y and z), exact wherever it lies within
 * `reach` of the limb. A limb of many cones (eight tentacles) would test every cone at every point; here each cone only
 * fills the points near it. Points farther than `reach` from every part get Infinity.
 */
export function limbField(l: Limb, ox: number, oy: number, oz: number, h: number, nx: number, ny: number, nz: number, reach: number): Float32Array {
  const out = new Float32Array(nx * ny * nz).fill(Infinity);
  const kb = l.blend ?? PAW_BLEND;
  const span = (lo: number, hi: number, o: number, n: number): [number, number] =>
    [Math.max(0, Math.floor((lo - o) / h)), Math.min(n - 1, Math.ceil((hi - o) / h))];
  const each = (lo: V3, hi: V3, f: (idx: number, x: number, y: number, z: number) => void): void => {
    const [i0, i1] = span(lo[0], hi[0], ox, nx), [j0, j1] = span(lo[1], hi[1], oy, ny), [k0, k1] = span(lo[2], hi[2], oz, nz);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f((k * ny + j) * nx + i, ox + i * h, oy + j * h, oz + k * h);
  };
  for (const c of l.cones) {
    const r = Math.max(c.ra, c.rb) + reach + kb;
    each([Math.min(c.a[0], c.b[0]) - r, Math.min(c.a[1], c.b[1]) - r, Math.min(c.a[2], c.b[2]) - r],
      [Math.max(c.a[0], c.b[0]) + r, Math.max(c.a[1], c.b[1]) + r, Math.max(c.a[2], c.b[2]) + r],
      l.blend ? (idx, x, y, z) => { out[idx] = smin(out[idx]!, sdRoundCone(x, y, z, c), kb); }
        : (idx, x, y, z) => { const d = sdRoundCone(x, y, z, c); if (d < out[idx]!) out[idx] = d; });
  }
  for (const m of l.domes) {
    const r = reach + kb;
    each([m.c[0] - m.r[0] - r, m.c[1] - m.r[1] - r, m.c[2] - m.r[2] - r], [m.c[0] + m.r[0] + r, m.c[1] + m.r[1] + r, m.c[2] + m.r[2] + r],
      (idx, x, y, z) => { out[idx] = smin(out[idx]!, sdEllipsoid(x, y, z, m), kb); });
  }
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const y = oy + j * h;
    for (let i = 0, idx = (k * ny + j) * nx; i < nx; i++, idx++) if (out[idx]! < -y) out[idx] = -y;
  }
  return out;
}

export function limbBox(l: Limb): { lo: V3; hi: V3 } {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: V3, r: V3): void => {
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, p[i]! - r[i]!); hi[i] = Math.max(hi[i]!, p[i]! + r[i]!); }
  };
  for (const c of l.cones) { grow(c.a, [c.ra, c.ra, c.ra]); grow(c.b, [c.rb, c.rb, c.rb]); }
  for (const m of l.domes) grow(m.c, m.r);
  lo[1] = Math.max(0, lo[1]);
  return { lo, hi };
}

/** Side view of the limb: every cone as the hull of its two end circles, every dome as a half ellipse on the bed. */
export function limbOutline(l: Limb): Path {
  const out = new Path();
  const circle = (c: V3, r: number, n: number): XY[] => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as XY;
  });
  for (const c of l.cones) out.append(polygon(clipBed(hull([...circle(c.a, c.ra, 32), ...circle(c.b, c.rb, 32)]))));
  for (const m of l.domes) {
    const pts: XY[] = [];
    for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI; pts.push([m.c[0] + Math.cos(a) * m.r[0], m.c[1] + Math.sin(a) * m.r[1]]); }
    out.append(polygon(pts));
  }
  return out;
}

/** Points below the bed are lifted onto it (the solid is clipped there too). */
const clipBed = (pts: XY[]): XY[] => pts.map(([x, y]) => [x, Math.max(0, y)] as XY);

/** Convex hull, counter-clockwise (monotone chain). */
function hull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: XY, a: XY, b: XY): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [], upper: XY[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Where every pair of jointed legs leaves the trunk (side view) and where its foot stands, rear first: one pair stands
 * under the middle of a level trunk (under the hips of an upright one), more pairs spread evenly from the hips to the
 * shoulders. An upright creature's extra pairs leave a short trunk (a humanoid's all at the hips) and splay their feet
 * apart so no two soles of a side touch (touching feet would close a loop through the body). The rear pair is the hind
 * legs (slot legB), every other pair a front pair (legF).
 */
export function legTops(pairs: number, upright: boolean, hipB: XY, shF: XY, stand: { human: boolean; girth: number; soleL: number; legW: number }): { slot: 'legB' | 'legF'; top: XY; footX: number }[] {
  if (pairs <= 0) return [];
  if (pairs === 1) { const top: XY = upright ? hipB : [(hipB[0] + shF[0]) / 2, (hipB[1] + shF[1]) / 2]; return [{ slot: 'legB', top, footX: top[0] }]; }
  // (an upright creature's tops sit at least a leg's width and a gap apart, round their middle, so its legs do not
  // touch where they leave the trunk)
  const [ax, ay, bx, by] = upright && stand.human ? [hipB[0] - stand.girth * 0.25, hipB[1], hipB[0] + stand.girth * 0.25, hipB[1]] : [hipB[0], hipB[1], shF[0], shF[1]];
  const len = Math.hypot(bx - ax, by - ay) || 1, need = upright ? (stand.legW * 1.2 + 1) * (pairs - 1) : 0, k = Math.max(1, need / len);
  const tops = Array.from({ length: pairs }, (_, i): XY => {
    const t = (i / (pairs - 1) - 0.5) * k + 0.5;
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  });
  const mid = tops.reduce((a, t) => a + t[0], 0) / pairs;
  const step = Math.max(Math.abs(tops[1]![0] - tops[0]![0]), stand.soleL + 5.8); // heel to toe (and claws) plus a gap
  return tops.map((top, i) => ({ slot: i === 0 ? 'legB' : 'legF', top, footX: upright ? mid + (i - (pairs - 1) / 2) * step : top[0] }));
}

/** Several limbs as one (tips kept). */
export const mergeLimbs = (limbs: Limb[]): Limb => ({
  cones: limbs.flatMap((l) => l.cones), domes: limbs.flatMap((l) => l.domes), tips: limbs.flatMap((l) => l.tips ?? []),
});

/** The leg of a slot: hind legs bend like a dog's, a biped's like a bird's, front legs stay nearly straight. */
export function legSpecOf(slot: 'legB' | 'legF', biped: boolean, top: XY, foot: XY, legW: number, footType: number, soleL: number, muscular: boolean, humanoid = false): LegSpec {
  // a humanoid's legs are nearly straight, knees forward, like a front leg
  return { kind: slot === 'legF' || humanoid ? 'fore' : biped ? 'bird' : 'hind', top, foot, legW, footType, soleL, muscular };
}

/** Hand kinds (gene X): 1 grasping hands, 2 talons, 3 mitts. Arm poses: 0 held in front, 1 raised, 2 hanging. */
export const HAND = { grip: 1, talons: 2, mitts: 3 } as const;
/** World angles (rad, from forward, counter-clockwise) of the upper arm and the forearm, per pose. */
const ARM_POSE: readonly [number, number][] = [[-1.05, 0.2], [-0.3, 0.7], [-1.6, -0.75]];
/** An upright humanoid's poses: elbows bent with the hands in front, raised, or hanging loose along the body. */
const HUMAN_POSE: readonly [number, number][] = [[-1.75, -0.2], [-0.6, 1.2], [-1.62, -1.38]];

export interface ArmSpec {
  /** shoulder (side view, mm), buried in the upper chest */
  shoulder: XY;
  len: number; legW: number; hand: number; pose: number;
  /** an upright humanoid's arm (its own poses) */
  human?: boolean;
  /** the right arm's pose (the left one's is `pose`) */
  poseR: number;
  /** how far out (mm) the shoulder may sit at most: it stays in the chest when thick legs push the hand out */
  shoulderZ?: number;
  /** the handle's swing (rad, counter-clockwise in the side view): the whole arm turns about the shoulder */
  swing?: number;
}

/** Where the shoulder sits: in the torso's own frame (forward, up), turned with its tilt. */
export function armShoulder(torso: XY, bodyL: number, bodyG: number, tilt: number, at: readonly [number, number] = [0.3, 0.12]): XY {
  const a = bodyL * at[0], b = bodyG * at[1], c = Math.cos(tilt), s = Math.sin(tilt);
  return [torso[0] + a * c - b * s, torso[1] + a * s + b * c];
}

/** How far out (z, mm) the elbow and the hand stand, clear of the flank and of the front leg beneath. */
export function armZ(bodyW: number, legW: number): { shoulder: number; out: number } {
  const rF = Math.max(LIMB_MIN_R, legW * 0.3);
  return { shoulder: bodyW * 0.3, out: Math.max(bodyW * 0.43, bodyW * 0.32 + legW * 0.62) + rF + 1 };
}

const turn = (a: number): [number, number] => [Math.cos(a), Math.sin(a)];

/**
 * One arm: an upper arm and a forearm (round cones, narrowing to the wrist) and a hand. A grasping hand is a palm with
 * three fingers curling into a hook and a thumb closing against them, so it can hold a stick; talons are three long
 * curved points; mitts are a round fist with knuckles. `z` is the hand's depth (its sign picks the side).
 */
export function armLimb(s: ArmSpec, z: number): Limb {
  // a low creature (a caterpillar, short legs) would put its hand on the bed: the arm gets shorter, and if even a short
  // one cannot clear the bed, the arm is raised
  for (const pose of s.pose === 1 ? [1] : [s.pose, 1]) {
    for (let k = 1; k >= 0.5; k -= 0.1) {
      const l = armAt({ ...s, pose, len: s.len * k }, z);
      if (Math.min(...[...l.cones, ...(l.tips ?? [])].flatMap((c) => [c.a[1] - c.ra, c.b[1] - c.rb])) >= ARM_BED_CLEAR) return l;
    }
  }
  return armAt({ ...s, pose: 1, len: s.len * 0.5 }, z);
}

/** How high (mm) a hand stays above the bed. */
const ARM_BED_CLEAR = 1.5;

function armAt(s: ArmSpec, z: number): Limb {
  const side = Math.sign(z) || 1, zo = Math.abs(z), zs = z === 0 ? 0 : side * Math.min(zo * 0.7, s.shoulderZ ?? Infinity);
  const rU = Math.max(LIMB_MIN_R, s.legW * 0.36), rE = Math.max(LIMB_MIN_R, s.legW * 0.3), rW = Math.max(LIMB_MIN_R, s.legW * 0.26);
  const poses = s.human ? HUMAN_POSE : ARM_POSE, [ua0, fa0] = poses[s.pose] ?? poses[0]!, ua = ua0 + (s.swing ?? 0), fa = fa0 + (s.swing ?? 0);
  const u = turn(ua), f = turn(fa);
  const sh: V3 = [s.shoulder[0], s.shoulder[1], zs];
  const el: V3 = [sh[0] + u[0] * s.len * 0.5, sh[1] + u[1] * s.len * 0.5, z];
  const wr: V3 = [el[0] + f[0] * s.len * 0.5, el[1] + f[1] * s.len * 0.5, z];
  // a full upper arm, pinched at the elbow, a forearm swelling a little below it
  const fore: V3 = [el[0] + f[0] * s.len * 0.18, el[1] + f[1] * s.len * 0.18, z];
  const cones: Cone[] = [
    { a: sh, b: el, ra: rU, rb: rE * PINCH },
    { a: el, b: fore, ra: rE * PINCH, rb: rE * 1.05 },
    { a: fore, b: wr, ra: rE * 1.05, rb: rW },
  ];
  const tips: Cone[] = [];
  const palmR = Math.max(2.4, rW * 1.5);
  const at = (o: V3, d: [number, number], l: number, dz = 0): V3 => [o[0] + d[0] * l, o[1] + d[1] * l, o[2] + dz];
  const palm = at(wr, f, palmR * 0.8);
  if (s.hand === HAND.mitts) { // a round fist with three knuckles along its front
    const r = palmR * 1.2;
    cones.push({ a: palm, b: palm, ra: r, rb: r });
    const kr = Math.max(0.8, r * 0.36);
    for (const k of [-1, 0, 1]) {
      const kn = at(palm, f, r * 0.85, k * r * 0.55);
      cones.push({ a: kn, b: kn, ra: kr, rb: kr });
    }
  } else {
    cones.push({ a: wr, b: palm, ra: rW, rb: palmR });
    const fr = Math.max(0.8, palmR * 0.3);
    // fingers curl down (towards the inside of the hook), the thumb comes up from below to close it
    const curl = s.hand === HAND.talons ? [0, -0.6, -1.25] : [0, -1.25, -2.4];
    const seg = s.hand === HAND.talons ? [palmR * 1.1, palmR * 1.0, palmR * 0.9] : [palmR * 1.0, palmR * 0.8, palmR * 0.6];
    for (const k of [-1, 0, 1]) {
      let p = at(palm, f, palmR * 0.7, k * palmR * 0.6);
      const last = seg.length - 1;
      seg.forEach((l, i) => {
        const q = at(p, turn(fa + curl[i]!), l, k * 0.15 * l);
        const pointed = s.hand === HAND.talons && i === last;
        (pointed ? tips : cones).push({ a: p, b: q, ra: pointed ? fr * 0.9 : fr, rb: pointed ? 0.2 : fr * (i === last ? 0.85 : 0.95) });
        p = q;
      });
    }
    if (s.hand === HAND.grip) { // the thumb: from the palm's underside forward and up, against the curled fingers
      const t0 = at(palm, turn(fa - Math.PI / 2), palmR * 0.6, side * palmR * 0.3);
      const t1 = at(t0, turn(fa - 0.5), palmR * 0.8);
      const t2 = at(t1, turn(fa + 0.35), palmR * 0.6);
      cones.push({ a: t0, b: t1, ra: fr * 1.1, rb: fr }, { a: t1, b: t2, ra: fr, rb: fr * 0.85 });
    }
  }
  return { cones, domes: [], tips };
}

const merge = (limbs: Limb[]): Limb => ({ cones: limbs.flatMap((l) => l.cones), domes: limbs.flatMap((l) => l.domes) });

/**
 * Insect legs on one side (z sign of `side`): from the hip the thigh rises outwards at 45 deg to a knee above the body's
 * flank, the shin drops steeply to a small round foot on the bed. `dir`: +1 reaches forward, -1 back, 0 straight out.
 */
export function insectLimb(hips: { hip: XY; dir: number }[], w: number, rise: number, bodyW: number, z: number): Limb {
  const side = Math.sign(z) || 1, z0 = Math.abs(z) * 0.8;
  const rHip = Math.max(LIMB_MIN_R, w * 0.55), rKnee = Math.max(LIMB_MIN_R, w * 0.45), rFoot = Math.max(LIMB_MIN_R, w * 0.4);
  return merge(hips.map(({ hip: [hx, hy], dir }) => {
    // the knee stands clear of the flank; the thigh rises at least as much as it reaches out (45 deg prints clean)
    const out = bodyW / 2 + rKnee + rise * 0.35 - z0, dx = dir * rise * 0.5;
    const up = Math.max(rise * 1.2, Math.hypot(out, dx) * 1.3);
    const knee: V3 = [hx + dx, hy + up, side * (z0 + out)];
    const foot: V3 = [knee[0] + dir * rise * 0.25, rFoot + 0.4, side * (z0 + out + rise * 0.35)];
    return {
      cones: [{ a: [hx, hy, side * z0], b: knee, ra: rHip, rb: rKnee }, { a: knee, b: foot, ra: rKnee, rb: rFoot }],
      domes: [{ c: [foot[0], 0, foot[2]], r: [rFoot + 1, rFoot * 0.9, rFoot + 1] }],
    };
  }));
}

/** Caterpillar prolegs: short stubs out of the flank at every x, each on a round pad. */
export function prolegLimb(xs: number[], z: number): Limb {
  const side = Math.sign(z) || 1, zz = Math.abs(z);
  return merge(xs.map((x) => ({
    cones: [{ a: [x, 4.2, side * zz * 0.85], b: [x, 1.6, side * (zz + 0.4)], ra: 2.1, rb: 1.7 }],
    domes: [{ c: [x, 0, side * (zz + 0.4)], r: [2.2, 1.7, 2] }],
  })));
}

/**
 * Octopus arms: eight tentacles lying on the bed around the hub, each a chain of round cones along the same curl as the
 * old top-view outline (see octopusArms), thick at the hub and tapering to the tip. Their centres sit low, so the bed
 * clips a flat underside off every arm.
 */
export function octopusLimb(cx: number, len: number, hub: number, arms: number): Limb {
  const n = 10, cones: Cone[] = [];
  const a0: XY = [hub * 0.5, 0], c: XY = [len * 0.7, len * 0.1], b: XY = [len, len * 0.42];
  const at = (t: number): XY => { const u = 1 - t; return [u * u * a0[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a0[1] + 2 * u * t * c[1] + t * t * b[1]]; };
  const rad = (t: number): number => Math.max(1.1, 3.2 * (1 - t) + 1.1 * t);
  for (let k = 0; k < arms; k++) {
    const ang = ((k + 0.5) * 2 * Math.PI) / arms, cs = Math.cos(ang), sn = Math.sin(ang);
    const pt = (t: number): V3 => { const [x, zz] = at(t), r = rad(t); return [cx + x * cs - zz * sn, r * 0.5, x * sn + zz * cs]; };
    for (let i = 0; i < n; i++) cones.push({ a: pt(i / n), b: pt((i + 1) / n), ra: rad(i / n), rb: rad((i + 1) / n) });
  }
  return { cones, domes: [] };
}

/**
 * A round tail along the quadratic spine a -> b (control c): `width(t)` is the full thickness measured up from the spine
 * (the same profile the flat tail had), so the round tail's lower edge is still the spine (>= 45 deg) and its side view
 * is the old outline. `turn` rotates it about `a` (direction gene).
 */
export function tailLimb(a: XY, c: XY, b: XY, width: (t: number) => number, turn: number, n = 14): Limb {
  const cs = Math.cos(turn), sn = Math.sin(turn);
  const rot = ([x, y]: XY): XY => [a[0] + (x - a[0]) * cs - (y - a[1]) * sn, a[1] + (x - a[0]) * sn + (y - a[1]) * cs];
  const at = (t: number): { p: V3; r: number } => {
    const u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], y = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
    const tx = 2 * u * (c[0] - a[0]) + 2 * t * (b[0] - c[0]), ty = 2 * u * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    const l = Math.hypot(tx, ty) || 1, r = Math.max(LIMB_MIN_R * 0.6, width(t) / 2);
    const [px, py] = rot([x + (ty / l) * r, y - (tx / l) * r]); // the centre sits r to the right of the spine
    return { p: [px, py, 0], r };
  };
  const cones: Cone[] = [];
  for (let i = 0; i < n; i++) { const p = at(i / n), q = at((i + 1) / n); cones.push({ a: p.p, b: q.p, ra: p.r, rb: q.r }); }
  return { cones, domes: [] };
}
