import { describe, expect, it } from 'vitest'
import { utf8Bytes } from '../src/serialization/utf8'

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
