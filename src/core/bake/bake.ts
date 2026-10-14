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
import { closeSmallHoles, restore } from './close';
import { addPart, clipBelow, clipMid, gridDims, makeGrid, partBox } from './field';
import { flipMesh, validateMesh, type MeshValidation } from './mesh';
import { JOIN_MARGIN_MM, crop, cutAway, joinPart, newHostSockets, type HostSockets, type Joint } from './joint';
import { paintMesh } from './paint';
import { smoothMesh } from './smooth';
import { makeManifoldField, surfaceNets, type Grid3, type Mesh } from './surfacenets';

export type BakeQuality = 'draft' | 'standard' | 'fine';
export const VOXEL_MM: Record<BakeQuality, number> = { draft: 0.6, standard: 0.3, fine: 0.2 };
/** Smooth-union radius: joints grow organically within this distance (mm); it also closes slits narrower than half of it. */
export const BLEND_MM = 2.4;
/** Parts thinner than this are colour regions / engraving (3MF), not geometry. */
export const MIN_SOLID_MM = 0.8;
/** How far skin smoothing may move a vertex, in voxels (see smooth.ts). */
export const SMOOTH_MOVE = 0.9;

/**
 * Surface Nets can pinch where two sheets of the surface meet inside one cell (features about one
 * voxel thin). The validator finds those cells; we flip the sign of the weakest corner (a change
 * of less than a voxel) and mesh again, until every edge is shared by exactly two triangles.
 */
function meshLoop(
  grid: Grid3, maxIter: number, phase?: (name: 'topology' | 'mesh' | 'validate') => void,
): { mesh: Mesh; validation: MeshValidation; repairs: number } {
  phase?.('topology');
  let repairs = makeManifoldField(grid);
  phase?.('mesh');
  for (let iter = 0; ; iter++) {
    let mesh = surfaceNets(grid);
    phase?.('validate');
    let validation = validateMesh(mesh);
    if (validation.volume < 0) { mesh = flipMesh(mesh); validation = validateMesh(mesh); }
    if (validation.watertight || iter >= maxIter || !mesh.cells) {
      const clean = despeckle(mesh);
      if (clean.removed) return { mesh: clean.mesh, validation: validateMesh(clean.mesh), repairs: repairs + clean.removed };
      return { mesh, validation, repairs };
    }
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

/** Shells smaller than this (cm^3) are dust left over from thin features, not part of the model. */
const DUST_CM3 = 0.03;

/** Drop tiny disconnected shells (never the biggest one). Returns the cleaned mesh and how many were removed. */
export function despeckle(mesh: Mesh): { mesh: Mesh; removed: number } {
  const P = mesh.positions, I = mesh.indices, nv = P.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; } return a; };
  for (let t = 0; t < I.length; t += 3) { const a = find(I[t]!); parent[find(I[t + 1]!)] = a; parent[find(I[t + 2]!)] = a; }
  const vol = new Map<number, number>();
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
    const v = (P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!)) / 6000;
    const r = find(I[t]!);
    vol.set(r, (vol.get(r) ?? 0) + v);
  }
  if (vol.size < 2) return { mesh, removed: 0 };
  let biggest = -1, bigV = 0;
  for (const [r, v] of vol) if (Math.abs(v) > bigV) { bigV = Math.abs(v); biggest = r; }
  const drop = new Set<number>();
  for (const [r, v] of vol) if (r !== biggest && Math.abs(v) < DUST_CM3) drop.add(r);
  if (!drop.size) return { mesh, removed: 0 };
  const keep: number[] = [];
  for (let t = 0; t < I.length; t += 3) if (!drop.has(find(I[t]!))) keep.push(I[t]!, I[t + 1]!, I[t + 2]!);
  return { mesh: { positions: P, indices: new Uint32Array(keep), ...(mesh.cells ? { cells: mesh.cells } : {}) }, removed: drop.size };
}

/** Tunnels narrower than twice this (mm) are closed when the solid has through-holes. */
export const CLOSE_HOLES_MM = 2.0;

