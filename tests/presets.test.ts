import { describe, expect, it } from 'vitest';
import { parse, PRESETS, presetGenome, serialize } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { createStudioStore } from '../src/core/store';
import { bake } from '../src/core/bake/bake';
import { planWhole } from '../src/core/print';

describe('ready-made animals (Gotowce)', () => {
  it('every preset is a valid, distinct creature that stands without rig problems', () => {
    const codes = new Set<string>();
    for (const p of PRESETS) {
      const code = serialize(presetGenome(p));
      expect(parse(code).ok, p.name).toBe(true);
      expect(solveRig(presetGenome(p)).issues, p.name).toEqual([]);
      codes.add(code);
    }
    expect(codes.size).toBe(PRESETS.length);
  });

  it('loading a preset names the creature after the animal', () => {
    const s = createStudioStore();
    s.loadPreset(PRESETS.find((p) => p.id === 'cat')!);
    expect(s.creature().name).toBe('Kot');
  });

  it('every preset bakes into one watertight piece (hanging ears, hands and all attached)', { timeout: 120000 }, () => {
    for (const p of PRESETS) {
      const body = bake(presetGenome(p), planWhole(), 'draft').pieces.find((x) => x.id === 'body')!.validation;
      expect(body.watertight, p.name).toBe(true);
      expect(body.shells, p.name).toBe(1);
    }
  });
});
