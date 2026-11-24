import { describe, expect, it } from 'vitest'
import { ResourceType, type ResourceSlots } from '@sovereign/contracts'
import { NodeIndex } from '../src/resources/NodeIndex'
import { NodeStore } from '../src/resources/NodeStore'

type Entry = [number, number, number, number] // x, y, type, stock (richness 100)

function build(
  width: number,
  height: number,
  entries: Entry[],
  cell = 8
): { nodes: NodeStore; index: NodeIndex } {
  const size = width * height
  const make = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(size),
    richness: new Uint8Array(size),
    stock: new Uint8Array(size)
  })
  const slots: ResourceSlots = { surface: make(), ground: make() }
  for (const [x, y, type, stock] of entries) {
    // ground kinds go in the ground slot
    const layer = type === ResourceType.Stone || type === ResourceType.Iron ? 'ground' : 'surface'
    slots[layer].type[y * width + x] = type
    slots[layer].richness[y * width + x] = 100
    slots[layer].stock[y * width + x] = stock
  }
  const nodes = NodeStore.fromSlots(slots)
  return { nodes, index: new NodeIndex(nodes, width, height, cell) }
}

const tileOf = (nodes: NodeStore, id: number, width: number): [number, number] => {
  const t = nodes.tile[id] as number
  return [t % width, Math.floor(t / width)]
}

