import { describe, expect, it } from 'vitest'
import { defaultWorldConfig, type ExpansionConfig } from '@sovereign/config'
import { deriveStats } from '../src/nations/derive'
import { Nation } from '../src/nations/Nation'
import { combineProfile, type ProvinceFacts } from '../src/nations/provinceProfile'
import {
  claimCost,
  expansionRate,
  ExpansionSystem,
  processingOrder,
  provinceValue
} from '../src/systems/ExpansionSystem'
import { buildProvinces, type ProvinceMap } from '../src/terrain/provinces'
import { UNCLAIMED } from '../src/world/World'

/** Provinces of 11 x 11 tiles (odd, so no tile is a tie) on a lattice (id = row * cols + col); `rough(col, row)` costs 4 to cross, not 1. */
function lattice(
  cols: number,
  rows: number,
  rough: (c: number, r: number) => boolean = () => false
) {
  const width = cols * 11
  const height = rows * 11
  const land = new Uint8Array(width * height).fill(1)
  const cost = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cost[y * width + x] = rough(Math.floor(x / 11), Math.floor(y / 11)) ? 4 : 1
    }
  }
  const seeds: number[] = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) seeds.push((r * 11 + 5) * width + c * 11 + 5)
  }
  const map = buildProvinces({ width, height, land, cost, spacing: 11, minArea: 1, seeds })
  return { map, width, height }
}

function emptyFacts(map: ProvinceMap): ProvinceFacts {
  const n = map.count
  return {
    count: n,
    area: map.area,
    food: new Float64Array(n),
    timber: new Float64Array(n),
    stone: new Float64Array(n),
    horses: new Float64Array(n),
    metals: new Float64Array(n),
    luxuries: new Float64Array(n),
    coast: new Float64Array(n),
    river: new Float64Array(n),
    highGround: new Float64Array(n),
    defence: new Float64Array(n),
    traffic: new Float64Array(n),
    kinds: new Uint32Array(n)
  }
}

interface Setup {
  map: ProvinceMap
  facts: ProvinceFacts
  nations: Nation[]
  claimable: Uint8Array
  provinceOwner: Uint8Array
  ownership: Uint8Array
  system: ExpansionSystem
  config: ExpansionConfig
}

/** Nations on a lattice: `owned[k]` is the provinces nation k starts with (the first is its capital's). */
function setup(
  cols: number,
  rows: number,
  owned: number[][],
  over: {
    rough?: (c: number, r: number) => boolean
    food?: (p: number) => number
    claimable?: (p: number) => boolean
    config?: Partial<ExpansionConfig>
    expansionism?: number
    population?: number
    timestep?: number
    points?: number[]
  } = {}
): Setup {
  const { map, width, height } = lattice(cols, rows, over.rough)
  const facts = emptyFacts(map)
  for (let p = 0; p < map.count; p += 1) facts.food[p] = over.food?.(p) ?? 10
  const claimable = new Uint8Array(map.count)
  for (let p = 0; p < map.count; p += 1) claimable[p] = (over.claimable?.(p) ?? true) ? 1 : 0
  const provinceOwner = new Uint8Array(map.count).fill(UNCLAIMED)
  const ownership = new Uint8Array(width * height).fill(UNCLAIMED)
  const nations = owned.map((ids, k) => {
    ids.forEach((p) => {
      provinceOwner[p] = k
      for (let i = map.start[p]; i < map.start[p + 1]; i += 1) ownership[map.tiles[i]] = k
    })
    const profile = combineProfile(facts, ids, 0)
    return new Nation({
      id: `n${k}`,
      name: `N${k}`,
      color: [1, 2, 3],
      flag: { type: 'solid', background: [0, 0, 0], accent: [0, 0, 0] },
      government: 'republic',
      personality: {
        aggression: 0.5,
        expansionism: over.expansionism ?? 0.5,
        diplomacy: 0.5,
        mercantilism: 0.5,
        militarism: 0.5
      },
      capital: map.seed[ids[0] as number] as number,
      provinces: new Set(ids),
      stats: { ...deriveStats(profile), population: over.population ?? 100 },
      profile,
      expansionPoints: over.points?.[k] ?? 0
    })
  })
  const config = { ...defaultWorldConfig.expansion, ...over.config }
  const system = new ExpansionSystem({
    nations,
    provinces: map,
    facts,
    claimable,
    provinceOwner,
    ownership,
    config,
    timestep: over.timestep ?? 1
  })
  return { map, facts, nations, claimable, provinceOwner, ownership, system, config }
}

