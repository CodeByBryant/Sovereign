import { describe, expect, it } from 'vitest'
import { EntityKind, ResourceType } from '@sovereign/contracts'
import { decodeWorld, encodeWorld } from '../src/serialization/save'
import { World } from '../src/world/World'
import { smallWorldOverrides } from './support/worldOptions'

const make = (seed = 11, perNation = 5, nations = 4): World =>
  World.create({ seed, config: { ...smallWorldOverrides({ nations }), units: { perNation } } })

const halls = (w: World): number[] =>
  [...w.entities.ids()].filter((id) => w.entities.kind[id] === EntityKind.Hall)
const villagers = (w: World): number[] =>
  [...w.entities.ids()].filter((id) => w.entities.kind[id] === EntityKind.Villager)

describe('halls', () => {
  it('a new world has one hall at each capital, owned by its nation', () => {
    const w = make()
    const ids = halls(w)
    expect(ids.length).toBe(w.nations.length)
    ids.forEach((id, i) => {
      const capital = w.nations[i]!.capital
      expect(w.entities.x[id]).toBe(capital % w.terrain.width)
      expect(w.entities.y[id]).toBe(Math.floor(capital / w.terrain.width))
      expect(w.entities.owner[id]).toBe(i)
    })
  })
  it('opens a stockpile for every hall, empty', () => {
    const w = make()
    expect(w.stockpiles.halls()).toEqual(halls(w))
    expect(w.stockpiles.total(ResourceType.Timber)).toBe(0)
    expect(w.stockpiles.counts(halls(w)[0]!).every((c) => c === 0)).toBe(true)
  })
  it('gives every villager the hall of its nation (the row id plus one)', () => {
    const w = make()
    const ids = villagers(w)
    expect(ids.length).toBe(5 * 4)
    for (const id of ids) {
      const owner = w.entities.owner[id] as number
      expect(w.entities.hall[id]).toBe((halls(w)[owner] as number) + 1)
    }
  })
  it('lists only the villagers in the unit snapshot, not the halls', () => {
    const w = make()
    const snap = w.unitPositions()
    expect(snap.count).toBe(20)
    expect(Array.from(snap.kind).every((k) => k === EntityKind.Villager)).toBe(true)
    expect(Array.from(snap.id)).toEqual(villagers(w))
  })
  it('never moves or wakes a hall as the world runs', () => {
    const w = make()
    const before = halls(w).map((id) => [
      w.entities.x[id],
      w.entities.y[id],
      w.entities.state[id],
      w.entities.wake[id]
    ])
    w.run(300)
    const after = halls(w).map((id) => [
      w.entities.x[id],
      w.entities.y[id],
      w.entities.state[id],
      w.entities.wake[id]
    ])
    expect(after).toEqual(before)
  })
  it('finds no halls to schedule after a restore, and the same world goes on', () => {
    const a = make()
    a.run(30)
    const b = decodeWorld(encodeWorld(a))
    a.run(200)
    b.run(200)
    expect(b.stateHash()).toBe(a.stateHash())
  })
  it('does not put a hall on the timer wheel when a world saved at its first tick is restored', () => {
    const b = decodeWorld(encodeWorld(make()))
    const before = halls(b).map((id) => [
      b.entities.x[id],
      b.entities.y[id],
      b.entities.state[id],
      b.entities.wake[id]
    ])
    b.run(10)
    const after = halls(b).map((id) => [
      b.entities.x[id],
      b.entities.y[id],
      b.entities.state[id],
      b.entities.wake[id]
    ])
    expect(after).toEqual(before)
  })
  it('is sound as made', () => {
    expect(make().validate()).toEqual([])
  })
})

describe('stockpiles in the hash and the save', () => {
  it('change the state hash when a counter changes', () => {
    const w = make()
    const before = w.stateHash()
    w.stockpiles.add(halls(w)[0]!, ResourceType.Grain, 1)
    expect(w.stateHash()).not.toBe(before)
  })
  it('hash each resource and each hall separately', () => {
    const a = make()
    const b = make()
    a.stockpiles.add(halls(a)[0]!, ResourceType.Grain, 1)
    b.stockpiles.add(halls(b)[0]!, ResourceType.Fish, 1)
    expect(a.stateHash()).not.toBe(b.stateHash())
    const c = make()
    c.stockpiles.add(halls(c)[1]!, ResourceType.Grain, 1)
    expect(a.stateHash()).not.toBe(c.stateHash())
  })
  it('survive a save: the counters and the hash', () => {
    const w = make()
    w.stockpiles.add(halls(w)[2]!, ResourceType.Iron, 41)
    const back = decodeWorld(encodeWorld(w))
    expect(back.stockpiles.get(halls(back)[2]!, ResourceType.Iron)).toBe(41)
    expect(back.stateHash()).toBe(w.stateHash())
  })
})

describe('what validate says about halls', () => {
  const problems = (w: World): string => w.validate().join('\n')
  it('a villager whose hall is not a hall row', () => {
    const w = make()
    w.entities.hall[villagers(w)[0]!] = villagers(w)[1]! + 1
    expect(problems(w)).toMatch(/hall/)
  })
  it('a villager whose hall is a row that is empty', () => {
    const w = make()
    w.entities.hall[villagers(w)[0]!] = 999
    expect(problems(w)).toMatch(/hall/)
  })
  it('a hall with no stockpile, and a stockpile with no hall', () => {
    const a = make()
    a.stockpiles.open(500)
    expect(problems(a)).toMatch(/stockpile/)
    const b = make()
    b.entities.spawn({
      kind: EntityKind.Hall,
      x: b.entities.x[halls(b)[0]!]!,
      y: b.entities.y[halls(b)[0]!]!,
      owner: 0,
      home: b.entities.home[halls(b)[0]!]!
    })
    expect(problems(b)).toMatch(/stockpile/)
  })
  it('a hall that is off the map, not on land, or owned by no nation', () => {
    const a = make()
    a.entities.x[halls(a)[0]!] = 60000
    expect(problems(a)).toMatch(/hall/)
    const b = make()
    b.entities.owner[halls(b)[0]!] = 200
    expect(problems(b)).toMatch(/owner/)
  })
  it('a hall that is walking or carrying something', () => {
    const a = make()
    a.entities.state[halls(a)[0]!] = 1
    expect(problems(a)).toMatch(/hall/)
    const b = make()
    b.entities.carriedType[halls(b)[0]!] = 3
    expect(problems(b)).toMatch(/hall/)
  })
  it('a villager after a node that does not exist (the last node is fine)', () => {
    const a = make()
    const v = villagers(a)[0]!
    a.entities.goal[v] = a.nodes.count // node count - 1, plus one
    expect(a.validate()).toEqual([])
    a.entities.goal[v] = a.nodes.count + 1
    expect(problems(a)).toMatch(/node/)
  })
  it('a villager carrying a resource that is not in the catalogue, or a count with no type', () => {
    const a = make()
    const v = villagers(a)[0]!
    a.entities.carriedType[v] = 23
    a.entities.carriedCount[v] = 1
    expect(problems(a)).toMatch(/carries/)
    const b = make()
    b.entities.carriedCount[villagers(b)[0]!] = 4
    expect(problems(b)).toMatch(/carries/)
    const c = make()
    c.entities.carriedType[villagers(c)[0]!] = 3
    expect(problems(c)).toMatch(/carries/)
  })
})
