import type { ResourcePlacementConfig, ResourceRule } from '@sovereign/config'
import { BIOME_INDEX, RESOURCE_CATALOG, ResourceType } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { placeResources, regionalField, type PlacementInput } from '../src/terrain/placement'
import { createSimplexNoise2D } from '../src/noise/simplex'
import { createStream } from '../src/random/streams'

// A 96 x 96 world with a known geography, so the right answer is obvious:
//   x < 16        sea (elevation 0.1)
//   x 30..33      a low basin (0.42)
//   x 60..63      a high ridge (0.8)
//   everything else plain (0.5); sea level 0.37; a river along y = 48 for x >= 20.
const W = 96
const H = 96
const SEA = 0.37
const GRASSLAND = BIOME_INDEX.grassland
const WOODLAND = BIOME_INDEX.woodland

const idx = (x: number, y: number): number => y * W + x
const isRidge = (x: number): boolean => x >= 60 && x <= 63
const isBasin = (x: number): boolean => x >= 30 && x <= 33

interface WorldOptions {
  elevation?: (x: number, y: number) => number
  biome?: (x: number, y: number) => number
  temperature?: (x: number, y: number) => number
  humidity?: (x: number, y: number) => number
}

function build(
  rules: Record<string, ResourceRule>,
  options: WorldOptions = {},
  seed = 7
): PlacementInput {
  const n = W * H
  const elevation = new Float32Array(n)
  const temperature = new Float32Array(n)
  const humidity = new Float32Array(n)
  const biomeIds = new Uint8Array(n)
  const riverMask = new Uint8Array(n)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = idx(x, y)
      elevation[i] = options.elevation
        ? options.elevation(x, y)
        : x < 16
          ? 0.1
          : isRidge(x)
            ? 0.8
            : isBasin(x)
              ? 0.42
              : 0.5
      temperature[i] = options.temperature ? options.temperature(x, y) : 0.5
      humidity[i] = options.humidity ? options.humidity(x, y) : 0.5
      biomeIds[i] = options.biome ? options.biome(x, y) : GRASSLAND
      if (y === 48 && x >= 20) riverMask[i] = 1
    }
  }
  const config: ResourcePlacementConfig = {
    features: { ridgeRadius: 6, ridgeScale: 0.05, slopeScale: 0.02 },
    rules
  }
  return {
    seed,
    width: W,
    height: H,
    seaLevel: SEA,
    elevation,
    temperature,
    humidity,
    biomeIds,
    riverMask,
    config
  }
}

const rule = (r: Partial<ResourceRule> = {}): ResourceRule => ({
  share: 0.1,
  regional: 0,
  regionSize: 40,
  ...r
})

const landCount = (input: PlacementInput): number => {
  let n = 0
  for (const e of input.elevation) if (e > SEA) n += 1
  return n
}
const waterCount = (input: PlacementInput): number => W * H - landCount(input)

/** Indices of the tiles holding `type` in a slot. */
const tilesOf = (slot: { type: Uint8Array }, type: number): number[] => {
  const out: number[] = []
  for (let i = 0; i < slot.type.length; i += 1) if (slot.type[i] === type) out.push(i)
  return out
}
const xOf = (i: number): number => i % W

describe('placeResources: how much', () => {
  it('gives a resource exactly its share of the land', () => {
    const input = build({ iron: rule({ share: 0.1 }) })
    const slots = placeResources(input)
    expect(tilesOf(slots.ground, ResourceType.Iron)).toHaveLength(
      Math.round(0.1 * landCount(input))
    )
  })

  it('gives a resource all the qualifying tiles when there are fewer than its share asks for', () => {
    const input = build({ iron: rule({ share: 0.9, elevation: [0.7, 1] }) })
    const found = tilesOf(placeResources(input).ground, ResourceType.Iron)
    expect(found).toHaveLength(4 * H) // the 4-column ridge
    expect(found.every((i) => isRidge(xOf(i)))).toBe(true)
  })

  it('gives nothing for a share of 0 or for a rule nothing can satisfy', () => {
    const none = placeResources(
      build({ iron: rule({ share: 0 }), coal: rule({ elevation: [2, 3] }) })
    )
    expect(tilesOf(none.ground, ResourceType.Iron)).toEqual([])
    expect(tilesOf(none.ground, ResourceType.Coal)).toEqual([])
  })

  it('places nothing for a resource with no rule', () => {
    const slots = placeResources(build({ iron: rule() }))
    expect(tilesOf(slots.ground, ResourceType.Coal)).toEqual([])
    expect(tilesOf(slots.surface, ResourceType.Timber)).toEqual([])
  })
})

