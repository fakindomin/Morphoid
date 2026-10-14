import { useEffect, useRef } from 'react';
import { dimensions as D, solveRig, SOCKET_NODE, type SocketId } from '../../core';
import { PALETTES } from '../../core/palette';
import { studio } from '../studio';
import { clonePose, easePose, targetPose, type Pose } from '../../core/art/pose';
import { buildShapes, SLOTS, rigSize, type Shapes, type SlotKind } from '../../core/art/shapes';

const W = 820, H = 520, SCALE = 4.6, CX = 430, GROUND = 440;
const to = (x: number, y: number) => [CX - x * SCALE, GROUND - y * SCALE] as const;

/** Solid parts that make up the figurine's silhouette: drawn once more underneath as one outline. */
const SOLID: readonly SlotKind[] = ['skin', 'skinFar', 'accent', 'accentFar', 'accentSoft', 'white'];
/** Small details drawn above the shading (eyes, mouth, nose), so the light does not tint them. */
const DETAIL: readonly SlotKind[] = ['white', 'iris', 'ink', 'glint', 'lid', 'lip', 'nostril', 'claw', 'relief', 'groove', 'blush', 'tongue'];
/** Parts drawn in front of the coated ones that hide their texture (the near front leg covers the torso). */
const COAT_CUT = ['legF', 'head', 'snout', 'ear', 'stalks'] as const;
const SIL_SLOTS = SLOTS.filter(([id, kind]) => SOLID.includes(kind) && !id.startsWith('legOver'));
/**
 * Paint layers, back to front. The skin-coloured parts are fused into one smooth body (the 2D twin of the bake's
 * smooth union), so the head, neck, torso, legs and tail read as one figurine, not a pile of shapes. Accents that grow
 * out of it (horns, crest, a fin on the back) sit behind it so their roots are hidden; the ones lying on it (a saddle,
 * a collar, a near wing) sit in front.
 */
type Layer = 'far' | 'behind' | 'skin' | 'over' | 'detail';
const BEHIND = new Set<string>(['stand', 'horns', 'antennae', 'tuft', 'spines', 'finD', 'mane']);
const OVER_LEGS = ['legOver0', 'legOver1', 'legOver2'] as const;
const layerOf = (id: string, kind: SlotKind): Layer | null =>
  kind === 'clip' || id === 'shadow' || id.startsWith('legOver') ? null
    : DETAIL.includes(kind) || kind === 'bone' ? 'detail'
    : id === 'neckDecor' ? 'over'
    : kind === 'skinFar' || kind === 'accentFar' ? 'far'
    : BEHIND.has(id) ? 'behind'
    : kind === 'skin' ? 'skin'
    : 'over';
const LAYER_SLOTS = (layer: Layer) => SLOTS.filter(([id, kind]) => layerOf(id, kind) === layer);

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
  /** print problems to point at (rig mm) */
  markers?: { at: [number, number]; severity: 'info' | 'support' | 'warn' | 'error'; text: string }[];
}

