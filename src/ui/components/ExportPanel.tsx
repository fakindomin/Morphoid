import { useRef, useState } from 'react';
import { exportBundle } from '../../core/bake/orient';
import { VOXEL_MM, type BakeQuality, type BakeResult } from '../../core/bake/bake';
import { runBake, type BakeHandle } from '../bakeClient';
import { studio, useStudioState } from '../studio';

export interface BakeState { result: BakeResult; signature: string }

export const signatureOf = (code: string, separate: readonly string[]): string => `${code}|${[...separate].sort().join(',')}`;

const QUALITY: { id: BakeQuality; label: string; hint: string }[] = [
  { id: 'draft', label: 'Szkic', hint: `${VOXEL_MM.draft} mm, ok. 0,5 s` },
  { id: 'standard', label: 'Standard', hint: `${VOXEL_MM.standard} mm, kilka s` },
  { id: 'fine', label: 'Dokładny', hint: `${VOXEL_MM.fine} mm, ok. 10 s` },
];

function download(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: name.endsWith('.zip') ? 'application/zip' : 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ExportPanel({ baked, setBaked, showBaked, setShowBaked }: {
  baked: BakeState | null; setBaked: (b: BakeState | null) => void; showBaked: boolean; setShowBaked: (v: boolean) => void;
}) {
  const { genome, plan } = useStudioState();
  const [quality, setQuality] = useState<BakeQuality>('standard');
  const [busy, setBusy] = useState<{ stage: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<BakeHandle | null>(null);
  const code = studio.code();
  const signature = signatureOf(code, plan.separate);
  const stale = baked !== null && baked.signature !== signature;

  const start = (): void => {
    setError(null); setBusy({ stage: 'start', pct: 0 });
    const h = runBake(genome, plan, quality, (stage, done, total) => setBusy({ stage, pct: Math.round((done / total) * 100) }));
    handle.current = h;
    h.promise
      .then((result) => { setBaked({ result, signature }); setShowBaked(true); })
      .catch((e: Error) => { if (e.message !== 'cancelled') setError(e.message); })
      .finally(() => { setBusy(null); handle.current = null; });
  };

  const result = baked?.result;
  const allOk = result?.pieces.every((p) => p.validation.watertight && p.validation.volume > 0);
  const totalVol = result?.pieces.reduce((s, p) => s + p.validation.volume, 0) ?? 0;

  return (
    <section className="tile">
      <header className="tile-header"><span className="tile-title">📦 Eksport do druku</span><span className="tile-status">STL</span></header>
      <p className="hint">Silnik zlewa wszystkie elementy w jedną gładką bryłę (zrost bez szwów) i sprawdza, czy jest szczelna. Części drukowane osobno trafiają do ZIP-a.</p>
      <div className="control-label">Dokładność</div>
      <div className="segment">
        {QUALITY.map((q) => (
          <button key={q.id} type="button" title={q.hint} className={`seg-pill${quality === q.id ? ' active' : ''}`} onClick={() => setQuality(q.id)}>{q.label}</button>
        ))}
      </div>
      {busy ? (
        <>
          <div className="progress" aria-label="Postęp"><i style={{ width: `${Math.max(6, busy.pct)}%` }} /></div>
          <button type="button" className="btn-tile danger" onClick={() => handle.current?.cancel()}>Anuluj</button>
        </>
      ) : (
        <button type="button" className="btn-tile" onClick={start}>{result ? '↻ Przygotuj ponownie' : '⚙ Przygotuj bryłę do druku'}</button>
      )}
      {error && <div className="msg warn">Błąd: {error}</div>}
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
          <div className="hint">Objętość razem {totalVol.toFixed(1)} cm³ · czas {(result.ms / 1000).toFixed(1)} s · {allOk ? 'wszystkie bryły szczelne (manifold)' : 'uwaga: nieszczelne bryły'}</div>
          <label className="check"><input type="checkbox" checked={showBaked && !stale} disabled={stale} onChange={(e) => setShowBaked(e.target.checked)} /> Pokaż bryłę do druku w widoku 3D</label>
          <button type="button" className="btn-tile" disabled={stale || !allOk}
            onClick={() => { const f = exportBundle(result, code); download(f.name, f.bytes); }}>
            ⬇ Pobierz {result.pieces.length > 1 ? 'ZIP z częściami (STL)' : 'STL'}
          </button>
        </div>
      )}
    </section>
  );
}
