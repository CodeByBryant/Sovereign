/**
 * @module world
 * @description The world configuration: every tunable parameter of world generation and the
 * simulation clock, with typed overrides, resolution and validation.
 *
 * The world seed is deliberately NOT part of the config: it is an input supplied by the host
 * (title screen, CLI), so that the same config and seed always give the same world. Rendering and
 * camera settings belong to the apps, not the engine config.
 *
 * @example A smaller, island-style map
 * ```ts
 * const config = resolveWorldConfig({ map: { width: 800, height: 600, islandMode: true } })
 * ```
 */
import { BIOME_KEYS, type QuantileProfile } from '@sovereign/contracts'
import type {
  BiomeConfig,
  BiomeNoiseConfig,
  HumidityConfig,
  ResourceConfig,
  RiverConfig,
  StrategicConfig,
  TemperatureConfig,
  TerrainConfig
} from './types'

/** Map dimensions and water level. */
export interface MapConfig {
  /** Map width in tiles. */
  width: number
  /** Map height in tiles. */
  height: number
  /** Elevation threshold separating ocean from land, in `(0, 1)`. */
  seaLevel: number
  /** Minimum fraction of tiles that must be land, in `[0, 1)`; the sea level is lowered to meet it. */
  minLandRatio: number
  /** When true, elevation falls off from the centre, producing a single island continent. */
  islandMode: boolean
}

/** The elevation noise settings (a {@link TerrainConfig} without the map-owned fields). */
export type ElevationConfig = Omit<TerrainConfig, 'width' | 'height' | 'seaLevel' | 'islandMode'>

/** Nation spawning. */
export interface NationsConfig {
  /** Number of nations to spawn, at most 255 (the ownership layer is one byte per tile). */
  count: number
  /** Minimum tile distance between spawn points. */
  minSpacing: number
}

export interface WorldConfig {
  map: MapConfig
  elevation: ElevationConfig
  temperature: TemperatureConfig
  humidity: HumidityConfig
  biomeNoise: BiomeNoiseConfig
  rivers: RiverConfig
  biomes: BiomeConfig
  strategic: StrategicConfig
  resources: ResourceConfig
  nations: NationsConfig
  /** In-game days per simulation tick. */
  timestep: number
}

/** Per-section partial overrides of a {@link WorldConfig}. */
export type WorldConfigOverrides = {
  [K in keyof WorldConfig]?: WorldConfig[K] extends number ? number : Partial<WorldConfig[K]>
}

