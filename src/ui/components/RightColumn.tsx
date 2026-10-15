import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FINE_LEVELS, FINE_ZERO, fineOffset, fineScale, BLOCKS, parse, sculptValue, solveRig, STEPS } from '../../core';
import { exportBundle } from '../../core/bake/orient';
import { export3mf } from '../../core/bake/threemf';
import { PALETTES } from '../../core/palette';
import { GROUPS, isSeparate, planKind, planModular, planWhole, type PartGroup } from '../../core/print';
import { bakeStore } from '../bakeStore';
import { download } from '../download';
import { fittedPlan, restGeometry, usePrintReport } from '../printReport';
import { newSeed, storage, studio, useStudioState } from '../studio';
import { useBakeFresh } from './BakeStatus';
import { previewStore, usePreview } from '../previewStore';
import { useViewOptions, viewOptions } from '../viewOptions';

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

interface Props { view: ViewMode; explode: number; setExplode: (v: number) => void }

function Category({ id, title, value, badge, open, setOpen, children }: {
  id: string; title: string; value: ReactNode; badge?: number; open: string | null; setOpen: (v: string | null) => void; children: ReactNode;
}) {
  const on = open === id;
  return (
    <section className={`cat${on ? ' open' : ''}`}>
      <button type="button" className="cat-h" aria-expanded={on} onClick={() => setOpen(on ? null : id)}>
        <span className="cat-t">{title}</span>
        <span className="cat-v">{value}</span>
        {!!badge && <span className="cat-badge" title="Uwagi do druku">{badge}</span>}
        <i className="chev" aria-hidden />
      </button>
      {on && <div className="cat-b">{children}</div>}
    </section>
  );
}

/** Name, dice, mutation and a field to paste a new DNA code into (the creature's own code is above the sketch). */
function MorphoidBody() {
  const { genome } = useStudioState();
  const { rolling } = useViewOptions();
  const who = studio.creature();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const saveName = (): void => { if (nameDraft !== null) studio.setName(nameDraft); setNameDraft(null); };
  // a separate field to paste someone else's creature into (the code above stays this creature's, to copy)
  const [paste, setPaste] = useState('');
  const load = (value: string): void => {
    const code = value.trim();
    if (!code) return setMsg({ text: 'Wklej kod DNA, np. MPH2:B01.33:…', warn: true });
    const r = parse(code, genome);
    if (!r.ok) return setMsg({ text: r.message, warn: true });
    studio.loadCode(code, genome);
    setPaste('');
    setMsg(r.badGenes.length ? { text: `Wczytano. Nieznane geny: ${r.badGenes.join(', ')}. Te części zostają bez zmian.`, warn: true }
      : { text: r.checksumOk ? 'Wczytano stwora z kodu DNA.' : 'Wczytano, ale suma kontrolna się nie zgadza: sprawdź, czy kod jest cały.', warn: !r.checksumOk });
  };
  const pasteClipboard = async (): Promise<void> => {
    try { load(await navigator.clipboard.readText()); } catch { setMsg({ text: 'Przeglądarka nie dała dostępu do schowka: wklej kod w pole (Ctrl+V).', warn: true }); }
  };
  return (
    <>
      <div>
        <div className="control-label">Nazwa</div>
        <input className="name-field" value={nameDraft ?? who.name} maxLength={40} spellCheck={false} aria-label="Nazwa stwora"
          onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setNameDraft(null); }} />
      </div>
      <div className="btn-row">
        <button type="button" className={`btn-soft${rolling ? ' rolling' : ''}`} disabled={rolling} onClick={() => viewOptions.roll(() => studio.randomize(newSeed()))}><i className="dice">🎲</i> {rolling ? 'Losuję…' : 'Losowo'}</button>
        <button type="button" className="btn-soft" disabled={rolling} onClick={() => viewOptions.roll(() => studio.mutateLight(newSeed()))}>🧬 Mutuj</button>
      </div>
      <div>
        <div className="control-label">Wklej nowe DNA</div>
        <div className="dna-box">
          <textarea className="dna-code-field" rows={2} value={paste} spellCheck={false} aria-label="Wklej kod DNA" placeholder="MPH2:B01.33:L01.3:…"
            onChange={(e) => setPaste(e.target.value)}
            onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); load(t); } }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); load(paste); } }} />
          <div className="dna-actions">
            <button type="button" className="link-btn" onClick={pasteClipboard}>Wklej</button>
            <button type="button" className="link-btn" onClick={() => load(paste)}>Wczytaj</button>
          </div>
        </div>
      </div>
      {msg && <div className={`msg${msg.warn ? ' warn' : ''}`} role="status">{msg.text}</div>}
    </>
  );
}

