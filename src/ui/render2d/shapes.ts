/**
 * Pure side-view artwork ("toy figurine" style): (pose, genome) -> SVG path
 * strings, one per fixed slot, in z-order. Slots are rendered once by React;
 * the rAF loop only rewrites `d` attributes (and only when the string
 * changed). Colours come from CSS (--c1/--c2/--c3 = the genome's palette).
 * Geometry is in rig mm, +X forward, +Y up; ToPx mirrors X (faces left).
 */
import type { MorphotypeGenome } from '../../core/genome';
import { dimensions as D, type NodeId, type Rig } from '../../core/rig';
import { ellipse, line, Path, polygon, taper, tube, type ToPx, type XY } from './path';
import type { Pose } from './pose';

/** skin/skinFar = body colour (c1); accent = c2; white/ink/glint = details; clip = not drawn. */
export type SlotKind =
  | 'shadow' | 'skin' | 'skinFar' | 'belly' | 'pattern' | 'accent' | 'accentFar' | 'accentSoft'
  | 'white' | 'ink' | 'glint' | 'line' | 'bone' | 'clip';

export const SLOTS = [
  ['shadow', 'shadow'], ['wingFar', 'accentFar'], ['tail', 'skin'], ['legBFar', 'skinFar'], ['legFFar', 'skinFar'],
  ['legB', 'skin'], ['torso', 'skin'], ['torsoClip', 'clip'], ['belly', 'belly'], ['pattern', 'pattern'],
  ['saddle', 'accent'], ['spines', 'accent'], ['legF', 'skin'], ['neck', 'skin'], ['neckDecor', 'line'],
  ['mane', 'accent'], ['collar', 'accent'], ['ear', 'skin'], ['earIn', 'accentSoft'], ['horns', 'accent'], ['tuft', 'accent'],
  ['head', 'skin'], ['snout', 'skin'], ['wingNear', 'accent'], ['nose', 'ink'],
  ['mouth', 'line'], ['teeth', 'white'], ['whiskers', 'line'], ['eye', 'white'], ['pupil', 'ink'],
  ['glint', 'glint'], ['brow', 'line'], ['bones', 'bone'],
] as const satisfies readonly (readonly [string, SlotKind])[];

export type SlotId = (typeof SLOTS)[number][0];
export type Shapes = Record<SlotId, string>;

const p = (pose: Pose, id: NodeId): XY => pose.pos[id];
const R = D.HEAD_RADIUS;

/** One leg + rounded foot. Soles are always flat on y = foot y (print rule). */
function leg(top: XY, foot: XY, w: number, type: number, soleL: number): Path {
  const [tx, ty] = top, [fx, fy] = foot;
  const hw = w / 2, fh = type === 2 ? 5 : 3.5;
  const toe = fx + soleL * 0.7, heel = fx - soleL * 0.3;
  const path = new Path().M(tx - hw, ty).L(tx + hw, ty).L(fx + hw * 0.9, fy + fh);
  if (type === 2) { // hoof: boxy
    path.L(fx + hw * 1.2, fy + fh).L(fx + hw * 1.2, fy).L(fx - hw * 1.2, fy).L(fx - hw * 1.2, fy + fh);
  } else {
    path.Q(toe + 0.5, fy + fh, toe, fy + 0.2);
    if (type === 1) path.L(toe + 0.1, fy + 2.2).L(toe + 3.4, fy + 0.9).L(toe, fy); // claw tip, sole stays flat
    path.L(heel, fy).Q(heel - 1.5, fy + fh * 0.6, fx - hw * 0.9, fy + fh);
  }
  return path.Z();
}

function headShape(hx: number, hy: number, skull: number): { rx: number; ry: number; path: Path } {
  const [rx, ry] = skull === 1 ? [R * 1.12, R * 0.82] : skull === 2 ? [R * 1.1, R * 0.7] : [R, R * 0.96];
  return { rx, ry, path: ellipse(hx, hy, rx, ry) };
}

