import { describe, expect, it } from 'vitest'
import { createSimplexNoise2D } from '../src/noise/simplex'
import { createStream } from '../src/random/streams'

// Exact values from an independent Python implementation of the algorithm in
// docs/simulation/determinism.md (same IEEE-754 operations in the same order, so equality is exact).
const POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0.5, 0.5],
  [1.3, -2.7],
  [-10.25, 33.125],
  [123.456, 789.012],
  [0.001, 0.002],
  [1000.5, -1000.5],
  [-0.5, -0.5],
  [3.999, 4.001]
]

const VECTORS = {
  'seed 12345, stream elevation': {
    seed: 12345,
    name: 'elevation' as const,
    values: [
      0, -0.3078061834694493, 0.4213085827898947, 0.6233383467908111, -0.18378226453632554,
      -0.004384078239144989, 0.24999999999988512, 0.6156123669388986, 0.008529778672535637
    ],
    gridMin: -0.9965035747131901,
    gridMax: 0.9992800068700002
  },
  'seed 0, stream ocean': {
    seed: 0,
    name: 'ocean' as const,
    values: [
      0, 0.3078061834694493, 7.586316206273396e-16, 0.27370480993323837, -0.10500321572878757,
      -0.008768156478289978, -0.25000000000011463, -0.3078061834694493, -0.17252281009976203
    ],
    gridMin: -0.9993998491913942,
    gridMax: 0.9987544145881019
  }
}

describe('createSimplexNoise2D', () => {
  describe.each(Object.entries(VECTORS))('%s', (_label, v) => {
    const noise = createSimplexNoise2D(createStream(v.seed, v.name))

    it('reproduces the reference values exactly, including negative coordinates', () => {
      expect(POINTS.map(([x, y]) => noise(x, y))).toEqual(v.values)
    })

    it('reproduces the reference extremes over a 120 x 120 grid', () => {
      const vals: number[] = []
      for (let x = -60; x < 60; x += 1)
        for (let y = -60; y < 60; y += 1) vals.push(noise(x * 0.37, y * 0.41))
      expect(Math.min(...vals)).toBe(v.gridMin)
      expect(Math.max(...vals)).toBe(v.gridMax)
    })
  })

  // Points one ulp apart across a skewed-cell boundary (skewed x + (x + y) * F2 is just below, then
  // exactly at, an integer). F2 only enters through floor(), so only such points can pin it.
  it('puts points either side of a cell boundary in the right cell', () => {
    const noise = createSimplexNoise2D(createStream(12345, 'elevation'))
    expect(noise(3, 7.928203230275509)).toBe(0.24150037923003204)
    expect(noise(3, 7.92820323027551)).toBe(0.2415003792300292)
    expect(noise(-2.5, -1.5980762113533185)).toBe(0.32205766333753255)
    expect(noise(-2.5, -1.5980762113533182)).toBe(0.32205766333753255)
  })

  it('stays within [-1, 1] (a hair of slack) with a mean near zero', () => {
    const noise = createSimplexNoise2D(createStream(99, 'elevation'))
    let sum = 0
    let n = 0
    for (let x = 0; x < 200; x += 1) {
      for (let y = 0; y < 200; y += 1) {
        const v = noise(x * 0.13, y * 0.17)
        expect(Math.abs(v)).toBeLessThanOrEqual(1.0001)
        sum += v
        n += 1
      }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.02)
  })

  it('is continuous: a tiny step in input gives a tiny change in output', () => {
    const noise = createSimplexNoise2D(createStream(7, 'humidity'))
    for (let i = 0; i < 500; i += 1) {
      const x = i * 0.731 - 150
      const y = i * 0.419 + 20
      expect(Math.abs(noise(x + 1e-6, y) - noise(x, y))).toBeLessThan(1e-4)
      expect(Math.abs(noise(x, y + 1e-6) - noise(x, y))).toBeLessThan(1e-4)
    }
  })

  it('is a pure function of the stream: equal streams give equal noise, different streams differ', () => {
    const a = createSimplexNoise2D(createStream(5, 'elevation'))
    const b = createSimplexNoise2D(createStream(5, 'elevation'))
    const c = createSimplexNoise2D(createStream(5, 'ocean'))
    let differs = false
    for (let i = 0; i < 50; i += 1) {
      expect(a(i * 0.5, i * 0.25)).toBe(b(i * 0.5, i * 0.25))
      if (a(i * 0.5 + 0.1, i * 0.25) !== c(i * 0.5 + 0.1, i * 0.25)) differs = true
    }
    expect(differs).toBe(true)
  })

  it('is repeatable when called again with the same arguments (no hidden state)', () => {
    const noise = createSimplexNoise2D(createStream(5, 'elevation'))
    const first = noise(3.3, 4.4)
    noise(100, 100)
    expect(noise(3.3, 4.4)).toBe(first)
  })
})
