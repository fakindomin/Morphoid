/**
 * Printability audit. The 2D outlines ARE the print profiles, so each *piece*
 * (the body, plus every part the user chose to print separately) is rasterised
 * in rig millimetres and tested layer by layer, bed (y = 0) upwards:
 *   OVERHANG  a layer sticks out beyond what the layers below carry (> ~45 deg)
 *   BRIDGE    unsupported span anchored on both sides longer than the plan's limit
 *   FLOATING  material that never reaches the bed or the rest of the piece
 *   THIN      material thinner than minFeature that is more than a sharp tip
 *   SLIT      a gap narrower than ~0.9 mm inside the shape (cannot be printed, it fuses or leaves a hairline void)
 *   PEG       a separate part too small to carry a mounting peg
 *   SOLE      too little flat area under the feet
 *   BALANCE   the finished figurine would tip over: its centre of mass is not above the soles (or the stand)
 * Severity: error = will not print as planned; warn = prints with care / minor supports.
 */
import type { Rig } from '../rig';
import { WHISKER_PAD, type SlotId, type SlotPaths } from '../art/shapes';
import type { XY } from '../art/path';
import { PRINT_SOLID_SLOTS, SLOT_NAME_PL } from './catalog';
import { GROUPS, PRINTERS, groupOfSlot, isSeparate, type GroupDef, type PartGroup, type PrintPlan } from './plan';
import { PRINT_RULES as R } from './rules';
import { balanceOf } from './balance';

export type PrintIssueCode = 'OVERHANG' | 'BRIDGE' | 'FLOATING' | 'THIN' | 'SLIT' | 'PEG' | 'SOLE' | 'BED' | 'BALANCE';
export type Severity = 'info' | 'support' | 'warn' | 'error';

export interface PrintIssue {
  code: PrintIssueCode;
  severity: Severity;
  piece: string;
  part: string;
  slot: SlotId | null;
  /** group the user could print separately to get rid of this issue (null: nothing to split) */
  fix: PartGroup | null;
  /** group that is separate but too small for a peg: advise fusing it back to the body */
  fuse?: PartGroup;
  at: [number, number];
  size: number;
  /** for OVERHANG / BRIDGE: side-view area (mm^2) of the supports needed under this part */
  area?: number;
  message: string;
}

export interface PieceInfo {
  id: string;
  label: string;
  kind: 'body' | 'part';
  orientation: 'upright' | 'flat';
  peg: '3x3x5' | '5x5x8' | null;
  size: [number, number];
}

export interface PrintReport {
  /** no errors (warnings are allowed) */
  ok: boolean;
  /** green: prints as is; blue: needs supports (allowed); yellow: care needed; red: will not print as planned */
  level: 'green' | 'blue' | 'yellow' | 'red';
  issues: PrintIssue[];
  pieces: PieceInfo[];
  /** total side-view area (mm^2) that would need supports: the number to compare before/after a change */
  supportArea: number;
}

const CELL = 0.3;
const LOOK = 6;
const WINDOW = Math.round(LOOK * Math.tan((R.maxOverhangDeg * Math.PI) / 180));
const TOL_CELLS = 2;
const R_OPEN = Math.round(R.minFeature / 2 / CELL);
// A square peg of side s needs a root at least s + 0.8 mm wide (one 0.4 mm line each side).
const RASTER_TOL = 0.4; // mm: raster resolution noise on measured widths
const PEG_R = { small: (3 + 0.8) / 2, big: (5 + 0.8) / 2 };

interface Grid { w: number; h: number; x0: number; y0: number; occ: Uint8Array; owner: Uint8Array }

