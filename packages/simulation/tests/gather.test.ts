import { EntityKind, ResourceType, UnitState, type ResourceSlots } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { EntityStore } from '../src/entities/EntityStore'
import { NodeIndex } from '../src/resources/NodeIndex'
import { NodeStore } from '../src/resources/NodeStore'
import { UnitSystem, workTile } from '../src/systems/UnitSystem'
import { Pathfinder, RouteCache } from '../src/terrain/pathing'
import { ResourceStocks, buildRegrowthTable } from '../src/world/ResourceStocks'
import { Stockpiles } from '../src/world/Stockpiles'
import { drawGrid } from './support/costGrid'

const OPEN = Array.from({ length: 12 }, () => '.'.repeat(16)) // 64 x 48 tiles

interface NodeSpec {
  x: number
  y: number
  type: number
  stock: number
  richness?: number
}

interface Options {
  rows?: string[]
  nodes?: NodeSpec[]
  /** Villagers: where they rest; `homeless` ones belong to no hall. */
  villagers?: Array<{ x: number; y: number; homeless?: boolean }>
  gather?: Record<string, { work: number; amount: number }>
  carry?: number
  radius?: number
  land?: (x: number, y: number) => boolean
  seed?: number
  regrowth?: Record<string, { units: number; period: number }>
}

/** Every kind the multi-kind tests use. */
const ALL = {
  timber: { work: 3, amount: 5 },
  grain: { work: 2, amount: 4 },
  stone: { work: 4, amount: 3 },
  fish: { work: 2, amount: 6 }
}

const GROUND = new Set<number>([ResourceType.Stone, ResourceType.Iron, ResourceType.Gold])

function slotsOf(width: number, height: number, nodes: NodeSpec[]): ResourceSlots {
  const size = width * height
  const make = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(size),
    richness: new Uint8Array(size),
    stock: new Uint8Array(size)
  })
  const slots: ResourceSlots = { surface: make(), ground: make() }
  for (const n of nodes) {
    const slot = slots[GROUND.has(n.type) ? 'ground' : 'surface']
    slot.type[n.y * width + n.x] = n.type
    slot.richness[n.y * width + n.x] = n.richness ?? Math.max(n.stock, 1)
    slot.stock[n.y * width + n.x] = n.stock
  }
  return slots
}

function setup(o: Options = {}) {
  const { grid } = drawGrid(o.rows ?? OPEN)
  const width = grid.cols * grid.cell
  const height = grid.rows * grid.cell
  const entities = new EntityStore(4)
  const nodes = NodeStore.fromSlots(slotsOf(width, height, o.nodes ?? []))
  const index = new NodeIndex(nodes, width, height)
  const stocks = new ResourceStocks(nodes, buildRegrowthTable(o.regrowth ?? {}))
  const stockpiles = new Stockpiles()
  const homeTile = { x: 6, y: 6 }
  const hall = entities.spawn({ kind: EntityKind.Hall, x: homeTile.x, y: homeTile.y, owner: 0 })
  stockpiles.open(hall)
  const homeCell =
    Math.floor(homeTile.y / grid.cell) * grid.cols + Math.floor(homeTile.x / grid.cell)
  const config = {
    perNation: 0,
    walkSpeed: 5,
    wanderRadius: 4,
    restMin: 1,
    restMax: 3,
    carryCapacity: o.carry ?? 20,
    searchRadius: o.radius ?? 40,
    gather: o.gather ?? { timber: { work: 3, amount: 5 } }
  }
  const system = new UnitSystem({
    entities,
    grid,
    routes: new RouteCache(new Pathfinder(grid, { maxExpand: 100000 })),
    config,
    seed: o.seed ?? 1337,
    width,
    height,
    land: o.land ?? (() => true),
    gather: {
      nodes,
      index,
      stockpiles,
      extract: (node, amount) => stocks.extractNode(node, amount)
    }
  })
  const ids = (o.villagers ?? [{ x: 6, y: 6 }]).map((v) =>
    system.spawnVillager(v.x, v.y, 0, homeCell, 0, v.homeless === true ? 0 : hall + 1)
  )
  return {
    grid,
    entities,
    nodes,
    index,
    stocks,
    stockpiles,
    system,
    ids,
    hall,
    config,
    width,
    height
  }
}

