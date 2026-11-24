/**
 * @module provinces
 * @description Cuts the land into provinces: the unit nations own and expand by. A province is the set of
 * tiles that are cheaper to reach (over the cost of the ground) from one seed than from any other, so
 * provinces are connected by construction and their borders sit where the ground is costly to cross:
 * mountains, rivers, coasts.
 *
 * - **Seeds** are spread by `spacing` over the land, preferring cheap ground (so a seed sits in a plain and
 *   the barrier falls between seeds), and every landmass gets at least one.
 * - **The cut** is one multi-source Dijkstra over the land tiles (own heap, total order: the same result on
 *   every engine).
 * - **Small provinces** (under `minArea`) merge into the neighbour that shares the longest border, smallest
 *   first; a speck with no neighbour at all belongs to nobody.
 *
 * Everything is a pure function of the arrays given: `+ - * /` and comparisons only.
 */
import type { CostGrid } from './cost'
import { MinHeap } from './heap'
import { pickHubs } from './routes'

/** `provinceOf` holds this where a tile is in no province (water, or a speck too small to be one). */
export const NO_PROVINCE = 0xffff

/** A province id is 16 bits: this many are possible (the top value is `NO_PROVINCE`). */
const MAX_PROVINCES = NO_PROVINCE

export interface ProvinceInput {
  width: number
  height: number
  /** 1 for a land tile, 0 for water. */
  land: Uint8Array
  /** The cost of a step onto each land tile (finite, above 0); the cost of water tiles is never read. */
  cost: Float32Array
}

export interface ProvinceOptions extends ProvinceInput {
  /** The least distance between two seeds, in tiles; sets the size of a province. */
  spacing: number
  /** Provinces with fewer tiles than this merge into a neighbour. */
  minArea: number
  /** Seed tiles, to use as given instead of picking (for tests). Province ids follow this order. */
  seeds?: readonly number[]
}

export interface ProvinceMap {
  count: number
  /** The province of each tile; `NO_PROVINCE` for none. */
  provinceOf: Uint16Array
  /** The tiles of province `p` are `tiles[start[p]] ... tiles[start[p + 1] - 1]`, in tile order. */
  start: Uint32Array
  tiles: Uint32Array
  area: Uint32Array
  centroidX: Float32Array
  centroidY: Float32Array
  /** The mean cost of the tiles of each province (what it costs to cross it). */
  meanCost: Float32Array
  /** A tile inside the province: where it was seeded. */
  seed: Uint32Array
  /** The neighbours of province `p` are `neighbourId[neighbourStart[p]] ...`, by id, with the length of the shared border in tile edges. */
  neighbourStart: Uint32Array
  neighbourId: Uint16Array
  neighbourBorder: Uint32Array
}

/**
 * The cost of each tile, from the route cost grid: the cost of the cell it lies in, at most `cap` (closed
 * cells too), so a mountain range divides provinces without making them reach for a seed a world away.
 */
export function tileCosts(
  grid: CostGrid,
  width: number,
  height: number,
  cap: number
): Float32Array {
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.floor(y / grid.cell) * grid.cols
    for (let x = 0; x < width; x += 1) {
      const c = grid.cost[rowBase + Math.floor(x / grid.cell)]
      out[y * width + x] = c > cap ? cap : c
    }
  }
  return out
}

/** A land tile with the least cost among `tiles`, ties to the lower index. */
function cheapest(cost: Float32Array, tiles: Iterable<number>): number {
  let best = -1
  for (const t of tiles) {
    if (best < 0 || cost[t] < cost[best] || (cost[t] === cost[best] && t < best)) best = t
  }
  return best
}

/**
 * Pick the seeds: the land is cut into cells of about a fifth of `spacing`, each scored by how much of it
 * is land and how cheap that land is, and the best cells are taken a spacing apart ({@link pickHubs}); the
 * seed of a cell is its cheapest land tile. Then every landmass (4-connected land) without a seed gets one,
 * at its cheapest tile. Best first, then the landmasses in order of their first tile.
 */
