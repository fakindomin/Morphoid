import * as THREE from 'three';
import type { MorphotypeGenome } from '../../core/genome';
import { PALETTES } from '../../core/palette';
import { solveRig, type NodeId } from '../../core/rig';
import { targetPose } from '../../core/art/pose';
import { buildPaths } from '../../core/art/shapes';
import { buildParts3D, ctxFor, type ColorKey, type Part3D } from '../../core/art/spec3d';
import type { Limb } from '../../core/art/limb';
import { COAT_GLSL, type Coat } from '../../core/art/coat';
import { widthAt } from '../../core/bake/field';
import { groupOfSlot, pieceOf, type PartGroup, type PrintPlan, type PrintReport } from '../../core/print';

/** How far each separately printed piece slides away in the exploded view (mm at 100%). z is multiplied by the piece's side. */
const OFFSET: Record<PartGroup, [number, number, number]> = {
  head: [16, 14, 0], ears: [0, 10, 16], horns: [0, 14, 16], crest: [0, 16, 0], wings: [0, 16, 28],
  tail: [-22, 10, 0], legs: [0, 0, 26], whiskers: [16, 0, 16], stand: [0, -12, 0],
};
/** Rig nodes where a peg joins the piece to the body. */
const ROOTS: Record<PartGroup, NodeId[]> = {
  head: ['neckBase'], ears: ['earRoot'], horns: ['hornRoot'], crest: ['neckBase'], wings: ['wingRoot'],
  tail: ['tailBase'], legs: ['hipB', 'shoulderF'], whiskers: ['muzzle'], stand: ['footBL'],
};

/** The preview's bump is a little stronger than the real relief: a light bump reads weaker on screen than a groove in plastic. */
const COAT_BUMP = 1.6;

const mix = (a: string, b: string, t: number): THREE.Color => new THREE.Color(a).lerp(new THREE.Color(b), t);

export interface Model {
  root: THREE.Group;
  box: THREE.Box3;
  /** slide separate pieces apart: 0 = assembled, 1 = fully exploded */
  explode(f: number): void;
  dispose(): void;
}

/** A jointed leg (world mm): a tapered cylinder per segment, a ball at every joint, half an ellipsoid for the paw. */
function limbGeometry(limb: Limb): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const c of limb.cones) {
    const a = new THREE.Vector3(...c.a), b = new THREE.Vector3(...c.b), len = a.distanceTo(b);
    if (len > 1e-3) {
      const cyl = new THREE.CylinderGeometry(c.rb, c.ra, len, 20, 1, true);
      cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize()));
      cyl.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      out.push(cyl);
    }
    for (const [q, r] of [[a, c.ra], [b, c.rb]] as const) {
      const ball = new THREE.SphereGeometry(r, 20, 12);
      ball.translate(q.x, q.y, q.z);
      out.push(ball);
    }
  }
  for (const d of limb.domes) {
    const dome = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(d.r[0], d.r[1], d.r[2]);
    dome.translate(d.c[0], d.c[1], d.c[2]);
    out.push(dome);
  }
  return out;
}

function geometryFor(p: Part3D): THREE.BufferGeometry[] {
  if (p.limb) return limbGeometry(p.limb);
  return p.polys.map((poly) => {
    // the bevel eats into the outline (bevelOffset -b): wider than half the shape it turns the outline inside out and
    // a small round part (a nose) shows as a spiky knob, so it never exceeds ~half the shape's narrow side
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const b = Math.max(0, Math.min(p.bevel, p.thickness / 2 - 0.01, 0.42 * Math.min(x1 - x0, y1 - y0)));
    const depth = Math.max(0.05, p.thickness - 2 * b);
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: 6,
      bevelEnabled: b > 0.03, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 3,
    });
    geo.translate(0, 0, -depth / 2); // centre the slab on z = 0 (bevel extends symmetrically)
    if (p.widths) { // anatomy: narrower at the waist, as the bake makes it
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * widthAt(p, pos.getX(i)));
      geo.computeVertexNormals();
    }
    return geo;
  });
}

/**
 * The torso's material: the coat pattern painted on as a colour region (planar projection of the 2D pattern), and the
 * coat texture (fur, scales, armour) as a bump from the same height function the bake sinks into the solid.
 */