export function meshWithRepair(
  grid: Grid3, maxIter = 12, phase?: (name: 'topology' | 'mesh' | 'validate') => void,
  /** sockets and slots: closing tiny holes must not fill them, so they are cut again afterwards */
  holes: readonly ((g: Grid3) => void)[] = [],
): { mesh: Mesh; validation: MeshValidation; repairs: number; holesClosed: number } {
  const first = meshLoop(grid, maxIter, phase);
  if (first.validation.genus <= 0) return { ...first, holesClosed: 0 };
  // through-holes: close the tiny ones (hairline tunnels between neighbouring parts); keep the result only if it helps
  phase?.('topology');
  const keep = holes.length ? grid.data.slice() : null;
  const undo = closeSmallHoles(grid, CLOSE_HOLES_MM);
  if (!undo.index.length) return { ...first, holesClosed: 0 };
  for (const cut of holes) cut(grid);
  const second = meshLoop(grid, maxIter, phase);
  if (second.validation.watertight && second.validation.genus < first.validation.genus) {
    return { ...second, holesClosed: first.validation.genus - second.validation.genus };
  }
  if (keep) grid.data.set(keep); else restore(grid, undo);
  return { ...first, holesClosed: 0 };
}

export interface BakedPiece {
  id: string;
  label: string;
  orientation: 'upright' | 'flat';
  /** model coordinates (mm, y up) */
  mesh: Mesh;
  /** AMS filament (0-based: c1, c2, c3, white) of every triangle, see paint.ts */
  paint: Uint8Array;
  validation: MeshValidation;
  ms: number;
  /** through-holes the engine closed (tiny tunnels between neighbouring parts) */
  holesClosed: number;
  /** separately printed pieces this one runs through when assembled (neither could be trimmed without falling apart) */
  clashesWith: string[];
  /** joints of this part with the pieces it mounts on; empty for the body */
  joints: (Joint & { hostId: string })[];
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

export function bake(
  genome: MorphotypeGenome, plan: PrintPlan, quality: BakeQuality, onProgress?: Progress,
  /** test hook: the finished fields of every piece, just before meshing */
  inspect?: (grids: ReadonlyMap<string, Grid3>) => void,
): BakeResult {
  const t0 = performance.now();
  const rig = solveRig(genome);
  const paths = buildPaths(targetPose(rig, genome, 0, false, { x: 0, y: 0 }), genome, rig, false);
  const all = buildParts3D(paths, genome, rig, true);
  const parts = all.filter((p) => p.thickness >= MIN_SOLID_MM);
  // too thin to be geometry: painted on the piece they belong to (3MF colour regions)
  const decalsOf = (id: string): Part3D[] => all.filter((p) => p.thickness < MIN_SOLID_MM && pieceOf(p.slot as SlotId, plan) === id);
  const h = VOXEL_MM[quality];

  const byPiece = new Map<string, Part3D[]>();
  for (const p of parts) {
    const id = pieceOf(p.slot as SlotId, plan);
    (byPiece.get(id) ?? byPiece.set(id, []).get(id)!).push(p);
  }
  const legsSeparate = isSeparate(plan, 'legs');
  const order = ['body', ...GROUPS.map((g) => g.id)].filter((id) => byPiece.has(id));
  const labelOf = (id: string): string => (id === 'body' ? (byPiece.size === 1 ? 'Całość' : 'Korpus') : GROUPS.find((x) => x.id === id)!.label);
  // a part plugs into the body, and into a separately printed head where it touches the head (ears, horns, a tuft)
  const hostsOf = (id: string): string[] => id === 'body' ? []
    : id === 'stand' ? [byPiece.has('legs') ? 'legs' : 'body'] // the stand carries the feet
    : id === 'head' || !byPiece.has('head') ? ['body'] : ['body', 'head'];
  const margin = (id: string): number => (id === 'body' ? 3 : JOIN_MARGIN_MM);
  const weights = order.map((id) => { const d = gridDims(byPiece.get(id)!, h, margin(id)); return d.nx * d.ny * d.nz; });
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  let doneW = 0;
  const report = (n: number, share: number, label: string): void =>
    onProgress?.({ frac: Math.min(1, (doneW + weights[n]! * share) / totalW), label, piece: labelOf(order[n]!), index: n + 1, count: order.length });

  // 1. fields of every piece
  const grids = new Map<string, Grid3>();
  order.forEach((id, n) => {
    const ps = byPiece.get(id)!;
    report(n, 0, PHASE_LABEL.field);
    const grid = makeGrid(ps, h, margin(id));
    for (const p of ps) addPart(grid, p, BLEND_MM);
    // flat cuts so a piece has a real footprint on the bed
    if (id === 'head') clipBelow(grid, rig.nodes.neckBase.y);
    // wings print lying on their inner face: the ribs' smooth blend must not bulge through it
    if (id === 'wings') { const w = ps.filter((p) => p.ribs); if (w.length) clipMid(grid, Math.min(...w.map((p) => Math.abs(p.z) - p.thickness / 2))); }
    if (id === 'body' && legsSeparate) {
      let ymin = Infinity;
      for (const p of ps) ymin = Math.min(ymin, partBox(p).lo[1]);
      clipBelow(grid, ymin + 2);
    }
    grids.set(id, grid);
    doneW += weights[n]! * PHASES.field;
  });

  // 2. joints: every part is cut against its (still unmodified) host, then the sockets are carved
  const joints = new Map<string, Joint[]>();
  const sockets = new Map<string, HostSockets>();
  const partHoles = new Map<string, ((g: Grid3) => void)[]>();
  order.forEach((id, n) => {
    const hosts = hostsOf(id);
    if (!hosts.length) return;
    report(n, PHASES.field, 'Czopy i gniazda');
    joints.set(id, joinPart(grids.get(id)!, hosts.map((hid) => ({ grid: grids.get(hid)!, sockets: sockets.get(hid) ?? sockets.set(hid, newHostSockets()).get(hid)! })),
      GROUPS.find((x) => x.id === id)?.orientation === 'upright', partHoles.set(id, []).get(id)!,
      (sockets.get(id) ?? sockets.set(id, newHostSockets()).get(id)!).placed));
  });
  const clashes = new Map<string, string[]>();
  // separate parts that overlap each other but are not joined: the later one gives way to the earlier one
  order.forEach((id, n) => {
    if (!hostsOf(id).length) return;
    for (const other of order.slice(0, n)) {
      // the later part gives way; if that would chop it apart, the earlier one does; failing both, they clash
      if (hostsOf(id).includes(other) || cutAway(grids.get(id)!, grids.get(other)!) || cutAway(grids.get(other)!, grids.get(id)!)) continue;
      (clashes.get(id) ?? clashes.set(id, []).get(id)!).push(other);
    }
  });
  for (const [host, list] of sockets) for (const carve of list.carve) grids.set(host, carve(grids.get(host)!));
  // a piece made of horizontal plates (whiskers) prints as it lies: its underside must stay one flat face, so a tab
  // that dips below it on a slanted joint axis is trimmed back to the plate
  for (const id of order) {
    const ps = byPiece.get(id)!;
    if (id !== 'body' && ps.every((p) => p.plane === 'xz')) clipBelow(grids.get(id)!, Math.min(...ps.map((p) => partBox(p).lo[1])) + 0.05);
  }
  inspect?.(grids);

  // 3. meshes
  const pieces: BakedPiece[] = [];
  const rest = 1 - PHASES.field;
  const start = { topology: 0, mesh: PHASES.topology / rest, validate: (PHASES.topology + PHASES.mesh) / rest } as const;
  doneW = 0;
  order.forEach((id, n) => {
    const t1 = performance.now();
    // keep the usual 3 mm of empty border: hole closing needs room around the solid
    const grid = crop(grids.get(id)!, Math.ceil(3 / h));
    const base = doneW + weights.reduce((a, w) => a + w * PHASES.field, 0);
    const holes = [...(sockets.get(id)?.holes ?? []), ...(partHoles.get(id) ?? [])];
    const { mesh: raw, validation: rawValidation, holesClosed } = meshWithRepair(grid, 12, (name) =>
      onProgress?.({ frac: Math.min(1, (base + weights[n]! * rest * start[name]) / totalW), label: PHASE_LABEL[name], piece: labelOf(id), index: n + 1, count: order.length }), holes);
    grids.delete(id);
    const mesh = rawValidation.watertight ? smoothMesh(raw, SMOOTH_MOVE * h) : raw;
    const validation = mesh === raw ? rawValidation : validateMesh(mesh);
    // a part swallowed whole by the piece it gave way to (ears inside a big octopus mantle) leaves nothing to print
    if (id !== 'body' && validation.shells === 0) { doneW += weights[n]! * rest; return; }
    const paint = paintMesh(mesh, byPiece.get(id)!, decalsOf(id), id === 'body' ? paths.pattern.flatten(8) : []);
    const flat = id !== 'body' && GROUPS.find((x: { id: PartGroup }) => x.id === id)?.orientation === 'flat';
    pieces.push({ id, label: labelOf(id), orientation: flat ? 'flat' : 'upright', mesh, paint, validation, ms: performance.now() - t1, holesClosed, clashesWith: clashes.get(id) ?? [], joints: (joints.get(id) ?? []).map((j) => ({ ...j, hostId: hostsOf(id)[j.host]! })) });
    doneW += weights[n]! * rest;
  });
  onProgress?.({ frac: 1, label: 'Gotowe', piece: '', index: order.length, count: order.length });
  return { pieces, ms: performance.now() - t0, quality };
}
