/**
 * 3D specification of every 2D slot: how the outline becomes a solid.
 *
 * The 2D outlines (rig mm) are extruded across Z, rounded with a bevel, and mirrored
 * for paired parts. This is the preview representation (and the contract for the
 * SDF bake later): a slot without an entry here would be visible in 2D but missing
 * in 3D, which the project forbids - tests/art3d.test.ts enforces the full coverage.
 */
import type { MorphotypeGenome } from '../genome';
import { dimensions as D, type Rig } from '../rig';
import { groupOfSlot, type PartGroup } from '../print/plan';
import { COAT_LIMB, type Coat } from './coat';
import { EYES, eyelids, LIP_R, WHISKER_TURN, insectHips, insectLegW, insectRise, prolegXs, roundTail, STALK_W, wingRibs, STAND_MARGIN_MM, STAND_MM, WHISKER_FAN, WHISKER_PAD, WHISKER_W, whiskerLength, type SlotId, type SlotPaths } from './shapes';
import type { XY } from './path';
import { typeSize } from './pose';
import { insectLimb, legLimb, legSpecOf, octopusLimb, prolegLimb, type Cone, type Limb } from './limb';
import { edgesOf, sdPolys, slabDist, type Edge } from '../bake/field';

export type ColorKey = 'c1' | 'c1dark' | 'c2' | 'c2soft' | 'c3' | 'ink' | 'white';

export interface Part3D {
  id: string;
  slot: SlotId;
  /** group the user can print separately; null = part of the body piece */
  group: PartGroup | null;
  /**
   * outline polygons in rig mm. A side-view part (the default) is drawn in (x forward, y up) and extruded along Z;
   * a top-view part (`plane: 'xz'`, e.g. whiskers sticking out sideways, a stand) is drawn in (x forward, z left)
   * and extruded along Y.
   */
  polys: XY[][];
  plane?: 'xz';
  /** centre of the slab along its extrusion axis (Z, or Y for a top-view part), and its total thickness (mm) */
  z: number;
  thickness: number;
  /** rounding radius (mm) of the edges (<= thickness / 2) */
  bevel: number;
  color: ColorKey;
  /** -1 / +1 for paired parts, 0 on the centre plane */
  side: -1 | 0 | 1;
  /**
   * one-sided rounding (paired parts that print lying flat: horns, antennae, ears): the inner face (towards z = 0) stays
   * flat, the outer side is rounded with this radius, so the section is a dome that prints without supports
   */
  dome?: number;
  /** anatomy: the slab's thickness times k, sampled every dx mm from x0 (a torso's chest, waist and haunches) */
  widths?: { x0: number; dx: number; k: number[] };
  /** a true 3D solid (a jointed leg) in world mm: then `polys` is only its side view, see limb.ts */
  limb?: Limb;
  /** added last with a tight blend, so it stays a crisp shape (teeth and tongue in an open mouth) */
  inset?: boolean;
  /** cut out of the solid instead of added (a nostril, the groove of a closed mouth); never painted, see paint.ts */
  carve?: boolean;
  /** raised 3D ribs fused onto the slab (wing bones, feather shafts), world mm */
  ribs?: Limb;
  /** coat texture (fur, scales, armour): a shallow relief sunk into the surface, see coat.ts */
  coat?: Coat;
}

interface Ctx { W: number; G: number; legW: number; legZ: number; headW: number; snoutW: number; neckT: number }
interface Spec { color: ColorKey; mirror: boolean; z: (c: Ctx) => number; t: (c: Ctx) => number; bevel: (t: number, c: Ctx) => number; dome?: (t: number) => number }

const round = (k: number) => (t: number): number => Math.min(t / 2 - 0.01, t * k);
const flat = (t: number): number => Math.min(0.45, t / 2 - 0.01);
const centre = (): number => 0;

