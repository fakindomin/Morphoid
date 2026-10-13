/** npm run audit [N] - print-rule audit over the default genome and N random genomes. */
import { defaultGenome, mulberry32, randomGenome, serialize } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { analyzePrint } from '../src/core/print';

const N = Number(process.argv[2] ?? 150);
const stats = new Map<string, { n: number; max: number; example: string }>();
let bad = 0;
const t0 = performance.now();
const rnd = mulberry32(7);
const genomes = [defaultGenome(), ...Array.from({ length: N }, () => randomGenome(rnd))];
for (const g of genomes) {
  const rig = solveRig(g);
  const pose = targetPose(rig, g, 0, false, { x: 0, y: 0 });
  const rep = analyzePrint(buildPaths(pose, g, rig, false), rig);
  if (!rep.ok) bad++;
  for (const i of rep.issues) {
    const k = `${i.code} ${i.part}`;
    const s = stats.get(k) ?? { n: 0, max: 0, example: '' };
    s.n++; if (i.size >= s.max) { s.max = i.size; s.example = i.message; }
    stats.set(k, s);
  }
}
const first = analyzePrint(buildPaths(targetPose(solveRig(genomes[0]!), genomes[0]!, 0, false, { x: 0, y: 0 }), genomes[0]!, solveRig(genomes[0]!), false), solveRig(genomes[0]!));
console.log(`default ${serialize(genomes[0]!)}:`, first.issues.map((i) => i.message));
console.log(`\n${bad}/${genomes.length} genomes have print issues  (${((performance.now() - t0) / genomes.length).toFixed(1)} ms each)\n`);
for (const [k, s] of [...stats].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(s.n).padStart(4)}  ${k.padEnd(28)} max ${s.max.toFixed(1)}   e.g. ${s.example}`);
