import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parse } from '../../core';
import { exportBundle } from '../../core/bake/orient';
import { export3mf } from '../../core/bake/threemf';
import { PALETTES } from '../../core/palette';
import { GROUPS, PRINTERS, filamentSlots, isSeparate, planKind, planModular, planWhole, type PartGroup } from '../../core/print';
import { filamentPlan, printHex } from '../../core/filaments';
import { inkName } from '../../core/bake/threemf';
import { bakeStore } from '../bakeStore';
import { download } from '../download';
import { creatureInks, fittedPlan, restGeometry, usePrintReport } from '../printReport';
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
      : { text: r.checksumOk ? 'Wczytano Morphoida z kodu DNA.' : 'Wczytano, ale suma kontrolna się nie zgadza: sprawdź, czy kod jest cały.', warn: !r.checksumOk });
  };
  return (
    <>
      <div>
        <div className="control-label">Nazwa</div>
        <input className="name-field" value={nameDraft ?? who.name} maxLength={40} spellCheck={false} aria-label="Nazwa Morphoida"
          onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setNameDraft(null); }} />
      </div>
      <div className="btn-row">
        <button type="button" className={`btn-soft${rolling ? ' rolling' : ''}`} disabled={rolling} onClick={() => viewOptions.roll(() => studio.randomize(newSeed()))}><i className="dice">🎲</i> {rolling ? 'Losuję…' : 'Losowo'}</button>
        <button type="button" className="btn-soft" disabled={rolling} onClick={() => viewOptions.roll(() => studio.mutateLight(newSeed()))}>🧬 Mutuj lekko</button>
      </div>
      <div>
        <div className="control-label">Wklej DNA</div>
        <div className="dna-input-pair">
          <div className="dna-box">
            <textarea className="dna-code-field" rows={2} value={paste} spellCheck={false} aria-label="Wklej kod DNA" placeholder="MPH2:B01.33:L01.3:…"
              onChange={(e) => setPaste(e.target.value)}
              onPaste={(e) => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); load(t); } }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); load(paste); } }} />
          </div>
          <button type="button" className="btn-soft dna-load" onClick={() => load(paste)}>Wczytaj</button>
        </div>
      </div>
      {msg && <div className={`msg${msg.warn ? ' warn' : ''}`} role="status">{msg.text}</div>}
    </>
  );
}

function ProjectBody() {
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
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
      {!asking ? <button type="button" className="btn-soft danger" onClick={() => { setAsking(true); setMsg(null); }}>Resetuj</button> : (
        <div className="confirm-box" role="alertdialog" aria-label="Potwierdź reset">
          <p>Na pewno zresetować? Obecny Morphoid zniknie, jeśli nie jest zapisany.</p>
          <div className="btn-row">
            <button type="button" className="btn-soft danger" onClick={() => { studio.reset(); setAsking(false); setMsg({ text: 'Przywrócono bazowego Morphoida.', warn: false }); }}>Tak, resetuj</button>
            <button type="button" className="btn-soft" onClick={() => setAsking(false)}>Anuluj</button>
          </div>
        </div>
      )}
      {msg && <div className={`msg${msg.warn ? ' warn' : ''}`} role="status">{msg.text}</div>}
    </>
  );
}

/**
 * The printer the 3MF is set up for and its AMS units: how many filaments the creature needs, and which colours
 * share a filament when the printer has fewer slots than that.
 */
