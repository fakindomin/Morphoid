import { useState } from 'react';
import { STEPS, blockDef, stepToClass } from '../../core';
import { newSeed, storage, studio, useStudioState } from '../studio';
import { TILES } from '../tiles';
import { PrintPanel } from './PrintPanel';
import { Viewport3D } from './Viewport3D';
import { ExportPanel } from './ExportPanel';

export type ViewMode = '2d' | '3d';
const SAVE_KEY = 'morphoid.saved';

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="segment">
      <button type="button" className={`seg-pill${on ? ' active' : ''}`} onClick={() => onChange(true)}>WŁ</button>
      <button type="button" className={`seg-pill${!on ? ' active' : ''}`} onClick={() => onChange(false)}>WYŁ</button>
    </div>
  );
}

interface Props {
  view: ViewMode;
  explode: number; setExplode: (v: number) => void;
  showBones: boolean; setShowBones: (v: boolean) => void;
  breathing: boolean; setBreathing: (v: boolean) => void;
}

function Tools2D({ showBones, setShowBones, breathing, setBreathing }: Omit<Props, 'view' | 'explode' | 'setExplode'>) {
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const { past, future } = useStudioState();

  const clone = (): void => {
    const r = studio.loadCode(input);
    if (!r.ok) return setMsg({ text: r.message, warn: true });
    if (!r.checksumOk) setMsg({ text: 'Wczytano, ale suma kontrolna się nie zgadza (literówka lub starszy kod).', warn: true });
    else if (r.warnings.length) setMsg({ text: r.warnings.join('; '), warn: true });
    else setMsg({ text: 'Wczytano Morphotyp.', warn: false });
    setInput('');
  };
  const save = (): void => { storage.set(SAVE_KEY, studio.code()); setMsg({ text: 'Zapisano w pamięci przeglądarki.', warn: false }); };
  const load = (): void => {
    const saved = storage.get(SAVE_KEY);
    if (!saved) return setMsg({ text: 'Brak zapisanego projektu.', warn: true });
    const r = studio.loadCode(saved);
    setMsg(r.ok ? { text: 'Projekt wczytany.', warn: false } : { text: r.message, warn: true });
  };

  return (
    <>
      <section className="tile">
        <header className="tile-header"><span className="tile-title">🎲 Generator</span></header>
        <div className="btn-grid">
          <button type="button" className="btn-tile" onClick={() => studio.randomize(newSeed())}>🎲 Losuj wszystko</button>
          <button type="button" className="btn-tile" onClick={() => studio.mutateLight(newSeed())}>🧬 Mutuj lekko</button>
          <button type="button" className="btn-tile" disabled={!past.length} onClick={() => studio.undo()}>↩ Cofnij</button>
          <button type="button" className="btn-tile" disabled={!future.length} onClick={() => studio.redo()}>↪ Ponów</button>
        </div>
      </section>

      <section className="tile">
        <header className="tile-header"><span className="tile-title">🧬 Genom DNA (Morphotyp)</span></header>
        <div className="control-label">Wklej lub sklonuj kod DNA:</div>
        <div className="dna-input-row">
          <input className="dna-input" value={input} placeholder="MPH…" spellCheck={false}
            onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && clone()} />
          <button type="button" className="btn-tile" onClick={clone}>Klonuj</button>
        </div>
        {msg && <div className={`msg${msg.warn ? ' warn' : ''}`} role="status">{msg.text}</div>}
      </section>

      <section className="tile">
        <header className="tile-header"><span className="tile-title">💾 Zapis i projekty</span></header>
        <div className="btn-grid">
          <button type="button" className="btn-tile" onClick={save}>💾 Zapisz</button>
          <button type="button" className="btn-tile" onClick={load}>📂 Wczytaj</button>
        </div>
        <button type="button" className="btn-tile danger" onClick={() => studio.reset()}>🔄 Reset do bazy</button>
      </section>

      <section className="tile">
        <header className="tile-header"><span className="tile-title">⚲ Podgląd 3D na żywo</span></header>
        <Viewport3D variant="mini" />
      </section>

      <section className="tile">
        <header className="tile-header"><span className="tile-title">🛠 Widok szkicu</span></header>
        <div className="control-label">Kości riga:</div>
        <Toggle on={showBones} onChange={setShowBones} />
        <div className="control-label">Pętla oddechu (spacja):</div>
        <Toggle on={breathing} onChange={setBreathing} />
      </section>
    </>
  );
}

function Steps3D({ explode, setExplode }: Pick<Props, 'explode' | 'setExplode'>) {
  const { genome } = useStudioState();
  const stepFields = TILES.flatMap((t) => t.fields).filter((tf) =>
    blockDef(tf.block).fields.find((f) => f.name === tf.field)?.kind === 'step');
  return (
    <>
      <section className="tile">
        <header className="tile-header"><span className="tile-title">🔧 Widok rozłożony</span><span className="tile-status">{Math.round(explode * 100)}%</span></header>
        <p className="hint">Rozsuwa części drukowane osobno (wybierz je w panelu „Kontrola druku") i pokazuje czopy montażowe.</p>
        <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} aria-label="Rozsunięcie części" />
      </section>
      <section className="tile">
        <header className="tile-header"><span className="tile-title">⚙ Suwaki skokowe 2N</span><span className="tile-status">6 pozycji</span></header>
        <p className="hint">Każdy skok = sztywna, bezpieczna wartość pod dyszę 0,4 mm. Przekroczenie progu przełącza klasę rysunku 2D (1–3).</p>
        {stepFields.map((tf) => {
          const def = blockDef(tf.block);
          const none = def.noneMeansEmpty && genome[tf.block]![def.fields[0]!.name] === 0;
          const v = genome[tf.block]![tf.field]!;
          return (
            <label key={`${tf.block}.${tf.field}`} className="slider-row">
              <span className="control-label">{tf.label} <b>{none ? '—' : `${v + 1}/${STEPS} · klasa ${stepToClass(v) + 1}`}</b></span>
              <input type="range" min={0} max={STEPS - 1} step={1} value={v} disabled={!!none}
                onChange={(e) => studio.applyOps([{ kind: 'set', block: tf.block, field: tf.field, value: Number(e.target.value) }])} />
            </label>
          );
        })}
      </section>
      <ExportPanel />
    </>
  );
}

export function RightColumn(props: Props) {
  return (
    <aside className="column right">
      <PrintPanel />
      {props.view === '2d' ? <Tools2D {...props} /> : <Steps3D explode={props.explode} setExplode={props.setExplode} />}
    </aside>
  );
}

