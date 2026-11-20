import { defaultWorldConfig } from '@sovereign/config'
import { BIOME_INDEX, type ResourceSlots, type StrategicType } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { buildStrategicNetwork, type StrategicInput } from '../src/terrain/strategic'

const W = 120
const H = 80
const SEA = 0.37

function noResources(): ResourceSlots {
  const slot = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(W * H),
    richness: new Uint8Array(W * H),
    stock: new Uint8Array(W * H)
  })
  return { surface: slot(), ground: slot() }
}

interface World {
  elevation?: (x: number, y: number) => number
  river?: (x: number, y: number) => number
  biome?: (x: number, y: number) => number
}

function input(w: World = {}): StrategicInput {
  const n = W * H
  const elevation = new Float32Array(n)
  const biomeIds = new Uint8Array(n)
  const riverMask = new Uint8Array(n)
  const riverWidth = new Uint8Array(n)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x
      elevation[i] = w.elevation ? w.elevation(x, y) : 0.5
      biomeIds[i] = w.biome ? w.biome(x, y) : BIOME_INDEX.grassland
      const r = w.river ? w.river(x, y) : 0
      riverWidth[i] = r
      riverMask[i] = r > 0 ? 1 : 0
    }
  }
  return {
    width: W,
    height: H,
    seaLevel: SEA,
    elevation,
    biomeIds,
    riverMask,
    riverWidth,
    resources: noResources(),
    highlandElevation: defaultWorldConfig.biomes.highlandElevation,
    slopeScale: 0.006,
    routes: { ...defaultWorldConfig.routes, hubSpacing: 32 },
    strategic: defaultWorldConfig.strategic
  }
}

const near = (
  points: Array<{ x: number; y: number; type: StrategicType }>,
  type: StrategicType,
  x: number,
  y: number,
  r: number
): boolean =>
  points.some((p) => p.type === type && Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r)

describe('buildStrategicNetwork: a world with nothing in the way', () => {
  const net = buildStrategicNetwork(input())

  it('has hubs on the land, spaced apart, and routes joining neighbours', () => {
    expect(net.hubs.length).toBeGreaterThan(3)
    for (const hub of net.hubs) {
      expect(hub.x).toBeGreaterThanOrEqual(0)
      expect(hub.x).toBeLessThan(W)
      expect(hub.y).toBeGreaterThanOrEqual(0)
      expect(hub.y).toBeLessThan(H)
      expect(hub.weight).toBeGreaterThan(0)
      expect(hub.weight).toBeLessThanOrEqual(1)
    }
    for (let i = 0; i < net.hubs.length; i += 1) {
      for (let j = i + 1; j < net.hubs.length; j += 1) {
        const d = Math.hypot(net.hubs[i].x - net.hubs[j].x, net.hubs[i].y - net.hubs[j].y)
        expect(d).toBeGreaterThanOrEqual(28) // the 32 tile spacing, less what snapping to a tile can move a hub
      }
    }
    expect(net.routes.length).toBeGreaterThanOrEqual(net.hubs.length - 1)
  })

  it('draws every route from one hub to another as in-bounds x, y pairs', () => {
    for (const route of net.routes) {
      expect(route.from).toBeLessThan(route.to)
      expect(route.to).toBeLessThan(net.hubs.length)
      expect(route.path.length % 2).toBe(0)
      expect(route.path.length).toBeGreaterThanOrEqual(4)
      expect(route.cost).toBeGreaterThan(0)
      expect(route.traffic).toBeGreaterThan(0)
      for (let k = 0; k < route.path.length; k += 2) {
        expect(route.path[k]).toBeGreaterThanOrEqual(0)
        expect(route.path[k]).toBeLessThan(W)
        expect(route.path[k + 1]).toBeGreaterThanOrEqual(0)
        expect(route.path[k + 1]).toBeLessThan(H)
      }
    }
  })

  it('has no strategic points on open flat land', () => {
    expect(net.points).toEqual([])
  })

  it('is the same twice', () => {
    expect(buildStrategicNetwork(input())).toEqual(net)
  })
})

