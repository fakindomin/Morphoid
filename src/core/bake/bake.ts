/**
 * Bake: parts -> pieces (per print plan) -> smooth fused field -> Surface Nets -> validated mesh.
 * Pure TypeScript with typed arrays, so the same code runs in a Web Worker and in tests.
 */
import type { MorphotypeGenome } from '../genome';
import { solveRig } from '../rig';
import { targetPose } from '../art/pose';
import { buildPaths, type SlotId } from '../art/shapes';
import { buildParts3D, type Part3D } from '../art/spec3d';
import { GROUPS, isSeparate, pieceOf, type PartGroup, type PrintPlan } from '../print';
import { addPart, clipBelow, gridDims, makeGrid } from './field';
import { flipMesh, validateMesh, type MeshValidation } from './mesh';
import { makeManifoldField, surfaceNets, type Grid3, type Mesh } from './surfacenets';

export type BakeQuality = 'draft' | 'standard' | 'fine';
export const VOXEL_MM: Record<BakeQuality, number> = { draft: 0.6, standard: 0.3, fine: 0.2 };
/** Smooth-union radius: joints grow organically within this distance (mm). */
export const BLEND_MM = 1.2;
/** Parts thinner than this are colour regions / engraving (3MF), not geometry. */
export const MIN_SOLID_MM = 0.8;

/**
 * Surface Nets can pinch where two sheets of the surface meet inside one cell (features about one
 * voxel thin). The validator finds those cells; we flip the sign of the weakest corner (a change
 * of less than a voxel) and mesh again, until every edge is shared by exactly two triangles.
 */
export function meshWithRepair(
  grid: Grid3, maxIter = 12, phase?: (name: 'topology' | 'mesh' | 'validate') => void,
): { mesh: Mesh; validation: MeshValidation; repairs: number } {
  phase?.('topology');
  let repairs = makeManifoldField(grid);
  phase?.('mesh');
  for (let iter = 0; ; iter++) {
    let mesh = surfaceNets(grid);
    phase?.('validate');
    let validation = validateMesh(mesh);
    if (validation.volume < 0) { mesh = flipMesh(mesh); validation = validateMesh(mesh); }
    if (validation.watertight || iter >= maxIter || !mesh.cells) return { mesh, validation, repairs };
    const cx = grid.nx - 1, cy = grid.ny - 1;
    const seen = new Set<number>();
    for (const v of validation.badVertices) {
      const c = mesh.cells[v];
      if (c === undefined || seen.has(c)) continue;
      seen.add(c);
      const i = c % cx, j = Math.floor(c / cx) % cy, k = Math.floor(c / (cx * cy));
      let best = -1, bestAbs = Infinity;
      for (let dk = 0; dk <= 1; dk++) for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) {
        const idx = ((k + dk) * grid.ny + (j + dj)) * grid.nx + i + di;
        const a = Math.abs(grid.data[idx]!);
        if (a < bestAbs) { bestAbs = a; best = idx; }
      }
      grid.data[best] = grid.data[best]! < 0 ? 1e-3 : -1e-3;
      repairs++;
    }
  }
}

export interface BakedPiece {
  id: string;
  label: string;
  orientation: 'upright' | 'flat';
  /** model coordinates (mm, y up) */
  mesh: Mesh;
  validation: MeshValidation;
  ms: number;
}

export interface BakeResult { pieces: BakedPiece[]; ms: number; quality: BakeQuality }

export interface BakeProgress {
  /** 0..1 over the whole bake, weighted by the size of every piece's grid */
  frac: number;
  /** what is happening right now, in Polish */
  label: string;
  /** name of the piece being baked and its position */
  piece: string;
  index: number;
  count: number;
}
type Progress = (p: BakeProgress) => void;

/** Share of one piece's time spent in each phase (measured on typical models). */
const PHASES = { field: 0.28, topology: 0.2, mesh: 0.37, validate: 0.15 } as const;
const PHASE_LABEL = { field: 'Zrost elementów w bryłę', topology: 'Naprawa topologii', mesh: 'Tworzenie siatki', validate: 'Kontrola szczelności' } as const;

export function bake(genome: MorphotypeGenome, plan: PrintPlan, quality: BakeQuality, onProgress?: Progress): BakeResult {
  const t0 = performance.now();
  const rig = solveRig(genome);
  const paths = buildPaths(targetPose(rig, genome, 0, false, { x: 0, y: 0 }), genome, rig, false);
  const parts = buildParts3D(paths, genome, rig).filter((p) => p.thickness >= MIN_SOLID_MM);
  const h = VOXEL_MM[quality];

  const byPiece = new Map<string, Part3D[]>();
  for (const p of parts) {
    const id = pieceOf(p.slot as SlotId, plan);
    (byPiece.get(id) ?? byPiece.set(id, []).get(id)!).push(p);
  }
  const legsSeparate = isSeparate(plan, 'legs');
  const order = ['body', ...GROUPS.map((g) => g.id)].filter((id) => byPiece.has(id));
  const labelOf = (id: string): string => (id === 'body' ? (byPiece.size === 1 ? 'Całość' : 'Korpus') : GROUPS.find((x) => x.id === id)!.label);
  const weights = order.map((id) => { const d = gridDims(byPiece.get(id)!, h); return d.nx * d.ny * d.nz; });
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  let doneW = 0;
  const report = (n: number, phaseDone: number, label: string): void =>
    onProgress?.({ frac: Math.min(1, (doneW + weights[n]! * phaseDone) / totalW), label, piece: labelOf(order[n]!), index: n + 1, count: order.length });
  const pieces: BakedPiece[] = [];
  order.forEach((id, n) => {
    const ps = byPiece.get(id)!;
    const t1 = performance.now();
    report(n, 0, PHASE_LABEL.field);
    const grid = makeGrid(ps, h);
    for (const p of ps) addPart(grid, p, BLEND_MM);
    // flat cuts so a piece has a real footprint on the bed
    if (id === 'head') clipBelow(grid, rig.nodes.neckBase.y);
    if (id === 'body' && legsSeparate) {
      let ymin = Infinity;
      for (const p of ps) for (const poly of p.polys) for (const [, y] of poly) ymin = Math.min(ymin, y);
      clipBelow(grid, ymin + 2);
    }
    const start = { topology: PHASES.field, mesh: PHASES.field + PHASES.topology, validate: PHASES.field + PHASES.topology + PHASES.mesh } as const;
    const { mesh, validation } = meshWithRepair(grid, 12, (name) => report(n, start[name], PHASE_LABEL[name]));
    const flat = id !== 'body' && GROUPS.find((x: { id: PartGroup }) => x.id === id)?.orientation === 'flat';
    pieces.push({ id, label: labelOf(id), orientation: flat ? 'flat' : 'upright', mesh, validation, ms: performance.now() - t1 });
    doneW += weights[n]!;
  });
  onProgress?.({ frac: 1, label: 'Gotowe', piece: '', index: order.length, count: order.length });
  return { pieces, ms: performance.now() - t0, quality };
}
