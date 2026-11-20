/**
 * @module types/tile
 * @description Per-tile data accessor for the Sovereign world.
 *
 * The underlying storage is struct-of-arrays (compact typed arrays).
 * `TileInfo` is a readonly view returned by `WorldMap.at(x, y)`.
 */
import type { ResourceLayer, ResourceType } from './resources'
import type { BiomeKey } from './biomes'

/**
 * Readonly snapshot of a single tile's data, composed from multiple
 * typed-array layers. This is NOT stored per-tile — it's built on
 * demand by `WorldMap.at()` to avoid 4M object allocations.
 */
/** One resource on a tile, as the UI and the economy see it. */
export interface TileResource {
  type: ResourceType
  key: string
  label: string
  layer: ResourceLayer
  /** The potential the deposit began with (1 to 255). */
  richness: number
  /** What is left (0 to `richness`). */
  stock: number
}

export interface TileInfo {
  /** Tile grid X coordinate. */
  x: number
  /** Tile grid Y coordinate. */
  y: number
  /** Flat index into typed arrays: `y * width + x`. */
  index: number
  /** Normalised elevation [0, 1]. */
  elevation: number
  /** Normalised temperature [0, 1]. */
  temperature: number
  /** Normalised humidity [0, 1]. */
  humidity: number
  /** Biome numeric ID (index into BIOME_KEYS). */
  biomeId: number
  /** Biome string key (e.g. 'grassland'). */
  biome: BiomeKey
  /** Whether this tile is a river. */
  isRiver: boolean
  /** Whether this tile is below sea level. */
  isWater: boolean
  /** Whether any of the 4 cardinal neighbours is water. */
  nearShore: boolean
  /** What the tile holds: its surface resource, then its ground resource (up to two). */
  resources: TileResource[]
  /** Owning nation ID, or -1 if unclaimed. */
  ownerId: number
}

