/**
 * @module readyMessage
 * @description Builds the message that carries a generated world from the worker to the app. Pure
 * (no worker APIs), so it is tested directly.
 *
 * The worker keeps its `World` (later phases step it there), so it must not give its own arrays
 * away: tile layers are sent as copies, and the overlay pixels are freshly made. Every buffer in the
 * message is listed for transfer, so nothing is copied twice.
 */
import {
  biomeRgba,
  elevationRgba,
  humidityRgba,
  politicalRgba,
  resourceRgba,
  strategicRgba,
  temperatureRgba,
  type LayerName,
  type PoliticalStyle
} from '@sovereign/renderer'
import type { World } from '@sovereign/simulation'
import type { WorldFields, WorldReady } from './protocol'

export interface Built {
  message: WorldReady
  /** The buffers to hand to `postMessage` as its transfer list. */
  transfer: ArrayBuffer[]
}

export function buildReady(world: World, style: PoliticalStyle): Built {
  const t = world.terrain
  const { width, height } = t

  const biome = biomeRgba(t.biomeIds, t.riverWidth, width, height)
  const layers: Record<LayerName, Uint8ClampedArray> = {
    elevation: elevationRgba(t.elevation, t.seaLevel),
    temperature: temperatureRgba(t.temperature),
    humidity: humidityRgba(t.humidity),
    biome,
    strategic: strategicRgba(biome, width, height, t.strategicPoints),
    resource: resourceRgba(biome, t.resourceType, t.resourceDensity),
    political: politicalRgba(
      biome,
      world.map.ownership,
      world.nations.map((n) => n.color),
      width,
      height,
      style
    )
  }

  const fields: WorldFields = {
    elevation: t.elevation.slice(),
    temperature: t.temperature.slice(),
    humidity: t.humidity.slice(),
    biomeIds: t.biomeIds.slice(),
    riverMask: t.riverMask.slice(),
    resourceType: t.resourceType.slice(),
    resourceDensity: t.resourceDensity.slice(),
    ownership: world.map.ownership.slice()
  }

  const transfer = [...Object.values(layers), ...Object.values(fields)].map(
    (array) => array.buffer as ArrayBuffer
  )
  return {
    message: {
      type: 'ready',
      snapshot: world.snapshot(),
      strategicPoints: t.strategicPoints.map((p) => ({ ...p })),
      layers,
      fields
    },
    transfer
  }
}
