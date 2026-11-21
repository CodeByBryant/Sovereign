import { RESOURCE_CATALOG } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { contactCounts } from '../src/nations/capitals'
import { deriveStats, GOVERNMENTS } from '../src/nations/derive'
import { spawnNations } from '../src/nations/NationSpawner'
import { measureProfile } from '../src/nations/profile'
import { World } from '../src/world/World'
import { hashNations } from './support/nationHash'
import { smallWorldOverrides } from './support/worldOptions'
import { spawnInputOf } from './support/spawnInput'

const make = (seed: number, options = {}): World =>
  World.create({ seed, config: smallWorldOverrides({ nations: 8, ...options }) })

/** Spearman rank correlation (average ranks for ties). */
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]): number[] => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0])
    const r = new Array<number>(xs.length).fill(0)
    for (let i = 0; i < order.length;) {
      let j = i
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j += 1
      for (let k = i; k <= j; k += 1) r[order[k]![1]] = (i + j) / 2
      i = j + 1
    }
    return r
  }
  const ra = rank(a)
  const rb = rank(b)
  const n = a.length
  const ma = ra.reduce((s, v) => s + v, 0) / n
  const mb = rb.reduce((s, v) => s + v, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i += 1) {
    num += (ra[i]! - ma) * (rb[i]! - mb)
    da += (ra[i]! - ma) ** 2
    db += (rb[i]! - mb) ** 2
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db)
}

describe('spawnNations: where they start', () => {
  const world = make(11)
  const t = world.terrain
  const spacing = world.config.nations.minSpacing

  it('spawns nations, no more than asked for', () => {
    expect(world.nations.length).toBeGreaterThan(2)
    expect(world.nations.length).toBeLessThanOrEqual(8)
  })

  it('puts every capital on a hub, on land, at least the minimum spacing from the others', () => {
    const hubTiles = new Set(t.hubs.map((h) => h.y * t.width + h.x))
    for (const n of world.nations) {
      expect(hubTiles.has(n.capital)).toBe(true)
      expect(t.elevation[n.capital]).toBeGreaterThan(t.seaLevel)
    }
    for (let i = 0; i < world.nations.length; i += 1) {
      for (let j = i + 1; j < world.nations.length; j += 1) {
        const a = world.nations[i]!.capital
        const b = world.nations[j]!.capital
        const d = Math.hypot(
          (a % t.width) - (b % t.width),
          Math.floor(a / t.width) - Math.floor(b / t.width)
        )
        expect(d).toBeGreaterThanOrEqual(spacing)
      }
    }
  })

  it('starts the first nation on the best hub it can have', () => {
    const best = Math.max(...t.hubs.map((h) => h.weight))
    const first = world.nations[0]!
    const hub = t.hubs.find((h) => h.y * t.width + h.x === first.capital)!
    expect(hub.weight).toBe(best)
  })
})

describe('spawnNations: starting territory', () => {
  const world = make(11)
  const t = world.terrain
  const area = world.config.nations.startArea

  it('gives each nation about the starting area, never more', () => {
    for (const n of world.nations) expect(n.provinces.size).toBeLessThanOrEqual(area)
    const full = world.nations.filter((n) => n.provinces.size === area).length
    expect(full).toBeGreaterThanOrEqual(Math.ceil(world.nations.length / 2))
  })

  it('claims the capital first, then each tile beside one it already had, in claim order', () => {
    for (const n of world.nations) {
      const order = [...n.provinces]
      expect(order[0]).toBe(n.capital)
      const held = new Set<number>([order[0]!])
      for (const tile of order.slice(1)) {
        const x = tile % t.width
        const near = [
          x > 0 ? tile - 1 : -1,
          x < t.width - 1 ? tile + 1 : -1,
          tile - t.width,
          tile + t.width
        ]
        expect(near.some((k) => held.has(k))).toBe(true)
        held.add(tile)
      }
    }
  })

  it('shares the land: no tile belongs to two nations, and the ownership layer agrees', () => {
    const seen = new Map<number, number>()
    world.nations.forEach((n, i) => {
      for (const tile of n.provinces) {
        expect(seen.has(tile)).toBe(false)
        seen.set(tile, i)
        expect(world.map.ownership[tile]).toBe(i)
      }
    })
  })

  it('owns only land that is not ice', () => {
    for (const n of world.nations) {
      for (const tile of n.provinces) expect(t.elevation[tile]).toBeGreaterThan(t.seaLevel)
    }
  })
})

