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
import { reliefSpec, rootOf, type Relief } from './relief';
import { armSpecOf, EYES, eyelids, LIP_R, WHISKER_TURN, insectHips, insectLegW, insectRise, prolegXs, roundTail, STALK_W, wingRibs, STAND_MARGIN_MM, STAND_MM, WHISKER_FAN, WHISKER_PAD, WHISKER_W, whiskerLength, type SlotId, type SlotPaths } from './shapes';
import type { XY } from './path';
import { typeSize } from './pose';
import { armLimb, armZ, insectLimb, legLimb, legSpecOf, legTops, mergeLimbs, octopusLimb, prolegLimb, type Cone, type Dome, type Limb } from './limb';
import { blendGroup, edgesOf, sdPolys, slabDist, type Edge } from '../bake/field';
import { neckLimb, sculptOf, trunkLimb } from './anatomy';
import { hostsOf, mountAt, skinZ, slabSd, type Host } from './mounts';
import { cutPlanes, langOf, speakLanguage, type Cut } from './form';
import './settle'; // registers the settling of touching elements with solveRig

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
  /** which face of a `dome` part is the round one (default: its side, away from the centre plane); +1 = up for a top-view part */
  domeSide?: 1 | -1;
  /** the body pattern (spots, stripes) as a shallow sunk relief, side-view polygons; see PATTERN_DEPTH in field.ts */
  pattern?: XY[][];
  /** growth rings or rays sunk into the surface (horns, fins, feathers), see relief.ts */
  relief?: Relief;
  /** cut out of the solid instead of added (a nostril, the groove of a closed mouth); never painted, see paint.ts */
  carve?: boolean;
  /** raised 3D ribs fused onto the slab (wing bones, feather shafts), world mm */
  ribs?: Limb;
  /** blend radius of this appendage as a share of its thickness (its shape language), see blendOf in field.ts */
  blendShare?: number;
  /** flat planes cut into the part (cheeks, temples, the back), see form.ts */
  cuts?: Cut[];
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
  shadow: null, torsoClip: null, belly: null, legOver0: null, legOver1: null, legOver2: null, legOver3: null, glint: null, bones: null, blush: null, toes: null, // render-only
  relief: null, // grooves sunk into the accessories (Part3D.relief), see relief.ts
  wingRibs: null, // drawn crests of the wing ribs; the ribs themselves are `ribs` on the wing, see buildParts3D
  legBFar: null, legFFar: null, wingFar: null, handsFar: null,                          // mirror images, generated from the near slot
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
  earFlop: { color: 'c1', mirror: true, z: (c) => c.headW / 2, t: () => 2.2, bevel: (t) => round(0.45)(t), dome: (t) => t * 0.75 }, // laid on the head's side, see buildParts3D
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
  hands: { color: 'c1', mirror: true, z: (c) => armZ(c.W, c.legW).out, t: (c) => c.legW * 0.7, bevel: (t) => round(0.4)(t) }, // arms with hands, see buildParts3D
  claws: { color: 'c1dark', mirror: true, z: (c) => c.legZ, t: () => 1.6, bevel: () => 0.6 }, // the legs' tips, see buildParts3D
  nostrils: { color: 'ink', mirror: true, z: (c) => c.snoutW * 0.18, t: () => 1, bevel: () => 0.4 }, // holes in the nose, see lipsAndNostrils
  teeth: { color: 'white', mirror: true, z: (c) => c.snoutW / 2 - 0.9, t: () => 1.4, bevel: () => 0.5 }, // along the jaws' rims
  arms: { color: 'c1', mirror: false, z: centre, t: () => D.OCTOPUS.armMm, bevel: (t) => round(0.45)(t) }, // top-view, see buildParts3D
  stand: { color: 'c2', mirror: false, z: centre, t: () => STAND_MM, bevel: (t) => round(0.3)(t) }, // top-view plate, see standTop
  whiskers: { color: 'c1dark', mirror: true, z: () => 0, t: () => 1.6, bevel: (t) => flat(t), dome: () => WHISKER_W * 0.46 }, // top-view plate, see whiskerTop
};

export function ctxFor(rig: Rig): Ctx {
  const W = rig.dims.bodyWidth, G = rig.dims.bodyGirth;
  // never wider than the head is tall (rule 1); a bigger head (size slider) may outgrow the body's width
  const headW = Math.max(8, Math.min(W * 0.9 * Math.max(1, rig.dims.headSize), rig.dims.headR * 1.7));
  return { W, G, legW: rig.dims.legWidth, legZ: W * 0.32, headW, snoutW: headW * 0.62, neckT: Math.max(6, W * 0.7) * rig.dims.neckK };
}

