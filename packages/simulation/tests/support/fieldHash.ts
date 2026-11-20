import type { TerrainFields } from '@sovereign/contracts'
import { ByteHasher } from '../../src/serialization/hash'

export type HashableTerrain = TerrainFields

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
  for (const slot of ['surface', 'ground'] as const) {
    writeBytes(h, `${slot}Type`, t.resources[slot].type)
    writeBytes(h, `${slot}Richness`, t.resources[slot].richness)
    writeBytes(h, `${slot}Stock`, t.resources[slot].stock)
  }
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
