/**
 * Morphotyp schema: the blocks and fields a creature is made of, and the genes (DNA v2) that write them down.
 *
 * Two field kinds:
 *  - 'enum': a discrete variant (index into `options`). Options are only ever APPENDED: an option's position fixes
 *            its stable variant number in the code (see GENES), so reordering or removing one would change old codes.
 *            A variant that should no longer be offered is `retired` (hidden from menus and dice, still drawn).
 *  - 'step': one of STEPS (=2N=6) rigid 3D positions. The 2D size class (N=3)
 *            is derived: class = floor(step / 2).
 *  - 'fine': a 3D-only adjustment in FINE_LEVELS levels (one hex digit, FINE_ZERO = no change), set by the
 *            deformation sliders. One with `coarse` is the fraction of a step of that size field: stretched past half a
 *            step it carries over into the step itself (and so into the 2D drawing), see codec carryFine.
 */

export const STEPS = 6; // 2N
export const SIZE_CLASSES = 3; // N
/** Levels of a 'fine' field (one hex digit) and the level that changes nothing. */
export const FINE_LEVELS = 16;
export const FINE_ZERO = 8;

export type BlockId =
  | 'body' | 'legs' | 'head' | 'snout' | 'ears' | 'horns' | 'wings'
  | 'tail' | 'crest' | 'face' | 'coat' | 'accessory' | 'palette' | 'build' | 'plan' | 'stand' | 'antennae' | 'hands' | 'sculpt';

export interface EnumOption { id: string; label: string; retired?: boolean }
export interface EnumField {
  kind: 'enum';
  name: string;
  /** Stable ids; index = stored value. Order MUST NOT change once released (append only). */
  options: readonly EnumOption[];
  /** Value used by defaultGenome(). */
  def: number;
  /** What the field sets, when it is written as a digit after a gene's sizes (default: "Kierunek"). */
  label?: string;
}
export interface StepField {
  kind: 'step';
  name: string;
  label: string;
}
export interface FineField {
  kind: 'fine';
  name: string;
  label: string;
  /** the step field this one fine-tunes (its value is a fraction of one of that field's steps) */
  coarse?: { block: BlockId; field: string };
}
export type Field = EnumField | StepField | FineField;

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

const e = (name: string, opts: [string, string][], def = 0, label?: string): EnumField =>
  ({ kind: 'enum', name, def, options: opts.map(([id, label]) => ({ id, label })), ...(label ? { label } : {}) });
const retire = (f: EnumField, ...ids: string[]): EnumField => ({ ...f, options: f.options.map((o) => (ids.includes(o.id) ? { ...o, retired: true } : o)) });
const s = (name: string, label: string): StepField => ({ kind: 'step', name, label });
const fine = (name: string, label: string, coarse?: FineField['coarse']): FineField => ({ kind: 'fine', name, label, ...(coarse ? { coarse } : {}) });

