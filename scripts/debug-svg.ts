/** npx vite-node scripts/debug-svg.ts <MPH code|default> out.svg : solid parts + issue markers, in mm. */
import { writeFileSync } from 'node:fs';
import { defaultGenome, parse } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { analyzePrint, PRINT_SOLID_SLOTS } from '../src/core/print';

const arg = process.argv[2] ?? 'default';
const g = arg === 'default' ? defaultGenome() : (parse(arg) as { ok: true; genome: ReturnType<typeof defaultGenome> }).genome;
const rig = solveRig(g);
const paths = buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false);
const rep = analyzePrint(paths, rig);
const S = 8, X0 = 60, H = 90;
const to = (x: number, y: number) => [(X0 - x) * S, (H - y) * S] as const;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(X0 + 80) * S}" height="${(H + 4) * S}" style="background:#fff">`;
svg += `<line x1="0" x2="${(X0 + 80) * S}" y1="${H * S}" y2="${H * S}" stroke="#08f" stroke-width="2"/>`;
for (const id of PRINT_SOLID_SLOTS) {
  const d = paths[id].d(to);
  if (d) svg += `<path d="${d}" fill="#9cb" fill-opacity=".55" stroke="#243" stroke-width="1"/>`;
}
for (const i of rep.issues) {
  const [x, y] = to(...i.at);
  svg += `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="red" stroke-width="3"/><text x="${x + 12}" y="${y}" font-size="14" fill="red">${i.code} ${i.part} ${i.size.toFixed(1)}</text>`;
}
writeFileSync(process.argv[3] ?? 'debug.svg', svg + '</svg>');
console.log(rep.issues.map((i) => `${i.code} ${i.part} @${i.at.map((v) => v.toFixed(1))} ${i.size.toFixed(1)}`).join('\n'));
