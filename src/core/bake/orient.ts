/**
 * Print orientation + export. Slicers expect Z up with the model on the bed:
 *  - upright pieces keep standing: (x, y, z) -> (x, -z, y), lowest point on the bed;
 *  - flat pieces (wings, ears, horns, tail, crest, whiskers) lie on their large face: every
 *    separate body of the piece is dropped on the bed and laid out in a row with a gap.
 */
import { strToU8, zipSync } from 'fflate';
import type { BakedPiece, BakeResult } from './bake';
import { toBinaryStl } from './mesh';
import { fileBase, shortHash } from '../genome/name';
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

/** Area of the faces lying in the lowest (bottom) or highest (top) 0.3 mm of a body and facing out of it. */
function flatArea(m: Mesh, c: { tris: number[]; min: number[]; max: number[] }, which: 'top' | 'bottom'): number {
  const P = m.positions, I = m.indices;
  let a = 0;
  for (const t of c.tris) {
    const i = 3 * I[3 * t]!, j = 3 * I[3 * t + 1]!, k = 3 * I[3 * t + 2]!;
    const zs = [P[i + 2]!, P[j + 2]!, P[k + 2]!];
    if (which === 'bottom' ? Math.max(...zs) > c.min[2]! + 0.3 : Math.min(...zs) < c.max[2]! - 0.3) continue;
    const ux = P[j]! - P[i]!, uy = P[j + 1]! - P[i + 1]!, vx = P[k]! - P[i]!, vy = P[k + 1]! - P[i + 1]!;
    const nz = (ux * vy - uy * vx) / 2;
    if (which === 'bottom' ? nz < 0 : nz > 0) a += Math.abs(nz);
  }
  return a;
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
    // a body with ribs or a peg on one face lies on the other one: turned over (180 deg about X) when its top is flatter
    const flip = flatArea(src, c, 'top') > flatArea(src, c, 'bottom') * 1.2;
    const [ymin, ymax] = flip ? [-c.max[1], -c.min[1]] : [c.min[1], c.max[1]];
    const dx = -xmin, dy = cursor - ymin, dz = flip ? c.max[2] : -c.min[2];
    for (const t of c.tris) for (let k = 0; k < 3; k++) {
      const v = src.indices[3 * t + k]!, sg = flip ? -1 : 1;
      P[3 * v] = src.positions[3 * v]! + dx; P[3 * v + 1] = sg * src.positions[3 * v + 1]! + dy; P[3 * v + 2] = sg * src.positions[3 * v + 2]! + dz;
    }
    cursor += ymax - ymin + GAP_MM;
  }
  return { positions: P, indices: src.indices };
}

export interface ExportFile { name: string; bytes: Uint8Array }

const slug = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Who is being exported: files are named after the creature, its DNA code goes inside them. */
export interface Creature { name: string; code: string }

const ascii = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/[^\x20-\x7e]/g, '');

export function exportFiles(result: BakeResult, who: Creature): ExportFile[] {
  const only = result.pieces.length === 1, base = fileBase(who.name);
  return result.pieces.map((p) => ({
    name: only ? `${base}.stl` : `${base} - ${slug(p.label)}.stl`,
    // the 80-byte STL header cannot hold the code: name, a short hash of the code and the part
    bytes: toBinaryStl(printMesh(p), ascii(`${base} #${shortHash(who.code)} ${p.label}`)),
  }));
}

/** One file to download: the STL itself, or a ZIP when the model is split into parts. */
export function exportBundle(result: BakeResult, who: Creature): ExportFile {
  const files = exportFiles(result, who);
  if (files.length === 1) return files[0]!;
  const zip: Record<string, Uint8Array> = {};
  for (const f of files) zip[f.name] = f.bytes;
  zip['dna.txt'] = strToU8(`${fileBase(who.name)}\nDNA: ${who.code}\n`);
  zip['README.txt'] = strToU8(`${fileBase(who.name)}\n${files.length} parts, print each as is (Z up, on the bed).\n`);
  return { name: `${fileBase(who.name)}.zip`, bytes: zipSync(zip, { level: 0 }) };
}
