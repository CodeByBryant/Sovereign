// A measurement, not a test: how meaningful are the strategic points, and do a nation's stats follow its land?
//
//   STRATEGIC  counts and mean value by type; how clumped the points are (distance to the nearest other
//              point); whether the points are a network (do any two of them lie on one landmass pair).
//   NATIONS    the starting stats, governments and personalities, and the rank correlation of each stat
//              with the land it should depend on (food, metals, luxuries). Stats that follow the land
//              correlate; random ones do not.
//
//   pnpm --filter @sovereign/simulation probe -- tests/probe/strategic-nations.probe.ts
//
// PROBE_SEEDS=1,2,3 picks the seeds (default ten) and PROBE_SIDE=512 shrinks the maps.
import { RESOURCE_CATALOG, ResourceType } from '@sovereign/contracts'
import { it } from 'vitest'
import { World } from '../../src/world/World'

const DEFAULT_SEEDS = [1337, 1, 2, 3, 42, 2024, 31337, 90210, 8675309, 4294967295]
const seeds = (process.env.PROBE_SEEDS ?? DEFAULT_SEEDS.join(','))
  .split(',')
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n >= 0)
const side = Number.parseInt(process.env.PROBE_SIDE ?? '', 10)

const TYPES: string[] = ['river_crossing', 'mountain_pass', 'strait', 'peninsula', 'isthmus']
const FOOD = new Set<number>([ResourceType.Grain, ResourceType.Pasture, ResourceType.Fish])
const METAL = new Set<number>([ResourceType.Iron, ResourceType.Copper, ResourceType.Coal])
const LUXURY = new Set<number>(
  RESOURCE_CATALOG.filter((d) => d.tier === 'luxury').map((d) => d.id as number)
)

/** Spearman rank correlation of two equal-length series (average ranks for ties). */
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]): number[] => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0])
    const r = new Array<number>(xs.length).fill(0)
    for (let i = 0; i < order.length;) {
      let j = i
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1
      for (let k = i; k <= j; k += 1) r[order[k][1]] = (i + j) / 2
      i = j + 1
    }
    return r
  }
  const ra = rank(a)
  const rb = rank(b)
  const n = a.length
  const ma = ra.reduce((s, v) => s + v, 0) / n
  const mb = rb.reduce((s, v) => s + v, 0) / n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i += 1) {
    num += (ra[i] - ma) * (rb[i] - mb)
    da += (ra[i] - ma) ** 2
    db += (rb[i] - mb) ** 2
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db)
}

