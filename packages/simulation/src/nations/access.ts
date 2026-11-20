/**
 * @module access
 * @description How well a place can feed and build a nation: the food, timber and stone within reach.
 * The spawner prefers starts with some of each, so nobody begins on barren ground; it is a preference,
 * not a guarantee, and a rich desert still loses to a poor meadow only by a margin.
 *
 * The resource slots are counted per small cell once, so asking about a tile is a sum over a few
 * dozen cells instead of a scan of hundreds of tiles.
 */
import { ResourceType, type ResourceSlots } from '@sovereign/contracts'

/** The side of a counting cell, in tiles. */
export const ACCESS_CELL = 4
/** How many cells away (each direction) a place can draw on: about 12 tiles. */
export const ACCESS_RADIUS_CELLS = 3

/** Tiles of food (grain, pasture, fish) within reach that count as plenty. */
const FOOD_FULL = 20
/** Tiles of timber within reach that count as plenty. */
const TIMBER_FULL = 20
/** Tiles of stone within reach that count as plenty. */
const STONE_FULL = 8

/** Food matters most (people starve); timber and stone share the rest. */
const FOOD_WEIGHT = 0.5
const TIMBER_WEIGHT = 0.25
const STONE_WEIGHT = 0.25

export interface AccessGrid {
  /** 0 to 1: how much food, timber and stone is within reach of the tile (x, y). */
  at(x: number, y: number): number
}

export function buildAccessGrid(
  resources: ResourceSlots,
  width: number,
  height: number
): AccessGrid {
  const cols = Math.ceil(width / ACCESS_CELL)
  const rows = Math.ceil(height / ACCESS_CELL)
  const food = new Uint16Array(cols * rows)
  const timber = new Uint16Array(cols * rows)
  const stone = new Uint16Array(cols * rows)
  const { surface, ground } = resources

  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.floor(y / ACCESS_CELL) * cols
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const cell = rowBase + Math.floor(x / ACCESS_CELL)
      const s = surface.type[i]
      if (s === ResourceType.Grain || s === ResourceType.Pasture || s === ResourceType.Fish) {
        food[cell] += 1
      } else if (s === ResourceType.Timber) {
        timber[cell] += 1
      }
      if (ground.type[i] === ResourceType.Stone) stone[cell] += 1
    }
  }

  return {
    at(x: number, y: number): number {
      const cx = Math.floor(x / ACCESS_CELL)
      const cy = Math.floor(y / ACCESS_CELL)
      let f = 0
      let t = 0
      let s = 0
      for (
        let row = Math.max(0, cy - ACCESS_RADIUS_CELLS);
        row <= Math.min(rows - 1, cy + ACCESS_RADIUS_CELLS);
        row += 1
      ) {
        for (
          let col = Math.max(0, cx - ACCESS_RADIUS_CELLS);
          col <= Math.min(cols - 1, cx + ACCESS_RADIUS_CELLS);
          col += 1
        ) {
          const cell = row * cols + col
          f += food[cell] as number
          t += timber[cell] as number
          s += stone[cell] as number
        }
      }
      return (
        FOOD_WEIGHT * Math.min(1, f / FOOD_FULL) +
        TIMBER_WEIGHT * Math.min(1, t / TIMBER_FULL) +
        STONE_WEIGHT * Math.min(1, s / STONE_FULL)
      )
    }
  }
}
