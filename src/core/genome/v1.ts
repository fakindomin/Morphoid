/**
 * Reader for the first code format (`MPH` + 26 hex: 13 bit-packed bytes, CRC-4 in the last one), kept so saved codes
 * and links still open. The layout below is frozen: it is how those codes were written, whatever the schema becomes.
 */
import type { BlockId } from './schema';

type V1Field = [name: string, bits: number, range: number];
const V1: readonly [BlockId, V1Field[]][] = [
  ['body', [['shape', 2, 3], ['length', 3, 6], ['girth', 3, 6]]],
  ['legs', [['count', 1, 2], ['foot', 2, 3], ['length', 3, 6]]],
  ['head', [['skull', 3, 3], ['neck', 2, 3], ['neckLength', 3, 6]]],
  ['snout', [['type', 2, 3], ['reach', 3, 6]]],
  ['ears', [['type', 3, 4], ['scale', 3, 6]]],
  ['horns', [['type', 3, 5], ['span', 3, 6]]],
  ['wings', [['type', 2, 3], ['scale', 3, 6]]],
  ['tail', [['type', 2, 4], ['length', 3, 6]]],
  ['crest', [['type', 3, 4], ['scale', 3, 6]]],
  ['face', [['eyes', 2, 3], ['teeth', 2, 3], ['whiskers', 2, 3], ['expression', 2, 3]]],
  ['coat', [['texture', 3, 4], ['pattern', 3, 3]]],
  ['accessory', [['type', 4, 3]]],
  ['palette', [['index', 4, 16]]],
];
export const V1_HEX_LENGTH = 26;

/** CRC-4/ITU (poly x^4+x+1), as the first format used it. */
function crc4(nibbles: readonly number[]): number {
  let crc = 0;
  for (const n of nibbles) {
    for (let bit = 3; bit >= 0; bit--) {
      const top = (crc >> 3) & 1;
      crc = (crc << 1) & 0xf;
      if (top ^ ((n >> bit) & 1)) crc ^= 0x3;
    }
  }
  return crc;
}

/** Field values of a first-format payload (26 hex digits); fields the current schema no longer has are dropped later. */
export function readV1(hex: string, warnings: string[]): { values: Record<BlockId, Record<string, number>>; checksumOk: boolean } {
  const bytes = Array.from({ length: V1.length }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  const last = V1.length - 1;
  const pal = bytes[last]! & 0xf;
  const nibbles: number[] = [];
  for (const b of bytes.slice(0, last)) nibbles.push(b >> 4, b & 0xf);
  nibbles.push(pal);
  const checksumOk = bytes[last]! >> 4 === crc4(nibbles);
  const values = {} as Record<BlockId, Record<string, number>>;
  V1.forEach(([block, fields], i) => {
    const byte = i === last ? pal << 4 : bytes[i]!;
    let used = 0;
    values[block] = {};
    for (const [name, bits, range] of fields) {
      used += bits;
      const raw = (byte >> (8 - used)) & ((1 << bits) - 1);
      if (raw >= range) warnings.push(`${block}.${name}: ${raw} poza zakresem, ustawiono ${range - 1}`);
      values[block]![name] = Math.min(raw, range - 1);
    }
  });
  return { values, checksumOk };
}