it(
  'reports strategic points and how nation stats relate to land',
  () => {
    const lines: string[] = []
    const byType = new Map<string, { count: number; value: number }>()
    const nearest: number[] = []
    let total = 0
    let crossingsNearRiver = 0
    let crossings = 0
    let riverTiles = 0
    const stat = {
      pop: [] as number[],
      mil: [] as number[],
      eco: [] as number[],
      dip: [] as number[]
    }
    const land = {
      food: [] as number[],
      metal: [] as number[],
      luxury: [] as number[],
      area: [] as number[]
    }
    const governments = new Map<string, number>()
    const profileKeys = [
      'food',
      'timber',
      'stone',
      'horses',
      'metals',
      'luxuries',
      'diversity',
      'coast',
      'river',
      'highGround',
      'defence',
      'traffic',
      'contacts'
    ] as const
    const profiles: Record<string, number[]> = Object.fromEntries(
      profileKeys.map((k) => [k, [] as number[]])
    )
    const personality: number[][] = [[], [], [], [], []]
    let nationCount = 0
    let hubCount = 0
    let routeCount = 0
    let components = 0
    const routeTiles: number[] = []

    for (const seed of seeds) {
      const config = Number.isFinite(side) ? { map: { width: side, height: side } } : undefined
      const world = World.create({ seed, config })
      const t = world.terrain
      for (const v of t.riverMask) riverTiles += v
      hubCount += t.hubs.length
      routeCount += t.routes.length
      const parent = t.hubs.map((_, i) => i)
      const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
      for (const r of t.routes) {
        parent[find(r.from)] = find(r.to)
        routeTiles.push(r.path.length / 2)
      }
      components += new Set(t.hubs.map((_, i) => find(i))).size
      for (const p of t.strategicPoints) {
        const entry = byType.get(p.type) ?? { count: 0, value: 0 }
        entry.count += 1
        entry.value += p.value
        byType.set(p.type, entry)
        total += 1
        if (p.type === 'river_crossing') {
          crossings += 1
          let near = false
          for (let dy = -3; dy <= 3 && !near; dy += 1) {
            for (let dx = -3; dx <= 3; dx += 1) {
              const x = p.x + dx
              const y = p.y + dy
              if (x >= 0 && y >= 0 && x < t.width && y < t.height && t.riverMask[y * t.width + x]) {
                near = true
                break
              }
            }
          }
          if (near) crossingsNearRiver += 1
        }
      }
      // distance to the nearest other point (a coarse grid keeps it cheap)
      const pts = t.strategicPoints
      const cell = 32
      const cols = Math.ceil(t.width / cell)
      const grid = new Map<number, number[]>()
      pts.forEach((p, i) => {
        const key = Math.floor(p.y / cell) * cols + Math.floor(p.x / cell)
        grid.set(key, [...(grid.get(key) ?? []), i])
      })
      pts.forEach((p, i) => {
        let best = Infinity
        const cx = Math.floor(p.x / cell)
        const cy = Math.floor(p.y / cell)
        for (let gy = cy - 2; gy <= cy + 2; gy += 1) {
          for (let gx = cx - 2; gx <= cx + 2; gx += 1) {
            for (const j of grid.get(gy * cols + gx) ?? []) {
              if (j === i) continue
              best = Math.min(best, Math.hypot(pts[j].x - p.x, pts[j].y - p.y))
            }
          }
        }
        if (Number.isFinite(best)) nearest.push(best)
      })

      for (const n of world.nations) {
        nationCount += 1
        let food = 0
        let metal = 0
        let luxury = 0
        for (const tile of n.provinces) {
          const s = t.resources.surface.type[tile] as number
          const g = t.resources.ground.type[tile] as number
          if (FOOD.has(s)) food += 1
          if (METAL.has(g)) metal += 1
          if (LUXURY.has(s) || LUXURY.has(g)) luxury += 1
        }
        land.food.push(food)
        land.metal.push(metal)
        land.luxury.push(luxury)
        land.area.push(n.provinces.size)
        stat.pop.push(n.stats.population)
        stat.mil.push(n.stats.military)
        stat.eco.push(n.stats.economy)
        stat.dip.push(n.stats.diplomacy)
        governments.set(n.government, (governments.get(n.government) ?? 0) + 1)
        for (const k of profileKeys) (profiles[k] as number[]).push(n.profile[k])
        const p = n.personality
        ;[p.aggression, p.expansionism, p.diplomacy, p.mercantilism, p.militarism].forEach((v, k) =>
          personality[k].push(v)
        )
      }
    }

    nearest.sort((a, b) => a - b)
    const q = (p: number): number => nearest[Math.floor(p * (nearest.length - 1))] ?? 0
    const worlds = seeds.length
    lines.push(`\nStrategic points over ${worlds} worlds (mean per world)`)
    for (const type of TYPES) {
      const e = byType.get(type)
      if (e === undefined) continue
      lines.push(
        `  ${type.padEnd(16)} ${(e.count / worlds).toFixed(0).padStart(6)} points   mean value ${(e.value / e.count).toFixed(2)}`
      )
    }
    lines.push(`  total            ${(total / worlds).toFixed(0).padStart(6)} points`)
    routeTiles.sort((a, b) => a - b)
    lines.push(
      `  hubs ${(hubCount / worlds).toFixed(0)} and routes ${(routeCount / worlds).toFixed(0)} per world; connected groups of hubs ${(components / worlds).toFixed(1)}; route length (cells) median ${routeTiles[Math.floor(routeTiles.length / 2)] ?? 0}, longest ${routeTiles[routeTiles.length - 1] ?? 0}`
    )
    lines.push(
      `  nearest other point: median ${q(0.5).toFixed(1)}, 10th pct ${q(0.1).toFixed(1)}, 90th pct ${q(0.9).toFixed(1)} tiles`
    )
    lines.push(
      `  river tiles ${(riverTiles / worlds).toFixed(0)} per world; river_crossing points ${(crossings / worlds).toFixed(0)} (${crossings === 0 ? 0 : ((100 * crossingsNearRiver) / crossings).toFixed(0)}% within 3 tiles of a river)`
    )

    lines.push(`\nNations over ${worlds} worlds (${nationCount} nations)`)
    const range = (xs: number[]): string =>
      `${Math.min(...xs).toFixed(2)} to ${Math.max(...xs).toFixed(2)}`
    lines.push(`  territory tiles    ${range(land.area)}`)
    lines.push(`  population         ${range(stat.pop)}`)
    lines.push(`  military           ${range(stat.mil)}`)
    lines.push(`  economy            ${range(stat.eco)}`)
    lines.push(`  diplomacy          ${range(stat.dip)}`)
    lines.push(
      '  personality (aggression, expansionism, diplomacy, mercantilism, militarism): means ' +
        personality.map((xs) => (xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(2)).join(', ')
    )
    lines.push(
      '  governments: ' +
        [...governments.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([k, v]) => `${k} ${v}`)
          .join(', ')
    )
    const pct = (xs: number[], q: number): number =>
      [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))] ?? 0
    lines.push(
      `  nations with a coast: ${(profiles.coast as number[]).filter((c) => c > 0).length} of ${nationCount}; with a river: ${(profiles.river as number[]).filter((c) => c > 0).length}`
    )
    lines.push('  what the land gives (10th / 50th / 90th percentile):')
    for (const k of profileKeys) {
      const xs = profiles[k] as number[]
      lines.push(
        `    ${k.padEnd(12)} ${pct(xs, 0.1).toFixed(2).padStart(8)} ${pct(xs, 0.5).toFixed(2).padStart(8)} ${pct(xs, 0.9).toFixed(2).padStart(8)}`
      )
    }
    for (const [name, xs] of [
      ['population', stat.pop],
      ['military', stat.mil],
      ['economy', stat.eco],
      ['diplomacy', stat.dip]
    ] as const) {
      lines.push(
        `    ${(name + ' (stat)').padEnd(16)} ${pct(xs, 0.1).toFixed(0).padStart(5)} ${pct(xs, 0.5).toFixed(0).padStart(5)} ${pct(xs, 0.9).toFixed(0).padStart(5)}`
      )
    }
    lines.push('  rank correlation of a stat with the land it should follow (0 = unrelated):')
    lines.push(`    population vs food tiles       ${spearman(stat.pop, land.food).toFixed(2)}`)
    lines.push(`    population vs territory tiles  ${spearman(stat.pop, land.area).toFixed(2)}`)
    lines.push(`    military vs metal tiles        ${spearman(stat.mil, land.metal).toFixed(2)}`)
    lines.push(`    economy vs luxury tiles        ${spearman(stat.eco, land.luxury).toFixed(2)}`)
    console.log(lines.join('\n') + '\n')
  },
  30 * 60 * 1000
)