describe('processingOrder: who goes first rotates, so no nation is always first', () => {
  it('starts at the nation whose index is the tick, wrapping around', () => {
    expect(processingOrder(0, 4)).toEqual([0, 1, 2, 3])
    expect(processingOrder(1, 4)).toEqual([1, 2, 3, 0])
    expect(processingOrder(3, 4)).toEqual([3, 0, 1, 2])
    expect(processingOrder(4, 4)).toEqual([0, 1, 2, 3])
    expect(processingOrder(10, 4)).toEqual([2, 3, 0, 1])
  })

  it('is empty for no nations', () => {
    expect(processingOrder(5, 0)).toEqual([])
  })
})

describe('the rate, the price and the value', () => {
  const nation = (
    expansionism: number,
    population: number
  ): Pick<Nation, 'personality' | 'stats'> =>
    ({
      personality: { aggression: 0, expansionism, diplomacy: 0, mercantilism: 0, militarism: 0 },
      stats: { population, military: 0, economy: 0, diplomacy: 0 }
    }) as Pick<Nation, 'personality' | 'stats'>
  const config: ExpansionConfig = { rate: 2, costPerTile: 0.1 }

  it('is the configured rate at 100 people and an expansionism of 0.5', () => {
    expect(expansionRate(nation(0.5, 100), config, 1)).toBe(2)
  })

  it('grows with expansionism as 0.5 + expansionism', () => {
    expect(expansionRate(nation(1, 100), config, 1)).toBe(3)
    expect(expansionRate(nation(0, 100), config, 1)).toBe(1)
  })

  it('grows with the square root of the population over 100', () => {
    expect(expansionRate(nation(0.5, 400), config, 1)).toBe(4)
    expect(expansionRate(nation(0.5, 25), config, 1)).toBe(1)
  })

  it('is per day, so a tick of several days earns several days of it', () => {
    expect(expansionRate(nation(0.5, 100), config, 3)).toBe(6)
  })

  it('prices a province by its area and how hard it is to cross', () => {
    const { map } = lattice(2, 1, (c) => c === 1)
    expect(claimCost(map, 0, config)).toBeCloseTo(0.1 * map.area[0] * map.meanCost[0], 6)
    expect(claimCost(map, 1, config)).toBeCloseTo(0.1 * map.area[1] * map.meanCost[1], 6)
    // per tile, the rough province (cost 4 to cross) is dearer than the easy one
    expect(claimCost(map, 1, config) / map.area[1]).toBeGreaterThan(
      2 * (claimCost(map, 0, config) / map.area[0])
    )
  })

  it('values a province by what its land gives', () => {
    const { map } = lattice(1, 1)
    const facts = emptyFacts(map)
    expect(provinceValue(facts, 0)).toBeGreaterThan(0) // never nothing, so a barren province still counts
    const base = provinceValue(facts, 0)
    for (const key of [
      'food',
      'timber',
      'stone',
      'horses',
      'metals',
      'luxuries',
      'defence'
    ] as const) {
      const rich = emptyFacts(map)
      rich[key][0] = 10
      expect(provinceValue(rich, 0), key).toBeGreaterThan(base)
    }
  })
})