export function pickSeeds(input: ProvinceInput, spacing: number): number[] {
  const { width, height, land, cost } = input
  const cell = Math.max(1, Math.floor(spacing / 5))
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const score = new Float32Array(cols * rows)
  const bestTile = new Int32Array(cols * rows).fill(-1)
  const landTiles = new Uint32Array(cols * rows)
  const costSum = new Float64Array(cols * rows)
  const area = new Uint32Array(cols * rows)

  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.floor(y / cell) * cols
    for (let x = 0; x < width; x += 1) {
      const c = rowBase + Math.floor(x / cell)
      area[c] += 1
      const i = y * width + x
      if (land[i] === 0) continue
      landTiles[c] += 1
      costSum[c] += cost[i]
      const best = bestTile[c]
      if (best < 0 || cost[i] < cost[best]) bestTile[c] = i
    }
  }
  for (let c = 0; c < score.length; c += 1) {
    if (landTiles[c] === 0) continue
    score[c] = landTiles[c] / area[c] / (1 + costSum[c] / landTiles[c])
  }

  const seeds = pickHubs(score, cols, rows, spacing / cell, 0)
    .filter((c) => bestTile[c] >= 0)
    .map((c) => bestTile[c])

  // every landmass gets a seed
  const label = new Int32Array(width * height).fill(-1)
  const hasSeed: boolean[] = []
  const members: number[][] = []
  const stack: number[] = []
  for (let first = 0; first < label.length; first += 1) {
    if (land[first] === 0 || label[first] >= 0) continue
    const id = members.length
    const list: number[] = []
    label[first] = id
    stack.push(first)
    const join = (n: number): void => {
      if (land[n] === 1 && label[n] < 0) {
        label[n] = id
        stack.push(n)
      }
    }
    while (stack.length > 0) {
      const t = stack.pop() as number
      list.push(t)
      const x = t % width
      if (x > 0) join(t - 1)
      if (x < width - 1) join(t + 1)
      if (t >= width) join(t - width)
      if (t + width < label.length) join(t + width)
    }
    members.push(list)
    hasSeed.push(false)
  }
  for (const s of seeds) hasSeed[label[s]] = true
  members.forEach((list, id) => {
    if (!hasSeed[id]) seeds.push(cheapest(cost, list))
  })
  return seeds
}

