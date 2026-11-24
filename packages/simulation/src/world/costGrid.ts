/**
 * @module costGrid
 * @description The cost of crossing the ground on a coarse grid of cells, built from a world's terrain and
 * configuration. A pure function of them, so a world made and a world restored get the same grid. Walkers,
 * the province cut and the route network all read it.
 */
import type { WorldConfig } from '@sovereign/config'
import type { TerrainFields } from '@sovereign/contracts'
import { buildCostGrid, type CostGrid } from '../terrain/cost'

export function costGridOf(terrain: TerrainFields, config: WorldConfig): CostGrid {
  return buildCostGrid({
    width: terrain.width,
    height: terrain.height,
    seaLevel: terrain.seaLevel,
    elevation: terrain.elevation,
    biomeIds: terrain.biomeIds,
    riverMask: terrain.riverMask,
    riverWidth: terrain.riverWidth,
    highlandElevation: config.biomes.highlandElevation,
    slopeScale: config.resources.features.slopeScale,
    cell: config.routes.cell,
    config: config.routes.cost
  })
}