function earPaths(type: number, e: number, ex: number, ey: number): { outer: Path; inner: Path } {
  if (type === 1) {
    return {
      outer: polygon([[ex - 3.5, ey + 2], [ex - 1.5, ey + 2 + e], [ex + 4.5, ey + 1]]),
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

export function buildShapes(pose: Pose, g: MorphotypeGenome, rig: Rig, to: ToPx, showBones: boolean): Shapes {
  const out = {} as Shapes;
  for (const [id] of SLOTS) out[id] = '';
  const put = (id: SlotId, path: Path): void => { out[id] = path.empty ? '' : path.d(to); };

  const n = pose.n;
  const torso = p(pose, 'torso');
  const head = p(pose, 'head');
  const neckBase = p(pose, 'neckBase');
  const muzzle = p(pose, 'muzzle');
  const tailBase = p(pose, 'tailBase');
  const tailTip = p(pose, 'tailTip');
  const wingRoot = p(pose, 'wingRoot');
  const legW = Math.max(6.5, n.bodyG * 0.5);
  const foot = g.legs!.foot!;
  const tRx = n.bodyL / 2 + 2.5, tRy = n.bodyG / 2 + 1.5;

  // ---- shadow on the bed ------------------------------------------------------
  const sx = (p(pose, 'footFL')[0] + p(pose, 'footBL')[0]) / 2;
  put('shadow', ellipse(sx, 0, n.bodyL * 0.78, 3.4));

  // ---- legs (far pair is darker and peeks out behind) -------------------------
  const hipB = p(pose, 'hipB'), shF = p(pose, 'shoulderF'), fB = p(pose, 'footBL'), fF = p(pose, 'footFL');
  put('legB', leg(hipB, fB, legW, foot, n.soleL));
  put('legF', leg(shF, fF, legW, foot, n.soleL));
  put('legBFar', leg([hipB[0] + 3.2, hipB[1]], [fB[0] + 3.2, fB[1]], legW, foot, n.soleL));
  put('legFFar', leg([shF[0] + 3.2, shF[1]], [fF[0] + 3.2, fF[1]], legW, foot, n.soleL));

  // ---- torso, belly, pattern, saddle ---------------------------------------------
  put('torso', ellipse(torso[0], torso[1], tRx, tRy));
  put('torsoClip', ellipse(torso[0], torso[1], tRx, tRy));
  put('belly', ellipse(torso[0] - 0.5, torso[1] - tRy * 0.38, tRx * 0.7, tRy * 0.48));

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

  // ---- tail -------------------------------------------------------------------
  const tailType = g.tail!.type!;
  if (tailType > 0 && n.tailLen > 0.5) {
    const lift = n.tailLen * 0.18;
    const ctrl: XY = [(tailBase[0] + tailTip[0]) / 2, (tailBase[1] + tailTip[1]) / 2 + lift];
    const w0 = n.bodyG * 0.46;
    const width = tailType === 1 ? (t: number) => w0 * (1 - t * 0.9)
      : tailType === 2 ? (t: number) => w0 * (1 - t) + n.bodyG * 1.05 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.04))
      : (t: number) => w0 * (1 - t) + n.bodyG * 1.35 * t * t;
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
  if (neckType === 1) { // crested: zigzag
    const pts: XY[] = [];
    for (let i = 0; i <= 6; i++) pts.push(at(i / 6, upSign * (neckW(i / 6) / 2 + (i % 2 ? 3.5 : -0.5))));
    pts.forEach(([x, y], i) => (i ? deco.L(x, y) : deco.M(x, y)));
  } else if (neckType === 2) { // armored: plates
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const a = at(t, upSign * neckW(t) / 2), b = at(t, -upSign * neckW(t) / 2);
      deco.M(a[0], a[1]).L(b[0], b[1]);
    }
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
    put('ear', ep.outer);
    put('earIn', ep.inner);
  }

  // ---- horns / crest ---------------------------------------------------------------
  const hr = p(pose, 'hornRoot');
  const hornType = g.horns!.type!;
  if (n.hornS > 0.3 && hornType > 0) {
    const s = n.hornS, [x, y] = hr;
    const horns = new Path();
    if (hornType === 1) horns.append(taper([x, y], [x + 0.1 * s, y + 0.7 * s], [x - 0.5 * s, y + s], (t) => 5 * (1 - t), 8));
    else if (hornType === 2) horns.append(taper([x, y], [x - 0.9 * s, y + 1.1 * s], [x - 0.6 * s, y + 0.1 * s], (t) => 5.6 * (1 - t * 0.8), 12));
    else if (hornType === 3) {
      horns.append(polygon([[x - 2.5, y], [x - 0.4 * s, y + s], [x + 1.2, y]]));
      horns.append(polygon([[x + 1, y], [x + 0.05 * s, y + 1.25 * s], [x + 4, y]]));
    } else {
      horns.append(taper([x, y], [x - 0.1 * s, y + 0.6 * s], [x - 0.5 * s, y + s], (t) => 4 * (1 - t * 0.6), 8));
      horns.append(taper([x - 0.2 * s, y + 0.55 * s], [x + 0.1 * s, y + 0.8 * s], [x + 0.25 * s, y + 1.05 * s], (t) => 2.8 * (1 - t), 5));
      horns.append(taper([x - 0.35 * s, y + 0.8 * s], [x - 0.5 * s, y + 0.95 * s], [x - 0.8 * s, y + 1.0 * s], (t) => 2.6 * (1 - t), 5));
    }
    put('horns', horns);
  }

  const crestType = g.crest!.type!;
  if (n.crestS > 0.3 && crestType > 0) {
    const c = n.crestS;
    if (crestType === 1) {
      const base: XY = [head[0] - 1, head[1] + hs.ry - 0.8];
      put('tuft', polygon([[base[0] - 2.5, base[1]], [base[0] + 1, base[1] + c * 1.2], [base[0] + 4.5, base[1]]])
        .append(polygon([[base[0] + 1, base[1]], [base[0] + 4.5, base[1] + c], [base[0] + 7, base[1] - 0.5]])));
    } else if (crestType === 2) {
      const m = new Path();
      for (let i = 0; i < 5; i++) {
        const t0 = 0.08 + i * 0.18;
        m.append(polygon([at(t0, upSign * neckW(t0) / 2 - 0.5), at(t0 + 0.09, upSign * (neckW(t0) / 2 + c * 0.9)), at(t0 + 0.18, upSign * neckW(t0 + 0.18) / 2 - 0.5)]));
      }
      put('mane', m);
    } else {
      const s = new Path();
      const x0 = neckBase[0], x1 = tailBase[0];
      for (let i = 0; i < 6; i++) {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / 6;
        const k = Math.max(0, 1 - ((x - torso[0]) / tRx) ** 2);
        const y = torso[1] + tRy * Math.sqrt(k) - 0.8;
        s.append(polygon([[x - 2.2, y], [x + 0.4, y + c], [x + 2.2, y]]));
      }
      put('spines', s);
    }
  }

  // ---- wings -----------------------------------------------------------------------
  const wingType = g.wings!.type!;
  if (n.wingS > 0.5 && wingType > 0) {
    const s = n.wingS, [x, y] = wingRoot;
    let w: Path;
    if (wingType === 2) {
      w = polygon([
        [x + 2.5, y], [x - 0.15 * s, y + 0.75 * s], [x - 0.35 * s, y + 1.0 * s], [x - 0.55 * s, y + 0.62 * s],
        [x - 0.75 * s, y + 0.82 * s], [x - 0.8 * s, y + 0.35 * s], [x - 1.0 * s, y + 0.38 * s], [x - 0.6 * s, y + 0.05 * s], [x - 0.3 * s, y - 0.05 * s],
      ]);
    } else {
      w = taper([x, y], [x - 0.2 * s, y + 0.9 * s], [x - 1.0 * s, y + 0.7 * s], (t) => 0.78 * s * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.05)), 12);
    }
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

  const mouthA: XY = [tipX - 1.6, tip[1] - 1.6];
  const mouthB: XY = [head[0] + hs.rx * 0.22, head[1] - hs.ry * 0.4];
  const expr = face.expression!;
  put('mouth', expr === 1
    ? new Path().M(mouthA[0], mouthA[1]).Q((mouthA[0] + mouthB[0]) / 2, mouthA[1] - 2.8, mouthB[0], mouthB[1] + 1.4)
    : line(mouthA, mouthB));
  if (expr === 2) put('brow', line([eye[0] - er2 - 1.4, eye[1] + er2 + 3], [eye[0] + er2 + 1.4, eye[1] + er2 + 1]));

  if (face.teeth! > 0) {
    const t = new Path();
    const count = face.teeth === 1 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const f = face.teeth === 1 ? 0.35 + i * 0.4 : 0.2 + i * 0.2;
      const x = mouthA[0] + (mouthB[0] - mouthA[0]) * f, y = mouthA[1] + (mouthB[1] - mouthA[1]) * f;
      t.append(polygon([[x - 1.1, y], [x, y - (face.teeth === 1 ? 3 : 2)], [x + 1.1, y]]));
    }
    put('teeth', t);
  }
  if (face.whiskers! > 0) {
    const len = face.whiskers === 1 ? 6 : 11;
    const wk = new Path();
    for (const a of [-0.25, 0.05, 0.35]) {
      const wx = tipX - 3, wy = tip[1] + 1;
      wk.M(wx, wy).L(wx + Math.cos(a) * len, wy + Math.sin(a) * len - 1);
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
