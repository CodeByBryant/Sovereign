import { describe, expect, it } from 'vitest'
import { resolveWorldConfig } from '@sovereign/config'
import type { WorldSnapshot } from '@sovereign/contracts'
import { EntityStore } from '../src/entities/EntityStore'
import { spawnNations } from '../src/nations/NationSpawner'
import { generateTerrain } from '../src/terrain/pipeline'
import { decodeWorld, encodeWorld } from '../src/serialization/save'
import { World } from '../src/world/World'
import { hashTerrain } from './support/fieldHash'
import { spawnInputOf } from './support/spawnInput'
import { hashNations } from './support/nationHash'
import { smallTerrainRequest } from './support/terrainRequest'
import { smallWorldOverrides } from './support/worldOptions'

const make = (seed: string | number = 7, options = {}): World =>
  World.create({ seed, config: smallWorldOverrides(options) })

describe('World.create', () => {
  const world = make(7)

  it('normalizes the seed, resolves the config and starts at tick 0', () => {
    expect(world.seed).toBe(7)
    expect(make('sovereign').seed).toBe(0xa3579d13)
    expect(world.config).toEqual(resolveWorldConfig(smallWorldOverrides()))
    expect(world.clock.tick).toBe(0)
    expect(world.clock.time).toBe(0)
    expect(world.clock.deltaTime).toBe(1)
  })

  it('generates the same terrain as the generation pipeline for the same configuration', () => {
    const direct = generateTerrain(smallTerrainRequest(7, { seaLevel: 0.2 }))
    expect(hashTerrain(world.terrain)).toBe(hashTerrain(direct))
  })

  it('spawns nations, no more than configured, and shares its layers with the tile map', () => {
    expect(world.nations.length).toBeGreaterThan(2)
    expect(world.nations.length).toBeLessThanOrEqual(8)
    expect(world.map.width).toBe(160)
    expect(world.map.height).toBe(96)
    expect(world.map.elevation).toBe(world.terrain.elevation)
    expect(world.map.biomeIds).toBe(world.terrain.biomeIds)
  })

  it('records ownership as the index of the owning nation, with 255 for unclaimed', () => {
    const { ownership } = world.map
    let claimed = 0
    const map = world.provinces
    world.nations.forEach((nation, index) => {
      for (const province of nation.provinces) {
        for (let k = map.start[province]!; k < map.start[province + 1]!; k += 1) {
          expect(ownership[map.tiles[k]!]).toBe(index)
          claimed += 1
        }
      }
    })
    expect(ownership.filter((o) => o !== 255).length).toBe(claimed)
  })

  it('refuses an invalid config, naming the problem', () => {
    expect(() => World.create({ seed: 1, config: { map: { width: 3 } } })).toThrow(RangeError)
    expect(() => World.create({ seed: 1, config: { map: { width: 3 } } })).toThrow(/map\.width/)
  })

  it('refuses a seed that is not a valid number or text', () => {
    expect(() => World.create({ seed: -1, config: smallWorldOverrides() })).toThrow(RangeError)
    expect(() => World.create({ seed: 1.5, config: smallWorldOverrides() })).toThrow(RangeError)
  })

  it('places nations on land by the effective sea level when the land-ratio rescue lowered it', () => {
    // The default sea level now leaves 25.5% land on every seed, so the rescue only has work to do
    // when a custom sea level leaves too little: at 0.9 almost nothing is land, so it lowers it.
    const rescued = World.create({ seed: 2024, config: smallWorldOverrides({ seaLevel: 0.9 }) })
    expect(rescued.terrain.seaLevel).toBeLessThan(0.9)
    expect(rescued.nations.length).toBeGreaterThan(2)
    for (const n of rescued.nations) {
      expect(rescued.terrain.elevation[n.capital]).toBeGreaterThan(rescued.terrain.seaLevel)
    }
  })

  it('spawns exactly the nations spawnNations gives on the generated terrain at its effective sea level', () => {
    const rescued = World.create({ seed: 2024, config: smallWorldOverrides({ seaLevel: 0.9 }) })
    const expected = spawnNations(spawnInputOf(rescued)).nations
    expect(hashNations(rescued.nations)).toBe(hashNations(expected))
  })

  it('can be created with no nations', () => {
    const empty = make(7, { nations: 0 })
    expect(empty.nations).toEqual([])
    expect(empty.map.ownership.every((o) => o === 255)).toBe(true)
    expect(empty.validate()).toEqual([])
  })
})

