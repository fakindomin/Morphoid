import { useRef, useState } from 'react';
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

/** The creature's DNA code above the sketch: one line, live with every change; one click copies it (the frame flashes).
 *  Beside it, the badges of the creature's body plan and build. */
export function DnaStrip() {
  const { genome } = useStudioState(); // re-render on every genome change
  const { code } = studio.creature();
  const plan = typeOf('plan', genome.plan?.type ?? 0, 'quadruped'), build = typeOf('build', genome.build?.type ?? 0, 'normal');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  const copy = async (): Promise<void> => {
    if (!(await copyText(code))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="dna-row">
      <div className="dna-types">
        <TypeBadge kind={plan.kind} label={`Plan ciała: ${plan.label}`} />
        <TypeBadge kind={build.kind} label={`Budowa: ${build.label}`} />
      </div>
      <button type="button" className={`dna-strip${copied ? ' copied' : ''}`} onClick={copy} title="Kliknij, aby skopiować kod DNA" aria-label="Kod DNA stwora. Kliknij, aby skopiować">
        <code>{code}</code>
      </button>
    </div>
  );
}
