import { describe, expect, it } from 'vitest';
import { defaultGenome, serialize } from '../src/core/genome';
import {
  applyOp, closedMenu, hitSlice, reduceMenu, treeForSocket, viewMenu, normAngle,
  type MenuEvent, type MenuState,
} from '../src/core/radial';
import { createStudioStore } from '../src/core/store';
import type { SocketId } from '../src/core/rig';

const run = (s: MenuState, ev: MenuEvent) => reduceMenu(s, ev);

describe('radial menu / Zero-Travel Undo', () => {
  it('builds a tree for all 5 sockets', () => {
    for (const s of ['head', 'chest', 'tail', 'legF', 'legB'] as SocketId[]) {
      expect(treeForSocket(s).children!.length).toBeGreaterThan(0);
    }
  });

  it('Back is centred on the click angle for ANY click angle and ring depth', () => {
    for (const clickAngle of [-3, -1.1, 0, 0.4, 2.2, 5.9]) {
      let { state } = run(closedMenu, { type: 'open', socket: 'head' });
      const root = viewMenu(state)!;
      expect(root.slices.some((s) => s.isBack)).toBe(false);
      ({ state } = run(state, { type: 'pick', id: 'horns', angle: clickAngle }));
      let v = viewMenu(state)!;
      const back = v.slices.find((s) => s.isBack)!;
      expect(normAngle(back.angle)).toBeCloseTo(normAngle(clickAngle));
      // the cursor really is inside the Back slice
      expect(hitSlice(v.slices, clickAngle)!.isBack).toBe(true);
      // go one level deeper and check again with a different click angle
      ({ state } = run(state, { type: 'pick', id: 'horns.devil', angle: clickAngle + 1 }));
      v = viewMenu(state)!;
      expect(hitSlice(v.slices, clickAngle + 1)!.isBack).toBe(true);
    }
  });

  it('leaf choice commits, shows only Back under the cursor, Back reverts', () => {
    const store = createStudioStore();
    const before = store.code();
    let { state } = run(closedMenu, { type: 'open', socket: 'head' });
    ({ state } = run(state, { type: 'pick', id: 'horns', angle: 0.3 }));
    ({ state } = run(state, { type: 'pick', id: 'horns.devil', angle: 1.0 }));
    let r = run(state, { type: 'pick', id: 'horns.devil.size2', angle: 2.0 });
    state = r.state;
    expect(r.effects).toEqual([{ type: 'commit', ops: expect.any(Array) }]);
    const eff = r.effects[0]!;
    if (eff.type === 'commit') store.applyOps(eff.ops);
    expect(store.getState().genome.horns).toEqual({ type: 1, span: 4 });
    const v = viewMenu(state)!;
    expect(v.slices).toHaveLength(1);
    expect(v.slices[0]!.isBack).toBe(true);
    expect(normAngle(v.slices[0]!.angle)).toBeCloseTo(2.0);

    r = run(state, { type: 'back', angle: 2.0 });
    expect(r.effects).toEqual([{ type: 'revert' }]);
    store.undo();
    expect(store.code()).toBe(before);
    // we are back on the size level with Back under the cursor
    expect(hitSlice(viewMenu(r.state)!.slices, 2.0)!.isBack).toBe(true);
  });

  it('Back in a submenu goes up one level; at the root it closes', () => {
    let { state } = run(closedMenu, { type: 'open', socket: 'tail' });
    ({ state } = run(state, { type: 'pick', id: 'tail', angle: 1 }));
    ({ state } = run(state, { type: 'back', angle: 1 }));
    expect(state.path).toHaveLength(0);
    ({ state } = run(state, { type: 'back', angle: 1 }));
    expect(state.open).toBe(false);
  });

  it('applying a size op keeps the 2N step when already inside the class', () => {
    let g = applyOp(defaultGenome(), { kind: 'set', block: 'horns', field: 'type', value: 2 });
    g = applyOp(g, { kind: 'size', block: 'horns', field: 'span', cls: 1 });
    const step = g.horns!.span!;
    expect(step).toBe(2);
    expect(applyOp(g, { kind: 'size', block: 'horns', field: 'span', cls: 1 }).horns!.span).toBe(2);
  });
});

describe('store', () => {
  it('undo/redo, loadCode and deterministic randomize', () => {
    const s = createStudioStore();
    s.randomize(11);
    const a = s.code();
    s.randomize(12);
    s.undo();
    expect(s.code()).toBe(a);
    s.redo();
    expect(s.code()).not.toBe(a);
    const other = createStudioStore();
    other.randomize(11);
    expect(other.code()).toBe(a);
    expect(s.loadCode('MPH-garbage').ok).toBe(false);
    expect(s.loadCode(a).ok).toBe(true);
    expect(serialize(s.getState().genome)).toBe(a);
  });
});
