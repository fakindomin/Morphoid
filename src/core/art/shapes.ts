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

/** skin/skinFar = body colour (c1); accent = c2; white/ink/glint = details; clip = not drawn. */
export type SlotKind =
  | 'shadow' | 'skin' | 'skinFar' | 'belly' | 'pattern' | 'accent' | 'accentFar' | 'accentSoft'
  | 'white' | 'ink' | 'glint' | 'groove' | 'bone' | 'clip';

export const SLOTS = [
  ['shadow', 'shadow'], ['wingFar', 'accentFar'], ['tail', 'skin'], ['legBFar', 'skinFar'], ['legFFar', 'skinFar'],
  ['legB', 'skin'], ['web', 'skin'], ['throat', 'skin'], ['torso', 'skin'], ['torsoClip', 'clip'], ['belly', 'belly'], ['pattern', 'pattern'],
  ['saddle', 'accent'], ['spines', 'accent'], ['legF', 'skin'], ['neck', 'skin'], ['neckDecor', 'skinFar'],
  ['mane', 'accent'], ['collar', 'accent'], ['ear', 'skin'], ['earIn', 'accentSoft'], ['horns', 'accent'], ['tuft', 'accent'],
  ['head', 'skin'], ['snout', 'skin'], ['wingNear', 'accent'], ['nose', 'ink'],
  ['mouth', 'groove'], ['teeth', 'white'], ['whiskers', 'skinFar'], ['eye', 'white'], ['pupil', 'ink'],
  ['glint', 'glint'], ['brow', 'groove'], ['bones', 'bone'],
] as const satisfies readonly (readonly [string, SlotKind])[];

export type SlotId = (typeof SLOTS)[number][0];
export type Shapes = Record<SlotId, string>;

const p = (pose: Pose, id: NodeId): XY => pose.pos[id];
const R = D.HEAD_RADIUS;

/** One leg + rounded foot. Soles are always flat on y = foot y (print rule). */
function leg(top: XY, foot: XY, w: number, type: number, soleL: number): Path {
  const [tx, ty] = top, [fx, fy] = foot;
  const hw = w / 2, fh = type === 2 ? 5 : 2.4;
  const toe = fx + soleL * 0.7, heel = fx - soleL * 0.3;
  const path = new Path().M(tx - hw, ty).L(tx + hw, ty).L(fx + hw * 0.9, fy + fh);
  if (type === 2) { // hoof: boxy
    path.L(fx + hw * 1.2, fy + fh).L(fx + hw * 1.2, fy).L(fx - hw * 1.2, fy).L(fx - hw * 1.2, fy + fh);
  } else {
    path.Q(toe + 0.5, fy + fh, toe, fy + 0.2);
    if (type === 1) path.L(toe, fy + 2.2).L(toe + 3.2, fy + 1.4).L(toe + 3.2, fy).L(toe, fy); // claw = wedge lying on the bed (>= 1.4 mm tip)
    path.L(heel, fy).Q(heel - 1.5, fy + fh * 0.6, fx - hw * 0.9, fy + fh);
  }
  return path.Z();
}

