/**
 * Bake: parts -> pieces (per print plan) -> smooth fused field -> Surface Nets -> validated mesh.
 * Pure TypeScript with typed arrays, so the same code runs in a Web Worker and in tests.
 */
import type { MorphotypeGenome } from '../genome';
import { solveRig } from '../rig';
import { targetPose } from '../art/pose';
import { buildPaths, type SlotId } from '../art/shapes';
import { buildParts3D, type Part3D } from '../art/spec3d';
import { GROUPS, groupOfSlot, isSeparate, pieceOf, type PartGroup, type PrintPlan } from '../print';
import { addPart, clipBelow, makeGrid } from './field';
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
export function meshWithRepair(grid: Grid3, maxIter = 12): { mesh: Mesh; validation: MeshValidation; repairs: number } {
  let repairs = makeManifoldField(grid);
  for (let iter = 0; ; iter++) {
    let mesh = surfaceNets(grid);
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

type Progress = (stage: string, done: number, total: number) => void;

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
  const pieces: BakedPiece[] = [];
  order.forEach((id, n) => {
    onProgress?.(id, n, order.length);
    const ps = byPiece.get(id)!;
    const t1 = performance.now();
    const grid = makeGrid(ps, h);
    for (const p of ps) addPart(grid, p, BLEND_MM);
    // flat cuts so a piece has a real footprint on the bed
    if (id === 'head') clipBelow(grid, rig.nodes.neckBase.y);
    if (id === 'body' && legsSeparate) {
      let ymin = Infinity;
      for (const p of ps) for (const poly of p.polys) for (const [, y] of poly) ymin = Math.min(ymin, y);
      clipBelow(grid, ymin + 2);
    }
    const { mesh, validation } = meshWithRepair(grid);
    const gdef = groupOfSlot(ps[0]!.slot as SlotId);
    const flat = id !== 'body' && GROUPS.find((x: { id: PartGroup }) => x.id === id)?.orientation === 'flat';
    void gdef;
    pieces.push({
      id, label: id === 'body' ? (byPiece.size === 1 ? 'Całość' : 'Korpus') : GROUPS.find((x) => x.id === id)!.label,
      orientation: flat ? 'flat' : 'upright', mesh, validation, ms: performance.now() - t1,
    });
  });
  onProgress?.('done', order.length, order.length);
  return { pieces, ms: performance.now() - t0, quality };
}
