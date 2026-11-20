import { describe, expect, it } from 'vitest'
import { fnv1a32 } from '../src/random/streams'
import { HISTOGRAM_BINS, remapByProfile, type QuantileProfile } from '../src/math/quantile'

// Expected values come from an independent reference written from the spec in Python
// (ref_quantile.py), not from this implementation: see docs/simulation/determinism.md.

/** The reference's input generator: three uniform draws from a 32-bit LCG, averaged (a bell, like fBm). */
function bell(seed: number, n: number): Float32Array {
  let s = seed >>> 0
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const a = next()
    const b = next()
    const c = next()
    out[i] = (a + b + c) / 3
  }
  return out
}

const hashFloats = (values: Float32Array): number =>
  fnv1a32(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))

const SEA: QuantileProfile = [
  [0, 0],
  [0.19, 0.2035],
  [0.745, 0.37],
  [0.775, 0.378],
  [0.93, 0.74],
  [1, 1]
]
const TEMP: QuantileProfile = [
  [0, 0.02],
  [0.3, 0.35],
  [0.7, 0.7],
  [1, 0.98]
]
const HALF: QuantileProfile = [
  [0, 0],
  [0.5, 0.25],
  [1, 1]
]
const SMALL = Float32Array.of(
  0.5,
  0.25,
  0.75,
  0.5,
  0.125,
  0.875,
  0.5,
  0.3125,
  0.6875,
  0,
  0.999,
  0.4375
)

describe('remapByProfile: reference vectors', () => {
  it('maps a small field by rank through the profile', () => {
    // Equal values share the rank of the first of them (here 5 tiles are below 0.5: 5/12 -> 0.2083).
    expect(Array.from(remapByProfile(SMALL, HALF))).toEqual(
      [
        0.2083333283662796, 0.0833333358168602, 0.625, 0.2083333283662796, 0.0416666679084301, 0.75,
        0.2083333283662796, 0.125, 0.5, 0, 0.93310546875, 0.1666666716337204
      ].map(Math.fround)
    )
  })

  it('ranks only the masked tiles but remaps every tile', () => {
    const mask = Uint8Array.of(1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1)
    expect(Array.from(remapByProfile(SMALL, HALF, mask))).toEqual(
      [
        0.3333333432674408, 0.1111111119389534, 0.6666666865348816, 0.3333333432674408,
        0.0555555559694767, 0.8333333134651184, 0.3333333432674408, 0.1666666716337204, 0.5, 0, 1,
        0.2222222238779068
      ].map(Math.fround)
    )
  })

  it('matches the reference bit for bit on 200 000 bell-shaped values (the ocean profile)', () => {
    expect(hashFloats(remapByProfile(bell(7, 200_000), SEA))).toBe(388538675)
  })

  it('matches the reference bit for bit with a mask (the temperature profile, land only)', () => {
    const values = bell(11, 200_000)
    const mask = new Uint8Array(values.length)
    for (let i = 0; i < mask.length; i += 1) mask[i] = i % 3 === 0 ? 0 : 1
    expect(hashFloats(remapByProfile(values, TEMP, mask))).toBe(306960889)
  })

  it('maps a field of equal values to the profile start', () => {
    expect(Array.from(remapByProfile(new Float32Array(8).fill(0.5), HALF))).toEqual(
      Array(8).fill(0)
    )
  })
})

