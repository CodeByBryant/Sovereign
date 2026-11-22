/**
 * @module provinceProfile
 * @description What each province is like, measured once, so a nation's profile is the sum of the profiles
 * of its provinces and can be recomputed in a few additions whenever it gains or loses one.
 *
 * Almost every fact adds up (food, timber, stone, defence, traffic...). Diversity does not (two provinces
 * with iron have one kind of iron), so each province keeps the set of resource kinds it holds as a bit mask
 * and a nation's diversity is the size of the union.
 *
 * The facts are the same ones {@link measureProfile} measures for a list of tiles; the tests hold the two
 * to each other.
 */
import type { NationProfile, StrategicPoint, StrategicRoute } from '@sovereign/contracts'
import { NO_PROVINCE, type ProvinceMap } from '../terrain/provinces'
import { kindCount, tileFacts, type TileFactsInput } from './profile'

export interface ProvinceFactsInput extends TileFactsInput {
  provinces: ProvinceMap
  strategicPoints: readonly StrategicPoint[]
  routes: readonly StrategicRoute[]
}

/** One array per fact, indexed by province id. */
export interface ProvinceFacts {
  count: number
  area: Uint32Array
  food: Float64Array
  timber: Float64Array
  stone: Float64Array
  horses: Float64Array
  metals: Float64Array
  luxuries: Float64Array
  coast: Float64Array
  river: Float64Array
  highGround: Float64Array
  defence: Float64Array
  traffic: Float64Array
  /** One bit per resource type present (bit `type - 1`). */
  kinds: Uint32Array
}

const SUMMED = [
  'food',
  'timber',
  'stone',
  'horses',
  'metals',
  'luxuries',
  'coast',
  'river',
  'highGround',
  'defence',
  'traffic'
] as const

export function buildProvinceFacts(input: ProvinceFactsInput): ProvinceFacts {
  const { provinces, width } = input
  const count = provinces.count
  const facts: ProvinceFacts = {
    count,
    area: provinces.area,
    food: new Float64Array(count),
    timber: new Float64Array(count),
    stone: new Float64Array(count),
    horses: new Float64Array(count),
    metals: new Float64Array(count),
    luxuries: new Float64Array(count),
    coast: new Float64Array(count),
    river: new Float64Array(count),
    highGround: new Float64Array(count),
    defence: new Float64Array(count),
    traffic: new Float64Array(count),
    kinds: new Uint32Array(count)
  }

  for (let p = 0; p < count; p += 1) {
    const t = tileFacts(input, provinces.tiles.subarray(provinces.start[p], provinces.start[p + 1]))
    facts.food[p] = t.food
    facts.timber[p] = t.timber
    facts.stone[p] = t.stone
    facts.horses[p] = t.horses
    facts.metals[p] = t.metals
    facts.luxuries[p] = t.luxuries
    facts.coast[p] = t.coast
    facts.river[p] = t.river
    facts.highGround[p] = t.highGround
    facts.kinds[p] = t.kinds
  }

  for (const point of input.strategicPoints) {
    const p = provinces.provinceOf[point.y * width + point.x]
    if (p !== NO_PROVINCE) facts.defence[p] += point.value
  }

  let busiest = 0
  for (const route of input.routes) busiest = Math.max(busiest, route.traffic)
  if (busiest > 0) {
    for (const route of input.routes) {
      const points = route.path.length / 2
      if (points === 0) continue
      const share = route.traffic / points / busiest
      for (let k = 0; k < route.path.length; k += 2) {
        const p = provinces.provinceOf[route.path[k + 1] * width + route.path[k]]
        if (p !== NO_PROVINCE) facts.traffic[p] += share
      }
    }
  }
  return facts
}

/**
 * The profile of a nation that holds `provinceIds`: the facts of its provinces added in the order given
 * (claim order, so the same nation always sums the same way), the union of their resource kinds, and the
 * contacts it was given.
 */
export function combineProfile(
  facts: ProvinceFacts,
  provinceIds: Iterable<number>,
  contacts: number
): NationProfile {
  let area = 0
  let kinds = 0
  const sum = { food: 0, timber: 0, stone: 0, horses: 0, metals: 0, luxuries: 0 } as Record<
    (typeof SUMMED)[number],
    number
  >
  for (const key of SUMMED) sum[key] = 0
  for (const p of provinceIds) {
    area += facts.area[p]
    kinds |= facts.kinds[p]
    for (const key of SUMMED) sum[key] += facts[key][p]
  }
  return {
    area,
    food: sum.food,
    timber: sum.timber,
    stone: sum.stone,
    horses: sum.horses,
    metals: sum.metals,
    luxuries: sum.luxuries,
    diversity: kindCount(kinds),
    coast: sum.coast,
    river: sum.river,
    highGround: sum.highGround,
    defence: sum.defence,
    traffic: sum.traffic,
    contacts
  }
}
