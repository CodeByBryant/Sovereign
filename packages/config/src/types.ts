/**
 * @module types
 * @description Typed configuration sections for world generation.
 * Pure data shapes: the generators in `@sovereign/simulation` consume them.
 */

import type { BiomeKey, QuantileProfile } from '@sovereign/contracts'

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

/**
 * One row of a climate band: the biome chosen when the tile's (jittered) humidity is below
 * `maxHumidity`. The last row of a band has `maxHumidity` 1 and catches everything above.
 *
 * @property lowlandBiome - Chosen instead of `biome` on low ground, within `lowlandBand` of sea
 *                          level (a very wet temperate tile is a swamp there, a wetland elsewhere).
 */
export interface BiomeRow {
  maxHumidity: number
  biome: BiomeKey
  lowlandBiome?: BiomeKey
}

/**
 * A temperature band of the classifier: tiles with temperature below `maxTemperature` (and not in
 * a lower band) are classified by humidity from `rows`. The last band has `maxTemperature` 1.
 */
export interface ClimateBand {
  maxTemperature: number
  rows: BiomeRow[]
}

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
 * @property bands              - The temperature x humidity table for land below the highlands:
 *                                ascending temperature bands, each a list of ascending humidity rows.
 * @property lowlandBand        - Elevation above sea level within which a row's `lowlandBiome` applies.
 */
export interface BiomeConfig {
  shoreBand: number
  deepOceanFactor: number
  mountainElevation: number
  highlandElevation: number
  alpineElevation: number
  tempJitter: number
  humidityJitter: number
  bands: ClimateBand[]
  lowlandBand: number
}

