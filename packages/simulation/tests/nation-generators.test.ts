import { describe, expect, it } from 'vitest'
import { ColorGenerator } from '../src/nations/ColorGenerator'
import { FlagGenerator } from '../src/nations/FlagGenerator'
import { NameGenerator } from '../src/nations/NameGenerator'
import { pickSpawnPoints } from '../src/nations/NationSpawner'
import type { RandomSource } from '../src/random/RandomSource'
import { createStream } from '../src/random/streams'

/** A RandomSource that never reorders anything: `integer(min, max)` always answers `max`. */
const noShuffle: RandomSource = {
  nextUint32: () => 0,
  float: () => 0,
  integer: (_min, max) => max,
  boolean: () => false,
  choose: (items) => items[0] as never
}

describe('pickSpawnPoints', () => {
  const width = 100
  const at = (x: number, y: number, score: number): { index: number; score: number } => ({
    index: y * width + x,
    score
  })

  it('accepts a candidate at exactly the minimum distance (strictly closer is too close)', () => {
    const picked = pickSpawnPoints([at(0, 0, 1), at(5, 0, 0.9)], 2, 5, width, noShuffle)
    expect(picked).toEqual([0, 5])
  })

  it('rejects a candidate just inside the minimum distance', () => {
    const picked = pickSpawnPoints([at(0, 0, 1), at(4, 0, 0.9)], 2, 5, width, noShuffle)
    expect(picked).toEqual([0])
  })

  it('measures distance in two dimensions (3-4-5), not along one axis', () => {
    expect(pickSpawnPoints([at(0, 0, 1), at(3, 4, 0.9)], 2, 5, width, noShuffle)).toEqual([0, 403])
    expect(pickSpawnPoints([at(0, 0, 1), at(3, 4, 0.9)], 2, 5.1, width, noShuffle)).toEqual([0])
  })

  it('prefers higher scores, and stops at the requested count', () => {
    const picked = pickSpawnPoints(
      [at(0, 0, 0.2), at(50, 0, 0.9), at(0, 50, 0.5), at(50, 50, 0.7)],
      2,
      10,
      width,
      noShuffle
    )
    expect(picked).toEqual([50, 50 * width + 50])
  })

  it('breaks ties by the random shuffle, so different streams can pick different spots', () => {
    const tied = [at(0, 0, 1), at(30, 0, 1), at(60, 0, 1), at(90, 0, 1)]
    const picks = new Set<string>()
    for (let seed = 1; seed <= 30; seed += 1) {
      picks.add(pickSpawnPoints(tied, 1, 10, width, createStream(seed, 'spawn')).join())
    }
    expect(picks.size).toBeGreaterThan(1)
  })
})

describe('ColorGenerator', () => {
  it('keeps nation colours visibly apart (RGB distance of at least 50)', () => {
    const gen = new ColorGenerator(3)
    const colors = Array.from({ length: 12 }, () => gen.generate())
    for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        const a = colors[i] as [number, number, number]
        const b = colors[j] as [number, number, number]
        const d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
        expect(d2).toBeGreaterThanOrEqual(2500)
      }
    }
  })

  it('produces valid RGB triples', () => {
    const gen = new ColorGenerator(9)
    for (let i = 0; i < 50; i += 1) {
      for (const c of gen.generate()) {
        expect(Number.isInteger(c)).toBe(true)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(255)
      }
    }
  })
})

describe('FlagGenerator', () => {
  const gen = new FlagGenerator(21)
  const flags = Array.from({ length: 6000 }, () => gen.generate())

  it('uses all six patterns', () => {
    expect(new Set(flags.map((f) => f.type)).size).toBe(6)
  })

  it('always gives a quartered flag a detail colour, and a cross one about half the time', () => {
    for (const f of flags.filter((x) => x.type === 'quartered')) expect(f.detail).toBeDefined()
    const crosses = flags.filter((x) => x.type === 'cross')
    const withDetail = crosses.filter((x) => x.detail !== undefined).length
    // ~1000 crosses: the fraction is 0.5 with a standard error of about 0.016.
    expect(withDetail / crosses.length).toBeGreaterThan(0.45)
    expect(withDetail / crosses.length).toBeLessThan(0.55)
  })

  it('keeps the accent hue at least 60 degrees from the background hue', () => {
    for (const f of flags)
      expect(Math.abs(f.accent[0] - f.background[0])).toBeGreaterThanOrEqual(60)
  })
})

describe('NameGenerator', () => {
  it('never repeats a name within one generator, even after many nations', () => {
    const gen = new NameGenerator(5)
    const names = Array.from({ length: 500 }, () => gen.generate())
    expect(new Set(names).size).toBe(names.length)
  })

  it('is deterministic per seed and different across seeds', () => {
    const a = new NameGenerator(5)
    const b = new NameGenerator(5)
    const c = new NameGenerator(6)
    const first = Array.from({ length: 10 }, () => a.generate())
    expect(Array.from({ length: 10 }, () => b.generate())).toEqual(first)
    expect(Array.from({ length: 10 }, () => c.generate())).not.toEqual(first)
  })
})
