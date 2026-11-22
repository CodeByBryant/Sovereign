/**
 * @module NationSpawner
 * @description Spawns nations on the world map, from the land up.
 *
 * Capitals go on hubs (the best places to live, joined by routes), best first, spread over the map
 * ({@link ./capitals}). Every nation then grows its starting territory over the graph of provinces, all at
 * once ({@link ./territory}), so borders follow mountains and rivers. What the territory is like is the sum
 * of what its provinces are like ({@link ./provinceProfile}) and the nation's stats, government and
 * personality follow from it
 * ({@link ./derive}): population from food, military from people, metals and defensible ground, economy
 * from resources and trade, diplomacy from neighbours. The only chance left is a small seeded jitter on
 * government and personality (stream `spawn`), so two nations on similar land are not clones.
 *
 * @example
 * ```ts
 * const { nations } = spawnNations({ ...terrain, provinces: layer, count: 12, seed, minSpacing: 70, startArea: 1200 })
 * ```
 */
import { BIOME_INDEX, type RouteHub, type StrategicRoute } from '@sovereign/contracts'
import { normalizeSeed } from '../random/seed'
import { createStream } from '../random/streams'
import { NO_PROVINCE } from '../terrain/provinces'
import type { ProvinceLayer } from '../world/provinceLayer'
import { chooseCapitals, contactCounts } from './capitals'
import { deriveGovernment, derivePersonality, deriveStats, GOVERNMENTS } from './derive'
import { ColorGenerator } from './ColorGenerator'
import { FlagGenerator } from './FlagGenerator'
import { Nation } from './Nation'
import { NameGenerator } from './NameGenerator'
import { combineProfile } from './provinceProfile'
import { growTerritories } from './territory'

/** A nation's neighbours are the other capitals within this many routes of its own. */
export const CONTACT_HOPS = 3

export interface SpawnInput {
  width: number
  biomeIds: Uint8Array
  hubs: readonly RouteHub[]
  routes: readonly StrategicRoute[]
  /** The provinces, and what each is like. */
  provinces: ProvinceLayer
  /** How many nations to spawn (fewer if there are not enough sites). */
  count: number
  seed: string | number
  /** Minimum tile distance between capitals. */
  minSpacing: number
  /** The number of tiles each nation tries to claim, in whole provinces. */
  startArea: number
}

export interface SpawnResult {
  nations: Nation[]
}

/** Biomes nobody settles: the ice. (Shore, mountains and the rest can be owned.) */
const UNCLAIMABLE = [BIOME_INDEX.glacier, BIOME_INDEX.polar_desert]

/** A random draw in -1 to 1 for the jitter of a government score or a personality trait. */
const draw = (rng: { float(): number }): number => rng.float() * 2 - 1

export function spawnNations(input: SpawnInput): SpawnResult {
  const { width } = input
  const { map, facts } = input.provinces
  const worldSeed = normalizeSeed(input.seed)
  const rng = createStream(worldSeed, 'spawn')
  const nameGen = new NameGenerator(worldSeed)
  const colorGen = new ColorGenerator(worldSeed)
  const flagGen = new FlagGenerator(worldSeed)

  // ---- where nations can live: provinces that are not mostly ice ----
  const blocked = new Uint8Array(256)
  for (const biome of UNCLAIMABLE) blocked[biome] = 1
  const claimable = new Uint8Array(map.count)
  for (let p = 0; p < map.count; p += 1) {
    let ice = 0
    for (let k = map.start[p]; k < map.start[p + 1]; k += 1)
      ice += blocked[input.biomeIds[map.tiles[k]]]
    claimable[p] = ice * 2 <= map.area[p] ? 1 : 0
  }
  const hubTile = (hub: RouteHub): number => hub.y * width + hub.x
  const provinceOfHub = (h: number): number => map.provinceOf[hubTile(input.hubs[h] as RouteHub)]
  const chosen = chooseCapitals(
    input.hubs,
    input.count,
    input.minSpacing,
    (h) => provinceOfHub(h) !== NO_PROVINCE && claimable[provinceOfHub(h)] === 1
  )
  // two capitals in one province would share it: the better hub keeps it
  const taken = new Set<number>()
  const capitalHubs = chosen.filter((h) => {
    const province = provinceOfHub(h)
    if (taken.has(province)) return false
    taken.add(province)
    return true
  })
  if (capitalHubs.length === 0) return { nations: [] }

  // ---- starting territories, grown together over the graph of provinces ----
  const claimed = growTerritories({
    provinces: map,
    capitals: capitalHubs.map(provinceOfHub),
    claimable,
    area: input.startArea
  })

  // ---- who is near whom, by routes ----
  const contacts = contactCounts(capitalHubs, input.routes, input.hubs.length, CONTACT_HOPS)

  // ---- the nations: the land added up, then stats, government and personality follow ----
  const nations: Nation[] = []
  capitalHubs.forEach((h, k) => {
    const provinces = claimed[k] as number[]
    const profile = combineProfile(facts, provinces, contacts[k] as number)
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
        id: `nation-${k}`,
        name,
        color,
        flag,
        government,
        personality,
        capital: hubTile(input.hubs[h] as RouteHub),
        provinces: new Set(provinces),
        stats,
        profile
      })
    )
  })
  return { nations }
}
