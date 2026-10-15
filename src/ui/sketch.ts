/**
 * The side view drawn like the Morphoid logo: every part cut into flat facets lit from the upper front.
 * Two colourings:
 *   'color'  the creature's own colours (body c1, accents c2, pattern c3), facet by facet a shade lighter or darker;
 *   'print'  what the print audit found under each facet: blue prints as is, violet gets slicer supports, red needs
 *            attention (too thin, floating, parts grown into each other), steel stands on the bed.
 * No markers: the colour of the facet is the message.
 */
import { SLOTS, type SlotId, type SlotKind, type SlotPaths } from '../core/art/shapes';
import { facetsOf, resample } from '../core/art/facets';
import type { XY } from '../core/art/path';
import { HEAT, heatAt, type HeatLevel, type PrintReport } from '../core/print';
import { SLOT_TILE } from './tiles';

export type SketchMode = 'color' | 'print';

/** dark -> light */
const PRINT_PAL: Record<HeatLevel, readonly string[]> = {
  [HEAT.none]: ['#0b3b63', '#0369a1', '#0284c7', '#38bdf8', '#7dd3fc'],
  [HEAT.bed]: ['#1e293b', '#334155', '#3f2a33', '#475569'],
  [HEAT.support]: ['#3b1a78', '#5b21b6', '#6d28d9', '#8b5cf6', '#a78bfa'],
  [HEAT.attention]: ['#4c1010', '#7f1d1d', '#991b1b', '#b91c1c', '#ff1744'],
};
/** one colour per level for legends and the info line */
export const HEAT_SWATCH: Record<HeatLevel, string> = { [HEAT.none]: '#0284c7', [HEAT.bed]: '#475569', [HEAT.support]: '#7c3aed', [HEAT.attention]: '#e11d48' };
export const HEAT_NAME: Record<HeatLevel, string> = { [HEAT.none]: 'Drukuje się dobrze', [HEAT.bed]: 'Leży na stole', [HEAT.support]: 'Podpory ze slicera', [HEAT.attention]: 'Wymaga uwagi' };

const FACETED: readonly SlotKind[] = ['skin', 'skinFar', 'accent', 'accentFar', 'accentSoft', 'pattern'];
const FAR: readonly SlotKind[] = ['skinFar', 'accentFar'];
/** drawn but not cut: only the look, no print meaning */
const SKIP = new Set<string>(['shadow', 'torsoClip', 'belly', 'coat', 'coatLegs', 'coatOn', 'coatLegB', 'coatLegF', 'relief', 'blush']);
/** smaller than this (mm²) a part is a detail: one flat colour */
const MIN_FACET_AREA = 6;

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

export interface SketchInput {
  paths: SlotPaths;
  mode: SketchMode;
  palette: readonly [string, string, string];
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
  const fillPoly = (poly: readonly XY[]): void => {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };

  const heatOf = (slot: SlotId, pts: readonly XY[], edge: readonly XY[]): HeatLevel => {
    const cx = (pts[0]![0] + pts[1]![0] + pts[2]![0]) / 3, cy = (pts[0]![1] + pts[1]![1] + pts[2]![1]) / 3;
    let lv = heatAt(s.report.heat, cx, cy) as number;
    for (const [x, y] of edge) {
      // just inside the outline, where the audit's raster has the cell
      const nx = x + (cx - x) * 0.25, ny = y + (cy - y) * 0.25;
      lv = Math.max(lv, heatAt(s.report.heat, nx, ny));
    }
    for (const t of touch) if ((t.a === slot || t.b === slot) && Math.hypot(cx - t.at[0], cy - t.at[1]) < 5) lv = HEAT.attention;
    return lv as HeatLevel;
  };

  const baseOf = (kind: SlotKind): string =>
    kind === 'skin' ? c1 : kind === 'skinFar' ? mix(c1, '#000000', 0.3)
      : kind === 'accent' ? c2 : kind === 'accentFar' ? mix(c2, '#000000', 0.3)
        : kind === 'accentSoft' ? mix(c2, '#ffffff', 0.45) : c3;


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

    if (!FACETED.includes(kind)) {
      // details (eyes, mouth, teeth, claws) in flat colour
      const col = detailColour(kind, s.mode, c1, c2, c3);
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
          const lv = heatOf(id, f.pts, f.edge);
          const pal = PRINT_PAL[lv];
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

  return { hits, area };
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