export const defaultWorldConfig: WorldConfig = {
  /* ------------------------------------------------------------ */
  /*  Map dimensions & tiling                                      */
  /* ------------------------------------------------------------ */

  /**
   * Map grid dimensions, tile/chunk sizes, and water level.
   *
   * @example A larger, wetter world
   * ```ts
   * defaultWorldConfig.map.width = 3000
   * defaultWorldConfig.map.height = 2000
   * defaultWorldConfig.map.seaLevel = 0.45
   * ```
   */
  map: {
    /** Map width in tiles. @default 2000 */
    width: 2000,
    /** Map height in tiles. @default 2000 */
    height: 2000,
    /**
     * Elevation threshold separating ocean from land.
     * Range `[0, 1]`. Higher = more water.
     * @default 0.37
     */
    seaLevel: 0.37,
    /**
     * Minimum fraction of tiles that must be land (0–1).
     * If the generated elevation produces less land than this,
     * the sea level is automatically lowered until the target is met.
     * @default 0.25
     */
    minLandRatio: 0.25,
    /**
     * When `true`, elevation falls off radially from the centre
     * producing a single island continent.
     * @default false
     */
    islandMode: false
  },

  /* ------------------------------------------------------------ */
  /*  Elevation noise                                              */
  /* ------------------------------------------------------------ */

  /**
   * Multi-octave simplex noise controlling the heightmap.
   *
   * `continentScale/Strength` add very-low-frequency bias creating
   * large continental masses; `oceanScale/Strength` carve basins.
   *
   * @example Flatter terrain with bigger continents
   * ```ts
   * defaultWorldConfig.elevation.persistence = 0.4
   * defaultWorldConfig.elevation.continentStrength = 0.7
   * ```
   */
  elevation: {
    /** Base noise frequency. Smaller = larger features. @default 0.0008 */
    scale: 0.0008,
    /** Number of fractal octaves. @default 5 */
    octaves: 5,
    /** Amplitude decay per octave (0–1). @default 0.52 */
    persistence: 0.52,
    /** Frequency multiplier per octave. @default 2 */
    lacunarity: 2,
    /** Continent bias noise frequency. @default 0.0002 */
    continentScale: 0.0002,
    /** Blend weight for continent bias (0–1). @default 0.5 */
    continentStrength: 0.5,
    /** Ocean-carving noise frequency. @default 0.00012 */
    oceanScale: 0.00012,
    /** Subtraction strength for ocean basins (0–1). @default 0.3 */
    oceanStrength: 0.3,
    /**
     * Rank-to-elevation profile (quantile of ALL tiles, elevation). Pins the ocean: 19% of tiles are
     * deep ocean (below 0.55 x sea level), water is 74.5% of tiles (sea level 0.37), the next 3% is
     * the shore band; the top 14% of land is highland or higher (0.74), the top 7.5% is above
     * 0.78 and the top 4% is mountain (0.85). Quantiles 0.9643 / 0.9809 / 0.9898 are those land
     * shares of the 25.5% of tiles that are land.
     */
    profile: [
      [0, 0],
      [0.19, 0.2035],
      [0.745, 0.37],
      [0.775, 0.378],
      [0.9643, 0.74],
      [0.9809, 0.78],
      [0.9898, 0.85],
      [1, 1]
    ]
  },

  /* ------------------------------------------------------------ */
  /*  Temperature                                                  */
  /* ------------------------------------------------------------ */

  /**
   * Temperature combines latitude gradient + noise + elevation cooling.
   *
   * @example A colder world overall
   * ```ts
   * defaultWorldConfig.temperature.latitudeStrength = 0.8
   * defaultWorldConfig.temperature.elevationCooling = 0.7
   * ```
   */
  temperature: {
    /** Noise frequency. @default 0.0025 */
    scale: 0.0025,
    /** Fractal octaves. @default 3 */
    octaves: 3,
    /** Amplitude decay. @default 0.5 */
    persistence: 0.5,
    /** Frequency multiplier. @default 2 */
    lacunarity: 2,
    /**
     * Weight of the equator→pole gradient vs noise.
     * `1` = pure latitude, `0` = pure noise.
     * @default 0.65
     */
    latitudeStrength: 0.65,
    /** How much elevation reduces temperature (0–1). @default 0.55 */
    elevationCooling: 0.55,
    /** Continentality: how much inland tiles amplify temp extremes (0–1). @default 0.3 */
    continentalStrength: 0.3,
    /**
     * Rank-to-temperature profile, ranked over land tiles. Fitted (tests/probe/fit-climate.probe.ts)
     * so the inland lowland divides among the climate bands as intended: about 15% polar (below
     * 0.2), 17% cool (to 0.4), 40% temperate (to 0.7) and 28% tropical. It ranks all land, and
     * the elevated tiles, which are cold, fall in the first two bands.
     */
    profile: [
      [0, 0.03],
      [0.197, 0.2],
      [0.3604, 0.4],
      [0.7291, 0.7],
      [1, 0.97]
    ]
  },

  /* ------------------------------------------------------------ */
  /*  Humidity                                                     */
  /* ------------------------------------------------------------ */

  /**
   * Humidity is driven by noise, distance-to-coast and elevation.
   *
   * @example Wetter coasts, drier mountains
   * ```ts
   * defaultWorldConfig.humidity.coastalInfluence = 0.6
   * defaultWorldConfig.humidity.elevationDrying = 0.55
   * ```
   */
  humidity: {
    /** Noise frequency. @default 0.004 */
    scale: 0.004,
    /** Fractal octaves. @default 3 */
    octaves: 3,
    /** Amplitude decay. @default 0.45 */
    persistence: 0.45,
    /** Frequency multiplier. @default 2 */
    lacunarity: 2,
    /** Weight of coast-proximity vs noise (0–1). @default 0.45 */
    coastalInfluence: 0.45,
    /** Drying effect of high elevation (0–1). @default 0.45 */
    elevationDrying: 0.45,
    /** Rank-to-humidity profile, ranked over land tiles. Evenly spread to start. */
    profile: [
      [0, 0.02],
      [0.5, 0.5],
      [1, 0.98]
    ]
  },

  /* ------------------------------------------------------------ */
  /*  Rivers (Minecraft-style noise zero-crossing)                 */
  /* ------------------------------------------------------------ */

  /**
   * Rivers are placed where `|noise(x,y)| < threshold`, producing
   * natural winding channels without pathfinding.
   *
   * Two layers exist: wide primary rivers and thinner tributaries.
   *
   * @example Fewer, thinner rivers
   * ```ts
   * defaultWorldConfig.rivers.primaryThreshold = 0.02
   * defaultWorldConfig.rivers.primaryWidth = 3
   * ```
   */
  rivers: {
    /** Primary river noise frequency. @default 0.0018 */
    primaryScale: 0.0009,
    /** Tributary noise frequency. @default 0.004 */
    secondaryScale: 0.004,
    /** Width of the primary zero-crossing band (bigger = more river). @default 0.023 */
    primaryThreshold: 0.023,
    /** Width of the tributary zero-crossing band. @default 0.0144 */
    secondaryThreshold: 0.0144,
    /** Max rendered pixel width of primary rivers. @default 4 */
    primaryWidth: 4,
    /** Max rendered pixel width of tributaries. @default 2 */
    secondaryWidth: 2,
    /** Humidity increase near river tiles (0–1). @default 0.18 */
    humidityBoost: 0.18,
    /** Radius (tiles) for the humidity boost spread. @default 3 */
    humidityRadius: 3,
    /** Normalised elevation above which rivers taper to nothing. @default 0.82 */
    mountainCutoff: 0.82,
    /** Normalised land-height at which rivers begin fading near coasts. @default 0.1 */
    shoreTaper: 0.1,
    /** Domain warp strength for organic river shapes. @default 40 */
    warpStrength: 40,
    /** Noise octaves for river fBm sampling. @default 3 */
    noiseOctaves: 3,
    /** Noise persistence for river fBm sampling. @default 0.5 */
    noisePersistence: 0.5,
    /** Noise lacunarity for river fBm sampling. @default 2.2 */
    noiseLacunarity: 2.2
  },

  /* ------------------------------------------------------------ */
  /*  Strategic points                                             */
  /* ------------------------------------------------------------ */

  /**
   * Detection radii for strategic feature identification.
   *
   * @example Wider strait detection
   * ```ts
   * defaultWorldConfig.strategic.straitMaxWidth = 20
   * ```
   */
  strategic: {
    /** Search radius for river crossing candidates (tiles). @default 5 */
    riverCrossingRadius: 5,
    /** Saddle-point search radius for mountain passes. @default 8 */
    mountainPassRadius: 8,
    /** Elevation by which the ground around a pass must rise above it. @default 0.02 */
    mountainPassRise: 0.02,
    /** Share of the surrounding samples that must rise by that much. @default 0.35 */
    mountainPassMinRatio: 0.35,
    /** Max water gap to qualify as a strait (tiles). @default 12 */
    straitMaxWidth: 12,
    /** Min water-to-total ratio in scan circle for peninsula. @default 0.6 */
    peninsulaMinRatio: 0.6,
    /** Scan radius for peninsula detection (tiles). @default 10 */
    peninsulaRadius: 10
  },

  /* ------------------------------------------------------------ */
  /*  Biome noise jitter                                           */
  /* ------------------------------------------------------------ */

  /**
   * A low-frequency noise field used to jitter temperature/humidity
   * inputs before biome lookup, breaking up sharp biome boundaries.
   *
   * @example More irregular biome edges
   * ```ts
   * defaultWorldConfig.biomeNoise.tempJitter = 0.2
   * defaultWorldConfig.biomeNoise.humidityJitter = 0.2
   * ```
   */
  biomeNoise: {
    /** Jitter noise frequency. @default 0.006 */
    scale: 0.006,
    /** Fractal octaves. @default 2 */
    octaves: 2,
    /** Amplitude decay. @default 0.5 */
    persistence: 0.5,
    /** Frequency multiplier. @default 2 */
    lacunarity: 2
  },

  /* ------------------------------------------------------------ */
  /*  Biome classification                                         */
  /* ------------------------------------------------------------ */

  /**
   * Thresholds that convert elevation/temperature/humidity into one
   * of the 26 biome types (see `biomes.ts`).
   *
   * @example More mountainous terrain
   * ```ts
   * defaultWorldConfig.biomes.mountainElevation = 0.78
   * defaultWorldConfig.biomes.highlandElevation = 0.68
   * ```
   */
  biomes: {
    /** Land-elevation band immediately above sea level rendered as shore. @default 0.008 */
    shoreBand: 0.008,
    /** Fraction of seaLevel below which water becomes deep ocean. @default 0.55 */
    deepOceanFactor: 0.55,
    /** Elevation above which tiles become mountains. @default 0.85 */
    mountainElevation: 0.85,
    /** Elevation above which tiles become highlands. @default 0.74 */
    highlandElevation: 0.74,
    /** Elevation above which cold tiles become alpine. @default 0.78 */
    alpineElevation: 0.78,
    /** Per-tile temperature jitter from biome noise (0–1). @default 0.1 */
    tempJitter: 0.1,
    /** Per-tile humidity jitter from biome noise (0–1). @default 0.1 */
    humidityJitter: 0.1,
    /** Elevation above sea level within which a row's `lowlandBiome` applies. @default 0.05 */
    lowlandBand: 0.05,
    /**
     * The land climate table, fitted (tests/probe/fit-climate.probe.ts) so each biome covers its
     * target share of land. Below the highland elevation gates: the first band whose
     * `maxTemperature` is above the tile's temperature, then the first row whose `maxHumidity`
     * is above its humidity. The last band and the last row of each band catch the rest.
     */
    bands: [
      {
        maxTemperature: 0.2,
        rows: [
          { maxHumidity: 0.142, biome: 'polar_desert' },
          { maxHumidity: 0.54, biome: 'tundra' },
          { maxHumidity: 0.89, biome: 'taiga' },
          { maxHumidity: 1, biome: 'glacier' }
        ]
      },
      {
        maxTemperature: 0.4,
        rows: [
          { maxHumidity: 0.291, biome: 'cold_steppe' },
          { maxHumidity: 0.477, biome: 'taiga' },
          { maxHumidity: 0.9, biome: 'boreal_forest' },
          { maxHumidity: 1, biome: 'swamp' }
        ]
      },
      {
        maxTemperature: 0.7,
        rows: [
          { maxHumidity: 0.2, biome: 'temperate_desert' },
          { maxHumidity: 0.353, biome: 'steppe' },
          { maxHumidity: 0.549, biome: 'grassland' },
          { maxHumidity: 0.72, biome: 'woodland' },
          { maxHumidity: 0.927, biome: 'temperate_forest' },
          { maxHumidity: 1, biome: 'wetland', lowlandBiome: 'swamp' }
        ]
      },
      {
        maxTemperature: 1,
        rows: [
          { maxHumidity: 0.443, biome: 'desert' },
          { maxHumidity: 0.526, biome: 'badlands' },
          { maxHumidity: 0.679, biome: 'savanna' },
          { maxHumidity: 0.766, biome: 'chaparral' },
          { maxHumidity: 0.883, biome: 'tropical_forest' },
          { maxHumidity: 0.999, biome: 'rainforest' },
          { maxHumidity: 1, biome: 'mangrove' }
        ]
      }
    ]
  },

  /* ------------------------------------------------------------ */
  /*  Resources                                                    */
  /* ------------------------------------------------------------ */

  /**
   * Tuning for the resource generation layer.
   *
   * Resources are derived from biome type, ore noise, elevation
   * and river proximity.  Gold and iron use an independent simplex
   * noise layer whose frequency is set by `oreScale`.
   *
   * @example Making gold rarer
   * ```ts
   * defaultWorldConfig.resources.goldRarity = 0.93
   * ```
   */
  resources: {
    /** Ore noise frequency. Smaller = larger deposit clusters. @default 0.008 */
    oreScale: 0.008,
    /** Gold rarity threshold (0–1, higher = rarer). @default 0.88 */
    goldRarity: 0.88,
    /** Iron rarity threshold (0–1, higher = rarer). @default 0.72 */
    ironRarity: 0.72,
    /** Minimum density to register a resource (0–255). @default 30 */
    minDensity: 30
  },

  /* ------------------------------------------------------------ */
  /*  Nations                                                      */
  /* ------------------------------------------------------------ */

  /**
   * Configuration for nation spawning.
   *
   * @example Fewer, more spread-out nations
   * ```ts
   * defaultWorldConfig.nations.count = 6
   * defaultWorldConfig.nations.minSpacing = 120
   * ```
   */
  nations: {
    /** Number of nations to spawn. @default 12 */
    count: 12,
    /** Minimum tile distance between spawn points. @default 70 */
    minSpacing: 70
  },

  /* ------------------------------------------------------------ */
  /*  Time                                                         */
  /* ------------------------------------------------------------ */

  /** In-game days that pass per simulation tick. @default 1 */
  timestep: 1
}