type S = ReturnType<typeof setup>

/** Step the system one tick at a time until `done` (or `limit` ticks), returning the tick it was true on. */
function until(s: S, done: () => boolean, from = 0, limit = 600): number {
  for (let tick = from; tick < from + limit; tick += 1) {
    s.system.step(tick)
    s.stocks.regrow(tick)
    if (done()) return tick
  }
  throw new Error('it never happened')
}

const state = (s: S, id = 0): number => s.entities.state[s.ids[id] as number] as number

describe('workTile: where a villager stands to work a deposit', () => {
  const water = (wx: number, wy: number) => (x: number, y: number) => !(x === wx && y === wy)
  it('is the deposit itself when that is land', () => {
    expect(workTile(10, 7, 64, 48, () => true)).toBe(7 * 64 + 10)
  })
  it('is the neighbouring land tile with the lowest row, then the lowest column, when the deposit is in water', () => {
    expect(workTile(20, 10, 64, 48, water(20, 10))).toBe(9 * 64 + 19)
    // with the row above all water, it is the left tile on the row of the deposit
    const sea = (x: number, y: number): boolean =>
      !(y <= 10 && x >= 19 && x <= 21 && !(x === 19 && y === 10))
    expect(workTile(20, 10, 64, 48, (x, y) => (y === 10 && x === 20 ? false : sea(x, y)))).toBe(
      10 * 64 + 19
    )
  })
  it('is -1 when no neighbour is land', () => {
    expect(workTile(20, 10, 64, 48, () => false)).toBe(-1)
  })
  it('stays on the map at its edges and corners', () => {
    expect(workTile(0, 0, 64, 48, (x, y) => !(x === 0 && y === 0))).toBe(1)
    expect(workTile(63, 47, 64, 48, (x, y) => !(x === 63 && y === 47))).toBe(46 * 64 + 62)
    expect(workTile(0, 47, 64, 48, (x, y) => !(x === 0 && y === 47))).toBe(46 * 64 + 0)
  })
})