export interface StrategicConfig {
  /** The longest run of river cells (in route cells) a route may cross and still count as a ford. */
  fordMaxRun: number
  /** The longest stretch of open water (in route cells) a sea lane may cross and still count as a strait. */
  straitMaxCells: number
  /** How much higher a pass is than the lowest ground on each side of it along the route (elevation, 0 to 1). */
  passRise: number
  /** The lowest elevation (0 to 1) a pass can be at: hills and above. */
  passMinElevation: number
  /** A pass is the highest point of its route within this many route cells. */
  passWindow: number
  /** A land neck is a stretch of route at most this many cells from the sea (width about twice that). */
  isthmusMaxSeaDistance: number
  /** The land on each side of a neck is at least this many cells farther from the sea. */
  isthmusRise: number
  /** The wider land is looked for this many route cells beyond each end of the neck. */
  isthmusWindow: number
  /** Two points of one kind closer than this many cells are one point (the busier wins). */
  mergeRadius: number
  /** Routes carrying less than this fraction of the busiest route's traffic have no strategic points. */
  minTraffic: number
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
  /**
   * Rank-to-elevation profile: after the raw field is built, every tile is ranked and given the
   * elevation this profile assigns to its rank. It is what pins the ocean amount and how much land
   * is highland or mountain, whatever the seed. Absolute elevations, so `seaLevel` keeps its meaning.
   */
  profile: QuantileProfile
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
  /** Rank-to-temperature profile, ranked over land tiles only. See `TerrainConfig.profile`. */
  profile: QuantileProfile
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
  /** Rank-to-humidity profile, ranked over land tiles only. See `TerrainConfig.profile`. */
  profile: QuantileProfile
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

/* ------------------------------------------------------------------ */
/*  Resource placement                                                 */
/* ------------------------------------------------------------------ */

/** A `[min, max]` range, both ends inclusive. */
export type Range = readonly [min: number, max: number]

/** Soft preferences: each adds `weight x feature` (a 0 to 1 feature) to a tile's score of 1. */
export interface ResourcePreferences {
  /** Stand above the surroundings (ridges and peaks); negative to avoid them. */
  ridge?: number
  /** Sit below the surroundings (basins and valleys). */
  basin?: number
  /** Steep ground. */
  slope?: number
  /** High ground, from sea level (0) to the highest peak (1). */
  height?: number
  /** Near a river: full weight on the river, fading to nothing `within` tiles away. */
  river?: { within: number; weight: number }
  /** Near the coast (on land, the sea; on water, the land): full weight at the shore, fading to nothing `within` tiles out. */
  coast?: { within: number; weight: number }
  /** Wet ground. */
  wet?: number
  /** Warm ground. */
  warm?: number
}

/**
 * Where one resource is found and how much of it there is. Hard gates decide which tiles can hold
 * it; the soft preferences and the regional factor rank those tiles; the top `share` of them get it.
 */
export interface ResourceRule {
  /** Fraction of the land (or, for a water resource, of the water) that holds it: an upper bound if too few tiles qualify. */
  share: number
  /** Land resources: the weight (0 to 1) of each biome that can hold it. A biome not listed cannot. Omit for every land biome. */
  biomes?: Partial<Record<BiomeKey, number>>
  /** Hard limits on the tile's elevation (0 to 1), temperature and humidity. */
  elevation?: Range
  temperature?: Range
  humidity?: Range
  /** Hard limit on the distance (tiles) to the coast: from the sea for land, from the land for water. */
  coastDistance?: Range
  prefer?: ResourcePreferences
  /** How far regional geology or ecology can make it rich or barren: 0 none, 1 complete (whole regions with none). */
  regional: number
  /** The size of those regions, in tiles. */
  regionSize: number
  /**
   * The room between objects, in tiles (a whole number from 1 to 8; omit or 1 for none). Tiles are taken best
   * first as before, but a tile is skipped if an object of this resource already placed is closer than this, so a patch is a scatter of objects with open ground between them instead of a
   * solid block. The share still counts what is placed: it is reached with the best tiles that leave the room, or
   * as many as fit.
   */
  spacing?: number
  /**
   * Oil and salt: the share of the **water** tiles within the coast distance range (and, if given, the
   * elevation range: how deep it can lie) that also hold it, under the sea. The rule's own elevation,
   * temperature and humidity limits are for the land and do not apply here.
   */
  offshore?: { share: number; coastDistance?: Range; elevation?: Range }
}

/** Settings shared by every rule when features are derived from the terrain. */
export interface ResourceFeatureConfig {
  /** Radius (tiles) of the window a tile is compared with to decide whether it is a ridge or a basin. */
  ridgeRadius: number
  /** How far above or below its surroundings (elevation) counts as a full ridge or basin. */
  ridgeScale: number
  /** The slope (elevation per tile) that counts as fully steep. */
  slopeScale: number
}

/** The placement rules for every resource, by catalogue key (`timber`, `iron`, ...). */
export interface ResourcePlacementConfig {
  features: ResourceFeatureConfig
  rules: Record<string, ResourceRule>
}

/** How fast a drawn-down renewable resource grows back. */
export interface ResourceRegrowth {
  /** Units of stock regrown each time. 1 to 255. */
  units: number
  /** Every this many ticks (a tick is a day). 1 to 65535. */
  period: number
}

/** Everything that decides where resources are, how rich they are, and how they regrow. */
export interface ResourcePlacementSettings extends ResourcePlacementConfig {
  /** Regrowth by catalogue key, for every renewable resource (the surface ones). Ground resources are finite. */
  regrowth: Record<string, ResourceRegrowth>
}

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */

/**
 * What it costs to cross the ground, per step of one cell. The cheapest path between two places is a
 * route, so these numbers decide where roads, passes, fords and sea lanes go.
 */
export interface RouteCostConfig {
  /** The cost of one step over flat, open ground. Everything else is added to it. */
  base: number
  /** Extra cost of a steep cell: this much for a cell as steep as `resources.features.slopeScale`. */
  slope: number
  /** Extra cost of high ground: this much at the highest peak, scaled from the highland line. */
  height: number
  /** Extra cost of a river cell, per unit of river width (so a ford is found where a river is narrow). */
  river: number
  /** The cost of one step by boat in coastal water (open water costs more than the land it replaces). */
  sea: number
  /** How far from land (in cells) a boat will go; water farther out is not part of any route. */
  seaReach: number
  /** Extra cost by biome (added to `base`): swamps, deserts and mountains are slow, grassland is not. */
  biomes: Record<BiomeKey, number>
}

/** How the land is cut into provinces, the units nations own and grow by. */
export interface ProvincesConfig {
  /** The least distance (tiles) between two province seeds; sets the size of a province (about 20 gives 450 tiles). */
  spacing: number
  /** A province with fewer tiles than this merges into the neighbour it shares the longest border with. */
  minArea: number
  /** The most one tile costs to cross when provinces are cut, so a range divides two seeds without ruling a whole map. */
  costCap: number
}

/** The people who walk the world: how many there are to start with and how they move. */
export interface UnitsConfig {
  /** How many villagers each nation starts with, at its capital. 0 for none. */
  perNation: number
  /** Travel cost a walker pays per tick (a route's cost divided by this is the days it takes). */
  walkSpeed: number
  /** How far (in route cells of `routes.cell` tiles) a villager wanders from home. */
  wanderRadius: number
  /** The fewest and the most ticks a villager rests between walks. */
  restMin: number
  restMax: number
  /** The most units a villager carries home in one trip (1 to 255). */
  carryCapacity: number
  /** How far (in tiles) from where it rests a villager looks for something to gather. */
  searchRadius: number
  /**
   * What villagers gather, by catalogue key: the ticks of work at the deposit and the units taken from it per
   * trip (also limited by `carryCapacity` and by what is left). A resource not listed is not gathered. An override
   * of this table replaces the whole table, like the regrowth table does.
   */
  gather: Record<string, GatherRule>
}

/** How one resource is gathered. */
export interface GatherRule {
  /** Ticks (days) a villager works at the deposit before it has anything to carry (1 to 365). */
  work: number
  /** Units taken per trip (1 to 255). */
  amount: number
}

/** How nations grow into free provinces as time passes. */
export interface ExpansionConfig {
  /**
   * Expansion points a nation earns per day at 100 people and an expansionism of 0.5; it scales with
   * `0.5 + expansionism` and with the square root of the population over 100.
   */
  rate: number
  /** Points it costs to claim a province, per tile of it, times how hard its ground is to cross. */
  costPerTile: number
}

/** Where routes between settlements are drawn from, and how they are found. */
export interface RoutesConfig {
  /** Side of one route cell, in tiles: routes are found on this coarser grid. */
  cell: number
  /** The least distance (tiles) between two hubs, the places routes join. */
  hubSpacing: number
  /** The lowest site score (0 to 1) a place needs to be a hub. */
  hubMinScore: number
  cost: RouteCostConfig
}
