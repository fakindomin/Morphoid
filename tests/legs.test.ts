import { describe, expect, it } from 'vitest';
import { defaultGenome, parse, serialize, type MorphotypeGenome } from '../src/core/genome';
import { planWhole } from '../src/core/print';
import { analyzePrint } from '../src/core/print';
import { bake } from '../src/core/bake/bake';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';

/** Block 2 (2026-10-20): 2/4/6/8 legs on every plan with legs, a fish on legs, hands on a fish and an octopus, and a
 * right arm posed apart from the left. */
const PLAN = { quadruped: 0, biped: 1, caterpillar: 2, insect: 3, fish: 4, octopus: 5, humanoid: 6 } as const;
const COUNT = { plan: 0, two: 1, four: 2, six: 3, eight: 4 } as const;

const make = (plan: number, count: number, f?: (g: MorphotypeGenome) => void): MorphotypeGenome => {
  const g = defaultGenome();
  g.plan!.type = plan; g.legs!.count = count;
  f?.(g);
  return g;
};
const paths = (g: MorphotypeGenome) => { const rig = solveRig(g); return { rig, paths: buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false) }; };

describe('leg count: DNA', () => {
  it('count and the right arm round-trip; codes written before block 2 read as the body plan and one pose', () => {
    const g = make(PLAN.quadruped, COUNT.six, (x) => { x.hands!.type = 1; x.hands!.dir = 1; x.hands!.dir2 = 3; });
    const r = parse(serialize(g));
    expect(r.ok && serialize(r.genome)).toBe(serialize(g));
    const old = serialize(g).split('#')[0]!.replace(/:L(\d\d\.\d{2})\d/, ':L$1').replace(/:X(\d\d\.\d{3})\d/, ':X$1');
    const o = parse(old);
    expect(o.ok).toBe(true);
    if (o.ok) { expect(o.genome.legs!.count).toBe(COUNT.plan); expect(o.genome.hands!.dir2).toBe(0); }
  });
});

describe('leg count: rig', () => {
  it('pairs follow the plan unless a count is set; an octopus never has legs', () => {
    const pairs = (plan: number, count: number) => solveRig(make(plan, count)).dims.legPairs;
    expect(pairs(PLAN.quadruped, COUNT.plan)).toBe(2);
    expect(pairs(PLAN.biped, COUNT.plan)).toBe(1);
    expect(pairs(PLAN.insect, COUNT.plan)).toBe(3);
    expect(pairs(PLAN.fish, COUNT.plan)).toBe(0);
    expect(pairs(PLAN.fish, COUNT.four)).toBe(2);
    expect(pairs(PLAN.quadruped, COUNT.eight)).toBe(4);
    expect(pairs(PLAN.biped, COUNT.four)).toBe(2);
    expect(pairs(PLAN.octopus, COUNT.eight)).toBe(0);
    for (const plan of Object.values(PLAN)) for (const count of Object.values(COUNT)) expect(solveRig(make(plan, count)).issues, `${plan}/${count}`).toEqual([]);
  });
});

describe('leg count: drawing', () => {
  it('a fish on legs has legs, a plain fish none; more pairs fill the front slot', () => {
    expect(paths(make(PLAN.fish, COUNT.plan)).paths.legB.empty).toBe(true);
    expect(paths(make(PLAN.fish, COUNT.four)).paths.legB.empty).toBe(false);
    expect(paths(make(PLAN.biped, COUNT.plan)).paths.legF.empty).toBe(true);
    expect(paths(make(PLAN.biped, COUNT.six)).paths.legF.empty).toBe(false);
  });

  it('a fish and an octopus get hands; the right arm can take its own pose', () => {
    for (const plan of [PLAN.fish, PLAN.octopus]) expect(paths(make(plan, 0, (g) => { g.hands!.type = 1; g.hands!.length = 2; })).paths.hands.empty).toBe(false);
    const same = paths(make(PLAN.quadruped, 0, (g) => { g.hands!.type = 1; g.hands!.length = 2; }));
    const up = paths(make(PLAN.quadruped, 0, (g) => { g.hands!.type = 1; g.hands!.length = 2; g.hands!.dir2 = 2; }));
    expect(up.paths.hands.flatten(8)).toEqual(same.paths.hands.flatten(8));
    expect(up.paths.handsFar.flatten(8)).not.toEqual(same.paths.handsFar.flatten(8));
  });
});

describe('leg count: the creatures still print', () => {
  const CASES: [string, MorphotypeGenome][] = [
    ['quadruped 2', make(PLAN.quadruped, COUNT.two)],
    ['quadruped 8', make(PLAN.quadruped, COUNT.eight)],
    ['biped 4', make(PLAN.biped, COUNT.four)],
    ['humanoid 6', make(PLAN.humanoid, COUNT.six)],
    ['fish 4', make(PLAN.fish, COUNT.four)],
    ['insect 8', make(PLAN.insect, COUNT.eight)],
    ['insect 2', make(PLAN.insect, COUNT.two)],
    ['caterpillar 4', make(PLAN.caterpillar, COUNT.four)],
    ['octopus with hands', make(PLAN.octopus, 0, (g) => { g.hands!.type = 1; g.hands!.length = 2; })],
    ['fish with hands', make(PLAN.fish, 0, (g) => { g.hands!.type = 3; g.hands!.length = 2; })],
    ['one arm raised', make(PLAN.biped, 0, (g) => { g.hands!.type = 1; g.hands!.length = 2; g.hands!.dir2 = 2; })],
  ];
  it('each bakes to one watertight shell without holes and prints whole without errors', { timeout: 300000 }, () => {
    const bad: string[] = [];
    for (const [label, g] of CASES) {
      const { rig, paths: p } = paths(g);
      const errs = analyzePrint(p, rig, planWhole()).issues.filter((i) => i.severity === 'error').map((i) => i.message);
      if (errs.length) bad.push(`${label}: ${errs.join('; ')}`);
      for (const piece of bake(g, planWhole(), 'draft').pieces) {
        const v = piece.validation;
        if (!v.watertight || (v.shells !== 1 && piece.id !== 'whiskers') || v.genus !== 0) bad.push(`${label} ${piece.id}: watertight ${v.watertight}, shells ${v.shells}, holes ${v.genus}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
