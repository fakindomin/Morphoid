/**
 * Mount points: where small elements attach to the head and the Pysk.
 *
 * The head and the Pysk are rounded across Z, so their skin is not at a fixed distance from the centre plane: a part
 * placed at "half the muzzle's width" floats beside a narrow tip or sinks into a fat cheek. Every element that sits on
 * the skin (whiskers, teeth, eyes, lips) asks this module where the real 3D surface is at its root and is set a fixed
 * depth into it, so it is attached on every creature, whatever the head or Pysk looks like.
 */
import type { Part3D } from './spec3d';
import type { SlotId } from './shapes';
import { edgesOf, sdPolys, slabDist, type Edge } from '../bake/field';

/** A solid an element can be mounted on, with its outline's edges. */
export interface Host { p: Part3D; e: Edge[] }

/** A mount point: a spot on the host's outline (x, y) and the host's skin there (z >= 0, mirrored per side). */
export interface Mount { x: number; y: number; z: number; host: Part3D }

/** The centre solids of the given slots (in the order given), ready to mount elements on. */
export function hostsOf(out: Part3D[], slots: SlotId[]): Host[] {
  const hosts: Host[] = [];
  for (const s of slots) for (const p of out) if (p.slot === s && !p.side && !p.limb && !p.carve) hosts.push({ p, e: edgesOf(p.polys) });
  return hosts;
}

/** Signed distance to a part's rounded slab (the shape the bake fuses). */
export function slabSd(p: Part3D, e: Edge[], x: number, y: number, z: number): number {
  return slabDist(p, sdPolys(e, p.polys, x, y), z - p.z, x, y);
}

/** The host's skin at (x, y): the largest z where a point is still `depth` mm inside it, or -Infinity outside it. */
export function skinZ(h: Host, x: number, y: number, depth = 0): number {
  let z = h.p.z + h.p.thickness / 2;
  while (z >= h.p.z) {
    if (slabSd(h.p, h.e, x, y, z) < -depth) return z;
    z -= 0.05;
  }
  return -Infinity;
}

/**
 * The mount point nearest to (x, y): on the host whose outline is closest, moved in along the outline's normal until
 * it is at least `inset` mm inside it, so a root drawn on the very edge (or a hair outside it) still lands on skin.
 */
export function mountAt(hosts: Host[], x: number, y: number, inset = 0, depth = 0): Mount | null {
  if (!hosts.length) return null;
  const sd = (h: Host, px: number, py: number): number => sdPolys(h.e, h.p.polys, px, py);
  const h = hosts.reduce((a, b) => (sd(b, x, y) < sd(a, x, y) ? b : a));
  let px = x, py = y;
  for (let i = 0; i < 120 && sd(h, px, py) > -inset; i++) {
    const gx = sd(h, px + 0.05, py) - sd(h, px - 0.05, py), gy = sd(h, px, py + 0.05) - sd(h, px, py - 0.05), gl = Math.hypot(gx, gy) || 1;
    px -= (gx / gl) * 0.1; py -= (gy / gl) * 0.1;
  }
  // where hosts overlap (Pysk grown out of the head) the skin is the outermost of them
  const z = Math.max(...hosts.map((o) => skinZ(o, px, py, depth)));
  return z === -Infinity ? null : { x: px, y: py, z, host: h.p };
}
