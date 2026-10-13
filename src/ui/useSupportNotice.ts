import { useEffect, useRef, useState } from 'react';
import { BLOCKS, type MorphotypeGenome } from '../core/genome';
import { GROUPS, type PartGroup, type PrintPlan, type PrintReport } from '../core/print';
import { reportFor } from './printReport';
import { studio } from './studio';

/** mm^2 of side-view support area: below this a change is noise (raster aliasing, tiny stubs). */
const NOISE = 25;
/** above this the honest advice is "split the model" rather than "accept some supports". */
const HEAVY = 400;

export interface SupportNotice {
  key: number;
  /** what the user's last action did */
  source: 'genome' | 'plan';
  added: number;
  heavy: boolean;
  /** parts that now need (more) supports */
  parts: { name: string; size: 'małe' | 'średnie' | 'duże' }[];
  /** error/warn level problems that appeared (only when supports are set to "avoid") */
  problems: string[];
  suggestions: { group: PartGroup; label: string; gain: number }[];
  avoid: boolean;
}

const sizeWord = (area: number): 'małe' | 'średnie' | 'duże' => (area < 120 ? 'małe' : area < 400 ? 'średnie' : 'duże');

function changedFields(a: MorphotypeGenome, b: MorphotypeGenome): number {
  let n = 0;
  for (const blk of BLOCKS) for (const f of blk.fields) if (a[blk.id]?.[f.name] !== b[blk.id]?.[f.name]) n++;
  return n;
}

function areaByPart(rep: PrintReport): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of rep.issues) if (i.area) m.set(i.part, (m.get(i.part) ?? 0) + i.area);
  return m;
}

/**
 * Watches the model and the print plan. When the user's last action makes the model need more
 * supports (or breaks a limit they asked to avoid), returns a notice with a way out.
 * Bulk changes (randomize, load a code) are not announced: the panel shows the result anyway.
 */
export function useSupportNotice(genome: MorphotypeGenome, plan: PrintPlan): { notice: SupportNotice | null; dismiss: () => void } {
  const prev = useRef<{ genome: MorphotypeGenome; plan: PrintPlan; report: PrintReport } | null>(null);
  const [notice, setNotice] = useState<SupportNotice | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    const report = reportFor(genome, plan);
    const before = prev.current;
    prev.current = { genome, plan, report };
    if (!before || (before.genome === genome && before.plan === plan)) return;

    const genomeChanged = before.genome !== genome;
    if (genomeChanged && changedFields(before.genome, genome) > 2) { setNotice(null); return; }

    const added = report.supportArea - before.report.supportArea;
    const oldParts = areaByPart(before.report), newParts = areaByPart(report);
    const worse = [...newParts].filter(([name, a]) => a - (oldParts.get(name) ?? 0) > NOISE);
    const seen = new Set(before.report.issues.filter((i) => i.severity === 'warn' || i.severity === 'error').map((i) => `${i.code}:${i.part}`));
    const problems = report.issues
      .filter((i) => (i.severity === 'warn' || i.severity === 'error') && !seen.has(`${i.code}:${i.part}`))
      .map((i) => i.message);

    if (added <= NOISE && !problems.length) { setNotice(null); return; }

    // which splits would get rid of it?
    const groups = new Set<PartGroup>();
    for (const i of report.issues) if (i.fix && (i.area || i.severity !== 'support')) groups.add(i.fix);
    const suggestions = [...groups].map((g) => {
      const alt = reportFor(genome, { ...plan, separate: [...plan.separate, g] });
      return { group: g, label: GROUPS.find((x) => x.id === g)!.label, gain: report.supportArea - alt.supportArea };
    }).filter((s) => s.gain > NOISE).sort((a, b) => b.gain - a.gain).slice(0, 2);

    setNotice({
      key: ++counter.current,
      source: genomeChanged ? 'genome' : 'plan',
      added,
      heavy: added > HEAVY,
      parts: worse.map(([name, a]) => ({ name, size: sizeWord(a - (oldParts.get(name) ?? 0)) })),
      problems,
      suggestions,
      avoid: plan.supports === 'avoid',
    });
  }, [genome, plan]);

  // remember what to undo when the user asks to revert a plan change
  return { notice, dismiss: () => setNotice(null) };
}

/** Reverting the action that caused the notice. */
export function revertLastChange(notice: SupportNotice, previousPlan: PrintPlan | null): void {
  if (notice.source === 'genome') studio.undo();
  else if (previousPlan) studio.setPlan(previousPlan);
}
