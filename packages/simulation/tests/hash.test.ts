import { describe, expect, it } from 'vitest'
import { ByteHasher, HASH_SCHEMA_VERSION, stateHasher } from '../src/serialization/hash'

describe('HASH_SCHEMA_VERSION', () => {
  it('is 1: the first canonical layout of Sovereign state', () => {
    expect(HASH_SCHEMA_VERSION).toBe(1)
  })
})

// Vectors come from an independent implementation of docs/simulation/determinism.md section 7.
describe('ByteHasher', () => {
  it('hashes no bytes to the reference value', () => {
    expect(new ByteHasher().digest()).toBe('027ae52ecfc796215593990d4b41437c')
  })

  it('returns 32 lowercase hex characters', () => {
    const h = new ByteHasher()
    h.writeUint32(123456789)
    expect(h.digest()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('canonicalizes -0 to +0, so equal numbers hash equally', () => {
    const a = stateHasher()
    a.writeUint32(7)
    a.writeFloat64(-0)
    a.writeFloat64(0.5)
    a.writeUint8(1)
    const b = stateHasher()
    b.writeUint32(7)
    b.writeFloat64(0)
    b.writeFloat64(0.5)
    b.writeUint8(1)
    expect(a.digest()).toBe('0cfff52cd59cd936ea6e87ef760fd062')
    expect(b.digest()).toBe('0cfff52cd59cd936ea6e87ef760fd062')
  })

  it('encodes a string as its UTF-8 byte length (uint32, big-endian) then its UTF-8 bytes', () => {
    const h = stateHasher()
    h.writeString('héllo ✓ \u{1F30D}')
    expect(h.digest()).toBe('1ee750036f11b9738e0e26b0a664f383')
  })

  it('depends on the order of writes', () => {
    const a = new ByteHasher()
    a.writeUint8(1)
    a.writeUint8(2)
    const b = new ByteHasher()
    b.writeUint8(2)
    b.writeUint8(1)
    expect(a.digest()).not.toBe(b.digest())
  })

  it('does not consume state when read: digest() twice agrees and writes may continue', () => {
    const h = new ByteHasher()
    h.writeUint32(1)
    const first = h.digest()
    expect(h.digest()).toBe(first)
    h.writeUint32(2)
    const continued = h.digest()
    expect(continued).not.toBe(first)

    const fresh = new ByteHasher()
    fresh.writeUint32(1)
    fresh.writeUint32(2)
    expect(continued).toBe(fresh.digest())
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'refuses to hash the non-finite number %s (fail loud, never hash garbage)',
    (value) => {
      expect(() => new ByteHasher().writeFloat64(value)).toThrow(RangeError)
    }
  )

  it.each([-1, 256, 1.5, Number.NaN])('rejects %s as a uint8', (value) => {
    expect(() => new ByteHasher().writeUint8(value)).toThrow(RangeError)
  })

  it.each([-1, 4294967296, 1.5, Number.NaN])('rejects %s as a uint32', (value) => {
    expect(() => new ByteHasher().writeUint32(value)).toThrow(RangeError)
  })
})

describe('stateHasher', () => {
  it('starts with the versioned header: "SOVH" then the schema version as a uint32', () => {
    expect(stateHasher().digest()).toBe('0fe9d992d6cf4eba7b27f691dba022c3')
  })

  it('differs from a bare ByteHasher, so state hashes are never confused with raw ones', () => {
    expect(stateHasher().digest()).not.toBe(new ByteHasher().digest())
  })
})
