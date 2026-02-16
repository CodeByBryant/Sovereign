/**
 * @module types/tile
 * @description Per-tile data accessor for the Sovereign world.
 *
 * The underlying storage is struct-of-arrays (compact typed arrays).
 * `TileInfo` is a readonly view returned by `WorldMap.at(x, y)`.
 */
import { ResourceType, RESOURCE_META } from './resources'
import type { BiomeKey } from '../core/terrain/biomes'

/**
 * Readonly snapshot of a single tile's data, composed from multiple
 * typed-array layers. This is NOT stored per-tile — it's built on
 * demand by `WorldMap.at()` to avoid 4M object allocations.
 */
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
  /** Primary resource type present on this tile. */
  resource: ResourceType
  /** Resource density 0–255 (0 = absent). */
  resourceDensity: number
  /** Resource display label. */
  resourceLabel: string
  /** Owning nation ID, or -1 if unclaimed. */
  ownerId: number
}

export { ResourceType, RESOURCE_META }
