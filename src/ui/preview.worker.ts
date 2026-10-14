/// <reference lib="webworker" />
import { previewSolid } from '../core/bake/preview';
import type { MorphotypeGenome } from '../core/genome';

interface Req { id: number; genome: MorphotypeGenome; voxels: number[] }

/** Builds the preview solid, coarse first and then finer, posting each as soon as it is ready. */
self.onmessage = (e: MessageEvent<Req>): void => {
  const { id, genome, voxels } = e.data;
  for (const h of voxels) {
    try {
      const solid = previewSolid(genome, h);
      self.postMessage({ id, h, solid }, [solid.positions.buffer as ArrayBuffer, solid.normals.buffer as ArrayBuffer, solid.ao.buffer as ArrayBuffer, solid.indices.buffer as ArrayBuffer]);
    } catch (err) {
      self.postMessage({ id, h, error: err instanceof Error ? err.message : String(err) });
      return;
    }
  }
};