export function Canvas2D({ showBones, breathing, frozen, onSocket, markers = [] }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  /** every element drawing a slot (its fill, its silhouette copy, its clip copy) */
  const slotEls = useRef<Record<string, (SVGPathElement | null)[]>>({});
  const reg = (id: string, k: number) => (el: SVGPathElement | null): void => { (slotEls.current[id] ??= [])[k] = el; };
  const figureRef = useRef<SVGGElement>(null);
  const lightRef = useRef<SVGRectElement>(null);
  const insectRef = useRef<SVGGElement>(null);
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
    let lastPalette = -1;

    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { breathing: br, frozen: fz, showBones: sb } = live.current;
      const g = studio.getState().genome;
      const rig = solveRig(g);
      const pal = g.palette!.index!;
      if (pal !== lastPalette && svgRef.current) {
        lastPalette = pal;
        const [c1, c2, c3] = PALETTES[pal]!;
        svgRef.current.style.setProperty('--c1', c1);
        svgRef.current.style.setProperty('--c2', c2);
        svgRef.current.style.setProperty('--c3', c3);
      }
      if (br && !fz) t += dt * 2;
      const m = fz ? { x: 0, y: 0 } : mouse.current;
      const tgt = targetPose(rig, g, t, br && !fz, m);
      if (!cur) cur = clonePose(tgt);
      const remaining = easePose(cur, tgt, 1 - Math.exp(-dt * 14));
      if (rig.code !== lastCode || sb !== lastBones) { dirty = true; lastCode = rig.code; lastBones = sb; }

      if (dirty || remaining > 1e-3 || (br && !fz)) {
        const shapes = buildShapes(cur, g, rig, to, sb);
        insectRef.current?.setAttribute('visibility', rig.dims.plan === D.PLAN.insect ? 'visible' : 'hidden');
        for (const [id] of SLOTS) {
          if (cache[id] !== shapes[id]) {
            cache[id] = shapes[id];
            for (const el of slotEls.current[id] ?? []) el?.setAttribute('d', shapes[id]);
          }
        }
        // the light falls on the figure's own bounding box (top lit, belly in shade)
        const bb = figureRef.current?.getBBox();
        if (bb && lightRef.current) {
          lightRef.current.setAttribute('x', String(bb.x)); lightRef.current.setAttribute('y', String(bb.y));
          lightRef.current.setAttribute('width', String(Math.max(1, bb.width))); lightRef.current.setAttribute('height', String(Math.max(1, bb.height)));
        }
        for (const s of SOCKETS) {
          const [x, y] = to(...cur.pos[SOCKET_NODE[s.id]]);
          socketEls.current[s.id]?.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
          // a biped has no front legs: no shoulder socket
          socketEls.current[s.id]?.setAttribute('visibility', s.id === 'legF' && rig.dims.plan === 1 ? 'hidden' : 'visible');
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

    return (
    <div className="creature-viewport" onPointerMove={onMove}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Rzut boczny Morphoida">
        <defs>
          <linearGradient id="skinGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="g-hi" />
            <stop offset="0.55" className="g-mid" />
            <stop offset="1" className="g-lo" />
          </linearGradient>
          <linearGradient id="deskGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="desk-hi" />
            <stop offset="1" className="desk-lo" />
          </linearGradient>
          <clipPath id="torsoClip">
            <path ref={reg('torsoClip', 0)} d="" />
          </clipPath>
          {/* the coat texture shows only on the parts that carry it in 3D, and not where a part in front hides them */}
          <mask id="coatMask" maskUnits="userSpaceOnUse" x={-W} y={-H} width={3 * W} height={3 * H}>
            <path ref={reg('coatOn', 3)} fill="#fff" d="" />
            {COAT_CUT.map((id) => <path key={id} ref={reg(id, 3)} fill="#000" d="" />)}
          </mask>
          <mask id="coatLegMask" maskUnits="userSpaceOnUse" x={-W} y={-H} width={3 * W} height={3 * H}>
            <path ref={reg('coatLegB', 3)} fill="#fff" d="" />
            <path ref={reg('torso', 4)} fill="#000" d="" />
            <path ref={reg('coatLegF', 3)} fill="#fff" d="" />
            {COAT_CUT.filter((id) => id !== 'legF').map((id) => <path key={id} ref={reg(id, 4)} fill="#000" d="" />)}
          </mask>
          <clipPath id="silClip">
            {SIL_SLOTS.map(([id]) => <path key={id} ref={reg(id, 2)} d="" />)}
          </clipPath>
          <linearGradient id="lightGrad" x1="0.1" y1="0" x2="0.6" y2="1">
            <stop offset="0" className="light-hi" />
            <stop offset="0.45" className="light-mid" />
            <stop offset="1" className="light-lo" />
          </linearGradient>
          {/* fuse: blur the shapes, then cut the alpha sharp again: joints between parts get smooth fillets */}
          <filter id="goo" filterUnits="userSpaceOnUse" x={-40} y={-40} width={W + 80} height={H + 80}>
            <feGaussianBlur in="SourceGraphic" stdDeviation={2.8} result="b" />
            <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="body" />
            {/* form shading: a soft shade along every lower edge, a soft light along every upper edge */}
            <feOffset in="body" dx={-4} dy={-9} result="up" />
            <feGaussianBlur in="up" stdDeviation={5} result="upB" />
            <feComposite in="body" in2="upB" operator="out" result="lowBand" />
            <feFlood className="shade-flood" result="sc" />
            <feComposite in="sc" in2="lowBand" operator="in" result="shade" />
            <feOffset in="body" dx={3} dy={7} result="dn" />
            <feGaussianBlur in="dn" stdDeviation={4} result="dnB" />
            <feComposite in="body" in2="dnB" operator="out" result="hiBand" />
            <feFlood className="hi-flood" result="hc" />
            <feComposite in="hc" in2="hiBand" operator="in" result="hi" />
            <feMerge><feMergeNode in="body" /><feMergeNode in="shade" /><feMergeNode in="hi" /></feMerge>
          </filter>
          {/* the same form shading for the accent parts, without fusing them (horn tips stay sharp) */}
          <filter id="form" filterUnits="userSpaceOnUse" x={-40} y={-40} width={W + 80} height={H + 80}>
            <feOffset in="SourceAlpha" dx={-3} dy={-6} result="up" />
            <feGaussianBlur in="up" stdDeviation={3} result="upB" />
            <feComposite in="SourceAlpha" in2="upB" operator="out" result="lowBand" />
            <feFlood className="shade-flood" result="sc" />
            <feComposite in="sc" in2="lowBand" operator="in" result="shade" />
            <feOffset in="SourceAlpha" dx={2} dy={5} result="dn" />
            <feGaussianBlur in="dn" stdDeviation={2.5} result="dnB" />
            <feComposite in="SourceAlpha" in2="dnB" operator="out" result="hiBand" />
            <feFlood className="hi-flood" result="hc" />
            <feComposite in="hc" in2="hiBand" operator="in" result="hi" />
            <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="shade" /><feMergeNode in="hi" /></feMerge>
          </filter>
          <filter id="gooOutline" filterUnits="userSpaceOnUse" x={-40} y={-40} width={W + 80} height={H + 80}>
            <feGaussianBlur in="SourceAlpha" stdDeviation={2.8} result="b" />
            <feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 24 -11" result="g" />
            <feMorphology in="g" operator="dilate" radius={2} result="d" />
            {/* the line swells on the shaded side, away from the light */}
            <feOffset in="d" dx={1.3} dy={1.9} result="dS" />
            <feMerge result="dd"><feMergeNode in="d" /><feMergeNode in="dS" /></feMerge>
            <feFlood className="ink-flood" result="ink" />
            <feComposite in="ink" in2="dd" operator="in" />
          </filter>
          {/* pencil hatching in the core shadow: the band along the lower-right edge of the whole silhouette */}
          <pattern id="hatch" patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(-35)">
            <line className="hatch-line" x1={0} y1={0} x2={0} y2={5} />
          </pattern>
          <filter id="shadeBand" filterUnits="userSpaceOnUse" x={-40} y={-40} width={W + 80} height={H + 80}>
            <feGaussianBlur in="SourceAlpha" stdDeviation={2.8} result="b" />
            <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="body" />
            <feOffset in="body" dx={-7} dy={-11} result="up" />
            <feGaussianBlur in="up" stdDeviation={4} result="upB" />
            <feComposite in="body" in2="upB" operator="out" result="band" />
            <feFlood floodColor="#fff" result="w" />
            <feComposite in="w" in2="band" operator="in" />
          </filter>
          <mask id="shadeMask" maskUnits="userSpaceOnUse" x={-W} y={-H} width={3 * W} height={3 * H}>
            <g filter="url(#shadeBand)">
              {SIL_SLOTS.map(([id]) => <path key={id} ref={reg(id, 5)} fill="#fff" d="" />)}
            </g>
          </mask>
          <radialGradient id="shadowGrad">
            <stop offset="0" className="shadow-in" />
            <stop offset="1" className="shadow-out" />
          </radialGradient>
        </defs>
        <rect className="desk" x={0} y={GROUND} width={W} height={H - GROUND} />
        <line className="desk-edge" x1={0} x2={W} y1={GROUND} y2={GROUND} />
        <text className="desk-label" x={24} y={GROUND + 22}>STÓŁ DRUKARKI · Y = 0</text>
        <text className="desk-label" x={W - 24} y={GROUND + 22} textAnchor="end">stopy zawsze przylegają do stołu</text>
        <text ref={sizeRef} className="size-label" x={W - 24} y={28} textAnchor="end" />
        <path ref={reg('shadow', 0)} className="shape shadow" d="" />
        {/* one ink outline around the whole silhouette: every solid part, drawn fat, underneath the fills */}
        <g className="silhouette" aria-hidden filter="url(#gooOutline)">
          {SIL_SLOTS.map(([id]) => <path key={id} ref={reg(id, 1)} className="sil" d="" />)}
        </g>
        <g className="figure" ref={figureRef}>
          {(['far', 'behind', 'skin', 'over'] as const).map((layer) => (
            <g key={layer} className={`layer-${layer}`} filter={layer === 'skin' ? 'url(#goo)' : layer === 'far' ? undefined : 'url(#form)'}>
              {LAYER_SLOTS(layer).map(([id, kind]) => (
                <path key={id} ref={reg(id, 0)} className={`shape ${kind} s-${id}`} d=""
                  clipPath={id === 'pattern' || id === 'belly' ? 'url(#torsoClip)' : undefined}
                  mask={id === 'coat' ? 'url(#coatMask)' : id === 'coatLegs' ? 'url(#coatLegMask)' : undefined} />
              ))}
            </g>
          ))}
          {/* an insect's near legs splay out sideways over its flank: drawn once more on top, each with its own outline,
              so the six jointed legs read as legs and not as one block fused with the body */}
          <g ref={insectRef} className="insect-legs" visibility="hidden" filter="url(#form)">
            {OVER_LEGS.map((id) => (
              <g key={id}>
                <path ref={reg(id, 1)} className="leg-ink" d="" />
                <path ref={reg(id, 0)} className="shape skin" style={{ stroke: 'none' }} d="" />
              </g>
            ))}
          </g>
        </g>
        <rect ref={lightRef} className="light" clipPath="url(#silClip)" fill="url(#lightGrad)" />
        <rect className="hatch" x={0} y={0} width={W} height={H} fill="url(#hatch)" mask="url(#shadeMask)" />
        <g className="details">
          {LAYER_SLOTS('detail').map(([id, kind]) => <path key={id} ref={reg(id, 0)} className={`shape ${kind} s-${id}`} d="" />)}
        </g>
        {markers.map((m, k) => {
          const [mx, my] = to(m.at[0], m.at[1]);
          return (
            <g key={k} className={`marker ${m.severity}`} transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)})`}>
              <title>{m.text}</title>
              <circle r={11} /><text y={4}>!</text>
            </g>
          );
        })}
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
