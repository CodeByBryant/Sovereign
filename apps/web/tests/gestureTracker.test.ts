import { describe, expect, it } from 'vitest'
import { GestureTracker, type GestureEvent } from '../src/input/GestureTracker'

const pans = (events: GestureEvent[]) => events.filter((e) => e.type === 'pan')
const pinches = (events: GestureEvent[]) => events.filter((e) => e.type === 'pinch')

describe('one finger (or a mouse)', () => {
  it('pans by how far the pointer moved since the last event', () => {
    const g = new GestureTracker()
    g.down(1, 100, 100, 0)
    expect(g.move(1, 110, 95)).toEqual([{ type: 'pan', dx: 10, dy: -5 }])
    expect(g.move(1, 112, 95)).toEqual([{ type: 'pan', dx: 2, dy: 0 }])
  })

  it('emits nothing when the pointer has not moved', () => {
    const g = new GestureTracker()
    g.down(1, 100, 100, 0)
    expect(g.move(1, 100, 100)).toEqual([])
  })

  it('ignores moves of a pointer that is not down (a hovering mouse)', () => {
    const g = new GestureTracker()
    expect(g.move(1, 50, 50)).toEqual([])
    expect(g.active).toBe(0)
  })
})

describe('a tap', () => {
  it('is a quick release near where the pointer went down', () => {
    const g = new GestureTracker()
    g.down(1, 100, 100, 1000)
    expect(g.up(1, 103, 101, 1120)).toEqual([{ type: 'tap', at: { x: 103, y: 101 } }])
  })

  it('is not a tap if the pointer travelled further than the tap distance', () => {
    const g = new GestureTracker({ tapMaxDistance: 10 })
    g.down(1, 100, 100, 0)
    g.move(1, 120, 100)
    expect(g.up(1, 120, 100, 100)).toEqual([])
  })

  it('is not a tap if the pointer was ever dragged past the tap distance, even if it came back', () => {
    const g = new GestureTracker({ tapMaxDistance: 10 })
    g.down(1, 100, 100, 0)
    g.move(1, 140, 100)
    g.move(1, 101, 100)
    // it ends 1px from the start, but it was dragged: that is a pan, not a tap
    expect(g.up(1, 101, 100, 100)).toEqual([])
  })

  it('is not a tap if the pointer was held down too long', () => {
    const g = new GestureTracker({ tapMaxMs: 300 })
    g.down(1, 100, 100, 0)
    expect(g.up(1, 100, 100, 301)).toEqual([])
    g.down(2, 100, 100, 1000)
    expect(g.up(2, 100, 100, 1300)).toHaveLength(1)
  })

  it('has a default tap distance of 10 px and a default time of 300 ms', () => {
    const g = new GestureTracker()
    g.down(1, 0, 0, 0)
    expect(g.up(1, 10, 0, 300)).toHaveLength(1)
    g.down(2, 0, 0, 0)
    expect(g.up(2, 11, 0, 100)).toEqual([])
    g.down(3, 0, 0, 0)
    expect(g.up(3, 0, 0, 301)).toEqual([])
  })

  it('never follows a two-finger gesture, even for the finger that stays last', () => {
    const g = new GestureTracker()
    g.down(1, 100, 100, 0)
    g.down(2, 200, 100, 10)
    expect(g.up(2, 200, 100, 50)).toEqual([])
    expect(g.up(1, 100, 100, 60)).toEqual([])
  })

  it('is possible again once every finger is up', () => {
    const g = new GestureTracker()
    g.down(1, 0, 0, 0)
    g.down(2, 50, 0, 0)
    g.up(1, 0, 0, 10)
    g.up(2, 50, 0, 10)
    g.down(3, 20, 20, 1000)
    expect(g.up(3, 20, 20, 1050)).toEqual([{ type: 'tap', at: { x: 20, y: 20 } }])
  })

  it('is not produced by a pointer that was cancelled', () => {
    const g = new GestureTracker()
    g.down(1, 0, 0, 0)
    g.cancel(1)
    expect(g.up(1, 0, 0, 10)).toEqual([])
  })
})

