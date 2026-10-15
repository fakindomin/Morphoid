/**
 * Ready-made creatures ("Gotowce"): well-known animals built from the same genes as any Morphoid, to show what the
 * studio can make and to start from. Each one lists only the genes that differ from the default creature; option
 * values are indices into the schema's options and sizes are steps 0..STEPS-1 (see schema.ts).
 */
import { canonicalize, defaultGenome, type MorphotypeGenome } from './codec';
import type { BlockId } from './schema';

export interface Preset {
  id: string;
  /** shown to the user, also the creature's name */
  name: string;
  genes: Partial<Record<BlockId, Record<string, number>>>;
}

export const PRESETS: readonly Preset[] = [
  { id: 'cat', name: 'Kot', genes: {
    body: { shape: 3, length: 4, girth: 1 }, legs: { foot: 0, length: 3 }, head: { skull: 0, neckLength: 2 },
    snout: { type: 3, reach: 1 }, ears: { type: 1, scale: 3, dir: 0 }, tail: { type: 1, length: 5, dir: 2 },
    face: { eyes: 2, whiskers: 2, whiskerDir: 0, eyeShape: 1 }, coat: { texture: 1, pattern: 1 }, palette: { index: 3 },
  } },
  { id: 'dog', name: 'Pies', genes: {
    body: { shape: 3, length: 3, girth: 2 }, legs: { foot: 0, length: 3 }, head: { skull: 0, neckLength: 2 },
    snout: { type: 4, reach: 3 }, ears: { type: 4, scale: 3, dir: 0 }, tail: { type: 1, length: 3, dir: 0 },
    face: { expression: 1, eyeShape: 2 }, coat: { texture: 1, pattern: 2 }, palette: { index: 1 },
  } },
  { id: 'bird', name: 'Ptak', genes: {
    plan: { type: 1 }, body: { shape: 0, length: 2, girth: 3 }, legs: { foot: 1, length: 3 }, head: { skull: 0, neckLength: 1 },
    snout: { type: 2, reach: 2 }, ears: { type: 0 }, wings: { type: 1, scale: 3 }, tail: { type: 4, length: 3, dir: 1 },
    crest: { type: 1, scale: 2 }, face: { eyes: 2, eyeShape: 2 }, palette: { index: 5 },
  } },
  { id: 'bull', name: 'Byk', genes: {
    body: { shape: 2, length: 4, girth: 4 }, build: { type: 2 }, legs: { foot: 2, length: 3 }, head: { skull: 2, neckLength: 0 },
    snout: { type: 0, reach: 2 }, ears: { type: 2, scale: 1, dir: 0 }, horns: { type: 1, span: 4, dir: 1 },
    tail: { type: 1, length: 2, dir: 1 }, face: { expression: 2, eyeShape: 2 }, coat: { texture: 0 }, palette: { index: 7 },
  } },
  { id: 'giraffe', name: 'Żyrafa', genes: {
    face: { eyeShape: 2 },
    body: { shape: 1, length: 2, girth: 2 }, legs: { foot: 2, length: 5 }, head: { skull: 1, neckLength: 5 },
    snout: { type: 1, reach: 3 }, ears: { type: 1, scale: 1, dir: 1 }, antennae: { type: 1, length: 0, dir: 1 },
    tail: { type: 1, length: 2, dir: 1 }, crest: { type: 2, scale: 0 }, coat: { pattern: 2 }, palette: { index: 2 },
  } },
  { id: 'horse', name: 'Koń', genes: {
    face: { eyeShape: 2 },
    body: { shape: 1, length: 4, girth: 2 }, legs: { foot: 2, length: 4 }, head: { skull: 1, neckLength: 4 },
    snout: { type: 1, reach: 4 }, ears: { type: 1, scale: 1, dir: 0 }, crest: { type: 2, scale: 3 },
    tail: { type: 2, length: 4, dir: 1 }, palette: { index: 9 },
  } },
  { id: 'deer', name: 'Jeleń', genes: {
    face: { eyeShape: 2 },
    body: { shape: 1, length: 3, girth: 2 }, legs: { foot: 2, length: 4 }, head: { skull: 1, neckLength: 3 },
    snout: { type: 1, reach: 3 }, ears: { type: 1, scale: 2, dir: 1 }, horns: { type: 4, span: 4, dir: 0 },
    tail: { type: 1, length: 0, dir: 0 }, coat: { pattern: 2 }, palette: { index: 4 },
  } },
  { id: 'lion', name: 'Lew', genes: {
    body: { shape: 2, length: 4, girth: 3 }, build: { type: 2 }, legs: { foot: 1, length: 3 }, head: { skull: 2, neckLength: 1 },
    snout: { type: 3, reach: 2 }, ears: { type: 2, scale: 1, dir: 0 }, crest: { type: 2, scale: 5 },
    tail: { type: 1, length: 5, dir: 1 }, face: { teeth: 1, whiskers: 1, eyeShape: 1 }, coat: { texture: 1 }, palette: { index: 2 },
  } },
  { id: 'fox', name: 'Lis', genes: {
    body: { shape: 3, length: 3, girth: 1 }, legs: { foot: 0, length: 2 }, head: { skull: 1, neckLength: 1 },
    snout: { type: 1, reach: 5 }, ears: { type: 1, scale: 5, dir: 0 }, tail: { type: 2, length: 5, dir: 1 },
    face: { whiskers: 1, expression: 1, eyeShape: 1 }, coat: { texture: 1 }, palette: { index: 6 },
  } },
  { id: 'rabbit', name: 'Królik', genes: {
    body: { shape: 0, length: 1, girth: 4 }, build: { type: 3 }, legs: { foot: 0, length: 1 }, head: { skull: 0, neckLength: 0 },
    snout: { type: 0, reach: 0 }, ears: { type: 3, scale: 5, dir: 0 }, tail: { type: 2, length: 0, dir: 0 },
    face: { eyes: 2, whiskers: 1, eyeShape: 2 }, coat: { texture: 1 }, palette: { index: 0 },
  } },
  { id: 'mouse', name: 'Mysz', genes: {
    body: { shape: 0, length: 2, girth: 2 }, legs: { foot: 1, length: 0 }, head: { skull: 1, neckLength: 0 },
    snout: { type: 1, reach: 2 }, ears: { type: 2, scale: 5, dir: 0 }, tail: { type: 1, length: 5, dir: 1 },
    face: { eyes: 2, whiskers: 2, eyeShape: 2 }, palette: { index: 8 },
  } },
  { id: 'bear', name: 'Niedźwiedź', genes: {
    face: { eyeShape: 2 },
    body: { shape: 2, length: 3, girth: 5 }, build: { type: 3 }, legs: { foot: 1, length: 1 }, head: { skull: 0, neckLength: 0 },
    snout: { type: 0, reach: 3 }, ears: { type: 2, scale: 2, dir: 0 }, tail: { type: 2, length: 0, dir: 0 },
    coat: { texture: 1 }, palette: { index: 10 },
  } },
  { id: 'dragon', name: 'Smok', genes: {
    body: { shape: 2, length: 4, girth: 3 }, build: { type: 2 }, legs: { foot: 1, length: 3 }, head: { skull: 1, neckLength: 3 },
    snout: { type: 1, reach: 4 }, ears: { type: 0 }, horns: { type: 1, span: 3, dir: 2 }, wings: { type: 2, scale: 4 },
    crest: { type: 3, scale: 3 }, tail: { type: 1, length: 5, dir: 1 }, face: { teeth: 1, expression: 2, eyeShape: 1 },
    coat: { texture: 2 }, palette: { index: 11 },
  } },
  { id: 'monkey', name: 'Małpa', genes: {
    plan: { type: 1 }, body: { shape: 1, length: 2, girth: 2 }, legs: { foot: 0, length: 2 }, head: { skull: 0, neckLength: 0 },
    snout: { type: 0, reach: 1 }, ears: { type: 2, scale: 3, dir: 0 }, tail: { type: 1, length: 5, dir: 0 },
    hands: { type: 1, length: 5, dir: 0 }, face: { eyes: 2, expression: 1, eyeShape: 2 }, coat: { texture: 1 }, palette: { index: 6 },
  } },
  { id: 'kangaroo', name: 'Kangur', genes: {
    face: { eyeShape: 2 },
    plan: { type: 1 }, body: { shape: 0, length: 3, girth: 3 }, legs: { foot: 0, length: 4 }, head: { skull: 1, neckLength: 1 },
    snout: { type: 1, reach: 2 }, ears: { type: 1, scale: 4, dir: 0 }, tail: { type: 1, length: 5, dir: 1 },
    hands: { type: 3, length: 1, dir: 0 }, palette: { index: 2 },
  } },
  { id: 'mantis', name: 'Modliszka', genes: {
    plan: { type: 3 }, build: { type: 1 }, body: { shape: 1, length: 4, girth: 1 }, legs: { foot: 1, length: 3 }, ears: { type: 0 },
    tail: { type: 0 }, snout: { type: 0, reach: 0 }, face: { eyes: 2 }, antennae: { type: 1, length: 4, dir: 0 },
    hands: { type: 2, length: 4, dir: 1 }, palette: { index: 5 },
  } },
  { id: 'fish', name: 'Ryba', genes: {
    plan: { type: 4 }, body: { shape: 0, length: 3, girth: 4 }, snout: { type: 0, reach: 1 }, ears: { type: 0 },
    tail: { type: 3, length: 3, dir: 1 }, face: { eyes: 2 }, coat: { texture: 2, pattern: 1 }, stand: { type: 1 }, palette: { index: 12 },
  } },
  { id: 'octopus', name: 'Ośmiornica', genes: {
    plan: { type: 5 }, body: { shape: 0, length: 3, girth: 5 }, legs: { length: 3 }, ears: { type: 0 }, tail: { type: 0 },
    snout: { type: 0, reach: 0 }, face: { eyes: 2, expression: 1 }, coat: { pattern: 2 }, palette: { index: 4 },
  } },
  { id: 'beetle', name: 'Żuk', genes: {
    plan: { type: 3 }, body: { shape: 2, length: 3, girth: 3 }, legs: { foot: 1, length: 2 }, ears: { type: 0 }, tail: { type: 0 },
    snout: { type: 0, reach: 0 }, horns: { type: 3, span: 3, dir: 1 }, antennae: { type: 1, length: 3, dir: 0 },
    coat: { texture: 3 }, palette: { index: 14 },
  } },
  { id: 'caterpillar', name: 'Gąsienica', genes: {
    plan: { type: 2 }, body: { shape: 0, length: 5, girth: 2 }, legs: { length: 1 }, ears: { type: 0 }, tail: { type: 0 },
    snout: { type: 0, reach: 0 }, antennae: { type: 1, length: 2, dir: 1 }, face: { eyes: 2, expression: 1 },
    coat: { pattern: 2 }, palette: { index: 15 },
  } },
];

/** The preset's full genome (default creature plus its genes, canonical). */
export function presetGenome(p: Preset): MorphotypeGenome {
  const g = defaultGenome();
  for (const [block, fields] of Object.entries(p.genes)) Object.assign(g[block as BlockId]!, fields);
  return canonicalize(g);
}
