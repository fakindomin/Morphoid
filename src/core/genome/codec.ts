import {
  BLOCKS, GENES, PREFIX, SIZE_CLASSES, STEPS,
  blockDef, type BlockDef, type BlockId, type Field, type GeneDef,
} from './schema';
import { readV1, V1_HEX_LENGTH } from './v1';

/** blockId -> fieldName -> value. Always fully populated and canonical. */
export type MorphotypeGenome = Record<BlockId, Record<string, number>>;

export type ParseErrorCode = 'EMPTY' | 'BAD_LENGTH' | 'BAD_CODE';
export interface ParseOk {
  ok: true;
  genome: MorphotypeGenome;
  /** false when the checksum does not match (a typo or a hand edit); true when the code carries none. */
  checksumOk: boolean;
  /** clamped/ignored values, for UI toasts. */
  warnings: string[];
  /** genes as typed that name no known variant or size; the rest of the creature is still read */
  badGenes: string[];
}
export interface ParseErr { ok: false; code: ParseErrorCode; message: string }
export type ParseResult = ParseOk | ParseErr;

// ---------------------------------------------------------------- creation

export function defaultGenome(): MorphotypeGenome {
  const g = {} as MorphotypeGenome;
  for (const b of BLOCKS) {
    g[b.id] = {};
    for (const f of b.fields) g[b.id]![f.name] = defaultValue(b, f);
  }
  return canonicalize(g);
}

function defaultValue(_b: BlockDef, f: Field): number {
  return f.kind === 'step' ? 2 : f.def; // step 2 = first step of class 1 ("2: Średni")
}

export const cloneGenome = (g: MorphotypeGenome): MorphotypeGenome =>
  Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { ...v }])) as MorphotypeGenome;

/** Fieldwise max value (exclusive) for validation. */
export const fieldRange = (f: Field): number => (f.kind === 'step' ? STEPS : f.options.length);

/** Clamp every field into its legal range, zero 'none' blocks. Pure. */
export function canonicalize(g: MorphotypeGenome): MorphotypeGenome {
  const out = cloneGenome(g);
  for (const b of BLOCKS) {
    const blk = out[b.id] ?? (out[b.id] = {});
    for (const f of b.fields) {
      const v = blk[f.name];
      blk[f.name] = Number.isInteger(v) ? Math.max(0, Math.min(fieldRange(f) - 1, v as number)) : 0;
    }
    if (b.noneMeansEmpty && blk[b.fields[0]!.name] === 0) {
      for (const f of b.fields) blk[f.name] = 0;
    }
  }
  // a gene whose part is absent writes its size and direction digits as 0: those fields are 0 too (whiskers off)
  for (const gd of GENES) {
    if (!gd.variant || gd.variant.block === 'palette') continue;
    const f = blockDef(gd.variant.block).fields.find((x) => x.name === gd.variant!.field)!;
    if (f.kind === 'enum' && f.options[0]?.id === 'none' && out[gd.variant.block]![gd.variant.field] === 0) {
      for (const sz of gd.sizes) out[sz.block]![sz.field] = 0;
    }
  }
  return out;
}

// ------------------------------------------------------------ N -> 2N rule

/** 2D size class (0..2) for a 3D step (0..5): the threshold rule. */
export const stepToClass = (step: number): number => Math.floor(step / (STEPS / SIZE_CLASSES));

/** Step to use when the user picks a 2D class: keep current step if it is
 *  already inside that class (idempotent), else the first step of the class. */
export function classToStep(cls: number, currentStep: number): number {
  const c = Math.max(0, Math.min(SIZE_CLASSES - 1, cls));
  return stepToClass(currentStep) === c ? currentStep : c * (STEPS / SIZE_CLASSES);
}

// ------------------------------------------------------------------ genes

const field = (block: BlockId, name: string): Field => blockDef(block).fields.find((f) => f.name === name)!;

/** An enum with a "none" first option (and the palette) is numbered from 00, any other from 01. */
const zeroBased = (block: BlockId, f: Field): boolean =>
  block === 'palette' || (f.kind === 'enum' && f.options[0]?.id === 'none');

/** Stable variant number of the value stored in a field. */
export const variantId = (block: BlockId, name: string, value: number): number =>
  zeroBased(block, field(block, name)) ? value : value + 1;

