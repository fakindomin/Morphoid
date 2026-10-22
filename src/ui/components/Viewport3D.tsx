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
import { elementDef, pickAnchor, pullLength, pullSwing, pullThick, type Anchor } from '../../core/art/handles';
import { handlesStore } from '../handlesStore';
import { HandlesPanel } from './HandlesPanel';

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
    let shown: unknown = null, shownPalette = -1, shownGrey = false, shownSolid = false;
    let onRebuilt = (): void => undefined; // (the handles follow the solid on screen, see below)
    const rebuild = (): void => {
      const { genome, plan } = studio.getState();
      const b = bakedRef.current, p = previewStore.get();
      const solid = !b && explodeRef.current < 0.02 ? p.solid : null;
      const what = b ?? solid ?? `slabs:${studio.code()}:${plan.separate.join(',')}`;
      // a preview solid wears the colours of the creature it was built from, so a new creature's colours never land on the old shape
      const shapeOf = (code: string | null): string => (code ?? '').split('#')[0]!.replace(/:P[0-9A-F]+/, '');
      const pal = solid && !b && shapeOf(p.code) !== shapeOf(studio.code()) ? p.palette : genome.palette!.index!;
      if (what === shown && pal === shownPalette && greyRef.current === shownGrey && model) return;
      shown = what; shownPalette = pal; shownGrey = greyRef.current; shownSolid = !!solid;
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
      onRebuilt();
    };
    rebuild();

    // ---- handles: click an element of the solid, pull its handles (length, thickness, swing) --------------------
    const handles = new THREE.Group();
    handles.renderOrder = 10;
    scene.add(handles);
    type Kind = 'len' | 'thick' | 'swing';
    const HANDLE_COLOR: Record<Kind, number> = { len: 0x2d7bff, thick: 0xff3b4e, swing: 0xffc61a };
    const ball = new THREE.SphereGeometry(1, 20, 14);
    const mats = (Object.keys(HANDLE_COLOR) as Kind[]).reduce((m, k) => ({ ...m, [k]: new THREE.MeshBasicMaterial({ color: HANDLE_COLOR[k], depthTest: false, transparent: true, opacity: 0.95 }) }), {} as Record<Kind, THREE.MeshBasicMaterial>);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.35 });
    /** the anchors of the solid on screen (only while the solid shown is the preview of the current creature's shape) */
    const anchorsNow = (): Anchor[] => (shownSolid ? previewStore.get().solid?.anchors ?? [] : []);
    const v3 = (a: readonly number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
    let handleMeshes: { mesh: THREE.Mesh; kind: Kind; dir: THREE.Vector3; at: THREE.Vector3 }[] = [];
    let current: Anchor | null = null;
    const clearHandles = (): void => {
      for (const o of [...handles.children]) { handles.remove(o); if ((o as THREE.Line).isLine) (o as THREE.Line).geometry.dispose(); }
      handleMeshes = [];
    };
    const drawHandles = (): void => {
      if (handlesStore.get().dragging) return;
      clearHandles();
      const sel = handlesStore.get().selected, list = anchorsNow();
      current = sel ? list.find((x) => x.id === sel.id && x.side === sel.side) ?? list.find((x) => x.id === sel.id) ?? null : null;
      if (!current) { invalidate(); return; }
      const root = v3(current.root), tip = v3(current.tip), axis = tip.clone().sub(root), L = axis.length();
      const r = current.radius, size = Math.max(1.3, Math.min(2.2, L * 0.07));
      const thickAt = root.clone().addScaledVector(axis, 0.45).addScaledVector(v3(current.thickDir), r + 3);
      const swingAt = root.clone().addScaledVector(axis, 0.75).addScaledVector(v3(current.swingDir), r + 3);
      const lenAt = tip.clone().addScaledVector(axis.clone().normalize(), 2.5);
      const put = (kind: Kind, at: THREE.Vector3, dir: THREE.Vector3): void => {
        const mesh = new THREE.Mesh(ball, mats[kind]);
        mesh.scale.setScalar(size); mesh.position.copy(at); mesh.renderOrder = 11;
        handles.add(mesh);
        handleMeshes.push({ mesh, kind, dir: dir.clone().normalize(), at: at.clone() });
      };
      const line = (pts: THREE.Vector3[]): void => {
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
        l.renderOrder = 10; handles.add(l);
      };
      line([root, lenAt]);
      line([root.clone().addScaledVector(axis, 0.45), thickAt]);
      line([root.clone().addScaledVector(axis, 0.75), swingAt]);
      put('len', lenAt, axis); put('thick', thickAt, v3(current.thickDir)); put('swing', swingAt, v3(current.swingDir));
      invalidate();
    };

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const aim = (e: PointerEvent): void => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    const toScreen = (p: THREE.Vector3): THREE.Vector2 => {
      const q = p.clone().project(camera), rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2((q.x + 1) / 2 * rect.width, (1 - q.y) / 2 * rect.height);
    };
    /** a pull in progress: which handle, where it started, the creature it started from */
    let drag: { h: (typeof handleMeshes)[number]; x: number; y: number; perMm: THREE.Vector2; genome: ReturnType<typeof studio.getState>['genome']; a: Anchor; sent: number; first: boolean; last: number | null } | null = null;
    let down: { x: number; y: number; t: number } | null = null;
    const SEND_MS = 150;
    const valueFor = (d: NonNullable<typeof drag>, mm: number): number => {
      const def = elementDef(d.a.id), L = Math.hypot(d.a.tip[0] - d.a.root[0], d.a.tip[1] - d.a.root[1], d.a.tip[2] - d.a.root[2]);
      return d.h.kind === 'len' ? pullLength(d.genome, def, L, mm) : d.h.kind === 'thick' ? pullThick(d.genome, def, d.a.radius, mm) : pullSwing(d.genome, def, def.splay ? L : L * 0.75, mm);
    };
    const send = (d: NonNullable<typeof drag>, value: number): void => {
      const def = elementDef(d.a.id), ref = d.h.kind === 'len' ? def.length : d.h.kind === 'thick' ? def.thick : def.swing;
      studio.fine(ref.block, ref.field, value, !d.first);
      d.first = false; d.sent = performance.now(); d.last = null;
    };
    const onDown = (e: PointerEvent): void => {
      if (variant !== 'main' || e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (!handleMeshes.length || !current) return;
      aim(e);
      const hit = ray.intersectObjects(handleMeshes.map((h) => h.mesh), false)[0];
      const h = hit && handleMeshes.find((x) => x.mesh === hit.object);
      if (!h) return;
      // screen pixels per mm along the handle's direction
      const p0 = toScreen(h.at), p1 = toScreen(h.at.clone().addScaledVector(h.dir, 10));
      drag = { h, x: e.clientX, y: e.clientY, perMm: p1.sub(p0).multiplyScalar(0.1), genome: studio.getState().genome, a: current, sent: 0, first: true, last: null };
      controls.enabled = false;
      handlesStore.setDragging(true);
      renderer.domElement.setPointerCapture(e.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
      e.stopPropagation();
    };
    const onMove = (e: PointerEvent): void => {
      if (!drag) {
        if (variant !== 'main' || e.buttons || !handleMeshes.length) return;
        aim(e);
        renderer.domElement.style.cursor = ray.intersectObjects(handleMeshes.map((h) => h.mesh), false).length ? 'grab' : '';
        return;
      }
      const d = drag, l2 = d.perMm.lengthSq();
      if (l2 < 1e-6) return;
      const mm = ((e.clientX - d.x) * d.perMm.x + (e.clientY - d.y) * d.perMm.y) / l2;
      d.h.mesh.position.copy(d.h.at).addScaledVector(d.h.dir, mm);
      invalidate();
      const value = valueFor(d, mm);
      if (performance.now() - d.sent > SEND_MS) send(d, value); else d.last = value;
    };
    const onUp = (e: PointerEvent): void => {
      if (drag) {
        const d = drag;
        drag = null;
        if (d.last !== null) send(d, d.last);
        controls.enabled = variant === 'main';
        renderer.domElement.style.cursor = '';
        handlesStore.setDragging(false);
        drawHandles();
        return;
      }
      // a click (not a drag of the view): pick the element under the pointer
      const c = down; down = null;
      if (!c || Math.hypot(e.clientX - c.x, e.clientY - c.y) > 5 || performance.now() - c.t > 500 || !model || !shownSolid) return;
      aim(e);
      const hit = ray.intersectObject(model.root, true)[0];
      const a = hit ? pickAnchor(anchorsNow(), hit.point.x, hit.point.y, hit.point.z) : null;
      handlesStore.select(a ? { id: a.id, side: a.side } : null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown, { capture: true });
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    const unHandles = [handlesStore.subscribe(drawHandles)];
    onRebuilt = drawHandles;
    drawHandles();

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
      unHandles.forEach((u) => u()); clearHandles(); ball.dispose(); Object.values(mats).forEach((m) => m.dispose()); lineMat.dispose();
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
      {variant === 'main' && !baked && explode < 0.02 && <HandlesPanel anchors={preview.solid?.anchors ?? []} />}
    </div>
  );
}