describe('placeResources: where (geology and ecology)', () => {
  it('puts a ridge-loving resource on the ridge and its flanks', () => {
    const input = build({ iron: rule({ share: 0.04, prefer: { ridge: 3 } }) })
    const found = tilesOf(placeResources(input).ground, ResourceType.Iron)
    expect(found.length).toBeGreaterThan(100)
    const nearRidge = found.filter((i) => xOf(i) >= 55 && xOf(i) <= 68).length
    expect(nearRidge / found.length).toBeGreaterThan(0.95)
  })

  it('puts a basin-loving resource in the basin', () => {
    // no ridge here: the foothills beside a ridge are also below their surroundings
    const noRidge = (x: number): number => (x < 16 ? 0.1 : isBasin(x) ? 0.42 : 0.5)
    const input = build(
      { coal: rule({ share: 0.03, prefer: { basin: 3 } }) },
      { elevation: noRidge }
    )
    const found = tilesOf(placeResources(input).ground, ResourceType.Coal)
    expect(found.length).toBeGreaterThan(100)
    // the basin floor (x 30..33) is lowest, and bigger than the share asks for, so it is all in it
    expect(found.every((i) => isBasin(xOf(i)))).toBe(true)
  })

  it('keeps a resource to the biomes that can hold it, by weight', () => {
    const input = build(
      { timber: rule({ share: 0.9, biomes: { woodland: 1 } }) },
      { biome: (x) => (x < 56 ? GRASSLAND : WOODLAND) }
    )
    const found = tilesOf(placeResources(input).surface, ResourceType.Timber)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((i) => xOf(i) >= 56)).toBe(true)
  })

  it('ranks biomes by their weight: the heavier biome is taken first', () => {
    const input = build(
      { grain: rule({ share: 0.25, biomes: { grassland: 1, woodland: 0.4 } }) },
      { biome: (x) => (x < 56 ? GRASSLAND : WOODLAND) }
    )
    const found = tilesOf(placeResources(input).surface, ResourceType.Grain)
    expect(found.every((i) => xOf(i) < 56)).toBe(true)
  })

  it('applies hard limits on elevation, temperature, humidity and distance to the coast', () => {
    // one rule per world, so they do not compete for the surface slot
    const options = {
      temperature: (x: number) => (x < 50 ? 0.3 : 0.8),
      humidity: (x: number) => (x < 40 ? 0.2 : 0.7)
    }
    const solo = (key: string, r: Partial<ResourceRule>) => {
      const input = build({ [key]: rule({ share: 0.9, ...r }) }, options)
      return {
        input,
        found: tilesOf(
          placeResources(input).surface,
          ResourceType[(key.charAt(0).toUpperCase() + key.slice(1)) as keyof typeof ResourceType]
        )
      }
    }
    const timber = solo('timber', { temperature: [0.6, 1] })
    expect(timber.found.length).toBeGreaterThan(0)
    expect(timber.found.every((i) => xOf(i) >= 50)).toBe(true)
    const grain = solo('grain', { humidity: [0, 0.4] })
    expect(grain.found.length).toBeGreaterThan(0)
    expect(grain.found.every((i) => xOf(i) < 40)).toBe(true)
    // land x = 16.. is 1 step from the sea at x = 15, so within 10 steps means x <= 25
    const horses = solo('horses', { coastDistance: [1, 10] })
    expect(horses.found.length).toBeGreaterThan(0)
    expect(horses.found.every((i) => xOf(i) <= 25)).toBe(true)
    const pasture = solo('pasture', { elevation: [0.45, 0.6] })
    expect(pasture.found.length).toBeGreaterThan(0)
    expect(
      pasture.found.every(
        (i) => pasture.input.elevation[i] >= 0.45 && pasture.input.elevation[i] <= 0.6
      )
    ).toBe(true)
  })

  it('draws a resource toward rivers', () => {
    const input = build({
      spices: rule({ share: 0.02, prefer: { river: { within: 6, weight: 4 } } })
    })
    const found = tilesOf(placeResources(input).surface, ResourceType.Spices)
    expect(found.length).toBeGreaterThan(50)
    expect(
      found.filter((i) => Math.abs(Math.floor(i / W) - 48) <= 8).length / found.length
    ).toBeGreaterThan(0.95)
  })

  it('draws a resource toward the coast', () => {
    const input = build({
      salt: rule({ share: 0.03, prefer: { coast: { within: 20, weight: 4 } } })
    })
    const found = tilesOf(placeResources(input).ground, ResourceType.Salt)
    expect(found.filter((i) => xOf(i) <= 30).length / found.length).toBeGreaterThan(0.95)
  })

  it('draws a resource toward high ground, damp ground and warm ground', () => {
    const gradient = (x: number): number => (x < 16 ? 0.1 : 0.4 + (x - 16) * 0.004)
    const input = build(
      {
        gems: rule({ share: 0.05, prefer: { height: 4 } }),
        tea: rule({ share: 0.05, prefer: { wet: 4 } }),
        cotton: rule({ share: 0.05, prefer: { warm: 4 } })
      },
      {
        elevation: gradient,
        humidity: (x) => (x - 16) / 80,
        temperature: (x) => (x - 16) / 80
      }
    )
    const slots = placeResources(input)
    for (const [slot, type] of [
      [slots.ground, ResourceType.Gems],
      [slots.surface, ResourceType.Tea],
      [slots.surface, ResourceType.Cotton]
    ] as const) {
      const found = tilesOf(slot, type)
      expect(found.length).toBeGreaterThan(50)
      expect(found.filter((i) => xOf(i) >= 56).length / found.length).toBeGreaterThan(0.9)
    }
  })

  it('draws a resource toward steep ground', () => {
    const input = build({ stone: rule({ share: 0.03, prefer: { slope: 4 } }) })
    const found = tilesOf(placeResources(input).ground, ResourceType.Stone)
    // the steep tiles are at the ridge's edges (x = 59/60 and 63/64) and the basin's, and the coast
    expect(
      found.filter((i) => [15, 16, 29, 30, 33, 34, 59, 60, 63, 64].includes(xOf(i))).length /
        found.length
    ).toBeGreaterThan(0.9)
  })
})

