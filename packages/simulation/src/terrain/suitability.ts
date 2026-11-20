/**
 * @module suitability
 * @description How good a place is to live: the score that decides where hubs (and so routes) and nation
 * capitals go. A cell scores by the biome at its centre, a river anywhere in it, and the food, timber and
 * stone within reach ({@link ../nations/access}), scaled to 0 to 1; sea and places nobody can live (deserts,
 * mountains, ice) score 0.
 */
import { BIOME_INDEX, BIOME_KEYS, type BiomeKey, type ResourceSlots } from '@sovereign/contracts'
import { buildAccessGrid } from '../nations/access'

/** How good a biome is to live in, 0 to 1. A biome under {@link MIN_DESIRABILITY} is not lived in. */
const DESIRABLE: Partial<Record<BiomeKey, number>> = {
  grassland: 1,
  woodland: 0.9,
  temperate_forest: 0.85,
  steppe: 0.7,
  tropical_forest: 0.7,
  savanna: 0.65,
  chaparral: 0.6,
  rainforest: 0.55,
  boreal_forest: 0.5,
  cold_steppe: 0.4,
  highland: 0.35,
  taiga: 0.35,
  wetland: 0.3,
  swamp: 0.25,
  temperate_desert: 0.2,
  badlands: 0.15
}

export const BIOME_DESIRABILITY: Readonly<Record<BiomeKey, number>> = Object.freeze(
  Object.fromEntries(BIOME_KEYS.map((key) => [key, DESIRABLE[key] ?? 0])) as Record<
    BiomeKey,
    number
  >
)

/** A biome scoring below this is too poor to settle. */
export const MIN_DESIRABILITY = 0.1
/** What a river in the cell adds, before scaling. */
export const SITE_RIVER_BONUS = 0.2
/** What the best resource access adds, before scaling. */
export const SITE_ACCESS_WEIGHT = 0.5

const MAX_RAW = 1 + SITE_RIVER_BONUS + SITE_ACCESS_WEIGHT

export interface SiteInput {
  width: number
  height: number
  /** The side of a cell, in tiles. */
  cell: number
  seaLevel: number
  elevation: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  resources: ResourceSlots
}

export interface SiteGrid {
  cols: number
  rows: number
  /** 0 to 1 for every cell. */
  score: Float32Array
}

const DESIRABILITY_BY_ID = new Float64Array(256)
for (const key of BIOME_KEYS) DESIRABILITY_BY_ID[BIOME_INDEX[key]] = BIOME_DESIRABILITY[key]

export function siteScoreGrid(input: SiteInput): SiteGrid {
  const { width, height, cell } = input
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const score = new Float32Array(cols * rows)
  const access = buildAccessGrid(input.resources, width, height)
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const x = Math.min(width - 1, cx * cell + (cell >> 1))
      const y = Math.min(height - 1, cy * cell + (cell >> 1))
      const centre = y * width + x
      if (input.elevation[centre] <= input.seaLevel) continue
      const desirable = DESIRABILITY_BY_ID[input.biomeIds[centre]]
      if (desirable < MIN_DESIRABILITY) continue
      let river = false
      for (let ty = cy * cell; ty < Math.min(height, (cy + 1) * cell) && !river; ty += 1) {
        for (let tx = cx * cell; tx < Math.min(width, (cx + 1) * cell); tx += 1) {
          if (input.riverMask[ty * width + tx] !== 0) {
            river = true
            break
          }
        }
      }
      const raw = desirable + (river ? SITE_RIVER_BONUS : 0) + SITE_ACCESS_WEIGHT * access.at(x, y)
      score[cy * cols + cx] = raw / MAX_RAW
    }
  }
  return { cols, rows, score }
}
