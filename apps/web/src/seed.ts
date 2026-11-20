/**
 * @module seed
 * @description World seed helpers. This is the one place a seed may come from the wall clock or
 * `Math.random()`: seeds are an *input* to the deterministic engine, chosen at the edge. What a
 * typed seed *means* (digits vs text) is decided by the engine's `normalizeSeed`, not here.
 */

/** A fresh random world seed (a non-negative integer below 1e9). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 1e9)
}
