import type { RandomSource } from './RandomSource'

/** The four xoshiro128** state words. */
export type RandomWords = readonly [number, number, number, number]

/** Serializable generator state (for saves). */
export interface RandomState {
  readonly words: RandomWords
}

/** Replacement for the invalid all-zero xoshiro state (spec section 3.1, step 4). */
export const FALLBACK_WORDS: RandomWords = [0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x71374491]

const TWO_POW_32 = 4_294_967_296

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0
}

function checkWords(words: RandomWords): void {
  for (const word of words) {
    if (!Number.isInteger(word) || word < 0 || word >= TWO_POW_32) {
      throw new RangeError('random state words must be uint32 values')
    }
  }
  if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0) {
    throw new RangeError('the all-zero xoshiro state is invalid')
  }
}

/**
 * xoshiro128** generator using 32-bit integer arithmetic only. Its output is specified bit for bit
 * in docs/simulation/determinism.md, section 3. Derive initial words with `streamWords`.
 */
export class SeededRandom implements RandomSource {
  private s0 = 0
  private s1 = 0
  private s2 = 0
  private s3 = 0

  constructor(words: RandomWords) {
    this.setState({ words })
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0
    const t = (this.s1 << 9) >>> 0
    this.s2 = (this.s2 ^ this.s0) >>> 0
    this.s3 = (this.s3 ^ this.s1) >>> 0
    this.s1 = (this.s1 ^ this.s2) >>> 0
    this.s0 = (this.s0 ^ this.s3) >>> 0
    this.s2 = (this.s2 ^ t) >>> 0
    this.s3 = rotl(this.s3, 11)
    return result
  }

  float(): number {
    // Order matters: the high word is drawn first.
    const hi = this.nextUint32() >>> 5
    const lo = this.nextUint32() >>> 6
    return (hi * 67_108_864 + lo) / 9_007_199_254_740_992
  }

  integer(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new RangeError('integer(min, max) needs safe integers with min <= max')
    }
    const range = max - min + 1
    if (range > TWO_POW_32) {
      throw new RangeError('integer(min, max) range must not exceed 2^32')
    }
    const limit = Math.floor(TWO_POW_32 / range) * range
    let u = this.nextUint32()
    while (u >= limit) u = this.nextUint32()
    return min + (u % range)
  }

  boolean(p = 0.5): boolean {
    return this.float() < p
  }

  choose<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('choose() needs a non-empty list')
    return items[this.integer(0, items.length - 1)] as T
  }

  getState(): RandomState {
    return { words: [this.s0, this.s1, this.s2, this.s3] }
  }

  setState(state: RandomState): void {
    checkWords(state.words)
    ;[this.s0, this.s1, this.s2, this.s3] = state.words
  }
}
