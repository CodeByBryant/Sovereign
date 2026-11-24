import { describe, expect, it } from 'vitest'
import { counterFloat, counterInt, counterMix } from '../src/random/counter'

describe('counterMix: a hash of four numbers', () => {
  // Vectors from an independent implementation (Python integers and masks) of the same four-step mix.
  it.each([
    [[0, 0, 0, 0], 2688605155],
    [[1, 0, 0, 0], 3120657311],
    [[1337, 5, 100, 7], 803228589],
    [[0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff], 420893632],
    [[123456789, 42, 365000, 3], 2560630870],
    [[2024, 29999, 1, 0], 1942173129]
  ] as const)('%j gives %i', (input, expected) => {
    expect(counterMix(input[0], input[1], input[2], input[3])).toBe(expected)
  })

  it('is a pure function: the same inputs always give the same number, in any order', () => {
    const first = [1, 2, 3].map((i) => counterMix(9, i, 5, 0))
    const second = [3, 2, 1].map((i) => counterMix(9, i, 5, 0)).reverse()
    expect(second).toEqual(first)
  })

  it('changes with every one of its inputs', () => {
    const base = counterMix(10, 20, 30, 40)
    expect(counterMix(11, 20, 30, 40)).not.toBe(base)
    expect(counterMix(10, 21, 30, 40)).not.toBe(base)
    expect(counterMix(10, 20, 31, 40)).not.toBe(base)
    expect(counterMix(10, 20, 30, 41)).not.toBe(base)
  })

  it('is not symmetric: swapping the inputs gives something else', () => {
    expect(counterMix(1, 2, 3, 4)).not.toBe(counterMix(1, 3, 2, 4))
    expect(counterMix(1, 2, 3, 4)).not.toBe(counterMix(2, 1, 3, 4))
  })

  it('always gives a whole number from 0 to 2^32 - 1', () => {
    for (let i = 0; i < 2000; i += 1) {
      const v = counterMix(i, i * 7, i * 13, i % 5)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('counterFloat: a number from 0 up to but not including 1', () => {
  it('is the mix over 2^32', () => {
    expect(counterFloat(1337, 5, 100, 7)).toBe(803228589 / 4294967296)
  })

  it('looks uniform: the mean is near a half and each tenth gets about a tenth', () => {
    const n = 100000
    let sum = 0
    const tenths = new Array<number>(10).fill(0)
    for (let i = 0; i < n; i += 1) {
      const f = counterFloat(77, i, 1234, 2)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
      sum += f
      tenths[Math.floor(f * 10)]! += 1
    }
    expect(sum / n).toBeGreaterThan(0.49)
    expect(sum / n).toBeLessThan(0.51)
    for (const t of tenths) expect(Math.abs(t - n / 10)).toBeLessThan(400)
  })

  it('does not repeat for neighbouring ids or ticks (no visible pattern between them)', () => {
    const seen = new Set<number>()
    for (let id = 0; id < 300; id += 1)
      for (let tick = 0; tick < 300; tick += 1) seen.add(counterMix(5, id, tick, 0))
    expect(seen.size).toBeGreaterThan(89990) // the birthday bound expects about one collision in 90,000 draws of 32 bits
  })

  it('is uncorrelated between neighbouring ids', () => {
    const n = 20000
    let sx = 0
    let sy = 0
    let sxy = 0
    let sxx = 0
    let syy = 0
    for (let i = 0; i < n; i += 1) {
      const x = counterFloat(3, i, 10, 0)
      const y = counterFloat(3, i + 1, 10, 0)
      sx += x
      sy += y
      sxy += x * y
      sxx += x * x
      syy += y * y
    }
    const cov = sxy / n - (sx / n) * (sy / n)
    const r = cov / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2))
    expect(Math.abs(r)).toBeLessThan(0.03)
  })
})

describe('counterInt: a whole number from 0 up to but not including n', () => {
  it('stays below n, takes every value, and gives 0 for n of 1', () => {
    const counts = new Array<number>(7).fill(0)
    for (let i = 0; i < 7000; i += 1) {
      const v = counterInt(8, i, 3, 1, 7)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
      counts[v]! += 1
    }
    for (const c of counts) expect(Math.abs(c - 1000)).toBeLessThan(150)
    expect(counterInt(8, 1, 1, 1, 1)).toBe(0)
  })

  it('is the float scaled and cut down', () => {
    expect(counterInt(1337, 5, 100, 7, 10)).toBe(Math.floor(counterFloat(1337, 5, 100, 7) * 10))
  })

  it('refuses an n that is not a whole number of at least 1', () => {
    expect(() => counterInt(0, 0, 0, 0, 0)).toThrow(RangeError)
    expect(() => counterInt(0, 0, 0, 0, -3)).toThrow(RangeError)
    expect(() => counterInt(0, 0, 0, 0, 2.5)).toThrow(RangeError)
    expect(() => counterInt(0, 0, 0, 0, Number.NaN)).toThrow(RangeError)
  })
})
