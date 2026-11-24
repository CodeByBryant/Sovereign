/**
 * @module ExpansionSystem
 * @description Nations grow into free provinces. Every tick each nation earns expansion points (more with a
 * high expansionism and a big population) and, while it holds enough, buys the free province on its border
 * that is the best value for the effort: what the land gives, per point of price (the price is the area of
 * the province times how hard it is to cross). Provinces that are mostly ice are never taken.
 *
 * There is no chance in it: ties go to the lower province id, and the nations are served in a rotating
 * order (starting at the nation whose index is the tick, modulo the number of nations) so that when two can
 * afford the same province, the one that gets it alternates. Nobody fights yet, so once every province a
 * nation can reach is taken, nothing changes any more: the borders are stable (`saturated`).
 *
 * A claim keeps three things in step: the nation's province list (in claim order), the owner of each
 * province and of each tile (the ownership layer), and the nation's profile and stats, which are re-summed
 * from its provinces and re-derived. The system's borders ("frontiers") are derived from the land held, so
 * they are rebuilt when a world is created or restored; they are not saved.
 */
import type { ExpansionConfig } from '@sovereign/config'
import { deriveStats } from '../nations/derive'
import type { Nation } from '../nations/Nation'
import { combineProfile, type ProvinceFacts } from '../nations/provinceProfile'
import type { ProvinceMap } from '../terrain/provinces'

/** The owner byte of a province or a tile that nobody holds. */
const NOBODY = 255

export interface ExpansionState {
  nations: readonly Nation[]
  provinces: ProvinceMap
  facts: ProvinceFacts
  /** 1 for a province that can be owned, 0 for one that cannot (ice). */
  claimable: Uint8Array
  /** The index of the nation that holds each province, or 255. Kept up to date by the system. */
  provinceOwner: Uint8Array
  /** The index of the nation that holds each tile, or 255. Kept up to date by the system. */
  ownership: Uint8Array
  config: ExpansionConfig
  /** In-game days per tick. */
  timestep: number
}

/** The order the nations are served in at `tick`: from the nation whose index is `tick` (mod count), around. */
export function processingOrder(tick: number, count: number): number[] {
  const order: number[] = []
  if (count === 0) return order
  const start = tick % count
  for (let k = 0; k < count; k += 1) order.push((start + k) % count)
  return order
}

/** Expansion points a nation earns in one tick. */
export function expansionRate(
  nation: Pick<Nation, 'personality' | 'stats'>,
  config: ExpansionConfig,
  timestep: number
): number {
  return (
    config.rate *
    (0.5 + nation.personality.expansionism) *
    Math.sqrt(nation.stats.population / 100) *
    timestep
  )
}

/** What a province costs, in expansion points: its area, times how hard it is to cross. */
export function claimCost(map: ProvinceMap, province: number, config: ExpansionConfig): number {
  return config.costPerTile * map.area[province] * map.meanCost[province]
}

/** What a province is worth to whoever holds it: what its land gives. Never zero, so barren land still counts. */
export function provinceValue(facts: ProvinceFacts, province: number): number {
  return (
    1 +
    facts.food[province] +
    facts.timber[province] +
    facts.stone[province] +
    2 * facts.horses[province] +
    2 * facts.metals[province] +
    2 * facts.luxuries[province] +
    facts.defence[province]
  )
}

export class ExpansionSystem {
  private readonly state: ExpansionState
  /** The free, claimable provinces beside each nation's land. */
  private readonly borders: Array<Set<number>>
  /** How many provinces have been claimed since this system was made. */
  claims = 0

  constructor(state: ExpansionState) {
    this.state = state
    this.borders = state.nations.map(() => new Set<number>())
    state.nations.forEach((nation, index) => {
      for (const province of nation.provinces) this.addNeighbours(index, province)
    })
  }

  /** True when no nation has a free province left beside its land: nothing will ever change again. */
  get saturated(): boolean {
    return this.borders.every((border) => border.size === 0)
  }

  /** The free provinces beside a nation's land, by id. */
  frontier(nation: number): number[] {
    return [...(this.borders[nation] as Set<number>)].sort((a, b) => a - b)
  }

  step(tick: number): void {
    for (const index of processingOrder(tick, this.state.nations.length)) {
      const nation = this.state.nations[index] as Nation
      nation.expansionPoints += expansionRate(nation, this.state.config, this.state.timestep)
      for (;;) {
        const best = this.best(index)
        if (best < 0) {
          nation.expansionPoints = 0 // nothing to buy: it does not save up
          break
        }
        const cost = claimCost(this.state.provinces, best, this.state.config)
        if (nation.expansionPoints < cost) break
        nation.expansionPoints -= cost
        this.claim(index, best)
      }
    }
  }

  /** The province on a nation's border that is the best value for its price (ties to the lower id); -1 for none. */
  private best(nation: number): number {
    let best = -1
    let bestScore = -Infinity
    for (const province of this.borders[nation] as Set<number>) {
      const score =
        provinceValue(this.state.facts, province) /
        claimCost(this.state.provinces, province, this.state.config)
      if (score > bestScore || (score === bestScore && province < best)) {
        best = province
        bestScore = score
      }
    }
    return best
  }

  private claim(index: number, province: number): void {
    const { nations, provinces, facts, provinceOwner, ownership } = this.state
    const nation = nations[index] as Nation
    nation.addProvince(province)
    provinceOwner[province] = index
    for (let k = provinces.start[province]; k < provinces.start[province + 1]; k += 1) {
      ownership[provinces.tiles[k]] = index
    }
    nation.profile = combineProfile(facts, nation.provinces, nation.profile.contacts)
    nation.stats = deriveStats(nation.profile)
    for (const border of this.borders) border.delete(province)
    this.addNeighbours(index, province)
    this.claims += 1
  }

  /** Put the free, claimable neighbours of a province on a nation's border. */
  private addNeighbours(nation: number, province: number): void {
    const { provinces, claimable, provinceOwner } = this.state
    for (
      let k = provinces.neighbourStart[province];
      k < provinces.neighbourStart[province + 1];
      k += 1
    ) {
      const next = provinces.neighbourId[k]
      if (claimable[next] === 1 && provinceOwner[next] === NOBODY) {
        ;(this.borders[nation] as Set<number>).add(next)
      }
    }
  }
}
