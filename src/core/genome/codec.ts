import {
  BLOCKS, FINE_LEVELS, FINE_ZERO, GENES, PREFIX, SIZE_CLASSES, STEPS,
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
  return f.kind === 'step' ? 2 : f.kind === 'fine' ? FINE_ZERO : f.def; // step 2 = first step of class 1 ("2: Średni")
}

export const cloneGenome = (g: MorphotypeGenome): MorphotypeGenome =>
  Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { ...v }])) as MorphotypeGenome;

/** Fieldwise max value (exclusive) for validation. */
export const fieldRange = (f: Field): number => (f.kind === 'step' ? STEPS : f.kind === 'fine' ? FINE_LEVELS : f.options.length);

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

// ------------------------------------------------------------- deformation

/** A fine field as a fraction of one step (coarse) or a scale offset: level 8 = 0. */
export const fineOffset = (v: number): number => (v - FINE_ZERO) / FINE_LEVELS;
/** Scale of a plain deformation slider: 5% per level, 0.6 .. 1.35. */
export const fineScale = (v: number): number => 1 + (v - FINE_ZERO) * 0.05;
function fineText(f: Field, v: number): string {
  if (f.kind !== 'fine') return '';
  const pct = Math.round(f.coarse ? fineOffset(v) * 100 : (fineScale(v) - 1) * 100);
  return f.coarse ? `${pct >= 0 ? '+' : ''}${pct}% kroku` : `${pct >= 0 ? '+' : ''}${pct}%`;
}

/** The slider position of a fine field with a coarse step: the step plus its fraction (-0.5 .. 0.44). */
export function sculptValue(g: MorphotypeGenome, name: string): number {
  const f = field('sculpt', name);
  const v = g.sculpt![name]!;
  if (f.kind !== 'fine' || !f.coarse) return v;
  return g[f.coarse.block]![f.coarse.field]! + fineOffset(v);
}

/**
 * Set a deformation slider. A slider with a coarse step works across the whole size range: stretched past half a
 * step it carries over into the step (which changes the 2D drawing too) and keeps only the rest as the fine digit.
 */
export function setSculpt(g: MorphotypeGenome, name: string, value: number): MorphotypeGenome {
  const f = field('sculpt', name);
  const next = cloneGenome(g);
  if (f.kind === 'fine' && f.coarse) {
    const s = Math.max(-0.5, Math.min(STEPS - 1 + (FINE_LEVELS - 1 - FINE_ZERO) / FINE_LEVELS, value));
    const step = Math.max(0, Math.min(STEPS - 1, Math.round(s)));
    next[f.coarse.block]![f.coarse.field] = step;
    next.sculpt![name] = Math.max(0, Math.min(FINE_LEVELS - 1, Math.round((s - step) * FINE_LEVELS) + FINE_ZERO));
  } else next.sculpt![name] = Math.max(0, Math.min(FINE_LEVELS - 1, Math.round(value)));
  return canonicalize(next);
}

/** The same creature without its 3D-only deformation (what the 2D sketch draws). */
export function withoutSculpt(g: MorphotypeGenome): MorphotypeGenome {
  const next = cloneGenome(g);
  for (const k of Object.keys(next.sculpt ?? {})) next.sculpt![k] = FINE_ZERO;
  return next;
}

