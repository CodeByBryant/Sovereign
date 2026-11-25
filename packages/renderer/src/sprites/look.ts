/**
 * @module sprites/look
 * @description How a deposit is drawn on the map: which picture, how big, where it stands and what shadow it
 * casts. Pure and view-only: the variant comes from the tile, never from the simulation, so it is not in any
 * hash and changing it moves no save. Objects are drawn bigger than their tile and stand on a contact point
 * at the lower middle of it; rows are drawn top to bottom, so a tree in front covers the one behind it.
 */
import { RESOURCE_CATALOG, ResourceType } from '@sovereign/contracts'
import { TREE_VARIANTS, resourceFrameName, type ResourceSpriteState } from './atlas'

export interface ResourceLook {
  /** The atlas frame. */
  frame: string
  /** Width and height in tiles (the sprite is square). */
  size: number
  /** Where in the sprite, from its top (0 to 1), the object meets the ground. */
  anchorY: number
  /** Width in tiles of the shadow beneath it, or 0 for none. */
  shadow: number
}

const ROCK_LIKE: ReadonlySet<number> = new Set([
  ResourceType.Stone,
  ResourceType.Iron,
  ResourceType.Gold,
  ResourceType.Copper,
  ResourceType.Coal,
  ResourceType.Silver,
  ResourceType.Gems,
  ResourceType.Salt
])

/** Flat or in the water: fields, pastures, vines, tea, fish, whales, pearls, oil. They stand on no shadow. */
const FLAT: ReadonlySet<number> = new Set([
  ResourceType.Grain,
  ResourceType.Pasture,
  ResourceType.Cotton,
  ResourceType.Spices,
  ResourceType.Wine,
  ResourceType.Tea,
  ResourceType.Fish,
  ResourceType.Pearls,
  ResourceType.Whales,
  ResourceType.Oil
])

/** A cheap integer hash of a tile, for picking a picture. */
function tileHash(tile: number): number {
  let h = Math.imul(tile | 0, 0x9e3779b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  return h >>> 0
}

/** How `type` in `state` is drawn on `tile`. */
export function resourceLook(type: number, state: ResourceSpriteState, tile: number): ResourceLook {
  if (!Number.isInteger(type) || RESOURCE_CATALOG[type - 1] === undefined) {
    throw new RangeError(`no resource has id ${type}`)
  }
  const base = resourceFrameName(type, state)
  if (type === ResourceType.Timber) {
    const variant = state === 2 ? 0 : tileHash(tile) % TREE_VARIANTS
    return {
      frame: variant === 0 ? base : `${base}.v${variant}`,
      size: state === 0 ? 1.9 : state === 1 ? 1.35 : 1,
      anchorY: 0.8125, // the foot of the trunk, row 13 of 16
      shadow: state === 0 ? 1.1 : state === 1 ? 0.75 : 0.5
    }
  }
  if (ROCK_LIKE.has(type)) {
    return { frame: base, size: 1.1, anchorY: 0.85, shadow: state === 2 ? 0.5 : 0.9 }
  }
  if (FLAT.has(type)) return { frame: base, size: 1, anchorY: 0.9, shadow: 0 }
  // animals and the like (fur, horses, ivory): a shadow under the herd
  return { frame: base, size: 1, anchorY: 0.9, shadow: state === 2 ? 0 : 0.7 }
}
