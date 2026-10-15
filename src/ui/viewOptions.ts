import { useSyncExternalStore } from 'react';
import { previewStore } from './previewStore';
import { storage } from './studio';

/**
 * How the creature is shown (not part of the DNA): the sketch's colours and bones in 2D, the grey filament and the
 * "centre the view" request in 3D. The controls live in the right column, the views read them from here.
 */
import type { SketchMode } from './sketch';
import type { ViewId } from '../core/art/views';

export type { SketchMode, ViewId };
export interface ViewOptions {
  sketchMode: SketchMode;
  showBones: boolean;
  grey: boolean;
  /** bumped by "Wyśrodkuj widok": the 3D view frames the creature again */
  recenter: number;
  /** a new creature is being drawn ("Losowo", "Mutuj"): the dice spin until its new shape is on screen */
  rolling: boolean;
  /** the 2D sketch seen from the side, the front or above (it turns smoothly between them) */
  view: ViewId;
  /** the 3D model turns slowly on its own (switch in the right column) */
  spin: boolean;
}

const SKETCH_KEY = 'morphoid.sketchMode', GREY_KEY = 'morphoid.grey', SPIN_KEY = 'morphoid.spin';
let state: ViewOptions = {
  sketchMode: storage.get(SKETCH_KEY) === 'color' ? 'color' : 'print',
  showBones: false,
  grey: storage.get(GREY_KEY) === '1',
  recenter: 0,
  rolling: false,
  view: 'side',
  spin: storage.get(SPIN_KEY) !== '0',
};
const listeners = new Set<() => void>();
const set = (patch: Partial<ViewOptions>): void => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

export const viewOptions = {
  get: (): ViewOptions => state,
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
  setSketchMode(m: SketchMode): void { storage.set(SKETCH_KEY, m); set({ sketchMode: m }); },
  setShowBones(on: boolean): void { set({ showBones: on }); },
  setGrey(on: boolean): void { storage.set(GREY_KEY, on ? '1' : '0'); set({ grey: on }); },
  setView(v: ViewId): void { set({ view: v }); },
  setSpin(on: boolean): void { storage.set(SPIN_KEY, on ? '1' : '0'); set({ spin: on }); },
  recenter(): void { set({ recenter: state.recenter + 1 }); },
  /**
   * Draw a new creature with a short, visible roll: the dice spin first, then the creature changes, and the roll ends
   * only when its new shape is on screen (the 3D solid takes a moment), so nobody clicks twice thinking nothing happened.
   */
  roll(change: () => void): void {
    if (state.rolling) return;
    set({ rolling: true });
    const t0 = performance.now();
    window.setTimeout(() => {
      change();
      const done = (): void => {
        const t = performance.now() - t0;
        if ((t < MIN_ROLL_MS || previewStore.get().busy) && t < MAX_ROLL_MS) { window.setTimeout(done, 60); return; }
        set({ rolling: false });
      };
      window.setTimeout(done, 60);
    }, ROLL_LEAD_MS);
  },
};
const ROLL_LEAD_MS = 350, MIN_ROLL_MS = 750, MAX_ROLL_MS = 8000;

export const useViewOptions = (): ViewOptions => useSyncExternalStore(viewOptions.subscribe, viewOptions.get);