function fillPolygon(g: Grid, poly: readonly (readonly [number, number])[], ownerId: number): void {
  let ymin = Infinity, ymax = -Infinity;
  for (const [, y] of poly) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  const j0 = Math.max(0, Math.floor((ymin - g.y0) / CELL)), j1 = Math.min(g.h - 1, Math.ceil((ymax - g.y0) / CELL));
  // non-zero winding, like the SVG fill of the 2D drawing (a self-overlapping outline stays solid)
  const xs: [number, number][] = [];
  for (let j = j0; j <= j1; j++) {
    const y = g.y0 + (j + 0.5) * CELL;
    xs.length = 0;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!, b = poly[(k + 1) % poly.length]!;
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push([a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), b[1] > a[1] ? 1 : -1]);
    }
    xs.sort((p, q) => p[0] - q[0]);
    let wn = 0;
    for (let k = 0; k + 1 < xs.length; k++) {
      wn += xs[k]![1];
      if (!wn) continue;
      const i0 = Math.max(0, Math.ceil((xs[k]![0] - g.x0) / CELL - 0.5));
      const i1 = Math.min(g.w - 1, Math.floor((xs[k + 1]![0] - g.x0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) { g.occ[j * g.w + i] = 1; g.owner[j * g.w + i] = ownerId; }
    }
  }
}

/** Largest inscribed circle radius (mm) via a two-pass chamfer distance transform. */
function maxInscribed(g: Grid): number {
  const { w, h } = g;
  const INF = 1e9, d = new Float32Array(w * h);
  for (let s = 0; s < w * h; s++) d[s] = g.occ[s] ? INF : 0;
  const D1 = 1, D2 = 1.4142;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const s = j * w + i; if (!d[s]) continue;
    let v = d[s]!;
    if (i > 0) v = Math.min(v, d[s - 1]! + D1);
    if (j > 0) { v = Math.min(v, d[s - w]! + D1); if (i > 0) v = Math.min(v, d[s - w - 1]! + D2); if (i < w - 1) v = Math.min(v, d[s - w + 1]! + D2); }
    if (i === 0 || j === 0 || i === w - 1 || j === h - 1) v = Math.min(v, 1);
    d[s] = v;
  }
  let best = 0;
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const s = j * w + i; if (!d[s]) continue;
    let v = d[s]!;
    if (i < w - 1) v = Math.min(v, d[s + 1]! + D1);
    if (j < h - 1) { v = Math.min(v, d[s + w]! + D1); if (i < w - 1) v = Math.min(v, d[s + w + 1]! + D2); if (i > 0) v = Math.min(v, d[s + w - 1]! + D2); }
    d[s] = v; best = Math.max(best, v);
  }
  return (best - 0.5) * CELL;
}

/** Which group a fused slot rides along with when that group is printed separately (crest: only tuft + mane sit on the head). */
function hostOf(slot: SlotId, g: GroupDef | undefined): PartGroup | undefined {
  if (g?.id === 'crest') return slot === 'tuft' || slot === 'mane' ? 'head' : undefined;
  return g?.host;
}

const FACE_RELIEF: readonly SlotId[] = ['eye', 'pupil', 'iris', 'lids', 'lips', 'nostrils', 'brow', 'mouth', 'maw', 'tongue', 'teeth', 'nose'];

/** Which printed piece a slot belongs to under a plan: its own group, its host, or the body. */
export function pieceOf(slot: SlotId, plan: PrintPlan): PartGroup | 'body' {
  const g = groupOfSlot(slot);
  if (g && isSeparate(plan, g.id)) return g.id;
  const host = hostOf(slot, g);
  if (host && isSeparate(plan, host)) return host;
  if (FACE_RELIEF.includes(slot) && isSeparate(plan, 'head')) return 'head';
  return 'body';
}

interface PieceSpec { id: string; label: string; kind: 'body' | 'part'; orientation: 'upright' | 'flat'; slots: SlotId[]; clipY?: number }

/**
 * The preview draws the whiskers' root as a small dot; the printed set gets a pad there (see buildParts3D `print`) that
 * seats it in the muzzle and carries its peg. The audit checks what is printed, so it adds the pad back.
 */
function withWhiskerPad(polys: XY[][]): XY[][] {
  const root = polys[0];
  if (!root) return polys;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of root) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, pad: XY[] = [];
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; pad.push([cx + Math.cos(a) * WHISKER_PAD[0], cy + Math.sin(a) * 1.6]); }
  return [pad, ...polys.slice(1)];
}

