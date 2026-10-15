import { useEffect, useRef } from 'react';
import { dimensions as D, solveRig, withoutSculpt, SOCKET_NODE, type SocketId } from '../../core';
import { PALETTES } from '../../core/palette';
import { studio } from '../studio';
import { clonePose, easePose, targetPose, type Pose } from '../../core/art/pose';
import { buildPaths, rigSize } from '../../core/art/shapes';
import { HEAT, type HeatLevel, type PrintReport, type Severity } from '../../core/print';
import { drawSketch, HEAT_NAME, HEAT_SWATCH, insidePoly, type SketchMode, type SketchOutput } from '../sketch';
import { TILES } from '../tiles';

const W = 820, H = 520, SCALE = 4.6, CX = 430, GROUND = 440;
const to = (x: number, y: number) => [CX - x * SCALE, GROUND - y * SCALE] as const;

const SOCKETS: { id: SocketId; title: string }[] = [
  { id: 'head', title: 'Głowa, pysk, uszy i rogi' },
  { id: 'chest', title: 'Kark, szyja i skrzydła' },
  { id: 'tail', title: 'Nasada ogona' },
  { id: 'legF', title: 'Staw barkowy' },
  { id: 'legB', title: 'Staw biodrowy' },
];

const TITLE: Record<string, string> = Object.fromEntries(TILES.map((t) => [t.id, t.title]));
const RANK: Record<Severity, number> = { info: 0, support: 1, warn: 2, error: 3 };
const LEVELS: HeatLevel[] = [HEAT.none, HEAT.bed, HEAT.support, HEAT.attention];

/** The worst thing the print audit says about a body element, as one sentence and its colour. */
function verdict(tile: string, report: PrintReport, hits: SketchOutput['hits']): { text: string; level: HeatLevel } {
  const slots = new Set(hits.filter((h) => h.tile === tile).map((h) => h.slot));
  const name = TITLE[tile] ?? tile;
  const worst = report.issues
    .filter((i) => i.severity !== 'info' && i.slot && slots.has(i.slot))
    .sort((a, b) => RANK[b.severity] - RANK[a.severity])[0];
  if (!worst) return { text: `${name}: drukuje się bez pomocy.`, level: HEAT.none };
  const msg = worst.message.replace(/^[^:]+:\s*/, '');
  return { text: `${name}: ${msg}${/[.!?]$/.test(msg) ? '' : '.'}`, level: worst.severity === 'support' ? HEAT.support : HEAT.attention };
}

interface Props {
  showBones: boolean;
  mode: SketchMode;
  report: PrintReport;
  /** category lit up from the left column */
  hotTile: string | null;
  onHoverTile: (tile: string | null) => void;
  onPickTile: (tile: string) => void;
  onSocket: (socket: SocketId, screen: { x: number; y: number }) => void;
}

