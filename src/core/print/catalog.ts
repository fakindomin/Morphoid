/**
 * Element catalog = the 2D <-> 3D <-> print contract.
 *
 * Rule: every element drawn in the 2D editor must (1) exist in 3D, with a
 * defined volumetric representation, and (2) satisfy PRINT_RULES. Nothing may
 * be added to the art without an entry here; tests/catalog.test.ts fails if a
 * 2D slot or a genome variant has no spec.
 */
import type { BlockId } from '../genome';
import type { SlotId } from '../art/shapes';

export type Repr3D =
  | 'ellipsoid'     // solid of revolution scaled to the rig dimensions
  | 'sweep'         // tapered elliptical sweep along a curve
  | 'plate'         // outline extruded in Z (thickness = PRINT_RULES.plateThickness)
  | 'cone-array'    // row of pointed teeth/spikes, each >= minFeature at the tip
  | 'dome'          // raised relief, height >= reliefHeight
  | 'ridge'         // raised line relief on a surface
  | 'groove'        // engraved relief (also the colour region for AMS/MMU)
  | 'flat-part';    // separate part printed lying flat + peg into a socket

export interface PartSpec {
  id: string;
  blocks: BlockId[];
  /** 2D slots that draw this part */
  slots: SlotId[];
  repr3D: Repr3D;
  /** fused in Monolit; modular export prints it separately with a peg */
  modular: boolean;
  note: string;
}

export const PARTS: readonly PartSpec[] = [
  { id: 'torso', blocks: ['body', 'build', 'plan', 'sculpt'], slots: ['torso'], repr3D: 'ellipsoid', modular: false, note: 'elipsoida L x W x G, baza modelu' },
  { id: 'legs', blocks: ['legs'], slots: ['legB', 'legF', 'legBFar', 'legFFar', 'claws'], repr3D: 'sweep', modular: false,
    note: '4 nogi (druga para = lustro w Z), płaska podeszwa na Y=0, pazury jako klin leżący na stole' },
  { id: 'neck', blocks: ['head', 'sculpt'], slots: ['neck', 'neckDecor'], repr3D: 'sweep', modular: false, note: 'stożek ścięty; grzebień/pancerz jako grzbiety o wysokości 0,8 mm' },
  { id: 'head', blocks: ['head'], slots: ['head'], repr3D: 'ellipsoid', modular: false, note: 'elipsoida czaszki; żadnych sztucznych podpór pod pyskiem' },
  { id: 'snout', blocks: ['snout'], slots: ['snout', 'nose', 'nostrils'], repr3D: 'sweep', modular: false, note: 'zwężająca się kufa; nos jako kopułka z dwoma nozdrzami' },
  { id: 'ears', blocks: ['ears'], slots: ['ear', 'earIn', 'earFlop'], repr3D: 'plate', modular: false, note: 'płytka 1,6 mm; wnętrze jako zagłębienie koloru' },
  { id: 'horns', blocks: ['horns'], slots: ['horns'], repr3D: 'sweep', modular: false, note: 'rogi jako sweep, kąt nawisu <= 45°, czubek >= 1,2 mm' },
  { id: 'antennae', blocks: ['antennae'], slots: ['antennae'], repr3D: 'plate', modular: false, note: 'para czułków 2 mm pochylonych do przodu <= 25°, z kulką albo pierzastym listkiem' },
  { id: 'stalks', blocks: ['face'], slots: ['stalks'], repr3D: 'sweep', modular: false, note: 'szypułki oczu 2,4 mm, oko jako kula na czubku' },
  { id: 'crest', blocks: ['crest'], slots: ['tuft', 'mane', 'spines'], repr3D: 'cone-array', modular: false, note: 'kolce/czub z czubkiem >= 1,2 mm' },
  { id: 'wings', blocks: ['wings'], slots: ['wingNear', 'wingFar'], repr3D: 'plate', modular: true, note: 'płytki 1,6 mm po obu stronach; w trybie modułowym drukowane na płasko z czopem' },
  { id: 'tail', blocks: ['tail'], slots: ['tail'], repr3D: 'sweep', modular: false, note: 'sweep eliptyczny od nasady' },
  { id: 'eyes', blocks: ['face'], slots: ['eye', 'pupil', 'iris', 'lids'], repr3D: 'dome', modular: false, note: 'oko = gałka wystająca z głowy, tęczówka i źrenica = kolor, powieki = wałki nad i pod gałką' },
  { id: 'mouth', blocks: ['face'], slots: ['mouth', 'brow', 'maw', 'tongue', 'lips'], repr3D: 'groove', modular: false, note: 'zamknięte usta: rowek 0,8 x 0,5 mm; otwarte (z zębami): żuchwa opuszczona, wnętrze cofnięte 1,2 mm, język' },
  { id: 'teeth', blocks: ['face'], slots: ['teeth'], repr3D: 'dome', modular: false, note: 'zęby 1,4 mm wzdłuż krawędzi szczęk w otwartym pysku' },
  { id: 'hands', blocks: ['hands'], slots: ['hands', 'handsFar'], repr3D: 'sweep', modular: false, note: 'para rąk z górnej piersi: ramię, przedramię i dłoń z palcami (chwytna, szpony albo łapka), palce >= 1,5 mm' },
  { id: 'arms', blocks: ['plan'], slots: ['arms'], repr3D: 'plate', modular: false, note: 'osiem macek 3,2 mm leżących płasko na stole wokół piasty pod płaszczem (bryła z góry)' },
  { id: 'fins', blocks: ['plan'], slots: ['finD', 'finP'], repr3D: 'plate', modular: false, note: 'płetwy ryby: grzbietowa 2,4 mm, piersiowe 1,6 mm po bokach, spód każdej opada >= 45°' },
  { id: 'stand', blocks: ['stand'], slots: ['stand'], repr3D: 'flat-part', modular: true, note: 'płyta 4 mm pod stopami, drukowana osobno; czopy wchodzą w stopy' },
  { id: 'whiskers', blocks: ['face'], slots: ['whiskers'], repr3D: 'flat-part', modular: true, note: 'płaska nakładka 1,6 mm drukowana osobno, czop w kufie' },
  { id: 'pattern', blocks: ['coat'], slots: ['pattern'], repr3D: 'groove', modular: false, note: 'płytkie zagłębienie 0,4 mm = granica koloru' },
  { id: 'collar', blocks: ['accessory'], slots: ['collar'], repr3D: 'ridge', modular: false, note: 'pierścień wokół szyi, wysokość 1,2 mm' },
  { id: 'saddle', blocks: ['accessory'], slots: ['saddle'], repr3D: 'dome', modular: false, note: 'płaska nakładka 1 mm na grzbiecie' },
];

