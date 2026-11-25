/**
 * @module sprites/UnitInterpolator
 * @description Smooths unit movement on the main thread. The world sends where every unit is each time it
 * has run some ticks; a screen draws sixty frames a second. The interpolator glides each unit from where
 * it is shown now to where the newest snapshot puts it, over about as long as the snapshots are apart, so
 * movement looks continuous at any speed. It is only a picture: it never feeds back into the simulation.
 *
 * Snapshots list units by ascending id (the engine iterates by id), so two snapshots are matched with a
 * merge, without a map.
 */
import type { UnitSnapshot } from '@sovereign/contracts'

export interface UnitInterpolatorOptions {
  /** Shortest glide, in milliseconds. @default 40 */
  minMs?: number
  /** Longest glide, in milliseconds. @default 500 */
  maxMs?: number
  /** A unit that moved further than this many tiles jumps instead of gliding (a long run of ticks). @default 40 */
  jumpTiles?: number
}

/** The units to draw this frame. The arrays are views that stay valid until the next `sample`. */
export interface UnitFrame {
  count: number
  id: Uint32Array
  kind: Uint8Array
  owner: Uint8Array
  /** What each unit is doing (a `UnitState`) and the resource it carries (0 for none). */
  state: Uint8Array
  carry: Uint8Array
  x: Float32Array
  y: Float32Array
}

export class UnitInterpolator {
  private readonly minMs: number
  private readonly maxMs: number
  private readonly jumpTiles: number
  private count = 0
  private id = new Uint32Array(0)
  private kind = new Uint8Array(0)
  private owner = new Uint8Array(0)
  private state = new Uint8Array(0)
  private carry = new Uint8Array(0)
  private fromX = new Float32Array(0)
  private fromY = new Float32Array(0)
  private toX = new Float32Array(0)
  private toY = new Float32Array(0)
  private outX = new Float32Array(0)
  private outY = new Float32Array(0)
  private start = 0
  private duration = 1
  private lastPush = Number.NaN

  constructor(options: UnitInterpolatorOptions = {}) {
    this.minMs = options.minMs ?? 40
    this.maxMs = options.maxMs ?? 500
    this.jumpTiles = options.jumpTiles ?? 40
  }

  /** Take a new snapshot, received at `nowMs`. */
  push(snapshot: UnitSnapshot, nowMs: number): void {
    const n = snapshot.count
    // where the old units are shown right now: the new glides start there
    const shown = this.sample(nowMs)
    const oldCount = this.count
    const oldId = this.id.slice(0, oldCount)
    const oldX = Float32Array.from(shown.x)
    const oldY = Float32Array.from(shown.y)

    const fromX = new Float32Array(n)
    const fromY = new Float32Array(n)
    let i = 0
    for (let j = 0; j < n; j += 1) {
      const id = snapshot.id[j] as number
      const x = snapshot.x[j] as number
      const y = snapshot.y[j] as number
      while (i < oldCount && (oldId[i] as number) < id) i += 1
      if (i < oldCount && oldId[i] === id) {
        const ox = oldX[i] as number
        const oy = oldY[i] as number
        const far = Math.max(Math.abs(x - ox), Math.abs(y - oy)) > this.jumpTiles
        fromX[j] = far ? x : ox
        fromY[j] = far ? y : oy
      } else {
        fromX[j] = x
        fromY[j] = y
      }
    }
    this.count = n
    this.id = Uint32Array.from(snapshot.id.subarray(0, n))
    this.kind = Uint8Array.from(snapshot.kind.subarray(0, n))
    this.owner = Uint8Array.from(snapshot.owner.subarray(0, n))
    this.state = Uint8Array.from(snapshot.state.subarray(0, n))
    this.carry = Uint8Array.from(snapshot.carry.subarray(0, n))
    this.toX = Float32Array.from(snapshot.x.subarray(0, n))
    this.toY = Float32Array.from(snapshot.y.subarray(0, n))
    this.fromX = fromX
    this.fromY = fromY
    this.outX = new Float32Array(n)
    this.outY = new Float32Array(n)
    const gap = Number.isNaN(this.lastPush) ? this.maxMs : nowMs - this.lastPush
    this.duration = Math.min(this.maxMs, Math.max(this.minMs, gap))
    this.start = nowMs
    this.lastPush = nowMs
  }

  /** Where every unit is at `nowMs`. */
  sample(nowMs: number): UnitFrame {
    const n = this.count
    const t = Math.min(1, Math.max(0, (nowMs - this.start) / this.duration))
    for (let i = 0; i < n; i += 1) {
      const fx = this.fromX[i] as number
      const fy = this.fromY[i] as number
      this.outX[i] = fx + ((this.toX[i] as number) - fx) * t
      this.outY[i] = fy + ((this.toY[i] as number) - fy) * t
    }
    return {
      count: n,
      id: this.id,
      kind: this.kind,
      owner: this.owner,
      state: this.state,
      carry: this.carry,
      x: this.outX,
      y: this.outY
    }
  }
}