describe('placeResources: competition and slots', () => {
  it('lets the rarer resource take the best tiles first, and no tile holds two in one slot', () => {
    const prefer = { ridge: 3 }
    const input = build({
      pasture: rule({ share: 0.3, prefer }),
      horses: rule({ share: 0.05, prefer })
    })
    const slots = placeResources(input)
    const horses = tilesOf(slots.surface, ResourceType.Horses)
    const pasture = tilesOf(slots.surface, ResourceType.Pasture)
    expect(horses).toHaveLength(Math.round(0.05 * landCount(input)))
    expect(pasture).toHaveLength(Math.round(0.3 * landCount(input)))
    expect(horses.filter((i) => pasture.includes(i))).toEqual([])
    // the rare one sits on the ridge, where the shared preference peaks
    expect(
      horses.filter((i) => xOf(i) >= 55 && xOf(i) <= 68).length / horses.length
    ).toBeGreaterThan(0.95)
    expect(
      pasture.filter((i) => xOf(i) >= 55 && xOf(i) <= 68).length / pasture.length
    ).toBeLessThan(0.8)
  })

  it('lets a surface resource and a ground resource share a tile', () => {
    const input = build({ timber: rule({ share: 0.9 }), iron: rule({ share: 0.9 }) })
    const slots = placeResources(input)
    let both = 0
    for (let i = 0; i < W * H; i += 1) {
      if (
        slots.surface.type[i] === ResourceType.Timber &&
        slots.ground.type[i] === ResourceType.Iron
      )
        both += 1
    }
    expect(both).toBeGreaterThan(0.7 * landCount(input))
  })

  it('keeps surface resources out of the ground slot and ground resources out of the surface slot', () => {
    const slots = placeResources(
      build({ timber: rule({ share: 0.5 }), iron: rule({ share: 0.5 }) })
    )
    expect(tilesOf(slots.ground, ResourceType.Timber)).toEqual([])
    expect(tilesOf(slots.surface, ResourceType.Iron)).toEqual([])
  })
})

