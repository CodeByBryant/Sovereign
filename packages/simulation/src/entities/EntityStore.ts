/**
 * @module EntityStore
 * @description Everything that lives and acts in the world is a row here: struct-of-arrays, one typed array per
 * field, so thousands of units cost no per-object memory and a system sweeps plain numbers.
 *
 * Ids are row indices. **The lowest free id is always the next one handed out**, whatever order rows were freed
 * in, so the ids a world allocates depend only on which rows are alive, never on the history that got it
 * there: a world restored from a save allocates exactly as the original would have. Rows are visited in id
 * order, always. A row is alive when its `kind` is not 0; a freed row is zeroed (its owner back to "none").
 *
 * Only plain numbers live here. Anything derived (a route a unit is walking, the unit's position between two
 * events) is rebuilt from these fields, so it never has to be saved.
 */
import { EntityKind, NO_OWNER } from '@sovereign/contracts'

/** What a new row is given; everything but the kind and the tile defaults to 0 (and the owner to none). */
export interface SpawnInput {
  kind: number
  /** The tile the entity is on, 0 to 65535 each way. */
  x: number
  y: number
  owner?: number
  state?: number
  /** The route-grid cell it calls home. */
  home?: number
  /** The route-grid cell it is heading for. */
  target?: number
  /** The tick it next needs attention. */
  wake?: number
  /** The tick its current leg started and the tick it arrives. */
  legStart?: number
  legEnd?: number
  /** The row of the hall it belongs to, plus one (0 for none). */
  hall?: number
  /** The resource node it is working or walking to, plus one (0 for none). */
  goal?: number
  /** What it carries: a resource id (0 for nothing) and how many units. */
  carriedType?: number
  carriedCount?: number
}

const INITIAL_CAPACITY = 256

/** Every column of a store up to its high water mark, as plain numbers (what a save holds). */
export interface EntityColumns {
  highWater: number
  kind: number[]
  x: number[]
  y: number[]
  owner: number[]
  state: number[]
  home: number[]
  target: number[]
  wake: number[]
  legStart: number[]
  legEnd: number[]
  hall: number[]
  goal: number[]
  carriedType: number[]
  carriedCount: number[]
}

/** The columns, in the order they are saved and hashed. */
export const COLUMN_NAMES = [
  'kind',
  'x',
  'y',
  'owner',
  'state',
  'home',
  'target',
  'wake',
  'legStart',
  'legEnd',
  'hall',
  'goal',
  'carriedType',
  'carriedCount'
] as const

/** The columns and the range each value must be in (the width of the typed array that holds it). */
const COLUMN_RANGES = {
  kind: [0, 255],
  x: [0, 65535],
  y: [0, 65535],
  owner: [0, 255],
  state: [0, 255],
  home: [-2147483648, 2147483647],
  target: [-2147483648, 2147483647],
  wake: [-2147483648, 2147483647],
  legStart: [-2147483648, 2147483647],
  legEnd: [-2147483648, 2147483647],
  hall: [0, 2147483647],
  goal: [0, 2147483647],
  carriedType: [0, 255],
  carriedCount: [0, 255]
} as const

export class EntityStore {
  kind: Uint8Array
  x: Uint16Array
  y: Uint16Array
  owner: Uint8Array
  state: Uint8Array
  home: Int32Array
  target: Int32Array
  wake: Int32Array
  legStart: Int32Array
  legEnd: Int32Array
  hall: Int32Array
  goal: Int32Array
  carriedType: Uint8Array
  carriedCount: Uint8Array

  private alive_ = 0
  private highWater_ = 0
  /** No row below this id is free. */
  private firstFree = 0

  constructor(capacity = INITIAL_CAPACITY) {
    const n = Math.max(1, capacity)
    this.kind = new Uint8Array(n)
    this.x = new Uint16Array(n)
    this.y = new Uint16Array(n)
    this.owner = new Uint8Array(n).fill(NO_OWNER)
    this.state = new Uint8Array(n)
    this.home = new Int32Array(n)
    this.target = new Int32Array(n)
    this.wake = new Int32Array(n)
    this.legStart = new Int32Array(n)
    this.legEnd = new Int32Array(n)
    this.hall = new Int32Array(n)
    this.goal = new Int32Array(n)
    this.carriedType = new Uint8Array(n)
    this.carriedCount = new Uint8Array(n)
  }

  /** How many rows are alive. */
  get count(): number {
    return this.alive_
  }

  /** One past the highest id ever handed out: rows from here on were never used. */
  get highWater(): number {
    return this.highWater_
  }

  /** True if `id` is a row that is alive. */
  alive(id: number): boolean {
    return (
      Number.isInteger(id) && id >= 0 && id < this.highWater_ && this.kind[id] !== EntityKind.None
    )
  }

  /** Add an entity and return its id: the lowest that is free. */
  spawn(input: SpawnInput): number {
    const { kind, x, y } = input
    if (!Number.isInteger(kind) || kind <= 0 || kind > 255) {
      throw new RangeError('an entity needs a kind from 1 to 255')
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 65535 || y > 65535) {
      throw new RangeError('an entity must be on a tile from 0 to 65535 each way')
    }
    let id = this.firstFree
    while (id < this.highWater_ && this.kind[id] !== EntityKind.None) id += 1
    if (id === this.highWater_) {
      if (id === this.kind.length) this.grow()
      this.highWater_ += 1
    }
    this.kind[id] = kind
    this.x[id] = x
    this.y[id] = y
    this.owner[id] = input.owner ?? NO_OWNER
    this.state[id] = input.state ?? 0
    this.home[id] = input.home ?? 0
    this.target[id] = input.target ?? 0
    this.wake[id] = input.wake ?? 0
    this.legStart[id] = input.legStart ?? 0
    this.legEnd[id] = input.legEnd ?? 0
    this.hall[id] = input.hall ?? 0
    this.goal[id] = input.goal ?? 0
    this.carriedType[id] = input.carriedType ?? 0
    this.carriedCount[id] = input.carriedCount ?? 0
    this.alive_ += 1
    this.firstFree = id + 1
    return id
  }