describe('a villager gathers: walk, work, carry home, deposit', () => {
  const timber = (stock = 100): NodeSpec[] => [{ x: 40, y: 20, type: ResourceType.Timber, stock }]

  it('goes through every step in order and leaves the goods in the hall', () => {
    const s = setup({ nodes: timber() })
    const id = s.ids[0] as number
    const seen: number[] = [state(s)]
    let tick = 0
    for (; tick < 400 && s.stockpiles.get(s.hall, ResourceType.Timber) === 0; tick += 1) {
      s.system.step(tick)
      if (state(s) !== seen[seen.length - 1]) seen.push(state(s))
    }
    // rest, walk to the tree, work it, haul the logs home, rest
    expect(seen.slice(0, 5)).toEqual([
      UnitState.Rest,
      UnitState.Walk,
      UnitState.Work,
      UnitState.Haul,
      UnitState.Rest
    ])
    expect(s.stockpiles.get(s.hall, ResourceType.Timber)).toBe(5)
    expect(s.nodes.stock[0]).toBe(95)
    expect(s.entities.carriedCount[id]).toBe(0)
    expect(s.entities.carriedType[id]).toBe(0)
    expect(s.entities.goal[id]).toBe(0)
  })

  it('walks with the node as its goal, works standing on the deposit, and carries the stack home', () => {
    const s = setup({ nodes: timber() })
    const id = s.ids[0] as number
    let walkSeen = false
    let workSeen = false
    let haulSeen = false
    for (let tick = 0; tick < 400 && !haulSeen; tick += 1) {
      s.system.step(tick)
      if (state(s) === UnitState.Walk && s.entities.goal[id] === 1) walkSeen = true
      if (state(s) === UnitState.Work) {
        workSeen = true
        expect([s.entities.x[id], s.entities.y[id]]).toEqual([40, 20])
        expect(s.entities.goal[id]).toBe(1)
        expect(s.entities.carriedCount[id]).toBe(0)
      }
      if (state(s) === UnitState.Haul) {
        haulSeen = true
        expect(s.entities.carriedType[id]).toBe(ResourceType.Timber)
        expect(s.entities.carriedCount[id]).toBe(5)
        expect(s.entities.goal[id]).toBe(0)
        expect(s.entities.target[id]).toBe(s.entities.home[id])
      }
    }
    expect([walkSeen, workSeen, haulSeen]).toEqual([true, true, true])
  })

  it('works for exactly the ticks the rule says', () => {
    const s = setup({ nodes: timber() })
    let started = -1
    let finished = -1
    for (let tick = 0; tick < 400 && finished < 0; tick += 1) {
      s.system.step(tick)
      if (state(s) === UnitState.Work && started < 0) started = tick
      if (started >= 0 && state(s) === UnitState.Haul) finished = tick
    }
    expect(finished - started).toBe(3)
  })

  it('does not draw the node down until the work is done', () => {
    const s = setup({ nodes: timber() })
    const start = until(s, () => state(s) === UnitState.Work)
    expect(s.nodes.stock[0]).toBe(100)
    until(s, () => state(s) === UnitState.Haul, start + 1)
    expect(s.nodes.stock[0]).toBe(95)
  })

  it('carries no more than it can, and no more than a trip takes', () => {
    const s = setup({ nodes: timber(), carry: 3 })
    until(s, () => s.stockpiles.get(s.hall, ResourceType.Timber) > 0)
    expect(s.stockpiles.get(s.hall, ResourceType.Timber)).toBe(3)
    expect(s.nodes.stock[0]).toBe(97)
  })

  it('takes what is left when less than a trip remains, and then finds the deposit empty', () => {
    const s = setup({ nodes: timber(2) })
    until(s, () => s.stockpiles.get(s.hall, ResourceType.Timber) > 0)
    expect(s.stockpiles.get(s.hall, ResourceType.Timber)).toBe(2)
    expect(s.nodes.stock[0]).toBe(0)
  })

  it('gathers a ground resource from its own slot (stone) with its own rule', () => {
    const s = setup({
      nodes: [{ x: 30, y: 30, type: ResourceType.Stone, stock: 50 }],
      gather: { stone: ALL.stone }
    })
    until(s, () => s.stockpiles.get(s.hall, ResourceType.Stone) > 0)
    expect(s.stockpiles.get(s.hall, ResourceType.Stone)).toBe(3)
    expect(s.nodes.stock[0]).toBe(47)
  })

  it('draws down through the stock tracker, so the deposit regrows afterwards', () => {
    const s = setup({
      nodes: timber(),
      regrowth: { timber: { units: 1, period: 10 } }
    })
    const first = until(s, () => state(s) === UnitState.Haul)
    expect(s.stocks.pending).toBe(1)
    const low = s.nodes.stock[0] as number
    until(s, () => (s.nodes.stock[0] as number) > low, first)
  })

  it('goes round again: more trips, more in the hall', () => {
    const s = setup({ nodes: timber() })
    until(s, () => s.stockpiles.get(s.hall, ResourceType.Timber) >= 15)
    expect(s.stockpiles.get(s.hall, ResourceType.Timber) % 5).toBe(0)
    expect(s.nodes.stock[0]).toBe(100 - s.stockpiles.get(s.hall, ResourceType.Timber))
  })
})

