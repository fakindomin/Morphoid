import { useSyncExternalStore } from 'react';
import type { PreviewSolid } from '../core/bake/preview';
import { studio } from './studio';

/**
 * Keeps the 3D preview's solid in step with the model: after every change (a short pause first, so a burst of clicks
 * or a slider drag is one job) a worker builds a quick, coarse draft. The fine, smooth solid is built only when asked
 * ("Wygładź model"): it costs seconds of CPU, too much to pay on every change on a weaker computer. A new change
 * terminates the running job and goes back to the draft. The last solid stays on screen, marked stale, until the new
 * one arrives.
 */
export interface PreviewJob {
  solid: PreviewSolid | null;
  /** DNA the solid was made from */
  code: string | null;
  /** a newer solid is being built */
  busy: boolean;
  /** draft = quick coarse solid; smoothing = the fine one is being built; smooth = the fine one is on screen */
  quality: 'draft' | 'smoothing' | 'smooth';
  error: string | null;
}

/** The draft's voxel (mm): about half a second on a fast computer. */
const DRAFT = [1.0];
/** The smooth solid: teeth, eyelids and claws crisp (the cell budget caps it, a few seconds). */
const SMOOTH = [0.28];
const DEBOUNCE_MS = 200;

let job: PreviewJob = { solid: null, code: null, busy: false, quality: 'draft', error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<PreviewJob>): void => { job = { ...job, ...patch }; listeners.forEach((l) => l()); };

let worker: Worker | null = null;
let timer = 0;
let seq = 0;
let active = 0;

function run(smooth = false): void {
  const code = studio.code();
  if (!smooth && code === job.code && !job.busy) return;
  const voxels = smooth ? SMOOTH : DRAFT;
  worker?.terminate();
  const id = ++seq;
  const w = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  set({ busy: true, error: null, quality: smooth ? 'smoothing' : 'draft' });
  let left = voxels.length;
  w.onmessage = (e: MessageEvent<{ id: number; solid?: PreviewSolid; error?: string }>): void => {
    if (e.data.id !== id || worker !== w) return;
    if (e.data.error) { w.terminate(); worker = null; set({ busy: false, quality: 'draft', error: e.data.error }); return; }
    left--;
    if (left === 0) { w.terminate(); worker = null; }
    set({ solid: e.data.solid!, code, busy: left > 0, quality: smooth ? (left > 0 ? 'smoothing' : 'smooth') : 'draft' });
  };
  w.onerror = (e): void => { if (worker === w) { w.terminate(); worker = null; set({ busy: false, quality: 'draft', error: e.message }); } };
  w.postMessage({ id, genome: studio.getState().genome, voxels });
}

const schedule = (): void => {
  if (!active) return;
  clearTimeout(timer);
  if (studio.code() === job.code && !job.busy) return; // a name or a print option changed, not the creature
  if (studio.code() !== job.code) set({ busy: true, quality: 'draft' });
  timer = window.setTimeout(() => run(), DEBOUNCE_MS);
};
studio.subscribe(schedule);

export const previewStore = {
  get: (): PreviewJob => job,
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
  /** build the fine, smooth solid of the current model (the draft stays on screen until it is ready) */
  smooth(): void { if (active && job.quality === 'draft') { clearTimeout(timer); run(true); } },
  /** the 3D view is on screen: keep the solid up to date (nothing is built while only the 2D sketch is shown) */
  attach(): () => void {
    active++;
    if (studio.code() !== job.code) run();
    return () => { active--; if (!active) { clearTimeout(timer); worker?.terminate(); worker = null; if (job.busy) set({ busy: false, quality: job.code === studio.code() && job.quality === 'smooth' ? 'smooth' : 'draft' }); } };
  },
};

export const usePreview = (): PreviewJob => useSyncExternalStore(previewStore.subscribe, previewStore.get);
