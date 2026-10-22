/**
 * Handles of the 3D view (2026-10-22): click an element of the creature (a leg, the tail, a wing, an arm, a horn, an
 * ear, an antenna, the neck) and pull its handles to change its length, its thickness and its swing. There is no free
 * sculpting: every handle moves one fine field of the genome (three hex digits at the end of the element's gene, see
 * schema), so the change is part of the DNA, copies with the code and rebuilds the same solid everywhere.
 *
 * This module says which element is where on the model (anchorsOf: its root, its tip and the parts it is made of, for
 * picking) and turns a pull in millimetres into the new field value (pullLength, pullThick, pullSwing).
 */
import {
  BLOCKS, FINE_LEVELS, FINE_RANGE, FINE_ZERO, fineValue, SWING_RAD, stepAt, thickScale, type BlockId, type MorphotypeGenome,
} from '../genome';
import { dimensions as D, type Rig } from '../rig';
import { edgesOf } from '../bake/field';
import type { V3 } from './limb';
import { slabSd } from './mounts';
import type { SlotId } from './shapes';
import type { Part3D } from './spec3d';

export type ElementId = 'legs' | 'tail' | 'wings' | 'hands' | 'horns' | 'ears' | 'antennae' | 'neck';

/** A fine field: where it lives in the genome. */
export interface FineRef { block: BlockId; field: string }

export interface ElementDef {
  id: ElementId;
  label: string;
  slots: readonly SlotId[];
  /** the length handle's field (a fraction of a step of `table`) */
  length: FineRef;
  table: readonly number[];
  /** the thickness handle's field: a fraction of a step of `thickTable` when given, else a plain scale */
  thick: FineRef;
  thickTable?: readonly number[];
  /** the swing handle's field; `splay`: the legs lean out sideways (else the element turns about its root in the side view) */
  swing: FineRef;
  splay?: boolean;
  /** the handle's labels, in the element's own words */
  words: { length: string; thick: string; swing: string };
}

const words = (swing = 'Wychylenie'): ElementDef['words'] => ({ length: 'Długość', thick: 'Grubość', swing });
const el = (id: ElementId, label: string, slots: SlotId[], block: BlockId, size: string, table: readonly number[]): ElementDef => ({
  id, label, slots, length: { block, field: `${size}F` }, table, thick: { block, field: 'thick' }, swing: { block, field: 'swing' }, words: words(),
});

export const ELEMENTS: readonly ElementDef[] = [
  { id: 'legs', label: 'Nogi', slots: ['legB', 'legF', 'arms'], length: { block: 'legs', field: 'lengthF' }, table: D.LEG_LENGTH,
    thick: { block: 'legs', field: 'thickF' }, thickTable: D.LEG_THICK, swing: { block: 'legs', field: 'swing' }, splay: true, words: words('Rozstaw') },
  el('tail', 'Ogon', ['tail'], 'tail', 'length', D.TAIL_LENGTH),
  el('wings', 'Skrzydła', ['wingNear'], 'wings', 'scale', D.WING_SPAN),
  { id: 'hands', label: 'Ręce', slots: ['hands'], length: { block: 'hands', field: 'lengthF' }, table: D.ARM_LEN,
    thick: { block: 'hands', field: 'thickF' }, thickTable: D.HAND_THICK, swing: { block: 'hands', field: 'swing' }, words: words() },
  el('horns', 'Rogi', ['horns'], 'horns', 'span', D.HORN_SPAN),
  el('ears', 'Uszy', ['ear', 'earFlop'], 'ears', 'scale', D.EAR_SIZE),
  el('antennae', 'Czułki', ['antennae'], 'antennae', 'length', D.ANTENNA_LEN),
  { id: 'neck', label: 'Szyja', slots: ['neck'], length: { block: 'sculpt', field: 'neckLength' }, table: D.NECK_LENGTH,
    thick: { block: 'sculpt', field: 'neckThick' }, swing: { block: 'head', field: 'neckSwing' }, words: words() },
];
export const elementDef = (id: ElementId): ElementDef => ELEMENTS.find((e) => e.id === id)!;

