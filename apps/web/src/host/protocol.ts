/**
 * @module protocol
 * @description The messages between the app and the world worker. Plain data, so they are
 * structured-cloneable; the big buffers travel as transferables.
 */
import type { WorldConfigOverrides } from '@sovereign/config'
import type {
  NationSnapshot,
  ResourceSlots,
  StrategicPoint,
  WorldSnapshot
} from '@sovereign/contracts'
import type { LayerName } from '@sovereign/renderer'

/** How a `run` request wants its answer. */
export interface RunOptions {
  /** Also send the political overlay if provinces changed hands (set while that view is on screen). */
  political?: boolean
  /** Send whatever was held back by the update throttle now (the player paused, or changed view). */
  flush?: boolean
}

export type WorldRequest =
  | { type: 'create'; seed: number | string; config?: WorldConfigOverrides }
  | { type: 'hash' }
  | ({ type: 'run'; ticks: number } & RunOptions)

/** The tile layers the inspector reads, as copies (the worker keeps its own world). */
export interface WorldFields {
  elevation: Float32Array
  temperature: Float32Array
  humidity: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  /** The two resource slots (type, richness and stock) as copies. */
  resources: ResourceSlots
  /** One byte per tile: the owning nation's index, or 255. */
  ownership: Uint8Array
}

/** A freshly generated world, ready to display. */
export interface WorldReady {
  type: 'ready'
  snapshot: WorldSnapshot
  strategicPoints: StrategicPoint[]
  /** Every overlay as RGBA pixels, `width * height * 4` bytes. */
  layers: Record<LayerName, Uint8ClampedArray>
  fields: WorldFields
}

/** The world after some ticks. */
export interface WorldTicked {
  type: 'ticked'
  tick: number
  /** In-game time in days. */
  time: number
  /** Provinces that changed hands in this run. */
  claims: number
  /** True when no nation has a free province left: the borders will not move again. */
  saturated: boolean
  /** The nations as they are now (their stats and areas change as they grow). */
  nations: NationSnapshot[]
  /** The ownership layer, when provinces changed hands since the app last had it (and the throttle allows). */
  ownership?: Uint8Array
  /** The political overlay as RGBA pixels, when it was asked for and is out of date. */
  political?: Uint8ClampedArray
}

export type WorldResponse =
  WorldReady | WorldTicked | { type: 'hash'; hash: string } | { type: 'error'; message: string }
