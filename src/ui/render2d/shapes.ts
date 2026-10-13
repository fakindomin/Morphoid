/**
 * Pure side-view artwork: (pose, genome) -> SVG path strings, one per fixed
 * "slot". Slots are rendered once by React; the rAF loop only rewrites `d`
 * attributes (and only when the string changed). All geometry is in rig mm,
 * +X forward, +Y up; ToPx mirrors X so the creature faces left like the mockup.
 */
import type { MorphotypeGenome } from '../../core/genome';
import { dimensions as D, type NodeId, type Rig } from '../../core/rig';
import { ellipse, line, Path, polygon, taper, tube, type ToPx, type XY } from './path';
import type { Pose } from './pose';

export type SlotKind = 'part' | 'line' | 'accent' | 'warn' | 'dot' | 'bone' | 'wing';

export const SLOTS = [
  ['wingFar', 'wing'], ['tail', 'part'], ['legB', 'part'], ['torso', 'part'], ['spines', 'accent'],
  ['legF', 'part'], ['neck', 'part'], ['neckDecor', 'accent'], ['mane', 'accent'], ['head', 'part'],
  ['snout', 'part'], ['ear', 'part'], ['horns', 'warn'], ['tuft', 'accent'], ['wingNear', 'wing'],
  ['eye', 'dot'], ['pupil', 'accent'], ['brow', 'line'], ['mouth', 'line'], ['teeth', 'dot'],
  ['whiskers', 'line'], ['bones', 'bone'],
] as const satisfies readonly (readonly [string, SlotKind])[];

export type SlotId = (typeof SLOTS)[number][0];
export type Shapes = Record<SlotId, string>;

const p = (pose: Pose, id: NodeId): XY => pose.pos[id];
const R = D.HEAD_RADIUS;

function leg(top: XY, foot: XY, w: number, type: number, soleL: number): Path {
  const [tx, ty] = top, [fx, fy] = foot;
  const hw = w / 2, fh = type === 2 ? 5 : 3;
  const toe = fx + soleL * 0.7, heel = fx - soleL * 0.3;
  const path = new Path().M(tx - hw, ty).L(tx + hw, ty).L(fx + hw * 0.85, fy + fh);
  if (type === 2) { // hoof: boxy
    path.L(fx + hw * 1.15, fy + fh).L(fx + hw * 1.15, fy).L(fx - hw * 1.15, fy).L(fx - hw * 1.15, fy + fh);
  } else {
    path.L(toe - 1, fy + 1.5);
    if (type === 1) path.L(toe, fy + 2).L(toe + 3.2, fy + 0.8); // claw tip; the sole itself stays flat
    path.L(toe, fy).L(heel, fy).L(fx - hw * 0.85, fy + fh);
  }
  return path.Z();
}

