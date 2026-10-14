import { useEffect, useState } from 'react';
import { signatureOf, useBake, type BakeJob } from '../bakeStore';
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