const LEG_SLOTS = new Set<SlotId>(['legB', 'legF', 'legBFar', 'legFFar']);
/** Parts whose tips (claws, hooves, talons) make up the darker 'claws' part. */
const TIP_SLOTS = new Set<SlotId>([...LEG_SLOTS, 'hands']);

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
  // an animal's trunk and neck are round solids of anatomical masses (their outlines are the drawing's, see anatomy.ts)
  if (rig.dims.anatomical) {
    const n = rig.nodes, d = rig.dims;
    for (const p of out) {
      if (p.slot === 'torso') { p.limb = trunkLimb({ torso: [n.torso.x, n.torso.y], L: d.bodyLength, G: d.bodyGirth, W: d.bodyWidth, tilt: d.tilt, biped: D.isBiped(d.plan), humanoid: d.plan === D.PLAN.humanoid, sculpt: sculptOf(g) }); p.thickness = d.bodyWidth * 1.1; }
      else if (p.slot === 'neck') { p.limb = neckLimb([n.neckBase.x, n.neckBase.y], [n.head.x, n.head.y], d.bodyGirth, d.headR, sculptOf(g).neck * d.neckK); p.thickness = d.bodyGirth * 0.7 * d.neckK; }
    }
  }
  const head = out.find((p) => p.slot === 'head');
  if (head) for (const p of out) if (p.slot === 'ear') p.polys = seatOn(p, head);
  // a hanging ear lies against the side of the head: its root sinks into the skin, the leaf hangs just off the cheek
  const lang = langOf(g, rig);
  speakLanguage(out, lang); // round, square or sharp edges
  cutPlanes(out, lang, rig.dims.plan); // planes on the head, the Pysk and the back, before anything is mounted on them
  // a hanging ear lies on the side of the head: the leaf rests on the cheek's widest point, standing out of the skin,
  // and a short root runs from its top into the crown (which is narrower than the cheek)
  if (head) for (const p of out) if (p.slot === 'earFlop') {
    const host = hostsOf(out, ['head'])[0]!, pts = p.polys.flat(), top = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
    const skin = Math.max(0, ...pts.filter((_, i) => i % 3 === 0).map(([x, y]) => skinZ(host, x, y)));
    const zc = skin + p.thickness / 2 - 0.5;
    p.z = p.side * zc;
    const rx = top[0] - 1, ry = top[1] - 1.6, zin = Math.max(0, skinZ(host, rx, ry) - 1.2);
    p.ribs = { cones: [{ a: [rx, ry, p.side * zc], b: [rx, ry, p.side * zin], ra: 1.5, rb: 1.5 }], domes: [] };
  }
  { const muzzle = hostsOf(out, ['snout', 'head']); for (const p of out) if (p.slot === 'whiskers') whiskerTop(p, g, ctx, muzzle, print); }
  // teeth and tongue stay crisp shapes in the open mouth (tight blend, see bake)
  for (const p of out) if (p.slot === 'teeth' || p.slot === 'tongue') p.inset = true;
  if (g.face!.eyes === EYES.stalks) for (const p of out) { // eyes on stalks: a ball on top of each stalk, the pupil on its outer side
    const zs = ctx.headW * 0.25 * p.side;
    if (p.slot === 'eye') p.z = zs;
  }
  eyeballs(out, g.face!.eyes === EYES.stalks, g.face!.eyes === EYES.stalks ? EYE_OUT[0] : EYE_OUT[g.face!.eyeSet ?? 0] ?? EYE_OUT[0],
    g.face!.eyeShape ?? 0);
  seatTeeth(out);
  // the inside of an ear is a real cup: the inner-ear outline is hollowed out of the ear's outer face
  for (const p of [...out]) if (p.slot === 'earIn') out.push({ ...p, id: `earCup${p.side > 0 ? '+' : '-'}`, thickness: EAR_CUP_MM * 2, bevel: EAR_CUP_MM * 0.8, carve: true, z: p.z + p.side * 0.25 });
  lipsAndNostrils(out, paths, ctx);
  // jointed legs of four- and two-legged creatures are real 3D chains (insects and caterpillars keep their slabs)
  const plan = rig.dims.plan, biped = D.isBiped(plan), human = plan === D.PLAN.humanoid;
  // (a slot holds every pair of its kind: the hind pair in legB, all the others in legF)
  if (D.jointedLegs(plan, rig.dims.legPairs)) for (const p of out) {
    if (p.slot !== 'legB' && p.slot !== 'legF') continue;
    const slot = p.slot, n = rig.nodes;
    p.limb = mergeLimbs(legTops(rig.dims.legPairs, biped, [n.hipB.x, n.hipB.y], [n.shoulderF.x - (rig.nudge?.legsBack ?? 0), n.shoulderF.y], { human, girth: rig.dims.bodyGirth, soleL: rig.dims.soleLength, legW: rig.dims.legWidth }).filter((t) => t.slot === slot)
      .map((t) => legLimb(legSpecOf(slot, biped, t.top, [t.footX, 0], rig.dims.legWidth, g.legs!.foot!, rig.dims.soleLength, rig.dims.build === 2, human), p.z)));
  }
  // arms with hands: real 3D chains out of the upper chest, one per side
  { const n = rig.nodes, a0 = armSpecOf(g, [n.torso.x, n.torso.y], rig.dims.bodyLength, rig.dims.bodyGirth, rig.dims.tilt, rig.dims.legWidth, plan, rig.nudge?.armPose);
    // the shoulder stays where it sits on legs of the middle thickness (thicker legs only push the hand out)
    const arm = a0 && { ...a0, shoulderZ: armZ(rig.dims.bodyWidth, rig.dims.legWidth / D.factorAt(D.LEG_THICK, g.legs!.thick)).out * 0.7 };
    // the left arm (+z) takes the pose gene, the right one its own (or the same)
    for (const p of out) if (p.slot === 'hands' && arm) {
      p.z += Math.sign(p.z) * (rig.nudge?.armOut ?? 0); // hands splayed out where they would grow into a leg or an ear (settle.ts)
      p.limb = armLimb(p.side < 0 ? { ...arm, pose: arm.poseR } : arm, p.z);
    } }
  // claws, hooves and talons: one darker part per side holding the tips of that side's legs and hand
  for (const c of out) if (c.slot === 'claws') {
    const tips = out.filter((p) => TIP_SLOTS.has(p.slot) && p.side === c.side && p.limb?.tips).flatMap((p) => p.limb!.tips!);
    c.limb = { cones: tips, domes: [] };
    c.inset = true; // crisp points, not lumps
  }
  for (const p of out) if (p.slot === 'arms') { // octopus tentacles lie on the bed around the hub
    p.limb = octopusLimb(rig.nodes.torso.x, D.OCTOPUS.armLen(g.legs!.length!), Math.max(6, rig.dims.bodyWidth * D.OCTOPUS.hub), D.OCTOPUS.arms);
  }
  // insects: six jointed legs reaching out sideways; caterpillars: stubby prolegs out of the flanks
  if (plan === D.PLAN.insect) for (const p of out) {
    if (p.slot !== 'legB' && p.slot !== 'legF') continue;
    const n = rig.nodes, hips = insectHips([n.hipB.x, n.hipB.y], [n.shoulderF.x - (rig.nudge?.legsBack ?? 0), n.shoulderF.y], rig.dims.legPairs, D.insectReach(rig.dims.armsPair, rig.dims.legPairs));
    p.limb = insectLimb(hips[p.slot], insectLegW(rig.dims.legWidth), insectRise(rig.dims.bodyGirth), rig.dims.bodyWidth, p.z);
  }
  if (plan !== D.PLAN.fish) for (const p of out) if (p.slot === 'tail') { // wolf and fluffy tails are round
    const n = rig.nodes, tl = roundTail(g, rig.dims.bodyGirth, [n.tailBase.x, n.tailBase.y], [n.tailMid.x, n.tailMid.y], [n.tailTip.x, n.tailTip.y], rig.dims.anatomical && plan === D.PLAN.quadruped, rig.nudge?.turn.tail);
    if (tl) p.limb = tl;
  }
  if (plan === D.PLAN.caterpillar) for (const p of out) if (p.slot === 'legF') p.limb = prolegLimb(prolegXs(rig.nodes.torso.x, rig.dims.bodyLength, rig.dims.legPairs), p.z);
  // the stand last of the body: it reaches under every foot, claw and tentacle that rests on the bed
  for (const p of out) if (p.slot === 'stand') standTop(p, g, rig, out);
  separateAppendages(out); // appendages of different kinds never grow into each other
  // wing ribs stand on the OUTER face (the inner one stays flat: the wing prints lying on it)
  const wingS = typeSize(g, 'wings', D.WING_SPAN, 'scale');
  if (g.wings!.type! > 0 && wingS > 0.5) for (const p of out) if (p.slot === 'wingNear') {
    const zo = Math.abs(p.z) + p.thickness / 2, side = p.side || 1;
    const zAt = (r: number): number => side * (zo - 0.25 * r);
    const n = rig.nodes.wingRoot;
    p.ribs = { cones: wingRibs(g.wings!.type!, [n.x, n.y], wingS).map((r) => ({ a: [r.a[0], r.a[1], zAt(r.ra)], b: [r.b[0], r.b[1], zAt(r.rb)], ra: r.ra, rb: r.rb })), domes: [] };
  }
  if (plan === D.PLAN.quadruped || biped) for (const p of out) if (p.slot === 'torso') p.widths = torsoWidths(p, rig);
  // the body pattern is felt as well as seen: a shallow relief on the torso
  const pat = paths.pattern.flatten(8);
  if (pat.length) for (const p of out) if (p.slot === 'torso' && !p.limb) p.pattern = pat;
  // muscles: a shoulder and a haunch over the top of every jointed leg (strongest on a muscular build)
  const brawn = rig.dims.anatomical ? 0 : MUSCLE[rig.dims.build] ?? 0; // an animal's trunk has its own shoulders and haunches
  if ((plan === D.PLAN.quadruped || biped) && brawn > 0) for (const side of [1, -1] as const) {
    const w = rig.dims.legWidth, z = side * (ctx.legZ + w * 0.12);
    const at = (n: { x: number; y: number }, k: [number, number, number], dy: number): Dome => ({ c: [n.x, n.y + dy * w, z], r: [k[0] * w * brawn, k[1] * w * brawn, Math.min(k[2] * w * brawn, Math.abs(z) * 0.5)] });
    const domes = [at(rig.nodes.hipB, [0.7, 0.8, 0.3], -0.15), ...(biped ? [] : [at(rig.nodes.shoulderF, [0.6, 0.72, 0.28], -0.1)])];
    const torso = out.find((p) => p.slot === 'torso');
    if (torso) out.push({ ...torso, id: `muscle${side > 0 ? '+' : '-'}`, side, z, limb: { cones: [], domes }, widths: undefined, pattern: undefined });
  }
  // relief: rings round horns and antennae, rays across fins, feathers, a mane
  for (const p of out) {
    const r = p.limb || p.plane ? null : reliefSpec(p.slot, g);
    if (!r) continue;
    const n = rig.nodes[r.anchor];
    p.relief = { kind: r.kind, pitch: r.pitch, depth: r.depth, root: rootOf(p.polys, [n.x, n.y]) };
  }
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
/** Size of the shoulder and haunch muscles per build (normal, stick, muscular, round, skeletal); 0 = none. */
const MUSCLE: readonly number[] = [0.75, 0, 0.95, 0, 0];

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

