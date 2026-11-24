import type { Nation } from '../../src/nations/Nation'
import { ByteHasher } from '../../src/serialization/hash'

/** A fingerprint of every field of every nation, including the order its provinces were claimed. */
export function hashNations(nations: readonly Nation[]): string {
  const h = new ByteHasher()
  h.writeUint32(nations.length)
  for (const n of nations) {
    h.writeString(n.id)
    h.writeString(n.name)
    for (const c of n.color) h.writeUint8(c)
    h.writeString(n.flag.type)
    for (const c of [...n.flag.background, ...n.flag.accent, ...(n.flag.detail ?? [])])
      h.writeFloat64(c)
    h.writeString(n.government)
    for (const v of Object.values(n.personality)) h.writeFloat64(v)
    h.writeUint32(n.capital)
    for (const v of Object.values(n.stats)) h.writeUint32(v)
    for (const v of Object.values(n.profile)) h.writeFloat64(v)
    h.writeFloat64(n.expansionPoints)
    h.writeUint32(n.provinces.size)
    for (const province of n.provinces) h.writeUint32(province)
  }
  return h.digest()
}
