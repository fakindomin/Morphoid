import { useEffect, useRef, useState } from 'react';
import { exportBundle } from '../../core/bake/orient';
import { bakeStore, signatureOf, useBake, type BakeJob } from '../bakeStore';
import { download } from '../download';
import { studio, useStudioState } from '../studio';

const sec = (ms: number): string => `${(ms / 1000).toFixed(ms < 9500 ? 1 : 0).replace('.', ',')} s`;

/** Elapsed ms since `since` while `running`, refreshed 4x per second (so the user always sees time moving). */
export function useElapsed(running: boolean, since: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!running) return;
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);
  return running ? Math.max(0, now - since) : 0;
}

export function useBakeFresh(): { job: BakeJob; fresh: boolean; stale: boolean } {
  const job = useBake();
  const { plan } = useStudioState();
  const sig = signatureOf(studio.code(), plan.separate);
  const hasResult = job.result !== null && job.signature !== null;
  return { job, fresh: hasResult && job.signature === sig, stale: hasResult && job.signature !== sig };
}

export function eta(frac: number, elapsed: number): string {
  if (frac < 0.12 || elapsed < 600) return 'liczę czas…';
  const left = (elapsed * (1 - frac)) / frac;
  return left < 1000 ? 'jeszcze chwila' : `jeszcze ok. ${sec(left)}`;
}

/** Big progress bar with everything the user wants to know: percent, what is happening, time. */
export function BakeProgressBar({ job }: { job: BakeJob }) {
  const elapsed = useElapsed(job.status === 'running', job.startedAt);
  const p = job.progress;
  const pct = Math.round((p?.frac ?? 0) * 100);
  return (
    <div className="bake-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Przygotowanie bryły do druku">
      <div className="bake-progress-top">
        <span className="spinner" aria-hidden />
        <b>{pct}%</b>
        <span className="bake-label">{p?.label ?? 'Start'}{p && p.count > 1 ? ` · ${p.piece} (${p.index}/${p.count})` : p?.piece ? ` · ${p.piece}` : ''}</span>
      </div>
      <div className="progress"><i style={{ width: `${Math.max(4, pct)}%` }} /></div>
      <div className="bake-progress-bottom">
        <span>{sec(elapsed)}</span><span>{eta(p?.frac ?? 0, elapsed)}</span>
      </div>
      <div className="hint">Liczy się w tle. Możesz dalej edytować, strona nie zawiesiła się.</div>
    </div>
  );
}

/** Top bar: one button that is always there and always tells the truth about the state of the solid. */
export function HeaderBake() {
  const { job, fresh, stale } = useBakeFresh();
  const code = studio.code();
  const pct = Math.round((job.progress?.frac ?? 0) * 100);
  if (job.status === 'running') {
    return (
      <span className="bake-chip running" role="status" aria-live="polite">
        <span className="spinner" aria-hidden />
        <span>Bryła {pct}%</span>
        <span className="chip-bar"><i style={{ width: `${Math.max(4, pct)}%` }} /></span>
        <button type="button" className="chip-x" title="Anuluj" aria-label="Anuluj przygotowanie bryły" onClick={() => bakeStore.cancel()}>×</button>
      </span>
    );
  }
  if (fresh && job.result) {
    return (
      <span className="bake-chip done">
        <button type="button" className="chip-main" onClick={() => { const f = exportBundle(job.result!, studio.creature()); download(f.name, f.bytes); }}>✓ Bryła gotowa · Pobierz</button>
        <button type="button" className="chip-x" title="Przygotuj ponownie" aria-label="Przygotuj ponownie" onClick={() => bakeStore.start()}>↻</button>
      </span>
    );
  }
  return (
    <button type="button" className={`bake-chip idle${stale ? ' stale' : ''}`} onClick={() => bakeStore.start()}
      title="Zamienia model na gładką, szczelną bryłę gotową do druku (STL)">
      {job.status === 'error' ? '⚠ Błąd, spróbuj ponownie' : stale ? '↻ Model się zmienił, przygotuj bryłę' : '⚙ Przygotuj do druku'}
    </button>
  );
}

/** Status bar item (visible in 2D and 3D). */
export function StatusBake({ onOpen }: { onOpen: () => void }) {
  const { job, fresh, stale } = useBakeFresh();
  const elapsed = useElapsed(job.status === 'running', job.startedAt);
  if (job.status === 'running') {
    const p = job.progress;
    return (
      <button type="button" className="status-bake running" onClick={onOpen} aria-live="polite">
        <span className="spinner" aria-hidden />
        Bryła: {Math.round((p?.frac ?? 0) * 100)}% · {p?.label ?? 'start'}{p && p.count > 1 ? ` · ${p.piece} ${p.index}/${p.count}` : ''} · {sec(elapsed)}
        <span className="mini-bar"><i style={{ width: `${Math.max(4, (p?.frac ?? 0) * 100)}%` }} /></span>
      </button>
    );
  }
  if (job.status === 'error') return <span className="status-bake bad">Bryła: błąd ({job.error})</span>;
  if (fresh) return <button type="button" className="status-bake done" onClick={onOpen}>✓ Bryła gotowa ({sec(job.result!.ms)})</button>;
  if (stale) return <button type="button" className="status-bake stale" onClick={onOpen}>Bryła nieaktualna: model się zmienił</button>;
  return <span className="status-bake muted">Bryła: nie przygotowana</span>;
}

/** One-off message when a bake finishes, so nobody has to watch the bar. */
export function BakeToast() {
  const { job } = useBakeFresh();
  const seen = useRef(job.finishedCount);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (job.finishedCount !== seen.current) {
      seen.current = job.finishedCount; setOpen(true);
      const id = window.setTimeout(() => setOpen(false), 12000);
      return () => window.clearTimeout(id);
    }
    return;
  }, [job.finishedCount]);
  if (!open || !job.result) return null;
  const ok = job.result.pieces.every((p) => p.validation.watertight && p.validation.volume > 0);
  return (
    <div className={`bake-toast ${ok ? 'ok' : 'bad'}`} role="status" aria-live="polite">
      <b>{ok ? '✓ Bryła gotowa' : '⚠ Bryła z problemami'}</b>
      <span>{sec(job.result.ms)} · {job.result.pieces.length} {job.result.pieces.length === 1 ? 'część' : 'części'} · {ok ? 'wszystko szczelne' : 'sprawdź listę w panelu eksportu'}</span>
      {ok && <button type="button" className="btn-mini" onClick={() => { const f = exportBundle(job.result!, studio.creature()); download(f.name, f.bytes); setOpen(false); }}>Pobierz</button>}
      <button type="button" className="btn-mini ghost" onClick={() => setOpen(false)} aria-label="Zamknij">×</button>
    </div>
  );
}
