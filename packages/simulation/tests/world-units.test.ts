import { EntityKind, UnitState } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { COLUMN_NAMES } from '../src/entities/EntityStore'
import { decodeWorld, encodeWorld } from '../src/serialization/save'
import { World } from '../src/world/World'
import { smallWorldOverrides } from './support/worldOptions'

const make = (seed = 11, units: { perNation?: number } = {}, nations = 6): World =>
  World.create({ seed, config: { ...smallWorldOverrides({ nations }), units } })

/** The living villagers of a world, by id (its halls are rows too). */
const villagersOf = (w: World): number[] =>
  [...w.entities.ids()].filter((id) => w.entities.kind[id] === EntityKind.Villager)

const cellOf = (w: World, tile: number): number => {
  const cell = w.config.routes.cell
  const x = tile % w.terrain.width
  const y = Math.floor(tile / w.terrain.width)
  return Math.floor(y / cell) * Math.ceil(w.terrain.width / cell) + Math.floor(x / cell)
}

describe('a world has villagers', () => {
  const w = make(11, { perNation: 24 })

  it('starts each nation with its share, resting at its capital', () => {
    expect(w.nations.length).toBeGreaterThan(2)
    expect(villagersOf(w).length).toBe(24 * w.nations.length)
    expect(w.entities.count).toBe(25 * w.nations.length) // and a hall each
    for (const id of villagersOf(w)) {
      const owner = w.entities.owner[id]!
      const capital = w.nations[owner]!.capital
      expect(w.entities.kind[id]).toBe(EntityKind.Villager)
      expect(w.entities.state[id]).toBe(UnitState.Rest)
      expect([w.entities.x[id], w.entities.y[id]]).toEqual([
        capital % w.terrain.width,
        Math.floor(capital / w.terrain.width)
      ])
      expect(w.entities.home[id]).toBe(cellOf(w, capital))
    }
  })

  it('has none when asked for none, or when there are no nations', () => {
    expect(villagersOf(make(11, { perNation: 0 })).length).toBe(0)
    expect(make(11, { perNation: 24 }, 0).entities.count).toBe(0) // no nations, no halls either
  })

  it('is a sound world as made', () => {
    expect(w.validate()).toEqual([])
  })
})

describe('villagers live as time passes', () => {
  it('rests, walks and rests again, and the world stays sound all along', () => {
    const w = make(11)
    const start = Array.from(w.entities.x.subarray(0, w.entities.highWater))
    let walking = 0
    for (let t = 0; t < 120; t += 1) {
      w.step()
      for (const id of w.entities.ids()) if (w.entities.state[id] === UnitState.Walk) walking += 1
      if (t % 40 === 0) expect(w.validate()).toEqual([])
    }
    expect(walking).toBeGreaterThan(0)
    expect(w.validate()).toEqual([])
    expect(Array.from(w.entities.x.subarray(0, w.entities.highWater))).not.toEqual(start)
  })

  it('walks on land, inside the map', () => {
    const w = make(11)
    for (let t = 0; t < 200; t += 1) {
      w.step()
      const snap = w.unitPositions()
      for (let i = 0; i < snap.count; i += 1) {
        expect(snap.x[i]).toBeGreaterThanOrEqual(0)
        expect(snap.x[i]).toBeLessThan(w.terrain.width)
        expect(snap.y[i]).toBeGreaterThanOrEqual(0)
        expect(snap.y[i]).toBeLessThan(w.terrain.height)
      }
    }
  })
})

describe('unitPositions: for a host to draw', () => {
  it('lists every living villager by id, with kind, owner and where it is', () => {
    const w = make(11)
    w.run(60)
    const snap = w.unitPositions()
    expect(snap.tick).toBe(60)
    expect(snap.count).toBe(villagersOf(w).length)
    expect(Array.from(snap.id)).toEqual(villagersOf(w))
    snap.id.forEach((id, i) => {
      expect(snap.kind[i]).toBe(EntityKind.Villager)
      expect(snap.owner[i]).toBe(w.entities.owner[id])
    })
  })

  it('puts a walker between where it set off and where it is going, and a rester where it rests', () => {
    const w = make(11)
    w.run(80)
    const snap = w.unitPositions()
    let walkers = 0
    snap.id.forEach((id, i) => {
      if (w.entities.state[id] === UnitState.Rest) {
        expect([snap.x[i], snap.y[i]]).toEqual([w.entities.x[id], w.entities.y[id]])
      } else {
        walkers += 1
      }
    })
    expect(walkers).toBeGreaterThan(0)
  })

  it('has no one in a world with no villagers', () => {
    const w = make(11, { perNation: 0 })
    const snap = w.unitPositions()
    expect(snap.count).toBe(0)
    expect(snap.x).toHaveLength(0)
  })
})