describe('placeResources: water', () => {
  it('puts a water resource on the water within its distance of the land, never on land', () => {
    const input = build({ fish: rule({ share: 0.5, coastDistance: [1, 12] }) })
    const found = tilesOf(placeResources(input).surface, ResourceType.Fish)
    expect(found).toHaveLength(Math.round(0.5 * waterCount(input)))
    // water is x 0..15; distance to land is 16 - x, so within 12 means x >= 4
    expect(found.every((i) => xOf(i) >= 4 && xOf(i) <= 15)).toBe(true)
  })

  it('puts oil and salt under the land and also under shallow sea', () => {
    const input = build({
      oil: rule({ share: 0.1, offshore: { share: 0.2, coastDistance: [1, 12] } })
    })
    const found = tilesOf(placeResources(input).ground, ResourceType.Oil)
    const onLand = found.filter((i) => input.elevation[i] > SEA)
    const atSea = found.filter((i) => input.elevation[i] <= SEA)
    expect(onLand).toHaveLength(Math.round(0.1 * landCount(input)))
    expect(atSea).toHaveLength(Math.round(0.2 * waterCount(input)))
    expect(atSea.every((i) => xOf(i) >= 4)).toBe(true)
  })

  it('keeps a land-only resource off the water even if its gates would allow it', () => {
    const slots = placeResources(build({ iron: rule({ share: 1 }) }))
    for (const i of tilesOf(slots.ground, ResourceType.Iron))
      expect(xOf(i)).toBeGreaterThanOrEqual(16)
  })
})

describe('placeResources: richness and stock', () => {
  it('gives every placed tile a richness of 1 to 255, a full stock, and nothing elsewhere', () => {
    const slots = placeResources(build({ iron: rule({ share: 0.2, prefer: { ridge: 2 } }) }))
    for (let i = 0; i < W * H; i += 1) {
      if (slots.ground.type[i] === 0) {
        expect(slots.ground.richness[i]).toBe(0)
        expect(slots.ground.stock[i]).toBe(0)
      } else {
        expect(slots.ground.richness[i]).toBeGreaterThanOrEqual(1)
        expect(slots.ground.richness[i]).toBeLessThanOrEqual(255)
        expect(slots.ground.stock[i]).toBe(slots.ground.richness[i])
      }
    }
  })

  it('is richest where the tile ranks highest: the core of a patch, not its edge', () => {
    const gradient = (x: number): number => (x < 16 ? 0.1 : 0.4 + (x - 16) * 0.004)
    const input = build(
      { gold: rule({ share: 0.2, prefer: { height: 5 } }) },
      { elevation: gradient }
    )
    const slots = placeResources(input)
    const found = tilesOf(slots.ground, ResourceType.Gold)
    for (const a of found) {
      for (const b of found) {
        if (input.elevation[a] > input.elevation[b]) {
          expect(slots.ground.richness[a]).toBeGreaterThanOrEqual(slots.ground.richness[b])
        }
      }
    }
    const richest = Math.max(...found.map((i) => slots.ground.richness[i]))
    const poorest = Math.min(...found.map((i) => slots.ground.richness[i]))
    expect(richest).toBe(255)
    expect(poorest).toBeLessThan(60)
  })
})

