/**
 * Print plan = HOW the user wants to print this Morphoid. It is NOT part of the
 * Morphotyp (the DNA is pure phenotype, no production settings): the same creature
 * can be printed whole, or split into parts joined with pegs, at the user's choice.
 */
import type { SlotId } from '../art/shapes';

export type PartGroup = 'head' | 'ears' | 'horns' | 'crest' | 'wings' | 'tail' | 'legs' | 'whiskers';

export interface GroupDef {
  id: PartGroup;
  label: string;
  slots: SlotId[];
  /**
   * 'flat'   : printed lying on its side; its 3D model gets a flat back face (no overhang analysis)
   * 'upright': printed standing, analysed like the body (shifted so its lowest point is on the bed)
   */
  orientation: 'flat' | 'upright';
  /** cannot be fused (cantilever by design); always a separate part */
  forced?: boolean;
  /** which pieces it rides along with when it stays fused but its host is split away (e.g. ears on a split head) */
  host?: PartGroup;
}

export const GROUPS: readonly GroupDef[] = [
  { id: 'head', label: 'Głowa z szyją', slots: ['head', 'snout', 'throat', 'neck', 'neckDecor', 'collar'], orientation: 'upright' },
  { id: 'ears', label: 'Uszy', slots: ['ear', 'earIn'], orientation: 'flat', host: 'head' },
  { id: 'horns', label: 'Rogi', slots: ['horns'], orientation: 'flat', host: 'head' },
  { id: 'crest', label: 'Grzywa, czub, kolce', slots: ['tuft', 'mane', 'spines'], orientation: 'flat' },
  { id: 'wings', label: 'Skrzydła', slots: ['wingNear', 'wingFar'], orientation: 'flat' },
  { id: 'tail', label: 'Ogon', slots: ['tail'], orientation: 'flat' },
  { id: 'legs', label: 'Nogi z łukiem', slots: ['legB', 'legF', 'legBFar', 'legFFar', 'web'], orientation: 'upright' },
  { id: 'whiskers', label: 'Wąsy', slots: ['whiskers'], orientation: 'flat', forced: true },
];

export const groupOfSlot = (slot: SlotId): GroupDef | undefined => GROUPS.find((g) => g.slots.includes(slot));

export interface PrinterProfile {
  id: string;
  name: string;
  bed: readonly [number, number, number];
  nozzle: number;
  /** default bridge limit (mm) that prints cleanly without supports on this machine */
  maxBridge: number;
}

export const PRINTERS: Record<string, PrinterProfile> = {
  p1s: { id: 'p1s', name: 'Bambu Lab P1S', bed: [256, 256, 256], nozzle: 0.4, maxBridge: 12 },
};

export interface PrintPlan {
  printer: string;
  /** user-tunable bridge limit (mm); defaults to the printer's */
  maxBridge: number;
  /** groups printed as separate parts (peg + socket). Forced groups are always separate. */
  separate: PartGroup[];
}

export const FORCED: readonly PartGroup[] = GROUPS.filter((g) => g.forced).map((g) => g.id);

export function planWhole(printer = 'p1s'): PrintPlan {
  return { printer, maxBridge: PRINTERS[printer]!.maxBridge, separate: [...FORCED] };
}
export function planModular(printer = 'p1s'): PrintPlan {
  return { printer, maxBridge: PRINTERS[printer]!.maxBridge, separate: GROUPS.map((g) => g.id) };
}
export function isSeparate(plan: PrintPlan, g: PartGroup): boolean {
  return plan.separate.includes(g) || FORCED.includes(g);
}
export function toggleGroup(plan: PrintPlan, g: PartGroup, separate: boolean): PrintPlan {
  if (FORCED.includes(g)) return plan;
  const set = new Set(plan.separate);
  if (separate) set.add(g); else set.delete(g);
  return { ...plan, separate: [...set] };
}
export function planKind(plan: PrintPlan): 'whole' | 'modular' | 'custom' {
  const free = GROUPS.filter((g) => !g.forced).map((g) => g.id);
  const n = free.filter((id) => plan.separate.includes(id)).length;
  return n === 0 ? 'whole' : n === free.length ? 'modular' : 'custom';
}
