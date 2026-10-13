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
import { planWhole, planModular, toggleGroup, type PartGroup, type PrintPlan } from './print/plan';

export interface StudioState {
  genome: MorphotypeGenome;
  past: MorphotypeGenome[];
  future: MorphotypeGenome[];
  /** how the user wants to print it - deliberately NOT part of the genome */
  plan: PrintPlan;
}

const HISTORY_LIMIT = 100;

export function createStudioStore(initial: MorphotypeGenome = defaultGenome()) {
  let state: StudioState = { genome: initial, past: [], future: [], plan: planWhole() };
  const listeners = new Set<(s: StudioState) => void>();
  const emit = (): void => listeners.forEach((l) => l(state));

  /** @returns true when the genome actually changed (and a history entry was added). */
  const commit = (next: MorphotypeGenome): boolean => {
    if (serialize(next) === serialize(state.genome)) return false;
    state = { ...state, genome: next, past: [...state.past, state.genome].slice(-HISTORY_LIMIT), future: [] };
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

    setPlan(plan: PrintPlan): void { state = { ...state, plan }; emit(); },
    planPreset(kind: 'whole' | 'modular'): void {
      const base = kind === 'whole' ? planWhole(state.plan.printer) : planModular(state.plan.printer);
      state = { ...state, plan: { ...base, maxBridge: state.plan.maxBridge } };
      emit();
    },
    setSeparate(group: PartGroup, separate: boolean): void { state = { ...state, plan: toggleGroup(state.plan, group, separate) }; emit(); },
    setBridge(mm: number): void { state = { ...state, plan: { ...state.plan, maxBridge: mm } }; emit(); },

    undo(): void {
      const prev = state.past[state.past.length - 1];
      if (!prev) return;
      state = { ...state, genome: prev, past: state.past.slice(0, -1), future: [state.genome, ...state.future] };
      emit();
    },
    redo(): void {
      const [next, ...rest] = state.future;
      if (!next) return;
      state = { ...state, genome: next, past: [...state.past, state.genome], future: rest };
      emit();
    },
  };
}

export type StudioStore = ReturnType<typeof createStudioStore>;