describe('villagers are part of the state: replay, hash and save', () => {
  it('replays to the same hash', () => {
    const a = make(7)
    const b = make(7)
    a.run(150)
    b.run(150)
    expect(a.stateHash()).toBe(b.stateHash())
  })

  it('has a hash that moves as villagers move', () => {
    const w = make(7)
    const before = w.stateHash()
    w.run(1)
    expect(w.stateHash()).not.toBe(before)
  })

  it('has a hash that sees every column of a villager', () => {
    const w = make(7)
    const id = villagersOf(w)[3]!
    const base = w.stateHash()
    for (const name of COLUMN_NAMES) {
      if (name === 'kind') continue
      const column = w.entities[name]
      const was = column[id]!
      column[id] = was === 5 ? 6 : 5
      expect(w.stateHash(), name).not.toBe(base)
      column[id] = was
      expect(w.stateHash(), name).toBe(base)
    }
  })

  it('goes on exactly the same after being saved and restored in the middle', () => {
    const a = make(7)
    a.run(90)
    const b = decodeWorld(encodeWorld(a))
    expect(b.stateHash()).toBe(a.stateHash())
    expect(b.entities.count).toBe(a.entities.count)
    a.run(260)
    b.run(260)
    expect(b.stateHash()).toBe(a.stateHash())
    expect(b.validate()).toEqual([])
  })

  it('keeps every column of every villager through a save', () => {
    const a = make(7)
    a.run(75)
    const b = decodeWorld(encodeWorld(a))
    expect(b.entities.toColumns()).toEqual(a.entities.toColumns())
  })
})

describe('validate: villagers that do not add up', () => {
  const fresh = (): { w: World; id: number } => {
    const w = make(11)
    w.run(40)
    return { w, id: villagersOf(w)[0]! }
  }
  const walkerOf = (w: World): number => {
    for (let t = 0; t < 200; t += 1) {
      for (const id of w.entities.ids()) if (w.entities.state[id] === UnitState.Walk) return id
      w.step()
    }
    throw new Error('nobody walked')
  }

  it('is sound as made', () => {
    expect(fresh().w.validate()).toEqual([])
  })

  it('catches a kind that does not exist', () => {
    const { w, id } = fresh()
    w.entities.kind[id] = 99
    expect(w.validate().join('\n')).toMatch(/unit .* kind/)
  })

  it('catches a unit off the map, or in the sea', () => {
    const { w, id } = fresh()
    const was = [w.entities.x[id]!, w.entities.y[id]!]
    w.entities.x[id] = w.terrain.width
    expect(w.validate().join('\n')).toMatch(/outside the map/)
    w.entities.x[id] = was[0]!
    let sea = -1
    for (let i = 0; i < w.terrain.elevation.length && sea < 0; i += 1)
      if (w.terrain.elevation[i]! <= w.terrain.seaLevel) sea = i
    w.entities.x[id] = sea % w.terrain.width
    w.entities.y[id] = Math.floor(sea / w.terrain.width)
    expect(w.validate().join('\n')).toMatch(/not on land/)
  })

  it('catches an owner that names no nation', () => {
    const { w, id } = fresh()
    w.entities.owner[id] = w.nations.length + 3
    expect(w.validate().join('\n')).toMatch(/owner/)
  })

  it('catches a state that is neither resting nor walking', () => {
    const { w, id } = fresh()
    w.entities.state[id] = 9
    expect(w.validate().join('\n')).toMatch(/state/)
  })

  it('catches a home that is not a cell of the grid', () => {
    const { w, id } = fresh()
    w.entities.home[id] = -1
    expect(w.validate().join('\n')).toMatch(/home/)
    w.entities.home[id] = 10 ** 8
    expect(w.validate().join('\n')).toMatch(/home/)
  })

  it('catches a walker whose leg ends before it begins, or that wakes at the wrong time', () => {
    const w = make(11)
    const id = walkerOf(w)
    const end = w.entities.legEnd[id]!
    w.entities.legEnd[id] = w.entities.legStart[id]!
    expect(w.validate().join('\n')).toMatch(/leg/)
    w.entities.legEnd[id] = end
    w.entities.wake[id] = end + 1
    expect(w.validate().join('\n')).toMatch(/wake/)
  })

  it('catches a walker heading for a cell that is not land, or not on the grid', () => {
    const w = make(11)
    const id = walkerOf(w)
    w.entities.target[id] = -4
    expect(w.validate().join('\n')).toMatch(/heading for/)
  })

  it('catches a resting villager whose wake-up is already past', () => {
    const { w, id } = fresh()
    w.entities.state[id] = UnitState.Rest
    w.entities.wake[id] = w.clock.tick - 1
    expect(w.validate().join('\n')).toMatch(/wake/)
  })

  it('catches a row that is empty but not zeroed', () => {
    const { w } = fresh()
    const hole = w.entities.spawn({ kind: 1, x: 0, y: 0 })
    w.entities.despawn(hole)
    w.entities.home[hole] = 5
    expect(w.validate().join('\n')).toMatch(/empty/)
  })
})
