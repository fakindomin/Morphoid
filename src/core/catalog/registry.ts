/**
 * The variant registry: every variant number each gene letter has handed out, read from the schema.
 *
 * Numbers come from the order of a field's options (see GENES in the schema), so the schema stays the one place a
 * variant is added. `registry.lock.json` records every number ever released; the registry test fails if a number
 * disappears, changes meaning (its key) or is handed out twice. To add a variant: append it to the field's options,
 * run `npm run lock`, commit both. To stop offering one: mark it `retired` (old codes still draw it).
 */
import { BLOCKS, GENES, type EnumField } from '../genome/schema';
import { variantId } from '../genome/codec';

export interface Variant { id: number; key: string; label: string; retired: boolean }
export interface GeneEntry { letter: string; label: string; variants: Variant[] }

export function registry(): GeneEntry[] {
  return GENES.map((g) => {
    if (!g.variant) return { letter: g.letter, label: g.label, variants: [{ id: 0, key: 'none', label: 'Brak', retired: false }] };
    const { block, field } = g.variant;
    const f = BLOCKS.find((b) => b.id === block)!.fields.find((x) => x.name === field) as EnumField;
    return {
      letter: g.letter, label: g.label,
      variants: f.options.map((o, i) => ({ id: variantId(block, field, i), key: o.id, label: o.label, retired: !!o.retired })),
    };
  });
}

/** letter -> { "01": key, ... }: the shape of registry.lock.json */
export type Lock = Record<string, Record<string, string>>;

export const lockOf = (entries: GeneEntry[]): Lock => Object.fromEntries(entries.map((e) => [
  e.letter, Object.fromEntries(e.variants.map((v) => [v.id.toString(16).toUpperCase().padStart(2, '0'), v.key])),
]));

/** Differences that break released codes: a locked number missing or meaning something else. */
export function lockViolations(locked: Lock, now: Lock): string[] {
  const out: string[] = [];
  for (const [letter, ids] of Object.entries(locked)) {
    for (const [id, key] of Object.entries(ids)) {
      const cur = now[letter]?.[id];
      if (cur === undefined) out.push(`${letter}${id} (${key}) usunięty`);
      else if (cur !== key) out.push(`${letter}${id} zmienił znaczenie: ${key} -> ${cur}`);
    }
  }
  for (const [letter, ids] of Object.entries(now)) {
    const keys = Object.values(ids);
    for (const k of new Set(keys)) if (keys.filter((x) => x === k).length > 1) out.push(`${letter}: wariant ${k} ma dwa numery`);
  }
  return out;
}
