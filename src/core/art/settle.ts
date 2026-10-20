/**
 * Settling (2026-10-20): elements of different kinds (an ear and a horn, a hand and a leg, spines and a tail) must
 * never grow into each other, or the print has them fused into one lump. separateAppendages (spec3d) packs head
 * appendages across Z; what still touches after it is measured here on the real 3D parts and nudged apart: the mover
 * turns about its root away from the other element, a hand splays out sideways, a spike is left out. The nudges live
 * on the rig (rig.nudge), so the 2D sketch and the 3D model change together. Runs once per rig (solveRig caches rigs).
 */
import type { MorphotypeGenome } from '../genome';
import { dimensions as D, settleHook, type Nudge, type Rig } from '../rig';
import { edgesOf, partBox, type Edge } from '../bake/field';
import { slabSd } from './mounts';
import { targetPose } from './pose';
import { buildPaths, type SlotId } from './shapes';
import { buildParts3D, type Part3D } from './spec3d';

/** Elements that may not touch each other (the body masses and the face's details are their hosts, not neighbours). */
const ELEMENTS = new Set<string>([
  'ear', 'earFlop', 'horns', 'antennae', 'stalks', 'tuft', 'mane', 'spines', 'finD', 'finP', 'wingNear', 'wingFar', 'tail',
  'legB', 'legF', 'legBFar', 'legFFar', 'hands', 'handsFar',
]);
const BODY = new Set<string>(['torso', 'head', 'neck', 'snout', 'saddle', 'collar', 'neckDecor', 'arms']);
/** One element on one side: a near and a far copy of the same slot are one kind (a pair of ears never moves apart). */
const kindOf = (slot: string): string => (slot === 'earFlop' ? 'ear' : slot.replace(/Far$|Near$/, ''));

/** Who gives way when two touch (first in the list moves); kinds not listed never move. */
const MOVERS = ['hands', 'legF', 'spines', 'ear', 'antennae', 'tuft', 'horns', 'stalks', 'tail'] as const;
type Mover = (typeof MOVERS)[number];
/** Distances (mm). */
const STEP = 0.5, TOUCH = 0.15, OUTSIDE_BODY = 0.6;
const EAR_STEP = 0.5, TURN_STEP = 0.15, ARM_STEP = 0.8, ARM_MAX = 2.4, SCALE_STEP = 0.08, SCALE_MIN = 0.68, ROUNDS = 24;
/** What an ear or a horn makes room for by sliding back round the skull (from anything else, that would not help). */
const HEAD_TOP = new Set<string>(['horns', 'antennae', 'stalks', 'tuft']); // (for a horn: the others)
/** How far each may turn (rad): an ear may lie back along the head, a horn or a tail only lean a little more. */
const TURN_MAX: Partial<Record<Mover, number>> = { ear: 0.9, antennae: 0.75, tuft: 0.75, horns: 0.8, stalks: 0.9, tail: 0.9 };
/** What turns and, past its turn, shrinks a little (a tail does not shrink). */
type Turner = Exclude<Mover, 'hands' | 'legF' | 'spines'>;
const SHRINKS = new Set<Mover>(['ear', 'stalks']); // (a horn, an antenna or a crest would get tips too thin to print)

interface Element { kind: string; slot: SlotId; parts: { p: Part3D; e: Edge[] }[]; lo: number[]; hi: number[] }
/** `depth`: how far (mm) the two reach into each other at `at` (negative), or how near they come (up to TOUCH) */
export interface Touch { a: SlotId; b: SlotId; at: [number, number, number]; depth: number }

const sdOf = (el: { p: Part3D; e: Edge[] }[], x: number, y: number, z: number): number => {
  let d = Infinity;
  for (const { p, e } of el) d = Math.min(d, slabSd(p, e, x, y, z));
  return d;
};

