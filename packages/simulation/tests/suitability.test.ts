import { BIOME_INDEX, ResourceType, type BiomeKey, type ResourceSlots } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import {
  BIOME_DESIRABILITY,
  SITE_ACCESS_WEIGHT,
  SITE_COAST_BONUS,
  SITE_RIVER_BONUS,
  siteScoreGrid
} from '../src/terrain/suitability'

const W = 40
const H = 24
const CELL = 4

function slots(): ResourceSlots {
  const slot = (): ResourceSlots['surface'] => ({
    type: new Uint8Array(W * H),
    richness: new Uint8Array(W * H),
    stock: new Uint8Array(W * H)
  })
  return { surface: slot(), ground: slot() }
}

interface World {
  biome?: (x: number, y: number) => BiomeKey
  river?: (x: number, y: number) => boolean
  water?: (x: number, y: number) => boolean
  resources?: ResourceSlots
}

function score(w: World = {}) {
  const elevation = new Float32Array(W * H)
  const biomeIds = new Uint8Array(W * H)
  const riverMask = new Uint8Array(W * H)
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x
      elevation[i] = w.water?.(x, y) ? 0.1 : 0.5
      biomeIds[i] = BIOME_INDEX[w.biome ? w.biome(x, y) : 'grassland']
      riverMask[i] = w.river?.(x, y) ? 1 : 0
    }
  }
  return siteScoreGrid({
    width: W,
    height: H,
    cell: CELL,
    seaLevel: 0.37,
    elevation,
    biomeIds,
    riverMask,
    resources: w.resources ?? slots()
  })
}

const MAX = 1 + SITE_RIVER_BONUS + SITE_ACCESS_WEIGHT + SITE_COAST_BONUS

