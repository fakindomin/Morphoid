/**
 * Support-free printability audit of the side silhouette.
 *
 * The 2D outlines ARE the print profiles (every solid part is the extrusion /
 * sweep of its outline), so we rasterise the union of all additive parts in
 * rig millimetres and test it layer by layer, bottom (bed, y = 0) to top:
 *   OVERHANG   a layer sticks out beyond what the layers below can carry (> ~45 deg)
 *   BRIDGE     an unsupported span anchored on both sides is longer than maxBridge
 *   FLOATING   a piece of the model that never touches the bed or the rest
 *   THIN       material thinner than minFeature that is more than a sharp tip
 *   SOLE       too little flat area on the bed
 */
import type { Rig } from '../rig';
import type { SlotId, SlotPaths } from '../art/shapes';
import { PRINT_SOLID_SLOTS, SLOT_NAME_PL } from './catalog';
import { PRINT_RULES as R } from './rules';

export type PrintIssueCode = 'OVERHANG' | 'BRIDGE' | 'FLOATING' | 'THIN' | 'SOLE';

export interface PrintIssue {
  code: PrintIssueCode;
  part: string;           // Polish name of the offending part
  slot: SlotId | null;
  /** rig mm (x forward, y up) - where to point the user */
  at: [number, number];
  /** mm (length) or mm^2 (area) */
  size: number;
  message: string;
}

export interface PrintReport { ok: boolean; issues: PrintIssue[] }

const CELL = 0.3;
const LOOK = 6;                       // layers of look-back: 6 * 0.3 mm = 1.8 mm => slope averaged over 1.8 mm
const WINDOW = Math.round(LOOK * Math.tan((R.maxOverhangDeg * Math.PI) / 180)); // allowed shift (cells)
const TOL_CELLS = 2;                  // raster noise tolerance for a one-sided overhang segment
const R_OPEN = Math.round(R.minFeature / 2 / CELL);

interface Grid { w: number; h: number; x0: number; occ: Uint8Array; owner: Uint8Array }

function fillPolygon(g: Grid, poly: readonly (readonly [number, number])[], ownerId: number): void {
  let ymin = Infinity, ymax = -Infinity;
  for (const [, y] of poly) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  const j0 = Math.max(0, Math.floor(ymin / CELL)), j1 = Math.min(g.h - 1, Math.ceil(ymax / CELL));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = (j + 0.5) * CELL;
    xs.length = 0;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]!, b = poly[(k + 1) % poly.length]!;
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k]! - g.x0) / CELL - 0.5));
      const i1 = Math.min(g.w - 1, Math.floor((xs[k + 1]! - g.x0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) { g.occ[j * g.w + i] = 1; g.owner[j * g.w + i] = ownerId; }
    }
  }
}

