import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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

export function Viewport3D({ variant, explode = 0, baked = null }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ explode: (f: number) => void; resetView: () => void; rebuild: () => void } | null>(null);
  const bakedRef = useRef(baked);
  bakedRef.current = baked;
  const explodeRef = useRef(explode);
  explodeRef.current = explode;
  const [failed, setFailed] = useState(false);
  const preview = usePreview();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 1, 2000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3b4a5c, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(60, 120, -80); scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fd8ff, 0.7); fill.position.set(-80, 40, 90); scene.add(fill);

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
    let shown: unknown = null, shownPalette = -1;
    const rebuild = (): void => {
      const { genome, plan } = studio.getState();
      const b = bakedRef.current, p = previewStore.get();
      const solid = !b && explodeRef.current < 0.02 ? p.solid : null;
      const what = b ?? solid ?? `slabs:${studio.code()}:${plan.separate.join(',')}`;
      if (what === shown && genome.palette!.index! === shownPalette && model) return;
      shown = what; shownPalette = genome.palette!.index!;
      const next = b ? buildBakedModel(b, genome.palette!.index!)
        : solid ? buildSolidModel(solid, genome.palette!.index!)
        : buildModel(genome, plan, reportFor(genome, plan));
      if (model) { scene.remove(model.root); model.dispose(); }
      model = next;
      scene.add(model.root);
      model.explode(explodeRef.current);
      if (!framed || variant === 'mini') { frame(); framed = true; }
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
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el); resize();

    let raf = 0;
    const loop = (): void => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    api.current = { explode: (f) => model?.explode(f), resetView: () => { controls.autoRotate = true; frame(); }, rebuild };

    return () => {
      cancelAnimationFrame(raf); unsubs.forEach((u) => u()); ro.disconnect(); controls.dispose();
      model?.dispose(); renderer.dispose(); renderer.domElement.remove(); api.current = null;
    };
  }, [variant]);

  useEffect(() => { api.current?.rebuild(); api.current?.explode(explode); }, [explode]);
  useEffect(() => { api.current?.rebuild(); }, [baked]);

  if (failed) return <div className="viewport3d-fail">Przeglądarka nie udostępnia WebGL, więc podgląd 3D jest niedostępny.</div>;
  return (
    <div className={`viewport3d ${variant}`} ref={host}>
      {variant === 'main' && preview.busy && !baked && explode < 0.02 && <div className="viewport-busy">Przeliczam bryłę…</div>}
      {variant === 'main' && (
        <button type="button" className="btn-mini viewport-reset" onClick={() => api.current?.resetView()}>Wyśrodkuj widok</button>
      )}
    </div>
  );
}
