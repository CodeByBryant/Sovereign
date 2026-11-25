import { ResourceType } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { deriveStats } from '../src/nations/derive'
import { FOOD_FISH, FOOD_GRAIN, fullStockTable } from '../src/nations/profile'
import { NO_PROVINCE } from '../src/terrain/provinces'
import { buildProvinceLayer } from '../src/world/provinceLayer'
import { decodeWorld, encodeWorld } from '../src/serialization/save'
import { UNCLAIMED, World } from '../src/world/World'
import { smallWorldOverrides } from './support/worldOptions'

const make = (seed = 11): World =>
  World.create({ seed, config: smallWorldOverrides({ nations: 6 }) })

/** A land tile in a province held by a nation, whose slot of `layer` holds `type` (with `minStock` to spare). */
function ownedTile(
  world: World,
  layer: 'surface' | 'ground',
  type: ResourceType,
  minStock = 4
): number {
  const slot = world.terrain.resources[layer]
  for (let i = 0; i < slot.type.length; i += 1) {
    const p = world.provinces.provinceOf[i]!
    if (
      slot.type[i] === type &&
      slot.stock[i]! >= minStock &&
      p !== NO_PROVINCE &&
      world.provinceOwner[p] !== UNCLAIMED
    ) {
      return i
    }
  }
  throw new Error(`no owned ${ResourceType[type]} tile`)
}

/** Every fact of every province is what a fresh computation from the world as it is now gives. */
function expectFactsFresh(world: World): void {
  const fresh = buildProvinceLayer(world.terrain, world.config).facts
  for (const key of [
    'food',
    'timber',
    'stone',
    'horses',
    'metals',
    'luxuries',
    'coast',
    'river',
    'highGround',
    'defence',
    'traffic'
  ] as const) {
    expect(Array.from(world.provinceFacts[key]), key).toEqual(Array.from(fresh[key]))
  }
  expect(Array.from(world.provinceFacts.kinds)).toEqual(Array.from(fresh.kinds))
}

