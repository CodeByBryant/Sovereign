import type { StrategicPoint } from '@sovereign/contracts'

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
  resourceType: Uint8Array
  resourceDensity: Uint8Array
  strategicPoints: StrategicPoint[]
}

export function syntheticFields(width = 64, height = 40): SyntheticFields {
  const n = width * height
  const elevation = new Float32Array(n)
  const temperature = new Float32Array(n)
  const humidity = new Float32Array(n)
  const biomeIds = new Uint8Array(n)
  const riverWidth = new Uint8Array(n)
  const resourceType = new Uint8Array(n)
  const resourceDensity = new Uint8Array(n)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      elevation[i] = ((x * 7 + y * 13) % 97) / 96
      temperature[i] = ((x * 3 + y * 5) % 101) / 100
      humidity[i] = ((x * 11 + y * 2) % 103) / 102
      biomeIds[i] = (x + 3 * y) % 26
      riverWidth[i] = (x * y) % 11 === 0 && x % 2 === 0 ? 1 + ((x + y) % 4) : 0
      resourceType[i] = (x * 5 + y * 3) % 8
      resourceDensity[i] = (x * 11 + y * 17) % 256
    }
  }
  // Includes points on the corners and edges so marker clipping is exercised.
  const strategicPoints: StrategicPoint[] = [
    { x: 0, y: 0, type: 'river_crossing', value: 10 },
    { x: width - 1, y: height - 1, type: 'strait', value: 3 },
    { x: 20, y: 12, type: 'mountain_pass', value: 7 },
    { x: 41, y: 25, type: 'peninsula', value: 1 },
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
    resourceType,
    resourceDensity,
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