/** A copy of `base` with every defined property of `overrides` applied. */
function merge<T extends object>(base: T, overrides: Partial<T> | undefined): T {
  const out = { ...base }
  if (overrides !== undefined) {
    for (const key of Object.keys(overrides) as Array<keyof T>) {
      const value = overrides[key]
      if (value !== undefined) out[key] = value as T[keyof T]
    }
  }
  // Arrays (profiles, the climate table) are copied, so a resolved config never shares them with
  // the defaults or with the caller's overrides.
  for (const key of Object.keys(out) as Array<keyof T>) {
    if (Array.isArray(out[key])) out[key] = JSON.parse(JSON.stringify(out[key])) as T[keyof T]
  }
  return out
}

/**
 * The defaults with `overrides` applied per section. Always returns a fresh object: nothing in the
 * result aliases the defaults or the overrides.
 */
export function resolveWorldConfig(overrides: WorldConfigOverrides = {}): WorldConfig {
  const d = defaultWorldConfig
  return {
    map: merge(d.map, overrides.map),
    elevation: merge(d.elevation, overrides.elevation),
    temperature: merge(d.temperature, overrides.temperature),
    humidity: merge(d.humidity, overrides.humidity),
    biomeNoise: merge(d.biomeNoise, overrides.biomeNoise),
    rivers: merge(d.rivers, overrides.rivers),
    biomes: merge(d.biomes, overrides.biomes),
    strategic: merge(d.strategic, overrides.strategic),
    resources: merge(d.resources, overrides.resources),
    nations: merge(d.nations, overrides.nations),
    timestep: overrides.timestep ?? d.timestep
  }
}

