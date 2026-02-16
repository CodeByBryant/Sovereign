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

/* ------------------------------------------------------------------ */
/*  Biome keys & palette                                               */
/* ------------------------------------------------------------------ */

/** Union of all 26 biome string identifiers (const tuple). */
export const BIOME_KEYS = [
  'deep_ocean',
  'ocean',
  'shore',
  'polar_desert',
  'glacier',
  'tundra',
  'alpine',
  'boreal_forest',
  'taiga',
  'cold_steppe',
  'temperate_desert',
  'steppe',
  'grassland',
  'woodland',
  'temperate_forest',
  'chaparral',
  'swamp',
  'desert',
  'badlands',
  'savanna',
  'tropical_forest',
  'rainforest',
  'wetland',
  'mangrove',
  'highland',
  'mountain'
] as const

/** Discriminated string-literal type for biome identifiers. */
export type BiomeKey = (typeof BIOME_KEYS)[number]

/**
 * Display name and RGB colour for every biome, used for both the biome
 * map renderer and any future UI legends / tooltips.
 */
const BIOME_PALETTE: Record<BiomeKey, { name: string; color: [number, number, number] }> = {
  deep_ocean: { name: 'Deep Ocean', color: [0, 26, 51] },
  ocean: { name: 'Ocean', color: [0, 44, 84] },
  shore: { name: 'Shore', color: [214, 197, 149] },
  polar_desert: { name: 'Polar Desert', color: [220, 231, 239] },
  glacier: { name: 'Glacier', color: [242, 250, 255] },
  tundra: { name: 'Tundra', color: [204, 221, 238] },
  alpine: { name: 'Alpine', color: [176, 192, 170] },
  boreal_forest: { name: 'Boreal Forest', color: [72, 104, 74] },
  taiga: { name: 'Taiga', color: [58, 88, 70] },
  cold_steppe: { name: 'Cold Steppe', color: [171, 167, 134] },
  temperate_desert: { name: 'Temperate Desert', color: [214, 200, 154] },
  steppe: { name: 'Steppe', color: [156, 170, 92] },
  grassland: { name: 'Grassland', color: [124, 186, 61] },
  woodland: { name: 'Woodland', color: [98, 150, 82] },
  temperate_forest: { name: 'Temperate Forest', color: [76, 132, 76] },
  chaparral: { name: 'Scrubland', color: [140, 152, 86] },
  swamp: { name: 'Swamp', color: [64, 92, 78] },
  desert: { name: 'Desert', color: [224, 192, 151] },
  badlands: { name: 'Badlands', color: [191, 148, 98] },
  savanna: { name: 'Savanna', color: [200, 180, 90] },
  tropical_forest: { name: 'Tropical Forest', color: [52, 140, 90] },
  rainforest: { name: 'Rainforest', color: [42, 122, 86] },
  wetland: { name: 'Wetland', color: [60, 112, 102] },
  mangrove: { name: 'Mangrove', color: [45, 105, 96] },
  highland: { name: 'Highland', color: [122, 116, 108] },
  mountain: { name: 'Mountain', color: [156, 150, 140] }
}

/** Numeric index for each biome (position in {@link BIOME_KEYS}). */
const BIOME_INDEX: Record<BiomeKey, number> = BIOME_KEYS.reduce(
  (acc, key, index) => {
    acc[key] = index
    return acc
  },
  {} as Record<BiomeKey, number>
)

/* ------------------------------------------------------------------ */
/*  Lookup helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Resolve a numeric biome id back to its key and display name.
 * Returns `'ocean'` for any out-of-range id.
 */
export const getBiomeById = (id: number): { key: BiomeKey; name: string } => {
  const key = BIOME_KEYS[id] ?? 'ocean'
  return { key, name: BIOME_PALETTE[key].name }
}

/** Return the RGB colour tuple for a biome key. */
export const getBiomeColor = (key: BiomeKey): [number, number, number] => {
  return BIOME_PALETTE[key].color
}

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
 * Build a full biome map (ImageData + id array) from the terrain fields.
 *
 * Iterates every tile, classifies it with {@link determineBiome}, writes
 * the palette colour into `imageData` and the numeric biome id into
 * `biomeIds`.
 *
 * @returns An object with `imageData` (RGBA) and `biomeIds` (Uint8Array).
 */
export const buildBiomeMap = (
  elevation: Float32Array,
  temperature: Float32Array,
  humidity: Float32Array,
  variation: Float32Array,
  width: number,
  height: number,
  seaLevel: number,
  config: BiomeConfig
): { imageData: ImageData; biomeIds: Uint8Array } => {
  const imageData = new ImageData(width, height)
  const biomeIds = new Uint8Array(width * height)

  for (let i = 0; i < biomeIds.length; i += 1) {
    const biome = determineBiome(
      elevation[i],
      temperature[i],
      humidity[i],
      variation[i],
      seaLevel,
      config
    )
    const color = getBiomeColor(biome)
    const index = i * 4

    biomeIds[i] = BIOME_INDEX[biome]
    imageData.data[index] = color[0]
    imageData.data[index + 1] = color[1]
    imageData.data[index + 2] = color[2]
    imageData.data[index + 3] = 255
  }

  return { imageData, biomeIds }
}

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

/** Clamp a value to [0, 1]. */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
