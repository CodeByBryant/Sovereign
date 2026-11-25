// A guard against the strategic points and the nations quietly turning back into noise. Before the route
// network, 92% of the strategic points were river crossings (one per 53 river tiles, a median 6.7 tiles
// apart) and every nation was 25 random-statted tiles. This generates three mid-size worlds and holds
// them to the design: points that lie on routes, of every kind, spread out; nations whose stats follow
// from the land they hold. The full measurement is `pnpm probe -- tests/probe/strategic-nations.probe.ts`.
import { defaultWorldConfig } from '@sovereign/config'
import { describe, expect, it } from 'vitest'
import { deriveStats, GOVERNMENTS } from '../../src/nations/derive'
import { World } from '../../src/world/World'

const SEEDS = [101, 202, 303]
const SIDE = 1000

/** Spearman rank correlation (average ranks for ties). */
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]): number[] => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0])
    const r = new Array<number>(xs.length).fill(0)
    for (let i = 0; i < order.length;) {
      let j = i
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j += 1
      for (let k = i; k <= j; k += 1) r[order[k]![1]] = (i + j) / 2
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
    num += (ra[i]! - ma) * (rb[i]! - mb)
    da += (ra[i]! - ma) ** 2
    db += (rb[i]! - mb) ** 2
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db)
}

describe(`routes, strategic points and nations over ${SEEDS.length} worlds of ${SIDE} x ${SIDE}`, () => {
  const worlds = SEEDS.map((seed) =>
    World.create({ seed, config: { map: { width: SIDE, height: SIDE } } })
  )
  const cell = defaultWorldConfig.routes.cell

  it('has a network: hubs on land, joined by routes, mostly in one connected group', () => {
    for (const w of worlds) {
      const t = w.terrain
      expect(t.hubs.length).toBeGreaterThanOrEqual(10)
      expect(t.routes.length).toBeGreaterThanOrEqual(t.hubs.length)
      for (const hub of t.hubs)
        expect(t.elevation[hub.y * t.width + hub.x]).toBeGreaterThan(t.seaLevel)
      const parent = t.hubs.map((_, i) => i)
      const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)))
      for (const r of t.routes) parent[find(r.from)] = find(r.to)
      const sizes = new Map<number, number>()
      t.hubs.forEach((_, i) => sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1))
      expect(Math.max(...sizes.values())).toBeGreaterThanOrEqual(t.hubs.length / 2)
    }
  })

  it('puts every strategic point on a route (within a cell of one of its tiles)', () => {
    for (const w of worlds) {
      const t = w.terrain
      const near = (x: number, y: number): boolean => {
        for (const r of t.routes) {
          for (let k = 0; k < r.path.length; k += 2) {
            if (
              Math.abs((r.path[k] as number) - x) <= cell &&
              Math.abs((r.path[k + 1] as number) - y) <= cell
            ) {
              return true
            }
          }
        }
        return false
      }
      const stray = t.strategicPoints.filter((p) => !near(p.x, p.y))
      expect(stray).toEqual([])
    }
  })

  it('has every kind of strategic point, none of them the bulk of the lot', () => {
    const counts = new Map<string, number>()
    let total = 0
    for (const w of worlds) {
      for (const p of w.terrain.strategicPoints) {
        counts.set(p.type, (counts.get(p.type) ?? 0) + 1)
        total += 1
      }
    }
    for (const type of ['river_crossing', 'mountain_pass', 'strait', 'isthmus']) {
      expect(counts.get(type) ?? 0, type).toBeGreaterThan(0)
    }
    for (const [type, n] of counts) expect(n / total, type).toBeLessThan(0.7)
  })

  it('has a sensible number of points, not hundreds on every river', () => {
    for (const w of worlds) {
      expect(w.terrain.strategicPoints.length).toBeGreaterThanOrEqual(10)
      expect(w.terrain.strategicPoints.length).toBeLessThanOrEqual(400)
    }
  })

  it('spaces the points: the median distance to the next one is well above what the noise gave', () => {
    const nearest: number[] = []
    for (const w of worlds) {
      const pts = w.terrain.strategicPoints
      for (const p of pts) {
        let best = Infinity
        for (const q of pts) {
          if (q === p) continue
          best = Math.min(best, Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2))
        }
        if (Number.isFinite(best)) nearest.push(best)
      }
    }
    nearest.sort((a, b) => a - b)
    expect(nearest[Math.floor(nearest.length / 2)]).toBeGreaterThan(15)
  })

  it('puts fords on rivers, passes on high ground, straits in water', () => {
    let fords = 0
    let fordsOnRiver = 0
    let passes = 0
    let passesHigh = 0
    let straits = 0
    let straitsWet = 0
    for (const w of worlds) {
      const t = w.terrain
      for (const p of t.strategicPoints) {
        const i = p.y * t.width + p.x
        if (p.type === 'river_crossing') {
          fords += 1
          if (t.riverMask[i] === 1) fordsOnRiver += 1
        } else if (p.type === 'mountain_pass') {
          passes += 1
          if ((t.elevation[i] as number) >= defaultWorldConfig.strategic.passMinElevation - 0.05)
            passesHigh += 1
        } else if (p.type === 'strait') {
          straits += 1
          if ((t.elevation[i] as number) <= t.seaLevel) straitsWet += 1
        }
      }
    }
    expect(fordsOnRiver / fords).toBeGreaterThanOrEqual(0.9)
    expect(passesHigh / passes).toBeGreaterThanOrEqual(0.9)
    expect(straitsWet / straits).toBeGreaterThanOrEqual(0.7)
  })

  it('gives every nation its starting area (nearly always), in provinces nobody else holds', () => {
    const area = defaultWorldConfig.nations.startArea
    let nations = 0
    let full = 0
    for (const w of worlds) {
      const seen = new Set<number>()
      for (const n of w.nations) {
        nations += 1
        const held = n.profile.area
        const last = w.provinces.area[[...n.provinces].pop() as number] as number
        if (held >= area) full += 1
        // it stops at the first province that takes it to the starting area
        expect(held - last).toBeLessThan(area)
        for (const province of n.provinces) {
          expect(seen.has(province)).toBe(false)
          seen.add(province)
        }
      }
    }
    expect(nations).toBeGreaterThanOrEqual(30)
    expect(full / nations).toBeGreaterThanOrEqual(0.9)
  })

  it('derives the stats of every nation from its land alone, and they follow the land', () => {
    const food: number[] = []
    const people: number[] = []
    const metals: number[] = []
    const army: number[] = []
    for (const w of worlds) {
      for (const n of w.nations) {
        expect(n.stats).toEqual(deriveStats(n.profile))
        food.push(n.profile.food)
        people.push(n.stats.population)
        metals.push(n.profile.metals)
        army.push(n.stats.military)
      }
    }
    expect(spearman(food, people)).toBeGreaterThanOrEqual(0.9)
    // with metals scattered thin (and stocks moving as villagers gather) the link is real but loose
    expect(spearman(metals, army)).toBeGreaterThanOrEqual(0.2)
  })

  it('has a variety of governments and personalities, all in range', () => {
    const governments = new Set<string>()
    for (const w of worlds) {
      for (const n of w.nations) {
        governments.add(n.government)
        expect(GOVERNMENTS).toContain(n.government)
        for (const v of Object.values(n.personality)) {
          expect(v).toBeGreaterThanOrEqual(0.05)
          expect(v).toBeLessThanOrEqual(0.95)
        }
      }
    }
    expect(governments.size).toBeGreaterThanOrEqual(4)
  })
})
