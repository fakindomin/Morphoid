/**
 * Minimal framework-free store. The genome is the ONLY mutable truth; the code
 * string and the rig are derived (rig is memoised in solveRig). A UI layer can
 * wrap this in Zustand/React with `subscribe` + `getState` unchanged.
 */
import {
  creatureName, defaultGenome, mulberry32, mutate, parse, presetGenome, serialize, setFine, surpriseGenome, withoutSculpt,
  type BlockId, type MorphotypeGenome, type ParseResult, type Preset,
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
  /** names the user gave, by code (without the checksum); every other creature is named from its code */
  names: Record<string, string>;
}

const nameKey = (code: string): string => code.split('#')[0]!;

const HISTORY_LIMIT = 100;

export function createStudioStore(initial: MorphotypeGenome = defaultGenome()) {
  let state: StudioState = { genome: initial, past: [], future: [], plan: planWhole(), names: {} };
  const listeners = new Set<(s: StudioState) => void>();
  const emit = (): void => listeners.forEach((l) => l(state));

  /** @returns true when the genome actually changed (and a history entry was added). */
  const commit = (next: MorphotypeGenome): boolean => {
    if (serialize(next) === serialize(state.genome)) return false;
    state = { ...state, genome: next, past: [...state.past, state.genome].slice(-HISTORY_LIMIT), future: [] };
    emit();
    return true;
  };

  /** Commit a genome; `drag`: a continuation of the same drag, folded into the last history entry (one undo for it). */
  const edit = (next: MorphotypeGenome, drag = false): void => {
    if (!drag || !state.past.length) { commit(next); return; }
    if (serialize(next) === serialize(state.genome)) return;
    state = { ...state, genome: next, future: [] };
    emit();
  };

  return {
    getState: (): StudioState => state,
    subscribe(l: (s: StudioState) => void): () => void { listeners.add(l); return () => listeners.delete(l); },
    code: (): string => serialize(state.genome),
    rig: (): Rig => solveRig(state.genome),
    /** the name and code the files are exported under */
    creature(): { name: string; code: string } {
      const code = serialize(state.genome);
      return { name: state.names[nameKey(code)] ?? creatureName(code), code };
    },
    /** give the current creature a name of one's own; an empty name restores the one drawn from the code */
    setName(name: string): void {
      const key = nameKey(serialize(state.genome)), names = { ...state.names };
      if (name.trim() && name.trim() !== creatureName(key)) names[key] = name.trim().slice(0, 40); else delete names[key];
      state = { ...state, names };
      emit();
    },
    setNames(names: Record<string, string>): void { state = { ...state, names }; emit(); },
    /** start from a ready-made animal: its genome, named after it (Morphoid Kot) */
    loadPreset(p: Preset): void {
      const g = presetGenome(p), key = nameKey(serialize(g));
      commit(g);
      state = { ...state, names: { ...state.names, [key]: p.name } };
      emit();
    },

    applyOps(ops: readonly Op[]): boolean { return commit(ops.reduce(applyOp, state.genome)); },
    /** `base`: what genes missing from the text keep (hand edits keep the current creature) */
    loadCode(text: string, base?: MorphotypeGenome): ParseResult {
      const r = parse(text, base);
      if (r.ok) commit(r.genome);
      return r;
    },
    randomize(seed: number): void { commit(surpriseGenome(mulberry32(seed))); }, // one signature feature, the rest calm
    mutateLight(seed: number): void { commit(mutate(state.genome, mulberry32(seed))); },
    reset(): void { commit(defaultGenome()); },
    /**
     * Move a deformation slider (gene I). `drag`: a continuation of the same drag, which replaces the last history
     * entry instead of adding one per pixel, so one undo takes the whole drag back.
     */
    sculpt(name: string, value: number, drag = false): void { edit(setFine(state.genome, 'sculpt', name, value), drag); },
    /** Move a fine field (a deformation slider, a handle of the 3D view); `drag` as in sculpt. */
    fine(block: BlockId, name: string, value: number, drag = false): void { edit(setFine(state.genome, block, name, value), drag); },
    edit,
    /** all deformation sliders back to zero (the size genes they carried into stay) */
    resetSculpt(): void { commit(withoutSculpt(state.genome)); },

    setPlan(plan: PrintPlan): void { state = { ...state, plan }; emit(); },
    planPreset(kind: 'whole' | 'modular'): void {
      const base = kind === 'whole' ? planWhole(state.plan.printer) : planModular(state.plan.printer);
      state = { ...state, plan: { ...base, maxBridge: state.plan.maxBridge } };
      emit();
    },
    setSeparate(group: PartGroup, separate: boolean): void { state = { ...state, plan: toggleGroup(state.plan, group, separate) }; emit(); },
    setSupports(mode: 'allowed' | 'avoid'): void { state = { ...state, plan: { ...state.plan, supports: mode } }; emit(); },
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
