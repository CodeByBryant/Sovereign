// Pins what the terrain generator produced BEFORE it was refactored into a headless pipeline.
// The refactor must leave these hashes unchanged; only the randomness swap that follows may move
// them (and it replaces this file with new goldens).
import { describe, expect, it } from 'vitest'
import { hashTerrain } from './support/fieldHash'
import { generateTerrain } from '../src/terrain/pipeline'
import { smallTerrainRequest, smallTerrainRequestWithDefaults } from './support/terrainRequest'

const scenarios = [
  { name: 'seed 1', request: smallTerrainRequest(1), hash: 'c73f60d2bab00f12f703c5bf83237f92' },
  {
    name: 'seed 12345',
    request: smallTerrainRequest(12345),
    hash: '23986aefe908c7abd928618ef2ed0c5d'
  },
  {
    name: 'text seed',
    request: smallTerrainRequest('sovereign'),
    hash: '669f4deb24b9bf7f0aa1a76783b0ad23'
  },
  {
    name: 'island mode',
    request: smallTerrainRequest(7, { islandMode: true }),
    hash: '252d418ce330b253c3b5d0968e7f4526'
  },
  {
    name: 'optional config fields omitted (their defaults apply)',
    request: smallTerrainRequestWithDefaults(5),
    hash: 'f79b843da134520e1cf2c6bc6199652e'
  },
  {
    name: 'land-ratio rescue (sea level lowered)',
    request: smallTerrainRequest(3, { minLandRatio: 0.7 }),
    hash: 'd4b62979ce02ba404e83c201a8cfe78a'
  }
]

describe('terrain characterization (pre-refactor behaviour)', () => {
  it.each(scenarios)('$name', ({ request, hash }) => {
    expect(hashTerrain(generateTerrain(request))).toBe(hash)
  })
})
