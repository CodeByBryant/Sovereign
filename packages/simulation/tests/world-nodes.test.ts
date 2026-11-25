import { describe, expect, it } from 'vitest'
import { World } from '../src/world/World'
import { decodeWorld, encodeWorld } from '../src/serialization/save'
import { smallWorldOverrides } from './support/worldOptions'

const make = (seed = 7): World => World.create({ seed, config: smallWorldOverrides() })

/** A node of the world that holds some stock. */
function loaded(world: World, layer: 'surface' | 'ground' = 'surface'): number {
  for (let id = 0; id < world.nodes.count; id += 1) {
    if (world.nodes.layerOf(id) === layer && (world.nodes.stock[id] as number) > 0) return id
  }
  throw new Error('no such node')
}

describe('the resource nodes of a world', () => {
  it('are one row for every resource on the map', () => {
    const w = make()
    let filled = 0
    for (const layer of ['surface', 'ground'] as const) {
      for (const t of w.terrain.resources[layer].type) if (t !== 0) filled += 1
    }
    expect(w.nodes.count).toBe(filled)
    expect(filled).toBeGreaterThan(50)
  })
  it('share their slot arrays with the terrain, so everything that reads the tiles sees them', () => {
    const w = make()
    expect(w.nodes.slots).toBe(w.terrain.resources)
  })
  it('agree with those slot arrays in a new world', () => {
    expect(make().validate()).toEqual([])
  })
  it('are drawn down by extractResource, and the slot arrays and the hash follow', () => {
    const w = make()
    const id = loaded(w)
    const tile = w.nodes.tile[id] as number
    const before = w.stateHash()
    const taken = w.extractResource('surface', tile, 5)
    expect(taken).toBe(Math.min(5, w.nodes.richness[id] as number))
    expect(w.terrain.resources.surface.stock[tile]).toBe(w.nodes.stock[id])
    expect(w.stateHash()).not.toBe(before)
    expect(w.validate()).toEqual([])
  })
  it('grow back as the world runs, in the nodes and in the slot arrays', () => {
    const w = make()
    const id = (() => {
      for (let i = 0; i < w.nodes.count; i += 1) {
        if (w.nodes.layerOf(i) === 'surface' && (w.nodes.stock[i] as number) >= 10) return i
      }
      throw new Error('none')
    })()
    const tile = w.nodes.tile[id] as number
    const full = w.nodes.stock[id] as number
    w.extractResource('surface', tile, full)
    expect(w.nodes.stock[id]).toBe(0)
    w.run(600)
    // every surface resource regrows: after 600 ticks the felled node has something again
    expect(w.nodes.stock[id]).toBeGreaterThan(0)
    expect(w.terrain.resources.surface.stock[tile]).toBe(w.nodes.stock[id])
    expect(w.validate()).toEqual([])
  })
  it('are reported by validate when a slot array drifts from them', () => {
    const w = make()
    const id = loaded(w)
    w.terrain.resources.surface.stock[w.nodes.tile[id] as number] = 0
    expect(w.validate().some((p) => /node \d+ on tile \d+ disagrees/.test(p))).toBe(true)
  })
  it('are reported by validate when the slots hold a resource the store does not know', () => {
    const w = make()
    let tile = 0
    while ((w.terrain.resources.ground.type[tile] as number) !== 0) tile += 1
    w.terrain.resources.ground.type[tile] = 2
    w.terrain.resources.ground.richness[tile] = 10
    w.terrain.resources.ground.stock[tile] = 10
    expect(w.validate().some((p) => /node store has/.test(p))).toBe(true)
  })
  it('survive a save in the middle of a run: the same hash now and after more ticks', () => {
    const a = make()
    a.run(40)
    const b = decodeWorld(encodeWorld(a))
    expect(b.stateHash()).toBe(a.stateHash())
    a.run(200)
    b.run(200)
    expect(b.stateHash()).toBe(a.stateHash())
    expect(b.nodes.count).toBe(a.nodes.count)
  })
  it('refuse nodes whose slot arrays are not the terrain slot arrays', () => {
    const a = make()
    const other = make()
    expect(() =>
      World.restore({
        seed: a.seed,
        config: a.config,
        tick: 0,
        terrain: a.terrain,
        nations: [...a.nations],
        ownership: a.map.ownership.slice(),
        nodes: other.nodes
      })
    ).toThrow(RangeError)
  })
})

describe('drainStockChanges: what changed since the app last heard', () => {
  it('is empty for a world nothing has happened to', () => {
    const c = make().drainStockChanges()
    expect(c.tile.length).toBe(0)
    expect(c.layer.length).toBe(0)
    expect(c.value.length).toBe(0)
  })
  it('lists a drawn-down deposit once, with its tile, layer and what is left', () => {
    const w = make()
    const id = loaded(w)
    const tile = w.nodes.tile[id] as number
    w.extractResource('surface', tile, 3)
    w.extractResource('surface', tile, 2)
    const c = w.drainStockChanges()
    expect(Array.from(c.tile)).toEqual([tile])
    expect(Array.from(c.layer)).toEqual([0])
    expect(Array.from(c.value)).toEqual([w.nodes.stock[id]])
  })
  it('says 1 for a ground deposit', () => {
    const w = make()
    const id = loaded(w, 'ground')
    w.extractResource('ground', w.nodes.tile[id] as number, 1)
    expect(Array.from(w.drainStockChanges().layer)).toEqual([1])
  })
  it('hands each change over once', () => {
    const w = make()
    const id = loaded(w)
    w.extractResource('surface', w.nodes.tile[id] as number, 3)
    expect(w.drainStockChanges().tile.length).toBe(1)
    expect(w.drainStockChanges().tile.length).toBe(0)
  })
  it('lists what villagers gather and what grows back, as a run goes on', () => {
    const w = make()
    w.run(200)
    const c = w.drainStockChanges()
    expect(c.tile.length).toBeGreaterThan(5)
    c.tile.forEach((tile, i) => {
      const id = w.nodes.nodeAt(tile, c.layer[i] === 1 ? 'ground' : 'surface')
      expect(id).toBeGreaterThanOrEqual(0)
      expect(c.value[i]).toBe(w.nodes.stock[id])
    })
  })
})
