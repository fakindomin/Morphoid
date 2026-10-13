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
export interface Limb { cones: Cone[]; domes: Dome[] }

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

export interface LegSpec {
  kind: LegKind;
  /** hip or shoulder (side view, mm) and the foot node on the bed */
  top: XY; foot: XY;
  legW: number;
  /** foot gene: 0 paw, 1 claws, 2 hoof */
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
  const ankle: V3 = [fx + (s.footType === 2 ? 0 : -s.soleL * 0.04), paw.ankleY, z];
  const pts: { p: V3; r: number }[] = [{ p: [tx, ty, z], r: r(0) }];
  JOINTS[s.kind].forEach(([dx, fy], i) => {
    const x = fx + (tx - fx) * fy + dx * H * bend;
    pts.push({ p: [x, Math.max(paw.ankleY + 0.5, H * fy), z], r: r(i + 1) });
  });
  pts.push({ p: ankle, r: r(3) });
  // drop joints too close to the next one (very short legs): the chain then runs straight
  const chain = pts.filter((q, i) => i === 0 || i === pts.length - 1 || dist(q.p, pts[i - 1]!.p) > Math.abs(q.r - pts[i - 1]!.r) + 1);
  const cones: Cone[] = [];
  for (let i = 0; i + 1 < chain.length; i++) cones.push({ a: chain[i]!.p, b: chain[i + 1]!.p, ra: chain[i]!.r, rb: chain[i + 1]!.r });
  return { cones: [...cones, ...paw.cones], domes: paw.domes };
}

function pawOf(s: LegSpec, z: number): { ankleY: number; cones: Cone[]; domes: Dome[] } {
  const fx = s.foot[0], w = s.legW;
  if (s.footType === 2) { // hoof: a flat-bottomed cone, a little wider at the bed
    const rb = Math.max(2.6, Math.min(w * 0.62, Math.abs(z) - 1.5));
    return { ankleY: 4.6, cones: [{ a: [fx, 0, z], b: [fx, 4.2, z], ra: rb, rb: Math.max(LIMB_MIN_R, w * 0.4) }], domes: [] };
  }
  // the paw is a little wider than the ankle, but keeps a 3 mm gap to its pair (a narrower gap fuses on the bed)
  const rx = Math.max(3, s.soleL / 2), rz = Math.max(LIMB_MIN_R + 0.4, Math.min(w * 0.55, Math.abs(z) - 1.5)), ry = Math.max(2.4, w * 0.4);
  const cx = fx + s.soleL * 0.2;
  const domes: Dome[] = [{ c: [cx, 0, z], r: [rx, ry, rz] }];
  const cones: Cone[] = [];
  if (s.footType === 1) { // claws: three low ridges reaching forward past the paw, lying on the bed
    const toe = cx + rx;
    for (const k of [-1, 0, 1]) {
      const dz = k * rz * 0.5;
      cones.push({ a: [toe - 2.2, 0.4, z + dz], b: [toe + 2.4, 0.2, z + dz * 1.15], ra: 1.3, rb: 0.9 });
    }
  }
  return { ankleY: ry * 0.8, cones, domes };
}

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
  for (const c of l.cones) d = Math.min(d, sdRoundCone(x, y, z, c));
  for (const m of l.domes) d = smin(d, sdEllipsoid(x, y, z, m), PAW_BLEND);
  return Math.max(d, -y);
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

/** The leg of a slot: hind legs bend like a dog's, a biped's like a bird's, front legs stay nearly straight. */
export function legSpecOf(slot: 'legB' | 'legF', biped: boolean, top: XY, foot: XY, legW: number, footType: number, soleL: number, muscular: boolean): LegSpec {
  return { kind: slot === 'legF' ? 'fore' : biped ? 'bird' : 'hind', top, foot, legW, footType, soleL, muscular };
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
