// A guard against the terrain quietly losing a biome or its balance. A probe found, once, that four of
// the 26 biomes never generated (no mountains, no glacier) and that the ocean amount depended on the
// seed. This generates three mid-size worlds and holds them to the design: all 26 biomes present,
// the ocean exactly what the profile pins, and every biome within a wide band of its target share.
// The bands are wide on purpose (a few worlds at this size vary); the full 10-world, 2000 x 2000
// measurement is `pnpm probe -- tests/probe/biome-coverage.probe.ts`.
import { BIOME_KEYS, type BiomeKey } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { World } from '../../src/world/World'

const SEEDS = [101, 202, 303]
const SIDE = 1000

/** Target share of INLAND land (land that is not shore), in percent: the design table in docs/terrain.md. */
const TARGET: Record<string, number> = {
  mountain: 4,
  alpine: 3,
  highland: 7,
  glacier: 0.5,
  polar_desert: 2,
  tundra: 7,
  taiga: 7,
  boreal_forest: 7,
  cold_steppe: 3,
  swamp: 1.5,
  temperate_desert: 2.5,
  steppe: 6,
  grassland: 9,
  woodland: 7.5,
  temperate_forest: 7.5,
  wetland: 1.5,
  desert: 6,
  badlands: 2.5,
  savanna: 5,
  chaparral: 3,
  tropical_forest: 4,
  rainforest: 3,
  mangrove: 0.5
}

describe(`biome coverage over ${SEEDS.length} worlds of ${SIDE} x ${SIDE}`, () => {
  const counts = new Array<number>(BIOME_KEYS.length).fill(0)
  const perWorld: number[][] = []
  let tiles = 0
  for (const seed of SEEDS) {
    const world = World.create({ seed, config: { map: { width: SIDE, height: SIDE } } })
    const own = new Array<number>(BIOME_KEYS.length).fill(0)
    for (const id of world.terrain.biomeIds) own[id] += 1
    perWorld.push(own)
    own.forEach((n, i) => (counts[i] += n))
    tiles += world.terrain.biomeIds.length
  }
  const index = (key: BiomeKey): number => BIOME_KEYS.indexOf(key)
  const water = counts[index('deep_ocean')] + counts[index('ocean')]
  const inland = tiles - water - counts[index('shore')]

  it('generates all 26 biomes', () => {
    expect(BIOME_KEYS.filter((key) => counts[index(key)] === 0)).toEqual([])
  })

  it('keeps the ocean exactly as the elevation profile pins it, on every seed', () => {
    for (const own of perWorld) {
      const total = SIDE * SIDE
      expect(own[index('deep_ocean')] / total).toBeCloseTo(0.19, 3)
      expect(own[index('ocean')] / total).toBeCloseTo(0.555, 3)
      expect(own[index('shore')] / total).toBeCloseTo(0.03, 3)
    }
  })

  it('keeps each biome within a wide band of its target share of inland land', () => {
    const off: string[] = []
    for (const [key, target] of Object.entries(TARGET)) {
      const percent = (100 * counts[index(key as BiomeKey)]) / inland
      if (percent < target / 4 || percent > target * 4) {
        off.push(`${key}: ${percent.toFixed(2)}% (target ${target}%)`)
      }
    }
    expect(off).toEqual([])
  })

  it('has the elevated land the profile promises: about 4% mountain and 14% highland or above', () => {
    const elevated = counts[index('mountain')] + counts[index('alpine')] + counts[index('highland')]
    expect((100 * counts[index('mountain')]) / inland).toBeGreaterThan(3)
    expect((100 * counts[index('mountain')]) / inland).toBeLessThan(6)
    expect((100 * elevated) / inland).toBeGreaterThan(11)
    expect((100 * elevated) / inland).toBeLessThan(17)
  })
})
