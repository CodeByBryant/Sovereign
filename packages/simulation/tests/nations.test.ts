import { describe, expect, it } from 'vitest'
import { generateTerrain } from '../src/terrain/pipeline'
import { spawnNations } from '../src/nations/NationSpawner'
import type { Nation } from '../src/nations/Nation'
import { hashNations } from './support/nationHash'
import { smallTerrainRequest } from './support/terrainRequest'

// A 160x96 world at sea level 0.2 is roughly 40% land, enough room for several nations.
const request = smallTerrainRequest(2024, { seaLevel: 0.2 })
const terrain = generateTerrain(request)
const SPACING = 18

function spawn(seed: string | number, count: number): ReturnType<typeof spawnNations> {
  return spawnNations(
    terrain.elevation,
    terrain.biomeIds,
    terrain.riverMask,
    request.terrain,
    count,
    seed,
    SPACING
  )
}

/** Everything a nation consists of, in a form that compares by value. */
function plain(n: Nation): unknown {
  return {
    id: n.id,
    name: n.name,
    color: n.color,
    flag: n.flag,
    government: n.government,
    personality: n.personality,
    capital: n.capital,
    stats: n.stats,
    provinces: [...n.provinces]
  }
}

describe('spawnNations', () => {
  const { nations, ownerMap } = spawn(11, 8)

  it('spawns nations, no more than asked for', () => {
    expect(nations.length).toBeGreaterThan(2)
    expect(nations.length).toBeLessThanOrEqual(8)
  })

  it('puts every capital on land, at least the minimum spacing apart', () => {
    const w = terrain.width
    for (const n of nations) expect(terrain.elevation[n.capital]).toBeGreaterThan(terrain.seaLevel)
    for (let i = 0; i < nations.length; i += 1) {
      for (let j = i + 1; j < nations.length; j += 1) {
        const a = nations[i] as Nation
        const b = nations[j] as Nation
        const dx = (a.capital % w) - (b.capital % w)
        const dy = Math.floor(a.capital / w) - Math.floor(b.capital / w)
        expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(SPACING)
      }
    }
  })

  it('gives every nation a unique id, a unique name and a distinct colour', () => {
    expect(new Set(nations.map((n) => n.id)).size).toBe(nations.length)
    expect(new Set(nations.map((n) => n.name)).size).toBe(nations.length)
    expect(new Set(nations.map((n) => n.color.join(','))).size).toBe(nations.length)
  })

  it('keeps the owner map and the nations consistent, with no tile owned twice', () => {
    expect(ownerMap.length).toBe(terrain.width * terrain.height)
    let owned = 0
    for (const n of nations) {
      expect(n.provinces.size).toBeGreaterThan(0)
      expect(n.provinces.has(n.capital)).toBe(true)
      for (const tile of n.provinces) expect(ownerMap[tile]).toBe(n.id)
      owned += n.provinces.size
    }
    expect(ownerMap.filter((o) => o !== '').length).toBe(owned)
  })

  it('keeps personalities and stats in their documented ranges', () => {
    for (const n of nations) {
      for (const v of Object.values(n.personality)) {
        expect(v).toBeGreaterThanOrEqual(0.1)
        expect(v).toBeLessThanOrEqual(0.9)
      }
      expect(n.stats.population).toBeGreaterThanOrEqual(50)
      expect(n.stats.population).toBeLessThan(150)
      expect(n.stats.military).toBeGreaterThanOrEqual(50)
      expect(n.stats.military).toBeLessThan(100)
    }
  })

  it('is deterministic: the same seed and map give identical nations', () => {
    expect(spawn(11, 8).nations.map(plain)).toEqual(nations.map(plain))
    expect(spawn(11, 8).ownerMap).toEqual(ownerMap)
  })

  it('gives a different set of nations for a different seed', () => {
    const other = spawn(12, 8).nations
    expect(other.map((n) => n.name)).not.toEqual(nations.map((n) => n.name))
  })

  it('treats a numeric seed and its decimal text as the same world', () => {
    expect(spawn('11', 8).nations.map(plain)).toEqual(nations.map(plain))
  })

  it('does not let the number of nations change the ones already placed', () => {
    const few = spawn(11, 3).nations
    expect(few.map(plain)).toEqual(nations.slice(0, few.length).map(plain))
  })

  // A regression pin (see tests/determinism/terrain-golden.test.ts): any change to spawning moves it on purpose.
  it('matches its golden hash (seed 11, up to 8 nations on the 2024 world)', () => {
    expect(nations.length).toBe(8)
    expect(hashNations(nations)).toBe('17a4e5d137ca1f295e3dbac486cc9ce7')
  })
})
