import { describe, expect, it } from 'vitest';
import { PRESETS, presetGenome } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { buildParts3D } from '../src/core/art/spec3d';
import { projectViews, spanAt, VIEWS } from '../src/core/art/views';

const extent = (rings: (readonly (readonly [number, number])[])[][]): { u: number; v: number } => {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const r of rings.flat()) for (const [u, v] of r) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  return { u: u1 - u0, v: v1 - v0 };
};

describe('2D views (side, front, top)', () => {
  const g = presetGenome(PRESETS.find((p) => p.id === 'dog')!);
  const rig = solveRig(g);
  const parts = buildParts3D(buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false), g, rig);
  const views = projectViews(parts);

  it('shows the body in every view, each part with its own outline', () => {
    for (const v of VIEWS) {
      expect(views[v].some((p) => p.slot === 'torso')).toBe(true);
      for (const p of views[v]) expect(p.rings[0]!.length).toBeGreaterThan(3);
    }
  });

  it('is as long as the creature from the side and from above, as wide from the front', () => {
    const side = extent(views.side.map((p) => p.rings)), front = extent(views.front.map((p) => p.rings)), top = extent(views.top.map((p) => p.rings));
    expect(Math.abs(side.u - top.u)).toBeLessThan(2);   // length
    expect(Math.abs(side.v - front.v)).toBeLessThan(2); // height
    expect(Math.abs(front.u - top.v)).toBeLessThan(2);  // width
    expect(front.u).toBeLessThan(side.u);
  });

  it('knows how deep each part reaches under a point of its view', () => {
    const torso = views.front.find((p) => p.slot === 'torso')!;
    const r = torso.rings[0]!;
    const c = r.reduce((s, q) => [s[0] + q[0] / r.length, s[1] + q[1] / r.length], [0, 0]);
    const span = spanAt(torso.map, c[0], c[1]);
    expect(span).not.toBeNull();
    expect(span![0]).toBeGreaterThan(span![1]); // the near surface (from ahead: +x) is in front of the far one
  });
});