/** `null` = deliberately not a 3D solid (render-only shading, or the mirror image of another slot). */
export const SPEC_3D: Record<SlotId, Spec | null> = {
  shadow: null, torsoClip: null, belly: null, glint: null, bones: null, blush: null, toes: null, // render-only
  wingRibs: null, // drawn crests of the wing ribs; the ribs themselves are `ribs` on the wing, see buildParts3D
  legBFar: null, legFFar: null, wingFar: null,                          // mirror images, generated from the near slot
  torso: { color: 'c1', mirror: false, z: centre, t: (c) => c.W, bevel: (t) => round(0.48)(t) },
  pattern: null, // painted onto the torso surface (colour region), see the viewport
  coat: null, coatLegs: null, coatOn: null, coatLegB: null, coatLegF: null, // a relief sunk into the solid (Part3D.coat), see coat.ts
  legB: { color: 'c1', mirror: true, z: (c) => c.legZ, t: (c) => c.legW, bevel: (t) => round(0.4)(t) },
  legF: { color: 'c1', mirror: true, z: (c) => c.legZ, t: (c) => c.legW, bevel: (t) => round(0.4)(t) },
  tail: { color: 'c1', mirror: false, z: centre, t: (c) => Math.max(3.2, c.G * 0.5), bevel: (t) => round(0.42)(t) },
  neck: { color: 'c1', mirror: false, z: centre, t: (c) => c.neckT, bevel: (t) => round(0.4)(t) },
  neckDecor: { color: 'c1dark', mirror: false, z: centre, t: (c) => c.neckT + 1.8, bevel: (t) => flat(t) },
  head: { color: 'c1', mirror: false, z: centre, t: (c) => c.headW, bevel: (t) => round(0.42)(t) },
  snout: { color: 'c1', mirror: false, z: centre, t: (c) => c.snoutW, bevel: (t) => round(0.42)(t) },
  nose: { color: 'ink', mirror: false, z: centre, t: (c) => c.snoutW * 0.8, bevel: (t) => round(0.45)(t) },
  ear: { color: 'c1', mirror: true, z: (c) => c.headW * 0.28, t: () => 2.8, bevel: (t) => round(0.45)(t), dome: (t) => t * 0.75 },
  earIn: { color: 'c2soft', mirror: true, z: (c) => c.headW * 0.28 + 1.35, t: () => 0.3, bevel: () => 0.05 },
  horns: { color: 'c2', mirror: true, z: (c) => c.headW * 0.3, t: () => 3.4, bevel: (t) => round(0.45)(t), dome: (t) => t * 0.75 },
  antennae: { color: 'c2', mirror: true, z: (c) => c.headW * 0.22, t: () => 2, bevel: (t) => round(0.45)(t), dome: (t) => t * 0.75 },
  stalks: { color: 'c1', mirror: true, z: (c) => c.headW * 0.25, t: () => STALK_W, bevel: (t) => round(0.4)(t) },
  tuft: { color: 'c2', mirror: false, z: centre, t: () => 3.2, bevel: (t) => round(0.3)(t) },
  mane: { color: 'c2', mirror: false, z: centre, t: (c) => c.neckT * 0.6, bevel: (t) => round(0.3)(t) },
  finD: { color: 'c2', mirror: false, z: centre, t: () => 2.4, bevel: (t) => round(0.3)(t) },
  finP: { color: 'c2', mirror: true, z: (c) => c.W * 0.42, t: () => 1.6, bevel: (t) => flat(t) },
  spines: { color: 'c2', mirror: false, z: centre, t: () => 3.2, bevel: (t) => round(0.3)(t) },
  wingNear: { color: 'c2', mirror: true, z: (c) => c.W * 0.34, t: () => 1.6, bevel: (t) => flat(t) },
  saddle: { color: 'c2', mirror: false, z: centre, t: (c) => c.W * 0.96, bevel: (t) => round(0.45)(t) },
  collar: { color: 'c2', mirror: false, z: centre, t: (c) => c.neckT + 1.6, bevel: (t) => round(0.3)(t) },
  eye: { color: 'white', mirror: true, z: (c) => c.headW / 2 - 0.35, t: () => 2.3, bevel: (t) => round(0.35)(t) }, // sits 1.5 mm in, stands 0.8 mm proud
  iris: { color: 'c2soft', mirror: true, z: (c) => c.headW / 2 + 0.8, t: () => 0.3, bevel: () => 0.05 },  // painted on the eyeball's front
  pupil: { color: 'ink', mirror: true, z: (c) => c.headW / 2 + 0.8, t: () => 0.4, bevel: () => 0.08 }, // likewise, over the iris
  lids: { color: 'c1', mirror: true, z: (c) => c.headW / 2, t: () => 1, bevel: () => 0.4 }, // rolled round the eyeball, see eyeballs
  brow: { color: 'ink', mirror: true, z: (c) => c.headW / 2 - 0.1, t: () => 0.5, bevel: () => 0.1 },
  // open mouth: the inside is set back 1.2 mm from each side of the jaws, the tongue narrower still
  maw: { color: 'ink', mirror: false, z: centre, t: (c) => Math.max(1.6, c.snoutW - 2.4), bevel: (t) => round(0.3)(t) },
  tongue: { color: 'c2soft', mirror: false, z: centre, t: (c) => Math.max(1.6, c.snoutW * 0.5), bevel: (t) => round(0.45)(t) },
  mouth: { color: 'ink', mirror: true, z: (c) => c.snoutW / 2 - 0.1, t: () => 0.5, bevel: () => 0.1 }, // painted, and carved as a groove (see lipsAndNostrils)
  lips: { color: 'c1dark', mirror: true, z: (c) => c.snoutW / 2, t: () => 1.2, bevel: () => 0.5 }, // rolled along the jaws' edges, see lipsAndNostrils
  nostrils: { color: 'ink', mirror: true, z: (c) => c.snoutW * 0.18, t: () => 1, bevel: () => 0.4 }, // holes in the nose, see lipsAndNostrils
  teeth: { color: 'white', mirror: true, z: (c) => c.snoutW / 2 - 0.9, t: () => 1.4, bevel: () => 0.5 }, // along the jaws' rims
  arms: { color: 'c1', mirror: false, z: centre, t: () => D.OCTOPUS.armMm, bevel: (t) => round(0.45)(t) }, // top-view, see buildParts3D
  stand: { color: 'c2', mirror: false, z: centre, t: () => STAND_MM, bevel: (t) => round(0.3)(t) }, // top-view plate, see standTop
  whiskers: { color: 'c1dark', mirror: true, z: () => 0, t: () => 1.6, bevel: (t) => flat(t) }, // top-view plate, see whiskerTop
};

