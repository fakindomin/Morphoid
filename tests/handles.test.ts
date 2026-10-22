import { describe, expect, it } from 'vitest';
import {
  defaultGenome, FINE_ZERO, mulberry32, parse, randomGenome, serialize, setFine, surpriseGenome, withoutSculpt, type MorphotypeGenome,
} from '../src/core/genome';
import { presetGenome, PRESETS } from '../src/core/genome/presets';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { buildParts3D, type Part3D } from '../src/core/art/spec3d';
import { touchesOf } from '../src/core/art/settle';
import { anchorsOf, ELEMENTS, elementDef, pickAnchor, pullLength, pullSwing, pullThick, resetElement } from '../src/core/art/handles';
import { limbBox } from '../src/core/art/limb';
import { bake } from '../src/core/bake/bake';
import { planModular, planWhole } from '../src/core/print';

/** The handles of the 3D view (2026-10-22): length, thickness and swing of every element, written into the DNA. */
const partsOf = (g: MorphotypeGenome): Part3D[] => {
  const rig = solveRig(g);
  return buildParts3D(buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false), g, rig);
};
const anchors = (g: MorphotypeGenome) => anchorsOf(partsOf(g), solveRig(g));
const reach = (g: MorphotypeGenome, id: string): number => {
  const a = anchors(g).find((x) => x.id === id)!;
  return Math.hypot(a.tip[0] - a.root[0], a.tip[1] - a.root[1], a.tip[2] - a.root[2]);
};

/** A creature with every element the handles work on. */
const full = (): MorphotypeGenome => {
  const g = defaultGenome();
  g.horns!.type = 1; g.horns!.span = 2; g.wings!.type = 2; g.wings!.scale = 2; g.antennae!.type = 1; g.antennae!.length = 2;
  g.hands!.type = 1; g.hands!.length = 2; g.plan!.type = 1;
  return g;
};

/** Every handle of every element pulled to the given levels (length as a fraction of a step on top of the step). */
function pulled(g: MorphotypeGenome, len: number, thick: number, swing: number): MorphotypeGenome {
  let h = g;
  for (const e of ELEMENTS) {
    const f = e.length.block === 'sculpt' ? 'neckLength' : e.length.field.replace(/F$/, '');
    const base = e.length.block === 'sculpt' ? h.head!.neckLength! : h[e.length.block]![f]!;
    h = setFine(h, e.length.block, e.length.field, base + len);
    h = setFine(h, e.thick.block, e.thick.field, e.thickTable ? (h[e.thick.block]![e.thick.field.replace(/F$/, '')] ?? 2) + (thick - FINE_ZERO) / 16 : thick);
    h = setFine(h, e.swing.block, e.swing.field, swing);
  }
  return h;
}

describe('handles: DNA', () => {
  it('a code written before the handles loads as it looked, whatever creature was on screen', () => {
    const old = 'MPH2:B01.33:L01.331:N01.33:H01.3:S02.3:E01.31:R01.31:W02.31:T01.31:U00:C00.0:O02.113:M01:Z00:V00.00:F01:D00.0:A00:G00:P00:J01:Y01:Q00:K01.31:X01.3131:I00.888888888';
    const base = pulled(full(), 0.4, 12, 3);
    const r = parse(old, base);
    expect(r.ok && r.badGenes).toEqual([]);
    if (!r.ok) return;
    for (const e of ELEMENTS) for (const f of [e.thick, e.swing]) if (f.block !== 'sculpt') expect(r.genome[f.block]![f.field], `${e.id} ${f.field}`).toBe(FINE_ZERO);
    expect(serialize(r.genome)).toContain(':T01.31888:');
    expect(serialize(r.genome)).toContain(':X01.3131888:');
  });

  it('pulled handles round-trip through the code; an absent part writes zeros and keeps nothing', () => {
    const g = pulled(full(), 0.3, 11, 5);
    const r = parse(serialize(g));
    expect(r.ok && serialize(r.genome)).toBe(serialize(g));
    const noTail = setFine(g, 'tail', 'thick', 14);
    noTail.tail!.type = 0;
    const code = serialize(noTail);
    expect(code).toContain(':T00.00888:');
    const back = parse(code);
    expect(back.ok && back.genome.tail!.thick).toBe(FINE_ZERO);
  });

  it('a length pulled past half a step carries into the size step (the 2D sketch follows), the rest stays a fraction', () => {
    const g = defaultGenome();
    const h = setFine(g, 'tail', 'lengthF', g.tail!.length! + 1.25);
    expect(h.tail!.length).toBe(g.tail!.length! + 1);
    expect(h.tail!.lengthF).toBe(FINE_ZERO + 4);
    // the sketch draws the creature without them (only the steps they carried into)
    const s = withoutSculpt(h);
    expect(s.tail!.lengthF).toBe(FINE_ZERO);
    expect(s.tail!.length).toBe(g.tail!.length! + 1);
  });

  it('the dice and mutations never pull a handle', () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 40; i++) {
      const g = i % 2 ? randomGenome(rnd) : surpriseGenome(rnd);
      for (const e of ELEMENTS) for (const f of [e.length, e.thick, e.swing]) expect(g[f.block]![f.field]).toBe(FINE_ZERO);
    }
  });

  it('reset puts an element\'s handles back to zero', () => {
    const g = pulled(full(), 0.3, 12, 2), def = elementDef('wings');
    const r = resetElement(g, def);
    for (const f of [def.length, def.thick, def.swing]) expect(r[f.block]![f.field]).toBe(FINE_ZERO);
    expect(r.tail!.thick).toBe(12);
  });
});

