import { describe, expect, it } from 'vitest'
import { ByteHasher, HASH_SCHEMA_VERSION, stateHasher } from '../src/serialization/hash'

describe('HASH_SCHEMA_VERSION', () => {
  it('is 2: two resource slots (type, richness, stock) per tile', () => {
    expect(HASH_SCHEMA_VERSION).toBe(2)
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
    expect(a.digest()).toBe('13a50d16dbb8ff322a31b0a1e892d199')
    expect(b.digest()).toBe('13a50d16dbb8ff322a31b0a1e892d199')
  })

  it('encodes a string as its UTF-8 byte length (uint32, big-endian) then its UTF-8 bytes', () => {
    const h = stateHasher()
    h.writeString('héllo ✓ \u{1F30D}')
    expect(h.digest()).toBe('dca4d03e56316b1c0956110c6846b56a')
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

describe('bulk array writers', () => {
  // Reference vectors: independent implementation, header \"SOVH\" + version 1 then the array.
  it('writeFloat32Array: a uint32 length, then each value as 4 big-endian IEEE-754 bytes', () => {
    const h = stateHasher()
    h.writeFloat32Array(
      Float32Array.of(
        0.5,
        -0,
        0.3333333432674408,
        3.4028234663852886e38,
        1.401298464324817e-45,
        -2.5
      )
    )
    expect(h.digest()).toBe('2074957879a0d0c00daadd671ce6e421')
  })

  it('writeFloat32Array canonicalizes -0 to +0, like writeFloat64', () => {
    const a = stateHasher()
    a.writeFloat32Array(Float32Array.of(-0, 1))
    const b = stateHasher()
    b.writeFloat32Array(Float32Array.of(0, 1))
    expect(a.digest()).toBe(b.digest())
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'writeFloat32Array refuses the non-finite value %s',
    (value) => {
      expect(() => new ByteHasher().writeFloat32Array(Float32Array.of(1, value))).toThrow(
        RangeError
      )
    }
  )

  it('writeUint8Array: a uint32 length, then the bytes', () => {
    const h = stateHasher()
    h.writeUint8Array(Uint8Array.of(0, 1, 2, 255, 128))
    expect(h.digest()).toBe('a5285b8a6d19a5c622c9aa16741a2d31')
    const empty = stateHasher()
    empty.writeUint8Array(new Uint8Array(0))
    expect(empty.digest()).toBe('4c619c911067ce59bb35bc3b2e410d53')
  })

  it('writes arrays one after another, each self-delimiting', () => {
    const h = stateHasher()
    h.writeUint8Array(Uint8Array.of(0, 1, 2, 255, 128))
    h.writeFloat32Array(Float32Array.of(1.5, -0.25))
    expect(h.digest()).toBe('66d4df4e9737599b2ca7bf231541111c')
  })

  it('cannot confuse where one array ends and the next begins', () => {
    const a = new ByteHasher()
    a.writeUint8Array(Uint8Array.of(1, 2))
    a.writeUint8Array(Uint8Array.of(3))
    const b = new ByteHasher()
    b.writeUint8Array(Uint8Array.of(1))
    b.writeUint8Array(Uint8Array.of(2, 3))
    expect(a.digest()).not.toBe(b.digest())
  })

  it('hashes a 4-million-element layer quickly enough to be used on a full map', () => {
    const layer = new Float32Array(4_000_000).fill(0.25)
    const started = Date.now()
    const h = new ByteHasher()
    h.writeFloat32Array(layer)
    h.digest()
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describe('stateHasher', () => {
  it('starts with the versioned header: "SOVH" then the schema version as a uint32', () => {
    expect(stateHasher().digest()).toBe('d48ad70d56ab7785f786d29b03b9781a')
  })

  it('differs from a bare ByteHasher, so state hashes are never confused with raw ones', () => {
    expect(stateHasher().digest()).not.toBe(new ByteHasher().digest())
  })
})
