/**
 * @module GestureTracker
 * @description Turns a stream of pointer events (a mouse, one finger, two fingers) into map
 * gestures: pan, pinch and tap. Pure logic with no DOM, so it is tested without a browser; the map
 * view feeds it `pointerdown/move/up/cancel` and applies what it returns to the camera.
 *
 * - One pointer moving is a **pan** by how far it moved since the last event.
 * - Two pointers moving is a **pinch**: `scale` is the change in the distance between them since the
 *   last event, anchored at their midpoint, and `dx`/`dy` is the midpoint's movement (a two-finger
 *   drag pans as well). Only the first two pointers count; a third is ignored until one of them lifts.
 * - A pointer released quickly, that never strayed far from where it went down and had no second
 *   finger involved, is a **tap** (a drag that ends where it began is still a drag).
 *
 * Gaining or losing a finger never produces a jump: the baseline is reset to the current positions.
 */

export interface Point {
  x: number
  y: number
}

export type GestureEvent =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'pinch'; scale: number; anchor: Point; dx: number; dy: number }
  | { type: 'tap'; at: Point }

export interface GestureOptions {
  /** Furthest (px) a pointer may be from where it went down and still count as a tap. */
  tapMaxDistance?: number
  /** Longest (ms) a pointer may be down and still count as a tap. */
  tapMaxMs?: number
}

interface Pointer {
  id: number
  x: number
  y: number
  startX: number
  startY: number
  startTime: number
  /** The furthest the pointer has been from where it went down. */
  drift: number
}

export class GestureTracker {
  private pointers: Pointer[] = []
  /** A second finger touched during this gesture, so it is not a tap. */
  private multi = false
  private lastDistance = 0
  private lastMid: Point = { x: 0, y: 0 }
  private readonly tapMaxDistance: number
  private readonly tapMaxMs: number

  constructor(options: GestureOptions = {}) {
    this.tapMaxDistance = options.tapMaxDistance ?? 10
    this.tapMaxMs = options.tapMaxMs ?? 300
  }

  /** The number of pointers currently down. */
  get active(): number {
    return this.pointers.length
  }

  down(id: number, x: number, y: number, time: number): void {
    this.pointers = this.pointers.filter((p) => p.id !== id)
    this.pointers.push({ id, x, y, startX: x, startY: y, startTime: time, drift: 0 })
    if (this.pointers.length === 1) this.multi = false
    if (this.pointers.length >= 2) this.multi = true
    if (this.pointers.length === 2) this.resetBaseline()
  }

  move(id: number, x: number, y: number): GestureEvent[] {
    const pointer = this.pointers.find((p) => p.id === id)
    if (pointer === undefined) return []
    const dx = x - pointer.x
    const dy = y - pointer.y
    pointer.x = x
    pointer.y = y
    pointer.drift = Math.max(pointer.drift, Math.hypot(x - pointer.startX, y - pointer.startY))

    if (this.pointers.length === 1) {
      return dx === 0 && dy === 0 ? [] : [{ type: 'pan', dx, dy }]
    }
    // only the first two pointers count; a third moving leaves this pair, and so the result, unchanged
    const [a, b] = this.pointers
    const distance = Math.hypot(b.x - a.x, b.y - a.y)
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const scale = this.lastDistance > 0 ? distance / this.lastDistance : 1
    const midDx = mid.x - this.lastMid.x
    const midDy = mid.y - this.lastMid.y
    this.lastDistance = distance
    this.lastMid = mid
    if (scale === 1 && midDx === 0 && midDy === 0) return []
    return [{ type: 'pinch', scale, anchor: mid, dx: midDx, dy: midDy }]
  }

  up(id: number, x: number, y: number, time: number): GestureEvent[] {
    const pointer = this.pointers.find((p) => p.id === id)
    if (pointer === undefined) return []
    const isTap =
      this.pointers.length === 1 &&
      !this.multi &&
      Math.max(pointer.drift, Math.hypot(x - pointer.startX, y - pointer.startY)) <=
        this.tapMaxDistance &&
      time - pointer.startTime <= this.tapMaxMs
    this.remove(id)
    return isTap ? [{ type: 'tap', at: { x, y } }] : []
  }

  /** A pointer was cancelled (or left the map): forget it, with no tap. No id forgets them all. */
  cancel(id?: number): void {
    if (id === undefined) {
      this.pointers = []
      this.multi = false
      return
    }
    this.remove(id)
  }

  private remove(id: number): void {
    this.pointers = this.pointers.filter((p) => p.id !== id)
    if (this.pointers.length === 0) this.multi = false
    if (this.pointers.length === 2) this.resetBaseline()
  }

  private resetBaseline(): void {
    const [a, b] = this.pointers
    this.lastDistance = Math.hypot(b.x - a.x, b.y - a.y)
    this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
}
