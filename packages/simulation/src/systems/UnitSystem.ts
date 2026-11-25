/**
 * @module UnitSystem
 * @description What villagers do. A villager that belongs to a hall **gathers**: it rests, picks a kind of
 * resource, walks to the nearest deposit of it within reach, works there for some ticks, takes what the
 * deposit and its own strength allow, carries it home over the cheapest route and drops it in its hall's
 * stockpile. A villager with no hall, or with nothing in reach, **wanders**: it picks a place near home, walks
 * there, rests and goes again. See docs/decisions/0008-units-and-a-living-world.md.
 *
 * The states a villager is in: Rest (wake = when it next acts), Walk (a route to `target`; if `goal` is set it
 * is going to that deposit), Work (at the deposit `goal`, until `wake`) and Haul (a route home carrying
 * `carriedType` x `carriedCount`).
 *
 * **Event-driven.** A villager acts only when its `wake` tick comes round; a timer wheel holds who is due when,
 * so a tick costs what happens in it, not how many units there are. A walker's position between events is not
 * stored: it is worked out on demand from its route and how much of the leg has passed ({@link positionAt}),
 * which is all a renderer needs.
 *
 * **Same world however it was reached.** The wheel is derived from the rows' `wake` fields ({@link rebuild}),
 * the units due on a tick are handled in id order whatever order they were put on the wheel in, and every
 * choice is a counter-based draw keyed by (seed, unit, tick, purpose), so a world rebuilt from a save goes on
 * exactly as the original would. Routes come from a shared cache that is only ever a memo.
 */
import type { UnitsConfig } from '@sovereign/config'
import { EntityKind, RESOURCE_CATALOG, UnitState } from '@sovereign/contracts'
import type { EntityStore } from '../entities/EntityStore'
import { counterInt } from '../random/counter'
import type { NodeIndex } from '../resources/NodeIndex'
import type { NodeStore } from '../resources/NodeStore'
import type { CostGrid } from '../terrain/cost'
import { routePosition, type RouteCache } from '../terrain/pathing'
import type { Stockpiles } from '../world/Stockpiles'

/** What gathering needs: the deposits, a way to find the nearest, a way to take from one, and where it all goes. */
export interface GatherOptions {
  nodes: NodeStore
  index: NodeIndex
  stockpiles: Stockpiles
  /** Take up to `amount` from a node; returns what was taken (it also tells the world a stock changed). */
  extract: (node: number, amount: number) => number
}

export interface UnitOptions {
  entities: EntityStore
  grid: CostGrid
  routes: RouteCache
  config: UnitsConfig
  seed: number
  /** The map's size in tiles (the last cell of a row or column may be only partly on it). */
  width: number
  height: number
  /** Slots in the timer wheel. @default 4096 */
  wheelSize?: number
  /** Whether a tile is land: a cell counts as land when half its tiles are, so its middle may be water. */
  land: (x: number, y: number) => boolean
  /** Without this, villagers only wander. */
  gather?: GatherOptions
}

/** What a draw is for, so two choices made on one tick by one unit are not the same number. */
const SALT_X = 1
const SALT_Y = 2
const SALT_REST = 3
const SALT_KIND = 4

/** How many kinds of resource a resting villager tries, from a random one on, before it gives up and wanders. */
const GATHER_TRIES = 3

/**
 * The tile a villager stands on to work a deposit on tile (x, y): the tile itself when it is land, else the
 * land tile next to it that comes first in reading order (row, then column); -1 if there is none (a deposit
 * out at sea cannot be worked).
 */
export function workTile(
  x: number,
  y: number,
  width: number,
  height: number,
  land: (x: number, y: number) => boolean
): number {
  if (land(x, y)) return y * width + x
  for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny += 1) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx += 1) {
      if (land(nx, ny)) return ny * width + nx
    }
  }
  return -1
}

export class UnitSystem {
  private readonly o: UnitOptions
  private readonly wheel: number[][]
  private readonly size: number
  /** For each cell, the tile a walker stands on there (packed `y * width + x`), or -1 until it is worked out. */
  private readonly anchors: Int32Array

