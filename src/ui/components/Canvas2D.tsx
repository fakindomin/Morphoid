import { useEffect, useRef, useState } from 'react';
import { dimensions as D, solveRig, withoutSculpt } from '../../core';
import { PALETTES } from '../../core/palette';
import { studio } from '../studio';
import { clonePose, easePose, targetPose, type Pose } from '../../core/art/pose';
import { buildPaths, rigSize } from '../../core/art/shapes';
import { HEAT, type HeatLevel, type PrintReport } from '../../core/print';
import { drawParts, drawSketch, HEAT_NAME, HEAT_SWATCH, insidePoly, type SketchMode, type SketchOutput } from '../sketch';
import { viewOptions, useViewOptions, type ViewId } from '../viewOptions';
import { viewsFor } from '../viewsClient';
import { extentOfView, morphParts, type End } from '../viewMorph';
import { TILES } from '../tiles';

/**
 * The sketch fills the whole stage: the creature is scaled to fit it (px per mm), standing on a desk line near the
 * bottom (room for the info line under it), with room above for the tools. A new shape eases to its new scale.
 */
/** `lift`: px the drawing is raised off the desk line (the top view floats in the middle of the stage) */
interface View { w: number; h: number; scale: number; cx: number; ground: number; lift: number }
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
/** the legend's three colours: blue safe, red supports, steel on the bed */
const LEVELS: HeatLevel[] = [HEAT.none, HEAT.support, HEAT.bed];
/** how long the sketch takes to turn from one view to another (ms), and to morph a new shape in a turned view */
const TURN_MS = 750, RESHAPE_MS = 380;
/** the full side drawing (eyes, mouth, pattern) fades out as a turn starts and back in as it ends (ms) */
const FADE_MS = 220, FADE_IN_MS = 380;
const AXES: [ViewId, string][] = [['side', 'Bok'], ['front', 'Przód'], ['top', 'Góra']];
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The print colour of a body element: red when the audit found anything that needs supports or care on it. */
function verdict(tile: string, report: PrintReport, hits: SketchOutput['hits']): HeatLevel {
  const slots = new Set(hits.filter((h) => h.tile === tile).map((h) => h.slot));
  return report.issues.some((i) => i.severity !== 'info' && i.slot && slots.has(i.slot)) ? HEAT.support : HEAT.none;
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
  const sizeRef = useRef<HTMLSpanElement>(null);
  const infoRef = useRef<HTMLSpanElement>(null);
  const swRef = useRef<HTMLElement>(null);
  const legendRefs = useRef<(HTMLElement | null)[]>([]);
  const legendBoxRef = useRef<HTMLSpanElement>(null);
  /** the category under the pointer on the sketch itself */
  const pointerTile = useRef<string | null>(null);
  const live = useRef({ showBones, mode, report, hotTile });
  live.current = { showBones, mode, report, hotTile };
  const hitsRef = useRef<SketchOutput['hits']>([]);
  const dirtyRef = useRef(true);
  dirtyRef.current = true;
  const [size, setSize] = useState({ w: 820, h: 520 });
  const { view: axis } = useViewOptions();
  const viewRef = useRef<View>({ w: 820, h: 520, scale: 4.6, cx: 410, ground: groundOf(520), lift: 0 });
  const to = (x: number, y: number): readonly [number, number] => {
    const v = viewRef.current;
    return [v.cx - x * v.scale, v.ground - v.lift - y * v.scale] as const;
  };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let cur: Pose | null = null;
    let lastKey = '';
    // the scale and centre the view eases to, refitted whenever the shape or the stage size changes
    let fitKey = '', fit = { scale: 4.6, cx: 410, lift: 0 }, snap = true;
    // the turned views: what is on screen (`shown`) and the turn under way (`turn`); null `shown` = the classic side view
    let shown: End | null = null;
    let turn: { from: End; to: End; t0: number; ms: number; fitFrom: { scale: number; cx: number; lift: number } } | null = null;
    const fitOf = (e: { x0: number; x1: number; y1: number; view?: ViewId }): { scale: number; cx: number; lift: number } => {
      const v = viewRef.current;
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (v.w - 2 * MARGIN_X) / Math.max(1, e.x1 - e.x0), (v.ground - TOP) / Math.max(1, e.y1)));
      const lift = e.view === 'top' ? Math.max(0, (v.ground - TOP - e.y1 * scale) / 2) : 0;
      return { scale, cx: v.w / 2 + ((e.x0 + e.x1) / 2) * scale, lift };
    };

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
      raf = requestAnimationFrame(frame); // first: one frame that throws must not leave the sketch blank for good
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
      // which view to show, and whether a turn starts
      const want = viewOptions.get().view;
      const vs = viewsFor(g);
      const at: End | null = turn ? turn.to : shown;
      if (vs && (want !== (at?.view ?? 'side') || (at && at.vs !== vs && want !== 'side'))) {
        const from: End = at ?? { vs, view: 'side' };
        const v = viewRef.current;
        turn = { from, to: { vs, view: want }, t0: now, ms: from.view === want ? RESHAPE_MS : TURN_MS, fitFrom: { scale: v.scale, cx: v.cx, lift: v.lift } };
        shown = null;
      }
      boxRef.current?.setAttribute('data-view', turn ? turn.to.view : shown?.view ?? 'side');
      const key = `${rig.code}|${sb}|${md}|${hot}|${g.palette!.index}|${Object.values(g.colors ?? {}).join(',')}|${shown?.view ?? '-'}|${vs ? 1 : 0}`;
      if (key !== lastKey) { dirtyRef.current = true; lastKey = key; }

      const c = canvasRef.current, v = viewRef.current;
      // the full side drawing's own fit (its outline, not the projected solid's): a turn back to the side ends exactly on it
      let sideFit: { scale: number; cx: number; lift: number } | null = null;
      const fitSide = (): { scale: number; cx: number; lift: number } => {
        if (sideFit) return sideFit;
        const e = extentOf(buildPaths(tgt, g, rig, false) as never);
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (v.w - 2 * MARGIN_X) / Math.max(1, e.x1 - e.x0), (v.ground - TOP) / Math.max(1, e.y1)));
        return (sideFit = { scale, cx: v.w / 2 + ((e.x0 + e.x1) / 2) * scale, lift: 0 });
      };
      if (!turn && !shown && rig.code !== fitKey) {
        // fit the resting shape (not the easing one) into the stage
        fit = fitSide();
        // only the first fit jumps; later ones (a new shape) glide
        if (snap) { v.scale = fit.scale; v.cx = fit.cx; v.lift = 0; snap = false; }
        fitKey = rig.code;
      }
      let turnT = 1;
      if (turn) {
        // the turn: the view's scale and centre glide from where they were to the new view's own fit
        turnT = Math.min(1, (now - turn.t0) / turn.ms);
        const e = easeInOut(turnT), f1 = turn.to.view === 'side' ? fitSide() : fitOf(extentOfView(turn.to));
        v.scale = turn.fitFrom.scale + (f1.scale - turn.fitFrom.scale) * e;
        v.cx = turn.fitFrom.cx + (f1.cx - turn.fitFrom.cx) * e;
        v.lift = turn.fitFrom.lift + (f1.lift - turn.fitFrom.lift) * e;
      } else if (shown) fit = fitOf(extentOfView(shown));
      const ease = 1 - Math.exp(-dt * 10);
      const moving = !turn && (Math.abs(fit.scale - v.scale) > 1e-3 || Math.abs(fit.cx - v.cx) > 0.05 || Math.abs(fit.lift - v.lift) > 0.05);
      if (moving) { v.scale += (fit.scale - v.scale) * ease; v.cx += (fit.cx - v.cx) * ease; v.lift += (fit.lift - v.lift) * ease; }
      if (c && (dirtyRef.current || remaining > 1e-3 || moving || turn)) {
        dirtyRef.current = false;
        const ctx = c.getContext('2d')!;
        const k = c.width / v.w;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        // rig mm -> canvas pixels: forward (+x) to the left, up (+y) up
        ctx.setTransform(-v.scale * k, 0, 0, -v.scale * k, v.cx * k, (v.ground - v.lift) * k);
        const palette = PALETTES[g.palette!.index!] ?? PALETTES[0]!;
        let out: SketchOutput;
        const classic = (): SketchOutput => {
          const paths = buildPaths(cur!, g, rig, sb);
          const torso = cur!.pos.torso;
          return drawSketch(ctx, 1 / (v.scale * k), {
            paths, mode: md, palette, colors: g.colors, report: rep, hot, showBones: sb,
            insect: rig.dims.plan === D.PLAN.insect, away: [torso[0], torso[1]], torso: [torso[0], torso[1]],
          });
        };
        const over = (alpha: number, under: SketchOutput): SketchOutput => {
          ctx.globalAlpha = alpha;
          const o = classic();
          ctx.globalAlpha = 1;
          return alpha > 0.5 ? o : under;
        };
        if (turn || shown) {
          const [from, to] = turn ? [turn.from, turn.to] : [shown!, shown!];
          const parts = morphParts(from, to, turn ? easeInOut(turnT) : 1, rep.heat, md === 'print');
          // coming back to the side: the full drawing (eyes, mouth, pattern) takes over during the end of the turn, in
          // the same place and size, so the turn ends on it with no swap and no jump
          const left = turn ? turn.ms * (1 - turnT) : Infinity;
          const back = turn && turn.to.view === 'side' && left < FADE_IN_MS ? easeInOut(1 - left / FADE_IN_MS) : 0;
          ctx.globalAlpha = 1 - back;
          out = drawParts(ctx, 1 / (v.scale * k), { parts, mode: md, palette, hot });
          ctx.globalAlpha = 1;
          const since = turn ? now - turn.t0 : FADE_MS;
          if (turn && turn.from.view === 'side' && since < FADE_MS) out = over(1 - since / FADE_MS, out);
          if (back > 0) out = over(back, out);
          if (turn && turnT >= 1) {
            shown = turn.to.view === 'side' ? null : turn.to;
            if (!shown) { fit = fitSide(); fitKey = rig.code; v.scale = fit.scale; v.cx = fit.cx; v.lift = 0; }
            turn = null;
            dirtyRef.current = true;
          }
        } else {
          out = classic();
        }
        hitsRef.current = out.hits;

        // the line under the sketch: the lit element's verdict, or how the whole figure prints
        out.area[HEAT.support] += out.area[HEAT.attention];
        out.area[HEAT.attention] = 0;
        const total = LEVELS.reduce<number>((s2, l) => s2 + out.area[l], 0) || 1;
        LEVELS.forEach((l, i) => {
          const el = legendRefs.current[i];
          if (el) el.textContent = `${Math.round((out.area[l] / total) * 100)}%`;
        });
        // the top view shows the shape only: no support colours there, so no legend either
        const fromAbove = md === 'print' && (turn ? turn.to.view : shown?.view) === 'top';
        if (legendBoxRef.current) legendBoxRef.current.style.display = fromAbove ? 'none' : '';
        // the line under the sketch: which part is under the pointer (no advice on supports: that is the slicer's job)
        if (infoRef.current && swRef.current) {
          infoRef.current.textContent = hot ? `${TITLE[hot] ?? hot}. Kliknij, żeby zmienić.` : 'Kliknij część ciała, żeby ją zmienić.';
          swRef.current.style.background = md !== 'print' ? 'var(--c1)' : hot && !fromAbove ? HEAT_SWATCH[verdict(hot, rep, out.hits)] : HEAT_SWATCH[HEAT.none];
        }
        boxRef.current?.style.setProperty('--c1', (PALETTES[g.palette!.index!] ?? PALETTES[0]!)[0]);

        if (sizeRef.current) {
          const sz = rigSize(rig);
          sizeRef.current.textContent = `${sz.length.toFixed(0)} × ${sz.width.toFixed(0)} × ${sz.height.toFixed(0)} mm`;
        }
      }
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
    const x = (v.cx - px) / v.scale, y = (v.ground - v.lift - py) / v.scale;
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
      <canvas ref={canvasRef} className="sketch-canvas" role="img" aria-label={`Morphoid, widok: ${AXES.find((a) => a[0] === axis)![1]}`} />
      <div className="seg-mini view-axes" role="group" aria-label="Widok 2D" onPointerMove={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        {AXES.map(([id, label]) => (
          <button key={id} type="button" className={axis === id ? 'on' : ''} aria-pressed={axis === id} onClick={() => viewOptions.setView(id)}>{label}</button>
        ))}
      </div>
      <div className="sketch-info">
        <i ref={swRef} className="sk-sw" />
        <span ref={infoRef} className="sketch-info-t" />
        <span ref={sizeRef} className="sketch-size" title="Wymiary wydruku: długość × szerokość × wysokość" />
        {mode === 'print' && (
          <span className="sketch-legend" ref={legendBoxRef}>
            {LEVELS.map((l, i) => (
              <span key={l} title={HEAT_NAME[l]}><i className="sk-sw" style={{ background: HEAT_SWATCH[l] }} />{HEAT_NAME[l]} <b ref={(el) => { legendRefs.current[i] = el; }} /></span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
