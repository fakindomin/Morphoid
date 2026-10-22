import { useSyncExternalStore } from 'react';
import type { ElementId } from '../core/art/handles';

/**
 * Which element of the creature the 3D view's handles are on (clicked on the model), and whether one is being pulled.
 * Only the view and its panel read it; the change itself goes into the genome (studio.fine).
 */
export interface HandlesState {
  selected: { id: ElementId; side: -1 | 0 | 1 } | null;
  /** a handle is being dragged: the view keeps it under the pointer instead of following each rebuilt solid */
  dragging: boolean;
}

let state: HandlesState = { selected: null, dragging: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<HandlesState>): void => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

export const handlesStore = {
  get: (): HandlesState => state,
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
  select(sel: HandlesState['selected']): void {
    if (sel?.id === state.selected?.id && sel?.side === state.selected?.side) return;
    set({ selected: sel });
  },
  setDragging(on: boolean): void { if (on !== state.dragging) set({ dragging: on }); },
};

export const useHandles = (): HandlesState => useSyncExternalStore(handlesStore.subscribe, handlesStore.get);
