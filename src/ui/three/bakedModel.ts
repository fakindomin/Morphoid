import * as THREE from 'three';
import type { BakeResult } from '../../core/bake/bake';
import { PALETTES } from '../../core/palette';
import type { Model } from './model';

/** The real baked solid (smooth normals from the shared vertices), one flat colour per palette body colour. */
export function buildBakedModel(result: BakeResult, paletteIndex: number): Model {
  const root = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mat = new THREE.MeshStandardMaterial({ color: PALETTES[paletteIndex]![0], roughness: 0.5, metalness: 0 });
  for (const p of result.pieces) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.mesh.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(p.mesh.indices, 1));
    geo.computeVertexNormals();
    geos.push(geo);
    root.add(new THREE.Mesh(geo, mat));
  }
  return {
    root, box: new THREE.Box3().setFromObject(root), explode: () => undefined,
    dispose() { geos.forEach((g) => g.dispose()); mat.dispose(); },
  };
}
