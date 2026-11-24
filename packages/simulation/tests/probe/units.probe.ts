// A measurement, not a test: what does a simulated unit cost? Prototypes a gatherer loop (idle -> pick a
// target -> A* over the 4-tile cost grid -> walk -> work -> walk home -> deposit) for N units in typed arrays,
// two ways, so the design can pick tick semantics and a unit budget (ADR 0008, M0):
//
//   stepped: every walking unit moves one tile every tick (the obvious way);
//   events : a unit schedules its arrival and sleeps; only arrivals and work timers cost anything, and its
//            position is worked out on demand (what a renderer needs for the units on screen).
//
//   pnpm --filter @sovereign/simulation probe -- tests/probe/units.probe.ts
//
// PROBE_UNITS=2000,10000,30000 sets the unit counts; PROBE_TICKS the ticks per run (default 600).
import { it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { buildCostGrid, type CostGrid } from '../../src/terrain/cost'
import { MinHeap } from '../../src/terrain/heap'
import { World } from '../../src/world/World'

const counts = (process.env.PROBE_UNITS ?? '2000,10000,30000')
  .split(',')
  .map((s) => Number.parseInt(s, 10))
  .filter((n) => n > 0)
const TICKS = Number.parseInt(process.env.PROBE_TICKS ?? '600', 10)
/** Work spots per village when routes are reused (trees, a field, a quarry: a worker revisits places). */
const SPOTS = Number.parseInt(process.env.PROBE_SPOTS ?? '40', 10)

/** A small deterministic generator (the probe must be repeatable, it is not the engine's). */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

class Pathing {
  private readonly heap = new MinHeap(4096)
  private readonly g: Float32Array
  private readonly from: Int32Array
  private readonly seen: Uint32Array
  private stamp = 0
  expansions = 0
  searches = 0
  constructor(private readonly grid: CostGrid) {
    const n = grid.cols * grid.rows
    this.g = new Float32Array(n)
    this.from = new Int32Array(n)
    this.seen = new Uint32Array(n)
  }

  /** A* between two cells (8 neighbours, octile heuristic); the cells from `to` back to `from`, or null. */
  find(a: number, b: number, maxExpand = 6000): number[] | null {
    const { cols, rows, cost } = this.grid
    this.stamp += 1
    this.searches += 1
    const heap = this.heap
    const bx = b % cols
    const by = (b - bx) / cols
    const h = (c: number): number => {
      const x = c % cols
      const dx = Math.abs(x - bx)
      const dy = Math.abs((c - x) / cols - by)
      return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy)
    }
    heap.clear()
    this.g[a] = 0
    this.seen[a] = this.stamp
    this.from[a] = -1
    heap.push(h(a), a)
    let expanded = 0
    while (heap.size > 0) {
      const cell = heap.pop()
      if (cell === b) {
        const path: number[] = []
        for (let c = b; c >= 0; c = this.from[c] as number) path.push(c)
        this.expansions += expanded
        return path
      }
      expanded += 1
      if (expanded > maxExpand) break
      const x = cell % cols
      const y = (cell - x) / cols
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
          const n = ny * cols + nx
          const c = cost[n] as number
          if (!(c < Infinity)) continue
          const step = (dx !== 0 && dy !== 0 ? 1.41421356 : 1) * c
          const gn = (this.g[cell] as number) + step
          if (this.seen[n] !== this.stamp || gn < (this.g[n] as number)) {
            this.seen[n] = this.stamp
            this.g[n] = gn
            this.from[n] = cell
            heap.push(gn + h(n), n)
          }
        }
      }
    }
    this.expansions += expanded
    return null
  }
}

interface Setup {
  grid: CostGrid
  /** Village cells (the hubs) */
  villages: Int32Array
  /** Land cells with a finite cost, for picking work targets */
  workable: (village: number, rand: () => number) => number
}

const IDLE = 0
const WALK_OUT = 1
const WORK = 2
const WALK_HOME = 3

