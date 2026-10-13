import { mulberry32, randomGenome, serialize } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { analyzePrint, planWhole } from '../src/core/print';
const want = process.argv[2] ?? 'podbródek';
const rnd = mulberry32(7);
let found = 0;
for (let i = 0; i < 400 && found < 3; i++) {
  const g = randomGenome(rnd), rig = solveRig(g);
  const rep = analyzePrint(buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false), rig, planWhole());
  const hit = rep.issues.find((x) => x.severity === 'error' && x.part === want);
  if (hit) { console.log(serialize(g), hit.message); found++; }
}
