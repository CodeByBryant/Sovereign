import { describe, expect, it } from 'vitest'
import { RESOURCE_CATALOG, ResourceType, resourceDef } from '../src/resources'

const byKey = (key: string) => RESOURCE_CATALOG.find((r) => r.key === key)

describe('RESOURCE_CATALOG', () => {
  it('has the 22 resources, with ids 1 to 22 in order (0 means none)', () => {
    expect(RESOURCE_CATALOG).toHaveLength(22)
    RESOURCE_CATALOG.forEach((def, index) => expect(def.id).toBe(index + 1))
  })

  it('keeps the ids the first seven resources always had', () => {
    // existing saves, hashes and palettes know these numbers
    expect(ResourceType.Timber).toBe(1)
    expect(ResourceType.Stone).toBe(2)
    expect(ResourceType.Iron).toBe(3)
    expect(ResourceType.Gold).toBe(4)
    expect(ResourceType.Grain).toBe(5)
    expect(ResourceType.Fish).toBe(6)
    expect(ResourceType.Fur).toBe(7)
  })

  it('agrees with the ResourceType enum: each key is its member, lower-cased', () => {
    for (const def of RESOURCE_CATALOG) {
      expect(ResourceType[def.id]?.toLowerCase()).toBe(def.key)
    }
    expect(ResourceType[0]).toBe('None')
  })

  it('has unique keys and labels, and a label and an icon for each', () => {
    expect(new Set(RESOURCE_CATALOG.map((r) => r.key)).size).toBe(22)
    expect(new Set(RESOURCE_CATALOG.map((r) => r.label)).size).toBe(22)
    for (const def of RESOURCE_CATALOG) {
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.icon.length).toBeGreaterThan(0)
      expect(def.unit.length).toBeGreaterThan(0)
    }
  })

  it('gives every resource a colour that can be told apart from every other', () => {
    for (const def of RESOURCE_CATALOG) {
      expect(def.color).toHaveLength(3)
      for (const c of def.color) {
        expect(Number.isInteger(c)).toBe(true)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(255)
      }
    }
    for (let a = 0; a < RESOURCE_CATALOG.length; a += 1) {
      for (let b = a + 1; b < RESOURCE_CATALOG.length; b += 1) {
        const [r1, g1, b1] = RESOURCE_CATALOG[a].color
        const [r2, g2, b2] = RESOURCE_CATALOG[b].color
        const distance = Math.hypot(r1 - r2, g1 - g2, b1 - b2)
        expect(
          distance,
          `${RESOURCE_CATALOG[a].key} and ${RESOURCE_CATALOG[b].key} are too alike`
        ).toBeGreaterThanOrEqual(30)
      }
    }
  })

  it('has 10 surface resources on land, 9 in the ground and 3 on the water', () => {
    const land = RESOURCE_CATALOG.filter((r) => r.layer === 'surface' && r.domain === 'land')
    const ground = RESOURCE_CATALOG.filter((r) => r.layer === 'ground')
    const water = RESOURCE_CATALOG.filter((r) => r.domain === 'water')
    expect(land.map((r) => r.key).sort()).toEqual(
      [
        'cotton',
        'fur',
        'grain',
        'horses',
        'ivory',
        'pasture',
        'spices',
        'tea',
        'timber',
        'wine'
      ].sort()
    )
    expect(ground.map((r) => r.key).sort()).toEqual(
      ['coal', 'copper', 'gems', 'gold', 'iron', 'oil', 'salt', 'silver', 'stone'].sort()
    )
    expect(water.map((r) => r.key).sort()).toEqual(['fish', 'pearls', 'whales'])
  })

  it('makes everything on the surface renewable and everything in the ground finite', () => {
    for (const def of RESOURCE_CATALOG) {
      expect(def.renewable, def.key).toBe(def.layer === 'surface')
    }
  })

  it('lets only oil and salt lie under shallow sea as well as under land', () => {
    expect(
      RESOURCE_CATALOG.filter((r) => r.domain === 'both')
        .map((r) => r.key)
        .sort()
    ).toEqual(['oil', 'salt'])
  })

  it('keeps water resources on the surface layer and ground resources off dry-land-only rules', () => {
    for (const def of RESOURCE_CATALOG.filter((r) => r.domain === 'water')) {
      expect(def.layer).toBe('surface')
    }
  })

  it('sorts resources into basic, industrial and luxury goods', () => {
    const tier = (t: string) =>
      RESOURCE_CATALOG.filter((r) => r.tier === t)
        .map((r) => r.key)
        .sort()
    expect(tier('basic')).toEqual(['fish', 'fur', 'grain', 'pasture', 'salt', 'stone', 'timber'])
    expect(tier('industrial')).toEqual([
      'coal',
      'copper',
      'cotton',
      'horses',
      'iron',
      'oil',
      'whales'
    ])
    expect(tier('luxury')).toEqual([
      'gems',
      'gold',
      'ivory',
      'pearls',
      'silver',
      'spices',
      'tea',
      'wine'
    ])
  })
})

describe('resourceDef', () => {
  it('looks a resource up by its id', () => {
    expect(resourceDef(ResourceType.Iron)).toBe(byKey('iron'))
    expect(resourceDef(22)).toBe(byKey('whales'))
  })

  it('has nothing for none, out-of-range or non-integer ids', () => {
    expect(resourceDef(0)).toBeUndefined()
    expect(resourceDef(23)).toBeUndefined()
    expect(resourceDef(-1)).toBeUndefined()
    expect(resourceDef(2.5)).toBeUndefined()
    expect(resourceDef(Number.NaN)).toBeUndefined()
  })
})
