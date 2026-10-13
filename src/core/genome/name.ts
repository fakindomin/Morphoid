/**
 * A creature's name, drawn from its DNA code: the same code always gets the same name, also for someone who pastes
 * it. Files are named "Morphoid <Name>". A name the user types in the studio is kept locally next to the code, never
 * in the DNA.
 */

/** FNV-1a, 32-bit. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/** 6 hex digits identifying a code where the whole code does not fit (the 80-byte STL header). */
export const shortHash = (code: string): string => hash32(code.split('#')[0]!.toUpperCase()).toString(16).padStart(8, '0').slice(0, 6);

const ONSET = ['b', 'br', 'd', 'dr', 'f', 'g', 'gr', 'k', 'kr', 'l', 'm', 'n', 'p', 'pl', 'r', 's', 'sk', 't', 'tr', 'w', 'z', 'ch', 'sz', 'cz'];
const VOWEL = ['a', 'e', 'i', 'o', 'u', 'y', 'a', 'o'];
const CODA = ['', '', 'n', 'k', 'l', 'm', 'r', 's', 'x', 'lik', 'ek', 'uś', 'ot', 'ix'];

export function creatureName(code: string): string {
  let h = hash32(code.split('#')[0]!.toUpperCase());
  const next = (n: number): number => { const v = h % n; h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0; h = (h + 0x9e3779b9) >>> 0; return v; };
  const syllables = 2 + next(2);
  let out = '';
  for (let i = 0; i < syllables; i++) out += ONSET[next(ONSET.length)]! + VOWEL[next(VOWEL.length)]!;
  const coda = CODA[next(CODA.length)]!;
  out = /^[aeiouyą-ż]/.test(coda) ? out.slice(0, -1) + coda : out + coda; // no vowel pile-up ("-oek")
  return out[0]!.toUpperCase() + out.slice(1);
}

/** "Morphoid <Name>" with characters that file systems reject removed. */
export const fileBase = (name: string): string => `Morphoid ${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim() || 'Bez imienia'}`;
