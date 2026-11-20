import { defaultWorldConfig } from '@sovereign/config'
import { BIOME_INDEX } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { buildCostGrid, type CostInput } from '../src/terrain/cost'

const SEA = 0.37
const GRASS = BIOME_INDEX.grassland
const config = defaultWorldConfig.routes.cost

interface Options {
  width?: number
  height?: number
  cell?: number
  elevation?: (x: number, y: number) => number
  biome?: (x: number, y: number) => number
  riverWidth?: (x: number, y: number) => number
  cost?: Partial<typeof config>
  slopeScale?: number
  highland?: number
}

/** A world of flat grassland (elevation 0.5) unless an option says otherwise. */
function input(o: Options = {}): CostInput {
  const width = o.width ?? 32
  const height = o.height ?? 32
  const n = width * height
  const elevation = new Float32Array(n)
  const biomeIds = new Uint8Array(n)
  const riverMask = new Uint8Array(n)
  const riverWidth = new Uint8Array(n)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      elevation[i] = o.elevation ? o.elevation(x, y) : 0.5
      biomeIds[i] = o.biome ? o.biome(x, y) : GRASS
      const w = o.riverWidth ? o.riverWidth(x, y) : 0
      riverWidth[i] = w
      riverMask[i] = w > 0 ? 1 : 0
    }
  }
  return {
    width,
    height,
    seaLevel: SEA,
    elevation,
    biomeIds,
    riverMask,
    riverWidth,
    highlandElevation: o.highland ?? 0.74,
    slopeScale: o.slopeScale ?? 0.006,
    cell: o.cell ?? 4,
    config: { ...config, ...o.cost }
  }
}

const at = (grid: ReturnType<typeof buildCostGrid>, cx: number, cy: number): number =>
  grid.cost[cy * grid.cols + cx] as number

describe('buildCostGrid: shape', () => {
  it('has one cell per cell x cell block, rounding up at the edge', () => {
    const grid = buildCostGrid(input({ width: 30, height: 18, cell: 4 }))
    expect(grid.cols).toBe(8)
    expect(grid.rows).toBe(5)
    expect(grid.cost).toHaveLength(40)
    expect(grid.land).toHaveLength(40)
    expect(grid.cell).toBe(4)
  })

  it('costs the base on flat open ground, everywhere', () => {
    const grid = buildCostGrid(input())
    for (const c of grid.cost) expect(c).toBeCloseTo(config.base, 6)
    for (const l of grid.land) expect(l).toBe(1)
  })

  it('reads a cell as land when at least half its tiles are land', () => {
    // a 4 x 4 cell: 8 land tiles (x < 2) is land, 7 is sea
    const eight = buildCostGrid(
      input({ elevation: (x) => (x < 2 ? 0.5 : 0.1), width: 4, height: 4 })
    )
    expect(eight.land[0]).toBe(1)
    const seven = buildCostGrid(
      input({
        elevation: (x, y) => (x < 2 && !(x === 1 && y === 3) ? 0.5 : 0.1),
        width: 4,
        height: 4
      })
    )
    expect(seven.land[0]).toBe(0)
  })
})

