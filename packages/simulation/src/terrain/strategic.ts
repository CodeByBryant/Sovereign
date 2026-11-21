/**
 * @module strategic
 * @description Strategic points: the places the route network has to go through. A route is the cheapest
 * way between two neighbouring hubs ({@link ./routes}); where it has to climb a ridge there is a **pass**,
 * where it has to cross a river a **ford** (the narrowest part of the river it can use), where it has to
 * cross water between two shores a **strait**, and where the land it runs over narrows between wider land
 * a **land neck** (isthmus). A point matters because routes need it, so its value comes from the traffic
 * of the routes through it, scaled by how narrow it is.
 *
 * The classification works on a route's *profile* (one entry per cell it passes), so it is a pure function
 * of numbers and is tested on drawn profiles; {@link buildStrategicNetwork} builds the profiles from a world.
 */
import type { RoutesConfig, StrategicConfig } from '@sovereign/config'
import type {
  ResourceSlots,
  RouteHub,
  StrategicPoint,
  StrategicRoute,
  StrategicType
} from '@sovereign/contracts'
import { buildCostGrid, type CostGrid } from './cost'
import { findRoutes, pickHubs } from './routes'
import { siteScoreGrid } from './suitability'

/* ------------------------------------------------------------------ */
/*  What a route passes over, cell by cell                             */
/* ------------------------------------------------------------------ */

export interface RouteCell {
  /** Mean elevation of the cell (0 to 1). */
  elevation: number
  /** The widest river in the cell (0 for none). */
  river: number
  /** Whether the cell is water. */
  sea: boolean
  /** Steps over cells to the nearest sea (0 in the sea, 1 on the coast). */
  seaDistance: number
}

export interface RouteFeature {
  type: StrategicType
  /** Where along the route (an index into its cells). */
  index: number
  /** 0 to 1, higher is better: how narrow a ford, strait or neck is, how high a pass stands. */
  quality: number
}

