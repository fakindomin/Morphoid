/** npm run audit -- [N] [whole|modular] : print audit over the default genome and N random genomes. */
import { defaultGenome, mulberry32, randomGenome, serialize } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { analyzePrint, planModular, planWhole } from '../src/core/print';

const N = Number(process.argv[2] ?? 150);
const MODE = process.argv[3] === 'modular' ? planModular() : planWhole();
const run = (g: ReturnType<typeof defaultGenome>) => {
  const rig = solveRig(g);
  return analyzePrint(buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false), rig, MODE);
};
const stats = new Map<string, { n: number; max: number; example: string }>();
let red = 0, yellow = 0;
const t0 = performance.now();
const rnd = mulberry32(7);
const genomes = [defaultGenome(), ...Array.from({ length: N }, () => randomGenome(rnd))];
for (const g of genomes) {
  const rep = run(g);
  if (rep.level === 'red') red++; else if (rep.level === 'yellow') yellow++;
  for (const i of rep.issues) {
    const k = `${i.severity === 'error' ? 'ERR ' : 'warn'} ${i.code} ${i.part}`;
    const s = stats.get(k) ?? { n: 0, max: 0, example: '' };
    s.n++; if (i.size >= s.max) { s.max = i.size; s.example = i.message; }
    stats.set(k, s);
  }
}
const first = run(genomes[0]!);
console.log(`mode: ${process.argv[3] ?? 'whole'}  default ${serialize(genomes[0]!)} -> ${first.level}`);
for (const i of first.issues) console.log(`   ${i.severity} ${i.message}`);
console.log(`\n${red} red, ${yellow} yellow, ${genomes.length - red - yellow} green of ${genomes.length}  (${((performance.now() - t0) / genomes.length).toFixed(1)} ms each)\n`);
for (const [k, s] of [...stats].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(s.n).padStart(4)}  ${k.padEnd(34)} max ${s.max.toFixed(1)}   e.g. ${s.example}`);