describe('what a villager will not gather', () => {
  it('wanders when there is nothing to gather', () => {
    const s = setup({ nodes: [] })
    let walked = false
    for (let tick = 0; tick < 200; tick += 1) {
      s.system.step(tick)
      if (state(s) === UnitState.Walk) walked = true
      expect(state(s)).not.toBe(UnitState.Work)
    }
    expect(walked).toBe(true)
    expect(s.entities.goal[s.ids[0] as number]).toBe(0)
  })
  it('wanders when the deposit is further than it looks', () => {
    const s = setup({ nodes: [{ x: 60, y: 44, type: ResourceType.Timber, stock: 50 }], radius: 20 })
    for (let tick = 0; tick < 300; tick += 1) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Work)
    }
    expect(s.nodes.stock[0]).toBe(50)
  })
  it('gathers a deposit just inside its radius', () => {
    // from (6, 6) to (30, 6) is 24 tiles
    const s = setup({ nodes: [{ x: 30, y: 6, type: ResourceType.Timber, stock: 50 }], radius: 24 })
    until(s, () => state(s) === UnitState.Work)
  })
  it('ignores a resource that is not in the gather table', () => {
    const s = setup({ nodes: [{ x: 20, y: 20, type: ResourceType.Pearls, stock: 50 }] })
    for (let tick = 0; tick < 300; tick += 1) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Work)
    }
    expect(s.nodes.stock[0]).toBe(50)
  })
  it('wanders if the gather table is empty', () => {
    const s = setup({ nodes: [{ x: 20, y: 20, type: ResourceType.Timber, stock: 50 }], gather: {} })
    for (let tick = 0; tick < 200; tick += 1) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Work)
    }
  })
  it('does not gather for a villager that belongs to no hall (it has nowhere to take it)', () => {
    const s = setup({
      nodes: [{ x: 20, y: 20, type: ResourceType.Timber, stock: 50 }],
      villagers: [{ x: 6, y: 6, homeless: true }]
    })
    for (let tick = 0; tick < 300; tick += 1) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Work)
    }
    expect(s.nodes.stock[0]).toBe(50)
  })
  it('does not go for a deposit with nothing left in it', () => {
    const s = setup({
      nodes: [{ x: 20, y: 20, type: ResourceType.Timber, stock: 0, richness: 10 }]
    })
    for (let tick = 0; tick < 300; tick += 1) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Work)
    }
  })
  it('gives up on a deposit that was emptied while it walked there, and rests', () => {
    const s = setup({ nodes: [{ x: 50, y: 30, type: ResourceType.Timber, stock: 10 }] })
    const id = s.ids[0] as number
    const set = until(s, () => state(s) === UnitState.Walk && s.entities.goal[id] === 1)
    s.stocks.extractNode(0, 10) // someone else takes it all
    until(s, () => state(s) === UnitState.Rest, set + 1)
    expect(s.entities.goal[id]).toBe(0)
    expect(s.entities.carriedCount[id]).toBe(0)
    expect(s.stockpiles.get(s.hall, ResourceType.Timber)).toBe(0)
  })
})

describe('deposits in the water (fish) are worked from the shore', () => {
  const sea = (x: number, y: number): boolean => !(x >= 30 && x <= 34 && y >= 20 && y <= 24)
  it('stands on the lowest-row, lowest-column land tile next to the fish', () => {
    const s = setup({
      nodes: [{ x: 32, y: 22, type: ResourceType.Fish, stock: 30 }],
      land: sea,
      gather: { fish: ALL.fish }
    })
    const id = s.ids[0] as number
    // the fish are at (32, 22) in the middle of a 5 x 5 pond: no neighbour is land, so nobody can work them
    for (let tick = 0; tick < 200; tick += 1) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Work)
    }
    expect(s.entities.carriedCount[id]).toBe(0)
  })
  it('works fish on a shoal next to land', () => {
    // fish at (30, 22) in the pond's west edge: (29, 21) is the first land tile in reading order
    const s = setup({
      nodes: [{ x: 30, y: 22, type: ResourceType.Fish, stock: 30 }],
      land: sea,
      gather: { fish: ALL.fish }
    })
    const id = s.ids[0] as number
    until(s, () => state(s) === UnitState.Work)
    expect([s.entities.x[id], s.entities.y[id]]).toEqual([29, 21])
    until(s, () => s.stockpiles.get(s.hall, ResourceType.Fish) > 0)
    expect(s.stockpiles.get(s.hall, ResourceType.Fish)).toBe(6)
    expect(s.nodes.stock[0]).toBe(24)
  })
})

