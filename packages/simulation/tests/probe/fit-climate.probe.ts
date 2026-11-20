// A tool, not a test: fits the climate (temperature profile knots and the humidity thresholds of every
// climate band) so each biome covers its target share of land. It samples a few full-size worlds,
// looks at how land is actually distributed in temperature and humidity, and solves for the cut
// points that give each band and row its target share. Rank-based, so it does not depend on the
// noise, and the result is checked on other seeds by the coverage probe.
//
//   pnpm --filter @sovereign/simulation probe -- tests/probe/fit-climate.probe.ts
//
// FIT_SEEDS=11,12 picks the fitting seeds (default four, none of which the coverage probe uses).
import { defaultWorldConfig } from '@sovereign/config'
import { it } from 'vitest'
import { World } from '../../src/world/World'

const seeds = (process.env.FIT_SEEDS ?? '11,12,13,14')
  .split(',')
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n >= 0)

/**
 * Target share of INLAND land (land that is not shore) for each climate biome, in percent, in table
 * order within each temperature band. The elevated biomes (highland, alpine, mountain: 14%) come from
 * the elevation profile, so these sum to 86 and the shares below are of all inland land.
 */
const TARGETS: ReadonlyArray<{
  band: string
  rows: ReadonlyArray<[biome: string, percent: number]>
}> = [
  {
    band: 'polar',
    rows: [
      ['polar_desert', 2],
      ['tundra', 7],
      ['taiga', 3],
      ['glacier', 0.5]
    ]
  },
  {
    band: 'cool',
    rows: [
      ['cold_steppe', 3],
      ['taiga', 4],
      ['boreal_forest', 7],
      ['swamp', 1]
    ]
  },
  {
    band: 'temperate',
    rows: [
      ['temperate_desert', 2.5],
      ['steppe', 6],
      ['grassland', 9],
      ['woodland', 7.5],
      ['temperate_forest', 7.5],
      ['wetland', 2]
    ]
  },
  {
    band: 'tropical',
    rows: [
      ['desert', 6],
      ['badlands', 2.5],
      ['savanna', 5],
      ['chaparral', 3],
      ['tropical_forest', 4],
      ['rainforest', 3],
      ['mangrove', 0.5]
    ]
  }
]

/** The value at fraction `p` (0 to 1) of an ascending array. */
const at = (sorted: Float32Array, p: number): number =>
  sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))))]

/** Fraction of an ascending array that is at most `value`. */
function cdf(sorted: Float32Array, value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo / sorted.length
}

const sortedCopy = (values: number[]): Float32Array => Float32Array.from(values).sort()

it(
  'fits the climate table to the target shares',
  () => {
    const sea = defaultWorldConfig.map.seaLevel
    const shoreTop = sea + defaultWorldConfig.biomes.shoreBand
    const highland = defaultWorldConfig.biomes.highlandElevation

    // Pool the land tiles of every fitting world: temperature of all land, and (temperature,
    // humidity) of the inland lowland tiles the climate table classifies.
    const landTemp: number[] = []
    const lowTemp: number[] = []
    const lowHumid: number[] = []
    for (const seed of seeds) {
      const t = World.create({ seed }).terrain
      for (let i = 0; i < t.elevation.length; i += 1) {
        const e = t.elevation[i]
        if (e <= t.seaLevel) continue
        landTemp.push(t.temperature[i])
        if (e >= shoreTop && e <= highland) {
          lowTemp.push(t.temperature[i])
          lowHumid.push(t.humidity[i])
        }
      }
    }
    const allLand = sortedCopy(landTemp)
    const lowland = sortedCopy(lowTemp)

    const lines: string[] = [
      `\nClimate fit on ${seeds.length} worlds: ${landTemp.length} land tiles, ${lowTemp.length} inland lowland`
    ]

    // --- Temperature: the cut points between bands, as ranks among ALL land ---
    const bandTotals = TARGETS.map((b) => b.rows.reduce((n, [, p]) => n + p, 0))
    const grand = bandTotals.reduce((a, b) => a + b, 0)
    const cutValues: number[] = []
    const knots: Array<[number, number]> = [[0, 0.03]]
    let cumulative = 0
    const boundaries = [0.2, 0.4, 0.7]
    for (let b = 0; b < 3; b += 1) {
      cumulative += bandTotals[b] / grand
      const cut = at(lowland, cumulative)
      cutValues.push(cut)
      knots.push([Math.round(cdf(allLand, cut) * 10000) / 10000, boundaries[b]])
    }
    knots.push([1, 0.97])
    lines.push('\ntemperature.profile (rank over land -> temperature):')
    lines.push(`  [${knots.map(([q, v]) => `[${q}, ${v}]`).join(', ')}]`)

    // --- Humidity: row thresholds from each band's own humidity distribution ---
    lines.push('\nbiomes.bands (humidity thresholds fitted to the target shares):')
    const rank = (t: number): number => cutValues.filter((c) => t >= c).length // 0..3
    for (let b = 0; b < TARGETS.length; b += 1) {
      const humidities = sortedCopy(lowHumid.filter((_, i) => rank(lowTemp[i]) === b))
      const total = bandTotals[b]
      let running = 0
      let previous = 0
      const rows = TARGETS[b].rows.map(([biome, percent], r) => {
        running += percent
        const last = r === TARGETS[b].rows.length - 1
        // Strictly increasing and below 1 for every row but the last: humidity is clamped at exactly 1
        // beside rivers, so the wettest rows can tie there; the threshold just below 1 then picks out
        // that tied mass.
        const fitted = Math.round(at(humidities, running / total) * 1000) / 1000
        const threshold = last ? 1 : Math.min(0.999, Math.max(fitted, previous + 0.001))
        previous = threshold
        return `{ maxHumidity: ${threshold}, biome: '${biome}' }`
      })
      lines.push(
        `  band ${TARGETS[b].band} (${((100 * humidities.length) / lowland.length).toFixed(1)}% of inland lowland, target ${((100 * total) / grand).toFixed(1)}%):`
      )
      for (const row of rows) lines.push(`    ${row},`)
    }
    console.log(lines.join('\n'))
  },
  30 * 60 * 1000
)
