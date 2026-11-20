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
