/**
 * @module nation
 * @description Plain data shapes for nations, shared by the engine and the UI.
 */

export type GovernmentType =
  | 'monarchy'
  | 'republic'
  | 'democracy'
  | 'theocracy'
  | 'empire'
  | 'tribal'
  | 'oligarchy'
  | 'dictatorship'

export interface NationPersonality {
  /** Willingness to start wars (0–1). */
  aggression: number
  /** Drive to claim unclaimed land (0–1). */
  expansionism: number
  /** Preference for diplomatic solutions (0–1). */
  diplomacy: number
  /** Investment in trade / economy (0–1). */
  mercantilism: number
  /** Tendency to build military (0–1). */
  militarism: number
}

export interface FlagPattern {
  /** Base background colour [H, S, L]. */
  background: [number, number, number]
  /** Pattern type for rendering. */
  type: 'solid' | 'horizontal_stripes' | 'vertical_stripes' | 'cross' | 'diagonal' | 'quartered'
  /** Secondary colour [H, S, L]. */
  accent: [number, number, number]
  /** Tertiary colour for some patterns [H, S, L]. */
  detail?: [number, number, number]
}

export interface NationStats {
  population: number
  military: number
  economy: number
  diplomacy: number
}

/**
 * What a nation's land is like: the measured facts its stats, government and personality follow from.
 * All of it is a pure function of the territory, so it can be measured again when the territory changes.
 */
export interface NationProfile {
  /** Tiles owned. */
  area: number
  /** Food the land yields: fertile ground, rivers, coast, grain, pasture and fisheries (in tile equivalents). */
  food: number
  /** Timber, stone and horses in the ground and forests (stock as a fraction of a full deposit, summed). */
  timber: number
  stone: number
  horses: number
  /** Iron, copper and coal, weighted by how useful each is to an army. */
  metals: number
  /** Luxuries (spices, wine, tea, ivory, gold, silver, gems, pearls...), summed like the others. */
  luxuries: number
  /** How many different resources the territory holds. */
  diversity: number
  /** Tiles on the coast (a port can be built there). */
  coast: number
  /** Tiles with a river. */
  river: number
  /** Tiles of highland, alpine and mountain ground. */
  highGround: number
  /** The value of the strategic points inside the territory (passes, fords, straits, necks). */
  defence: number
  /** How much of the route network's traffic passes through it, as a share of the busiest route. */
  traffic: number
  /** How many other nations lie within a few routes of its capital. */
  contacts: number
}

/** Read-only view of a nation as the UI and renderer see it. */
export interface NationData {
  readonly id: string
  readonly name: string
  readonly color: [number, number, number]
  readonly flag: FlagPattern
  readonly founded: number
  readonly government: GovernmentType
  readonly personality: NationPersonality
  /** The ids of the provinces it owns, in the order it claimed them. */
  readonly provinces: ReadonlySet<number>
  /** Expansion points saved up toward the next province. */
  readonly expansionPoints: number
  readonly capital: number
  readonly stats: NationStats
  /** What its land is like: the facts the stats follow from. */
  readonly profile: NationProfile
  /** Total number of owned tiles. */
  readonly totalArea: number
}
