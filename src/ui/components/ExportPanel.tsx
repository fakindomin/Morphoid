import { exportBundle } from '../../core/bake/orient';
import { export3mf } from '../../core/bake/threemf';
import { PALETTES } from '../../core/palette';
import { VOXEL_MM, type BakeQuality } from '../../core/bake/bake';
import { bakeStore } from '../bakeStore';
import { download } from '../download';
import { GROUPS, isSeparate, type PartGroup } from '../../core/print';
import type { BakedPiece } from '../../core/bake/bake';
import { studio, useStudioState } from '../studio';
import { BakeProgressBar, useBakeFresh } from './BakeStatus';

const QUALITY: { id: BakeQuality; label: string; hint: string }[] = [
  { id: 'draft', label: 'Szkic', hint: `${VOXEL_MM.draft} mm: ułamek sekundy` },
  { id: 'standard', label: 'Standard', hint: `${VOXEL_MM.standard} mm: ok. 1 s` },
  { id: 'fine', label: 'Dokładny', hint: `${VOXEL_MM.fine} mm: kilka sekund, do ok. 0,5 GB pamięci` },
];

/** Chrome reports the device RAM in GB; the finest bake needs roughly half a gigabyte. */
const lowMemory = (): boolean => { const m = (navigator as Navigator & { deviceMemory?: number }).deviceMemory; return m !== undefined && m <= 2; };

const PEG_TEXT: Record<string, string> = { '5x5x8': 'czop 5×5×8', '3x3x5': 'czop 3×3×5', '2x2x4': 'kołek 2×2×4', tab: 'wpust' };

/** "czop 5×5×8, 2× wpust" — how this part is fixed to the rest */
function jointSummary(p: BakedPiece): string {
  const count = new Map<string, number>();
  for (const j of p.joints) if (j.peg) count.set(j.peg, (count.get(j.peg) ?? 0) + 1);
  if (!count.size) return p.joints.length ? 'do przyklejenia' : '';
  return [...count].map(([k, n]) => (n > 1 ? `${n}× ` : '') + PEG_TEXT[k]).join(', ');
}

const labelOfPiece = (id: string): string => (id === 'body' ? 'korpus' : GROUPS.find((g) => g.id === id)?.label.toLowerCase() ?? id);

