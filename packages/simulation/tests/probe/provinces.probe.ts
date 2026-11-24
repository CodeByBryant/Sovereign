// A measurement, not a test: how long does it take to cut a 2000 x 2000 world into provinces by travel cost,
// and what do they look like? Prototypes the search (tile level multi-source Dijkstra over land tiles) so the
// design can pick tile or cell level and a seed spacing.
//
//   pnpm --filter @sovereign/simulation probe -- tests/probe/provinces.probe.ts
//
// PROBE_SEEDS=1,2 picks the seeds; PROBE_SPACING=20,30 the seed spacings in tiles (default 20).
import { it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { buildCostGrid } from '../../src/terrain/cost'
import { MinHeap } from '../../src/terrain/heap'
import { pickHubs } from '../../src/terrain/routes'
import { World } from '../../src/world/World'

const seeds = (process.env.PROBE_SEEDS ?? '1337,1,2')
  .split(',')
  .map((s) => Number.parseInt(s, 10))
  .filter((n) => Number.isInteger(n))
const spacings = (process.env.PROBE_SPACING ?? '20')
  .split(',')
  .map((s) => Number.parseInt(s, 10))
  .filter((n) => n > 0)

it('prototypes provinces', () => {
  const lines: string[] = []
  for (const seed of seeds) {
    const world = World.create({ seed, config: { nations: { count: 0 } } })
    const t = world.terrain
    const { width, height } = t
    const cfg = world.config
    const grid = buildCostGrid({
      width,
      height,
      seaLevel: t.seaLevel,
      elevation: t.elevation,
      biomeIds: t.biomeIds,
      riverMask: t.riverMask,
      riverWidth: new Uint8Array(width * height),
      highlandElevation: cfg.biomes.highlandElevation,
      slopeScale: cfg.resources.features.slopeScale,
      cell: cfg.routes.cell,
      config: cfg.routes.cost
    })
    for (const spacing of spacings) {
      const t0 = performance.now()
      // seeds: greedy on the cell grid, preferring cheap ground
      const score = new Float32Array(grid.cols * grid.rows)
      for (let c = 0; c < score.length; c += 1) {
        score[c] =
          grid.land[c] === 1 && grid.cost[c] < Infinity ? 1 / (1 + (grid.cost[c] as number)) : 0
      }
      const seedCells = pickHubs(score, grid.cols, grid.rows, spacing / grid.cell, 0.01)
      const t1 = performance.now()
      const size = width * height
      const owner = new Int32Array(size).fill(-1)
      const dist = new Float64Array(size).fill(Infinity)
      const heap = new MinHeap(1 << 16)
      seedCells.forEach((c, p) => {
        const cx = (c % grid.cols) * grid.cell + (grid.cell >> 1)
        const cy = Math.floor(c / grid.cols) * grid.cell + (grid.cell >> 1)
        const tile = Math.min(height - 1, cy) * width + Math.min(width - 1, cx)
        if (t.elevation[tile] > t.seaLevel) {
          dist[tile] = 0
          owner[tile] = p
          heap.push(0, tile)
        }
      })
      const costAt = (tile: number): number => {
        const x = tile % width
        const y = (tile - x) / width
        return Math.min(
          grid.cost[Math.floor(y / grid.cell) * grid.cols + Math.floor(x / grid.cell)] as number,
          12
        )
      }
      while (heap.size > 0) {
        const d = heap.peekKey()
        const tile = heap.pop()
        if (d > dist[tile]) continue
        const x = tile % width
        const y = (tile - x) / width
        const here = costAt(tile)
        for (const n of [
          x > 0 ? tile - 1 : -1,
          x < width - 1 ? tile + 1 : -1,
          y > 0 ? tile - width : -1,
          y < height - 1 ? tile + width : -1
        ]) {
          if (n < 0 || t.elevation[n] <= t.seaLevel) continue
          const next = d + (here + costAt(n)) / 2
          if (next < dist[n]) {
            dist[n] = next
            owner[n] = owner[tile]
            heap.push(next, n)
          }
        }
      }
      const t2 = performance.now()
      const areas = new Map<number, number>()
      let land = 0
      let unreached = 0
      for (let i = 0; i < size; i += 1) {
        if (t.elevation[i] <= t.seaLevel) continue
        land += 1
        if (owner[i] < 0) unreached += 1
        else areas.set(owner[i], (areas.get(owner[i]) ?? 0) + 1)
      }
      const sorted = [...areas.values()].sort((a, b) => a - b)
      const q = (p: number): number => sorted[Math.floor(p * (sorted.length - 1))] ?? 0
      lines.push(
        `seed ${seed} spacing ${spacing}: ${seedCells.length} seeds, ${areas.size} provinces over ${land} land tiles (${unreached} unreached); area p10 ${q(0.1)} median ${q(0.5)} p90 ${q(0.9)} max ${q(1)}; seeds ${(t1 - t0).toFixed(0)} ms, search ${(t2 - t1).toFixed(0)} ms`
      )
    }
  }
  console.log('\n' + lines.join('\n') + '\n')
}, 600000)
