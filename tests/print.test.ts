import { describe, expect, it } from 'vitest';
import { BLOCKS, defaultGenome, mulberry32, randomGenome } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths, SLOTS } from '../src/core/art/shapes';
import {
  GROUPS, PARTS, PRINT_SOLID_SLOTS, RENDER_ONLY_SLOTS, analyzePrint, fitPlan, planKind, planModular, planWhole,
  type PrintReport,
} from '../src/core/print';

const geometry = (g: ReturnType<typeof defaultGenome>) => {
  const rig = solveRig(g);
  return { rig, paths: buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false) };
};

describe('element contract: 2D <-> 3D <-> print', () => {
  it('every 2D slot is either a catalogued printable part or explicitly render-only', () => {
    const covered = new Set<string>([...PARTS.flatMap((p) => p.slots), ...RENDER_ONLY_SLOTS]);
    const missing = SLOTS.map(([id]) => id).filter((id) => !covered.has(id));
    expect(missing, `2D elements without a 3D/print spec: ${missing.join(', ')}`).toEqual([]);
  });

  it('every visible genome block has a part spec (palette is colour only)', () => {
    const blocks = new Set(PARTS.flatMap((p) => p.blocks));
    const missing = BLOCKS.map((b) => b.id).filter((b) => b !== 'palette' && !blocks.has(b));
    expect(missing).toEqual([]);
  });

  it('solid parts and split groups only reference real slots', () => {
    const ids = new Set<string>(SLOTS.map(([id]) => id));
    for (const s of [...PRINT_SOLID_SLOTS, ...GROUPS.flatMap((g) => g.slots)]) expect(ids.has(s), s).toBe(true);
  });

  it('plan kinds', () => {
    expect(planKind(planWhole())).toBe('whole');
    expect(planKind(planModular())).toBe('modular');
  });
});

const errorsOf = (r: PrintReport) => r.issues.filter((i) => i.severity === 'error').map((i) => i.message);

describe('print audit (Bambu P1S profile)', () => {
  it('the default Morphoid prints whole, needing supports only under the belly', () => {
    const { rig, paths } = geometry(defaultGenome());
    const rep = analyzePrint(paths, rig, planWhole());
    expect(errorsOf(rep)).toEqual([]);
    expect(rep.level).toBe('blue'); // round body => slicer supports, no problems
    expect(rep.issues.every((i) => i.severity === 'support' || i.severity === 'info')).toBe(true);
  });

  it('with supports avoided the round belly is reported as a real problem', () => {
    const { rig, paths } = geometry(defaultGenome());
    const rep = analyzePrint(paths, rig, { ...planWhole(), supports: 'avoid' });
    expect(rep.issues.some((i) => i.part.includes('brzuch') && (i.severity === 'warn' || i.severity === 'error'))).toBe(true);
  });

  it('100 random Morphoids print whole (supports allowed) without errors', { timeout: 60000 }, () => {
    const rnd = mulberry32(31);
    for (let i = 0; i < 100; i++) {
      const g = randomGenome(rnd);
      const { rig, paths } = geometry(g);
      expect(errorsOf(analyzePrint(paths, rig, planWhole())), rig.code).toEqual([]);
    }
  });

  it('every build and body plan prints whole without errors (40 random creatures each)', { timeout: 60000 }, () => {
    const rnd = mulberry32(33);
    for (let k = 0; k < 11; k++) for (let i = 0; i < 40; i++) {
      const g = randomGenome(rnd);
      if (k < 5) g.build!.type = k; else g.plan!.type = k - 5;
      const { rig, paths } = geometry(g);
      expect(rig.issues, rig.code).toEqual([]);
      expect(errorsOf(analyzePrint(paths, rig, planWhole())), rig.code).toEqual([]);
    }
  });

  it('a biped that would tip over gets a warning, and a stand fixes it', () => {
    const rnd = mulberry32(6);
    let tipped = 0;
    for (let i = 0; i < 200; i++) {
      const g = randomGenome(rnd); g.plan!.type = 1; g.stand!.type = 0;
      const { rig, paths } = geometry(g);
      if (!analyzePrint(paths, rig, planWhole()).issues.some((x) => x.code === 'BALANCE')) continue;
      tipped++;
      g.stand!.type = 1;
      const after = geometry(g);
      expect(analyzePrint(after.paths, after.rig, planWhole()).issues.filter((x) => x.code === 'BALANCE'), after.rig.code).toEqual([]);
    }
    expect(tipped).toBeGreaterThan(0);
    // a quadruped stands on its own
    const { rig, paths } = geometry(defaultGenome());
    expect(analyzePrint(paths, rig, planWhole()).issues.filter((x) => x.code === 'BALANCE')).toEqual([]);
  });

  it('100 random Morphoids print as modular parts without errors (too-small parts are fused back)', { timeout: 60000 }, () => {
    const rnd = mulberry32(32);
    for (let i = 0; i < 100; i++) {
      const g = randomGenome(rnd);
      const { rig, paths } = geometry(g);
      const plan = fitPlan(paths, rig, planModular());
      const rep = analyzePrint(paths, rig, plan);
      expect(errorsOf(rep), rig.code).toEqual([]);
      for (const piece of rep.pieces.filter((p) => p.kind === 'part')) expect(piece.peg, `${rig.code} ${piece.id}`).not.toBeNull();
    }
  });

  it('whiskers are always a separate part (a horizontal plate, printed as it lies) with a peg pad', () => {
    const g = defaultGenome();
    g.face!.whiskers = 2;
    const { rig, paths } = geometry(g);
    const rep = analyzePrint(paths, rig, planWhole());
    const w = rep.pieces.find((p) => p.id === 'whiskers');
    expect(w?.orientation).toBe('upright'); // they stick out sideways: their large face is already horizontal
    expect(w?.peg).not.toBeNull();
  });

  it('catches a real defect: a long horizontal bridge is reported', () => {
    const g = defaultGenome();
    g.legs!.length = 0;
    const { rig, paths } = geometry(g);
    const wide = analyzePrint(paths, rig, { ...planWhole(), maxBridge: 1, supports: 'avoid' });
    expect(wide.issues.some((i) => i.code === 'BRIDGE' || i.code === 'OVERHANG')).toBe(true);
  });
});