/** Drawn only to look good; carries no geometry and must never suggest any. */
export const RENDER_ONLY_SLOTS: readonly SlotId[] = ['shadow', 'torsoClip', 'belly', 'glint', 'bones', 'blush', 'toes', 'wingRibs', 'coat', 'coatLegs', 'coatOn', 'coatLegB', 'coatLegF', 'relief', 'legOver0', 'legOver1', 'legOver2'];

/** Additive parts that form the support-free print silhouette (whiskers are printed separately). */
export const PRINT_SOLID_SLOTS: readonly SlotId[] = [
  'tail', 'legBFar', 'legFFar', 'legB', 'torso', 'saddle', 'spines', 'legF', 'neck', 'mane', 'collar',
  'ear', 'horns', 'antennae', 'stalks', 'tuft', 'head', 'snout', 'maw', 'wingNear', 'wingFar', 'finD', 'finP', 'arms', 'hands', 'handsFar', 'earFlop',
];

export const SLOT_NAME_PL: Record<SlotId, string> = {
  shadow: 'cień', stand: 'podstawka', arms: 'macki', hands: 'ręka', handsFar: 'ręka', earFlop: 'ucho', finD: 'płetwa grzbietowa', finP: 'płetwa piersiowa', wingFar: 'skrzydło', tail: 'ogon', legBFar: 'noga tylna', legFFar: 'noga przednia', legB: 'noga tylna',
  torso: 'brzuch/tułów', torsoClip: 'tułów', belly: 'brzuch', pattern: 'wzór', coat: 'faktura', coatLegs: 'faktura nóg', coatOn: 'faktura', coatLegB: 'faktura', coatLegF: 'faktura', saddle: 'siodło', spines: 'kolce', legF: 'noga przednia',
  neck: 'szyja', neckDecor: 'ozdoba szyi', mane: 'grzywa', collar: 'obroża', ear: 'ucho', earIn: 'ucho', horns: 'rogi', antennae: 'czułki', stalks: 'szypułki oczu', tuft: 'czub',
  head: 'głowa', snout: 'pysk', wingNear: 'skrzydło', nose: 'nos', mouth: 'usta', maw: 'wnętrze pyska', tongue: 'język', teeth: 'zęby', whiskers: 'wąsy', eye: 'oko',
  pupil: 'źrenica', glint: 'odblask', iris: 'tęczówka', blush: 'rumieniec', toes: 'paluszki', brow: 'brew', lids: 'powieki', lips: 'wargi', claws: 'pazury', relief: 'prążki', nostrils: 'nozdrza', wingRibs: 'kości skrzydeł', bones: 'kości', legOver0: 'noga', legOver1: 'noga', legOver2: 'noga',
};
