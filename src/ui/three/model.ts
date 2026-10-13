import * as THREE from 'three';
import type { MorphotypeGenome } from '../../core/genome';
import { PALETTES } from '../../core/palette';
import { solveRig, type NodeId } from '../../core/rig';
import { targetPose } from '../../core/art/pose';
import { buildPaths } from '../../core/art/shapes';
import { buildParts3D, ctxFor, type ColorKey, type Part3D } from '../../core/art/spec3d';
import { groupOfSlot, pieceOf, type PartGroup, type PrintPlan, type PrintReport } from '../../core/print';

/** How far each separately printed piece slides away in the exploded view (mm at 100%). z is multiplied by the piece's side. */
const OFFSET: Record<PartGroup, [number, number, number]> = {
  head: [16, 14, 0], ears: [0, 10, 16], horns: [0, 14, 16], crest: [0, 16, 0], wings: [0, 16, 28],
  tail: [-22, 10, 0], legs: [0, 0, 26], whiskers: [16, 0, 16],
};
/** Rig nodes where a peg joins the piece to the body. */
const ROOTS: Record<PartGroup, NodeId[]> = {
  head: ['neckBase'], ears: ['earRoot'], horns: ['hornRoot'], crest: ['neckBase'], wings: ['wingRoot'],
  tail: ['tailBase'], legs: ['hipB', 'shoulderF'], whiskers: ['muzzle'],
};

const mix = (a: string, b: string, t: number): THREE.Color => new THREE.Color(a).lerp(new THREE.Color(b), t);

export interface Model {
  root: THREE.Group;
  box: THREE.Box3;
  /** slide separate pieces apart: 0 = assembled, 1 = fully exploded */
  explode(f: number): void;
  dispose(): void;
}

function geometryFor(p: Part3D): THREE.BufferGeometry[] {
  const b = Math.max(0, Math.min(p.bevel, p.thickness / 2 - 0.01));
  const depth = Math.max(0.05, p.thickness - 2 * b);
  return p.polys.map((poly) => {
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: 6,
      bevelEnabled: b > 0.03, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 3,
    });
    geo.translate(0, 0, -depth / 2); // centre the slab on z = 0 (bevel extends symmetrically)
    return geo;
  });
}