describe('ExpansionSystem: earning and spending', () => {
  it('earns points every tick at its rate', () => {
    const s = setup(5, 1, [[0]], { config: { costPerTile: 1000 } }) // too dear to buy
    s.system.step(0)
    expect(s.nations[0]!.expansionPoints).toBe(expansionRate(s.nations[0]!, s.config, 1))
    s.system.step(1)
    expect(s.nations[0]!.expansionPoints).toBe(2 * expansionRate(s.nations[0]!, s.config, 1))
    expect(s.system.claims).toBe(0)
  })

  it('claims a province once it can pay for it, and pays', () => {
    const s = setup(3, 1, [[0]])
    const cost = claimCost(s.map, 1, s.config)
    const rate = expansionRate(s.nations[0]!, s.config, 1)
    s.nations[0]!.expansionPoints = cost - rate + 0.25
    s.system.step(0)
    expect([...s.nations[0]!.provinces]).toEqual([0, 1])
    expect(s.nations[0]!.expansionPoints).toBeCloseTo(0.25, 9)
    expect(s.system.claims).toBe(1)
  })

  it('claims when it has exactly enough', () => {
    // numbers a float holds exactly: a province of 11 x 11 tiles at a price of 0.5 a tile costs 60.5
    const s = setup(3, 1, [[0]], { config: { rate: 2, costPerTile: 0.5 } })
    expect(claimCost(s.map, 1, s.config)).toBe(60.5)
    s.nations[0]!.expansionPoints = 58.5 // plus the 2 it earns this tick
    s.system.step(0)
    expect([...s.nations[0]!.provinces]).toEqual([0, 1])
    expect(s.nations[0]!.expansionPoints).toBe(0)
  })

  it('does not claim when it is a hair short', () => {
    const s = setup(3, 1, [[0]])
    const cost = claimCost(s.map, 1, s.config)
    const rate = expansionRate(s.nations[0]!, s.config, 1)
    s.nations[0]!.expansionPoints = cost - rate - 1e-6
    s.system.step(0)
    expect([...s.nations[0]!.provinces]).toEqual([0])
  })

  it('claims several provinces in one tick when it can pay for them', () => {
    const s = setup(5, 1, [[0]], { points: [1e9] })
    s.system.step(0)
    expect(s.nations[0]!.provinces.size).toBe(5)
    expect(s.system.claims).toBe(4)
  })

  it('claims only provinces beside the land it holds, one ring at a time', () => {
    const s = setup(5, 5, [[12]], { points: [1e9] })
    s.system.step(0)
    expect(s.nations[0]!.provinces.size).toBe(25) // all of them, but each beside one it already held
    const order = [...s.nations[0]!.provinces]
    const held = new Set<number>([order[0]!])
    for (const p of order.slice(1)) {
      const near = Array.from(
        s.map.neighbourId.subarray(s.map.neighbourStart[p], s.map.neighbourStart[p + 1])
      )
      expect(near.some((q) => held.has(q))).toBe(true)
      held.add(p)
    }
  })

  it('takes the best value for its price among the provinces on its border', () => {
    // nation at the left end of a strip of 5; the province to its right is poor, the other neighbours are rich
    const s = setup(3, 3, [[4]], {
      food: (p) => (p === 1 ? 500 : p === 3 ? 40 : p === 5 ? 20 : 10)
    })
    const cost = claimCost(s.map, 1, s.config)
    const rate = expansionRate(s.nations[0]!, s.config, 1)
    s.nations[0]!.expansionPoints = cost - rate + 0.01
    s.system.step(0)
    expect([...s.nations[0]!.provinces]).toEqual([4, 1])
  })

  it('weighs the price: the same value on easier ground is better', () => {
    // the centre province has a rough neighbour to the west (the lower id) and an easy one to the east,
    // both worth the same: the easy one is cheaper, so it is the better buy
    const s = setup(3, 1, [[1]], { rough: (c) => c === 0 })
    const cost = claimCost(s.map, 2, s.config)
    const rate = expansionRate(s.nations[0]!, s.config, 1)
    s.nations[0]!.expansionPoints = cost - rate + 0.01
    s.system.step(0)
    expect([...s.nations[0]!.provinces]).toEqual([1, 2])
  })

  it('breaks ties between equally good provinces by the lower id', () => {
    const s = setup(3, 1, [[1]])
    const cost = claimCost(s.map, 0, s.config)
    const rate = expansionRate(s.nations[0]!, s.config, 1)
    s.nations[0]!.expansionPoints = cost - rate + 0.01
    s.system.step(0)
    expect([...s.nations[0]!.provinces]).toEqual([1, 0])
  })

  it('never claims a province that cannot be claimed', () => {
    const s = setup(3, 1, [[0]], { claimable: (p) => p !== 1, points: [1e9] })
    s.system.step(0)
    expect([...s.nations[0]!.provinces]).toEqual([0]) // the province in the way is ice; nothing past it is reachable
  })

  it('never takes a province another nation holds', () => {
    const s = setup(4, 1, [[0], [3]], { points: [1e9, 1e9] })
    s.system.step(0)
    const a = [...s.nations[0]!.provinces]
    const b = [...s.nations[1]!.provinces]
    expect(a.filter((p) => b.includes(p))).toEqual([])
    expect(a.length + b.length).toBe(4)
  })
})

describe('ExpansionSystem: fairness', () => {
  it('lets the nation that goes first take a province both can afford, and rotates who that is', () => {
    // two nations, one free province between them
    const first = setup(3, 1, [[0], [2]], { points: [1e9, 1e9] })
    first.system.step(0) // order 0, 1
    expect([...first.nations[0]!.provinces]).toEqual([0, 1])
    expect([...first.nations[1]!.provinces]).toEqual([2])
    const second = setup(3, 1, [[0], [2]], { points: [1e9, 1e9] })
    second.system.step(1) // order 1, 0
    expect([...second.nations[0]!.provinces]).toEqual([0])
    expect([...second.nations[1]!.provinces]).toEqual([2, 1])
  })
})

