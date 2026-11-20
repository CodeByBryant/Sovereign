import { utf8Bytes } from '../serialization/utf8'
import { fnv1a32 } from './streams'

const TWO_POW_32 = 4_294_967_296

/**
 * Turn whatever the user typed (or a host chose) into the engine's seed, an integer in
 * `[0, 2^32 - 1]`.
 *
 * - A number must already be such an integer; anything else is a programmer error (`RangeError`).
 * - A canonical digit string ("0", "12345", no leading zeros) that fits in 32 bits is the number
 *   it spells, so typing `12345` and passing `12345` give the same world.
 * - Any other text is hashed with FNV-1a 32 over its UTF-8 bytes.
 */
export function normalizeSeed(input: number | string): number {
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 0 || input >= TWO_POW_32) {
      throw new RangeError('seed must be an integer in [0, 2^32 - 1]')
    }
    return input
  }
  if (/^(0|[1-9][0-9]*)$/.test(input)) {
    const value = Number(input)
    if (value < TWO_POW_32) return value
  }
  return fnv1a32(utf8Bytes(input))
}
