import { utf8Bytes } from '../serialization/utf8'
import { FALLBACK_WORDS, SeededRandom, type RandomWords } from './SeededRandom'

/**
 * The fixed set of named random streams. Each stream is derived from the world seed and its own
 * name, so a draw in one stream never changes another. Adding a name here is safe (existing
 * streams are unaffected) but is a deliberate act: `tests/stream-usage.test.ts` pins this list.
 */
export const STREAM_NAMES = [
  'elevation',
  'continent',
  'ocean',
  'temperature',
  'humidity',
  'biome',
  'riverPrimary',
  'riverSecondary',
  'riverWarpX',
  'riverWarpY',
  'riverWidth',
  'ore',
  'resourceDensity',
  'spawn',
  'names',
  'colors',
  'flags'
] as const

export type StreamName = (typeof STREAM_NAMES)[number]

const TWO_POW_32 = 4_294_967_296

/** Domain-separation prefix of the derivation input (spec section 3.1). Part of the format. */
const DOMAIN = utf8Bytes('sovereign-rng-v1')

/** FNV-1a, 32-bit (offset basis 0x811c9dc5, prime 0x01000193). */
export function fnv1a32(bytes: Uint8Array): number {
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Four consecutive splitmix32 outputs starting from `state`. */
export function splitmix32Words(state: number): [number, number, number, number] {
  const words: number[] = []
  let s = state | 0
  for (let i = 0; i < 4; i += 1) {
    s = (s + 0x9e3779b9) | 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
    words.push((z ^ (z >>> 16)) >>> 0)
  }
  return words as [number, number, number, number]
}

/** xoshiro's state must not be all zero; if it is, use the fixed fallback. */
export function fixZeroWords(words: RandomWords): RandomWords {
  return words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0
    ? FALLBACK_WORDS
    : words
}

/** Initial xoshiro state of a named stream for a world seed (spec section 3.1). */
export function streamWords(seed: number, name: StreamName): RandomWords {
  if (!Number.isInteger(seed) || seed < 0 || seed >= TWO_POW_32) {
    throw new RangeError('seed must be an integer in [0, 2^32 - 1]')
  }
  const nameBytes = utf8Bytes(name)
  const input = new Uint8Array(DOMAIN.length + 1 + 4 + 1 + nameBytes.length)
  let at = 0
  input.set(DOMAIN, at)
  at += DOMAIN.length
  input[at++] = 0
  input[at++] = (seed >>> 24) & 0xff
  input[at++] = (seed >>> 16) & 0xff
  input[at++] = (seed >>> 8) & 0xff
  input[at++] = seed & 0xff
  input[at++] = 0
  input.set(nameBytes, at)
  return fixZeroWords(splitmix32Words(fnv1a32(input)))
}

/** A fresh generator for one named stream of a world seed. */
export function createStream(seed: number, name: StreamName): SeededRandom {
  return new SeededRandom(streamWords(seed, name))
}
