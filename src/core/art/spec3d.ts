/**
 * 3D specification of every 2D slot: how the outline becomes a solid.
 *
 * The 2D outlines (rig mm) are extruded across Z, rounded with a bevel, and mirrored
 * for paired parts. This is the preview representation (and the contract for the
 * SDF bake later): a slot without an entry here would be visible in 2D but missing
 * in 3D, which the project forbids - tests/art3d.test.ts enforces the full coverage.
 */
import type { MorphotypeGenome } from '../genome';
import type { Rig } from '../rig';
import { groupOfSlot, type PartGroup } from '../print/plan';
import type { SlotId, SlotPaths } from './shapes';
import type { XY } from './path';
import { edgesOf, sdPolys, type Edge } from '../bake/field';

export type ColorKey = 'c1' | 'c1dark' | 'c2' | 'c2soft' | 'c3' | 'ink' | 'white';

export interface Part3D {
  id: string;
  slot: SlotId;
  /** group the user can print separately; null = part of the body piece */
  group: PartGroup | null;
  /** outline polygons in rig mm (x forward, y up) */
  polys: XY[][];
  /** centre of the slab along Z, and its total thickness (mm) */
  z: number;
  thickness: number;
  /** rounding radius (mm) of the edges (<= thickness / 2) */
  bevel: number;
  color: ColorKey;
  /** -1 / +1 for paired parts, 0 on the centre plane */
  side: -1 | 0 | 1;
}

interface Ctx { W: number; G: number; legW: number; legZ: number; headW: number; snoutW: number; neckT: number }
interface Spec { color: ColorKey; mirror: boolean; z: (c: Ctx) => number; t: (c: Ctx) => number; bevel: (t: number, c: Ctx) => number }

const round = (k: number) => (t: number): number => Math.min(t / 2 - 0.01, t * k);
const flat = (t: number): number => Math.min(0.45, t / 2 - 0.01);
const centre = (): number => 0;

/** `null` = deliberately not a 3D solid (render-only shading, or the mirror image of another slot). */
export const SPEC_3D: Record<SlotId, Spec | null> = {
  shadow: null, torsoClip: null, belly: null, glint: null, bones: null, // render-only
  legBFar: null, legFFar: null, wingFar: null,                          // mirror images, generated from the near slot
  torso: { color: 'c1', mirror: false, z: centre, t: (c) => c.W, bevel: (t) => round(0.48)(t) },
  pattern: null, // painted onto the torso surface (colour region), see the viewport
  legB: { color: 'c1', mirror: true, z: (c) => c.legZ, t: (c) => c.legW, bevel: (t) => round(0.4)(t) },
  legF: { color: 'c1', mirror: true, z: (c) => c.legZ, t: (c) => c.legW, bevel: (t) => round(0.4)(t) },
  tail: { color: 'c1', mirror: false, z: centre, t: (c) => Math.max(3.2, c.G * 0.5), bevel: (t) => round(0.42)(t) },
  throat: { color: 'c1', mirror: false, z: centre, t: (c) => c.headW * 0.62, bevel: (t) => round(0.4)(t) },
  neck: { color: 'c1', mirror: false, z: centre, t: (c) => c.neckT, bevel: (t) => round(0.4)(t) },
  neckDecor: { color: 'c1dark', mirror: false, z: centre, t: (c) => c.neckT + 1.8, bevel: (t) => flat(t) },
  head: { color: 'c1', mirror: false, z: centre, t: (c) => c.headW, bevel: (t) => round(0.42)(t) },
  snout: { color: 'c1', mirror: false, z: centre, t: (c) => c.snoutW, bevel: (t) => round(0.42)(t) },
  nose: { color: 'ink', mirror: false, z: centre, t: (c) => c.snoutW * 0.8, bevel: (t) => round(0.45)(t) },
  ear: { color: 'c1', mirror: true, z: (c) => c.headW * 0.28, t: () => 2.4, bevel: (t) => flat(t) },
  earIn: { color: 'c2soft', mirror: true, z: (c) => c.headW * 0.28 + 1.35, t: () => 0.3, bevel: () => 0.05 },
  horns: { color: 'c2', mirror: true, z: (c) => c.headW * 0.3, t: () => 3.2, bevel: (t) => round(0.3)(t) },
  tuft: { color: 'c2', mirror: false, z: centre, t: () => 3.2, bevel: (t) => round(0.3)(t) },
  mane: { color: 'c2', mirror: false, z: centre, t: (c) => c.neckT * 0.6, bevel: (t) => round(0.3)(t) },
  spines: { color: 'c2', mirror: false, z: centre, t: () => 3.2, bevel: (t) => round(0.3)(t) },
  wingNear: { color: 'c2', mirror: true, z: (c) => c.W * 0.34, t: () => 1.6, bevel: (t) => flat(t) },
  saddle: { color: 'c2', mirror: false, z: centre, t: (c) => c.W * 0.96, bevel: (t) => round(0.45)(t) },
  collar: { color: 'c2', mirror: false, z: centre, t: (c) => c.neckT + 1.6, bevel: (t) => round(0.3)(t) },
  eye: { color: 'white', mirror: true, z: (c) => c.headW / 2 - 0.35, t: () => 2.3, bevel: (t) => round(0.35)(t) }, // sits 1.5 mm in, stands 0.8 mm proud
  pupil: { color: 'ink', mirror: true, z: (c) => c.headW / 2 + 0.8, t: () => 0.4, bevel: () => 0.08 },
  brow: { color: 'ink', mirror: true, z: (c) => c.headW / 2 - 0.1, t: () => 0.5, bevel: () => 0.1 },
  mouth: { color: 'ink', mirror: true, z: (c) => c.snoutW / 2 - 0.1, t: () => 0.5, bevel: () => 0.1 },
  teeth: { color: 'white', mirror: true, z: (c) => c.snoutW / 2 - 0.4, t: () => 1.6, bevel: () => 0.1 },
  whiskers: { color: 'c1dark', mirror: true, z: (c) => c.snoutW / 2 + 0.7, t: () => 1.6, bevel: (t) => flat(t) },
};