export const BLOCKS: readonly BlockDef[] = [
  { id: 'body', letter: 'B', label: 'Tułów', fields: [
    e('shape', [['barrel', 'Beczka'], ['lean', 'Smukły'], ['bulky', 'Masywny'], ['athletic', 'Zwierzęcy (głęboka klatka)']]),
    s('length', 'Długość'), s('girth', 'Pękatość'),
  ] },
  { id: 'legs', letter: 'L', label: 'Nogi', fields: [
    e('foot', [['paw', 'Łapa'], ['claws', 'Pazury'], ['hoof', 'Kopyto'], ['catpaw', 'Kocia łapka'], ['bearpaw', 'Niedźwiedzia łapa'], ['webbed', 'Płetwiasta'], ['cloven', 'Racica'], ['hand', 'Dłoń małpy']]),
    s('length', 'Wysokość'),
  ] },
  { id: 'head', letter: 'H', label: 'Głowa i szyja', fields: [
    e('skull', [['round', 'Okrągła'], ['wedge', 'Klin'], ['flat', 'Płaska']]),
    e('neck', [['smooth', 'Gładka'], ['crested', 'Grzebień'], ['armored', 'Pancerz']]),
    s('neckLength', 'Długość szyi'),
  ] },
  { id: 'snout', letter: 'S', label: 'Pysk', fields: [
    e('type', [['pug', 'Krótki'], ['wolf', 'Wilczy'], ['beak', 'Dziób'], ['cat', 'Koci'], ['dog', 'Psi'], ['horse', 'Koński'], ['bear', 'Niedźwiedzi'], ['rodent', 'Gryzonia'], ['ape', 'Małpi'], ['macaque', 'Makaka']], 1),
    s('reach', 'Wysunięcie'),
  ] },
  { id: 'ears', letter: 'E', label: 'Uszy', noneMeansEmpty: true, fields: [
    e('type', [['none', 'Brak'], ['wolf', 'Wilcze'], ['bear', 'Misiowe'], ['rabbit', 'Zajęcze'], ['floppy', 'Opadające'], ['cat', 'Kocie'], ['mouse', 'Mysie'], ['horse', 'Końskie']], 1),
    s('scale', 'Skala'),
    e('dir', [['up', 'Do góry'], ['back', 'Do tyłu'], ['forward', 'Do przodu']]),
  ] },
  { id: 'horns', letter: 'O', label: 'Rogi / Poroże', noneMeansEmpty: true, fields: [
    e('type', [['none', 'Brak'], ['devil', 'Diabelskie'], ['ram', 'Baranie'], ['spikes', 'Kolce'], ['antlers', 'Poroże']]),
    s('span', 'Rozpiętość'),
    e('dir', [['up', 'Do góry'], ['forward', 'Do przodu'], ['back', 'Do tyłu']]),
  ] },
  { id: 'wings', letter: 'W', label: 'Skrzydła', noneMeansEmpty: true, fields: [
    e('type', [['none', 'Brak'], ['feather', 'Pierzaste'], ['bat', 'Nietoperze']]),
    s('scale', 'Wielkość'),
  ] },
  { id: 'tail', letter: 'T', label: 'Ogon', noneMeansEmpty: true, fields: [
    e('type', [['none', 'Brak'], ['wolf', 'Wilczy'], ['fluffy', 'Puszysty'], ['fan', 'Wachlarz'], ['feathers', 'Pióra ptaka']], 1),
    s('length', 'Długość'),
    e('dir', [['up', 'Naturalnie'], ['back', 'Do tyłu'], ['high', 'W górę']]),
  ] },
  { id: 'crest', letter: 'C', label: 'Czub / Grzywa / Kolce', noneMeansEmpty: true, fields: [
    e('type', [['none', 'Brak'], ['tuft', 'Czub'], ['mane', 'Grzywa'], ['spines', 'Kolce'], ['crystals', 'Kryształy'], ['plume', 'Pióropusz']]),
    s('scale', 'Skala'),
  ] },
  { id: 'face', letter: 'D', label: 'Detale pyska', fields: [
    e('eyes', [['small', 'Małe'], ['normal', 'Zwykłe'], ['big', 'Duże'], ['many', 'Wiele małych'], ['stalks', 'Na szypułkach']], 1),
    e('teeth', [['none', 'Brak'], ['fangs', 'Kły'], ['row', 'Rząd']]),
    e('whiskers', [['none', 'Brak'], ['short', 'Krótkie'], ['long', 'Długie']]),
    e('whiskerDir', [['side', 'Na boki'], ['forward', 'Skośnie do przodu'], ['back', 'Skośnie do tyłu']]),
    e('expression', [['calm', 'Spokojna'], ['grin', 'Uśmiech'], ['angry', 'Zła']]),
    e('eyeSet', [['bulging', 'Wyłupiaste'], ['deep', 'Osadzone głębiej']], 0, 'Osadzenie'),
    e('eyeShape', [['round', 'Okrągłe'], ['almond', 'Kocie (migdałowe)'], ['animal', 'Zwierzęce (ciemne)'], ['sleepy', 'Senne (przymknięte)'], ['reptile', 'Gadzie (wąska źrenica)'], ['goat', 'Kozie (pozioma źrenica)']], 0, 'Kształt'),
  ] },
  { id: 'coat', letter: 'K', label: 'Pokrycie i wzór', fields: [
    e('texture', [['smooth', 'Gładkie'], ['fur', 'Futro'], ['scales', 'Łuski'], ['armor', 'Pancerz']]),
    e('pattern', [['none', 'Brak'], ['stripes', 'Pręgi'], ['spots', 'Cętki'], ['glow', 'Świecące plamy']]),
  ] },
  { id: 'accessory', letter: 'X', label: 'Dodatki', noneMeansEmpty: true, fields: [
    // accessories are off the menu for now (user, 2026-10-15): old codes still draw them, the dice never pick them
    retire(e('type', [['none', 'Brak'], ['collar', 'Obroża'], ['saddle', 'Siodło']]), 'collar', 'saddle'),
  ] },
  { id: 'palette', letter: 'P', label: 'Paleta barw', fields: [
    { kind: 'enum', name: 'index', def: 0,
      options: Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, label: `Triada ${i + 1}` })) },
  ] },
  { id: 'build', letter: 'J', label: 'Budowa', fields: [
    e('type', [['normal', 'Normalna'], ['stick', 'Patyk'], ['muscular', 'Umięśniona'], ['round', 'Kulista'], ['skeletal', 'Szkieletowa']]),
  ] },
  { id: 'plan', letter: 'Y', label: 'Plan ciała', fields: [
    e('type', [['quadruped', 'Czworonóg'], ['biped', 'Dwunóg / ptak'], ['caterpillar', 'Gąsienica'], ['insect', 'Owad (6 nóg)'], ['fish', 'Ryba'], ['octopus', 'Ośmiornica'], ['humanoid', 'Człekokształtny']]),
  ] },
  { id: 'stand', letter: 'Q', label: 'Podstawka', noneMeansEmpty: true, fields: [
    e('type', [['none', 'Brak'], ['round', 'Okrągła'], ['stone', 'Kamień']]),
  ] },
  { id: 'antennae', letter: 'I', label: 'Czułki', noneMeansEmpty: true, fields: [
    e('type', [['none', 'Brak'], ['ball', 'Z kulką'], ['feather', 'Pierzaste']]),
    s('length', 'Długość'),
    e('dir', [['forward', 'Do przodu'], ['up', 'Prosto w górę'], ['back', 'Do tyłu']]),
  ] },
  { id: 'hands', letter: 'G', label: 'Ręce', noneMeansEmpty: true, fields: [
    e('type', [['none', 'Brak'], ['grip', 'Chwytne dłonie'], ['talons', 'Szpony'], ['mitts', 'Łapki']]),
    s('length', 'Długość'),
    e('dir', [['hold', 'Przed sobą'], ['raise', 'Uniesione'], ['down', 'Opuszczone']], 0, 'Ułożenie'),
  ] },
  { id: 'sculpt', letter: 'I', label: 'Deformacja', fields: [
    fine('length', 'Długość tułowia', { block: 'body', field: 'length' }),
    fine('girth', 'Wysokość tułowia', { block: 'body', field: 'girth' }),
    fine('width', 'Szerokość tułowia'),
    fine('chest', 'Głębokość klatki'),
    fine('waist', 'Talia'),
    fine('haunch', 'Zad i uda'),
    fine('shoulder', 'Łopatki'),
    fine('neckLength', 'Długość szyi', { block: 'head', field: 'neckLength' }),
    fine('neckThick', 'Grubość szyi'),
  ] },
] as const;

