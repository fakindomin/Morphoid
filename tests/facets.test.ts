import { describe, expect, it } from 'vitest';
import { defaultGenome, mulberry32, randomGenome } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { facetsOf, resample, FACET_N } from '../src/core/art/facets';
import type { XY } from '../src/core/art/path';
import { analyzePrint, HEAT, heatAt, planWhole } from '../src/core/print';

const area = (t: readonly XY[]): number => Math.abs((t[1]![0] - t[0]![0]) * (t[2]![1] - t[0]![1]) - (t[2]![0] - t[0]![0]) * (t[1]![1] - t[0]![1])) / 2;
const polyArea = (p: readonly XY[]): number => { let a = 0; for (let i = 0; i < p.length; i++) { const u = p[i]!, v = p[(i + 1) % p.length]!; a += u[0] * v[1] - v[0] * u[1]; } return Math.abs(a) / 2; };

describe('faceted sketch', () => {
  it('cuts every outline into the same pattern, covering it exactly', () => {
    const ellipse: XY[] = Array.from({ length: 40 }, (_, i) => [20 * Math.cos((i / 40) * 2 * Math.PI), 8 * Math.sin((i / 40) * 2 * Math.PI)] as XY);
    const ring = resample(ellipse, FACET_N, [0, -100]);
    expect(ring).toHaveLength(FACET_N);
    const f = facetsOf(ring, 3);
    expect(f).toHaveLength(2 * FACET_N - 4);
    // the strip fills a convex outline without gaps or overlaps
    expect(f.reduce((s, x) => s + area(x.pts), 0)).toBeCloseTo(polyArea(ring), 6);
    // the same shape a little bigger keeps the same facets, only scaled
    const g = facetsOf(resample(ellipse.map(([x, y]) => [x * 1.1, y * 1.1] as XY), FACET_N, [0, -100]), 3);
    expect(g.map((x) => x.seed)).toEqual(f.map((x) => x.seed));
  });

  it('starts the cut at the far end of a part (a tail at its tip)', () => {
    const tail: XY[] = [[0, 0], [30, 2], [30, 4], [0, 6]];
    expect(resample(tail, FACET_N, [-10, 3])[0]![0]).toBeGreaterThan(29);
  });

  it('maps print problems to where they are: the bed under the feet, supports under the belly', () => {
    for (const seed of [1, 2, 3]) {
      const g = seed === 1 ? defaultGenome() : randomGenome(mulberry32(seed));
      const rig = solveRig(g);
      const paths = buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false);
      const rep = analyzePrint(paths, rig, planWhole());
      expect(rep.heat.length).toBeGreaterThan(0);
      const cells = rep.heat.flatMap((h) => [...h.st]);
      expect(cells.some((v) => v === HEAT.bed)).toBe(true);
      if (rep.issues.some((i) => i.code === 'OVERHANG' && i.severity === 'support')) {
        const o = rep.issues.find((i) => i.code === 'OVERHANG')!;
        // the issue's own spot is coloured as needing supports
        expect(heatAt(rep.heat, o.at[0], o.at[1])).toBeGreaterThanOrEqual(HEAT.support);
      }
      // nothing in the air above the creature
      expect(heatAt(rep.heat, 0, 500)).toBe(HEAT.none);
    }
  });
});
