/**
 * @module routes
 * @description The route network: where people and goods have to go to get from one settlement to another.
 *
 * **Hubs** are the best places to live (picked greedily by site score, at least a spacing apart). A single
 * multi-source Dijkstra search over the cost grid ({@link ./cost}) gives every cell its nearest hub (by
 * travel cost) and the way back to it. Two hubs whose territories touch are neighbours, and the cheapest
 * place where they touch is the **route** between them (the natural-neighbour graph of the hubs, measured
 * in travel cost, which crosses a strait but never an ocean). One search instead of one per pair: a
 * 2000 x 2000 map has about 300 hubs and 250 000 cells.
 *
 * **Traffic** is betweenness: for every pair of hubs, the shortest path through the network adds the
 * product of the two hubs' weights to each route it uses. A route that many hub pairs need carries a lot.
 *
 * Only `+ - * /` and exact functions, a total order on every comparison (cost, then cell or hub index), so
 * the network is the same on every engine.
 */
import type { CostGrid } from './cost'
import { MinHeap } from './heap'

/** A place routes join: a cell, and how much it matters (its site score). */
export interface HubSite {
  cell: number
  weight: number
}

export interface Route {
  /** The hub indices this route joins, `a < b`. */
  a: number
  b: number
  /** The travel cost along the route. */
  cost: number
  /** The cells along it, from hub `a` to hub `b`, each a step from the last. */
  cells: number[]
  /** Betweenness: the weighted number of hub pairs whose shortest path uses this route. */
  traffic: number
}

export interface RouteNetwork {
  routes: Route[]
  /** For every cell, the traffic of the routes that pass through it (0 off the network). */
  traffic: Float32Array
}

/** 8 neighbours, each with the length of the step. */
const SQRT2 = 1.4142135623730951

const stepCost = (grid: CostGrid, from: number, to: number, diagonal: boolean): number =>
  ((grid.cost[from] + grid.cost[to]) / 2) * (diagonal ? SQRT2 : 1)

