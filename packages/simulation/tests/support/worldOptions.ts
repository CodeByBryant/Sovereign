import type { WorldConfigOverrides } from '@sovereign/config'
import { defaultWorldConfig, type ResourcePlacementSettings } from '@sovereign/config'

export interface SmallWorldOptions {
  width?: number
  height?: number
  seaLevel?: number
  nations?: number
  minSpacing?: number
  islandMode?: boolean
}

/**
 * The resource rules for a test-sized map: the feature windows and the regions shrink with the
 * spatial frequencies (the default numbers are in tiles of a 2000 x 2000 map).
 */
export function smallResources(k = 12): ResourcePlacementSettings {
  const d = defaultWorldConfig.resources
  const rules: ResourcePlacementSettings['rules'] = {}
  for (const key of Object.keys(d.rules)) {
    const rule = d.rules[key]
    if (rule !== undefined) rules[key] = { ...rule, regionSize: Math.max(8, rule.regionSize / k) }
  }
  return {
    features: {
      ridgeRadius: 3,
      ridgeScale: d.features.ridgeScale,
      slopeScale: d.features.slopeScale * k
    },
    rules,
    regrowth: { ...d.regrowth }
  }
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
    resources: smallResources(k),
    nations: { count: options.nations ?? 8, minSpacing: options.minSpacing ?? 18 }
  }
}
