/**
 * @module WorldMap
 * @description Central tile-data store backed by struct-of-arrays.
 *
 * Each layer is a compact typed array (Uint8Array or Float32Array).
 * The `at(x, y)` method composes a readonly {@link TileInfo} snapshot
 * on demand without allocating 4M objects.
 *
 * @example
 * ```ts
 * const world = new WorldMap(data)
 * const tile = world.at(500, 300)
 * console.log(tile.biome, tile.resource, tile.nearShore)
 * ```
 */
import { BIOME_KEYS, type BiomeKey } from '../terrain/biomes'
import { ResourceType, RESOURCE_META } from '../../types/resources'
import type { TileInfo } from '../../types/tile'

/** Raw layer data transferred from the terrain worker. */
export interface WorldMapData {
  width: number
  height: number
  seaLevel: number
  elevation: Float32Array
  temperature: Float32Array
  humidity: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  resourceType: Uint8Array
  resourceDensity: Uint8Array
  /** Per-tile owner nation ID. 255 = unclaimed. */
  ownership: Uint8Array
}

/**
 * Tile-data store with struct-of-arrays layout.
 *
 * All typed arrays share the same length (`width × height`).
 * Use `at(x, y)` for ergonomic reads, or access layers directly
 * for bulk operations.
 */
export class WorldMap {
  readonly width: number
  readonly height: number
  readonly seaLevel: number
  readonly size: number

  /** Layer data — mutable for ownership/resource updates. */
  readonly elevation: Float32Array
  readonly temperature: Float32Array
  readonly humidity: Float32Array
  readonly biomeIds: Uint8Array
  readonly riverMask: Uint8Array
  readonly resourceType: Uint8Array
  readonly resourceDensity: Uint8Array
  readonly ownership: Uint8Array

  constructor(data: WorldMapData) {
    this.width = data.width
    this.height = data.height
    this.seaLevel = data.seaLevel
    this.size = data.width * data.height
    this.elevation = data.elevation
    this.temperature = data.temperature
    this.humidity = data.humidity
    this.biomeIds = data.biomeIds
    this.riverMask = data.riverMask
    this.resourceType = data.resourceType
    this.resourceDensity = data.resourceDensity
    this.ownership = data.ownership
  }

  /** Check whether (x, y) is within map bounds. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /** Flat index for (x, y). No bounds check — caller must verify. */
  index(x: number, y: number): number {
    return y * this.width + x
  }

  /**
   * Compose a readonly {@link TileInfo} for the tile at (x, y).
   * Returns `null` if out of bounds.
   *
   * Computed properties (`nearShore`, `isWater`) are derived on
   * the fly from neighbouring layers — no extra storage required.
   */
  at(x: number, y: number): TileInfo | null {
    if (!this.inBounds(x, y)) return null
    const i = this.index(x, y)
    const elev = this.elevation[i]
    const isWater = elev <= this.seaLevel
    const biomeId = this.biomeIds[i]
    const resType = this.resourceType[i] as ResourceType
    const ownRaw = this.ownership[i]

    // Compute nearShore: any cardinal neighbour is water?
    let nearShore = false
    if (!isWater) {
      const w = this.width
      if (x > 0 && this.elevation[i - 1] <= this.seaLevel) nearShore = true
      else if (x < this.width - 1 && this.elevation[i + 1] <= this.seaLevel) nearShore = true
      else if (y > 0 && this.elevation[i - w] <= this.seaLevel) nearShore = true
      else if (y < this.height - 1 && this.elevation[i + w] <= this.seaLevel) nearShore = true
    }

    return {
      x,
      y,
      index: i,
      elevation: elev,
      temperature: this.temperature[i],
      humidity: this.humidity[i],
      biomeId,
      biome: (BIOME_KEYS[biomeId] ?? 'ocean') as BiomeKey,
      isRiver: this.riverMask[i] === 1,
      isWater,
      nearShore,
      resource: resType,
      resourceDensity: this.resourceDensity[i],
      resourceLabel: RESOURCE_META[resType]?.label ?? 'None',
      ownerId: ownRaw === 255 ? -1 : ownRaw
    }
  }
}
