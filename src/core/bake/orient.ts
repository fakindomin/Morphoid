/**
 * Print orientation + export. Slicers expect Z up with the model on the bed:
 *  - upright pieces keep standing: (x, y, z) -> (x, -z, y), lowest point on the bed;
 *  - flat pieces (wings, ears, horns, tail, crest, whiskers) lie on their large face: every
 *    separate body of the piece is dropped on the bed and laid out in a row with a gap.
 */
import { strToU8, zipSync } from 'fflate';
import type { BakedPiece, BakeResult } from './bake';
import { toBinaryStl } from './mesh';
import type { Mesh } from './surfacenets';

const GAP_MM = 4;

function components(m: Mesh): { tris: number[]; min: [number, number, number]; max: [number, number, number] }[] {
  const nv = m.positions.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; } return a; };
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = find(m.indices[t]!), b = find(m.indices[t + 1]!), c = find(m.indices[t + 2]!);
    parent[b] = a; parent[find(c)] = a;
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < m.indices.length / 3; t++) {
    const r = find(m.indices[3 * t]!);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(t);
  }
  return [...groups.values()].map((tris) => {
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) {
      const v = m.positions[3 * m.indices[3 * t + k]! + a]!;
      min[a] = Math.min(min[a]!, v); max[a] = Math.max(max[a]!, v);
    }
    return { tris, min, max };
  });
}

export function printMesh(piece: BakedPiece): Mesh {
  const src = piece.mesh;
  if (piece.orientation === 'upright') {
    const P = new Float32Array(src.positions.length);
    let zmin = Infinity, xmin = Infinity, ymin = Infinity;
    for (let v = 0; v < P.length; v += 3) {
      P[v] = src.positions[v]!; P[v + 1] = -src.positions[v + 2]!; P[v + 2] = src.positions[v + 1]!;
      xmin = Math.min(xmin, P[v]!); ymin = Math.min(ymin, P[v + 1]!); zmin = Math.min(zmin, P[v + 2]!);
    }
    for (let v = 0; v < P.length; v += 3) { P[v] = P[v]! - xmin; P[v + 1] = P[v + 1]! - ymin; P[v + 2] = P[v + 2]! - zmin; }
    return { positions: P, indices: src.indices };
  }
  // flat: lay every body on the bed (z up stays z up), then line them up along Y. Triangles keep their order (and
  // so their paint, see paint.ts): only the vertices move, each with its own body.
  const comps = components(src).sort((a, b) => a.min[1] - b.min[1]);
  const xmin = Math.min(...comps.map((c) => c.min[0]));
  const P = new Float32Array(src.positions.length);
  let cursor = 0;
  for (const c of comps) {
    const dx = -xmin, dy = cursor - c.min[1], dz = -c.min[2];
    for (const t of c.tris) for (let k = 0; k < 3; k++) {
      const v = src.indices[3 * t + k]!;
      P[3 * v] = src.positions[3 * v]! + dx; P[3 * v + 1] = src.positions[3 * v + 1]! + dy; P[3 * v + 2] = src.positions[3 * v + 2]! + dz;
    }
    cursor += c.max[1] - c.min[1] + GAP_MM;
  }
  return { positions: P, indices: src.indices };
}

export interface ExportFile { name: string; bytes: Uint8Array }

const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function exportFiles(result: BakeResult, code: string): ExportFile[] {
  const only = result.pieces.length === 1;
  return result.pieces.map((p) => ({
    name: only ? `morphoid-${code}.stl` : `morphoid-${code}-${slug(p.label)}.stl`,
    bytes: toBinaryStl(printMesh(p), `Morphoid ${code} ${p.label}`),
  }));
}

/** One file to download: the STL itself, or a ZIP when the model is split into parts. */
export function exportBundle(result: BakeResult, code: string): ExportFile {
  const files = exportFiles(result, code);
  if (files.length === 1) return files[0]!;
  const zip: Record<string, Uint8Array> = {};
  for (const f of files) zip[f.name] = f.bytes;
  zip['README.txt'] = strToU8(`Morphoid ${code}\n${files.length} parts, print each as is (Z up, on the bed).\n`);
  return { name: `morphoid-${code}-czesci.zip`, bytes: zipSync(zip, { level: 0 }) };
}
