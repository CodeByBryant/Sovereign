import { describe, expect, it } from 'vitest'
import { BIOME_KEYS, RESOURCE_CATALOG } from '@sovereign/contracts'
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
    ['a non-positive noise scale', (c: WorldConfig) => (c.biomeNoise.scale = 0)],
    ['a zero pass rise', (c: WorldConfig) => (c.strategic.mountainPassRise = 0)],
    ['a zero pass ratio', (c: WorldConfig) => (c.strategic.mountainPassMinRatio = 0)],
    ['a pass ratio above 1', (c: WorldConfig) => (c.strategic.mountainPassMinRatio = 1.01)]
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

describe('terrain distribution profiles', () => {
  const at = (profile: ReadonlyArray<readonly [number, number]>, q: number): number => {
    for (let k = 1; k < profile.length; k += 1) {
      const [q1, v1] = profile[k]
      if (q <= q1) {
        const [q0, v0] = profile[k - 1]
        return v0 + ((q - q0) / (q1 - q0)) * (v1 - v0)
      }
    }
    return profile[profile.length - 1][1]
  }

  it.each([
    ['elevation', defaultWorldConfig.elevation.profile],
    ['temperature', defaultWorldConfig.temperature.profile],
    ['humidity', defaultWorldConfig.humidity.profile]
  ])('the default %s profile is a valid monotone map from quantile 0 to 1', (_name, profile) => {
    expect(profile[0][0]).toBe(0)
    expect(profile[profile.length - 1][0]).toBe(1)
    for (let k = 1; k < profile.length; k += 1) {
      expect(profile[k][0]).toBeGreaterThan(profile[k - 1][0])
      expect(profile[k][1]).toBeGreaterThanOrEqual(profile[k - 1][1])
    }
    for (const [, value] of profile) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('pins the ocean: water is 74.5% of tiles (deep 19%, shallow 55.5%), shore 3%', () => {
    const { profile } = defaultWorldConfig.elevation
    const sea = defaultWorldConfig.map.seaLevel
    expect(at(profile, 0.19)).toBeCloseTo(defaultWorldConfig.biomes.deepOceanFactor * sea, 10)
    expect(at(profile, 0.745)).toBeCloseTo(sea, 10)
    expect(at(profile, 0.775)).toBeCloseTo(sea + defaultWorldConfig.biomes.shoreBand, 10)
  })

  it('puts the elevated land where the classifier looks for it', () => {
    // The top 14% of land (25.5% of tiles) is highland or higher; the top 4% is mountain.
    const { profile } = defaultWorldConfig.elevation
    const b = defaultWorldConfig.biomes
    const landTop = (share: number): number => 1 - share * 0.255
    expect(at(profile, landTop(0.14))).toBeCloseTo(b.highlandElevation, 2)
    expect(at(profile, landTop(0.075))).toBeCloseTo(b.alpineElevation, 2)
    expect(at(profile, landTop(0.04))).toBeCloseTo(b.mountainElevation, 2)
  })

  it('no longer carries the power-curve knob the remap replaced', () => {
    expect('redistributionPower' in defaultWorldConfig.elevation).toBe(false)
  })

  const bad = (edit: (c: WorldConfig) => void): string[] => {
    const c = clone()
    edit(c)
    return validateWorldConfig(c)
  }
  type Knots = Array<[number, number]>

  it.each([
    ['a profile of one knot', (k: Knots) => k.splice(1)],
    ['a profile that does not start at quantile 0', (k: Knots) => (k[0][0] = 0.1)],
    ['a profile that does not end at quantile 1', (k: Knots) => (k[k.length - 1][0] = 0.9)],
    ['a repeated quantile', (k: Knots) => (k[1][0] = k[0][0])],
    ['quantiles going backwards', (k: Knots) => (k[2][0] = k[1][0] - 0.01)],
    ['values going backwards', (k: Knots) => (k[2][1] = k[1][1] - 0.01)],
    ['a value above 1', (k: Knots) => (k[k.length - 1][1] = 1.01)],
    ['a value below 0', (k: Knots) => (k[0][1] = -0.01)],
    ['a NaN value', (k: Knots) => (k[1][1] = Number.NaN)]
  ])('rejects %s, in each of the three profiles', (_label, edit) => {
    for (const section of ['elevation', 'temperature', 'humidity'] as const) {
      const problems = bad((c) => edit(c[section].profile as Knots))
      expect(problems.some((p) => p.startsWith(`${section}.profile`))).toBe(true)
    }
  })

  it('accepts a flat stretch (a plateau) in a profile', () => {
    expect(
      bad((c) => {
        const k = c.elevation.profile as Knots
        k[3][1] = k[2][1]
      })
    ).toEqual([])
  })

  it('does not alias the default profiles or bands into a resolved config', () => {
    const before = JSON.stringify(defaultWorldConfig)
    const resolved = resolveWorldConfig()
    ;(resolved.elevation.profile as Knots)[1][1] = 0.5
    ;(resolved.temperature.profile as Knots).pop()
    resolved.biomes.bands[0].rows[0].maxHumidity = 0.9
    resolved.biomes.bands.pop()
    expect(JSON.stringify(defaultWorldConfig)).toBe(before)
  })

  it('replaces a whole profile when one is overridden', () => {
    const profile: Knots = [
      [0, 0],
      [1, 1]
    ]
    expect(resolveWorldConfig({ elevation: { profile } }).elevation.profile).toEqual(profile)
  })
})

describe('the classifier table (biomes.bands)', () => {
  const bad = (edit: (c: WorldConfig) => void): string[] => {
    const c = clone()
    edit(c)
    return validateWorldConfig(c)
  }

  it('is a valid table by default and offers every land climate biome', () => {
    expect(validateWorldConfig(defaultWorldConfig)).toEqual([])
    const offered = new Set(
      defaultWorldConfig.biomes.bands.flatMap((band) => band.rows.map((row) => row.biome))
    )
    for (const key of BIOME_KEYS) {
      const elevationOrWater = ['deep_ocean', 'ocean', 'shore', 'alpine', 'highland', 'mountain']
      if (!elevationOrWater.includes(key)) expect(offered.has(key)).toBe(true)
    }
  })

  it.each([
    ['no bands', (c: WorldConfig) => (c.biomes.bands = [])],
    ['a band with no rows', (c: WorldConfig) => (c.biomes.bands[0].rows = [])],
    [
      'a last band that does not reach temperature 1',
      (c: WorldConfig) => (c.biomes.bands[3].maxTemperature = 0.95)
    ],
    ['bands out of order', (c: WorldConfig) => (c.biomes.bands[1].maxTemperature = 0.1)],
    ['a band temperature of 0', (c: WorldConfig) => (c.biomes.bands[0].maxTemperature = 0)],
    [
      'a last row that does not reach humidity 1',
      (c: WorldConfig) => (c.biomes.bands[0].rows[3].maxHumidity = 0.9)
    ],
    ['rows out of order', (c: WorldConfig) => (c.biomes.bands[0].rows[1].maxHumidity = 0.1)],
    [
      'an unknown biome',
      (c: WorldConfig) => ((c.biomes.bands[0].rows[0] as { biome: string }).biome = 'lava')
    ],
    [
      'an unknown lowland biome',
      (c: WorldConfig) =>
        ((c.biomes.bands[2].rows[5] as { lowlandBiome?: string }).lowlandBiome = 'lava')
    ],
    ['a negative lowland band', (c: WorldConfig) => (c.biomes.lowlandBand = -0.1)]
  ])('rejects %s', (_label, edit) => {
    expect(bad(edit).some((p) => p.startsWith('biomes.'))).toBe(true)
  })
})

describe('resource placement rules (resources)', () => {
  const placement = defaultWorldConfig.resources
  const bad = (edit: (c: WorldConfig) => void): string[] => {
    const c = clone()
    edit(c)
    return validateWorldConfig(c)
  }

  it('has a rule for every one of the 22 resources, and for nothing else', () => {
    expect(Object.keys(placement.rules).sort()).toEqual(RESOURCE_CATALOG.map((d) => d.key).sort())
  })

  it('has a regrowth rate for every renewable resource and for no finite one', () => {
    const renewable = RESOURCE_CATALOG.filter((d) => d.renewable).map((d) => d.key)
    expect(Object.keys(placement.regrowth).sort()).toEqual(renewable.sort())
  })

  it('keeps every share between 0 and 1, and each slot realistic: shares on one slot cannot exceed what exists', () => {
    for (const def of RESOURCE_CATALOG) {
      const rule = placement.rules[def.key]
      expect(rule.share, def.key).toBeGreaterThan(0)
      expect(rule.share, def.key).toBeLessThanOrEqual(1)
    }
    const sum = (pick: (d: (typeof RESOURCE_CATALOG)[number]) => boolean): number =>
      RESOURCE_CATALOG.filter(pick).reduce((s, d) => s + placement.rules[d.key].share, 0)
    expect(sum((d) => d.layer === 'surface' && d.domain === 'land')).toBeLessThan(0.8)
    expect(sum((d) => d.layer === 'ground')).toBeLessThan(0.5)
    expect(sum((d) => d.domain === 'water')).toBeLessThan(0.5)
  })

  it('only puts offshore deposits on resources that can lie under the sea (oil and salt)', () => {
    for (const def of RESOURCE_CATALOG) {
      expect(placement.rules[def.key].offshore !== undefined, def.key).toBe(def.domain === 'both')
    }
  })

  it('is itself valid, and reports problems naming the rule', () => {
    expect(validateWorldConfig(defaultWorldConfig)).toEqual([])
    const problems = bad((c) => (c.resources.rules.iron.share = 2))
    expect(problems.some((p) => p.startsWith('resources.rules.iron.share'))).toBe(true)
  })

  it.each([
    [
      'an unknown resource',
      (c: WorldConfig) =>
        (c.resources.rules.unicorn = { ...c.resources.rules.iron })
    ],
    ['a negative share', (c: WorldConfig) => (c.resources.rules.iron.share = -0.1)],
    ['a share above 1', (c: WorldConfig) => (c.resources.rules.iron.share = 1.1)],
    [
      'a regional factor above 1',
      (c: WorldConfig) => (c.resources.rules.iron.regional = 1.2)
    ],
    [
      'a negative regional factor',
      (c: WorldConfig) => (c.resources.rules.iron.regional = -0.1)
    ],
    ['a region size of 0', (c: WorldConfig) => (c.resources.rules.iron.regionSize = 0)],
    [
      'a range with min above max',
      (c: WorldConfig) => (c.resources.rules.iron.elevation = [0.9, 0.2])
    ],
    [
      'a negative coast distance',
      (c: WorldConfig) => (c.resources.rules.fish.coastDistance = [-1, 10])
    ],
    [
      'an unknown biome',
      (c: WorldConfig) => (c.resources.rules.timber.biomes = { lava: 1 } as never)
    ],
    [
      'a biome weight above 1',
      (c: WorldConfig) => (c.resources.rules.timber.biomes = { woodland: 1.5 })
    ],
    [
      'a biome weight below 0',
      (c: WorldConfig) => (c.resources.rules.timber.biomes = { woodland: -1 })
    ],
    [
      'biomes on a water resource',
      (c: WorldConfig) => (c.resources.rules.fish.biomes = { ocean: 1 })
    ],
    [
      'an offshore elevation range that runs backwards',
      (c: WorldConfig) => (c.resources.rules.oil.offshore = { share: 0.01, elevation: [0.9, 0.1] })
    ],
    [
      'an offshore deposit on a land-only resource',
      (c: WorldConfig) => (c.resources.rules.iron.offshore = { share: 0.01 })
    ],
    [
      'no offshore setting on oil being allowed to exceed 1',
      (c: WorldConfig) => (c.resources.rules.oil.offshore = { share: 1.5 })
    ],
    [
      'a river preference with no reach',
      (c: WorldConfig) =>
        (c.resources.rules.grain.prefer = { river: { within: 0, weight: 1 } })
    ],
    [
      'regrowth for a finite resource',
      (c: WorldConfig) => (c.resources.regrowth.iron = { units: 1, period: 10 })
    ],
    [
      'regrowth for an unknown resource',
      (c: WorldConfig) => (c.resources.regrowth.unicorn = { units: 1, period: 10 })
    ],
    ['regrowth of 0 units', (c: WorldConfig) => (c.resources.regrowth.grain.units = 0)],
    ['regrowth of 256 units', (c: WorldConfig) => (c.resources.regrowth.grain.units = 256)],
    ['a regrowth period of 0', (c: WorldConfig) => (c.resources.regrowth.grain.period = 0)],
    [
      'a fractional regrowth period',
      (c: WorldConfig) => (c.resources.regrowth.grain.period = 2.5)
    ],
    ['a ridge radius of 0', (c: WorldConfig) => (c.resources.features.ridgeRadius = 0)],
    [
      'a fractional ridge radius',
      (c: WorldConfig) => (c.resources.features.ridgeRadius = 2.5)
    ],
    ['a ridge scale of 0', (c: WorldConfig) => (c.resources.features.ridgeScale = 0)],
    ['a slope scale of 0', (c: WorldConfig) => (c.resources.features.slopeScale = 0)],
    [
      'surface land shares that add up to more than the land',
      (c: WorldConfig) => {
        for (const key of ['timber', 'grain', 'pasture']) c.resources.rules[key].share = 0.5
      }
    ],
    [
      'ground shares that add up to more than the land',
      (c: WorldConfig) => (c.resources.rules.stone.share = 1)
    ],
    [
      'water shares that add up to more than the water',
      (c: WorldConfig) => (c.resources.rules.fish.share = 1)
    ]
  ])('rejects %s', (_label, edit) => {
    expect(bad(edit).some((p) => p.startsWith('resources'))).toBe(true)
  })

  it('checks each offshore share on its own, and the offshore shares together', () => {
    const own = bad((c) => (c.resources.rules.oil.offshore = { share: 1.2 }))
    expect(own.some((p) => p.includes('oil.offshore.share'))).toBe(true)
    const together = bad((c) => {
      c.resources.rules.oil.offshore = { share: 0.7 }
      c.resources.rules.salt.offshore = { share: 0.7 }
    })
    expect(together.some((p) => p.includes('offshore shares add up'))).toBe(true)
    expect(together.some((p) => p.includes('offshore.share must'))).toBe(false)
    expect(bad((c) => (c.resources.rules.oil.offshore = { share: 0.9 }))).toEqual([])
  })

  it('does not alias the default rules into a resolved config, however deep', () => {
    const before = JSON.stringify(defaultWorldConfig)
    const resolved = resolveWorldConfig()
    resolved.resources.rules.iron.share = 0.9
    resolved.resources.rules.iron.prefer = { ridge: 99 }
    resolved.resources.regrowth.grain.units = 200
    resolved.resources.features.ridgeRadius = 1
    delete (resolved.resources.rules as Record<string, unknown>).gold
    expect(JSON.stringify(defaultWorldConfig)).toBe(before)
  })

  it('lets a section be overridden as a whole', () => {
    const rules = {
      ...clone().resources.rules,
      iron: { share: 0.5, regional: 0, regionSize: 10 }
    }
    const resolved = resolveWorldConfig({ resources: { rules } })
    expect(resolved.resources.rules.iron.share).toBe(0.5)
    expect(resolved.resources.regrowth).toEqual(
      defaultWorldConfig.resources.regrowth
    )
  })
})
