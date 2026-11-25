import {
  BIOME_INDEX,
  ResourceType,
  type BiomeKey,
  type ResourceSlots,
  type StrategicPoint,
  type StrategicRoute
} from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { BIOME_DESIRABILITY } from '../src/terrain/suitability'
import { FOOD_GRAIN, measureProfile, type ProfileInput } from '../src/nations/profile'

const W = 40
const H = 30
const SEA = 0.37

function slots(): ResourceSlots {
  const slot = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(W * H),
    richness: new Uint8Array(W * H),
    stock: new Uint8Array(W * H)
  })
  return { surface: slot(), ground: slot() }
}

interface World {
  biome?: (x: number, y: number) => BiomeKey
  water?: (x: number, y: number) => boolean
  river?: (x: number, y: number) => boolean
  resources?: ResourceSlots
  fullStock?: ArrayLike<number>
  points?: StrategicPoint[]
  routes?: StrategicRoute[]
  contacts?: number
}

const tile = (x: number, y: number): number => y * W + x
/** The tiles of a rectangle, in reading order. */
const rect = (x0: number, y0: number, x1: number, y1: number): number[] => {
  const out: number[] = []
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) out.push(tile(x, y))
  return out
}

function measure(tiles: number[], w: World = {}) {
  const n = W * H
  const elevation = new Float32Array(n)
  const biomeIds = new Uint8Array(n)
  const riverMask = new Uint8Array(n)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = tile(x, y)
      elevation[i] = w.water?.(x, y) ? 0.1 : 0.5
      biomeIds[i] = BIOME_INDEX[w.biome ? w.biome(x, y) : 'grassland']
      riverMask[i] = w.river?.(x, y) ? 1 : 0
    }
  }
  const input: ProfileInput = {
    width: W,
    height: H,
    seaLevel: SEA,
    elevation,
    biomeIds,
    riverMask,
    resources: w.resources ?? slots(),
    ...(w.fullStock !== undefined ? { fullStock: w.fullStock } : {}),
    strategicPoints: w.points ?? [],
    routes: w.routes ?? [],
    tiles,
    contacts: w.contacts ?? 0
  }
  return measureProfile(input)
}

const put = (
  r: ResourceSlots,
  layer: 'surface' | 'ground',
  x: number,
  y: number,
  type: number,
  stock = 255
): void => {
  r[layer].type[tile(x, y)] = type
  r[layer].richness[tile(x, y)] = 255
  r[layer].stock[tile(x, y)] = stock
}