/** A limb's end this close to the bed (its lowest point, mm) rests on the stand. */
const BED_TOUCH_MM = 1;

/** The stand seen from above: an oval (or an uneven stone) under every foot, its top on the bed plane y = 0. */
function standTop(p: Part3D, g: MorphotypeGenome, rig: Rig, parts: readonly Part3D[]): void {
  let x0 = Infinity, x1 = -Infinity;
  for (const poly of p.polys) for (const [x] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  let rz = rig.dims.bodyWidth * 0.32 + rig.dims.legWidth / 2 + STAND_MARGIN_MM;
  // everything that touches the bed (an insect's feet far out to the sides, an octopus's tentacles) stands on it
  for (const q of parts) {
    if (q === p || !q.limb) continue;
    for (const c of [...q.limb.cones, ...(q.limb.tips ?? [])]) for (const [e, r] of [[c.a, c.ra], [c.b, c.rb]] as const) {
      if (e[1] - r > BED_TOUCH_MM) continue;
      x0 = Math.min(x0, e[0] - r - STAND_MARGIN_MM); x1 = Math.max(x1, e[0] + r + STAND_MARGIN_MM);
      // an ellipse through the point needs more than its z: the point is not at the ellipse's widest x
      rz = Math.max(rz, Math.abs(e[2]) + r + STAND_MARGIN_MM);
    }
  }
  const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2;
  // a foot near the front or the back end needs the oval wider there too: grow it until every contact is inside
  for (const q of parts) {
    if (q === p || !q.limb) continue;
    for (const c of [...q.limb.cones, ...(q.limb.tips ?? [])]) for (const [e, r] of [[c.a, c.ra], [c.b, c.rb]] as const) {
      if (e[1] - r > BED_TOUCH_MM) continue;
      const u = Math.min(0.95, Math.abs(e[0] - cx) / rx);
      rz = Math.max(rz, (Math.abs(e[2]) + r + STAND_MARGIN_MM * 0.5) / Math.sqrt(1 - u * u));
    }
  }
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
/** The smallest air gap (mm) between two appendages of different kinds that sit side by side. */
export const APPENDAGE_GAP_MM = 1.2;
/** Two outlines closer than this in the side view can meet in 3D (the body blend radius, bake BLEND_MM, plus the gap). */
const SIDE_NEAR_MM = 2.4 + APPENDAGE_GAP_MM;
/** How thin a horn, antenna or wing may get to make room on a crowded head. */
const THIN_MM = 1.8;
/** The gap a crowded head falls back to before giving up. */
const TIGHT_GAP_MM = 0.6;
/** Which appendage gives way first when two touch (higher moves first); central ones (crest, fin, mane) never move. */
/** Tie-break when two sit at the same depth: the one with the higher value goes outside. */
const GIVE: Partial<Record<number, number>> = { 2: 6, 4: 5, 3: 4, 8: 3, 1: 2 };

/** One appendage on one side (an ear with its cup, a wing); `reach` is how far out its outer face may go. */
interface Unit { grp: number; side: -1 | 0 | 1; parts: Part3D[]; reach?: number }
const span = (u: Unit): [number, number] => {
  let lo = Infinity, hi = -Infinity;
  for (const p of u.parts) if (!p.carve) { const c = p.z * (u.side || 1); lo = Math.min(lo, c - p.thickness / 2); hi = Math.max(hi, c + p.thickness / 2); }
  return [lo, hi];
};

/** Distance between two sets of side-view outlines (negative where they overlap), from the vertices of each to the other. */
export function outlineGap(a: XY[][], b: XY[][]): number {
  const ea = edgesOf(a), eb = edgesOf(b);
  let d = Infinity;
  for (const poly of a) for (const [x, y] of poly) d = Math.min(d, sdPolys(eb, b, x, y));
  for (const poly of b) for (const [x, y] of poly) d = Math.min(d, sdPolys(ea, a, x, y));
  return d;
}

/** Pairs of appendage units that overlap (or nearly) in the side view: only these can touch in 3D. */
export function appendageUnits(out: Part3D[]): Unit[] {
  const units = new Map<string, Unit>();
  for (const p of out) {
    const grp = blendGroup(p.slot);
    if (!grp || p.plane || p.limb) continue;
    const key = `${grp}:${p.side}`;
    const u = units.get(key) ?? { grp, side: p.side, parts: [] };
    u.parts.push(p);
    units.set(key, u);
  }
  return [...units.values()];
}

/** The air gap in Z between two units whose outlines meet in the side view, or null when they cannot touch. */
export function unitGap(u: Unit, v: Unit): number | null {
  if (u.side && v.side && u.side !== v.side) return null;
  if (outlineGap(solid(u), solid(v)) > SIDE_NEAR_MM) return null;
  const [a0, a1] = span(u), [b0, b1] = span(v);
  if (!u.side || !v.side) { // one sits on the centre plane: the gap is from its half-thickness to the other's inner face
    const [c, s] = u.side ? [v, u] : [u, v];
    const hw = span(c)[1];
    return span(s)[0] - hw;
  }
  return Math.max(b0 - a1, a0 - b1);
}

/**
 * Appendages of different kinds (an ear and a wing, a horn and an antenna, a horn and a crest) should not touch. Only
 * those whose outlines meet (or nearly meet) in the side view can touch in 3D; on each side those are packed across Z
 * like books on a shelf: in their current order, each one at least APPENDAGE_GAP_MM beyond its inner neighbours and
 * past any crest on the centre plane, then pulled back where its root would leave the head or body (see reachOut). A part that already sits clear never moves. When a small head simply has no room for all of them, the
 * rest still touch: appendageContacts reports those. 2D is a side view, so it does not change.
 */
function separateAppendages(out: Part3D[]): void {
  const units = appendageUnits(out);
  const near = new Map<Unit, Set<Unit>>(units.map((u) => [u, new Set()]));
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const u = units[i]!, v = units[j]!;
    if (u.side && v.side && u.side !== v.side) continue;
    if (outlineGap(solid(u), solid(v)) > SIDE_NEAR_MM) continue;
    near.get(u)!.add(v); near.get(v)!.add(u);
  }
  // how far out each unit may slide while its root stays buried in the head or body
  const bodies = out.filter((p) => BODY_SLOTS.has(p.slot) && !p.plane).map((p) => ({ p, e: edgesOf(p.polys) }));
  for (const u of units) if (u.side && near.get(u)!.size) u.reach = span(u)[1] + reachOut(u, bodies);
  for (const side of [1, -1] as const) {
    const row = units.filter((u) => u.side === side && near.get(u)!.size);
    if (!row.length) continue;
    const span0 = new Map(row.map((u) => [u, span(u)] as const));
    const at = new Map<Unit, [number, number]>(); // [inner, outer] in |z|
    const width = (u: Unit): number => at.get(u)![1] - at.get(u)![0];
    const move = (u: Unit, inner: number): void => { const w = width(u); at.set(u, [inner, inner + w]); };
    const mid = (u: Unit): number => (span0.get(u)![0] + span0.get(u)![1]) / 2;
    row.sort((u, v) => mid(u) - mid(v) || (GIVE[u.grp] ?? 0) - (GIVE[v.grp] ?? 0));
    // alternate: push outwards past the crest and inner neighbours, then pull inwards within reach and under outer
    // neighbours; when the row fits, this settles with every part as close to where it was as the gaps allow
    const pack = (gap: number, slim: (u: Unit) => number): boolean => {
      for (const u of row) { const w = slim(u); at.set(u, [mid(u) - w / 2, mid(u) + w / 2]); }
      const out = (): void => row.forEach((u, k) => {
        let lo = 0.4;
        for (const c of near.get(u)!) if (!c.side) lo = Math.max(lo, span(c)[1] + gap);
        for (const v of row.slice(0, k)) if (near.get(u)!.has(v)) lo = Math.max(lo, at.get(v)![1] + gap);
        if (at.get(u)![0] < lo) move(u, lo);
      });
      for (let it = 0; it < 6; it++) {
        out();
        for (let k = row.length - 1; k >= 0; k--) {
          const u = row[k]!;
          let hi = u.reach!;
          for (const v of row.slice(k + 1)) if (near.get(u)!.has(v)) hi = Math.min(hi, at.get(v)![0] - gap);
          if (at.get(u)![1] > hi) move(u, hi - width(u));
        }
      }
      out(); // the last inward pull may have broken an inner gap: only the reach may be broken now
      return row.every((u) => at.get(u)![1] <= u.reach! + 1e-6);
    };
    const full = (u: Unit): number => span0.get(u)![1] - span0.get(u)![0];
    // a single plate (horn, antenna, wing) may slim down to THIN_MM to make room on a crowded head
    const slim = (u: Unit): number => u.parts.length === 1 ? Math.min(full(u), THIN_MM) : full(u);
    const ok = pack(APPENDAGE_GAP_MM, full) || pack(APPENDAGE_GAP_MM, slim) || pack(TIGHT_GAP_MM, slim);
    // still no room: everything stays within reach and as far apart as it fits; the parts that still touch are
    // reported by appendageContacts
    if (!ok) for (const u of row) if (at.get(u)![1] > u.reach!) move(u, Math.max(0.4, u.reach! - width(u)));
    for (const u of row) if (u.parts.length === 1 && width(u) < full(u) - 1e-6) {
      const p = u.parts[0]!, t = width(u);
      p.thickness = t;
      p.bevel = Math.min(p.bevel, t / 2 - 0.01);
      if (p.dome) p.dome = Math.min(p.dome, t * 0.75);
    }
    for (const u of row) { const dz = (at.get(u)![0] + at.get(u)![1]) / 2 - (span(u)[0] + span(u)[1]) / 2; for (const p of u.parts) p.z += side * dz; }
  }
}
const solid = (u: Unit): XY[][] => u.parts.flatMap((p) => p.carve ? [] : p.polys);

export interface Contact { a: SlotId; b: SlotId; gap: number; at: XY }

/**
 * Appendages of different kinds that still touch (or nearly touch) in 3D after separateAppendages: a small head with
 * no room for an ear, a horn and an antenna side by side. One entry per pair (the left and right sides are mirrors).
 */
export function appendageContacts(out: Part3D[]): Contact[] {
  const units = appendageUnits(out), found = new Map<string, Contact>();
  const centre = (u: Unit): XY => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const poly of solid(u)) for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  };
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const u = units[i]!, v = units[j]!, gap = unitGap(u, v);
    if (gap === null || gap >= TIGHT_GAP_MM - 0.05) continue;
    const [a, b] = [u.parts[0]!.slot, v.parts[0]!.slot].sort() as [SlotId, SlotId];
    const [cu, cv] = [centre(u), centre(v)];
    const key = `${a}/${b}`;
    if (!found.has(key) || gap < found.get(key)!.gap) found.set(key, { a, b, gap, at: [(cu[0] + cv[0]) / 2, (cu[1] + cv[1]) / 2] });
  }
  return [...found.values()];
}

