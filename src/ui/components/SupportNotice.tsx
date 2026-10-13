import { studio } from '../studio';
import { revertLastChange, type SupportNotice as Notice } from '../useSupportNotice';
import type { PrintPlan } from '../../core/print';

export function SupportNotice({ notice, previousPlan, dismiss }: { notice: Notice; previousPlan: PrintPlan | null; dismiss: () => void }) {
  const names = notice.parts.map((p) => `${p.name} (${p.size})`).join(', ');
  return (
    <div className={`support-notice${notice.avoid || notice.problems.length ? ' strict' : ''}`} role="status" aria-live="polite">
      <div className="notice-title">
        {notice.avoid || notice.problems.length
          ? 'Ta zmiana wymaga podpór albo rozbicia modelu na części'
          : notice.heavy ? 'Ta zmiana wymaga sporo więcej podpór. Warto rozbić model na części' : 'Ta zmiana wymaga więcej podpór'}
      </div>
      <div className="notice-body">
        {names && <>Podpory pod: {names}. </>}
        {notice.problems.length > 0 && <>{notice.problems.join(' ')} </>}
        {!notice.avoid && <>Slicer doda je sam, ale wydruk będzie dłuższy i trzeba je oderwać.</>}
      </div>
      <div className="notice-actions">
        {notice.suggestions.map((s) => (
          <button key={s.group} type="button" className="btn-mini" onClick={() => { studio.setSeparate(s.group, true); dismiss(); }}>
            Wydrukuj osobno: {s.label}
          </button>
        ))}
        <button type="button" className="btn-mini" onClick={() => { revertLastChange(notice, previousPlan); dismiss(); }}>Cofnij zmianę</button>
        <button type="button" className="btn-mini ghost" onClick={dismiss}>Rozumiem</button>
      </div>
    </div>
  );
}
