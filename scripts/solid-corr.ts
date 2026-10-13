/** Which genome values go with body-shell / body-hole failures? (draft bake, whole print, body piece only) */
import { writeFileSync } from 'node:fs';
import { BLOCKS, defaultGenome, mulberry32, randomGenome, serialize } from '../src/core/genome';
import { planWhole } from '../src/core/print';
import { bake } from '../src/core/bake/bake';
const N = Number(process.argv[2] ?? 400);
const rnd = mulberry32(2025);
const rows: { g: ReturnType<typeof defaultGenome>; shells: number; genus: number }[] = [];
for (let i = 0; i < N; i++) {
  const g = randomGenome(rnd);
  const body = bake(g, planWhole(), 'draft').pieces.find((p) => p.id === 'body')!;
  rows.push({ g, shells: body.validation.shells, genus: body.validation.genus });
}
const failShell = rows.filter((r) => r.shells !== 1), failHole = rows.filter((r) => r.genus !== 0);
console.log(`body: ${failShell.length} with extra shells, ${failHole.length} with holes, of ${rows.length}`);
const rate = (pred: (r: (typeof rows)[number]) => boolean, sel: (r: (typeof rows)[number]) => boolean) => {
  const sub = rows.filter(sel); return sub.length ? sub.filter(pred).length / sub.length : 0;
};
for (const [label, pred] of [['SHELLS', (r: (typeof rows)[number]) => r.shells !== 1], ['HOLES', (r: (typeof rows)[number]) => r.genus !== 0]] as const) {
  const out: [string, number, number][] = [];
  for (const b of BLOCKS) for (const f of b.fields) {
    const max = f.kind === 'step' ? 6 : f.options.length;
    for (let v = 0; v < max; v++) {
      const sel = (r: (typeof rows)[number]) => r.g[b.id]![f.name] === v;
      const n = rows.filter(sel).length; if (n < 12) continue;
      out.push([`${b.id}.${f.name}=${f.kind === 'enum' ? f.options[v]!.id : v}`, rate(pred, sel), n]);
    }
  }
  out.sort((a, b) => b[1] - a[1]);
  console.log(`\n${label}: base rate ${(rate(pred, () => true) * 100).toFixed(0)}%  | highest:`);
  for (const [k, r, n] of out.slice(0, 8)) console.log(`  ${(r * 100).toFixed(0).padStart(3)}%  ${k}  (n=${n})`);
}
writeFileSync(process.argv[3] ?? '/tmp/solid-rows.json', JSON.stringify(rows.map((r) => ({ code: serialize(r.g), shells: r.shells, genus: r.genus }))));
