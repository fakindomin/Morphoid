import * as THREE from 'three';
import type { PreviewSolid } from '../../core/bake/preview';
import type { ColorKey } from '../../core/art/spec3d';
import { previewColors, type Model } from './model';

const KEYS: ColorKey[] = ['c1', 'c1dark', 'c2', 'c2soft', 'c3', 'ink', 'white'];

/** "Grey filament": how a hobbyist judges a sculpt, without the colours. */
const GREY = new THREE.Color('#a7abb1');

/**
 * The preview solid (the fused field the bake prints), smooth-shaded with its ambient occlusion, painted in the
 * drawing's colours or, in grey mode, as one grey filament.
 */
export function buildSolidModel(solid: PreviewSolid, palette: number, grey = false): Model {
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
    const glossy = !grey && (key === 'white' || key === 'ink'); // eyes and the nose catch a highlight
    mats.push(new THREE.MeshStandardMaterial({ color: grey ? GREY : colors[key], roughness: glossy ? 0.25 : grey ? 0.62 : 0.55, metalness: 0, vertexColors: true }));
  });
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setAttribute('normal', new THREE.BufferAttribute(solid.normals, 3));
  const ao = new Float32Array(solid.ao.length * 3);
  solid.ao.forEach((a, v) => { ao[3 * v] = a; ao[3 * v + 1] = a; ao[3 * v + 2] = a; });
  geo.setAttribute('color', new THREE.BufferAttribute(ao, 3));
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true; mesh.receiveShadow = true;
  root.add(mesh);
  return {
    root, box: new THREE.Box3().setFromObject(root), explode: () => undefined,
    dispose() { geo.dispose(); mats.forEach((m) => m.dispose()); },
  };
}
