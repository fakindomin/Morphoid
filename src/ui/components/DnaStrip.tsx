import { useLayoutEffect, useRef, useState } from 'react';
import { studio, useStudioState } from '../studio';
import { copyText } from './RightColumn';
import { TypeBadge } from './TypeBadge';
import { BADGE_SVG, type BadgeKey } from '../brand/marks';
import { blockDef } from '../../core/genome/schema';

/** The chosen option of a block's `type` field; its id names the badge (e.g. plan 0 = "quadruped"). */
const typeOf = (id: 'plan' | 'build', index: number, fallback: BadgeKey): { kind: BadgeKey; label: string } => {
  const field = blockDef(id).fields.find((f) => f.name === 'type');
  const opt = field?.kind === 'enum' ? field.options[index] : undefined;
  return { kind: opt && opt.id in BADGE_SVG ? (opt.id as BadgeKey) : fallback, label: opt?.label ?? '' };
};

/**
 * The code cut at its colons into `n` lines as even as possible (the longest line as short as it can be), so a code
 * that does not fit on one line never ends with a short tail under a long line.
 */
export function balancedLines(code: string, n: number): string[] {
  const genes = code.split(':').map((g, i, all) => (i < all.length - 1 ? `${g}:` : g));
  const fill = (max: number): string[] => {
    const out: string[] = [];
    for (const g of genes) {
      const last = out.length - 1;
      if (last >= 0 && out[last]!.length + g.length <= max) out[last] += g;
      else out.push(g);
    }
    return out;
  };
  let lo = Math.max(...genes.map((g) => g.length)), hi = code.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (fill(mid).length <= n) hi = mid; else lo = mid + 1; }
  return fill(lo);
}

/** The Morphoid's name, centred, and its DNA code under it, above the sketch: live with every change; one click copies it (a small note says so).
 *  Beside it, the badges of the creature's body plan and build. */
export function DnaStrip() {
  const { genome } = useStudioState(); // re-render on every genome change
  const { code, name } = studio.creature();
  const plan = typeOf('plan', genome.plan?.type ?? 0, 'quadruped'), build = typeOf('build', genome.build?.type ?? 0, 'normal');
  const [copied, setCopied] = useState(false);
  // how many characters fit on a line next to the badges: the block is as wide as its longest line
  const rowRef = useRef<HTMLDivElement>(null), codeRef = useRef<HTMLElement>(null);
  const [perLine, setPerLine] = useState(400);
  useLayoutEffect(() => {
    const row = rowRef.current, el = codeRef.current;
    if (!row || !el) return;
    const measure = (): void => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = getComputedStyle(el).font;
      const ch = ctx.measureText('0'.repeat(20)).width / 20 || 7.2;
      const types = (row.querySelector('.dna-types') as HTMLElement | null)?.offsetWidth ?? 0;
      setPerLine(Math.max(12, Math.floor((row.parentElement!.clientWidth - types - 8 - 30) / ch)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row.parentElement!);
    return () => ro.disconnect();
  }, []);
  let lines = balancedLines(code, Math.ceil(code.length / perLine));
  while (lines.length < 12 && Math.max(...lines.map((l) => l.length)) > perLine) lines = balancedLines(code, lines.length + 1);
  const timer = useRef<number>();
  const copy = async (): Promise<void> => {
    if (!(await copyText(code))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="dna-head">
    <h1 className="dna-name">Morphoid {name}</h1>
    <div className="dna-row" ref={rowRef}>
      <div className="dna-types">
        <TypeBadge kind={plan.kind} label={`Plan ciała: ${plan.label}`} />
        <TypeBadge kind={build.kind} label={`Budowa: ${build.label}`} />
      </div>
      <button type="button" className={`dna-strip${copied ? ' copied' : ''}`} onClick={copy} title="Kliknij, aby skopiować kod DNA" aria-label="Kod DNA Morphoida. Kliknij, aby skopiować">
        {/* a narrow window cuts the code at its colons (between genes) into even lines */}
        <code ref={codeRef}>{lines.map((l, i) => <span key={i} className="dna-line">{l}</span>)}</code>
      </button>
      {copied && <span className="dna-toast" role="status">Skopiowano kod DNA</span>}
    </div>
    </div>
  );
}
