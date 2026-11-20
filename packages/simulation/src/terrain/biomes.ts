/**
 * @module biomes
 * @description 26-biome classification system driven by elevation,
 * temperature and humidity thresholds.
 *
 * Each tile is classified into one of 26 biomes ranging from deep ocean
 * through deserts, forests, alpine zones and mountains.  The classifier
 * injects per-tile noise jitter so boundaries look organic rather than
 * perfectly linear.
 *
 * @example
 * ```ts
 * const biome = determineBiome(0.55, 0.6, 0.4, 0.5, 0.37, biomeConfig)
 * // → 'grassland'
 * ```
 */

import { BIOME_INDEX, type BiomeKey } from '@sovereign/contracts'
import type { BiomeConfig } from '@sovereign/config'

/* ------------------------------------------------------------------ */
/*  Classifier                                                         */
/* ------------------------------------------------------------------ */

/**
 * Classify a single tile into one of 26 biomes.
 *
 * Elevation gates (ocean → shore → highland → mountain) are checked
 * first, then the tile falls through a temperature×humidity decision
 * tree.  `variation` injects noise-based jitter so biome edges aren't
 * perfectly straight.
 */
export const determineBiome = (
  elevation: number,
  temperature: number,
  humidity: number,
  variation: number,
  seaLevel: number,
  config: BiomeConfig
): BiomeKey => {
  const temp = clamp01(temperature + (variation - 0.5) * config.tempJitter)
  const humid = clamp01(humidity + (variation - 0.5) * config.humidityJitter)

  // --- Water ---
  if (elevation < seaLevel) {
    return elevation < seaLevel * config.deepOceanFactor ? 'deep_ocean' : 'ocean'
  }

  if (elevation < seaLevel + config.shoreBand) return 'shore'

  // --- High elevation ---
  if (elevation > config.mountainElevation) return 'mountain'
  if (elevation > config.alpineElevation && temp < 0.45) return 'alpine'
  if (elevation > config.highlandElevation) return 'highland'

  // --- Polar (temp < 0.2) ---
  if (temp < 0.2) {
    if (humid < 0.25) return 'polar_desert'
    if (humid < 0.55) return 'tundra'
    if (humid < 0.8) return 'taiga'
    // High-altitude → glacier; low-altitude wet polar → tundra
    if (elevation > config.highlandElevation) return 'glacier'
    return 'tundra'
  }

  // --- Cool (temp 0.2–0.4) ---
  if (temp < 0.4) {
    if (humid < 0.2) return 'cold_steppe'
    if (humid < 0.45) return 'taiga'
    if (humid < 0.7) return 'boreal_forest'
    return 'swamp' // subarctic wetland / bog
  }

  // --- Temperate (temp 0.4–0.7) ---
  if (temp < 0.7) {
    if (humid < 0.18) return 'temperate_desert'
    if (humid < 0.32) return 'steppe'
    if (humid < 0.5) return 'grassland'
    if (humid < 0.68) return 'woodland'
    if (humid < 0.82) return 'temperate_forest'
    // Swamp: very wet + low-lying (near sea level)
    if (elevation < seaLevel + 0.05) return 'swamp'
    return 'wetland'
  }

  // --- Tropical (temp ≥ 0.7) ---
  if (humid < 0.18) return 'desert'
  if (humid < 0.3) return 'badlands'
  if (humid < 0.45) return 'savanna'
  if (humid < 0.6) return 'chaparral'
  if (humid < 0.78) return 'tropical_forest'
  if (humid < 0.9) return 'rainforest'
  return 'mangrove'
}

/* ------------------------------------------------------------------ */
/*  Bitmap builder                                                     */
/* ------------------------------------------------------------------ */

/**
 * Classify every tile into a biome id (an index into `BIOME_KEYS`).
 *
 * @returns One byte per tile, `y * width + x`.
 */
export const classifyBiomes = (
  elevation: Float32Array,
  temperature: Float32Array,
  humidity: Float32Array,
  variation: Float32Array,
  seaLevel: number,
  config: BiomeConfig
): Uint8Array => {
  const biomeIds = new Uint8Array(elevation.length)
  for (let i = 0; i < biomeIds.length; i += 1) {
    const biome = determineBiome(
      elevation[i],
      temperature[i],
      humidity[i],
      variation[i],
      seaLevel,
      config
    )
    biomeIds[i] = BIOME_INDEX[biome]
  }
  return biomeIds
}

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

/** Clamp a value to [0, 1]. */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
