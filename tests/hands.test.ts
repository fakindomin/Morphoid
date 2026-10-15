import { describe, expect, it } from 'vitest';
import { defaultGenome, mulberry32, randomGenome } from '../src/core/genome';
import { dimensions as D, solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { buildParts3D } from '../src/core/art/spec3d';
import { analyzePrint, planWhole } from '../src/core/print';
import { bake } from '../src/core/bake/bake';

const withHands = (g: ReturnType<typeof defaultGenome>, type: number, length: number, dir: number) => {
  g.hands = { type, length, dir };
  return g;
};

describe('arms with hands (gene X)', () => {
  it('every hand on every body plan that has a chest: drawn, solid in 3D, clear of the bed, no print errors', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 300; i++) {
      const g = withHands(randomGenome(r), 1 + (i % 3), Math.floor(r() * 6), Math.floor(r() * 3));
      const rig = solveRig(g), plan = rig.dims.plan;
      const paths = buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false);
      const hands = paths.hands.flatten(6).flat();
      if (!D.hasArms(plan)) { expect(hands.length).toBe(0); continue; }
      expect(hands.length).toBeGreaterThan(0);
      expect(Math.min(...hands.map(([, y]) => y)), 'the hand stays off the bed').toBeGreaterThan(1);
      const parts = buildParts3D(paths, g, rig).filter((p) => p.slot === 'hands');
      expect(parts.map((p) => Math.sign(p.z)).sort()).toEqual([-1, 1]);
      for (const p of parts) expect(p.limb?.cones.length).toBeGreaterThan(3);
      const errors = analyzePrint(paths, rig, planWhole()).issues.filter((x) => x.severity === 'error' && (x.slot === 'hands' || x.slot === 'handsFar'));
      expect(errors.map((x) => x.message), rig.code).toEqual([]);
    }
  });

  it('a creature holding out its hands bakes into one watertight piece', () => {
    for (const type of [1, 2, 3]) {
      const g = withHands(defaultGenome(), type, 3, 0);
      const body = bake(g, planWhole(), 'draft').pieces.find((p) => p.id === 'body')!.validation;
      expect(body.watertight, `hand ${type}`).toBe(true);
      expect(body.shells, `hand ${type}: the arms are attached`).toBe(1);
    }
  });
});