  /** The resources villagers gather, in catalogue order, with how long and how much (from the config). */
  private readonly rules: Array<{ kind: number; work: number; amount: number }> = []
  /** For each resource id, its place in `rules`, or -1. */
  private readonly ruleOf = new Int32Array(RESOURCE_CATALOG.length + 1).fill(-1)

  constructor(options: UnitOptions) {
    this.o = options
    for (const def of RESOURCE_CATALOG) {
      const rule = options.config.gather[def.key]
      if (rule === undefined) continue
      this.ruleOf[def.id] = this.rules.length
      this.rules.push({ kind: def.id, work: rule.work, amount: rule.amount })
    }
    this.size = options.wheelSize ?? 4096
    this.wheel = Array.from({ length: this.size }, () => [])
    this.anchors = new Int32Array(options.grid.cols * options.grid.rows).fill(-1)
  }

  /** Put a villager on a tile, resting, with its first wake-up a little way off (so a crowd does not set off together). */
  spawnVillager(x: number, y: number, owner: number, home: number, tick = 0, hall = 0): number {
    const id = this.o.entities.spawn({
      kind: EntityKind.Villager,
      x,
      y,
      owner,
      home,
      hall,
      state: UnitState.Rest
    })
    this.o.entities.wake[id] = tick + this.rest(id, tick)
    this.schedule(id)
    return id
  }

  /** Find every villager's timer again from its row: after a restore, or to put the wheel back in order. */
  rebuild(): void {
    for (const bucket of this.wheel) bucket.length = 0
    for (const id of this.o.entities.ids()) {
      if (this.o.entities.kind[id] === EntityKind.Villager) this.schedule(id)
    }
  }

  /** Handle everyone who is due on this tick, lowest id first. */
  step(tick: number): void {
    const slot = tick % this.size
    const due = this.wheel[slot] as number[]
    if (due.length === 0) return
    this.wheel[slot] = []
    due.sort((a, b) => a - b)
    const { entities } = this.o
    let previous = -1
    for (const id of due) {
      if (id === previous) continue // on the wheel twice
      previous = id
      if (!entities.alive(id)) continue
      const wake = entities.wake[id] as number
      if (wake !== tick) {
        if (wake > tick) this.schedule(id) // a walk longer than the wheel: round again
        continue
      }
      const state = entities.state[id]
      if (state === UnitState.Walk) this.arrive(id, tick)
      else if (state === UnitState.Work) this.finishWork(id, tick)
      else if (state === UnitState.Haul) this.arriveHome(id, tick)
      else this.depart(id, tick)
    }
  }

  /** Where a villager is at `tick`, in tiles: where it rests, or along its route while it walks. */
  positionAt(id: number, tick: number): [number, number] {
    const { entities, grid, routes } = this.o
    const x = entities.x[id] as number
    const y = entities.y[id] as number
    if (entities.state[id] !== UnitState.Walk && entities.state[id] !== UnitState.Haul)
      return [x, y]
    const route = routes.route(this.cellOf(x, y), entities.target[id] as number)
    if (route === null) return [x, y]
    const span = (entities.legEnd[id] as number) - (entities.legStart[id] as number)
    const progress = span > 0 ? (tick - (entities.legStart[id] as number)) / span : 1
    return routePosition(route, grid, progress, (cell) => this.anchorOf(cell))
  }

  /**
   * The tile a walker stands on in a cell: the land tile nearest the middle (ties to the lowest row, then the
   * lowest column), or the middle itself if the cell holds no land. Worked out once per cell.
   */
  anchorOf(cell: number): [number, number] {
    const { grid, width, height, land } = this.o
    let packed = this.anchors[cell] as number
    if (packed < 0) {
      const cx = cell % grid.cols
      const cy = (cell - cx) / grid.cols
      const half = grid.cell >> 1
      const mx = Math.min(width - 1, cx * grid.cell + half)
      const my = Math.min(height - 1, cy * grid.cell + half)
      let best = -1
      let bestD = Infinity
      for (let y = cy * grid.cell; y < Math.min(height, (cy + 1) * grid.cell); y += 1) {
        for (let x = cx * grid.cell; x < Math.min(width, (cx + 1) * grid.cell); x += 1) {
          if (!land(x, y)) continue
          const d = (x - mx) * (x - mx) + (y - my) * (y - my)
          if (d < bestD) {
            bestD = d
            best = y * width + x
          }
        }
      }
      packed = best >= 0 ? best : my * width + mx
      this.anchors[cell] = packed
    }
    const x = packed % width
    return [x, (packed - x) / width]
  }

