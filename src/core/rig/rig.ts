/**
 * Kinematic rig: THE single source of truth for 2D (side view) and 3D.
 *
 * Coordinates (millimetres, right-handed):
 *   +X = forward (towards the head)   +Y = up   +Z = creature's left
 *   Y = 0 is the print bed.
 * The 2D renderer mirrors X if it wants a left-facing creature (as the mockup).
 *
 * solveRig() is pure and cheap (~25 nodes, no allocation beyond the result),
 * so it is safe to call every frame; results are memoised per genome code.
 */
import { serialize, type MorphotypeGenome } from '../genome';
import * as D from './dimensions';

export type NodeId =
  | 'torso' | 'shoulderF' | 'hipB' | 'neckBase' | 'head' | 'muzzle' | 'tailBase' | 'tailMid' | 'tailTip' | 'wingRoot'
  | 'hornRoot' | 'earRoot' | 'crestRoot'
  | 'footFL' | 'footFR' | 'footBL' | 'footBR';

export interface RigNode {
  id: NodeId;
  parent: NodeId | null;
  /** Local offset in the parent's frame (mm), before the node's own rotation. */
  local: readonly [number, number, number];
  /** Rotation around Z, radians, applied to this node's frame (children inherit). */
  rotZ: number;
  /** Computed world position. */
  x: number; y: number; z: number;
  /** Computed world rotation around Z. */
  worldRotZ: number;
  /** Contact nodes define the ground plane (their y is 0 after solve). */
  contact: boolean;
}

export type SocketId = 'head' | 'chest' | 'tail' | 'legF' | 'legB';
/** The 5 interactive mounting points of the 2D editor -> rig node they ride on. */
export const SOCKET_NODE: Record<SocketId, NodeId> = {
  head: 'head', chest: 'neckBase', tail: 'tailBase', legF: 'shoulderF', legB: 'hipB',
};

export interface Rig {
  code: string;
  nodes: Record<NodeId, RigNode>;
  order: NodeId[];
  /** mm dimensions that were resolved from the genome (useful for the 3D bake). */
  dims: {
    bodyLength: number; bodyGirth: number; bodyWidth: number;
    legLength: number; neckLength: number; tailLength: number;
    soleLength: number; soleWidth: number;
  };
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Rule violations; empty for a printable pose. */
  issues: string[];
}

const NECK_ANGLE = 1.15; // rad above horizontal (steep: the head sits over the chest, not in front of it)
// The tail leaves the rump backwards and UP, curling steeper towards the tip, so
// every part of it is >= 45 deg above horizontal (support-free print, see PRINT_RULES).
const TAIL_RISE = 0.80;      // rad (~46 deg) first half
const TAIL_CURL = 0.30;      // rad extra steepness for the second half

interface Spec { id: NodeId; parent: NodeId | null; contact?: boolean }
const SPECS: readonly Spec[] = [
  { id: 'torso', parent: null },
  { id: 'shoulderF', parent: 'torso' },
  { id: 'hipB', parent: 'torso' },
  { id: 'footFL', parent: 'shoulderF', contact: true },
  { id: 'footFR', parent: 'shoulderF', contact: true },
  { id: 'footBL', parent: 'hipB', contact: true },
  { id: 'footBR', parent: 'hipB', contact: true },
  { id: 'neckBase', parent: 'torso' },
  { id: 'head', parent: 'neckBase' },
  { id: 'muzzle', parent: 'head' },
  { id: 'hornRoot', parent: 'head' },
  { id: 'earRoot', parent: 'head' },
  { id: 'crestRoot', parent: 'neckBase' },
  { id: 'wingRoot', parent: 'torso' },
  { id: 'tailBase', parent: 'torso' },
  { id: 'tailMid', parent: 'tailBase' },
  { id: 'tailTip', parent: 'tailMid' },
];

const cache = new Map<string, Rig>();

export function solveRig(genome: MorphotypeGenome): Rig {
  const code = serialize(genome);
  const hit = cache.get(code);
  if (hit) return hit;
  const rig = build(genome, code);
  if (cache.size > 512) cache.clear();
  cache.set(code, rig);
  return rig;
}

