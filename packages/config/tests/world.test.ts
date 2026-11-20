import { describe, expect, it } from 'vitest'
import {
  assertValidWorldConfig,
  defaultWorldConfig,
  resolveWorldConfig,
  validateWorldConfig,
  type WorldConfig
} from '../src/world'

/** A deep copy that we can mutate freely. */
function clone(): WorldConfig {
  return JSON.parse(JSON.stringify(defaultWorldConfig)) as WorldConfig
}

describe('defaultWorldConfig', () => {
  it('describes the 2000x2000 world the game starts with', () => {
    expect(defaultWorldConfig.map).toEqual({
      width: 2000,
      height: 2000,
      seaLevel: 0.37,
      minLandRatio: 0.25,
      islandMode: false
    })
    expect(defaultWorldConfig.nations).toEqual({ count: 12, minSpacing: 70 })
    expect(defaultWorldConfig.timestep).toBe(1)
  })

  it('holds engine settings only: no rendering or camera knobs', () => {
    const text = JSON.stringify(defaultWorldConfig)
    for (const key of ['tileSize', 'chunkSize', 'territoryAlpha', 'borderDarken', 'seed']) {
      expect(text).not.toContain(`"${key}"`)
    }
  })

  it('is itself valid', () => {
    expect(validateWorldConfig(defaultWorldConfig)).toEqual([])
  })
})

describe('resolveWorldConfig', () => {
  it('returns the defaults when given no overrides', () => {
    expect(resolveWorldConfig()).toEqual(defaultWorldConfig)
    expect(resolveWorldConfig({})).toEqual(defaultWorldConfig)
  })

  it('changes only what an override names, within its section', () => {
    const resolved = resolveWorldConfig({ map: { width: 300 }, nations: { count: 5 } })
    expect(resolved.map).toEqual({ ...defaultWorldConfig.map, width: 300 })
    expect(resolved.nations).toEqual({ ...defaultWorldConfig.nations, count: 5 })
    expect(resolved.elevation).toEqual(defaultWorldConfig.elevation)
    expect(resolved.rivers).toEqual(defaultWorldConfig.rivers)
  })

  it.each([
    ['map', { height: 77 }],
    ['elevation', { scale: 0.5 }],
    ['temperature', { latitudeStrength: 0.1 }],
    ['humidity', { coastalInfluence: 0.9 }],
    ['biomeNoise', { octaves: 4 }],
    ['rivers', { primaryWidth: 9 }],
    ['biomes', { shoreBand: 0.5 }],
    ['strategic', { straitMaxWidth: 3 }],
    ['resources', { goldRarity: 0.5 }],
    ['nations', { minSpacing: 11 }]
  ] as const)('applies an override to the %s section', (section, override) => {
    const resolved = resolveWorldConfig({ [section]: override })
    expect(resolved[section]).toEqual({ ...defaultWorldConfig[section], ...override })
  })

  it('overrides the timestep', () => {
    expect(resolveWorldConfig({ timestep: 0.5 }).timestep).toBe(0.5)
  })

  it('never aliases or mutates the defaults or the overrides it was given', () => {
    const before = JSON.stringify(defaultWorldConfig)
    const overrides = { map: { width: 100 } }
    const resolved = resolveWorldConfig(overrides)
    resolved.map.width = 1
    resolved.rivers.primaryWidth = 99
    resolved.elevation.scale = 7
    expect(JSON.stringify(defaultWorldConfig)).toBe(before)
    expect(overrides).toEqual({ map: { width: 100 } })
    expect(resolveWorldConfig().rivers.primaryWidth).toBe(defaultWorldConfig.rivers.primaryWidth)
  })

  it('ignores an override explicitly set to undefined, rather than erasing the default', () => {
    const resolved = resolveWorldConfig({ map: { width: undefined, height: 64 } })
    expect(resolved.map.width).toBe(2000)
    expect(resolved.map.height).toBe(64)
  })
})

