import { exportBundle } from '../../core/bake/orient';
import { VOXEL_MM, type BakeQuality } from '../../core/bake/bake';
import { bakeStore } from '../bakeStore';
import { download } from '../download';
import { studio } from '../studio';
import { BakeProgressBar, useBakeFresh } from './BakeStatus';

const QUALITY: { id: BakeQuality; label: string; hint: string }[] = [
  { id: 'draft', label: 'Szkic', hint: `${VOXEL_MM.draft} mm: ułamek sekundy` },
  { id: 'standard', label: 'Standard', hint: `${VOXEL_MM.standard} mm: ok. 1 s` },
  { id: 'fine', label: 'Dokładny', hint: `${VOXEL_MM.fine} mm: kilka sekund, do ok. 0,5 GB pamięci` },
];

/** Chrome reports the device RAM in GB; the finest bake needs roughly half a gigabyte. */
const lowMemory = (): boolean => { const m = (navigator as Navigator & { deviceMemory?: number }).deviceMemory; return m !== undefined && m <= 2; };

export function ExportPanel() {
  const { job, fresh, stale } = useBakeFresh();
  const code = studio.code();
  const result = job.result;
  const running = job.status === 'running';
  const allOk = result?.pieces.every((p) => p.validation.watertight && p.validation.volume > 0);
  const totalVol = result?.pieces.reduce((s, p) => s + p.validation.volume, 0) ?? 0;

  return (
    <section className="tile">
      <header className="tile-header"><span className="tile-title">📦 Eksport do druku</span><span className="tile-status">STL</span></header>
      <p className="hint">Zamienia model na jedną gładką, szczelną bryłę (zrost bez szwów) i sprawdza ją. Części drukowane osobno trafiają do ZIP-a. Przygotowanie trwa od ułamka sekundy do kilku sekund i dzieje się w tle.</p>
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
              </li>
            ))}
          </ul>
          <div className="hint">Objętość razem {totalVol.toFixed(1)} cm³ · czas {(result.ms / 1000).toFixed(1).replace('.', ',')} s · {allOk ? 'wszystkie bryły szczelne (manifold)' : 'uwaga: nieszczelne bryły'}</div>
          <label className="check"><input type="checkbox" checked={job.showBaked && fresh} disabled={!fresh} onChange={(e) => bakeStore.setShowBaked(e.target.checked)} /> Pokaż bryłę do druku w widoku 3D</label>
          <button type="button" className="btn-tile" disabled={!fresh || !allOk}
            onClick={() => { const f = exportBundle(result, code); download(f.name, f.bytes); }}>
            ⬇ Pobierz {result.pieces.length > 1 ? 'ZIP z częściami (STL)' : 'STL'}
          </button>
        </div>
      )}
    </section>
  );
}