function build(g: MorphotypeGenome, code: string): Rig {
  const L = D.BODY_LENGTH[g.body!.length!]!;
  const G = D.BODY_GIRTH[g.body!.girth!]!;
  const W = D.snap(G * D.BODY_WIDTH_RATIO[g.body!.shape!]!);
  const legLen = D.LEG_LENGTH[g.legs!.length!]!;
  const neckLen = D.NECK_LENGTH[g.head!.neckLength!]!;
  const tailLen = g.tail!.type === 0 ? 0 : D.TAIL_LENGTH[g.tail!.length!]!;
  const sole = D.FOOT_SOLE[g.legs!.foot!]!;
  const legZ = W * 0.32;
  const legX = Math.max(6, L / 2 - G / 2 - 1.3);

  // Local offsets are a function of the dims only -> hierarchy: stretching the
  // torso moves neck/head/front legs forward and tail/hind legs backward.
  const local: Record<NodeId, [number, number, number]> = {
    torso: [0, 0, 0],
    // legs stand under the flat part of the torso underside (its 45 deg chamfers start at the leg outer edges)
    shoulderF: [legX, -G * 0.35, 0],
    hipB: [-legX, -G * 0.35, 0],
    footFL: [0, -legLen, legZ],
    footFR: [0, -legLen, -legZ],
    footBL: [0, -legLen, legZ],
    footBR: [0, -legLen, -legZ],
    neckBase: [L * 0.36, G * 0.25, 0],
    head: [neckLen, 0, 0], // along the neck's rotated frame
    muzzle: [D.HEAD_RADIUS + D.SNOUT_REACH[g.snout!.reach!]!, -2, 0],
    hornRoot: [1, 4, 0],
    earRoot: [-2, 4, 0],
    crestRoot: [0, 2, 0],
    wingRoot: [L * 0.18, G * 0.45, W * 0.3],
    tailBase: [-L * 0.5 + 4, G * 0.1, 0], // root buried in the rump
    tailMid: [tailLen * 0.5, 0, 0], // along the tail's rotated frame
    tailTip: [tailLen * 0.5, 0, 0],
  };
  const rot: Partial<Record<NodeId, number>> = {
    neckBase: NECK_ANGLE,
    head: -NECK_ANGLE, // head level again
    tailBase: Math.PI - TAIL_RISE, // pointing backwards and up
    tailMid: -TAIL_CURL,           // facing backwards, so a negative turn = steeper
  };

  const nodes = {} as Record<NodeId, RigNode>;
  const order: NodeId[] = [];
  for (const s of SPECS) {
    nodes[s.id] = {
      id: s.id, parent: s.parent, local: local[s.id], rotZ: rot[s.id] ?? 0,
      x: 0, y: 0, z: 0, worldRotZ: 0, contact: !!s.contact,
    };
    order.push(s.id);
  }
  // Wing Z mirror and horn/ear duplicates are the 3D bake's job (mirror about z=0).

  forwardKinematics(nodes, order);

  // ---- Iron rule: lowest contact point on Y = 0 ------------------------------
  let lowest = Infinity;
  for (const id of order) if (nodes[id].contact) lowest = Math.min(lowest, nodes[id].y);
  for (const id of order) nodes[id].y -= lowest;

  const bounds = computeBounds(nodes, order);
  const rig: Rig = {
    code, nodes, order,
    dims: {
      bodyLength: L, bodyGirth: G, bodyWidth: W, legLength: legLen, neckLength: neckLen,
      tailLength: tailLen, soleLength: sole.length, soleWidth: sole.width,
    },
    bounds, issues: [],
  };
  rig.issues = validateRig(rig);
  return rig;
}

function forwardKinematics(nodes: Record<NodeId, RigNode>, order: readonly NodeId[]): void {
  for (const id of order) {
    const n = nodes[id];
    const p = n.parent ? nodes[n.parent] : null;
    if (!p) {
      n.x = n.local[0]; n.y = n.local[1]; n.z = n.local[2]; n.worldRotZ = n.rotZ;
      continue;
    }
    const c = Math.cos(p.worldRotZ), s = Math.sin(p.worldRotZ);
    n.x = p.x + n.local[0] * c - n.local[1] * s;
    n.y = p.y + n.local[0] * s + n.local[1] * c;
    n.z = p.z + n.local[2];
    n.worldRotZ = p.worldRotZ + n.rotZ;
  }
}

function computeBounds(nodes: Record<NodeId, RigNode>, order: readonly NodeId[]): Rig['bounds'] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const id of order) {
    const n = nodes[id];
    const p = [n.x, n.y, n.z] as const;
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, p[i]!); max[i] = Math.max(max[i]!, p[i]!); }
  }
  return { min, max };
}

const EPS = 1e-6;

/** Invariants of a printable pose. Returned strings are stable, machine-checkable ids. */
export function validateRig(rig: Rig): string[] {
  const issues: string[] = [];
  const contacts = rig.order.filter((id) => rig.nodes[id].contact);
  const lowest = Math.min(...contacts.map((id) => rig.nodes[id].y));
  if (Math.abs(lowest) > EPS) issues.push('GROUND_NOT_ANCHORED');
  for (const id of rig.order) {
    if (rig.nodes[id].y < -EPS) issues.push(`BELOW_BED:${id}`);
  }
  if (rig.dims.soleLength * rig.dims.soleWidth < D.MIN_SOLE_AREA_MM2) issues.push('SOLE_TOO_SMALL');
  return issues;
}

// ----------------------------------------------------------- transforms / 3D

/** Column-major 4x4 (Three.js Matrix4.fromArray compatible): translate * rotZ. */
export function nodeMatrix4(n: RigNode): number[] {
  const c = Math.cos(n.worldRotZ), s = Math.sin(n.worldRotZ);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, n.x, n.y, n.z, 1];
}

/** 2D side-view projection (drops Z). `mirrorX` for left-facing artwork. */
export function project2D(n: RigNode, mirrorX = false): { x: number; y: number } {
  return { x: mirrorX ? -n.x : n.x, y: n.y };
}

export function socketPosition(rig: Rig, socket: SocketId): RigNode {
  return rig.nodes[SOCKET_NODE[socket]];
}

/**
 * Cosmetic idle motion (breathing). Returns per-node LOCAL deltas in mm that
 * accumulate down the hierarchy (a head delta also moves the muzzle). Contact
 * nodes are never listed - the renderer pins them, so Y = 0 stays true.
 * Never feeds back into the genome or the export.
 */
export function idleOffsets(rig: Rig, t: number): Partial<Record<NodeId, { dx: number; dy: number }>> {
  const breath = Math.sin(t) * 0.6;
  const wave = Math.sin(t * 1.3) * 1.2;
  return {
    torso: { dx: 0, dy: breath * 0.5 },
    neckBase: { dx: 0, dy: breath },
    head: { dx: 0, dy: breath * 1.2 },
    wingRoot: { dx: 0, dy: breath },
    tailMid: { dx: 0, dy: wave * 0.4 },
    tailTip: { dx: 0, dy: wave * 0.6 },
  };
}