/** The strategic features along one route, in route order. */
export function routeFeatures(
  cells: readonly RouteCell[],
  config: StrategicConfig
): RouteFeature[] {
  const n = cells.length
  const found: RouteFeature[] = []
  if (n < 3) return found

  // ---- fords: a run of river cells the route crosses (not one it runs along, or starts on) ----
  for (let i = 0; i < n;) {
    if (cells[i].sea || cells[i].river <= 0) {
      i += 1
      continue
    }
    let end = i
    while (end + 1 < n && !cells[end + 1].sea && cells[end + 1].river > 0) end += 1
    if (i > 0 && end < n - 1 && end - i + 1 <= config.fordMaxRun) {
      let narrowest = i
      for (let k = i + 1; k <= end; k += 1)
        if (cells[k].river < cells[narrowest].river) narrowest = k
      found.push({
        type: 'river_crossing',
        index: narrowest,
        quality: Math.min(1, 1 / cells[narrowest].river)
      })
    }
    i = end + 1
  }

  // ---- straits: a run of water between two shores, narrow enough to be a crossing ----
  for (let i = 0; i < n;) {
    if (!cells[i].sea) {
      i += 1
      continue
    }
    let end = i
    while (end + 1 < n && cells[end + 1].sea) end += 1
    const span = end - i + 1
    if (i > 0 && end < n - 1 && span <= config.straitMaxCells) {
      const quality = 1 - (0.5 * (span - 1)) / Math.max(1, config.straitMaxCells - 1)
      found.push({ type: 'strait', index: Math.floor((i + end) / 2), quality })
    }
    i = end + 1
  }

  // ---- passes: the highest point of the route within a window, with lower ground on both sides ----
  const prefixMin = new Float64Array(n)
  const suffixMin = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    prefixMin[i] = i === 0 ? cells[i].elevation : Math.min(prefixMin[i - 1], cells[i].elevation)
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    suffixMin[i] = i === n - 1 ? cells[i].elevation : Math.min(suffixMin[i + 1], cells[i].elevation)
  }
  for (let i = 0; i < n; i += 1) {
    const e = cells[i].elevation
    if (cells[i].sea || e < config.passMinElevation) continue
    let top = true
    for (let j = Math.max(0, i - config.passWindow); j < i && top; j += 1) {
      if (!(e > cells[j].elevation)) top = false
    }
    for (let j = i + 1; j <= Math.min(n - 1, i + config.passWindow) && top; j += 1) {
      if (e < cells[j].elevation) top = false
    }
    if (!top) continue
    const rise = Math.min(e - prefixMin[i], e - suffixMin[i])
    if (rise < config.passRise) continue
    found.push({
      type: 'mountain_pass',
      index: i,
      quality: Math.min(1, 0.4 + 1.5 * rise)
    })
  }

  // ---- land necks: a stretch of land close to the sea on both sides, between wider land ----
  // A run of land cells within isthmusMaxSeaDistance of the sea, with land at least isthmusRise cells
  // farther from the sea reached on each side within isthmusWindow cells (never looking across water).
  for (let i = 0; i < n;) {
    if (cells[i].sea || cells[i].seaDistance > config.isthmusMaxSeaDistance) {
      i += 1
      continue
    }
    let end = i
    let narrowest = cells[i].seaDistance
    while (
      end + 1 < n &&
      !cells[end + 1].sea &&
      cells[end + 1].seaDistance <= config.isthmusMaxSeaDistance
    ) {
      end += 1
      narrowest = Math.min(narrowest, cells[end].seaDistance)
    }
    let widestBefore = 0
    for (let j = i - 1; j >= Math.max(0, i - config.isthmusWindow) && !cells[j].sea; j -= 1) {
      widestBefore = Math.max(widestBefore, cells[j].seaDistance)
    }
    let widestAfter = 0
    for (
      let j = end + 1;
      j <= Math.min(n - 1, end + config.isthmusWindow) && !cells[j].sea;
      j += 1
    ) {
      widestAfter = Math.max(widestAfter, cells[j].seaDistance)
    }
    if (
      widestBefore >= narrowest + config.isthmusRise &&
      widestAfter >= narrowest + config.isthmusRise
    ) {
      found.push({
        type: 'isthmus',
        index: Math.floor((i + end) / 2),
        quality: Math.min(
          1,
          Math.max(0.1, 1 - (0.5 * (narrowest - 1)) / config.isthmusMaxSeaDistance)
        )
      })
    }
    i = end + 1
  }

  return found.sort((a, b) => a.index - b.index)
}

/* ------------------------------------------------------------------ */
/*  A world's network                                                  */
/* ------------------------------------------------------------------ */

export interface StrategicInput {
  width: number
  height: number
  seaLevel: number
  elevation: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  riverWidth: Uint8Array
  resources: ResourceSlots
  /** `biomes.highlandElevation`: ground above it is costly to cross. */
  highlandElevation: number
  /** `resources.features.slopeScale`: the slope that counts as fully steep. */
  slopeScale: number
  routes: RoutesConfig
  strategic: StrategicConfig
}

export interface StrategicNetwork {
  points: StrategicPoint[]
  hubs: RouteHub[]
  routes: StrategicRoute[]
}

/** What each cell is like, for the profile of a route over it. */
interface CellFields {
  elevation: Float64Array
  river: Uint8Array
  /** The tile of the narrowest river in the cell, or -1. */
  riverTile: Int32Array
  seaDistance: Int32Array
}

