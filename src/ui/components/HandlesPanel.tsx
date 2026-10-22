import { useRef } from 'react';
import { FINE_LEVELS, FINE_RANGE, fineValue } from '../../core';
import { elementDef, handleValues, resetElement, type Anchor, type FineRef } from '../../core/art/handles';
import { handlesStore, useHandles } from '../handlesStore';
import { usePreview } from '../previewStore';
import { studio, useStudioState } from '../studio';

const pct = (v: number): string => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
const deg = (v: number): string => `${v >= 0 ? '+' : ''}${Math.round(v)}°`;

/**
 * The card over the 3D view for the element whose handles are shown: its name, the three values (also as sliders, for
 * a touch screen or a precise value) and a reset. With nothing selected, a hint how to pick an element.
 */
export function HandlesPanel({ anchors }: { anchors: Anchor[] }) {
  const { selected } = useHandles();
  const { genome } = useStudioState();
  const preview = usePreview();
  // a drag on a slider is one undo step
  const dragging = useRef(false);
  const a = selected && (anchors.find((x) => x.id === selected.id && x.side === selected.side) ?? anchors.find((x) => x.id === selected.id));
  if (!selected || !a) { // (also when the creature no longer has the element)
    return anchors.length && !preview.busy ? <div className="handles-hint">Kliknij nogę, ogon, ucho, róg lub skrzydło, żeby je rozciągnąć</div> : null;
  }
  const def = elementDef(selected.id);
  const vals = handleValues(genome, def);
  const mm = Math.hypot(a.tip[0] - a.root[0], a.tip[1] - a.root[1], a.tip[2] - a.root[2]);
  const slider = (ref: FineRef, coarse: boolean, label: string, text: string, cls: string) => (
    <label className={`slider-row handle-row ${cls}`}>
      <span className="control-label">{label}<b>{text}</b></span>
      <input type="range" min={coarse ? FINE_RANGE[0] : 0} max={coarse ? FINE_RANGE[1] : FINE_LEVELS - 1} step={coarse ? 1 / 16 : 1}
        value={fineValue(genome, ref.block, ref.field)} aria-label={`${def.label}: ${label}`}
        onPointerDown={() => { dragging.current = false; }}
        onChange={(e) => { studio.fine(ref.block, ref.field, Number(e.target.value), dragging.current); dragging.current = true; }}
        onPointerUp={() => { dragging.current = false; }} />
    </label>
  );
  return (
    <div className="handles-card" role="group" aria-label={`Uchwyty: ${def.label}`}>
      <div className="handles-head">
        <b>{def.label}</b>
        <button className="btn-mini ghost" onClick={() => studio.edit(resetElement(genome, def))} disabled={!vals.moved} title="Uchwyty tego elementu z powrotem na zero">Wyzeruj</button>
        <button className="btn-mini ghost" onClick={() => handlesStore.select(null)} aria-label="Zamknij uchwyty">✕</button>
      </div>
      {slider(def.length, true, def.words.length, mm ? `${mm.toFixed(0)} mm` : '', 'len')}
      {slider(def.thick, !!def.thickTable, def.words.thick, pct(vals.thick), 'thick')}
      {slider(def.swing, false, def.words.swing, deg(vals.swing), 'swing')}
      <p className="hint">Ciągnij kulki na modelu: niebieska wydłuża, czerwona pogrubia, żółta wychyla. Zmiany zapisują się w DNA.</p>
    </div>
  );
}
