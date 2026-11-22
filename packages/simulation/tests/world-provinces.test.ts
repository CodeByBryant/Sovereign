import { BIOME_INDEX } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { deriveStats } from '../src/nations/derive'
import { combineProfile } from '../src/nations/provinceProfile'
import { NO_PROVINCE } from '../src/terrain/provinces'
import { UNCLAIMED, World } from '../src/world/World'
import { smallWorldOverrides } from './support/worldOptions'

const make = (seed: number, options = {}): World =>
  World.create({ seed, config: smallWorldOverrides({ nations: 8, ...options }) })

const world = make(11)

describe('a world has provinces', () => {
  it('cuts the land into provinces of a sensible size', () => {
    const p = world.provinces
    expect(p.count).toBeGreaterThan(20)
    let land = 0
    for (let i = 0; i < world.terrain.elevation.length; i += 1) {
      if (world.terrain.elevation[i] > world.terrain.seaLevel) land += 1
    }
    let covered = 0
    for (let k = 0; k < p.count; k += 1) {
      covered += p.area[k]
      expect(p.area[k]).toBeGreaterThanOrEqual(world.config.provinces.minArea)
    }
    // all land is in a province, bar specks too small to be one
    expect(covered).toBeGreaterThan(land * 0.97)
    expect(covered).toBeLessThanOrEqual(land)
  })

  it('has no province in the sea', () => {
    for (let i = 0; i < world.terrain.elevation.length; i += 1) {
      if (world.terrain.elevation[i] <= world.terrain.seaLevel) {
        expect(world.provinces.provinceOf[i]).toBe(NO_PROVINCE)
      }
    }
  })

  it('is the same world twice, province by province', () => {
    const again = make(11)
    expect(Array.from(again.provinces.provinceOf)).toEqual(Array.from(world.provinces.provinceOf))
  })

  it('has facts for every province', () => {
    expect(world.provinceFacts.count).toBe(world.provinces.count)
  })
})

