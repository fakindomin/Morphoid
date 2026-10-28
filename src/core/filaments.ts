/**
 * Element colours: each body element can take its own filament colour instead of the palette's. The choice is part
 * of the DNA (the P gene grows two hex digits per element, 00 = the palette's colour), so the colours travel with
 * the code and land in the 3MF as the filaments to load.
 */
import type { ColorKey } from './art/spec3d';

export interface FilamentColor { id: string; label: string; hex: string }

/**
 * Bambu PLA Basic colours, close to the spools. APPEND ONLY: a colour's position is its number in the code
 * (1-based, 0 = the palette's colour).
 */
export const FILAMENT_COLORS: readonly FilamentColor[] = [
  ['white', 'Biały', '#FFFFFF'], ['beige', 'Beżowy', '#F7E6DE'], ['lightGray', 'Jasnoszary', '#D1D3D5'],
  ['yellow', 'Żółty', '#F4EE2A'], ['sunflower', 'Słonecznikowy', '#FEC600'], ['gold', 'Złoty', '#E4BD68'],
  ['pumpkin', 'Dyniowy', '#FF8E16'], ['orange', 'Pomarańczowy', '#FF6A13'], ['red', 'Czerwony', '#C12E1F'],
  ['maroon', 'Bordowy', '#9D2235'], ['pink', 'Różowy', '#F55A74'], ['magenta', 'Magenta', '#EC008C'],
  ['purple', 'Fioletowy', '#5E43B7'], ['indigo', 'Indygo', '#482960'], ['turquoise', 'Turkusowy', '#00B1B7'],
  ['cyan', 'Błękitny', '#0086D6'], ['cobalt', 'Kobaltowy', '#0056B8'], ['blue', 'Granatowy', '#0A2989'],
  ['brightGreen', 'Limonkowy', '#BECF00'], ['green', 'Zielony', '#00AE42'], ['mistletoe', 'Butelkowy', '#3F8E43'],
  ['brown', 'Brązowy', '#9D432C'], ['cocoa', 'Kakaowy', '#6F5034'], ['bronze', 'Oliwkowy', '#847D48'],
  ['silver', 'Srebrny', '#A6A9AA'], ['gray', 'Szary', '#8E9089'], ['blueGray', 'Grafitowy', '#5B6579'],
  ['darkGray', 'Ciemnoszary', '#545454'], ['black', 'Czarny', '#000000'],
].map(([id, label, hex]) => ({ id: id!, label: label!, hex: hex! }));

/**
 * The elements that can take a colour, in the order of their digits in the P gene (append only). `slots` are the
 * drawing slots the colour goes on: their body colour (c1 and its shade) and accent (c2). Eyes colour the iris,
 * the pattern the coat pattern; eye whites, the nose and the mouth keep theirs.
 */
export const COLOR_TARGETS: readonly { id: string; label: string; slots: readonly string[] }[] = [
  { id: 'body', label: 'Tułów', slots: ['torso', 'finD', 'finP', 'arms', 'collar', 'saddle'] },
  { id: 'neck', label: 'Szyja', slots: ['neck', 'neckDecor'] },
  { id: 'head', label: 'Głowa', slots: ['head', 'lids', 'stalks'] },
  { id: 'snout', label: 'Pysk', slots: ['snout', 'lips', 'whiskers'] },
  { id: 'ears', label: 'Uszy', slots: ['ear', 'earFlop'] },
  { id: 'horns', label: 'Rogi i czułki', slots: ['horns', 'antennae'] },
  { id: 'crest', label: 'Czub, grzywa, kolce', slots: ['tuft', 'mane', 'spines'] },
  { id: 'wings', label: 'Skrzydła', slots: ['wingNear', 'wingFar', 'wingRibs'] },
  { id: 'legs', label: 'Nogi i stopy', slots: ['legB', 'legF', 'legBFar', 'legFFar', 'claws', 'toes', 'legOver0', 'legOver1', 'legOver2', 'legOver3'] },
  { id: 'hands', label: 'Ręce', slots: ['hands', 'handsFar'] },
  { id: 'tail', label: 'Ogon', slots: ['tail'] },
  { id: 'eyes', label: 'Tęczówki', slots: ['iris'] },
  { id: 'pattern', label: 'Wzór', slots: ['pattern'] },
  { id: 'stand', label: 'Podstawka', slots: ['stand'] },
];