function simulate(
  mode: 'stepped' | 'events',
  n: number,
  setup: Setup,
  paths: Pathing,
  cached = false
): { msPerTick: number; legsPerTick: number; searchMs: number; positionUsFor3000: number } {
  const { grid, villages } = setup
  const { cols } = grid
  const rand = rng(12345)
  const ux = new Uint16Array(n) // tile position
  const uy = new Uint16Array(n)
  const state = new Uint8Array(n)
  const home = new Int32Array(n)
  const target = new Int32Array(n)
  const wake = new Int32Array(n) // events: the tick a unit next needs attention
  const pathStart = new Int32Array(n)
  // paths are kept as one JS array per unit while it walks (the probe's cost; a real store would pool them)
  const route: Array<Int32Array | null> = new Array(n).fill(null)
  const step = new Int32Array(n)
  const WORK_TICKS = 12
  const SPEED = 1 // tiles per tick

  for (let i = 0; i < n; i += 1) {
    const v = villages[i % villages.length] as number
    home[i] = v
    ux[i] = (v % cols) * grid.cell + 2
    uy[i] = Math.floor(v / cols) * grid.cell + 2
    wake[i] = Math.floor(rand() * 20)
  }
  // a timer wheel: unit ids by the tick they wake
  const wheelSize = 4096
  const wheel: number[][] = Array.from({ length: wheelSize }, () => [])
  for (let i = 0; i < n; i += 1) wheel[(wake[i] as number) % wheelSize]!.push(i)
  // movers for the stepped mode: a dense list
  const movers: number[] = []

  const tileOfCell = (c: number): [number, number] => [
    (c % cols) * grid.cell + (grid.cell >> 1),
    Math.floor(c / cols) * grid.cell + (grid.cell >> 1)
  ]
  let legs = 0
  let searchMs = 0

  // routes between two cells, shared by everyone who walks them (and the same route backwards)
  const cache = new Map<number, Int32Array | null>()
  const lookup = (from: number, to: number): Int32Array | null => {
    const key = from * 250000 + to
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const p = paths.find(from, to)
    if (p === null) {
      cache.set(key, null)
      return null
    }
    p.reverse()
    const forward = Int32Array.from(p)
    cache.set(key, forward)
    cache.set(to * 250000 + from, forward.slice().reverse())
    return forward
  }

  const startLeg = (i: number, from: number, to: number, tick: number, next: number): boolean => {
    const t0 = performance.now()
    let found: Int32Array | null
    if (cached) found = lookup(from, to)
    else {
      const p = paths.find(from, to)
      found = p === null ? null : Int32Array.from(p.reverse())
    }
    searchMs += performance.now() - t0
    if (found === null) return false
    legs += 1
    const p = found
    route[i] = found
    step[i] = 0
    pathStart[i] = tick
    state[i] = next
    // length in tiles ~ cells * cell size
    const arrive = tick + Math.max(1, Math.ceil(((p.length - 1) * grid.cell) / SPEED))
    wake[i] = arrive
    if (mode === 'events') wheel[arrive % wheelSize]!.push(i)
    else movers.push(i)
    return true
  }

  const cellOf = (i: number): number =>
    Math.floor((uy[i] as number) / grid.cell) * cols + Math.floor((ux[i] as number) / grid.cell)

  const t0 = performance.now()
  for (let tick = 0; tick < TICKS; tick += 1) {
    if (mode === 'stepped') {
      // every walking unit moves one tile toward the next cell centre
      for (let k = movers.length - 1; k >= 0; k -= 1) {
        const i = movers[k] as number
        const r = route[i] as Int32Array
        const s = step[i] as number
        const [tx, ty] = tileOfCell(r[Math.min(s + 1, r.length - 1)] as number)
        const x = ux[i] as number
        const y = uy[i] as number
        if (x < tx) ux[i] = x + 1
        else if (x > tx) ux[i] = x - 1
        if (y < ty) uy[i] = y + 1
        else if (y > ty) uy[i] = y - 1
        if (ux[i] === tx && uy[i] === ty) step[i] = s + 1
        if ((step[i] as number) >= r.length - 1 && tick >= (wake[i] as number)) {
          movers[k] = movers[movers.length - 1] as number
          movers.pop()
          wheel[tick % wheelSize]!.push(i)
        }
      }
    }
    const due = wheel[tick % wheelSize] as number[]
    wheel[tick % wheelSize] = []
    for (const i of due) {
      const s = state[i] as number
      if (s === IDLE) {
        // pick a work target near home and walk out
        const tgt = setup.workable(home[i] as number, rand)
        target[i] = tgt
        if (!startLeg(i, cellOf(i), tgt, tick, WALK_OUT)) wheel[(tick + 5) % wheelSize]!.push(i)
      } else if (s === WALK_OUT) {
        const [tx, ty] = tileOfCell(target[i] as number)
        ux[i] = tx
        uy[i] = ty
        state[i] = WORK
        wake[i] = tick + WORK_TICKS
        wheel[wake[i] % wheelSize]!.push(i)
      } else if (s === WORK) {
        if (!startLeg(i, target[i] as number, home[i] as number, tick, WALK_HOME)) state[i] = IDLE
      } else if (s === WALK_HOME) {
        const [tx, ty] = tileOfCell(home[i] as number)
        ux[i] = tx
        uy[i] = ty
        state[i] = IDLE
        wake[i] = tick + 1
        wheel[wake[i] % wheelSize]!.push(i)
      }
    }
  }
  const ms = performance.now() - t0

  // what a renderer needs: the position of 3000 visible units at an arbitrary tick, from their routes
  const probeTick = TICKS - 1
  const visible = Math.min(3000, n)
  const t1 = performance.now()
  let sink = 0
  for (let rep = 0; rep < 20; rep += 1) {
    for (let k = 0; k < visible; k += 1) {
      const i = k
      const r = route[i]
      if (r === null || state[i] === WORK || state[i] === IDLE) {
        sink += ux[i] as number
        continue
      }
      const walked = ((probeTick - (pathStart[i] as number)) * SPEED) / grid.cell
      const seg = Math.min(r.length - 2, Math.max(0, Math.floor(walked)))
      const f = Math.min(1, Math.max(0, walked - seg))
      const [ax, ay] = tileOfCell(r[seg] as number)
      const [bx, by] = tileOfCell(r[seg + 1] as number)
      sink += ax + (bx - ax) * f + ay + (by - ay) * f
    }
  }
  const positionUs = ((performance.now() - t1) / 20 / visible) * 1000 * 3000
  void sink
  return {
    msPerTick: ms / TICKS,
    legsPerTick: legs / TICKS,
    searchMs: searchMs / TICKS,
    positionUsFor3000: positionUs
  }
}

