/**
 * The side view drawn like the Morphoid logo: every part cut into flat facets lit from the upper front.
 * Two colourings:
 *   'color'  the creature's own colours (body c1, accents c2, pattern c3), facet by facet a shade lighter or darker;
 *   'print'  what the print audit found under each facet, in the logo's colours: blue prints safely, red gets slicer
 *            supports, deep red needs fixing (too thin, floating, parts grown into each other), steel stands on the bed.
 * No markers: the colour of the facet is the message.
 */
import { SLOTS, type SlotId, type SlotKind, type SlotPaths } from '../core/art/shapes';
import { facetsOf, resample } from '../core/art/facets';
import type { XY } from '../core/art/path';
import { HEAT, heatAt, type HeatLevel, type PrintReport } from '../core/print';
import { SLOT_TILE } from './tiles';
import type { ColorKey } from '../core/art/spec3d';
import { inkOf, isHex, type ElementColors, type Ink } from '../core/filaments';

export type SketchMode = 'color' | 'print';

/** dark -> light */
/**
 * Print colours from the logo: blues = prints safely (as many shades as the facets need), reds = needs supports from the
 * slicer (the deep reds: a spot to fix, too thin or touching), the logo's steel = lies on the bed.
 */
const PRINT_PAL: Record<Exclude<HeatLevel, typeof HEAT.attention>, readonly string[]> = {
  [HEAT.none]: ['#0b3b63', '#0369a1', '#0284c7', '#38bdf8', '#7dd3fc'],
  [HEAT.bed]: ['#1e293b', '#334155', '#3f2a33', '#475569'],
  [HEAT.support]: ['#b91c1c', '#e11d48', '#ff1744', '#ff4d63', '#ff8a9a'],
};
/** what a spot shows: a spot to fix (too thin, touching) is red like one that needs supports; the legend has three colours */
export const toneOf = (lv: HeatLevel): Exclude<HeatLevel, typeof HEAT.attention> => (lv === HEAT.attention ? HEAT.support : lv);
/** one colour per level for legends and the info line */
export const HEAT_SWATCH: Record<HeatLevel, string> = { [HEAT.none]: '#0284c7', [HEAT.bed]: '#334155', [HEAT.support]: '#ff1744', [HEAT.attention]: '#ff1744' };
export const HEAT_NAME: Record<HeatLevel, string> = { [HEAT.none]: 'Bezpieczne', [HEAT.bed]: 'Na stole', [HEAT.support]: 'Podpory', [HEAT.attention]: 'Podpory' };

const FACETED: readonly SlotKind[] = ['skin', 'skinFar', 'accent', 'accentFar', 'accentSoft', 'pattern'];
const FAR: readonly SlotKind[] = ['skinFar', 'accentFar'];
/** drawn but not cut: only the look, no print meaning */
const SKIP = new Set<string>(['shadow', 'torsoClip', 'belly', 'coat', 'coatLegs', 'coatOn', 'coatLegB', 'coatLegF', 'relief', 'blush']);
/** smaller than this (mm²) a part is a detail: one flat colour */
const MIN_FACET_AREA = 6;
/** body parts whose red (supports under the belly, the chest) shows faintly through the legs drawn over them */
const GHOSTED = new Set<string>(['torso', 'neck']);
const GHOST_FADE = 7;
const isLimb = (id: string): boolean => !id.endsWith('Far') && (id.startsWith('leg') || id === 'hands' || id === 'claws' || id === 'toes');

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: readonly number[]): string => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const mix = (a: string, b: string, k: number): string => { const p = hex(a), q = hex(b); return toHex(p.map((v, i) => v + (q[i]! - v) * k)); };

const polyArea = (p: readonly XY[]): number => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const u = p[i]!, v = p[(i + 1) % p.length]!; a += u[0] * v[1] - v[0] * u[1]; }
  return Math.abs(a) / 2;
};

