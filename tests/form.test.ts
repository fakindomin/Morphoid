import { describe, expect, it } from 'vitest';
import { BLOCKS, defaultGenome, mulberry32, randomGenome, serialize, STEPS, surpriseGenome, parse } from '../src/core/genome';
import { dimensions as D, solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { buildParts3D } from '../src/core/art/spec3d';
import { LANG, langOf } from '../src/core/art/form';
import { blendOf } from '../src/core/bake/field';
import { BLEND_MM } from '../src/core/bake/bake';

const standing = (plan: number): boolean => plan === D.PLAN.quadruped || plan === D.PLAN.biped;

describe('form rules (Zasady formy Morphoidów)', () => {
  it('big, medium, small: the head of a standing creature is never a second ball as big as the body', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 1500; i++) {
      const g = randomGenome(r), rig = solveRig(g);
      if (!standing(rig.dims.plan) || rig.dims.build === 1 || rig.dims.build === 4) continue; // stick builds: thinner than any head
      expect(2 * rig.dims.headR, serialize(g)).toBeLessThan(rig.dims.bodyGirth + 3);
    }
  });

  it('gesture: a quadruped carries its chest above its hips and still stands on all four feet', () => {
    const rig = solveRig(defaultGenome());
    const n = rig.nodes;
    expect(n.shoulderF.y).toBeGreaterThan(n.hipB.y);
    for (const f of ['footFL', 'footFR', 'footBL', 'footBR'] as const) expect(n[f].y).toBeCloseTo(0, 6);
  });

  it('silhouette test: light under the belly of every standing creature', () => {
    const r = mulberry32(9);
    for (let i = 0; i < 2000; i++) {
      const g = randomGenome(r), rig = solveRig(g);
      if (rig.dims.plan !== D.PLAN.quadruped) continue;
      const belly = rig.nodes.torso.y - rig.dims.bodyGirth / 2 - 1.5;
      expect(belly, serialize(g)).toBeGreaterThan(D.BELLY_GAP_MM - 1);
    }
  });

  it('one exaggeration per creature: the dice push one feature to its extreme and keep the rest calm', () => {
    const r = mulberry32(21);
    for (let i = 0; i < 600; i++) {
      const g = surpriseGenome(r);
      const back = parse(serialize(g));
      expect(back.ok).toBe(true);
      let extreme = 0;
      for (const b of BLOCKS) for (const f of b.fields) if (f.kind === 'step' && g[b.id]![f.name] === STEPS - 1) extreme++;
      expect(extreme, serialize(g)).toBe(1);
    }
  });

  it('shape language follows the body plan, the build and the skull', () => {
    const lang = (edit: (g: ReturnType<typeof defaultGenome>) => void): number => { const g = defaultGenome(); edit(g); return langOf(g, solveRig(g)); };
    expect(lang((g) => { g.build!.type = 3; })).toBe(LANG.round);
    expect(lang((g) => { g.build!.type = 2; })).toBe(LANG.square);
    expect(lang((g) => { g.plan!.type = 3; })).toBe(LANG.sharp);
    expect(lang((g) => { g.head!.skull = 2; })).toBe(LANG.square);
  });

  it('blend hierarchy: body masses melt softly, small appendages join tightly, and the head carries its planes', () => {
    const g = defaultGenome(), rig = solveRig(g);
    const parts = buildParts3D(buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false), g, rig);
    const k = (slot: string): number => blendOf(parts.find((p) => p.slot === slot)!, BLEND_MM);
    expect(k('torso')).toBe(BLEND_MM);
    expect(k('ear')).toBeLessThan(BLEND_MM * 0.75);
    expect(parts.find((p) => p.slot === 'head')!.cuts?.length).toBeGreaterThan(0);
  });
});
