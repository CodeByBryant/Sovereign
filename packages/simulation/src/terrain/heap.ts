/**
 * @module heap
 * @description A binary min-heap of (key, id) pairs for shortest-path searches. The order is **total**:
 * a smaller key pops first and equal keys pop by the smaller id, so a search gives the same result on every
 * engine and never depends on how the pushes happened to interleave. Keys and ids live in typed arrays, so a
 * search over hundreds of thousands of cells allocates nothing per push.
 *
 * Entries are never updated in place: a search pushes a cheaper entry for a cell and skips the stale one when
 * it pops ("lazy deletion").
 */
export class MinHeap {
  private keys: Float64Array
  private ids: Int32Array
  private count = 0

  constructor(capacity = 1024) {
    const size = Math.max(2, capacity)
    this.keys = new Float64Array(size)
    this.ids = new Int32Array(size)
  }

  get size(): number {
    return this.count
  }

  /** The key of the entry that `pop()` would return. */
  peekKey(): number {
    if (this.count === 0) throw new RangeError('the heap is empty')
    return this.keys[0]
  }

  push(key: number, id: number): void {
    if (this.count === this.keys.length) this.grow()
    let i = this.count
    this.count += 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(key, id, this.keys[parent], this.ids[parent])) break
      this.keys[i] = this.keys[parent]
      this.ids[i] = this.ids[parent]
      i = parent
    }
    this.keys[i] = key
    this.ids[i] = id
  }

  /** Remove the smallest entry and return its id. */
  pop(): number {
    if (this.count === 0) throw new RangeError('the heap is empty')
    const top = this.ids[0]
    this.count -= 1
    if (this.count > 0) {
      const key = this.keys[this.count]
      const id = this.ids[this.count]
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= this.count) break
        const right = child + 1
        if (
          right < this.count &&
          this.less(this.keys[right], this.ids[right], this.keys[child], this.ids[child])
        ) {
          child = right
        }
        if (!this.less(this.keys[child], this.ids[child], key, id)) break
        this.keys[i] = this.keys[child]
        this.ids[i] = this.ids[child]
        i = child
      }
      this.keys[i] = key
      this.ids[i] = id
    }
    return top
  }

  clear(): void {
    this.count = 0
  }

  private less(keyA: number, idA: number, keyB: number, idB: number): boolean {
    return keyA < keyB || (keyA === keyB && idA < idB)
  }

  private grow(): void {
    const keys = new Float64Array(this.keys.length * 2)
    const ids = new Int32Array(this.ids.length * 2)
    keys.set(this.keys)
    ids.set(this.ids)
    this.keys = keys
    this.ids = ids
  }
}
