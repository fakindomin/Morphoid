/**
 * Printability contract for FDM, 0.4 mm nozzle, NO supports.
 * These numbers are the project's definition of "prints well". Every element
 * that exists in the 2D editor is checked against them; changing a number here
 * changes the verdict for the whole catalog.
 */
export const PRINT_RULES = {
  nozzle: 0.4,
  /** thinnest protrusion allowed (3 extrusion lines); sharper tips are cut, not printed */
  minFeature: 1.2,
  /** thinnest wall of a shell */
  minWall: 0.8,
  /** Z thickness of plate-like parts (wings, ears) */
  plateThickness: 1.6,
  /** steepest overhang from the vertical (deg). 45 = classic support-free limit */
  maxOverhangDeg: 45,
  /** unsupported span anchored on both sides (mm) */
  maxBridge: 8,
  /** minimum flat contact area per foot (mm^2) */
  minSoleArea: 60,
  /** engraved details (mouth, brow, patterns) */
  grooveWidth: 0.8,
  grooveDepth: 0.5,
  /** raised details (eyes, nose, ridges) */
  reliefHeight: 0.8,
  /** areas of "lost" thin material below this are just sharp tips (mm^2) */
  tipTolerance: 4,
} as const;
