import { EntityKind } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { COLUMN_NAMES, EntityStore } from '../src/entities/EntityStore'

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

  it('keeps the hall, the goal and the carried stack it was given, and defaults them to none', () => {
    const store = new EntityStore()
    const id = store.spawn({
      kind: 1,
      x: 3,
      y: 4,
      hall: 7,
      goal: 99,
      carriedType: 5,
      carriedCount: 12
    })
    expect([store.hall[id], store.goal[id], store.carriedType[id], store.carriedCount[id]]).toEqual(
      [7, 99, 5, 12]
    )
    const plain = store.spawn({ kind: 1, x: 0, y: 0 })
    expect([
      store.hall[plain],
      store.goal[plain],
      store.carriedType[plain],
      store.carriedCount[plain]
    ]).toEqual([0, 0, 0, 0])
  })

  it('zeroes the hall, goal and carried stack of a row it removes', () => {
    const store = new EntityStore()
    const id = store.spawn({
      kind: 1,
      x: 3,
      y: 4,
      hall: 7,
      goal: 99,
      carriedType: 5,
      carriedCount: 12
    })
    store.despawn(id)
    expect([store.hall[id], store.goal[id], store.carriedType[id], store.carriedCount[id]]).toEqual(
      [0, 0, 0, 0]
    )
    expect(store.spawn({ kind: 1, x: 1, y: 1 })).toBe(id)
    expect(store.hall[id]).toBe(0)
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

describe('EntityStore: columns, for saving and restoring', () => {
  const filled = (): EntityStore => {
    const store = new EntityStore(2)
    for (let i = 0; i < 6; i += 1) {
      store.spawn({
        kind: 1,
        x: i,
        y: 2 * i,
        owner: i % 3,
        state: i % 2,
        home: 10 + i,
        target: 20 + i,
        wake: 30 + i,
        legStart: 40 + i,
        legEnd: 50 + i,
        hall: 60 + i,
        goal: 70 + i,
        carriedType: 1 + i,
        carriedCount: 10 * i
      })
    }
    store.despawn(1)
    store.despawn(4)
    return store
  }

  it('gives every column up to the high water mark, holes included', () => {
    const store = filled()
    const c = store.toColumns()
    expect(c.highWater).toBe(6)
    expect(c.kind).toEqual([1, 0, 1, 1, 0, 1])
    expect(c.x).toEqual([0, 0, 2, 3, 0, 5])
    expect(c.owner).toEqual([0, 255, 2, 0, 255, 2])
    expect(c.legEnd).toEqual([50, 0, 52, 53, 0, 55])
    expect(c.hall).toEqual([60, 0, 62, 63, 0, 65])
    expect(c.goal).toEqual([70, 0, 72, 73, 0, 75])
    expect(c.carriedType).toEqual([1, 0, 3, 4, 0, 6])
    expect(c.carriedCount).toEqual([0, 0, 20, 30, 0, 50])
  })

  it('rebuilds the same store from them: the same rows, the same count, the same ids handed out next', () => {
    const a = filled()
    const b = EntityStore.fromColumns(a.toColumns())
    expect(b.toColumns()).toEqual(a.toColumns())
    expect(b.count).toBe(a.count)
    expect(b.highWater).toBe(a.highWater)
    expect([...b.ids()]).toEqual([...a.ids()])
    expect([
      a.spawn({ kind: 1, x: 0, y: 0 }),
      a.spawn({ kind: 1, x: 0, y: 0 }),
      a.spawn({ kind: 1, x: 0, y: 0 })
    ]).toEqual([1, 4, 6])
    expect([
      b.spawn({ kind: 1, x: 0, y: 0 }),
      b.spawn({ kind: 1, x: 0, y: 0 }),
      b.spawn({ kind: 1, x: 0, y: 0 })
    ]).toEqual([1, 4, 6])
  })

  it('rebuilds an empty store from empty columns', () => {
    const empty = EntityStore.fromColumns(new EntityStore().toColumns())
    expect(empty.count).toBe(0)
    expect(empty.spawn({ kind: 1, x: 0, y: 0 })).toBe(0)
  })

  it('refuses columns that are not all the same length, or a high water mark that does not match', () => {
    const c = filled().toColumns()
    expect(() => EntityStore.fromColumns({ ...c, x: c.x.slice(1) })).toThrow(RangeError)
    expect(() => EntityStore.fromColumns({ ...c, legEnd: [...c.legEnd, 1] })).toThrow(RangeError)
    expect(() => EntityStore.fromColumns({ ...c, highWater: 5 })).toThrow(RangeError)
  })

  it('refuses a value that does not fit its column, one way at a time', () => {
    const c = filled().toColumns() // rows 1 and 4 are empty, so only rows 0, 2, 3 and 5 may change
    const bad = (over: Partial<typeof c>): void => {
      expect(() => EntityStore.fromColumns({ ...c, ...over })).toThrow(/does not fit/)
    }
    bad({ kind: [1, 0, 1, 1, 0, 256] })
    bad({ x: [0, 0, 2, 3, 0, 65536] })
    bad({ y: [0, 0, 2, 3, 0, -1] })
    bad({ owner: [0, 255, 2, 0, 255, 256] })
    bad({ state: [0, 0, 1, 0, 0, 1.5] })
    bad({ home: [10, 0, 12, 13, 0, 2.5] })
    bad({ target: [20, 0, 22, 23, 0, Number.NaN] })
    bad({ wake: [30, 0, 32, 33, 0, 2 ** 31] })
    bad({ legStart: [40, 0, 42, 43, 0, -(2 ** 31) - 1] })
    bad({ legEnd: [50, 0, 52, 53, 0, Infinity] })
    bad({ hall: [60, 0, 62, 63, 0, -1] })
    bad({ goal: [70, 0, 72, 73, 0, 2 ** 31] })
    bad({ carriedType: [1, 0, 3, 4, 0, 256] })
    bad({ carriedCount: [0, 0, 20, 30, 0, -1] })
    const edge = {
      ...c,
      x: [0, 0, 2, 3, 0, 65535],
      wake: [30, 0, 32, 33, 0, 2 ** 31 - 1],
      legStart: [40, 0, 42, 43, 0, -(2 ** 31)],
      carriedCount: [0, 0, 20, 30, 0, 255],
      goal: [70, 0, 72, 73, 0, 2 ** 31 - 1]
    }
    expect(() => EntityStore.fromColumns(edge)).not.toThrow()
  })

  it('refuses a column that is missing or not a list', () => {
    const c = filled().toColumns()
    expect(() => EntityStore.fromColumns({ ...c, x: undefined as unknown as number[] })).toThrow(
      RangeError
    )
    expect(() => EntityStore.fromColumns({ ...c, home: 'nope' as unknown as number[] })).toThrow(
      RangeError
    )
  })

  it('refuses a high water mark that is not a whole number of 0 or more', () => {
    const c = filled().toColumns()
    expect(() => EntityStore.fromColumns({ ...c, highWater: -1 })).toThrow(RangeError)
    expect(() => EntityStore.fromColumns({ ...c, highWater: 5.5 })).toThrow(RangeError)
  })

  it('refuses a row that is empty but not zeroed', () => {
    const c = filled().toColumns()
    expect(() => EntityStore.fromColumns({ ...c, x: [0, 9, 2, 3, 0, 5] })).toThrow(RangeError)
  })

  it.each(COLUMN_NAMES.filter((name) => name !== 'kind'))(
    'refuses an empty row whose %s is not back to its empty value',
    (name) => {
      const c = filled().toColumns()
      const column = [...c[name]]
      column[1] = name === 'owner' ? 3 : 1 // row 1 is empty: its owner should be 255, the rest 0
      expect(() => EntityStore.fromColumns({ ...c, [name]: column })).toThrow(
        /empty but not zeroed/
      )
    }
  )

  it('copies: changing the columns afterwards does not change the store', () => {
    const c = filled().toColumns()
    const store = EntityStore.fromColumns(c)
    c.x[0] = 999
    expect(store.x[0]).toBe(0)
  })
})
