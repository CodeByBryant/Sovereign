import { describe, expect, it } from 'vitest'
import { distanceToMask, slopeField, topographicPosition } from '../src/terrain/features'

/** A width x height field filled by `fn(x, y)`. */
function field(width: number, height: number, fn: (x: number, y: number) => number): Float32Array {
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) out[y * width + x] = fn(x, y)
  return out
}
const mask = (width: number, height: number, on: (x: number, y: number) => boolean): Uint8Array =>
  Uint8Array.from(field(width, height, (x, y) => (on(x, y) ? 1 : 0)))

describe('distanceToMask', () => {
  it('is the number of 4-neighbour steps to the nearest masked tile, 0 on the mask', () => {
    const w = 11
    const m = mask(w, w, (x, y) => x === 5 && y === 5)
    const d = distanceToMask(m, w, w)
    expect(d[5 * w + 5]).toBe(0)
    expect(d[5 * w + 6]).toBe(1)
    expect(d[3 * w + 5]).toBe(2)
    expect(d[7 * w + 8]).toBe(5) // 2 down + 3 across
    expect(d[0]).toBe(10) // 5 + 5
  })

  it('takes the nearest of several sources', () => {
    const w = 20
    const m = mask(w, 1, (x) => x === 0 || x === 19)
    const d = distanceToMask(m, w, 1)
    expect(d[9]).toBe(9)
    expect(d[10]).toBe(9)
    expect(d[5]).toBe(5)
    expect(d[15]).toBe(4)
  })

  it('walks through every tile, with no obstacles: it is a distance on the grid, not a flood of land', () => {
    const w = 5
    const m = mask(w, w, (x, y) => x === 0 && y === 0)
    expect(distanceToMask(m, w, w)[4 * w + 4]).toBe(8)
  })

  it('walks up and down a single column, including from the second row to the first', () => {
    // a 1 x 4 strip: index = y
    expect(Array.from(distanceToMask(Uint8Array.of(0, 1, 0, 0), 1, 4))).toEqual([1, 0, 1, 2])
    expect(Array.from(distanceToMask(Uint8Array.of(0, 0, 0, 1), 1, 4))).toEqual([3, 2, 1, 0])
    expect(Array.from(distanceToMask(Uint8Array.of(1, 0, 0, 0), 1, 4))).toEqual([0, 1, 2, 3])
  })

  it('rejects a limit that is not an integer from 1 to 65535', () => {
    const m = new Uint8Array(4)
    for (const bad of [0, -1, 2.5, 65536, Number.NaN]) {
      expect(() => distanceToMask(m, 2, 2, bad), String(bad)).toThrow(RangeError)
    }
    expect(() => distanceToMask(m, 2, 2, 1)).not.toThrow()
    expect(() => distanceToMask(m, 2, 2, 65535)).not.toThrow()
  })

  it('stops counting at the limit', () => {
    const m = mask(30, 1, (x) => x === 0)
    const d = distanceToMask(m, 30, 1, 10)
    expect(d[10]).toBe(10)
    expect(d[11]).toBe(10)
    expect(d[29]).toBe(10)
    expect(d[3]).toBe(3)
  })

  it('gives every tile the limit when nothing is masked', () => {
    const d = distanceToMask(new Uint8Array(12), 4, 3, 7)
    expect(Array.from(d)).toEqual(Array(12).fill(7))
  })

  it('has a default limit that a 8192-tile map cannot exceed', () => {
    const d = distanceToMask(
      mask(3, 1, (x) => x === 0),
      3,
      1
    )
    expect(Array.from(d)).toEqual([0, 1, 2])
  })

  it('does not change its input', () => {
    const m = mask(4, 4, (x, y) => x === y)
    const copy = Uint8Array.from(m)
    distanceToMask(m, 4, 4)
    expect(Array.from(m)).toEqual(Array.from(copy))
  })
})

