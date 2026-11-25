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
  { name: 'seed 1', request: smallTerrainRequest(1), hash: 'bf1e951535b1a62f57af23fae28b0751' },
  {
    name: 'seed 12345',
    request: smallTerrainRequest(12345),
    hash: '0666bb31f1daf59e89117d81f6b9f8bd'
  },
  {
    name: 'text seed',
    request: smallTerrainRequest('sovereign'),
    hash: '31da575e9f3cdc11d7f05e2c0934d269'
  },
  {
    name: 'island mode',
    request: smallTerrainRequest(7, { islandMode: true }),
    hash: 'e429bb0ed8fb65401eb50c145b134bc2'
  },
  {
    name: 'optional config fields omitted (their defaults apply)',
    request: smallTerrainRequestWithDefaults(5),
    hash: '3cdad0bf07837ca672bef4e3d6fd4d3e'
  },
  {
    name: 'land-ratio rescue (sea level lowered)',
    request: smallTerrainRequest(3, { minLandRatio: 0.7 }),
    hash: '779d6d614c0b900d4f9015d71a65f0e8'
  }
]

describe('terrain goldens', () => {
  it.each(scenarios)('$name', ({ request, hash }) => {
    expect(hashTerrain(generateTerrain(request))).toBe(hash)
  })

  it('a text seed and the number it hashes to are the same world', async () => {
    const { normalizeSeed } = await import('../../src/random/seed')
    const asNumber = smallTerrainRequest(normalizeSeed('sovereign'))
    expect(hashTerrain(generateTerrain(asNumber))).toBe('31da575e9f3cdc11d7f05e2c0934d269')
  })
})
