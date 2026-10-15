/**
 * Option sketches for the radial menu: each slice shows the part it picks, drawn by the same 2D sketch code as the
 * creature (so a "Pióra ptaka" slice shows exactly the feathers this creature would get), cropped around that part,
 * with the body it grows from faintly behind it.
 */
import { applyOp, solveRig, withoutSculpt, type BlockId, type MorphotypeGenome, type Op } from '../core';
import { targetPose } from '../core/art/pose';
import { buildPaths, SLOTS, type SlotId, type SlotKind } from '../core/art/shapes';
import { PALETTES } from '../core/palette';

/** For a field: the slots that draw it, and the body around them shown faintly for context. */
interface Focus { parts: SlotId[]; context: SlotId[] }

const EYES: Focus = { parts: ['eye', 'iris', 'pupil', 'glint', 'lids', 'stalks'], context: ['head', 'snout'] };
const SNOUT: SlotId[] = ['snout', 'nose', 'maw', 'tongue', 'mouth', 'lips', 'teeth', 'nostrils'];
const WHOLE: Focus = { parts: [], context: [] }; // whole creature, in colour

const FOCUS: Partial<Record<BlockId, Focus | Record<string, Focus>>> = {
  tail: { parts: ['tail'], context: ['torso', 'legB'] },
  ears: { parts: ['ear', 'earIn'], context: ['head', 'snout'] },
  horns: { parts: ['horns'], context: ['head', 'snout', 'ear'] },
  antennae: { parts: ['antennae'], context: ['head', 'snout'] },
  wings: { parts: ['wingFar', 'wingNear', 'wingRibs'], context: ['torso', 'neck', 'head'] },
  crest: { parts: ['mane', 'tuft', 'spines'], context: ['head', 'neck', 'torso'] },
  snout: { parts: SNOUT, context: ['head'] },
  legs: { parts: ['legB', 'legF', 'legBFar', 'legFFar', 'toes', 'claws'], context: ['torso'] },
  head: {
    skull: { parts: ['head'], context: ['snout', 'neck'] },
    neck: { parts: ['neck', 'neckDecor'], context: ['head', 'torso'] },
    neckLength: { parts: ['neck', 'neckDecor', 'head'], context: ['torso'] },
  },
  face: {
    eyes: EYES, eyeSet: EYES,
    teeth: { parts: SNOUT, context: ['head'] },
    whiskers: { parts: ['whiskers'], context: ['head', ...SNOUT] },
    whiskerDir: { parts: ['whiskers'], context: ['head', ...SNOUT] },
    expression: { parts: [...SNOUT, 'brow', 'eye', 'pupil', 'lids'], context: ['head'] },
  },
};

const focusOf = (block: BlockId, field: string): Focus => {
  const f = FOCUS[block];
  if (!f) return WHOLE;
  return 'parts' in f ? (f as Focus) : ((f as Record<string, Focus>)[field] ?? WHOLE);
};

export interface ThumbLayer { d: string; fill: string; stroke: string; opacity: number }
export interface Thumb { viewBox: string; layers: ThumbLayer[] }

const INK = '#3b2333';
const mix = (hex: string, to: string, k: number): string => {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(p(hex, i) * (1 - k) + p(to, i) * k).toString(16).padStart(2, '0')).join('');
};

/** Fill of a slot kind in the sketch's palette; null = a touch too fine for a thumbnail. */
function fillOf(kind: SlotKind, [c1, c2, c3]: readonly [string, string, string]): string | null {
  switch (kind) {
    case 'skin': return c1;
    case 'skinFar': return mix(c1, '#000000', 0.3);
    case 'belly': return mix(c1, '#ffffff', 0.4);
    case 'accent': return c2;
    case 'accentFar': return mix(c2, '#000000', 0.3);
    case 'accentSoft': return mix(c2, '#ffffff', 0.45);
    case 'white': case 'glint': return '#ffffff';
    case 'ink': case 'lid': case 'groove': return INK;
    case 'iris': return c3;
    case 'tongue': return '#d9737f';
    case 'lip': return mix(c1, '#000000', 0.25);
    default: return null;
  }
}

/** The sketch of `block`'s part on the creature `g` with `ops` applied. */
export function makeThumb(g: MorphotypeGenome, ops: Op[], block: BlockId, field: string): Thumb {
  const g2 = withoutSculpt(ops.reduce(applyOp, g));
  const rig = solveRig(g2);
  const paths = buildPaths(targetPose(rig, g2, 0, false, { x: 0, y: 0 }), g2, rig, false);
  const pal = PALETTES[g2.palette!.index!] ?? PALETTES[0]!;
  const focus = focusOf(block, field);
  const whole = focus.parts.length === 0;
  const parts = new Set<string>(focus.parts), context = new Set<string>(focus.context);
  const to = (x: number, y: number) => [-x, -y] as const; // forward = screen-left, as on the big sketch

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const grow = (id: SlotId): void => {
    for (const poly of paths[id].flatten(4)) for (const [x, y] of poly) {
      x0 = Math.min(x0, -x); x1 = Math.max(x1, -x); y0 = Math.min(y0, -y); y1 = Math.max(y1, -y);
    }
  };
  const layers: ThumbLayer[] = [];
  for (const [id, kind] of SLOTS) {
    const p = paths[id];
    if (p.empty) continue;
    const fill = fillOf(kind, pal);
    if (!fill) continue;
    const inPart = whole || parts.has(id);
    if (!inPart && !context.has(id)) continue;
    if (inPart) grow(id);
    layers.push(inPart
      ? { d: p.d(to), fill, stroke: INK, opacity: 1 }
      : { d: p.d(to), fill: '#9aa3ad', stroke: 'none', opacity: 0.28 });
  }
  // nothing of the part drawn (e.g. "Brak"): frame the body it would grow from
  if (x0 === Infinity) for (const id of focus.context) grow(id as SlotId);
  if (x0 === Infinity) return { viewBox: '-1 -1 2 2', layers: [] };
  const w = x1 - x0, h = y1 - y0, side = Math.max(w, h) * 1.18 + 2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return { viewBox: `${(cx - side / 2).toFixed(1)} ${(cy - side / 2).toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}`, layers };
}
