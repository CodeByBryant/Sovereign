// TEMPORARY (deleted in the same PR): the OLD terrain.worker pipeline, composed from its DOM-free
// parts, used to pin what the generator produced before it was refactored. The refactor must
// reproduce these hashes exactly; only the later randomness swap is allowed to change them.
import { BIOME_INDEX } from '@sovereign/contracts'
import type { TerrainConfig } from '@sovereign/config'
import { determineBiome } from '../../src/terrain/biomes'
import { generateResources } from '../../src/terrain/resources'
import { RiverGenerator } from '../../src/terrain/rivers'
import { detectStrategicPoints } from '../../src/terrain/strategic'
import { TerrainGenerator } from '../../src/terrain/TerrainGenerator'
import type { HashableTerrain } from './fieldHash'
import type { TerrainRequestShape } from './terrainRequest'

export function legacyPipeline(req: TerrainRequestShape): HashableTerrain {
  const { seed, terrain, temperature, humidity, biomeNoise, rivers, biomes, strategic, resources } =
    req
  const generator = new TerrainGenerator(seed)
  const elevationField = generator.generateElevationField(terrain)

  let effectiveSeaLevel = terrain.seaLevel
  const minLandRatio = req.minLandRatio
  if (minLandRatio !== undefined && minLandRatio > 0) {
    const totalTiles = elevationField.length
    const targetLand = Math.floor(totalTiles * minLandRatio)
    let landCount = 0
    for (let i = 0; i < totalTiles; i += 1) {
      if (elevationField[i] > effectiveSeaLevel) landCount += 1
    }
    if (landCount < targetLand) {
      const step = 4
      const sampleSize = Math.ceil(totalTiles / step)
      const sample = new Float32Array(sampleSize)
      for (let i = 0; i < sampleSize; i += 1) sample[i] = elevationField[i * step]
      sample.sort()
      const cutIdx = Math.floor(sampleSize * (1 - minLandRatio))
      effectiveSeaLevel = Math.min(terrain.seaLevel, sample[cutIdx] - 0.001)
      if (effectiveSeaLevel < 0.05) effectiveSeaLevel = 0.05
    }
  }
  const adjusted: TerrainConfig = { ...terrain, seaLevel: effectiveSeaLevel }

  const waterDistance = generator.computeDistanceToWater(
    elevationField,
    adjusted.width,
    adjusted.height,
    adjusted.seaLevel
  )
  const temperatureField = generator.generateTemperatureField(
    elevationField,
    adjusted,
    temperature,
    waterDistance
  )
  const baseHumidity = generator.generateHumidityField(
    elevationField,
    adjusted,
    humidity,
    waterDistance
  )
  const riverData = new RiverGenerator(seed).generate(
    elevationField,
    baseHumidity,
    adjusted,
    rivers
  )
  const humidityField = riverData.humidity
  const variation = generator.generateBiomeNoiseField(biomeNoise, adjusted)

  const biomeIds = new Uint8Array(adjusted.width * adjusted.height)
  for (let i = 0; i < biomeIds.length; i += 1) {
    const key = determineBiome(
      elevationField[i],
      temperatureField[i],
      humidityField[i],
      variation[i],
      adjusted.seaLevel,
      biomes
    )
    biomeIds[i] = BIOME_INDEX[key]
  }

  const res = generateResources(
    elevationField,
    humidityField,
    biomeIds,
    riverData.riverMask,
    adjusted.width,
    adjusted.height,
    adjusted.seaLevel,
    seed,
    resources
  )
  const strat = detectStrategicPoints(
    elevationField,
    riverData.riverMask,
    adjusted,
    biomes,
    strategic
  )

  return {
    width: adjusted.width,
    height: adjusted.height,
    seaLevel: adjusted.seaLevel,
    elevation: elevationField,
    temperature: temperatureField,
    humidity: humidityField,
    biomeIds,
    riverMask: riverData.riverMask,
    riverWidth: riverData.riverWidth,
    resourceType: res.resourceType,
    resourceDensity: res.resourceDensity,
    strategicPoints: strat.points
  }
}
