/**
 * @module NationSpawner
 * @description Spawns nations on the world map, from the land up.
 *
 * Capitals go on hubs (the best places to live, joined by routes), best first, spread over the map
 * ({@link ./capitals}). Every nation then grows its starting territory over the cost of the ground, all at
 * once ({@link ./territory}), so borders follow mountains and rivers. What the territory is like is measured
 * ({@link ./profile}) and the nation's stats, government and personality follow from it
 * ({@link ./derive}): population from food, military from people, metals and defensible ground, economy
 * from resources and trade, diplomacy from neighbours. The only chance left is a small seeded jitter on
 * government and personality (stream `spawn`), so two nations on similar land are not clones.
 *
 * @example
 * ```ts
 * const { nations, ownerMap } = spawnNations({ ...terrain, count: 12, seed, minSpacing: 70, startArea: 1200, ... })
 * ```
 */
import type { RoutesConfig } from '@sovereign/config'
import {
  BIOME_INDEX,
  type ResourceSlots,
  type RouteHub,
  type StrategicPoint,
  type StrategicRoute
} from '@sovereign/contracts'
import { normalizeSeed } from '../random/seed'
import { createStream } from '../random/streams'
import { buildCostGrid } from '../terrain/cost'
import { chooseCapitals, contactCounts } from './capitals'
import { deriveGovernment, derivePersonality, deriveStats, GOVERNMENTS } from './derive'
import { ColorGenerator } from './ColorGenerator'
import { FlagGenerator } from './FlagGenerator'
import { Nation } from './Nation'
import { NameGenerator } from './NameGenerator'
import { measureProfile } from './profile'
import { growTerritories } from './territory'

/** A nation's neighbours are the other capitals within this many routes of its own. */
export const CONTACT_HOPS = 3

export interface SpawnInput {
  width: number
  height: number
  seaLevel: number
  elevation: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  riverWidth: Uint8Array
  resources: ResourceSlots
  strategicPoints: readonly StrategicPoint[]
  hubs: readonly RouteHub[]
  routes: readonly StrategicRoute[]
  /** The route settings: the movement costs the territories grow over. */
  routeConfig: RoutesConfig
  /** `biomes.highlandElevation` and `resources.features.slopeScale`, for the movement costs. */
  highlandElevation: number
  slopeScale: number
  /** How many nations to spawn (fewer if there are not enough sites). */
  count: number
  seed: string | number
  /** Minimum tile distance between capitals. */
  minSpacing: number
  /** The number of tiles each nation tries to claim. */
  startArea: number
}

export interface SpawnResult {
  nations: Nation[]
  /** Per-tile owner id. Empty string = unclaimed. */
  ownerMap: string[]
}

/** Biomes nobody settles: the ice. (Shore, mountains and the rest can be owned.) */
const UNCLAIMABLE = [BIOME_INDEX.glacier, BIOME_INDEX.polar_desert]

/** A random draw in -1 to 1 for the jitter of a government score or a personality trait. */
const draw = (rng: { float(): number }): number => rng.float() * 2 - 1

export function spawnNations(input: SpawnInput): SpawnResult {
  const { width, height } = input
  const size = width * height
  const worldSeed = normalizeSeed(input.seed)
  const rng = createStream(worldSeed, 'spawn')
  const nameGen = new NameGenerator(worldSeed)
  const colorGen = new ColorGenerator(worldSeed)
  const flagGen = new FlagGenerator(worldSeed)
  const ownerMap = new Array<string>(size).fill('')

  // ---- where nations can live ----
  const claimable = new Uint8Array(size)
  const blocked = new Uint8Array(256)
  for (const biome of UNCLAIMABLE) blocked[biome] = 1
  for (let i = 0; i < size; i += 1) {
    claimable[i] = input.elevation[i] > input.seaLevel && blocked[input.biomeIds[i]] === 0 ? 1 : 0
  }
  const hubTile = (hub: RouteHub): number => hub.y * width + hub.x
  const capitalHubs = chooseCapitals(
    input.hubs,
    input.count,
    input.minSpacing,
    (h) => claimable[hubTile(input.hubs[h] as RouteHub)] === 1
  )
  if (capitalHubs.length === 0) return { nations: [], ownerMap }

  // ---- starting territories, grown together over the cost of the ground ----
  const grid = buildCostGrid({
    width,
    height,
    seaLevel: input.seaLevel,
    elevation: input.elevation,
    biomeIds: input.biomeIds,
    riverMask: input.riverMask,
    riverWidth: input.riverWidth,
    highlandElevation: input.highlandElevation,
    slopeScale: input.slopeScale,
    cell: input.routeConfig.cell,
    config: input.routeConfig.cost
  })
  const cell = grid.cell
  // a land tile in a cell that is mostly water costs as much as a boat trip, never nothing and never closed
  const ceiling = input.routeConfig.cost.sea * 2
  const tileCost = (tile: number): number => {
    const x = tile % width
    const c = grid.cost[
      Math.floor((tile - x) / width / cell) * grid.cols + Math.floor(x / cell)
    ] as number
    return Math.min(c, ceiling)
  }
  const claimed = growTerritories({
    width,
    height,
    capitals: capitalHubs.map((h) => hubTile(input.hubs[h] as RouteHub)),
    claimable,
    tileCost,
    area: input.startArea
  })

  // ---- who is near whom, by routes ----
  const contacts = contactCounts(capitalHubs, input.routes, input.hubs.length, CONTACT_HOPS)

  // ---- the nations: land measured, then stats, government and personality follow ----
  const nations: Nation[] = []
  capitalHubs.forEach((h, k) => {
    const id = `nation-${k}`
    const tiles = claimed[k] as number[]
    for (const tile of tiles) ownerMap[tile] = id
    const profile = measureProfile({
      width,
      height,
      seaLevel: input.seaLevel,
      elevation: input.elevation,
      biomeIds: input.biomeIds,
      riverMask: input.riverMask,
      resources: input.resources,
      strategicPoints: input.strategicPoints,
      routes: input.routes,
      tiles,
      contacts: contacts[k] as number
    })
    const stats = deriveStats(profile)
    const name = nameGen.generate()
    const color = colorGen.generate()
    const flag = flagGen.generate()
    const governmentJitter = GOVERNMENTS.map(() => draw(rng))
    const government = deriveGovernment(profile, stats, governmentJitter)
    const personality = derivePersonality(profile, stats, government, [
      draw(rng),
      draw(rng),
      draw(rng),
      draw(rng),
      draw(rng)
    ])
    nations.push(
      new Nation({
        id,
        name,
        color,
        flag,
        government,
        personality,
        capital: hubTile(input.hubs[h] as RouteHub),
        provinces: new Set(tiles),
        stats,
        profile
      })
    )
  })
  return { nations, ownerMap }
}
