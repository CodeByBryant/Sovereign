import { utf8Bytes } from './utf8'

/**
 * Version of the canonical state-hash layout (docs/simulation/determinism.md, section 7).
 * Any change to the field list, order or encoding of what a state hash covers bumps this number
 * and regenerates the golden hashes.
 */
export const HASH_SCHEMA_VERSION = 1

const TWO_POW_32 = 4_294_967_296

/**
 * Incremental 128-bit hash (cyrb128-style, four 32-bit lanes fed one byte at a time) with fixed,
 * platform-independent byte encodings for the values the engine writes.
 */
export class ByteHasher {
  private h1 = 1779033703
  private h2 = 3144134277
  private h3 = 1013904242
  private h4 = 2773480762
  private readonly scratch = new DataView(new ArrayBuffer(8))

  writeByte(k: number): void {
    this.h1 = this.h2 ^ Math.imul(this.h1 ^ k, 597399067)
    this.h2 = this.h3 ^ Math.imul(this.h2 ^ k, 2869860233)
    this.h3 = this.h4 ^ Math.imul(this.h3 ^ k, 951274213)
    this.h4 = this.h1 ^ Math.imul(this.h4 ^ k, 2716044179)
  }

  writeUint8(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new RangeError('uint8 out of range')
    }
    this.writeByte(value)
  }

  /** 4 bytes, big-endian. */
  writeUint32(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= TWO_POW_32) {
      throw new RangeError('uint32 out of range')
    }
    this.writeByte((value >>> 24) & 0xff)
    this.writeByte((value >>> 16) & 0xff)
    this.writeByte((value >>> 8) & 0xff)
    this.writeByte(value & 0xff)
  }

  /** 8 bytes of exact IEEE-754 bits, big-endian; -0 is written as +0; non-finite is an error. */
  writeFloat64(value: number): void {
    if (!Number.isFinite(value)) {
      throw new RangeError('cannot hash a non-finite number')
    }
    this.scratch.setFloat64(0, value === 0 ? 0 : value, false)
    for (let i = 0; i < 8; i += 1) this.writeByte(this.scratch.getUint8(i))
  }

  /** The UTF-8 byte length as a uint32, then the UTF-8 bytes. */
  writeString(value: string): void {
    const bytes = utf8Bytes(value)
    this.writeUint32(bytes.length)
    for (const byte of bytes) this.writeByte(byte)
  }

  /** A uint32 length, then the bytes. */
  writeUint8Array(values: Uint8Array): void {
    this.writeUint32(values.length)
    for (let i = 0; i < values.length; i += 1) this.writeByte(values[i] as number)
  }

  /**
   * A uint32 length, then each value as 4 bytes of exact IEEE-754 float32 bits, big-endian; -0 is
   * written as +0 and a non-finite value is an error. (The values are float32 already: widening to
   * float64 would change nothing but waste time.)
   */
  writeFloat32Array(values: Float32Array): void {
    this.writeUint32(values.length)
    const scratch = this.scratch
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i] as number
      if (!Number.isFinite(v)) throw new RangeError('cannot hash a non-finite number')
      scratch.setFloat32(0, v === 0 ? 0 : v, false)
      this.writeByte(scratch.getUint8(0))
      this.writeByte(scratch.getUint8(1))
      this.writeByte(scratch.getUint8(2))
      this.writeByte(scratch.getUint8(3))
    }
  }

  /** The 32-character lowercase hex digest of everything written so far. Does not consume state. */
  digest(): string {
    let h1 = this.h1
    let h2 = this.h2
    let h3 = this.h3
    let h4 = this.h4
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
    h1 ^= h2 ^ h3 ^ h4
    h2 ^= h1
    h3 ^= h1
    h4 ^= h1
    return [h1, h2, h3, h4].map((lane) => (lane >>> 0).toString(16).padStart(8, '0')).join('')
  }
}

/** A hasher that has already written the versioned header `"SOVH"` + `HASH_SCHEMA_VERSION`. */
export function stateHasher(): ByteHasher {
  const hasher = new ByteHasher()
  for (const byte of utf8Bytes('SOVH')) hasher.writeByte(byte)
  hasher.writeUint32(HASH_SCHEMA_VERSION)
  return hasher
}
