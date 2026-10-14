import * as THREE from 'three';
import type { PreviewSolid } from '../../core/bake/preview';
import type { ColorKey } from '../../core/art/spec3d';
import { previewColors, type Model } from './model';

const KEYS: ColorKey[] = ['c1', 'c1dark', 'c2', 'c2soft', 'c3', 'ink', 'white'];

/** The preview solid (the fused field the bake prints), smooth-shaded and painted in the drawing's colours. */
export function buildSolidModel(solid: PreviewSolid, palette: number): Model {
  const colors = previewColors(palette);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(solid.positions, 3));
  const I = solid.indices, nt = I.length / 3, index = new Uint32Array(I.length);
  const mats: THREE.MeshStandardMaterial[] = [];
  let at = 0;
  KEYS.forEach((key) => {
    const start = at;
    for (let t = 0; t < nt; t++) if (solid.colors[t] === key) { index.set(I.subarray(3 * t, 3 * t + 3), at); at += 3; }
    if (at === start) return;
    geo.addGroup(start, at - start, mats.length);
    mats.push(new THREE.MeshStandardMaterial({ color: colors[key], roughness: key === 'white' || key === 'ink' ? 0.3 : 0.6, metalness: 0 }));
  });
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setAttribute('normal', new THREE.BufferAttribute(solid.normals, 3));
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geo, mats));
  return {
    root, box: new THREE.Box3().setFromObject(root), explode: () => undefined,
    dispose() { geo.dispose(); mats.forEach((m) => m.dispose()); },
  };
}