export function analyzePrint(paths: SlotPaths, rig: Rig, plan: PrintPlan): PrintReport {
  const issues: PrintIssue[] = [];
  const pieces: PieceInfo[] = [];
  const printer = PRINTERS[plan.printer] ?? PRINTERS.p1s!;
  const sep = (g: PartGroup): boolean => isSeparate(plan, g);

  // ---- assign every solid slot to exactly one piece -----------------------------------
  const specs = new Map<string, PieceSpec>();
  const spec = (id: string, label: string, kind: 'body' | 'part', orientation: 'upright' | 'flat', clipY?: number): PieceSpec => {
    let s = specs.get(id);
    if (!s) { s = { id, label, kind, orientation, slots: [], ...(clipY !== undefined ? { clipY } : {}) }; specs.set(id, s); }
    return s;
  };
  const allSlots: SlotId[] = [...PRINT_SOLID_SLOTS, 'whiskers'];
  for (const slot of allSlots) {
    if (!paths[slot] || paths[slot].empty) continue;
    const gdef: GroupDef | undefined = groupOfSlot(slot);
    if (gdef && sep(gdef.id)) { spec(gdef.id, gdef.label, 'part', gdef.orientation, gdef.id === 'head' ? rig.nodes.neckBase.y : undefined).slots.push(slot); continue; }
    // fused group whose host is a separate part rides along with the host
    const hostId = hostOf(slot, gdef);
    if (hostId && sep(hostId)) {
      const host = GROUPS.find((x) => x.id === hostId)!;
      spec(host.id, host.label, 'part', host.orientation, host.id === 'head' ? rig.nodes.neckBase.y : undefined).slots.push(slot);
      continue;
    }
    spec('body', 'Korpus', 'body', 'upright').slots.push(slot);
  }

  for (const s of specs.values()) analyzePiece(s);

  // ---- feet ---------------------------------------------------------------------------
  const legsFused = !sep('legs');
  if (legsFused && rig.dims.soleLength * rig.dims.soleWidth < R.minSoleArea) {
    issues.push({ code: 'SOLE', severity: 'error', piece: 'body', part: 'stopy', slot: null, fix: null, at: [0, 0], size: 0, message: 'Stopy: zbyt mała płaska podeszwa' });
  }
  // ---- will it stand? ------------------------------------------------------------------
  const bal = balanceOf(paths, rig);
  if (bal.outside > 0) {
    const where = bal.com > bal.support[1] ? 'do przodu' : 'do tyłu';
    issues.push({ code: 'BALANCE', severity: 'warn', piece: 'body', part: 'stopy', slot: null, fix: null, at: [bal.com, 0], size: bal.outside,
      message: `Figurka przewróci się ${where}: środek ciężkości jest ${bal.outside.toFixed(1).replace('.', ',')} mm poza ${paths.stand.empty ? 'stopami' : 'podstawką'}. Dodaj podstawkę albo zmień proporcje.` });
  }
  const errors = issues.some((i) => i.severity === 'error');
  const warns = issues.some((i) => i.severity === 'warn');
  const supports = issues.some((i) => i.severity === 'support');
  const supportArea = issues.reduce((sum, i) => sum + (i.code === 'OVERHANG' || i.code === 'BRIDGE' ? (i.area ?? 0) : 0), 0);
  return { ok: !errors, level: errors ? 'red' : warns ? 'yellow' : supports ? 'blue' : 'green', issues, pieces, supportArea };

  // ---------------------------------------------------------------------------------------
  function analyzePiece(s: PieceSpec): void {
    const solids = s.slots.map((id) => ({ id, polys: id === 'whiskers' ? withWhiskerPad(paths[id].flatten(8)) : paths[id].flatten(8) })).filter((x) => x.polys.length);
    if (!solids.length) return;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const o of solids) for (const poly of o.polys) for (const [x, y] of poly) {
      xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    }
    const y0raw = s.clipY !== undefined ? Math.max(ymin, s.clipY) : Math.max(0, ymin);
    const y0 = Math.floor(y0raw / CELL) * CELL;      // grid phase is fixed in space so areas of two states compare cleanly
    const pad = 2, x0 = Math.floor((xmin - pad) / CELL) * CELL;
    const w = Math.ceil((xmax + pad - x0) / CELL), h = Math.max(2, Math.ceil((ymax - y0 + pad) / CELL));
    const grid: Grid = { w, h, x0, y0, occ: new Uint8Array(w * h), owner: new Uint8Array(w * h) };
    solids.forEach((o, idx) => o.polys.forEach((poly) => fillPolygon(grid, poly, idx + 1)));
    const at = (i: number, j: number): [number, number] => [x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL];
    const slotAt = (i: number, j: number): SlotId | null => { const o = grid.owner[j * w + i]!; return o > 0 ? solids[o - 1]!.id : null; };
    const worst = new Map<string, PrintIssue>();
    const report = (code: PrintIssueCode, severity: Severity, i: number, j: number, size: number, text: (part: string) => string, area = 0): void => {
      const slot = slotAt(i, j);
      const part = slot ? SLOT_NAME_PL[slot] : s.label.toLowerCase();
      const gdef = slot ? groupOfSlot(slot) : undefined;
      const fix = gdef && !sep(gdef.id) && !gdef.forced ? gdef.id : null;
      const key = `${code}:${part}`;
      const prev = worst.get(key);
      const total = (prev?.area ?? 0) + area;
      if (!prev || size > prev.size) worst.set(key, { code, severity, piece: s.id, part, slot, fix, at: at(i, j), size, area: total, message: text(part) });
      else prev.area = total;
    };

    const sizeMm: [number, number] = [xmax - xmin, ymax - y0];
    if (Math.max(...sizeMm) > Math.min(printer.bed[0], printer.bed[2])) {
      issues.push({ code: 'BED', severity: 'error', piece: s.id, part: s.label, slot: null, fix: null, at: [xmin, ymin], size: Math.max(...sizeMm), message: `${s.label}: nie mieści się na stole ${printer.name}` });
    }

    if (s.orientation === 'upright') {
      const prefix = new Int32Array(w + 1);
      const sup = new Uint8Array(w * h);
      // air[j][i] = empty cells directly below (j, i) down to the bed or the next solid: the height of a support column
      const air = new Int32Array(w * h);
      for (let j = 1; j < h; j++) for (let i = 0; i < w; i++) air[j * w + i] = grid.occ[(j - 1) * w + i] ? 0 : air[(j - 1) * w + i]! + 1;
      const columnArea = (j: number, a: number, b: number): number => {
        let sum = 0;
        for (let k = a; k <= b; k++) sum += air[j * w + k]!;
        return sum * CELL * CELL;
      };
      for (let j = 0; j < h; j++) {
        if (j < LOOK) { for (let i = 0; i < w; i++) sup[j * w + i] = 1; continue; }
        const below = (j - LOOK) * w;
        for (let i = 0; i < w; i++) prefix[i + 1] = prefix[i]! + grid.occ[below + i]!;
        for (let i = 0; i < w; i++) {
          const a = Math.max(0, i - WINDOW), b = Math.min(w, i + WINDOW + 1);
          sup[j * w + i] = prefix[b]! - prefix[a]! > 0 ? 1 : 0;
        }
      }
      for (let j = LOOK; j < h; j++) {
        let i = 0;
        while (i < w) {
          if (!grid.occ[j * w + i]) { i++; continue; }
          let e = i; while (e + 1 < w && grid.occ[j * w + e + 1]) e++;
          let a = i;
          while (a <= e) {
            if (sup[j * w + a]) { a++; continue; }
            let b = a; while (b + 1 <= e && !sup[j * w + b + 1]) b++;
            const len = b - a + 1, mm = len * CELL, mid = (a + b) >> 1;
            const left = a > i && sup[j * w + a - 1] === 1, right = b < e && sup[j * w + b + 1] === 1;
            if (left && right) {
              if (mm > plan.maxBridge) {
                if (plan.supports === 'allowed') report('BRIDGE', 'support', mid, j, mm, (p) => `${p}: podpory pod spodem (rozpiętość ${mm.toFixed(0)} mm)`, columnArea(j, a, b));
                else report('BRIDGE', mm > plan.maxBridge * 2 ? 'error' : 'warn', mid, j, mm,
                  (p) => `${p}: wisi nad pustką na ${mm.toFixed(0)} mm (most do ${plan.maxBridge} mm)`, columnArea(j, a, b));
              }
            } else if (len > TOL_CELLS && mm > 2.5) {
              if (plan.supports === 'allowed') report('OVERHANG', 'support', mid, j, mm, (p) => `${p}: potrzebne podpory (nawis ~${mm.toFixed(0)} mm)`, columnArea(j, a, b));
              else report('OVERHANG', mm > 4 ? 'error' : 'warn', mid, j, mm,
                (p) => `${p}: nawis ostrzejszy niż ${R.maxOverhangDeg}° (~${mm.toFixed(1)} mm bez podparcia)`, columnArea(j, a, b));
            }
            a = b + 1;
          }
          i = e + 1;
        }
      }
      // floating islands
      const comp = new Int32Array(w * h);
      const stack: number[] = [];
      let nc = 0;
      for (let q = 0; q < w * h; q++) {
        if (!grid.occ[q] || comp[q]) continue;
        nc++; let bed = false, count = 0, sx = 0, sy = 0;
        stack.push(q); comp[q] = nc;
        while (stack.length) {
          const c = stack.pop()!; const cj = (c / w) | 0, ci = c - cj * w;
          count++; sx += ci; sy += cj; if (cj < 2) bed = true;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
            const n = nj * w + ni;
            if (grid.occ[n] && !comp[n]) { comp[n] = nc; stack.push(n); }
          }
        }
        if (!bed && count * CELL * CELL > 3) report('FLOATING', 'error', Math.round(sx / count), Math.round(sy / count), count * CELL * CELL, (p) => `${p}: element nie łączy się ze stołem ani z resztą modelu`);
      }
    }

    // thin features: opening with a disk of radius minFeature / 2
    const disk: [number, number][] = [];
    for (let dj = -R_OPEN; dj <= R_OPEN; dj++) for (let di = -R_OPEN; di <= R_OPEN; di++) if (di * di + dj * dj <= R_OPEN * R_OPEN) disk.push([di, dj]);
    const eroded = new Uint8Array(w * h), opened = new Uint8Array(w * h);
    for (let j = R_OPEN; j < h - R_OPEN; j++) for (let i = R_OPEN; i < w - R_OPEN; i++) {
      if (!grid.occ[j * w + i]) continue;
      let all = 1;
      for (const [di, dj] of disk) if (!grid.occ[(j + dj) * w + i + di]) { all = 0; break; }
      eroded[j * w + i] = all;
    }
    for (let j = R_OPEN; j < h - R_OPEN; j++) for (let i = R_OPEN; i < w - R_OPEN; i++) {
      if (!eroded[j * w + i]) continue;
      for (const [di, dj] of disk) opened[(j + dj) * w + i + di] = 1;
    }
    const seen = new Uint8Array(w * h), stack2: number[] = [];
    for (let q = 0; q < w * h; q++) {
      if (!grid.occ[q] || opened[q] || seen[q]) continue;
      let count = 0, sx = 0, sy = 0; stack2.push(q); seen[q] = 1;
      while (stack2.length) {
        const c = stack2.pop()!; const cj = (c / w) | 0, ci = c - cj * w;
        count++; sx += ci; sy += cj;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          const n = nj * w + ni;
          if (grid.occ[n] && !opened[n] && !seen[n]) { seen[n] = 1; stack2.push(n); }
        }
      }
      const area = count * CELL * CELL;
      if (area > R.tipTolerance) report('THIN', 'error', Math.round(sx / count), Math.round(sy / count), area, (p) => `${p}: zbyt cienki fragment (< ${R.minFeature} mm, ${area.toFixed(0)} mm²)`);
    }

    // slits: closing the shape with a 3 x 3 element fills every gap narrower than ~0.9 mm; what it adds is a slit
    {
      const dil = new Uint8Array(w * h), closed = new Uint8Array(w * h);
      for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
        let any = 0;
        for (let dj = -1; dj <= 1 && !any; dj++) for (let di = -1; di <= 1; di++) if (grid.occ[(j + dj) * w + i + di]) { any = 1; break; }
        dil[j * w + i] = any;
      }
      for (let j = 2; j < h - 2; j++) for (let i = 2; i < w - 2; i++) {
        let all = 1;
        for (let dj = -1; dj <= 1 && all; dj++) for (let di = -1; di <= 1; di++) if (!dil[(j + dj) * w + i + di]) { all = 0; break; }
        closed[j * w + i] = all;
      }
      const seenS = new Uint8Array(w * h), st: number[] = [];
      for (let q = 0; q < w * h; q++) {
        if (!closed[q] || grid.occ[q] || seenS[q]) continue;
        let count = 0, sx = 0, sy = 0;
        st.push(q); seenS[q] = 1;
        while (st.length) {
          const c = st.pop()!; const cj = (c / w) | 0, ci = c - cj * w;
          count++; sx += ci; sy += cj;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const ni = ci + di, nj = cj + dj, n = nj * w + ni;
            if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
            if (closed[n] && !grid.occ[n] && !seenS[n]) { seenS[n] = 1; st.push(n); }
          }
        }
        const area = count * CELL * CELL;
        if (area > 1.0) {
          const ci = Math.round(sx / count), cj = Math.round(sy / count);
          let owner = 0;
          for (let r = 1; r <= 4 && !owner; r++) for (let dj = -r; dj <= r && !owner; dj++) for (let di = -r; di <= r; di++) {
            const ni = ci + di, nj = cj + dj;
            if (ni >= 0 && nj >= 0 && ni < w && nj < h && grid.occ[nj * w + ni]) { owner = grid.owner[nj * w + ni]!; break; }
          }
          const slot = owner > 0 ? solids[owner - 1]!.id : null;
          const part = slot ? SLOT_NAME_PL[slot] : s.label.toLowerCase();
          const key = `SLIT:${part}`;
          const prev = worst.get(key);
          if (!prev || area > prev.size) worst.set(key, { code: 'SLIT', severity: 'info', piece: s.id, part, slot, fix: null, at: at(ci, cj), size: area, message: `${part}: wąska szczelina (${area.toFixed(1)} mm², węższa niż 0,9 mm) zostanie zlana przy przygotowaniu bryły` });
        }
      }
    }

    // mounting peg for separate parts
    let peg: PieceInfo['peg'] = null;
    if (s.kind === 'part') {
      const r = maxInscribed(grid);
      const d = r * 2;
      if (d >= PEG_R.big * 2 - RASTER_TOL) peg = '5x5x8';
      else if (d >= PEG_R.small * 2 - RASTER_TOL) peg = '3x3x5';
      else if (d >= 2.4) {
        peg = '3x3x5';
        issues.push({ code: 'PEG', severity: 'info', piece: s.id, part: s.label, slot: null, fix: null, at: [xmin, ymin], size: d,
          message: `${s.label}: bardzo drobne (${d.toFixed(1)} mm). Czop 3×3 siedzi w korzeniu ukrytym w korpusie.` });
      } else {
        issues.push({ code: 'PEG', severity: 'error', piece: s.id, part: s.label, slot: null, fix: null, fuse: s.id as PartGroup, at: [xmin, ymin], size: d,
          message: `${s.label}: zbyt drobne na czop montażowy (${d.toFixed(1)} mm). Zostaw przy korpusie.` });
      }
    }
    issues.push(...worst.values());
    pieces.push({ id: s.id, label: s.label, kind: s.kind, orientation: s.orientation, peg, size: [Math.round(sizeMm[0]), Math.round(sizeMm[1])] });
  }
}

/**
 * Applies a plan, then fuses back every separate part that is too small to carry a peg
 * (a "split everything" preset must not fail on a 2 mm ear).
 */
export function fitPlan(paths: SlotPaths, rig: Rig, plan: PrintPlan): PrintPlan {
  let cur = plan;
  for (let i = 0; i < 4; i++) {
    const rep = analyzePrint(paths, rig, cur);
    const fuse = rep.issues.filter((x) => x.code === 'PEG' && x.fuse && !isForced(x.fuse)).map((x) => x.fuse!);
    if (!fuse.length) return cur;
    cur = { ...cur, separate: cur.separate.filter((g) => !fuse.includes(g)) };
  }
  return cur;
}
const isForced = (g: PartGroup): boolean => GROUPS.some((x) => x.id === g && x.forced);
