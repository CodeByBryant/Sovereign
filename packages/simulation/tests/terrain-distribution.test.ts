import { defaultWorldConfig } from '@sovereign/config'
import { BIOME_INDEX } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { generateTerrain } from '../src/terrain/pipeline'
import { smallTerrainRequest } from './support/terrainRequest'

// The default profiles promise a distribution that holds on every seed, because the fields are
// reshaped by rank. These tests hold the pipeline to that promise on test-sized worlds (400 x 300 =
// 120 000 tiles, so a share is exact to a few tenths of a percent).

const SEEDS = [1, 2, 3, 42, 31337]
const SEA = defaultWorldConfig.map.seaLevel
const sized = { width: 400, height: 300 }
const tiles = 400 * 300

const share = (
  values: ArrayLike<number>,
  predicate: (v: number) => boolean,
  over?: Uint8Array
): number => {
  let n = 0
  let total = 0
  for (let i = 0; i < values.length; i += 1) {
    if (over !== undefined && over[i] === 0) continue
    total += 1
    if (predicate(values[i])) n += 1
  }
  return n / total
}

describe.each(SEEDS)('terrain distribution, seed %d', (seed) => {
  const fields = generateTerrain(smallTerrainRequest(seed, sized))
  const land = new Uint8Array(tiles)
  for (let i = 0; i < tiles; i += 1) land[i] = fields.elevation[i] > fields.seaLevel ? 1 : 0

  it('keeps the configured sea level: the land-ratio rescue never has to fire', () => {
    expect(fields.seaLevel).toBe(SEA)
  })

  it('has exactly the ocean the profile pins: 19% deep, 55.5% ocean, 3% shore, 22.5% inland', () => {
    const count = (key: keyof typeof BIOME_INDEX): number =>
      share(fields.biomeIds, (id) => id === BIOME_INDEX[key])
    expect(count('deep_ocean')).toBeCloseTo(0.19, 2)
    expect(count('ocean')).toBeCloseTo(0.555, 2)
    expect(count('shore')).toBeCloseTo(0.03, 2)
    expect(share(land, (v) => v === 1)).toBeCloseTo(0.255, 2)
  })

  it('puts 14% of land in the highlands or above, 7.5% above alpine and 4% in mountains', () => {
    const e = fields.elevation
    expect(share(e, (v) => v > 0.74, land)).toBeCloseTo(0.14, 2)
    expect(share(e, (v) => v > 0.78, land)).toBeCloseTo(0.075, 2)
    expect(share(e, (v) => v > 0.85, land)).toBeCloseTo(0.04, 2)
  })

  it('spreads land temperature across the bands the profile describes', () => {
    const t = fields.temperature
    expect(share(t, (v) => v < 0.2, land)).toBeCloseTo(0.2, 1)
    expect(share(t, (v) => v < 0.4, land)).toBeCloseTo(0.4, 1)
    expect(share(t, (v) => v < 0.7, land)).toBeCloseTo(0.76, 1)
  })

  it('spreads land humidity over the profile, a little wetter beside rivers', () => {
    // The profile puts half of land below 0.5; the river boost (+0.18 within 3 tiles of a river)
    // then lifts the land beside rivers, so slightly fewer tiles end below 0.5, and none above 1.
    const h = fields.humidity
    const below = share(h, (v) => v < 0.5, land)
    expect(below).toBeGreaterThan(0.3)
    expect(below).toBeLessThanOrEqual(0.5)
    let min = 1
    let max = 0
    for (let i = 0; i < tiles; i += 1) {
      if (land[i] === 0) continue
      min = Math.min(min, h[i])
      max = Math.max(max, h[i])
    }
    expect(min).toBeGreaterThanOrEqual(0.02 - 1e-6)
    expect(max).toBeLessThanOrEqual(1)
  })
})

describe('terrain distribution, other cases', () => {
  it('keeps every seed at the same land amount, however its noise falls', () => {
    const lands = SEEDS.map((seed) => {
      const f = generateTerrain(smallTerrainRequest(seed, sized))
      return share(f.elevation, (v) => v > f.seaLevel)
    })
    expect(Math.max(...lands) - Math.min(...lands)).toBeLessThan(0.002)
  })

  it('keeps the same land amount in island mode, with the edges still ocean', () => {
    const f = generateTerrain(smallTerrainRequest(5, { ...sized, islandMode: true }))
    expect(share(f.elevation, (v) => v > f.seaLevel)).toBeCloseTo(0.255, 2)
    for (const index of [0, 399, 299 * 400, tiles - 1]) {
      expect(f.elevation[index]).toBeLessThan(f.seaLevel)
    }
  })

  it('still lowers the sea level to meet minLandRatio when a custom sea level leaves too little land', () => {
    const f = generateTerrain(
      smallTerrainRequest(5, { ...sized, seaLevel: 0.95, minLandRatio: 0.3 })
    )
    expect(f.seaLevel).toBeLessThan(0.95)
    expect(share(f.elevation, (v) => v > f.seaLevel)).toBeGreaterThanOrEqual(0.3 - 0.01)
  })

  it('moves the ocean with the sea level, the profile being absolute: a lower sea means more land', () => {
    const f = generateTerrain(smallTerrainRequest(5, { ...sized, seaLevel: 0.3 }))
    expect(share(f.elevation, (v) => v > f.seaLevel)).toBeGreaterThan(0.3)
  })

  it('is reproducible: the same request gives the same fields', () => {
    const a = generateTerrain(smallTerrainRequest(8, sized))
    const b = generateTerrain(smallTerrainRequest(8, sized))
    expect(b.elevation).toEqual(a.elevation)
    expect(b.temperature).toEqual(a.temperature)
    expect(b.humidity).toEqual(a.humidity)
    expect(b.biomeIds).toEqual(a.biomeIds)
  })
})
