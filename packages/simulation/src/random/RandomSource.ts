/** A source of deterministic randomness. Systems receive one of these, never `Math.random`. */
export interface RandomSource {
  /** Next raw 32-bit unsigned integer. */
  nextUint32(): number
  /** Uniform float in `[0, 1)` with 53 bits of precision. */
  float(): number
  /** Uniform integer in `[min, max]`, both inclusive (rejection sampling, no modulo bias). */
  integer(min: number, max: number): number
  /** `true` with probability `p` (default one half). */
  boolean(p?: number): boolean
  /** A uniformly chosen element; throws on an empty list. */
  choose<T>(items: readonly T[]): T
}
