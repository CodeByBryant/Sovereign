/**
 * @module protocol
 * @description The messages between the app and the world worker. Plain data, so they are
 * structured-cloneable; the big buffers travel as transferables.
 */
import type { WorldConfigOverrides } from '@sovereign/config'
import type { StrategicPoint, WorldSnapshot } from '@sovereign/contracts'
import type { LayerName } from '@sovereign/renderer'

export type WorldRequest =
  { type: 'create'; seed: number | string; config?: WorldConfigOverrides } | { type: 'hash' }

/** The tile layers the inspector reads, as copies (the worker keeps its own world). */
export interface WorldFields {
  elevation: Float32Array
  temperature: Float32Array
  humidity: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  resourceType: Uint8Array
  resourceDensity: Uint8Array
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

export type WorldResponse =
  WorldReady | { type: 'hash'; hash: string } | { type: 'error'; message: string }
