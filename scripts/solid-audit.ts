/** npx vite-node scripts/solid-audit.ts [N] [seed] : holes / shells / handles over N random Morphoids, whole AND modular (draft bake). */
import { defaultGenome, mulberry32, randomGenome, serialize, type MorphotypeGenome } from '../src/core/genome';
import { planModular, planWhole } from '../src/core/print';
import { bake } from '../src/core/bake/bake';

const N = Number(process.argv[2] ?? 300);
const rnd = mulberry32(Number(process.argv[3] ?? 2025));
const genomes: MorphotypeGenome[] = [defaultGenome(), ...Array.from({ length: N }, () => randomGenome(rnd))];
for (const [name, plan] of [['CAŁOŚĆ', planWhole()], ['MODUŁY', planModular()]] as const) {
  const t0 = performance.now();
  let notTight = 0, extraShells = 0, holes = 0, pieces = 0, closed = 0;
  const examples: string[] = [];
  for (const g of genomes) {
    for (const p of bake(g, plan, 'draft').pieces) {
      pieces++;
      const v = p.validation;
      closed += p.holesClosed;
      // a piece made of mirrored parts (ears, wings, whiskers, legs...) legitimately has one shell per part: only the body must be 1 shell
      if (!v.watertight) notTight++;
      if (p.id === 'body' && v.shells !== 1) { extraShells++; if (examples.length < 3) examples.push(`${serialize(g)} body shells ${v.shells}`); }
      if (v.genus !== 0) { holes++; if (examples.length < 6) examples.push(`${serialize(g)} ${p.id} holes ${v.genus}`); }
    }
  }
  console.log(`${name}: ${genomes.length} stworków / ${pieces} części, ${((performance.now() - t0) / 1000).toFixed(0)} s | nieszczelne: ${notTight} | korpus z dodatkowymi powłokami: ${extraShells} | części z otworami przelotowymi: ${holes} | zamknięte drobne otwory: ${closed}`);
  for (const e of examples) console.log('   ', e);
}
