/**
 * Minimal framework-free store. The genome is the ONLY mutable truth; the code
 * string and the rig are derived (rig is memoised in solveRig). A UI layer can
 * wrap this in Zustand/React with `subscribe` + `getState` unchanged.
 */
import {
  defaultGenome, mulberry32, mutate, parse, randomGenome, serialize,
  type MorphotypeGenome, type ParseResult,
} from './genome';
import { applyOp, type Op } from './radial';
import { solveRig, type Rig } from './rig';

export interface StudioState {
  genome: MorphotypeGenome;
  past: MorphotypeGenome[];
  future: MorphotypeGenome[];
}

const HISTORY_LIMIT = 100;

export function createStudioStore(initial: MorphotypeGenome = defaultGenome()) {
  let state: StudioState = { genome: initial, past: [], future: [] };
  const listeners = new Set<(s: StudioState) => void>();
  const emit = (): void => listeners.forEach((l) => l(state));

  /** @returns true when the genome actually changed (and a history entry was added). */
  const commit = (next: MorphotypeGenome): boolean => {
    if (serialize(next) === serialize(state.genome)) return false;
    state = { genome: next, past: [...state.past, state.genome].slice(-HISTORY_LIMIT), future: [] };
    emit();
    return true;
  };

  return {
    getState: (): StudioState => state,
    subscribe(l: (s: StudioState) => void): () => void { listeners.add(l); return () => listeners.delete(l); },
    code: (): string => serialize(state.genome),
    rig: (): Rig => solveRig(state.genome),

    applyOps(ops: readonly Op[]): boolean { return commit(ops.reduce(applyOp, state.genome)); },
    loadCode(text: string): ParseResult {
      const r = parse(text);
      if (r.ok) commit(r.genome);
      return r;
    },
    randomize(seed: number): void { commit(randomGenome(mulberry32(seed))); },
    mutateLight(seed: number): void { commit(mutate(state.genome, mulberry32(seed))); },
    reset(): void { commit(defaultGenome()); },

    undo(): void {
      const prev = state.past[state.past.length - 1];
      if (!prev) return;
      state = { genome: prev, past: state.past.slice(0, -1), future: [state.genome, ...state.future] };
      emit();
    },
    redo(): void {
      const [next, ...rest] = state.future;
      if (!next) return;
      state = { genome: next, past: [...state.past, state.genome], future: rest };
      emit();
    },
  };
}

export type StudioStore = ReturnType<typeof createStudioStore>;
