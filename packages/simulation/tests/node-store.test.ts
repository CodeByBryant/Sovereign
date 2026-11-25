import { describe, expect, it } from 'vitest'
import { ResourceType, type ResourceSlots } from '@sovereign/contracts'
import { NodeStore } from '../src/resources/NodeStore'

const SIZE = 24 // a 6 x 4 map

/** Slots for a small map with the given resources: [layer, tile, type, richness, stock]. */
function slotsOf(
  entries: Array<['surface' | 'ground', number, number, number, number]>,
  size = SIZE
): ResourceSlots {
  const make = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(size),
    richness: new Uint8Array(size),
    stock: new Uint8Array(size)
  })
  const slots: ResourceSlots = { surface: make(), ground: make() }
  for (const [layer, tile, type, richness, stock] of entries) {
    slots[layer].type[tile] = type
    slots[layer].richness[tile] = richness
    slots[layer].stock[tile] = stock
  }
  return slots
}

const sample = (): ResourceSlots =>
  slotsOf([
    ['surface', 9, ResourceType.Timber, 200, 200],
    ['ground', 3, ResourceType.Iron, 90, 90],
    ['surface', 3, ResourceType.Grain, 120, 60],
    ['ground', 17, ResourceType.Stone, 255, 255],
    ['surface', 20, ResourceType.Fish, 80, 0]
  ])

describe('NodeStore.fromSlots', () => {
  it('makes one row per resource, in tile order with the surface before the ground on a tile', () => {
    const nodes = NodeStore.fromSlots(sample())
    expect(nodes.count).toBe(5)
    expect(Array.from(nodes.tile)).toEqual([3, 3, 9, 17, 20])
    expect(Array.from(nodes.kind)).toEqual([
      ResourceType.Grain,
      ResourceType.Iron,
      ResourceType.Timber,
      ResourceType.Stone,
      ResourceType.Fish
    ])
    expect(Array.from(nodes.stock)).toEqual([60, 90, 200, 255, 0])
    expect(Array.from(nodes.richness)).toEqual([120, 90, 200, 255, 80])
  })
  it('makes no rows for a map with nothing on it', () => {
    expect(NodeStore.fromSlots(slotsOf([])).count).toBe(0)
  })
  it('refuses slots that are not sound: no richness, or more stock than richness', () => {
    expect(() => NodeStore.fromSlots(slotsOf([['surface', 1, ResourceType.Timber, 0, 0]]))).toThrow(
      RangeError
    )
    expect(() =>
      NodeStore.fromSlots(slotsOf([['surface', 1, ResourceType.Timber, 10, 11]]))
    ).toThrow(RangeError)
    expect(() => NodeStore.fromSlots(slotsOf([['surface', 1, 99, 10, 10]]))).toThrow(RangeError)
  })
  it('refuses a resource sitting in the wrong layer', () => {
    expect(() =>
      NodeStore.fromSlots(slotsOf([['ground', 1, ResourceType.Timber, 10, 10]]))
    ).toThrow(RangeError)
  })
})

describe('NodeStore lookups', () => {
  const nodes = NodeStore.fromSlots(sample())
  it('finds the node on a tile in a layer, and none where there is none', () => {
    expect(nodes.nodeAt(3, 'surface')).toBe(0)
    expect(nodes.nodeAt(3, 'ground')).toBe(1)
    expect(nodes.nodeAt(9, 'surface')).toBe(2)
    expect(nodes.nodeAt(17, 'ground')).toBe(3)
    expect(nodes.nodeAt(20, 'surface')).toBe(4)
    expect(nodes.nodeAt(9, 'ground')).toBe(-1)
    expect(nodes.nodeAt(0, 'surface')).toBe(-1)
    expect(nodes.nodeAt(23, 'ground')).toBe(-1)
    expect(nodes.nodeAt(-1, 'surface')).toBe(-1)
    expect(nodes.nodeAt(SIZE, 'surface')).toBe(-1)
  })
  it('finds every node of a bigger map (binary search lands on each row)', () => {
    const entries: Array<['surface' | 'ground', number, number, number, number]> = []
    for (let t = 0; t < 500; t += 1) {
      if (t % 3 === 0) entries.push(['surface', t, ResourceType.Grain, 10, 10])
      if (t % 5 === 0) entries.push(['ground', t, ResourceType.Stone, 10, 10])
    }
    const big = NodeStore.fromSlots(slotsOf(entries, 500))
    let found = 0
    for (let t = 0; t < 500; t += 1) {
      expect(big.nodeAt(t, 'surface') >= 0).toBe(t % 3 === 0)
      expect(big.nodeAt(t, 'ground') >= 0).toBe(t % 5 === 0)
      if (big.nodeAt(t, 'surface') >= 0) found += 1
    }
    expect(found).toBe(167)
  })
  it('says which layer a node is in', () => {
    expect(nodes.layerOf(0)).toBe('surface')
    expect(nodes.layerOf(1)).toBe('ground')
  })
})