/** Where an element is on the model: one per element and side (the left and right ear are two). */
export interface Anchor {
  id: ElementId;
  side: -1 | 0 | 1;
  /** where it grows out of the body, and its far end (world mm) */
  root: V3; tip: V3;
  /** its half thickness (mm), where the thickness handle stands off its axis */
  radius: number;
  /** which way the swing handle pulls the tip (unit) */
  swingDir: V3;
  /** which way the thickness handle stands off the axis (unit) */
  thickDir: V3;
  /** the parts it is made of (for picking) */
  parts: Part3D[];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** World points of a part: its limb's cone ends, or its outline at its own depth (a spread wing leant out). */
function pointsOf(p: Part3D): V3[] {
  if (p.limb) return p.limb.cones.flatMap((c) => [c.a, c.b]);
  return p.polys.flat().map(([x, y]): V3 => {
    if (p.plane === 'xz') return [x, p.z, y];
    if (!p.tilt) return [x, y, p.z];
    const { a, y: ty, z: tz } = p.tilt, c = Math.cos(a), s = Math.sin(a);
    return [x, ty + (y - ty) * c - (p.z - tz) * s, tz + (y - ty) * s + (p.z - tz) * c];
  });
}

/** The elements of a model with their roots and tips (only the ones the creature has). */
export function anchorsOf(parts: readonly Part3D[], rig: Rig): Anchor[] {
  const out: Anchor[] = [];
  const n = rig.nodes;
  for (const def of ELEMENTS) {
    for (const side of [1, -1, 0] as const) {
      const own = parts.filter((p) => def.slots.includes(p.slot) && p.side === side && !p.carve && (p.limb || p.polys.length));
      if (!own.length) continue;
      const pts = own.flatMap(pointsOf);
      if (!pts.length) continue;
      let root: V3;
      if (def.id === 'neck') root = [n.neckBase.x, n.neckBase.y, 0];
      else if (def.id === 'tail') root = [n.tailBase.x, n.tailBase.y, 0];
      else if (def.id === 'wings') root = [n.wingRoot.x, n.wingRoot.y, own[0]!.z];
      else if ((def.id === 'legs' || def.id === 'hands') && own[0]!.limb?.cones.length) root = own[0]!.limb.cones[0]!.a; // the hip, the shoulder
      else if (def.id === 'legs') root = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
      else { // ears, horns, antennae: where they sit deepest in the head
        const h: V3 = [n.head.x, n.head.y, 0];
        root = pts.reduce((a, b) => (len(sub(b, h)) < len(sub(a, h)) ? b : a));
      }
      // (a leg's tip: its own foot, the lowest point under its hip, not another leg's foot further along the body)
      const under = def.id === 'legs' ? pts.filter((q) => Math.abs(q[0] - root[0]) < root[1] * 0.6 + 6) : [];
      const tip = def.id === 'neck' ? [n.head.x, n.head.y, 0] as V3
        : under.length ? under.reduce((a, b) => (b[1] < a[1] ? b : a))
          : pts.reduce((a, b) => (len(sub(b, root)) > len(sub(a, root)) ? b : a));
      const axis = unit(sub(tip, root));
      const radius = Math.max(1, ...own.map((p) => (p.limb ? Math.max(...p.limb.cones.map((c) => Math.max(c.ra, c.rb))) : p.thickness / 2)));
      const inPlane = unit([-axis[1], axis[0], 0]);
      // the legs lean out sideways and thicken forward; anything else swings in the side view and thickens towards the viewer
      const out1: V3 = [0, 0, side || -1];
      out.push({ id: def.id, side, root, tip, radius, parts: own, swingDir: def.splay ? out1 : inPlane, thickDir: def.splay ? inPlane : out1 });
    }
  }
  return out;
}

/** The element under a point of the model's surface (within `near` mm), or null when it is the body. */
export function pickAnchor(anchors: readonly Anchor[], x: number, y: number, z: number, near = 1.6): Anchor | null {
  let best: Anchor | null = null, bd = near;
  for (const a of anchors) for (const p of a.parts) {
    const d = slabSd(p, edgesOf(p.polys), x, y, z);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// ------------------------------------------------------------------ pulls

const fieldOf = (r: FineRef) => BLOCKS.find((b) => b.id === r.block)!.fields.find((f) => f.name === r.field)!;
/** A table's value at a slider position (a step plus a fraction). */
const tableAt = (t: readonly number[], s: number): number => {
  const step = Math.max(0, Math.min(t.length - 1, Math.round(s)));
  return stepAt(t, step, s - step);
};
/** The slider position whose table value is `target` (the tables grow with the step). */
function invert(t: readonly number[], target: number): number {
  let lo = FINE_RANGE[0], hi = FINE_RANGE[1];
  if (target <= tableAt(t, lo)) return lo;
  if (target >= tableAt(t, hi)) return hi;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (tableAt(t, m) < target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** The new value of a length handle pulled by `mm` (the element `was` mm long from root to tip when the pull began). */
export function pullLength(g: MorphotypeGenome, def: ElementDef, was: number, mm: number): number {
  const s0 = fineValue(g, def.length.block, def.length.field);
  const k = Math.max(0.2, (was + mm) / Math.max(1, was));
  return invert(def.table, tableAt(def.table, s0) * k);
}

/** The new value of a thickness handle pulled `mm` off an element `r` mm thick (half). */
export function pullThick(g: MorphotypeGenome, def: ElementDef, r: number, mm: number): number {
  const k = Math.max(0.2, (r + mm) / Math.max(0.5, r));
  const s0 = fineValue(g, def.thick.block, def.thick.field);
  if (def.thickTable) return invert(def.thickTable, tableAt(def.thickTable, s0) * k);
  const k1 = thickScale(def.thick.block, s0) * k;
  return def.thick.block === 'sculpt' ? FINE_ZERO + (k1 - 1) / 0.05 : FINE_ZERO + Math.log(k1) / Math.log(1.1);
}

/** The new value of a swing handle pulled `mm` sideways at `arm` mm from the root. */
export function pullSwing(g: MorphotypeGenome, def: ElementDef, arm: number, mm: number): number {
  const v0 = fineValue(g, def.swing.block, def.swing.field);
  return Math.max(0, Math.min(FINE_LEVELS - 1, v0 + Math.atan2(mm, Math.max(2, arm)) / SWING_RAD));
}

/** The three handles of an element as the panel shows them: a share (length, thickness) or degrees (swing). */
export function handleValues(g: MorphotypeGenome, def: ElementDef): { length: number; thick: number; swing: number; moved: boolean } {
  const s = fineValue(g, def.length.block, def.length.field), base = Math.round(s);
  const length = tableAt(def.table, s) / (def.table[Math.max(0, Math.min(5, base))] ?? 1) - 1;
  const t = fineValue(g, def.thick.block, def.thick.field);
  const thick = def.thickTable ? tableAt(def.thickTable, t) / (def.thickTable[2] ?? 1) - 1 : thickScale(def.thick.block, t) - 1; // (against the middle size)
  const swing = (fineValue(g, def.swing.block, def.swing.field) - FINE_ZERO) * SWING_RAD * 180 / Math.PI;
  const moved = [def.length, def.thick, def.swing].some((r) => (g[r.block]?.[r.field] ?? FINE_ZERO) !== FINE_ZERO);
  return { length, thick, swing, moved };
}

/** The element's handles back to untouched (the steps they carried into stay, like the size sliders left them). */
export function resetElement(g: MorphotypeGenome, def: ElementDef): MorphotypeGenome {
  const next = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { ...v }])) as MorphotypeGenome;
  for (const r of [def.length, def.thick, def.swing]) if (fieldOf(r)) next[r.block]![r.field] = FINE_ZERO;
  return next;
}