const BODY_SLOTS = new Set<string>(['head', 'torso', 'neck', 'snout']);
/** A moved appendage still counts as attached when this many points of its inner face lie this deep in the body. */
const ROOT_POINTS = 6, ROOT_DEPTH_MM = 0.6;

/** The farthest (mm, in steps of 0.2) a unit can slide outwards with its root still buried in the head or body. */
function reachOut(u: Unit, bodies: { p: Part3D; e: Edge[] }[]): number {
  const pts: XY[] = [];
  for (const poly of solid(u)) for (let k = 0; k < poly.length; k += 2) pts.push(poly[k]!);
  const inner = span(u)[0] + 0.3;
  const buried = (dz: number): boolean => {
    const z = (u.side || 1) * (inner + dz);
    let n = 0;
    for (const [x, y] of pts) if (bodies.some(({ p, e }) => slabSd(p, e, x, y, z) < -ROOT_DEPTH_MM) && ++n >= ROOT_POINTS) return true;
    return false;
  };
  if (!buried(0)) return 0;
  let dz = 0;
  while (dz < 12 && buried(dz + 0.2)) dz += 0.2;
  return dz;
}

/** How deep (mm) the cup inside an ear is. */
const EAR_CUP_MM = 0.9;

/** How deep (mm) a whisker's root sinks into the Pysk's skin, and how far in from its outline the mount sits. */
export const WHISKER_EMBED_MM = 0.9;
const WHISKER_INSET_MM = 1.2;

