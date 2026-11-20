import { defaultWorldConfig, type BiomeConfig } from '@sovereign/config'
import { BIOME_KEYS, type BiomeKey } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { determineBiome } from '../src/terrain/biomes'

const tuned = defaultWorldConfig.biomes

/** The thresholds the hard-coded classifier used, as a table. The oracle runs on these, not on the tuned defaults. */
const LEGACY_BANDS: BiomeConfig['bands'] = [
  {
    maxTemperature: 0.2,
    rows: [
      { maxHumidity: 0.25, biome: 'polar_desert' },
      { maxHumidity: 0.55, biome: 'tundra' },
      { maxHumidity: 0.8, biome: 'taiga' },
      { maxHumidity: 1, biome: 'glacier' }
    ]
  },
  {
    maxTemperature: 0.4,
    rows: [
      { maxHumidity: 0.2, biome: 'cold_steppe' },
      { maxHumidity: 0.45, biome: 'taiga' },
      { maxHumidity: 0.7, biome: 'boreal_forest' },
      { maxHumidity: 1, biome: 'swamp' }
    ]
  },
  {
    maxTemperature: 0.7,
    rows: [
      { maxHumidity: 0.18, biome: 'temperate_desert' },
      { maxHumidity: 0.32, biome: 'steppe' },
      { maxHumidity: 0.5, biome: 'grassland' },
      { maxHumidity: 0.68, biome: 'woodland' },
      { maxHumidity: 0.82, biome: 'temperate_forest' },
      { maxHumidity: 1, biome: 'wetland', lowlandBiome: 'swamp' }
    ]
  },
  {
    maxTemperature: 1,
    rows: [
      { maxHumidity: 0.18, biome: 'desert' },
      { maxHumidity: 0.3, biome: 'badlands' },
      { maxHumidity: 0.45, biome: 'savanna' },
      { maxHumidity: 0.6, biome: 'chaparral' },
      { maxHumidity: 0.78, biome: 'tropical_forest' },
      { maxHumidity: 0.9, biome: 'rainforest' },
      { maxHumidity: 1, biome: 'mangrove' }
    ]
  }
]
const config: BiomeConfig = { ...tuned, bands: LEGACY_BANDS }
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * The classifier as it was before the climate table became data: the hard-coded tree, copied
 * unchanged. It is the oracle that proves the table reproduces it (see the glacier note below).
 */
function legacyBiome(
  elevation: number,
  temperature: number,
  humidity: number,
  variation: number,
  seaLevel: number,
  c: BiomeConfig
): BiomeKey {
  const temp = clamp01(temperature + (variation - 0.5) * c.tempJitter)
  const humid = clamp01(humidity + (variation - 0.5) * c.humidityJitter)
  if (elevation < seaLevel) return elevation < seaLevel * c.deepOceanFactor ? 'deep_ocean' : 'ocean'
  if (elevation < seaLevel + c.shoreBand) return 'shore'
  if (elevation > c.mountainElevation) return 'mountain'
  if (elevation > c.alpineElevation && temp < 0.45) return 'alpine'
  if (elevation > c.highlandElevation) return 'highland'
  if (temp < 0.2) {
    if (humid < 0.25) return 'polar_desert'
    if (humid < 0.55) return 'tundra'
    if (humid < 0.8) return 'taiga'
    if (elevation > c.highlandElevation) return 'glacier'
    return 'tundra'
  }
  if (temp < 0.4) {
    if (humid < 0.2) return 'cold_steppe'
    if (humid < 0.45) return 'taiga'
    if (humid < 0.7) return 'boreal_forest'
    return 'swamp'
  }
  if (temp < 0.7) {
    if (humid < 0.18) return 'temperate_desert'
    if (humid < 0.32) return 'steppe'
    if (humid < 0.5) return 'grassland'
    if (humid < 0.68) return 'woodland'
    if (humid < 0.82) return 'temperate_forest'
    if (elevation < seaLevel + 0.05) return 'swamp'
    return 'wetland'
  }
  if (humid < 0.18) return 'desert'
  if (humid < 0.3) return 'badlands'
  if (humid < 0.45) return 'savanna'
  if (humid < 0.6) return 'chaparral'
  if (humid < 0.78) return 'tropical_forest'
  if (humid < 0.9) return 'rainforest'
  return 'mangrove'
}

