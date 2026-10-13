import { describe, expect, it } from 'vitest';
import { defaultGenome, mulberry32, randomGenome, setField, serialize } from '../src/core/genome';
import { idleOffsets, nodeMatrix4, solveRig, SOCKET_NODE } from '../src/core/rig';

describe('rig', () => {
  it('anchors the lowest contact point at Y = 0 for EVERY leg/body/foot/neck/tail combination', () => {
    let g = defaultGenome();
    let n = 0;
    for (let leg = 0; leg < 6; leg++) for (let girth = 0; girth < 6; girth++)
      for (let foot = 0; foot < 3; foot++) for (let neck = 0; neck < 6; neck++)
        for (let tail = 0; tail < 6; tail++) {
          g = setField(g, 'legs', 'length', leg);
          g = setField(g, 'body', 'girth', girth);
          g = setField(g, 'legs', 'foot', foot);
          g = setField(g, 'head', 'neckLength', neck);
          g = setField(g, 'tail', 'length', tail);
          const rig = solveRig(g);
          const feet = rig.order.filter((id) => rig.nodes[id].contact).map((id) => rig.nodes[id].y);
          expect(Math.min(...feet)).toBeCloseTo(0, 9);
          expect(rig.issues, serialize(g)).toEqual([]);
          n++;
        }
    expect(n).toBe(6 * 6 * 3 * 6 * 6);
  });

  it('holds the invariants for 3000 random genomes', () => {
    const rnd = mulberry32(42);
    for (let i = 0; i < 3000; i++) {
      const rig = solveRig(randomGenome(rnd));
      expect(rig.issues, rig.code).toEqual([]);
      expect(rig.bounds.min[1]).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('hierarchy: a longer torso moves head/front legs forward and tail/hind legs back', () => {
    const short = solveRig(setField(defaultGenome(), 'body', 'length', 0));
    const long = solveRig(setField(defaultGenome(), 'body', 'length', 5));
    const dx = (id: keyof typeof short.nodes) =>
      long.nodes[id].x - short.nodes[id].x;
    expect(dx('head')).toBeGreaterThan(0);
    expect(dx('shoulderF')).toBeGreaterThan(0);
    expect(dx('footFL')).toBeGreaterThan(0);
    expect(dx('tailBase')).toBeLessThan(0);
    expect(dx('hipB')).toBeLessThan(0);
    expect(dx('footBL')).toBeLessThan(0);
  });

  it('longer legs lift the whole body, feet stay on the bed', () => {
    const lo = solveRig(setField(defaultGenome(), 'legs', 'length', 0));
    const hi = solveRig(setField(defaultGenome(), 'legs', 'length', 5));
    expect(hi.nodes.torso.y).toBeGreaterThan(lo.nodes.torso.y);
    expect(hi.nodes.footFL.y).toBeCloseTo(0);
  });

  it('is symmetric in Z and memoised', () => {
    const g = defaultGenome();
    const r = solveRig(g);
    expect(r.nodes.footFL.z).toBeCloseTo(-r.nodes.footFR.z);
    expect(solveRig(g)).toBe(r);
  });

  it('exposes 5 sockets and column-major matrices', () => {
    expect(Object.keys(SOCKET_NODE)).toHaveLength(5);
    const m = nodeMatrix4(solveRig(defaultGenome()).nodes.head);
    expect(m).toHaveLength(16);
    expect(m[15]).toBe(1);
  });

  it('idle animation never moves contact nodes', () => {
    const rig = solveRig(defaultGenome());
    const off = idleOffsets(rig, 1.234);
    for (const id of rig.order) if (rig.nodes[id].contact) expect(off[id]).toBeUndefined();
  });
});
