/**
 * @module biomes
 * @description 26-biome classification system driven by elevation,
 * temperature and humidity thresholds (a data table in `BiomeConfig`).
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
 * Water, shore and the highland, alpine and mountain elevation gates are checked first. Land below
 * them is looked up in the climate table `config.bands`: the first band whose `maxTemperature` is
 * above the tile's temperature, then the first row of that band whose `maxHumidity` is above its
 * humidity (the last band and last row catch the rest). A row may name a `lowlandBiome` that
 * replaces its biome within `config.lowlandBand` of sea level. `variation` injects noise-based
 * jitter so biome edges aren't perfectly straight.
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

  // --- Climate table ---
  const bands = config.bands
  let band = bands[bands.length - 1]
  for (let b = 0; b < bands.length; b += 1) {
    if (temp < bands[b].maxTemperature) {
      band = bands[b]
      break
    }
  }
  const rows = band.rows
  let row = rows[rows.length - 1]
  for (let r = 0; r < rows.length; r += 1) {
    if (humid < rows[r].maxHumidity) {
      row = rows[r]
      break
    }
  }
  if (row.lowlandBiome !== undefined && elevation < seaLevel + config.lowlandBand) {
    return row.lowlandBiome
  }
  return row.biome
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
