import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  closedMenu, isActive, reduceMenu, viewMenu,
  type MenuEvent, type MenuState, type Slice, type SocketId,
} from '../../core';
import { studio } from '../studio';

const R_IN = 66, R_OUT = 132, R_MID = (R_IN + R_OUT) / 2, SIZE = 320;
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
                {sl.icon && <text className="slice-icon" x={tx} y={ty - 7}>{sl.icon}</text>}
                <text className="slice-label" x={tx} y={ty + (sl.icon ? 9 : 3)}>{sl.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
