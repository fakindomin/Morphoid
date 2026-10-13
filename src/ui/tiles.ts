import type { BlockId } from '../core';

export interface TileField { block: BlockId; field: string; label: string; /** not drawn in 2D/3D yet: shown disabled */ planned?: boolean }
export interface TileDef { id: string; title: string; fields: TileField[]; palette?: boolean }

/** Left column: anatomical stack from the spec (1-7) plus the remaining genome blocks. */
export const TILES: TileDef[] = [
  { id: 'head', title: '1. Głowa & Pysk', fields: [
    { block: 'head', field: 'skull', label: 'Kształt czaszki' },
    { block: 'snout', field: 'type', label: 'Kształt pyska' },
    { block: 'snout', field: 'reach', label: 'Wysunięcie pyska' },
    { block: 'ears', field: 'type', label: 'Kształt uszu' },
    { block: 'ears', field: 'scale', label: 'Wielkość uszu' },
    { block: 'face', field: 'eyes', label: 'Wielkość oczu' },
  ] },
  { id: 'horns', title: '2. Rogi', fields: [
    { block: 'horns', field: 'type', label: 'Kształt rogów' },
    { block: 'horns', field: 'span', label: 'Wielkość rogów' },
  ] },
  { id: 'neck', title: '3. Szyja', fields: [
    { block: 'head', field: 'neck', label: 'Fasada szyi' },
    { block: 'head', field: 'neckLength', label: 'Długość szyi' },
  ] },
  { id: 'body', title: '4. Tułów (baza)', fields: [
    { block: 'body', field: 'shape', label: 'Kształt tułowia' },
    { block: 'body', field: 'length', label: 'Długość korpusu' },
    { block: 'body', field: 'girth', label: 'Pękatość tułowia' },
  ] },
  { id: 'wings', title: '5. Skrzydła', fields: [
    { block: 'wings', field: 'type', label: 'Typ skrzydeł' },
    { block: 'wings', field: 'scale', label: 'Rozpiętość' },
  ] },
  { id: 'legs', title: '6. Nogi & Stopy', fields: [
    { block: 'legs', field: 'foot', label: 'Kształt stóp (płaska baza Y=0)' },
    { block: 'legs', field: 'length', label: 'Wysokość nóg' },
  ] },
  { id: 'tail', title: '7. Ogon', fields: [
    { block: 'tail', field: 'type', label: 'Kształt ogona' },
    { block: 'tail', field: 'length', label: 'Wielkość ogona' },
  ] },
  { id: 'crest', title: '8. Czub / Grzywa / Kolce', fields: [
    { block: 'crest', field: 'type', label: 'Rodzaj wyrostków' },
    { block: 'crest', field: 'scale', label: 'Skala wyrostków' },
  ] },
  { id: 'face', title: '9. Detale twarzy', fields: [
    { block: 'face', field: 'teeth', label: 'Zęby' },
    { block: 'face', field: 'whiskers', label: 'Wąsy' },
    { block: 'face', field: 'expression', label: 'Mina' },
  ] },
  { id: 'coat', title: '10. Pokrycie i wzór', fields: [
    { block: 'coat', field: 'texture', label: 'Faktura (wkrótce)', planned: true },
    { block: 'coat', field: 'pattern', label: 'Wzór' },
  ] },
  { id: 'accessory', title: '11. Dodatki', fields: [{ block: 'accessory', field: 'type', label: 'Akcesorium' }] },
  { id: 'palette', title: '12. Paleta barw', fields: [], palette: true },
];

/** Which tile a radial-menu socket highlights. */
export const SOCKET_TILES: Record<string, string[]> = {
  head: ['head', 'horns'], chest: ['neck', 'wings'], tail: ['tail'], legF: ['legs'], legB: ['legs'],
};
