// A measurement, not a test: how good are the resources? Three questions, over several full-size worlds:
//
//   SHARE       what fraction of land carries each resource?
//   CLUSTERING  are a resource's tiles coherent patches or speckle? For every tile of a resource, the
//               fraction of its 4 neighbours that hold the same resource (0 = isolated pixels,
//               1 = solid blocks). Noise thresholds score low; veins, basins and fields score high.
//   SCARCITY    does geography decide who is rich? Landmasses (4-connected land of at least MIN_LAND
//               tiles) are counted per resource: how many of them have none of it?
//
//   pnpm --filter @sovereign/simulation probe -- tests/probe/resource-quality.probe.ts
//
// PROBE_SEEDS=1,2,3 picks the seeds (default ten) and PROBE_SIDE=512 shrinks the maps.
import { RESOURCE_META, ResourceType, type TerrainFields } from '@sovereign/contracts'
import { it } from 'vitest'
import { World } from '../../src/world/World'

const DEFAULT_SEEDS = [1337, 1, 2, 3, 42, 2024, 31337, 90210, 8675309, 4294967295]
const seeds = (process.env.PROBE_SEEDS ?? DEFAULT_SEEDS.join(','))
  .split(',')
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n >= 0)
const side = Number.parseInt(process.env.PROBE_SIDE ?? '', 10)

/** A landmass is at least this many tiles (about 0.5% of a 2000 x 2000 map). */
const MIN_LAND = 20_000

/** The resource type layers of a world: one array per slot (today there is one). */
function typeLayers(t: TerrainFields): Uint8Array[] {
  return [t.resourceType]
}

interface WorldStats {
  land: number
  /** tiles per type, summed over slots */
  count: number[]
  /** same-type neighbour pairs per type, summed over slots (4-neighbourhood, counted per tile) */
  sameNeighbours: number[]
  landmasses: number
  /** landmasses that hold none of the type */
  missing: number[]
}

function measure(world: World): WorldStats {
  const t = world.terrain
  const { width, height } = t
  const size = width * height
  const kinds = Object.keys(ResourceType).length / 2
  const count = new Array<number>(kinds).fill(0)
  const sameNeighbours = new Array<number>(kinds).fill(0)
  let land = 0
  for (let i = 0; i < size; i += 1) if (t.elevation[i] > t.seaLevel) land += 1

  for (const layer of typeLayers(t)) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x
        const type = layer[i]
        if (type === 0) continue
        count[type] += 1
        if (x > 0 && layer[i - 1] === type) sameNeighbours[type] += 1
        if (x < width - 1 && layer[i + 1] === type) sameNeighbours[type] += 1
        if (y > 0 && layer[i - width] === type) sameNeighbours[type] += 1
        if (y < height - 1 && layer[i + width] === type) sameNeighbours[type] += 1
      }
    }
  }

  // landmasses: 4-connected land, labelled by flood fill
  const label = new Int32Array(size)
  const queue = new Int32Array(size)
  const present: Array<Set<number>> = []
  for (let start = 0; start < size; start += 1) {
    if (label[start] !== 0 || t.elevation[start] <= t.seaLevel) continue
    const id = present.length + 1
    let head = 0
    let tail = 0
    queue[tail] = start
    tail += 1
    label[start] = id
    const types = new Set<number>()
    let tiles = 0
    while (head < tail) {
      const i = queue[head]
      head += 1
      tiles += 1
      for (const layer of typeLayers(t)) if (layer[i] !== 0) types.add(layer[i])
      const x = i % width
      const y = (i - x) / width
      const next = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1
      ]
      for (const n of next) {
        if (n >= 0 && label[n] === 0 && t.elevation[n] > t.seaLevel) {
          label[n] = id
          queue[tail] = n
          tail += 1
        }
      }
    }
    present.push(tiles >= MIN_LAND ? types : new Set<number>([-1]))
  }
  const big = present.filter((s) => !s.has(-1))
  const missing = new Array<number>(kinds).fill(0)
  for (let type = 1; type < kinds; type += 1) {
    missing[type] = big.filter((s) => !s.has(type)).length
  }
  return { land, count, sameNeighbours, landmasses: big.length, missing }
}

it(
  'reports resource share, clustering and scarcity',
  () => {
    const worlds = seeds.map((seed) => {
      const config = Number.isFinite(side) ? { map: { width: side, height: side } } : undefined
      return measure(World.create({ seed, config }))
    })
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    const lines: string[] = []
    lines.push(`\nResource quality over ${worlds.length} worlds (mean per world)`)
    lines.push(
      `  landmasses of at least ${MIN_LAND} tiles: ${mean(worlds.map((w) => w.landmasses)).toFixed(1)}`
    )
    lines.push(
      '\n  resource            % of land   clustering   landmasses with none   worlds present'
    )
    for (let type = 1; type < Object.keys(ResourceType).length / 2; type += 1) {
      const entry = RESOURCE_META[type as ResourceType]
      const share = mean(worlds.map((w) => (100 * w.count[type]) / w.land))
      const present = worlds.filter((w) => w.count[type] > 0)
      const clustering =
        present.length === 0
          ? 0
          : mean(present.map((w) => w.sameNeighbours[type] / (4 * w.count[type])))
      const missing = mean(worlds.map((w) => w.missing[type]))
      lines.push(
        `  ${entry.label.padEnd(18)} ${share.toFixed(3).padStart(9)}   ${clustering.toFixed(3).padStart(9)}   ${missing.toFixed(2).padStart(20)}   ${String(present.length).padStart(8)}/${worlds.length}`
      )
    }
    console.log(lines.join('\n') + '\n')
  },
  30 * 60 * 1000
)
