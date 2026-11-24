/**
 * @module profile
 * @description What a nation's land is like, measured: the facts its stats, government and personality
 * follow from ({@link ./derive}). A pure function of the territory (the tiles it owns) and the terrain, so
 * it can be measured again whenever the territory or its stocks change. Resource amounts are the *stock*
 * left, as a fraction of a full deposit, so a mined-out seam stops counting.
 */
import {
  BIOME_INDEX,
  BIOME_KEYS,
  ResourceType,
  resourceDef,
  type NationProfile,
  type ResourceSlots,
  type StrategicPoint,
  type StrategicRoute
} from '@sovereign/contracts'
import { BIOME_DESIRABILITY } from '../terrain/suitability'

/** Extra food a river gives a tile, a coast gives it, and what grain, pasture and fish add per full deposit. */
export const FOOD_RIVER = 0.3
export const FOOD_COAST = 0.15
export const FOOD_GRAIN = 1
export const FOOD_PASTURE = 0.7
export const FOOD_FISH = 0.6

/** How much each metal is worth to an army, per full deposit. */
export const METAL_WEIGHT: Readonly<Record<number, number>> = {
  [ResourceType.Iron]: 1,
  [ResourceType.Copper]: 0.8,
  [ResourceType.Coal]: 0.6
}

const FERTILITY = new Float64Array(256)
for (const key of BIOME_KEYS) FERTILITY[BIOME_INDEX[key]] = BIOME_DESIRABILITY[key]

/** What the per-tile facts need of the terrain. */
export interface TileFactsInput {
  width: number
  height: number
  seaLevel: number
  elevation: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  resources: ResourceSlots
}

/** The facts that add up tile by tile. `kinds` has one bit per resource type present (bit `type - 1`). */
export interface TileFacts {
  food: number
  timber: number
  stone: number
  horses: number
  metals: number
  luxuries: number
  coast: number
  river: number
  highGround: number
  kinds: number
}

/** How many different resource types a `kinds` mask holds. */
export function kindCount(kinds: number): number {
  let n = 0
  for (let k = kinds >>> 0; k !== 0; k &= k - 1) n += 1
  return n
}

/** Measure the facts that are sums over tiles: food, materials, luxuries, coast, rivers, high ground. */
export function tileFacts(input: TileFactsInput, tiles: Iterable<number>): TileFacts {
  const { width, height, seaLevel, elevation, resources } = input
  const isWater = (tile: number): boolean => elevation[tile] <= seaLevel

  let food = 0
  let timber = 0
  let stone = 0
  let horses = 0
  let metals = 0
  let luxuries = 0
  let coast = 0
  let river = 0
  let highGround = 0
  let kinds = 0

  for (const tile of tiles) {
    const biome = input.biomeIds[tile]
    food += FERTILITY[biome]
    if (input.riverMask[tile] !== 0) {
      river += 1
      food += FOOD_RIVER
    }
    if (
      biome === BIOME_INDEX.highland ||
      biome === BIOME_INDEX.alpine ||
      biome === BIOME_INDEX.mountain
    ) {
      highGround += 1
    }

    const x = tile % width
    const y = (tile - x) / width
    let beside = 0
    let wet = false
    for (const n of [
      x > 0 ? tile - 1 : -1,
      x < width - 1 ? tile + 1 : -1,
      y > 0 ? tile - width : -1,
      y < height - 1 ? tile + width : -1
    ]) {
      if (n < 0 || !isWater(n)) continue
      wet = true
      if (resources.surface.type[n] === ResourceType.Fish) {
        beside = Math.max(beside, resources.surface.stock[n] / 255)
      }
    }
    if (wet) {
      coast += 1
      food += FOOD_COAST + FOOD_FISH * beside
    }

    for (const layer of ['surface', 'ground'] as const) {
      const slot = resources[layer]
      const type = slot.type[tile]
      if (type === 0) continue
      kinds |= 1 << (type - 1)
      const left = slot.stock[tile] / 255
      if (type === ResourceType.Grain) food += FOOD_GRAIN * left
      else if (type === ResourceType.Pasture) food += FOOD_PASTURE * left
      else if (type === ResourceType.Timber) timber += left
      else if (type === ResourceType.Stone) stone += left
      else if (type === ResourceType.Horses) horses += left
      const metal = METAL_WEIGHT[type]
      if (metal !== undefined) metals += metal * left
      if (resourceDef(type)?.tier === 'luxury') luxuries += left
    }
  }
  return { food, timber, stone, horses, metals, luxuries, coast, river, highGround, kinds }
}

export interface ProfileInput extends TileFactsInput {
  strategicPoints: readonly StrategicPoint[]
  routes: readonly StrategicRoute[]
  /** The tiles the nation owns. */
  tiles: readonly number[]
  /** How many other nations lie within a few routes of its capital (measured by the caller). */
  contacts: number
}

/** The profile of a territory, measured from its tiles; see {@link combineProfile} for the same from provinces. */
export function measureProfile(input: ProfileInput): NationProfile {
  const { width } = input
  const owned = new Set<number>(input.tiles)
  const facts = tileFacts(input, input.tiles)

  let defence = 0
  for (const point of input.strategicPoints) {
    if (owned.has(point.y * width + point.x)) defence += point.value
  }

  let busiest = 0
  for (const route of input.routes) busiest = Math.max(busiest, route.traffic)
  let traffic = 0
  if (busiest > 0) {
    for (const route of input.routes) {
      const points = route.path.length / 2
      if (points === 0) continue
      let inside = 0
      for (let k = 0; k < route.path.length; k += 2) {
        if (owned.has(route.path[k + 1] * width + route.path[k])) inside += 1
      }
      traffic += (route.traffic * (inside / points)) / busiest
    }
  }

  return {
    area: input.tiles.length,
    food: facts.food,
    timber: facts.timber,
    stone: facts.stone,
    horses: facts.horses,
    metals: facts.metals,
    luxuries: facts.luxuries,
    diversity: kindCount(facts.kinds),
    coast: facts.coast,
    river: facts.river,
    highGround: facts.highGround,
    defence,
    traffic,
    contacts: input.contacts
  }
}
