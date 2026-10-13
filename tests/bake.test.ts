import { describe, expect, it } from 'vitest';
import { defaultGenome, mulberry32, randomGenome } from '../src/core/genome';
import { planModular, planWhole } from '../src/core/print';
import { bake } from '../src/core/bake/bake';
import { toBinaryStl, validateMesh } from '../src/core/bake/mesh';
import { surfaceNets, type Grid3 } from '../src/core/bake/surfacenets';

describe('Surface Nets', () => {
  it('turns a sphere field into a closed manifold mesh with the right volume', () => {
    const n = 40, h = 0.5, R = 6;
    const g: Grid3 = { nx: n, ny: n, nz: n, h, ox: -10, oy: -10, oz: -10, data: new Float32Array(n * n * n) };
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      g.data[(k * n + j) * n + i] = Math.hypot(-10 + i * h, -10 + j * h, -10 + k * h) - R;
    }
    const v = validateMesh(surfaceNets(g));
    expect(v.watertight).toBe(true);
    expect(v.shells).toBe(1);
    const exact = (4 / 3) * Math.PI * R ** 3 / 1000;
    expect(Math.abs(Math.abs(v.volume) - exact) / exact).toBeLessThan(0.03);
  });
});

describe('bake: SDF fusion -> watertight solid', () => {
  it('the default Morphoid bakes into ONE watertight shell', { timeout: 30000 }, () => {
    const r = bake(defaultGenome(), planWhole(), 'draft');
    const body = r.pieces.find((p) => p.id === 'body')!;
    expect(body.validation.watertight, `bad edges: ${body.validation.badEdges}`).toBe(true);
    expect(body.validation.volume).toBeGreaterThan(5);
    expect(body.validation.shells).toBe(1);
    expect(body.validation.degenerate).toBe(0);
    // whiskers are a separate part but the default has none
    expect(r.pieces).toHaveLength(1);
  });

  it('25 random Morphoids bake into watertight meshes (every piece), whole and modular', { timeout: 120000 }, () => {
    const rnd = mulberry32(77);
    for (let i = 0; i < 25; i++) {
      const g = randomGenome(rnd);
      for (const plan of [planWhole(), planModular()]) {
        const r = bake(g, plan, 'draft');
        for (const p of r.pieces) {
          expect(p.validation.watertight, `${p.id} of ${JSON.stringify(g.palette)} edges ${p.validation.badEdges}`).toBe(true);
          expect(p.validation.volume).toBeGreaterThan(0);
        }
      }
    }
  });

  it('fusion really merges: a model of many parts is a single shell (no inner walls)', { timeout: 30000 }, () => {
    const g = defaultGenome();
    g.horns = { type: 1, span: 3 };
    g.wings = { type: 1, scale: 3 };
    const body = bake(g, planWhole(), 'draft').pieces.find((p) => p.id === 'body')!;
    expect(body.validation.shells).toBe(1);
  });

  it('writes a valid binary STL', { timeout: 30000 }, () => {
    const m = bake(defaultGenome(), planWhole(), 'draft').pieces[0]!.mesh;
    const stl = toBinaryStl(m);
    const dv = new DataView(stl.buffer);
    expect(stl.length).toBe(84 + dv.getUint32(80, true) * 50);
    expect(dv.getUint32(80, true)).toBe(m.indices.length / 3);
  });
});

import { exportBundle, exportFiles, printMesh } from '../src/core/bake/orient';

describe('print orientation and export', () => {
  const g = (() => { const x = defaultGenome(); x.wings = { type: 2, scale: 3 }; x.face!.whiskers = 2; return x; })();

  it('upright pieces stand on the bed (Z up), flat pieces lie on it with every body at z = 0', { timeout: 30000 }, () => {
    const r = bake(g, planWhole(), 'draft');
    for (const p of r.pieces) {
      const m = printMesh(p);
      let zmin = Infinity;
      for (let i = 2; i < m.positions.length; i += 3) zmin = Math.min(zmin, m.positions[i]!);
      expect(zmin, p.id).toBeCloseTo(0, 3);
    }
    const whiskers = r.pieces.find((p) => p.id === 'whiskers')!;
    expect(whiskers.orientation).toBe('flat');
    const m = printMesh(whiskers);
    // all strands/pad touch the bed: the number of vertices at z ~ 0 is large and nothing is below
    let low = 0, below = 0;
    for (let i = 2; i < m.positions.length; i += 3) { if (m.positions[i]! < 0.01) low++; if (m.positions[i]! < -0.001) below++; }
    expect(below).toBe(0);
    expect(low).toBeGreaterThan(20);
  });

  it('modular export is a ZIP with one STL per piece, whole export is a single STL', { timeout: 60000 }, () => {
    const whole = exportBundle(bake(g, planWhole(), 'draft'), 'MPHTEST');
    const modular = bake(g, planModular(), 'draft');
    const bundle = exportBundle(modular, 'MPHTEST');
    expect(exportFiles(modular, 'X')).toHaveLength(modular.pieces.length);
    expect(bundle.name.endsWith('.zip')).toBe(true);
    expect(whole.name === 'morphoid-MPHTEST.stl' || whole.name.endsWith('.zip')).toBe(true); // whiskers are forced separate
    expect(bundle.bytes[0]).toBe(0x50); // 'P' of PK
  });
});