describe('design policy: elements are support-free by default, deviations are detectable', () => {
  const avoid = { ...planWhole(), supports: 'avoid' as const };
  const area = (g: ReturnType<typeof defaultGenome>): number => {
    const { rig, paths } = geometry(g);
    return analyzePrint(paths, rig, avoid).supportArea;
  };
  const base = area(defaultGenome());
  const withField = (block: 'ears' | 'horns' | 'wings' | 'crest' | 'tail' | 'snout', type: number, stepField: string, step: number) => {
    const g = defaultGenome();
    g[block]!.type = type;
    g[block]![stepField] = step;
    return g;
  };

  it('ears, horns, wings, crest and tail add NO supports in any variant at any of the 6 sizes', () => {
    const cases: ['ears' | 'horns' | 'wings' | 'crest' | 'tail', number, string][] = [
      ['ears', 3, 'scale'], ['horns', 4, 'span'], ['wings', 2, 'scale'], ['crest', 3, 'scale'], ['tail', 3, 'length'],
    ];
    for (const [block, variants, stepField] of cases) {
      for (let v = 1; v <= variants; v++) for (let s = 0; s < 6; s++) {
        expect(area(withField(block, v, stepField, s)) - base, `${block} variant ${v} size ${s + 1}`).toBeLessThanOrEqual(25);
      }
    }
  });

  it('the default-size muzzle needs no supports, a long muzzle does (so the app can warn)', () => {
    for (const type of [0, 1, 2]) {
      expect(area(withField('snout', type, 'reach', 2)) - base, `snout ${type} default`).toBeLessThanOrEqual(25);
      expect(area(withField('snout', type, 'reach', 5)) - base, `snout ${type} longest`).toBeGreaterThan(100);
    }
  });

  it('splitting the offending part away removes the need for supports', () => {
    const g = withField('snout', 1, 'reach', 5);
    const { rig, paths } = geometry(g);
    const whole = analyzePrint(paths, rig, avoid);
    const split = analyzePrint(paths, rig, { ...avoid, separate: [...avoid.separate, 'head'] });
    expect(split.supportArea).toBeLessThan(whole.supportArea);
  });
});

describe('no slits: every element, variant and size has clean outlines', () => {
  it('no real slit (> 2.5 mm2) narrower than 0.9 mm in any outline (hairline V roots are closed by the bake)', { timeout: 120000 }, () => {
    const cases: ['ears' | 'horns' | 'wings' | 'crest' | 'tail' | 'snout', number, string][] = [
      ['ears', 3, 'scale'], ['horns', 4, 'span'], ['wings', 2, 'scale'], ['crest', 3, 'scale'], ['tail', 3, 'length'], ['snout', 2, 'reach'],
    ];
    const slits: string[] = [];
    for (const [block, variants, stepField] of cases) {
      for (let v = block === 'snout' ? 0 : 1; v <= variants; v++) for (let s = 0; s < 6; s++) {
        const g = defaultGenome();
        g[block]!.type = v; g[block]![stepField] = s;
        const { rig, paths } = geometry(g);
        for (const i of analyzePrint(paths, rig, planWhole()).issues) if (i.code === 'SLIT' && i.size > 2.5) slits.push(`${block} variant ${v} size ${s + 1}: ${i.message}`);
      }
    }
    for (let foot = 0; foot < 3; foot++) {
      const g = defaultGenome(); g.legs!.foot = foot;
      const { rig, paths } = geometry(g);
      for (const i of analyzePrint(paths, rig, planWhole()).issues) if (i.code === 'SLIT' && i.size > 2.5) slits.push(`foot ${foot}: ${i.message}`);
    }
    expect(slits).toEqual([]);
  });
});
