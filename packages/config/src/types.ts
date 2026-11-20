/**
 * @module types
 * @description Typed configuration sections for world generation.
 * Pure data shapes: the generators in `@sovereign/simulation` consume them.
 */

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

/**
 * Tunable thresholds that shape the biome classification.
 *
 * @property shoreBand          - Elevation band above seaLevel classified as shore.
 * @property deepOceanFactor    - Fraction of seaLevel below which ocean is "deep".
 * @property mountainElevation  - Elevation above which land is classified as mountain.
 * @property highlandElevation  - Elevation threshold for highland biome.
 * @property alpineElevation    - Elevation threshold for alpine (cold + high).
 * @property tempJitter         - Per-tile temperature variation magnitude.
 * @property humidityJitter     - Per-tile humidity variation magnitude.
 */
export interface BiomeConfig {
  shoreBand: number
  deepOceanFactor: number
  mountainElevation: number
  highlandElevation: number
  alpineElevation: number
  tempJitter: number
  humidityJitter: number
}

export interface StrategicConfig {
  /** Radius to check neighbours for river crossing detection. */
  riverCrossingRadius: number
  /** Radius to search for mountain pass saddle points. */
  mountainPassRadius: number
  /** Max water width to qualify as a strait. */
  straitMaxWidth: number
  /** Min land-to-water ratio in scan area to count as peninsula. */
  peninsulaMinRatio: number
  /** Radius for peninsula scan. */
  peninsulaRadius: number
}

/**
 * Shared parameters for fractal Brownian motion (fBm) noise sampling.
 *
 * @property scale       - Base frequency multiplier (smaller → larger features).
 * @property octaves     - Number of noise layers to sum.
 * @property persistence - Amplitude decay per octave (0–1).
 * @property lacunarity  - Frequency multiplier per octave (usually 2).
 */
export interface NoiseLayerConfig {
  scale: number
  octaves: number
  persistence: number
  lacunarity: number
}

/**
 * Elevation-specific generation parameters.
 *
 * Extends {@link NoiseLayerConfig} with map dimensions, sea-level,
 * island falloff toggle, and continent/ocean shaping knobs.
 */
export interface TerrainConfig extends NoiseLayerConfig {
  seaLevel: number
  islandMode: boolean
  width: number
  height: number
  /** Frequency for broad continental shapes. */
  continentScale: number
  /** Blend weight of continent layer (0–1). */
  continentStrength: number
  /** Frequency for ocean-depth carving. */
  oceanScale: number
  /** Subtractive strength of ocean layer. */
  oceanStrength: number
  /** Elevation redistribution power curve (>1 flattens lowlands, steepens highlands). @default 1.4 */
  redistributionPower?: number
}

/**
 * Temperature field parameters.
 *
 * Temperature combines latitude gradient, noise, and an
 * elevation-cooling penalty.
 */
export interface TemperatureConfig extends NoiseLayerConfig {
  /** How strongly latitude controls temperature (0–1). */
  latitudeStrength: number
  /** Temperature penalty multiplied by elevation (0–1). */
  elevationCooling: number
  /** How strongly continental interior amplifies temperature extremes (0–1). @default 0.3 */
  continentalStrength?: number
}

/**
 * Humidity field parameters.
 *
 * Humidity is a blend of noise, BFS coastal distance, and an
 * elevation-drying factor.
 */
export interface HumidityConfig extends NoiseLayerConfig {
  /** Blend weight of coastal proximity on humidity (0–1). */
  coastalInfluence: number
  /** Humidity penalty multiplied by elevation (0–1). */
  elevationDrying: number
}

/**
 * Biome variation noise parameters.
 *
 * Provides per-tile jitter values that are applied inside the
 * biome classifier to create softer biome edges.
 */
export type BiomeNoiseConfig = NoiseLayerConfig

export interface RiverConfig {
  /** Scale of the primary (large) river noise. Smaller = wider spacing. */
  primaryScale: number
  /** Scale of the secondary (tributary) river noise. */
  secondaryScale: number
  /** Threshold for primary rivers. Higher = wider rivers. */
  primaryThreshold: number
  /** Threshold for secondary rivers. */
  secondaryThreshold: number
  /** Maximum pixel width of primary river centres. */
  primaryWidth: number
  /** Maximum pixel width of secondary river centres. */
  secondaryWidth: number
  /** How much to boost humidity near rivers (0-1). */
  humidityBoost: number
  /** Radius (in tiles) for humidity boost spreading. */
  humidityRadius: number
  /** Elevation above sea-level at which rivers taper out (mountains). */
  mountainCutoff: number
  /** Blend factor for shore tapering (how close to sea-level rivers fade). */
  shoreTaper: number
  /** Domain warp strength for organic river shapes. @default 40 */
  warpStrength?: number
  /** Noise octaves for river sampling. @default 3 */
  noiseOctaves?: number
  /** Noise persistence for river sampling. @default 0.5 */
  noisePersistence?: number
  /** Noise lacunarity for river sampling. @default 2.2 */
  noiseLacunarity?: number
}

export interface ResourceConfig {
  /** Ore noise frequency. @default 0.008 */
  oreScale: number
  /** Gold rarity threshold (0–1, higher = rarer). @default 0.88 */
  goldRarity: number
  /** Iron rarity threshold (0–1, higher = rarer). @default 0.72 */
  ironRarity: number
  /** Minimum density to register a resource (0–255). @default 30 */
  minDensity: number
}
