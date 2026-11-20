import type { GovernmentType, NationProfile } from '@sovereign/contracts'
import { describe, expect, it } from 'vitest'
import {
  GOVERNMENTS,
  deriveGovernment,
  derivePersonality,
  deriveStats
} from '../src/nations/derive'

/** A modest nation of 1200 tiles: decent farmland, a little of everything else. */
const base: NationProfile = {
  area: 1200,
  food: 900,
  timber: 40,
  stone: 20,
  horses: 5,
  metals: 8,
  luxuries: 4,
  diversity: 8,
  coast: 40,
  river: 30,
  highGround: 60,
  defence: 12,
  traffic: 0.3,
  contacts: 2
}
const p = (over: Partial<NationProfile> = {}): NationProfile => ({ ...base, ...over })
const calm = [0, 0, 0, 0, 0, 0, 0, 0]
const noise5 = [0, 0, 0, 0, 0]

describe('deriveStats', () => {
  it('gives whole numbers, within the ranges the UI draws', () => {
    for (const profile of [
      p(),
      p({ food: 0, metals: 0, luxuries: 0 }),
      p({ food: 1e6, metals: 1e4, luxuries: 1e4, traffic: 50, contacts: 40 })
    ]) {
      const s = deriveStats(profile)
      for (const v of [s.population, s.military, s.economy, s.diplomacy]) {
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(5)
      }
      expect(s.population).toBeLessThanOrEqual(300)
      expect(s.military).toBeLessThanOrEqual(200)
      expect(s.economy).toBeLessThanOrEqual(200)
      expect(s.diplomacy).toBeLessThanOrEqual(200)
    }
  })

  it('is the same twice, and takes nothing but the profile (no randomness)', () => {
    expect(deriveStats(p())).toEqual(deriveStats(p()))
    expect(deriveStats.length).toBe(1)
  })

  it('makes a nation more populous the more food its land yields', () => {
    const pop = (food: number): number => deriveStats(p({ food })).population
    expect(pop(300)).toBeLessThan(pop(600))
    expect(pop(600)).toBeLessThan(pop(1200))
    expect(pop(1200)).toBeLessThan(pop(2400))
    expect(pop(0)).toBe(5)
    expect(pop(1e7)).toBe(300)
  })

  it.each([
    ['metals', { metals: 30 }],
    ['horses', { horses: 30 }],
    ['timber', { timber: 200 }],
    ['stone', { stone: 200 }],
    ['defence', { defence: 60 }],
    ['high ground', { highGround: 400 }],
    ['food (more people to arm)', { food: 2000 }]
  ] as Array<[string, Partial<NationProfile>]>)('arms a nation more for more %s', (_name, more) => {
    expect(deriveStats(p(more)).military).toBeGreaterThan(deriveStats(p()).military)
  })

  it.each([
    ['luxuries', { luxuries: 20 }],
    ['different resources', { diversity: 16 }],
    ['coast (ports)', { coast: 200 }],
    ['route traffic', { traffic: 1.5 }],
    ['food (more people to work)', { food: 2000 }]
  ] as Array<[string, Partial<NationProfile>]>)(
    'enriches a nation more for more %s',
    (_name, more) => {
      expect(deriveStats(p(more)).economy).toBeGreaterThan(deriveStats(p()).economy)
    }
  )

  it.each([
    ['neighbours', { contacts: 6 }],
    ['route traffic', { traffic: 1.5 }],
    ['wealth (luxuries)', { luxuries: 40, diversity: 20 }]
  ] as Array<[string, Partial<NationProfile>]>)(
    'gives a nation more standing with others for more %s',
    (_name, more) => {
      expect(deriveStats(p(more)).diplomacy).toBeGreaterThan(deriveStats(p()).diplomacy)
    }
  )

  it('weighs a neighbour, route traffic and wealth in diplomacy by about what they are worth', () => {
    const d = (more: Partial<NationProfile>): number => deriveStats(p(more)).diplomacy
    expect(d({ contacts: base.contacts + 1 }) - d({})).toBeGreaterThanOrEqual(14)
    expect(d({ traffic: base.traffic + 1 }) - d({})).toBeGreaterThanOrEqual(25)
    expect(d({ luxuries: base.luxuries + 10 }) - d({})).toBeGreaterThanOrEqual(8)
  })

  it('never lowers a stat when a good thing is added', () => {
    const before = deriveStats(p())
    for (const more of [
      { food: 1100 },
      { metals: 9 },
      { luxuries: 5 },
      { coast: 41 },
      { contacts: 3 },
      { traffic: 0.31 }
    ]) {
      const after = deriveStats(p(more))
      expect(after.population).toBeGreaterThanOrEqual(before.population)
      expect(after.military).toBeGreaterThanOrEqual(before.military)
      expect(after.economy).toBeGreaterThanOrEqual(before.economy)
      expect(after.diplomacy).toBeGreaterThanOrEqual(before.diplomacy)
    }
  })

  it('ranks nations by their land: richer land gives more of everything', () => {
    const poor = deriveStats(
      p({
        food: 250,
        metals: 0,
        luxuries: 0,
        diversity: 3,
        coast: 0,
        traffic: 0,
        contacts: 0,
        defence: 0,
        horses: 0
      })
    )
    const rich = deriveStats(
      p({
        food: 1800,
        metals: 20,
        luxuries: 15,
        diversity: 14,
        coast: 120,
        traffic: 1,
        contacts: 4,
        defence: 30,
        horses: 20
      })
    )
    expect(rich.population).toBeGreaterThan(poor.population)
    expect(rich.military).toBeGreaterThan(poor.military)
    expect(rich.economy).toBeGreaterThan(poor.economy)
    expect(rich.diplomacy).toBeGreaterThan(poor.diplomacy)
  })
})