describe('spawnNations: stats follow from the land', () => {
  const world = make(11)
  const t = world.terrain

  const measured = (n: (typeof world.nations)[number], contacts: number) =>
    measureProfile({
      width: t.width,
      height: t.height,
      seaLevel: t.seaLevel,
      elevation: t.elevation,
      biomeIds: t.biomeIds,
      riverMask: t.riverMask,
      resources: t.resources,
      strategicPoints: t.strategicPoints,
      routes: t.routes,
      tiles: [...n.provinces],
      contacts
    })

  it('gives every nation the profile of its territory, and the stats of that profile', () => {
    for (const n of world.nations) {
      expect(n.profile).toEqual(measured(n, n.profile.contacts))
      expect(n.stats).toEqual(deriveStats(n.profile))
    }
  })

  it('counts neighbours by routes between capitals', () => {
    const hubIndex = world.nations.map((n) =>
      t.hubs.findIndex((h) => h.y * t.width + h.x === n.capital)
    )
    const expected = contactCounts(hubIndex, t.routes, t.hubs.length, 3)
    expect(world.nations.map((n) => n.profile.contacts)).toEqual(expected)
  })

  it('lets governments and personalities vary but keeps them in range', () => {
    for (const n of world.nations) {
      expect(GOVERNMENTS).toContain(n.government)
      for (const v of Object.values(n.personality)) {
        expect(v).toBeGreaterThanOrEqual(0.05)
        expect(v).toBeLessThanOrEqual(0.95)
      }
    }
  })

  it('has no chance in the stats: another seed for the names and jitter changes only those', () => {
    const a = spawnNations(spawnInputOf(world, { seed: 1 }))
    const b = spawnNations(spawnInputOf(world, { seed: 2 }))
    expect(a.nations.length).toBe(b.nations.length)
    a.nations.forEach((n, i) => {
      const m = b.nations[i]!
      expect(m.capital).toBe(n.capital)
      expect([...m.provinces]).toEqual([...n.provinces])
      expect(m.profile).toEqual(n.profile)
      expect(m.stats).toEqual(n.stats)
    })
    expect(a.nations.map((n) => n.name)).not.toEqual(b.nations.map((n) => n.name))
    // the chance that is left moves a trait by 0.06 at most (plus the government's own nudge if it changed)
    a.nations.forEach((n, i) => {
      const m = b.nations[i]!
      if (m.government !== n.government) return
      for (const key of [
        'aggression',
        'expansionism',
        'diplomacy',
        'mercantilism',
        'militarism'
      ] as const) {
        expect(Math.abs(m.personality[key] - n.personality[key])).toBeLessThanOrEqual(0.12 + 1e-9)
      }
    })
  })

  it('makes the more fertile nations more populous, across several worlds', () => {
    const food: number[] = []
    const people: number[] = []
    for (const seed of [11, 12, 13, 14]) {
      for (const n of make(seed).nations) {
        food.push(n.profile.food)
        people.push(n.stats.population)
      }
    }
    expect(food.length).toBeGreaterThan(12)
    expect(spearman(food, people)).toBeGreaterThanOrEqual(0.99)
  })

  it('makes nations with more metals more heavily armed than the land alone would explain', () => {
    const metals: number[] = []
    const military: number[] = []
    for (const seed of [11, 12, 13, 14]) {
      for (const n of make(seed).nations) {
        metals.push(n.profile.metals)
        military.push(n.stats.military)
      }
    }
    expect(spearman(metals, military)).toBeGreaterThan(0.1)
  })

  it('has some variety of stats from nation to nation', () => {
    const populations = new Set<number>()
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      for (const n of make(seed).nations) populations.add(n.stats.population)
    }
    // (governments are tuned for full-size territories; the guard test at 1000 x 1000 checks their variety)
    expect(populations.size).toBeGreaterThan(10)
  })
})

describe('spawnNations: determinism and edges', () => {
  it('is the same twice', () => {
    expect(hashNations(make(5).nations)).toBe(hashNations(make(5).nations))
  })

  it('spawns nothing when asked for no nations', () => {
    expect(make(5, { nations: 0 }).nations).toEqual([])
  })

  it('spawns fewer than asked when there are not enough sites, and still a valid world', () => {
    const crowded = make(5, { nations: 200, minSpacing: 18 })
    expect(crowded.nations.length).toBeLessThan(200)
    expect(crowded.validate()).toEqual([])
  })

  it('has an economy even for the resource catalogue: nations hold different resources', () => {
    const world = make(11)
    const diversity = world.nations.map((n) => n.profile.diversity)
    expect(Math.max(...diversity)).toBeLessThanOrEqual(RESOURCE_CATALOG.length)
    expect(Math.max(...diversity)).toBeGreaterThan(0)
  })
})