/** Size table value at a step plus a fraction of a step (linear between steps, extended past the ends). */
export function stepAt(table: readonly number[], step: number, frac: number): number {
  const i = Math.max(0, Math.min(table.length - 1, step));
  if (!frac) return table[i]!;
  const j = frac > 0 ? Math.min(table.length - 1, i + 1) : Math.max(0, i - 1);
  const k = j === i ? (frac > 0 ? i - 1 : i + 1) : j; // at the ends: the slope of the last step
  const slope = (table[i]! - table[k]!) / (i - k);
  return table[i]! + slope * frac;
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
  const sizes = gd.sizes.map((sz) => {
    const v = g[sz.block]![sz.field]!;
    if (field(sz.block, sz.field).kind === 'fine') return v.toString(16).toUpperCase(); // one hex digit, 8 = unchanged
    return absent ? '0' : String(v + 1);
  }).join('');
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
  if (!gd.variant && gd.sizes.length) { // the deformation sliders: only the ones moved
    const moved = gd.sizes.flatMap((sz) => {
      const sf = field(sz.block, sz.field), v = genome[sz.block]![sz.field]!;
      return sf.kind === 'fine' && v !== FINE_ZERO ? [`${sf.label} ${fineText(sf, v)}`] : [];
    });
    return `${gd.label}: ${moved.length ? moved.join(' · ') : 'brak'}`;
  }
  if (!gd.variant) return `${gd.label}: brak (wkrótce)`;
  const { block, field: name } = gd.variant;
  const f = field(block, name);
  const v = genome[block]![name]!;
  const variant = f.kind === 'enum' ? f.options[v]?.label ?? '?' : String(v + 1);
  const absent = variantId(block, name, v) === 0 && zeroBased(block, f);
  const sizes = absent ? [] : gd.sizes.map((sz) => {
    const sf = field(sz.block, sz.field), v2 = genome[sz.block]![sz.field]!;
    return sf.kind === 'step' ? `${sf.label} ${v2 + 1}` : sf.kind === 'fine' ? `${sf.label} ${fineText(sf, v2)}`
      : `${sf.label ?? 'Kierunek'}: ${sf.options[v2]?.label ?? '?'}`;
  });
  return [`${gd.label}: ${variant}`, ...sizes].join(' · ');
}

const GENE_RE = /^([A-Z])([0-9A-F]{2})(?:\.([0-9A-F]*))?$/;

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
      if (field(sz.block, sz.field).kind === 'fine') { // one hex digit
        const ch = digits[i];
        if (ch !== undefined) g[sz.block]![sz.field] = parseInt(ch, 16);
        return;
      }
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
  if (/^[\s:]*[A-Z][0-9A-F]{2}(\.[0-9A-F]*)?([\s:;,]+[A-Z][0-9A-F]{2}(\.[0-9A-F]*)?)*\s*(#.*)?$/.test(upper)) return parseV2(upper, base);
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
  f.kind === 'fine' ? [FINE_ZERO] // the dice never deform: that is the sculptor's job
  : f.kind === 'step' ? Array.from({ length: STEPS }, (_, i) => i) : f.options.flatMap((o, i) => (o.retired ? [] : [i]));

export function randomGenome(rand: () => number): MorphotypeGenome {
  const g = defaultGenome();
  for (const b of BLOCKS) for (const f of b.fields) {
    const vals = offered(f);
    g[b.id]![f.name] = vals[Math.floor(rand() * vals.length)]!;
  }
  return canonicalize(g);
}

/**
 * Features a creature can show off: one of them is pushed to its extreme on a dice roll (rule "jedna przesada na
 * stwora"). Each is a size field, used only when its part is there.
 */
const SIGNATURES: readonly { block: BlockId; field: string; when?: (g: MorphotypeGenome) => boolean }[] = [
  { block: 'ears', field: 'scale', when: (g) => g.ears!.type! > 0 },
  { block: 'horns', field: 'span', when: (g) => g.horns!.type! > 0 },
  { block: 'snout', field: 'reach' },
  { block: 'head', field: 'neckLength' },
  { block: 'tail', field: 'length', when: (g) => g.tail!.type! > 0 },
  { block: 'legs', field: 'length' },
  { block: 'crest', field: 'scale', when: (g) => g.crest!.type! > 0 },
  { block: 'wings', field: 'scale', when: (g) => g.wings!.type! > 0 },
];

/**
 * The dice ("Zaskocz mnie"): a random creature with one signature feature. Unique comes from one bold trait, not from
 * ten average ones: the signature goes to its largest size, every other size stays in the calm middle band, so nothing
 * competes with it. Returns the genome and which feature was chosen.
 */
export function surpriseGenome(rand: () => number): MorphotypeGenome {
  const g = randomGenome(rand);
  const pool = SIGNATURES.filter((s) => !s.when || s.when(g));
  const sig = pool[Math.floor(rand() * pool.length)]!;
  for (const b of BLOCKS) for (const f of b.fields) {
    if (f.kind !== 'step') continue;
    const v = g[b.id]![f.name]!;
    if (b.id === sig.block && f.name === sig.field) g[b.id]![f.name] = STEPS - 1;
    else g[b.id]![f.name] = Math.min(STEPS - 2, Math.max(1, v)); // canonicalize zeroes it again on an absent part
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