function cellFields(input: StrategicInput, grid: CostGrid): CellFields {
  const { width, height } = input
  const { cell, cols, rows } = grid
  const cells = cols * rows
  const sum = new Float64Array(cells)
  const count = new Uint32Array(cells)
  const river = new Uint8Array(cells)
  const riverTile = new Int32Array(cells).fill(-1)
  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.floor(y / cell) * cols
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const c = rowBase + Math.floor(x / cell)
      sum[c] += input.elevation[i]
      count[c] += 1
      if (input.riverMask[i] !== 0) {
        const w = input.riverWidth[i]
        if (river[c] === 0 || w < river[c]) {
          river[c] = w
          riverTile[c] = i
        }
      }
    }
  }
  // the widest river of a cell decides what it costs (see ./cost); a ford is its narrowest part
  const widest = new Uint8Array(cells)
  for (let i = 0; i < width * height; i += 1) {
    if (input.riverMask[i] !== 0) {
      const c = Math.floor(Math.floor(i / width) / cell) * cols + Math.floor((i % width) / cell)
      if (input.riverWidth[i] > widest[c]) widest[c] = input.riverWidth[i]
    }
  }
  const elevation = new Float64Array(cells)
  for (let c = 0; c < cells; c += 1) elevation[c] = count[c] > 0 ? sum[c] / count[c] : 0

  const seaDistance = new Int32Array(cells).fill(-1)
  const queue = new Int32Array(cells)
  let head = 0
  let tail = 0
  for (let c = 0; c < cells; c += 1) {
    if (grid.land[c] === 0) {
      seaDistance[c] = 0
      queue[tail] = c
      tail += 1
    }
  }
  while (head < tail) {
    const c = queue[head]
    head += 1
    const cx = c % cols
    const cy = (c - cx) / cols
    const next = [
      cx > 0 ? c - 1 : -1,
      cx < cols - 1 ? c + 1 : -1,
      cy > 0 ? c - cols : -1,
      cy < rows - 1 ? c + cols : -1
    ]
    for (const n of next) {
      if (n >= 0 && seaDistance[n] === -1) {
        seaDistance[n] = seaDistance[c] + 1
        queue[tail] = n
        tail += 1
      }
    }
  }
  // a world with no sea has no distance to it: call everything far
  for (let c = 0; c < cells; c += 1) if (seaDistance[c] === -1) seaDistance[c] = cols + rows
  return { elevation, river: widest, riverTile, seaDistance }
}

/** The land tile of a cell nearest its centre (or the centre, if the cell has none). */
function landTileOf(input: StrategicInput, grid: CostGrid, c: number): number {
  const { width, height } = input
  const cx = c % grid.cols
  const cy = (c - cx) / grid.cols
  const x0 = cx * grid.cell
  const y0 = cy * grid.cell
  const mx = Math.min(width - 1, x0 + (grid.cell >> 1))
  const my = Math.min(height - 1, y0 + (grid.cell >> 1))
  let best = my * width + mx
  let bestD = Infinity
  for (let y = y0; y < Math.min(height, y0 + grid.cell); y += 1) {
    for (let x = x0; x < Math.min(width, x0 + grid.cell); x += 1) {
      if (input.elevation[y * width + x] <= input.seaLevel) continue
      const d = (x - mx) * (x - mx) + (y - my) * (y - my)
      if (d < bestD) {
        bestD = d
        best = y * width + x
      }
    }
  }
  return best
}

const TYPE_ORDER: Record<StrategicType, number> = {
  river_crossing: 0,
  mountain_pass: 1,
  strait: 2,
  isthmus: 3
}

