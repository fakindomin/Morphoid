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
import { FINE_ZERO, fineOffset, fineScale, serialize, stepAt, type MorphotypeGenome } from '../genome';
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
    /** leg width in the side view = its thickness across the body = the sole's width on the bed */
    legWidth: number;
    /** head radius (mm), see dimensions headRadius */
    headR: number;
    /** head size slider factor (1 = as before the slider) */
    headSize: number;
    /** neck thickness slider factor */
    neckK: number;
    soleLength: number; soleWidth: number;
    /** build variant (gene J): 0 normal, 1 stick, 2 muscular, 3 round, 4 skeletal */
    build: number;
    /** body plan (gene Y): 0 quadruped, 1 biped */
    plan: number;
    /** torso tilt (rad, nose up) */
    tilt: number;
    /** trunk and neck built from anatomical masses (see dimensions ANATOMY) */
    anatomical: boolean;
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
  const build = g.build?.type ?? 0, B = D.BUILD[build]!;
  const plan = g.plan?.type ?? 0, biped = D.isBiped(plan), human = plan === D.PLAN.humanoid, belly = D.onBelly(plan), insect = plan === D.PLAN.insect;
  const fish = plan === D.PLAN.fish, octopus = plan === D.PLAN.octopus;
  const anat = D.isAnatomical(plan, g.body!.shape!), A = D.ANATOMY;
  // a two-legged animal gets the anatomical trunk and slim legs, but keeps its upright stance, neck and tail
  const anatQ = anat && !biped;
  // a quadruped carries its chest a little higher than its hips (rule "linia gestu"): the spine is never a level line
  const H = D.HUMANOID;
  const tilt = human ? H.tilt : biped ? D.BIPED.tilt : plan === D.PLAN.quadruped ? D.GESTURE.chestUp : 0;
  // deformation sliders (3D view): a fraction of a step on top of the size genes, finer than the nozzle grid
  const sc = g.sculpt ?? {}, fine = (k: string): number => sc[k] ?? FINE_ZERO;
  const size = (table: readonly number[], step: number, k: string): number => stepAt(table, step, fineOffset(fine(k)));
  const snapF = (mm: number, k: string): number => (fine(k) === FINE_ZERO ? D.snap(mm) : D.snap(mm, 0.1));
  const L = snapF(size(D.BODY_LENGTH, g.body!.length!, 'length') * B.length * (human ? H.length : 1), 'length');
  const G = snapF(size(D.BODY_GIRTH, g.body!.girth!, 'girth') * B.girth, 'girth');
  // legs and head follow the girth gene alone: the height slider reshapes the trunk, not the whole creature
  const G0 = D.snap(D.BODY_GIRTH[g.body!.girth!]! * B.girth);
  const W = D.snap(size(D.BODY_GIRTH, g.body!.girth!, 'girth') * D.BODY_WIDTH_RATIO[g.body!.shape!]! * (human ? H.width : 1) * B.width * fineScale(fine('width')), fine('girth') === FINE_ZERO && fine('width') === FINE_ZERO ? 0.4 : 0.1);
  // belly plans: the "feet" are the torso's flat underside (G/2 + 1.5 is the drawn torso's half height)
  // octopus: the mantle stands on the arms' hub (arms ARM_MM thick, the mantle's underside rests on them)
  const legLen = octopus ? (G / 2 + 1.5) * 0.85 - G * 0.35 + D.OCTOPUS.armMm
    : belly ? (G / 2 + 1.5) * (1 - D.BELLY_FLAT) - G * 0.35
    // silhouette test: a standing creature always shows light under its belly, so its legs read as legs
    : anatQ ? Math.max(D.snap(G0 * A.legK[g.legs!.length!]! * B.leg), D.snap(D.minLegForGap(G)))
    : Math.max(D.snap(D.LEG_LENGTH[g.legs!.length!]! * B.leg * (human ? H.leg : biped ? D.BIPED.leg : insect ? 1.15 : 1)), insect ? 0 : D.snap(D.minLegForGap(G)));
  // leg thickness slider: never thinner than a leg that still stands and prints
  const legK = D.factorAt(D.LEG_THICK, g.legs!.thick);
  const legW0 = anat ? Math.max(A.legWMin, B.legW(G0) * A.legW) : B.legW(G0);
  // ... and never so thick that the pair of legs outgrows the body
  const legW = D.snap(Math.max(3.6, legK > 1 ? Math.min(legW0 * legK, Math.max(legW0, W * 0.7)) : legW0 * legK));
  const headSize = D.factorAt(D.HEAD_SIZE, g.head!.size);
  const headR0 = D.headRadius(G0, plan) * (human ? H.head : 1);
  // a bigger head (size slider) still never becomes a second ball as big as the body (form rule "big, medium, small")
  const headR = D.snap(headSize > 1 ? Math.min(headR0 * headSize, Math.max(headR0, (G + 2.8) / 2)) : headR0 * headSize, 0.1);
  const headK = headR / D.HEAD_RADIUS;
  const neckT = size(D.NECK_LENGTH, g.head!.neckLength!, 'neckLength');
  const neckLen = human ? neckT * H.neckK + headR * 0.5 : anatQ ? neckT * A.neckK + headR * A.neckHead
    : neckT * (fish || octopus ? 0.25 : plan === D.PLAN.caterpillar ? 0.5 : 1);
  const neckAngle = human ? H.neckAngle : fish || octopus ? 0 : belly ? 0.5 : anatQ ? A.neckAngle(g.head!.neckLength!) : NECK_ANGLE;
  const tailLen = g.tail!.type === 0 ? 0 : D.TAIL_LENGTH[g.tail!.length!]!;
  const up = (mm: number): number => Math.ceil(mm / D.NOZZLE_MM - 1e-9) * D.NOZZLE_MM;
  const soleL = D.FOOT_SOLE[g.legs!.foot!]!.length * B.sole * (human ? H.sole : biped ? D.BIPED.sole : 1);
  // an animal's paw is round, not a long slipper (about as long as the slim leg is wide); no sole is below the minimum area
  const sole = { length: Math.max(up(D.MIN_SOLE_AREA_MM2 / legW), anatQ && g.legs!.foot! !== D.FOOT_HAND ? Math.min(D.snap(soleL), up(legW * 1.7)) : D.snap(soleL)), width: legW };
  // caterpillar prolegs peek out of the flanks
  const legZ = W * (plan === D.PLAN.caterpillar ? 0.45 : 0.32);
  const legX = Math.max(5, L * (insect ? 0.27 : 0.3));
  // a raised chest lifts the shoulders: the front legs grow by as much, so all four feet stay on the bed
  const legLenF = biped ? legLen : legLen + 2 * legX * Math.sin(tilt);

  // Local offsets are a function of the dims only -> hierarchy: stretching the
  // torso moves neck/head/front legs forward and tail/hind legs backward.
  const local: Record<NodeId, [number, number, number]> = {
    torso: [0, 0, 0],
    shoulderF: [legX, -G * 0.35, 0],
    hipB: human ? [L * H.hipX, 0, 0] : [biped ? L * D.BIPED.hipX : -legX, -G * 0.35, 0],
    footFL: [0, biped ? 0 : -legLenF, legZ], // a biped has no front legs: the unused feet stay at the shoulder
    footFR: [0, biped ? 0 : -legLenF, -legZ],
    footBL: [0, -legLen, legZ],
    footBR: [0, -legLen, -legZ],
    neckBase: human ? [L * H.neckBase[0], G * H.neckBase[1], 0] : octopus ? [L * 0.3, -G * 0.2, 0] : fish ? [L * 0.42, 0, 0] : belly ? [L * 0.4, G * 0.15, 0]
      : anatQ ? [L * A.neckBase[0], G * A.neckBase[1], 0] : [L * 0.36, G * 0.25, 0],
    head: [neckLen, 0, 0], // along the neck's rotated frame
    muzzle: [headR + D.SNOUT_REACH[g.snout!.reach!]!, -2, 0],
    // ears and horns sit on the skull's crown, wherever its size puts it
    hornRoot: [1 * headK, 4 * headK, 0],
    earRoot: human || D.primateSnout(g.snout!.type!) ? [-3.2 * headK, 1.6 * headK, 0] : [-2 * headK, 4 * headK, 0], // a primate's ears (an ape's face) sit on the sides of the head
    crestRoot: [0, 2, 0],
    wingRoot: [L * 0.18, G * 0.45, W * 0.3],
    tailBase: human ? [L * H.tail[0], G * H.tail[1], 0] : [-L * 0.5 + 4, fish ? 0 : anatQ ? G * A.tailY : G * 0.1, 0], // root buried in the rump (an animal's sits high on the croup)
    tailMid: [tailLen * 0.5, 0, 0], // along the tail's rotated frame
    tailTip: [tailLen * 0.5, 0, 0],
  };
  // a tilted torso carries its children along; neck, tail and legs turn back by the tilt so their world angles (and
  // so their print rules: a level head, a tail rising >= 45 deg, vertical legs) stay what they are on a quadruped
  const rot: Partial<Record<NodeId, number>> = {
    torso: tilt,
    shoulderF: -tilt,
    hipB: -tilt,
    neckBase: neckAngle - tilt,
    head: -neckAngle, // head level again
    tailBase: fish ? Math.PI : Math.PI - TAIL_RISE - tilt, // pointing backwards and up (a fish: straight back)
    tailMid: fish ? 0 : -TAIL_CURL, // facing backwards, so a negative turn = steeper
  };

  const nodes = {} as Record<NodeId, RigNode>;
  const order: NodeId[] = [];
  for (const s of SPECS) {
    nodes[s.id] = {
      id: s.id, parent: s.parent, local: local[s.id], rotZ: rot[s.id] ?? 0,
      // a biped stands on its hind feet only
      x: 0, y: 0, z: 0, worldRotZ: 0, contact: !!s.contact && !(biped && (s.id === 'footFL' || s.id === 'footFR')),
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
      tailLength: tailLen, legWidth: legW, headR, headSize, neckK: D.factorAt(D.NECK_THICK, g.head!.neckThick), soleLength: sole.length, soleWidth: sole.width, build, plan, tilt, anatomical: anat,
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
