import * as THREE from 'three';
import type { BakeResult } from '../../core/bake/bake';
import { printHex } from '../../core/filaments';
import { PALETTES } from '../../core/palette';
import type { Model } from './model';

/** The real baked solid (smooth normals from the shared vertices), painted with the filaments of the 3MF. */
export function buildBakedModel(result: BakeResult, paletteIndex: number, grey = false): Model {
  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const palette = PALETTES[paletteIndex] ?? PALETTES[0]!;
  const mats = result.inks.map((k) => printHex(k, palette))
    .map((color) => new THREE.MeshStandardMaterial({ color: grey ? '#a7abb1' : color, roughness: grey ? 0.62 : 0.5, metalness: 0 }));
  for (const p of result.pieces) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.mesh.positions, 3));
    // triangles sorted by filament, one draw group per filament
    const nt = p.mesh.indices.length / 3, index = new Uint32Array(p.mesh.indices.length);
    let at = 0;
    for (let f = 0; f < mats.length; f++) {
      const start = at;
      for (let t = 0; t < nt; t++) if ((p.paint[t] ?? 0) === f) { index.set(p.mesh.indices.subarray(3 * t, 3 * t + 3), at); at += 3; }
      if (at > start) geo.addGroup(start, at - start, f);
    }
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeVertexNormals();
    geos.push(geo);
    root.add(new THREE.Mesh(geo, mats));
  }
  return {
    root, box: new THREE.Box3().setFromObject(root), explode: () => undefined,
    dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); },
  };
}
