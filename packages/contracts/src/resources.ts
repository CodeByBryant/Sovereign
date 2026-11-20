/**
 * @module types/resources
 * @description Resource type definitions for the Sovereign world.
 *
 * Resources are stored as compact `Uint8Array` layers (one byte per tile)
 * to keep memory usage low across 4M+ tiles.
 */

/** Numeric resource type IDs — fits in a single byte (Uint8Array). */
export enum ResourceType {
  None = 0,
  Timber = 1,
  Stone = 2,
  Iron = 3,
  Gold = 4,
  Fertile = 5,
  Fish = 6,
  Fur = 7
}

/** Human-readable metadata for each resource type. */
export const RESOURCE_META: Record<
  ResourceType,
  { label: string; icon: string; color: [number, number, number] }
> = {
  [ResourceType.None]: { label: 'None', icon: '', color: [0, 0, 0] },
  [ResourceType.Timber]: { label: 'Timber', icon: '🌲', color: [34, 120, 50] },
  [ResourceType.Stone]: { label: 'Stone', icon: '🪨', color: [140, 130, 120] },
  [ResourceType.Iron]: { label: 'Iron', icon: '⛏', color: [160, 100, 80] },
  [ResourceType.Gold]: { label: 'Gold', icon: '✦', color: [212, 175, 55] },
  [ResourceType.Fertile]: { label: 'Fertile Soil', icon: '🌾', color: [140, 180, 60] },
  [ResourceType.Fish]: { label: 'Fish', icon: '🐟', color: [60, 140, 200] },
  [ResourceType.Fur]: { label: 'Fur & Game', icon: '🦌', color: [130, 90, 60] }
}