/**
 * Hills (0.6) with a ridge across the middle (x 52 to 68, 0.08 higher) that has a low saddle at y 36 to 44
 * (0.03 higher): smooth, as real hills are, and gentle enough that its steepness is not at the cost cap.
 */
const ridge = (x: number, y: number): number => {
  const bump = Math.max(0, 1 - Math.abs(x - 60) / 8)
  const peak = y >= 36 && y <= 44 ? 0.03 : 0.08
  return 0.6 + peak * bump
}

describe('buildStrategicNetwork: a ridge with a saddle', () => {
  const net = buildStrategicNetwork(input({ elevation: ridge }))

  it('puts a mountain pass in the saddle', () => {
    expect(near(net.points, 'mountain_pass', 60, 40, 10)).toBe(true)
  })

  it('sends the routes that cross the ridge near the saddle through it, not over the top', () => {
    const across = net.routes.filter((r) => {
      const xs: number[] = []
      for (let k = 0; k < r.path.length; k += 2) xs.push(r.path[k])
      const y0 = r.path[1]
      const y1 = r.path[r.path.length - 1]
      return (
        Math.min(...xs) < 52 && Math.max(...xs) > 68 && y0 >= 24 && y0 <= 52 && y1 >= 24 && y1 <= 52
      )
    })
    expect(across.length).toBeGreaterThan(0)
    for (const r of across) {
      for (let k = 0; k < r.path.length; k += 2) {
        if (r.path[k] >= 52 && r.path[k] <= 68) {
          expect(r.path[k + 1]).toBeGreaterThanOrEqual(32)
          expect(r.path[k + 1]).toBeLessThanOrEqual(48)
        }
      }
    }
  })
})

describe('buildStrategicNetwork: a river with one narrow place', () => {
  // a river at x 59 to 60: three tiles wide everywhere except a one tile ford around y 30
  const river = (x: number, y: number): number => {
    if (x < 58 || x > 61) return 0
    return y >= 28 && y <= 32 ? 1 : 3
  }
  const net = buildStrategicNetwork(input({ river }))

  it('puts the ford at the narrow place, on a one tile wide river tile', () => {
    const fords = net.points.filter((p) => p.type === 'river_crossing')
    expect(fords.length).toBeGreaterThan(0)
    const input2 = input({ river })
    for (const f of fords) expect(input2.riverWidth[f.y * W + f.x]).toBeGreaterThan(0)
    // the ford by the narrow place is on its narrowest (one tile wide) river tile
    const byTheNarrowPlace = fords.filter((f) => Math.abs(f.x - 60) <= 8 && Math.abs(f.y - 30) <= 8)
    expect(byTheNarrowPlace.length).toBeGreaterThan(0)
    for (const f of byTheNarrowPlace) expect(input2.riverWidth[f.y * W + f.x]).toBe(1)
    expect(near(net.points, 'river_crossing', 60, 30, 8)).toBe(true)
  })

  it('does not put a ford on every tile of the river', () => {
    expect(net.points.filter((p) => p.type === 'river_crossing').length).toBeLessThan(6)
  })
})

describe('buildStrategicNetwork: a strait between two shores', () => {
  // land to the west and east, a 20 tile strait of sea in between
  const strait = (x: number): number => (x >= 50 && x < 70 ? 0.1 : 0.5)
  const net = buildStrategicNetwork(input({ elevation: (x) => strait(x) }))

  it('joins the two landmasses with a route over the water', () => {
    const over = net.routes.filter((r) => {
      let west = false
      let east = false
      for (let k = 0; k < r.path.length; k += 2) {
        if (r.path[k] < 50) west = true
        if (r.path[k] >= 70) east = true
      }
      return west && east
    })
    expect(over.length).toBeGreaterThan(0)
  })

  it('puts a strait point in the water between them', () => {
    const straits = net.points.filter((p) => p.type === 'strait')
    expect(straits.length).toBeGreaterThan(0)
    for (const s of straits) {
      expect(s.x).toBeGreaterThanOrEqual(50)
      expect(s.x).toBeLessThan(70)
    }
  })
})

