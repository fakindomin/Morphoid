import { describe, expect, it } from 'vitest';
import { mulberry32, randomGenome } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { buildShapes, SLOTS } from '../src/core/art/shapes';
import { targetPose } from '../src/core/art/pose';

describe('2D artwork', () => {
  it('produces finite path data for 1500 random genomes, incl. breathing and mouse offsets', () => {
    const rnd = mulberry32(2024);
    const to = (x: number, y: number) => [370 - x * 3.6, 440 - y * 3.6] as const;
    for (let i = 0; i < 1500; i++) {
      const g = randomGenome(rnd);
      const rig = solveRig(g);
      const pose = targetPose(rig, g, i * 0.37, i % 2 === 0, { x: 1.2, y: -0.8 });
      const shapes = buildShapes(pose, g, rig, to, true);
      for (const [id] of SLOTS) {
        expect(shapes[id], `${rig.code}:${id}`).not.toMatch(/NaN|Infinity/);
      }
      expect(shapes.torso.length).toBeGreaterThan(10);
      if (rig.dims.plan === 0) expect(shapes.legF.length).toBeGreaterThan(10); // bipeds have no front legs
    }
  });

  it('feet stay on the bed in the display pose even while breathing', () => {
    const g = randomGenome(mulberry32(8));
    const rig = solveRig(g);
    for (let t = 0; t < 20; t += 0.7) {
      const pose = targetPose(rig, g, t, true, { x: 2, y: 2 });
      for (const id of ['footFL', 'footFR', 'footBL', 'footBR'] as const) if (rig.nodes[id].contact) expect(pose.pos[id][1]).toBeCloseTo(0, 9);
    }
  });
});