export function ctxFor(rig: Rig): Ctx {
  const W = rig.dims.bodyWidth, G = rig.dims.bodyGirth;
  const headW = Math.max(8, W * 0.9);
  return { W, G, legW: rig.dims.legWidth, legZ: W * 0.32, headW, snoutW: headW * 0.62, neckT: Math.max(6, W * 0.7) };
}

const LEG_SLOTS = new Set<SlotId>(['legB', 'legF', 'legBFar', 'legFFar']);

/**
 * `print`: the parts as the bake makes them, with the hidden seating that only a separately printed piece needs (the
 * whiskers' root pad). The previews leave it out, so they show the creature alone.
 */
export function buildParts3D(paths: SlotPaths, g: MorphotypeGenome, rig: Rig, print = false): Part3D[] {
  void g;
  const ctx = ctxFor(rig);
  const out: Part3D[] = [];
  for (const slot of Object.keys(SPEC_3D) as SlotId[]) {
    const spec = SPEC_3D[slot];
    if (!spec) continue;
    const polys = paths[slot].flatten(24); // fine steps: every polyline corner leaves a flat band on the rounded skin
    if (!polys.length) continue;
    const t = spec.t(ctx), bevel = spec.bevel(t, ctx), z = spec.z(ctx), group = groupOfSlot(slot)?.id ?? null;
    if (spec.mirror) {
      for (const side of [1, -1] as const) out.push({ id: `${slot}${side > 0 ? '+' : '-'}`, slot, group, polys, z: z * side, thickness: t, bevel, color: spec.color, side, ...(spec.dome ? { dome: spec.dome(t) } : {}) });
    } else {
      out.push({ id: slot, slot, group, polys, z, thickness: t, bevel, color: spec.color, side: 0 });
    }
  }
  const head = out.find((p) => p.slot === 'head');
  if (head) for (const p of out) if (p.slot === 'ear') p.polys = seatOn(p, head);
  for (const p of out) if (p.slot === 'whiskers') whiskerTop(p, g, ctx, print);
  // teeth and tongue stay crisp shapes in the open mouth (tight blend, see bake)
  for (const p of out) if (p.slot === 'teeth' || p.slot === 'tongue') p.inset = true;
  if (g.face!.eyes === EYES.stalks) for (const p of out) { // eyes on stalks: a ball on top of each stalk, the pupil on its outer side
    const zs = ctx.headW * 0.25 * p.side;
    if (p.slot === 'eye') p.z = zs;
  }
  eyeballs(out, g.face!.eyes === EYES.stalks);
  lipsAndNostrils(out, paths, ctx);
  for (const p of out) if (p.slot === 'stand') standTop(p, g, rig);
  // jointed legs of four- and two-legged creatures are real 3D chains (insects and caterpillars keep their slabs)
  const plan = rig.dims.plan, biped = plan === D.PLAN.biped;
  if (plan === D.PLAN.quadruped || biped) for (const p of out) {
    if (p.slot !== 'legB' && p.slot !== 'legF') continue;
    const [top, foot] = p.slot === 'legB' ? [rig.nodes.hipB, rig.nodes.footBL] : [rig.nodes.shoulderF, rig.nodes.footFL];
    p.limb = legLimb(legSpecOf(p.slot, biped, [top.x, top.y], [foot.x, foot.y], rig.dims.legWidth, g.legs!.foot!, rig.dims.soleLength, rig.dims.build === 2), p.z);
  }
  for (const p of out) if (p.slot === 'arms') { // octopus tentacles lie on the bed around the hub
    p.limb = octopusLimb(rig.nodes.torso.x, D.OCTOPUS.armLen(g.legs!.length!), Math.max(6, rig.dims.bodyWidth * D.OCTOPUS.hub), D.OCTOPUS.arms);
  }
  // insects: six jointed legs reaching out sideways; caterpillars: stubby prolegs out of the flanks
  if (plan === D.PLAN.insect) for (const p of out) {
    if (p.slot !== 'legB' && p.slot !== 'legF') continue;
    const n = rig.nodes, hips = insectHips([n.hipB.x, n.hipB.y], [n.shoulderF.x, n.shoulderF.y]);
    p.limb = insectLimb(hips[p.slot], insectLegW(rig.dims.legWidth), insectRise(rig.dims.bodyGirth), rig.dims.bodyWidth, p.z);
  }
  if (plan !== D.PLAN.fish) for (const p of out) if (p.slot === 'tail') { // wolf and fluffy tails are round
    const n = rig.nodes, tl = roundTail(g, rig.dims.bodyGirth, [n.tailBase.x, n.tailBase.y], [n.tailMid.x, n.tailMid.y], [n.tailTip.x, n.tailTip.y]);
    if (tl) p.limb = tl;
  }
  if (plan === D.PLAN.caterpillar) for (const p of out) if (p.slot === 'legF') p.limb = prolegLimb(prolegXs(rig.nodes.torso.x, rig.dims.bodyLength), p.z);
  // wing ribs stand on the OUTER face (the inner one stays flat: the wing prints lying on it)
  const wingS = typeSize(g, 'wings', D.WING_SPAN, 'scale');
  if (g.wings!.type! > 0 && wingS > 0.5) for (const p of out) if (p.slot === 'wingNear') {
    const zo = Math.abs(p.z) + p.thickness / 2, side = p.side || 1;
    const zAt = (r: number): number => side * (zo - 0.25 * r);
    const n = rig.nodes.wingRoot;
    p.ribs = { cones: wingRibs(g.wings!.type!, [n.x, n.y], wingS).map((r) => ({ a: [r.a[0], r.a[1], zAt(r.ra)], b: [r.b[0], r.b[1], zAt(r.rb)], ra: r.ra, rb: r.rb })), domes: [] };
  }
  if (plan === D.PLAN.quadruped || biped) for (const p of out) if (p.slot === 'torso') p.widths = torsoWidths(p, rig);
  // coat texture: the torso and neck, a round tail and jointed legs (a leg's armour runs in rings); the head stays smooth
  const tex = g.coat?.texture ?? 0;
  if (tex > 0) for (const p of out) {
    const coat = (depth: number, bands: Coat['bands']): Coat => ({ kind: tex as Coat['kind'], cx: rig.nodes.torso.x, cy: rig.nodes.torso.y, tilt: rig.dims.tilt, depth, bands });
    if (p.slot === 'torso' || p.slot === 'neck') p.coat = coat(1, 'u');
    else if (p.slot === 'tail' && p.limb) p.coat = coat(COAT_LIMB, 'u');
    else if (LEG_SLOTS.has(p.slot) && p.limb && (plan === D.PLAN.quadruped || biped)) p.coat = coat(COAT_LIMB, 'v');
  }
  return out;
}

