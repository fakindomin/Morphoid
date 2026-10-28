/**
 * 3MF for multi-material printers (Bambu AMS, Prusa MMU): all pieces in one file, laid out on the bed, every
 * triangle painted with its filament (see paint.ts). The colour is written three ways so each slicer finds it:
 *  - `paint_color` (Bambu Studio / OrcaSlicer painting),
 *  - `slic3rpe:mmu_segmentation` (PrusaSlicer painting),
 *  - core 3MF base materials (plain viewers show the colours).
 * Bambu Studio reads a project's settings only from a file that names BambuStudio as its Application; without them
 * 2.08.02 refuses the config with "The 3mf file has invalid config" and drops the colours. So the file carries a
 * Bambu project config (bambu-p1s.json: P1S 0.4, 0.20 mm Standard, four PLA Basic filaments) recoloured per creature.
 */
import { strToU8, zipSync } from 'fflate';
import type { BakeResult } from './bake';
import { printMesh, type Creature, type ExportFile } from './orient';
import { fileBase } from '../genome/name';
import { FILAMENTS } from './paint';
import bambuProject from './bambu-p1s.json';

/** Painted-triangle state for filament 1..4 in the slicers' TriangleSelector encoding. */
const PAINT_CODE = ['4', '8', '0C', '1C'] as const;
const FILAMENT_NAME = ['c1 (korpus)', 'c2 (akcenty)', 'c3 (detale)', 'biały'] as const;
const BED_MM = 256;
const GAP_MM = 10;
/** The Bambu Studio build that produced bambu-p1s.json; files naming it are opened as Bambu projects. */
const BAMBU_APP = 'BambuStudio-02.08.02.61';

const num = (v: number): string => String(Math.round(v * 1000) / 1000);

/** One .3mf with every piece of the bake; `colors` are the filament colours c1, c2, c3 (hex), white is the fourth. */
export function export3mf(result: BakeResult, who: Creature, colors: readonly [string, string, string]): ExportFile {
  const base = fileBase(who.name);
  const swatch = [...colors, '#ffffff'].slice(0, FILAMENTS);
  const objects: string[] = [], items: string[] = [];
  const meshes = result.pieces.map((p) => ({ piece: p, mesh: printMesh(p) }));
  const sizes = meshes.map(({ mesh }) => {
    let x1 = 0, y1 = 0;
    for (const i of mesh.indices) { x1 = Math.max(x1, mesh.positions[3 * i]!); y1 = Math.max(y1, mesh.positions[3 * i + 1]!); }
    return [x1, y1] as const;
  });
  const place = layout(sizes);
  const [towerX, towerY] = towerSpot(sizes, place);
  meshes.forEach(({ piece, mesh }, n) => {
    const id = n + 2;
    const P = mesh.positions, I = mesh.indices;
    const v: string[] = [], t: string[] = [];
    // only the vertices the triangles use (despeckling leaves a few behind)
    const at = new Int32Array(P.length / 3).fill(-1);
    const vid = (i: number): number => {
      if (at[i]! < 0) { at[i] = v.length; v.push(`<vertex x="${num(P[3 * i]!)}" y="${num(P[3 * i + 1]!)}" z="${num(P[3 * i + 2]!)}"/>`); }
      return at[i]!;
    };
    for (let i = 0; i < I.length; i += 3) {
      const f = piece.paint[i / 3] ?? 0;
      // filament 1 is the object's own (pid/pindex on the object): only the other colours need saying
      t.push(f ? `<triangle v1="${vid(I[i]!)}" v2="${vid(I[i + 1]!)}" v3="${vid(I[i + 2]!)}" p1="${f}" paint_color="${PAINT_CODE[f]}" slic3rpe:mmu_segmentation="${PAINT_CODE[f]}"/>`
        : `<triangle v1="${vid(I[i]!)}" v2="${vid(I[i + 1]!)}" v3="${vid(I[i + 2]!)}"/>`);
    }
    objects.push(`<object id="${id}" name="${esc(`${base} ${piece.label}`)}" type="model" pid="1" pindex="0"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`);
    const [x, y] = place[n]!;
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(x)} ${num(y)} 0" printable="1"/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
<metadata name="Title">${esc(base)}</metadata>
<metadata name="Application">${BAMBU_APP}</metadata>
<metadata name="BambuStudio:3mfVersion">1</metadata>
<metadata name="Description">${esc(`DNA: ${who.code}. Filamenty: ${swatch.map((c, i) => `${i + 1} = ${FILAMENT_NAME[i]} ${c}`).join(', ')}`)}</metadata>
<metadata name="slic3rpe:Version3mf">1</metadata>
<metadata name="slic3rpe:MmPaintingVersion">1</metadata>
<resources>
<basematerials id="1">${swatch.map((c, i) => `<base name="${esc(FILAMENT_NAME[i]!)}" displaycolor="${c.toUpperCase()}FF"/>`).join('')}</basematerials>
${objects.join('\n')}
</resources>
<build>${items.join('')}</build>
</model>`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="txt" ContentType="text/plain"/><Default Extension="config" ContentType="text/xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
    'Metadata/project_settings.config': strToU8(JSON.stringify({
      ...bambuProject, filament_colour: swatch.map((c) => c.toUpperCase()), wipe_tower_x: [num(towerX)], wipe_tower_y: [num(towerY)],
    }, null, 1)),
    'Metadata/dna.txt': strToU8(`${base}\nDNA: ${who.code}\nMorphoid Studio\n`),
  };
  return { name: `${base}.3mf`, bytes: zipSync(files, { level: 1 }) };
}

/**
 * Shelf packing on the bed: biggest pieces first, rows along X, the whole block centred. A set that does not fit one
 * plate simply runs past the edge; the slicer's arrange spreads it over plates.
 */
function layout(sizes: (readonly [number, number])[]): [number, number][] {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]![1] - sizes[a]![1]);
  const at: [number, number][] = sizes.map(() => [0, 0]);
  let x = 0, y = 0, row = 0, width = 0;
  for (const i of order) {
    const [w, d] = sizes[i]!;
    if (x > 0 && x + w > BED_MM - 2 * GAP_MM) { y += row + GAP_MM; x = 0; row = 0; }
    at[i] = [x, y];
    x += w + GAP_MM; row = Math.max(row, d); width = Math.max(width, x - GAP_MM);
  }
  const ox = Math.max(GAP_MM, (BED_MM - width) / 2), oy = Math.max(GAP_MM, (BED_MM - (y + row)) / 2);
  return at.map(([a, b]) => [a + ox, b + oy]);
}

/** Room the AMS prime tower takes on the bed (35 mm wide, grows in depth with the colour changes) plus its brim. */
const TOWER_MM = [45, 70] as const;

/** A bed corner for the prime tower that no piece covers; the slicer rejects a tower that runs off the plate. */
function towerSpot(sizes: (readonly [number, number])[], place: [number, number][]): [number, number] {
  const [tw, td] = TOWER_MM;
  const corners: [number, number][] = [[BED_MM - GAP_MM - tw, BED_MM - GAP_MM - td], [GAP_MM, BED_MM - GAP_MM - td], [BED_MM - GAP_MM - tw, GAP_MM], [GAP_MM, GAP_MM]];
  const free = ([x, y]: [number, number]): boolean => place.every(([px, py], i) =>
    px >= x + tw + 5 || px + sizes[i]![0] + 5 <= x || py >= y + td + 5 || py + sizes[i]![1] + 5 <= y);
  return corners.find(free) ?? corners[0]!;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
