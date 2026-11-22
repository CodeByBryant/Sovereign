import { beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from '../src/state/GameStore'

describe('resource focus', () => {
  beforeEach(() => useGameStore.getState().reset())

  it('starts on no resource at all (every resource shown)', () => {
    expect(useGameStore.getState().resourceFocus).toBe(0)
  })

  it('can focus a resource and go back to all of them', () => {
    useGameStore.getState().setResourceFocus(3)
    expect(useGameStore.getState().resourceFocus).toBe(3)
    useGameStore.getState().setResourceFocus(0)
    expect(useGameStore.getState().resourceFocus).toBe(0)
  })

  it('goes back to all resources when the game resets (a new world)', () => {
    useGameStore.getState().setResourceFocus(7)
    useGameStore.getState().reset()
    expect(useGameStore.getState().resourceFocus).toBe(0)
  })
})

describe('time', () => {
  beforeEach(() => useGameStore.getState().reset())

  it('starts paused at the first day, at a speed of 10 days a second', () => {
    const s = useGameStore.getState()
    expect(s.paused).toBe(true)
    expect(s.speed).toBe(10)
    expect(s.tick).toBe(0)
    expect(s.time).toBe(0)
    expect(s.timestep).toBe(1)
    expect(s.saturated).toBe(false)
  })

  it('plays and pauses', () => {
    useGameStore.getState().setPaused(false)
    expect(useGameStore.getState().paused).toBe(false)
    useGameStore.getState().togglePaused()
    expect(useGameStore.getState().paused).toBe(true)
    useGameStore.getState().togglePaused()
    expect(useGameStore.getState().paused).toBe(false)
  })

  it('sets a speed that is one of the speeds on offer, and refuses any other', () => {
    useGameStore.getState().setSpeed(100)
    expect(useGameStore.getState().speed).toBe(100)
    useGameStore.getState().setSpeed(7)
    expect(useGameStore.getState().speed).toBe(100)
  })

  it('goes faster and slower one step at a time, and stops at the ends', () => {
    const s = useGameStore.getState
    s().setSpeed(1)
    s().slower()
    expect(s().speed).toBe(1)
    s().faster()
    expect(s().speed).toBe(10)
    s().faster()
    s().faster()
    expect(s().speed).toBe(1000)
    s().faster()
    expect(s().speed).toBe(1000)
    s().slower()
    expect(s().speed).toBe(100)
  })

  it('keeps the clock the simulation reports', () => {
    useGameStore.getState().setClock({ tick: 40, time: 20, timestep: 0.5, saturated: true })
    const s = useGameStore.getState()
    expect([s.tick, s.time, s.timestep, s.saturated]).toEqual([40, 20, 0.5, true])
  })

  it('goes back to the start for a new world: paused, first day, default speed', () => {
    const s = useGameStore.getState
    s().setPaused(false)
    s().setSpeed(1000)
    s().setClock({ tick: 40, time: 40, timestep: 1, saturated: true })
    s().reset()
    expect([s().paused, s().speed, s().tick, s().time, s().saturated]).toEqual([
      true,
      10,
      0,
      0,
      false
    ])
  })
})