function patternMaterial(base: THREE.MeshStandardMaterial, polys: [number, number][][], box: THREE.Box2, color: THREE.Color): THREE.MeshStandardMaterial {
  const W = 768;
  const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = Math.max(8, Math.round((W * h) / w));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  for (const poly of polys) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => {
      const px = ((x - box.min.x) / w) * canvas.width, py = (1 - (y - box.min.y) / h) * canvas.height;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.closePath(); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  const mat = base.clone();
  mat.userData.tex = tex;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.patMap = { value: tex };
    shader.uniforms.patBox = { value: new THREE.Vector4(box.min.x, box.min.y, w, h) };
    shader.uniforms.patColor = { value: color };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPat; uniform sampler2D patMap; uniform vec4 patBox; uniform vec3 patColor;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 puv = (vPat - patBox.xy) / patBox.zw;
        float pm = (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) ? 0.0 : texture2D(patMap, puv).a;
        diffuseColor.rgb = mix(diffuseColor.rgb, patColor, pm * 0.92);`);
  };
  return mat;
}

export function buildModel(genome: MorphotypeGenome, plan: PrintPlan, report: PrintReport): Model {
  const rig = solveRig(genome);
  const paths = buildPaths(targetPose(rig, genome, 0, false, { x: 0, y: 0 }), genome, rig, false);
  const parts = buildParts3D(paths, genome, rig);
  const [hc1, hc2, hc3] = PALETTES[genome.palette!.index!]!;
  const colors: Record<ColorKey, THREE.Color> = {
    c1: new THREE.Color(hc1), c1dark: mix(hc1, '#000000', 0.35), c2: new THREE.Color(hc2), c2soft: mix(hc2, '#ffffff', 0.45),
    c3: new THREE.Color(hc3), ink: new THREE.Color('#1d2335'), white: new THREE.Color('#ffffff'),
  };
  const mats = new Map<ColorKey, THREE.MeshStandardMaterial>();
  const matFor = (k: ColorKey): THREE.MeshStandardMaterial => {
    let m = mats.get(k);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: colors[k], roughness: 0.55, metalness: 0 }); mats.set(k, m); }
    return m;
  };

  const root = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const containers = new Map<string, { obj: THREE.Group; offset: THREE.Vector3 }>();
  const container = (key: string, offset: THREE.Vector3): THREE.Group => {
    let c = containers.get(key);
    if (!c) { const obj = new THREE.Group(); root.add(obj); c = { obj, offset }; containers.set(key, c); }
    return c.obj;
  };

  // pattern: painted onto the torso as a colour region (planar projection of the 2D pattern)
  const torsoPolys = paths.torso.flatten(8);
  const patPolys = paths.pattern.flatten(8) as [number, number][][];
  let box2: THREE.Box2 | null = null;
  if (patPolys.length && torsoPolys.length) {
    box2 = new THREE.Box2();
    for (const poly of torsoPolys) for (const [x, y] of poly) box2.expandByPoint(new THREE.Vector2(x, y));
  }

  for (const part of parts) {
    const piece = pieceOf(part.slot, plan);
    const own = part.group !== null && groupOfSlot(part.slot)?.id === piece;
    const side = own ? part.side : 0;
    const off = piece === 'body' ? new THREE.Vector3() : new THREE.Vector3(OFFSET[piece][0], OFFSET[piece][1], OFFSET[piece][2] * (side || 1) * (OFFSET[piece][2] ? 1 : 0));
    const key = piece === 'body' ? 'body' : `${piece}:${side}`;
    const holder = container(key, off);
    let material = matFor(part.color);
    if (part.slot === 'torso' && box2) material = patternMaterial(material, patPolys, box2, colors.c3);
    for (const geo of geometryFor(part)) {
      geometries.push(geo);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.z = part.z;
      holder.add(mesh);
    }
  }

  // pegs for the separately printed parts (preview markers; real peg geometry comes with the bake)
  const pegMat = new THREE.MeshStandardMaterial({ color: '#00e5ff', roughness: 0.4, emissive: '#00a5b8', emissiveIntensity: 0.5 });
  const pegs: { mesh: THREE.Mesh; root: THREE.Vector3; offset: THREE.Vector3 }[] = [];
  for (const piece of report.pieces.filter((p) => p.kind === 'part' && p.peg)) {
    const group = piece.id as PartGroup;
    const [s, len] = piece.peg === '5x5x8' ? [5, 8] : [3, 5];
    const zs = [...new Set(parts.filter((p) => pieceOf(p.slot, plan) === group && p.group === group).map((p) => Math.round(p.z * 100) / 100))];
    for (const nodeId of ROOTS[group]) {
      for (const z of zs.length ? zs : [0]) {
        const n = rig.nodes[nodeId];
        const geo = new THREE.BoxGeometry(s, len, s);
        geometries.push(geo);
        const mesh = new THREE.Mesh(geo, pegMat);
        const rootPos = new THREE.Vector3(n.x, n.y, z);
        const sideSign = Math.sign(z) || 1;
        const o = OFFSET[group];
        pegs.push({ mesh, root: rootPos, offset: new THREE.Vector3(o[0], o[1], o[2] * sideSign) });
        root.add(mesh);
      }
    }
  }

  const apply = (f: number): void => {
    for (const c of containers.values()) c.obj.position.copy(c.offset).multiplyScalar(f);
    for (const p of pegs) { p.mesh.position.copy(p.root).addScaledVector(p.offset, 0.5 * f); p.mesh.visible = true; }
  };
  apply(0);
  const box = new THREE.Box3().setFromObject(root);

  return {
    root, box, explode: apply,
    dispose() {
      geometries.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      pegMat.dispose();
      root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && (m.userData as { tex?: THREE.Texture }).tex) { (m.userData as { tex: THREE.Texture }).tex.dispose(); m.dispose(); } });
    },
  };
}