describe('nations own provinces', () => {
  it('starts every nation in the province of its capital, claimed first', () => {
    for (const n of world.nations) {
      const first = [...n.provinces][0]
      expect(first).toBe(world.provinces.provinceOf[n.capital])
    }
  })

  it('holds at least the starting area, in whole provinces', () => {
    const want = world.config.nations.startArea
    for (const n of world.nations) {
      const area = [...n.provinces].reduce((s, p) => s + world.provinces.area[p], 0)
      // it stops at the first province that takes it to the starting area (or when no more can be reached)
      const lastArea = world.provinces.area[[...n.provinces].pop()!]!
      expect(area - lastArea).toBeLessThan(want)
      expect(n.profile.area).toBe(area)
      expect(n.totalArea).toBe(area)
    }
    // some nations have taken more than one province
    expect(world.nations.some((n) => n.provinces.size > 1)).toBe(true)
  })

  it('holds provinces that touch, claim after claim', () => {
    const p = world.provinces
    for (const n of world.nations) {
      const held = new Set<number>()
      for (const id of n.provinces) {
        if (held.size > 0) {
          const near = Array.from(
            p.neighbourId.subarray(p.neighbourStart[id], p.neighbourStart[id + 1])
          )
          expect(near.some((q) => held.has(q))).toBe(true)
        }
        held.add(id)
      }
    }
  })

  it('shares the provinces: none has two owners, and the ownership layer agrees tile by tile', () => {
    const seen = new Set<number>()
    world.nations.forEach((n) => {
      for (const id of n.provinces) {
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
    })
    const p = world.provinces
    const own = world.map.ownership
    const ownerOf = new Map<number, number>()
    world.nations.forEach((n, i) => n.provinces.forEach((id) => ownerOf.set(id, i)))
    for (let i = 0; i < own.length; i += 1) {
      const province = p.provinceOf[i]
      expect(own[i]).toBe(
        province === NO_PROVINCE ? UNCLAIMED : (ownerOf.get(province) ?? UNCLAIMED)
      )
    }
  })

  it('has a profile that is the sum of its provinces, and the stats of that profile', () => {
    for (const n of world.nations) {
      expect(n.profile).toEqual(
        combineProfile(world.provinceFacts, n.provinces, n.profile.contacts)
      )
      expect(n.stats).toEqual(deriveStats(n.profile))
    }
  })

  it('does not own a province that is mostly ice', () => {
    const t = world.terrain
    for (const n of world.nations) {
      for (const id of n.provinces) {
        const tiles = world.provinces.tiles.subarray(
          world.provinces.start[id],
          world.provinces.start[id + 1]
        )
        let ice = 0
        for (const tile of tiles) {
          const biome = t.biomeIds[tile]
          if (biome === BIOME_INDEX.glacier || biome === BIOME_INDEX.polar_desert) ice += 1
        }
        expect(ice).toBeLessThanOrEqual(tiles.length / 2)
      }
    }
  })

  it('starts the expansion points at nothing', () => {
    for (const n of world.nations) expect(n.expansionPoints).toBe(0)
  })

  it('reports provinces in the snapshot', () => {
    const snap = world.snapshot()
    snap.nations.forEach((s, i) => {
      expect(s.provinceCount).toBe(world.nations[i]!.provinces.size)
      expect(s.area).toBe(world.nations[i]!.profile.area)
    })
  })
})

describe('validate: province ownership that does not add up', () => {
  const fresh = (): World => make(11)

  it('is sound as made', () => {
    expect(fresh().validate()).toEqual([])
  })

  it.each([
    ['one past the last', 0],
    ['far past the last', 5],
    ['negative', -1],
    ['fractional', 0.5]
  ])('catches a province id that is %s', (_label, offset) => {
    const w = fresh()
    w.nations[0]!.provinces.add(
      offset === -1 || offset === 0.5 ? offset : w.provinces.count + offset
    )
    expect(w.validate().join('\n')).toMatch(/not on the map/)
  })

  it('catches a province two nations hold', () => {
    const w = fresh()
    const stolen = [...w.nations[1]!.provinces][0]!
    w.nations[0]!.provinces.add(stolen)
    expect(w.validate().join('\n')).toMatch(/both|twice|two nations/)
  })

  it('catches a tile whose ownership disagrees with its province', () => {
    const w = fresh()
    const id = [...w.nations[0]!.provinces][0]!
    const tile = w.provinces.tiles[w.provinces.start[id]!]!
    w.map.ownership[tile] = UNCLAIMED
    expect(w.validate().join('\n')).toMatch(/ownership/)
  })

  it("catches a capital that is not in the nation's provinces", () => {
    const w = fresh()
    w.nations[0]!.provinces.delete([...w.nations[0]!.provinces][0]!)
    expect(w.validate().join('\n')).toMatch(/capital/)
  })

  it('catches a profile that is not the sum of the provinces', () => {
    const w = fresh()
    w.nations[0]!.profile.food += 1
    expect(w.validate().join('\n')).toMatch(/profile of nation-0 is not the sum of its provinces/)
  })

  it('catches stats that are not those of the profile', () => {
    const w = fresh()
    w.nations[0]!.stats.population += 1
    expect(w.validate().join('\n')).toMatch(/stats of nation-0 are not those of its profile/)
  })

  it('catches expansion points that are not a finite number of 0 or more', () => {
    const w = fresh()
    w.nations[0]!.expansionPoints = -1
    expect(w.validate().join('\n')).toMatch(/expansion/)
    w.nations[0]!.expansionPoints = Number.NaN
    expect(w.validate().join('\n')).toMatch(/expansion/)
  })
})

describe('stateHash sees provinces and expansion points', () => {
  it("changes with a nation's expansion points", () => {
    const w = make(11)
    const before = w.stateHash()
    w.nations[0]!.expansionPoints = 3.5
    expect(w.stateHash()).not.toBe(before)
  })

  it('changes with which provinces a nation holds', () => {
    const w = make(11)
    const before = w.stateHash()
    const n = w.nations[0]!
    n.provinces = new Set([...n.provinces].reverse())
    if (n.provinces.size > 1) expect(w.stateHash()).not.toBe(before)
    else expect(w.stateHash()).toBe(before)
  })

  it('is the same for the same world', () => {
    expect(make(11).stateHash()).toBe(make(11).stateHash())
  })
})