/**
 * Seen from above a torso is not a plank: full over the haunches, drawn in at the waist, deepest over the chest. Values
 * are half-width factors at the rear end, the hips, the waist, the shoulders and the front end, per build (gene J).
 */
const ANATOMY: readonly (readonly [number, number, number, number, number])[] = [
  [0.86, 0.97, 0.86, 1, 0.9],   // normal
  [0.8, 0.92, 0.78, 1, 0.86],   // stick
  [0.86, 1, 0.8, 1, 0.9],       // muscular: big haunches and chest, a tight waist
  [0.92, 1, 0.97, 1, 0.94],     // round: barely any waist
  [0.78, 0.88, 0.68, 1, 0.84],  // skeletal: a ribcage and a wasp waist
];

function torsoWidths(p: Part3D, rig: Rig): Part3D['widths'] {
  let x0 = Infinity, x1 = -Infinity;
  for (const poly of p.polys) for (const [x] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const hip = rig.nodes.hipB.x, sh = rig.nodes.shoulderF.x;
  const [kr, kh, kw, ks, kf] = ANATOMY[rig.dims.build] ?? ANATOMY[0]!;
  const keys: [number, number][] = [[x0, kr], [hip, kh], [(hip + sh) / 2, kw], [sh, ks], [x1, kf]];
  keys.sort((a, b) => a[0] - b[0]);
  const at = (x: number): number => {
    for (let i = 0; i + 1 < keys.length; i++) {
      const [a, ka] = keys[i]!, [b, kb] = keys[i + 1]!;
      if (x <= b) { const t = b > a ? Math.max(0, (x - a) / (b - a)) : 1, s = t * t * (3 - 2 * t); return ka + (kb - ka) * s; } // smoothstep
    }
    return keys[keys.length - 1]![1];
  };
  const dx = 0.5, k: number[] = [];
  for (let x = x0; x <= x1 + dx; x += dx) k.push(at(x));
  return { x0, dx, k };
}

/** The stand seen from above: an oval (or an uneven stone) under every foot, its top on the bed plane y = 0. */
function standTop(p: Part3D, g: MorphotypeGenome, rig: Rig): void {
  let x0 = Infinity, x1 = -Infinity;
  for (const poly of p.polys) for (const [x] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2;
  const rz = rig.dims.bodyWidth * 0.32 + rig.dims.legWidth / 2 + STAND_MARGIN_MM;
  const stone = g.stand!.type === 2;
  const ring: XY[] = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    // a stone: a few low lobes, the same for the same creature (no randomness)
    const k = stone ? 1 + 0.07 * Math.sin(3 * a + 0.7) + 0.05 * Math.sin(5 * a + 2.1) : 1;
    ring.push([cx + Math.cos(a) * rx * k, Math.sin(a) * rz * k]);
  }
  p.polys = [ring];
  p.plane = 'xz';
  p.z = -STAND_MM / 2;
}

/**
 * Whiskers stick out sideways: the part becomes a top-view plate (x, z) at the height of their root in the side view,
 * three strands fanning out of the muzzle side; for print, a pad half sunk into the muzzle holds them together.
 */
function whiskerTop(p: Part3D, g: MorphotypeGenome, ctx: Ctx, print: boolean): void {
  const pad = p.polys[0]!; // the root dot of the drawing: the side-view position of the pad
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pad) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, side = p.side || 1, len = whiskerLength(g.face!.whiskers!);
  const off = WHISKER_TURN[g.face!.whiskerDir ?? 0] ?? 0;
  const zr = ctx.snoutW / 2 - 0.6; // pad centre: just inside the muzzle side
  const polys: XY[][] = [];
  const ell: XY[] = [];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; ell.push([cx + Math.cos(a) * WHISKER_PAD[0], side * (zr + Math.sin(a) * WHISKER_PAD[1])]); }
  if (print) polys.push(side > 0 ? ell : ell.reverse()); // the pad that seats the separate whiskers in the muzzle
  for (const a of WHISKER_FAN) {
    const ax = cx, az = zr + 0.8, bx = cx + Math.sin(a + off) * len, bz = zr + 1.2 + Math.cos(a + off) * len;
    const l = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / l * (WHISKER_W / 2), nz = (bx - ax) / l * (WHISKER_W / 2);
    const quad: XY[] = [[ax + nx, side * (az + nz)], [bx + nx, side * (bz + nz)], [bx - nx, side * (bz - nz)], [ax - nx, side * (az - nz)]];
    polys.push(side > 0 ? quad : quad.reverse());
  }
  p.polys = polys;
  p.plane = 'xz';
  p.z = cy;
}