function ProjectBody() {
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const save = (): void => { storage.set(SAVE_KEY, studio.code()); setMsg({ text: 'Zapisano w pamięci tej przeglądarki.', warn: false }); };
  const load = (): void => {
    const saved = storage.get(SAVE_KEY);
    if (!saved) return setMsg({ text: 'Brak zapisanego projektu.', warn: true });
    const r = studio.loadCode(saved);
    setMsg(r.ok ? { text: 'Projekt wczytany.', warn: false } : { text: r.message, warn: true });
  };
  return (
    <>
      <div className="btn-row">
        <button type="button" className="btn-soft" onClick={save}>Zapisz</button>
        <button type="button" className="btn-soft" onClick={load}>Wczytaj</button>
      </div>
      <button type="button" className="btn-soft danger" onClick={() => { studio.reset(); setMsg({ text: 'Przywrócono stwora bazowego.', warn: false }); }}>Resetuj</button>
      {msg && <div className={`msg${msg.warn ? ' warn' : ''}`} role="status">{msg.text}</div>}
    </>
  );
}

/** Whole or modules; with modules, the creature's own parts, each one a separate module or printed with the body. */
function PrintBody({ view, explode, setExplode }: Props) {
  const { genome, plan } = useStudioState();
  const report = usePrintReport(genome, plan);
  const kind = planKind(plan);
  const paths = useMemo(() => restGeometry(genome).paths, [genome]);
  const present = GROUPS.filter((g) => g.slots.some((s) => paths[s] && !paths[s].empty));
  const anySeparate = present.some((g) => !g.forced && isSeparate(plan, g.id as PartGroup));
  const issues = report.issues.filter((i) => i.severity !== 'info');
  const fix = issues.find((i) => i.fix);
  return (
    <>
      <div className="segment">
        <button type="button" className={`seg-pill${kind === 'whole' ? ' active' : ''}`}
          onClick={() => studio.setPlan({ ...planWhole(plan.printer), maxBridge: plan.maxBridge })}>Całość</button>
        <button type="button" className={`seg-pill${kind !== 'whole' ? ' active' : ''}`}
          onClick={() => { if (kind === 'whole') studio.setPlan(fittedPlan(genome, { ...planModular(plan.printer), maxBridge: plan.maxBridge })); }}>Moduły</button>
      </div>
      {kind === 'whole' ? <p className="hint">Stwór drukuje się jako jedna bryła{present.some((g) => g.forced) ? ` (${present.filter((g) => g.forced).map((g) => g.label.toLowerCase()).join(' i ')} zawsze osobno)` : ''}.</p> : (
        <div>
          <div className="control-label">Rozpiska modułów</div>
          <ol className="mods">
            <li><span className="mn">Korpus</span><span className="mx">baza</span></li>
            {present.map((g) => {
              const on = isSeparate(plan, g.id as PartGroup);
              return (
                <li key={g.id} className={on ? '' : 'merged'}>
                  <span className="mn">{g.label}</span>
                  <span className="mx">{g.forced ? 'zawsze osobno' : on ? 'osobny moduł' : 'z korpusem'}</span>
                  {!g.forced && <button type="button" className="sw" role="switch" aria-checked={on} aria-label={`${g.label} jako osobny moduł`}
                    onClick={() => studio.setSeparate(g.id, !on)} />}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {view === '3d' && kind !== 'whole' && anySeparate && (
        <label className="slider-row">
          <span className="control-label">Rozsuń moduły <b>{Math.round(explode * 100)}%</b></span>
          <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} aria-label="Rozsuń moduły" />
        </label>
      )}
      <div className={`check-line ${issues.length ? 'warn' : 'ok'}`}>
        <span className="dot" />
        <div>
          {!issues.length ? <><b>Gotowe do druku.</b> Żadna część nie potrzebuje zmian.</> : fix ? (
            <>
              <b>{fix.message}</b>{issues.length > 1 ? ` Uwag razem: ${issues.length}, wszystkie zaznaczone na szkicu.` : ''}
              <button type="button" className="link-btn" onClick={() => studio.setSeparate(fix.fix!, true)}>Drukuj osobno: {GROUPS.find((g) => g.id === fix.fix)?.label.toLowerCase()}</button>
            </>
          ) : (
            <><b>{issues[0]!.message}</b>{issues.length > 1 ? ` Uwag razem: ${issues.length}, wszystkie zaznaczone na szkicu.` : ''}</>
          )}
        </div>
      </div>
    </>
  );
}

const THROTTLE_MS = 250;

/** The creature's 3D deformation (gene I): sliders saved in the DNA; long pulls carry over into the size genes. */
function SculptBody() {
  const { genome } = useStudioState();
  const anatomical = solveRig(genome).dims.anatomical;
  const dragging = useRef(false);
  // while a slider is dragged it follows the hand at once; the creature (DNA, print check, 3D) catches up at most
  // every THROTTLE_MS and on release, so a weaker computer does not recompute on every pixel
  const [live, setLive] = useState<{ name: string; value: number } | null>(null);
  const last = useRef(0), timer = useRef(0), pend = useRef<{ name: string; value: number } | null>(null);
  const flush = (): void => {
    window.clearTimeout(timer.current);
    const p = pend.current;
    if (!p) return;
    pend.current = null; last.current = performance.now();
    studio.sculpt(p.name, p.value, dragging.current);
    dragging.current = true;
  };
  const move = (name: string, value: number): void => {
    setLive({ name, value });
    pend.current = { name, value };
    window.clearTimeout(timer.current);
    const wait = THROTTLE_MS - (performance.now() - last.current);
    if (wait <= 0) flush(); else timer.current = window.setTimeout(flush, wait);
  };
  const release = (): void => { flush(); dragging.current = false; setLive(null); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const fields = BLOCKS.find((b) => b.id === 'sculpt')!.fields;
  const moved = fields.some((f) => genome.sculpt?.[f.name] !== FINE_ZERO);
  const MASS = new Set(['chest', 'waist', 'haunch', 'shoulder']);
  return (
    <>
      <p className="hint">Każdy ruch zapisuje się w kodzie DNA. Drobne zmiany widać tylko w 3D; przeciągnięte za pół kroku zmieniają też rozmiar w szkicu 2D.</p>
      {fields.map((f) => {
        if (f.kind !== 'fine') return null;
        const off = MASS.has(f.name) && !anatomical;
        const v = genome.sculpt?.[f.name] ?? FINE_ZERO;
        const coarse = !!f.coarse;
        const val = live?.name === f.name ? live.value : coarse ? sculptValue(genome, f.name) : v;
        const step = coarse ? genome[f.coarse!.block]![f.coarse!.field]! : 0;
        const pct = Math.round(coarse ? fineOffset(v) * 100 : (fineScale(v) - 1) * 100);
        const text = coarse ? `krok ${step + 1}${pct ? ` ${pct > 0 ? '+' : ''}${pct}%` : ''}` : `${pct > 0 ? '+' : ''}${pct}%`;
        return (
          <label key={f.name} className={`slider-row${off ? ' off' : ''}`}>
            <span className="control-label">{f.label} <b>{text}</b></span>
            <input type="range" disabled={off} aria-label={f.label}
              min={coarse ? -0.5 : 0} max={coarse ? STEPS - 1 + (FINE_LEVELS - 1 - FINE_ZERO) / FINE_LEVELS : FINE_LEVELS - 1}
              step={coarse ? 1 / FINE_LEVELS : 1} value={val}
              onPointerDown={() => { dragging.current = false; last.current = 0; }}
              onChange={(e) => move(f.name, Number(e.target.value))}
              onPointerUp={release} onKeyUp={release} onBlur={release} />
          </label>
        );
      })}
      {!anatomical && <p className="hint">Klatka, talia, zad i łopatki działają na korpusie „Zwierzęcy”.</p>}
      <button type="button" className="btn-soft" disabled={!moved} onClick={() => studio.resetSculpt()}>Wyzeruj deformację</button>
    </>
  );
}

/** How the creature is shown: in 2D the sketch's colours and bones, in 3D the grey filament, framing and smoothing. */
function ViewBody({ view }: { view: ViewMode }) {
  const o = useViewOptions();
  const preview = usePreview();
  if (view === '2d') return (
    <>
      <div>
        <div className="control-label">Kolory szkicu</div>
        <div className="segment">
          <button type="button" className={`seg-pill${o.sketchMode === 'color' ? ' active' : ''}`} onClick={() => viewOptions.setSketchMode('color')}>Kolory stwora</button>
          <button type="button" className={`seg-pill${o.sketchMode === 'print' ? ' active' : ''}`} onClick={() => viewOptions.setSketchMode('print')}>Druk</button>
        </div>
      </div>
      <label className="switch-row">
        <span>Pokaż kości</span>
        <button type="button" className="sw" role="switch" aria-checked={o.showBones} aria-label="Pokaż kości" onClick={() => viewOptions.setShowBones(!o.showBones)} />
      </label>
    </>
  );
  return (
    <>
      <label className="switch-row">
        <span>Szary filament</span>
        <button type="button" className="sw" role="switch" aria-checked={o.grey} aria-label="Szary filament" title="Jak wydruk z jednego, szarego filamentu" onClick={() => viewOptions.setGrey(!o.grey)} />
      </label>
      <div className="btn-row">
        <button type="button" className="btn-soft" onClick={() => viewOptions.recenter()}>Wyśrodkuj widok</button>
        <button type="button" className="btn-soft" disabled={preview.quality !== 'draft' || preview.busy}
          title="Podgląd podczas zmian jest uproszczony, żeby działał płynnie. Wygładzenie pokazuje model tak, jak wyjdzie w pliku do druku."
          onClick={() => previewStore.smooth()}>
          {preview.quality === 'smoothing' ? 'Wygładzam…' : preview.quality === 'smooth' ? 'Wygładzony' : 'Wygładź model'}
        </button>
      </div>
    </>
  );
}

type Format = 'stl' | '3mf';

/**
 * Always visible at the bottom: the file format and one button. If the print solid for this exact model is ready, it
 * downloads at once; otherwise the button prepares it (progress inside the button) and downloads when it is done.
 */
function ExportFooter() {
  const { job, fresh } = useBakeFresh();
  const { genome, plan } = useStudioState();
  const report = usePrintReport(genome, plan);
  const [fmt, setFmt] = useState<Format>('stl');
  const pending = useRef<Format | null>(null);
  const running = job.status === 'running';
  const pct = Math.round((job.progress?.frac ?? 0) * 100);
  const many = report.pieces.length > 1;

  const save = (format: Format): boolean => {
    const r = job.result!;
    if (!r.pieces.every((p) => p.validation.watertight && p.validation.volume > 0)) return false;
    const f = format === '3mf' ? export3mf(r, studio.creature(), PALETTES[genome.palette!.index!]!) : exportBundle(r, studio.creature());
    download(f.name, f.bytes);
    return true;
  };
  useEffect(() => {
    if (job.status !== 'done' || !pending.current || !fresh) return;
    const f = pending.current;
    pending.current = null;
    save(f);
  }, [job.finishedCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (): void => {
    if (running) return;
    if (fresh && job.result) { save(fmt); return; }
    pending.current = fmt;
    bakeStore.start();
  };
  const leaky = fresh && job.result && !job.result.pieces.every((p) => p.validation.watertight && p.validation.volume > 0);
  const clashes = fresh ? job.result?.pieces.filter((p) => p.clashesWith.length) ?? [] : [];

  return (
    <div className="export-foot">
      <p className="foot-t">Eksport do druku</p>
      <div className="segment">
        <button type="button" className={`seg-pill${fmt === 'stl' ? ' active' : ''}`} onClick={() => setFmt('stl')}>STL</button>
        <button type="button" className={`seg-pill${fmt === '3mf' ? ' active' : ''}`} onClick={() => setFmt('3mf')}
          title="Bambu Studio, OrcaSlicer, PrusaSlicer: kolory jako pomalowane obszary, filamenty 1–4 = c1, c2, c3, biały">3MF w kolorach</button>
      </div>
      <button type="button" className={`dl-btn${running ? ' running' : ''}`} onClick={go} aria-live="polite">
        {running && <i className="dl-bar" style={{ width: `${Math.max(3, pct)}%` }} />}
        <span>{running ? `Przygotowuję plik… ${pct}%` : fmt === '3mf' ? 'Pobierz 3MF w kolorach' : many ? 'Pobierz ZIP z częściami' : 'Pobierz STL'}</span>
      </button>
      {running && <button type="button" className="link-btn" onClick={() => { pending.current = null; bakeStore.cancel(); }}>Anuluj</button>}
      {job.status === 'error' && <div className="msg warn">Błąd: {job.error}</div>}
      {job.notice && job.status !== 'error' && <div className="msg info">{job.notice}</div>}
      {leaky && <div className="msg warn">Bryła wyszła nieszczelna, więc jej nie pobieram. Zmień model lekko i spróbuj ponownie.</div>}
      {clashes.map((p) => (
        <div key={p.id} className="msg warn">
          {p.label} przenika się z inną częścią po złożeniu.
          <button type="button" className="link-btn" onClick={() => studio.setSeparate(p.id as PartGroup, false)}>Drukuj razem: {p.label.toLowerCase()}</button>
        </div>
      ))}
    </div>
  );
}

/** Right column: Morphoid, Projekt and Opcje druku as closed categories (one open at a time), export pinned below. */
export function RightColumn(props: Props) {
  const { genome, plan } = useStudioState();
  const report = usePrintReport(genome, plan);
  const [open, setOpen] = useState<string | null>(null);
  const saved = storage.get(SAVE_KEY) === studio.code();
  const kind = planKind(plan);
  const parts = report.pieces.length;
  const issues = report.issues.filter((i) => i.severity !== 'info').length;
  const viewSketch = useViewOptions().sketchMode;
  const sculptCount = Object.values(genome.sculpt ?? {}).filter((v) => v !== FINE_ZERO).length;
  return (
    <aside className="column right acc-column right-panel">
      <div className="right-scroll">
        <Category id="view" title="Widok" value={props.view === '2d' ? (viewSketch === 'color' ? 'Kolory stwora' : 'Druk') : 'Studio 3D'} open={open} setOpen={setOpen}><ViewBody view={props.view} /></Category>
        <Category id="morphoid" title="Morphoid" value={studio.creature().name} open={open} setOpen={setOpen}><MorphoidBody /></Category>
        <Category id="project" title="Projekt" value={saved ? 'zapisany' : 'niezapisany'} open={open} setOpen={setOpen}><ProjectBody /></Category>
        {props.view === '3d' && <Category id="sculpt" title="Deformacja" value={sculptCount ? `zmian: ${sculptCount}` : 'brak'} open={open} setOpen={setOpen}><SculptBody /></Category>}
        <Category id="print" title="Opcje druku" value={kind === 'whole' ? 'Całość' : `Moduły · ${parts}`} badge={issues} open={open} setOpen={setOpen}><PrintBody {...props} /></Category>
      </div>
      <ExportFooter />
    </aside>
  );
}
