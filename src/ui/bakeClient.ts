import type { BakeProgress, BakeQuality, BakeResult } from '../core/bake/bake';
import type { MorphotypeGenome } from '../core/genome';
import type { PrintPlan } from '../core/print';

/** The worker itself failed (not a model problem): worth retrying at a lighter quality. */
export class BakeCrash extends Error {}

export interface BakeHandle { promise: Promise<BakeResult>; cancel: () => void }

/** Runs a bake in a fresh Web Worker; cancelling terminates it. The page never blocks. */
export function runBake(genome: MorphotypeGenome, plan: PrintPlan, quality: BakeQuality, onProgress: (p: BakeProgress) => void): BakeHandle {
  const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
  let rejectFn: (e: Error) => void = () => undefined;
  const promise = new Promise<BakeResult>((resolve, reject) => {
    rejectFn = reject;
    worker.onmessage = (e: MessageEvent): void => {
      const m = e.data as { type: string; result?: BakeResult; message?: string; progress?: BakeProgress };
      if (m.type === 'progress') onProgress(m.progress!);
      else if (m.type === 'result') { worker.terminate(); resolve(m.result!); }
      else { worker.terminate(); reject(m.message?.startsWith('Za mało pamięci') ? new BakeCrash(m.message) : new Error(m.message)); }
    };
    // a worker that dies without a message either never loaded (the page is older than the site) or ran out of memory
    worker.onerror = (e): void => { e.preventDefault(); worker.terminate(); reject(new BakeCrash(e.message || '')); };
    worker.postMessage({ id: 1, genome, plan, quality });
  });
  return { promise, cancel: () => { worker.terminate(); rejectFn(new Error('cancelled')); } };
}