it('measures what units cost', () => {
  const world = World.create({ seed: 1337, config: { nations: { count: 0 } } })
  const t = world.terrain
  const grid = buildCostGrid({
    width: t.width,
    height: t.height,
    seaLevel: t.seaLevel,
    elevation: t.elevation,
    biomeIds: t.biomeIds,
    riverMask: t.riverMask,
    riverWidth: t.riverWidth,
    highlandElevation: world.config.biomes.highlandElevation,
    slopeScale: world.config.resources.features.slopeScale,
    cell: world.config.routes.cell,
    config: world.config.routes.cost
  })
  const villages = Int32Array.from(
    t.hubs.map((h) => Math.floor(h.y / grid.cell) * grid.cols + Math.floor(h.x / grid.cell))
  )
  const R = 10 // work targets within this many cells of home
  const workable = (v: number, rand: () => number): number => {
    for (let tries = 0; tries < 30; tries += 1) {
      const vx = v % grid.cols
      const vy = (v - vx) / grid.cols
      const x = Math.max(0, Math.min(grid.cols - 1, vx + Math.floor((rand() * 2 - 1) * R)))
      const y = Math.max(0, Math.min(grid.rows - 1, vy + Math.floor((rand() * 2 - 1) * R)))
      const c = y * grid.cols + x
      if (c !== v && grid.land[c] === 1 && (grid.cost[c] as number) < Infinity) return c
    }
    return v
  }
  const lines: string[] = [
    `world ${t.width}x${t.height}, cost grid ${grid.cols}x${grid.rows}, ${villages.length} villages, ${TICKS} ticks, 1 tile per tick, work 12 ticks, targets within ${R} cells`
  ]
  const paths = new Pathing(grid)
  // A* on its own
  const rand = rng(99)
  const t0 = performance.now()
  let lenSum = 0
  let found = 0
  for (let k = 0; k < 2000; k += 1) {
    const v = villages[k % villages.length] as number
    const p = paths.find(v, workable(v, rand))
    if (p !== null) {
      found += 1
      lenSum += p.length
    }
  }
  const astarMs = (performance.now() - t0) / 2000
  lines.push(
    `A*: ${(astarMs * 1000).toFixed(0)} us per search, ${found}/2000 found, mean ${(lenSum / Math.max(1, found)).toFixed(1)} cells, ${(paths.expansions / paths.searches).toFixed(0)} expansions per search`
  )
  for (const n of counts) {
    for (const mode of ['stepped', 'events', 'events+cache'] as const) {
      const cachedRun = mode === 'events+cache'
      const spots = new Map<number, number[]>()
      const pick = (v: number, r: () => number): number => {
        let list = spots.get(v)
        if (list === undefined) {
          const own = rng(v + 7)
          list = Array.from({ length: SPOTS }, () => workable(v, own))
          spots.set(v, list)
        }
        return list[Math.floor(r() * list.length)] as number
      }
      const r = simulate(
        cachedRun ? 'events' : mode,
        n,
        { grid, villages, workable: cachedRun ? pick : workable },
        new Pathing(grid),
        cachedRun
      )
      lines.push(
        `${String(n).padStart(6)} units ${mode.padEnd(12)}: ${r.msPerTick.toFixed(3)} ms per tick (${(1000 / r.msPerTick).toFixed(0)} ticks per second), ${r.legsPerTick.toFixed(1)} legs per tick (${r.searchMs.toFixed(3)} ms of search per tick), positions of 3000 visible units ${(r.positionUsFor3000 / 1000).toFixed(2)} ms`
      )
    }
  }
  console.log('\n' + lines.join('\n') + '\n')
}, 900000)