describe('solid quality: no holes, no gaps, no floating bits (every element, variant and size on the default creature)', () => {
  const cases: ['ears' | 'horns' | 'wings' | 'crest' | 'tail' | 'snout', number, string][] = [
    ['ears', 3, 'scale'], ['horns', 4, 'span'], ['wings', 2, 'scale'], ['crest', 3, 'scale'], ['tail', 3, 'length'], ['snout', 2, 'reach'],
  ];
  it('each variant at each of the 6 sizes bakes to ONE watertight shell without through-holes', { timeout: 240000 }, () => {
    const bad: string[] = [];
    for (const [block, variants, stepField] of cases) {
      for (let v = block === 'snout' ? 0 : 1; v <= variants; v++) for (let s = 0; s < 6; s++) {
        const g = defaultGenome();
        g[block]!.type = v; g[block]![stepField] = s;
        const body = bake(g, planWhole(), 'draft').pieces.find((p) => p.id === 'body')!;
        const x = body.validation;
        if (!x.watertight || x.shells !== 1 || x.genus !== 0) bad.push(`${block} variant ${v} size ${s + 1}: watertight ${x.watertight}, shells ${x.shells}, holes ${x.genus}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('feet, necks, bodies and heads too', { timeout: 120000 }, () => {
    const bad: string[] = [];
    const tryIt = (label: string, mod: (g: ReturnType<typeof defaultGenome>) => void): void => {
      const g = defaultGenome(); mod(g);
      const x = bake(g, planWhole(), 'draft').pieces.find((p) => p.id === 'body')!.validation;
      if (!x.watertight || x.shells !== 1 || x.genus !== 0) bad.push(`${label}: shells ${x.shells}, holes ${x.genus}`);
    };
    for (let foot = 0; foot < 3; foot++) for (let l = 0; l < 6; l += 5) tryIt(`foot ${foot} legs ${l}`, (g) => { g.legs!.foot = foot; g.legs!.length = l; });
    for (let neck = 0; neck < 3; neck++) for (let nl = 0; nl < 6; nl += 5) tryIt(`neck ${neck} len ${nl}`, (g) => { g.head!.neck = neck; g.head!.neckLength = nl; });
    for (let sh = 0; sh < 3; sh++) for (let bl = 0; bl < 6; bl += 5) for (let bg = 0; bg < 6; bg += 5) tryIt(`body ${sh} L${bl} G${bg}`, (g) => { g.body!.shape = sh; g.body!.length = bl; g.body!.girth = bg; });
    for (let skull = 0; skull < 3; skull++) tryIt(`skull ${skull}`, (g) => { g.head!.skull = skull; });
    for (let acc = 1; acc <= 2; acc++) tryIt(`accessory ${acc}`, (g) => { g.accessory!.type = acc; });
    expect(bad).toEqual([]);
  });
});

describe('joints: pegs, sockets and tabs are real geometry', () => {
  it('modular parts are mostly seated on a peg or tab; the rest is marked for glue, and nothing loses its joint silently', () => {
    const rnd = mulberry32(31);
    let parts = 0, glued = 0;
    const bad: string[] = [];
    for (const g of [defaultGenome(), ...Array.from({ length: 8 }, () => randomGenome(rnd))]) {
      for (const p of bake(g, planModular(), 'draft').pieces) {
        if (!p.validation.watertight) bad.push(`${p.id} not watertight`);
        if (p.id === 'body') { expect(p.joints).toEqual([]); continue; }
        parts++;
        if (!p.joints.length) bad.push(`${p.id} has no joint`);
        if (!p.joints.some((j) => j.peg !== null)) glued++;
        for (const j of p.joints) if (!['body', 'head'].includes(j.hostId)) bad.push(`${p.id} mounts on ${j.hostId}`);
      }
    }
    expect(bad).toEqual([]);
    expect(glued / parts).toBeLessThan(0.2);
  });
});

describe('3MF for AMS: painted triangles', () => {
  it('paints the eyes white, pupils and nose in c3, the inner ear in c2, and writes every piece into one 3MF', async () => {
    const { export3mf } = await import('../src/core/bake/threemf');
    const { unzipSync, strFromU8 } = await import('fflate');
    const r = bake(defaultGenome(), planModular(), 'draft');
    const used = (id: string): number[] => { const c = [0, 0, 0, 0]; for (const f of r.pieces.find((p) => p.id === id)!.paint) c[f]!++; return c; };
    const head = used('head');
    expect(head[0]).toBeGreaterThan(head[2]! + head[3]!);
    expect(head[2]).toBeGreaterThan(0); // pupils, nose, mouth
    expect(head[3]).toBeGreaterThan(0); // eye whites
    expect(used('ears')[1]).toBeGreaterThan(0); // inner ear
    for (const p of r.pieces) expect(p.paint.length).toBe(p.mesh.indices.length / 3);

    const f = export3mf(r, 'TEST', ['#e8e2d4', '#c25e4e', '#1c2230']);
    expect(f.name).toBe('morphoid-TEST.3mf');
    const zip = unzipSync(f.bytes);
    expect(Object.keys(zip).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const xml = strFromU8(zip['3D/3dmodel.model']!);
    expect(xml.match(/<object /g)!.length).toBe(r.pieces.length);
    expect(xml.match(/<item /g)!.length).toBe(r.pieces.length);
    expect(xml).toContain('paint_color="1C"');
    expect(xml).toContain('slic3rpe:mmu_segmentation="0C"');
    // every triangle refers to a vertex of its own object
    for (const obj of xml.split('<object ').slice(1)) {
      const nv = obj.match(/<vertex /g)!.length;
      for (const m of obj.matchAll(/v[123]="(\d+)"/g)) expect(Number(m[1])).toBeLessThan(nv);
    }
  });
});
