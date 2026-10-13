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
import { EYES, WHISKER_TURN, insectHips, insectLegW, insectRise, prolegXs, roundTail, STALK_W, wingRibs, STAND_MARGIN_MM, STAND_MM, WHISKER_FAN, WHISKER_PAD, WHISKER_W, whiskerLength, type SlotId, type SlotPaths } from './shapes';
import type { XY } from './path';
import { typeSize } from './pose';
import { insectLimb, legLimb, legSpecOf, octopusLimb, prolegLimb, type Limb } from './limb';
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
  /** a true 3D solid (a jointed leg) in world mm: then `polys` is only its side view, see limb.ts */
  limb?: Limb;
  /** raised 3D ribs fused onto the slab (wing bones, feather shafts), world mm */
  ribs?: Limb;
}

interface Ctx { W: number; G: number; legW: number; legZ: number; headW: number; snoutW: number; neckT: number }
interface Spec { color: ColorKey; mirror: boolean; z: (c: Ctx) => number; t: (c: Ctx) => number; bevel: (t: number, c: Ctx) => number; dome?: (t: number) => number }

const round = (k: number) => (t: number): number => Math.min(t / 2 - 0.01, t * k);
const flat = (t: number): number => Math.min(0.45, t / 2 - 0.01);
const centre = (): number => 0;

/** `null` = deliberately not a 3D solid (render-only shading, or the mirror image of another slot). */
export const SPEC_3D: Record<SlotId, Spec | null> = {
  shadow: null, torsoClip: null, belly: null, glint: null, bones: null, iris: null, blush: null, toes: null, // render-only
  wingRibs: null, // drawn crests of the wing ribs; the ribs themselves are `ribs` on the wing, see buildParts3D
  legBFar: null, legFFar: null, wingFar: null,                          // mirror images, generated from the near slot
  torso: { color: 'c1', mirror: false, z: centre, t: (c) => c.W, bevel: (t) => round(0.48)(t) },
  pattern: null, // painted onto the torso surface (colour region), see the viewport
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
  pupil: { color: 'ink', mirror: true, z: (c) => c.headW / 2 + 0.8, t: () => 0.4, bevel: () => 0.08 },
  brow: { color: 'ink', mirror: true, z: (c) => c.headW / 2 - 0.1, t: () => 0.5, bevel: () => 0.1 },
  mouth: { color: 'ink', mirror: true, z: (c) => c.snoutW / 2 - 0.1, t: () => 0.5, bevel: () => 0.1 },
  teeth: { color: 'white', mirror: true, z: (c) => c.snoutW / 2 - 0.4, t: () => 1.6, bevel: () => 0.1 },
  arms: { color: 'c1', mirror: false, z: centre, t: () => D.OCTOPUS.armMm, bevel: (t) => round(0.45)(t) }, // top-view, see buildParts3D
  stand: { color: 'c2', mirror: false, z: centre, t: () => STAND_MM, bevel: (t) => round(0.3)(t) }, // top-view plate, see standTop
  whiskers: { color: 'c1dark', mirror: true, z: () => 0, t: () => 1.6, bevel: (t) => flat(t) }, // top-view plate, see whiskerTop
};

export function ctxFor(rig: Rig): Ctx {
  const W = rig.dims.bodyWidth, G = rig.dims.bodyGirth;
  const headW = Math.max(8, W * 0.9);
  return { W, G, legW: rig.dims.legWidth, legZ: W * 0.32, headW, snoutW: headW * 0.62, neckT: Math.max(6, W * 0.7) };
}

export function buildParts3D(paths: SlotPaths, g: MorphotypeGenome, rig: Rig): Part3D[] {
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
  for (const p of out) if (p.slot === 'whiskers') whiskerTop(p, g, ctx);
  if (g.face!.eyes === EYES.stalks) for (const p of out) { // eyes on stalks: a ball on top of each stalk, the pupil on its outer side
    const zs = ctx.headW * 0.25 * p.side;
    if (p.slot === 'eye') { p.z = zs; p.thickness = 4.4; p.bevel = 2.1; }
    if (p.slot === 'pupil') p.z = zs + 2.2 * p.side;
  }
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
  return out;
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
 * Whiskers stick out sideways: the part becomes a top-view plate (x, z) at the height of its pad in the side view,
 * the pad half sunk into the muzzle side, three strands fanning out from it.
 */
function whiskerTop(p: Part3D, g: MorphotypeGenome, ctx: Ctx): void {
  const pad = p.polys[0]!;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pad) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, side = p.side || 1, len = whiskerLength(g.face!.whiskers!);
  const off = WHISKER_TURN[g.face!.whiskerDir ?? 0] ?? 0;
  const zr = ctx.snoutW / 2 - 0.6; // pad centre: just inside the muzzle side
  const polys: XY[][] = [];
  const ell: XY[] = [];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; ell.push([cx + Math.cos(a) * WHISKER_PAD[0], side * (zr + Math.sin(a) * WHISKER_PAD[1])]); }
  polys.push(side > 0 ? ell : ell.reverse());
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

/** Signed distance to a part's rounded slab (the shape the bake fuses). */
function slabSd(p: Part3D, e: Edge[], x: number, y: number, z: number): number {
  return slabDist(p, sdPolys(e, p.polys, x, y), z - p.z);
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