describe('deposits that go away', () => {
  it('never starts work on a deposit that was emptied on the way', () => {
    const s = setup({ nodes: [{ x: 50, y: 30, type: ResourceType.Timber, stock: 10 }] })
    const id = s.ids[0] as number
    const set = until(s, () => state(s) === UnitState.Walk && s.entities.goal[id] === 1)
    s.stocks.extractNode(0, 10)
    for (let tick = set + 1; tick < set + 200; tick += 1) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Work)
      expect(state(s)).not.toBe(UnitState.Haul)
    }
  })
  it('comes away empty-handed from a deposit that was emptied while it worked, without hauling nothing home', () => {
    const s = setup({ nodes: [{ x: 50, y: 30, type: ResourceType.Timber, stock: 10 }] })
    const id = s.ids[0] as number
    const start = until(s, () => state(s) === UnitState.Work)
    s.stocks.extractNode(0, 10)
    for (let tick = start + 1; tick < start + 200; tick += 1) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Haul)
      expect(s.entities.carriedCount[id]).toBe(0)
    }
    expect(s.stockpiles.get(s.hall, ResourceType.Timber)).toBe(0)
  })
  it('does not go for a deposit in a cell the routes call water, even if its tiles are land', () => {
    const rows = OPEN.map((r, y) => (y === 5 ? r.slice(0, 10) + '~' + r.slice(11) : r))
    // cell (10, 5) covers tiles 40..43 x 20..23
    const s = setup({ rows, nodes: [{ x: 41, y: 21, type: ResourceType.Timber, stock: 50 }] })
    for (let tick = 0; tick < 300; tick += 1) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Work)
    }
  })
})

describe('a deposit in the same cell', () => {
  it('is worked at once, with no walk', () => {
    // the villager rests at (6, 6) in cell (1, 1) (tiles 4..7); a tree at (4, 5) is in that cell
    const s = setup({ nodes: [{ x: 4, y: 5, type: ResourceType.Timber, stock: 20 }] })
    const id = s.ids[0] as number
    let walked = false
    let worked = false
    for (let tick = 0; tick < 100 && !worked; tick += 1) {
      s.system.step(tick)
      if (state(s) === UnitState.Walk) walked = true
      if (state(s) === UnitState.Work) {
        worked = true
        expect([s.entities.x[id], s.entities.y[id]]).toEqual([4, 5])
      }
    }
    expect(worked).toBe(true)
    expect(walked).toBe(false)
  })
  it('is taken home straight away when the hall is in the same cell', () => {
    const s = setup({ nodes: [{ x: 4, y: 5, type: ResourceType.Timber, stock: 20 }] })
    for (
      let tick = 0;
      tick < 100 && s.stockpiles.get(s.hall, ResourceType.Timber) === 0;
      tick += 1
    ) {
      s.system.step(tick)
      expect(state(s)).not.toBe(UnitState.Haul)
    }
    expect(s.stockpiles.get(s.hall, ResourceType.Timber)).toBe(5)
    expect(state(s)).toBe(UnitState.Rest)
  })
})

/** For each villager, what it does the first time it leaves Rest: the goal it set (0 for a wander) and the node's kind. */
function firstDepartures(s: S, limit = 50): Array<{ goal: number; kind: number }> {
  const out: Array<{ goal: number; kind: number } | undefined> = s.ids.map(() => undefined)
  for (let tick = 0; tick < limit; tick += 1) {
    s.system.step(tick)
    s.ids.forEach((id, i) => {
      if (out[i] === undefined && s.entities.state[id] !== UnitState.Rest) {
        const goal = s.entities.goal[id] as number
        out[i] = { goal, kind: goal === 0 ? 0 : (s.nodes.kind[goal - 1] as number) }
      }
    })
  }
  return out.map((o) => o ?? { goal: -1, kind: -1 })
}

