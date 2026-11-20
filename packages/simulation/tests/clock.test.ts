import { describe, expect, it } from 'vitest'
import { SimulationClock } from '../src/clock/SimulationClock'

describe('SimulationClock', () => {
  it('starts at tick 0, time 0', () => {
    const clock = new SimulationClock(1)
    expect(clock.tick).toBe(0)
    expect(clock.time).toBe(0)
    expect(clock.deltaTime).toBe(1)
  })

  it('advances by exactly one tick per call', () => {
    const clock = new SimulationClock(0.5)
    for (let i = 1; i <= 100; i += 1) {
      clock.advance()
      expect(clock.tick).toBe(i)
    }
  })

  it('computes time as tick * deltaTime by multiplication, never by accumulating', () => {
    // Adding 0.1 ten times gives 0.9999999999999999; 10 * 0.1 is exactly 1.
    const clock = new SimulationClock(0.1)
    for (let i = 0; i < 10; i += 1) clock.advance()
    expect(clock.time).toBe(10 * 0.1)
    expect(clock.time).toBe(1)
  })

  it('can resume from a saved tick', () => {
    const clock = new SimulationClock(0.25, 40)
    expect(clock.tick).toBe(40)
    expect(clock.time).toBe(10)
    clock.advance()
    expect(clock.tick).toBe(41)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects the timestep %s', (dt) => {
    expect(() => new SimulationClock(dt)).toThrow(RangeError)
  })

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'rejects the starting tick %s',
    (tick) => {
      expect(() => new SimulationClock(1, tick)).toThrow(RangeError)
    }
  )

  it('refuses to advance past the largest safe integer, instead of losing precision', () => {
    const clock = new SimulationClock(1, Number.MAX_SAFE_INTEGER)
    expect(() => clock.advance()).toThrow(RangeError)
    expect(clock.tick).toBe(Number.MAX_SAFE_INTEGER)
  })
})
