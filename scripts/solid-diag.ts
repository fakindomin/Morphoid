/** npx vite-node scripts/solid-diag.ts <MPH code> [piece] : shells (size/position) and genus of a baked piece. */
import { parse } from '../src/core/genome';
import { planWhole } from '../src/core/print';
import { bake } from '../src/core/bake/bake';
const g = (parse(process.argv[2]!) as { ok: true; genome: ReturnType<typeof import('../src/core/genome').defaultGenome> }).genome;
const r = bake(g, planWhole(), 'draft');
for (const p of r.pieces.filter((x) => !process.argv[3] || x.id === process.argv[3])) {
  const m = p.mesh, nv = m.positions.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; } return a; };
  for (let t = 0; t < m.indices.length; t += 3) { const a = find(m.indices[t]!); parent[find(m.indices[t + 1]!)] = a; parent[find(m.indices[t + 2]!)] = a; }
  const sh = new Map<number, { n: number; min: number[]; max: number[]; vol: number }>();
  for (let t = 0; t < m.indices.length; t += 3) {
    const r0 = find(m.indices[t]!); const s = sh.get(r0) ?? { n: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], vol: 0 };
    s.n++;
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { const v = m.positions[3 * m.indices[t + k]! + a]!; s.min[a] = Math.min(s.min[a]!, v); s.max[a] = Math.max(s.max[a]!, v); }
    const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((q) => m.positions[3 * m.indices[t + k]! + q]!));
    s.vol += (a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!) - a![1]! * (b![0]! * c![2]! - b![2]! * c![0]!) + a![2]! * (b![0]! * c![1]! - b![1]! * c![0]!)) / 6000;
    sh.set(r0, s);
  }
  console.log(`${p.id}: genus ${p.validation.genus}, shells ${sh.size}`);
  for (const s of [...sh.values()].sort((a, b) => Math.abs(b.vol) - Math.abs(a.vol)).slice(0, 5)) {
    console.log(`  tris ${s.n}  vol ${s.vol.toFixed(3)} cm3  bbox x[${s.min[0]!.toFixed(1)},${s.max[0]!.toFixed(1)}] y[${s.min[1]!.toFixed(1)},${s.max[1]!.toFixed(1)}] z[${s.min[2]!.toFixed(1)},${s.max[2]!.toFixed(1)}]`);
  }
}