describe('measureProfile: area and food', () => {
  it('has the area of the territory, and nothing at all for an empty one', () => {
    expect(measure(rect(5, 5, 9, 9)).area).toBe(25)
    const empty = measure([])
    expect(empty).toEqual({
      area: 0,
      food: 0,
      timber: 0,
      stone: 0,
      horses: 0,
      metals: 0,
      luxuries: 0,
      diversity: 0,
      coast: 0,
      river: 0,
      highGround: 0,
      defence: 0,
      traffic: 0,
      contacts: 0
    })
  })

  it('counts the fertility of the biome of each tile as food', () => {
    const grass = measure(rect(5, 5, 9, 9)).food
    expect(grass).toBeCloseTo(25 * BIOME_DESIRABILITY.grassland, 6)
    const poor = measure(rect(5, 5, 9, 9), { biome: () => 'taiga' }).food
    expect(poor).toBeCloseTo(25 * BIOME_DESIRABILITY.taiga, 6)
    expect(grass).toBeGreaterThan(poor)
  })

  it('counts land nobody can farm (desert, mountain, ice) as no food', () => {
    expect(measure(rect(5, 5, 9, 9), { biome: () => 'desert' }).food).toBe(0)
    expect(measure(rect(5, 5, 9, 9), { biome: () => 'mountain' }).food).toBe(0)
  })

  it('adds food for a river, and for the coast', () => {
    const base = measure(rect(5, 5, 9, 9)).food
    const river = measure(rect(5, 5, 9, 9), { river: (x, y) => x === 7 && y === 7 })
    expect(river.food).toBeGreaterThan(base)
    expect(river.river).toBe(1)
    const coast = measure(rect(5, 5, 9, 9), { water: (x) => x < 5 })
    expect(coast.food).toBeGreaterThan(base)
    expect(coast.coast).toBe(5) // the five tiles of the west edge touch the sea
  })

  it('adds exactly 0.3 food for a river tile and 0.15 for a coastal tile', () => {
    const base = measure(rect(5, 5, 9, 9)).food
    const river = measure(rect(5, 5, 9, 9), { river: (x, y) => x === 7 && y === 7 }).food
    expect(river - base).toBeCloseTo(0.3, 6)
    const coast = measure(rect(7, 5, 7, 5), { water: (x, y) => x === 7 && y === 4 }).food
    expect(coast - BIOME_DESIRABILITY.grassland).toBeCloseTo(0.15, 6)
  })

  it('takes the best fishery beside a coastal tile, not the sum of them', () => {
    // a tile with water to its west and north, a fishery in each
    const r = slots()
    put(r, 'surface', 6, 5, ResourceType.Fish, 255)
    put(r, 'surface', 7, 4, ResourceType.Fish, 255)
    const world = { water: (x: number, y: number) => x === 6 || y === 4, resources: r }
    const food = measure(rect(7, 5, 7, 5), world).food
    expect(food - BIOME_DESIRABILITY.grassland - 0.15).toBeCloseTo(0.6, 6)
  })

  it('adds 1 food for a full grain deposit and 0.7 for pasture', () => {
    const grain = slots()
    put(grain, 'surface', 7, 7, ResourceType.Grain, 255)
    const pasture = slots()
    put(pasture, 'surface', 7, 7, ResourceType.Pasture, 255)
    const base = measure(rect(5, 5, 9, 9)).food
    expect(measure(rect(5, 5, 9, 9), { resources: grain }).food - base).toBeCloseTo(1, 6)
    expect(measure(rect(5, 5, 9, 9), { resources: pasture }).food - base).toBeCloseTo(0.7, 6)
  })

  it('reads a coast to the south of a tile, too', () => {
    const food = measure(rect(7, 5, 7, 5), { water: (x, y) => x === 7 && y === 6 })
    expect(food.coast).toBe(1)
  })

  it('adds food for grain and pasture in proportion to what is left of them', () => {
    const base = measure(rect(5, 5, 9, 9)).food
    const full = slots()
    put(full, 'surface', 7, 7, ResourceType.Grain, 255)
    const half = slots()
    put(half, 'surface', 7, 7, ResourceType.Grain, 128)
    const none = slots()
    put(none, 'surface', 7, 7, ResourceType.Grain, 0)
    const fullFood = measure(rect(5, 5, 9, 9), { resources: full }).food
    const halfFood = measure(rect(5, 5, 9, 9), { resources: half }).food
    expect(fullFood - base).toBeCloseTo(1, 6)
    expect(halfFood - base).toBeCloseTo(128 / 255, 6)
    expect(measure(rect(5, 5, 9, 9), { resources: none }).food).toBeCloseTo(base, 6)
    const pasture = slots()
    put(pasture, 'surface', 7, 7, ResourceType.Pasture, 255)
    const p = measure(rect(5, 5, 9, 9), { resources: pasture }).food - base
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1)
  })

  it('adds food for a fishery in the water beside a coastal tile, once', () => {
    const base = measure(rect(5, 5, 9, 9), { water: (x) => x < 5 }).food
    const fish = slots()
    put(fish, 'surface', 4, 7, ResourceType.Fish, 255)
    put(fish, 'surface', 3, 7, ResourceType.Fish, 255) // farther out: not beside the land
    const withFish = measure(rect(5, 5, 9, 9), { water: (x) => x < 5, resources: fish }).food
    expect(withFish).toBeGreaterThan(base)
    const twice = slots()
    put(twice, 'surface', 4, 7, ResourceType.Fish, 255)
    put(twice, 'surface', 4, 6, ResourceType.Fish, 255)
    // two fisheries on two coast tiles are worth twice one
    const two = measure(rect(5, 5, 9, 9), { water: (x) => x < 5, resources: twice }).food - base
    const one = withFish - base
    expect(two).toBeCloseTo(2 * one, 6)
  })

  it('does not count a tile that is not part of the territory', () => {
    const resources = slots()
    put(resources, 'surface', 20, 20, ResourceType.Grain)
    const a = measure(rect(5, 5, 9, 9), { resources })
    expect(a.food).toBeCloseTo(25 * BIOME_DESIRABILITY.grassland, 6)
  })
})