describe('validateWorldConfig', () => {
  const bad = (edit: (c: WorldConfig) => void): string[] => {
    const c = clone()
    edit(c)
    return validateWorldConfig(c)
  }

  it.each([
    ['a zero width', (c: WorldConfig) => (c.map.width = 0)],
    ['a fractional height', (c: WorldConfig) => (c.map.height = 10.5)],
    ['a map below the minimum size', (c: WorldConfig) => (c.map.width = 8)],
    ['a width above the limit', (c: WorldConfig) => (c.map.width = 8193)],
    ['an area above the limit', (c: WorldConfig) => ((c.map.width = 8192), (c.map.height = 8192))],
    ['a sea level of 0', (c: WorldConfig) => (c.map.seaLevel = 0)],
    ['a sea level of exactly 1', (c: WorldConfig) => (c.map.seaLevel = 1)],
    ['a sea level above 1', (c: WorldConfig) => (c.map.seaLevel = 1.2)],
    ['a negative land ratio', (c: WorldConfig) => (c.map.minLandRatio = -0.1)],
    ['a land ratio of 1', (c: WorldConfig) => (c.map.minLandRatio = 1)],
    [
      'a non-boolean island mode',
      (c: WorldConfig) => ((c.map as { islandMode: unknown }).islandMode = 'yes')
    ],
    ['more than 255 nations', (c: WorldConfig) => (c.nations.count = 256)],
    ['a negative nation count', (c: WorldConfig) => (c.nations.count = -1)],
    ['a fractional nation count', (c: WorldConfig) => (c.nations.count = 2.5)],
    ['a zero spawn spacing', (c: WorldConfig) => (c.nations.minSpacing = 0)],
    ['a zero timestep', (c: WorldConfig) => (c.timestep = 0)],
    ['a NaN timestep', (c: WorldConfig) => (c.timestep = Number.NaN)],
    ['an infinite noise scale', (c: WorldConfig) => (c.elevation.scale = Number.POSITIVE_INFINITY)],
    ['a NaN river threshold', (c: WorldConfig) => (c.rivers.primaryThreshold = Number.NaN)],
    ['zero octaves', (c: WorldConfig) => (c.elevation.octaves = 0)],
    ['too many octaves', (c: WorldConfig) => (c.temperature.octaves = 20)],
    ['nine octaves', (c: WorldConfig) => (c.elevation.octaves = 9)],
    ['a persistence above 1', (c: WorldConfig) => (c.humidity.persistence = 1.01)],
    ['a zero persistence', (c: WorldConfig) => (c.humidity.persistence = 0)],
    ['a lacunarity below 1', (c: WorldConfig) => (c.temperature.lacunarity = 0.9)],
    ['a fractional octave count', (c: WorldConfig) => (c.humidity.octaves = 2.5)],
    ['a non-positive noise scale', (c: WorldConfig) => (c.biomeNoise.scale = 0)]
  ])('rejects %s', (_label, edit) => {
    expect(bad(edit).length).toBeGreaterThan(0)
  })

  it('names the offending field in its message', () => {
    expect(bad((c) => (c.map.width = 0)).join('\n')).toContain('map.width')
    expect(bad((c) => (c.nations.count = 300)).join('\n')).toContain('nations.count')
    expect(bad((c) => (c.rivers.primaryThreshold = Number.NaN)).join('\n')).toContain(
      'rivers.primaryThreshold'
    )
  })

  it('reports every problem, not just the first', () => {
    const messages = bad((c) => {
      c.map.width = 0
      c.map.seaLevel = 5
      c.timestep = -1
    })
    expect(messages.length).toBe(3)
  })

  it('accepts the boundary values that are allowed', () => {
    expect(bad((c) => (c.nations.count = 255))).toEqual([])
    expect(bad((c) => (c.nations.count = 0))).toEqual([])
    expect(bad((c) => (c.map.width = 16))).toEqual([])
    expect(bad((c) => ((c.map.width = 4096), (c.map.height = 4096)))).toEqual([])
    expect(bad((c) => (c.map.minLandRatio = 0))).toEqual([])
    expect(bad((c) => ((c.map.width = 8192), (c.map.height = 2048)))).toEqual([]) // the longest side, exactly at the area limit
    expect(bad((c) => (c.map.seaLevel = 0.0001))).toEqual([])
    expect(bad((c) => (c.map.seaLevel = 0.9999))).toEqual([])
    expect(bad((c) => (c.elevation.octaves = 8))).toEqual([])
    expect(bad((c) => (c.elevation.octaves = 1))).toEqual([])
    expect(bad((c) => (c.humidity.persistence = 1))).toEqual([])
    expect(bad((c) => (c.temperature.lacunarity = 1))).toEqual([])
  })
})

describe('assertValidWorldConfig', () => {
  it('passes a valid config through silently', () => {
    expect(() => assertValidWorldConfig(defaultWorldConfig)).not.toThrow()
  })

  it('throws a RangeError listing every problem', () => {
    const c = clone()
    c.map.width = 0
    c.timestep = 0
    expect(() => assertValidWorldConfig(c)).toThrow(RangeError)
    expect(() => assertValidWorldConfig(c)).toThrow(/map\.width[\s\S]*timestep/)
  })
})
