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
export const TAIL_LENGTH = table([12, 16, 21, 27, 34, 42]);
export const WING_SPAN = table([14, 18, 23, 29, 36, 44]);
export const HORN_SPAN = table([5, 7, 9, 12, 15, 19]);
export const EAR_SIZE = table([5, 7, 9, 11, 14, 18]);
export const SNOUT_REACH = table([4, 6, 8, 10, 13, 16]);
export const CREST_SIZE = table([4, 6, 8, 10, 12, 15]);
export const ANTENNA_LEN = table([6, 8, 10, 13, 16, 20]);

/** Head ellipse radius (mm); the muzzle starts at the head's front edge. */
export const HEAD_RADIUS = 9.5;

/**
 * Head radius of a creature (rule "duży, średni, mały"): the head follows the torso's girth, so it is always clearly the
 * medium mass next to the big torso (about 0.85 of the girth across), never a second ball as big as the body. Belly
 * plans (caterpillar, fish, octopus) keep the fixed head their outlines are tuned for.
 */
export const HEAD_SHARE = 0.42;
export const HEAD_MIN = 7.5, HEAD_MAX = 10.5;
export function headRadius(girth: number, plan: number): number {
  if (plan === 2 || plan === 4 || plan === 5) return HEAD_RADIUS;
  return Math.round(Math.min(HEAD_MAX, Math.max(HEAD_MIN, girth * HEAD_SHARE)) * 10) / 10;
}

/** Body width (Z) as a fraction of its girth, per body shape. */
export const BODY_WIDTH_RATIO = [0.9, 0.7, 1.15] as const;

/**
 * Build (gene J): one setting that rescales the trunk and limbs of the whole creature. `legW` is the leg's width in
 * the side view and its thickness across the body, so it is also the width of the sole on the bed.
 */
export interface Build { girth: number; length: number; width: number; leg: number; legW: (girth: number) => number; sole: number }
export const BUILD: readonly Build[] = [
  { girth: 1, length: 1, width: 1, leg: 1, legW: (G) => Math.max(6.5, G * 0.5), sole: 1 },          // normal
  { girth: 0.62, length: 1.05, width: 0.75, leg: 1.45, legW: () => 4.4, sole: 1.4 },               // stick: thin, long legs, longer soles
  { girth: 1.1, length: 1, width: 1.15, leg: 1, legW: (G) => Math.max(8, G * 0.62), sole: 1.1 },    // muscular
  { girth: 1.5, length: 0.78, width: 1.25, leg: 0.6, legW: (G) => Math.max(7, G * 0.42), sole: 1 }, // round
  { girth: 0.7, length: 1.05, width: 0.8, leg: 1.3, legW: () => 4.8, sole: 1.3 },                  // skeletal
];

/**
 * Silhouette test (rule "test sylwetki"): the light under a standing creature's belly, in mm. The belly sits about
 * 0.15 of the girth plus 1.5 mm below the hips, so legs shorter than this leave the body lying on the bed.
 */
export const BELLY_GAP_MM = 3.5;
export const minLegForGap = (girth: number): number => BELLY_GAP_MM + 1.5 + 0.15 * girth;

/** Gesture: how far (rad) a quadruped's chest rises over its hips. */
export const GESTURE = { chestUp: 0.07 } as const;

/**
 * Body plan (gene Y). A biped stands on its hind legs under the middle of a torso tilted nose-up; its legs are longer
 * and its soles longer (toes forward, a spur back), since two feet must carry it.
 */
export const BIPED = { tilt: 0.32, hipX: 0.06, leg: 1.35, sole: 1.5 } as const;

/** Body plans by index (gene Y). Belly plans lie on the bed: the torso's flat underside is their sole. */
export const PLAN = { quadruped: 0, biped: 1, caterpillar: 2, insect: 3, fish: 4, octopus: 5 } as const;
export const onBelly = (plan: number): boolean => plan === PLAN.caterpillar || plan === PLAN.fish;
/**
 * Octopus: eight arms lying flat on the bed around a hub under the mantle (the torso, standing on the hub). Arms are
 * top-view plates ARM_MM thick; their length comes from the legs' length gene.
 */
export const OCTOPUS = { arms: 8, armMm: 3.2, hub: 0.5, armLen: (legStep: number) => 16 + legStep * 4 } as const;
/** How much of a belly plan's torso height is cut flat by the bed. */
export const BELLY_FLAT = 0.22;

/** Flat soles are mandatory: a foot with too little contact will not stick. */
export interface FootSole { length: number; width: number }
export const FOOT_SOLE: readonly FootSole[] = [
  { length: 12, width: 9 }, // paw
  { length: 12, width: 9 }, // claws - toes are raised, but the sole stays flat
  { length: 10, width: 9 }, // hoof
];
export const MIN_SOLE_AREA_MM2 = 60;
