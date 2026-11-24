/**
 * @module Nation
 * @description Core nation entity for the Sovereign world simulation.
 *
 * Each nation owns a set of provinces (ids into the province map, in the order they were claimed), has
 * stats for military/economy/population/diplomacy, personality traits that drive AI behaviour, and visual
 * identity (color, flag pattern).
 */
import type {
  FlagPattern,
  GovernmentType,
  NationData,
  NationPersonality,
  NationProfile,
  NationStats
} from '@sovereign/contracts'

/* ------------------------------------------------------------------ */
/*  Nation class                                                        */
/* ------------------------------------------------------------------ */

/**
 * Represents a single nation on the world map.
 *
 * The `capital` is the tile from which the nation originated; its province is the first one claimed.
 */
export class Nation implements NationData {
  readonly id: string
  readonly name: string
  /** Display colour as [R, G, B] in 0–255. */
  readonly color: [number, number, number]
  readonly flag: FlagPattern
  readonly founded: number
  readonly government: GovernmentType
  readonly personality: NationPersonality

  /** The ids of the provinces this nation owns, in the order it claimed them (a `Set` keeps that order). */
  provinces: Set<number>
  /** Flat tile index of the capital. */
  capital: number
  stats: NationStats
  /** What the territory is like; stats, government and personality were derived from it. */
  profile: NationProfile
  /** Expansion points saved up toward the next province (see the expansion system). */
  expansionPoints: number

  constructor(opts: {
    id: string
    name: string
    color: [number, number, number]
    flag: FlagPattern
    government: GovernmentType
    personality: NationPersonality
    capital: number
    provinces?: Set<number>
    stats?: Partial<NationStats>
    profile: NationProfile
    expansionPoints?: number
    founded?: number
  }) {
    this.id = opts.id
    this.name = opts.name
    this.color = opts.color
    this.flag = opts.flag
    this.government = opts.government
    this.personality = opts.personality
    this.capital = opts.capital
    this.provinces = opts.provinces ?? new Set<number>()
    this.founded = opts.founded ?? 0
    this.profile = opts.profile
    this.expansionPoints = opts.expansionPoints ?? 0
    this.stats = {
      population: opts.stats?.population ?? 100,
      military: opts.stats?.military ?? 100,
      economy: opts.stats?.economy ?? 50,
      diplomacy: opts.stats?.diplomacy ?? 50
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Province management                                              */
  /* ---------------------------------------------------------------- */

  /** Claim a province. */
  addProvince(province: number): void {
    this.provinces.add(province)
  }

  /** Release a province. */
  removeProvince(province: number): void {
    this.provinces.delete(province)
  }

  /** Total number of owned tiles (the profile counts them). */
  get totalArea(): number {
    return this.profile.area
  }
}
