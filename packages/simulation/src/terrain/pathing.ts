/**
 * @module pathing
 * @description The cheapest way for a walker over the route cost grid ({@link ./cost}), and a cache that lets
 * everyone who walks the same way share one search.
 *
 * Pathfinding is the whole cost of a crowd (a probe on a 2000 x 2000 world: moving a unit is nearly free, a
 * search is about 50 microseconds), so a route between two cells is found once, kept forward and reversed, and
 * reused. The cache is only a memo: a route is a pure function of the grid, so the same cells come back
 * whether it was cached or not, and what it holds never has to be saved.
 *
 * A* over 8 neighbours (a step costs the mean of the two cells, so costs are the same either way and a route
 * reversed is exactly the route back) with an octile heuristic, on a deterministic heap (ties by cell index), expanding
 * neighbours in a fixed order and replacing a cell's cost only when strictly cheaper, so the same grid gives the
 * same route on every engine whatever was searched before it. Only `+ - * /` and `sqrt` of a constant.
 */
import type { CostGrid } from './cost'
import { MinHeap } from './heap'

/** A way from one cell to another. */
export interface Route {
  /** The cells, from the start to the goal (one cell for a route from a cell to itself). */
  cells: Int32Array
  /** The total cost: each step costs the mean of the two cells it joins (a diagonal one the square root of two times as much), so a route costs the same either way. */
  cost: number
  /** The cost paid on arriving at each cell: 0 at the start, `cost` at the goal. */
  cumulative: Float32Array
}

export interface PathfinderOptions {
  /** Only land cells may be walked (a boat may use sea lanes). @default true */
  landOnly?: boolean
  /** Give up (no route) after expanding this many cells, so a search never runs away. @default 6000 */
  maxExpand?: number
}

const DIAGONAL = 1.4142135623730951
const OCTILE = DIAGONAL - 1

export class Pathfinder {
  private readonly heap = new MinHeap(4096)
  private readonly g: Float32Array
  private readonly from: Int32Array
  private readonly seen: Uint32Array
  private stamp = 0
  private readonly landOnly: boolean
  private readonly maxExpand: number
  /** The least a step can cost, so the heuristic never overestimates. */
  private readonly minCost: number
  /** How many searches have been run (a cache hit is not one). */
  searches = 0

  constructor(
    readonly grid: CostGrid,
    options: PathfinderOptions = {}
  ) {
    const n = grid.cols * grid.rows
    this.g = new Float32Array(n)
    this.from = new Int32Array(n)
    this.seen = new Uint32Array(n)
    this.landOnly = options.landOnly ?? true
    this.maxExpand = options.maxExpand ?? 6000
    let least = Infinity
    for (let c = 0; c < n; c += 1) {
      const v = grid.cost[c] as number
      if (v < least && v > 0) least = v
    }
    this.minCost = least < Infinity ? least : 1
  }

  private walkable(cell: number): boolean {
    const c = this.grid.cost[cell] as number
    return c < Infinity && (!this.landOnly || this.grid.land[cell] === 1)
  }