describe('NodeStore.setStock', () => {
  it('changes the stock and writes it through to the slot arrays it was made from', () => {
    const slots = sample()
    const nodes = NodeStore.fromSlots(slots)
    nodes.setStock(0, 7)
    expect(nodes.stock[0]).toBe(7)
    expect(slots.surface.stock[3]).toBe(7)
    nodes.setStock(1, 0)
    expect(slots.ground.stock[3]).toBe(0)
    expect(slots.surface.stock[3]).toBe(7)
  })
  it('refuses a stock that is not a whole number from 0 to the richness', () => {
    const nodes = NodeStore.fromSlots(sample())
    expect(() => nodes.setStock(0, 121)).toThrow(RangeError)
    expect(() => nodes.setStock(0, -1)).toThrow(RangeError)
    expect(() => nodes.setStock(0, 1.5)).toThrow(RangeError)
    expect(() => nodes.setStock(5, 0)).toThrow(RangeError)
    expect(() => nodes.setStock(-1, 0)).toThrow(RangeError)
    nodes.setStock(0, 120)
    expect(nodes.stock[0]).toBe(120)
  })
  it('lists each changed node once until the changes are taken', () => {
    const nodes = NodeStore.fromSlots(sample())
    nodes.setStock(2, 150)
    nodes.setStock(0, 10)
    nodes.setStock(2, 140)
    expect(Array.from(nodes.drainChanges())).toEqual([2, 0])
    expect(nodes.drainChanges().length).toBe(0)
    nodes.setStock(2, 100)
    expect(Array.from(nodes.drainChanges())).toEqual([2])
  })
  it('does not list a node whose stock did not change', () => {
    const nodes = NodeStore.fromSlots(sample())
    nodes.setStock(2, 200)
    expect(nodes.drainChanges().length).toBe(0)
  })
  it('keeps a node in the list that was changed and changed back (the app may have seen the first)', () => {
    const nodes = NodeStore.fromSlots(sample())
    nodes.setStock(2, 150)
    nodes.setStock(2, 200)
    expect(Array.from(nodes.drainChanges())).toEqual([2])
  })
})

describe('NodeStore bytes', () => {
  it('round-trips through bytes and rebuilds slot views equal to the originals', () => {
    const slots = sample()
    const nodes = NodeStore.fromSlots(slots)
    const back = NodeStore.fromBytes(nodes.toBytes(), SIZE)
    expect(back.count).toBe(nodes.count)
    expect(Array.from(back.tile)).toEqual(Array.from(nodes.tile))
    expect(Array.from(back.kind)).toEqual(Array.from(nodes.kind))
    expect(Array.from(back.stock)).toEqual(Array.from(nodes.stock))
    expect(Array.from(back.richness)).toEqual(Array.from(nodes.richness))
    for (const layer of ['surface', 'ground'] as const) {
      expect(back.slots[layer].type).toEqual(slots[layer].type)
      expect(back.slots[layer].richness).toEqual(slots[layer].richness)
      expect(back.slots[layer].stock).toEqual(slots[layer].stock)
    }
  })
  it('writes the same bytes for the same nodes, and a size that follows the count', () => {
    const nodes = NodeStore.fromSlots(sample())
    expect(nodes.toBytes()).toEqual(NodeStore.fromSlots(sample()).toBytes())
    expect(nodes.toBytes().length).toBe(4 + nodes.count * 7)
    expect(nodes.byteLength).toBe(4 + nodes.count * 7)
  })
  it('writes through to the rebuilt views too', () => {
    const back = NodeStore.fromBytes(NodeStore.fromSlots(sample()).toBytes(), SIZE)
    back.setStock(0, 5)
    expect(back.slots.surface.stock[3]).toBe(5)
  })
  it('round-trips an empty store', () => {
    const back = NodeStore.fromBytes(NodeStore.fromSlots(slotsOf([])).toBytes(), SIZE)
    expect(back.count).toBe(0)
    expect(back.slots.surface.type.length).toBe(SIZE)
  })

  const good = (): Uint8Array => NodeStore.fromSlots(sample()).toBytes()
  const reject = (bytes: Uint8Array, size = SIZE): void =>
    expect(() => NodeStore.fromBytes(bytes, size)).toThrow(RangeError)

  it('rejects bytes of the wrong length', () => {
    reject(new Uint8Array(0))
    reject(new Uint8Array(3))
    reject(good().slice(0, good().length - 1))
    reject(new Uint8Array([...good(), 0]))
  })
  it('rejects a count that does not fit the map or the bytes', () => {
    const b = good()
    new DataView(b.buffer).setUint32(0, 0xffffffff, true)
    reject(b)
    const c = good()
    new DataView(c.buffer).setUint32(0, 6, true)
    reject(c)
    reject(good(), 4) // a map of four tiles cannot hold the tile 9 node
  })
  it('rejects an unknown kind, a tile off the map, or rows out of order', () => {
    const base = good()
    const at = (i: number): number => 4 + i
    const kindEdit = (i: number, v: number): Uint8Array => {
      const b = base.slice()
      b[at(i)] = v
      return b
    }
    reject(kindEdit(0, 0))
    reject(kindEdit(0, 23))
    const n = 5
    const tileOffset = 4 + n * 3
    const tileEdit = (i: number, v: number): Uint8Array => {
      const b = base.slice()
      new DataView(b.buffer).setUint32(tileOffset + i * 4, v, true)
      return b
    }
    reject(tileEdit(4, SIZE))
    reject(tileEdit(0, 9)) // out of order against the next row
    reject(tileEdit(2, 3)) // the same key as row 0 (a surface node on tile 3), and out of order
  })
  it('rejects two nodes with the same key (a second surface node on a tile)', () => {
    const base = good()
    const b = base.slice()
    b[4 + 1] = ResourceType.Grain // node 1 (ground iron on tile 3) becomes a second surface node on tile 3
    reject(b)
  })
  it('rejects a stock above its richness and a richness of zero', () => {
    const n = 5
    const base = good()
    const stockEdit = base.slice()
    stockEdit[4 + n] = 255 // node 0's stock
    reject(stockEdit)
    const richEdit = base.slice()
    richEdit[4 + 2 * n] = 0
    reject(richEdit)
  })
})
