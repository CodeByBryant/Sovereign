import { defaultWorldConfig } from '@sovereign/config'
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

/** Everything the terrain pipeline needs. */
export interface TerrainRequestShape {
  seed: string | number
  terrain: TerrainConfig
  temperature: TemperatureConfig
  humidity: HumidityConfig
  biomeNoise: BiomeNoiseConfig
  rivers: RiverConfig
  biomes: BiomeConfig
  strategic: StrategicConfig
  resources: ResourceConfig
  minLandRatio?: number
}

export interface SmallWorldOptions {
  width?: number
  height?: number
  islandMode?: boolean
  minLandRatio?: number
  seaLevel?: number
}

/**
 * The default config is tuned for a 2000x2000 map; on a test-sized map it would be featureless.
 * Spatial frequencies are scaled up so a small map still has coasts, rivers, biomes and mountains.
 */
export function smallTerrainRequest(
  seed: string | number,
  options: SmallWorldOptions = {}
): TerrainRequestShape {
  const { width = 160, height = 96, islandMode = false } = options
  const k = 12
  const t = defaultWorldConfig
  return {
    seed,
    terrain: {
      width,
      height,
      seaLevel: options.seaLevel ?? t.map.seaLevel,
      islandMode,
      ...t.elevation,
      scale: t.elevation.scale * k,
      continentScale: t.elevation.continentScale * k,
      oceanScale: t.elevation.oceanScale * k
    },
    temperature: { ...t.temperature, scale: t.temperature.scale * k },
    humidity: { ...t.humidity, scale: t.humidity.scale * k },
    biomeNoise: { ...t.biomeNoise, scale: t.biomeNoise.scale * k },
    rivers: {
      ...t.rivers,
      primaryScale: t.rivers.primaryScale * k,
      secondaryScale: t.rivers.secondaryScale * k,
      warpStrength: 3
    },
    biomes: { ...t.biomes },
    strategic: { ...t.strategic },
    resources: { ...t.resources, oreScale: t.resources.oreScale * k },
    minLandRatio: options.minLandRatio ?? t.map.minLandRatio
  }
}

/** Like {@link smallTerrainRequest} but with every optional field left out, so defaults apply. */
export function smallTerrainRequestWithDefaults(seed: string | number): TerrainRequestShape {
  const full = smallTerrainRequest(seed)
  const { continentalStrength: _continental, ...temperature } = full.temperature
  const {
    warpStrength: _warp,
    noiseOctaves: _oct,
    noisePersistence: _per,
    noiseLacunarity: _lac,
    ...rivers
  } = full.rivers
  void [_continental, _warp, _oct, _per, _lac]
  return { ...full, temperature, rivers }
}
