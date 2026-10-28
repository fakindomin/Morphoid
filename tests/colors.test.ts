import { describe, expect, it } from 'vitest';
import { defaultGenome, describeGene, parse, randomGenome, serialize, mulberry32, setField, GENES } from '../src/core';
import { COLOR_TARGETS, FILAMENT_COLORS, filamentPlan, inkOf, patternInk } from '../src/core/filaments';
import { buildParts3D } from '../src/core/art/spec3d';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths } from '../src/core/art/shapes';
import { paintCode, bambuConfig } from '../src/core/bake/threemf';

const red = FILAMENT_COLORS.findIndex((c) => c.id === 'red') + 1;
const blue = FILAMENT_COLORS.findIndex((c) => c.id === 'cobalt') + 1;

describe('element colours in the DNA', () => {
  it('a code without colours (written before them) loads with every element in the palette', () => {
    const g = defaultGenome();
    const code = serialize(g);
    const old = code.replace(/:P(\w\w)\.0+:/, ':P$1:').replace(/#.*/, '');
    expect(old).not.toBe(code);
    const r = parse(old);
    expect(r.ok && r.badGenes).toEqual([]);
    if (r.ok) for (const t of COLOR_TARGETS) expect(r.genome.colors![t.id]).toBe(0);
  });

  it('two hex digits per element after the palette, round trip', () => {
    let g = setField(defaultGenome(), 'palette', 'index', 5);
    g = setField(g, 'colors', 'body', red);
    g = setField(g, 'colors', 'eyes', blue);
    const code = serialize(g);
    const p = code.split(':').find((x) => x.startsWith('P'))!;
    expect(p).toBe(`P05.${red.toString(16).toUpperCase().padStart(2, '0')}${'00'.repeat(10)}${blue.toString(16).toUpperCase().padStart(2, '0')}0000`);
    const r = parse(code);
    expect(r.ok && r.checksumOk).toBe(true);
    if (r.ok) expect(serialize(r.genome)).toBe(code);
    expect(describeGene(g, GENES.find((x) => x.letter === 'P')!)).toBe('Paleta: Triada 6 · Tułów: Czerwony · Tęczówki: Kobaltowy');
  });

  it('a colour number no app knows is a bad gene, the rest still loads', () => {
    const code = serialize(defaultGenome()).replace(/:P00\.00/, ':P00.FF').replace(/#.*/, '');
    const r = parse(code);
    expect(r.ok && r.badGenes.length).toBe(1);
  });

  it('the dice never paint', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 20; i++) expect(Object.values(randomGenome(rand).colors!).every((v) => v === 0)).toBe(true);
  });
});

describe('element colours on the model', () => {
  const partsOf = (g: ReturnType<typeof defaultGenome>) => {
    const rig = solveRig(g);
    return buildParts3D(buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false), g, rig);
  };

  it('the picked colour goes on the element only; eye whites and the nose keep theirs', () => {
    let g = setField(defaultGenome(), 'colors', 'head', red);
    g = setField(g, 'colors', 'eyes', blue);
    const parts = partsOf(g);
    const hex = FILAMENT_COLORS[red - 1]!.hex;
    expect(parts.find((p) => p.slot === 'head')!.color).toBe(hex);
    expect(parts.find((p) => p.slot === 'torso')!.color).toBe('c1');
    expect(parts.filter((p) => p.slot === 'eye').every((p) => p.color === 'white')).toBe(true);
    expect(parts.filter((p) => p.slot === 'iris').every((p) => p.color === FILAMENT_COLORS[blue - 1]!.hex)).toBe(true);
    expect(inkOf(g.colors!, 'nose', 'ink')).toBe('ink');
    expect(inkOf(g.colors!, 'earIn', 'c2soft')).toBe('c2soft');
    expect(patternInk(g.colors!)).toBe('c3');
  });
});

describe('filaments for a printer', () => {
  it('equal colours share a slot, the closest merge when the printer is short', () => {
    const p = filamentPlan(['#FFFFFF', '#C12E1F', '#9D2235', '#0056B8', '#FFFFFF', '#000000'], 4);
    expect(p.filaments).toEqual(['#FFFFFF', '#C12E1F', '#0056B8', '#000000']);
    expect(p.merged).toEqual([['#9D2235', '#C12E1F']]);
    expect(p.slotOf).toEqual([0, 1, 1, 2, 0, 3]);
    expect(filamentPlan(['#FFFFFF', '#C12E1F'], 1)).toMatchObject({ filaments: ['#FFFFFF'], slotOf: [0, 0] });
  });

  it('paint codes for filaments 1..8 and a config sized to the filaments', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(paintCode)).toEqual(['4', '8', '0C', '1C', '2C', '3C', '4C', '5C']);
    const c = bambuConfig({ perFilament: ['filament_type', 'nozzle_temperature'], config: { filament_type: ['PLA'], nozzle_temperature: ['220'], layer_height: '0.2' } },
      ['#FFFFFF', '#000000', '#C12E1F', '#0056B8', '#00AE42'], 10, 20);
    expect(c.filament_type).toHaveLength(5);
    expect(c.filament_self_index).toEqual(['1', '2', '3', '4', '5']);
    expect(c.flush_volumes_matrix).toHaveLength(25);
    expect((c.flush_volumes_matrix as string[]).filter((v) => v === '0')).toHaveLength(5);
    expect(c.layer_height).toBe('0.2');
  });
});
