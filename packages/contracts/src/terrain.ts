/**
 * @module terrain
 * @description The fields a terrain run produces. This is the contract between the engine (which
 * generates them) and the renderer / hosts (which display and store them). Plain typed arrays, no
 * DOM types: the engine never draws.
 */
import type { StrategicPoint } from './strategic'

export interface TerrainFields {
  width: number
  height: number
  /** The effective sea level (may be lower than configured if the land-ratio rescue applied). */
  seaLevel: number
  /** Normalised elevation per tile, `y * width + x`. */
  elevation: Float32Array
  temperature: Float32Array
  /** Humidity including the moisture boost around rivers. */
  humidity: Float32Array
  /** Index into `BIOME_KEYS` per tile. */
  biomeIds: Uint8Array
  /** 1 where there is a river. */
  riverMask: Uint8Array
  /** River width per tile, for drawing. */
  riverWidth: Uint8Array
  resourceType: Uint8Array
  resourceDensity: Uint8Array
  strategicPoints: StrategicPoint[]
}
