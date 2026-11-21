/**
 * @module cost
 * @description What it costs to cross the ground, on a coarse grid of cells. The cheapest paths over this
 * grid are the routes between places ({@link ./routes}), so this decides where roads, passes, fords and
 * sea lanes go.
 *
 * A cell is land when at least half its tiles are land. Its cost is the base cost plus the mean extra cost of
 * its land tiles (biome, steepness, height) plus the widest river in it, so a ford is found where a river is
 * narrow. Water costs the sea cost within `seaReach` cells of land and cannot be crossed farther out, so
 * sea lanes exist only along coasts and across straits, never across an ocean.
 *
 * Only `+ - * /` and exact functions: the same inputs give the same grid on every engine.
 */
import type { RouteCostConfig } from '@sovereign/config'
import { BIOME_KEYS } from '@sovereign/contracts'
import { slopeField } from './features'

export interface CostInput {
  width: number
  height: number
  seaLevel: number
  elevation: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  riverWidth: Uint8Array
  /** The elevation above which ground counts as high (`biomes.highlandElevation`). */
  highlandElevation: number
  /** The slope that counts as fully steep (`resources.features.slopeScale`). */
  slopeScale: number
  /** The side of one cell, in tiles. */
  cell: number
  config: RouteCostConfig
}

export interface CostGrid {
  cell: number
  cols: number
  rows: number
  /** The cost of a step into each cell; `Infinity` where nothing can pass. */
  cost: Float32Array
  /** 1 for a land cell, 0 for water. */
  land: Uint8Array
}

/** A slope this many times `slopeScale` is as costly as it gets. */
const SLOPE_CAP = 2

export function buildCostGrid(input: CostInput): CostGrid {
  const { width, height, cell, config } = input
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const cells = cols * rows

  const biomeCost = new Float64Array(256)
  BIOME_KEYS.forEach((key, id) => {
    biomeCost[id] = config.biomes[key]
  })

  const slope = slopeField(input.elevation, width, height)
  const landTiles = new Uint32Array(cells)
  const totalTiles = new Uint32Array(cells)
  const extra = new Float64Array(cells)
  const widest = new Uint8Array(cells)
  const highSpan = 1 - input.highlandElevation

  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.floor(y / cell) * cols
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const c = rowBase + Math.floor(x / cell)
      totalTiles[c] += 1
      if (input.elevation[i] <= input.seaLevel) continue
      landTiles[c] += 1
      const steep = Math.min(SLOPE_CAP, slope[i] / input.slopeScale)
      const high =
        highSpan > 0 ? Math.max(0, (input.elevation[i] - input.highlandElevation) / highSpan) : 0
      extra[c] += biomeCost[input.biomeIds[i]] + config.slope * steep + config.height * high
      if (input.riverMask[i] !== 0 && input.riverWidth[i] > widest[c])
        widest[c] = input.riverWidth[i]
    }
  }

  const land = new Uint8Array(cells)
  const cost = new Float32Array(cells)
  for (let c = 0; c < cells; c += 1) {
    if (landTiles[c] * 2 >= totalTiles[c] && landTiles[c] > 0) {
      land[c] = 1
      cost[c] = config.base + extra[c] / landTiles[c] + config.river * widest[c]
    }
  }

  // Water within reach of land (in steps over cells) is a sea lane; farther out it is closed.
  const reach = new Int32Array(cells).fill(-1)
  const queue = new Int32Array(cells)
  let head = 0
  let tail = 0
  for (let c = 0; c < cells; c += 1) {
    if (land[c] === 1) {
      reach[c] = 0
      queue[tail] = c
      tail += 1
    }
  }
  while (head < tail) {
    const c = queue[head]
    head += 1
    if (reach[c] >= config.seaReach) continue
    const cx = c % cols
    const cy = (c - cx) / cols
    const next = [
      cx > 0 ? c - 1 : -1,
      cx < cols - 1 ? c + 1 : -1,
      cy > 0 ? c - cols : -1,
      cy < rows - 1 ? c + cols : -1
    ]
    for (const n of next) {
      if (n >= 0 && reach[n] === -1) {
        reach[n] = reach[c] + 1
        queue[tail] = n
        tail += 1
      }
    }
  }
  for (let c = 0; c < cells; c += 1) {
    if (land[c] === 0) cost[c] = reach[c] >= 0 ? config.sea : Infinity
  }

  return { cell, cols, rows, cost, land }
}