const TARGET_OF = new Map(COLOR_TARGETS.flatMap((t) => t.slots.map((s) => [s, t.id] as const)));
/** The palette shades an element colour replaces (eye whites, ink and the soft accents of the inner ear stay). */
const TINTED: ReadonlySet<ColorKey> = new Set(['c1', 'c1dark', 'c2', 'c3']);

/** The colour of a drawing element: a palette key or a filament colour picked for its element (hex). */
export type Ink = ColorKey | `#${string}`;
export const isHex = (k: Ink): k is `#${string}` => k.startsWith('#');

/** The element colours a genome picks: target id -> colour number (0 = the palette's). */
export type ElementColors = Readonly<Record<string, number>>;

/** Hex of colour number `n` (1-based), or null for 0 (the palette's) and unknown numbers. */
export const colorHex = (n: number): `#${string}` | null => (FILAMENT_COLORS[n - 1]?.hex as `#${string}` | undefined) ?? null;

/** The ink of slot `slot` drawn in palette key `key` with the element colours `colors`. */
export function inkOf(colors: ElementColors, slot: string, key: ColorKey): Ink {
  const target = TARGET_OF.get(slot);
  if (!target) return key;
  if (target === 'eyes' ? key !== 'c2soft' : target === 'pattern' ? false : !TINTED.has(key)) return key;
  return colorHex(colors[target] ?? 0) ?? key;
}

/** The colour of the coat pattern (slot 'pattern', palette c3). */
export const patternInk = (colors: ElementColors): Ink => colorHex(colors.pattern ?? 0) ?? 'c3';

/** The hex a palette key prints in (its filament: shades of a palette colour print in that colour). */
export function printHex(k: Ink, palette: readonly [string, string, string]): string {
  if (isHex(k)) return k.toUpperCase();
  const [c1, c2, c3] = palette;
  return (k === 'c1' || k === 'c1dark' ? c1 : k === 'c2' || k === 'c2soft' ? c2 : k === 'c3' || k === 'ink' ? c3 : '#FFFFFF').toUpperCase();
}

/** The print key of an ink: one per filament (palette shades fold into their colour). */
export function printKey(k: Ink): Ink {
  if (isHex(k)) return k.toUpperCase() as Ink;
  return k === 'c1dark' ? 'c1' : k === 'c2soft' ? 'c2' : k === 'ink' ? 'c3' : k;
}

// ---------------------------------------------------------------- filaments for a printer

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
/** Perceptual-ish distance (redmean) between two colours. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export interface FilamentPlan {
  /** the filaments to load, in slot order (hex) */
  filaments: string[];
  /** for every input colour, its filament (0-based) */
  slotOf: number[];
  /** colours that had to print in another one's filament: [colour, the filament colour it prints in] */
  merged: [string, string][];
}

/**
 * The filaments for `colors` (hex, in order of importance: the first is the body) on a printer with `slots`
 * filament slots. Equal colours share a slot; when there are more colours than slots, the two closest colours are
 * merged (the less important one prints in the other's filament) until they fit.
 */
export function filamentPlan(colors: readonly string[], slots: number): FilamentPlan {
  const up = colors.map((c) => c.toUpperCase());
  const groups: { hex: string; members: number[] }[] = [];
  up.forEach((c, i) => {
    const g = groups.find((x) => x.hex === c);
    if (g) g.members.push(i); else groups.push({ hex: c, members: [i] });
  });
  const merged: [string, string][] = [];
  while (groups.length > Math.max(1, slots)) {
    let best = Infinity, keep = 0, drop = 1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const d = colorDistance(groups[i]!.hex, groups[j]!.hex);
      if (d < best) { best = d; keep = i; drop = j; }
    }
    const [gone] = groups.splice(drop, 1);
    merged.push([gone!.hex, groups[keep]!.hex]);
    groups[keep]!.members.push(...gone!.members);
  }
  const slotOf = up.map((_, i) => groups.findIndex((g) => g.members.includes(i)));
  return { filaments: groups.map((g) => g.hex), slotOf, merged };
}
