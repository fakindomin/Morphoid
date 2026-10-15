import { studio, useStudioState } from '../studio';
import { Logo } from './Logo';
import type { ViewMode } from './RightColumn';

export type Theme = 'dark' | 'light';

export function Header({ view, setView, theme, setTheme }: {
  view: ViewMode; setView: (v: ViewMode) => void; theme: Theme; setTheme: (t: Theme) => void;
}) {
  useStudioState(); // re-render on every genome change
  const { name } = studio.creature();
  return (
    <header className="topbar">
      <div className="topbar-left">
        <a className="brand" href="/" aria-label="Morphoid Studio, strona główna">
          <Logo />
          <span className="brand-title">MORPHOID<small>Studio</small></span>
        </a>
        <div className="dna-pill" title={`Morphoid ${name}`}>
          <span aria-hidden>🧬</span>
          <span className="dna-code">Morphoid {name}</span>
        </div>
      </div>
      <div className="topbar-right">
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
