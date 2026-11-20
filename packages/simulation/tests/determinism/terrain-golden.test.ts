// Golden hashes of every field of small worlds, produced by the deterministic engine (the
// engine's own simplex noise, named random streams and math). They are regression pins: the
// *correctness* of what is underneath them is established by the independent-reference tests of the
// RNG, the noise and the math. Any change to world generation moves these hashes on purpose, so
// regenerating them is a deliberate act with the reason in the commit message.
//
// To regenerate, print `hashTerrain(generateTerrain(request))` for each scenario below.
//
// The pins were regenerated again when resources moved to two slots (placement rules, ADR 0005).
//
// History: the pins before the deterministic-engine swap (alea + simplex-noise + Math.pow) were
// 1: c73f60d2..., 12345: 23986aef..., 'sovereign': 669f4deb..., island: 252d418c...,
// land-ratio: d4b62979..., defaults: f79b843d... (all intentionally superseded).
import { describe, expect, it } from 'vitest'
import { generateTerrain } from '../../src/terrain/pipeline'
import { hashTerrain } from '../support/fieldHash'
import { smallTerrainRequest, smallTerrainRequestWithDefaults } from '../support/terrainRequest'

const scenarios = [
  { name: 'seed 1', request: smallTerrainRequest(1), hash: '404b727a738885ca7960474334f0b3af' },
  {
    name: 'seed 12345',
    request: smallTerrainRequest(12345),
    hash: 'f71418e78636f4286b85e31a75860c7d'
  },
  {
    name: 'text seed',
    request: smallTerrainRequest('sovereign'),
    hash: 'e7ce60d8ed704906bd7ac47410eceff0'
  },
  {
    name: 'island mode',
    request: smallTerrainRequest(7, { islandMode: true }),
    hash: '49a17d367ad1d57cd0ba0ff193cacf7d'
  },
  {
    name: 'optional config fields omitted (their defaults apply)',
    request: smallTerrainRequestWithDefaults(5),
    hash: '9057b6a80e3db7ef82702e1b2b495493'
  },
  {
    name: 'land-ratio rescue (sea level lowered)',
    request: smallTerrainRequest(3, { minLandRatio: 0.7 }),
    hash: '9c8e17b2fef37ce666d6bb15c85228ab'
  }
]

describe('terrain goldens', () => {
  it.each(scenarios)('$name', ({ request, hash }) => {
    expect(hashTerrain(generateTerrain(request))).toBe(hash)
  })

  it('a text seed and the number it hashes to are the same world', async () => {
    const { normalizeSeed } = await import('../../src/random/seed')
    const asNumber = smallTerrainRequest(normalizeSeed('sovereign'))
    expect(hashTerrain(generateTerrain(asNumber))).toBe('e7ce60d8ed704906bd7ac47410eceff0')
  })
})
