import { describe, expect, it } from 'vitest'
import { decodeWorld, encodeWorld } from '../src/serialization/save'
import { World } from '../src/world/World'
import { smallWorldOverrides } from './support/worldOptions'

const make = (seed: number, options = {}): World =>
  World.create({ seed, config: smallWorldOverrides({ nations: 6, ...options }) })

/** Run until nothing changes any more (or `limit` ticks), and say how many ticks it took. */
function runToSaturation(world: World, limit = 40000): number {
  let ticks = 0
  while (!world.saturated && ticks < limit) {
    world.step()
    ticks += 1
  }
  return ticks
}

const provincesHeld = (w: World): number =>
  w.nations.reduce((n, nation) => n + nation.provinces.size, 0)

describe('World.step grows the nations', () => {
  it('starts with no claims, and nations that still have room', () => {
    const w = make(11)
    expect(w.expansionClaims).toBe(0)
    expect(w.saturated).toBe(false)
  })

  it('claims provinces as time passes, and stays a valid world all along', () => {
    const w = make(11)
    const start = provincesHeld(w)
    for (const ticks of [1, 9, 40, 150]) {
      w.run(ticks)
      expect(w.validate()).toEqual([])
    }
    expect(provincesHeld(w)).toBeGreaterThan(start)
    expect(w.expansionClaims).toBe(provincesHeld(w) - start)
  })

  it('serves the nations in rotating order, expansion before the clock moves', () => {
    const w = make(11)
    const tickBefore = w.clock.tick
    w.step()
    expect(w.clock.tick).toBe(tickBefore + 1)
    expect(w.nations.every((n) => n.expansionPoints > 0)).toBe(true) // each earned its first day's points
  })

  it('grows until nothing free can be reached, then the borders hold still', () => {
    const w = make(11)
    const ticks = runToSaturation(w)
    expect(w.saturated).toBe(true)
    expect(ticks).toBeLessThan(40000)
    expect(w.validate()).toEqual([])

    const owners = Array.from(w.provinceOwner)
    const claims = w.expansionClaims
    const lists = w.nations.map((n) => [...n.provinces])
    w.run(500)
    expect(w.expansionClaims).toBe(claims)
    expect(Array.from(w.provinceOwner)).toEqual(owners)
    expect(w.nations.map((n) => [...n.provinces])).toEqual(lists)
    expect(w.nations.every((n) => n.expansionPoints === 0)).toBe(true)
  })

  it('leaves no free province next to a nation, bar ice', () => {
    const w = make(11)
    runToSaturation(w)
    const p = w.provinces
    for (const n of w.nations) {
      for (const held of n.provinces) {
        for (let k = p.neighbourStart[held]!; k < p.neighbourStart[held + 1]!; k += 1) {
          const next = p.neighbourId[k]!
          // a province beside a nation that nobody holds can only be one nobody can hold: mostly ice
          if (w.provinceOwner[next] === 255) expect(w.claimable[next]).toBe(0)
        }
      }
    }
  })

  it('keeps each nation in one piece: every province it claims touches one it held', () => {
    const w = make(11)
    const p = w.provinces
    runToSaturation(w)
    for (const n of w.nations) {
      const held = new Set<number>()
      for (const id of n.provinces) {
        if (held.size > 0) {
          const near = Array.from(
            p.neighbourId.subarray(p.neighbourStart[id], p.neighbourStart[id + 1])
          )
          expect(near.some((q) => held.has(q))).toBe(true)
        }
        held.add(id)
      }
    }
  })

  it('follows the land: every nation has the stats of its profile, which is the sum of its provinces', () => {
    const w = make(11)
    w.run(400)
    expect(w.validate()).toEqual([]) // validate() checks both
  })
})

describe('World: replay and save', () => {
  it('replays to the same hash: the same seed and ticks give the same world', () => {
    const a = make(7)
    const b = make(7)
    a.run(300)
    b.run(300)
    expect(a.stateHash()).toBe(b.stateHash())
  })

  it('is different after a different number of ticks while growing', () => {
    const a = make(7)
    const b = make(7)
    a.run(100)
    b.run(101)
    expect(a.stateHash()).not.toBe(b.stateHash())
  })

  it('goes on exactly the same after being saved and restored mid-run', () => {
    const a = make(7)
    a.run(120)
    const b = decodeWorld(encodeWorld(a))
    expect(b.stateHash()).toBe(a.stateHash())
    a.run(180)
    b.run(180)
    expect(b.stateHash()).toBe(a.stateHash())
    expect(b.expansionClaims).toBeGreaterThan(0)
  })

  it('restores a saturated world as saturated', () => {
    const a = make(7)
    runToSaturation(a)
    const b = decodeWorld(encodeWorld(a))
    expect(b.saturated).toBe(true)
    expect(b.stateHash()).toBe(a.stateHash())
  })

  it('grows a different world differently', () => {
    const a = make(7)
    const b = make(8)
    a.run(200)
    b.run(200)
    expect(a.stateHash()).not.toBe(b.stateHash())
  })
})

describe('World.snapshot after growth', () => {
  it('reports the area and province count the nations have grown to', () => {
    const w = make(11)
    const before = w.snapshot()
    w.run(300)
    const after = w.snapshot()
    after.nations.forEach((n, i) => {
      expect(n.area).toBe(w.nations[i]!.profile.area)
      expect(n.provinceCount).toBe(w.nations[i]!.provinces.size)
      expect(n.area).toBeGreaterThanOrEqual(before.nations[i]!.area)
    })
    expect(after.tick).toBe(300)
  })
})
