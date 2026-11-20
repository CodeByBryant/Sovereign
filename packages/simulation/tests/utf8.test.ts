import { describe, expect, it } from 'vitest'
import { utf8Bytes, utf8Decode } from '../src/serialization/utf8'

const encoder = new TextEncoder()

describe('utf8Bytes', () => {
  it.each([
    '',
    'a',
    'sovereign',
    'héllo',
    '✓ check',
    'héllo ✓ \u{1F30D}', // 1-, 2-, 3- and 4-byte sequences
    '\u{10FFFF}'
  ])('encodes %j exactly like the platform TextEncoder', (text) => {
    expect([...utf8Bytes(text)]).toEqual([...encoder.encode(text)])
  })

  it('encodes a lone surrogate as U+FFFD, as TextEncoder does', () => {
    expect([...utf8Bytes('a\ud800b')]).toEqual([...encoder.encode('a\ud800b')])
  })
})

describe('utf8Decode', () => {
  const strict = new TextDecoder('utf-8', { fatal: true })

  it.each([
    '',
    'a',
    'sovereign',
    'h\u00e9llo',
    '\u2713 check',
    'h\u00e9llo \u2713 \u{1F30D}',
    '\u{10FFFF}',
    '\u0000\u007f\u0080\u07ff\u0800\uffff'
  ])('decodes %j, and is the inverse of utf8Bytes', (text) => {
    expect(utf8Decode(utf8Bytes(text))).toBe(text)
    expect(utf8Decode(encoderBytes(text))).toBe(strict.decode(encoderBytes(text)))
  })

  // Each of these is invalid UTF-8; the strict platform decoder rejects them, so must we.
  it.each([
    ['a lone continuation byte', [0x80]],
    ['a continuation byte after ASCII', [0x61, 0xbf]],
    ['a 2-byte lead with no continuation', [0xc3]],
    ['a 2-byte lead followed by ASCII', [0xc3, 0x28]],
    ['a 2-byte lead followed by another lead byte', [0xc3, 0xc3]],
    ['a 3-byte sequence ending in a lead byte', [0xe2, 0x82, 0xe2]],
    ['a 4-byte sequence with a lead byte in the middle', [0xf0, 0x9f, 0xc0, 0x80]],
    ['an overlong 2-byte encoding of NUL', [0xc0, 0x80]],
    ['an overlong 2-byte encoding of "/"', [0xc1, 0xbf]],
    ['a truncated 3-byte sequence', [0xe2, 0x82]],
    ['an overlong 3-byte encoding', [0xe0, 0x80, 0x80]],
    ['an encoded surrogate (U+D800)', [0xed, 0xa0, 0x80]],
    ['a truncated 4-byte sequence', [0xf0, 0x9f, 0x8c]],
    ['an overlong 4-byte encoding', [0xf0, 0x80, 0x80, 0x80]],
    ['a code point above U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
    ['a lead byte that is never valid (0xF8)', [0xf8, 0x88, 0x80, 0x80, 0x80]],
    ['0xFF', [0xff]],
    ['0xFE', [0xfe]]
  ])('rejects %s', (_label, bytes) => {
    expect(() => strict.decode(Uint8Array.from(bytes))).toThrow()
    expect(() => utf8Decode(Uint8Array.from(bytes))).toThrow(RangeError)
  })
})

function encoderBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}
