import { describe, expect, it } from 'vitest';
import { defaultGenome, mulberry32, randomGenome } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths, SLOTS } from '../src/core/art/shapes';
import { buildParts3D, SPEC_3D } from '../src/core/art/spec3d';

const parts = (g: ReturnType<typeof defaultGenome>) => {
  const rig = solveRig(g);
  const paths = buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false);
  return { rig, paths, parts: buildParts3D(paths, g, rig) };
};

describe('3D contract: everything drawn in 2D exists in 3D', () => {
  it('every 2D slot has an explicit 3D decision', () => {
    const missing = SLOTS.map(([id]) => id).filter((id) => !(id in SPEC_3D));
    expect(missing, `2D slots with no 3D spec: ${missing.join(', ')}`).toEqual([]);
  });

  it('every non-empty solid slot yields at least one 3D part (mirror images and render-only excepted)', () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 150; i++) {
      const g = randomGenome(rnd);
      const { paths, parts: ps } = parts(g);
      const have = new Set(ps.map((p) => p.slot));
      for (const [id] of SLOTS) {
        if (SPEC_3D[id] === null) continue;
        if (!paths[id].empty) expect(have.has(id), `${solveRig(g).code}: ${id} drawn in 2D but missing in 3D`).toBe(true);
      }
    }
  });

  it('parts are finite, paired parts mirror in Z, thickness respects the plate rule', () => {
    const { parts: ps } = parts(defaultGenome());
    for (const p of ps) {
      expect(Number.isFinite(p.z) && Number.isFinite(p.thickness)).toBe(true);
      expect(p.bevel).toBeLessThanOrEqual(p.thickness / 2);
      for (const poly of p.polys) for (const [x, y] of poly) expect(Number.isFinite(x + y)).toBe(true);
    }
    const legs = ps.filter((p) => p.slot === 'legF');
    expect(legs.map((l) => l.z).sort()).toEqual([-legs[0]!.z, legs[0]!.z].sort());
    const wings = parts({ ...defaultGenome(), wings: { type: 2, scale: 3 } }).parts.filter((p) => p.slot === 'wingNear');
    expect(wings).toHaveLength(2);
    expect(wings[0]!.thickness).toBe(1.6);
  });
});
