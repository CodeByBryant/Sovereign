import { describe, expect, it } from 'vitest'
import {
  SAVE_FORMAT_VERSION,
  SaveFormatError,
  decodeWorld,
  encodeWorld
} from '../src/serialization/save'
import { World } from '../src/world/World'
import { smallWorldOverrides } from './support/worldOptions'

const make = (seed: string | number = 7, options = {}): World =>
  World.create({ seed, config: smallWorldOverrides(options) })

const MAGIC = [0x53, 0x4f, 0x56, 0x57] // "SOVW"

/** Replace the JSON header of an encoded world, keeping everything else. */
function withHeader(
  bytes: Uint8Array,
  edit: (header: Record<string, unknown>) => void
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const headerLength = view.getUint32(8, false)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + headerLength)))
  edit(header)
  const newHeader = new TextEncoder().encode(JSON.stringify(header))
  const out = new Uint8Array(12 + newHeader.length + (bytes.length - 12 - headerLength))
  out.set(bytes.subarray(0, 8), 0)
  new DataView(out.buffer).setUint32(8, newHeader.length, false)
  out.set(newHeader, 12)
  out.set(bytes.subarray(12 + headerLength), 12 + newHeader.length)
  return out
}

describe('SAVE_FORMAT_VERSION and layout', () => {
  const bytes = encodeWorld(make(7))
  const view = new DataView(bytes.buffer, bytes.byteOffset)

  it('is version 6', () => {
    expect(SAVE_FORMAT_VERSION).toBe(6)
  })

  it('starts with the magic "SOVW", the version (uint32, big-endian) and the header length', () => {
    expect([...bytes.subarray(0, 4)]).toEqual(MAGIC)
    expect(view.getUint32(4, false)).toBe(6)
    expect(view.getUint32(8, false)).toBeGreaterThan(0)
  })

  it('has exactly the header plus thirteen tile layers (3 x float32, 10 x byte) after it', () => {
    const headerLength = view.getUint32(8, false)
    const tiles = 160 * 96
    expect(bytes.length).toBe(12 + headerLength + tiles * (3 * 4 + 10))
  })
})

describe('round trip', () => {
  it.each([
    ['a fresh world', () => make(7)],
    ['a world that has been run', () => ((w) => (w.run(9), w))(make(7))],
    ['a world with no nations', () => make(7, { nations: 0 })],
    ['an island world', () => make(7, { islandMode: true })],
    ['a text-seeded world', () => make('sovereign')],
    ['a different size', () => make(3, { width: 64, height: 48, nations: 4, minSpacing: 10 })]
  ])('restores %s with the identical state hash', (_label, build) => {
    const world = build()
    const decoded = decodeWorld(encodeWorld(world))
    expect(decoded.stateHash()).toBe(world.stateHash())
    expect(decoded.validate()).toEqual([])
    expect(decoded.clock.tick).toBe(world.clock.tick)
    expect(decoded.seed).toBe(world.seed)
  })

  it('restores a world that goes on to evolve exactly like the original', () => {
    const world = make(7)
    world.run(4)
    const decoded = decodeWorld(encodeWorld(world))
    world.run(6)
    decoded.run(6)
    expect(decoded.stateHash()).toBe(world.stateHash())
  })

  it('keeps drawn-down stocks, and they go on regrowing exactly as in the original', () => {
    const world = make(7)
    const slot = world.terrain.resources.surface
    const tiles: number[] = []
    for (let i = 0; i < slot.type.length && tiles.length < 20; i += 1)
      if (slot.type[i] !== 0) tiles.push(i)
    for (const tile of tiles) world.extractResource('surface', tile, 200)
    const decoded = decodeWorld(encodeWorld(world))
    expect(decoded.terrain.resources.surface.stock).toEqual(slot.stock)
    expect(decoded.terrain.resources.ground.richness).toEqual(
      world.terrain.resources.ground.richness
    )
    world.run(400)
    decoded.run(400)
    expect(decoded.stateHash()).toBe(world.stateHash())
  })

  it('is byte-stable: the same world encodes identically, and decode then encode is a fixed point', () => {
    const world = make(7)
    const bytes = encodeWorld(world)
    expect(encodeWorld(world)).toEqual(bytes)
    expect(encodeWorld(decodeWorld(bytes))).toEqual(bytes)
  })

  it('copies: later changes to the world or to the bytes do not leak across', () => {
    const world = make(7)
    const bytes = encodeWorld(world)
    const before = decodeWorld(bytes).stateHash()
    world.terrain.elevation[0] = 0.987
    world.step()
    expect(decodeWorld(bytes).stateHash()).toBe(before)

    const decoded = decodeWorld(bytes)
    const hash = decoded.stateHash()
    bytes.fill(0)
    expect(decoded.stateHash()).toBe(hash)
  })

  it("keeps what each nation's land is like, the profile its stats follow from", () => {
    const world = make(7)
    expect(world.nations.length).toBeGreaterThan(0)
    const decoded = decodeWorld(encodeWorld(world))
    expect(decoded.nations.map((n) => n.profile)).toEqual(world.nations.map((n) => n.profile))
    expect(decoded.nations.map((n) => n.stats)).toEqual(world.nations.map((n) => n.stats))
  })

  it('keeps the nations: names, colours, provinces in claim order', () => {
    const world = make(7)
    const decoded = decodeWorld(encodeWorld(world))
    expect(decoded.nations.map((n) => n.name)).toEqual(world.nations.map((n) => n.name))
    expect(decoded.nations.map((n) => [...n.provinces])).toEqual(
      world.nations.map((n) => [...n.provinces])
    )
    expect(decoded.nations.map((n) => n.color)).toEqual(world.nations.map((n) => n.color))
  })
})