/** Torso silhouette: elliptical back, flat belly with 45 degree chamfers at both ends (support-free). */
function hull(cx: number, cy: number, rx: number, ry: number): Path {
  const r = Math.min(ry, rx * 0.9);
  const c = rx - r;
  const p = new Path().M(cx + rx, cy);
  for (let i = 1; i <= 24; i++) {
    const a = (Math.PI * i) / 24;
    p.L(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  // lower half: 45 deg chamfer in, flat belly, 45 deg chamfer out (corners softened)
  p.L(cx - c - 2.1, cy - r + 2.1).Q(cx - c, cy - r, cx - c + 3, cy - r);
  p.L(cx + c - 3, cy - r).Q(cx + c, cy - r, cx + c + 2.1, cy - r + 2.1);
  return p.Z();
}

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

/** Slots -> geometry in rig millimetres. THE source for both the 2D art and the print audit. */
export type SlotPaths = Record<SlotId, Path>;

export function buildShapes(pose: Pose, g: MorphotypeGenome, rig: Rig, to: ToPx, showBones: boolean): Shapes {
  const paths = buildPaths(pose, g, rig, showBones);
  const out = {} as Shapes;
  for (const [id] of SLOTS) out[id] = paths[id].empty ? '' : paths[id].d(to);
  return out;
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
  const legW = Math.max(6.5, n.bodyG * 0.5);
  const foot = g.legs!.foot!;
  const tRx = n.bodyL / 2 + 2.5, tRy = n.bodyG / 2 + 1.5;
  const maxBridge = PRINT_RULES.maxBridge;

  // ---- shadow on the bed ------------------------------------------------------
  const sx = (p(pose, 'footFL')[0] + p(pose, 'footBL')[0]) / 2;
  put('shadow', ellipse(sx, 0, n.bodyL * 0.78, 3.4));

  // ---- legs (far pair is darker and peeks out behind) -------------------------
  const hipB = p(pose, 'hipB'), shF = p(pose, 'shoulderF'), fB = p(pose, 'footBL'), fF = p(pose, 'footFL');
  put('legB', leg(hipB, fB, legW, foot, n.soleL));
  put('legF', leg(shF, fF, legW, foot, n.soleL));
  put('legBFar', leg([hipB[0] + 3.2, hipB[1]], [fB[0] + 3.2, fB[1]], legW, foot, n.soleL));
  put('legFFar', leg([shF[0] + 3.2, shF[1]], [fF[0] + 3.2, fF[1]], legW, foot, n.soleL));

  // ---- torso (flat belly + 45 deg chamfers) and the belly arch between the legs ----
  put('torso', hull(torso[0], torso[1], tRx, tRy));
  put('torsoClip', hull(torso[0], torso[1], tRx, tRy));
  put('belly', ellipse(torso[0] - 0.5, torso[1] - tRy * 0.38, tRx * 0.62, tRy * 0.44));

  const innerB = hipB[0] + legW / 2, innerF = shF[0] - legW / 2;
  const gap = innerF - innerB;
  const bottomY = torso[1] - Math.min(tRy, tRx * 0.9);
  if (gap > 1 && bottomY > 0.5) {
    // Pointed arch under the belly: walls rise at 45 deg, the flat ceiling (= the belly) is never wider than maxBridge.
    const hb = Math.min(gap / 2, bottomY + maxBridge / 2);
    const hc = Math.min(bottomY, hb);
    const ht = hb - hc;
    const xm = (innerB + innerF) / 2;
    put('web', new Path().M(innerB, 0).L(xm - hb, 0).L(xm - ht, hc).L(xm + ht, hc).L(xm + hb, 0).L(innerF, 0)
      .L(innerF, torso[1]).L(innerB, torso[1]).Z());
  }

  const pattern = g.coat!.pattern!;
  if (pattern > 0) {
    const pt = new Path();
    if (pattern === 1) {
      for (let i = 0; i < 6; i++) {
        const x = torso[0] + (i - 2.5) * (n.bodyL / 6.2);
        pt.append(polygon([[x - 1.7, torso[1] + tRy + 2], [x + 1.7, torso[1] + tRy + 2], [x + 2.2, torso[1] - tRy - 2], [x - 1.2, torso[1] - tRy - 2]]));
      }
    } else {
      const pts: [number, number, number][] = [[-0.55, 0.35, 2], [-0.2, 0.55, 1.6], [0.2, 0.3, 2.2], [0.5, 0.5, 1.7], [-0.4, -0.1, 1.5], [0, -0.05, 2], [0.4, -0.2, 1.6]];
      for (const [fx, fy, r] of pts) pt.append(ellipse(torso[0] + fx * n.bodyL * 0.9, torso[1] + fy * n.bodyG, r, r * 0.85));
    }
    put('pattern', pt);
  }
  const acc = g.accessory!.type!;
  if (acc === 2) put('saddle', ellipse(torso[0] - n.bodyL * 0.02, torso[1] + tRy * 0.62, n.bodyL * 0.2, tRy * 0.3));

  // ---- tail: leaves the rump backwards and up (>= 45 deg), tip is never thinner than TIP ----
  const tailType = g.tail!.type!;
  if (tailType > 0 && n.tailLen > 0.5) {
    const ctrl: XY = [2 * tailMid[0] - (tailBase[0] + tailTip[0]) / 2, 2 * tailMid[1] - (tailBase[1] + tailTip[1]) / 2];
    const w0 = n.bodyG * 0.46;
    const width = tailType === 1 ? (t: number) => Math.max(1.8, w0 * (1 - t * 0.9))
      : tailType === 2 ? (t: number) => Math.max(1.8, w0 * (1 - t) + n.bodyG * 0.95 * Math.sin(Math.PI * Math.min(0.98, t * 0.95 + 0.04)))
      : (t: number) => Math.max(1.8, w0 * (1 - t) + n.bodyG * 1.1 * t * t);
    put('tail', taper(tailBase, ctrl, tailTip, width, 14));
  }

  // ---- neck ---------------------------------------------------------------------
  put('neck', tube(neckBase, head, n.bodyG * 0.72, R * 1.15));
  const neckType = g.head!.neck!;
  const dir: XY = [head[0] - neckBase[0], head[1] - neckBase[1]];
  const dl = Math.hypot(dir[0], dir[1]) || 1;
  const up: XY = [-dir[1] / dl, dir[0] / dl];
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

  // Chin/throat wedge: the muzzle underside runs 45 deg down-back from the chin until it meets the
  // FRONT edge of the neck; the triangle in between is filled so nothing hangs in the air.
  const chin: XY = [tipX - 0.5, tip[1] - 4.2];
  const w0 = n.bodyG * 0.72;
  const q0: XY = [neckBase[0] - (up[0] * w0) / 2, neckBase[1] - (up[1] * w0) / 2]; // front/lower side of the neck
  const dn: XY = [dir[0] / dl, dir[1] / dl];
  const den = dn[0] - dn[1];
  if (Math.abs(den) > 1e-6) {
    const u = ((chin[0] - chin[1]) - (q0[0] - q0[1])) / den;
    const s = chin[0] - q0[0] - u * dn[0];
    if (s > 0.2) {
      const uc = Math.max(0, Math.min(dl, u));
      const hit: XY = [q0[0] + dn[0] * uc, q0[1] + dn[1] * uc];
      put('throat', polygon([chin, hit, head]));
    }
  }

  // ---- ears (behind the head so their base is hidden) -----------------------------
  const er = p(pose, 'earRoot');
  if (n.earS > 0.3) {
    const ep = earPaths(g.ears!.type!, n.earS, er[0], er[1]);
    put('ear', ep.outer);
    put('earIn', ep.inner);
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
      horns.append(spike(x, y, 1, 4, x + 0.05 * s, y + 1.25 * s));
    } else {
      horns.append(taper([x, y], [x - 0.1 * s, y + 0.6 * s], [x - 0.4 * s, y + 1.05 * s], (t) => Math.max(TIP, 4 * (1 - t * 0.6)), 8));
      horns.append(taper([x - 0.2 * s, y + 0.55 * s], [x + 0.05 * s, y + 0.8 * s], [x + 0.2 * s, y + 1.15 * s], (t) => Math.max(TIP, 2.8 * (1 - t)), 5));
      horns.append(taper([x - 0.3 * s, y + 0.8 * s], [x - 0.45 * s, y + 0.95 * s], [x - 0.65 * s, y + 1.3 * s], (t) => Math.max(TIP, 2.6 * (1 - t)), 5));
    }
    put('horns', horns);
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
      const cnt = Math.max(2, Math.min(6, Math.floor(dl / 3.6)));
      for (let i = 0; i < cnt; i++) {
        const t0 = i / cnt, t1 = (i + 1) / cnt;
        const a = at(t0, upSign * neckW(t0) / 2 - 0.8), d2 = at(t1, upSign * neckW(t1) / 2 - 0.8);
        const b = at((t0 + t1) / 2, upSign * (neckW((t0 + t1) / 2) / 2 + c * 0.9));
        m.append(polygon([a, [b[0] - TIP / 2, b[1]], [b[0] + TIP / 2, b[1]], d2]));
      }
      put('mane', m);
    } else {
      const s = new Path();
      const x0 = neckBase[0], x1 = tailBase[0];
      for (let i = 0; i < 6; i++) {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / 6;
        const k = Math.max(0, 1 - ((x - torso[0]) / tRx) ** 2);
        const y = torso[1] + tRy * Math.sqrt(k) - 0.8;
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
    const w = wingType === 2
      ? polygon([A, [x - 0.4 * s, y + 0.55 * s], [x - 0.3 * s, y + 0.3 * s], [x - 0.75 * s, y + 0.78 * s],
        [x - 0.3 * s, y + 1.05 * s], [x + 0.05 * s, y + 0.95 * s]])
      : polygon([A, [x - 0.62 * s, y + 0.78 * s], [x - 0.35 * s, y + 1.05 * s], [x + 0.05 * s, y + 0.95 * s]]);
    put('wingNear', w);
    put('wingFar', w.translated(-3.5, 2.5));
  }

  // ---- face -------------------------------------------------------------------------
  const face = g.face!;
  const er2 = [1.7, 2.4, 3.2][face.eyes!]!;
  const eye: XY = [head[0] + hs.rx * 0.32, head[1] + hs.ry * 0.25];
  put('eye', ellipse(eye[0], eye[1], er2, er2 * 1.08));
  put('pupil', ellipse(eye[0] + er2 * 0.22, eye[1] - er2 * 0.05, er2 * 0.62, er2 * 0.7));
  put('glint', ellipse(eye[0] + er2 * 0.42, eye[1] + er2 * 0.32, er2 * 0.24, er2 * 0.24));

  // grooves are real-width ribbons (0.9 mm) so the drawing shows what will be engraved
  const G = PRINT_RULES.grooveWidth + 0.1;
  const mouthA: XY = [tipX - 1.6, tip[1] - 1.6];
  const mouthB: XY = [head[0] + hs.rx * 0.22, head[1] - hs.ry * 0.4];
  const expr = face.expression!;
  put('mouth', expr === 1
    ? taper(mouthA, [(mouthA[0] + mouthB[0]) / 2, mouthA[1] - 2.8], [mouthB[0], mouthB[1] + 1.4], () => G, 8)
    : tube(mouthA, mouthB, G, G));
  if (expr === 2) put('brow', tube([eye[0] - er2 - 1.4, eye[1] + er2 + 3], [eye[0] + er2 + 1.4, eye[1] + er2 + 1], G, G));

  if (face.teeth! > 0) { // flat relief on the muzzle side, inside the silhouette
    const t = new Path();
    const count = face.teeth === 1 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const f = face.teeth === 1 ? 0.35 + i * 0.4 : 0.2 + i * 0.2;
      const x = mouthA[0] + (mouthB[0] - mouthA[0]) * f, y = mouthA[1] + (mouthB[1] - mouthA[1]) * f + 0.5;
      t.append(polygon([[x - 1.2, y + 2.6], [x + 1.2, y + 2.6], [x, y]]));
    }
    put('teeth', t);
  }
  if (face.whiskers! > 0) { // separate flat part: 1.4 mm wide plates, 1.6 mm thick
    const len = face.whiskers === 1 ? 6 : 11;
    const wk = new Path();
    for (const a of [-0.25, 0.05, 0.35]) {
      const wx = tipX - 3, wy = tip[1] + 1;
      wk.append(tube([wx, wy], [wx + Math.cos(a) * len, wy + Math.sin(a) * len - 1], 1.4, 1.4));
    }
    put('whiskers', wk);
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