describe('measureProfile: materials, metals and luxuries', () => {
  const territory = rect(5, 5, 9, 9)

  it('counts timber, stone and horses by what is left of each', () => {
    const r = slots()
    put(r, 'surface', 5, 5, ResourceType.Timber, 255)
    put(r, 'surface', 6, 5, ResourceType.Timber, 51)
    put(r, 'ground', 7, 5, ResourceType.Stone, 255)
    put(r, 'surface', 8, 5, ResourceType.Horses, 255)
    const p = measure(territory, { resources: r })
    expect(p.timber).toBeCloseTo(1.2, 6)
    expect(p.stone).toBeCloseTo(1, 6)
    expect(p.horses).toBeCloseTo(1, 6)
  })

  it('weights iron over copper over coal, and counts only the ground slot', () => {
    const one = (type: number): number => {
      const r = slots()
      put(r, 'ground', 6, 6, type)
      return measure(territory, { resources: r }).metals
    }
    expect(one(ResourceType.Iron)).toBeGreaterThan(one(ResourceType.Copper))
    expect(one(ResourceType.Copper)).toBeGreaterThan(one(ResourceType.Coal))
    expect(one(ResourceType.Coal)).toBeGreaterThan(0)
    expect(one(ResourceType.Stone)).toBe(0)
  })

  it('counts luxuries from both slots, and not everyday resources', () => {
    const r = slots()
    put(r, 'surface', 5, 5, ResourceType.Spices)
    put(r, 'ground', 6, 5, ResourceType.Gold)
    put(r, 'surface', 7, 5, ResourceType.Timber)
    put(r, 'ground', 8, 5, ResourceType.Iron)
    expect(measure(territory, { resources: r }).luxuries).toBeCloseTo(2, 6)
  })

  it('counts how many different resources are there, not how many tiles', () => {
    const r = slots()
    put(r, 'surface', 5, 5, ResourceType.Timber)
    put(r, 'surface', 6, 5, ResourceType.Timber)
    put(r, 'surface', 7, 5, ResourceType.Grain)
    put(r, 'ground', 8, 5, ResourceType.Iron)
    put(r, 'ground', 9, 5, ResourceType.Iron, 0) // exhausted: still a different resource that was here
    expect(measure(territory, { resources: r }).diversity).toBe(3)
  })

  it('adds up over separate parts of a territory', () => {
    const r = slots()
    put(r, 'ground', 6, 6, ResourceType.Iron)
    put(r, 'ground', 30, 20, ResourceType.Iron)
    const parts = measure([...territory, ...rect(28, 18, 32, 22)], { resources: r })
    expect(parts.metals).toBeCloseTo(2 * measure(territory, { resources: r }).metals, 6)
  })
})

describe('measureProfile: ground, defence and routes', () => {
  const territory = rect(5, 5, 9, 9)

  it('counts highland, alpine and mountain tiles as high ground', () => {
    const high = measure(territory, {
      biome: (_x, y) =>
        y === 5 ? 'mountain' : y === 6 ? 'alpine' : y === 7 ? 'highland' : 'grassland'
    })
    expect(high.highGround).toBe(15)
    expect(measure(territory).highGround).toBe(0)
  })

  it('sums the value of the strategic points inside the territory', () => {
    const points: StrategicPoint[] = [
      { x: 6, y: 6, type: 'mountain_pass', value: 7 },
      { x: 8, y: 9, type: 'river_crossing', value: 3 },
      { x: 20, y: 20, type: 'strait', value: 9 } // outside
    ]
    expect(measure(territory, { points }).defence).toBe(10)
  })

  it('counts the share of each route inside the territory, by its traffic, against the busiest', () => {
    const routes: StrategicRoute[] = [
      // wholly inside (4 of 4 points), the busiest
      { from: 0, to: 1, cost: 1, traffic: 10, path: [5, 5, 6, 5, 7, 5, 8, 5] },
      // half inside
      { from: 1, to: 2, cost: 1, traffic: 5, path: [9, 9, 10, 9, 20, 20, 21, 20] },
      // outside
      { from: 2, to: 3, cost: 1, traffic: 8, path: [20, 20, 21, 20] }
    ]
    expect(measure(territory, { routes }).traffic).toBeCloseTo((10 * 1 + 5 * 0.25) / 10, 6)
  })

  it('counts only the busiest route as a whole when it is entirely inside', () => {
    const routes: StrategicRoute[] = [{ from: 0, to: 1, cost: 1, traffic: 4, path: [5, 5, 6, 5] }]
    expect(measure(territory, { routes }).traffic).toBeCloseTo(1, 6)
    expect(measure(rect(20, 20, 22, 22), { routes }).traffic).toBe(0)
  })

  it('has no traffic when there are no routes', () => {
    expect(measure(territory).traffic).toBe(0)
  })

  it('passes the number of neighbours it was given through', () => {
    expect(measure(territory, { contacts: 3 }).contacts).toBe(3)
  })

  it('is the same twice', () => {
    expect(measure(territory, { river: (x) => x === 6, water: (x) => x < 4 })).toEqual(
      measure(territory, { river: (x) => x === 6, water: (x) => x < 4 })
    )
  })
})

describe('measureProfile: deposits that hold little', () => {
  const grainTile = (stock: number): ResourceSlots => {
    const r = slots()
    r.surface.type[tile(5, 5)] = ResourceType.Grain
    r.surface.richness[tile(5, 5)] = 6
    r.surface.stock[tile(5, 5)] = stock
    return r
  }
  const base = measure([tile(5, 5)]).food

  it('counts stock as a share of the most a deposit of that kind holds, not of 255', () => {
    const full = new Float64Array(32).fill(255)
    full[ResourceType.Grain] = 6
    const half = measure([tile(5, 5)], { resources: grainTile(3), fullStock: full }).food
    expect(half - base).toBeCloseTo(FOOD_GRAIN * 0.5, 9)
    const whole = measure([tile(5, 5)], { resources: grainTile(6), fullStock: full }).food
    expect(whole - base).toBeCloseTo(FOOD_GRAIN, 9)
  })

  it('still reads 255 as a whole deposit when no table is given', () => {
    const food = measure([tile(5, 5)], { resources: grainTile(255) }).food
    expect(food - base).toBeCloseTo(FOOD_GRAIN, 9)
  })
})
