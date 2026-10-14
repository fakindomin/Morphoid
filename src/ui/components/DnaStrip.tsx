import { useRef, useState } from 'react';
import { studio, useStudioState } from '../studio';
import { copyText } from './RightColumn';

/** The creature's DNA code above the sketch: one line, live with every change; one click copies it (the frame flashes). */
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
      <code>{code}</code>
    </button>
  );
}