/** Width of a whisker at its tip, as a share of its root. */
const WHISKER_TIP = 0.45;

function whiskerTop(p: Part3D, g: MorphotypeGenome, ctx: Ctx, muzzle: Host[], print: boolean): void {
  const pad = p.polys[0]!; // the root dot of the drawing: the side-view position of the pad
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pad) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const side = p.side || 1, len = whiskerLength(g.face!.whiskers!, g.face!.whiskerSize), half = p.thickness / 2;
  const off = WHISKER_TURN[g.face!.whiskerDir ?? 0] ?? 0;
  // the whisker mount: on the Pysk's skin at the pad, the whole strand's height (y +- half) inside it
  const m = mountAt(muzzle, (x0 + x1) / 2, (y0 + y1) / 2, WHISKER_INSET_MM);
  const cx = m?.x ?? (x0 + x1) / 2, cy = m?.y ?? (y0 + y1) / 2;
  const skin = m ? Math.min(...[-half, 0, half].map((dy) => Math.max(...muzzle.map((h) => skinZ(h, cx, cy + dy))))) : ctx.snoutW / 2;
  const zr = Math.max(0, skin - WHISKER_PAD[1] * 0.4); // pad centre: inside the Pysk, its outer half standing out
  const polys: XY[][] = [];
  const ell: XY[] = [];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; ell.push([cx + Math.cos(a) * WHISKER_PAD[0], side * (zr + Math.sin(a) * WHISKER_PAD[1])]); }
  if (print) polys.push(side > 0 ? ell : ell.reverse()); // the pad that seats the separate whiskers in the muzzle
  for (const a of WHISKER_FAN) {
    const ax = cx, az = Math.max(0, skin - WHISKER_EMBED_MM), bx = cx + Math.sin(a + off) * len, bz = az + 0.4 + Math.cos(a + off) * len;
    const l = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / l * (WHISKER_W / 2), nz = (bx - ax) / l * (WHISKER_W / 2);
    // a hair tapers to its tip (and its top is rounded, see SPEC_3D: a strand, not a flat strip)
    const tx = nx * WHISKER_TIP, tz = nz * WHISKER_TIP;
    const quad: XY[] = [[ax + nx, side * (az + nz)], [bx + tx, side * (bz + tz)], [bx - tx, side * (bz - tz)], [ax - nx, side * (az - nz)]];
    polys.push(side > 0 ? quad : quad.reverse());
  }
  p.polys = polys;
  p.plane = 'xz';
  p.z = cy;
  p.domeSide = 1; // round on top, flat underneath: the set prints lying on the bed
}

