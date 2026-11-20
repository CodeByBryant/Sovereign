/**
 * @module biomes
 * @description Biome identifiers and display metadata shared by the
 * simulation (classification), the renderer (colours) and the UI (labels).
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
export const BIOME_PALETTE: Record<BiomeKey, { name: string; color: [number, number, number] }> = {
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
export const BIOME_INDEX: Record<BiomeKey, number> = BIOME_KEYS.reduce(
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
