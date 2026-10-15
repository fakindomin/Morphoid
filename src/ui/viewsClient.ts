import { serialize, withoutSculpt, type MorphotypeGenome } from '../core/genome';
import type { ViewSet } from '../core/art/views';

/**
 * The creature's three views, computed off the main thread and kept per shape. `viewsFor` answers at once with what is
 * ready (null while a new shape is being projected); the sketch asks again every frame.
 */
const cache = new Map<string, ViewSet>();
let worker: Worker | null = null;
let busy = '';
let queued: { key: string; genome: MorphotypeGenome } | null = null;

const send = (key: string, genome: MorphotypeGenome): void => {
  if (!worker) {
    worker = new Worker(new URL('./views.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ key: string; views?: ViewSet; error?: string }>): void => {
      if (e.data.views) {
        if (cache.size > 24) cache.delete(cache.keys().next().value!);
        cache.set(e.data.key, e.data.views);
      } else console.warn('views:', e.data.error);
      busy = '';
      if (queued) { const q = queued; queued = null; if (!cache.has(q.key)) send(q.key, q.genome); }
    };
  }
  busy = key;
  worker.postMessage({ key, genome });
};

/** The views of the shape (the 2D sketch leaves out the 3D-only deformation, so do the views). */
export function viewsFor(g: MorphotypeGenome): ViewSet | null {
  const shape = withoutSculpt(g);
  const key = serialize({ ...shape, palette: { index: 0 } } as MorphotypeGenome);
  const hit = cache.get(key);
  if (hit) return hit;
  if (busy === key) return null;
  if (busy) queued = { key, genome: shape };
  else send(key, shape);
  return null;
}
