/** npx vite-node scripts/bake-bench.ts : bake time / mesh size per quality for the default Morphoid and a random one. */
import { defaultGenome, mulberry32, randomGenome } from '../src/core/genome';
import { planWhole } from '../src/core/print';
import { bake, type BakeQuality } from '../src/core/bake/bake';
import { toBinaryStl } from '../src/core/bake/mesh';

const rnd = mulberry32(3);
for (const [name, g] of [['default', defaultGenome()], ['random', randomGenome(rnd)]] as const) {
  for (const q of ['draft', 'standard', 'fine'] as BakeQuality[]) {
    const r = bake(g, planWhole(), q);
    const p = r.pieces[0]!;
    console.log(name.padEnd(8), q.padEnd(9), `${r.ms.toFixed(0).padStart(6)} ms`, `${p.validation.triangles.toString().padStart(8)} tris`,
      `${(toBinaryStl(p.mesh).length / 1e6).toFixed(1)} MB`, `vol ${p.validation.volume.toFixed(1)} cm3`, p.validation.watertight ? 'watertight' : 'BAD', 'shells', p.validation.shells);
  }
}