describe('handles: the solid', () => {
  it('every element of a creature has its anchor, and a point on it picks it', () => {
    const g = full(), list = anchors(g);
    for (const id of ['legs', 'tail', 'wings', 'hands', 'horns', 'ears', 'antennae', 'neck']) expect(list.some((a) => a.id === id), id).toBe(true);
    for (const a of list) {
      const mid = a.parts[0]!.limb ? a.parts[0]!.limb!.cones[1]?.a ?? a.tip : a.tip;
      // (a point inside the element is nearest to it, or to an element it is joined to)
      expect(pickAnchor(list, mid[0], mid[1], mid[2], 3), a.id).not.toBeNull();
    }
  });

  it('pulling the length handle makes the element longer, about as much as pulled', () => {
    for (const id of ['tail', 'wings', 'horns', 'ears', 'antennae', 'hands', 'legs'] as const) {
      const g = full(), def = elementDef(id), was = reach(g, id);
      const h = setFine(g, def.length.block, def.length.field, pullLength(g, def, was, 6));
      expect(reach(h, id), id).toBeGreaterThan(was + 2);
      const k = setFine(g, def.length.block, def.length.field, pullLength(g, def, was, -4));
      expect(reach(k, id), id).toBeLessThan(was - 1);
    }
  });

  it('pulling the thickness handle makes the element thicker; the swing handle turns it', () => {
    for (const id of ['tail', 'horns', 'ears', 'wings', 'antennae'] as const) {
      // (alone on the head: a crowded head slims its horns back to make room, see separateAppendages)
      const g = defaultGenome();
      if (id !== 'ears' && id !== 'tail') { g.ears!.type = 0; g[id]!.type = 1; g[id]![id === 'horns' ? 'span' : id === 'wings' ? 'scale' : 'length'] = 2; }
      const def = elementDef(id), a = anchors(g).find((x) => x.id === id)!;
      const h = setFine(g, def.thick.block, def.thick.field, pullThick(g, def, a.radius, a.radius));
      const b = anchorsOf(partsOf(h), solveRig(h)).find((x) => x.id === id)!;
      expect(b.radius, id).toBeGreaterThan(a.radius * 1.3);
      const s = setFine(g, def.swing.block, def.swing.field, pullSwing(g, def, reach(g, id), 5));
      const c = anchorsOf(partsOf(s), solveRig(s)).find((x) => x.id === id && x.side === a.side)!;
      expect(Math.hypot(c.tip[0] - a.tip[0], c.tip[1] - a.tip[1]), id).toBeGreaterThan(1.5);
    }
  });

  it('spread legs keep their feet on the bed and stand wider', () => {
    const g = defaultGenome(), def = elementDef('legs');
    const h = setFine(g, def.swing.block, def.swing.field, 15);
    const feet = (x: MorphotypeGenome): number => Math.max(...partsOf(x).filter((p) => p.slot === 'legB' && p.limb).map((p) => Math.max(Math.abs(limbBox(p.limb!).lo[2]), Math.abs(limbBox(p.limb!).hi[2]))));
    expect(feet(h)).toBeGreaterThan(feet(g) + 3);
    expect(solveRig(h).issues).toEqual([]);
    for (const p of partsOf(h).filter((q) => q.limb)) expect(limbBox(p.limb!).lo[1]).toBeGreaterThanOrEqual(0);
  });

  it('pulled elements still do not grow into each other on most creatures', { timeout: 300000 }, () => {
    const rnd = mulberry32(31);
    let bad = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      const lvl = (): number => Math.floor(rnd() * 16);
      const g = pulled(randomGenome(rnd), rnd() - 0.5, lvl(), lvl());
      if (touchesOf(partsOf(g)).some((t) => t.depth < 0)) bad++;
    }
    expect(bad / n).toBeLessThan(0.3);
  });
});

describe('handles: the extremes still print', () => {
  const check = (label: string, g: MorphotypeGenome, modular: boolean, bad: string[]): void => {
    if (solveRig(g).issues.length) bad.push(`${label}: rig ${solveRig(g).issues.join(',')}`);
    for (const p of bake(g, modular ? planModular() : planWhole(), 'draft').pieces) {
      const x = p.validation;
      // (in parts, a pair of ears or wings, the legs, the spikes are one print job of several pieces)
      if (!x.watertight || (x.shells !== 1 && p.id !== 'whiskers' && !modular) || x.genus !== 0) bad.push(`${label} ${p.id}: watertight ${x.watertight}, shells ${x.shells}, holes ${x.genus}`);
    }
  };
  it('every handle at its ends bakes whole and in parts, watertight', { timeout: 600000 }, () => {
    const bad: string[] = [];
    const dragon = presetGenome(PRESETS.find((p) => p.name === 'Smok')!);
    for (const [label, g] of [['full', full()], ['dragon', dragon]] as const) {
      for (const [len, thick, swing] of [[0.44, 15, 15], [-0.5, 1, 0]] as const) {
        const h = pulled(g, len, thick, swing);
        check(`${label} ${len}/${thick}/${swing} whole`, h, false, bad);
        check(`${label} ${len}/${thick}/${swing} parts`, h, true, bad);
      }
    }
    expect(bad).toEqual([]);
  });
});
