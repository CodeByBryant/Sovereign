import type { ResourceSlot, ResourceSlots } from '@sovereign/contracts'
import { ResourceType } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { ResourceStocks, buildRegrowthTable } from '../src/world/ResourceStocks'

const N = 64

/** A slot with the given tiles set: `[tile, type, richness]`; stock starts full. */
function slot(tiles: Array<[number, number, number]>): ResourceSlot {
  const s: ResourceSlot = {
    type: new Uint8Array(N),
    richness: new Uint8Array(N),
    stock: new Uint8Array(N)
  }
  for (const [tile, type, richness] of tiles) {
    s.type[tile] = type
    s.richness[tile] = richness
    s.stock[tile] = richness
  }
  return s
}

const slots = (surface: ResourceSlot, ground: ResourceSlot = slot([])): ResourceSlots => ({
  surface,
  ground
})

// grain regrows 2 units every 10 ticks, fish 5 every 4, timber 1 every 30; ground resources never
const table = buildRegrowthTable({
  grain: { units: 2, period: 10 },
  fish: { units: 5, period: 4 },
  timber: { units: 1, period: 30 }
})

describe('buildRegrowthTable', () => {
  it('maps catalogue keys to regrowth by resource id, and nothing for the rest', () => {
    expect(table.units[ResourceType.Grain]).toBe(2)
    expect(table.period[ResourceType.Grain]).toBe(10)
    expect(table.units[ResourceType.Fish]).toBe(5)
    expect(table.period[ResourceType.Fish]).toBe(4)
    expect(table.period[ResourceType.Pasture]).toBe(0)
    expect(table.units[ResourceType.None]).toBe(0)
  })

  it('refuses an unknown resource, a finite resource, and a bad rate or period', () => {
    expect(() => buildRegrowthTable({ unicorn: { units: 1, period: 1 } })).toThrow(RangeError)
    expect(() => buildRegrowthTable({ iron: { units: 1, period: 1 } })).toThrow(RangeError)
    expect(() => buildRegrowthTable({ grain: { units: 0, period: 5 } })).toThrow(RangeError)
    expect(() => buildRegrowthTable({ grain: { units: 256, period: 5 } })).toThrow(RangeError)
    expect(() => buildRegrowthTable({ grain: { units: 1.5, period: 5 } })).toThrow(RangeError)
    expect(() => buildRegrowthTable({ grain: { units: 1, period: 0 } })).toThrow(RangeError)
    expect(() => buildRegrowthTable({ grain: { units: 1, period: 65536 } })).toThrow(RangeError)
  })
})

describe('extract', () => {
  it('takes what it can and returns what it took, clamped to the stock', () => {
    const s = slots(slot([[5, ResourceType.Grain, 100]]), slot([[9, ResourceType.Iron, 40]]))
    const stocks = new ResourceStocks(s, table)
    expect(stocks.extract('surface', 5, 30)).toBe(30)
    expect(s.surface.stock[5]).toBe(70)
    expect(stocks.extract('surface', 5, 500)).toBe(70)
    expect(s.surface.stock[5]).toBe(0)
    expect(stocks.extract('surface', 5, 10)).toBe(0)
    expect(stocks.extract('ground', 9, 15)).toBe(15)
    expect(s.ground.stock[9]).toBe(25)
  })

  it('takes nothing from a tile that holds nothing, or when asked for nothing', () => {
    const s = slots(slot([[5, ResourceType.Grain, 100]]))
    const stocks = new ResourceStocks(s, table)
    expect(stocks.extract('surface', 6, 10)).toBe(0)
    expect(stocks.extract('surface', 5, 0)).toBe(0)
    expect(s.surface.stock[5]).toBe(100)
  })

  it('leaves the richness and the resource type alone: a depleted mine is still a mine', () => {
    const s = slots(slot([]), slot([[9, ResourceType.Gold, 60]]))
    const stocks = new ResourceStocks(s, table)
    stocks.extract('ground', 9, 1000)
    expect(s.ground.stock[9]).toBe(0)
    expect(s.ground.type[9]).toBe(ResourceType.Gold)
    expect(s.ground.richness[9]).toBe(60)
  })

  it('rejects a negative or fractional amount, a tile off the map, and an unknown layer', () => {
    const stocks = new ResourceStocks(slots(slot([[5, ResourceType.Grain, 100]])), table)
    expect(() => stocks.extract('surface', 5, -1)).toThrow(RangeError)
    expect(() => stocks.extract('surface', 5, 1.5)).toThrow(RangeError)
    expect(() => stocks.extract('surface', 5, Number.NaN)).toThrow(RangeError)
    expect(() => stocks.extract('surface', -1, 1)).toThrow(RangeError)
    expect(() => stocks.extract('surface', N, 1)).toThrow(RangeError)
    expect(() => stocks.extract('surface', 2.5, 1)).toThrow(RangeError)
    expect(() => stocks.extract('sky' as never, 5, 1)).toThrow(RangeError)
  })
})