/** Field value for a variant number, or null when no such variant exists. */
export function variantValue(block: BlockId, name: string, id: number): number | null {
  const f = field(block, name);
  const v = zeroBased(block, f) ? id : id - 1;
  return v >= 0 && v < fieldRange(f) ? v : null;
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

/** One gene as written in the code, e.g. `B01.33`, `R00.0`, `H02`. */
export function geneText(g: MorphotypeGenome, gd: GeneDef): string {
  const id = gd.variant ? variantId(gd.variant.block, gd.variant.field, g[gd.variant.block]![gd.variant.field]!) : 0;
  const absent = id === 0 && gd.variant !== null && zeroBased(gd.variant.block, field(gd.variant.block, gd.variant.field));
  const sizes = gd.sizes.map((sz) => (absent ? '0' : String(g[sz.block]![sz.field]! + 1))).join('');
  return gd.letter + hex2(id) + (gd.sizes.length ? '.' + sizes : '');
}

// ---------------------------------------------------------------- checksum

/** CRC-8 (poly 0x07) over the code text before '#'. Detects every single-character typo. */
export function crc8(text: string): number {
  let crc = 0;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) & 0xff;
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

// -------------------------------------------------------- (de)serialisation

export function serialize(genome: MorphotypeGenome): string {
  const g = canonicalize(genome);
  const body = [PREFIX, ...GENES.map((gd) => geneText(g, gd))].join(':');
  return `${body}#${hex2(crc8(body))}`;
}

/** Each gene's text, in code order (for the DNA strip in the UI). */
export const genesOf = (genome: MorphotypeGenome): { gene: GeneDef; text: string }[] => {
  const g = canonicalize(genome);
  return GENES.map((gene) => ({ gene, text: geneText(g, gene) }));
};

/** What a gene says, in words: "Tułów: Beczka · Długość 3 · Pękatość 4". */
export function describeGene(genome: MorphotypeGenome, gd: GeneDef): string {
  if (!gd.variant) return `${gd.label}: brak (wkrótce)`;
  const { block, field: name } = gd.variant;
  const f = field(block, name);
  const v = genome[block]![name]!;
  const variant = f.kind === 'enum' ? f.options[v]?.label ?? '?' : String(v + 1);
  const absent = variantId(block, name, v) === 0 && zeroBased(block, f);
  const sizes = absent ? [] : gd.sizes.map((sz) => {
    const sf = field(sz.block, sz.field), v2 = genome[sz.block]![sz.field]!;
    return sf.kind === 'step' ? `${sf.label} ${v2 + 1}` : `Kierunek: ${sf.options[v2]?.label ?? '?'}`;
  });
  return [`${gd.label}: ${variant}`, ...sizes].join(' · ');
}

const GENE_RE = /^([A-Z])([0-9A-F]{2})(?:\.([0-9]*))?$/;

function parseV2(body: string, base?: MorphotypeGenome): ParseResult {
  const hash = body.indexOf('#');
  const stored = hash >= 0 ? body.slice(hash + 1).match(/^\s*([0-9A-F]{2})/)?.[1] : undefined;
  const tokens = (hash >= 0 ? body.slice(0, hash) : body).split(/[\s:;,]+/).filter(Boolean);
  if (!tokens.length) return { ok: false, code: 'EMPTY', message: 'Brak genów w kodzie' };

  const g = cloneGenome(base ?? defaultGenome());
  const warnings: string[] = [], badGenes: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokens) {
    const m = tok.match(GENE_RE);
    const gd = m ? GENES.find((x) => x.letter === m[1]) : undefined;
    if (!m || !gd) { badGenes.push(tok); continue; }
    if (seen.has(gd.letter)) { warnings.push(`Gen ${gd.letter} powtórzony, użyto pierwszego`); continue; }
    seen.add(gd.letter);
    const id = parseInt(m[2]!, 16);
    if (gd.variant) {
      const v = variantValue(gd.variant.block, gd.variant.field, id);
      if (v === null) { badGenes.push(tok); continue; }
      g[gd.variant.block]![gd.variant.field] = v;
    } else if (id !== 0) { badGenes.push(tok); continue; }
    const digits = m[3] ?? '';
    gd.sizes.forEach((sz, i) => {
      const d = Number(digits[i] ?? NaN);
      if (d >= 1 && d <= fieldRange(field(sz.block, sz.field))) g[sz.block]![sz.field] = d - 1;
      else if (!(d === 0 || Number.isNaN(d))) badGenes.push(tok);
    });
  }
  if (!seen.size) return { ok: false, code: 'BAD_CODE', message: 'Nie rozpoznano żadnego genu' };
  const checksumOk = stored === undefined || parseInt(stored, 16) === crc8([PREFIX, ...tokens].join(':'));
  return { ok: true, genome: canonicalize(g), checksumOk, warnings, badGenes: [...new Set(badGenes)] };
}

