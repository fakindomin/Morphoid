import { useSyncExternalStore } from 'react';
import type { BakeProgress, BakeQuality, BakeResult } from '../core/bake/bake';
import { BakeCrash, runBake, type BakeHandle } from './bakeClient';
import { studio } from './studio';

export const signatureOf = (code: string, separate: readonly string[]): string => `${code}|${[...separate].sort().join(',')}`;

export interface BakeJob {
  status: 'idle' | 'running' | 'done' | 'error';
  quality: BakeQuality;
  startedAt: number;
  progress: BakeProgress | null;
  result: BakeResult | null;
  /** model + plan the result was made from */
  signature: string | null;
  error: string | null;
  /** set when the bake had to step down to a lighter quality */
  notice: string | null;
  showBaked: boolean;
  /** bumped when a bake finishes: lets the UI show a one-off "ready" notification */
  finishedCount: number;
}

/** Detail first: the finest grid unless the device is short of memory. */
const defaultQuality = (): BakeQuality => {
  try { const m = (navigator as Navigator & { deviceMemory?: number }).deviceMemory; return m !== undefined && m <= 2 ? 'standard' : 'fine'; } catch { return 'standard'; }
};

let job: BakeJob = {
  status: 'idle', quality: defaultQuality(), startedAt: 0, progress: null, result: null, signature: null,
  error: null, notice: null, showBaked: true, finishedCount: 0,
};
const LIGHTER: Partial<Record<BakeQuality, BakeQuality>> = { fine: 'standard', standard: 'draft' };
const NAME: Record<BakeQuality, string> = { draft: 'Szkic', standard: 'Standard', fine: 'Dokładny' };
let handle: BakeHandle | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<BakeJob>): void => { job = { ...job, ...patch }; listeners.forEach((l) => l()); };
const TITLE = 'Morphoid Studio';

function run(quality: BakeQuality): void {
  handle?.cancel();
  const { genome, plan } = studio.getState();
  const signature = signatureOf(studio.code(), plan.separate);
  set({ status: 'running', startedAt: performance.now(), progress: { frac: 0, label: 'Start', piece: '', index: 0, count: 0 }, error: null });
  const h = runBake(genome, plan, quality, (progress) => {
    set({ progress });
    document.title = `⚙ ${Math.round(progress.frac * 100)}% · ${TITLE}`;
  });
  handle = h;
  h.promise
    .then((result) => { if (handle === h) set({ status: 'done', result, signature, progress: null, showBaked: true, finishedCount: job.finishedCount + 1 }); })
    .catch((e: Error) => {
      if (handle !== h || e.message === 'cancelled') return;
      handle = null;
      const lighter = LIGHTER[quality];
      // the browser could not hold this grid: try again one step lighter, by itself
      if (e instanceof BakeCrash && lighter) {
        set({ quality: lighter, notice: `Dokładność „${NAME[quality]}” nie zmieściła się w pamięci przeglądarki, więc bryła powstała w „${NAME[lighter]}”.` });
        run(lighter);
        return;
      }
      set({ status: 'error', progress: null, notice: null,
        error: e instanceof BakeCrash && !e.message ? 'Nie udało się uruchomić obliczeń. Odśwież stronę (strona mogła się zaktualizować) i spróbuj ponownie.' : e.message });
    })
    .finally(() => { if (handle === h) { handle = null; document.title = TITLE; } });
}

export const bakeStore = {
  get: (): BakeJob => job,
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
  setQuality(quality: BakeQuality): void { set({ quality }); },
  setShowBaked(showBaked: boolean): void { set({ showBaked }); },

  start(): void {
    set({ notice: null });
    run(job.quality);
  },

  cancel(): void {
    handle?.cancel();
    handle = null;
    document.title = TITLE;
    set({ status: job.result ? 'done' : 'idle', progress: null });
  },
};

export const useBake = (): BakeJob => useSyncExternalStore(bakeStore.subscribe, bakeStore.get);
