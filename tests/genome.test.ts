import { describe, expect, it } from 'vitest';
import {
  BLOCKS, GENES, classToStep, defaultGenome, mulberry32, mutate, parse, randomGenome,
  serialize, setField, setSizeClass, stepToClass, genomeEquals,
} from '../src/core/genome';

describe('Morphotyp codec (DNA v2)', () => {
  it('writes the default creature as the spec example, every gene always present, fixed length', () => {
    const code = serialize(defaultGenome());
    expect(code.split('#')[0]).toBe('MPH2:B01.33:L01.3:N01.3:H01:S02.3:E01.3:R00.0:W00.0:T01.3:U00:C00.0:O02:M01:Z00:V00:F01:D00:A00:G00:P00:J01:Y01:Q00');
    expect(code).toMatch(/#[0-9A-F]{2}$/);
    const rnd = mulberry32(3);
    for (let i = 0; i < 50; i++) expect(serialize(randomGenome(rnd))).toHaveLength(code.length);
    expect(GENES.map((g) => g.letter).join('')).toBe('BLNHSERWTUCOMZVFDAGPJYQ');
  });

  it('round-trips 2000 random genomes losslessly with a valid checksum', () => {
    const rnd = mulberry32(1234);
    for (let i = 0; i < 2000; i++) {
      const g = randomGenome(rnd);
      const r = parse(serialize(g));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.checksumOk).toBe(true);
      expect(r.warnings).toEqual([]);
      expect(r.badGenes).toEqual([]);
      expect(r.genome).toEqual(g);
    }
  });

  it('changing one gene changes only that part; the code length stays', () => {
    const code = serialize(defaultGenome());
    const r = parse(code.split('#')[0]!.replace('R00.0', 'R02.4'));
    expect(r.ok && r.genome.horns).toEqual({ type: 2, span: 3 });
    expect(r.ok && serialize(r.genome)).toHaveLength(code.length);
    const b = parse(code.split('#')[0]!.replace('B01', 'B03'));
    expect(b.ok && b.genome.body).toEqual({ ...defaultGenome().body, shape: 2 });
  });

  it('accepts lowercase, embedded, spaced input and missing genes; rejects garbage', () => {
    const code = serialize(randomGenome(mulberry32(7)));
    for (const input of [code.toLowerCase(), `mój kod: ${code}, dzięki!`, `  ${code}\n`, code.replace(/:/g, ' : ')]) {
      const r = parse(input);
      expect(r.ok, input).toBe(true);
      if (r.ok) expect(serialize(r.genome)).toBe(code);
    }
    const short = parse('MPH2:R03.2');
    expect(short.ok && short.genome).toEqual(setField(setField(defaultGenome(), 'horns', 'type', 3), 'horns', 'span', 1));
    expect(parse('')).toMatchObject({ ok: false, code: 'EMPTY' });
    expect(parse('MPH2:')).toMatchObject({ ok: false, code: 'EMPTY' });
    expect(parse('MPH2:xyz')).toMatchObject({ ok: false, code: 'BAD_CODE' });
    expect(parse('MPH0204')).toMatchObject({ ok: false, code: 'BAD_LENGTH' });
  });

  it('an unknown variant marks only its gene as bad, the rest of the creature is read', () => {
    const code = serialize(setField(defaultGenome(), 'tail', 'type', 2)).split('#')[0]!;
    const r = parse(code.replace('B01.33', 'B7F.33').replace('E01.3', 'E01.9'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.badGenes).toEqual(['B7F.33', 'E01.9']);
    expect(r.genome.body).toEqual(defaultGenome().body);
    expect(r.genome.tail!.type).toBe(2);
  });

  it('checksum detects every single-character corruption', () => {
    const code = serialize(randomGenome(mulberry32(99)));
    const body = code.indexOf(':') + 1;
    for (let pos = body; pos < code.length; pos++) {
      for (const d of '0123456789ABCDEF') {
        if (d === code[pos] || code[pos] === ':' || code[pos] === '.' || code[pos] === '#') continue;
        const bad = code.slice(0, pos) + d + code.slice(pos + 1);
        const r = parse(bad);
        if (r.ok && !r.badGenes.length) expect(r.checksumOk, `${pos}:${d}`).toBe(false);
      }
    }
  });

  it('opens first-format codes (MPH + 26 hex), dropping the old leg-count field', () => {
    const d = parse('MPH12080250280000500040000030');
    expect(d).toMatchObject({ ok: true, checksumOk: true });
    expect(d.ok && d.genome).toEqual(defaultGenome());
    const r = parse('MPH-12-88-02-50-28-50-00-50-00-40-00-00-89');
    expect(r).toMatchObject({ ok: true, checksumOk: true });
    if (!r.ok) return;
    expect(r.genome.horns).toEqual({ type: 2, span: 4 });
    expect(r.genome.palette!.index).toBe(9);
    expect(r.genome.legs).toEqual(defaultGenome().legs);
    expect(parse('MPH0204030502010406031A080107').ok).toBe(true);
  });

  it('canonical form: "none" blocks drop their size => one phenotype, one code', () => {
    const a = setField(setField(defaultGenome(), 'horns', 'span', 5), 'horns', 'type', 0);
    expect(a.horns).toEqual({ type: 0, span: 0 });
    expect(genomeEquals(a, defaultGenome())).toBe(true);
  });

  it('retired variants still read, but the dice never pick them', () => {
    const f = BLOCKS.find((b) => b.id === 'tail')!.fields[0]! as unknown as { options: { retired?: boolean }[] };
    f.options[3]!.retired = true;
    try {
      const rnd = mulberry32(11);
      for (let i = 0; i < 300; i++) expect(randomGenome(rnd).tail!.type).not.toBe(3);
      const r = parse('MPH2:T03.2');
      expect(r.ok && r.genome.tail!.type).toBe(3);
    } finally { delete f.options[3]!.retired; }
  });

  it('is deterministic for a seed (randomize / mutate)', () => {
    expect(serialize(randomGenome(mulberry32(5)))).toBe(serialize(randomGenome(mulberry32(5))));
    const g = defaultGenome();
    expect(serialize(mutate(g, mulberry32(3)))).toBe(serialize(mutate(g, mulberry32(3))));
  });
});

describe('N -> 2N rule', () => {
  it('maps 6 steps to 3 classes with a threshold', () => {
    expect([0, 1, 2, 3, 4, 5].map(stepToClass)).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it('picking a class is idempotent inside the class and snaps otherwise', () => {
    expect(classToStep(1, 3)).toBe(3);
    expect(classToStep(1, 0)).toBe(2);
    expect(classToStep(2, 0)).toBe(4);
    const g = setField(defaultGenome(), 'body', 'length', 5);
    expect(setSizeClass(g, 'body', 'length', 0).body!.length).toBe(0);
    expect(setSizeClass(g, 'body', 'length', 2).body!.length).toBe(5);
  });
});

describe('creature name', () => {
  it('is drawn from the code: same code, same name; a typed name is kept apart from the DNA', async () => {
    const { creatureName, fileBase } = await import('../src/core/genome');
    const { createStudioStore } = await import('../src/core/store');
    const code = serialize(randomGenome(mulberry32(42)));
    expect(creatureName(code)).toBe(creatureName(code.toLowerCase()));
    expect(creatureName(code)).toMatch(/^[A-ZŁŚŻ][a-ząćęłńóśźż]+$/);
    const names = new Set(Array.from({ length: 200 }, (_, i) => creatureName(serialize(randomGenome(mulberry32(i))))));
    expect(names.size).toBeGreaterThan(190);
    expect(fileBase('Pan/Kot?')).toBe('Morphoid PanKot');

    const s = createStudioStore();
    const drawn = s.creature().name;
    s.setName('Burek');
    expect(s.creature()).toEqual({ name: 'Burek', code: s.code() });
    s.randomize(1);
    expect(s.creature().name).not.toBe('Burek');
    s.undo();
    expect(s.creature().name).toBe('Burek');
    s.setName('');
    expect(s.creature().name).toBe(drawn);
  });
});
