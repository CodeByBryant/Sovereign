import type { StrategicPoint } from '@sovereign/contracts'
import { ByteHasher } from '../../src/serialization/hash'

/** The fields a terrain run produces (the shape of both the old worker and the new pipeline). */
export interface HashableTerrain {
  width: number
  height: number
  seaLevel: number
  elevation: Float32Array
  temperature: Float32Array
  humidity: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  riverWidth: Uint8Array
  resourceType: Uint8Array
  resourceDensity: Uint8Array
  strategicPoints: readonly StrategicPoint[]
}

function writeFloats(h: ByteHasher, label: string, values: Float32Array): void {
  h.writeString(label)
  h.writeUint32(values.length)
  for (const v of values) h.writeFloat64(v)
}

function writeBytes(h: ByteHasher, label: string, values: Uint8Array): void {
  h.writeString(label)
  h.writeUint32(values.length)
  for (const v of values) h.writeUint8(v)
}

/** A stable fingerprint of every field of a terrain run. */
export function hashTerrain(t: HashableTerrain): string {
  const h = new ByteHasher()
  h.writeUint32(t.width)
  h.writeUint32(t.height)
  h.writeFloat64(t.seaLevel)
  writeFloats(h, 'elevation', t.elevation)
  writeFloats(h, 'temperature', t.temperature)
  writeFloats(h, 'humidity', t.humidity)
  writeBytes(h, 'biomeIds', t.biomeIds)
  writeBytes(h, 'riverMask', t.riverMask)
  writeBytes(h, 'riverWidth', t.riverWidth)
  writeBytes(h, 'resourceType', t.resourceType)
  writeBytes(h, 'resourceDensity', t.resourceDensity)
  h.writeString('strategic')
  h.writeUint32(t.strategicPoints.length)
  for (const p of t.strategicPoints) {
    h.writeUint32(p.x)
    h.writeUint32(p.y)
    h.writeString(p.type)
    h.writeFloat64(p.value)
  }
  return h.digest()
}