export function Canvas2D({ showBones, mode, report, hotTile, onHoverTile, onPickTile, onSocket }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketEls = useRef<Record<string, SVGGElement | null>>({});
  const sizeRef = useRef<SVGTextElement>(null);
  const infoRef = useRef<HTMLSpanElement>(null);
  const swRef = useRef<HTMLElement>(null);
  const legendRefs = useRef<(HTMLElement | null)[]>([]);
  /** the category under the pointer on the sketch itself */
  const pointerTile = useRef<string | null>(null);
  const live = useRef({ showBones, mode, report, hotTile });
  live.current = { showBones, mode, report, hotTile };
  const hitsRef = useRef<SketchOutput['hits']>([]);
  const dirtyRef = useRef(true);
  dirtyRef.current = true;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let cur: Pose | null = null;
    let lastKey = '';

    const resize = (): void => {
      const c = canvasRef.current, box = boxRef.current;
      if (!c || !box) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.clientWidth * dpr)), h = Math.max(1, Math.round(box.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; dirtyRef.current = true; }
    };
    const ro = new ResizeObserver(resize);
    if (boxRef.current) ro.observe(boxRef.current);
    resize();

    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { showBones: sb, mode: md, report: rep, hotTile: panelTile } = live.current;
      // the sketch draws the creature without its 3D-only deformation (fine sliders)
      const g = withoutSculpt(studio.getState().genome);
      const rig = solveRig(g);
      // the creature stands still: no breathing, the head does not follow the cursor
      const tgt = targetPose(rig, g, 0, false, { x: 0, y: 0 });
      if (!cur) cur = clonePose(tgt);
      const remaining = easePose(cur, tgt, 1 - Math.exp(-dt * 14));
      const hot = pointerTile.current ?? panelTile;
      const key = `${rig.code}|${sb}|${md}|${hot}|${g.palette!.index}`;
      if (key !== lastKey) { dirtyRef.current = true; lastKey = key; }

      const c = canvasRef.current;
      if (c && (dirtyRef.current || remaining > 1e-3)) {
        dirtyRef.current = false;
        const ctx = c.getContext('2d')!;
        const k = c.width / W;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        // rig mm -> canvas pixels: forward (+x) to the left, up (+y) up
        ctx.setTransform(-SCALE * k, 0, 0, -SCALE * k, CX * k, GROUND * k);
        const paths = buildPaths(cur, g, rig, sb);
        const torso = cur.pos.torso;
        const out = drawSketch(ctx, 1 / (SCALE * k), {
          paths, mode: md, palette: PALETTES[g.palette!.index!] ?? PALETTES[0]!, report: rep, hot, showBones: sb,
          insect: rig.dims.plan === D.PLAN.insect, away: [torso[0], torso[1]], torso: [torso[0], torso[1]],
        });
        hitsRef.current = out.hits;

        // the line under the sketch: the lit element's verdict, or how the whole figure prints
        const total = LEVELS.reduce<number>((s2, l) => s2 + out.area[l], 0) || 1;
        LEVELS.forEach((l, i) => {
          const el = legendRefs.current[i];
          if (el) el.textContent = `${Math.round((out.area[l] / total) * 100)}%`;
        });
        if (infoRef.current && swRef.current) {
          if (hot) {
            const v = verdict(hot, rep, out.hits);
            infoRef.current.textContent = md === 'print' ? `${v.text} Kliknij, żeby zmienić.` : `${TITLE[hot] ?? hot}. Kliknij, żeby zmienić.`;
            swRef.current.style.background = md === 'print' ? HEAT_SWATCH[v.level] : 'var(--c1)';
          } else {
            infoRef.current.textContent = md === 'print'
              ? 'Kolor mówi, jak dany fragment się wydrukuje. Najedź na część ciała po szczegóły, kliknij, żeby ją zmienić.'
              : 'Najedź na część ciała, kliknij, żeby ją zmienić.';
            swRef.current.style.background = md === 'print' ? HEAT_SWATCH[HEAT.none] : 'var(--c1)';
          }
        }
        boxRef.current?.style.setProperty('--c1', (PALETTES[g.palette!.index!] ?? PALETTES[0]!)[0]);

        for (const s of SOCKETS) {
          const [x, y] = to(...cur.pos[SOCKET_NODE[s.id]]);
          socketEls.current[s.id]?.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
          // a biped has no front legs: no shoulder socket
          socketEls.current[s.id]?.setAttribute('visibility', s.id === 'legF' && D.isBiped(rig.dims.plan) ? 'hidden' : 'visible');
        }
        if (sizeRef.current) {
          const sz = rigSize(rig);
          sizeRef.current.textContent = `${sz.length.toFixed(0)} × ${sz.width.toFixed(0)} × ${sz.height.toFixed(0)} mm`;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  /** the body element under a screen point, front-most first */
  const tileAt = (e: React.PointerEvent | React.MouseEvent): string | null => {
    const box = boxRef.current;
    if (!box) return null;
    const r = box.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const x = (CX - px) / SCALE, y = (GROUND - py) / SCALE;
    const hits = hitsRef.current;
    for (let i = hits.length - 1; i >= 0; i--) if (hits[i]!.polys.some((p) => insidePoly(p, x, y))) return hits[i]!.tile;
    return null;
  };
  const hover = (t: string | null): void => {
    if (pointerTile.current === t) return;
    pointerTile.current = t;
    dirtyRef.current = true;
    onHoverTile(t);
  };

  return (
    <div className="creature-viewport sketch" ref={boxRef}
      style={{ cursor: undefined }}
      onPointerMove={(e) => { const t = tileAt(e); hover(t); (e.currentTarget as HTMLElement).style.cursor = t ? 'pointer' : ''; }}
      onPointerLeave={() => hover(null)}
      onClick={(e) => { const t = tileAt(e); if (t) onPickTile(t); }}>
      <svg className="sketch-back" viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <rect className="desk" x={0} y={GROUND} width={W} height={H - GROUND} />
        <line className="desk-edge" x1={0} x2={W} y1={GROUND} y2={GROUND} />
      </svg>
      <canvas ref={canvasRef} className="sketch-canvas" role="img" aria-label="Rzut boczny Morphoida" />
      <svg className="sketch-front" viewBox={`0 0 ${W} ${H}`}>
        <text ref={sizeRef} className="size-label" x={W - 24} y={28} textAnchor="end" />
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
      <div className="sketch-info">
        <i ref={swRef} className="sk-sw" />
        <span ref={infoRef} className="sketch-info-t" />
        {mode === 'print' && (
          <span className="sketch-legend">
            {LEVELS.map((l, i) => (
              <span key={l} title={HEAT_NAME[l]}><i className="sk-sw" style={{ background: HEAT_SWATCH[l] }} /><b ref={(el) => { legendRefs.current[i] = el; }} /></span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
