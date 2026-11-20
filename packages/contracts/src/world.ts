/**
 * @module world
 * @description What a host (UI, CLI) may read of a simulated world: plain, JSON-safe data with no
 * references into the engine's state. Bulk tile layers are read through `TerrainFields` instead.
 */
import type { FlagPattern, GovernmentType, NationPersonality, NationStats } from './nation'

export interface NationSnapshot {
  id: string
  name: string
  /** Display colour as [R, G, B], 0-255. */
  color: [number, number, number]
  flag: FlagPattern
  government: GovernmentType
  personality: NationPersonality
  /** Flat tile index of the capital. */
  capital: number
  stats: NationStats
  /** Number of tiles the nation owns. */
  area: number
}

export interface WorldSnapshot {
  /** The engine seed (a uint32). */
  seed: number
  tick: number
  /** In-game time: `tick * timestep`. */
  time: number
  width: number
  height: number
  seaLevel: number
  nations: NationSnapshot[]
}
