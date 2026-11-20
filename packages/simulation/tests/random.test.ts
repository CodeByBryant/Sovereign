import { describe, expect, it } from 'vitest'
import { FALLBACK_WORDS, SeededRandom } from '../src/random/SeededRandom'

const hex = (n: number): string => n.toString(16).padStart(8, '0')

describe('SeededRandom (xoshiro128**)', () => {
  it('reproduces the published reference sequence for state [1, 2, 3, 4]', () => {
    const rng = new SeededRandom([1, 2, 3, 4])
    const out = [0, 1, 2, 3, 4].map(() => rng.nextUint32())
    expect(out).toEqual([11520, 0, 5927040, 70819200, 2031721883])
  })

  it('uses the fixed fallback state, with a known first three outputs, when asked to', () => {
    const rng = new SeededRandom(FALLBACK_WORDS)
    expect([0, 1, 2].map(() => hex(rng.nextUint32()))).toEqual(['92dcf72a', '00544cb2', '3c7807cc'])
  })

  it('rejects the all-zero state, which would emit zeros forever', () => {
    expect(() => new SeededRandom([0, 0, 0, 0])).toThrow(RangeError)
  })

  it.each([[[-1, 1, 1, 1]], [[1.5, 1, 1, 1]], [[4294967296, 1, 1, 1]], [[Number.NaN, 1, 1, 1]]])(
    'rejects words that are not uint32: %j',
    (words) => {
      expect(() => new SeededRandom(words as unknown as [number, number, number, number])).toThrow(
        RangeError
      )
    }
  )

  describe('float()', () => {
    it('returns the same values as the reference for a given state', () => {
      const rng = new SeededRandom([0xcba02774, 0xfb23c1a8, 0x8c5232ad, 0xb1b025b4])
      expect([rng.float(), rng.float(), rng.float()]).toEqual([
        0.642658713773465, 0.448331885058995, 0.34028948229342704
      ])
    })

    it('stays in [0, 1) over many draws', () => {
      const rng = new SeededRandom([9, 8, 7, 6])
      for (let i = 0; i < 20_000; i += 1) {
        const x = rng.float()
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThan(1)
      }
    })
  })

  describe('integer(min, max)', () => {
    it('is inclusive on both ends and covers the whole range', () => {
      const rng = new SeededRandom([3, 1, 4, 1])
      const seen = new Set<number>()
      for (let i = 0; i < 2_000; i += 1) seen.add(rng.integer(-2, 3))
      expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3])
    })

    it('returns min when min equals max', () => {
      const rng = new SeededRandom([5, 5, 5, 5])
      expect(rng.integer(7, 7)).toBe(7)
    })

    it('draws again instead of taking a modulo-biased value (rejection sampling)', () => {
      // range 3 -> limit = floor(2^32 / 3) * 3 = 4294967295, so only u = 2^32 - 1 is rejected.
      const rejected = 0xffffffff
      const rng = new SeededRandom([1, 2, 3, 4])
      const stub = rng as unknown as { nextUint32: () => number }
      const queue = [rejected, 7]
      stub.nextUint32 = () => queue.shift() as number
      expect(rng.integer(0, 2)).toBe(7 % 3)
      expect(queue).toEqual([])
    })

    it.each([
      [5, 4],
      [0.5, 2],
      [0, 2 ** 53],
      [0, 2 ** 32]
    ])('rejects an invalid range (%d, %d)', (min, max) => {
      const rng = new SeededRandom([1, 2, 3, 4])
      expect(() => rng.integer(min, max)).toThrow(RangeError)
    })
  })

  describe('boolean(p) and choose(items)', () => {
    it('boolean(0) is always false and boolean(1) is always true', () => {
      const rng = new SeededRandom([2, 7, 1, 8])
      for (let i = 0; i < 200; i += 1) {
        expect(rng.boolean(0)).toBe(false)
        expect(rng.boolean(1)).toBe(true)
      }
    })

    it('is strictly less-than: a draw exactly equal to p is false, so boolean(0) can never be true', () => {
      const rng = new SeededRandom([2, 7, 1, 8])
      const stub = rng as unknown as { float: () => number }
      stub.float = () => 0
      expect(rng.boolean(0)).toBe(false)
      stub.float = () => 0.25
      expect(rng.boolean(0.25)).toBe(false)
      expect(rng.boolean(0.2500001)).toBe(true)
    })

    it('choose picks an element of the list and throws on an empty one', () => {
      const rng = new SeededRandom([2, 7, 1, 8])
      const items = ['a', 'b', 'c'] as const
      for (let i = 0; i < 100; i += 1) expect(items).toContain(rng.choose(items))
      expect(() => rng.choose([])).toThrow()
    })
  })

  describe('getState() / setState()', () => {
    it('lets a restored generator continue exactly where the original was', () => {
      const original = new SeededRandom([11, 22, 33, 44])
      for (let i = 0; i < 17; i += 1) original.nextUint32()
      const saved = original.getState()

      const expected = [0, 1, 2, 3].map(() => original.nextUint32())

      const restored = new SeededRandom([1, 1, 1, 1])
      restored.setState(saved)
      expect([0, 1, 2, 3].map(() => restored.nextUint32())).toEqual(expected)
    })

    it('hands out a copy: mutating the returned state does not touch the generator', () => {
      const rng = new SeededRandom([1, 2, 3, 4])
      const state = rng.getState()
      ;(state.words as unknown as number[])[0] = 999
      expect(rng.nextUint32()).toBe(11520)
    })
  })
})
