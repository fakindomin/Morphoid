import { describe, expect, it } from 'vitest';
import { defaultGenome, mulberry32, parse, randomGenome, type MorphotypeGenome } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { buildParts3D } from '../src/core/art/spec3d';
import { touchesOf } from '../src/core/art/settle';

/** Settling (2026-10-20): elements of different kinds do not grow into each other (art/settle.ts). */
const overlaps = (g: MorphotypeGenome): string[] => {
  const rig = solveRig(g);
  const paths = buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false);
  return touchesOf(buildParts3D(paths, g, rig)).filter((t) => t.depth < 0).map((t) => `${t.a}/${t.b}`);
};

describe('settling: elements stay apart', () => {
  it('the ears of a horned creature make room for its horns', () => {
    const r = parse('MPH2:B03.22:L08.541:N03.16:H02.6:S03.2:E06.21:R03.42:W00.0:T03.53:U00:C04.3:O05.265:M03:Z01:V02.32:F01:D00.0:A00:G00:P09:J05:Y05:Q01:K02.63:X02.6123:I00.888888888');
    if (!r.ok) throw new Error(r.message);
    expect(overlaps(r.genome).filter((x) => x.includes('ear'))).toEqual([]);
  });

  it('spines leave room for the tail; many thick legs stay apart', () => {
    const g = defaultGenome();
    g.crest!.type = 3; g.crest!.scale = 5; g.legs!.count = 4; g.legs!.thick = 5;
    expect(overlaps(g)).toEqual([]);
  });

  it('an insect with hands holds them where its front legs were (a mantis)', () => {
    const g = defaultGenome();
    g.plan!.type = 3; g.hands!.type = 1; g.hands!.length = 2;
    expect(solveRig(g).dims.legPairs).toBe(2);
    expect(overlaps(g).filter((x) => x.includes('hands'))).toEqual([]);
  });

  it('most random creatures have nothing growing into anything else', { timeout: 300000 }, () => {
    const rnd = mulberry32(77);
    let bad = 0;
    for (let i = 0; i < 60; i++) if (overlaps(randomGenome(rnd)).length) bad++;
    // before settling about 70% of random creatures had a pair grown together; what is left gets a TOUCH warning
    expect(bad / 60).toBeLessThan(0.3);
  });
});