const MIN_SIDE = 16
const MAX_SIDE = 8192
const MAX_AREA = 4096 * 4096

function isInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/** Every problem with `config`, as human-readable messages naming the field; empty if valid. */
export function validateWorldConfig(config: WorldConfig): string[] {
  const problems: string[] = []

  // No number anywhere may be NaN or infinite.
  const scan = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) problems.push(`${path} must be a finite number`)
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) scan(child, `${path}.${key}`)
    }
  }
  for (const [key, section] of Object.entries(config)) scan(section, key)

  const { map, nations } = config
  if (!isInteger(map.width) || map.width < MIN_SIDE || map.width > MAX_SIDE) {
    problems.push(`map.width must be an integer from ${MIN_SIDE} to ${MAX_SIDE}`)
  }
  if (!isInteger(map.height) || map.height < MIN_SIDE || map.height > MAX_SIDE) {
    problems.push(`map.height must be an integer from ${MIN_SIDE} to ${MAX_SIDE}`)
  }
  if (map.width * map.height > MAX_AREA) {
    problems.push(`map.width * map.height must not exceed ${MAX_AREA} tiles`)
  }
  if (!(map.seaLevel > 0 && map.seaLevel < 1))
    problems.push('map.seaLevel must be between 0 and 1, exclusive')
  if (!(map.minLandRatio >= 0 && map.minLandRatio < 1)) {
    problems.push('map.minLandRatio must be at least 0 and below 1')
  }
  if (typeof map.islandMode !== 'boolean') problems.push('map.islandMode must be true or false')

  if (!isInteger(nations.count) || nations.count < 0 || nations.count > 255) {
    problems.push('nations.count must be an integer from 0 to 255')
  }
  if (!(nations.minSpacing > 0)) problems.push('nations.minSpacing must be greater than 0')
  if (!(config.timestep > 0)) problems.push('timestep must be greater than 0')

  const noise: Array<
    [string, { scale: number; octaves: number; persistence: number; lacunarity: number }]
  > = [
    ['elevation', config.elevation],
    ['temperature', config.temperature],
    ['humidity', config.humidity],
    ['biomeNoise', config.biomeNoise]
  ]
  for (const [name, layer] of noise) {
    if (!(layer.scale > 0)) problems.push(`${name}.scale must be greater than 0`)
    if (!isInteger(layer.octaves) || layer.octaves < 1 || layer.octaves > 8) {
      problems.push(`${name}.octaves must be an integer from 1 to 8`)
    }
    if (!(layer.persistence > 0 && layer.persistence <= 1)) {
      problems.push(`${name}.persistence must be greater than 0 and at most 1`)
    }
    if (!(layer.lacunarity >= 1)) problems.push(`${name}.lacunarity must be at least 1`)
  }

  validateProfile('elevation', config.elevation.profile, problems)
  validateProfile('temperature', config.temperature.profile, problems)
  validateProfile('humidity', config.humidity.profile, problems)
  validateBiomeTable(config.biomes, problems)
  if (!(config.strategic.mountainPassRise > 0)) {
    problems.push('strategic.mountainPassRise must be greater than 0')
  }
  if (!(config.strategic.mountainPassMinRatio > 0 && config.strategic.mountainPassMinRatio <= 1)) {
    problems.push('strategic.mountainPassMinRatio must be greater than 0 and at most 1')
  }

  return problems
}