  /** The cheapest route from one cell to another, or null if there is none (or it is too far to search). */
  find(start: number, goal: number): Route | null {
    const { cols, rows, cost } = this.grid
    const n = cols * rows
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(goal) ||
      start < 0 ||
      goal < 0 ||
      start >= n ||
      goal >= n
    ) {
      throw new RangeError('a route runs between two cells of the grid')
    }
    if (!this.walkable(start) || !this.walkable(goal)) return null
    this.searches += 1
    this.stamp += 1
    const heap = this.heap
    heap.clear()
    const gx = goal % cols
    const gy = (goal - gx) / cols
    const minCost = this.minCost
    const h = (c: number): number => {
      const x = c % cols
      const dx = Math.abs(x - gx)
      const dy = Math.abs((c - x) / cols - gy)
      return (Math.max(dx, dy) + OCTILE * Math.min(dx, dy)) * minCost
    }
    this.g[start] = 0
    this.seen[start] = this.stamp
    this.from[start] = -1
    heap.push(h(start), start)
    let expanded = 0
    while (heap.size > 0) {
      const cell = heap.pop()
      if (cell === goal) return this.build(goal)
      expanded += 1
      if (expanded > this.maxExpand) return null
      const x = cell % cols
      const y = (cell - x) / cols
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
          const next = ny * cols + nx
          if (!this.walkable(next)) continue
          const step =
            (dx !== 0 && dy !== 0 ? DIAGONAL : 1) *
            (((cost[cell] as number) + (cost[next] as number)) / 2)
          const total = (this.g[cell] as number) + step
          if (this.seen[next] !== this.stamp || total < (this.g[next] as number)) {
            this.seen[next] = this.stamp
            this.g[next] = total
            this.from[next] = cell
            heap.push(total + h(next), next)
          }
        }
      }
    }
    return null
  }

  private build(goal: number): Route {
    let length = 0
    for (let c = goal; c >= 0; c = this.from[c] as number) length += 1
    const cells = new Int32Array(length)
    const cumulative = new Float32Array(length)
    let i = length - 1
    for (let c = goal; c >= 0; c = this.from[c] as number) {
      cells[i] = c
      cumulative[i] = this.g[c] as number
      i -= 1
    }
    return { cells, cost: this.g[goal] as number, cumulative }
  }
}

/** The same route walked the other way. */
function reversed(route: Route): Route {
  const n = route.cells.length
  const cells = new Int32Array(n)
  const cumulative = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    cells[i] = route.cells[n - 1 - i] as number
    cumulative[i] = route.cost - (route.cumulative[n - 1 - i] as number)
  }
  return { cells, cost: route.cost, cumulative }
}

/** Routes found so far, each kept for the way there and the way back. */
export class RouteCache {
  private readonly routes = new Map<number, Route | null>()
  private readonly cells: number

  constructor(
    private readonly finder: Pathfinder,
    private readonly capacity = 100_000
  ) {
    this.cells = finder.grid.cols * finder.grid.rows
  }

  /** How many routes (and remembered absences) are held. */
  get size(): number {
    return this.routes.size
  }

  /** The route between two cells, from the cache if it was walked before, or null if there is none. */
  route(start: number, goal: number): Route | null {
    const key = start * this.cells + goal
    const held = this.routes.get(key)
    if (held !== undefined) return held
    const found = this.finder.find(start, goal)
    if (this.routes.size >= this.capacity) this.routes.clear() // start again: the memo is only ever a memo
    this.routes.set(key, found)
    this.routes.set(goal * this.cells + start, found === null ? null : reversed(found))
    return found
  }

  clear(): void {
    this.routes.clear()
  }
}

/**
 * Where a walker is when it has paid `progress` (0 to 1) of a route's cost, in tiles: between the centres of the
 * cells it is crossing, in proportion to the cost of each step (so it dawdles through rough ground).
 */
export function routePosition(route: Route, grid: CostGrid, progress: number): [number, number] {
  const { cells, cumulative, cost } = route
  const centre = (cell: number): [number, number] => {
    const x = cell % grid.cols
    return [
      x * grid.cell + (grid.cell >> 1),
      ((cell - x) / grid.cols) * grid.cell + (grid.cell >> 1)
    ]
  }
  if (cells.length === 1 || !(cost > 0)) return centre(cells[0] as number)
  const paid = Math.min(1, Math.max(0, progress)) * cost
  let lo = 0
  let hi = cells.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((cumulative[mid] as number) <= paid) lo = mid
    else hi = mid
  }
  const [ax, ay] = centre(cells[lo] as number)
  const [bx, by] = centre(cells[hi] as number)
  const span = (cumulative[hi] as number) - (cumulative[lo] as number)
  const f = span > 0 ? Math.min(1, Math.max(0, (paid - (cumulative[lo] as number)) / span)) : 0
  return [ax + (bx - ax) * f, ay + (by - ay) * f]
}