/** Radius (mm) of the groove a closed mouth is cut with, and of a nostril's opening. */
const MOUTH_CUT_R = 0.45;
const NOSTRIL_R = 0.5;

/**
 * Lips: a tube rolled along each jaw's edge on both sides of the muzzle, where its surface is. A closed mouth is a real
 * groove cut along the mouth line; nostrils are holes bored into the front of the nose on either side of its centre.
 */
function lipsAndNostrils(out: Part3D[], paths: SlotPaths, ctx: Ctx): void {
  const snout = out.find((p) => p.slot === 'snout'), se = snout ? edgesOf(snout.polys) : [];
  // the muzzle's surface z at (x, y): where its rounded slab ends
  const surfZ = (x: number, y: number): number => {
    if (!snout) return ctx.snoutW / 2;
    let z = snout.thickness / 2;
    while (z > 0 && slabSd(snout, se, x, y, z) > 0) z -= 0.05;
    return z;
  };
  const chain = (pts: [number, number, number][], r: number): Cone[] =>
    pts.slice(1).map((b, i) => ({ a: pts[i]!, b, ra: r, rb: r }));
  for (const p of out) {
    const side = p.side || 1;
    if (p.slot === 'lips') {
      p.limb = { cones: paths.lips.spines.flatMap((line) => chain(line.map(([x, y]) => [x, y, side * (surfZ(x, y) - LIP_R * 0.45)]), LIP_R)), domes: [] };
      p.inset = true;
    }
    if (p.slot === 'nostrils') {
      const cones: Cone[] = paths.nostrils.spines.map(([a, b]) => ({ a: [a![0], a![1], p.z], b: [b![0], b![1], p.z], ra: NOSTRIL_R, rb: NOSTRIL_R * 0.6 }));
      p.limb = { cones, domes: [] };
      p.carve = true;
    }
  }
  // the closed mouth's groove: one cut per side, following the muzzle's surface
  // (only where the muzzle is wide enough: near a narrow tip the two cuts would meet and bore a tunnel through it)
  for (const line of paths.mouth.spines) for (const side of [1, -1] as const) {
    const pts = line.map(([x, y]): [number, number, number] => [x, y, side * (surfZ(x, y) - MOUTH_CUT_R * 0.2)]).filter((q) => Math.abs(q[2]) > MOUTH_CUT_R * 3);
    if (pts.length < 2) continue;
    out.push({ id: `mouthCut${side > 0 ? '+' : '-'}`, slot: 'mouth', group: null, polys: paths.mouth.flatten(12), z: side * ctx.snoutW / 2, thickness: 1, bevel: 0.4, color: 'ink', side, limb: { cones: chain(pts, MOUTH_CUT_R), domes: [] }, carve: true });
  }
}

