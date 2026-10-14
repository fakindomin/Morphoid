import { useCallback, useEffect, useRef, useState } from 'react';
import { solveRig, type SocketId } from '../core';
import { Canvas2D } from './components/Canvas2D';
import { Viewport3D } from './components/Viewport3D';
import { DnaStrip } from './components/DnaStrip';
import { Header, type Theme } from './components/Header';
import { LeftColumn } from './components/LeftColumn';
import { RadialMenu, useRadial } from './components/RadialMenu';
import { RightColumn, type ViewMode } from './components/RightColumn';
import { rigSize } from '../core/art/shapes';
import { StatusBake } from './components/BakeStatus';
import { signatureOf, useBake } from './bakeStore';
import { SupportNotice } from './components/SupportNotice';
import { usePrintReport } from './printReport';
import { useSupportNotice } from './useSupportNotice';
import { storage, studio, useStudioState } from './studio';

const THEME_KEY = 'morphoid.theme';

function initialTheme(): Theme {
  const saved = storage.get(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [view, setView] = useState<ViewMode>('2d');
  const [showBones, setShowBones] = useState(false);
  const [breathing, setBreathing] = useState(true);
  const [explode, setExplode] = useState(0);
  const job = useBake();
  const radial = useRadial();
  const { genome, plan } = useStudioState();
  const rig = solveRig(genome);
  const report = usePrintReport(genome, plan);
  const { notice, dismiss } = useSupportNotice(genome, plan);
  const prevPlan = useRef(plan);
  const lastPlan = useRef(plan);
  if (lastPlan.current !== plan) { prevPlan.current = lastPlan.current; lastPlan.current = plan; }
  const markers = report.issues.filter((i) => i.severity !== 'info').map((i) => ({ at: i.at, severity: i.severity, text: i.message }));
  const size = rigSize(rig);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storage.set(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { e.preventDefault(); setBreathing((b) => !b); }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? studio.redo() : studio.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); studio.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSocket = useCallback((s: SocketId, c: { x: number; y: number }) => radial.open(s, c), [radial.open]);

  return (
    <div className="app">
      <Header view={view} setView={setView} theme={theme} setTheme={setTheme} />
      <main className="studio">
        <LeftColumn activeSocket={radial.state.open ? radial.state.socket : null} />
        <section className="blueprint">
          <DnaStrip />
          <div className="stage">
          {notice && <SupportNotice key={notice.key} notice={notice} previousPlan={prevPlan.current} dismiss={dismiss} />}
          {view === '2d' && (
            <div className="canvas-tools">
              <button type="button" className={`tool-btn${showBones ? ' on' : ''}`} aria-pressed={showBones} title="Pokaż kości" aria-label="Pokaż kości" onClick={() => setShowBones((b) => !b)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="5" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="8" r="2" /><circle cx="12" cy="20" r="2" /><path d="M6.6 7.2l3.8 3.6M13.8 11.2l3.4-2M12 14v4" /></svg>
              </button>
              <button type="button" className={`tool-btn${breathing ? ' on' : ''}`} aria-pressed={breathing} title="Oddech (spacja)" aria-label="Oddech" onClick={() => setBreathing((b) => !b)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 12c2.5-5 5.5-5 8 0s5.5 5 8 0" /><path d="M3 17c2.5-3 5.5-3 8 0s5.5 3 8 0" opacity=".5" /></svg>
              </button>
            </div>
          )}
          <div className="hud-tag">{view === '2d' ? 'WIDOK Z BOKU · kliknij pomarańczowy punkt, aby zmienić część' : '3D STUDIO · obracaj myszą, kółko = zbliżenie'}</div>
          {view === '2d' ? (
            <Canvas2D showBones={showBones} breathing={breathing} frozen={radial.state.open} onSocket={onSocket} markers={markers} />
          ) : (
            <Viewport3D variant="main" explode={explode} baked={job.showBaked && job.result && job.signature === signatureOf(studio.code(), plan.separate) ? job.result : null} />
          )}
          </div>
        </section>
        <RightColumn explode={explode} setExplode={setExplode} view={view} />
      </main>
      <footer className="statusbar">
        <span className={rig.issues.length ? 'bad' : 'ok'}>
          <i className="dot" />
          {rig.issues.length ? `Naruszenia: ${rig.issues.join(', ')}` : 'Podstawa Y=0: zablokowana'}
        </span>
        <span className={`print-status ${report.level}`}>
          <i className="dot" />
          Druk: {report.level === 'green' ? 'bez podpór' : report.level === 'blue' ? 'z podporami' : report.level === 'yellow' ? 'z uwagami' : 'wymaga zmian'}
        </span>
        <span className="muted">Model {size.length.toFixed(0)} × {size.width.toFixed(0)} × {size.height.toFixed(0)} mm</span>
        <StatusBake onOpen={() => setView('3d')} />
        <span className="spacer" />
        <span className="muted"><kbd>Spacja</kbd> pauza oddechu <kbd>Ctrl+Z</kbd> cofnij <kbd>Klik ●</kbd> koło wyboru</span>
      </footer>
      <RadialMenu ctl={radial} />
    </div>
  );
}
