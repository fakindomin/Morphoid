/// <reference lib="webworker" />
import { bake, type BakeQuality } from '../core/bake/bake';
import type { MorphotypeGenome } from '../core/genome';
import type { PrintPlan } from '../core/print';

interface Req { id: number; genome: MorphotypeGenome; plan: PrintPlan; quality: BakeQuality }

self.onmessage = (e: MessageEvent<Req>): void => {
  const { id, genome, plan, quality } = e.data;
  try {
    const result = bake(genome, plan, quality, (progress) => self.postMessage({ type: 'progress', id, progress }));
    const transfer: ArrayBuffer[] = [];
    for (const p of result.pieces) {
      delete p.mesh.cells; // only needed for repairs
      transfer.push(p.mesh.positions.buffer as ArrayBuffer, p.mesh.indices.buffer as ArrayBuffer);
    }
    self.postMessage({ type: 'result', id, result }, transfer);
  } catch (err) {
    const memory = err instanceof RangeError;
    self.postMessage({ type: 'error', id, message: memory ? 'Za mało pamięci na tę dokładność. Wybierz Standard albo Szkic.' : err instanceof Error ? err.message : String(err) });
  }
};
