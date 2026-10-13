import { useMemo, useState } from 'react';
import { GENES, describeGene, genesOf, parse, PREFIX } from '../../core';
import { studio, useStudioState } from '../studio';

/**
 * The creature's name and its DNA, gene by gene. Hovering a gene says what it means; the code can be edited in
 * place (B01 -> B03 redraws the body at once). A gene that names no known variant turns red and the part keeps its
 * current shape; everything else still applies.
 */
export function DnaEditor() {
  const { genome } = useStudioState();
  const who = studio.creature();
  const [draft, setDraft] = useState<string | null>(null); // non-null while the user is editing
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; warn: boolean } | null>(null);

  const editing = draft !== null;
  const text = draft ?? who.code;
  const parsed = useMemo(() => (editing ? parse(draft!, genome) : null), [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = new Set(parsed?.ok ? parsed.badGenes : []);

  // chips: the typed tokens while editing, else the genes of the current creature
  const chips = editing
    ? text.toUpperCase().replace(PREFIX, '').split('#')[0]!.split(/[\s:;,]+/).filter(Boolean).map((tok) => {
      const gd = GENES.find((g) => g.letter === tok[0]);
      const ok = !bad.has(tok) && !!gd && parsed?.ok;
      return { text: tok, title: ok && parsed?.ok ? describeGene(parsed.genome, gd!) : 'Nieznany gen: część zostaje bez zmian', bad: !ok };
    })
    : genesOf(genome).map(({ gene, text: t }) => ({ text: t, title: describeGene(genome, gene), bad: false }));

  const edit = (value: string): void => {
    setDraft(value);
    const r = parse(value, genome);
    if (!r.ok) return setMsg({ text: r.message, warn: true });
    studio.loadCode(value, genome);
    if (r.badGenes.length) setMsg({ text: `Nieznane geny: ${r.badGenes.join(', ')}. Te części zostają bez zmian.`, warn: true });
    else if (!r.checksumOk) setMsg({ text: 'Suma kontrolna się nie zgadza (literówka albo ręczna zmiana). Stwór wczytany.', warn: true });
    else setMsg(null);
  };
  const finish = (): void => { setDraft(null); };

  const saveName = (): void => { if (nameDraft !== null) studio.setName(nameDraft); setNameDraft(null); };

  return (
    <section className="tile">
      <header className="tile-header"><span className="tile-title">🧬 Imię i DNA</span></header>
      <div className="control-label">Imię (pliki: „Morphoid {who.name}”):</div>
      <input className="dna-input name-input" value={nameDraft ?? who.name} maxLength={40} spellCheck={false}
        onChange={(e) => setNameDraft(e.target.value)} onBlur={saveName}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setNameDraft(null); }} />

      <div className="control-label">Geny (najedź, aby zobaczyć znaczenie):</div>
      <div className="gene-strip" aria-label="Geny">
        {chips.map((c, i) => (
          <span key={i} className={`gene-chip${c.bad ? ' bad' : ''}`} title={c.title}>
            <b>{c.text[0]}</b>{c.text.slice(1)}
          </span>
        ))}
      </div>

      <div className="control-label">Kod DNA (wklej albo zmień, np. B01 → B03):</div>
      <textarea className="dna-input dna-edit" rows={4} value={text} spellCheck={false}
        onChange={(e) => edit(e.target.value)} onBlur={finish}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
      {msg && <div className={`msg${msg.warn ? ' warn' : ''}`} role="status">{msg.text}</div>}
    </section>
  );
}
