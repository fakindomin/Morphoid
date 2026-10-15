import { describe, expect, it } from 'vitest';
import { defaultGenome, parse, serialize, type MorphotypeGenome } from '../src/core/genome';
import { planWhole } from '../src/core/print';
import { bake } from '../src/core/bake/bake';
import { solveRig } from '../src/core/rig';

/** The size sliders (2026-10-15): new size digits at the end of genes, extremes that still print. */
const NEW_DIGITS: [string, number][] = [['L', 1], ['N', 1], ['H', 0], ['O', 2], ['V', 1], ['D', 0], ['X', 2]];

/** A code as written before the sliders: the genes without their new last digit. */
function legacy(code: string): string {
  const body = code.split('#')[0]!.split(':').map((tok) => {
    const old = NEW_DIGITS.find(([l]) => tok.startsWith(l));
    if (!old) return tok;
    const [head, digits = ''] = tok.split('.');
    return old[1] === 0 ? head! : `${head}.${digits.slice(0, old[1])}`;
  });
  return body.join(':');
}

describe('size sliders: DNA', () => {
  it('an old code (without the new size digits) loads as it looked, whatever creature is on screen', () => {
    const g = defaultGenome();
    g.face!.whiskers = 2; g.face!.whiskerSize = 2; g.coat!.pattern = 1; g.coat!.patternSize = 2;
    g.hands!.type = 1; g.hands!.length = 2; g.hands!.thick = 2;
    const old = legacy(serialize(g));
    expect(old).not.toContain('H01.');
    const base = defaultGenome();
    base.head!.size = 5; base.face!.eyeSize = 0; base.legs!.thick = 5; base.head!.neckThick = 0;
    const r = parse(old, base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(serialize(r.genome)).toBe(serialize(g));
  });

  it('the new sizes round-trip through the code', () => {
    const g = defaultGenome();
    g.face!.whiskers = 1; g.coat!.pattern = 2; g.hands!.type = 2;
    Object.assign(g.head!, { size: 5, neckThick: 0 });
    Object.assign(g.face!, { eyeSize: 4, whiskerSize: 0 });
    Object.assign(g.legs!, { thick: 5 });
    Object.assign(g.hands!, { thick: 0 });
    Object.assign(g.coat!, { patternSize: 5 });
    const r = parse(serialize(g));
    expect(r.ok && serialize(r.genome)).toBe(serialize(g));
  });
});

const solid = (label: string, g: MorphotypeGenome, bad: string[]): void => {
  if (solveRig(g).issues.length) bad.push(`${label}: rig ${solveRig(g).issues.join(',')}`);
  for (const p of bake(g, planWhole(), 'draft').pieces) {
    const x = p.validation;
    // the whiskers print apart from the body: one set per side may come out as two pieces
    if (!x.watertight || (x.shells !== 1 && p.id !== 'whiskers') || x.genus !== 0) bad.push(`${label} ${p.id}: watertight ${x.watertight}, shells ${x.shells}, holes ${x.genus}`);
  }
};

describe('size sliders: the extremes still print', () => {
  const dressed = (): MorphotypeGenome => {
    const g = defaultGenome();
    g.face!.whiskers = 2; g.face!.whiskerSize = 2; g.coat!.pattern = 2; g.coat!.patternSize = 2;
    return g;
  };
  const FIELDS: [string, (g: MorphotypeGenome, s: number) => void][] = [
    ['head size', (g, s) => { g.head!.size = s; }],
    ['eye size', (g, s) => { g.face!.eyeSize = s; }],
    ['whiskers', (g, s) => { g.face!.whiskerSize = s; }],
    ['neck thickness', (g, s) => { g.head!.neckThick = s; }],
    ['leg thickness', (g, s) => { g.legs!.thick = s; }],
    ['pattern size', (g, s) => { g.coat!.patternSize = s; }],
    ['hands', (g, s) => { g.plan!.type = 1; g.hands!.type = 1; g.hands!.length = 2; g.hands!.thick = s; }],
  ];
  it('each new slider at its smallest and largest size bakes to watertight single shells', { timeout: 240000 }, () => {
    const bad: string[] = [];
    for (const [label, set] of FIELDS) for (const s of [0, 5]) { const g = dressed(); set(g, s); solid(`${label} ${s + 1}`, g, bad); }
    expect(bad).toEqual([]);
  });

  it('everything at once at its smallest, and at its largest, on four and on two legs', { timeout: 240000 }, () => {
    const bad: string[] = [];
    for (const plan of [0, 1]) for (const s of [0, 5]) {
      const g = dressed();
      g.plan!.type = plan;
      for (const [, set] of FIELDS) set(g, s);
      g.plan!.type = plan;
      Object.assign(g.snout!, { reach: s });
      Object.assign(g.head!, { neckLength: s });
      Object.assign(g.ears!, { scale: s });
      solid(`plan ${plan} all ${s + 1}`, g, bad);
    }
    expect(bad).toEqual([]);
  });
});