describe('buildCostGrid: land', () => {
  it('adds the cost of the biome', () => {
    const grid = buildCostGrid(input({ biome: (x) => (x < 4 ? BIOME_INDEX.swamp : GRASS) }))
    expect(at(grid, 0, 0)).toBeCloseTo(config.base + config.biomes.swamp, 6)
    expect(at(grid, 1, 0)).toBeCloseTo(config.base + config.biomes.grassland, 6)
  })

  it('makes steeper ground cost more, up to a cap', () => {
    const slopeOf = (perTile: number) =>
      buildCostGrid(input({ elevation: (x) => 0.45 + perTile * x, highland: 5 }))
    const flat = at(slopeOf(0), 4, 4)
    const gentle = at(slopeOf(0.003), 4, 4)
    const steep = at(slopeOf(0.006), 4, 4)
    const cliff = at(slopeOf(0.012), 4, 4)
    const wall = at(slopeOf(0.024), 4, 4)
    expect(gentle).toBeGreaterThan(flat)
    expect(steep).toBeGreaterThan(gentle)
    expect(steep - flat).toBeCloseTo(config.slope, 1) // a slope of slopeScale costs `slope`
    expect(cliff).toBeGreaterThan(steep)
    expect(wall).toBeCloseTo(cliff, 3) // twice slopeScale is the cap
  })

  it('adds a cost for high ground above the highland line, none below it', () => {
    const grid = buildCostGrid(input({ elevation: (x) => (x < 16 ? 0.7 : 0.87), highland: 0.74 }))
    expect(at(grid, 1, 1)).toBeCloseTo(config.base, 6)
    const high = at(grid, 6, 1) - config.base
    expect(high).toBeCloseTo(config.height * ((0.87 - 0.74) / (1 - 0.74)), 2)
    // exactly at the line costs nothing
    const edge = buildCostGrid(input({ elevation: () => 0.74, highland: 0.74 }))
    expect(at(edge, 2, 2)).toBeCloseTo(config.base, 6)
  })

  it('charges for a river by its width, so narrow water is cheaper to cross', () => {
    const grid = buildCostGrid(
      input({ riverWidth: (x, y) => (y === 1 && x < 4 ? 1 : y === 1 && x >= 8 && x < 12 ? 3 : 0) })
    )
    expect(at(grid, 0, 0)).toBeCloseTo(config.base + config.river * 1, 6)
    expect(at(grid, 2, 0)).toBeCloseTo(config.base + config.river * 3, 6)
    expect(at(grid, 1, 0)).toBeCloseTo(config.base, 6) // no river in this cell
    expect(at(grid, 0, 1)).toBeCloseTo(config.base, 6)
  })

  it('takes the widest river in a cell', () => {
    const grid = buildCostGrid(
      input({ riverWidth: (x, y) => (x === 0 && y === 0 ? 1 : x === 3 && y === 3 ? 4 : 0) })
    )
    expect(at(grid, 0, 0)).toBeCloseTo(config.base + config.river * 4, 6)
  })

  it('averages the extra cost over the land tiles of a cell, not the water', () => {
    // 12 land tiles of swamp and 4 water tiles: the swamp cost is not diluted by the water
    const grid = buildCostGrid(
      input({
        width: 4,
        height: 4,
        elevation: (_x, y) => (y < 3 ? 0.5 : 0.1),
        slopeScale: 1e9,
        biome: () => BIOME_INDEX.swamp
      })
    )
    expect(grid.land[0]).toBe(1)
    expect(at(grid, 0, 0)).toBeCloseTo(config.base + config.biomes.swamp, 6)
  })

  it('averages a cell that is half grass and half swamp', () => {
    const grid = buildCostGrid(
      input({ width: 4, height: 4, biome: (x) => (x < 2 ? GRASS : BIOME_INDEX.swamp) })
    )
    expect(at(grid, 0, 0)).toBeCloseTo(config.base + config.biomes.swamp / 2, 6)
  })
})

describe('buildCostGrid: sea', () => {
  // land in the left 8 tiles, sea to the right: cells 0 and 1 are land, cells 2.. are sea
  const coast = (cost: Partial<typeof config> = {}, extra: Options = {}) =>
    buildCostGrid(
      input({ width: 64, height: 16, elevation: (x) => (x < 8 ? 0.5 : 0.1), cost, ...extra })
    )

  it('charges the sea cost for water within reach of land', () => {
    const grid = coast({ seaReach: 5 })
    expect(grid.land[2]).toBe(0)
    expect(at(grid, 2, 0)).toBeCloseTo(config.sea, 6)
    expect(at(grid, 6, 0)).toBeCloseTo(config.sea, 6) // 5 cells from the last land cell (1)
  })

  it('leaves water beyond the reach impassable', () => {
    const grid = coast({ seaReach: 5 })
    expect(at(grid, 7, 0)).toBe(Infinity)
    expect(at(grid, 15, 0)).toBe(Infinity)
  })

  it('has no reach at 0: every sea cell is impassable', () => {
    const grid = coast({ seaReach: 0 })
    expect(at(grid, 2, 0)).toBe(Infinity)
    expect(at(grid, 0, 0)).toBeCloseTo(config.base, 6)
  })

  it('measures the reach from the nearest land in any direction', () => {
    // an island of land in the middle of the sea
    const grid = buildCostGrid(
      input({
        width: 64,
        height: 64,
        elevation: (x, y) => (x >= 28 && x < 36 && y >= 28 && y < 36 ? 0.5 : 0.1),
        cost: { seaReach: 3 }
      })
    )
    // the island is cells 7 to 8 across and down; reach is counted in steps over cells (not diagonals)
    expect(at(grid, 7, 4)).toBeCloseTo(config.sea, 6) // 3 steps above the island
    expect(at(grid, 7, 3)).toBe(Infinity) // 4 steps
    expect(at(grid, 4, 7)).toBeCloseTo(config.sea, 6) // 3 steps to its west
    expect(at(grid, 12, 8)).toBe(Infinity)
    expect(at(grid, 5, 6)).toBeCloseTo(config.sea, 6) // 2 + 1 = 3 steps
    expect(at(grid, 5, 5)).toBe(Infinity) // 2 + 2 = 4 steps
  })
})
