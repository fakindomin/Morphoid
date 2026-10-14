import { useSyncExternalStore } from 'react';
import type { PreviewSolid } from '../core/bake/preview';
import { studio } from './studio';

/**
 * Keeps the 3D preview's solid in step with the model: after every change (a short pause first, so a burst of clicks
 * is one job) a worker builds it coarse and then fine. A new change terminates the running job. The last solid stays on
 * screen, marked stale, until the new one arrives.
 */
export interface PreviewJob {
  solid: PreviewSolid | null;
  /** DNA the solid was made from */
  code: string | null;
  /** a newer solid is being built */
  busy: boolean;
  error: string | null;
}

/** Coarse (quick), fine, then finest (teeth, eyelids and claws crisp, a few seconds more) voxel sizes (mm). */
const VOXELS = [0.7, 0.4, 0.28];
const DEBOUNCE_MS = 200;

let job: PreviewJob = { solid: null, code: null, busy: false, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<PreviewJob>): void => { job = { ...job, ...patch }; listeners.forEach((l) => l()); };

let worker: Worker | null = null;
let timer = 0;
let seq = 0;
let active = 0;

function run(): void {
  const code = studio.code();
  if (code === job.code && !job.busy) return;
  worker?.terminate();
  const id = ++seq;
  const w = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  set({ busy: true, error: null });
  let left = VOXELS.length;
  w.onmessage = (e: MessageEvent<{ id: number; solid?: PreviewSolid; error?: string }>): void => {
    if (e.data.id !== id || worker !== w) return;
    if (e.data.error) { w.terminate(); worker = null; set({ busy: false, error: e.data.error }); return; }
    left--;
    if (left === 0) { w.terminate(); worker = null; }
    set({ solid: e.data.solid!, code, busy: left > 0 });
  };
  w.onerror = (e): void => { if (worker === w) { w.terminate(); worker = null; set({ busy: false, error: e.message }); } };
  w.postMessage({ id, genome: studio.getState().genome, voxels: VOXELS });
}

const schedule = (): void => {
  if (!active) return;
  clearTimeout(timer);
  if (studio.code() !== job.code) set({ busy: true });
  timer = window.setTimeout(run, DEBOUNCE_MS);
};
studio.subscribe(schedule);

export const previewStore = {
  get: (): PreviewJob => job,
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
  /** the 3D view is on screen: keep the solid up to date (nothing is built while only the 2D sketch is shown) */
  attach(): () => void {
    active++;
    if (studio.code() !== job.code) run();
    return () => { active--; if (!active) { clearTimeout(timer); worker?.terminate(); worker = null; if (job.busy) set({ busy: false }); } };
  },
};

export const usePreview = (): PreviewJob => useSyncExternalStore(previewStore.subscribe, previewStore.get);