describe('deriveGovernment', () => {
  const gov = (profile: NationProfile, jitter = calm): GovernmentType =>
    deriveGovernment(profile, deriveStats(profile), jitter)

  it('lists the eight governments', () => {
    expect(new Set(GOVERNMENTS).size).toBe(8)
  })

  it('always returns one of them', () => {
    for (const profile of [p(), p({ food: 0 }), p({ food: 1e6, metals: 1e3, horses: 1e3 })]) {
      expect(GOVERNMENTS).toContain(gov(profile))
    }
  })

  it('is tribal for a small, poor, isolated people', () => {
    expect(
      gov(
        p({
          food: 250,
          metals: 0,
          luxuries: 0,
          diversity: 3,
          coast: 0,
          traffic: 0,
          contacts: 0,
          defence: 0,
          horses: 0,
          highGround: 0
        })
      )
    ).toBe('tribal')
  })

  it('is an empire for a populous, well-armed nation', () => {
    expect(
      gov(p({ food: 2400, metals: 40, horses: 40, defence: 40, timber: 200, stone: 100 }))
    ).toBe('empire')
  })

  it('is a republic for a trading coast', () => {
    expect(
      gov(
        p({
          food: 1000,
          coast: 300,
          traffic: 1.5,
          luxuries: 6,
          diversity: 12,
          metals: 2,
          horses: 0,
          defence: 3,
          contacts: 1
        })
      )
    ).toBe('republic')
  })

  it('is an oligarchy for the owners of great wealth in a small country', () => {
    expect(
      gov(
        p({
          food: 700,
          luxuries: 40,
          diversity: 16,
          metals: 30,
          coast: 10,
          traffic: 0.3,
          contacts: 0,
          defence: 4
        })
      )
    ).toBe('oligarchy')
  })

  it('is a theocracy for a high, isolated land', () => {
    expect(
      gov(
        p({
          food: 600,
          highGround: 700,
          contacts: 0,
          traffic: 0,
          coast: 0,
          luxuries: 1,
          diversity: 5,
          metals: 1,
          defence: 5
        })
      )
    ).toBe('theocracy')
  })

  it('is a dictatorship for a poor, hungry, militarised one', () => {
    expect(
      gov(
        p({
          food: 450,
          metals: 30,
          horses: 30,
          defence: 25,
          luxuries: 0,
          diversity: 5,
          coast: 0,
          traffic: 0,
          contacts: 3
        })
      )
    ).toBe('dictatorship')
  })

  it('is a monarchy for plain, settled farmland', () => {
    expect(
      gov(
        p({
          food: 1100,
          metals: 3,
          luxuries: 1,
          diversity: 6,
          coast: 5,
          traffic: 0.1,
          contacts: 1,
          defence: 2,
          horses: 2,
          highGround: 0
        })
      )
    ).toBe('monarchy')
  })

  it('is a democracy for a wealthy, connected, peaceful nation', () => {
    expect(
      gov(
        p({
          food: 1300,
          luxuries: 12,
          diversity: 14,
          coast: 60,
          traffic: 1.2,
          contacts: 5,
          metals: 3,
          horses: 0,
          defence: 2,
          highGround: 0
        })
      )
    ).toBe('democracy')
  })

  it('lets a little chance break a close call, but not overturn a clear one', () => {
    const tribal = p({
      food: 250,
      metals: 0,
      luxuries: 0,
      diversity: 3,
      coast: 0,
      traffic: 0,
      contacts: 0,
      defence: 0,
      horses: 0,
      highGround: 0
    })
    for (const j of [Array(8).fill(1), Array(8).fill(-1), [1, -1, 1, -1, 1, -1, 1, -1]]) {
      expect(gov(tribal, j)).toBe('tribal')
    }
    const outcomes = new Set<GovernmentType>()
    for (let k = 0; k < 8; k += 1) {
      outcomes.add(
        gov(
          p(),
          GOVERNMENTS.map((_, i) => (i === k ? 1 : -1))
        )
      )
    }
    expect(outcomes.size).toBeGreaterThan(1)
  })

  it('is the same twice', () => {
    expect(gov(p())).toBe(gov(p()))
  })
})

