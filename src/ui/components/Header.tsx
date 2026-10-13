import { useRef, useState } from 'react';
import { studio, useStudioState } from '../studio';
import { Logo } from './Logo';
import { HeaderBake } from './BakeStatus';
import { copyText, type ViewMode } from './RightColumn';

export type Theme = 'dark' | 'light';

export function Header({ view, setView, theme, setTheme }: {
  view: ViewMode; setView: (v: ViewMode) => void; theme: Theme; setTheme: (t: Theme) => void;
}) {
  useStudioState(); // re-render on every genome change
  const code = studio.code();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();

  const copy = async (): Promise<void> => {
    if (!(await copyText(code))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <a className="brand" href="./" aria-label="Morphoid Studio">
          <Logo />
          <span className="brand-title">MORPHOID<small>Studio</small></span>
        </a>
        <button type="button" className={`dna-pill${copied ? ' copied' : ''}`} onClick={copy}
          title="Kliknij, aby skopiować Morphotyp" aria-label={`Morphotyp ${code}. Kopiuj`}>
          <span aria-hidden>🧬</span>
          <span className="dna-code">{code}</span>
          <span className="dna-badge">{copied ? 'SKOPIOWANO!' : 'KOPIUJ'}</span>
        </button>
      </div>
      <div className="topbar-right">
        <HeaderBake />
        <div className="segment view-switch" role="group" aria-label="Widok">
          <button type="button" className={`seg-pill${view === '2d' ? ' active' : ''}`} onClick={() => setView('2d')}>2D Szkic</button>
          <button type="button" className={`seg-pill${view === '3d' ? ' active' : ''}`} onClick={() => setView('3d')}>3D Studio</button>
        </div>
        <button type="button" className="icon-btn" title="Przełącz motyw jasny / ciemny" aria-label="Przełącz motyw"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☾' : '☀'}
        </button>
      </div>
    </header>
  );
}
