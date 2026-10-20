import type { BlockId } from '../core';

export interface TileField {
  block: BlockId; field: string; label: string;
  /** not drawn in 2D/3D yet: shown disabled */
  planned?: boolean;
  /** the options in this order (by index) instead of the gene's */
  order?: number[];
  /**
   * 'mouth': a closed / open switch over the teeth gene (an open Pysk always shows teeth); 'legCount': how many legs,
   * shown as the real number (the plan's own when the gene says so); 'rightArm': the right arm's pose, shown as the
   * pose it really has (the left one's when the gene says "the same")
   */
  control?: 'mouth' | 'legCount' | 'rightArm';
}
export interface TileDef { id: string; title: string; fields: TileField[]; palette?: boolean }
export interface TileGroup { title: string; tiles: TileDef[] }

/**
 * Left column: the creature from head to tail, then what is not a body part. Every category starts closed; its header
 * shows the current choice of its first field.
 */
export const TILE_GROUPS: TileGroup[] = [
  { title: 'Od głowy po ogon', tiles: [
    { id: 'head', title: 'Głowa', fields: [
      { block: 'head', field: 'skull', label: 'Kształt czaszki' },
      { block: 'head', field: 'size', label: 'Wielkość głowy' },
      { block: 'face', field: 'eyes', label: 'Oczy' },
      { block: 'face', field: 'eyeSize', label: 'Wielkość oczu' },
      { block: 'face', field: 'eyeSet', label: 'Osadzenie oczu' },
      { block: 'face', field: 'eyeShape', label: 'Kształt oczu' },
    ] },
    { id: 'snout', title: 'Pysk', fields: [
      { block: 'snout', field: 'type', label: 'Kształt pyska' },
      { block: 'snout', field: 'reach', label: 'Wysunięcie pyska' },
      { block: 'face', field: 'expression', label: 'Mina' },
      { block: 'face', field: 'teeth', label: 'Pysk', control: 'mouth' },
      { block: 'face', field: 'teeth', label: 'Zęby' },
      { block: 'face', field: 'whiskers', label: 'Wąsy' },
      { block: 'face', field: 'whiskerSize', label: 'Długość wąsów' },
      { block: 'face', field: 'whiskerDir', label: 'Kierunek wąsów' },
    ] },
    { id: 'ears', title: 'Uszy', fields: [
      { block: 'ears', field: 'type', label: 'Kształt uszu' },
      { block: 'ears', field: 'scale', label: 'Wielkość uszu' },
      { block: 'ears', field: 'dir', label: 'Kierunek uszu' },
    ] },
    { id: 'horns', title: 'Rogi i czułki', fields: [
      { block: 'horns', field: 'type', label: 'Kształt rogów' },
      { block: 'horns', field: 'span', label: 'Wielkość rogów' },
      { block: 'horns', field: 'dir', label: 'Kierunek rogów' },
      { block: 'antennae', field: 'type', label: 'Czułki' },
      { block: 'antennae', field: 'length', label: 'Długość czułków' },
      { block: 'antennae', field: 'dir', label: 'Kierunek czułków' },
    ] },
    { id: 'crest', title: 'Czub, grzywa, kolce', fields: [
      { block: 'crest', field: 'type', label: 'Rodzaj wyrostków' },
      { block: 'crest', field: 'scale', label: 'Wielkość wyrostków' },
    ] },
    { id: 'neck', title: 'Szyja', fields: [
      { block: 'head', field: 'neckLength', label: 'Długość szyi' },
      { block: 'head', field: 'neckThick', label: 'Grubość szyi' },
    ] },
    { id: 'body', title: 'Tułów', fields: [
      { block: 'plan', field: 'type', label: 'Plan ciała' },
      { block: 'build', field: 'type', label: 'Budowa ciała' },
      { block: 'body', field: 'shape', label: 'Kształt tułowia' },
      { block: 'body', field: 'length', label: 'Długość korpusu' },
      { block: 'body', field: 'girth', label: 'Pękatość tułowia' },
    ] },
    { id: 'wings', title: 'Skrzydła', fields: [
      { block: 'wings', field: 'type', label: 'Typ skrzydeł' },
      { block: 'wings', field: 'scale', label: 'Rozpiętość' },
      { block: 'wings', field: 'spread', label: 'Rozłożenie skrzydeł' },
    ] },
    { id: 'legs', title: 'Nogi i stopy', fields: [
      { block: 'legs', field: 'count', label: 'Liczba nóg', control: 'legCount' },
      { block: 'legs', field: 'foot', label: 'Kształt stóp (płaska baza Y=0)' },
      { block: 'legs', field: 'length', label: 'Wysokość nóg' },
      { block: 'legs', field: 'thick', label: 'Grubość nóg' },
    ] },
    { id: 'hands', title: 'Ręce', fields: [
      { block: 'hands', field: 'type', label: 'Dłonie' },
      { block: 'hands', field: 'length', label: 'Długość rąk' },
      { block: 'hands', field: 'thick', label: 'Grubość rąk' },
      { block: 'hands', field: 'dir', label: 'Lewa ręka' },
      { block: 'hands', field: 'dir2', label: 'Prawa ręka', control: 'rightArm' },
    ] },
    { id: 'tail', title: 'Ogon', fields: [
      { block: 'tail', field: 'type', label: 'Kształt ogona' },
      { block: 'tail', field: 'length', label: 'Wielkość ogona' },
      { block: 'tail', field: 'dir', label: 'Kierunek ogona', order: [0, 2, 1] },
    ] },
  ] },
  { title: 'Wygląd i dodatki', tiles: [
    { id: 'palette', title: 'Kolory', fields: [], palette: true },
    { id: 'coat', title: 'Wzór', fields: [
      { block: 'coat', field: 'pattern', label: 'Wzór' },
      { block: 'coat', field: 'patternSize', label: 'Wielkość wzoru' },
      { block: 'coat', field: 'texture', label: 'Faktura' },
    ] },
    { id: 'stand', title: 'Podstawka', fields: [{ block: 'stand', field: 'type', label: 'Podstawka (osobny wydruk)' }] },
  ] },
];