describe('what a province holds follows what is left in the ground', () => {
  it('lowers the profile and the stats of the owner when its grain is taken', () => {
    const w = make()
    const tile = ownedTile(w, 'surface', ResourceType.Grain)
    const province = w.provinces.provinceOf[tile]!
    const owner = w.nations[w.provinceOwner[province]!]!
    const before = owner.profile.food
    const stock = w.terrain.resources.surface.stock[tile]!
    const full = fullStockTable(w.config.resources.rules)[ResourceType.Grain]!
    const taken = w.extractResource('surface', tile, stock)
    expect(taken).toBe(stock)
    expect(owner.profile.food).toBeCloseTo(before - (FOOD_GRAIN * stock) / full, 9)
    expect(owner.stats).toEqual(deriveStats(owner.profile))
    expect(w.validate()).toEqual([])
    expectFactsFresh(w)
  })

  it('re-derives the stats too, when a whole province is drawn down far enough to move them', () => {
    const w = make()
    const owner = w.nations[0]!
    const before = { ...owner.stats }
    for (const province of owner.provinces) {
      for (let k = w.provinces.start[province]!; k < w.provinces.start[province + 1]!; k += 1) {
        const tile = w.provinces.tiles[k]!
        w.extractResource('surface', tile, 255)
        w.extractResource('ground', tile, 255)
      }
    }
    expect(owner.stats).toEqual(deriveStats(owner.profile))
    // (the biome's fertility is not drawn down, so population may hold: some stat has to move)
    expect(owner.stats).not.toEqual(before)
    expect(w.validate()).toEqual([])
  })

  it('changes nothing for a nation when a province nobody holds is mined', () => {
    const w = make()
    const slot = w.terrain.resources.ground
    let tile = -1
    for (let i = 0; i < slot.type.length && tile < 0; i += 1) {
      const p = w.provinces.provinceOf[i]!
      if (
        slot.type[i] !== 0 &&
        slot.stock[i]! > 10 &&
        p !== NO_PROVINCE &&
        w.provinceOwner[p] === UNCLAIMED
      )
        tile = i
    }
    expect(tile).toBeGreaterThanOrEqual(0)
    const profiles = JSON.stringify(w.nations.map((n) => n.profile))
    w.extractResource('ground', tile, 10)
    expect(JSON.stringify(w.nations.map((n) => n.profile))).toBe(profiles)
    expect(w.validate()).toEqual([])
    expectFactsFresh(w)
  })

  it('lowers the food of a coast when the fishery beside it is fished out', () => {
    const w = make()
    w.run(600) // let the nations grow onto more coast
    const slot = w.terrain.resources.surface
    const t = w.terrain
    // a fishery in the sea beside an owned coastal tile
    let sea = -1
    let land = -1
    for (let i = 0; i < slot.type.length && sea < 0; i += 1) {
      if (slot.type[i] !== ResourceType.Fish || slot.stock[i]! < 6) continue
      const x = i % t.width
      const near = [x > 0 ? i - 1 : -1, x < t.width - 1 ? i + 1 : -1, i - t.width, i + t.width]
      for (const n of near) {
        if (n < 0 || n >= slot.type.length || t.elevation[n]! <= t.seaLevel) continue
        const p = w.provinces.provinceOf[n]!
        if (p !== NO_PROVINCE && w.provinceOwner[p] !== UNCLAIMED) {
          sea = i
          land = n
          break
        }
      }
    }
    expect(sea).toBeGreaterThanOrEqual(0)
    const owner = w.nations[w.provinceOwner[w.provinces.provinceOf[land]!]!]!
    const before = owner.profile.food
    w.extractResource('surface', sea, 255)
    expect(owner.profile.food).toBeLessThan(before)
    expect(FOOD_FISH).toBeGreaterThan(0)
    expect(w.validate()).toEqual([])
    expectFactsFresh(w)
  })

  it('grows back as the stock regrows, the profile and stats with it', () => {
    // nobody gathers here, so the tile that was drawn down is left to grow back by itself
    const w = World.create({
      seed: 11,
      config: { ...smallWorldOverrides({ nations: 6 }), units: { gather: {} } }
    })
    const tile = ownedTile(w, 'surface', ResourceType.Grain)
    const province = w.provinces.provinceOf[tile]!
    const owner = w.nations[w.provinceOwner[province]!]!
    const original = w.provinceFacts.food[province]!
    w.extractResource('surface', tile, w.terrain.resources.surface.stock[tile]!)
    expect(w.provinceFacts.food[province]).toBeLessThan(original)
    w.run(1) // one tick: the province is re-measured after the regrowth too
    expectFactsFresh(w)
    // grain regrows (see the regrowth table); give it time to be whole again
    let guard = 0
    while (
      w.terrain.resources.surface.stock[tile]! < w.terrain.resources.surface.richness[tile]! &&
      guard < 5000
    ) {
      w.step()
      guard += 1
    }
    expect(w.terrain.resources.surface.stock[tile]).toBe(w.terrain.resources.surface.richness[tile])
    expectFactsFresh(w)
    expect(owner.stats).toEqual(deriveStats(owner.profile))
    expect(w.validate()).toEqual([])
  })

  it('stays fresh while a nation grows into a province that has been drawn down', () => {
    const w = make()
    const slot = w.terrain.resources.surface
    // draw down many tiles over the whole map, then let the nations grow
    for (let i = 0; i < slot.type.length; i += 53) {
      if (slot.type[i] !== 0) w.extractResource('surface', i, 60)
    }
    w.run(300)
    expect(w.validate()).toEqual([])
    expectFactsFresh(w)
  })

  it('is the same world after a save in the middle of it all', () => {
    const w = make()
    const slot = w.terrain.resources.surface
    for (let i = 0; i < slot.type.length; i += 41) {
      if (slot.type[i] !== 0) w.extractResource('surface', i, 80)
    }
    w.run(50)
    const copy = decodeWorld(encodeWorld(w))
    expect(copy.stateHash()).toBe(w.stateHash())
    w.run(250)
    copy.run(250)
    expect(copy.stateHash()).toBe(w.stateHash())
    expectFactsFresh(copy)
  })
})
