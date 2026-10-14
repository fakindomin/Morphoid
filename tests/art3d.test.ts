import { describe, expect, it } from 'vitest';
import { defaultGenome, mulberry32, randomGenome } from '../src/core/genome';
import { solveRig } from '../src/core/rig';
import { targetPose } from '../src/core/art/pose';
import { buildPaths, SLOTS } from '../src/core/art/shapes';
import { appendageContacts, appendageUnits, buildParts3D, SPEC_3D, unitGap } from '../src/core/art/spec3d';
import { parse } from '../src/core/genome/codec';
import { hostsOf, slabSd } from '../src/core/art/mounts';
import { EYES } from '../src/core/art/shapes';

const parts = (g: ReturnType<typeof defaultGenome>) => {
  const rig = solveRig(g);
  const paths = buildPaths(targetPose(rig, g, 0, false, { x: 0, y: 0 }), g, rig, false);
  return { rig, paths, parts: buildParts3D(paths, g, rig) };
};

describe('3D contract: everything drawn in 2D exists in 3D', () => {
  it('every 2D slot has an explicit 3D decision', () => {
    const missing = SLOTS.map(([id]) => id).filter((id) => !(id in SPEC_3D));
    expect(missing, `2D slots with no 3D spec: ${missing.join(', ')}`).toEqual([]);
  });

  it('every non-empty solid slot yields at least one 3D part (mirror images and render-only excepted)', () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 150; i++) {
      const g = randomGenome(rnd);
      const { paths, parts: ps } = parts(g);
      const have = new Set(ps.map((p) => p.slot));
      for (const [id] of SLOTS) {
        if (SPEC_3D[id] === null) continue;
        if (!paths[id].empty) expect(have.has(id), `${solveRig(g).code}: ${id} drawn in 2D but missing in 3D`).toBe(true);
      }
    }
  });

  it('parts are finite, paired parts mirror in Z, thickness respects the plate rule', () => {
    const { parts: ps } = parts(defaultGenome());
    for (const p of ps) {
      expect(Number.isFinite(p.z) && Number.isFinite(p.thickness)).toBe(true);
      expect(p.bevel).toBeLessThanOrEqual(p.thickness / 2);
      for (const poly of p.polys) for (const [x, y] of poly) expect(Number.isFinite(x + y)).toBe(true);
    }
    const legs = ps.filter((p) => p.slot === 'legF');
    expect(legs.map((l) => l.z).sort()).toEqual([-legs[0]!.z, legs[0]!.z].sort());
    const wings = parts({ ...defaultGenome(), wings: { type: 2, scale: 3 } }).parts.filter((p) => p.slot === 'wingNear');
    expect(wings).toHaveLength(2);
    expect(wings[0]!.thickness).toBe(1.6);
  });
});

describe('3D contract: elements sit on what they stand on', () => {
  it('the hidden base of an ear rests on the head across its whole thickness (every skull, ear type and size)', async () => {
    const { edgesOf, sdPolys } = await import('../src/core/bake/field');
    const slab = (p: ReturnType<typeof parts>['parts'][number], x: number, y: number, z: number): number => {
      const half = p.thickness / 2, r = Math.min(p.bevel, half - 0.01);
      const wx = sdPolys(edgesOf(p.polys), p.polys, x, y) + r, wy = Math.abs(z - p.z) - half + r;
      return Math.min(Math.max(wx, wy), 0) + Math.hypot(Math.max(wx, 0), Math.max(wy, 0)) - r;
    };
    const bad: string[] = [];
    for (let skull = 0; skull < 3; skull++) for (let type = 1; type <= 3; type++) for (let scale = 0; scale <= 5; scale++) {
      const g = defaultGenome(); g.head!.skull = skull; g.ears!.type = type; g.ears!.scale = scale;
      const ps = parts(g).parts;
      const ear = ps.find((p) => p.id === 'ear+')!, head = ps.find((p) => p.slot === 'head')!;
      const ee = edgesOf(ear.polys), he = edgesOf(head.polys);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const poly of ear.polys) for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      // columns where the ear's lowest point is tucked behind the head in 2D: there it must touch the head in 3D too
      let run = 0, worst = 0;
      for (let x = x0; x <= x1; x += 0.1) {
        let yb = NaN;
        for (let y = y0; y <= y1; y += 0.1) if (sdPolys(ee, ear.polys, x, y) < 0) { yb = y; break; }
        const hidden = !isNaN(yb) && sdPolys(he, head.polys, x, yb) < 0;
        const gap = hidden ? Math.max(...[-0.4, 0, 0.4].map((f) => slab(head, x, yb - 0.1, ear.z + f * ear.thickness))) : 0;
        run = gap > 0.3 ? run + 0.1 : 0;
        worst = Math.max(worst, run);
      }
      // a strip narrower than the nozzle (0.4 mm) is not printed as a separate line
      if (worst >= 0.4) bad.push(`skull ${skull} ears ${type} size ${scale + 1}: ${worst.toFixed(1)} mm of the base in the air`);
    }
    expect(bad).toEqual([]);
  });
});