  private schedule(id: number): void {
    const wake = this.o.entities.wake[id] as number
    ;(this.wheel[wake % this.size] as number[]).push(id)
  }

  private rest(id: number, tick: number): number {
    const { restMin, restMax } = this.o.config
    return restMin + counterInt(this.o.seed, id, tick, SALT_REST, restMax - restMin + 1)
  }

  private cellOf(x: number, y: number): number {
    const { grid } = this.o
    return Math.floor(y / grid.cell) * grid.cols + Math.floor(x / grid.cell)
  }

  /** Rested: go and gather if there is something to, else pick somewhere near home, or rest again. */
  private depart(id: number, tick: number): void {
    if (this.o.gather !== undefined && this.o.entities.hall[id] !== 0 && this.tryGather(id, tick))
      return
    const { entities, grid, routes, config, seed } = this.o
    const home = entities.home[id] as number
    const hx = home % grid.cols
    const hy = (home - hx) / grid.cols
    const r = config.wanderRadius
    const tx = clamp(hx + counterInt(seed, id, tick, SALT_X, 2 * r + 1) - r, 0, grid.cols - 1)
    const ty = clamp(hy + counterInt(seed, id, tick, SALT_Y, 2 * r + 1) - r, 0, grid.rows - 1)
    const target = ty * grid.cols + tx
    const here = this.cellOf(entities.x[id] as number, entities.y[id] as number)
    const route = target === here || grid.land[target] !== 1 ? null : routes.route(here, target)
    if (route === null) {
      entities.wake[id] = tick + this.rest(id, tick)
    } else {
      const ticks = Math.max(1, Math.ceil(route.cost / config.walkSpeed))
      entities.state[id] = UnitState.Walk
      entities.target[id] = target
      entities.legStart[id] = tick
      entities.legEnd[id] = tick + ticks
      entities.wake[id] = tick + ticks
    }
    this.schedule(id)
  }

  /** Arrived: at a deposit it was after, start work; anywhere else stand on the cell's anchor tile and rest. */
  private arrive(id: number, tick: number): void {
    const { entities, gather } = this.o
    const goal = entities.goal[id] as number
    if (gather !== undefined && goal !== 0) {
      const node = goal - 1
      const tile = gather.nodes.tile[node] as number
      const { width } = this.o
      const wt = gather.nodes.stock[node] === 0 ? -1 : this.workTileOf(tile)
      if (wt >= 0) {
        this.startWork(id, tick, node, wt % width, Math.floor(wt / width))
        return
      }
      entities.goal[id] = 0 // it was emptied while the villager walked: nothing to do here
    }
    const [x, y] = this.anchorOf(entities.target[id] as number)
    entities.x[id] = x
    entities.y[id] = y
    entities.state[id] = UnitState.Rest
    entities.wake[id] = tick + this.rest(id, tick)
    this.schedule(id)
  }

  private workTileOf(tile: number): number {
    const { width, height, land } = this.o
    return workTile(tile % width, Math.floor(tile / width), width, height, land)
  }

