/// <reference lib="webworker" />
import { bake, type BakeQuality } from '../core/bake/bake';
import type { MorphotypeGenome } from '../core/genome';
import type { PrintPlan } from '../core/print';

interface Req { id: number; genome: MorphotypeGenome; plan: PrintPlan; quality: BakeQuality }

self.onmessage = (e: MessageEvent<Req>): void => {
  const { id, genome, plan, quality } = e.data;
  try {
    const result = bake(genome, plan, quality, (stage, done, total) => self.postMessage({ type: 'progress', id, stage, done, total }));
    const transfer: ArrayBuffer[] = [];
    for (const p of result.pieces) {
      delete p.mesh.cells; // only needed for repairs
      transfer.push(p.mesh.positions.buffer as ArrayBuffer, p.mesh.indices.buffer as ArrayBuffer);
    }
    self.postMessage({ type: 'result', id, result }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