export function buildStrategicNetwork(input: StrategicInput): StrategicNetwork {
  const { width, height } = input
  const grid = buildCostGrid({
    width,
    height,
    seaLevel: input.seaLevel,
    elevation: input.elevation,
    biomeIds: input.biomeIds,
    riverMask: input.riverMask,
    riverWidth: input.riverWidth,
    highlandElevation: input.highlandElevation,
    slopeScale: input.slopeScale,
    cell: input.routes.cell,
    config: input.routes.cost
  })
  const sites = siteScoreGrid({
    width,
    height,
    cell: input.routes.cell,
    seaLevel: input.seaLevel,
    elevation: input.elevation,
    biomeIds: input.biomeIds,
    riverMask: input.riverMask,
    resources: input.resources
  })
  // a hub needs ground a route can start on
  const usable = new Float32Array(sites.score.length)
  for (let c = 0; c < usable.length; c += 1) {
    if (grid.land[c] === 1 && grid.cost[c] < Infinity) usable[c] = sites.score[c]
  }
  const hubCells = pickHubs(
    usable,
    grid.cols,
    grid.rows,
    input.routes.hubSpacing / input.routes.cell,
    input.routes.hubMinScore
  )
  if (hubCells.length === 0) return { points: [], hubs: [], routes: [] }

  const network = findRoutes(
    grid,
    hubCells.map((cell) => ({ cell, weight: usable[cell] }))
  )
  const tileXY = (tile: number): [number, number] => [tile % width, Math.floor(tile / width)]
  const centreOf = (c: number): [number, number] => {
    const cx = c % grid.cols
    const cy = (c - cx) / grid.cols
    return [
      Math.min(width - 1, cx * grid.cell + (grid.cell >> 1)),
      Math.min(height - 1, cy * grid.cell + (grid.cell >> 1))
    ]
  }

  const hubs: RouteHub[] = hubCells.map((cell) => {
    const [x, y] = tileXY(landTileOf(input, grid, cell))
    return { x, y, weight: usable[cell] }
  })
  const routes: StrategicRoute[] = network.routes.map((route) => {
    const path: number[] = []
    for (const c of route.cells) path.push(...centreOf(c))
    return { from: route.a, to: route.b, cost: route.cost, traffic: route.traffic, path }
  })

  // ---- the strategic points along the routes ----
  const fields = cellFields(input, grid)
  let busiest = 0
  for (const route of network.routes) busiest = Math.max(busiest, route.traffic)
  interface Candidate {
    cell: number
    type: StrategicType
    value: number
  }
  const candidates: Candidate[] = []
  for (const route of network.routes) {
    const share = busiest > 0 ? route.traffic / busiest : 0
    if (share < input.strategic.minTraffic) continue
    const profile: RouteCell[] = route.cells.map((c) => ({
      elevation: fields.elevation[c],
      river: fields.river[c],
      sea: grid.land[c] === 0,
      seaDistance: fields.seaDistance[c]
    }))
    for (const feature of routeFeatures(profile, input.strategic)) {
      const value = Math.min(
        10,
        Math.max(1, 1 + Math.round(9 * Math.sqrt(share) * feature.quality))
      )
      candidates.push({ cell: route.cells[feature.index], type: feature.type, value })
    }
  }

  // two points of one kind close together are one point: the more valuable wins
  candidates.sort(
    (a, b) => b.value - a.value || a.cell - b.cell || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
  )
  const kept: Candidate[] = []
  const keptByType = new Map<StrategicType, number[]>()
  for (const cand of candidates) {
    const cx = cand.cell % grid.cols
    const cy = (cand.cell - cx) / grid.cols
    const same = keptByType.get(cand.type) ?? []
    let clash = false
    for (const other of same) {
      const ox = other % grid.cols
      const oy = (other - ox) / grid.cols
      if (Math.max(Math.abs(ox - cx), Math.abs(oy - cy)) < input.strategic.mergeRadius) {
        clash = true
        break
      }
    }
    if (clash) continue
    same.push(cand.cell)
    keptByType.set(cand.type, same)
    kept.push(cand)
  }
  kept.sort((a, b) => a.cell - b.cell || TYPE_ORDER[a.type] - TYPE_ORDER[b.type])

  const points: StrategicPoint[] = kept.map((cand) => {
    let x: number
    let y: number
    if (cand.type === 'river_crossing' && fields.riverTile[cand.cell] >= 0) {
      ;[x, y] = tileXY(fields.riverTile[cand.cell])
    } else {
      ;[x, y] = centreOf(cand.cell)
    }
    return { x, y, type: cand.type, value: cand.value }
  })

  return { points, hubs, routes }
}
