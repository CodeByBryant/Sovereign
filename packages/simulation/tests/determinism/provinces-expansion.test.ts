// A guard against the world quietly going back to standing still, or to borders that do not follow the
// land. Three mid-size worlds are cut into provinces and grown until the nations stop: the provinces must be
// connected, a sensible size and sit their borders on costly ground; the nations must settle (nothing changes
// once they have), stay consistent all along, and a replay (or a save in the middle) must give the same hash.
// The full measurement is `pnpm probe -- tests/probe/phase3-world.probe.ts`.
import { defaultWorldConfig } from '@sovereign/config'
import { describe, expect, it } from 'vitest'
import { deriveStats } from '../../src/nations/derive'
import { combineProfile } from '../../src/nations/provinceProfile'
import { decodeWorld, encodeWorld } from '../../src/serialization/save'
import { buildCostGrid } from '../../src/terrain/cost'
import { buildProvinces, NO_PROVINCE, tileCosts } from '../../src/terrain/provinces'
import { World } from '../../src/world/World'

const SEEDS = [101, 202, 303]
const SIDE = 1000
const config = { map: { width: SIDE, height: SIDE } }

/** Run until the borders settle, and say how many ticks that took (or give up at `limit`). */
function settle(world: World, limit = 200_000): number {
  let ticks = 0
  while (!world.saturated && ticks < limit) {
    world.step()
    ticks += 1
  }
  return ticks
}

describe(`provinces over ${SEEDS.length} worlds of ${SIDE} x ${SIDE}`, () => {
  const worlds = SEEDS.map((seed) => World.create({ seed, config }))
  const { minArea, spacing, costCap } = defaultWorldConfig.provinces

  it('cuts the land into provinces of a sensible size, none under the minimum', () => {
    for (const w of worlds) {
      const p = w.provinces
      const areas = Array.from(p.area).sort((a, b) => a - b)
      // a seed every `spacing` tiles gives about spacing^2 x 1.15 tiles each
      expect(p.count).toBeGreaterThanOrEqual(300)
      expect(p.count).toBeLessThanOrEqual(1000)
      expect(areas[0]).toBeGreaterThanOrEqual(minArea)
      const median = areas[Math.floor(areas.length / 2)]!
      expect(median).toBeGreaterThanOrEqual(spacing * spacing * 0.6)
      expect(median).toBeLessThanOrEqual(spacing * spacing * 1.8)
      // all land is in a province, bar specks
      let land = 0
      for (let i = 0; i < w.terrain.elevation.length; i += 1) {
        if (w.terrain.elevation[i]! > w.terrain.seaLevel) land += 1
      }
      const covered = areas.reduce((n, a) => n + a, 0)
      expect(covered).toBeGreaterThan(land * 0.99)
      expect(covered).toBeLessThanOrEqual(land)
    }
  })

  it('makes every province one connected piece', () => {
    for (const w of worlds) {
      const p = w.provinces
      const { width } = w.terrain
      const seen = new Uint8Array(w.terrain.elevation.length)
      for (let id = 0; id < p.count; id += 1) {
        const first = p.tiles[p.start[id]!]!
        let reached = 0
        const stack = [first]
        seen[first] = 1
        while (stack.length > 0) {
          const t = stack.pop()!
          reached += 1
          const x = t % width
          for (const n of [x > 0 ? t - 1 : -1, x < width - 1 ? t + 1 : -1, t - width, t + width]) {
            if (n >= 0 && n < seen.length && seen[n] === 0 && p.provinceOf[n] === id) {
              seen[n] = 1
              stack.push(n)
            }
          }
        }
        expect(reached, `province ${id} of seed ${w.seed}`).toBe(p.area[id])
      }
    }
  })

  it('pulls the borders toward ground that is costly to cross, more than the same seeds cut by plain distance do', () => {
    // Provinces are about the same size everywhere (a seed every `spacing` tiles), so a border can only
    // slide by up to half a province: the pull is modest, and it is measured against a control (the same
    // seeds, every tile costing 1) rather than against an absolute number. Measured on these worlds:
    // border tiles cost 1.07 to 1.13 times the average land tile (the control 1.00 to 1.03), and a river is
    // 1.4 to 1.6 times as common beside a border as on land (the control 1.0 to 1.06).
    for (const w of worlds) {
      const t = w.terrain
      const grid = buildCostGrid({
        width: t.width,
        height: t.height,
        seaLevel: t.seaLevel,
        elevation: t.elevation,
        biomeIds: t.biomeIds,
        riverMask: t.riverMask,
        riverWidth: t.riverWidth,
        highlandElevation: w.config.biomes.highlandElevation,
        slopeScale: w.config.resources.features.slopeScale,
        cell: w.config.routes.cell,
        config: w.config.routes.cost
      })
      const cost = tileCosts(grid, t.width, t.height, costCap)
      const land = new Uint8Array(t.elevation.length)
      for (let i = 0; i < land.length; i += 1) land[i] = t.elevation[i]! > t.seaLevel ? 1 : 0
      const control = buildProvinces({
        width: t.width,
        height: t.height,
        land,
        cost: new Float32Array(land.length).fill(1),
        spacing,
        minArea,
        seeds: Array.from(w.provinces.seed)
      })
      const measure = (of: Uint16Array): { costRatio: number; riverRatio: number } => {
        let all = 0
        let allCost = 0
        let allRiver = 0
        let edge = 0
        let edgeCost = 0
        let edgeRiver = 0
        const near = (i: number): boolean => {
          const x = i % t.width
          return (
            t.riverMask[i] !== 0 ||
            (x > 0 && t.riverMask[i - 1] !== 0) ||
            (x < t.width - 1 && t.riverMask[i + 1] !== 0) ||
            (i >= t.width && t.riverMask[i - t.width] !== 0) ||
            (i + t.width < of.length && t.riverMask[i + t.width] !== 0)
          )
        }
        for (let i = 0; i < of.length; i += 1) {
          if (of[i] === NO_PROVINCE) continue
          all += 1
          allCost += cost[i]!
          const river = near(i)
          if (river) allRiver += 1
          const x = i % t.width
          const different =
            (x > 0 && of[i - 1] !== of[i]) ||
            (x < t.width - 1 && of[i + 1] !== of[i]) ||
            (i >= t.width && of[i - t.width] !== of[i]) ||
            (i + t.width < of.length && of[i + t.width] !== of[i])
          if (different) {
            edge += 1
            edgeCost += cost[i]!
            if (river) edgeRiver += 1
          }
        }
        expect(edge).toBeGreaterThan(1000)
        return {
          costRatio: edgeCost / edge / (allCost / all),
          riverRatio: edgeRiver / edge / (allRiver / all)
        }
      }
      const cut = measure(w.provinces.provinceOf)
      const plain = measure(control.provinceOf)
      // borders sit on costlier ground than the average land tile, and than the same seeds cut by distance
      expect(cut.costRatio).toBeGreaterThan(1.03)
      expect(cut.costRatio).toBeGreaterThan(plain.costRatio + 0.03)
      // and rivers are commoner beside them
      expect(cut.riverRatio).toBeGreaterThan(1.2)
      expect(cut.riverRatio).toBeGreaterThan(plain.riverRatio + 0.15)
    }
  })

  it('gives every nation provinces it holds alone, to start with', () => {
    for (const w of worlds) {
      const seen = new Set<number>()
      for (const n of w.nations) {
        expect(n.provinces.size).toBeGreaterThanOrEqual(1)
        for (const id of n.provinces) {
          expect(seen.has(id)).toBe(false)
          seen.add(id)
        }
      }
      expect(w.validate()).toEqual([])
    }
  })
})