describe('World.restore', () => {
  const partsOf = (w: World): Parameters<typeof World.restore>[0] => ({
    seed: w.seed,
    config: w.config,
    tick: w.clock.tick,
    terrain: w.terrain,
    nations: [...w.nations],
    ownership: w.map.ownership,
    entities: EntityStore.fromColumns(w.entities.toColumns())
  })

  it('rebuilds a world with the same state hash, keeping its tick', () => {
    const original = make(7)
    original.run(12)
    const restored = World.restore(partsOf(original))
    expect(restored.clock.tick).toBe(12)
    expect(restored.clock.time).toBe(12)
    expect(restored.stateHash()).toBe(original.stateHash())
  })

  it('keeps stepping from the restored tick, in step with the original', () => {
    const original = make(7)
    original.run(5)
    const restored = World.restore(partsOf(original))
    original.run(5)
    restored.run(5)
    expect(restored.stateHash()).toBe(original.stateHash())
  })

  it('rejects parts that are not consistent with each other', () => {
    const parts = partsOf(make(7))
    parts.ownership = new Uint8Array(parts.ownership).fill(255)
    expect(() => World.restore(parts)).toThrow(RangeError)
    expect(() => World.restore(parts)).toThrow(/restored world is not valid/)
  })

  it('rejects an invalid configuration', () => {
    const parts = partsOf(make(7))
    parts.config = { ...parts.config, timestep: 0 }
    expect(() => World.restore(parts)).toThrow(/timestep/)
  })
})

