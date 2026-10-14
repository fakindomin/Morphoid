/**
 * Surface relief on the accessories: growth rings round a horn, segments on an antenna (rings: grooves at equal
 * distances from the root), and the rays of a fin, the strands of a mane or tuft, the vanes of feathers (rays:
 * grooves fanning out from the root). Like the coat (coat.ts) the relief only sinks into the surface, so outlines and
 * joints stay as they are; the bake adds it to the part's field and the 2D sketch draws the same grooves.
 */
import { Path, tube, type XY } from './path';
import type { MorphotypeGenome } from '../genome';
import type { NodeId } from '../rig';

export interface Relief {
  kind: 'rings' | 'rays';
  /** where the part grows from (side view, mm) */
  root: XY;
  /** distance between rings (mm), or angle between rays (radians) */
  pitch: number;
  /** groove depth (mm) */
  depth: number;
}

const sstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Groove width as a share of the pitch. */
const GROOVE = 0.22;
/** No relief this close to the root (mm): the joint with the body stays smooth. */
const ROOT_CLEAR = 1.5;

/** How deep (mm, >= 0) the relief sinks the surface at side-view point (x, y). */
export function reliefDepth(r: Relief, x: number, y: number): number {
  const dx = x - r.root[0], dy = y - r.root[1], dist = Math.hypot(dx, dy);
  const fade = sstep(ROOT_CLEAR, ROOT_CLEAR + 1.5, dist);
  if (fade <= 0) return 0;
  // phase within one pitch: 0 at a groove's centre line
  const u = r.kind === 'rings' ? dist / r.pitch : Math.atan2(dy, dx) / r.pitch;
  const f = Math.abs(u - Math.round(u)); // 0..0.5
  return r.depth * fade * (1 - sstep(GROOVE * 0.25, GROOVE, f));
}

/** The grooves as seen from the side, clipped to the part's outline (`inside` tests a point). */
export function reliefPath(r: Relief, inside: (p: XY) => boolean, reach: number): Path {
  const out = new Path(), w = 0.32;
  const runs = (pts: XY[]): void => {
    let run: XY[] = [];
    const flush = (): void => { for (let i = 1; i < run.length; i++) out.append(tube(run[i - 1]!, run[i]!, w, w)); run = []; };
    for (const p of pts) if (inside(p)) run.push(p); else flush();
    flush();
  };
  if (r.kind === 'rings') {
    for (let d = Math.ceil((ROOT_CLEAR + 0.8) / r.pitch) * r.pitch; d <= reach; d += r.pitch) {
      runs(Array.from({ length: 121 }, (_, i) => { const a = (i / 120) * Math.PI * 2; return [r.root[0] + Math.cos(a) * d, r.root[1] + Math.sin(a) * d] as XY; }));
    }
  } else {
    for (let a = -Math.PI; a < Math.PI; a += r.pitch) {
      runs(Array.from({ length: 80 }, (_, i) => { const d = ROOT_CLEAR + 0.8 + ((reach - ROOT_CLEAR) * i) / 79; return [r.root[0] + Math.cos(a) * d, r.root[1] + Math.sin(a) * d] as XY; }));
    }
  }
  return out;
}

/** Which accessories carry a relief, how it runs, and the rig node it grows from. */
export function reliefSpec(slot: string, g: MorphotypeGenome): (Omit<Relief, 'root'> & { anchor: NodeId }) | null {
  const horn = g.horns!.type!, crest = g.crest!.type!, wing = g.wings!.type!, tail = g.tail!.type!;
  switch (slot) {
    case 'horns': return horn === 4 ? null : { kind: 'rings', pitch: 1.7, depth: 0.35, anchor: 'hornRoot' }; // antlers stay smooth
    case 'antennae': return { kind: 'rings', pitch: 1.4, depth: 0.3, anchor: 'hornRoot' };
    case 'tuft': case 'mane': return crest === 1 || crest === 2 || crest === 5 ? { kind: 'rays', pitch: 0.2, depth: 0.3, anchor: 'crestRoot' } : null;
    case 'finD': case 'finP': return { kind: 'rays', pitch: 0.16, depth: 0.28, anchor: 'torso' };
    case 'wingNear': return wing === 1 ? { kind: 'rays', pitch: 0.12, depth: 0.28, anchor: 'wingRoot' } : null; // feathers; a bat wing has its bones
    case 'tail': return tail === 3 || tail === 4 ? { kind: 'rays', pitch: 0.15, depth: 0.3, anchor: 'tailBase' } : null;
    default: return null;
  }
}

/** The point of the outline nearest to the anchor: where the part leaves the body. */
export function rootOf(polys: readonly (readonly XY[])[], anchor: XY): XY {
  let best: XY = anchor, bd = Infinity;
  for (const poly of polys) for (const p of poly) { const d = Math.hypot(p[0] - anchor[0], p[1] - anchor[1]); if (d < bd) { bd = d; best = p; } }
  return best;
}
