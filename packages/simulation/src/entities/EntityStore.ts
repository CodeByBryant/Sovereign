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
}

const INITIAL_CAPACITY = 256

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
    this.alive_ -= 1
    if (id < this.firstFree) this.firstFree = id
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
  }
}
