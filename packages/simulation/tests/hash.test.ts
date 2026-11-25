import { describe, expect, it } from 'vitest'
import { ByteHasher, HASH_SCHEMA_VERSION, stateHasher } from '../src/serialization/hash'

describe('HASH_SCHEMA_VERSION', () => {
  it('is 6: the resource nodes (not the six slot layers) are hashed', () => {
    expect(HASH_SCHEMA_VERSION).toBe(6)
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
    expect(a.digest()).toBe('7a1be235c4f8363eeced3317866bb34b')
    expect(b.digest()).toBe('7a1be235c4f8363eeced3317866bb34b')
  })

  it('encodes a string as its UTF-8 byte length (uint32, big-endian) then its UTF-8 bytes', () => {
    const h = stateHasher()
    h.writeString('héllo ✓ \u{1F30D}')
    expect(h.digest()).toBe('da50b4bbf30e80a34b0169bc1ea1cad1')
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
  // Reference vectors: independent implementation, header \"SOVH\" + the schema version then the array.
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
    expect(h.digest()).toBe('39b55c3693a320632abdb10c3c5d620c')
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
    expect(h.digest()).toBe('47611f97fdccc749c61509b3c20bd877')
    const empty = stateHasher()
    empty.writeUint8Array(new Uint8Array(0))
    expect(empty.digest()).toBe('d9f62b40d8e74b57965ba9f1e81d7765')
  })

  it('writeUint32Array: a uint32 length, then each value as 4 big-endian bytes', () => {
    const h = stateHasher()
    h.writeUint32Array(Uint32Array.of(0, 1, 255, 256, 65536, 4294967295))
    expect(h.digest()).toBe('6f00305087b88793f4711f90edd90aa9')
    const empty = stateHasher()
    empty.writeUint32Array(new Uint32Array(0))
    expect(empty.digest()).toBe('d9f62b40d8e74b57965ba9f1e81d7765')
  })

  it('writeUint32Array is the same bytes as writing each value with writeUint32', () => {
    const a = stateHasher()
    a.writeUint32Array(Uint32Array.of(7, 70000, 3))
    const b = stateHasher()
    b.writeUint32(3)
    for (const v of [7, 70000, 3]) b.writeUint32(v)
    expect(a.digest()).toBe(b.digest())
  })

  it('writes arrays one after another, each self-delimiting', () => {
    const h = stateHasher()
    h.writeUint8Array(Uint8Array.of(0, 1, 2, 255, 128))
    h.writeFloat32Array(Float32Array.of(1.5, -0.25))
    expect(h.digest()).toBe('8848ba6f8e0a3619e445552b3c11a6fd')
    const mixed = stateHasher()
    mixed.writeUint32Array(Uint32Array.of(7))
    mixed.writeUint8Array(Uint8Array.of(9))
    expect(mixed.digest()).toBe('69635a6c2d8db7c0f7d1f8eeb8da3d7f')
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
    expect(stateHasher().digest()).toBe('45a06ec31292a203134a0c13c389cf3c')
  })

  it('differs from a bare ByteHasher, so state hashes are never confused with raw ones', () => {
    expect(stateHasher().digest()).not.toBe(new ByteHasher().digest())
  })
})