describe('3D contract: appendages of different kinds do not grow into each other', () => {
  it('the wing and the ear of a reported creature stay apart', () => {
    const r = parse('MPH2:B01.25:L03.5:N02.1:H02:S01.1:E03.51:R01.51:W01.6:T04.32:U00:C04.5:O05:M01:Z02:V00.0:F01:D00:A01:G00:P00:J03:Y05:Q02:K02.11#7F');
    if (!r.ok) throw new Error(r.message);
    const g = r.genome;
    const touching = appendageContacts(parts(g).parts).map((c) => `${c.a}/${c.b}`);
    expect(touching).not.toContain('ear/wingNear');
  });

  it('most neighbours are set apart; the rest are reported, and nothing is pushed off its host', () => {
    const rnd = mulberry32(5);
    let close = 0, touch = 0;
    for (let i = 0; i < 120; i++) {
      const g = randomGenome(rnd);
      const ps = parts(g).parts, units = appendageUnits(ps);
      for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) {
        const gap = unitGap(units[a]!, units[b]!);
        if (gap === null) continue;
        close++;
        if (gap < 0.55) touch++;
      }
      const reported = appendageContacts(ps).length;
      expect(reported > 0 || !units.some((u, a) => units.some((v, b) => b > a && (unitGap(u, v) ?? 9) < 0.55))).toBe(true);
    }
    expect(touch / close).toBeLessThan(0.45);
  });
});

describe('mount points: small elements sit on the real skin of the head and Pysk', () => {
  it('every whisker root and every eyeball is buried in the head or Pysk', () => {
    const rnd = mulberry32(41);
    let whiskers = 0, eyes = 0;
    for (let i = 0; i < 300; i++) {
      const g = randomGenome(rnd);
      const { rig, parts: ps } = parts(g);
      const hosts = hostsOf(ps, ['snout', 'head']);
      const depth = (x: number, y: number, z: number) => Math.min(...hosts.map((h) => slabSd(h.p, h.e, x, y, z)));
      for (const p of ps) {
        if (p.slot === 'whiskers') for (const q of p.polys) {
          if (q.length !== 4) continue; // the print-only pad
          const [x, z] = [(q[0]![0] + q[3]![0]) / 2, (q[0]![1] + q[3]![1]) / 2];
          expect(depth(x, p.z, z), `${rig.code}: ${p.id} root floats`).toBeLessThan(-0.3);
          whiskers++;
        }
        if (p.slot === 'eye' && g.face!.eyes !== EYES.stalks) for (const c of p.limb?.cones ?? []) {
          expect(depth(c.a[0], c.a[1], c.a[2]), `${rig.code}: ${p.id} ball off the head`).toBeLessThan(0);
          eyes++;
        }
      }
    }
    expect(whiskers).toBeGreaterThan(30);
    expect(eyes).toBeGreaterThan(100);
  });

  it('the whiskers of the reported creature start inside its Pysk', () => {
    const r = parse('MPH2:B03.63:L01.1:N01.5:H02:S02.6:E03.41:R03.43:W01.1:T04.22:U00:C05.3:O01:M02:Z01:V01.3:F03:D03:A00:G00:P09:J03:Y02:Q00:K00.00#4A');
    if (!r.ok) throw new Error('code does not parse');
    const { parts: ps } = parts(r.genome);
    const hosts = hostsOf(ps, ['snout', 'head']);
    for (const p of ps.filter((q) => q.slot === 'whiskers')) for (const q of p.polys) {
      const [x, z] = [(q[0]![0] + q[3]![0]) / 2, (q[0]![1] + q[3]![1]) / 2];
      expect(Math.min(...hosts.map((h) => slabSd(h.p, h.e, x, p.z, z)))).toBeLessThan(-0.3);
    }
  });
});
