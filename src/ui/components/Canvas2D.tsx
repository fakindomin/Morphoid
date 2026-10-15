import { useEffect, useRef, useState } from 'react';
import { dimensions as D, solveRig, withoutSculpt } from '../../core';
import { PALETTES } from '../../core/palette';
import { studio } from '../studio';
import { clonePose, easePose, targetPose, type Pose } from '../../core/art/pose';
import { buildPaths, rigSize } from '../../core/art/shapes';
import { HEAT, type HeatLevel, type PrintReport, type Severity } from '../../core/print';
import { drawSketch, HEAT_NAME, HEAT_SWATCH, insidePoly, type SketchMode, type SketchOutput } from '../sketch';
import { TILES } from '../tiles';

/**
 * The sketch fills the whole stage: the creature is scaled to fit it (px per mm), standing on a desk line near the
 * bottom (room for the info line under it), with room above for the tools. A new shape eases to its new scale.
 */
interface View { w: number; h: number; scale: number; cx: number; ground: number }
const MARGIN_X = 36, TOP = 96, BELOW = 70, MAX_SCALE = 18, MIN_SCALE = 1.5;
const groundOf = (h: number): number => h - Math.max(BELOW, h * 0.12);
/** The creature's drawn extent (mm), from every part's outline (the shadow excluded). */
function extentOf(paths: Record<string, { empty: boolean; flatten: (n?: number) => [number, number][][] }>): { x0: number; x1: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y1 = 0;
  for (const [slot, p] of Object.entries(paths)) {
    if (slot === 'shadow' || p.empty) continue;
    for (const line of p.flatten(3)) for (const [x, y] of line) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  return Number.isFinite(x0) ? { x0, x1, y1 } : { x0: -40, x1: 40, y1: 60 };
}

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
}

export function Canvas2D({ showBones, mode, report, hotTile, onHoverTile, onPickTile }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
  const [size, setSize] = useState({ w: 820, h: 520 });
  const viewRef = useRef<View>({ w: 820, h: 520, scale: 4.6, cx: 410, ground: groundOf(520) });
  const to = (x: number, y: number): readonly [number, number] => {
    const v = viewRef.current;
    return [v.cx - x * v.scale, v.ground - y * v.scale] as const;
  };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let cur: Pose | null = null;
    let lastKey = '';
    // the scale and centre the view eases to, refitted whenever the shape or the stage size changes
    let fitKey = '', fit = { scale: 4.6, cx: 410 };

    const resize = (): void => {
      const c = canvasRef.current, box = boxRef.current;
      if (!c || !box) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(box.clientWidth * dpr)), h = Math.max(1, Math.round(box.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; dirtyRef.current = true; }
      const v = viewRef.current, cw = Math.max(1, box.clientWidth), ch = Math.max(1, box.clientHeight);
      if (v.w !== cw || v.h !== ch) { v.w = cw; v.h = ch; v.ground = groundOf(ch); fitKey = ''; setSize({ w: cw, h: ch }); }
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

      const c = canvasRef.current, v = viewRef.current;
      if (rig.code !== fitKey) {
        // fit the resting shape (not the easing one) into the stage
        const e = extentOf(buildPaths(tgt, g, rig, false) as never);
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (v.w - 2 * MARGIN_X) / Math.max(1, e.x1 - e.x0), (v.ground - TOP) / Math.max(1, e.y1)));
        fit = { scale, cx: v.w / 2 + ((e.x0 + e.x1) / 2) * scale };
        if (!fitKey) { v.scale = fit.scale; v.cx = fit.cx; }
        fitKey = rig.code;
      }
      const ease = 1 - Math.exp(-dt * 10);
      const moving = Math.abs(fit.scale - v.scale) > 1e-3 || Math.abs(fit.cx - v.cx) > 0.05;
      if (moving) { v.scale += (fit.scale - v.scale) * ease; v.cx += (fit.cx - v.cx) * ease; }
      if (c && (dirtyRef.current || remaining > 1e-3 || moving)) {
        dirtyRef.current = false;
        const ctx = c.getContext('2d')!;
        const k = c.width / v.w;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        // rig mm -> canvas pixels: forward (+x) to the left, up (+y) up
        ctx.setTransform(-v.scale * k, 0, 0, -v.scale * k, v.cx * k, v.ground * k);
        const paths = buildPaths(cur, g, rig, sb);
        const torso = cur.pos.torso;
        const out = drawSketch(ctx, 1 / (v.scale * k), {
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
    const v = viewRef.current, px = e.clientX - r.left, py = e.clientY - r.top;
    const x = (v.cx - px) / v.scale, y = (v.ground - py) / v.scale;
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
      <svg className="sketch-back" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden>
        <rect className="desk" x={0} y={groundOf(size.h)} width={size.w} height={size.h - groundOf(size.h)} />
        <line className="desk-edge" x1={0} x2={size.w} y1={groundOf(size.h)} y2={groundOf(size.h)} />
      </svg>
      <canvas ref={canvasRef} className="sketch-canvas" role="img" aria-label="Rzut boczny Morphoida" />
      <svg className="sketch-front" viewBox={`0 0 ${size.w} ${size.h}`}>
        <text ref={sizeRef} className="size-label" x={size.w - 24} y={28} textAnchor="end" />
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
