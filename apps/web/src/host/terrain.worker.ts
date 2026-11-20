/**
 * @module terrain.worker
 * @description Web Worker that runs world generation off the UI thread. It asks the engine for the
 * terrain fields (`generateTerrain`, headless and pure), then asks the renderer's palettes to turn
 * them into pixel buffers, and posts everything back as **transferable** buffers (zero-copy).
 */
import {
  biomeRgba,
  elevationRgba,
  humidityRgba,
  resourceRgba,
  strategicRgba,
  temperatureRgba
} from '@sovereign/renderer'
import { generateTerrain, type TerrainRequest } from '@sovereign/simulation'
import type { StrategicPoint } from '@sovereign/contracts'

/* ------------------------------------------------------------------ */
/*  Message protocol                                                   */
/* ------------------------------------------------------------------ */

export type TerrainWorkerRequest = TerrainRequest & { type: 'generate' }

export interface TerrainWorkerResponse {
  type: 'done'
  width: number
  height: number
  seaLevel: number
  /** Raw RGBA pixel buffers (transferred, zero-copy). */
  elevationPixels: ArrayBuffer
  temperaturePixels: ArrayBuffer
  humidityPixels: ArrayBuffer
  biomePixels: ArrayBuffer
  strategicPixels: ArrayBuffer
  resourcePixels: ArrayBuffer
  /** Raw field data for WorldMap (transferred). */
  elevationField: ArrayBuffer
  temperatureField: ArrayBuffer
  humidityField: ArrayBuffer
  /** Biome ID per tile (Uint8Array buffer, transferred). */
  biomeIds: ArrayBuffer
  riverMask: ArrayBuffer
  resourceType: ArrayBuffer
  resourceDensity: ArrayBuffer
  /** Strategic points for the tooltip grid (structured clone). */
  strategicPoints: StrategicPoint[]
}

/* ------------------------------------------------------------------ */
/*  Worker entry point                                                 */
/* ------------------------------------------------------------------ */

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<TerrainWorkerRequest>) => void) | null
  postMessage: (message: TerrainWorkerResponse, transfer: ArrayBuffer[]) => void
}

ctx.onmessage = (event): void => {
  const { type, ...request } = event.data
  if (type !== 'generate') return

  const t = generateTerrain(request)

  const biomePixels = biomeRgba(t.biomeIds, t.riverWidth, t.width, t.height)
  const result: TerrainWorkerResponse = {
    type: 'done',
    width: t.width,
    height: t.height,
    seaLevel: t.seaLevel,
    elevationPixels: elevationRgba(t.elevation, t.seaLevel).buffer as ArrayBuffer,
    temperaturePixels: temperatureRgba(t.temperature).buffer as ArrayBuffer,
    humidityPixels: humidityRgba(t.humidity).buffer as ArrayBuffer,
    biomePixels: biomePixels.buffer as ArrayBuffer,
    strategicPixels: strategicRgba(biomePixels, t.width, t.height, t.strategicPoints)
      .buffer as ArrayBuffer,
    resourcePixels: resourceRgba(biomePixels, t.resourceType, t.resourceDensity)
      .buffer as ArrayBuffer,
    elevationField: t.elevation.buffer as ArrayBuffer,
    temperatureField: t.temperature.buffer as ArrayBuffer,
    humidityField: t.humidity.buffer as ArrayBuffer,
    biomeIds: t.biomeIds.buffer as ArrayBuffer,
    riverMask: t.riverMask.buffer as ArrayBuffer,
    resourceType: t.resourceType.buffer as ArrayBuffer,
    resourceDensity: t.resourceDensity.buffer as ArrayBuffer,
    strategicPoints: t.strategicPoints
  }

  // Each pixel buffer is its own ArrayBuffer, so transferring all of them is safe.
  ctx.postMessage(result, [
    result.elevationPixels,
    result.temperaturePixels,
    result.humidityPixels,
    result.biomePixels,
    result.strategicPixels,
    result.resourcePixels,
    result.elevationField,
    result.temperatureField,
    result.humidityField,
    result.biomeIds,
    result.riverMask,
    result.resourceType,
    result.resourceDensity
  ])
}