describe('siteScoreGrid', () => {
  it('has one score per cell', () => {
    const grid = score()
    expect(grid.cols).toBe(10)
    expect(grid.rows).toBe(6)
    expect(grid.score).toHaveLength(60)
  })

  it('scores a plain meadow by its biome alone, scaled to 0 to 1', () => {
    expect(score().score[0]).toBeCloseTo(BIOME_DESIRABILITY.grassland / MAX, 6)
  })

  it('likes better biomes more: grassland over woodland over steppe over desert-edge badlands', () => {
    const by = (biome: BiomeKey): number => score({ biome: () => biome }).score[0] as number
    expect(by('grassland')).toBeGreaterThan(by('woodland'))
    expect(by('woodland')).toBeGreaterThan(by('steppe'))
    expect(by('steppe')).toBeGreaterThan(by('badlands'))
  })

  it('scores places nobody can live as 0: sea, mountains, deserts, ice', () => {
    for (const biome of [
      'desert',
      'mountain',
      'alpine',
      'glacier',
      'polar_desert',
      'tundra',
      'ocean'
    ] as BiomeKey[]) {
      expect(score({ biome: () => biome }).score[0], biome).toBe(0)
    }
    expect(score({ water: () => true }).score[0]).toBe(0)
  })

  it('settles poor biomes a little, down to badlands, but not below', () => {
    expect(score({ biome: () => 'badlands' }).score[0]).toBeGreaterThan(0)
    expect(score({ biome: () => 'temperate_desert' }).score[0]).toBeGreaterThan(0)
  })

  it('treats ground exactly at sea level as sea', () => {
    const level = 0.375 // exact in float32
    const n = W * H
    const grid = siteScoreGrid({
      width: W,
      height: H,
      cell: CELL,
      seaLevel: level,
      elevation: new Float32Array(n).fill(level),
      biomeIds: new Uint8Array(n).fill(BIOME_INDEX.grassland),
      riverMask: new Uint8Array(n),
      resources: slots()
    })
    for (const v of grid.score) expect(v).toBe(0)
  })

  it('scores a marginal biome (desirability under 0.1) as 0', () => {
    for (const biome of Object.keys(BIOME_DESIRABILITY) as BiomeKey[]) {
      const d = BIOME_DESIRABILITY[biome]
      if (d < 0.1) expect(score({ biome: () => biome }).score[0], biome).toBe(0)
    }
  })

  it('adds a bonus for a river anywhere in the cell', () => {
    const river = score({ river: (x, y) => x === 1 && y === 2 }) // inside cell 0
    expect(river.score[0]).toBeCloseTo((BIOME_DESIRABILITY.grassland + SITE_RIVER_BONUS) / MAX, 6)
    expect(river.score[1]).toBeCloseTo(BIOME_DESIRABILITY.grassland / MAX, 6) // the next cell has none
  })

  it('adds a bonus for the sea within a cell of it (a port), and none farther out', () => {
    // water in the first cell column (x 0 to 3); cells 1 is beside it, cell 3 is two cells farther on
    const grid = score({ water: (x) => x < 4 })
    const at = (cx: number): number => grid.score[3 * grid.cols + cx] as number
    const plain = BIOME_DESIRABILITY.grassland / MAX
    expect(at(1)).toBeCloseTo((BIOME_DESIRABILITY.grassland + SITE_COAST_BONUS) / MAX, 6)
    expect(at(2)).toBeCloseTo(plain, 6) // two cells from the water
    expect(at(5)).toBeCloseTo(plain, 6)
  })

  it('looks one cell out in every direction for the sea', () => {
    const edges: Array<[string, (x: number, y: number) => boolean]> = [
      ['east', (x, y) => x >= 24 && x < 28 && y >= 8 && y < 12],
      ['north', (x, y) => x >= 20 && x < 24 && y >= 4 && y < 8],
      ['south', (x, y) => x >= 20 && x < 24 && y >= 12 && y < 16],
      ['west', (x, y) => x >= 16 && x < 20 && y >= 8 && y < 12]
    ]
    for (const [name, water] of edges) {
      const grid = score({ water })
      // the land cell at x 20 to 23, y 8 to 11 is cell (5, 2)
      expect(grid.score[2 * grid.cols + 5], name).toBeCloseTo(
        (BIOME_DESIRABILITY.grassland + SITE_COAST_BONUS) / MAX,
        6
      )
    }
  })

  it('adds the resource access around the cell centre, up to its weight', () => {
    const resources = slots()
    // fill a large area with grain, timber and stone: full access
    for (let i = 0; i < W * H; i += 1) {
      resources.surface.type[i] = i % 2 === 0 ? ResourceType.Grain : ResourceType.Timber
      resources.ground.type[i] = ResourceType.Stone
    }
    const rich = score({ resources })
    expect(rich.score[0]).toBeCloseTo((BIOME_DESIRABILITY.grassland + SITE_ACCESS_WEIGHT) / MAX, 5)
    const poor = score()
    expect(rich.score[0]).toBeGreaterThan(poor.score[0] as number)
  })

  it('reaches 1 only for the best biome with a river and every resource', () => {
    const resources = slots()
    for (let i = 0; i < W * H; i += 1) {
      resources.surface.type[i] = i % 2 === 0 ? ResourceType.Grain : ResourceType.Timber
      resources.ground.type[i] = ResourceType.Stone
    }
    const best = score({ river: () => true, resources })
    // (no coast in this world, so the best a meadow can reach is a little short of 1)
    expect(best.score[0]).toBeCloseTo((1 + SITE_RIVER_BONUS + SITE_ACCESS_WEIGHT) / MAX, 5)
    for (const v of best.score) expect(v).toBeLessThanOrEqual(1 + 1e-6)
  })

  it('reads a cell from its centre tile: a cell that is mostly water but has land at the centre', () => {
    const grid = score({ water: (x, y) => x < 4 && y < 4 && !(x === 2 && y === 2) })
    expect(grid.score[0]).toBeGreaterThan(0)
    const sea = score({ water: (x, y) => x < 4 && y < 4 && !(x === 0 && y === 0) })
    expect(sea.score[0]).toBe(0)
  })
})
