/**
 * @module layers
 * @description The map overlays. Defined in the pure entry point so that anything that names or
 * produces overlays (a worker, a host) does not have to load the WebGL renderer.
 */
export const LAYER_NAMES = [
  'elevation',
  'temperature',
  'humidity',
  'biome',
  'strategic',
  'resource',
  'political'
] as const

export type LayerName = (typeof LAYER_NAMES)[number]
