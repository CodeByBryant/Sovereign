/**
 * @module WanderSystem
 * @description The first behaviour: a villager rests, picks a place near home, walks there over the cheapest
 * route, rests, and goes again. It exists to put units on the map and to prove the machinery the real
 * behaviours (gathering, building, settling) will use; see docs/decisions/0008-units-and-a-living-world.md.
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
import { EntityKind, UnitState } from '@sovereign/contracts'
import type { EntityStore } from '../entities/EntityStore'
import { counterInt } from '../random/counter'
import type { CostGrid } from '../terrain/cost'
import { routePosition, type RouteCache } from '../terrain/pathing'

export interface WanderOptions {
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
}

/** What a draw is for, so two choices made on one tick by one unit are not the same number. */
const SALT_X = 1
const SALT_Y = 2
const SALT_REST = 3

export class WanderSystem {
  private readonly o: WanderOptions
  private readonly wheel: number[][]
  private readonly size: number
  /** For each cell, the tile a walker stands on there (packed `y * width + x`), or -1 until it is worked out. */
  private readonly anchors: Int32Array

  constructor(options: WanderOptions) {
    this.o = options
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
      if (entities.state[id] === UnitState.Walk) this.arrive(id, tick)
      else this.depart(id, tick)
    }
  }

  /** Where a villager is at `tick`, in tiles: where it rests, or along its route while it walks. */
  positionAt(id: number, tick: number): [number, number] {
    const { entities, grid, routes } = this.o
    const x = entities.x[id] as number
    const y = entities.y[id] as number
    if (entities.state[id] !== UnitState.Walk) return [x, y]
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

  /** Rested: pick somewhere near home and set off, or rest again if there is nowhere to go. */
  private depart(id: number, tick: number): void {
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

  /** Arrived: stand on the cell's anchor tile and rest. */
  private arrive(id: number, tick: number): void {
    const { entities } = this.o
    const [x, y] = this.anchorOf(entities.target[id] as number)
    entities.x[id] = x
    entities.y[id] = y
    entities.state[id] = UnitState.Rest
    entities.wake[id] = tick + this.rest(id, tick)
    this.schedule(id)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
