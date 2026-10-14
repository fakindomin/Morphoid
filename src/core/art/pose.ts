/**
 * Display pose = what the 2D view actually draws. It eases towards the
 * (discrete) rig target, so a variant change animates instead of popping,
 * while the target itself stays exactly on Y = 0 (feet are pinned).
 */
import type { MorphotypeGenome } from '../genome';
import { dimensions as D, idleOffsets, type NodeId, type Rig } from '../rig';

export type PosMap = Record<NodeId, [number, number]>;

export interface Nums {
  bodyL: number; bodyG: number; bodyW: number; legW: number; build: number; plan: number; tilt: number;
  /** octopus: arm length and hub radius (mm) */
  armLen: number; hub: number;
  earS: number; hornS: number; wingS: number;
  crestS: number; antS: number; tailLen: number; soleL: number;
}
export interface Pose { pos: PosMap; n: Nums }

export const typeSize = (g: MorphotypeGenome, block: 'ears' | 'horns' | 'wings' | 'crest' | 'antennae', table: readonly number[], f: string): number =>
  g[block]!.type === 0 ? 0 : table[g[block]![f]!]!;

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
  return {
    pos,
    n: {
      bodyL: rig.dims.bodyLength, bodyG: rig.dims.bodyGirth, bodyW: rig.dims.bodyWidth, legW: rig.dims.legWidth, build: rig.dims.build, plan: rig.dims.plan, tilt: rig.dims.tilt,
      armLen: D.OCTOPUS.armLen(g.legs!.length!), hub: Math.max(6, rig.dims.bodyWidth * D.OCTOPUS.hub),
      earS: typeSize(g, 'ears', D.EAR_SIZE, 'scale'), hornS: typeSize(g, 'horns', D.HORN_SPAN, 'span'),
      wingS: typeSize(g, 'wings', D.WING_SPAN, 'scale'), crestS: typeSize(g, 'crest', D.CREST_SIZE, 'scale'), antS: typeSize(g, 'antennae', D.ANTENNA_LEN, 'length'),
      tailLen: rig.dims.tailLength, soleL: rig.dims.soleLength,
    },
  };
}

const DISCRETE = new Set<keyof Nums>(['plan', 'build']);

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
    // body plan and build are ids, not sizes: a value in between (plan 2.97) matches no plan and draws no legs
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
