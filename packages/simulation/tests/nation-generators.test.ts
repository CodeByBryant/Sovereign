import { describe, expect, it } from 'vitest'
import { ColorGenerator } from '../src/nations/ColorGenerator'
import { FlagGenerator } from '../src/nations/FlagGenerator'
import { NameGenerator } from '../src/nations/NameGenerator'

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
