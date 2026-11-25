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
  { name: 'seed 1', request: smallTerrainRequest(1), hash: '081075beb270d4f20a6ff4d396b1ecc1' },
  {
    name: 'seed 12345',
    request: smallTerrainRequest(12345),
    hash: 'bb230c45db64b40bdd78bb9fd366beed'
  },
  {
    name: 'text seed',
    request: smallTerrainRequest('sovereign'),
    hash: '5e8b460d8c7fa42188972db03ace90a0'
  },
  {
    name: 'island mode',
    request: smallTerrainRequest(7, { islandMode: true }),
    hash: '85930a57a170e6e8f10d3d964e348e28'
  },
  {
    name: 'optional config fields omitted (their defaults apply)',
    request: smallTerrainRequestWithDefaults(5),
    hash: '22a064b7506e4d7bde0d339a0693dbc4'
  },
  {
    name: 'land-ratio rescue (sea level lowered)',
    request: smallTerrainRequest(3, { minLandRatio: 0.7 }),
    hash: '780b9e878bc43013addd4824886e42e2'
  }
]

describe('terrain goldens', () => {
  it.each(scenarios)('$name', ({ request, hash }) => {
    expect(hashTerrain(generateTerrain(request))).toBe(hash)
  })

  it('a text seed and the number it hashes to are the same world', async () => {
    const { normalizeSeed } = await import('../../src/random/seed')
    const asNumber = smallTerrainRequest(normalizeSeed('sovereign'))
    expect(hashTerrain(generateTerrain(asNumber))).toBe('5e8b460d8c7fa42188972db03ace90a0')
  })
})