/**
 * DNA v2 genes, in code order. A gene is one visible part: a letter, a stable variant number (2 hex digits) and, for
 * parts that have a size, one digit 1-6 per size field (0 when the part is absent). A direction (where an element points) is
 * one more digit after the sizes, 1 = the original direction; a code written before directions existed has no such
 * digit and reads as the original direction. Every gene is always written, so
 * every code has the same length and two codes compare character by character.
 *
 * Variant numbers: an enum whose first option is "none" uses the option index (00 = none); one without "none" starts
 * at 01 (00 never appears). The palette is numbered from 00. New genes are only appended (a code without them reads
 * them as 00); new variants are only appended to a field's options.
 */
export interface GeneDef {
  letter: string;
  label: string;
  /** where the variant lives; null = a part that has no variants yet (always 00) */
  variant: { block: BlockId; field: string } | null;
  /** step fields written as size digits, in order */
  sizes: readonly { block: BlockId; field: string }[];
}
const gene = (letter: string, label: string, block: BlockId | null, field = 'type', ...sizes: string[]): GeneDef => ({
  letter, label, variant: block ? { block, field } : null, sizes: sizes.map((f) => ({ block: block!, field: f })),
});
export const GENES: readonly GeneDef[] = [
  gene('B', 'Tułów', 'body', 'shape', 'length', 'girth'),
  gene('L', 'Nogi', 'legs', 'foot', 'length'),
  gene('N', 'Szyja', 'head', 'neck', 'neckLength'),
  gene('H', 'Czaszka', 'head', 'skull'),
  gene('S', 'Pysk', 'snout', 'type', 'reach'),
  gene('E', 'Uszy', 'ears', 'type', 'scale', 'dir'),
  gene('R', 'Rogi', 'horns', 'type', 'span', 'dir'),
  gene('W', 'Skrzydła', 'wings', 'type', 'scale'),
  gene('T', 'Ogon', 'tail', 'type', 'length', 'dir'),
  gene('U', 'Końcówka ogona', null),
  gene('C', 'Grzywa / czub / kolce', 'crest', 'type', 'scale'),
  gene('O', 'Oczy', 'face', 'eyes', 'eyeSet', 'eyeShape'),
  gene('M', 'Mina', 'face', 'expression'),
  gene('Z', 'Zęby', 'face', 'teeth'),
  gene('V', 'Wąsy', 'face', 'whiskers', 'whiskerDir'),
  gene('F', 'Faktura', 'coat', 'texture'),
  gene('D', 'Deseń', 'coat', 'pattern'),
  gene('A', 'Dodatek na ciało', 'accessory', 'type'),
  gene('G', 'Dodatek na głowę', null),
  gene('P', 'Paleta', 'palette', 'index'),
  gene('J', 'Budowa', 'build', 'type'),
  gene('Y', 'Plan ciała', 'plan', 'type'),
  gene('Q', 'Podstawka', 'stand', 'type'),
  gene('K', 'Czułki', 'antennae', 'type', 'length', 'dir'),
  gene('X', 'Ręce', 'hands', 'type', 'length', 'dir'),
  // deformation sliders (3D view): one hex digit per slider, 8 = unchanged; no variant (always 00)
  { letter: 'I', label: 'Deformacja', variant: null, sizes: ['length', 'girth', 'width', 'chest', 'waist', 'haunch', 'shoulder', 'neckLength', 'neckThick'].map((field) => ({ block: 'sculpt' as BlockId, field })) },
];

export const PREFIX = 'MPH2';

export const blockDef = (id: BlockId): BlockDef => {
  const b = BLOCKS.find((x) => x.id === id);
  if (!b) throw new Error(`unknown block ${id}`);
  return b;
};
