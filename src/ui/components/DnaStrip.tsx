import { useRef, useState } from 'react';
import { studio, useStudioState } from '../studio';
import { copyText } from './RightColumn';

/** The creature's DNA code above the sketch: shown in full, one click copies it. */
export function DnaStrip() {
  useStudioState(); // re-render on every genome change
  const { code } = studio.creature();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  const copy = async (): Promise<void> => {
    if (!(await copyText(code))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button type="button" className={`dna-strip${copied ? ' copied' : ''}`} onClick={copy} title="Kliknij, aby skopiować kod DNA" aria-label="Kod DNA stwora. Kliknij, aby skopiować">
      <span className="dna-strip-head"><span>🧬 DNA</span><span className="dna-strip-hint">{copied ? 'Skopiowano!' : 'Kliknij, aby skopiować'}</span></span>
      <code>{code}</code>
    </button>
  );
}