export function analyzePrint(paths: SlotPaths, rig: Rig): PrintReport {
  const solids = PRINT_SOLID_SLOTS.map((id) => ({ id, polys: paths[id].flatten(8) })).filter((s) => s.polys.length);
  let xmin = Infinity, xmax = -Infinity, ymax = 0;
  for (const s of solids) for (const poly of s.polys) for (const [x, y] of poly) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y);
  }
  const issues: PrintIssue[] = [];
  if (!solids.length) return { ok: true, issues };
  const pad = 2;
  const x0 = xmin - pad;
  const w = Math.ceil((xmax + pad - x0) / CELL), h = Math.ceil((ymax + pad) / CELL);
  const grid: Grid = { w, h, x0, occ: new Uint8Array(w * h), owner: new Uint8Array(w * h) };
  solids.forEach((s, idx) => s.polys.forEach((poly) => fillPolygon(grid, poly, idx + 1)));
  const slotOf = (o: number): SlotId | null => (o > 0 ? solids[o - 1]!.id : null);
  const at = (i: number, j: number): [number, number] => [x0 + (i + 0.5) * CELL, (j + 0.5) * CELL];

  const worst = new Map<string, PrintIssue>();
  const report = (code: PrintIssueCode, i: number, j: number, size: number, text: (part: string) => string): void => {
    const slot = slotOf(grid.owner[j * w + i]!);
    const part = slot ? SLOT_NAME_PL[slot] : 'bryła';
    const key = `${code}:${part}`;
    const prev = worst.get(key);
    if (!prev || size > prev.size) worst.set(key, { code, part, slot, at: at(i, j), size, message: text(part) });
  };

  // ---- layer-by-layer support ------------------------------------------------
  // supported[j][i] = a cell within +-WINDOW of (i) exists LOOK layers below (bed counts for the first layers)
  const prefix = new Int32Array(w + 1);
  const sup = new Uint8Array(w * h);
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
      let e = i; while (e + 1 < w && grid.occ[j * w + e + 1]) e++;           // occupied run [i..e]
      let a = i;
      while (a <= e) {
        if (sup[j * w + a]) { a++; continue; }
        let b = a; while (b + 1 <= e && !sup[j * w + b + 1]) b++;           // unsupported segment [a..b]
        const len = b - a + 1;
        const leftAnch = a > i && sup[j * w + a - 1] === 1, rightAnch = b < e && sup[j * w + b + 1] === 1;
        const mid = (a + b) >> 1;
        if (leftAnch && rightAnch) {
          if (len * CELL > R.maxBridge) {
            report('BRIDGE', mid, j, len * CELL, (p) => `${p}: wisi nad pustką na ${(len * CELL).toFixed(0)} mm (limit mostu ${R.maxBridge} mm)`);
          }
        } else if (len > TOL_CELLS) {
          report('OVERHANG', mid, j, len * CELL, (p) => `${p}: nawis ostrzejszy niż ${R.maxOverhangDeg}° (wystaje ~${(len * CELL).toFixed(1)} mm bez podparcia)`);
        }
        a = b + 1;
      }
      i = e + 1;
    }
  }

  // ---- floating pieces (4-connected components that never reach the bed) -------
  const comp = new Int32Array(w * h);
  let nc = 0;
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!grid.occ[s] || comp[s]) continue;
    nc++; let touchesBed = false, count = 0, sx = 0, sy = 0;
    stack.push(s); comp[s] = nc;
    while (stack.length) {
      const c = stack.pop()!; const cj = (c / w) | 0, ci = c - cj * w;
      count++; sx += ci; sy += cj; if (cj < 2) touchesBed = true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const n = nj * w + ni;
        if (grid.occ[n] && !comp[n]) { comp[n] = nc; stack.push(n); }
      }
    }
    if (!touchesBed && count * CELL * CELL > 3) report('FLOATING', Math.round(sx / count), Math.round(sy / count), count * CELL * CELL, (p) => `${p}: element nie łączy się ze stołem ani z resztą modelu`);
  }

  // ---- thin features: morphological opening with a disk of radius minFeature/2 ---
  const eroded = new Uint8Array(w * h);
  const disk: [number, number][] = [];
  for (let dj = -R_OPEN; dj <= R_OPEN; dj++) for (let di = -R_OPEN; di <= R_OPEN; di++) if (di * di + dj * dj <= R_OPEN * R_OPEN) disk.push([di, dj]);
  for (let j = R_OPEN; j < h - R_OPEN; j++) for (let i = R_OPEN; i < w - R_OPEN; i++) {
    if (!grid.occ[j * w + i]) continue;
    let all = 1;
    for (const [di, dj] of disk) if (!grid.occ[(j + dj) * w + i + di]) { all = 0; break; }
    eroded[j * w + i] = all;
  }
  const opened = new Uint8Array(w * h);
  for (let j = R_OPEN; j < h - R_OPEN; j++) for (let i = R_OPEN; i < w - R_OPEN; i++) {
    if (!eroded[j * w + i]) continue;
    for (const [di, dj] of disk) opened[(j + dj) * w + i + di] = 1;
  }
  const lost = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) lost[s] = grid.occ[s] && !opened[s] ? 1 : 0;
  const seen = new Uint8Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (!lost[s] || seen[s]) continue;
    let count = 0, sx = 0, sy = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!; const cj = (c / w) | 0, ci = c - cj * w;
      count++; sx += ci; sy += cj;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const n = nj * w + ni;
        if (lost[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
    const area = count * CELL * CELL;
    if (area > R.tipTolerance) report('THIN', Math.round(sx / count), Math.round(sy / count), area, (p) => `${p}: zbyt cienki fragment (< ${R.minFeature} mm, ${area.toFixed(0)} mm²)`);
  }

  // ---- sole -----------------------------------------------------------------------
  if (rig.dims.soleLength * rig.dims.soleWidth < R.minSoleArea) {
    issues.push({ code: 'SOLE', part: 'stopy', slot: null, at: [0, 0], size: rig.dims.soleLength * rig.dims.soleWidth, message: 'Stopy: zbyt mała płaska podeszwa' });
  }
  issues.push(...worst.values());
  return { ok: issues.length === 0, issues };
}
