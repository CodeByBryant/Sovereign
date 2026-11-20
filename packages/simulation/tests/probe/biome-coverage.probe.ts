// A measurement, not a test: does the generator really produce all 26 biomes, and in what
// proportions? It answers in two levels so a classifier bug is told apart from a tuning question:
//
//   1. REAL WORLDS. Generates several full-size worlds and counts every biome in each.
//   2. REACHABILITY. Sweeps the classifier over a fine grid of every input it can be given and lists
//      the biomes it can emit at all. A biome missing here can never appear in any world, however
//      the noise falls.
//
//   pnpm --filter @sovereign/simulation probe -- tests/probe/biome-coverage.probe.ts
//
// PROBE_SEEDS=1,2,3 picks the seeds and PROBE_SIDE=512 shrinks the maps (default: ten fixed seeds at
// the real 2000 x 2000). Nothing is asserted; the report is the output.
import { defaultWorldConfig } from '@sovereign/config'
import { BIOME_KEYS, ResourceType, type BiomeKey } from '@sovereign/contracts'
import { performance } from 'node:perf_hooks'
import { it } from 'vitest'
import { determineBiome } from '../../src/terrain/biomes'
import { World } from '../../src/world/World'

const DEFAULT_SEEDS = [1337, 1, 2, 3, 42, 2024, 31337, 90210, 8675309, 4294967295]
const seeds = (process.env.PROBE_SEEDS ?? DEFAULT_SEEDS.join(','))
  .split(',')
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n >= 0)
const side = Number.parseInt(process.env.PROBE_SIDE ?? '', 10)
const WATER: ReadonlySet<BiomeKey> = new Set(['deep_ocean', 'ocean'])

const pct = (n: number, digits = 3): string => `${n.toFixed(digits)}%`.padStart(9)

interface WorldCount {
  seed: number
  seaLevel: number
  total: number
  land: number
  counts: number[]
  /** River tiles, resource tiles by `ResourceType`, strategic points by type, nations spawned. */
  riverTiles: number
  resources: number[]
  strategic: Record<string, number>
  nations: number
  /** Elevation at the 50th, 90th, 99th and 99.99th percentile, and the maximum. */
  elevation: { p50: number; p90: number; p99: number; p9999: number; max: number }
}

function countWorld(seed: number): WorldCount {
  const config = Number.isFinite(side) ? { map: { width: side, height: side } } : undefined
  const world = World.create({ seed, config })
  const ids = world.terrain.biomeIds
  const counts = new Array<number>(BIOME_KEYS.length).fill(0)
  for (let i = 0; i < ids.length; i += 1) counts[ids[i]] += 1
  const water = BIOME_KEYS.reduce((n, key, id) => n + (WATER.has(key) ? counts[id] : 0), 0)
  const t = world.terrain
  let riverTiles = 0
  const resources = new Array<number>(8).fill(0)
  for (let i = 0; i < ids.length; i += 1) {
    if (t.riverMask[i] !== 0) riverTiles += 1
    if (t.resourceType[i] !== 0) resources[t.resourceType[i]] += 1
  }
  const strategic: Record<string, number> = {}
  for (const point of t.strategicPoints) strategic[point.type] = (strategic[point.type] ?? 0) + 1
  const sorted = Float32Array.from(world.terrain.elevation).sort()
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return {
    seed,
    riverTiles,
    resources,
    strategic,
    nations: world.nations.length,
    elevation: {
      p50: at(0.5),
      p90: at(0.9),
      p99: at(0.99),
      p9999: at(0.9999),
      max: sorted[sorted.length - 1]
    },
    seaLevel: world.terrain.seaLevel,
    total: ids.length,
    land: ids.length - water,
    counts
  }
}

/** Every biome the classifier can emit for some input, over a fine grid and several sea levels. */
function reachableBiomes(): Set<BiomeKey> {
  const seen = new Set<BiomeKey>()
  const config = defaultWorldConfig.biomes
  for (const seaLevel of [0.05, 0.15, 0.25, defaultWorldConfig.map.seaLevel]) {
    for (let e = 0; e <= 1000; e += 1) {
      for (let t = 0; t <= 100; t += 1) {
        for (let h = 0; h <= 100; h += 1) {
          for (const variation of [0, 0.5, 1]) {
            seen.add(determineBiome(e / 1000, t / 100, h / 100, variation, seaLevel, config))
          }
        }
      }
    }
  }
  return seen
}

