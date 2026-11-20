import { describe, expect, it } from 'vitest'
import { BIOME_KEYS } from '@sovereign/contracts'
import { generateTerrain } from '../src/terrain/pipeline'
import { hashTerrain } from './support/fieldHash'
import { smallTerrainRequest } from './support/terrainRequest'

describe('generateTerrain', () => {
  const request = smallTerrainRequest(2024)
  const fields = generateTerrain(request)
  const tiles = fields.width * fields.height

  it('returns one value per tile in every layer', () => {
    expect(fields.width).toBe(160)
    expect(fields.height).toBe(96)
    for (const layer of [
      fields.elevation,
      fields.temperature,
      fields.humidity,
      fields.biomeIds,
      fields.riverMask,
      fields.riverWidth,
      fields.resourceType,
      fields.resourceDensity
    ]) {
      expect(layer.length).toBe(tiles)
    }
  })

  it('keeps continuous fields in [0, 1] and discrete fields in their alphabets', () => {
    for (const layer of [fields.elevation, fields.temperature, fields.humidity]) {
      for (const v of layer) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
    for (const id of fields.biomeIds) expect(id).toBeLessThan(BIOME_KEYS.length)
    for (const r of fields.riverMask) expect([0, 1]).toContain(r)
    for (const t of fields.resourceType) expect(t).toBeLessThanOrEqual(7)
  })

  it('places every strategic point on the map', () => {
    expect(fields.strategicPoints.length).toBeGreaterThan(0)
    for (const p of fields.strategicPoints) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThan(fields.width)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThan(fields.height)
    }
  })

  it('is a pure function of its request: same request, identical result', () => {
    expect(hashTerrain(generateTerrain(request))).toBe(hashTerrain(fields))
  })

  it('does not mutate the request it is given', () => {
    const before = JSON.stringify(request)
    generateTerrain(request)
    expect(JSON.stringify(request)).toBe(before)
  })

  it('gives different worlds for different seeds', () => {
    expect(hashTerrain(generateTerrain(smallTerrainRequest(2025)))).not.toBe(hashTerrain(fields))
  })

  // At a sea level of 0.2 this world is about 42% land; at the default 0.37 it is all ocean.
  const lowSea = 0.2

  it('keeps the configured sea level when there is enough land', () => {
    const plenty = generateTerrain(
      smallTerrainRequest(2024, { seaLevel: lowSea, minLandRatio: 0.01 })
    )
    expect(plenty.seaLevel).toBe(lowSea)
  })

  it('lowers the sea level until the land-ratio target is met', () => {
    const wanted = 0.6
    const rescued = generateTerrain(smallTerrainRequest(2024, { minLandRatio: wanted }))
    expect(rescued.seaLevel).toBeLessThan(0.37)
    let land = 0
    for (const e of rescued.elevation) if (e > rescued.seaLevel) land += 1
    // The cut is estimated from every 4th tile, so allow a little slack.
    expect(land / tiles).toBeGreaterThan(wanted - 0.03)
  })

  it('does not lower the sea level when land is exactly at the target', () => {
    // Choose a ratio whose target equals the land this world actually has at sea level 0.2.
    const base = generateTerrain(
      smallTerrainRequest(2024, { seaLevel: lowSea, minLandRatio: 0.0001 })
    )
    let land = 0
    for (const e of base.elevation) if (e > base.seaLevel) land += 1
    const ratio = land / tiles
    expect(land).toBeGreaterThan(0)
    expect(Math.floor(tiles * ratio)).toBe(land) // the target is exactly the land we have
    const exact = generateTerrain(
      smallTerrainRequest(2024, { seaLevel: lowSea, minLandRatio: ratio })
    )
    expect(exact.seaLevel).toBe(lowSea)
  })

  it('counts a tile exactly at sea level as water, not land', () => {
    // Use a real elevation value as the sea level, so tiles tied with it exist by construction.
    const probe = generateTerrain(
      smallTerrainRequest(2024, { seaLevel: lowSea, minLandRatio: 0.0001 })
    )
    const level = probe.elevation[Math.floor(tiles / 2)] as number
    let above = 0
    let tied = 0
    for (const e of probe.elevation) {
      if (e > level) above += 1
      else if (e === level) tied += 1
    }
    expect(tied).toBeGreaterThan(0)
    // A target one tile above the strictly-land count can only be met if ties are NOT land.
    const target = above + 1
    const ratio = target / tiles
    expect(Math.floor(tiles * ratio)).toBe(target)
    const result = generateTerrain(
      smallTerrainRequest(2024, { seaLevel: level, minLandRatio: ratio })
    )
    expect(result.seaLevel).toBeLessThan(level)
  })
})
