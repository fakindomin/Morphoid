import {
  BLOCKS, BLOCK_COUNT, CODE_LENGTH, HEX_LENGTH, PREFIX, SIZE_CLASSES, STEPS,
  blockDef, type BlockDef, type BlockId, type Field,
} from './schema';

/** blockId -> fieldName -> value. Always fully populated and canonical. */
export type MorphotypeGenome = Record<BlockId, Record<string, number>>;

export type ParseErrorCode = 'EMPTY' | 'BAD_LENGTH';
export interface ParseOk {
  ok: true;
  genome: MorphotypeGenome;
  /** false when the checksum nibble does not match (typo, or legacy code). */
  checksumOk: boolean;
  /** clamped/ignored values, for UI toasts. */
  warnings: string[];
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

// -------------------------------------------------------------- bit packing

function packBlock(b: BlockDef, vals: Record<string, number>): number {
  let byte = 0;
  let used = 0;
  for (const f of b.fields) {
    used += f.bits;
    byte |= (vals[f.name] ?? 0) << (8 - used);
  }
  return byte;
}

function unpackBlock(b: BlockDef, byte: number, warnings: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  let used = 0;
  for (const f of b.fields) {
    used += f.bits;
    const raw = (byte >> (8 - used)) & ((1 << f.bits) - 1);
    const max = fieldRange(f);
    if (raw >= max) {
      warnings.push(`${b.letter}.${f.name}: ${raw} poza zakresem, ustawiono ${max - 1}`);
      out[f.name] = max - 1;
    } else out[f.name] = raw;
  }
  return out;
}

// ---------------------------------------------------------------- checksum

/** CRC-4/ITU (poly x^4+x+1). Detects every single-hex-digit error. */
export function crc4(nibbles: readonly number[]): number {
  let crc = 0;
  for (const n of nibbles) {
    for (let bit = 3; bit >= 0; bit--) {
      const inbit = (n >> bit) & 1;
      const top = (crc >> 3) & 1;
      crc = (crc << 1) & 0xf;
      if (top ^ inbit) crc ^= 0x3;
    }
  }
  return crc;
}

function checksumOf(dataBytes: readonly number[], paletteNibble: number): number {
  const nibbles: number[] = [];
  for (const b of dataBytes) nibbles.push(b >> 4, b & 0xf);
  nibbles.push(paletteNibble);
  return crc4(nibbles);
}

// -------------------------------------------------------- (de)serialisation

export function toBytes(genome: MorphotypeGenome): Uint8Array {
  const g = canonicalize(genome);
  const bytes = new Uint8Array(BLOCK_COUNT);
  BLOCKS.forEach((b, i) => { bytes[i] = packBlock(b, g[b.id]!); });
  const last = BLOCK_COUNT - 1;
  const palette = bytes[last]! >> 4; // palette field is 4 bits, MSB-first => high nibble
  const sum = checksumOf(Array.from(bytes.slice(0, last)), palette);
  // Final byte layout: [checksum:4][palette:4] (palette moved to the low nibble).
  bytes[last] = (sum << 4) | palette;
  return bytes;
}

export function serialize(genome: MorphotypeGenome): string {
  return PREFIX + Array.from(toBytes(genome), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Accepts `MPH0204...`, segmented `MPH-02-04-...`, lowercase, surrounding
 * text and whitespace. Prefix is located first, so letters in surrounding
 * words can never leak into the hex payload.
 */
export function parse(input: string): ParseResult {
  const upper = input.toUpperCase();
  const at = upper.indexOf(PREFIX);
  const body = at >= 0 ? upper.slice(at + PREFIX.length) : upper;
  const hex = body.replace(/[^0-9A-F]/g, '');
  if (hex.length === 0) return { ok: false, code: 'EMPTY', message: 'Brak kodu Morphotypu' };
  // A trailing sentence after the code could add stray hex digits; take exactly 26.
  if (hex.length < HEX_LENGTH || (at < 0 && hex.length !== HEX_LENGTH)) {
    return { ok: false, code: 'BAD_LENGTH',
      message: `Kod ma ${hex.length} znaków HEX, oczekiwano ${HEX_LENGTH} (${CODE_LENGTH} z prefiksem MPH)` };
  }
  const payload = hex.slice(0, HEX_LENGTH);
  const bytes = Array.from({ length: BLOCK_COUNT }, (_, i) => parseInt(payload.slice(i * 2, i * 2 + 2), 16));

  const warnings: string[] = [];
  if (hex.length > HEX_LENGTH) warnings.push(`Ignorowano ${hex.length - HEX_LENGTH} nadmiarowych znaków`);

  const last = BLOCK_COUNT - 1;
  const palNibble = bytes[last]! & 0xf;
  const storedSum = bytes[last]! >> 4;
  const checksumOk = storedSum === checksumOf(bytes.slice(0, last), palNibble);

  const raw = {} as MorphotypeGenome;
  BLOCKS.forEach((b, i) => {
    // Palette byte on the wire is [crc][palette]; unpack as if palette sat in the high nibble.
    const byte = i === last ? palNibble << 4 : bytes[i]!;
    raw[b.id] = unpackBlock(b, byte, warnings);
  });
  return { ok: true, genome: canonicalize(raw), checksumOk, warnings };
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

export function randomGenome(rand: () => number): MorphotypeGenome {
  const g = defaultGenome();
  for (const b of BLOCKS) for (const f of b.fields) g[b.id]![f.name] = Math.floor(rand() * fieldRange(f));
  return canonicalize(g);
}

/** Change `count` random fields by one notch/variant. */
export function mutate(g: MorphotypeGenome, rand: () => number, count = 2): MorphotypeGenome {
  let out = cloneGenome(g);
  const all = BLOCKS.flatMap((b) => b.fields.map((f) => [b, f] as const));
  for (let i = 0; i < count; i++) {
    const [b, f] = all[Math.floor(rand() * all.length)]!;
    const range = fieldRange(f);
    const cur = out[b.id]![f.name]!;
    const delta = f.kind === 'step' ? (rand() < 0.5 ? -1 : 1) : 1 + Math.floor(rand() * (range - 1 || 1));
    out[b.id]![f.name] = f.kind === 'step' ? Math.max(0, Math.min(range - 1, cur + delta)) : (cur + delta) % range;
    out = canonicalize(out);
  }
  return out;
}

export const genomeEquals = (a: MorphotypeGenome, b: MorphotypeGenome): boolean => serialize(a) === serialize(b);
