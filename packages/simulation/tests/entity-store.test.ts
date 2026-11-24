import { EntityKind } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { EntityStore } from '../src/entities/EntityStore'

const spawn = (store: EntityStore, x = 0, y = 0): number =>
  store.spawn({ kind: EntityKind.Villager, x, y })

describe('EntityStore: spawning', () => {
  it('starts empty', () => {
    const store = new EntityStore()
    expect(store.count).toBe(0)
    expect(store.highWater).toBe(0)
    expect([...store.ids()]).toEqual([])
  })

  it('gives ids from 0 up, and keeps what each row was given', () => {
    const store = new EntityStore()
    const a = store.spawn({ kind: EntityKind.Villager, x: 5, y: 9, owner: 3, home: 77, state: 2 })
    const b = spawn(store, 1, 2)
    expect([a, b]).toEqual([0, 1])
    expect(store.count).toBe(2)
    expect(store.kind[a]).toBe(EntityKind.Villager)
    expect([store.x[a], store.y[a]]).toEqual([5, 9])
    expect(store.owner[a]).toBe(3)
    expect(store.home[a]).toBe(77)
    expect(store.state[a]).toBe(2)
    expect([store.x[b], store.y[b]]).toEqual([1, 2])
  })

  it('has no owner unless one is given', () => {
    const store = new EntityStore()
    expect(store.owner[spawn(store)]).toBe(255)
  })

  it('refuses a row with no kind, or a position off the 16 bit grid', () => {
    const store = new EntityStore()
    expect(() => store.spawn({ kind: EntityKind.None, x: 0, y: 0 })).toThrow(RangeError)
    expect(() => store.spawn({ kind: EntityKind.Villager, x: -1, y: 0 })).toThrow(RangeError)
    expect(() => store.spawn({ kind: EntityKind.Villager, x: 0, y: 70000 })).toThrow(RangeError)
    expect(() => store.spawn({ kind: EntityKind.Villager, x: 1.5, y: 0 })).toThrow(RangeError)
    expect(store.count).toBe(0)
  })

  it('takes the edges of the grid and the highest kind, and refuses the first value past them', () => {
    const store = new EntityStore()
    expect(() => store.spawn({ kind: 255, x: 65535, y: 65535 })).not.toThrow()
    expect(() => store.spawn({ kind: 1, x: 0, y: 0 })).not.toThrow()
    expect(() => store.spawn({ kind: 256, x: 0, y: 0 })).toThrow(RangeError)
    expect(() => store.spawn({ kind: 1, x: 65536, y: 0 })).toThrow(RangeError)
    expect(() => store.spawn({ kind: 1, x: 0, y: 65536 })).toThrow(RangeError)
    expect(() => store.spawn({ kind: 1, x: 0, y: -1 })).toThrow(RangeError)
    expect(() => store.spawn({ kind: 1.5, x: 0, y: 0 })).toThrow(RangeError)
  })

  it('keeps the target, the timers and the owner it was given', () => {
    const store = new EntityStore()
    const id = store.spawn({
      kind: 1,
      x: 3,
      y: 4,
      target: 8,
      wake: 9,
      legStart: 10,
      legEnd: 11,
      owner: 6
    })
    expect([
      store.target[id],
      store.wake[id],
      store.legStart[id],
      store.legEnd[id],
      store.owner[id]
    ]).toEqual([8, 9, 10, 11, 6])
  })

  it('grows past its first capacity without losing a row', () => {
    const store = new EntityStore(4)
    for (let i = 0; i < 1000; i += 1) spawn(store, i, 2 * i)
    expect(store.count).toBe(1000)
    for (let i = 0; i < 1000; i += 1) {
      expect([store.x[i], store.y[i]]).toEqual([i, 2 * i])
    }
  })
})

describe('EntityStore: despawning', () => {
  it('empties the row and counts one fewer', () => {
    const store = new EntityStore()
    const a = store.spawn({ kind: EntityKind.Villager, x: 5, y: 5, owner: 1, home: 9 })
    spawn(store)
    store.despawn(a)
    expect(store.count).toBe(1)
    expect(store.alive(a)).toBe(false)
    expect(store.kind[a]).toBe(EntityKind.None)
    expect([store.x[a], store.y[a], store.home[a]]).toEqual([0, 0, 0])
    expect(store.owner[a]).toBe(255)
  })

  it('hands the lowest free id to the next spawn, however the rows were freed', () => {
    const store = new EntityStore()
    for (let i = 0; i < 6; i += 1) spawn(store)
    store.despawn(4)
    store.despawn(1)
    store.despawn(3)
    expect(spawn(store)).toBe(1)
    expect(spawn(store)).toBe(3)
    expect(spawn(store)).toBe(4)
    expect(spawn(store)).toBe(6)
  })

  it('allocates the same ids whatever order the rows were freed in (what a restore needs)', () => {
    const run = (order: number[]): number[] => {
      const store = new EntityStore()
      for (let i = 0; i < 8; i += 1) spawn(store)
      for (const id of order) store.despawn(id)
      return [spawn(store), spawn(store), spawn(store)]
    }
    expect(run([2, 5, 0])).toEqual(run([0, 5, 2]))
    expect(run([2, 5, 0])).toEqual([0, 2, 5])
  })

  it('refuses to despawn a row that is empty or not there', () => {
    const store = new EntityStore()
    const a = spawn(store)
    store.despawn(a)
    expect(() => store.despawn(a)).toThrow(RangeError)
    expect(() => store.despawn(99)).toThrow(RangeError)
    expect(() => store.despawn(-1)).toThrow(RangeError)
  })

  it('keeps the high water mark: it is where the rows stop, not how many are alive', () => {
    const store = new EntityStore()
    for (let i = 0; i < 5; i += 1) spawn(store)
    store.despawn(4)
    expect(store.highWater).toBe(5)
    expect(store.count).toBe(4)
  })
})

describe('EntityStore: iterating', () => {
  it('visits the living rows by id, skipping the dead', () => {
    const store = new EntityStore()
    for (let i = 0; i < 7; i += 1) spawn(store)
    store.despawn(0)
    store.despawn(3)
    store.despawn(6)
    expect([...store.ids()]).toEqual([1, 2, 4, 5])
  })

  it('reports whether a row is alive, and false past the end', () => {
    const store = new EntityStore()
    const a = spawn(store)
    expect(store.alive(a)).toBe(true)
    expect(store.alive(a + 1)).toBe(false)
    expect(store.alive(-1)).toBe(false)
    expect(store.alive(a + 0.5)).toBe(false)
    expect(store.alive(Number.NaN)).toBe(false)
  })
})