function torsoMaterial(base: THREE.MeshStandardMaterial, pat: { polys: [number, number][][]; box: THREE.Box2; color: THREE.Color } | null, coat: Coat | undefined, z: number): THREE.MeshStandardMaterial {
  const mat = base.clone();
  let tex: THREE.CanvasTexture | null = null;
  let w = 1, h = 1;
  if (pat) {
    const W = 768;
    w = pat.box.max.x - pat.box.min.x; h = pat.box.max.y - pat.box.min.y;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = Math.max(8, Math.round((W * h) / w));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    for (const poly of pat.polys) {
      ctx.beginPath();
      poly.forEach(([x, y], i) => {
        const px = ((x - pat.box.min.x) / w) * canvas.width, py = (1 - (y - pat.box.min.y) / h) * canvas.height;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath(); ctx.fill();
    }
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    mat.userData.tex = tex;
  }
  mat.userData.own = true;
  // the shader differs with what is on (pattern, coat), not with the callback's source: keep the programs apart
  mat.customProgramCacheKey = () => `torso:${tex ? 1 : 0}:${coat ? 1 : 0}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPat; varying vec3 vCoatP; varying vec3 vCoatN; uniform float coatZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPat = position.xy; vCoatP = position + vec3(0.0, 0.0, coatZ); vCoatN = objectNormal;');
    shader.uniforms.coatZ = { value: z };
    let head = 'varying vec2 vPat; varying vec3 vCoatP; varying vec3 vCoatN;';
    let frag = shader.fragmentShader;
    if (tex && pat) {
      shader.uniforms.patMap = { value: tex };
      shader.uniforms.patBox = { value: new THREE.Vector4(pat.box.min.x, pat.box.min.y, w, h) };
      shader.uniforms.patColor = { value: pat.color };
      head += ' uniform sampler2D patMap; uniform vec4 patBox; uniform vec3 patColor;';
      frag = frag.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 puv = (vPat - patBox.xy) / patBox.zw;
        float pm = (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) ? 0.0 : texture2D(patMap, puv).a;
        diffuseColor.rgb = mix(diffuseColor.rgb, patColor, pm * 0.92);`);
    }
    if (coat) {
      shader.uniforms.coatU = { value: new THREE.Vector4(coat.kind, coat.cx, coat.cy, coat.tilt) };
      head += ' uniform vec4 coatU;' + COAT_GLSL;
      // bump mapping (as three's bumpmap chunk): tilt the normal by the screen-space slope of the relief
      frag = frag.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float hh = -coatDepth(coatU, vCoatP, normalize(vCoatN)) * ${COAT_BUMP.toFixed(2)};
          vec3 sp = -vViewPosition, sx = dFdx(sp), sy = dFdy(sp);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(hh) * r1 + dFdy(hh) * r2);
          normal = normalize(abs(det) * normal - grad);
        }`);
    }
    shader.fragmentShader = frag.replace('#include <common>', '#include <common>\n' + head);
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
    if (part.slot === 'torso' && (box2 || part.coat)) material = torsoMaterial(material, box2 ? { polys: patPolys, box: box2, color: colors.c3 } : null, part.coat, part.z);
    for (const geo of geometryFor(part)) {
      geometries.push(geo);
      const mesh = new THREE.Mesh(geo, material);
      // a top-view part is drawn in (x, z) and extruded along y: +90 deg about X maps (u, v, w) to (u, -w, v), and the
      // slab is symmetric in w
      if (part.limb) { /* already in world mm */ } else if (part.plane === 'xz') { mesh.rotation.x = Math.PI / 2; mesh.position.y = part.z; } else mesh.position.z = part.z;
      holder.add(mesh);
    }
    if (part.ribs) for (const geo of limbGeometry(part.ribs)) { geometries.push(geo); holder.add(new THREE.Mesh(geo, material)); }
  }

  // pegs for the separately printed parts (preview markers; real peg geometry comes with the bake)
  const pegMat = new THREE.MeshStandardMaterial({ color: '#00e5ff', roughness: 0.4, emissive: '#00a5b8', emissiveIntensity: 0.5 });
  const pegs: { mesh: THREE.Mesh; root: THREE.Vector3; offset: THREE.Vector3 }[] = [];
  for (const piece of report.pieces.filter((p) => p.kind === 'part' && p.peg)) {
    const group = piece.id as PartGroup;
    const [s, len] = piece.peg === '5x5x8' ? [5, 8] : [3, 5];
    const own = parts.filter((p) => pieceOf(p.slot, plan) === group && p.group === group);
    if (own.some((p) => p.plane === 'xz')) continue; // top-view parts (whiskers) seat on tabs, see the bake
    const zs = [...new Set(own.map((p) => Math.round(p.z * 100) / 100))];
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
    for (const p of pegs) { p.mesh.position.copy(p.root).addScaledVector(p.offset, 0.5 * f); p.mesh.visible = f > 0.02; } // pegs only show when the pieces are pulled apart
  };
  apply(0);
  const box = new THREE.Box3().setFromObject(root);

  return {
    root, box, explode: apply,
    dispose() {
      geometries.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      pegMat.dispose();
      root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m?.userData.own) { (m.userData as { tex?: THREE.Texture }).tex?.dispose(); m.dispose(); } });
    },
  };
}