  /** Remove an entity: its row is zeroed and its id may be handed out again. */
  despawn(id: number): void {
    if (!this.alive(id)) throw new RangeError(`there is no entity ${id} to remove`)
    this.kind[id] = EntityKind.None
    this.x[id] = 0
    this.y[id] = 0
    this.owner[id] = NO_OWNER
    this.state[id] = 0
    this.home[id] = 0
    this.target[id] = 0
    this.wake[id] = 0
    this.legStart[id] = 0
    this.legEnd[id] = 0
    this.hall[id] = 0
    this.goal[id] = 0
    this.carriedType[id] = 0
    this.carriedCount[id] = 0
    this.alive_ -= 1
    if (id < this.firstFree) this.firstFree = id
  }

  /** Every column up to the high water mark, copied. */
  toColumns(): EntityColumns {
    const n = this.highWater_
    return {
      highWater: n,
      kind: Array.from(this.kind.subarray(0, n)),
      x: Array.from(this.x.subarray(0, n)),
      y: Array.from(this.y.subarray(0, n)),
      owner: Array.from(this.owner.subarray(0, n)),
      state: Array.from(this.state.subarray(0, n)),
      home: Array.from(this.home.subarray(0, n)),
      target: Array.from(this.target.subarray(0, n)),
      wake: Array.from(this.wake.subarray(0, n)),
      legStart: Array.from(this.legStart.subarray(0, n)),
      legEnd: Array.from(this.legEnd.subarray(0, n)),
      hall: Array.from(this.hall.subarray(0, n)),
      goal: Array.from(this.goal.subarray(0, n)),
      carriedType: Array.from(this.carriedType.subarray(0, n)),
      carriedCount: Array.from(this.carriedCount.subarray(0, n))
    }
  }

  /** Rebuild a store from columns made by {@link toColumns}; the columns are copied and checked. */
  static fromColumns(columns: EntityColumns): EntityStore {
    const n = columns.highWater
    if (!Number.isInteger(n) || n < 0)
      throw new RangeError('the high water mark must be a whole number of 0 or more')
    for (const name of COLUMN_NAMES) {
      const values = columns[name]
      if (!Array.isArray(values) || values.length !== n) {
        throw new RangeError(`the column ${name} must have ${n} values`)
      }
      const [lo, hi] = COLUMN_RANGES[name]
      for (const v of values) {
        if (!Number.isInteger(v) || v < lo || v > hi) {
          throw new RangeError(`the column ${name} has the value ${v}, which does not fit`)
        }
      }
    }
    const store = new EntityStore(n)
    let alive = 0
    for (let id = 0; id < n; id += 1) {
      store.kind[id] = columns.kind[id] as number
      store.x[id] = columns.x[id] as number
      store.y[id] = columns.y[id] as number
      store.owner[id] = columns.owner[id] as number
      store.state[id] = columns.state[id] as number
      store.home[id] = columns.home[id] as number
      store.target[id] = columns.target[id] as number
      store.wake[id] = columns.wake[id] as number
      store.legStart[id] = columns.legStart[id] as number
      store.legEnd[id] = columns.legEnd[id] as number
      store.hall[id] = columns.hall[id] as number
      store.goal[id] = columns.goal[id] as number
      store.carriedType[id] = columns.carriedType[id] as number
      store.carriedCount[id] = columns.carriedCount[id] as number
      if (store.kind[id] === EntityKind.None) {
        const zero =
          store.x[id] === 0 &&
          store.y[id] === 0 &&
          store.owner[id] === NO_OWNER &&
          store.state[id] === 0 &&
          store.home[id] === 0 &&
          store.target[id] === 0 &&
          store.wake[id] === 0 &&
          store.legStart[id] === 0 &&
          store.legEnd[id] === 0 &&
          store.hall[id] === 0 &&
          store.goal[id] === 0 &&
          store.carriedType[id] === 0 &&
          store.carriedCount[id] === 0
        if (!zero) throw new RangeError(`row ${id} is empty but not zeroed`)
      } else {
        alive += 1
      }
    }
    store.alive_ = alive
    store.highWater_ = n
    store.firstFree = 0
    return store
  }

  /** The ids of the living rows, lowest first. */
  *ids(): Generator<number> {
    for (let id = 0; id < this.highWater_; id += 1) {
      if (this.kind[id] !== EntityKind.None) yield id
    }
  }

  private grow(): void {
    const n = this.kind.length * 2
    const widen = <T extends Uint8Array | Uint16Array | Int32Array>(old: T, fill = 0): T => {
      const next = new (old.constructor as new (length: number) => T)(n)
      next.set(old)
      if (fill !== 0) next.fill(fill, old.length)
      return next
    }
    this.kind = widen(this.kind)
    this.x = widen(this.x)
    this.y = widen(this.y)
    this.owner = widen(this.owner, NO_OWNER)
    this.state = widen(this.state)
    this.home = widen(this.home)
    this.target = widen(this.target)
    this.wake = widen(this.wake)
    this.legStart = widen(this.legStart)
    this.legEnd = widen(this.legEnd)
    this.hall = widen(this.hall)
    this.goal = widen(this.goal)
    this.carriedType = widen(this.carriedType)
    this.carriedCount = widen(this.carriedCount)
  }
}