describe('growth over 3 worlds of 1000 x 1000', () => {
  // each world is its own copy of a fresh one, so the tests above and below do not share state
  const grown = SEEDS.map((seed) => {
    const w = World.create({ seed, config })
    const ticks = settle(w)
    return { w, ticks }
  })

  it('settles: every world reaches borders that no nation can move', () => {
    for (const { w, ticks } of grown) {
      expect(w.saturated, `seed ${w.seed} after ${ticks} ticks`).toBe(true)
      expect(ticks).toBeGreaterThan(1000) // growth takes years, not days
      expect(ticks).toBeLessThan(100_000) // and it ends
    }
  })

  it('has grown: the nations hold far more than they started with', () => {
    for (const { w } of grown) {
      const started = defaultWorldConfig.nations.startArea * w.nations.length
      const held = w.nations.reduce((n, nation) => n + nation.profile.area, 0)
      expect(held).toBeGreaterThan(started * 4)
    }
  })

  it('holds still once settled: more time changes no border, no stat, no point', () => {
    for (const { w } of grown) {
      const owners = Array.from(w.provinceOwner)
      const state = JSON.stringify(
        w.nations.map((n) => [[...n.provinces], n.expansionPoints, n.profile, n.stats])
      )
      const claims = w.expansionClaims
      w.run(2000)
      expect(Array.from(w.provinceOwner)).toEqual(owners)
      expect(
        JSON.stringify(
          w.nations.map((n) => [[...n.provinces], n.expansionPoints, n.profile, n.stats])
        )
      ).toBe(state)
      expect(w.expansionClaims).toBe(claims)
    }
  })

  it('stays consistent: provinces, ownership, profiles and stats all agree', () => {
    for (const { w } of grown) {
      expect(w.validate()).toEqual([])
      for (const n of w.nations) {
        expect(n.profile).toEqual(combineProfile(w.provinceFacts, n.provinces, n.profile.contacts))
        expect(n.stats).toEqual(deriveStats(n.profile))
      }
    }
  })

  it('keeps every nation in one piece, claim after claim', () => {
    for (const { w } of grown) {
      const p = w.provinces
      for (const n of w.nations) {
        const held = new Set<number>()
        for (const id of n.provinces) {
          if (held.size > 0) {
            const near = Array.from(
              p.neighbourId.subarray(p.neighbourStart[id], p.neighbourStart[id + 1])
            )
            expect(near.some((q) => held.has(q))).toBe(true)
          }
          held.add(id)
        }
      }
    }
  })

  it('leaves no free province beside a nation that could take it', () => {
    for (const { w } of grown) {
      const p = w.provinces
      for (const n of w.nations) {
        for (const held of n.provinces) {
          for (let k = p.neighbourStart[held]!; k < p.neighbourStart[held + 1]!; k += 1) {
            const next = p.neighbourId[k]!
            if (w.provinceOwner[next] === 255) expect(w.claimable[next]).toBe(0)
          }
        }
      }
    }
  })
})

describe('replay of a 1000 x 1000 world', () => {
  const TICKS = 4000

  it('gives the same hash twice, and the same after a save and a restore in the middle', () => {
    const a = World.create({ seed: SEEDS[0]!, config })
    const b = World.create({ seed: SEEDS[0]!, config })
    a.run(TICKS)
    b.run(TICKS / 2)
    const c = decodeWorld(encodeWorld(b))
    expect(c.stateHash()).toBe(b.stateHash())
    b.run(TICKS / 2)
    c.run(TICKS / 2)
    expect(b.stateHash()).toBe(a.stateHash())
    expect(c.stateHash()).toBe(a.stateHash())
    expect(a.expansionClaims).toBeGreaterThan(0)
  })
})
