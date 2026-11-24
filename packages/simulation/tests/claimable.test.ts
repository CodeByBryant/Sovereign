import { BIOME_INDEX } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import { claimableProvinces } from '../src/nations/claimable'
import { buildProvinces } from '../src/terrain/provinces'

/** A strip of 4 provinces of 10 tiles, with the biome of each tile chosen by `biome(x)`. */
function strip(biome: (x: number) => number): { claimable: Uint8Array; count: number } {
  const width = 40
  const land = new Uint8Array(width).fill(1)
  const cost = new Float32Array(width).fill(1)
  const map = buildProvinces({
    width,
    height: 1,
    land,
    cost,
    spacing: 10,
    minArea: 1,
    seeds: [5, 15, 25, 35]
  })
  const biomeIds = new Uint8Array(width)
  for (let x = 0; x < width; x += 1) biomeIds[x] = biome(x)
  return { claimable: claimableProvinces(map, biomeIds), count: map.count }
}

describe('claimableProvinces: which provinces can belong to a nation', () => {
  it('allows ordinary land', () => {
    const { claimable, count } = strip(() => BIOME_INDEX.grassland)
    expect(Array.from(claimable)).toEqual(new Array(count).fill(1))
  })

  it('refuses a province that is all glacier or all polar desert', () => {
    const { claimable } = strip((x) =>
      x < 10 ? BIOME_INDEX.glacier : x < 20 ? BIOME_INDEX.polar_desert : BIOME_INDEX.tundra
    )
    expect(Array.from(claimable)).toEqual([0, 0, 1, 1])
  })

  it('refuses a province that is mostly ice, and allows one that is half ice', () => {
    // province 0 (tiles 0 to 9, a tile or so either way at its edge): 8 of 10 icy, province 1: 5 of 10
    const { claimable } = strip((x) =>
      x < 8 || (x >= 10 && x < 15) ? BIOME_INDEX.glacier : BIOME_INDEX.grassland
    )
    expect(claimable[0]).toBe(0)
    expect(claimable[1]).toBe(1)
  })

  it('allows a province that is exactly half ice and refuses one with a single tile more', () => {
    // seeds at 4 and 15 on a strip of 20 split it exactly: tiles 0 to 9 and 10 to 19
    const width = 20
    const land = new Uint8Array(width).fill(1)
    const cost = new Float32Array(width).fill(1)
    const map = buildProvinces({
      width,
      height: 1,
      land,
      cost,
      spacing: 10,
      minArea: 1,
      seeds: [4, 15]
    })
    expect(Array.from(map.area)).toEqual([10, 10])
    const iceUpTo = (n: number): Uint8Array => {
      const biomes = new Uint8Array(width).fill(BIOME_INDEX.grassland)
      for (let x = 0; x < n; x += 1) biomes[x] = BIOME_INDEX.glacier
      return biomes
    }
    expect(claimableProvinces(map, iceUpTo(5))[0]).toBe(1)
    expect(claimableProvinces(map, iceUpTo(6))[0]).toBe(0)
  })

  it('refuses a province of odd area when more than half of it is ice', () => {
    // a strip of 21: tiles 0 to 9, and 10 to 20 (11 tiles); six icy tiles of the 11 are more than half
    const width = 21
    const land = new Uint8Array(width).fill(1)
    const cost = new Float32Array(width).fill(1)
    const map = buildProvinces({
      width,
      height: 1,
      land,
      cost,
      spacing: 10,
      minArea: 1,
      seeds: [4, 15]
    })
    expect(Array.from(map.area)).toEqual([10, 11])
    const biomes = new Uint8Array(width).fill(BIOME_INDEX.grassland)
    for (let x = 10; x < 16; x += 1) biomes[x] = BIOME_INDEX.glacier
    expect(claimableProvinces(map, biomes)[1]).toBe(0)
    biomes[15] = BIOME_INDEX.grassland // five of 11
    expect(claimableProvinces(map, biomes)[1]).toBe(1)
  })

  it('is a province-by-province answer: one icy tile does not spoil a province', () => {
    const { claimable } = strip((x) => (x === 3 ? BIOME_INDEX.glacier : BIOME_INDEX.grassland))
    expect(claimable[0]).toBe(1)
  })
})