export function findRoutes(grid: CostGrid, hubs: readonly HubSite[]): RouteNetwork {
  const { cols, rows } = grid
  const cells = cols * rows
  const seen = new Set<number>()
  for (const hub of hubs) {
    if (!Number.isInteger(hub.cell) || hub.cell < 0 || hub.cell >= cells) {
      throw new RangeError('a hub must be on a cell of the grid')
    }
    if (!(grid.cost[hub.cell] < Infinity))
      throw new RangeError('a hub cannot be on an impassable cell')
    if (seen.has(hub.cell)) throw new RangeError('two hubs cannot share a cell')
    seen.add(hub.cell)
  }
  const traffic = new Float32Array(cells)
  if (hubs.length < 2) return { routes: [], traffic }

  // ---- every cell's nearest hub, by travel cost, and the way back to it ----
  const dist = new Float64Array(cells).fill(Infinity)
  const owner = new Int32Array(cells).fill(-1)
  const pred = new Int32Array(cells).fill(-1)
  const heap = new MinHeap(Math.max(1024, hubs.length * 8))
  hubs.forEach((hub, h) => {
    dist[hub.cell] = 0
    owner[hub.cell] = h
    heap.push(0, hub.cell)
  })
  while (heap.size > 0) {
    const d = heap.peekKey()
    const c = heap.pop()
    if (d > dist[c]) continue // a stale entry: the cell was reached more cheaply since
    const cx = c % cols
    const cy = (c - cx) / cols
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = cy + dy
      if (ny < 0 || ny >= rows) continue
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue
        const nx = cx + dx
        if (nx < 0 || nx >= cols) continue
        const n = ny * cols + nx
        if (!(grid.cost[n] < Infinity)) continue
        const next = d + stepCost(grid, c, n, dx !== 0 && dy !== 0)
        if (next < dist[n]) {
          dist[n] = next
          owner[n] = owner[c]
          pred[n] = c
          heap.push(next, n)
        }
      }
    }
  }

  // ---- where two hubs' territories touch, the cheapest meeting is the route between them ----
  const best = new Map<number, { cost: number; u: number; v: number }>()
  const hubCount = hubs.length
  for (let c = 0; c < cells; c += 1) {
    if (owner[c] < 0) continue
    const cx = c % cols
    const cy = (c - cx) / cols
    // the neighbours after this cell in reading order, so each touching pair is seen once
    for (const [dx, dy] of [
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1]
    ] as const) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || nx >= cols || ny >= rows) continue
      const n = ny * cols + nx
      if (owner[n] < 0 || owner[n] === owner[c]) continue
      const meet = dist[c] + dist[n] + stepCost(grid, c, n, dx !== 0 && dy !== 0)
      const lo = Math.min(owner[c], owner[n])
      const hi = Math.max(owner[c], owner[n])
      const key = lo * hubCount + hi
      const held = best.get(key)
      if (held === undefined || meet < held.cost) {
        best.set(key, owner[c] < owner[n] ? { cost: meet, u: c, v: n } : { cost: meet, u: n, v: c })
      }
    }
  }

  const keys = [...best.keys()].sort((p, q) => p - q)
  const routes: Route[] = keys.map((key) => {
    const meeting = best.get(key) as { cost: number; u: number; v: number }
    const toward: number[] = []
    for (let c = meeting.u; c !== -1; c = pred[c]) toward.push(c)
    toward.reverse()
    for (let c = meeting.v; c !== -1; c = pred[c]) toward.push(c)
    return {
      a: Math.floor(key / hubCount),
      b: key % hubCount,
      cost: meeting.cost,
      cells: toward,
      traffic: 0
    }
  })

  // ---- traffic: the weighted number of hub pairs whose shortest path uses each route ----
  const edges: number[][] = hubs.map(() => [])
  routes.forEach((route, r) => {
    edges[route.a].push(r)
    edges[route.b].push(r)
  })
  const weight = hubs.map((h) => h.weight)
  const hubDist = new Float64Array(hubCount)
  const via = new Int32Array(hubCount)
  const from = new Int32Array(hubCount)
  const subtree = new Float64Array(hubCount)
  const order: number[] = []
  const hubHeap = new MinHeap(64)
  const carried = new Float64Array(routes.length)
  for (let s = 0; s < hubCount; s += 1) {
    hubDist.fill(Infinity)
    via.fill(-1)
    from.fill(-1)
    order.length = 0
    hubHeap.clear()
    hubDist[s] = 0
    hubHeap.push(0, s)
    while (hubHeap.size > 0) {
      const d = hubHeap.peekKey()
      const h = hubHeap.pop()
      if (d > hubDist[h]) continue
      order.push(h)
      for (const r of edges[h]) {
        const other = routes[r].a === h ? routes[r].b : routes[r].a
        const next = d + routes[r].cost
        if (next < hubDist[other]) {
          hubDist[other] = next
          via[other] = r
          from[other] = h
          hubHeap.push(next, other)
        }
      }
    }
    for (let k = 0; k < hubCount; k += 1) subtree[k] = weight[k]
    for (let k = order.length - 1; k > 0; k -= 1) {
      const h = order[k]
      carried[via[h]] += weight[s] * subtree[h]
      subtree[from[h]] += subtree[h]
    }
  }
  routes.forEach((route, r) => {
    route.traffic = carried[r] / 2 // every pair was counted from both ends
    for (const c of route.cells) traffic[c] += route.traffic
  })

  return { routes, traffic }
}

/**
 * Pick hubs from a score per cell: best first, never within `spacing` cells of one already picked, and
 * only where the score is at least `minScore` (and above 0). Ties go to the lower cell index. Returns the
 * cells, best first.
 */
export function pickHubs(
  score: Float32Array,
  cols: number,
  rows: number,
  spacing: number,
  minScore: number
): number[] {
  const candidates: number[] = []
  for (let c = 0; c < score.length; c += 1) {
    if (score[c] > 0 && score[c] >= minScore) candidates.push(c)
  }
  candidates.sort((p, q) => score[q] - score[p] || p - q)
  const blocked = new Uint8Array(cols * rows)
  const reach = Math.ceil(spacing)
  const picked: number[] = []
  for (const c of candidates) {
    if (blocked[c] === 1) continue
    picked.push(c)
    const cx = c % cols
    const cy = (c - cx) / cols
    for (let y = Math.max(0, cy - reach); y <= Math.min(rows - 1, cy + reach); y += 1) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(cols - 1, cx + reach); x += 1) {
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy < spacing * spacing) blocked[y * cols + x] = 1
      }
    }
  }
  return picked
}
