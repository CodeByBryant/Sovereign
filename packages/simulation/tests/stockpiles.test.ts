import { describe, expect, it } from 'vitest'
import { RESOURCE_CATALOG, ResourceType } from '@sovereign/contracts'
import { Stockpiles } from '../src/world/Stockpiles'

describe('Stockpiles', () => {
  it('opens a counter set for a hall with every resource at zero', () => {
    const s = new Stockpiles()
    s.open(3)
    expect(s.has(3)).toBe(true)
    expect(s.has(4)).toBe(false)
    for (const def of RESOURCE_CATALOG) expect(s.get(3, def.id)).toBe(0)
  })
  it('adds to one resource of one hall and leaves the rest alone', () => {
    const s = new Stockpiles()
    s.open(1)
    s.open(5)
    s.add(1, ResourceType.Timber, 7)
    s.add(1, ResourceType.Timber, 3)
    s.add(5, ResourceType.Grain, 2)
    expect(s.get(1, ResourceType.Timber)).toBe(10)
    expect(s.get(1, ResourceType.Grain)).toBe(0)
    expect(s.get(5, ResourceType.Grain)).toBe(2)
    expect(s.get(5, ResourceType.Timber)).toBe(0)
  })
  it('allows adding nothing', () => {
    const s = new Stockpiles()
    s.open(1)
    s.add(1, ResourceType.Timber, 0)
    expect(s.get(1, ResourceType.Timber)).toBe(0)
  })
  it('counts the last resource of the catalogue too', () => {
    const s = new Stockpiles()
    s.open(0)
    s.add(0, RESOURCE_CATALOG.length, 4)
    expect(s.get(0, RESOURCE_CATALOG.length)).toBe(4)
    expect(s.counts(0).length).toBe(RESOURCE_CATALOG.length)
  })
  it('totals a resource over every hall', () => {
    const s = new Stockpiles()
    s.open(1)
    s.open(2)
    s.add(1, ResourceType.Iron, 5)
    s.add(2, ResourceType.Iron, 6)
    expect(s.total(ResourceType.Iron)).toBe(11)
    expect(s.total(ResourceType.Gold)).toBe(0)
  })
  it('lists its halls lowest first, whatever order they were opened in', () => {
    const s = new Stockpiles()
    for (const h of [9, 2, 5]) s.open(h)
    expect(s.halls()).toEqual([2, 5, 9])
  })
  it('refuses a hall opened twice, a hall it does not have, and a bad resource, hall or amount', () => {
    const s = new Stockpiles()
    s.open(1)
    expect(() => s.open(1)).toThrow(RangeError)
    expect(() => s.open(-1)).toThrow(RangeError)
    expect(() => s.open(1.5)).toThrow(RangeError)
    expect(() => s.add(2, ResourceType.Timber, 1)).toThrow(RangeError)
    expect(() => s.get(2, ResourceType.Timber)).toThrow(RangeError)
    expect(() => s.add(1, 0, 1)).toThrow(RangeError)
    expect(() => s.add(1, RESOURCE_CATALOG.length + 1, 1)).toThrow(RangeError)
    expect(() => s.add(1, ResourceType.Timber, -1)).toThrow(RangeError)
    expect(() => s.add(1, ResourceType.Timber, 1.5)).toThrow(RangeError)
  })
  it('refuses to count past what a uint32 holds', () => {
    const s = new Stockpiles()
    s.open(1)
    s.add(1, ResourceType.Timber, 2 ** 32 - 1)
    expect(() => s.add(1, ResourceType.Timber, 1)).toThrow(RangeError)
    expect(s.get(1, ResourceType.Timber)).toBe(2 ** 32 - 1)
  })
  it('does not let anyone change the counters through the view it hands out', () => {
    const s = new Stockpiles()
    s.open(1)
    s.add(1, ResourceType.Timber, 3)
    const view = s.counts(1)
    view[0] = 99
    expect(s.get(1, ResourceType.Timber)).toBe(3)
  })

  describe('as JSON', () => {
    const filled = (): Stockpiles => {
      const s = new Stockpiles()
      s.open(7)
      s.open(2)
      s.add(7, ResourceType.Stone, 12)
      s.add(2, ResourceType.Fish, 1)
      return s
    }
    it('round-trips, lowest hall first', () => {
      const json = filled().toJson()
      expect(json.map((h) => h.hall)).toEqual([2, 7])
      const back = Stockpiles.fromJson(json)
      expect(back.halls()).toEqual([2, 7])
      expect(back.get(7, ResourceType.Stone)).toBe(12)
      expect(back.get(2, ResourceType.Fish)).toBe(1)
      expect(back.toJson()).toEqual(json)
    })
    it('round-trips nothing', () => {
      expect(Stockpiles.fromJson(new Stockpiles().toJson()).halls()).toEqual([])
    })
    const bad = (value: unknown): void =>
      expect(() => Stockpiles.fromJson(value)).toThrow(RangeError)
    it('refuses what is not a list of halls with 22 counters each', () => {
      bad(undefined)
      bad({})
      bad([1])
      bad([{ hall: 1 }])
      bad([{ hall: 1, counts: new Array(21).fill(0) }])
      bad([{ hall: 1, counts: new Array(23).fill(0) }])
      bad([{ hall: -1, counts: new Array(22).fill(0) }])
      bad([{ hall: 1.5, counts: new Array(22).fill(0) }])
      bad([{ hall: 1, counts: new Array(22).fill(-1) }])
      bad([{ hall: 1, counts: new Array(22).fill(0.5) }])
      bad([{ hall: 1, counts: new Array(22).fill(2 ** 32) }])
      bad([{ hall: 1, counts: new Array(22).fill('x') }])
    })
    it('refuses halls out of order or listed twice', () => {
      const z = new Array(22).fill(0)
      bad([
        { hall: 5, counts: z },
        { hall: 2, counts: z }
      ])
      bad([
        { hall: 2, counts: z },
        { hall: 2, counts: z }
      ])
    })
    it('accepts the largest counter a uint32 holds', () => {
      const c = new Array(22).fill(0)
      c[3] = 2 ** 32 - 1
      expect(Stockpiles.fromJson([{ hall: 0, counts: c }]).get(0, 4)).toBe(2 ** 32 - 1)
    })
  })
})