type Body = { p: Part3D; e: Edge[]; lo: number[]; hi: number[] }[];
/** The elements (one per slot and side) and the body masses of a model. */
function gather(parts: Part3D[]): { list: Element[]; body: Body } {
  const els = new Map<string, Element>();
  const body: Body = [];
  for (const p of parts) {
    if (p.carve || p.plane || !p.polys.length && !p.limb) continue;
    const { lo, hi } = partBox(p);
    if (![...lo, ...hi].every(Number.isFinite)) continue;
    if (BODY.has(p.slot)) { body.push({ p, e: edgesOf(p.polys), lo, hi }); continue; }
    if (!ELEMENTS.has(p.slot)) continue;
    const key = `${p.slot}|${p.side}`;
    const el = els.get(key) ?? { kind: kindOf(p.slot), slot: p.slot, parts: [], lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
    el.parts.push({ p, e: edgesOf(p.polys) });
    for (let d = 0; d < 3; d++) { el.lo[d] = Math.min(el.lo[d]!, lo[d]!); el.hi[d] = Math.max(el.hi[d]!, hi[d]!); }
    els.set(key, el);
  }
  return { list: [...els.values()], body };
}

/** Pairs of elements of different kinds that meet outside the body, with the point where they meet deepest. */
export function touchesOf(parts: Part3D[]): Touch[] {
  const { list, body } = gather(parts), out: Touch[] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]!, b = list[j]!;
    if (a.kind === b.kind) continue;
    const lo = [0, 1, 2].map((d) => Math.max(a.lo[d]!, b.lo[d]!) - TOUCH), hi = [0, 1, 2].map((d) => Math.min(a.hi[d]!, b.hi[d]!) + TOUCH);
    if (lo.some((v, d) => v > hi[d]!)) continue;
    const hosts = body.filter((h) => [0, 1, 2].every((d) => h.lo[d]! - 1 <= hi[d]! && h.hi[d]! + 1 >= lo[d]!));
    let best = Infinity, at: [number, number, number] | null = null;
    for (let x = lo[0]!; x <= hi[0]!; x += STEP) for (let y = lo[1]!; y <= hi[1]!; y += STEP) for (let z = lo[2]!; z <= hi[2]!; z += STEP) {
      // (a distance field: nothing of it lies closer than its value, so the walk along z may skip that far)
      const da = sdOf(a.parts, x, y, z);
      if (da > TOUCH) { z += Math.max(0, Math.floor((da - TOUCH) / STEP) - 1) * STEP; continue; }
      const db = sdOf(b.parts, x, y, z);
      if (db > TOUCH) { z += Math.max(0, Math.floor((db - TOUCH) / STEP) - 1) * STEP; continue; }
      const m = Math.max(da, db);
      if (m >= best || sdOf(hosts, x, y, z) < OUTSIDE_BODY) continue; // where both sit in the body they belong together
      best = m; at = [x, y, z];
    }
    if (at) out.push({ a: a.slot, b: b.slot, at, depth: best });
  }
  return out;
}

/** Kinds (of those asked about) with an element no longer rooted in the body: a nudge took it too far. */
function looseKinds(parts: Part3D[], kinds: Set<string>): Set<string> {
  const { list, body } = gather(parts), loose = new Set<string>();
  for (const el of list) {
    if (!kinds.has(el.kind) || loose.has(el.kind)) continue;
    const hosts = body.filter((h) => [0, 1, 2].every((d) => h.lo[d]! <= el.hi[d]! && h.hi[d]! >= el.lo[d]!));
    let rooted = false;
    for (let x = el.lo[0]!; x <= el.hi[0]! && !rooted; x += STEP) for (let y = el.lo[1]!; y <= el.hi[1]! && !rooted; y += STEP)
      for (let z = el.lo[2]!; z <= el.hi[2]! && !rooted; z += STEP) if (sdOf(el.parts, x, y, z) < -0.2 && sdOf(hosts, x, y, z) < -0.3) rooted = true;
    if (!rooted) loose.add(el.kind);
  }
  return loose;
}

/** The 3D parts of a rig as it stands (the neutral pose the print and the sketch use). */
function model(g: MorphotypeGenome, rig: Rig): Part3D[] {
  const paths = buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false);
  return buildParts3D(paths, g, rig);
}

