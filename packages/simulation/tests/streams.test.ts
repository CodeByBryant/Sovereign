import { describe, expect, it } from 'vitest'
import { FALLBACK_WORDS, SeededRandom } from '../src/random/SeededRandom'
import {
  STREAM_NAMES,
  createStream,
  fixZeroWords,
  fnv1a32,
  splitmix32Words,
  streamWords
} from '../src/random/streams'
import { utf8Bytes } from '../src/serialization/utf8'

const hex = (n: number): string => n.toString(16).padStart(8, '0')
const bytes = (text: string): Uint8Array => utf8Bytes(text)

describe('fnv1a32', () => {
  it('matches the published FNV-1a 32-bit test vectors', () => {
    expect(hex(fnv1a32(new Uint8Array(0)))).toBe('811c9dc5')
    expect(hex(fnv1a32(bytes('a')))).toBe('e40c292c')
    expect(hex(fnv1a32(bytes('foobar')))).toBe('bf9cf968')
  })
})

describe('splitmix32Words', () => {
  it('expands state 0 to the reference four words', () => {
    expect(splitmix32Words(0).map(hex)).toEqual(['92ca2f0e', '3cd6e3f3', '1b147dcc', '4c081dbf'])
  })
})

describe('fixZeroWords', () => {
  it('replaces the invalid all-zero state with the fixed fallback', () => {
    expect(fixZeroWords([0, 0, 0, 0])).toEqual(FALLBACK_WORDS)
  })

  it('leaves any other state untouched', () => {
    expect(fixZeroWords([0, 0, 0, 1])).toEqual([0, 0, 0, 1])
  })
})

describe('streamWords / createStream', () => {
  // Reference vectors produced by an independent implementation of docs/simulation/determinism.md.
  const vectors = [
    {
      seed: 0,
      name: 'elevation',
      words: 'd7117f9b 523f7bff ed700d00 ba2b3334',
      first: '9465ec35 43d34a24 94346339 ac916aeb acb5aba7'
    },
    {
      seed: 12345,
      name: 'elevation',
      words: 'cba02774 fb23c1a8 8c5232ad b1b025b4',
      first: 'a485480b 712bf198 72c5e0e1 00a8c92a 571d3632'
    },
    {
      seed: 12345,
      name: 'names',
      words: 'dab067d8 2f43aa12 632c8641 d85fd031',
      first: '72729926 a023bbc1 fc7ffd3e 92c7e46a aa0873a8'
    },
    {
      seed: 4294967295,
      name: 'spawn',
      words: '41d56cd8 56bedb81 3573cf20 9e377b4a',
      first: 'c64ad998 2696a57d 7a6555bd f977a8fb 3f481221'
    },
    // Seeds whose four bytes all differ, so a byte-order or shift bug in the encoding shows up.
    {
      seed: 0x12345678,
      name: 'names',
      words: 'd3f7002d 50479d51 2fb26b38 0084542d',
      first: '4b53a108 42a4fb9e 801f0396 f9e669e5 e7141911'
    },
    {
      seed: 0xdeadbeef,
      name: 'elevation',
      words: 'c44a5996 67216423 fad07633 a8145af7',
      first: '6f4d1389 f6234a60 35190a94 b509b022 f59b0c3e'
    },
    {
      seed: 0x00ff0100,
      name: 'spawn',
      words: 'bfc5cce7 6d0a67b5 a870f99c 9b605bb9',
      first: '6a1d6910 d0c71cc2 6744c741 91ff3c09 3339f064'
    },
    {
      seed: 0,
      name: 'riverWarpX',
      words: 'fc34eb54 7493dfbc eefa770f 9ab03e43',
      first: 'ff2a073b 3277d1f7 beb686bb 7ec2aba3 935d3898'
    }
  ] as const

  it.each(vectors)('seed $seed, stream $name: state words match the reference', (v) => {
    expect(streamWords(v.seed, v.name).map(hex).join(' ')).toBe(v.words)
  })

  it.each(vectors)('seed $seed, stream $name: first five outputs match the reference', (v) => {
    const rng = createStream(v.seed, v.name)
    expect([0, 1, 2, 3, 4].map(() => hex(rng.nextUint32())).join(' ')).toBe(v.first)
  })

  it('createStream returns a SeededRandom', () => {
    expect(createStream(1, 'names')).toBeInstanceOf(SeededRandom)
  })

  it('gives each stream a different sequence for the same seed', () => {
    const firsts = STREAM_NAMES.map((name) => createStream(777, name).nextUint32())
    expect(new Set(firsts).size).toBe(STREAM_NAMES.length)
  })

  it('gives the same stream a different sequence for different seeds', () => {
    expect(createStream(1, 'elevation').nextUint32()).not.toBe(
      createStream(2, 'elevation').nextUint32()
    )
  })

  it('is independent between streams: drawing from one never moves another', () => {
    const a = createStream(5, 'elevation')
    const b1 = createStream(5, 'names')
    for (let i = 0; i < 100; i += 1) a.nextUint32()
    const b2 = createStream(5, 'names')
    expect(b1.nextUint32()).toBe(b2.nextUint32())
  })

  it.each([-1, 1.5, 4294967296, Number.NaN])('rejects the invalid seed %s', (seed) => {
    expect(() => streamWords(seed, 'elevation')).toThrow(RangeError)
  })
})