export function ExportPanel() {
  const { job, fresh, stale } = useBakeFresh();
  const code = studio.code();
  const result = job.result;
  const running = job.status === 'running';
  const allOk = result?.pieces.every((p) => p.validation.watertight && p.validation.volume > 0);
  const totalVol = result?.pieces.reduce((s, p) => s + p.validation.volume, 0) ?? 0;
  const { genome, plan } = useStudioState();
  // a through-hole is not a defect (the solid is watertight and prints), but the user should know it is there
  const windowed = result?.pieces.find((p) => p.validation.genus > 0);
  const splitGroup = (genome.wings!.type! > 0 && !isSeparate(plan, 'wings')) ? 'wings' as const
    : (genome.tail!.type! > 0 && !isSeparate(plan, 'tail')) ? 'tail' as const : null;

  return (
    <section className="tile">
      <header className="tile-header"><span className="tile-title">📦 Eksport do druku</span><span className="tile-status">STL · 3MF</span></header>
      <p className="hint">Zamienia model na jedną gładką, szczelną bryłę (zrost bez szwów) i sprawdza ją. Części drukowane osobno trafiają do ZIP-a. 3MF zawiera wszystkie części ułożone na stole i pomalowane czterema filamentami (c1, c2, c3 i biały) pod AMS. Przygotowanie trwa od ułamka sekundy do kilku sekund i dzieje się w tle.</p>
      <div className="control-label">Dokładność</div>
      <div className="segment">
        {QUALITY.map((q) => (
          <button key={q.id} type="button" title={q.hint} disabled={running || (q.id === 'fine' && lowMemory())} className={`seg-pill${job.quality === q.id ? ' active' : ''}`} onClick={() => bakeStore.setQuality(q.id)}>{q.label}</button>
        ))}
      </div>
      {running ? (
        <>
          <BakeProgressBar job={job} />
          <button type="button" className="btn-tile danger" onClick={() => bakeStore.cancel()}>Anuluj</button>
        </>
      ) : (
        <button type="button" className="btn-tile" onClick={() => bakeStore.start()}>{result ? '↻ Przygotuj ponownie' : '⚙ Przygotuj bryłę do druku'}</button>
      )}
      {job.status === 'error' && <div className="msg warn">Błąd: {job.error}</div>}
      {result && (
        <div className={`bake-result${stale ? ' stale' : ''}`}>
          {stale && <div className="msg warn">Model się zmienił. Przygotuj bryłę ponownie, żeby pobrać aktualną.</div>}
          <ul className="piece-list">
            {result.pieces.map((p) => (
              <li key={p.id}>
                <span className="group-name">{p.label}</span>
                <span className={`valid ${p.validation.watertight ? 'ok' : 'bad'}`}>{p.validation.watertight ? '✓ szczelna' : '✗ otwarta'}</span>
                <span className="peg-badge">{(p.validation.triangles / 1000).toFixed(0)}k trój. · {p.validation.volume.toFixed(1)} cm³</span>
                {jointSummary(p) && <span className="peg-badge" title="Czop: kwadratowy kołek wchodzący w gniazdo z luzem 0,2 mm. Wpust: cienka część wchodzi w szczelinę swojego kształtu.">{jointSummary(p)}</span>}
              </li>
            ))}
          </ul>
          {result.pieces.filter((p) => p.clashesWith.length).map((p) => (
            <div key={p.id} className="msg warn">
              {p.label} i {p.clashesWith.map(labelOfPiece).join(', ')} przenikają się po złożeniu, a żadnej z tych części nie da się przyciąć bez rozpadnięcia. Wydrukuj jedną z nich razem z resztą.
              <button type="button" className="btn-mini" onClick={() => studio.setSeparate(p.id as PartGroup, false)}>Drukuj razem: {p.label.toLowerCase()}</button>
            </div>
          ))}
          {windowed && (
            <div className="msg info">
              {windowed.label}: między elementami jest otwór na wylot (np. między skrzydłem a ogonem). Bryła jest szczelna i się wydrukuje, ale slicer może dodać podpory nad otworem.
              {splitGroup && (
                <button type="button" className="btn-mini" onClick={() => studio.setSeparate(splitGroup, true)}>
                  Wydrukuj osobno: {splitGroup === 'wings' ? 'skrzydła' : 'ogon'}
                </button>
              )}
            </div>
          )}
          <div className="hint">Objętość razem {totalVol.toFixed(1)} cm³ · czas {(result.ms / 1000).toFixed(1).replace('.', ',')} s · {allOk ? 'wszystkie bryły szczelne (manifold)' : 'uwaga: nieszczelne bryły'}</div>
          <label className="check"><input type="checkbox" checked={job.showBaked && fresh} disabled={!fresh} onChange={(e) => bakeStore.setShowBaked(e.target.checked)} /> Pokaż bryłę do druku w widoku 3D</label>
          <button type="button" className="btn-tile" disabled={!fresh || !allOk}
            onClick={() => { const f = exportBundle(result, studio.creature()); download(f.name, f.bytes); }}>
            ⬇ Pobierz {result.pieces.length > 1 ? 'ZIP z częściami (STL)' : 'STL'}
          </button>
          <button type="button" className="btn-tile" disabled={!fresh || !allOk} title="Bambu Studio, OrcaSlicer, PrusaSlicer: kolory jako pomalowane obszary, filamenty 1–4 = c1, c2, c3, biały"
            onClick={() => { const f = export3mf(result, studio.creature(), PALETTES[genome.palette!.index!]!); download(f.name, f.bytes); }}>
            ⬇ Pobierz 3MF w kolorach (AMS)
          </button>
        </div>
      )}
    </section>
  );
}