const turnLeft = (nu: Nudge, m: Turner): boolean => Math.abs(nu.turn[m] ?? 0) < (TURN_MAX[m] ?? 0) - 1e-9;
/** Nudges that set every touching pair it can move apart (see the file comment); none when nothing touches. */
export function settle(g: MorphotypeGenome, rig: Rig): Nudge | undefined {
  const nu: Nudge = { turn: {}, scale: {}, shift: {}, armOut: 0, legsBack: 0, spinesOff: [] };
  const shiftMax = rig.dims.headR * 0.3; // (further round, the skull grows too narrow to hold it)
  const slides = (m: Mover, t: Touch): m is 'ear' | 'horns' => (m === 'ear' || m === 'horns') && HEAD_TOP.has(otherOf(m, t)) && (nu.shift[m] ?? 0) < shiftMax - 1e-9;
  // the front legs may step back at most a third of the way to the hind ones (no closer to their neighbours)
  // (an insect's legs splay so far that stepping back only brings them onto the hind ones)
  const legsMax = rig.dims.plan === D.PLAN.insect ? 0 : Math.abs(rig.nodes.shoulderF.x - rig.nodes.hipB.x) * 0.3, legsStep = Math.max(1, legsMax / 4);
  const otherOf = (m: Mover, t: Touch): string => (kindOf(t.a) === m ? kindOf(t.b) : kindOf(t.a));
  const canMove = (m: Mover, t: Touch): boolean =>
    m === 'hands' ? nu.armOut < ARM_MAX - 1e-9 || (nu.armPose === undefined && otherOf(m, t).startsWith('leg'))
      : m === 'legF' ? nu.legsBack < legsMax - 1e-9
        : m === 'spines' ? !nu.spinesOff.some((x) => Math.abs(x - t.at[0]) < 0.5)
          : turnLeft(nu, m) || slides(m, t) || (SHRINKS.has(m) && (nu.scale[m] ?? 1) > SCALE_MIN + 1e-9);
  const sign: Partial<Record<Mover, number>> = {};
  // the last step of each mover, to take back when it left the element hanging in the air (then it moves no more)
  const undo = new Map<Mover, () => void>(), locked = new Set<Mover>();
  let moved = false;
  for (let round = 0; round < ROUNDS; round++) {
    rig.nudge = moved ? nu : undefined;
    const parts = model(g, rig);
    if (undo.size) {
      const loose = looseKinds(parts, new Set(undo.keys()));
      for (const m of loose as Set<Mover>) { undo.get(m)!(); locked.add(m); }
      undo.clear();
      if (loose.size) continue;
    }
    const touches = touchesOf(parts);
    let any = false;
    const done = new Set<Mover>();
    for (const t of touches) {
      const ka = kindOf(t.a), kb = kindOf(t.b);
      // the first mover in the list gives way; when it cannot move any further, the other one does
      // (the front legs only step back for a hand)
      const cands = MOVERS.filter((m) => (m === ka || m === kb) && !done.has(m) && (m !== 'legF' || ka === 'hands' || kb === 'hands'));
      const mover = cands.find((m) => !locked.has(m) && canMove(m, t));
      if (!mover) continue;
      done.add(mover);
      // hands splay out sideways; when that is not enough next to a leg, both arms are raised clear of it and splay again
      { // (only this mover's own fields go back)
        const { armOut, armPose, legsBack } = nu, spines = nu.spinesOff.length, shift = nu.shift[mover as 'ear'];
        const turn = mover in TURN_MAX ? nu.turn[mover as Turner] : undefined, scale = mover in TURN_MAX ? nu.scale[mover as Turner] : undefined;
        undo.set(mover, () => {
          if (mover === 'hands') { nu.armOut = armOut; nu.armPose = armPose; } else if (mover === 'legF') nu.legsBack = legsBack;
          else if (mover === 'spines') nu.spinesOff.length = spines;
          else { nu.turn[mover] = turn; nu.scale[mover] = scale; if (mover === 'ear' || mover === 'horns') nu.shift[mover] = shift; }
        });
      }
      any = true;
      if (mover === 'hands') {
        if (nu.armOut < ARM_MAX - 1e-9) nu.armOut += ARM_STEP; else { nu.armPose = 1; nu.armOut = 0; } // (raised only off a leg)
        continue;
      }
      if (mover === 'legF') { nu.legsBack = Math.min(legsMax, nu.legsBack + legsStep); continue; } // the front legs step back
      if (mover === 'spines') { nu.spinesOff.push(t.at[0]); continue; }
      if (slides(mover, t)) { nu.shift[mover] = (nu.shift[mover] ?? 0) + EAR_STEP; continue; } // an ear or a horn first slides back round the skull
      if (!turnLeft(nu, mover)) { nu.scale[mover] = (nu.scale[mover] ?? 1) - SCALE_STEP; continue; } // turned all it may: a little smaller
      // turn so the meeting point moves away from the other element (a positive turn is counter-clockwise)
      // (the first time: try a few steps counter-clockwise; if that does not part them, go the other way)
      if (sign[mover] === undefined) {
        const trial = (sg: number): number => {
          rig.nudge = { ...nu, turn: { ...nu.turn, [mover]: (nu.turn[mover] ?? 0) + sg * TURN_STEP * 3 } };
          const hit = touchesOf(model(g, rig)).filter((x) => [kindOf(x.a), kindOf(x.b)].sort().join() === [ka, kb].sort().join());
          return hit.length ? Math.min(...hit.map((x) => x.depth)) : 1;
        };
        const up = trial(1);
        rig.nudge = moved ? nu : undefined;
        sign[mover] = up > t.depth ? 1 : -1;
      }
      nu.turn[mover] = (nu.turn[mover] ?? 0) + sign[mover]! * TURN_STEP;
    }
    if (!any) break;
    moved = true;
  }
  return moved ? nu : undefined;
}

settleHook.fn = settle;
