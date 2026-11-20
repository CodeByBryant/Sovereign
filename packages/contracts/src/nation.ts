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

/** Read-only view of a nation as the UI and renderer see it. */
export interface NationData {
  readonly id: string
  readonly name: string
  readonly color: [number, number, number]
  readonly flag: FlagPattern
  readonly founded: number
  readonly government: GovernmentType
  readonly personality: NationPersonality
  readonly provinces: ReadonlySet<number>
  readonly capital: number
  readonly stats: NationStats
  /** Total number of owned tiles. */
  readonly totalArea: number
}
