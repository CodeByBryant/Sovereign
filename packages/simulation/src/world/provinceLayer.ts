/**
 * @module provinceLayer
 * @description The provinces of a world and what each is like. Derived, never saved: it is a pure function
 * of the terrain and the configuration, so `World.create` and `World.restore` both rebuild it and get the
 * same layer on every engine.
 */
import type { WorldConfig } from '@sovereign/config'
import type { TerrainFields } from '@sovereign/contracts'
import { fullStockTable } from '../nations/profile'
import { buildProvinceFacts, type ProvinceFacts } from '../nations/provinceProfile'
import type { CostGrid } from '../terrain/cost'
import { buildProvinces, tileCosts, type ProvinceMap } from '../terrain/provinces'
import { costGridOf } from './costGrid'

export interface ProvinceLayer {
  /** The cut: which province each tile is in, their tiles, areas and neighbours. */
  map: ProvinceMap
  /** What each province is like, to add up into a nation's profile. */
  facts: ProvinceFacts
}

export function buildProvinceLayer(
  terrain: TerrainFields,
  config: WorldConfig,
  grid: CostGrid = costGridOf(terrain, config)
): ProvinceLayer {
  const { width, height } = terrain
  const land = new Uint8Array(width * height)
  for (let i = 0; i < land.length; i += 1) land[i] = terrain.elevation[i] > terrain.seaLevel ? 1 : 0
  const map = buildProvinces({
    width,
    height,
    land,
    cost: tileCosts(grid, width, height, config.provinces.costCap),
    spacing: config.provinces.spacing,
    minArea: config.provinces.minArea
  })
  const facts = buildProvinceFacts({
    width,
    height,
    seaLevel: terrain.seaLevel,
    elevation: terrain.elevation,
    biomeIds: terrain.biomeIds,
    riverMask: terrain.riverMask,
    resources: terrain.resources,
    fullStock: fullStockTable(config.resources.rules),
    provinces: map,
    strategicPoints: terrain.strategicPoints,
    routes: terrain.routes
  })
  return { map, facts }
}