  /** Look for something to gather: true if the villager is on its way (or already at work). */
  private tryGather(id: number, tick: number): boolean {
    const { entities, grid, routes, config, seed, gather, width } = this.o
    const rules = this.rules
    if (gather === undefined || rules.length === 0) return false
    const x = entities.x[id] as number
    const y = entities.y[id] as number
    const here = this.cellOf(x, y)
    const first = counterInt(seed, id, tick, SALT_KIND, rules.length)
    const reach = config.searchRadius
    const maxRing = Math.ceil(reach / gather.index.cell)
    for (let k = 0; k < Math.min(GATHER_TRIES, rules.length); k += 1) {
      const rule = rules[(first + k) % rules.length] as {
        kind: number
        work: number
        amount: number
      }
      const node = gather.index.nearest(rule.kind, x, y, maxRing)
      if (node < 0) continue
      const tile = gather.nodes.tile[node] as number
      const nx = tile % width
      const ny = (tile - nx) / width
      if ((nx - x) * (nx - x) + (ny - y) * (ny - y) > reach * reach) continue
      const wt = this.workTileOf(tile)
      if (wt < 0) continue
      const wx = wt % width
      const wy = (wt - wx) / width
      const target = this.cellOf(wx, wy)
      if (grid.land[target] !== 1) continue
      if (target === here) {
        this.startWork(id, tick, node, wx, wy)
        return true
      }
      const route = routes.route(here, target)
      if (route === null) continue
      const ticks = Math.max(1, Math.ceil(route.cost / config.walkSpeed))
      entities.state[id] = UnitState.Walk
      entities.goal[id] = node + 1
      entities.target[id] = target
      entities.legStart[id] = tick
      entities.legEnd[id] = tick + ticks
      entities.wake[id] = tick + ticks
      this.schedule(id)
      return true
    }
    return false
  }

  /** Begin work at deposit `node`, standing on (x, y). */
  private startWork(id: number, tick: number, node: number, x: number, y: number): void {
    const { entities, gather } = this.o
    const kind = (gather as GatherOptions).nodes.kind[node] as number
    const rule = this.rules[this.ruleOf[kind] as number] as { work: number }
    entities.x[id] = x
    entities.y[id] = y
    entities.state[id] = UnitState.Work
    entities.goal[id] = node + 1
    entities.target[id] = 0
    entities.legStart[id] = 0
    entities.legEnd[id] = 0
    entities.wake[id] = tick + rule.work
    this.schedule(id)
  }

  /** Work is done: take what there is, and carry it home (or hand it in at once if home is here). */
  private finishWork(id: number, tick: number): void {
    const { entities, grid, routes, config } = this.o
    const gather = this.o.gather as GatherOptions
    const node = (entities.goal[id] as number) - 1
    const kind = gather.nodes.kind[node] as number
    const rule = this.rules[this.ruleOf[kind] as number] as { amount: number }
    const got = gather.extract(node, Math.min(rule.amount, config.carryCapacity))
    entities.goal[id] = 0
    if (got === 0) {
      this.restHere(id, tick)
      return
    }
    entities.carriedType[id] = kind
    entities.carriedCount[id] = got
    const home = entities.home[id] as number
    const here = this.cellOf(entities.x[id] as number, entities.y[id] as number)
    const route = here === home || grid.land[home] !== 1 ? null : routes.route(here, home)
    if (route === null) {
      // nowhere to walk to (home is here, or not reachable): hand the goods in on the spot
      this.deposit(id)
      this.restHere(id, tick)
      return
    }
    const ticks = Math.max(1, Math.ceil(route.cost / config.walkSpeed))
    entities.state[id] = UnitState.Haul
    entities.target[id] = home
    entities.legStart[id] = tick
    entities.legEnd[id] = tick + ticks
    entities.wake[id] = tick + ticks
    this.schedule(id)
  }

  /** Home with a load: stand on the anchor tile, hand it in, rest. */
  private arriveHome(id: number, tick: number): void {
    const { entities } = this.o
    const [x, y] = this.anchorOf(entities.target[id] as number)
    entities.x[id] = x
    entities.y[id] = y
    this.deposit(id)
    this.restHere(id, tick)
  }

  /** Put what a villager carries into its hall's stockpile. */
  private deposit(id: number): void {
    const { entities } = this.o
    const gather = this.o.gather as GatherOptions
    gather.stockpiles.add(
      (entities.hall[id] as number) - 1,
      entities.carriedType[id] as number,
      entities.carriedCount[id] as number
    )
    entities.carriedType[id] = 0
    entities.carriedCount[id] = 0
  }

  /** Stop where it is and rest. */
  private restHere(id: number, tick: number): void {
    const { entities } = this.o
    entities.state[id] = UnitState.Rest
    entities.target[id] = 0
    entities.legStart[id] = 0
    entities.legEnd[id] = 0
    entities.wake[id] = tick + this.rest(id, tick)
    this.schedule(id)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