/** Radius (mm) of the groove a closed mouth is cut with, and of a nostril's opening. */
const MOUTH_CUT_R = 0.45;
const NOSTRIL_R = 0.5;

/**
 * Lips: a tube rolled along each jaw's edge on both sides of the muzzle, where its surface is. A closed mouth is a real
 * groove cut along the mouth line; nostrils are holes bored into the front of the nose on either side of its centre.
 */
function lipsAndNostrils(out: Part3D[], paths: SlotPaths, ctx: Ctx): void {
  const snout = hostsOf(out, ['snout'])[0];
  // the muzzle's surface z at (x, y): where its rounded slab ends
  const surfZ = (x: number, y: number): number => (snout ? Math.max(0, skinZ(snout, x, y)) : ctx.snoutW / 2);
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

/**
 * How far an eyeball stands out of the head, as a share of its radius: bulging eyes show most of the ball, like a
 * real eye; deep-set ones sit in the head with only a cap of the ball showing between the lids.
 */
const EYE_OUT = [0.75, 0.3] as const;

/** How deep (mm) a tooth's root sinks into the jaw it grows from. */
const TOOTH_SEAT_MM = 0.5;
/** How far in from the rim (mm) a tooth's mount sits. */
const TOOTH_IN_MM = 0.8;

/**
 * Teeth sit on the rims of the jaws, but the muzzle is rounded across Z: at the rim it is narrower than its full
 * width, so teeth placed at a fixed Z hang beside the jaws in the air. Each tooth becomes its own part, set just inside
 * the jaw's surface at its root (the point of the tooth deepest in the muzzle or head outline).
 */
function seatTeeth(out: Part3D[]): void {
  const jaws = hostsOf(out, ['snout', 'head']);
  if (!jaws.length) return;
  for (const t of out.filter((p) => p.slot === 'teeth' && p.side)) {
    const teeth = t.polys.map((poly, k): Part3D | null => {
      let root: XY | null = null, best = Infinity;
      for (const [x, y] of poly) for (const { p, e } of jaws) { const d = sdPolys(e, p.polys, x, y); if (d < best) { best = d; root = [x, y]; } }
      if (!root) return null;
      // the tooth's mount: on the jaw's rim at its root, a little way in, the root TOOTH_SEAT_MM inside the skin
      // (measured near the rim: further in, a rounded jaw is much wider than where the tooth actually grows)
      const m = mountAt(jaws, root[0], root[1], TOOTH_IN_MM, TOOTH_SEAT_MM);
      // (and no wider than the jaw at the root itself, so the tooth never stands out past the lip)
      const rim = Math.max(...jaws.map((j) => skinZ(j, root![0], root![1])));
      const z = Math.min(Math.abs(t.z) + t.thickness / 2, m?.z ?? 0, rim);
      return { ...t, id: `${t.id}${k}`, polys: [poly], z: t.side * Math.max(t.thickness / 2, z - t.thickness / 2) };
    });
    out.splice(out.indexOf(t), 1, ...teeth.filter((x): x is Part3D => !!x));
  }
}

/**
 * Eyes as real balls: every eye outline becomes a sphere that stands out of the head (or sits on its stalk), the iris
 * and pupil are painted on its front, and the eyelids are round folds rolled over the top and under the bottom of the
 * ball, following the arcs the 2D sketch draws (eyelids in shapes.ts).
 */
function eyeballs(out: Part3D[], stalks: boolean, eyeOut: number, shape: number): void {
  const head = hostsOf(out, ['head'])[0];
  for (const eye of out.filter((p) => p.slot === 'eye')) {
    const side = eye.side || 1, cones: Cone[] = [], lidCones: Cone[] = [];
    let front = -Infinity;
    for (const poly of eye.polys) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = (x1 - x0) / 2;
      // where the head's surface is at the eye (it curves away from the 2D outline's centre plane)
      let surf = Math.abs(eye.z) + eye.thickness / 2 - 0.8;
      if (!stalks && head) surf = Math.max(0, skinZ(head, cx, cy));
      const zc = stalks ? eye.z : side * (surf + (eyeOut - 1) * r);
      cones.push({ a: [cx, cy, zc], b: [cx, cy, zc], ra: r, rb: r });
      front = Math.max(front, Math.abs(zc) + r);
      for (const lid of eyelids(r, eyeOut < EYE_OUT[0], shape)) {
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