describe('regrowth', () => {
  it('tracks only the tiles that have been drawn down', () => {
    const stocks = new ResourceStocks(
      slots(
        slot([
          [1, ResourceType.Grain, 100],
          [2, ResourceType.Grain, 100],
          [3, ResourceType.Fish, 50]
        ])
      ),
      table
    )
    expect(stocks.pending).toBe(0)
    stocks.extract('surface', 1, 10)
    stocks.extract('surface', 3, 10)
    expect(stocks.pending).toBe(2)
    stocks.extract('surface', 1, 10) // already tracked
    expect(stocks.pending).toBe(2)
  })

  it('regrows a renewable stock by its rate on its own tick of each period', () => {
    // grain: 2 units per 10 ticks, on ticks where (tick + tile) % 10 === 0; tile 7 regrows at ticks 3, 13, 23
    const s = slots(slot([[7, ResourceType.Grain, 100]]))
    const stocks = new ResourceStocks(s, table)
    stocks.extract('surface', 7, 50)
    const seen: number[] = []
    for (let tick = 0; tick < 25; tick += 1) {
      stocks.regrow(tick)
      seen.push(s.surface.stock[7])
    }
    expect(seen[2]).toBe(50)
    expect(seen[3]).toBe(52)
    expect(seen[12]).toBe(52)
    expect(seen[13]).toBe(54)
    expect(seen[23]).toBe(56)
    expect(seen[24]).toBe(56)
  })

  it('never regrows past the richness, and stops tracking a tile once it is full', () => {
    // fish: 5 units per 4 ticks; tile 2 regrows when (tick + 2) % 4 === 0
    const s = slots(slot([[2, ResourceType.Fish, 12]]))
    const stocks = new ResourceStocks(s, table)
    stocks.extract('surface', 2, 12)
    for (let tick = 0; tick < 40; tick += 1) stocks.regrow(tick)
    expect(s.surface.stock[2]).toBe(12)
    expect(stocks.pending).toBe(0)
  })

  it('does not regrow ground resources, or a resource with no regrowth rate', () => {
    const s = slots(slot([[4, ResourceType.Pasture, 80]]), slot([[9, ResourceType.Iron, 50]]))
    const stocks = new ResourceStocks(s, table)
    stocks.extract('surface', 4, 40) // pasture has no entry in the table
    stocks.extract('ground', 9, 20)
    for (let tick = 0; tick < 500; tick += 1) stocks.regrow(tick)
    expect(s.surface.stock[4]).toBe(40)
    expect(s.ground.stock[9]).toBe(30)
    expect(stocks.pending).toBe(0)
  })

  it('spreads regrowth across ticks, so tiles do not all grow on the same tick', () => {
    const tiles: Array<[number, number, number]> = []
    for (let t = 0; t < 10; t += 1) tiles.push([t, ResourceType.Grain, 100])
    const s = slots(slot(tiles))
    const stocks = new ResourceStocks(s, table)
    for (let t = 0; t < 10; t += 1) stocks.extract('surface', t, 50)
    stocks.regrow(0)
    // period 10: of ten consecutive tiles exactly one has (0 + tile) % 10 === 0
    let grown = 0
    for (let t = 0; t < 10; t += 1) if (s.surface.stock[t] > 50) grown += 1
    expect(grown).toBe(1)
  })

  it('is rebuilt from the slots, so a world loaded part-way through finds its depleted tiles', () => {
    const s = slots(
      slot([
        [1, ResourceType.Grain, 100],
        [2, ResourceType.Grain, 100],
        [3, ResourceType.Iron, 100]
      ])
    )
    s.surface.stock[1] = 40
    s.ground.type[3] = ResourceType.Iron
    s.ground.richness[3] = 100
    s.ground.stock[3] = 10
    const stocks = new ResourceStocks(s, table)
    expect(stocks.pending).toBe(1) // tile 1 only: tile 2 is full, tile 3 is a finite mineral
    // 60 units to go at 2 per 10 ticks is 30 regrowths, so 300 ticks; allow 400
    for (let tick = 0; tick < 400; tick += 1) stocks.regrow(tick)
    expect(s.surface.stock[1]).toBe(100)
  })

  it('gives the same result however the work is split: two runs agree tick for tick', () => {
    const build = (): { s: ResourceSlots; stocks: ResourceStocks } => {
      const tiles: Array<[number, number, number]> = []
      for (let t = 0; t < 40; t += 1)
        tiles.push([t, t % 2 === 0 ? ResourceType.Grain : ResourceType.Timber, 30 + t])
      const s = slots(slot(tiles))
      return { s, stocks: new ResourceStocks(s, table) }
    }
    const a = build()
    const b = build()
    for (let tick = 0; tick < 300; tick += 1) {
      if (tick % 7 === 0) for (const w of [a, b]) w.stocks.extract('surface', tick % 40, 9)
      a.stocks.regrow(tick)
      b.stocks.regrow(tick)
    }
    expect(a.s.surface.stock).toEqual(b.s.surface.stock)
  })

  it('tracks and regrows more tiles than its first list holds', () => {
    const size = 6000
    const big: ResourceSlot = {
      type: new Uint8Array(size).fill(ResourceType.Grain),
      richness: new Uint8Array(size).fill(20),
      stock: new Uint8Array(size).fill(20)
    }
    const stocks = new ResourceStocks({ surface: big, ground: slot([]) }, table)
    for (let tile = 0; tile < 3000; tile += 1) stocks.extract('surface', tile, 20)
    expect(stocks.pending).toBe(3000)
    // 20 units at 2 per 10 ticks is 100 ticks
    for (let tick = 0; tick < 120; tick += 1) stocks.regrow(tick)
    expect(stocks.pending).toBe(0)
    for (let tile = 0; tile < 3000; tile += 1) expect(big.stock[tile]).toBe(20)
  })

  it('rejects a tick that is not a non-negative integer', () => {
    const stocks = new ResourceStocks(slots(slot([])), table)
    expect(() => stocks.regrow(-1)).toThrow(RangeError)
    expect(() => stocks.regrow(1.5)).toThrow(RangeError)
    expect(() => stocks.regrow(Number.NaN)).toThrow(RangeError)
  })
})
