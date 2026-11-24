import { describe, expect, it } from 'vitest'
import { Pacer } from '../src/host/Pacer'

describe('Pacer: real time into whole ticks', () => {
  it('gives a tick per day at 1 day a second: a second of frames is one tick', () => {
    const pacer = new Pacer()
    let total = 0
    for (let frame = 0; frame < 5; frame += 1) total += pacer.advance(200, 1, 1)
    expect(total).toBe(1)
  })

  it('gives ticks in proportion to the speed', () => {
    expect(new Pacer().advance(200, 10, 1)).toBe(2)
    expect(new Pacer().advance(200, 100, 1)).toBe(20)
    expect(new Pacer().advance(200, 1000, 1)).toBe(200)
    expect(new Pacer().advance(100, 100, 1)).toBe(10)
  })

  it('divides by the days a tick lasts', () => {
    expect(new Pacer().advance(200, 10, 0.5)).toBe(4)
    expect(new Pacer().advance(200, 10, 2)).toBe(1)
  })

  it('keeps the fraction it could not run yet, so frames add up to the right total', () => {
    const pacer = new Pacer()
    let total = 0
    for (let frame = 0; frame < 60; frame += 1) total += pacer.advance(1000 / 60, 10, 1)
    expect(total).toBeGreaterThanOrEqual(9)
    expect(total).toBeLessThanOrEqual(10)
    // a few more frames bring it to exactly what a second at 10 a second is worth
    total += pacer.advance(1000 / 60 + 0.001, 10, 1)
    expect(total).toBeLessThanOrEqual(10)
  })

  it('gives nothing for a frame too short to be worth a tick, and remembers it', () => {
    const pacer = new Pacer()
    expect(pacer.advance(40, 10, 1)).toBe(0) // 0.4 of a tick
    expect(pacer.advance(40, 10, 1)).toBe(0) // 0.8
    expect(pacer.advance(40, 10, 1)).toBe(1) // 1.2: one tick, 0.2 kept
    expect(pacer.advance(80, 10, 1)).toBe(1) // 0.2 + 0.8 = 1.0
  })

  it('does not run a long stall as a burst: a tab that was hidden catches up by a quarter of a second at most', () => {
    const pacer = new Pacer()
    expect(pacer.advance(60000, 10, 1)).toBe(2) // 250 ms at 10 a second is 2.5 ticks
  })

  it('never asks for more ticks than a cap, and drops the backlog rather than chase it', () => {
    const pacer = new Pacer(50)
    expect(pacer.advance(250, 1000, 1)).toBe(50) // 250 would be due
    expect(pacer.advance(0, 1000, 1)).toBe(0) // the rest is dropped, not carried
  })

  it('ignores time that does not move forward', () => {
    const pacer = new Pacer()
    expect(pacer.advance(-50, 10, 1)).toBe(0)
    expect(pacer.advance(0, 10, 1)).toBe(0)
    expect(pacer.advance(100, 10, 1)).toBe(1)
  })

  it('forgets the fraction on reset (a pause, a new world)', () => {
    const pacer = new Pacer()
    pacer.advance(80, 10, 1) // 0.8 kept
    pacer.reset()
    expect(pacer.advance(40, 10, 1)).toBe(0)
  })

  it('gives nothing for a speed or a timestep that is not above 0', () => {
    expect(new Pacer().advance(200, 0, 1)).toBe(0)
    expect(new Pacer().advance(200, 10, 0)).toBe(0)
    expect(new Pacer().advance(200, Number.NaN, 1)).toBe(0)
  })
})
