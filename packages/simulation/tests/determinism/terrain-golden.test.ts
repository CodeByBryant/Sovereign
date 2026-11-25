// Golden hashes of every field of small worlds, produced by the deterministic engine (the
// engine's own simplex noise, named random streams and math). They are regression pins: the
// *correctness* of what is underneath them is established by the independent-reference tests of the
// RNG, the noise and the math. Any change to world generation moves these hashes on purpose, so
// regenerating them is a deliberate act with the reason in the commit message.
//
// To regenerate, print `hashTerrain(generateTerrain(request))` for each scenario below.
//
// The pins were regenerated when resources moved to two slots (placement rules, ADR 0005) and again when
// strategic points became a route network (ADR 0006).
//
// History: the pins before the deterministic-engine swap (alea + simplex-noise + Math.pow) were
// 1: c73f60d2..., 12345: 23986aef..., 'sovereign': 669f4deb..., island: 252d418c...,
// land-ratio: d4b62979..., defaults: f79b843d... (all intentionally superseded).
import { describe, expect, it } from 'vitest'
import { generateTerrain } from '../../src/terrain/pipeline'
import { hashTerrain } from '../support/fieldHash'
import { smallTerrainRequest, smallTerrainRequestWithDefaults } from '../support/terrainRequest'

const scenarios = [
  { name: 'seed 1', request: smallTerrainRequest(1), hash: '040a6dad1ebb4f1c363d800de138f73d' },
  {
    name: 'seed 12345',
    request: smallTerrainRequest(12345),
    hash: 'ccf4a8d0d7821bc53ce51426fd755093'
  },
  {
    name: 'text seed',
    request: smallTerrainRequest('sovereign'),
    hash: '1d773096f7463cc6ef4cad69b73e12d5'
  },
  {
    name: 'island mode',
    request: smallTerrainRequest(7, { islandMode: true }),
    hash: 'c62c03f13b29c8a2ec533a3ac86ac4d6'
  },
  {
    name: 'optional config fields omitted (their defaults apply)',
    request: smallTerrainRequestWithDefaults(5),
    hash: 'fc1b39affa1ee4bbe4b5ee4f672af4d8'
  },
  {
    name: 'land-ratio rescue (sea level lowered)',
    request: smallTerrainRequest(3, { minLandRatio: 0.7 }),
    hash: '11f4945ba6898c4d17b11e9a5acf817c'
  }
]

describe('terrain goldens', () => {
  it.each(scenarios)('$name', ({ request, hash }) => {
    expect(hashTerrain(generateTerrain(request))).toBe(hash)
  })

  it('a text seed and the number it hashes to are the same world', async () => {
    const { normalizeSeed } = await import('../../src/random/seed')
    const asNumber = smallTerrainRequest(normalizeSeed('sovereign'))
    expect(hashTerrain(generateTerrain(asNumber))).toBe('1d773096f7463cc6ef4cad69b73e12d5')
  })
})
