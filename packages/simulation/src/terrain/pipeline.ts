/**
 * @module pipeline
 * @description The whole terrain generation pipeline as one pure, headless function: elevation,
 * the land-ratio sea level rescue, water distance, temperature, humidity, rivers, biomes,
 * resources and strategic points. It produces fields only; turning them into pixels is the
 * renderer's job, and running it off the UI thread is the host's.
 */
import type {
  BiomeConfig,
  BiomeNoiseConfig,
  HumidityConfig,
  ResourceConfig,
  RiverConfig,
  StrategicConfig,
  TemperatureConfig,
  TerrainConfig
} from '@sovereign/config'
import type { TerrainFields } from '@sovereign/contracts'
import { remapByProfile, scaleToUnit } from '../math/quantile'
import { normalizeSeed } from '../random/seed'
import { classifyBiomes } from './biomes'
import { generateResources } from './resources'
import { RiverGenerator } from './rivers'
import { detectStrategicPoints } from './strategic'
import { TerrainGenerator } from './TerrainGenerator'

/** Everything the pipeline needs; the seed and the world-generation config sections. */
export interface TerrainRequest {
  /** Anything a person can type or a host can pick; see `normalizeSeed`. */
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

/**
 * If a seed produces too little land, lower the effective sea level until at least `minLandRatio`
 * of the tiles are above water (estimated from every 4th tile).
 */
function effectiveSeaLevel(
  elevation: Float32Array,
  seaLevel: number,
  minLandRatio: number | undefined
): number {
  if (minLandRatio === undefined || minLandRatio <= 0) return seaLevel

  const totalTiles = elevation.length
  const targetLand = Math.floor(totalTiles * minLandRatio)
  let landCount = 0
  for (let i = 0; i < totalTiles; i += 1) {
    if (elevation[i] > seaLevel) landCount += 1
  }
  if (landCount >= targetLand) return seaLevel

  const step = 4
  const sampleSize = Math.ceil(totalTiles / step)
  const sample = new Float32Array(sampleSize)
  for (let i = 0; i < sampleSize; i += 1) sample[i] = elevation[i * step]
  sample.sort((a, b) => a - b)

  const cutIdx = Math.floor(sampleSize * (1 - minLandRatio))
  const lowered = Math.min(seaLevel, sample[cutIdx] - 0.001)
  return lowered < 0.05 ? 0.05 : lowered
}

/** Generate every terrain field for a seed and configuration. */
export function generateTerrain(request: TerrainRequest): TerrainFields {
  const { terrain, temperature, humidity, biomeNoise, rivers, biomes, strategic, resources } =
    request
  const seed = normalizeSeed(request.seed)

  const generator = new TerrainGenerator(seed)
  // The noise gives an ordering of the tiles; the profile gives it the intended distribution, so
  // the ocean amount and the share of highland and mountain hold on every seed.
  const elevation = remapByProfile(
    scaleToUnit(generator.generateElevationField(terrain)),
    terrain.profile
  )

  const adjusted: TerrainConfig = {
    ...terrain,
    seaLevel: effectiveSeaLevel(elevation, terrain.seaLevel, request.minLandRatio)
  }

  const waterDistance = generator.computeDistanceToWater(
    elevation,
    adjusted.width,
    adjusted.height,
    adjusted.seaLevel
  )
  // Temperature and humidity are reshaped over land only (the tiles the biome table classifies).
  const land = new Uint8Array(elevation.length)
  for (let i = 0; i < land.length; i += 1) land[i] = elevation[i] > adjusted.seaLevel ? 1 : 0
  const temperatureField = remapByProfile(
    scaleToUnit(
      generator.generateTemperatureField(elevation, adjusted, temperature, waterDistance)
    ),
    temperature.profile,
    land
  )
  const baseHumidity = remapByProfile(
    scaleToUnit(generator.generateHumidityField(elevation, adjusted, humidity, waterDistance)),
    humidity.profile,
    land
  )

  const riverData = new RiverGenerator(seed).generate(elevation, baseHumidity, adjusted, rivers)
  // The river boost comes after the reshaping: its size (`humidityBoost`) is in units of the
  // reshaped 0 to 1 humidity, so land beside a river is wetter than its profile alone says.
  const humidityField = riverData.humidity

  const variation = generator.generateBiomeNoiseField(biomeNoise, adjusted)
  const biomeIds = classifyBiomes(
    elevation,
    temperatureField,
    humidityField,
    variation,
    adjusted.seaLevel,
    biomes
  )

  const { resourceType, resourceDensity } = generateResources(
    elevation,
    humidityField,
    biomeIds,
    riverData.riverMask,
    adjusted.width,
    adjusted.height,
    adjusted.seaLevel,
    seed,
    resources
  )
  const strategicData = detectStrategicPoints(
    elevation,
    riverData.riverMask,
    adjusted,
    biomes,
    strategic
  )

  return {
    width: adjusted.width,
    height: adjusted.height,
    seaLevel: adjusted.seaLevel,
    elevation,
    temperature: temperatureField,
    humidity: humidityField,
    biomeIds,
    riverMask: riverData.riverMask,
    riverWidth: riverData.riverWidth,
    resourceType,
    resourceDensity,
    strategicPoints: strategicData.points
  }
}
