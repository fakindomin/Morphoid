import { useSyncExternalStore } from 'react';
import type { BakeProgress, BakeQuality, BakeResult } from '../core/bake/bake';
import { runBake, type BakeHandle } from './bakeClient';
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
  showBaked: boolean;
  /** bumped when a bake finishes: lets the UI show a one-off "ready" notification */
  finishedCount: number;
}

let job: BakeJob = {
  status: 'idle', quality: 'standard', startedAt: 0, progress: null, result: null, signature: null,
  error: null, showBaked: true, finishedCount: 0,
};
let handle: BakeHandle | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<BakeJob>): void => { job = { ...job, ...patch }; listeners.forEach((l) => l()); };
const TITLE = 'Morphoid Studio';

export const bakeStore = {
  get: (): BakeJob => job,
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
  setQuality(quality: BakeQuality): void { set({ quality }); },
  setShowBaked(showBaked: boolean): void { set({ showBaked }); },

  start(): void {
    handle?.cancel();
    const { genome, plan } = studio.getState();
    const signature = signatureOf(studio.code(), plan.separate);
    set({ status: 'running', startedAt: performance.now(), progress: { frac: 0, label: 'Start', piece: '', index: 0, count: 0 }, error: null });
    const h = runBake(genome, plan, job.quality, (progress) => {
      set({ progress });
      document.title = `⚙ ${Math.round(progress.frac * 100)}% · ${TITLE}`;
    });
    handle = h;
    h.promise
      .then((result) => { if (handle === h) set({ status: 'done', result, signature, progress: null, showBaked: true, finishedCount: job.finishedCount + 1 }); })
      .catch((e: Error) => { if (handle === h && e.message !== 'cancelled') set({ status: 'error', error: e.message, progress: null }); })
      .finally(() => { if (handle === h) { handle = null; document.title = TITLE; } });
  },

  cancel(): void {
    handle?.cancel();
    handle = null;
    document.title = TITLE;
    set({ status: job.result ? 'done' : 'idle', progress: null });
  },
};

export const useBake = (): BakeJob => useSyncExternalStore(bakeStore.subscribe, bakeStore.get);