describe('buildStrategicNetwork: a neck of land', () => {
  // two large lands joined by a narrow neck 8 tiles wide; sea everywhere else
  const land = (x: number, y: number): boolean =>
    (x >= 5 && x < 45 && y >= 10 && y < 70) ||
    (x >= 75 && x < 115 && y >= 10 && y < 70) ||
    (x >= 45 && x < 75 && y >= 36 && y < 44)
  // the neck is too dry to settle, so hubs are on the two lands and the routes cross the neck
  const net = buildStrategicNetwork(
    input({
      elevation: (x, y) => (land(x, y) ? 0.5 : 0.1),
      biome: (x) => (x >= 45 && x < 75 ? BIOME_INDEX.desert : BIOME_INDEX.grassland)
    })
  )

  it('puts a land neck in the narrow part', () => {
    const necks = net.points.filter((p) => p.type === 'isthmus')
    expect(necks.length).toBeGreaterThan(0)
    for (const n of necks) {
      expect(n.x).toBeGreaterThanOrEqual(40)
      expect(n.x).toBeLessThanOrEqual(80)
    }
  })

  it('has hubs only on land', () => {
    for (const hub of net.hubs) expect(land(hub.x, hub.y)).toBe(true)
  })
})

describe('buildStrategicNetwork: values', () => {
  it('rates every point from 1 to 10, and keeps points of one kind apart', () => {
    const net = buildStrategicNetwork(input({ elevation: ridge }))
    expect(net.points.length).toBeGreaterThan(0)
    for (const p of net.points) {
      expect(Number.isInteger(p.value)).toBe(true)
      expect(p.value).toBeGreaterThanOrEqual(1)
      expect(p.value).toBeLessThanOrEqual(10)
    }
    const radius = defaultWorldConfig.strategic.mergeRadius * defaultWorldConfig.routes.cell
    for (let i = 0; i < net.points.length; i += 1) {
      for (let j = i + 1; j < net.points.length; j += 1) {
        if (net.points[i].type !== net.points[j].type) continue
        const d = Math.max(
          Math.abs(net.points[i].x - net.points[j].x),
          Math.abs(net.points[i].y - net.points[j].y)
        )
        expect(d).toBeGreaterThan(radius - defaultWorldConfig.routes.cell)
      }
    }
  })

  it('rates the passes of busy routes well above the bottom of the scale', () => {
    const net = buildStrategicNetwork(input({ elevation: ridge }))
    expect(Math.max(...net.points.map((p) => p.value))).toBeGreaterThanOrEqual(5)
  })

  it('drops the points of quiet routes when minTraffic is raised', () => {
    const all = buildStrategicNetwork(input({ elevation: ridge }))
    const busy = buildStrategicNetwork({
      ...input({ elevation: ridge }),
      strategic: { ...defaultWorldConfig.strategic, minTraffic: 0.9 }
    })
    expect(busy.points.length).toBeLessThan(all.points.length)
  })

  it('merges points of one kind closer than mergeRadius into the most valuable one', () => {
    const merged = buildStrategicNetwork({
      ...input({ elevation: ridge }),
      strategic: { ...defaultWorldConfig.strategic, mergeRadius: 60 }
    })
    const types = new Set(merged.points.map((p) => p.type))
    expect(merged.points).toHaveLength(types.size)
    const all = buildStrategicNetwork(input({ elevation: ridge }))
    const best = Math.max(...all.points.map((p) => p.value))
    expect(Math.max(...merged.points.map((p) => p.value))).toBe(best)
  })

  it('has nothing at all when there is nowhere to live', () => {
    const net = buildStrategicNetwork(input({ biome: () => BIOME_INDEX.desert }))
    expect(net).toEqual({ points: [], hubs: [], routes: [] })
  })
})
