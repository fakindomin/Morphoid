/**
 * Display pose = what the 2D view actually draws. It eases towards the
 * (discrete) rig target, so a variant change animates instead of popping,
 * while the target itself stays exactly on Y = 0 (feet are pinned).
 */
import { sizeOf, type MorphotypeGenome } from '../genome';
import { dimensions as D, idleOffsets, legStepF, type NodeId, type Rig } from '../rig';

export type PosMap = Record<NodeId, [number, number]>;

export interface Nums {
  bodyL: number; bodyG: number; bodyW: number; legW: number; headR: number; build: number; plan: number; tilt: number;
  /** octopus: arm length and hub radius (mm) */
  armLen: number; hub: number;
  earS: number; hornS: number; wingS: number;
  crestS: number; antS: number; tailLen: number; soleL: number;
  /** neck thickness slider factor */
  neckK: number;
  /** pairs of legs on the bed (see rig dims.legPairs) */
  legPairs: number;
}
export interface Pose { pos: PosMap; n: Nums }

/** A part's size (mm) from its size step and the fraction of a step its length handle adds; 0 when it is absent. */
export const typeSize = (g: MorphotypeGenome, block: 'ears' | 'horns' | 'wings' | 'crest' | 'antennae', table: readonly number[], f: string): number =>
  g[block]!.type === 0 ? 0 : sizeOf(g, table, block, f);

export function targetPose(
  rig: Rig, g: MorphotypeGenome, t: number, breathing: boolean, mouse: { x: number; y: number },
): Pose {
  const idle = breathing ? idleOffsets(rig, t) : {};
  const cum = {} as Record<NodeId, [number, number]>;
  const pos = {} as PosMap;
  for (const id of rig.order) {
    const nd = rig.nodes[id];
    const parent = nd.parent ? cum[nd.parent] : [0, 0];
    const own = idle[id] ?? { dx: 0, dy: 0 };
    const m = id === 'head' ? mouse : { x: 0, y: 0 };
    cum[id] = [parent![0]! + own.dx + m.x, parent![1]! + own.dy + m.y];
    // contact nodes are pinned: the bed plane never moves
    pos[id] = nd.contact ? [nd.x, nd.y] : [nd.x + cum[id]![0], nd.y + cum[id]![1]];
  }
  const headK = rig.dims.headR / D.HEAD_RADIUS;
  return {
    pos,
    n: {
      bodyL: rig.dims.bodyLength, bodyG: rig.dims.bodyGirth, bodyW: rig.dims.bodyWidth, legW: rig.dims.legWidth, headR: rig.dims.headR, build: rig.dims.build, plan: rig.dims.plan, tilt: rig.dims.tilt,
      armLen: D.OCTOPUS.armLen(legStepF(g)), hub: Math.max(6, rig.dims.bodyWidth * D.OCTOPUS.hub),
      // ears and horns keep their size relative to the skull (a bigger head carries bigger ears)
      earS: typeSize(g, 'ears', D.EAR_SIZE, 'scale') * headK, hornS: typeSize(g, 'horns', D.HORN_SPAN, 'span') * headK,
      wingS: typeSize(g, 'wings', D.WING_SPAN, 'scale'), crestS: typeSize(g, 'crest', D.CREST_SIZE, 'scale'), antS: typeSize(g, 'antennae', D.ANTENNA_LEN, 'length'),
      tailLen: rig.dims.tailLength, soleL: rig.dims.soleLength, neckK: rig.dims.neckK, legPairs: rig.dims.legPairs,
    },
  };
}

const DISCRETE = new Set<keyof Nums>(['plan', 'build', 'legPairs']);

/** Ease `cur` towards `tgt` in place. Returns the largest remaining delta (mm). */
export function easePose(cur: Pose, tgt: Pose, k: number): number {
  let maxDelta = 0;
  for (const id of Object.keys(tgt.pos) as NodeId[]) {
    const c = cur.pos[id], t = tgt.pos[id];
    const dx = t[0] - c[0], dy = t[1] - c[1];
    c[0] += dx * k; c[1] += dy * k;
    maxDelta = Math.max(maxDelta, Math.abs(dx), Math.abs(dy));
  }
  for (const key of Object.keys(tgt.n) as (keyof Nums)[]) {
    // body plan and build are ids, not sizes: a value in between (plan 2.97) matches no plan and draws no legs; a count
    // of leg pairs in between (1.5) has no legs to draw
    if (DISCRETE.has(key)) { cur.n[key] = tgt.n[key]; continue; }
    const d = tgt.n[key] - cur.n[key];
    cur.n[key] += d * k;
    maxDelta = Math.max(maxDelta, Math.abs(d));
  }
  return maxDelta;
}

export function clonePose(p: Pose): Pose {
  const pos = {} as PosMap;
  for (const id of Object.keys(p.pos) as NodeId[]) pos[id] = [...p.pos[id]] as [number, number];
  return { pos, n: { ...p.n } };
}
