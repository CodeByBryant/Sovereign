import type { WorldConfigOverrides } from '@sovereign/config'
import { defaultWorldConfig } from '@sovereign/config'

export interface SmallWorldOptions {
  width?: number
  height?: number
  seaLevel?: number
  nations?: number
  minSpacing?: number
  islandMode?: boolean
}

/**
 * Overrides for a test-sized world. The defaults are tuned for 2000x2000 tiles, so spatial
 * frequencies are scaled up (12x) to keep a small map interesting; the sea level is 0.2 so that
 * about 40% of it is land.
 */
export function smallWorldOverrides(options: SmallWorldOptions = {}): WorldConfigOverrides {
  const k = 12
  const d = defaultWorldConfig
  return {
    map: {
      width: options.width ?? 160,
      height: options.height ?? 96,
      seaLevel: options.seaLevel ?? 0.2,
      islandMode: options.islandMode ?? false
    },
    elevation: {
      scale: d.elevation.scale * k,
      continentScale: d.elevation.continentScale * k,
      oceanScale: d.elevation.oceanScale * k
    },
    temperature: { scale: d.temperature.scale * k },
    humidity: { scale: d.humidity.scale * k },
    biomeNoise: { scale: d.biomeNoise.scale * k },
    rivers: {
      primaryScale: d.rivers.primaryScale * k,
      secondaryScale: d.rivers.secondaryScale * k,
      warpStrength: 3
    },
    resources: { oreScale: d.resources.oreScale * k },
    nations: { count: options.nations ?? 8, minSpacing: options.minSpacing ?? 18 }
  }
}