describe('slopeField', () => {
  it('is 0 on flat ground', () => {
    expect(
      Array.from(
        slopeField(
          field(6, 5, () => 0.4),
          6,
          5
        )
      ).every((v) => v === Math.fround(0))
    ).toBe(true)
  })

  it('is the gradient magnitude on a plane: 0.01 per tile along x gives 0.01 everywhere', () => {
    const s = slopeField(
      field(8, 8, (x) => 0.01 * x),
      8,
      8
    )
    for (const v of s) expect(v).toBeCloseTo(0.01, 6)
  })

  it('combines both directions: gradient (0.03, 0.04) has magnitude 0.05', () => {
    const s = slopeField(
      field(9, 9, (x, y) => 0.03 * x + 0.04 * y),
      9,
      9
    )
    for (const v of s) expect(v).toBeCloseTo(0.05, 6)
  })

  it('is steepest on the flank of a peak and 0 on its top and far away', () => {
    const w = 21
    const peak = field(w, w, (x, y) => Math.max(0, 1 - 0.1 * (Math.abs(x - 10) + Math.abs(y - 10))))
    const s = slopeField(peak, w, w)
    expect(s[10 * w + 10]).toBeCloseTo(0, 6) // the summit is a point of zero gradient by central difference
    expect(s[10 * w + 13]).toBeCloseTo(0.1, 6) // on the flank
    expect(s[0]).toBe(0) // far away, flat
  })

  it('does not change its input', () => {
    const e = field(5, 5, (x) => x)
    const copy = Float32Array.from(e)
    slopeField(e, 5, 5)
    expect(Array.from(e)).toEqual(Array.from(copy))
  })
})

describe('topographicPosition', () => {
  it('is 0 on flat ground, whatever the radius', () => {
    const t = topographicPosition(
      field(9, 9, () => 0.5),
      9,
      9,
      3
    )
    for (const v of t) expect(v).toBeCloseTo(0, 6)
  })

  it('is positive on a ridge and negative beside it', () => {
    // a one-tile-wide ridge of height 1 on flat ground at x = 10
    const w = 21
    const e = field(w, w, (x) => (x === 10 ? 1 : 0))
    const t = topographicPosition(e, w, w, 3)
    // radius 3: a 7 x 7 window, 7 of its 49 tiles on the ridge: mean 1/7; the ridge stands 6/7 above it
    expect(t[10 * w + 10]).toBeCloseTo(6 / 7, 5)
    // beside the ridge the window still holds the 7 ridge tiles, so the tile is below its mean
    expect(t[10 * w + 11]).toBeCloseTo(-1 / 7, 5)
    // beyond the window it is level
    expect(t[10 * w + 15]).toBeCloseTo(0, 6)
  })

  it('is negative in a basin', () => {
    const w = 15
    const e = field(w, w, (x, y) => (x === 7 && y === 7 ? -1 : 0))
    expect(topographicPosition(e, w, w, 2)[7 * w + 7]).toBeCloseTo(-1 + 1 / 25, 5)
  })

  it('averages only the tiles that exist at the map edge, not zeros beyond it', () => {
    // a field of 1s: if off-map tiles counted as 0 the corner would read as above its mean
    const t = topographicPosition(
      field(6, 6, () => 1),
      6,
      6,
      3
    )
    for (const v of t) expect(v).toBeCloseTo(0, 6)
    // a corner tile at 1 on 0s: the window is the 4 x 4 in-bounds block
    const corner = field(6, 6, (x, y) => (x === 0 && y === 0 ? 1 : 0))
    expect(topographicPosition(corner, 6, 6, 3)[0]).toBeCloseTo(1 - 1 / 16, 5)
  })

  it('works with radius 1: a 3 x 3 window', () => {
    // one tile at 9 in a field of 0s: its 3 x 3 window holds it and 8 zeros, mean 1
    const w = 7
    const e = field(w, w, (x, y) => (x === 3 && y === 3 ? 9 : 0))
    const t = topographicPosition(e, w, w, 1)
    expect(t[3 * w + 3]).toBeCloseTo(8, 5)
    expect(t[3 * w + 4]).toBeCloseTo(-1, 5)
    expect(t[3 * w + 6]).toBeCloseTo(0, 6)
  })

  it('with radius 0 every tile is its own mean', () => {
    const t = topographicPosition(
      field(5, 5, (x, y) => x * y),
      5,
      5,
      0
    )
    for (const v of t) expect(v).toBe(0)
  })

  it('rejects a negative or fractional radius', () => {
    expect(() => topographicPosition(new Float32Array(4), 2, 2, -1)).toThrow(RangeError)
    expect(() => topographicPosition(new Float32Array(4), 2, 2, 1.5)).toThrow(RangeError)
  })

  it('does not change its input', () => {
    const e = field(7, 7, (x, y) => x + y)
    const copy = Float32Array.from(e)
    topographicPosition(e, 7, 7, 2)
    expect(Array.from(e)).toEqual(Array.from(copy))
  })
})
