/**
 * @module terrain.worker
 * @description Web Worker that runs the entire terrain generation pipeline
 * off the main thread, keeping the UI fully responsive during generation.
 *
 * Receives a single `'generate'` message with all config, performs every
 * CPU-heavy step (elevation, temperature, humidity, rivers, biomes,
 * resources, strategic detection, and ImageData rendering), then posts
 * back the raw RGBA pixel buffers and typed-array layers as
 * **transferable** objects (zero-copy).
 */
import {
  TerrainGenerator,
  type TerrainConfig,
  type TemperatureConfig,
  type HumidityConfig,
  type BiomeNoiseConfig
} from './TerrainGenerator'
import { buildBiomeMap, type BiomeConfig } from './biomes'
import { RiverGenerator, type RiverConfig } from './rivers'
import {
  detectStrategicPoints,
  buildStrategicOverlay,
  type StrategicPoint,
  type StrategicConfig
} from './strategic'
import { generateResources, type ResourceConfig } from './resources'

/* ------------------------------------------------------------------ */
/*  Message protocol                                                   */
/* ------------------------------------------------------------------ */

export interface TerrainWorkerRequest {
  type: 'generate'
  seed: string | number
  terrain: TerrainConfig
  temperature: TemperatureConfig
  humidity: HumidityConfig
  biomeNoise: BiomeNoiseConfig
  rivers: RiverConfig
  biomes: BiomeConfig
  strategic: StrategicConfig
  resources: ResourceConfig
}

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
  /** Strategic points for tooltip grid (structured clone). */
  strategicPoints: StrategicPoint[]
}

/* ------------------------------------------------------------------ */
/*  Worker entry point                                                 */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = self as any

ctx.onmessage = (event: MessageEvent<TerrainWorkerRequest>): void => {
  const msg = event.data
  if (msg.type !== 'generate') return

  const { seed, terrain, temperature, humidity, biomeNoise, rivers, biomes, strategic, resources } =
    msg

  // ---- Field generation ----
  const generator = new TerrainGenerator(seed)
  const elevationField = generator.generateElevationField(terrain)

  const waterDistance = generator.computeDistanceToWater(
    elevationField,
    terrain.width,
    terrain.height,
    terrain.seaLevel
  )

  const temperatureField = generator.generateTemperatureField(
    elevationField,
    terrain,
    temperature,
    waterDistance
  )

  const baseHumidityField = generator.generateHumidityField(
    elevationField,
    terrain,
    humidity,
    waterDistance
  )

  const riverGenerator = new RiverGenerator(seed)
  const riverData = riverGenerator.generate(elevationField, baseHumidityField, terrain, rivers)
  const humidityField = riverData.humidity

  const biomeNoiseField = generator.generateBiomeNoiseField(biomeNoise, terrain)

  // ---- ImageData rendering ----
  const elevationMap = generator.generateElevationMap(elevationField, terrain)
  const temperatureMap = generator.generateTemperatureMap(temperatureField, terrain)
  const humidityMap = generator.generateHumidityMap(humidityField, terrain)

  const { imageData: biomeMap, biomeIds } = buildBiomeMap(
    elevationField,
    temperatureField,
    humidityField,
    biomeNoiseField,
    terrain.width,
    terrain.height,
    terrain.seaLevel,
    biomes
  )
  riverGenerator.applyToImage(biomeMap, riverData.riverWidth)

  // ---- Resource generation ----
  const { resourceType, resourceDensity } = generateResources(
    elevationField,
    humidityField,
    biomeIds,
    riverData.riverMask,
    terrain.width,
    terrain.height,
    terrain.seaLevel,
    seed,
    resources
  )

  // ---- Resource overlay map ----
  const resourceMap = buildResourceMap(
    biomeMap,
    resourceType,
    resourceDensity,
    terrain.width,
    terrain.height
  )

  // ---- Strategic overlay ----
  const strategicData = detectStrategicPoints(
    elevationField,
    riverData.riverMask,
    terrain,
    biomes,
    strategic
  )
  const strategicMap = buildStrategicOverlay(biomeMap, strategicData.points)

  // ---- Post results with transferable buffers ----
  const result: TerrainWorkerResponse = {
    type: 'done',
    width: terrain.width,
    height: terrain.height,
    seaLevel: terrain.seaLevel,
    elevationPixels: elevationMap.data.buffer,
    temperaturePixels: temperatureMap.data.buffer,
    humidityPixels: humidityMap.data.buffer,
    biomePixels: biomeMap.data.buffer,
    strategicPixels: strategicMap.data.buffer,
    resourcePixels: resourceMap.data.buffer,
    elevationField: elevationField.buffer as ArrayBuffer,
    temperatureField: temperatureField.buffer as ArrayBuffer,
    humidityField: humidityField.buffer as ArrayBuffer,
    biomeIds: biomeIds.buffer as ArrayBuffer,
    riverMask: riverData.riverMask.buffer as ArrayBuffer,
    resourceType: resourceType.buffer as ArrayBuffer,
    resourceDensity: resourceDensity.buffer as ArrayBuffer,
    strategicPoints: strategicData.points
  }

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

/* ------------------------------------------------------------------ */
/*  Resource overlay builder                                           */
/* ------------------------------------------------------------------ */

/** Tint the biome map with resource colours where density > 0. */
function buildResourceMap(
  baseImageData: ImageData,
  resourceType: Uint8Array,
  resourceDensity: Uint8Array,
  width: number,
  height: number
): ImageData {
  const overlay = new ImageData(new Uint8ClampedArray(baseImageData.data), width, height)
  const data = overlay.data

  // Resource tint colours (RGB)
  const tints: Record<number, [number, number, number]> = {
    1: [34, 120, 50], // Timber
    2: [140, 130, 120], // Stone
    3: [160, 100, 80], // Iron
    4: [212, 175, 55], // Gold
    5: [140, 180, 60], // Fertile
    6: [60, 140, 200], // Fish
    7: [130, 90, 60] // Fur
  }

  for (let i = 0; i < resourceType.length; i += 1) {
    const rt = resourceType[i]
    if (rt === 0) continue
    const tint = tints[rt]
    if (!tint) continue

    const blend = Math.min(0.55, (resourceDensity[i] / 255) * 0.6 + 0.15)
    const p = i * 4
    data[p] = Math.round(data[p] * (1 - blend) + tint[0] * blend)
    data[p + 1] = Math.round(data[p + 1] * (1 - blend) + tint[1] * blend)
    data[p + 2] = Math.round(data[p + 2] * (1 - blend) + tint[2] * blend)
  }

  return overlay
}
