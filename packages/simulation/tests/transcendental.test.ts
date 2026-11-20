import { describe, expect, it } from 'vitest'
import { exp, ln, pow } from '../src/math/transcendental'

/** Relative error, treating an exact zero expectation as an absolute comparison. */
function relErr(got: number, want: number): number {
  return want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want)
}

/** Log-spaced samples from `lo` to `hi` (inclusive), computed with platform Math (tests only). */
function logGrid(lo: number, hi: number, n: number): number[] {
  const a = Math.log(lo)
  const b = Math.log(hi)
  return Array.from({ length: n }, (_, i) => Math.exp(a + ((b - a) * i) / (n - 1)))
}

// Accuracy target from the spec: within about one unit in the last place (2^-52 relative).
const ONE_ULP = 2.3e-16

describe('ln', () => {
  it('is exactly zero at 1', () => {
    expect(ln(1)).toBe(0)
  })

  it('matches the platform log to one ulp over 1e-300 .. 1e300', () => {
    for (const x of logGrid(1e-300, 1e300, 1500)) {
      expect(relErr(ln(x), Math.log(x))).toBeLessThanOrEqual(ONE_ULP)
    }
  })

  it('stays accurate close to 1, where cancellation bites', () => {
    for (const d of [1e-1, 1e-3, 1e-5, 1e-8, 1e-10, 1e-14]) {
      for (const x of [1 + d, 1 - d]) {
        expect(relErr(ln(x), Math.log(x))).toBeLessThanOrEqual(ONE_ULP)
      }
    }
  })

  it('matches on small integers and the sqrt(2) range-reduction boundary', () => {
    for (let n = 1; n <= 1000; n += 1) {
      expect(relErr(ln(n), Math.log(n))).toBeLessThanOrEqual(ONE_ULP)
    }
    for (const x of [
      0.7071067811865475, 0.7071067811865476, 1.414213562373095, 1.4142135623730951
    ]) {
      expect(relErr(ln(x), Math.log(x))).toBeLessThanOrEqual(ONE_ULP)
    }
  })

  it.each([0, -1, -1e-300, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 5e-324])(
    'throws RangeError outside its domain (positive normal numbers): %s',
    (x) => {
      expect(() => ln(x)).toThrow(RangeError)
    }
  )
})

describe('exp', () => {
  it('is exactly one at zero', () => {
    expect(exp(0)).toBe(1)
  })

  it('matches the platform exp to one ulp over -700 .. 700', () => {
    for (let i = 0; i <= 2800; i += 1) {
      const x = -700 + i * 0.5 + (i % 7) * 0.0123
      expect(relErr(exp(x), Math.exp(x))).toBeLessThanOrEqual(ONE_ULP)
    }
  })

  it('matches for tiny and near-ln2 arguments, where the reduction changes branch', () => {
    const xs = [
      1e-30, 1e-9, -1e-9, 0.3, 0.34, 0.35, 0.5, 0.6931471805599453, 1, 1.0397, 1.04, -0.3, -0.35,
      -1, -1.04
    ]
    for (const x of xs) expect(relErr(exp(x), Math.exp(x))).toBeLessThanOrEqual(ONE_ULP)
  })

  it('flushes results below the smallest normal number to exactly zero', () => {
    expect(exp(-709)).toBe(0)
    expect(exp(-1000)).toBe(0)
    expect(exp(-1e9)).toBe(0)
  })

  it('is still accurate just above that flush threshold', () => {
    expect(relErr(exp(-708), Math.exp(-708))).toBeLessThanOrEqual(ONE_ULP)
  })

  it.each([710, 1000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'throws RangeError when the result would overflow or the input is not finite: %s',
    (x) => {
      expect(() => exp(x)).toThrow(RangeError)
    }
  )
})

describe('pow', () => {
  it('tracks the platform pow for the terrain curve (x in [0, 1], y = 1.4) to 1e-14', () => {
    for (const x of logGrid(1e-6, 1, 400)) {
      expect(relErr(pow(x, 1.4), Math.pow(x, 1.4))).toBeLessThanOrEqual(1e-14)
    }
  })

  it('tracks the platform pow for other exponents to 1e-14 when |y * ln x| <= 30', () => {
    for (const y of [0.5, 1, 1.4, 2, 2.5, 3]) {
      for (const x of logGrid(1e-3, 50, 120)) {
        if (Math.abs(y * Math.log(x)) > 30) continue
        expect(relErr(pow(x, y), Math.pow(x, y))).toBeLessThanOrEqual(1e-14)
      }
    }
  })

  it('has the usual edge values', () => {
    expect(pow(0, 1.4)).toBe(0)
    expect(pow(0, 0)).toBe(1)
    expect(pow(7.5, 0)).toBe(1)
    expect(pow(1, 12.3)).toBe(1)
  })

  it('flushes an underflowing result to zero, like exp', () => {
    expect(pow(1e-300, 2)).toBe(0)
  })

  it.each([
    [-1, 1.4],
    [0, -1],
    [10, 400],
    [Number.NaN, 1],
    [1, Number.NaN],
    [Number.POSITIVE_INFINITY, 1]
  ])('throws RangeError for pow(%s, %s)', (x, y) => {
    expect(() => pow(x, y)).toThrow(RangeError)
  })
})