describe('placeResources: regions, determinism and input checks', () => {
  const regional = { share: 0.08, regional: 1, regionSize: 15, prefer: { ridge: 0.01 } }
  const overlap = (a: number[], b: number[]): number => {
    const set = new Set(a)
    return b.filter((i) => set.has(i)).length / Math.max(1, Math.min(a.length, b.length))
  }

  it('is reproducible: the same input gives the same slots', () => {
    const a = placeResources(
      build({ iron: rule(regional), timber: rule({ share: 0.3, regional: 0.5 }) })
    )
    const b = placeResources(
      build({ iron: rule(regional), timber: rule({ share: 0.3, regional: 0.5 }) })
    )
    expect(b.ground.type).toEqual(a.ground.type)
    expect(b.surface.type).toEqual(a.surface.type)
    expect(b.ground.richness).toEqual(a.ground.richness)
  })

  it('lets the seed decide where the rich and barren regions are, when a resource is regional', () => {
    const a = tilesOf(
      placeResources(build({ iron: rule(regional) }, {}, 1)).ground,
      ResourceType.Iron
    )
    const b = tilesOf(
      placeResources(build({ iron: rule(regional) }, {}, 2)).ground,
      ResourceType.Iron
    )
    expect(overlap(a, b)).toBeLessThan(0.5)
  })

  it('does not depend on the seed at all when a resource is not regional', () => {
    const flat = { share: 0.1, regional: 0, regionSize: 15, prefer: { ridge: 1 } }
    const a = placeResources(build({ iron: rule(flat) }, {}, 1))
    const b = placeResources(build({ iron: rule(flat) }, {}, 2))
    expect(b.ground.type).toEqual(a.ground.type)
  })

  it('does not let one resource change another: adding a rule never moves an existing resource that is rarer', () => {
    const before = placeResources(
      build({ horses: rule({ share: 0.05, regional: 1, regionSize: 15 }) })
    )
    const after = placeResources(
      build({
        horses: rule({ share: 0.05, regional: 1, regionSize: 15 }),
        pasture: rule({ share: 0.3 })
      })
    )
    expect(after.surface.type.filter((t) => t === ResourceType.Horses).length).toBe(
      before.surface.type.filter((t) => t === ResourceType.Horses).length
    )
    expect(tilesOf(after.surface, ResourceType.Horses)).toEqual(
      tilesOf(before.surface, ResourceType.Horses)
    )
  })

  it('rejects a rule for a resource that does not exist', () => {
    expect(() => placeResources(build({ unicorn: rule() }))).toThrow(RangeError)
  })

  it('rejects a share outside 0 to 1, and a region size that is not positive', () => {
    expect(() => placeResources(build({ iron: rule({ share: 1.2 }) }))).toThrow(RangeError)
    expect(() => placeResources(build({ iron: rule({ share: -0.1 }) }))).toThrow(RangeError)
    expect(() => placeResources(build({ iron: rule({ regionSize: 0 }) }))).toThrow(RangeError)
    expect(() => placeResources(build({ iron: rule({ regional: 1.5 }) }))).toThrow(RangeError)
  })

  it('rejects fields whose length does not match the map', () => {
    const input = build({ iron: rule() })
    expect(() => placeResources({ ...input, elevation: new Float32Array(10) })).toThrow(RangeError)
  })

  it('does not modify its inputs', () => {
    const input = build({
      iron: rule({ prefer: { ridge: 1 } }),
      fish: rule({ coastDistance: [1, 9] })
    })
    const copies = [
      Float32Array.from(input.elevation),
      Float32Array.from(input.temperature),
      Float32Array.from(input.humidity),
      Uint8Array.from(input.biomeIds),
      Uint8Array.from(input.riverMask)
    ]
    placeResources(input)
    expect(input.elevation).toEqual(copies[0])
    expect(input.temperature).toEqual(copies[1])
    expect(input.humidity).toEqual(copies[2])
    expect(input.biomeIds).toEqual(copies[3])
    expect(input.riverMask).toEqual(copies[4])
  })
})