/** How far an eyeball stands out of the head, as a share of its radius: most of the ball shows, like a real eye. */
const EYE_OUT = 0.75;

/**
 * Eyes as real balls: every eye outline becomes a sphere that stands out of the head (or sits on its stalk), the iris
 * and pupil are painted on its front, and the eyelids are round folds rolled over the top and under the bottom of the
 * ball, following the arcs the 2D sketch draws (eyelids in shapes.ts).
 */
function eyeballs(out: Part3D[], stalks: boolean): void {
  const head = out.find((p) => p.slot === 'head'), he = head ? edgesOf(head.polys) : [];
  for (const eye of out.filter((p) => p.slot === 'eye')) {
    const side = eye.side || 1, cones: Cone[] = [], lidCones: Cone[] = [];
    let front = -Infinity;
    for (const poly of eye.polys) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = (x1 - x0) / 2;
      // where the head's surface is at the eye (it curves away from the 2D outline's centre plane)
      let surf = Math.abs(eye.z) + eye.thickness / 2 - 0.8;
      if (!stalks && head) { surf = head.thickness / 2; while (surf > 0 && slabSd(head, he, cx, cy, surf) > 0) surf -= 0.1; }
      const zc = stalks ? eye.z : side * (surf + (EYE_OUT - 1) * r);
      cones.push({ a: [cx, cy, zc], b: [cx, cy, zc], ra: r, rb: r });
      front = Math.max(front, Math.abs(zc) + r);
      for (const lid of eyelids(r)) {
        // the fold's centre line lies just above the ball, so the tube hugs it and reaches past its rim into the head
        const pts = lid.arc.map(([a, m, w]): [number, number, number, number] => {
          const R = r + 0.3 * w, proj = Math.min(0.98 * R, m), cosP = Math.sqrt(1 - (proj / R) ** 2);
          return [cx + Math.cos(a) * proj, cy + Math.sin(a) * proj * 1.08, zc + side * R * cosP, w];
        });
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay, az, ra] = pts[i - 1]!, [bx, by, bz, rb] = pts[i]!;
          lidCones.push({ a: [ax, ay, az], b: [bx, by, bz], ra, rb });
        }
      }
    }
    eye.limb = { cones, domes: [] };
    eye.inset = true; // a ball in its socket, not a lump grown out of the head
    for (const p of out) {
      if (p.side !== eye.side) continue;
      if (p.slot === 'pupil' || p.slot === 'iris') p.z = side * front;
      if (p.slot === 'lids') { p.limb = { cones: lidCones, domes: [] }; p.inset = true; }
    }
  }
}

