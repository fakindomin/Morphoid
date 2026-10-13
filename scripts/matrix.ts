/** npx vite-node scripts/matrix.ts : which element variants x sizes need supports (support area per part, mm^2). */
import { defaultGenome, BLOCKS, setField, type BlockId } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { analyzePrint, planWhole } from '../src/core/print';

const plan = { ...planWhole(), supports: 'avoid' as const };
const area = (g: ReturnType<typeof defaultGenome>) => {
  const rig = solveRig(g);
  const rep = analyzePrint(buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false), rig, plan);
  const m = new Map<string, number>();
  for (const i of rep.issues) if (i.area) m.set(i.part, (m.get(i.part) ?? 0) + i.area);
  return m;
};
const base = area(defaultGenome());
console.log('default creature needs supports under:', [...base].map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ') || 'nothing');

const rows: [BlockId, string, string][] = [
  ['ears', 'type', 'scale'], ['horns', 'type', 'span'], ['wings', 'type', 'scale'], ['crest', 'type', 'scale'],
  ['tail', 'type', 'length'], ['snout', 'type', 'reach'], ['head', 'neck', 'neckLength'],
];
for (const [block, typeF, stepF] of rows) {
  const def = BLOCKS.find((b) => b.id === block)!;
  const tf = def.fields.find((f) => f.name === typeF)!;
  if (tf.kind !== 'enum') continue;
  for (let v = 0; v < tf.options.length; v++) {
    if (tf.options[v]!.id === 'none') continue;
    const cells: string[] = [];
    for (let s = 0; s < 6; s++) {
      let g = setField(defaultGenome(), block, typeF, v);
      g = setField(g, block, stepF, s);
      const a = area(g);
      const extra = [...a].map(([k, val]) => [k, val - (base.get(k) ?? 0)] as const).filter(([, d]) => d > 4);
      cells.push(extra.length ? extra.map(([k, d]) => `${k}+${d.toFixed(0)}`).join('/') : '.');
    }
    console.log(`${block}.${tf.options[v]!.id}`.padEnd(18), cells.map((c) => c.padEnd(16)).join(' '));
  }
}