export function ctxFor(rig: Rig): Ctx {
  const W = rig.dims.bodyWidth, G = rig.dims.bodyGirth;
  const headW = Math.max(8, W * 0.9);
  return { W, G, legW: Math.max(6.5, G * 0.5), legZ: W * 0.32, headW, snoutW: headW * 0.62, neckT: Math.max(6, W * 0.7) };
}

export function buildParts3D(paths: SlotPaths, g: MorphotypeGenome, rig: Rig): Part3D[] {
  void g;
  const ctx = ctxFor(rig);
  const out: Part3D[] = [];
  for (const slot of Object.keys(SPEC_3D) as SlotId[]) {
    const spec = SPEC_3D[slot];
    if (!spec) continue;
    const polys = paths[slot].flatten(8);
    if (!polys.length) continue;
    const t = spec.t(ctx), bevel = spec.bevel(t, ctx), z = spec.z(ctx), group = groupOfSlot(slot)?.id ?? null;
    if (spec.mirror) {
      for (const side of [1, -1] as const) out.push({ id: `${slot}${side > 0 ? '+' : '-'}`, slot, group, polys, z: z * side, thickness: t, bevel, color: spec.color, side });
    } else {
      out.push({ id: slot, slot, group, polys, z, thickness: t, bevel, color: spec.color, side: 0 });
    }
  }
  const head = out.find((p) => p.slot === 'head');
  if (head) for (const p of out) if (p.slot === 'ear') p.polys = seatOn(p, head);
  return out;
}

/** Signed distance to a part's rounded slab (the shape the bake fuses). */
function slabSd(p: Part3D, e: Edge[], x: number, y: number, z: number): number {
  const half = p.thickness / 2, r = Math.min(p.bevel, half - 0.01);
  const wx = sdPolys(e, p.polys, x, y) + r, wy = Math.abs(z - p.z) - half + r;
  const px = Math.max(wx, 0), py = Math.max(wy, 0);
  return Math.min(Math.max(wx, wy), 0) + Math.hypot(px, py) - r;
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
