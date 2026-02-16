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
  /** Minimum land-to-total tile ratio. Sea level auto-lowers if needed. */
  minLandRatio?: number
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

  const {
    seed,
    terrain,
    temperature,
    humidity,
    biomeNoise,
    rivers,
    biomes,
    strategic,
    resources,
    minLandRatio
  } = msg

  // ---- Field generation ----
  const generator = new TerrainGenerator(seed)
  const elevationField = generator.generateElevationField(terrain)

  // ---- Land-fraction guarantee ----
  // If a seed produces too little land, lower the effective sea level
  // until at least minLandRatio of tiles are above water.
  let effectiveSeaLevel = terrain.seaLevel
  if (minLandRatio !== undefined && minLandRatio > 0) {
    const totalTiles = elevationField.length
    const targetLand = Math.floor(totalTiles * minLandRatio)

    // Count land at current sea level
    let landCount = 0
    for (let i = 0; i < totalTiles; i += 1) {
      if (elevationField[i] > effectiveSeaLevel) landCount += 1
    }

    if (landCount < targetLand) {
      // Sort a sample of elevations to find the threshold quickly
      // Full sort of 4M elements is too slow — sample every 4th tile
      const step = 4
      const sampleSize = Math.ceil(totalTiles / step)
      const sample = new Float32Array(sampleSize)
      for (let i = 0; i < sampleSize; i += 1) {
        sample[i] = elevationField[i * step]
      }
      sample.sort()

      // Find the elevation value at the (1 - minLandRatio) percentile
      const cutIdx = Math.floor(sampleSize * (1 - minLandRatio))
      effectiveSeaLevel = Math.min(terrain.seaLevel, sample[cutIdx] - 0.001)
      if (effectiveSeaLevel < 0.05) effectiveSeaLevel = 0.05
    }
  }

  // Patch terrain config with the adjusted sea level
  const adjustedTerrain: TerrainConfig = { ...terrain, seaLevel: effectiveSeaLevel }

  const waterDistance = generator.computeDistanceToWater(
    elevationField,
    adjustedTerrain.width,
    adjustedTerrain.height,
    adjustedTerrain.seaLevel
  )

  const temperatureField = generator.generateTemperatureField(
    elevationField,
    adjustedTerrain,
    temperature,
    waterDistance
  )

  const baseHumidityField = generator.generateHumidityField(
    elevationField,
    adjustedTerrain,
    humidity,
    waterDistance
  )

  const riverGenerator = new RiverGenerator(seed)
  const riverData = riverGenerator.generate(
    elevationField,
    baseHumidityField,
    adjustedTerrain,
    rivers
  )
  const humidityField = riverData.humidity

  const biomeNoiseField = generator.generateBiomeNoiseField(biomeNoise, adjustedTerrain)

  // ---- ImageData rendering ----
  const elevationMap = generator.generateElevationMap(elevationField, adjustedTerrain)
  const temperatureMap = generator.generateTemperatureMap(temperatureField, adjustedTerrain)
  const humidityMap = generator.generateHumidityMap(humidityField, adjustedTerrain)

  const { imageData: biomeMap, biomeIds } = buildBiomeMap(
    elevationField,
    temperatureField,
    humidityField,
    biomeNoiseField,
    adjustedTerrain.width,
    adjustedTerrain.height,
    adjustedTerrain.seaLevel,
    biomes
  )
  riverGenerator.applyToImage(biomeMap, riverData.riverWidth)

  // ---- Resource generation ----
  const { resourceType, resourceDensity } = generateResources(
    elevationField,
    humidityField,
    biomeIds,
    riverData.riverMask,
    adjustedTerrain.width,
    adjustedTerrain.height,
    adjustedTerrain.seaLevel,
    seed,
    resources
  )

  // ---- Resource overlay map ----
  const resourceMap = buildResourceMap(
    biomeMap,
    resourceType,
    resourceDensity,
    adjustedTerrain.width,
    adjustedTerrain.height
  )

  // ---- Strategic overlay ----
  const strategicData = detectStrategicPoints(
    elevationField,
    riverData.riverMask,
    adjustedTerrain,
    biomes,
    strategic
  )
  const strategicMap = buildStrategicOverlay(biomeMap, strategicData.points)

  // ---- Post results with transferable buffers ----
  const result: TerrainWorkerResponse = {
    type: 'done',
    width: adjustedTerrain.width,
    height: adjustedTerrain.height,
    seaLevel: adjustedTerrain.seaLevel,
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