describe('NodeIndex.nearest', () => {
  it('finds the closest node of a kind', () => {
    const { nodes, index } = build(64, 64, [
      [10, 10, ResourceType.Timber, 50],
      [20, 12, ResourceType.Timber, 50],
      [40, 40, ResourceType.Timber, 50]
    ])
    expect(tileOf(nodes, index.nearest(ResourceType.Timber, 18, 12, 10), 64)).toEqual([20, 12])
    expect(tileOf(nodes, index.nearest(ResourceType.Timber, 11, 10, 10), 64)).toEqual([10, 10])
    expect(tileOf(nodes, index.nearest(ResourceType.Timber, 41, 41, 10), 64)).toEqual([40, 40])
  })
  it('finds a node in the same tile and in the same cell', () => {
    const { nodes, index } = build(64, 64, [[5, 5, ResourceType.Grain, 9]])
    expect(tileOf(nodes, index.nearest(ResourceType.Grain, 5, 5, 0), 64)).toEqual([5, 5])
    expect(index.nearest(ResourceType.Grain, 7, 6, 0)).toBeGreaterThanOrEqual(0)
  })
  it('ignores nodes of other kinds, and says -1 when there is none of the kind', () => {
    const { index } = build(64, 64, [[10, 10, ResourceType.Timber, 50]])
    expect(index.nearest(ResourceType.Grain, 10, 10, 10)).toBe(-1)
    expect(index.nearest(0, 10, 10, 10)).toBe(-1)
    expect(index.nearest(23, 10, 10, 10)).toBe(-1)
  })
  it('skips a node with no stock, and finds it again when it has some', () => {
    const { nodes, index } = build(64, 64, [
      [10, 10, ResourceType.Timber, 0],
      [30, 10, ResourceType.Timber, 50]
    ])
    expect(tileOf(nodes, index.nearest(ResourceType.Timber, 11, 10, 10), 64)).toEqual([30, 10])
    nodes.setStock(nodes.nodeAt(10 * 64 + 10, 'surface'), 5)
    expect(tileOf(nodes, index.nearest(ResourceType.Timber, 11, 10, 10), 64)).toEqual([10, 10])
  })
  it('breaks a tie by the lowest node id', () => {
    const { nodes, index } = build(64, 64, [
      [12, 10, ResourceType.Timber, 50],
      [8, 10, ResourceType.Timber, 50],
      [10, 6, ResourceType.Timber, 50]
    ])
    // all three are 2 tiles from (10, 10) on the x axis, or 4 on y: the first two tie
    const id = index.nearest(ResourceType.Timber, 10, 10, 5)
    expect(id).toBe(
      Math.min(nodes.nodeAt(10 * 64 + 12, 'surface'), nodes.nodeAt(10 * 64 + 8, 'surface'))
    )
  })
  it('only looks as many cells out as it is told to', () => {
    // from tile 7 (cell 0) a node on tile 40 (cell 5) is 5 rings out
    const { index } = build(64, 64, [[40, 10, ResourceType.Timber, 50]])
    expect(index.nearest(ResourceType.Timber, 7, 10, 0)).toBe(-1)
    expect(index.nearest(ResourceType.Timber, 7, 10, 4)).toBe(-1)
    expect(index.nearest(ResourceType.Timber, 7, 10, 5)).toBeGreaterThanOrEqual(0)
  })
  it('does not stop at the first node found when a nearer one sits one ring further out', () => {
    // from (7, 7): a node at (15, 15) is in ring 1 but 11.3 away; one at (16, 7) is in ring 2 but only 9 away
    const { nodes, index } = build(64, 64, [
      [15, 15, ResourceType.Timber, 50],
      [16, 7, ResourceType.Timber, 50]
    ])
    expect(tileOf(nodes, index.nearest(ResourceType.Timber, 7, 7, 4), 64)).toEqual([16, 7])
  })
  it('reaches the edge of a map that is not a whole number of cells', () => {
    const { nodes, index } = build(21, 13, [[20, 12, ResourceType.Fish, 50]])
    expect(tileOf(nodes, index.nearest(ResourceType.Fish, 0, 0, 10), 21)).toEqual([20, 12])
  })
  it('agrees with a brute-force search on a scattered map, for every kind, from many places', () => {
    const width = 70
    const height = 50
    let seed = 12345
    const rand = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return (seed >>> 8) % n
    }
    const kinds = [ResourceType.Timber, ResourceType.Grain, ResourceType.Fish, ResourceType.Stone]
    const taken = new Set<number>()
    const entries: Entry[] = []
    for (let i = 0; i < 260; i += 1) {
      const x = rand(width)
      const y = rand(height)
      const type = kinds[rand(kinds.length)] as number
      const layerBit = type === ResourceType.Stone ? 1 : 0
      const key = (y * width + x) * 2 + layerBit
      if (taken.has(key)) continue
      taken.add(key)
      entries.push([x, y, type, rand(3) === 0 ? 0 : 1 + rand(99)])
    }
    const { nodes, index } = build(width, height, entries)
    for (let q = 0; q < 400; q += 1) {
      const x = rand(width)
      const y = rand(height)
      const kind = kinds[rand(kinds.length)] as number
      let best = -1
      let bestD = Infinity
      for (let id = 0; id < nodes.count; id += 1) {
        if (nodes.kind[id] !== kind || nodes.stock[id] === 0) continue
        const [nx, ny] = tileOf(nodes, id, width)
        const d = (nx - x) * (nx - x) + (ny - y) * (ny - y)
        if (d < bestD) {
          bestD = d
          best = id
        }
      }
      expect(index.nearest(kind, x, y, 100), `query ${q}`).toBe(best)
    }
  })
})

describe('NodeIndex.constructor', () => {
  it('refuses a map the nodes do not fit', () => {
    const { nodes } = build(16, 16, [[10, 10, ResourceType.Timber, 5]])
    expect(() => new NodeIndex(nodes, 8, 8)).toThrow(RangeError)
    expect(() => new NodeIndex(nodes, 16, 16, 0)).toThrow(RangeError)
    // the node on tile 240 (the first tile of row 15) is just off a 16 x 15 map
    const last = build(16, 16, [[0, 15, ResourceType.Timber, 5]]).nodes
    expect(() => new NodeIndex(last, 16, 15)).toThrow(RangeError)
    expect(() => new NodeIndex(last, 16, 16)).not.toThrow()
  })
})
