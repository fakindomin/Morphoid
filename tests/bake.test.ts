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

  it('coat texture (fur, scales, armour) sinks a relief into the torso and still bakes ONE watertight shell', { timeout: 60000 }, () => {
    const smooth = bake(defaultGenome(), planWhole(), 'standard').pieces.find((p) => p.id === 'body')!.validation.volume;
    for (const t of [1, 2, 3]) {
      const g = defaultGenome(); g.coat!.texture = t;
      const v = bake(g, planWhole(), 'standard').pieces.find((p) => p.id === 'body')!.validation;
      expect(v.watertight, `texture ${t}`).toBe(true);
      expect(v.shells, `texture ${t}`).toBe(1);
      expect(v.volume, `texture ${t}: grooves remove material`).toBeLessThan(smooth);
      expect(v.volume, `texture ${t}: only a shallow relief`).toBeGreaterThan(smooth * 0.9);
    }
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
    expect(whiskers.orientation).toBe('upright'); // a horizontal plate: printed as it lies
    const m = printMesh(whiskers);
    // all strands/pad touch the bed (both sides at the same height): many vertices at z ~ 0 and nothing below
    let low = 0, below = 0;
    for (let i = 2; i < m.positions.length; i += 3) { if (m.positions[i]! < 0.01) low++; if (m.positions[i]! < -0.001) below++; }
    expect(below).toBe(0);
    expect(low).toBeGreaterThan(20);
  });

  it('modular export is a ZIP with one STL per piece, whole export is a single STL', { timeout: 60000 }, () => {
    const whole = exportBundle(bake(g, planWhole(), 'draft'), { name: 'Brumlik', code: 'MPH2:TEST' });
    const modular = bake(g, planModular(), 'draft');
    const bundle = exportBundle(modular, { name: 'Brumlik', code: 'MPH2:TEST' });
    expect(exportFiles(modular, { name: 'X', code: 'MPH2:X' })).toHaveLength(modular.pieces.length);
    expect(bundle.name).toBe('Morphoid Brumlik.zip');
    expect(whole.name === 'Morphoid Brumlik.stl' || whole.name.endsWith('.zip')).toBe(true); // whiskers are forced separate
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

describe('build (gene J): every build bakes and splits cleanly', () => {
  it('each build, at the smallest and largest body and legs, is ONE watertight shell whole, and every modular piece is watertight', { timeout: 240000 }, () => {
    const bad: string[] = [];
    for (let build = 0; build < 5; build++) for (const st of [0, 5]) for (const crest of [0, 3]) {
      const g = defaultGenome();
      g.build!.type = build; g.body!.length = st; g.body!.girth = st; g.legs!.length = st; g.crest!.type = crest; g.crest!.scale = 2;
      const label = `build ${build} size ${st + 1} crest ${crest}`;
      const x = bake(g, planWhole(), 'draft').pieces.find((p) => p.id === 'body')!.validation;
      if (!x.watertight || x.shells !== 1 || x.genus !== 0) bad.push(`${label} whole: shells ${x.shells}, holes ${x.genus}`);
      for (const p of bake(g, planModular(), 'draft').pieces) {
        const v = p.validation;
        // a piece may hold several copies (both ears, four legs); the body must stay one shell
        if (!v.watertight || (p.id === 'body' && v.shells !== 1)) bad.push(`${label} ${p.id}: watertight ${v.watertight}, shells ${v.shells}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('body plan (gene Y) and stand (gene Q)', () => {
  it('every body plan bakes into ONE watertight shell (whole) and watertight pieces (modular), at both size extremes', { timeout: 240000 }, () => {
    const bad: string[] = [];
    for (let plan = 0; plan < 6; plan++) for (const st of [0, 5]) {
      const g = defaultGenome();
      g.plan!.type = plan; g.body!.length = st; g.body!.girth = st; g.legs!.length = st; g.tail!.length = st; g.crest!.type = 3;
      const w = bake(g, planWhole(), 'draft').pieces.find((p) => p.id === 'body')!.validation;
      if (!w.watertight || w.shells !== 1 || w.genus !== 0) bad.push(`plan ${plan} size ${st + 1} whole: shells ${w.shells}, holes ${w.genus}`);
      for (const p of bake(g, planModular(), 'draft').pieces) {
        if (!p.validation.watertight || (p.id === 'body' && p.validation.shells !== 1)) bad.push(`plan ${plan} size ${st + 1} ${p.id}: shells ${p.validation.shells}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('a biped bakes into one shell; its stand is a separate watertight plate pegged into the feet', { timeout: 120000 }, () => {
    const bad: string[] = [];
    for (const build of [0, 1, 3]) for (const stand of [0, 1, 2]) for (const plan of [planWhole(), planModular()]) {
      const g = defaultGenome(); g.plan!.type = 1; g.build!.type = build; g.stand!.type = stand;
      const r = bake(g, plan, 'draft');
      const label = `build ${build} stand ${stand} ${r.pieces.length > 2 ? 'modular' : 'whole'}`;
      const body = r.pieces.find((p) => p.id === 'body')!.validation;
      if (!body.watertight || body.shells !== 1 || body.genus !== 0) bad.push(`${label} body: shells ${body.shells}, holes ${body.genus}`);
      const st = r.pieces.find((p) => p.id === 'stand');
      if (!stand) { if (st) bad.push(`${label}: stand without the gene`); continue; }
      if (!st) { bad.push(`${label}: no stand`); continue; }
      if (!st.validation.watertight || st.validation.shells !== 1 || st.validation.genus !== 0) bad.push(`${label} stand: shells ${st.validation.shells}, holes ${st.validation.genus}`);
      // every foot is held by a peg or, since jointed legs have slender ankles that cannot take a socket, a tab
      if (!st.joints.every((j) => j.peg !== null)) bad.push(`${label}: stand joints ${st.joints.map((j) => j.peg).join(',')}`);
      if (!st.joints.length) bad.push(`${label}: stand touches no foot`);
    }
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
        for (const j of p.joints) if (!(p.id === 'stand' ? ['body', 'legs'] : ['body', 'head']).includes(j.hostId)) bad.push(`${p.id} mounts on ${j.hostId}`);
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

    const f = export3mf(r, { name: 'Żbik', code: 'MPH2:B01.33#00' }, ['#e8e2d4', '#c25e4e', '#1c2230']);
    expect(f.name).toBe('Morphoid Żbik.3mf');
    const zip = unzipSync(f.bytes);
    expect(Object.keys(zip).sort()).toEqual(['3D/3dmodel.model', 'Metadata/dna.txt', '[Content_Types].xml', '_rels/.rels']);
    expect(strFromU8(zip['Metadata/dna.txt']!)).toContain('DNA: MPH2:B01.33#00');
    const xml = strFromU8(zip['3D/3dmodel.model']!);
    expect(xml).toContain('<metadata name="Title">Morphoid Żbik</metadata>');
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

describe('cosmic extras', () => {
  it('eye stalks, many eyes, antennae, crystals, a plume and a bird tail bake watertight, whole and modular', { timeout: 240000 }, () => {
    const bad: string[] = [];
    const cases: [string, (g: ReturnType<typeof defaultGenome>) => void][] = [
      ['stalks + ball antennae + plume', (g) => { g.face!.eyes = 4; g.antennae!.type = 1; g.antennae!.length = 5; g.crest!.type = 5; g.crest!.scale = 5; }],
      ['many eyes + feather antennae + crystals', (g) => { g.face!.eyes = 3; g.antennae!.type = 2; g.antennae!.length = 0; g.crest!.type = 4; g.crest!.scale = 5; }],
      ['bird: tail feathers + plume', (g) => { g.plan!.type = 1; g.tail!.type = 4; g.tail!.length = 5; g.crest!.type = 5; g.crest!.scale = 0; }],
    ];
    for (const [label, set] of cases) {
      const g = defaultGenome(); set(g);
      for (const plan of [planWhole(), planModular()]) for (const p of bake(g, plan, 'draft').pieces) {
        const v = p.validation;
        if (!v.watertight || (p.id === 'body' && v.shells !== 1)) bad.push(`${label} ${p.id}: shells ${v.shells}, edges ${v.badEdges}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