describe('derivePersonality', () => {
  const per = (profile: NationProfile, government: GovernmentType = 'monarchy', jitter = noise5) =>
    derivePersonality(profile, deriveStats(profile), government, jitter)

  it('keeps every trait between 0.05 and 0.95', () => {
    for (const profile of [
      p(),
      p({ food: 0, metals: 0 }),
      p({ food: 1e6, metals: 1e4, contacts: 50, traffic: 50, defence: 1e3 })
    ]) {
      for (const jitter of [Array(5).fill(1), Array(5).fill(-1), noise5]) {
        for (const g of GOVERNMENTS) {
          for (const v of Object.values(per(profile, g, jitter))) {
            expect(v).toBeGreaterThanOrEqual(0.05)
            expect(v).toBeLessThanOrEqual(0.95)
          }
        }
      }
    }
  })

  it('makes a land-poor nation more expansionist and aggressive', () => {
    const poor = per(p({ food: 300 }))
    const rich = per(p({ food: 1600 }))
    expect(poor.expansionism).toBeGreaterThan(rich.expansionism)
    expect(poor.aggression).toBeGreaterThan(rich.aggression)
  })

  it('makes a quarrelsome nation less diplomatic than a content one of the same standing', () => {
    // same neighbours and trade; the land-poor one is more aggressive, which tempers its diplomacy
    const hungry = per(p({ food: 200, contacts: 3, traffic: 0.5 }))
    const fed = per(p({ food: 1500, contacts: 3, traffic: 0.5 }))
    expect(hungry.aggression).toBeGreaterThan(fed.aggression)
    expect(hungry.diplomacy).toBeLessThan(fed.diplomacy)
  })

  it('makes a trading nation more mercantile', () => {
    expect(per(p({ traffic: 1.5, coast: 200, luxuries: 15 })).mercantilism).toBeGreaterThan(
      per(p({ traffic: 0, coast: 0, luxuries: 0 })).mercantilism
    )
  })

  it('makes a nation with neighbours and trade more diplomatic', () => {
    expect(per(p({ contacts: 6, traffic: 1 })).diplomacy).toBeGreaterThan(
      per(p({ contacts: 0, traffic: 0 })).diplomacy
    )
  })

  it('makes a nation with strongholds and iron more militaristic', () => {
    expect(per(p({ defence: 50, metals: 30, horses: 20 })).militarism).toBeGreaterThan(
      per(p({ defence: 0, metals: 0, horses: 0 })).militarism
    )
  })

  it('nudges the traits by government, a little', () => {
    const monarchy = per(p(), 'monarchy')
    expect(per(p(), 'empire').expansionism).toBeGreaterThan(monarchy.expansionism)
    expect(per(p(), 'empire').aggression).toBeGreaterThan(monarchy.aggression)
    expect(per(p(), 'republic').mercantilism).toBeGreaterThan(monarchy.mercantilism)
    expect(per(p(), 'theocracy').aggression).toBeLessThan(monarchy.aggression)
    expect(per(p(), 'dictatorship').militarism).toBeGreaterThan(monarchy.militarism)
    for (const k of [
      'aggression',
      'expansionism',
      'diplomacy',
      'mercantilism',
      'militarism'
    ] as const) {
      expect(Math.abs(per(p(), 'empire')[k] - monarchy[k])).toBeLessThanOrEqual(0.16)
    }
  })

  it('shifts each trait by at most 0.06 for chance, in the direction of the draw', () => {
    const still = per(p())
    const up = per(p(), 'monarchy', Array(5).fill(1))
    const down = per(p(), 'monarchy', Array(5).fill(-1))
    for (const k of [
      'aggression',
      'expansionism',
      'diplomacy',
      'mercantilism',
      'militarism'
    ] as const) {
      expect(up[k] - still[k]).toBeCloseTo(0.06, 6)
      expect(down[k] - still[k]).toBeCloseTo(-0.06, 6)
    }
  })

  it('is the same twice', () => {
    expect(per(p())).toEqual(per(p()))
  })
})