describe('the first thing a villager does', () => {
  it('tries more than one kind: with one deposit among three kinds, every villager goes for it', () => {
    const s = setup({
      nodes: [{ x: 30, y: 10, type: ResourceType.Grain, stock: 200 }],
      gather: { timber: ALL.timber, grain: ALL.grain, stone: ALL.stone },
      villagers: Array.from({ length: 16 }, () => ({ x: 6, y: 6 }))
    })
    for (const d of firstDepartures(s)) expect(d.kind).toBe(ResourceType.Grain)
  })
  it('does not always start with the same kind', () => {
    const s = setup({
      nodes: [
        { x: 30, y: 10, type: ResourceType.Timber, stock: 200 },
        { x: 10, y: 30, type: ResourceType.Grain, stock: 200 },
        { x: 30, y: 30, type: ResourceType.Stone, stock: 200 }
      ],
      gather: { timber: ALL.timber, grain: ALL.grain, stone: ALL.stone },
      villagers: Array.from({ length: 30 }, () => ({ x: 6, y: 6 }))
    })
    const kinds = new Set(firstDepartures(s).map((d) => d.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(2)
  })
  it('reaches a deposit exactly as far away as its radius, but not one tile further', () => {
    // from (6, 6) a tree at (30, 6) is 24 tiles away
    const near = setup({
      nodes: [{ x: 30, y: 6, type: ResourceType.Timber, stock: 50 }],
      radius: 24
    })
    expect(firstDepartures(near)[0]!.goal).toBe(1)
    const far = setup({
      nodes: [{ x: 30, y: 6, type: ResourceType.Timber, stock: 50 }],
      radius: 23
    })
    expect(firstDepartures(far)[0]!.goal).toBe(0)
  })
})

describe('what villagers choose', () => {
  it('goes for different kinds on different tries (it is a draw, not always the nearest thing)', () => {
    const nodes: NodeSpec[] = [
      { x: 30, y: 10, type: ResourceType.Timber, stock: 200 },
      { x: 10, y: 30, type: ResourceType.Grain, stock: 200 },
      { x: 30, y: 30, type: ResourceType.Stone, stock: 200 }
    ]
    const s = setup({
      nodes,
      gather: { timber: ALL.timber, grain: ALL.grain, stone: ALL.stone },
      villagers: Array.from({ length: 30 }, () => ({ x: 6, y: 6 }))
    })
    for (let tick = 0; tick < 300; tick += 1) s.system.step(tick)
    for (const type of [ResourceType.Timber, ResourceType.Grain, ResourceType.Stone]) {
      expect(s.stockpiles.get(s.hall, type), String(type)).toBeGreaterThan(0)
    }
  })
  it('goes for the nearest deposit of the kind it picked', () => {
    const s = setup({
      gather: { timber: { work: 2, amount: 5 } },
      nodes: [
        { x: 50, y: 40, type: ResourceType.Timber, stock: 100 },
        { x: 20, y: 6, type: ResourceType.Timber, stock: 100 }
      ]
    })
    until(s, () => s.stockpiles.get(s.hall, ResourceType.Timber) > 0)
    expect(s.nodes.stock[s.nodes.nodeAt(6 * 64 + 20, 'surface')]).toBe(95)
    expect(s.nodes.stock[s.nodes.nodeAt(40 * 64 + 50, 'surface')]).toBe(100)
  })
})

describe('many villagers, one world: nothing is made or lost', () => {
  it('keeps hall + carried + deposits equal to what the deposits started with', () => {
    const nodes: NodeSpec[] = [
      { x: 30, y: 10, type: ResourceType.Timber, stock: 60 },
      { x: 12, y: 28, type: ResourceType.Grain, stock: 40 },
      { x: 36, y: 34, type: ResourceType.Stone, stock: 25 },
      { x: 46, y: 12, type: ResourceType.Fish, stock: 30 }
    ]
    const s = setup({
      nodes,
      gather: ALL,
      villagers: Array.from({ length: 40 }, (_, i) => ({ x: 6, y: 6 + (i % 3) }))
    })
    const total = 60 + 40 + 25 + 30
    for (let tick = 0; tick < 500; tick += 1) {
      s.system.step(tick)
      if (tick % 25 === 0) {
        let carried = 0
        for (const id of s.ids) carried += s.entities.carriedCount[id] as number
        let inHall = 0
        for (let r = 1; r <= 22; r += 1) inHall += s.stockpiles.get(s.hall, r)
        let left = 0
        for (let n = 0; n < s.nodes.count; n += 1) left += s.nodes.stock[n] as number
        expect(carried + inHall + left, `tick ${tick}`).toBe(total)
      }
    }
    // by now they have emptied the little deposits
    let inHall = 0
    for (let r = 1; r <= 22; r += 1) inHall += s.stockpiles.get(s.hall, r)
    expect(inHall).toBeGreaterThan(100)
  })
})

describe('the same world however it was reached', () => {
  const nodes: NodeSpec[] = [
    { x: 30, y: 10, type: ResourceType.Timber, stock: 200 },
    { x: 12, y: 28, type: ResourceType.Grain, stock: 200 },
    { x: 36, y: 34, type: ResourceType.Stone, stock: 200 }
  ]
  const THREE = { timber: ALL.timber, grain: ALL.grain, stone: ALL.stone }
  const crowd = Array.from({ length: 12 }, (_, i) => ({ x: 6, y: 6 + (i % 3) }))
  const snapshot = (s: S): string =>
    JSON.stringify([s.entities.toColumns(), s.stockpiles.toJson(), Array.from(s.nodes.stock)])

  it('goes on the same after the wheel is rebuilt from the rows in the middle of a run', () => {
    const a = setup({ nodes, gather: THREE, villagers: crowd })
    for (let tick = 0; tick < 300; tick += 1) a.system.step(tick)

    const b = setup({ nodes, gather: THREE, villagers: crowd })
    for (let tick = 0; tick < 120; tick += 1) b.system.step(tick)
    b.system.rebuild()
    for (let tick = 120; tick < 300; tick += 1) b.system.step(tick)
    expect(snapshot(b)).toBe(snapshot(a))
  })

  it('is the same each time it is run from the start', () => {
    const a = setup({ nodes, gather: THREE, villagers: crowd })
    for (let tick = 0; tick < 200; tick += 1) a.system.step(tick)
    const b = setup({ nodes, gather: THREE, villagers: crowd })
    for (let tick = 0; tick < 200; tick += 1) b.system.step(tick)
    expect(snapshot(b)).toBe(snapshot(a))
  })

  it('differs with another seed', () => {
    const a = setup({ nodes, gather: THREE, villagers: crowd, seed: 1 })
    const b = setup({ nodes, gather: THREE, villagers: crowd, seed: 2 })
    for (let tick = 0; tick < 200; tick += 1) {
      a.system.step(tick)
      b.system.step(tick)
    }
    expect(snapshot(b)).not.toBe(snapshot(a))
  })
})

describe('positions while gathering', () => {
  it('rests and works where it stands, walks and hauls along the route', () => {
    const s = setup({ nodes: [{ x: 50, y: 30, type: ResourceType.Timber, stock: 100 }] })
    const id = s.ids[0] as number
    let atWork: [number, number] | null = null
    let hauled = false
    for (let tick = 0; tick < 300 && !hauled; tick += 1) {
      s.system.step(tick)
      const p = s.system.positionAt(id, tick)
      if (state(s) === UnitState.Work) {
        atWork = p
        expect(p).toEqual([50, 30])
      }
      if (state(s) === UnitState.Haul) {
        hauled = true
        // just set off from the tree: still at its foot, and then on the way
        expect(p[0]).toBeCloseTo(50, 5)
        expect(p[1]).toBeCloseTo(30, 5)
        const later = s.system.positionAt(id, (s.entities.legStart[id] as number) + 1)
        expect(later[0] === 50 && later[1] === 30).toBe(false)
      }
    }
    expect(atWork).not.toBeNull()
    expect(hauled).toBe(true)
  })
})
