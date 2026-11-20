import { describe, expect, it } from 'vitest'
import type { WorldConfigOverrides } from '@sovereign/config'
import {
  biomeRgba,
  elevationRgba,
  humidityRgba,
  politicalRgba,
  resourceRgba,
  strategicRgba,
  temperatureRgba
} from '@sovereign/renderer'
import { World } from '@sovereign/simulation'
import type { ResourceSlot } from '@sovereign/contracts'
import { buildReady } from '../src/host/readyMessage'
import type { WorldFields } from '../src/host/protocol'

const STYLE = { alpha: 0.45, darken: 0.35 }

/** A small world with enough variety to be interesting (default noise is tuned for 2000x2000). */
const SMALL: WorldConfigOverrides = {
  map: { width: 96, height: 64, seaLevel: 0.2 },
  elevation: { scale: 0.0096, continentScale: 0.0024, oceanScale: 0.00144 },
  temperature: { scale: 0.03 },
  humidity: { scale: 0.048 },
  biomeNoise: { scale: 0.072 },
  rivers: { primaryScale: 0.0108, secondaryScale: 0.048, warpStrength: 3 },
  nations: { count: 5, minSpacing: 12 }
}

const slotBuffers = (slot: ResourceSlot): ArrayBufferLike[] => [
  slot.type.buffer,
  slot.richness.buffer,
  slot.stock.buffer
]

/** Every typed array in the fields message, the resource slots flattened. */
function fieldArrays(fields: WorldFields): Array<Float32Array | Uint8Array> {
  const { resources, ...flat } = fields
  return [
    ...Object.values(flat),
    ...[resources.surface, resources.ground].flatMap((slot) => [
      slot.type,
      slot.richness,
      slot.stock
    ])
  ]
}

const make = (): World => World.create({ seed: 21, config: SMALL })

describe('buildReady', () => {
  const world = make()
  const { message, transfer } = buildReady(world, STYLE)
  const { width, height } = world.terrain

  it('describes the world: a snapshot and its strategic points', () => {
    expect(message.type).toBe('ready')
    expect(message.snapshot).toEqual(world.snapshot())
    expect(message.strategicPoints).toEqual(world.terrain.strategicPoints)
  })

  it('has all seven overlays as RGBA buffers the size of the map', () => {
    expect(Object.keys(message.layers).sort()).toEqual([
      'biome',
      'elevation',
      'humidity',
      'political',
      'resource',
      'strategic',
      'temperature'
    ])
    for (const rgba of Object.values(message.layers)) expect(rgba.length).toBe(width * height * 4)
  })

  it('draws the biome and political overlays exactly as the renderer does', () => {
    const biome = biomeRgba(world.terrain.biomeIds, world.terrain.riverWidth, width, height)
    expect(message.layers.biome).toEqual(biome)
    expect(message.layers.political).toEqual(
      politicalRgba(
        biome,
        world.map.ownership,
        world.nations.map((n) => n.color),
        width,
        height,
        STYLE
      )
    )
  })

  it('draws every other overlay exactly as the renderer does, each from its own field', () => {
    const tf = world.terrain
    const biome = biomeRgba(tf.biomeIds, tf.riverWidth, width, height)
    expect(message.layers.elevation).toEqual(elevationRgba(tf.elevation, tf.seaLevel))
    expect(message.layers.temperature).toEqual(temperatureRgba(tf.temperature))
    expect(message.layers.humidity).toEqual(humidityRgba(tf.humidity))
    expect(message.layers.strategic).toEqual(
      strategicRgba(biome, width, height, tf.strategicPoints, tf.routes)
    )
    expect(message.layers.resource).toEqual(resourceRgba(biome, tf.resources))
  })

  it("copies the strategic points rather than sharing the engine's objects", () => {
    expect(message.strategicPoints).not.toBe(world.terrain.strategicPoints)
    message.strategicPoints.forEach((p, i) => expect(p).not.toBe(world.terrain.strategicPoints[i]))
  })

  it('carries the tile layers the inspector reads, equal to the world', () => {
    const f = message.fields
    expect(f.elevation).toEqual(world.terrain.elevation)
    expect(f.temperature).toEqual(world.terrain.temperature)
    expect(f.humidity).toEqual(world.terrain.humidity)
    expect(f.biomeIds).toEqual(world.terrain.biomeIds)
    expect(f.riverMask).toEqual(world.terrain.riverMask)
    for (const layer of ['surface', 'ground'] as const) {
      expect(f.resources[layer].type).toEqual(world.terrain.resources[layer].type)
      expect(f.resources[layer].richness).toEqual(world.terrain.resources[layer].richness)
      expect(f.resources[layer].stock).toEqual(world.terrain.resources[layer].stock)
    }
    expect(f.ownership).toEqual(world.map.ownership)
  })

  it("sends COPIES of the tile layers, never the engine's own arrays", () => {
    const own = new Set<ArrayBufferLike>([
      world.terrain.elevation.buffer,
      world.terrain.temperature.buffer,
      world.terrain.humidity.buffer,
      world.terrain.biomeIds.buffer,
      world.terrain.riverMask.buffer,
      ...slotBuffers(world.terrain.resources.surface),
      ...slotBuffers(world.terrain.resources.ground),
      world.map.ownership.buffer
    ])
    for (const array of fieldArrays(message.fields)) expect(own.has(array.buffer)).toBe(false)
  })

  it('lists every buffer to transfer exactly once, and nothing else', () => {
    const buffers = [...Object.values(message.layers), ...fieldArrays(message.fields)].map(
      (a) => a.buffer
    )
    expect(transfer.length).toBe(buffers.length)
    expect(new Set(transfer).size).toBe(transfer.length)
    for (const b of buffers) expect(transfer).toContain(b)
  })

  it('leaves the world fully usable after the message is transferred away', () => {
    const w = make()
    const before = w.stateHash()
    const built = buildReady(w, STYLE)
    // This is what postMessage(message, transfer) does: the buffers become detached here.
    const received = structuredClone(built.message, { transfer: built.transfer })
    expect(received.layers.biome.length).toBe(width * height * 4)
    expect(built.message.layers.biome.length).toBe(0) // detached on the sending side
    expect(w.stateHash()).toBe(before) // the worker's own world is untouched
    expect(w.validate()).toEqual([])
    w.run(3)
    expect(w.clock.tick).toBe(3)
  })

  it('works for a world with no nations', () => {
    const empty = World.create({ seed: 21, config: { ...SMALL, nations: { count: 0 } } })
    const built = buildReady(empty, STYLE)
    expect(built.message.snapshot.nations).toEqual([])
    expect(built.message.layers.political).toEqual(built.message.layers.biome)
  })
})