describe('ExpansionSystem: stats and ownership follow the land', () => {
  it('re-sums the profile and re-derives the stats after a claim', () => {
    const s = setup(3, 1, [[0]], { food: (p) => 100 * (p + 1), points: [1e9] })
    s.system.step(0)
    const n = s.nations[0]!
    expect(n.profile).toEqual(combineProfile(s.facts, n.provinces, 0))
    expect(n.profile.food).toBe(600)
    expect(n.profile.area).toBe(s.map.area[0]! + s.map.area[1]! + s.map.area[2]!)
    // every stat is re-derived from the new land, population included: a bigger nation feeds more people
    expect(n.stats).toEqual(deriveStats(n.profile))
    expect(n.stats.population).not.toBe(100)
  })

  it('writes the owner of every tile of a claimed province', () => {
    const s = setup(3, 1, [[0]], { points: [1e9] })
    s.system.step(0)
    for (let p = 0; p < 3; p += 1) {
      expect(s.provinceOwner[p]).toBe(0)
      for (let i = s.map.start[p]!; i < s.map.start[p + 1]!; i += 1) {
        expect(s.ownership[s.map.tiles[i]!]).toBe(0)
      }
    }
  })

  it('keeps the contacts a nation has', () => {
    const s = setup(3, 1, [[0]], { points: [1e9] })
    s.nations[0]!.profile = { ...s.nations[0]!.profile, contacts: 4 }
    s.system.step(0)
    expect(s.nations[0]!.profile.contacts).toBe(4)
  })
})

describe('ExpansionSystem: it saturates, and then the borders are stable', () => {
  it('stops claiming when nothing free is left beside it, and holds no points then', () => {
    const s = setup(3, 1, [[0]], { points: [1e9] })
    s.system.step(0)
    expect(s.nations[0]!.provinces.size).toBe(3)
    s.system.step(1)
    expect(s.nations[0]!.expansionPoints).toBe(0)
    expect(s.system.claims).toBe(2)
    expect(s.system.saturated).toBe(true)
  })

  it('is not saturated while a nation still has a province to take', () => {
    const s = setup(3, 1, [[0]])
    expect(s.system.saturated).toBe(false)
  })

  it('leaves a province that no nation can reach free for good', () => {
    // a wall of ice (province 1) cuts the strip: province 2 is out of reach
    const s = setup(3, 1, [[0]], { claimable: (p) => p !== 1 && p !== 2, points: [1e9] })
    s.system.step(0)
    expect(s.provinceOwner[2]).toBe(UNCLAIMED)
    expect(s.system.saturated).toBe(true)
  })

  it('changes nothing at all after saturation', () => {
    const s = setup(4, 4, [[0], [15]], { points: [1e9, 1e9] })
    s.system.step(0)
    expect(s.system.saturated).toBe(true)
    const before = JSON.stringify([
      s.nations.map((n) => [...n.provinces, n.expansionPoints, n.profile, n.stats]),
      Array.from(s.provinceOwner),
      Array.from(s.ownership)
    ])
    for (let t = 1; t < 50; t += 1) s.system.step(t)
    const after = JSON.stringify([
      s.nations.map((n) => [...n.provinces, n.expansionPoints, n.profile, n.stats]),
      Array.from(s.provinceOwner),
      Array.from(s.ownership)
    ])
    expect(after).toBe(before)
  })

  it('has a border for every nation that lists exactly the free provinces next to it', () => {
    const s = setup(3, 3, [[0], [8]])
    expect(s.system.frontier(0)).toEqual([1, 3])
    expect(s.system.frontier(1)).toEqual([5, 7])
  })

  it('does not list a province on two borders twice, nor one that was taken', () => {
    const s = setup(3, 1, [[0], [2]], { points: [1e9, 0] })
    expect(s.system.frontier(0)).toEqual([1])
    expect(s.system.frontier(1)).toEqual([1])
    s.system.step(0)
    expect(s.system.frontier(0)).toEqual([])
    expect(s.system.frontier(1)).toEqual([])
  })
})

describe('ExpansionSystem: no nations', () => {
  it('does nothing and is saturated', () => {
    const s = setup(2, 1, [])
    s.system.step(0)
    expect(s.system.claims).toBe(0)
    expect(s.system.saturated).toBe(true)
  })
})
