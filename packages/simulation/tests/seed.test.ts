import { describe, expect, it } from 'vitest'
import { normalizeSeed } from '../src/random/seed'

describe('normalizeSeed', () => {
  it.each([0, 1, 12345, 4294967295])('keeps the valid integer %d unchanged', (seed) => {
    expect(normalizeSeed(seed)).toBe(seed)
  })

  it('reads a canonical digit string as the number it spells', () => {
    expect(normalizeSeed('12345')).toBe(12345)
    expect(normalizeSeed('0')).toBe(0)
    expect(normalizeSeed('4294967295')).toBe(4294967295)
  })

  it('hashes any other text (FNV-1a 32 over its UTF-8 bytes)', () => {
    expect(normalizeSeed('sovereign')).toBe(0xa3579d13)
    expect(normalizeSeed('héllo ✓')).toBe(0xb4ab03a7)
  })

  it('hashes a digit string that does not fit in 32 bits, instead of throwing or wrapping', () => {
    expect(normalizeSeed('4294967296')).toBe(0xa5d2f78f)
    expect(normalizeSeed('99999999999')).toBe(0xf695eb82)
  })

  it('treats digit strings with leading zeros as text, so "007" and "7" are different worlds', () => {
    expect(normalizeSeed('007')).toBe(0xe2cb360e)
    expect(normalizeSeed('007')).not.toBe(normalizeSeed('7'))
  })

  it('maps the empty string to the FNV-1a offset basis (callers pick a random seed instead)', () => {
    expect(normalizeSeed('')).toBe(0x811c9dc5)
  })

  it.each([-1, 1.5, 4294967296, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the invalid number %s',
    (seed) => {
      expect(() => normalizeSeed(seed)).toThrow(RangeError)
    }
  )

  it('always returns a valid stream seed', () => {
    for (const input of ['', 'a', 'a much longer seed with spaces \u{1F30D}', '123456789012345']) {
      const seed = normalizeSeed(input)
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(4294967295)
    }
  })
})