describe('encodeWorld refuses to save a world that is not valid', () => {
  it('rejects a non-finite value, which JSON or a float layer would silently corrupt', () => {
    const world = make(7)
    world.terrain.humidity[2] = Number.NaN
    expect(() => encodeWorld(world)).toThrow(/not valid[\s\S]*humidity/)
  })
})

describe('decodeWorld rejects a file that is not a good save', () => {
  const good = encodeWorld(make(7))
  const rejects = (bytes: Uint8Array, message: RegExp): void => {
    expect(() => decodeWorld(bytes)).toThrow(SaveFormatError)
    expect(() => decodeWorld(bytes)).toThrow(message)
  }

  it('an empty file, or one too short to hold a header', () => {
    rejects(new Uint8Array(0), /too short/)
    rejects(good.subarray(0, 11), /too short/)
  })

  it.each([0, 1, 2, 3])('a file with the wrong magic in byte %d', (at) => {
    const bad = good.slice()
    bad[at] = (bad[at] as number) ^ 0x01
    rejects(bad, /not a Sovereign save/)
  })

  it.each([0, 1, 2, 3, 4, 5, 7, 99])('a file of unsupported format version %d', (version) => {
    const bad = good.slice()
    new DataView(bad.buffer).setUint32(4, version, false)
    rejects(bad, /unsupported save format version/)
  })

  it('a header length that runs past the end of the file, even by a single byte', () => {
    const huge = good.slice()
    new DataView(huge.buffer).setUint32(8, 0xffffffff, false)
    rejects(huge, /runs past the end/)
    const byOne = good.slice()
    new DataView(byOne.buffer).setUint32(8, good.length - 12 + 1, false)
    rejects(byOne, /runs past the end/)
  })

  it('a header that is not JSON', () => {
    const bad = good.slice()
    bad.fill(0x7b, 12, 40)
    rejects(bad, /header/)
  })

  it.each([
    'seed',
    'tick',
    'width',
    'height',
    'seaLevel',
    'config',
    'strategicPoints',
    'hubs',
    'routes',
    'nations'
  ])('a header with no "%s"', (field) => {
    rejects(
      withHeader(good, (h) => delete h[field]),
      /header/
    )
  })

  it.each([
    ['a hub that is not an object', (h: Record<string, unknown>) => ((h.hubs as unknown[])[0] = 7)],
    [
      'a hub with a fractional position',
      (h: Record<string, unknown>) =>
        (((h.hubs as Array<Record<string, unknown>>)[0] as Record<string, unknown>).x = 1.5)
    ],
    [
      'a hub with no weight',
      (h: Record<string, unknown>) =>
        delete ((h.hubs as Array<Record<string, unknown>>)[0] as Record<string, unknown>).weight
    ],
    ['hubs that are not a list', (h: Record<string, unknown>) => (h.hubs = {})]
  ])('a header with %s', (_label, edit) => {
    rejects(withHeader(good, edit), /hub/)
  })

  it.each([
    [
      'a route that is not an object',
      (h: Record<string, unknown>) => ((h.routes as unknown[])[0] = 7)
    ],
    [
      'a route with no cost',
      (h: Record<string, unknown>) =>
        delete ((h.routes as Array<Record<string, unknown>>)[0] as Record<string, unknown>).cost
    ],
    [
      'a route with a fractional hub index',
      (h: Record<string, unknown>) =>
        (((h.routes as Array<Record<string, unknown>>)[0] as Record<string, unknown>).from = 0.5)
    ],
    [
      'a route whose path is not a list of numbers',
      (h: Record<string, unknown>) =>
        (((h.routes as Array<Record<string, unknown>>)[0] as Record<string, unknown>).path = ['a'])
    ],
    [
      'a route whose path has a fractional tile',
      (h: Record<string, unknown>) =>
        (((h.routes as Array<Record<string, unknown>>)[0] as Record<string, unknown>).path = [
          1, 2.5, 3, 4
        ])
    ],
    ['routes that are not a list', (h: Record<string, unknown>) => (h.routes = 'none')]
  ])('a header with %s', (_label, edit) => {
    rejects(withHeader(good, edit), /route/)
  })

  it('a header whose hubs and routes disagree: a route to a hub that does not exist', () => {
    rejects(
      withHeader(
        good,
        (h) =>
          (((h.routes as Array<Record<string, unknown>>)[0] as Record<string, unknown>).to = 9999)
      ),
      /route/
    )
  })

  it('a header whose size disagrees with its config', () => {
    rejects(
      withHeader(good, (h) => (h.width = 161)),
      /width/
    )
  })

  it('a header whose height disagrees with its config', () => {
    rejects(
      withHeader(good, (h) => (h.height = 97)),
      /height/
    )
  })

  it.each([-1, 4294967296, 1.5, 'seven'])('a header with the seed %j', (seed) => {
    rejects(
      withHeader(good, (h) => (h.seed = seed)),
      /seed/
    )
  })

  it.each([-1, 1.5, 'now', 9007199254740992])('a header with the tick %j', (tick) => {
    rejects(
      withHeader(good, (h) => (h.tick = tick)),
      /tick/
    )
  })

  it('a layer section that is one byte short, or one byte too long', () => {
    rejects(good.subarray(0, good.length - 1), /size/)
    const long = new Uint8Array(good.length + 1)
    long.set(good)
    rejects(long, /size/)
  })

  it('keeps the expansion points a nation has saved up', () => {
    const world = make(7)
    world.nations[0]!.expansionPoints = 4.25
    const decoded = decodeWorld(encodeWorld(world))
    expect(decoded.nations.map((n) => n.expansionPoints)).toEqual(
      world.nations.map((n) => n.expansionPoints)
    )
    expect(decoded.nations[0]!.expansionPoints).toBe(4.25)
    expect(decoded.stateHash()).toBe(world.stateHash())
  })

  it('rebuilds the provinces from the terrain, exactly as they were', () => {
    const world = make(7)
    const decoded = decodeWorld(encodeWorld(world))
    expect(Array.from(decoded.provinces.provinceOf)).toEqual(Array.from(world.provinces.provinceOf))
    expect(Array.from(decoded.provinceOwner)).toEqual(Array.from(world.provinceOwner))
  })

  it.each([
    ['no expansion points', (n: Record<string, unknown>) => delete n.expansionPoints],
    [
      'expansion points that are not a number',
      (n: Record<string, unknown>) => (n.expansionPoints = 'lots')
    ],
    ['negative expansion points', (n: Record<string, unknown>) => (n.expansionPoints = -1)]
  ])('a nation with %s', (_label, edit) => {
    rejects(
      withHeader(good, (h) =>
        edit((h.nations as Array<Record<string, unknown>>)[0] as Record<string, unknown>)
      ),
      /nation|expansion/
    )
  })

  it('a nation whose province list names a province that is not on the map', () => {
    rejects(
      withHeader(good, (h) => {
        const nations = h.nations as Array<{ provinces: number[] }>
        nations[0]?.provinces.push(100000)
      }),
      /not valid/
    )
  })

  it('a nation whose province list is not a list of whole numbers', () => {
    rejects(
      withHeader(good, (h) => {
        ;(h.nations as Array<{ provinces: unknown }>)[0]!.provinces = [1.5]
      }),
      /province/
    )
  })

  it('keeps the villagers, holes and all, and they go on as before', () => {
    const world = make(7)
    world.run(30)
    const hole = world.entities.spawn({ kind: 1, x: 0, y: 0 })
    world.entities.despawn(hole) // a hole in the rows
    const decoded = decodeWorld(encodeWorld(world))
    expect(decoded.entities.toColumns()).toEqual(world.entities.toColumns())
    expect(decoded.stateHash()).toBe(world.stateHash())
    world.run(120)
    decoded.run(120)
    expect(decoded.stateHash()).toBe(world.stateHash())
  })

  it.each([
    ['no entities', (h: Record<string, unknown>) => delete h.entities],
    ['entities that are not an object', (h: Record<string, unknown>) => (h.entities = 5)],
    [
      'a column that is missing',
      (h: Record<string, unknown>) => delete (h.entities as Record<string, unknown>).x
    ],
    [
      'a column of the wrong length',
      (h: Record<string, unknown>) => ((h.entities as { x: number[] }).x = [1, 2])
    ],
    [
      'a value that does not fit',
      (h: Record<string, unknown>) => ((h.entities as { kind: number[] }).kind[0] = 300)
    ],
    [
      'a kind that is not a kind',
      (h: Record<string, unknown>) => ((h.entities as { kind: number[] }).kind[0] = 99)
    ],
    [
      'a unit in the sea',
      (h: Record<string, unknown>) => ((h.entities as { x: number[] }).x[0] = 15999)
    ]
  ])('a header with %s', (_label, edit) => {
    rejects(
      withHeader(good, (h) => edit(h)),
      /entit|unit|not valid|column|does not fit/
    )
  })

  it('a nation whose province list repeats a province held by another', () => {
    rejects(
      withHeader(good, (h) => {
        const nations = h.nations as Array<{ provinces: number[] }>
        nations[0]?.provinces.push(nations[1]!.provinces[0]!)
      }),
      /not valid/
    )
  })

  it.each([
    ['no profile', (n: Record<string, unknown>) => delete n.profile],
    ['a profile that is not an object', (n: Record<string, unknown>) => (n.profile = 5)],
    [
      'a profile with no food',
      (n: Record<string, unknown>) => delete (n.profile as Record<string, unknown>).food
    ],
    [
      'a profile with a non-number',
      (n: Record<string, unknown>) => ((n.profile as Record<string, unknown>).metals = 'lots')
    ],
    [
      'a profile whose area is not whole',
      (n: Record<string, unknown>) => ((n.profile as Record<string, unknown>).area = 1.5)
    ]
  ])('a nation with %s', (_label, edit) => {
    rejects(
      withHeader(good, (h) =>
        edit((h.nations as Array<Record<string, unknown>>)[0] as Record<string, unknown>)
      ),
      /nation|profile/
    )
  })

  it('a nation with a malformed field', () => {
    rejects(
      withHeader(good, (h) => ((h.nations as Array<{ name: unknown }>)[0]!.name = 42)),
      /nation/
    )
    rejects(
      withHeader(good, (h) => ((h.nations as Array<{ color: unknown }>)[0]!.color = [1, 2])),
      /nation/
    )
  })

  it('layer data that decodes to an invalid world (a NaN elevation)', () => {
    const bad = good.slice()
    const view = new DataView(bad.buffer)
    const headerLength = view.getUint32(8, false)
    view.setFloat32(12 + headerLength + 40, Number.NaN, true)
    rejects(bad, /elevation/)
  })

  it('an ownership byte that names no nation', () => {
    const bad = good.slice()
    bad[bad.length - 1] = 254
    rejects(bad, /ownership/)
  })

  it('an invalid config in the header', () => {
    rejects(
      withHeader(good, (h) => ((h.config as { timestep: number }).timestep = 0)),
      /timestep/
    )
  })

  it('never throws anything but SaveFormatError, whatever it is given', () => {
    for (let i = 0; i < 200; i += 1) {
      const junk = good.slice()
      // Corrupt a few bytes deterministically, anywhere in the file.
      for (let k = 0; k < 6; k += 1)
        junk[(i * 7919 + k * 104729) % junk.length] = (i * 31 + k * 17) & 0xff
      try {
        decodeWorld(junk)
      } catch (error) {
        expect(error).toBeInstanceOf(SaveFormatError)
      }
    }
  })
})
