import { describe, expect, it } from 'vitest';
import { defaultGenome, parse, serialize, type MorphotypeGenome } from '../src/core/genome';
import { planModular, planWhole } from '../src/core/print';
import { bake } from '../src/core/bake/bake';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { buildParts3D } from '../src/core/art/spec3d';
import { partBox } from '../src/core/bake/field';

/** Spread wings (2026-10-20): gene W's third digit leans the wings out sideways from upright. */
const winged = (type: number, spread: number): MorphotypeGenome => {
  const g = defaultGenome();
  g.wings!.type = type; g.wings!.scale = 3; g.wings!.spread = spread;
  return g;
};
const wingBox = (g: MorphotypeGenome) => {
  const rig = solveRig(g);
  const parts = buildParts3D(buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false), g, rig);
  return partBox(parts.find((p) => p.slot === 'wingNear' && p.side > 0)!);
};

describe('spread wings', () => {
  it('the spread round-trips; codes written before it read as upright wings', () => {
    const g = winged(1, 2);
    const r = parse(serialize(g));
    expect(r.ok && serialize(r.genome)).toBe(serialize(g));
    const old = parse(serialize(g).split('#')[0]!.replace(/:W(\d\d\.\d)\d/, ':W$1'));
    expect(old.ok && old.genome.wings!.spread).toBe(0);
  });

  it('a spread wing reaches further out and less high than an upright one', () => {
    const up = wingBox(winged(2, 0)), wide = wingBox(winged(2, 2));
    expect(wide.hi[2]).toBeGreaterThan(up.hi[2] + 5);
    expect(wide.hi[1]).toBeLessThan(up.hi[1]);
  });

  it('spread wings bake watertight, whole and as separate pieces', { timeout: 300000 }, () => {
    const bad: string[] = [];
    for (const [type, spread] of [[1, 1], [2, 2]] as const) for (const [plan, whole] of [[planWhole(), true], [planModular(), false]] as const) {
      for (const piece of bake(winged(type, spread), plan, 'draft').pieces) {
        const v = piece.validation; // (a pair printed separately is two shells)
        if (!v.watertight || (whole && v.shells !== 1) || v.genus !== 0) bad.push(`${type}/${spread} ${piece.id}: watertight ${v.watertight}, shells ${v.shells}, holes ${v.genus}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