describe('placeResources: edges of the rules', () => {
  it('rounds a share to the nearest tile: 0.77 of a tile is 1, 0.3 of a tile is 0', () => {
    const land = landCount(build({}))
    const found = (share: number): number =>
      tilesOf(placeResources(build({ iron: rule({ share }) })).ground, ResourceType.Iron).length
    expect(found(0.77 / land)).toBe(1)
    expect(found(0.3 / land)).toBe(0)
    expect(found(2.5 / land)).toBe(3)
  })

  it('includes tiles exactly at the end of a hard range', () => {
    const solo = (r: Partial<ResourceRule>): number =>
      tilesOf(placeResources(build({ iron: rule({ share: 1, ...r }) })).ground, ResourceType.Iron)
        .length
    const land = landCount(build({}))
    // plain land is exactly 0.5 elevation, 0.5 temperature, 0.5 humidity; the first land column is 1 from the sea
    expect(solo({ elevation: [0.5, 0.5] })).toBeGreaterThan(0.8 * land)
    expect(solo({ temperature: [0.5, 0.5] })).toBe(land)
    expect(solo({ humidity: [0.5, 0.5] })).toBe(land)
    expect(solo({ coastDistance: [1, 1] })).toBe(H)
    expect(solo({ coastDistance: [2, 2] })).toBe(H)
    expect(solo({ coastDistance: [1, 2] })).toBe(2 * H)
  })

  it('serves equal shares in catalogue order: the lower id claims the best tiles first', () => {
    const prefer = { height: 3 }
    const gradient = (x: number): number => (x < 16 ? 0.1 : 0.4 + (x - 16) * 0.004)
    const slots = placeResources(
      build(
        { coal: rule({ share: 0.1, prefer }), copper: rule({ share: 0.1, prefer }) },
        { elevation: gradient }
      )
    )
    const mean = (tiles: number[]): number => tiles.reduce((s, i) => s + xOf(i), 0) / tiles.length
    // copper (id 15) comes before coal (id 16), so it takes the highest ground
    expect(mean(tilesOf(slots.ground, ResourceType.Copper))).toBeGreaterThan(
      mean(tilesOf(slots.ground, ResourceType.Coal))
    )
  })

  it('gives each resource its own regions: two regional resources do not sit on the same ground', () => {
    const regional = { share: 0.15, regional: 1, regionSize: 15 }
    const slots = placeResources(build({ timber: rule(regional), iron: rule(regional) }))
    const timber = new Set(tilesOf(slots.surface, ResourceType.Timber))
    const iron = tilesOf(slots.ground, ResourceType.Iron)
    expect(iron.filter((i) => timber.has(i)).length / iron.length).toBeLessThan(0.6)
  })

  it('still ranks by region when every preference is a dislike: a disliked tile is worse, not better', () => {
    // preference 1 - 6 x height is below the floor on most ground, so the floor decides the ranking
    const gradient = (x: number): number => (x < 16 ? 0.1 : 0.45 + (x - 16) * 0.004)
    const input = build(
      { iron: rule({ share: 0.1, regional: 1, regionSize: 15, prefer: { height: -6 } }) },
      { elevation: gradient },
      3
    )
    const stream = createStream(3, 'geology')
    const noises = RESOURCE_CATALOG.map(() => createSimplexNoise2D(stream))
    const region = regionalField(noises[ResourceType.Iron - 1], 15, W, H)
    const chosen = tilesOf(placeResources(input).ground, ResourceType.Iron)
    const chosenSet = new Set(chosen)
    let chosenSum = 0
    for (const i of chosen) chosenSum += region[i]
    let others = 0
    let otherSum = 0
    for (let i = 0; i < W * H; i += 1) {
      if (input.elevation[i] > SEA && !chosenSet.has(i)) {
        others += 1
        otherSum += region[i]
      }
    }
    expect(chosenSum / chosen.length).toBeGreaterThan(otherSum / others)
  })
})

describe('placeResources: sea level and flat scores', () => {
  it('treats a tile exactly at sea level as water, like the rest of the engine', () => {
    const level = (x: number): number => (x < 16 ? 0.1 : x === 20 ? SEA : 0.5)
    // elevations are stored as float32, so the sea level must be the float32-exact one for a tile to equal it
    const built = build(
      { iron: rule({ share: 1 }), fish: rule({ share: 1, coastDistance: [1, 255] }) },
      { elevation: level }
    )
    const input = { ...built, seaLevel: Math.fround(SEA) }
    const slots = placeResources(input)
    expect(tilesOf(slots.ground, ResourceType.Iron).every((i) => xOf(i) !== 20)).toBe(true)
    expect(tilesOf(slots.surface, ResourceType.Fish).some((i) => xOf(i) === 20)).toBe(true)
  })

  it('gives full richness to every tile when nothing separates them (a flat score has no poor edge)', () => {
    const slots = placeResources(build({ iron: rule({ share: 0.2 }) }))
    const found = tilesOf(slots.ground, ResourceType.Iron)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((i) => slots.ground.richness[i] === 255)).toBe(true)
  })
})

describe('regionalField', () => {
  const noise = createSimplexNoise2D(createStream(5, 'geology'))

  it('is a smooth field within [-1, 1] over the whole map', () => {
    const f = regionalField(noise, 50, 120, 90)
    expect(f).toHaveLength(120 * 90)
    for (const v of f) {
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
    let biggestStep = 0
    for (let y = 0; y < 90; y += 1) {
      for (let x = 1; x < 120; x += 1)
        biggestStep = Math.max(biggestStep, Math.abs(f[y * 120 + x] - f[y * 120 + x - 1]))
    }
    expect(biggestStep).toBeLessThan(0.15)
  })

  it('varies on the scale of the region size: bigger regions change more slowly', () => {
    const roughness = (size: number): number => {
      const f = regionalField(noise, size, 160, 160)
      let total = 0
      for (let i = 1; i < f.length; i += 1) total += Math.abs(f[i] - f[i - 1])
      return total
    }
    expect(roughness(20)).toBeGreaterThan(roughness(80) * 2)
  })

  it('is not flat, and reaches both signs', () => {
    const f = regionalField(noise, 30, 200, 200)
    expect(Math.min(...f)).toBeLessThan(-0.2)
    expect(Math.max(...f)).toBeGreaterThan(0.2)
  })
})
