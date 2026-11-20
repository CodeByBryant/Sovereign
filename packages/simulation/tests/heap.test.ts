import { describe, expect, it } from 'vitest'
import { MinHeap } from '../src/terrain/heap'

/** A tiny LCG, so the tests need no randomness of their own. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function drain(heap: MinHeap): Array<[number, number]> {
  const out: Array<[number, number]> = []
  while (heap.size > 0) {
    const key = heap.peekKey()
    out.push([key, heap.pop()])
  }
  return out
}

describe('MinHeap', () => {
  it('starts empty, and pop on empty is an error', () => {
    const heap = new MinHeap()
    expect(heap.size).toBe(0)
    expect(() => heap.pop()).toThrow(RangeError)
    expect(() => heap.peekKey()).toThrow(RangeError)
  })

  it('pops the smallest key first', () => {
    const heap = new MinHeap()
    for (const [k, id] of [
      [5, 1],
      [2, 2],
      [9, 3],
      [1, 4],
      [7, 5]
    ] as const)
      heap.push(k, id)
    expect(drain(heap).map(([, id]) => id)).toEqual([4, 2, 1, 5, 3])
  })

  it('breaks ties by the smaller id, so the order is total', () => {
    const heap = new MinHeap()
    for (const id of [9, 3, 7, 1, 5]) heap.push(2.5, id)
    expect(drain(heap).map(([, id]) => id)).toEqual([1, 3, 5, 7, 9])
  })

  it('orders keys that differ in the last bits', () => {
    const heap = new MinHeap()
    const a = 1
    const b = 1 + Number.EPSILON
    heap.push(b, 1)
    heap.push(a, 2)
    expect(drain(heap).map(([, id]) => id)).toEqual([2, 1])
  })

  it("keeps duplicate entries of the same id (lazy deletion is the caller's business)", () => {
    const heap = new MinHeap()
    heap.push(3, 7)
    heap.push(1, 7)
    expect(drain(heap)).toEqual([
      [1, 7],
      [3, 7]
    ])
  })

  it('sorts a large random input exactly like a sort by (key, id)', () => {
    const next = lcg(42)
    const items: Array<[number, number]> = []
    const heap = new MinHeap()
    for (let i = 0; i < 20000; i += 1) {
      const key = Math.floor(next() * 500) / 7 // many ties
      items.push([key, i])
      heap.push(key, i)
    }
    items.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    expect(drain(heap)).toEqual(items)
  })

  it('works when pushes and pops are interleaved (as Dijkstra uses it)', () => {
    const next = lcg(7)
    const heap = new MinHeap()
    const shadow: Array<[number, number]> = []
    for (let step = 0; step < 5000; step += 1) {
      if (shadow.length === 0 || next() < 0.6) {
        const item: [number, number] = [Math.floor(next() * 50), step]
        shadow.push(item)
        shadow.sort((a, b) => a[0] - b[0] || a[1] - b[1])
        heap.push(item[0], item[1])
      } else {
        const want = shadow.shift() as [number, number]
        expect([heap.peekKey(), heap.pop()]).toEqual(want)
      }
      expect(heap.size).toBe(shadow.length)
    }
  })

  it('grows past its initial capacity, and clear() empties it for reuse', () => {
    const heap = new MinHeap(2)
    for (let i = 0; i < 100; i += 1) heap.push(100 - i, i)
    expect(heap.size).toBe(100)
    expect(heap.pop()).toBe(99)
    heap.clear()
    expect(heap.size).toBe(0)
    heap.push(1, 5)
    expect(heap.pop()).toBe(5)
  })
})
