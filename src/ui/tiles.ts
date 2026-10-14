import type { BlockId } from '../core';

export interface TileField { block: BlockId; field: string; label: string; /** not drawn in 2D/3D yet: shown disabled */ planned?: boolean }
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
      { block: 'face', field: 'eyes', label: 'Oczy' },
    ] },
    { id: 'snout', title: 'Pysk', fields: [
      { block: 'snout', field: 'type', label: 'Kształt pyska' },
      { block: 'snout', field: 'reach', label: 'Wysunięcie pyska' },
      { block: 'face', field: 'expression', label: 'Mina' },
      { block: 'face', field: 'teeth', label: 'Zęby' },
      { block: 'face', field: 'whiskers', label: 'Wąsy' },
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
      { block: 'crest', field: 'scale', label: 'Skala wyrostków' },
    ] },
    { id: 'neck', title: 'Szyja', fields: [
      { block: 'head', field: 'neck', label: 'Fasada szyi' },
      { block: 'head', field: 'neckLength', label: 'Długość szyi' },
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
    ] },
    { id: 'legs', title: 'Nogi i stopy', fields: [
      { block: 'legs', field: 'foot', label: 'Kształt stóp (płaska baza Y=0)' },
      { block: 'legs', field: 'length', label: 'Wysokość nóg' },
    ] },
    { id: 'tail', title: 'Ogon', fields: [
      { block: 'tail', field: 'type', label: 'Kształt ogona' },
      { block: 'tail', field: 'length', label: 'Wielkość ogona' },
      { block: 'tail', field: 'dir', label: 'Kierunek ogona' },
    ] },
  ] },
  { title: 'Wygląd i dodatki', tiles: [
    { id: 'palette', title: 'Kolory', fields: [], palette: true },
    { id: 'coat', title: 'Wzór', fields: [
      { block: 'coat', field: 'pattern', label: 'Wzór' },
      { block: 'coat', field: 'texture', label: 'Faktura' },
    ] },
    { id: 'accessory', title: 'Dodatki', fields: [{ block: 'accessory', field: 'type', label: 'Akcesorium' }] },
    { id: 'stand', title: 'Podstawka', fields: [{ block: 'stand', field: 'type', label: 'Podstawka (osobny wydruk)' }] },
  ] },
];

export const TILES: TileDef[] = TILE_GROUPS.flatMap((g) => g.tiles);

/** Which category a click on a part of the sketch (its radial-menu socket) opens. */
export const SOCKET_TILE: Record<string, string> = { head: 'head', chest: 'neck', tail: 'tail', legF: 'legs', legB: 'legs' };
