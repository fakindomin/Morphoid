import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useViewOptions } from '../viewOptions';
import type { BakeResult } from '../../core/bake/bake';
import { reportFor } from '../printReport';
import { buildBakedModel } from '../three/bakedModel';
import { buildModel, type Model } from '../three/model';
import { buildSolidModel } from '../three/solidModel';
import { previewStore, usePreview } from '../previewStore';
import { studio } from '../studio';

interface Props {
  /** 'mini': small turntable, no interaction */
  variant: 'main' | 'mini';
  /** exploded view of the separately printed parts, 0..1 */
  explode?: number;
  /** show this baked solid instead of the preview built from outlines (only while it matches the model) */
  baked?: BakeResult | null;
}

/** Sharpest canvas the preview draws (device pixels per CSS pixel): 2x on a retina screen costs 4x the pixels for little. */
const MAX_DPR = 1.5;
/** The turntable stops after this long (ms); "Wyśrodkuj widok" sets it going again. */
const AUTO_ROTATE_MS = 8000;
/** the main view turns while the switch is on (it pauses while the model is dragged); the mini view stops after a while */

export function Viewport3D({ variant, explode = 0, baked = null }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ explode: (f: number) => void; resetView: () => void; rebuild: () => void; setSpin: (on: boolean) => void } | null>(null);
  const bakedRef = useRef(baked);
  bakedRef.current = baked;
  const explodeRef = useRef(explode);
  explodeRef.current = explode;
  const [failed, setFailed] = useState(false);
  const preview = usePreview();
  const { grey, recenter, spin: spinOn } = useViewOptions();
  const spinRef = useRef(spinOn);
  spinRef.current = spinOn;
  const greyRef = useRef(grey);
  greyRef.current = grey;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(MAX_DPR, window.devicePixelRatio || 1)); // a sharper canvas costs the GPU the square of it
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
    // studio lighting: a soft room for reflections, a warm key that casts a soft shadow, a cool fill, a rim from behind
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // the key light and the model stand still while the camera orbits: the shadow is drawn once per model, not per frame
    renderer.shadowMap.autoUpdate = false;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = room;
    scene.environmentIntensity = 0.55;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445064, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.1); key.position.set(70, 140, -60);
    key.castShadow = variant === 'main';
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.4;
    Object.assign(key.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 400 });
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe6ff, 0.6); fill.position.set(-90, 50, 80); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1); rim.position.set(-40, 80, 160); scene.add(rim);
    // the shadow lands on an invisible catcher on the bed
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22 }));
    catcher.receiveShadow = true; catcher.position.y = 0.02;
    scene.add(catcher);

    // the print bed (P1S: 256 x 256) shown as a plate under the model
    const bed = new THREE.Group();
    const grid = new THREE.GridHelper(200, 20, 0x00e5ff, 0x00e5ff);
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.18;
    const plate = new THREE.Mesh(new THREE.CircleGeometry(100, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.05 }));
    plate.position.y = -0.05;
    bed.add(grid, plate);
    scene.add(bed);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = variant === 'mini' ? 2.2 : 1.1;
    controls.enabled = variant === 'main';
    controls.maxPolarAngle = Math.PI * 0.499;
    renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; });
    renderer.domElement.addEventListener('pointerup', () => { if (variant === 'main' && spinRef.current) { controls.autoRotate = true; invalidate(); } });

    // render on demand: a frame only while something moves (orbit, damping, the turntable), never when it stands still
    let raf = 0;
    const tick = (): void => {
      raf = 0;
      const moving = controls.update();
      renderer.render(scene, camera);
      if (moving || controls.autoRotate) invalidate();
    };
    const invalidate = (): void => { if (!raf && !document.hidden) raf = requestAnimationFrame(tick); };
    controls.addEventListener('change', invalidate);
    controls.addEventListener('start', invalidate);
    // the turntable stops by itself after a while
    let spinTimer = 0;
    const spin = (): void => {
      window.clearTimeout(spinTimer);
      if (variant === 'main') controls.autoRotate = spinRef.current;
      else {
        controls.autoRotate = true;
        spinTimer = window.setTimeout(() => { controls.autoRotate = false; }, AUTO_ROTATE_MS);
      }
      invalidate();
    };
    const onVisible = (): void => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else invalidate(); };
    document.addEventListener('visibilitychange', onVisible);

    let model: Model | null = null;
    let framed = false;
    const frame = (): void => {
      if (!model) return;
      const size = model.box.getSize(new THREE.Vector3());
      const c = model.box.getCenter(new THREE.Vector3());
      const d = Math.max(size.x, size.y * 1.4, 60) * 1.9;
      controls.target.set(c.x, Math.max(c.y * 0.9, 8), 0);
      camera.position.set(c.x + d * 0.5, c.y + d * 0.42, -d * 0.85);
      controls.update();
    };
    // what is on screen: the print bake if one matches, else the preview solid (also a slightly stale one while the
    // next is being built), else the quick outline slabs (first load, and the exploded view of separate pieces)
    let shown: unknown = null, shownPalette = -1, shownGrey = false;
    const rebuild = (): void => {
      const { genome, plan } = studio.getState();
      const b = bakedRef.current, p = previewStore.get();
      const solid = !b && explodeRef.current < 0.02 ? p.solid : null;
      const what = b ?? solid ?? `slabs:${studio.code()}:${plan.separate.join(',')}`;
      // a preview solid wears the colours of the creature it was built from, so a new creature's colours never land on the old shape
      const shapeOf = (code: string | null): string => (code ?? '').split('#')[0]!.replace(/:P[0-9A-F]+/, '');
      const pal = solid && !b && shapeOf(p.code) !== shapeOf(studio.code()) ? p.palette : genome.palette!.index!;
      if (what === shown && pal === shownPalette && greyRef.current === shownGrey && model) return;
      shown = what; shownPalette = pal; shownGrey = greyRef.current;
      const next = b ? buildBakedModel(b, genome.palette!.index!, greyRef.current)
        : solid ? buildSolidModel(solid, pal, greyRef.current)
        : buildModel(genome, plan, reportFor(genome, plan));
      if (model) { scene.remove(model.root); model.dispose(); }
      model = next;
      model.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      scene.add(model.root);
      model.explode(explodeRef.current);
      if (!framed || variant === 'mini') { frame(); framed = true; }
      renderer.shadowMap.needsUpdate = true;
      invalidate();
    };
    rebuild();

    let pending = false;
    const later = (): void => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; rebuild(); });
    };
    const unsubs = [studio.subscribe(later), previewStore.subscribe(later), previewStore.attach()];

    const resize = (): void => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h; camera.updateProjectionMatrix();
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el); resize();

    spin();
    api.current = {
      explode: (f) => { model?.explode(f); renderer.shadowMap.needsUpdate = true; invalidate(); },
      resetView: () => { frame(); spin(); },
      setSpin: () => spin(),
      rebuild,
    };

    return () => {
      cancelAnimationFrame(raf); window.clearTimeout(spinTimer); document.removeEventListener('visibilitychange', onVisible); unsubs.forEach((u) => u()); ro.disconnect(); controls.dispose();
      model?.dispose(); room.dispose(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove(); api.current = null;
    };
  }, [variant]);

  useEffect(() => { api.current?.rebuild(); api.current?.explode(explode); }, [explode]);
  useEffect(() => { api.current?.rebuild(); }, [grey]);
  useEffect(() => { if (recenter) api.current?.resetView(); }, [recenter]);
  useEffect(() => { api.current?.setSpin(spinOn); }, [spinOn]);
  useEffect(() => { api.current?.rebuild(); }, [baked]);

  if (failed) return <div className="viewport3d-fail">Przeglądarka nie udostępnia WebGL, więc podgląd 3D jest niedostępny.</div>;
  return (
    <div className={`viewport3d ${variant}`} ref={host}>
      {variant === 'main' && preview.busy && preview.quality === 'draft' && !baked && explode < 0.02 && <div className="viewport-busy">Przeliczam bryłę…</div>}
    </div>
  );
}
