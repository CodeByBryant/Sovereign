import { defaultWorldConfig, type StrategicConfig, type TerrainConfig } from '@sovereign/config'
import { describe, expect, it } from 'vitest'
import { detectStrategicPoints } from '../src/terrain/strategic'

// A 64 x 64 world of highland (0.78) with a 5 x 5 patch of lower ground (0.70) in the middle: a
// pass, a low point with higher ground all around it.
const SIZE = 64
const terrain: TerrainConfig = {
  ...defaultWorldConfig.elevation,
  width: SIZE,
  height: SIZE,
  seaLevel: defaultWorldConfig.map.seaLevel,
  islandMode: false
}
const elevation = new Float32Array(SIZE * SIZE).fill(0.78)
for (let y = 30; y <= 34; y += 1) for (let x = 30; x <= 34; x += 1) elevation[y * SIZE + x] = 0.7
const noRivers = new Uint8Array(SIZE * SIZE)

const passes = (strategic: Partial<StrategicConfig> = {}): Array<{ x: number; y: number }> =>
  detectStrategicPoints(elevation, noRivers, terrain, defaultWorldConfig.biomes, {
    ...defaultWorldConfig.strategic,
    ...strategic
  }).points.filter((p) => p.type === 'mountain_pass')

describe('mountain passes', () => {
  it('finds a low point surrounded by higher ground, at the low point', () => {
    const found = passes()
    expect(found.length).toBeGreaterThan(0)
    for (const p of found) {
      expect(p.x).toBeGreaterThanOrEqual(26)
      expect(p.x).toBeLessThanOrEqual(38)
      expect(p.y).toBeGreaterThanOrEqual(26)
      expect(p.y).toBeLessThanOrEqual(38)
    }
  })

  it('needs the ground around it to be higher by mountainPassRise', () => {
    // the surroundings are 0.08 higher than the pass
    expect(passes({ mountainPassRise: 0.07 }).length).toBeGreaterThan(0)
    expect(passes({ mountainPassRise: 0.09 })).toEqual([])
  })

  it('needs mountainPassMinRatio of the surroundings to be higher', () => {
    // 32 of the 36 sampled neighbours (89%) are higher at the centre, up to 35 (97%) at the patch's edge
    expect(passes({ mountainPassMinRatio: 0.85 }).length).toBeGreaterThan(0)
    expect(passes({ mountainPassMinRatio: 0.99 })).toEqual([])
  })

  it('finds nothing on flat ground', () => {
    const flat = new Float32Array(SIZE * SIZE).fill(0.78)
    const none = detectStrategicPoints(flat, noRivers, terrain, defaultWorldConfig.biomes, {
      ...defaultWorldConfig.strategic
    }).points.filter((p) => p.type === 'mountain_pass')
    expect(none).toEqual([])
  })

  it('ignores a low point that is itself at mountain height: a pass lies below the peaks', () => {
    const peaks = new Float32Array(SIZE * SIZE).fill(0.95)
    for (let y = 30; y <= 34; y += 1) for (let x = 30; x <= 34; x += 1) peaks[y * SIZE + x] = 0.88
    const none = detectStrategicPoints(peaks, noRivers, terrain, defaultWorldConfig.biomes, {
      ...defaultWorldConfig.strategic
    }).points.filter((p) => p.type === 'mountain_pass')
    expect(none).toEqual([])
  })

  it('ignores low ground, which is a valley and not a pass', () => {
    const low = new Float32Array(SIZE * SIZE).fill(0.45)
    for (let y = 30; y <= 34; y += 1) for (let x = 30; x <= 34; x += 1) low[y * SIZE + x] = 0.4
    const none = detectStrategicPoints(low, noRivers, terrain, defaultWorldConfig.biomes, {
      ...defaultWorldConfig.strategic
    }).points.filter((p) => p.type === 'mountain_pass')
    expect(none).toEqual([])
  })
})