describe('remapByProfile: properties', () => {
  it('is monotone: a larger input never gets a smaller output', () => {
    const values = bell(3, 50_000)
    const out = remapByProfile(values, SEA)
    const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b])
    for (let k = 1; k < order.length; k += 1) {
      expect(out[order[k]]).toBeGreaterThanOrEqual(out[order[k - 1]])
    }
  })

  it('puts the profile quantile of the tiles below each knot value (the ocean amount is exact)', () => {
    const values = bell(5, 400_000)
    const out = remapByProfile(values, SEA)
    const fractionAtMost = (limit: number): number => {
      let n = 0
      for (const v of out) if (v <= limit) n += 1
      return n / out.length
    }
    expect(fractionAtMost(0.2035)).toBeCloseTo(0.19, 3)
    expect(fractionAtMost(0.37)).toBeCloseTo(0.745, 3)
    expect(fractionAtMost(0.74)).toBeCloseTo(0.93, 3)
  })

  it('keeps every output inside the profile range', () => {
    const out = remapByProfile(bell(9, 20_000), TEMP)
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(Math.fround(0.02))
      expect(v).toBeLessThanOrEqual(Math.fround(0.98))
    }
  })

  it('is the identity (to within one bin) for the straight profile on uniform input', () => {
    const n = HISTOGRAM_BINS
    const ramp = new Float32Array(n)
    for (let i = 0; i < n; i += 1) ramp[i] = (i + 0.5) / n
    const out = remapByProfile(ramp, [
      [0, 0],
      [1, 1]
    ])
    for (let i = 0; i < n; i += 1) expect(Math.abs(out[i] - ramp[i])).toBeLessThanOrEqual(1 / n)
  })

  it('does not change its input and returns a new array', () => {
    const values = bell(1, 1000)
    const copy = Float32Array.from(values)
    const out = remapByProfile(values, HALF)
    expect(values).toEqual(copy)
    expect(out).not.toBe(values)
    expect(out.length).toBe(values.length)
  })

  it('handles an empty mask (nothing ranked) and an empty field', () => {
    expect(
      Array.from(remapByProfile(Float32Array.of(0.2, 0.9), HALF, Uint8Array.of(0, 0)))
    ).toEqual([0, 0])
    expect(remapByProfile(new Float32Array(0), HALF).length).toBe(0)
  })

  it('clamps values outside [0, 1] to the end bins', () => {
    const out = remapByProfile(Float32Array.of(-0.5, 0.5, 1.5), HALF)
    expect(out[0]).toBe(0)
    expect(out[2]).toBeGreaterThan(0.5)
    expect(out[2]).toBeLessThanOrEqual(1)
  })

  it('counts a value of exactly 1 in the last bin, beside its neighbours there', () => {
    // 1.0 and 65535.25 / 65536 share the last bin; 0 is alone in the first. Reference: [1, 0.25, 0].
    const out = remapByProfile(Float32Array.of(1, Math.fround(65535.25 / 65536), 0), HALF)
    expect(Array.from(out)).toEqual([1, 0.25, 0])
  })

  it('allows a flat stretch in the profile (a plateau of equal values)', () => {
    const plateau: QuantileProfile = [
      [0, 0],
      [0.5, 0.5],
      [0.8, 0.5],
      [1, 1]
    ]
    const ramp = Float32Array.from({ length: 10 }, (_, i) => Math.fround((i + 0.5) / 10))
    expect(Array.from(remapByProfile(ramp, plateau))).toEqual(
      [
        0.08000488579273224, 0.14003905653953552, 0.20000000298023224, 0.3599609434604645,
        0.419921875, 0.5, 0.5, 0.5, 0.650390625, 0.7998046875
      ].map(Math.fround)
    )
  })

  it('counts a value below 0 in the first bin, so the tile after it keeps its rank', () => {
    // -0.5 is clamped into bin 0 and ranks below the tile in bin 1. Reference: [0, 0.25, 0.69921875].
    const out = remapByProfile(Float32Array.of(-0.5, Math.fround(1.5 / 65536), 0.9), HALF)
    expect(Array.from(out)).toEqual([0, 0.25, 0.69921875])
  })

  it('places the top value of a field at its last bin without reading past the histogram', () => {
    expect(() => remapByProfile(Float32Array.of(1, 1, 0), HALF)).not.toThrow()
  })
})

describe('remapByProfile: rejects what it cannot use', () => {
  it('rejects a non-finite value rather than repairing it', () => {
    expect(() => remapByProfile(Float32Array.of(0.1, Number.NaN), HALF)).toThrow(RangeError)
    expect(() => remapByProfile(Float32Array.of(Infinity), HALF)).toThrow(RangeError)
  })

  it('rejects a mask that is longer than the field', () => {
    expect(() => remapByProfile(Float32Array.of(0.1), HALF, Uint8Array.of(1, 1))).toThrow(
      RangeError
    )
  })

  it('rejects a mask of the wrong length', () => {
    expect(() => remapByProfile(Float32Array.of(0.1, 0.2), HALF, Uint8Array.of(1))).toThrow(
      RangeError
    )
  })

  it('rejects a profile that is not a monotone map from quantile 0 to 1', () => {
    const bad: QuantileProfile[] = [
      [[0, 0]], // one knot
      [
        [0.1, 0],
        [1, 1]
      ], // does not start at 0
      [
        [0, 0],
        [0.9, 1]
      ], // does not end at 1
      [
        [0, 0],
        [0.5, 0.5],
        [0.5, 0.6],
        [1, 1]
      ], // repeated quantile
      [
        [0, 0],
        [0.6, 0.5],
        [0.4, 0.6],
        [1, 1]
      ], // quantiles go backwards
      [
        [0, 0],
        [0.5, 0.8],
        [1, 0.4]
      ] // values go backwards
    ]
    for (const profile of bad) expect(() => remapByProfile(SMALL, profile)).toThrow(RangeError)
  })
})