/** First format: `MPH` + 26 hex digits (also segmented `MPH-02-04-...`). */
function parseV1(upper: string, at: number): ParseResult {
  const hex = (at >= 0 ? upper.slice(at + 3) : upper).replace(/[^0-9A-F]/g, '');
  if (hex.length === 0) return { ok: false, code: 'EMPTY', message: 'Brak kodu Morphotypu' };
  if (hex.length < V1_HEX_LENGTH || (at < 0 && hex.length !== V1_HEX_LENGTH)) {
    return { ok: false, code: 'BAD_LENGTH', message: `Nie rozpoznano kodu (oczekiwano ${PREFIX}:… albo starego MPH + ${V1_HEX_LENGTH} znaków HEX)` };
  }
  const warnings: string[] = [];
  if (hex.length > V1_HEX_LENGTH) warnings.push(`Ignorowano ${hex.length - V1_HEX_LENGTH} nadmiarowych znaków`);
  const { values, checksumOk } = readV1(hex.slice(0, V1_HEX_LENGTH), warnings);
  const g = defaultGenome();
  for (const b of BLOCKS) for (const f of b.fields) {
    const v = values[b.id]?.[f.name];
    if (v !== undefined) g[b.id]![f.name] = v;
  }
  return { ok: true, genome: canonicalize(g), checksumOk, warnings, badGenes: [] };
}

/**
 * Accepts a v2 code `MPH2:B01.33:…#CC` (any case, extra spaces, the checksum optional) and the first format
 * `MPH0204…`. The prefix is located first, so words around the code cannot leak into it. Genes that are missing or
 * bad keep the value from `base` (default: the default creature), so a hand edit only changes what it names.
 */
export function parse(input: string, base?: MorphotypeGenome): ParseResult {
  const upper = input.toUpperCase();
  const at2 = upper.indexOf(PREFIX);
  if (at2 >= 0) return parseV2(upper.slice(at2 + PREFIX.length), base);
  if (!upper.trim()) return { ok: false, code: 'EMPTY', message: 'Brak kodu Morphotypu' };
  // bare genes without the prefix
  if (/^[\s:]*[A-Z][0-9A-F]{2}(\.\d*)?([\s:;,]+[A-Z][0-9A-F]{2}(\.\d*)?)*\s*(#.*)?$/.test(upper)) return parseV2(upper, base);
  return parseV1(upper, upper.indexOf('MPH'));
}

// ------------------------------------------------------------------ editing

export function setField(g: MorphotypeGenome, block: BlockId, field: string, value: number): MorphotypeGenome {
  blockDef(block); // throws on unknown block
  const next = cloneGenome(g);
  next[block]![field] = value;
  return canonicalize(next);
}

/** Pick a 2D size class for a block's step field. */
export function setSizeClass(g: MorphotypeGenome, block: BlockId, field: string, cls: number): MorphotypeGenome {
  return setField(g, block, field, classToStep(cls, g[block]![field] ?? 0));
}

// --------------------------------------------------------------- randomness

/** Deterministic PRNG so "randomize" is reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Values a menu or the dice may pick: every step, every enum option that is not retired. */
export const offered = (f: Field): number[] =>
  f.kind === 'step' ? Array.from({ length: STEPS }, (_, i) => i) : f.options.flatMap((o, i) => (o.retired ? [] : [i]));

export function randomGenome(rand: () => number): MorphotypeGenome {
  const g = defaultGenome();
  for (const b of BLOCKS) for (const f of b.fields) {
    const vals = offered(f);
    g[b.id]![f.name] = vals[Math.floor(rand() * vals.length)]!;
  }
  return canonicalize(g);
}

/** Change `count` random fields by one notch/variant. */
export function mutate(g: MorphotypeGenome, rand: () => number, count = 2): MorphotypeGenome {
  let out = cloneGenome(g);
  const all = BLOCKS.flatMap((b) => b.fields.map((f) => [b, f] as const));
  for (let i = 0; i < count; i++) {
    const [b, f] = all[Math.floor(rand() * all.length)]!;
    const cur = out[b.id]![f.name]!;
    if (f.kind === 'step') out[b.id]![f.name] = Math.max(0, Math.min(STEPS - 1, cur + (rand() < 0.5 ? -1 : 1)));
    else {
      const others = offered(f).filter((v) => v !== cur);
      if (others.length) out[b.id]![f.name] = others[Math.floor(rand() * others.length)]!;
    }
    out = canonicalize(out);
  }
  return out;
}

export const genomeEquals = (a: MorphotypeGenome, b: MorphotypeGenome): boolean => serialize(a) === serialize(b);
