/**
 * @module counter
 * @description Randomness with no state: a number is a pure function of four others (the world seed, and
 * three that say what is being decided, such as a unit's id, the tick, and a purpose). Units decide things at
 * run time, and a stream with a position would put that position into every save and make the result depend
 * on the order units are visited in; this has neither problem, so a world restored from a save, or one whose
 * units are visited in another order, makes the same choices.
 *
 * A four-step mix: the seed is scrambled by the 32-bit finaliser of MurmurHash3 (`fmix32`), then each of the other
 * three inputs is folded into the running value and scrambled again. Only `Math.imul`, `^`, `>>>` and `+` on 32-bit values, so it is identical on every
 * engine. The vectors in `tests/counter-random.test.ts` come from an independent implementation.
 */
const TWO_POW_32 = 4_294_967_296

function fmix32(value: number): number {
  let h = value >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** A 32-bit hash of the seed and three numbers that say what is being decided. */
export function counterMix(seed: number, a: number, b: number, salt: number): number {
  let h = fmix32(((seed >>> 0) + 0x9e3779b9) >>> 0)
  h = fmix32(((h ^ (a >>> 0)) + 0x9e3779b9) >>> 0)
  h = fmix32(((h ^ (b >>> 0)) + 0x9e3779b9) >>> 0)
  h = fmix32(((h ^ (salt >>> 0)) + 0x9e3779b9) >>> 0)
  return h
}

/** A number from 0 up to but not including 1. */
export function counterFloat(seed: number, a: number, b: number, salt: number): number {
  return counterMix(seed, a, b, salt) / TWO_POW_32
}

/** A whole number from 0 up to but not including `n`. */
export function counterInt(seed: number, a: number, b: number, salt: number, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a whole number of at least 1')
  return Math.floor(counterFloat(seed, a, b, salt) * n)
}