/** Cut the land into provinces. */
export function buildProvinces(options: ProvinceOptions): ProvinceMap {
  const { width, height, land, cost, minArea } = options
  const size = width * height
  const seedTiles = options.seeds ?? pickSeeds(options, options.spacing)

  // 1. the cut: every land tile goes to the seed it is cheapest to reach
  const owner = new Int32Array(size).fill(-1)
  const dist = new Float64Array(size).fill(Infinity)
  const heap = new MinHeap(1 << 14)
  seedTiles.forEach((tile, p) => {
    if (land[tile] === 0 || dist[tile] === 0) return
    dist[tile] = 0
    owner[tile] = p
    heap.push(0, tile)
  })
  while (heap.size > 0) {
    const d = heap.peekKey()
    const tile = heap.pop()
    if (d > dist[tile]) continue
    const x = tile % width
    const here = cost[tile]
    const visit = (n: number): void => {
      if (land[n] === 0) return
      const next = d + (here + cost[n]) / 2
      if (next < dist[n]) {
        dist[n] = next
        owner[n] = owner[tile]
        heap.push(next, n)
      }
    }
    if (x > 0) visit(tile - 1)
    if (x < width - 1) visit(tile + 1)
    if (tile >= width) visit(tile - width)
    if (tile + width < size) visit(tile + width)
  }

  // 2. areas, and the length of each shared border
  const seedCount = seedTiles.length
  const area = new Uint32Array(seedCount)
  const borders: Array<Map<number, number>> = Array.from({ length: seedCount }, () => new Map())
  const touch = (p: number, q: number): void => {
    if (q < 0 || p === q) return
    borders[p].set(q, (borders[p].get(q) ?? 0) + 1)
    borders[q].set(p, (borders[q].get(p) ?? 0) + 1)
  }
  for (let i = 0; i < size; i += 1) {
    const p = owner[i]
    if (p < 0) continue
    area[p] += 1
    if (i % width < width - 1) touch(p, owner[i + 1])
    if (i + width < size) touch(p, owner[i + width])
  }

  // 3. merge the small ones, smallest first, into the neighbour with the longest shared border
  const alive = new Uint8Array(seedCount)
  for (let p = 0; p < seedCount; p += 1) alive[p] = area[p] > 0 ? 1 : 0
  const into = new Int32Array(seedCount).fill(-1) // where a merged province went, -1 for itself
  for (;;) {
    let small = -1
    for (let p = 0; p < seedCount; p += 1) {
      if (alive[p] === 1 && area[p] < minArea && (small < 0 || area[p] < area[small])) small = p
    }
    if (small < 0) break
    alive[small] = 0
    if (borders[small].size === 0) {
      into[small] = -2 // a speck with no neighbour: nobody's
      continue
    }
    let target = -1
    let longest = 0
    for (const [q, length] of borders[small]) {
      if (length > longest || (length === longest && q < target)) [target, longest] = [q, length]
    }
    into[small] = target
    area[target] += area[small]
    borders[target].delete(small)
    for (const [q, length] of borders[small]) {
      borders[q].delete(small)
      if (q === target) continue
      borders[q].set(target, (borders[q].get(target) ?? 0) + length)
      borders[target].set(q, (borders[target].get(q) ?? 0) + length)
    }
  }

  // 4. renumber what is left, in seed order
  const finalId = new Int32Array(seedCount).fill(-1)
  let count = 0
  for (let p = 0; p < seedCount; p += 1) if (alive[p] === 1) finalId[p] = count++
  if (count > MAX_PROVINCES)
    throw new RangeError(`too many provinces (${count}, at most ${MAX_PROVINCES})`)
  const resolve = (p: number): number => {
    let q = p
    while (into[q] >= 0) q = into[q]
    return into[q] === -2 ? -1 : finalId[q]
  }
  const resolved = new Int32Array(seedCount)
  for (let p = 0; p < seedCount; p += 1) resolved[p] = resolve(p)

  const provinceOf = new Uint16Array(size).fill(NO_PROVINCE)
  const finalArea = new Uint32Array(count)
  for (let i = 0; i < size; i += 1) {
    if (owner[i] < 0) continue
    const p = resolved[owner[i]]
    if (p < 0) continue
    provinceOf[i] = p
    finalArea[p] += 1
  }

  const start = new Uint32Array(count + 1)
  for (let p = 0; p < count; p += 1) start[p + 1] = start[p] + finalArea[p]
  const tiles = new Uint32Array(start[count])
  const fill = start.slice(0, count)
  const sumX = new Float64Array(count)
  const sumY = new Float64Array(count)
  const sumCost = new Float64Array(count)
  for (let i = 0; i < size; i += 1) {
    const p = provinceOf[i]
    if (p === NO_PROVINCE) continue
    tiles[fill[p]++] = i
    const x = i % width
    sumX[p] += x
    sumY[p] += (i - x) / width
    sumCost[p] += cost[i]
  }
  const centroidX = new Float32Array(count)
  const centroidY = new Float32Array(count)
  const meanCost = new Float32Array(count)
  const seed = new Uint32Array(count)
  for (let p = 0; p < count; p += 1) {
    centroidX[p] = sumX[p] / finalArea[p]
    centroidY[p] = sumY[p] / finalArea[p]
    meanCost[p] = sumCost[p] / finalArea[p]
  }
  for (let p = 0; p < seedCount; p += 1) if (alive[p] === 1) seed[finalId[p]] = seedTiles[p]

  // neighbours by final id
  const lists: Array<Array<[number, number]>> = Array.from({ length: count }, () => [])
  for (let p = 0; p < seedCount; p += 1) {
    if (alive[p] === 0) continue
    for (const [q, length] of borders[p]) lists[finalId[p]].push([finalId[q], length])
  }
  const neighbourStart = new Uint32Array(count + 1)
  for (let p = 0; p < count; p += 1) {
    lists[p].sort((a, b) => a[0] - b[0])
    neighbourStart[p + 1] = neighbourStart[p] + lists[p].length
  }
  const neighbourId = new Uint16Array(neighbourStart[count])
  const neighbourBorder = new Uint32Array(neighbourStart[count])
  lists.forEach((list, p) => {
    list.forEach(([q, length], k) => {
      neighbourId[neighbourStart[p] + k] = q
      neighbourBorder[neighbourStart[p] + k] = length
    })
  })

  return {
    count,
    provinceOf,
    start,
    tiles,
    area: finalArea,
    centroidX,
    centroidY,
    meanCost,
    seed,
    neighbourStart,
    neighbourId,
    neighbourBorder
  }
}
