import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  closedMenu, isActive, reduceMenu, viewMenu,
  type MenuEvent, type MenuState, type Slice, type SocketId,
} from '../../core';
import { studio } from '../studio';
import { makeThumb, type Thumb } from '../thumbs';

const R_IN = 66, R_OUT = 152, R_MID = (R_IN + R_OUT) / 2, SIZE = 360;
/** Side (px) of an option's sketch inside its slice. */
const THUMB = 54;
const GAP = 0.03;

export interface RadialController {
  state: MenuState;
  center: { x: number; y: number };
  open: (socket: SocketId, center: { x: number; y: number }) => void;
  dispatch: (ev: MenuEvent) => void;
}

interface Internal { state: MenuState; center: { x: number; y: number }; changed: boolean }

/**
 * Binds the pure menu machine to the store. `changed` remembers whether the
 * last commit really modified the genome, so a Back-after-choice only calls
 * undo() when there is something of ours to undo.
 */
export function useRadial(): RadialController {
  const [s, setS] = useReducer(
    (_: Internal, next: Internal) => next, { state: closedMenu, center: { x: 0, y: 0 }, changed: false },
  );
  const ref = useRef(s);
  ref.current = s;

  const dispatch = useCallback((ev: MenuEvent) => {
    const cur = ref.current;
    const { state, effects } = reduceMenu(cur.state, ev);
    let changed = cur.changed;
    for (const fx of effects) {
      if (fx.type === 'commit') changed = studio.applyOps(fx.ops);
      else if (fx.type === 'revert') { if (changed) studio.undo(); changed = false; }
    }
    const next = { state, center: cur.center, changed };
    ref.current = next;
    setS(next);
  }, []);

  const open = useCallback((socket: SocketId, center: { x: number; y: number }) => {
    const { state } = reduceMenu(closedMenu, { type: 'open', socket });
    const next = { state, center, changed: false };
    ref.current = next;
    setS(next);
  }, []);

  return { state: s.state, center: s.center, open, dispatch };
}

const pol = (r: number, a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)];

function slicePath(a0: number, a1: number): string {
  const [x1, y1] = pol(R_OUT, a0), [x2, y2] = pol(R_OUT, a1), [x3, y3] = pol(R_IN, a1), [x4, y4] = pol(R_IN, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x1},${y1} A${R_OUT},${R_OUT} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${R_IN},${R_IN} 0 ${large} 0 ${x4},${y4}Z`;
}

export function RadialMenu({ ctl }: { ctl: RadialController }) {
  const { state, center, dispatch } = ctl;
  const hostRef = useRef<HTMLDivElement>(null);
  const genome = studio.getState().genome;
  const view = viewMenu(state);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') dispatch({ type: 'close' }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open, dispatch]);

  // every option's sketch: the part as this creature would get it (built once per menu level)
  const thumbs = useMemo(() => {
    const out: Record<string, Thumb> = {};
    for (const sl of view?.slices ?? []) {
      const pv = sl.node?.preview;
      if (!pv) continue;
      try { out[sl.id] = makeThumb(genome, pv.ops, pv.block, pv.field); } catch { /* a sketch that cannot be drawn shows the label only */ }
    }
    return out;
  }, [view, genome]);

  if (!view) return null;

  const angleOf = (e: React.MouseEvent): number => {
    const r = hostRef.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };

  const click = (e: React.MouseEvent, sl: Slice): void => {
    e.stopPropagation();
    const angle = angleOf(e);
    dispatch(sl.isBack ? { type: 'back', angle } : { type: 'pick', id: sl.id, angle });
  };

  return (
    <div className="radial-backdrop" onClick={() => dispatch({ type: 'close' })}>
      <div ref={hostRef} className="radial-host" style={{ left: center.x, top: center.y, width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}>
          <circle className="radial-guide" r={R_IN - 8} />
          <text className="radial-title" y={-4}>{view.title}</text>
          {view.slices.map((sl) => {
            const [tx, ty] = pol(R_MID, sl.angle);
            const active = !sl.isBack && sl.node?.op && isActive(genome, sl.node.op) && !sl.node.pre;
            return (
              <g key={sl.id} className={`slice${sl.isBack ? ' back' : ''}${active ? ' active' : ''}`} onClick={(e) => click(e, sl)}>
                <path d={slicePath(sl.start + GAP / 2, sl.end - GAP / 2)} />
                {thumbs[sl.id] ? (
                  <svg className="slice-thumb" x={tx - THUMB / 2} y={ty - THUMB / 2 - 9} width={THUMB} height={THUMB} viewBox={thumbs[sl.id]!.viewBox}>
                    {thumbs[sl.id]!.layers.map((l, i) => (
                      <path key={i} d={l.d} style={{ fill: l.fill, stroke: l.stroke, strokeWidth: 0.7, opacity: l.opacity, strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke' }} />
                    ))}
                  </svg>
                ) : sl.icon && <text className="slice-icon" x={tx} y={ty - 7}>{sl.icon}</text>}
                <text className="slice-label" x={tx} y={ty + (thumbs[sl.id] ? 27 : sl.icon ? 9 : 3)}>{sl.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
