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
  roadMaskFromRoutes,
  strategicRgba,
  temperatureRgba,
  type LayerName,
  type PoliticalStyle
} from '@sovereign/renderer'
import type { ResourceSlot, UnitSnapshot } from '@sovereign/contracts'
import type { World } from '@sovereign/simulation'
import type { WorldFields, WorldReady } from './protocol'

export interface Built {
  message: WorldReady
  /** The buffers to hand to `postMessage` as its transfer list. */
  transfer: ArrayBuffer[]
}

function copySlot(slot: ResourceSlot): ResourceSlot {
  return { type: slot.type.slice(), richness: slot.richness.slice(), stock: slot.stock.slice() }
}

function slotArrays(slot: ResourceSlot): Uint8Array[] {
  return [slot.type, slot.richness, slot.stock]
}

/** The buffers of a unit snapshot, for a transfer list. */
export function unitBuffers(units: UnitSnapshot): ArrayBuffer[] {
  return [units.id, units.kind, units.owner, units.x, units.y].map((a) => a.buffer as ArrayBuffer)
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
    strategic: strategicRgba(biome, width, height, t.strategicPoints, t.routes),
    resource: resourceRgba(biome, t.resources),
    political: politicalRgba(
      biome,
      world.map.ownership,
      world.nations.map((n) => n.color),
      width,
      height,
      style,
      world.provinces.provinceOf
    )
  }

  const fields: WorldFields = {
    elevation: t.elevation.slice(),
    temperature: t.temperature.slice(),
    humidity: t.humidity.slice(),
    biomeIds: t.biomeIds.slice(),
    riverMask: t.riverMask.slice(),
    resources: {
      surface: copySlot(t.resources.surface),
      ground: copySlot(t.resources.ground)
    },
    ownership: world.map.ownership.slice()
  }

  const roads = roadMaskFromRoutes(t.routes, width, height)
  const units = world.unitPositions()
  const { resources, ...flat } = fields
  const transfer = [
    ...Object.values(layers),
    ...Object.values(flat),
    ...slotArrays(resources.surface),
    ...slotArrays(resources.ground),
    roads
  ].map((array) => array.buffer as ArrayBuffer)
  transfer.push(...unitBuffers(units))
  return {
    message: {
      type: 'ready',
      snapshot: world.snapshot(),
      strategicPoints: t.strategicPoints.map((p) => ({ ...p })),
      layers,
      fields,
      roads,
      units
    },
    transfer
  }
}
