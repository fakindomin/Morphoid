import { useEffect, useRef } from 'react';
import { solveRig, SOCKET_NODE, type SocketId } from '../../core';
import { studio } from '../studio';
import { clonePose, easePose, targetPose, type Pose } from '../render2d/pose';
import { buildShapes, SLOTS, rigSize, type Shapes } from '../render2d/shapes';

const W = 820, H = 520, SCALE = 4.6, CX = 430, GROUND = 440;
const to = (x: number, y: number) => [CX - x * SCALE, GROUND - y * SCALE] as const;

const SOCKETS: { id: SocketId; title: string }[] = [
  { id: 'head', title: 'Głowa, pysk, uszy i rogi' },
  { id: 'chest', title: 'Kark, szyja i skrzydła' },
  { id: 'tail', title: 'Nasada ogona' },
  { id: 'legF', title: 'Staw barkowy' },
  { id: 'legB', title: 'Staw biodrowy' },
];

interface Props {
  showBones: boolean;
  breathing: boolean;
  /** menu open: freeze idle + mouse tracking so sockets don't drift under the cursor */
  frozen: boolean;
  onSocket: (socket: SocketId, screen: { x: number; y: number }) => void;
}

export function Canvas2D({ showBones, breathing, frozen, onSocket }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const slotEls = useRef<Record<string, SVGPathElement | null>>({});
  const socketEls = useRef<Record<string, SVGGElement | null>>({});
  const sizeRef = useRef<SVGTextElement>(null);
  const live = useRef({ showBones, breathing, frozen });
  live.current = { showBones, breathing, frozen };
  const mouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let cur: Pose | null = null;
    let lastCode = '';
    const cache: Partial<Record<keyof Shapes, string>> = {};
    let dirty = true;
    let lastBones = live.current.showBones;

    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { breathing: br, frozen: fz, showBones: sb } = live.current;
      const g = studio.getState().genome;
      const rig = solveRig(g);
      if (br && !fz) t += dt * 2;
      const m = fz ? { x: 0, y: 0 } : mouse.current;
      const tgt = targetPose(rig, g, t, br && !fz, m);
      if (!cur) cur = clonePose(tgt);
      const remaining = easePose(cur, tgt, 1 - Math.exp(-dt * 14));
      if (rig.code !== lastCode || sb !== lastBones) { dirty = true; lastCode = rig.code; lastBones = sb; }

      if (dirty || remaining > 1e-3 || (br && !fz)) {
        const shapes = buildShapes(cur, g, rig, to, sb);
        for (const [id] of SLOTS) {
          if (cache[id] !== shapes[id]) {
            cache[id] = shapes[id];
            slotEls.current[id]?.setAttribute('d', shapes[id]);
          }
        }
        for (const s of SOCKETS) {
          const [x, y] = to(...cur.pos[SOCKET_NODE[s.id]]);
          socketEls.current[s.id]?.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        }
        if (sizeRef.current) {
          const sz = rigSize(rig);
          sizeRef.current.textContent = `${sz.length.toFixed(0)} × ${sz.width.toFixed(0)} × ${sz.height.toFixed(0)} mm`;
        }
        dirty = remaining > 1e-3;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onMove = (e: React.PointerEvent): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const rx = (e.clientX - r.left) / r.width - 0.5, ry = (e.clientY - r.top) / r.height - 0.5;
    mouse.current = { x: -rx * 3.5, y: -ry * 2.5 }; // +x is "forward" = screen-left
  };

  const [gx0] = to(-200, 0), [gx1] = to(200, 0);

  return (
    <div className="creature-viewport" onPointerMove={onMove}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Rzut boczny Morphoida">
        <line className="ground-line" x1={gx1} x2={gx0} y1={GROUND} y2={GROUND} />
        <text className="ground-label" x={24} y={GROUND + 18}>POZIOM STOŁU (Y = 0)</text>
        <text className="ground-label" x={W - 24} y={GROUND + 18} textAnchor="end">PEŁNA ADHEZJA STÓP</text>
        <text ref={sizeRef} className="size-label" x={W - 24} y={28} textAnchor="end" />
        {SLOTS.map(([id, kind]) => (
          <path key={id} ref={(el) => { slotEls.current[id] = el; }} className={`shape ${kind}`} d="" />
        ))}
        {SOCKETS.map((s) => (
          <g key={s.id} ref={(el) => { socketEls.current[s.id] = el; }} className="socket"
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              onSocket(s.id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }}>
            <title>{s.title}</title>
            <circle className="socket-hit" r={16} />
            <circle className="socket-ring" r={11} />
            <circle className="socket-dot" r={7} />
          </g>
        ))}
      </svg>
    </div>
  );
}
