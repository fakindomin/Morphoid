/**
 * Morphotyp schema: the single declarative description of the 13-byte genome.
 *
 * Every block is exactly one byte. Fields are packed MSB-first inside the byte;
 * unused low bits are reserved (always 0). Field widths are FIXED forever for a
 * given schema - adding variants is free until a field's capacity (2^bits) is
 * reached, which keeps old codes valid.
 *
 * Two field kinds:
 *  - 'enum': a discrete variant (index into `options`).
 *  - 'step': one of STEPS (=2N=6) rigid 3D positions. The 2D size class (N=3)
 *            is derived: class = floor(step / 2).
 */

export const STEPS = 6; // 2N
export const SIZE_CLASSES = 3; // N

export type BlockId =
  | 'body' | 'legs' | 'head' | 'snout' | 'ears' | 'horns' | 'wings'
  | 'tail' | 'crest' | 'face' | 'coat' | 'accessory' | 'palette';

export interface EnumField {
  kind: 'enum';
  name: string;
  bits: number;
  /** Stable ids; index = stored value. Order MUST NOT change once released. */
  options: readonly { id: string; label: string }[];
  /** Value used by defaultGenome(). */
  def: number;
}
export interface StepField {
  kind: 'step';
  name: string;
  bits: number;
  label: string;
}
export type Field = EnumField | StepField;

export interface BlockDef {
  id: BlockId;
  letter: string;
  label: string;
  fields: readonly Field[];
  /**
   * If true and the first field is an enum whose option 0 is 'none', then
   * type 'none' forces every other field to 0 (canonical form: one phenotype
   * = one code).
   */
  noneMeansEmpty?: boolean;
}

const e = (name: string, bits: number, opts: [string, string][], def = 0): EnumField => {
  if (opts.length > 2 ** bits) throw new Error(`enum ${name}: ${opts.length} options > 2^${bits}`);
  return { kind: 'enum', name, bits, def, options: opts.map(([id, label]) => ({ id, label })) };
};
const s = (name: string, label: string): StepField => ({ kind: 'step', name, bits: 3, label });

export const BLOCKS: readonly BlockDef[] = [
  { id: 'body', letter: 'B', label: 'Tułów', fields: [
    e('shape', 2, [['barrel', 'Beczka'], ['lean', 'Smukły'], ['bulky', 'Masywny']]),
    s('length', 'Długość'), s('girth', 'Pękatość'),
  ] },
  { id: 'legs', letter: 'L', label: 'Nogi', fields: [
    e('count', 1, [['four', '4 nogi'], ['two', '2 nogi']]),
    e('foot', 2, [['paw', 'Łapa'], ['claws', 'Pazury'], ['hoof', 'Kopyto']]),
    s('length', 'Wysokość'),
  ] },
  { id: 'head', letter: 'H', label: 'Głowa i szyja', fields: [
    e('skull', 3, [['round', 'Okrągła'], ['wedge', 'Klin'], ['flat', 'Płaska']]),
    e('neck', 2, [['smooth', 'Gładka'], ['crested', 'Grzebień'], ['armored', 'Pancerz']]),
    s('neckLength', 'Długość szyi'),
  ] },
  { id: 'snout', letter: 'S', label: 'Pysk', fields: [
    e('type', 2, [['pug', 'Krótki'], ['wolf', 'Wilczy'], ['beak', 'Dziób']], 1),
    s('reach', 'Wysunięcie'),
  ] },
  { id: 'ears', letter: 'E', label: 'Uszy', noneMeansEmpty: true, fields: [
    e('type', 3, [['none', 'Brak'], ['wolf', 'Wilcze'], ['bear', 'Misiowe'], ['rabbit', 'Zajęcze']], 1),
    s('scale', 'Skala'),
  ] },
  { id: 'horns', letter: 'O', label: 'Rogi / Poroże', noneMeansEmpty: true, fields: [
    e('type', 3, [['none', 'Brak'], ['devil', 'Diabelskie'], ['ram', 'Baranie'], ['spikes', 'Kolce'], ['antlers', 'Poroże']]),
    s('span', 'Rozpiętość'),
  ] },
  { id: 'wings', letter: 'W', label: 'Skrzydła', noneMeansEmpty: true, fields: [
    e('type', 2, [['none', 'Brak'], ['feather', 'Pierzaste'], ['bat', 'Nietoperze']]),
    s('scale', 'Wielkość'),
  ] },
  { id: 'tail', letter: 'T', label: 'Ogon', noneMeansEmpty: true, fields: [
    e('type', 2, [['none', 'Brak'], ['wolf', 'Wilczy'], ['fluffy', 'Puszysty'], ['fan', 'Wachlarz']], 1),
    s('length', 'Długość'),
  ] },
  { id: 'crest', letter: 'C', label: 'Czub / Grzywa / Kolce', noneMeansEmpty: true, fields: [
    e('type', 3, [['none', 'Brak'], ['tuft', 'Czub'], ['mane', 'Grzywa'], ['spines', 'Kolce']]),
    s('scale', 'Skala'),
  ] },
  { id: 'face', letter: 'D', label: 'Detale twarzy', fields: [
    e('eyes', 2, [['small', 'Małe'], ['normal', 'Zwykłe'], ['big', 'Duże']], 1),
    e('teeth', 2, [['none', 'Brak'], ['fangs', 'Kły'], ['row', 'Rząd']]),
    e('whiskers', 2, [['none', 'Brak'], ['short', 'Krótkie'], ['long', 'Długie']]),
    e('expression', 2, [['calm', 'Spokojna'], ['grin', 'Uśmiech'], ['angry', 'Zła']]),
  ] },
  { id: 'coat', letter: 'K', label: 'Pokrycie i wzór', fields: [
    e('texture', 3, [['smooth', 'Gładkie'], ['fur', 'Futro'], ['scales', 'Łuski'], ['armor', 'Pancerz']]),
    e('pattern', 3, [['none', 'Brak'], ['stripes', 'Pręgi'], ['spots', 'Cętki']]),
  ] },
  { id: 'accessory', letter: 'X', label: 'Dodatki', noneMeansEmpty: true, fields: [
    e('type', 4, [['none', 'Brak'], ['collar', 'Obroża'], ['saddle', 'Siodło']]),
  ] },
  // Palette: low nibble = index of 1 of 16 color triads. High nibble is the
  // CRC-4 checksum and is handled by the codec, NOT listed as a field here.
  { id: 'palette', letter: 'P', label: 'Paleta barw', fields: [
    { kind: 'enum', name: 'index', bits: 4, def: 0,
      options: Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, label: `Triada ${i + 1}` })) },
  ] },
] as const;

export const BLOCK_COUNT = BLOCKS.length; // 13
export const PREFIX = 'MPH';
export const HEX_LENGTH = BLOCK_COUNT * 2; // 26
export const CODE_LENGTH = PREFIX.length + HEX_LENGTH; // 29

if (BLOCK_COUNT !== 13) throw new Error('Morphotyp must have exactly 13 blocks');

export const blockDef = (id: BlockId): BlockDef => {
  const b = BLOCKS.find((x) => x.id === id);
  if (!b) throw new Error(`unknown block ${id}`);
  return b;
};
