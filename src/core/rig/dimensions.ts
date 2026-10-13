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

/** Head ellipse radius (mm); the muzzle starts at the head's front edge. */
export const HEAD_RADIUS = 9.5;

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

/**
 * Torso silhouette geometry (shared by the rig, the 2D art and the 3D bake):
 * an ellipse (rx, ry) whose lower corners are cut by 45 degree chamfers down to a flat belly.
 * The chamfers are the tangents at the point where the ellipse itself becomes 45 degrees steep,
 * so every part of the underside is support-free except the flat belly (carried by the legs / arch).
 */
export function hullGeometry(bodyLength: number, bodyGirth: number): {
  rx: number; ry: number; theta: number; px: number; py: number; xc: number;
} {
  const rx = bodyLength / 2 + 2.5, ry = bodyGirth / 2 + 1.5;
  const theta = Math.atan2(ry, rx);              // tan(theta) = ry / rx  <=> slope 45 deg
  const px = rx * Math.cos(theta), py = -ry * Math.sin(theta);
  return { rx, ry, theta, px, py, xc: Math.max(0, px - (ry + py)) };
}