/** Problems with a quantile profile: a monotone map from quantile 0 to 1, with values in [0, 1]. */
function validateProfile(section: string, profile: QuantileProfile, problems: string[]): void {
  const name = `${section}.profile`
  if (!Array.isArray(profile) || profile.length < 2) {
    problems.push(`${name} needs at least two knots`)
    return
  }
  for (let k = 0; k < profile.length; k += 1) {
    const knot = profile[k]
    if (!Array.isArray(knot) || knot.length !== 2) {
      problems.push(`${name}[${k}] must be a [quantile, value] pair`)
      return
    }
  }
  if (profile[0][0] !== 0) problems.push(`${name} must start at quantile 0`)
  if (profile[profile.length - 1][0] !== 1) problems.push(`${name} must end at quantile 1`)
  for (let k = 1; k < profile.length; k += 1) {
    if (!(profile[k][0] > profile[k - 1][0])) {
      problems.push(`${name} quantiles must strictly increase (knot ${k})`)
    }
    if (profile[k][1] < profile[k - 1][1]) {
      problems.push(`${name} values must not decrease (knot ${k})`)
    }
  }
  for (let k = 0; k < profile.length; k += 1) {
    const value = profile[k][1]
    if (value < 0 || value > 1) problems.push(`${name} values must be between 0 and 1 (knot ${k})`)
  }
}

