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
  { id: 'torso', blocks: ['body', 'build'], slots: ['torso'], repr3D: 'ellipsoid', modular: false, note: 'elipsoida L x W x G, baza modelu' },
  { id: 'legs', blocks: ['legs'], slots: ['legB', 'legF', 'legBFar', 'legFFar'], repr3D: 'sweep', modular: false,
    note: '4 nogi (druga para = lustro w Z), płaska podeszwa na Y=0, pazury jako klin leżący na stole' },
  { id: 'neck', blocks: ['head'], slots: ['neck', 'neckDecor'], repr3D: 'sweep', modular: false, note: 'stożek ścięty; grzebień/pancerz jako grzbiety o wysokości 0,8 mm' },
  { id: 'head', blocks: ['head'], slots: ['head', 'throat'], repr3D: 'ellipsoid', modular: false, note: 'elipsoida czaszki + podbródek (klin 45° do przodu szyi)' },
  { id: 'snout', blocks: ['snout'], slots: ['snout', 'nose'], repr3D: 'sweep', modular: false, note: 'zwężająca się kufa; nos jako kopułka' },
  { id: 'ears', blocks: ['ears'], slots: ['ear', 'earIn'], repr3D: 'plate', modular: false, note: 'płytka 1,6 mm; wnętrze jako zagłębienie koloru' },
  { id: 'horns', blocks: ['horns'], slots: ['horns'], repr3D: 'sweep', modular: false, note: 'rogi jako sweep, kąt nawisu <= 45°, czubek >= 1,2 mm' },
  { id: 'crest', blocks: ['crest'], slots: ['tuft', 'mane', 'spines'], repr3D: 'cone-array', modular: false, note: 'kolce/czub z czubkiem >= 1,2 mm' },
  { id: 'wings', blocks: ['wings'], slots: ['wingNear', 'wingFar'], repr3D: 'plate', modular: true, note: 'płytki 1,6 mm po obu stronach; w trybie modułowym drukowane na płasko z czopem' },
  { id: 'tail', blocks: ['tail'], slots: ['tail'], repr3D: 'sweep', modular: false, note: 'sweep eliptyczny od nasady' },
  { id: 'eyes', blocks: ['face'], slots: ['eye', 'pupil'], repr3D: 'dome', modular: false, note: 'oko = kopułka >= 0,8 mm, źrenica = kolor/zagłębienie 0,4 mm' },
  { id: 'mouth', blocks: ['face'], slots: ['mouth', 'brow'], repr3D: 'groove', modular: false, note: 'rowek 0,8 x 0,5 mm' },
  { id: 'teeth', blocks: ['face'], slots: ['teeth'], repr3D: 'dome', modular: false, note: 'płaski relief na boku pyska (wysokość 0,8 mm), nic nie zwisa poza obrys' },
  { id: 'whiskers', blocks: ['face'], slots: ['whiskers'], repr3D: 'flat-part', modular: true, note: 'płaska nakładka 1,6 mm drukowana osobno, czop w kufie' },
  { id: 'pattern', blocks: ['coat'], slots: ['pattern'], repr3D: 'groove', modular: false, note: 'płytkie zagłębienie 0,4 mm = granica koloru' },
  { id: 'collar', blocks: ['accessory'], slots: ['collar'], repr3D: 'ridge', modular: false, note: 'pierścień wokół szyi, wysokość 1,2 mm' },
  { id: 'saddle', blocks: ['accessory'], slots: ['saddle'], repr3D: 'dome', modular: false, note: 'płaska nakładka 1 mm na grzbiecie' },
];

/** Drawn only to look good; carries no geometry and must never suggest any. */
export const RENDER_ONLY_SLOTS: readonly SlotId[] = ['shadow', 'torsoClip', 'belly', 'glint', 'bones'];

/** Additive parts that form the support-free print silhouette (whiskers are printed separately). */
export const PRINT_SOLID_SLOTS: readonly SlotId[] = [
  'tail', 'legBFar', 'legFFar', 'legB', 'torso', 'saddle', 'spines', 'legF', 'neck', 'mane', 'collar',
  'ear', 'horns', 'tuft', 'head', 'snout', 'wingNear', 'wingFar', 'throat',
];

export const SLOT_NAME_PL: Record<SlotId, string> = {
  shadow: 'cień', wingFar: 'skrzydło', tail: 'ogon', legBFar: 'noga tylna', legFFar: 'noga przednia', legB: 'noga tylna',
  torso: 'brzuch/tułów', torsoClip: 'tułów', belly: 'brzuch', pattern: 'wzór', saddle: 'siodło', spines: 'kolce', legF: 'noga przednia',
  neck: 'szyja', neckDecor: 'ozdoba szyi', mane: 'grzywa', collar: 'obroża', ear: 'ucho', earIn: 'ucho', horns: 'rogi', tuft: 'czub',
  head: 'głowa', snout: 'pysk', wingNear: 'skrzydło', nose: 'nos', mouth: 'usta', teeth: 'zęby', whiskers: 'wąsy', eye: 'oko',
  pupil: 'źrenica', glint: 'odblask', brow: 'brew', bones: 'kości', throat: 'podbródek',
};