export function insidePoly(poly: readonly XY[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** How far inside the outline a facet looks for print trouble (mm): the audit marks a thin band along the skin. */
const EDGE_IN = 0.45;
/**
 * The worst heat under a facet: its middle, and along the stretch of outline it touches, just inside it (an overhang
 * shows as a thin band under the belly, which a long facet would otherwise miss).
 */
/**
 * Does the facet sit on a stretch of the outline that faces down more steeply than 45° (an overhang of this part's own
 * skin, such as the belly over the legs)? The audit sees the legs holding the belly up in the side view; across the
 * width of the body the belly still hangs over, so its red shows through the legs.
 */
function overhangs(pts: readonly XY[], edge: readonly XY[]): boolean {
  if (edge.length !== 2) return false;
  const [a, b] = edge as [XY, XY];
  if (Math.min(a[1], b[1]) < 1.5) return false; // on the bed
  const cx = (pts[0]![0] + pts[1]![0] + pts[2]![0]) / 3, cy = (pts[0]![1] + pts[1]![1] + pts[2]![1]) / 3;
  let nx = b[1] - a[1], ny = a[0] - b[0];
  const len = Math.hypot(nx, ny) || 1;
  if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
  return ny / len < -Math.SQRT1_2;
}

export function facetHeat(at: (x: number, y: number) => HeatLevel, pts: readonly XY[], edge: readonly XY[]): HeatLevel {
  const cx = (pts[0]![0] + pts[1]![0] + pts[2]![0]) / 3, cy = (pts[0]![1] + pts[1]![1] + pts[2]![1]) / 3;
  let lv: number = at(cx, cy);
  const probe = (x: number, y: number): void => {
    const d = Math.hypot(cx - x, cy - y) || 1, k = Math.min(0.5, EDGE_IN / d);
    lv = Math.max(lv, at(x + (cx - x) * k, y + (cy - y) * k));
  };
  for (const [x, y] of edge) probe(x, y);
  if (edge.length === 2) {
    const [a, b] = edge as [XY, XY];
    for (const t of [0.25, 0.5, 0.75]) probe(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
  }
  return lv as HeatLevel;
}

export interface SketchInput {
  paths: SlotPaths;
  mode: SketchMode;
  palette: readonly [string, string, string];
  /** the element colours picked in the studio (they replace the palette's on their elements) */
  colors?: ElementColors;
  report: PrintReport;
  /** category lit up (hovered on the sketch or in the left column) */
  hot: string | null;
  showBones: boolean;
  insect: boolean;
  /** a point behind the body (rig mm): facet cuts start at the far end of each part */
  away: XY;
  /** rig torso centre: the torso's own cut starts at its front */
  torso: XY;
}

export interface SketchOutput {
  /** what was drawn, front last: for hit tests */
  hits: { slot: SlotId; tile: string; polys: XY[][] }[];
  /** side-view area (mm²) per heat level */
  area: Record<HeatLevel, number>;
}

/** Draws the sketch on `ctx`, whose transform already maps rig mm to pixels; `px` = one pixel in mm. */
export function drawSketch(ctx: CanvasRenderingContext2D, px: number, s: SketchInput): SketchOutput {
  const [c1, c2, c3] = s.palette;
  const hits: SketchOutput['hits'] = [];
  const area: Record<HeatLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const touch = s.report.touches ?? [];
  /** facets on the body's lower skin and how low that skin is there (mm): their red shows through the legs */
  const ghost: { pts: [XY, XY, XY]; y: number }[] = [];
  const fillPoly = (poly: readonly XY[]): void => {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };

  const heatOf = (slot: SlotId, pts: readonly XY[], edge: readonly XY[]): HeatLevel => {
    let lv: number = facetHeat((x, y) => heatAt(s.report.heat, x, y), pts, edge);
    const cx = (pts[0]![0] + pts[1]![0] + pts[2]![0]) / 3, cy = (pts[0]![1] + pts[1]![1] + pts[2]![1]) / 3;
    for (const t of touch) if ((t.a === slot || t.b === slot) && Math.hypot(cx - t.at[0], cy - t.at[1]) < 5) lv = HEAT.attention;
    return lv as HeatLevel;
  };

  const paletteBase = (kind: SlotKind): string =>
    kind === 'skin' ? c1 : kind === 'skinFar' ? mix(c1, '#000000', 0.3)
      : kind === 'accent' ? c2 : kind === 'accentFar' ? mix(c2, '#000000', 0.3)
        : kind === 'accentSoft' ? mix(c2, '#ffffff', 0.45) : c3;
  const picked = (id: SlotId, kind: SlotKind): string | null => (s.colors ? pickedColour(s.colors, id, kind) : null);


  // the lit element first: a bright outline round the whole part (drawn behind it, so only its rim shows outside the
  // outline and no line crosses its facets), with a thin dark edge so it reads on a light and a dark background
  if (s.hot) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const polysOfHot: XY[][] = [];
    for (const [id, kind] of SLOTS) {
      if (SKIP.has(id) || kind === 'clip' || kind === 'bone' || SLOT_TILE[id] !== s.hot) continue;
      if (id.startsWith('legOver') && !s.insect) continue;
      const path = s.paths[id];
      if (!path || path.empty) continue;
      polysOfHot.push(...path.flatten(8));
    }
    for (const [w, col] of [[9, 'rgba(15,23,42,.45)'], [6, '#ffffff']] as const) {
      ctx.lineWidth = w * px;
      ctx.strokeStyle = col;
      for (const poly of polysOfHot) { fillPoly(poly); ctx.stroke(); }
    }
    ctx.restore();
  }

  for (const [id, kind] of SLOTS) {
    if (SKIP.has(id) || kind === 'clip') continue;
    if (id.startsWith('legOver') && !s.insect) continue;
    const path = s.paths[id];
    if (!path || path.empty) continue;
    if (kind === 'bone') {
      if (!s.showBones) continue;
      ctx.save();
      ctx.setLineDash([4 * px, 4 * px]); ctx.lineWidth = 1.4 * px; ctx.strokeStyle = 'rgba(56,189,248,.7)';
      for (const poly of path.flatten(6)) { ctx.beginPath(); poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
      ctx.restore();
      continue;
    }
    if (kind === 'pattern' && s.mode === 'print') continue;
    const tile = SLOT_TILE[id] ?? null;
    const lit = !!tile && tile === s.hot;
    const polys = path.flatten(8);
    if (tile) hits.push({ slot: id, tile, polys });
    const far = FAR.includes(kind);

    const baseOf = (k: SlotKind): string => picked(id, k) ?? paletteBase(k);
    if (!FACETED.includes(kind)) {
      // details (eyes, mouth, teeth, claws) in flat colour
      const col = (s.mode === 'color' ? picked(id, kind) : null) ?? detailColour(kind, s.mode, c1, c2, c3);
      ctx.fillStyle = lit ? mix(col, '#ffffff', 0.15) : col;
      for (const poly of polys) { fillPoly(poly); ctx.fill(); }
      continue;
    }

    polys.forEach((poly, pi) => {
      const a = polyArea(poly);
      const salt = SLOTS.findIndex(([x]) => x === id) * 13 + pi;
      if (a < MIN_FACET_AREA) {
        ctx.fillStyle = s.mode === 'print' ? PRINT_PAL[HEAT.none][2]! : baseOf(kind);
        fillPoly(poly); ctx.fill();
        return;
      }
      const n = Math.max(12, Math.min(40, poly.length + (poly.length % 2)));
      const away: XY = id === 'torso' ? [s.torso[0] - 1000, s.torso[1]] : s.away;
      const facets = facetsOf(resample(poly, n, away), salt);
      ctx.save();
      fillPoly(poly);
      ctx.clip();
      // under the facets, for the bits of a concave outline the strip does not reach
      ctx.fillStyle = s.mode === 'print' ? PRINT_PAL[HEAT.none][1]! : mix(baseOf(kind), '#000000', 0.12);
      ctx.fill();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.6 * px;
      for (const f of facets) {
        let lum = 0.5 + 0.36 * f.light + (f.seed - 0.5) * 0.42;
        if (far) lum *= 0.6;
        if (lit) lum += 0.08;
        let col: string;
        if (s.mode === 'print') {
          const lv = toneOf(heatOf(id, f.pts, f.edge));
          const pal = PRINT_PAL[lv];
          if (GHOSTED.has(id) && (lv === HEAT.support || overhangs(f.pts, f.edge))) ghost.push({ pts: f.pts, y: Math.min(...(f.edge.length ? f.edge : f.pts).map((q) => q[1])) });
          col = pal[Math.max(0, Math.min(pal.length - 1, Math.floor(lum * pal.length)))]!;
          const [p, q, r] = f.pts;
          area[lv] += (Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2) * (far ? 0.4 : 1);
        } else {
          const base = baseOf(kind);
          col = lum >= 0.5 ? mix(base, '#ffffff', (lum - 0.5) * 0.75) : mix(base, '#000000', (0.5 - lum) * 0.9);
        }
        ctx.fillStyle = col; ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(...f.pts[0]); ctx.lineTo(...f.pts[1]); ctx.lineTo(...f.pts[2]); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    });
  }

  // the red under the body, faintly through the legs in front of it: a paler red, clipped to the legs
  if (ghost.length) {
    ctx.save();
    ctx.beginPath();
    for (const h of hits) if (isLimb(h.slot)) for (const poly of h.polys) poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.clip('nonzero');
    // strongest along the belly line, fading out upwards over GHOST_FADE mm
    for (const { pts: [a, b, c], y } of ghost) {
      const grad = ctx.createLinearGradient(0, y, 0, y + GHOST_FADE);
      grad.addColorStop(0, 'rgba(255,77,99,.72)');
      grad.addColorStop(1, 'rgba(255,77,99,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  return { hits, area };
}

/** The palette key a drawing kind stands for, where an element colour may replace it. */
const KIND_KEY: Partial<Record<SlotKind, ColorKey>> = {
  skin: 'c1', skinFar: 'c1', accent: 'c2', accentFar: 'c2', accentSoft: 'c2soft', pattern: 'c3', iris: 'c2soft',
  lid: 'c1dark', lip: 'c1dark', claw: 'c1dark',
};
/** How much darker than its element colour a kind is drawn (the palette's shades, see detailColour). */
const KIND_DARK: Partial<Record<SlotKind, number>> = { skinFar: 0.3, accentFar: 0.3, lid: 0.12, lip: 0.38, claw: 0.45 };

/** The colour picked for the element of slot `id`, in the shade of drawing kind `kind`; null = the palette's. */
export function pickedColour(colors: ElementColors, id: SlotId, kind: SlotKind): string | null {
  const key = KIND_KEY[kind];
  const ink = key ? inkOf(colors, id, key) : null;
  return ink && isHex(ink) ? mix(ink, '#000000', KIND_DARK[kind] ?? 0) : null;
}

function detailColour(kind: SlotKind, mode: SketchMode, c1: string, c2: string, c3: string): string {
  const ink = '#0b1220';
  if (mode === 'print') {
    switch (kind) {
      case 'white': return '#e0f2fe';
      case 'glint': return '#ffffff';
      case 'iris': return '#0369a1';
      case 'tongue': return '#7dd3fc';
      case 'lid': case 'lip': case 'claw': return '#0b3b63';
      case 'groove': case 'nostril': return '#082f49';
      default: return ink;
    }
  }
  switch (kind) {
    case 'white': return '#fbfbf8';
    case 'glint': return '#ffffff';
    case 'iris': return mix(c2, '#ffffff', 0.25);
    case 'tongue': return mix(c2, '#ffffff', 0.45);
    case 'lid': return mix(c1, '#000000', 0.12);
    case 'lip': return mix(c1, '#000000', 0.38);
    case 'claw': return mix(c1, '#000000', 0.45);
    case 'groove': return mix(c1, ink, 0.65);
    case 'nostril': return mix(c1, '#000000', 0.6);
    default: return mix(c3, ink, 0.4);
  }
}

/** One part of a turned view (front, top, or between two views), its outline already morphed. */
export interface ViewPartDraw {
  slot: SlotId;
  color: Ink;
  /** the outline resampled to an even count, index 0 = the cut's start */
  ring: XY[];
  /** smaller outlines of the same part, drawn flat */
  extra: XY[][];
  /** 0 = far from the viewer, 1 = nearest: far parts are darker */
  near: number;
  /** print heat of each facet (facetsOf order), worked out on the view it comes from */
  levels: readonly HeatLevel[];
  /** stable per part: the same facets in every view */
  salt: number;
}

export interface PartsInput {
  parts: ViewPartDraw[];
  mode: SketchMode;
  palette: readonly [string, string, string];
  hot: string | null;
}

/** The turned sketch: the parts back to front, cut into facets like the side view. */
export function drawParts(ctx: CanvasRenderingContext2D, px: number, s: PartsInput): SketchOutput {
  const [c1, c2, c3] = s.palette;
  const hits: SketchOutput['hits'] = [];
  const area: Record<HeatLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const path = (poly: readonly XY[]): void => {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  const baseOf = (k: Ink): string | null =>
    isHex(k) ? k : k === 'c1' ? c1 : k === 'c1dark' ? mix(c1, '#000000', 0.3) : k === 'c2' ? c2 : k === 'c2soft' ? mix(c2, '#ffffff', 0.45) : k === 'c3' ? c3 : null;

  if (s.hot) {
    ctx.save();
    ctx.lineJoin = 'round';
    for (const [w, col] of [[9, 'rgba(15,23,42,.45)'], [6, '#ffffff']] as const) {
      ctx.lineWidth = w * px;
      ctx.strokeStyle = col;
      for (const p of s.parts) if (SLOT_TILE[p.slot] === s.hot) for (const r of [p.ring, ...p.extra]) { path(r); ctx.stroke(); }
    }
    ctx.restore();
  }

  for (const p of s.parts) {
    const tile = SLOT_TILE[p.slot] ?? null;
    const lit = !!tile && tile === s.hot;
    if (tile) hits.push({ slot: p.slot, tile, polys: [p.ring, ...p.extra] });
    const base = baseOf(p.color);
    const shade = 0.62 + 0.38 * p.near;
    const flat = (): string => {
      if (!base) return p.color === 'white' ? (s.mode === 'print' ? '#e0f2fe' : '#fbfbf8') : '#0b1220';
      return s.mode === 'print' ? PRINT_PAL[HEAT.none][2]! : base;
    };
    for (const r of p.extra) { ctx.fillStyle = flat(); path(r); ctx.fill(); }
    if (!base || polyArea(p.ring) < MIN_FACET_AREA) {
      ctx.fillStyle = lit ? mix(flat(), '#ffffff', 0.15) : flat();
      path(p.ring); ctx.fill();
      continue;
    }
    const facets = facetsOf(p.ring, p.salt);
    ctx.save();
    path(p.ring);
    ctx.clip();
    ctx.fillStyle = s.mode === 'print' ? PRINT_PAL[HEAT.none][1]! : mix(base, '#000000', 0.12);
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.6 * px;
    facets.forEach((f, fi) => {
      let lum = (0.5 + 0.36 * f.light + (f.seed - 0.5) * 0.42) * shade;
      if (lit) lum += 0.08;
      let col: string;
      const [a, b, c] = f.pts;
      if (s.mode === 'print') {
        const lv = toneOf(p.levels[fi] ?? HEAT.none);
        const pal = PRINT_PAL[lv];
        col = pal[Math.max(0, Math.min(pal.length - 1, Math.floor(lum * pal.length)))]!;
        area[lv] += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      } else {
        col = lum >= 0.5 ? mix(base, '#ffffff', (lum - 0.5) * 0.75) : mix(base, '#000000', (0.5 - lum) * 0.9);
      }
      ctx.fillStyle = col; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath();
      ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  }
  return { hits, area };
}
