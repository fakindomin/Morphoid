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

/**
 * Size sliders (2026-10-15): a factor on a part's drawn size, step 2 = 1 (how every creature looked before the slider).
 * A 3-level slider uses steps 0, 2 and 5 (see SIZE_LEVELS3 in the studio), so its three sizes differ clearly.
 */
const factors = (raw: readonly number[]): readonly number[] => {
  if (raw.length !== STEPS) throw new Error('factor table must have 6 entries');
  return raw;
};
export const HEAD_SIZE = factors([0.74, 0.87, 1, 1.13, 1.27, 1.42]);
export const EYE_SIZE = factors([0.6, 0.8, 1, 1.2, 1.42, 1.66]);
export const WHISKER_SIZE = factors([0.55, 0.77, 1, 1.25, 1.5, 1.8]);
export const NECK_THICK = factors([0.7, 0.85, 1, 1.15, 1.3, 1.45]);
export const LEG_THICK = factors([0.74, 0.87, 1, 1.12, 1.25, 1.4]);
export const HAND_THICK = factors([0.72, 0.86, 1, 1.15, 1.3, 1.45]);
export const PATTERN_SIZE = factors([0.6, 0.8, 1, 1.2, 1.4, 1.6]);
/** A factor from its table, for a step that may be missing (an old genome object). */
export const factorAt = (t: readonly number[], step: number | undefined): number => t[step ?? 2] ?? 1;

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
export const BODY_WIDTH_RATIO = [0.9, 0.7, 1.15, 0.72] as const;

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

/**
 * Anatomical body (a quadruped with the animal trunk, body shape 3): the trunk and neck are built from masses (see
 * art/anatomy.ts) and the creature stands like an animal, not a toy. Its legs are slender and their length follows the
 * chest's depth (a share of the girth per leg-length step), the neck rises from inside the chest (a short, heavy neck
 * of a bull or a bear nearly level, a giraffe's long one steep)
 * and carries the head up and forward of the withers, and the tail is thin at the root.
 */
export const ANATOMY = {
  shape: 3,
  legK: [0.85, 0.95, 1.05, 1.15, 1.25, 1.4],
  legW: 0.68, legWMin: 4.8,
  neckAngle: (step: number): number => 0.6 + 0.1 * step, neckK: 1, neckHead: 0.9,
  neckBase: [0.38, 0.12] as const,
  tailY: 0.28,
} as const;
export const isAnatomical = (plan: number, shape: number): boolean => (plan === PLAN.quadruped || isBiped(plan)) && shape === ANATOMY.shape;

/** Gesture: how far (rad) a quadruped's chest rises over its hips. */
export const GESTURE = { chestUp: 0.07 } as const;

/**
 * Body plan (gene Y). A biped stands on its hind legs under the middle of a torso tilted nose-up; its legs are longer
 * and its soles longer (toes forward, a spur back), since two feet must carry it.
 */
export const BIPED = { tilt: 0.32, hipX: 0.06, leg: 1.35, sole: 1.5 } as const;

/**
 * Humanoid (gene Y, a monkey, an ape): stands upright on two legs, the trunk nearly vertical (chest over belly over
 * pelvis), the hips at its bottom, a short neck carrying the head on top, a broad chest and long arms. Its legs are
 * nearly straight (knees forward, not a bird's), its feet long and flat.
 */
export const HUMANOID = {
  tilt: 1.4, hipX: -0.4, leg: 2.0, sole: 1.6, width: 1.3, length: 0.72, head: 1.18,
  neckBase: [0.46, -0.05] as const, neckAngle: 1.3, neckK: 0.35,
  tail: [-0.42, 0.25] as const, arm: 1.3, shoulder: [0.36, -0.02] as const,
} as const;
/** Two-legged plans: the bird-like biped and the upright humanoid. */
export const isBiped = (plan: number): boolean => plan === PLAN.biped || plan === PLAN.humanoid;

/**
 * Arms with hands (gene X): a pair growing out of the upper chest, in front of the front legs. Length per size step
 * (shoulder to wrist, mm); the plans that have no chest to carry them (fish, octopus) show none.
 */
export const ARM_LEN: readonly number[] = [14, 17, 20, 23, 27, 31];
export const hasArms = (plan: number): boolean => plan !== PLAN.fish && plan !== PLAN.octopus;

/** Body plans by index (gene Y). Belly plans lie on the bed: the torso's flat underside is their sole. */
export const PLAN = { quadruped: 0, biped: 1, caterpillar: 2, insect: 3, fish: 4, octopus: 5, humanoid: 6 } as const;
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
  { length: 9, width: 9 },  // cat's paw: short and round
  { length: 14, width: 9 }, // bear's paw: long, flat
  { length: 14, width: 9 }, // webbed: long toes
  { length: 10, width: 9 }, // cloven hoof
  { length: 12, width: 9 }, // a monkey's hand: a long palm and fingers
];
export const MIN_SOLE_AREA_MM2 = 60;
/** Gene option indices the rig needs: the monkey's hand (foot) and the ape's face (snout). */
export const FOOT_HAND = 7, SNOUT_APE = 8, SNOUT_MACAQUE = 9;
/** A primate's muzzle: its ears sit on the sides of the head. */
export const primateSnout = (t: number): boolean => t === SNOUT_APE || t === SNOUT_MACAQUE;
