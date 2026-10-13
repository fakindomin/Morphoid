/** Ablation: which slot, when removed, repairs a body that has extra shells or holes? */
import { readFileSync } from 'node:fs';
import { parse } from '../src/core/genome';
import { planWhole, pieceOf } from '../src/core/print';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths, type SlotId } from '../src/core/art/shapes';
import { buildParts3D, type Part3D } from '../src/core/art/spec3d';
import { addPart, makeGrid } from '../src/core/bake/field';
import { meshWithRepair, BLEND_MM } from '../src/core/bake/bake';

const rows = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { code: string; shells: number; genus: number }[];
const kind = process.argv[3] ?? 'shells';
const bakeBody = (parts: Part3D[]) => {
  const grid = makeGrid(parts, 0.6); for (const p of parts) addPart(grid, p, BLEND_MM);
  return meshWithRepair(grid).validation;
};
const blame = new Map<string, number>();
let n = 0;
for (const row of rows.filter((r) => (kind === 'shells' ? r.shells !== 1 : r.genus !== 0))) {
  const g = (parse(row.code) as { ok: true; genome: ReturnType<typeof import('../src/core/genome').defaultGenome> }).genome;
  const rig = solveRig(g);
  const all = buildParts3D(buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false), g, rig)
    .filter((p) => p.thickness >= 0.8 && pieceOf(p.slot as SlotId, planWhole()) === 'body');
  const slots = [...new Set(all.map((p) => p.slot))];
  const culprits: string[] = [];
  for (const s of slots) {
    const v = bakeBody(all.filter((p) => p.slot !== s));
    const ok = kind === 'shells' ? v.shells === 1 : v.genus === 0;
    if (ok) culprits.push(s);
  }
  const key = culprits.length ? culprits.join('+') : '(no single slot)';
  blame.set(key, (blame.get(key) ?? 0) + 1);
  if (++n >= 60) break;
}
console.log(`${kind}: ablation over ${n} failing creatures`);
for (const [k, c] of [...blame].sort((a, b) => b[1] - a[1])) console.log(String(c).padStart(4), k);