/** Every combination of the inputs, as a lazy sequence. */
function* grid(): Generator<[number, number, number, number, number]> {
  for (const seaLevel of [0.2, 0.37]) {
    for (let e = 0; e <= 1000; e += 5) {
      for (let t = 0; t <= 100; t += 2) {
        for (let h = 0; h <= 100; h += 2) {
          for (const variation of [0, 0.5, 1])
            yield [e / 1000, t / 100, h / 100, variation, seaLevel]
        }
      }
    }
  }
}

describe('determineBiome', () => {
  it('reproduces the hard-coded classifier it replaced, except that wet polar land is now glacier', () => {
    let compared = 0
    let glaciers = 0
    for (const [e, t, h, v, sea] of grid()) {
      const was = legacyBiome(e, t, h, v, sea, config)
      const now = determineBiome(e, t, h, v, sea, config)
      if (now !== was) {
        // The one intended change: the old tree's glacier branch could never be reached, so wet
        // polar land below the highlands was tundra. The table makes it the ice sheet it is.
        const temp = clamp01(t + (v - 0.5) * config.tempJitter)
        const humid = clamp01(h + (v - 0.5) * config.humidityJitter)
        expect({ was, now, polar: temp < 0.2, wet: humid >= 0.8 }).toEqual({
          was: 'tundra',
          now: 'glacier',
          polar: true,
          wet: true
        })
        glaciers += 1
      }
      compared += 1
    }
    expect(compared).toBeGreaterThan(1_000_000)
    expect(glaciers).toBeGreaterThan(0)
  })

  it('can produce every one of the 26 biomes with the default (tuned) table', () => {
    const seen = new Set<BiomeKey>()
    for (const [e, t, h, v, sea] of grid()) seen.add(determineBiome(e, t, h, v, sea, tuned))
    expect([...BIOME_KEYS].filter((key) => !seen.has(key))).toEqual([])
  })

  it('reads the table, not constants: a different table gives a different biome', () => {
    const custom: BiomeConfig = {
      ...config,
      bands: [{ maxTemperature: 1, rows: [{ maxHumidity: 1, biome: 'savanna' }] }]
    }
    expect(determineBiome(0.5, 0.1, 0.9, 0.5, 0.37, custom)).toBe('savanna')
    expect(determineBiome(0.5, 0.9, 0.1, 0.5, 0.37, custom)).toBe('savanna')
  })

  it("applies a row's lowlandBiome only within lowlandBand of sea level", () => {
    // temperate (0.55), very wet (0.9): wetland, or swamp on low ground
    expect(determineBiome(0.37 + 0.049, 0.55, 0.9, 0.5, 0.37, config)).toBe('swamp')
    expect(determineBiome(0.37 + 0.051, 0.55, 0.9, 0.5, 0.37, config)).toBe('wetland')
    const wide: BiomeConfig = { ...config, lowlandBand: 0.2 }
    expect(determineBiome(0.37 + 0.1, 0.55, 0.9, 0.5, 0.37, wide)).toBe('swamp')
  })

  it('keeps water, shore and the elevation gates ahead of the climate table', () => {
    expect(determineBiome(0.1, 0.5, 0.5, 0.5, 0.37, config)).toBe('deep_ocean')
    expect(determineBiome(0.3, 0.5, 0.5, 0.5, 0.37, config)).toBe('ocean')
    expect(determineBiome(0.374, 0.5, 0.5, 0.5, 0.37, config)).toBe('shore')
    expect(determineBiome(0.9, 0.9, 0.9, 0.5, 0.37, config)).toBe('mountain')
    expect(determineBiome(0.8, 0.2, 0.5, 0.5, 0.37, config)).toBe('alpine')
    expect(determineBiome(0.8, 0.9, 0.5, 0.5, 0.37, config)).toBe('highland')
    expect(determineBiome(0.75, 0.5, 0.5, 0.5, 0.37, config)).toBe('highland')
  })
})