function headShape(hx: number, hy: number, skull: number): { rx: number; ry: number; path: Path } {
  const [rx, ry] = skull === 1 ? [R * 1.15, R * 0.8] : skull === 2 ? [R * 1.1, R * 0.68] : [R, R * 0.95];
  return { rx, ry, path: ellipse(hx, hy, rx, ry) };
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
  const legW = Math.max(5, n.bodyG * 0.42);
  const foot = g.legs!.foot!;

  put('legB', leg(p(pose, 'hipB'), p(pose, 'footBL'), legW, foot, n.soleL));
  put('legF', leg(p(pose, 'shoulderF'), p(pose, 'footFL'), legW, foot, n.soleL));
  put('torso', ellipse(torso[0], torso[1], n.bodyL / 2 + 2, n.bodyG / 2 + 1));

  // ---- tail ---------------------------------------------------------------
  const tailType = g.tail!.type!;
  if (tailType > 0 && n.tailLen > 0.5) {
    const lift = n.tailLen * 0.18;
    const ctrl: XY = [(tailBase[0] + tailTip[0]) / 2, (tailBase[1] + tailTip[1]) / 2 + lift];
    const w0 = n.bodyG * 0.34;
    const width = tailType === 1 ? (t: number) => w0 * (1 - t * 0.92)
      : tailType === 2 ? (t: number) => w0 * (1 - t) + n.bodyG * 0.95 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.04))
      : (t: number) => w0 * (1 - t) + n.bodyG * 1.3 * t * t;
    put('tail', taper(tailBase, ctrl, tailTip, width, 14));
  }

  // ---- neck + head -----------------------------------------------------------
  put('neck', tube(neckBase, head, n.bodyG * 0.55, R * 0.95));
  const neckType = g.head!.neck!;
  const dir: XY = [head[0] - neckBase[0], head[1] - neckBase[1]];
  const dl = Math.hypot(dir[0], dir[1]) || 1;
  const up: XY = [-dir[1] / dl, dir[0] / dl]; // left-hand normal = upper side of the neck
  const at = (t: number, off: number): XY => [
    neckBase[0] + dir[0] * t + up[0] * off, neckBase[1] + dir[1] * t + up[1] * off,
  ];
  const upSign = up[1] >= 0 ? 1 : -1;
  const deco = new Path();
  if (neckType === 1) {
    const pts: XY[] = [];
    for (let i = 0; i <= 6; i++) pts.push(at(i / 6, upSign * (n.bodyG * 0.3 + (i % 2 ? 4 : 0))));
    pts.forEach(([x, y], i) => (i ? deco.L(x, y) : deco.M(x, y)));
  } else if (neckType === 2) {
    for (const t of [0.25, 0.5, 0.75]) {
      const a = at(t, upSign * n.bodyG * 0.3), b = at(t, -upSign * n.bodyG * 0.3);
      deco.M(a[0], a[1]).L(b[0], b[1]);
    }
  }
  put('neckDecor', deco);

  const skull = g.head!.skull!;
  const hs = headShape(head[0], head[1], skull);
  put('head', hs.path);

  const snoutType = g.snout!.type!;
  const topB: XY = [head[0] + hs.rx * 0.55, head[1] + hs.ry * 0.45];
  const botB: XY = [head[0] + hs.rx * 0.5, head[1] - hs.ry * 0.75];
  const tipX = Math.max(muzzle[0], head[0] + hs.rx * 0.9);
  const tip: XY = [tipX, muzzle[1]];
  if (snoutType === 0) {
    put('snout', polygon([topB, [tipX, tip[1] + 2], [tipX, tip[1] - 2.5], botB]));
  } else if (snoutType === 1) {
    put('snout', polygon([topB, tip, botB]));
  } else {
    put('snout', new Path().M(topB[0], topB[1]).Q(tipX - 4, topB[1] + 1.5, tipX, tip[1] - 1.5)
      .L(tipX - 3, tip[1] - 3.5).L(botB[0], botB[1]).Z());
  }

  // ---- ears -------------------------------------------------------------------
  const er = p(pose, 'earRoot');
  if (n.earS > 0.3) {
    const e = n.earS, [ex, ey] = er;
    const type = g.ears!.type!;
    if (type === 1) put('ear', polygon([[ex - 3, ey + 2], [ex - 1.5, ey + 2 + e], [ex + 4, ey + 1]]));
    else if (type === 2) put('ear', ellipse(ex, ey + e * 0.45, e * 0.45, e * 0.4));
    else put('ear', ellipse(ex - 1.5, ey + e * 0.9, e * 0.22, e * 0.9, 0.25));
  }

  // ---- horns / crest ---------------------------------------------------------
  const hr = p(pose, 'hornRoot');
  const hornType = g.horns!.type!;
  if (n.hornS > 0.3 && hornType > 0) {
    const s = n.hornS, [x, y] = hr;
    const horns = new Path();
    if (hornType === 1) horns.append(taper([x, y], [x + 0.1 * s, y + 0.7 * s], [x - 0.5 * s, y + s], (t) => 3 * (1 - t), 8));
    else if (hornType === 2) horns.append(taper([x, y], [x - 0.9 * s, y + 1.1 * s], [x - 0.6 * s, y + 0.1 * s], (t) => 3.6 * (1 - t * 0.85), 12));
    else if (hornType === 3) {
      horns.append(polygon([[x - 2, y], [x - 0.4 * s, y + s], [x + 1, y]]));
      horns.append(polygon([[x + 1, y], [x + 0.05 * s, y + 1.25 * s], [x + 3.5, y]]));
    } else {
      horns.append(taper([x, y], [x - 0.1 * s, y + 0.6 * s], [x - 0.5 * s, y + s], (t) => 2.4 * (1 - t * 0.7), 8));
      horns.append(taper([x - 0.2 * s, y + 0.55 * s], [x + 0.1 * s, y + 0.8 * s], [x + 0.25 * s, y + 1.05 * s], (t) => 1.6 * (1 - t), 5));
      horns.append(taper([x - 0.35 * s, y + 0.8 * s], [x - 0.5 * s, y + 0.95 * s], [x - 0.8 * s, y + 1.0 * s], (t) => 1.4 * (1 - t), 5));
    }
    put('horns', horns);
  }

  const crestType = g.crest!.type!;
  if (n.crestS > 0.3 && crestType > 0) {
    const c = n.crestS;
    if (crestType === 1) { // tuft on the crown
      const base: XY = [head[0] - 1, head[1] + hs.ry - 0.5];
      put('tuft', polygon([[base[0] - 2, base[1]], [base[0] + 1, base[1] + c * 1.2], [base[0] + 4, base[1]]])
        .append(polygon([[base[0] + 1, base[1]], [base[0] + 4, base[1] + c], [base[0] + 6, base[1] - 0.5]])));
    } else if (crestType === 2) { // mane along the neck
      const m = new Path();
      for (let i = 0; i < 5; i++) {
        const a = at(0.1 + i * 0.18, upSign * n.bodyG * 0.25), b = at(0.1 + i * 0.18 + 0.09, upSign * (n.bodyG * 0.25 + c * 0.9));
        const d = at(0.1 + i * 0.18 + 0.18, upSign * n.bodyG * 0.25);
        m.append(polygon([a, b, d]));
      }
      put('mane', m);
    } else { // spines along the back
      const s = new Path();
      const x0 = neckBase[0], x1 = tailBase[0], rx = n.bodyL / 2 + 2, ry = n.bodyG / 2 + 1;
      for (let i = 0; i < 6; i++) {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / 6;
        const k = Math.max(0, 1 - ((x - torso[0]) / rx) ** 2);
        const y = torso[1] + ry * Math.sqrt(k) - 0.6;
        s.append(polygon([[x - 1.8, y], [x + 0.4, y + c], [x + 1.8, y]]));
      }
      put('spines', s);
    }
  }

  // ---- wings ----------------------------------------------------------------
  const wingType = g.wings!.type!;
  if (n.wingS > 0.5 && wingType > 0) {
    const s = n.wingS, [x, y] = wingRoot;
    let w: Path;
    if (wingType === 2) { // bat: three fingers with scalloped membrane
      w = polygon([
        [x + 2, y], [x - 0.15 * s, y + 0.75 * s], [x - 0.35 * s, y + 1.0 * s], [x - 0.55 * s, y + 0.62 * s],
        [x - 0.75 * s, y + 0.82 * s], [x - 0.8 * s, y + 0.35 * s], [x - 1.0 * s, y + 0.38 * s], [x - 0.6 * s, y + 0.05 * s], [x - 0.3 * s, y - 0.05 * s],
      ]);
    } else { // feathered: broad leaf
      w = taper([x, y], [x - 0.2 * s, y + 0.9 * s], [x - 1.0 * s, y + 0.7 * s], (t) => 0.7 * s * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.05)), 12);
    }
    put('wingNear', w);
    put('wingFar', w.translated(-3, 2));
  }

  // ---- face -------------------------------------------------------------------
  const face = g.face!;
  const er2 = [1.1, 1.6, 2.3][face.eyes!]!;
  const eye: XY = [head[0] + hs.rx * 0.35, head[1] + hs.ry * 0.22];
  put('eye', ellipse(eye[0], eye[1], er2, er2));
  put('pupil', ellipse(eye[0] + 0.3, eye[1], er2 * 0.45, er2 * 0.45));

  const mouthA: XY = [tipX - 1.2, tip[1] - 1.4];
  const mouthB: XY = [head[0] + hs.rx * 0.25, head[1] - hs.ry * 0.38];
  const expr = face.expression!;
  put('mouth', expr === 1
    ? new Path().M(mouthA[0], mouthA[1]).Q((mouthA[0] + mouthB[0]) / 2, mouthA[1] - 2.2, mouthB[0], mouthB[1] + 1.2)
    : line(mouthA, mouthB));
  if (expr === 2) put('brow', line([eye[0] - er2 - 1.2, eye[1] + er2 + 2.6], [eye[0] + er2 + 1.2, eye[1] + er2 + 0.9]));

  if (face.teeth! > 0) {
    const t = new Path();
    const count = face.teeth === 1 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const f = face.teeth === 1 ? 0.35 + i * 0.4 : 0.2 + i * 0.2;
      const x = mouthA[0] + (mouthB[0] - mouthA[0]) * f, y = mouthA[1] + (mouthB[1] - mouthA[1]) * f;
      t.append(polygon([[x - 0.9, y], [x, y - (face.teeth === 1 ? 2.6 : 1.7)], [x + 0.9, y]]));
    }
    put('teeth', t);
  }
  if (face.whiskers! > 0) {
    const len = face.whiskers === 1 ? 6 : 11;
    const wk = new Path();
    for (const a of [-0.25, 0.05, 0.35]) {
      const sx = tipX - 3, sy = tip[1] + 0.5;
      wk.M(sx, sy).L(sx + Math.cos(a) * len, sy + Math.sin(a) * len - 1);
    }
    put('whiskers', wk);
  }

  // ---- rig overlay -------------------------------------------------------------
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
