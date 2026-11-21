import type { ResourceSlots, StrategicPoint } from '@sovereign/contracts'

/** A deterministic, RNG-free set of fields that exercises every colour branch and every edge. */
export interface SyntheticFields {
  width: number
  height: number
  seaLevel: number
  elevation: Float32Array
  temperature: Float32Array
  humidity: Float32Array
  biomeIds: Uint8Array
  riverWidth: Uint8Array
  resources: ResourceSlots
  strategicPoints: StrategicPoint[]
}

/** The catalogue ids that live in each slot (a copy of the catalogue's layers, so a test fixture needs no engine). */
const SURFACE_IDS = [1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 22]
const GROUND_IDS = [2, 3, 4, 15, 16, 17, 18, 19, 20]

export function syntheticFields(width = 64, height = 40): SyntheticFields {
  const n = width * height
  const elevation = new Float32Array(n)
  const temperature = new Float32Array(n)
  const humidity = new Float32Array(n)
  const biomeIds = new Uint8Array(n)
  const riverWidth = new Uint8Array(n)
  const slot = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(n),
    richness: new Uint8Array(n),
    stock: new Uint8Array(n)
  })
  const resources: ResourceSlots = { surface: slot(), ground: slot() }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      elevation[i] = ((x * 7 + y * 13) % 97) / 96
      temperature[i] = ((x * 3 + y * 5) % 101) / 100
      humidity[i] = ((x * 11 + y * 2) % 103) / 102
      biomeIds[i] = (x + 3 * y) % 26
      riverWidth[i] = (x * y) % 11 === 0 && x % 2 === 0 ? 1 + ((x + y) % 4) : 0
      const surface = (x * 5 + y * 3) % 17
      const ground = (x * 7 + y * 2) % 14
      if (surface < SURFACE_IDS.length) {
        resources.surface.type[i] = SURFACE_IDS[surface] as number
        resources.surface.richness[i] = 1 + ((x * 11 + y * 17) % 255)
        resources.surface.stock[i] = (resources.surface.richness[i] as number) >> (x % 3)
      }
      if (ground < GROUND_IDS.length) {
        resources.ground.type[i] = GROUND_IDS[ground] as number
        resources.ground.richness[i] = 1 + ((x * 13 + y * 5) % 255)
        resources.ground.stock[i] = resources.ground.richness[i] as number
      }
    }
  }
  // Includes points on the corners and edges so marker clipping is exercised.
  const strategicPoints: StrategicPoint[] = [
    { x: 0, y: 0, type: 'river_crossing', value: 10 },
    { x: width - 1, y: height - 1, type: 'strait', value: 3 },
    { x: 20, y: 12, type: 'mountain_pass', value: 7 },
    { x: 41, y: 25, type: 'isthmus', value: 1 },
    { x: width - 2, y: 3, type: 'mountain_pass', value: 5 }
  ]
  return {
    width,
    height,
    seaLevel: 0.37,
    elevation,
    temperature,
    humidity,
    biomeIds,
    riverWidth,
    resources,
    strategicPoints
  }
}

/** FNV-1a 32 over bytes, as lowercase hex: a tiny stable checksum for pixel buffers. */
export function checksum(bytes: Uint8Array | Uint8ClampedArray): string {
  let h = 0x811c9dc5
  for (const b of bytes) {
    h ^= b
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Deterministic ownership data: three nations as overlapping blobs, a lone tile, and a corner tile. */
export function syntheticOwnership(
  width = 64,
  height = 40
): { ownership: Uint8Array; colors: Array<[number, number, number]> } {
  const ownership = new Uint8Array(width * height).fill(255)
  const fill = (id: number, x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y += 1)
      for (let x = x0; x <= x1; x += 1) ownership[y * width + x] = id
  }
  fill(0, 5, 5, 20, 15)
  fill(1, 18, 10, 40, 30) // overlaps nation 0's rectangle; later fill wins
  fill(2, 50, 2, 50, 2) // a single tile
  fill(0, 0, 0, 0, 0) // a corner tile
  fill(2, width - 1, height - 1, width - 1, height - 1) // the opposite corner
  const colors: Array<[number, number, number]> = [
    [200, 40, 40],
    [40, 200, 40],
    [40, 40, 200]
  ]
  return { ownership, colors }
}
