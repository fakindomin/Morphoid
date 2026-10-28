import {
  GROUPS, PRINTERS, isSeparate, planKind, planModular, planWhole, type PartGroup, type PrintIssue, type PrintReport,
} from '../../core/print';
import { fittedPlan, usePrintReport } from '../printReport';
import { studio, useStudioState } from '../studio';

const LEVEL_TEXT = {
  green: 'Bez podpór',
  blue: 'Z podporami',
  yellow: 'Drukuje się, ale z uwagami',
  red: 'Wymaga zmian',
} as const;

const BRIDGES = [
  { mm: 8, label: 'Ostrożnie · 8' },
  { mm: 12, label: 'P1S · 12' },
  { mm: 20, label: 'Odważnie · 20' },
];

function IssueRow({ issue }: { issue: PrintIssue }) {
  return (
    <li className={`issue ${issue.severity}`}>
      <span className="issue-text">{issue.message}</span>
      {issue.fix && (
        <button type="button" className="btn-mini" onClick={() => studio.setSeparate(issue.fix!, true)}>
          Wydrukuj osobno
        </button>
      )}
      {issue.fuse && (
        <button type="button" className="btn-mini" onClick={() => studio.setSeparate(issue.fuse!, false)}>
          Połącz z korpusem
        </button>
      )}
    </li>
  );
}

function summary(report: PrintReport): string {
  const parts = report.pieces.filter((p) => p.kind === 'part');
  if (!parts.length) return 'Jedna bryła, bez montażu.';
  return `Korpus + ${parts.length} ${parts.length === 1 ? 'część' : parts.length < 5 ? 'części' : 'części'} z czopami.`;
}

export function PrintPanel() {
  const { genome, plan } = useStudioState();
  const report = usePrintReport(genome, plan);
  const kind = planKind(plan);
  const printer = PRINTERS[plan.printer]!;
  const shown = report.issues.filter((i) => i.severity !== 'info');
  const infos = report.issues.filter((i) => i.severity === 'info');

  return (
    <section className={`tile print-tile ${report.level}`}>
      <header className="tile-header">
        <span className="tile-title">🖨 Kontrola druku</span>
        <span className={`level-pill ${report.level}`}>{LEVEL_TEXT[report.level]}</span>
      </header>
      <div className="hint">{printer.name} · stół {printer.bed[0]}×{printer.bed[1]} mm · dysza {printer.nozzle}</div>

      <div className="control-label">Sposób druku</div>
      <div className="segment">
        <button type="button" className={`seg-pill${kind === 'whole' ? ' active' : ''}`}
          onClick={() => studio.setPlan({ ...planWhole(plan.printer, plan.ams), maxBridge: plan.maxBridge })}>Całość</button>
        <button type="button" className={`seg-pill${kind === 'modular' ? ' active' : ''}`}
          onClick={() => studio.setPlan(fittedPlan(genome, { ...planModular(plan.printer, plan.ams), maxBridge: plan.maxBridge }))}>Moduły</button>
        <button type="button" className={`seg-pill${kind === 'custom' ? ' active' : ''}`} disabled={kind !== 'custom'}>Własny</button>
      </div>

      <div className="control-label">Które części drukować osobno</div>
      <ul className="group-list">
        {GROUPS.map((g) => {
          const sep = isSeparate(plan, g.id as PartGroup);
          const piece = report.pieces.find((p) => p.id === g.id);
          return (
            <li key={g.id}>
              <span className="group-name">{g.label}</span>
              {piece?.peg && <span className="peg-badge" title="Czop montażowy">czop {piece.peg}</span>}
              {g.forced ? <span className="forced">zawsze osobno</span> : (
                <span className="segment mini">
                  <button type="button" className={`seg-pill${!sep ? ' active' : ''}`} onClick={() => studio.setSeparate(g.id, false)}>Razem</button>
                  <button type="button" className={`seg-pill${sep ? ' active' : ''}`} onClick={() => studio.setSeparate(g.id, true)}>Osobno</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="control-label">Podpory</div>
      <div className="segment">
        <button type="button" className={`seg-pill${plan.supports === 'allowed' ? ' active' : ''}`} onClick={() => studio.setSupports('allowed')}>Dozwolone</button>
        <button type="button" className={`seg-pill${plan.supports === 'avoid' ? ' active' : ''}`} onClick={() => studio.setSupports('avoid')}>Unikaj</button>
      </div>
      <div className="control-label">Najdłuższy most bez podpór</div>
      <div className="segment">
        {BRIDGES.map((b) => (
          <button key={b.mm} type="button" className={`seg-pill${plan.maxBridge === b.mm ? ' active' : ''}`} onClick={() => studio.setBridge(b.mm)}>{b.label}</button>
        ))}
      </div>

      {shown.length > 0 && <ul className="issues">{shown.map((i, k) => <IssueRow key={`${i.code}${i.part}${k}`} issue={i} />)}</ul>}
      {infos.map((i, k) => <div key={k} className="hint">ℹ {i.message}</div>)}
      <div className="hint">{summary(report)}</div>
    </section>
  );
}