export const TILES: TileDef[] = TILE_GROUPS.flatMap((g) => g.tiles);

/** Which category a click on a part of the sketch (its radial-menu socket) opens. */
export const SOCKET_TILE: Record<string, string> = { head: 'head', chest: 'neck', tail: 'tail', legF: 'legs', legB: 'legs' };

/**
 * Which category a part of the sketch belongs to: hovering it lights up the whole body element, clicking it opens that
 * category in the left column.
 */
export const SLOT_TILE: Partial<Record<string, string>> = {
  head: 'head', eye: 'head', iris: 'head', pupil: 'head', glint: 'head', lids: 'head', brow: 'head', stalks: 'head',
  snout: 'snout', nose: 'snout', nostrils: 'snout', maw: 'snout', tongue: 'snout', mouth: 'snout', lips: 'snout', teeth: 'snout', whiskers: 'snout',
  ear: 'ears', earIn: 'ears', earFlop: 'ears',
  horns: 'horns', antennae: 'horns',
  mane: 'crest', tuft: 'crest', spines: 'crest',
  neck: 'neck', neckDecor: 'neck',
  torso: 'body', pattern: 'body', finD: 'body', finP: 'body', arms: 'body',
  wingNear: 'wings', wingFar: 'wings', wingRibs: 'wings',
  legB: 'legs', legF: 'legs', legBFar: 'legs', legFFar: 'legs', claws: 'legs', toes: 'legs', legOver0: 'legs', legOver1: 'legs', legOver2: 'legs', legOver3: 'legs',
  hands: 'hands', handsFar: 'hands',
  tail: 'tail',
  collar: 'body', saddle: 'body',
  stand: 'stand',
};