describe('determinism', () => {
  it('gives the same state hash for the same seed and config', () => {
    expect(make(7).stateHash()).toBe(make(7).stateHash())
  })

  it('gives a text seed and the number it normalizes to the same world', () => {
    expect(make('sovereign').stateHash()).toBe(make(0xa3579d13).stateHash())
  })

  it('changes the hash when the seed changes, or when the config does', () => {
    const base = make(7).stateHash()
    expect(make(8).stateHash()).not.toBe(base)
    expect(make(7, { nations: 5 }).stateHash()).not.toBe(base)
    expect(make(7, { islandMode: true }).stateHash()).not.toBe(base)
    const slower = World.create({ seed: 7, config: { ...smallWorldOverrides(), timestep: 0.5 } })
    expect(slower.stateHash()).not.toBe(base)
  })

  it('is a 32-character lowercase hex string', () => {
    expect(make(7).stateHash()).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('step() and run()', () => {
  it('advances the clock by one tick per step, and time by tick * timestep', () => {
    const world = make(7)
    world.step()
    world.step()
    expect(world.clock.tick).toBe(2)
    expect(world.clock.time).toBe(2)
  })

  it('honours a non-default timestep', () => {
    const world = World.create({
      seed: 7,
      config: { ...smallWorldOverrides(), timestep: 0.25 }
    })
    world.run(10)
    expect(world.clock.tick).toBe(10)
    expect(world.clock.time).toBe(2.5)
  })

  it('run(n) is n steps', () => {
    const a = make(7)
    const b = make(7)
    a.run(25)
    for (let i = 0; i < 25; i += 1) b.step()
    expect(a.stateHash()).toBe(b.stateHash())
    expect(a.clock.tick).toBe(25)
  })

  it('does not depend on how the run is chunked: run(3) then run(4) equals run(7)', () => {
    const a = make(7)
    a.run(3)
    a.run(4)
    const b = make(7)
    b.run(7)
    expect(a.stateHash()).toBe(b.stateHash())
  })

  it('run(0) changes nothing', () => {
    const world = make(7)
    const before = world.stateHash()
    world.run(0)
    expect(world.stateHash()).toBe(before)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('run(%s) is rejected', (n) => {
    expect(() => make(7).run(n)).toThrow(RangeError)
  })

  it('puts the tick into the state hash, so two ticks of one world differ', () => {
    const world = make(7)
    const t0 = world.stateHash()
    world.step()
    const t1 = world.stateHash()
    world.step()
    expect(new Set([t0, t1, world.stateHash()]).size).toBe(3)
  })

  it('reading the world never changes it', () => {
    const world = make(7)
    const before = world.stateHash()
    world.snapshot()
    world.validate()
    expect(world.stateHash()).toBe(before)
  })
})

describe('snapshot()', () => {
  const world = make(7)
  world.run(3)
  const snap: WorldSnapshot = world.snapshot()

  it('describes the world for the UI: size, time and nations', () => {
    expect(snap.seed).toBe(7)
    expect(snap.tick).toBe(3)
    expect(snap.time).toBe(3)
    expect(snap.width).toBe(160)
    expect(snap.height).toBe(96)
    expect(snap.seaLevel).toBe(world.terrain.seaLevel)
    expect(snap.nations.length).toBe(world.nations.length)
  })

  it('says how many days a tick is, so a host can turn days into ticks', () => {
    expect(snap.timestep).toBe(world.config.timestep)
    const slow = World.create({ seed: 7, config: { ...smallWorldOverrides(), timestep: 0.25 } })
    expect(slow.snapshot().timestep).toBe(0.25)
  })

  it('lists each nation with its area but without the bulky tile list', () => {
    const first = world.nations[0]
    const s = snap.nations[0]
    expect(s?.id).toBe(first?.id)
    expect(s?.name).toBe(first?.name)
    expect(s?.area).toBe(first?.profile.area)
    expect(s?.provinceCount).toBe(first?.provinces.size)
    expect(s).not.toHaveProperty('provinces')
  })

  it('is plain data: it survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })

  it('does not alias engine state: editing the snapshot leaves the world alone', () => {
    const before = world.stateHash()
    const s = world.snapshot()
    s.nations[0]?.color.fill(0)
    if (s.nations[0]) s.nations[0].name = 'Changed'
    expect(world.stateHash()).toBe(before)
  })
})

describe('resources in the world', () => {
  /** The first tile whose slot holds something, with at least `min` stock. */
  function tileWith(world: World, layer: 'surface' | 'ground', min = 1): number {
    const slot = world.terrain.resources[layer]
    for (let i = 0; i < slot.type.length; i += 1) {
      if (slot.type[i] !== 0 && (slot.stock[i] as number) >= min) return i
    }
    throw new Error(`no ${layer} resource with stock ${min}`)
  }

  it('places resources in both slots, and the map shares the arrays', () => {
    const world = make(7)
    expect(world.map.resources).toBe(world.terrain.resources)
    expect(tileWith(world, 'surface')).toBeGreaterThanOrEqual(0)
    expect(tileWith(world, 'ground')).toBeGreaterThanOrEqual(0)
  })

  it('describes a tile by what its slots hold, surface first', () => {
    const world = make(7)
    const i = tileWith(world, 'ground')
    const x = i % world.map.width
    const y = (i - x) / world.map.width
    const listed = world.map.at(x, y)?.resources ?? []
    const ground = listed.find((r) => r.layer === 'ground')
    expect(ground?.type).toBe(world.terrain.resources.ground.type[i])
    expect(ground?.richness).toBe(world.terrain.resources.ground.richness[i])
    expect(ground?.stock).toBe(world.terrain.resources.ground.stock[i])
    const layers = listed.map((r) => r.layer)
    expect(layers).toEqual(
      [...layers].sort((a, b) => (a === 'surface' ? -1 : b === 'surface' ? 1 : 0))
    )
  })

  it('lists no resources on a tile that has none', () => {
    const world = make(7)
    const size = world.map.size
    let empty = -1
    for (let i = 0; i < size; i += 1) {
      if (
        world.terrain.resources.surface.type[i] === 0 &&
        world.terrain.resources.ground.type[i] === 0
      ) {
        empty = i
        break
      }
    }
    expect(empty).toBeGreaterThanOrEqual(0)
    const x = empty % world.map.width
    expect(world.map.at(x, (empty - x) / world.map.width)?.resources).toEqual([])
  })

  it('extractResource takes what is asked, never more than the stock, and returns what it took', () => {
    const world = make(7)
    const i = tileWith(world, 'ground', 2)
    const before = world.terrain.resources.ground.stock[i] as number
    expect(world.extractResource('ground', i, 1)).toBe(1)
    expect(world.terrain.resources.ground.stock[i]).toBe(before - 1)
    expect(world.extractResource('ground', i, 255)).toBe(before - 1)
    expect(world.terrain.resources.ground.stock[i]).toBe(0)
    expect(world.extractResource('ground', i, 5)).toBe(0)
    expect(world.terrain.resources.ground.richness[i]).toBeGreaterThan(0)
  })

  it('regrows a drawn-down renewable resource during step(), up to its richness, but never a mineral', () => {
    const world = make(7)
    const s = tileWith(world, 'surface', 1)
    const g = tileWith(world, 'ground', 1)
    const richness = world.terrain.resources.surface.richness[s] as number
    world.extractResource('surface', s, 255)
    world.extractResource('ground', g, 255)
    world.run(2000)
    const regrown = world.terrain.resources.surface.stock[s] as number
    expect(regrown).toBeGreaterThan(0)
    expect(regrown).toBeLessThanOrEqual(richness)
    expect(world.terrain.resources.ground.stock[g]).toBe(0)
  })

  it('regrows identically in two worlds with the same history (and differently with another)', () => {
    const play = (take: number): string => {
      const world = make(7)
      world.extractResource('surface', tileWith(world, 'surface'), take)
      world.run(200)
      return world.stateHash()
    }
    expect(play(3)).toBe(play(3))
    expect(play(3)).not.toBe(play(4))
  })

  it('keeps regrowing after a save is restored', () => {
    const world = make(7)
    const s = tileWith(world, 'surface')
    world.extractResource('surface', s, 255)
    // the copy has nations of its own: they change as the worlds run
    const nations = [...decodeWorld(encodeWorld(world)).nations]
    const copy = World.restore({
      seed: world.seed,
      config: world.config,
      tick: world.clock.tick,
      terrain: structuredClone(world.terrain),
      nations,
      ownership: world.map.ownership.slice(),
      entities: EntityStore.fromColumns(world.entities.toColumns())
    })
    world.run(500)
    copy.run(500)
    expect(copy.stateHash()).toBe(world.stateHash())
    expect(copy.terrain.resources.surface.stock[s]).toBeGreaterThan(0)
  })
})

describe('validate() of the route network', () => {
  it('has hubs, routes and strategic points to check in a test world', () => {
    const world = make(7)
    expect(world.terrain.hubs.length).toBeGreaterThan(1)
    expect(world.terrain.routes.length).toBeGreaterThan(0)
    expect(world.terrain.strategicPoints.length).toBeGreaterThan(0)
  })

  it.each([
    ['a hub outside the map', (w: World) => (w.terrain.hubs[0]!.x = w.terrain.width), /hub/],
    ['a hub with a weight above 1', (w: World) => (w.terrain.hubs[0]!.weight = 1.5), /hub/],
    ['a hub with a weight of 0', (w: World) => (w.terrain.hubs[0]!.weight = 0), /hub/],
    ['a route to a hub that is not there', (w: World) => (w.terrain.routes[0]!.to = 999), /route/],
    [
      'a route from a hub after its end',
      (w: World) => (w.terrain.routes[0]!.from = w.terrain.routes[0]!.to),
      /route/
    ],
    [
      'a route with an odd number of path values',
      (w: World) => w.terrain.routes[0]!.path.push(3),
      /route/
    ],
    [
      'a route with a tile outside the map',
      (w: World) => (w.terrain.routes[0]!.path[0] = w.terrain.width),
      /route/
    ],
    [
      'a route that is only one tile',
      (w: World) => (w.terrain.routes[0]!.path.length = 2),
      /route/
    ],
    ['a route with a negative cost', (w: World) => (w.terrain.routes[0]!.cost = -1), /route/],
    [
      'a route with a non-finite traffic',
      (w: World) => (w.terrain.routes[0]!.traffic = Number.NaN),
      /route/
    ],
    [
      'a strategic point with a value of 0',
      (w: World) => (w.terrain.strategicPoints[0]!.value = 0),
      /strategic/
    ],
    [
      'a strategic point with a value above 10',
      (w: World) => (w.terrain.strategicPoints[0]!.value = 11),
      /strategic/
    ]
  ])('reports %s', (_label, edit, pattern) => {
    const world = make(7)
    edit(world)
    expect(world.validate().join('\n')).toMatch(pattern)
  })
})

describe('validate()', () => {
  it('reports a resource type that is not in the catalogue', () => {
    const world = make(7)
    world.terrain.resources.surface.type[3] = 99
    expect(world.validate().join('\n')).toMatch(/resource type/)
  })

  it('reports a stock above the richness', () => {
    const world = make(7)
    const i = world.terrain.resources.ground.type.findIndex((t) => t !== 0)
    world.terrain.resources.ground.stock[i] =
      (world.terrain.resources.ground.richness[i] as number) + 1
    world.terrain.resources.ground.richness[i] = Math.min(
      254,
      world.terrain.resources.ground.richness[i] as number
    )
    world.terrain.resources.ground.stock[i] =
      (world.terrain.resources.ground.richness[i] as number) + 1
    expect(world.validate().join('\n')).toMatch(/stock/)
  })

  it('reports a slot holding a resource of the other layer', () => {
    const world = make(7)
    const i = world.terrain.resources.surface.type.findIndex((t) => t !== 0)
    world.terrain.resources.ground.type[i] = world.terrain.resources.surface.type[i] as number
    world.terrain.resources.ground.richness[i] = 10
    world.terrain.resources.ground.stock[i] = 10
    expect(world.validate().join('\n')).toMatch(/ground/)
  })

  it('reports an empty slot that still has richness or stock, and a filled one with no richness', () => {
    const empty = make(7)
    const e = empty.terrain.resources.surface.type.findIndex((t) => t === 0)
    empty.terrain.resources.surface.stock[e] = 1
    expect(empty.validate().join('\n')).toMatch(/surface/)
    const hollow = make(7)
    const f = hollow.terrain.resources.surface.type.findIndex((t) => t !== 0)
    hollow.terrain.resources.surface.richness[f] = 0
    hollow.terrain.resources.surface.stock[f] = 0
    expect(hollow.validate().join('\n')).toMatch(/surface/)
  })

  it('reports a slot array of the wrong length', () => {
    const world = make(7)
    world.terrain.resources.ground.stock = new Uint8Array(5)
    expect(world.validate().join('\n')).toMatch(/ground stock/)
  })

  it('finds nothing wrong with a fresh world, or one that has been run', () => {
    const world = make(7)
    expect(world.validate()).toEqual([])
    world.run(5)
    expect(world.validate()).toEqual([])
  })

  it('reports a NaN in a continuous field', () => {
    const world = make(7)
    world.terrain.elevation[10] = Number.NaN
    expect(world.validate().join('\n')).toMatch(/elevation/)
  })

  it('reports an infinite value', () => {
    const world = make(7)
    world.terrain.humidity[3] = Number.POSITIVE_INFINITY
    expect(world.validate().join('\n')).toMatch(/humidity/)
  })

  it('reports a biome id that does not exist', () => {
    const world = make(7)
    world.terrain.biomeIds[5] = 200
    expect(world.validate().join('\n')).toMatch(/biome/)
  })

  it('reports an ownership byte that names no nation', () => {
    const world = make(7)
    world.map.ownership[0] = 254
    expect(world.validate().join('\n')).toMatch(/ownership/)
  })

  it('reports an ownership byte equal to the number of nations (the first index that names none)', () => {
    const world = make(7)
    world.map.ownership[0] = world.nations.length
    expect(world.validate().join('\n')).toMatch(/ownership/)
  })

  it('reports a nation tile whose owner byte disagrees', () => {
    const world = make(7)
    const nation = world.nations[0]
    const province = [...(nation?.provinces ?? [])][0] as number
    world.map.ownership[
      world.provinces.tiles[world.provinces.start[province] as number] as number
    ] = 255
    expect(world.validate().join('\n')).toMatch(/nation-0|ownership/)
  })

  it("reports a capital that is not in one of the nation's provinces", () => {
    const world = make(7)
    const nation = world.nations[0]
    nation?.provinces.delete(world.provinces.provinceOf[nation.capital] as number)
    expect(world.validate().join('\n')).toMatch(/capital/)
  })

  it('reports a river mask value other than 0 or 1', () => {
    const world = make(7)
    world.terrain.riverMask[4] = 2
    expect(world.validate().join('\n')).toMatch(/river/)
  })
})

describe('what the state hash covers: every field of a nation, and the seed', () => {
  const base = make(7).stateHash()
  type Mutable = {
    founded: number
    government: string
    personality: Record<string, number>
    stats: Record<string, number>
    flag: { type: string; background: number[]; accent: number[]; detail?: number[] }
  }

  it.each([
    ['founded', (n: Mutable) => (n.founded += 1)],
    ['government', (n: Mutable) => (n.government += 'x')],
    ['aggression', (n: Mutable) => (n.personality.aggression! += 0.01)],
    ['expansionism', (n: Mutable) => (n.personality.expansionism! += 0.01)],
    ['diplomacy (personality)', (n: Mutable) => (n.personality.diplomacy! += 0.01)],
    ['mercantilism', (n: Mutable) => (n.personality.mercantilism! += 0.01)],
    ['militarism', (n: Mutable) => (n.personality.militarism! += 0.01)],
    ['population', (n: Mutable) => (n.stats.population! += 1)],
    ['military', (n: Mutable) => (n.stats.military! += 1)],
    ['economy', (n: Mutable) => (n.stats.economy! += 1)],
    ['diplomacy (stat)', (n: Mutable) => (n.stats.diplomacy! += 1)],
    ['flag type', (n: Mutable) => (n.flag.type += 'x')],
    ['flag background', (n: Mutable) => (n.flag.background[2]! += 1)],
    ['flag accent', (n: Mutable) => (n.flag.accent[1]! += 1)],
    [
      'flag detail (added)',
      (n: Mutable) => (n.flag.detail = n.flag.detail === undefined ? [1, 2, 3] : undefined)
    ]
  ])("changes when a nation's %s changes", (_label, change) => {
    const world = make(7)
    change(world.nations[0] as unknown as Mutable)
    expect(world.stateHash()).not.toBe(base)
  })

  it('hashes the values of a flag detail colour, not just whether there is one', () => {
    const a = make(7)
    const b = make(7)
    ;(a.nations[0] as unknown as Mutable).flag.detail = [1, 2, 3]
    ;(b.nations[0] as unknown as Mutable).flag.detail = [1, 2, 4]
    expect(a.stateHash()).not.toBe(b.stateHash())
  })

  it('changes when only the seed differs, with every other part of the world identical', () => {
    const a = make(7)
    const b = World.restore({
      seed: a.seed + 1,
      config: a.config,
      tick: a.clock.tick,
      terrain: a.terrain,
      nations: [...a.nations],
      ownership: a.map.ownership
    })
    expect(b.stateHash()).not.toBe(a.stateHash())
  })
})

const PROFILE_KEYS = [
  'area',
  'food',
  'timber',
  'stone',
  'horses',
  'metals',
  'luxuries',
  'diversity',
  'coast',
  'river',
  'highGround',
  'defence',
  'traffic',
  'contacts'
]

describe('what the state hash covers', () => {
  const base = make(7).stateHash()

  it.each<[string, (w: World) => unknown]>([
    [
      'an elevation value',
      (w: World) => (w.terrain.elevation[100] = (w.terrain.elevation[100] as number) + 0.001)
    ],
    ['a temperature value', (w: World) => (w.terrain.temperature[5] = 0.123)],
    ['a humidity value', (w: World) => (w.terrain.humidity[77] = 0.456)],
    [
      'a biome id',
      (w: World) => (w.terrain.biomeIds[9] = ((w.terrain.biomeIds[9] as number) + 1) % 26)
    ],
    [
      'a river tile',
      (w: World) => (w.terrain.riverMask[40] = 1 - (w.terrain.riverMask[40] as number))
    ],
    ['a river width', (w: World) => (w.terrain.riverWidth[2] = 9)],
    ['a surface resource type', (w: World) => (w.terrain.resources.surface.type[8] ^= 1)],
    ['a surface richness', (w: World) => (w.terrain.resources.surface.richness[1] ^= 1)],
    ['a surface stock', (w: World) => (w.terrain.resources.surface.stock[2] ^= 1)],
    ['a ground resource type', (w: World) => (w.terrain.resources.ground.type[3] ^= 1)],
    ['a ground richness', (w: World) => (w.terrain.resources.ground.richness[4] ^= 1)],
    ['a ground stock', (w: World) => (w.terrain.resources.ground.stock[5] ^= 1)],
    [
      'the sea level',
      (w: World) =>
        (w.map as { seaLevel: number }).seaLevel === 0 ||
        ((w.terrain as { seaLevel: number }).seaLevel += 0.001)
    ],
    [
      'a strategic point',
      (w: World) => w.terrain.strategicPoints[0] && (w.terrain.strategicPoints[0].value += 1)
    ],
    [
      'a strategic point type',
      (w: World) =>
        (w.terrain.strategicPoints[0]!.type =
          w.terrain.strategicPoints[0]!.type === 'isthmus' ? 'strait' : 'isthmus')
    ],
    ['a hub position', (w: World) => (w.terrain.hubs[0]!.x += 1)],
    ['a hub weight', (w: World) => (w.terrain.hubs[0]!.weight += 0.01)],
    ['a route end', (w: World) => (w.terrain.routes[0]!.to += 1)],
    ['a route start', (w: World) => (w.terrain.routes[0]!.from += 1)],
    ['a route cost', (w: World) => (w.terrain.routes[0]!.cost += 1)],
    ['a route traffic', (w: World) => (w.terrain.routes[0]!.traffic += 1)],
    ['a route tile', (w: World) => (w.terrain.routes[0]!.path[2]! += 1)],
    ['the length of a route', (w: World) => w.terrain.routes[0]!.path.push(1, 1)],
    ['a route being gone', (w: World) => w.terrain.routes.pop()],
    ['a hub being gone', (w: World) => w.terrain.hubs.pop()],
    [
      'the ownership layer',
      (w: World) => (w.map.ownership[0] = w.map.ownership[0] === 255 ? 0 : 255)
    ],
    ['a nation name', (w: World) => ((w.nations[0] as { name: string }).name += 'x')],
    ...PROFILE_KEYS.map((key): [string, (w: World) => unknown] => [
      `a nation profile's ${key}`,
      (w: World) =>
        ((w.nations[0] as unknown as { profile: Record<string, number> }).profile[key]! += 1)
    ]),
    [
      'a nation stat',
      (w: World) => ((w.nations[0] as { stats: { military: number } }).stats.military += 1)
    ],
    [
      'a nation personality',
      (w: World) =>
        ((w.nations[1] as { personality: { aggression: number } }).personality.aggression += 0.01)
    ],
    [
      'a nation colour',
      (w: World) =>
        ((w.nations[0] as { color: number[] }).color[0] =
          ((w.nations[0] as { color: number[] }).color[0] as number) ^ 1)
    ],
    [
      'a nation flag',
      (w: World) => ((w.nations[0] as { flag: { background: number[] } }).flag.background[0] = 1.5)
    ],
    ['a nation capital', (w: World) => ((w.nations[0] as { capital: number }).capital += 1)],
    ['a nation tile', (w: World) => w.nations[0]?.provinces.add(0)]
  ])('changes when %s changes', (_label, change) => {
    const world = make(7)
    change(world)
    expect(world.stateHash()).not.toBe(base)
  })
})