it(
  'reports biome coverage over real worlds and over the classifier',
  () => {
    const started = performance.now()
    const worlds = seeds.map(countWorld)
    const worldsMs = performance.now() - started

    const lines: string[] = []
    const log = (line = ''): number => lines.push(line)

    log(
      `\nBiome coverage: ${worlds.length} worlds, ${worlds[0].total} tiles each (${Math.round(worldsMs)} ms)`
    )
    log('\nPer world')
    log('  seed         sea level   land        elevation: p50     p90     p99  p99.99     max')
    for (const w of worlds) {
      const e = w.elevation
      const f = (x: number): string => x.toFixed(3).padStart(7)
      log(
        `  ${String(w.seed).padEnd(11)}  ${w.seaLevel.toFixed(4)}   ${pct((100 * w.land) / w.total, 1)}   ${f(e.p50)} ${f(e.p90)} ${f(e.p99)} ${f(e.p9999)} ${f(e.max)}`
      )
    }
    const b = defaultWorldConfig.biomes
    log(
      `  (highland starts at elevation ${b.highlandElevation}, alpine at ${b.alpineElevation}, mountain at ${b.mountainElevation})`
    )

    log('\nPer biome (percent of ALL tiles | of LAND tiles | range of all-tile % across worlds)')
    log('  biome              all tiles   land only        min        max   in worlds')
    const rows = BIOME_KEYS.map((key, id) => {
      const all = worlds.map((w) => (100 * w.counts[id]) / w.total)
      const landOnly = worlds.map((w) => (WATER.has(key) ? 0 : (100 * w.counts[id]) / w.land))
      const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
      return {
        key,
        meanAll: mean(all),
        meanLand: mean(landOnly),
        min: Math.min(...all),
        max: Math.max(...all),
        present: worlds.filter((w) => w.counts[id] > 0).length
      }
    })
    for (const r of [...rows].sort((a, b) => b.meanAll - a.meanAll)) {
      log(
        `  ${r.key.padEnd(17)} ${pct(r.meanAll, 4)}  ${WATER.has(r.key) ? '        -' : pct(r.meanLand, 4)}  ${pct(r.min, 4)} ${pct(r.max, 4)}   ${r.present}/${worlds.length}`
      )
    }

    // Everything else the retune must not break (percent of LAND tiles, mean over the worlds).
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    log('\nOther layers (percent of land tiles, mean over worlds)')
    log(
      `  river tiles        ${pct(mean(worlds.map((w) => (100 * w.riverTiles) / w.land)), 3)}   (range ${pct(Math.min(...worlds.map((w) => (100 * w.riverTiles) / w.land)), 2).trim()} to ${pct(Math.max(...worlds.map((w) => (100 * w.riverTiles) / w.land)), 2).trim()})`
    )
    for (const [name, id] of Object.entries(ResourceType)) {
      if (typeof id !== 'number' || id === 0) continue
      log(
        `  ${(name.toLowerCase() + ' tiles').padEnd(18)} ${pct(mean(worlds.map((w) => (100 * w.resources[id]) / w.land)), 3)}`
      )
    }
    const strategicTypes = [...new Set(worlds.flatMap((w) => Object.keys(w.strategic)))].sort(
      (a, b) => a.localeCompare(b)
    )
    for (const type of strategicTypes) {
      const counts = worlds.map((w) => w.strategic[type] ?? 0)
      log(
        `  ${(type + ' points').padEnd(18)} mean ${mean(counts).toFixed(0).padStart(6)} per world (min ${Math.min(...counts)}, max ${Math.max(...counts)})`
      )
    }
    log(`  nations spawned    ${worlds.map((w) => w.nations).join(' ')}`)

    const reachable = reachableBiomes()
    const unreachable = BIOME_KEYS.filter((key) => !reachable.has(key))
    const absent = rows.filter((r) => r.present === 0).map((r) => r.key)
    const partial = rows.filter((r) => r.present > 0 && r.present < worlds.length).map((r) => r.key)
    const tiny = rows.filter((r) => r.present > 0 && r.meanAll < 0.01).map((r) => r.key)

    const present = rows.filter((r) => r.present > 0).length
    log('\nVerdict')
    log(`  generated in at least one world: ${present} of ${BIOME_KEYS.length}`)
    log(`  never generated in any world:    ${absent.length ? absent.join(', ') : 'none'}`)
    log(`  generated in only some worlds:   ${partial.length ? partial.join(', ') : 'none'}`)
    log(`  under 0.01% of tiles (mean):     ${tiny.length ? tiny.join(', ') : 'none'}`)
    log(
      `  classifier can NEVER emit:       ${unreachable.length ? unreachable.join(', ') : 'none'}`
    )
    log(
      `  (classifier emits ${reachable.size} of ${BIOME_KEYS.length} biomes over the whole input grid)\n`
    )
    console.log(lines.join('\n'))
  },
  30 * 60 * 1000
)
