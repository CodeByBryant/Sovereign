/**
 * @module terrain
 * @description The fields a terrain run produces. This is the contract between the engine (which
 * generates them) and the renderer / hosts (which display and store them). Plain typed arrays, no
 * DOM types: the engine never draws.
 */
import type { RouteHub, StrategicPoint, StrategicRoute } from './strategic'

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
  /** The two resource slots of every tile: surface and ground. */
  resources: ResourceSlots
  /** Where the route network has to go through: passes, fords, straits and land necks. */
  strategicPoints: StrategicPoint[]
  /** The places routes join (the best sites to live). */
  hubs: RouteHub[]
  /** The cheapest ways between neighbouring hubs. */
  routes: StrategicRoute[]
}

/**
 * One resource slot of every tile (struct of arrays, one entry per tile): which resource it holds
 * (a catalogue id, 0 for none), how rich the deposit was to begin with (1 to 255) and how much is
 * left (0 to `richness`; it only changes by extraction and regrowth).
 */
export interface ResourceSlot {
  type: Uint8Array
  richness: Uint8Array
  stock: Uint8Array
}

/**
 * The two slots every tile has: the **surface** (a forest, crop or herd on land; a fishery on water)
 * and the **ground** (a mineral; oil and salt may also lie under shallow sea).
 */
export interface ResourceSlots {
  surface: ResourceSlot
  ground: ResourceSlot
}
