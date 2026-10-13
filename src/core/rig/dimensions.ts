/**
 * Step tables: genome step (0..5 = 2N) -> physical size in millimetres.
 *
 * !! PLACEHOLDER VALUES - to be tuned against real prints. !!
 * Every value is snapped to the 0.4 mm nozzle grid so wall/feature sizes are
 * always multiples of the extrusion width.
 */
import { STEPS } from '../genome/schema';

export const NOZZLE_MM = 0.4;
export const snap = (mm: number, q = NOZZLE_MM): number => Math.round(mm / q) * q;

const table = (raw: readonly number[]): readonly number[] => {
  if (raw.length !== STEPS) throw new Error('step table must have 6 entries');
  return raw.map((v) => snap(v));
};

export const BODY_LENGTH = table([36, 42, 48, 56, 64, 74]);
export const BODY_GIRTH = table([14, 16, 18, 21, 24, 28]); // vertical thickness
export const LEG_LENGTH = table([8, 10, 12, 15, 18, 22]);
export const NECK_LENGTH = table([6, 9, 12, 16, 21, 27]);
export const TAIL_LENGTH = table([14, 20, 26, 34, 43, 54]);
export const WING_SPAN = table([14, 18, 23, 29, 36, 44]);
export const HORN_SPAN = table([5, 7, 9, 12, 15, 19]);
export const EAR_SIZE = table([5, 7, 9, 11, 14, 18]);
export const SNOUT_REACH = table([4, 6, 8, 10, 13, 16]);
export const CREST_SIZE = table([4, 6, 8, 10, 12, 15]);

/** Body width (Z) as a fraction of its girth, per body shape. */
export const BODY_WIDTH_RATIO = [0.9, 0.7, 1.15] as const;

/** Flat soles are mandatory: a foot with too little contact will not stick. */
export interface FootSole { length: number; width: number }
export const FOOT_SOLE: readonly FootSole[] = [
  { length: 12, width: 9 }, // paw
  { length: 12, width: 9 }, // claws - toes are raised, but the sole stays flat
  { length: 10, width: 9 }, // hoof
];
export const MIN_SOLE_AREA_MM2 = 60;