describe('two fingers', () => {
  it('pinch by the ratio of the distance between them, anchored at their midpoint', () => {
    const g = new GestureTracker()
    g.down(1, 100, 100, 0)
    g.down(2, 200, 100, 0)
    // second finger moves out: distance 100 -> 150, midpoint (100+250)/2 = 175
    const events = g.move(2, 250, 100)
    expect(pinches(events)).toEqual([
      { type: 'pinch', scale: 1.5, anchor: { x: 175, y: 100 }, dx: 25, dy: 0 }
    ])
    expect(pans(events)).toEqual([])
  })

  it('pinches in: a ratio below 1', () => {
    const g = new GestureTracker()
    g.down(1, 0, 0, 0)
    g.down(2, 100, 0, 0)
    const [pinch] = pinches(g.move(2, 50, 0)) as Array<Extract<GestureEvent, { type: 'pinch' }>>
    expect(pinch.scale).toBe(0.5)
  })

  it('reports the midpoint movement so a two-finger drag also pans', () => {
    // both fingers move by (+10, +10), one event each: the scales multiply back to 1 and the
    // midpoint movements add up to (10, 10)
    const g = new GestureTracker()
    g.down(1, 100, 100, 0)
    g.down(2, 200, 100, 0)
    const all = [...g.move(1, 110, 110), ...g.move(2, 210, 110)] as Array<
      Extract<GestureEvent, { type: 'pinch' }>
    >
    expect(all.every((e) => e.type === 'pinch')).toBe(true)
    expect(all.reduce((s, e) => s * e.scale, 1)).toBeCloseTo(1, 9)
    expect(all.reduce((s, e) => s + e.dx, 0)).toBeCloseTo(10, 9)
    expect(all.reduce((s, e) => s + e.dy, 0)).toBeCloseTo(10, 9)
  })

  it('is relative to the previous event, so successive scales multiply to the whole pinch', () => {
    const g = new GestureTracker()
    g.down(1, 0, 0, 0)
    g.down(2, 100, 0, 0)
    const a = g.move(2, 120, 0)[0] as Extract<GestureEvent, { type: 'pinch' }>
    const b = g.move(2, 150, 0)[0] as Extract<GestureEvent, { type: 'pinch' }>
    expect(a.scale * b.scale).toBeCloseTo(1.5)
  })

  it('does not jump when a second finger lands (no event until something moves)', () => {
    const g = new GestureTracker()
    g.down(1, 100, 100, 0)
    g.move(1, 120, 100)
    expect(g.down(2, 300, 300, 50)).toBeUndefined()
    expect(g.move(1, 120, 100)).toEqual([])
  })

  it('does not jump when one finger lifts: the one left pans from where it is', () => {
    const g = new GestureTracker()
    g.down(1, 100, 100, 0)
    g.down(2, 300, 100, 0)
    g.move(2, 320, 100)
    g.up(1, 100, 100, 100)
    expect(g.active).toBe(1)
    expect(g.move(2, 330, 105)).toEqual([{ type: 'pan', dx: 10, dy: 5 }])
  })

  it('survives a degenerate pinch of two fingers at the same point', () => {
    const g = new GestureTracker()
    g.down(1, 100, 100, 0)
    g.down(2, 100, 100, 0)
    const events = g.move(2, 110, 100)
    for (const e of events) {
      if (e.type === 'pinch') {
        expect(Number.isFinite(e.scale)).toBe(true)
        expect(e.scale).toBe(1)
      }
    }
  })
})

describe('more than two fingers, and bookkeeping', () => {
  it('ignores a third finger: only the first two drive the pinch', () => {
    const g = new GestureTracker()
    g.down(1, 0, 0, 0)
    g.down(2, 100, 0, 0)
    g.down(3, 500, 500, 0)
    expect(g.move(3, 520, 520)).toEqual([])
    const [pinch] = pinches(g.move(2, 150, 0)) as Array<Extract<GestureEvent, { type: 'pinch' }>>
    expect(pinch.scale).toBe(1.5)
  })

  it('promotes a waiting third finger when one of the first two lifts, without a jump', () => {
    const g = new GestureTracker()
    g.down(1, 0, 0, 0)
    g.down(2, 100, 0, 0)
    g.down(3, 400, 0, 0)
    g.up(1, 0, 0, 10)
    // pointers 2 and 3 now drive the pinch; the first event after the switch is relative to now
    expect(pinches(g.move(2, 100, 0))).toEqual([])
    const [pinch] = pinches(g.move(3, 500, 0)) as Array<Extract<GestureEvent, { type: 'pinch' }>>
    expect(pinch.scale).toBeCloseTo(400 / 300)
  })

  it('counts active pointers', () => {
    const g = new GestureTracker()
    expect(g.active).toBe(0)
    g.down(1, 0, 0, 0)
    g.down(2, 0, 0, 0)
    expect(g.active).toBe(2)
    g.cancel(1)
    expect(g.active).toBe(1)
    g.up(2, 0, 0, 0)
    expect(g.active).toBe(0)
  })

  it('cancel with no id forgets every pointer', () => {
    const g = new GestureTracker()
    g.down(1, 0, 0, 0)
    g.down(2, 0, 0, 0)
    g.cancel()
    expect(g.active).toBe(0)
    expect(g.move(1, 10, 10)).toEqual([])
  })

  it('ignores up and cancel of a pointer it never saw', () => {
    const g = new GestureTracker()
    expect(g.up(9, 0, 0, 0)).toEqual([])
    expect(() => g.cancel(9)).not.toThrow()
  })

  it('restarts a pointer that goes down twice with the same id', () => {
    const g = new GestureTracker()
    g.down(1, 0, 0, 0)
    g.down(1, 50, 50, 100)
    expect(g.active).toBe(1)
    expect(g.move(1, 55, 50)).toEqual([{ type: 'pan', dx: 5, dy: 0 }])
  })
})