/** Problems with the climate table: ascending bands and rows that end at 1, with real biomes. */
function validateBiomeTable(biomes: BiomeConfig, problems: string[]): void {
  if (!(biomes.lowlandBand >= 0)) problems.push('biomes.lowlandBand must be at least 0')
  const known = new Set<string>(BIOME_KEYS)
  const { bands } = biomes
  if (!Array.isArray(bands) || bands.length === 0) {
    problems.push('biomes.bands needs at least one temperature band')
    return
  }
  let previousTemperature = 0
  bands.forEach((band, b) => {
    const at = `biomes.bands[${b}]`
    const last = b === bands.length - 1
    if (!(band.maxTemperature > previousTemperature && band.maxTemperature <= 1)) {
      problems.push(`${at}.maxTemperature must rise above the band before it and be at most 1`)
    }
    if (last && band.maxTemperature !== 1)
      problems.push(`${at}.maxTemperature of the last band must be 1`)
    previousTemperature = band.maxTemperature
    if (!Array.isArray(band.rows) || band.rows.length === 0) {
      problems.push(`${at} needs at least one row`)
      return
    }
    let previousHumidity = 0
    band.rows.forEach((row, r) => {
      const rowAt = `${at}.rows[${r}]`
      if (!(row.maxHumidity > previousHumidity && row.maxHumidity <= 1)) {
        problems.push(`${rowAt}.maxHumidity must rise above the row before it and be at most 1`)
      }
      if (r === band.rows.length - 1 && row.maxHumidity !== 1) {
        problems.push(`${rowAt}.maxHumidity of the last row must be 1`)
      }
      previousHumidity = row.maxHumidity
      if (!known.has(row.biome)) problems.push(`${rowAt}.biome "${row.biome}" is not a biome`)
      if (row.lowlandBiome !== undefined && !known.has(row.lowlandBiome)) {
        problems.push(`${rowAt}.lowlandBiome "${row.lowlandBiome}" is not a biome`)
      }
    })
  })
}

/** Throws a `RangeError` listing every problem if `config` is invalid. */
export function assertValidWorldConfig(config: WorldConfig): void {
  const problems = validateWorldConfig(config)
  if (problems.length > 0) {
    throw new RangeError(`invalid world config:\n  ${problems.join('\n  ')}`)
  }
}
