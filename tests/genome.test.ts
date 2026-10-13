import { describe, expect, it } from 'vitest';
import {
  BLOCKS, CODE_LENGTH, classToStep, defaultGenome, mulberry32, mutate, parse, randomGenome,
  serialize, setField, setSizeClass, stepToClass, genomeEquals,
} from '../src/core/genome';

describe('Morphotyp codec', () => {
  it('has exactly 13 one-byte blocks and a 29-char code', () => {
    expect(BLOCKS).toHaveLength(13);
    expect(serialize(defaultGenome())).toMatch(/^MPH[0-9A-F]{26}$/);
    expect(serialize(defaultGenome())).toHaveLength(CODE_LENGTH);
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
      expect(r.genome).toEqual(g);
    }
  });

  it('parses the reference code from the spec (soft checksum, no crash)', () => {
    const r = parse('MPH0204030502010406031A080107');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // every field must be in range after decoding, re-serialising must be stable
    expect(parse(serialize(r.genome))).toMatchObject({ ok: true, checksumOk: true });
  });

  it('accepts segmented, lowercase and embedded input; rejects bad length', () => {
    const code = serialize(randomGenome(mulberry32(7)));
    const hex = code.slice(3);
    const seg = 'MPH-' + hex.match(/../g)!.join('-');
    for (const input of [seg, code.toLowerCase(), `mój kod: ${code}, dzięki!`, `  ${code}\n`]) {
      const r = parse(input);
      expect(r.ok, input).toBe(true);
      if (r.ok) expect(serialize(r.genome)).toBe(code);
    }
    expect(parse('')).toMatchObject({ ok: false, code: 'EMPTY' });
    expect(parse('MPH0204')).toMatchObject({ ok: false, code: 'BAD_LENGTH' });
  });

  it('checksum detects every single-digit corruption', () => {
    const code = serialize(randomGenome(mulberry32(99)));
    for (let pos = 3; pos < code.length; pos++) {
      for (const d of '0123456789ABCDEF') {
        if (d === code[pos]) continue;
        const bad = code.slice(0, pos) + d + code.slice(pos + 1);
        const r = parse(bad);
        if (r.ok) expect(r.checksumOk, `${pos}:${d}`).toBe(false);
      }
    }
  });

  it('canonical form: "none" blocks drop their size => one phenotype, one code', () => {
    const a = setField(setField(defaultGenome(), 'horns', 'span', 5), 'horns', 'type', 0);
    expect(a.horns).toEqual({ type: 0, span: 0 });
    expect(genomeEquals(a, defaultGenome())).toBe(true);
  });

  it('clamps out-of-range stored values with warnings', () => {
    // 0xFF in the step-heavy body byte => step 7 > 5
    const g = serialize(defaultGenome());
    const r = parse('MPH' + 'FF' + g.slice(5));
    expect(r.ok && r.warnings.length).toBeGreaterThan(0);
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