function PrinterBody() {
  const { genome, plan } = useStudioState();
  const machine = PRINTERS[plan.printer] ?? PRINTERS.p1s!;
  const palette = PALETTES[genome.palette!.index!] ?? PALETTES[0]!;
  const inks = useMemo(() => creatureInks(genome), [genome]);
  const slots = filamentSlots(plan.ams);
  const fp = filamentPlan(inks.map((k) => printHex(k, palette)), slots);
  const nameOf = (hex: string): string => inkName(inks.find((k) => printHex(k, palette) === hex) ?? 'c1', palette);
  const units = Array.from({ length: machine.amsMax + 1 }, (_, i) => i);
  return (
    <>
      <label className="field-row">
        <span className="control-label">Drukarka</span>
        <select value={machine.id} onChange={(e) => studio.setPrinter(e.target.value, plan.ams)} aria-label="Drukarka">
          {Object.values(PRINTERS).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div>
        <div className="control-label">{machine.amsName}</div>
        <div className="segment">
          {units.map((n) => (
            <button key={n} type="button" className={`seg-pill${plan.ams === n ? ' active' : ''}`} onClick={() => studio.setPrinter(machine.id, n)}>
              {n === 0 ? 'Brak' : machine.amsMax === 1 ? 'Jest' : `${n} × ${filamentSlots(1)}`}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="control-label">Filamenty w pliku 3MF <b>{fp.filaments.length} z {slots}</b></div>
        <ol className="filaments">
          {fp.filaments.map((hex, i) => (
            <li key={hex}><i className="sw-dot" style={{ background: hex }} /><span>{i + 1}. {nameOf(hex)}</span></li>
          ))}
        </ol>
        {fp.merged.length > 0 && (
          <p className="hint">
            Morphoid ma {inks.length} {inks.length < 5 ? 'kolory' : 'kolorów'}, a {plan.ams ? `${machine.amsName} mieści ${slots} ${slots < 5 ? 'filamenty' : 'filamentów'}` : 'bez AMS drukarka ma jeden filament'}.
            Najbliższe kolory drukują się razem: {fp.merged.map(([a, b]) => `${nameOf(a).toLowerCase()} jako ${nameOf(b).toLowerCase()}`).join(', ')}.
          </p>
        )}
      </div>
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
  const issues = report.issues.filter((i) => i.severity !== 'info' && i.severity !== 'support');
  const fix = issues.find((i) => i.fix);
  return (
    <>
      <PrinterBody />
      <div className="control-label">Sposób druku</div>
      <div className="segment">
        <button type="button" className={`seg-pill${kind === 'whole' ? ' active' : ''}`}
          onClick={() => studio.setPlan({ ...planWhole(plan.printer, plan.ams), maxBridge: plan.maxBridge })}>Całość</button>
        <button type="button" className={`seg-pill${kind !== 'whole' ? ' active' : ''}`}
          onClick={() => { if (kind === 'whole') studio.setPlan(fittedPlan(genome, { ...planModular(plan.printer, plan.ams), maxBridge: plan.maxBridge })); }}>Części</button>
      </div>
      {kind === 'whole' ? <p className="hint">Cały Morphoid drukuje się w jednym kawałku{present.some((g) => g.forced) ? ` (oprócz: ${present.filter((g) => g.forced).map((g) => g.label.toLowerCase()).join(', ')}, zawsze osobno)` : ''}.</p> : (
        <div>
          <div className="control-label">Części do druku</div>
          <ol className="mods">
            {/* a part switched off prints together with the torso: the torso's line says which */}
            <li><span className="mn">{['Tułów', ...present.filter((g) => !g.forced && !isSeparate(plan, g.id as PartGroup)).map((g) => g.label)].join(' + ')}</span><span className="mx">baza</span></li>
            {present.map((g) => {
              const on = isSeparate(plan, g.id as PartGroup);
              return (
                <li key={g.id} className={on ? '' : 'merged'}>
                  <span className="mn">{g.label}</span>
                  <span className="mx">{g.forced ? 'zawsze osobno' : on ? 'osobna część' : 'z tułowiem'}</span>
                  {!g.forced && <button type="button" className="sw" role="switch" aria-checked={on} aria-label={`${g.label} jako osobna część`}
                    onClick={() => studio.setSeparate(g.id, !on)} />}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {view === '3d' && kind !== 'whole' && anySeparate && (
        <label className="slider-row">
          <span className="control-label">Rozsuń części <b>{Math.round(explode * 100)}%</b></span>
          <input type="range" min={0} max={100} value={Math.round(explode * 100)} onChange={(e) => setExplode(Number(e.target.value) / 100)} aria-label="Rozsuń części" />
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



/** How the creature is shown: in 2D the sketch's colours and bones, in 3D the grey filament, framing and smoothing. */
function ViewBody({ view }: { view: ViewMode }) {
  const o = useViewOptions();
  const preview = usePreview();
  if (view === '2d') return (
    <>
      <div>
        <div className="control-label">Kolory szkicu</div>
        <div className="segment">
          <button type="button" className={`seg-pill${o.sketchMode === 'color' ? ' active' : ''}`} onClick={() => viewOptions.setSketchMode('color')}>Kolor Morphoida</button>
          <button type="button" className={`seg-pill${o.sketchMode === 'print' ? ' active' : ''}`} onClick={() => viewOptions.setSketchMode('print')}>Druk</button>
        </div>
      </div>
    </>
  );
  return (
    <>
      <label className="switch-row">
        <span>Obracaj model</span>
        <button type="button" className="sw" role="switch" aria-checked={o.spin} aria-label="Obracaj model" onClick={() => viewOptions.setSpin(!o.spin)} />
      </label>
      <label className="switch-row">
        <span>Szary filament</span>
        <button type="button" className="sw" role="switch" aria-checked={o.grey} aria-label="Szary filament" title="Jak wydruk z jednego, szarego filamentu" onClick={() => viewOptions.setGrey(!o.grey)} />
      </label>
      <div className="btn-row">
        <button type="button" className="btn-soft" onClick={() => viewOptions.recenter()}>Wyśrodkuj widok</button>
        <button type="button" className="btn-soft" disabled={preview.quality !== 'draft' || preview.busy}
          title="Podgląd podczas zmian jest uproszczony, żeby działał płynnie. Szczegóły pokazują model tak, jak wyjdzie w pliku do druku."
          onClick={() => previewStore.smooth()}>
          {preview.quality === 'smoothing' ? 'Liczę szczegóły…' : preview.quality === 'smooth' ? 'Szczegóły widoczne' : 'Pokaż szczegóły na modelu'}
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
    if (format === '3mf') {
      void export3mf(r, studio.creature(), PALETTES[genome.palette!.index!]!, plan.printer, plan.ams).then((f) => download(f.name, f.bytes));
      return true;
    }
    const f = exportBundle(r, studio.creature());
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
          title={`Projekt Bambu Studio dla ${PRINTERS[plan.printer]?.name ?? 'drukarki'} z filamentami w kolorach Morphoida (Opcje druku). Otwiera się też w OrcaSlicer i PrusaSlicer.`}>3MF w kolorach</button>
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
  const issues = report.issues.filter((i) => i.severity !== 'info' && i.severity !== 'support').length;
  const viewSketch = useViewOptions().sketchMode;
  return (
    <aside className="column right acc-column right-panel">
      <div className="right-scroll">
        <Category id="view" title="Widok" value={props.view === '2d' ? (viewSketch === 'color' ? 'Kolor Morphoida' : 'Druk') : 'Studio 3D'} open={open} setOpen={setOpen}><ViewBody view={props.view} /></Category>
        <Category id="morphoid" title="Morphoid" value={studio.creature().name} open={open} setOpen={setOpen}><MorphoidBody /></Category>
        <Category id="project" title="Projekt" value={saved ? 'zapisany' : 'niezapisany'} open={open} setOpen={setOpen}><ProjectBody /></Category>
        <Category id="print" title="Opcje druku" value={`${PRINTERS[plan.printer]?.name.replace('Bambu Lab ', '') ?? ''} · ${kind === 'whole' ? 'Całość' : `Części · ${parts}`}`} badge={issues} open={open} setOpen={setOpen}><PrintBody {...props} /></Category>
      </div>
      <ExportFooter />
    </aside>
  );
}
