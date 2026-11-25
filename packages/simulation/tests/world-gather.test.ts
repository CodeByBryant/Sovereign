import { defaultWorldConfig } from '@sovereign/config'
import { EntityKind, RESOURCE_CATALOG, UnitState } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { decodeWorld, encodeWorld } from '../src/serialization/save'
import { World } from '../src/world/World'
import { smallWorldOverrides } from './support/worldOptions'

/** A small world in which nothing regrows, so that what is gathered can be counted exactly. */
const make = (seed = 11, gather = true, regrow = false): World => {
  const base = smallWorldOverrides({ nations: 5 })
  const config = {
    ...base,
    resources: {
      ...(base.resources ?? defaultWorldConfig.resources),
      regrowth: regrow ? { ...defaultWorldConfig.resources.regrowth } : {}
    },
    units: { perNation: 12, ...(gather ? {} : { gather: {} }) }
  }
  return World.create({ seed, config })
}

const hallTotal = (w: World): number => {
  let n = 0
  for (const hall of w.stockpiles.halls()) for (const c of w.stockpiles.counts(hall)) n += c
  return n
}
const carried = (w: World): number => {
  let n = 0
  for (const id of w.entities.ids()) n += w.entities.carriedCount[id] as number
  return n
}
const stockTotal = (w: World): number => {
  let n = 0
  for (let i = 0; i < w.nodes.count; i += 1) n += w.nodes.stock[i] as number
  return n
}

describe('a world where villagers gather', () => {
  it('fills the halls as time passes', () => {
    const w = make()
    expect(hallTotal(w)).toBe(0)
    w.run(300)
    expect(hallTotal(w)).toBeGreaterThan(50)
    // every nation's hall has something by now
    for (const hall of w.stockpiles.halls()) {
      expect(
        w.stockpiles.counts(hall).some((c) => c > 0),
        `hall ${hall}`
      ).toBe(true)
    }
  })

  it('makes and loses nothing: what the deposits lost is in a hall or on a villager', () => {
    const w = make()
    const start = stockTotal(w)
    for (let t = 0; t < 400; t += 1) {
      w.step()
      if (t % 40 === 0) expect(start - stockTotal(w), `tick ${t}`).toBe(hallTotal(w) + carried(w))
    }
    expect(start - stockTotal(w)).toBe(hallTotal(w) + carried(w))
  })

  it('stays a sound world all along, with villagers in every state', () => {
    const w = make()
    const seen = new Set<number>()
    for (let t = 0; t < 250; t += 1) {
      w.step()
      for (const id of w.entities.ids()) {
        if (w.entities.kind[id] === EntityKind.Villager) seen.add(w.entities.state[id] as number)
      }
      if (t % 25 === 0) expect(w.validate(), `tick ${t}`).toEqual([])
    }
    expect(w.validate()).toEqual([])
    expect([...seen].sort()).toEqual([
      UnitState.Rest,
      UnitState.Walk,
      UnitState.Work,
      UnitState.Haul
    ])
  })

  it('only ever takes resources that are in the gather table', () => {
    const w = make()
    w.run(300)
    const allowed = new Set(
      RESOURCE_CATALOG.filter((d) => w.config.units.gather[d.key] !== undefined).map((d) => d.id)
    )
    for (const hall of w.stockpiles.halls()) {
      w.stockpiles.counts(hall).forEach((c, i) => {
        if (c > 0) expect(allowed.has(i + 1), RESOURCE_CATALOG[i]!.key).toBe(true)
      })
    }
  })

  it('is the same world every time it is run from the same seed', () => {
    const a = make()
    const b = make()
    a.run(200)
    b.run(200)
    expect(b.stateHash()).toBe(a.stateHash())
    expect(make(12).stateHash()).not.toBe(make(11).stateHash())
  })

  it('goes on the same after a save in the middle of a gather and a restore', () => {
    for (const stop of [37, 120]) {
      const a = make()
      a.run(stop)
      const b = decodeWorld(encodeWorld(a))
      expect(b.stateHash()).toBe(a.stateHash())
      a.run(150)
      b.run(150)
      expect(b.stateHash()).toBe(a.stateHash())
      expect(Array.from(b.nodes.stock)).toEqual(Array.from(a.nodes.stock))
      expect(b.stockpiles.toJson()).toEqual(a.stockpiles.toJson())
    }
  })

  it('does not gather when the gather table is empty', () => {
    const w = make(11, false)
    w.run(300)
    expect(hallTotal(w)).toBe(0)
    expect(stockTotal(w)).toBe(stockTotal(make(11, false)))
  })

  it('lets what is gathered change what a nation is like (its land is measured from the stocks)', () => {
    const a = make(11, true)
    const b = make(11, false)
    a.run(300)
    b.run(300)
    const profileOf = (w: World): string => JSON.stringify(w.nations.map((n) => n.profile))
    expect(profileOf(a)).not.toBe(profileOf(b))
  })

  it('regrows what was gathered, when the resource regrows', () => {
    const w = make(11, true, true)
    const start = stockTotal(w)
    w.run(400)
    const gathered = hallTotal(w) + carried(w)
    expect(gathered).toBeGreaterThan(50)
    // regrowth gives some back, so the deposits lost less than was taken
    expect(start - stockTotal(w)).toBeLessThan(gathered)
  })
})