/** Signed distance to a part's rounded slab (the shape the bake fuses). */
function slabSd(p: Part3D, e: Edge[], x: number, y: number, z: number): number {
  return slabDist(p, sdPolys(e, p.polys, x, y), z - p.z, x);
}



/** How deep (mm) the root of an element must reach below its 2D base to sit in the head across its whole thickness. */
const SEAT_MM = 0.4;
const MAX_ROOT_MM = 6;

/**
 * An element standing on the head off the centre plane (an ear) is drawn with its base tucked behind the head, but the
 * head is rounded across Z, so at the ear's Z its top is lower than the 2D outline: a flat skull leaves a strip of the
 * ear's base in the air. The ear gets a root, hidden inside the head outline, that runs down until it is SEAT_MM deep
 * in the head on both faces of the ear.
 */
function seatOn(p: Part3D, host: Part3D): XY[][] {
  const pe = edgesOf(p.polys), he = edgesOf(host.polys);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const poly of p.polys) for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const zs = [p.z - p.thickness / 2 + p.bevel, p.z + p.thickness / 2 - p.bevel];
  const step = 0.25, top: XY[] = [], bottom: XY[] = [], roots: XY[][] = [];
  const close = (): void => {
    if (top.length > 1) roots.push([...top, ...bottom.reverse()]);
    top.length = 0; bottom.length = 0;
  };
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    // the ear's lowest point in this column, where that point is inside the head outline (hidden in 2D)
    let yb = NaN;
    for (let y = y0; y <= y1; y += 0.1) if (sdPolys(pe, p.polys, x, y) < 0) { yb = y; break; }
    // (a corner right at the head's edge counts too: the root then starts a hair outside, too little to see)
    if (isNaN(yb) || sdPolys(he, host.polys, x, yb) > 0.5) { close(); continue; }
    let d = 0;
    while (d < MAX_ROOT_MM && zs.some((z) => slabSd(host, he, x, yb - d, z) > -SEAT_MM)) d += 0.1;
    // the root must stay inside the head outline (never show below it in 2D)
    while (d > 0 && sdPolys(he, host.polys, x, yb - d) > -SEAT_MM) d -= 0.1;
    if (d <= 0.05) { close(); continue; }
    top.push([x, yb + 0.3]); bottom.push([x, yb - d]);
  }
  close();
  if (!roots.length) return p.polys;
  // same winding as the ear itself, so the non-zero fill adds the root instead of cancelling it
  const area = (poly: XY[]): number => poly.reduce((a, [x, y], i) => { const [u, v] = poly[(i + 1) % poly.length]!; return a + x * v - u * y; }, 0);
  const sign = Math.sign(area(p.polys[0]!));
  return [...p.polys, ...roots.map((r) => (Math.sign(area(r)) === sign ? r : r.reverse()))];
}
