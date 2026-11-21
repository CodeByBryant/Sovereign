/**
 * @module derive
 * @description A nation's stats, government and personality, computed from what its land is like
 * ({@link ./profile}), as pure functions: the same profile always gives the same stats, so the simulation
 * can call them again whenever a territory changes.
 *
 * **Stats have no chance in them at all.** Population follows the food the land yields; military follows the
 * people, the metals, horses, timber and stone, and how defensible the ground is; economy follows the
 * resources (their variety and the luxuries), the ports and the trade routes through it; diplomacy follows
 * its neighbours and trade. Government and personality follow the same facts, with a *small* jitter
 * (supplied by the caller, drawn from a seeded stream) so two nations on similar land are not clones.
 *
 * The numbers are a first design. No economy exists yet to say how much of what a nation needs, so the
 * constants below are provisional; the structure (what follows from what) is the point.
 */
import type {
  GovernmentType,
  NationPersonality,
  NationProfile,
  NationStats
} from '@sovereign/contracts'

export const GOVERNMENTS: readonly GovernmentType[] = [
  'monarchy',
  'republic',
  'democracy',
  'theocracy',
  'empire',
  'tribal',
  'oligarchy',
  'dictatorship'
]

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const unit = (v: number): number => clamp(v, 0, 1)

/** The most a draw of chance moves a government score (a score runs about 0 to 1) or a personality trait. */
export const GOVERNMENT_JITTER = 0.08
export const PERSONALITY_JITTER = 0.06

/* ------------------------------------------------------------------ */
/*  Stats                                                              */
/* ------------------------------------------------------------------ */

/** Food that feeds one unit of population. */
const FOOD_PER_PERSON = 8

export function deriveStats(profile: NationProfile): NationStats {
  const population = clamp(Math.round(profile.food / FOOD_PER_PERSON), 5, 300)
  // Each contribution saturates, so one rich seam does not make an army of a hamlet.
  const military = clamp(
    Math.round(
      0.25 * population +
        1 * Math.min(profile.metals, 60) +
        1 * Math.min(profile.horses, 40) +
        0.15 * Math.min(profile.timber + profile.stone, 200) +
        0.8 * Math.min(profile.defence, 40) +
        0.05 * Math.min(profile.highGround, 600)
    ),
    5,
    200
  )
  const economy = clamp(
    Math.round(
      8 +
        4 * profile.diversity +
        4 * Math.min(profile.luxuries, 25) +
        0.15 * Math.min(profile.coast, 300) +
        30 * Math.min(profile.traffic, 1.5) +
        0.1 * population
    ),
    5,
    200
  )
  const diplomacy = clamp(
    Math.round(
      15 + 14 * profile.contacts + 25 * profile.traffic + 0.5 * profile.luxuries + 0.08 * economy
    ),
    5,
    200
  )
  return { population, military, economy, diplomacy }
}

/* ------------------------------------------------------------------ */
/*  Government                                                         */
/* ------------------------------------------------------------------ */

/**
 * The government that suits the land best: each type scores how well the nation fits it (0 to about 1), a
 * little chance (`jitter`, one draw in -1 to 1 per government, in {@link GOVERNMENTS} order) breaks close
 * calls, and the highest score wins (ties to the earlier in the list).
 */
export function deriveGovernment(
  profile: NationProfile,
  stats: NationStats,
  jitter: readonly number[]
): GovernmentType {
  const area = Math.max(1, profile.area)
  const farmland = unit(profile.food / area / 0.9)
  const popN = unit((stats.population - 110) / 100)
  const milN = unit((stats.military - 40) / 70)
  const armed = unit((stats.military - 60) / 70)
  const trade = unit(stats.economy / 120)
  const ports = unit(profile.coast / area / 0.1)
  const wealth = unit(profile.luxuries / 12)
  const metal = unit(profile.metals / 15)
  const contacts = unit(profile.contacts / 4)
  const mountain = unit(profile.highGround / area / 0.4)
  const hungry = 1 - farmland

  const score: Record<GovernmentType, number> = {
    tribal: unit(1 - stats.population / 110) * (1 - 0.4 * trade),
    monarchy: 0.2 + 0.25 * farmland - 0.2 * trade - 0.1 * milN,
    empire: 0.5 * popN + 0.5 * armed,
    republic: 0.35 * trade + 0.5 * ports + 0.2 * unit(profile.traffic / 0.5) - 0.2 * milN,
    oligarchy: 0.5 * wealth + 0.3 * metal + 0.1 * trade - 0.2 * contacts,
    democracy: 0.35 * contacts + 0.35 * trade + 0.2 * wealth - 0.3 * milN - 0.1 * hungry,
    theocracy: 0.2 * (1 - contacts) + 0.7 * mountain - 0.2 * trade,
    dictatorship: 0.6 * milN + 0.4 * hungry + 0.1 * unit(profile.defence / 30) - 0.3 * trade
  }

  let best: GovernmentType = GOVERNMENTS[0] as GovernmentType
  let bestScore = -Infinity
  GOVERNMENTS.forEach((government, i) => {
    const total = score[government] + GOVERNMENT_JITTER * clamp(jitter[i] ?? 0, -1, 1)
    if (total > bestScore) {
      bestScore = total
      best = government
    }
  })
  return best
}

/* ------------------------------------------------------------------ */
/*  Personality                                                        */
/* ------------------------------------------------------------------ */

const TRAIT_MIN = 0.05
const TRAIT_MAX = 0.95

/**
 * How a people tend to act, from the land they have: poor land makes for hunger and expansion, trade for
 * merchants, neighbours for diplomacy, strongholds and iron for soldiers. The government nudges each trait a
 * little, and `jitter` (five draws in -1 to 1: aggression, expansionism, diplomacy, mercantilism, militarism)
 * moves each by at most {@link PERSONALITY_JITTER}.
 */
export function derivePersonality(
  profile: NationProfile,
  stats: NationStats,
  government: GovernmentType,
  jitter: readonly number[]
): NationPersonality {
  const area = Math.max(1, profile.area)
  const scarcity = 1 - unit(profile.food / area / 0.9)
  const martial = unit(stats.military / 120)
  const trade = unit(stats.economy / 120)
  const ports = unit(profile.coast / area / 0.2)
  const contacts = unit(profile.contacts / 4)
  const mountain = unit(profile.highGround / area / 0.4)
  const defence = unit(profile.defence / 30)
  const metal = unit(profile.metals / 15)

  const aggression = 0.15 + 0.45 * scarcity + 0.3 * martial
  const expansionism =
    0.2 + 0.4 * scarcity + 0.25 * unit(stats.population / 150) + 0.1 * (1 - mountain)
  const diplomacy =
    0.2 + 0.3 * contacts + 0.25 * unit(profile.traffic) + 0.1 * trade - 0.15 * aggression
  const mercantilism = 0.15 + 0.5 * trade + 0.2 * ports
  const militarism = 0.15 + 0.35 * defence + 0.3 * martial + 0.1 * metal

  const nudge = GOVERNMENT_NUDGE[government]
  const raw = [
    aggression + (nudge.aggression ?? 0),
    expansionism + (nudge.expansionism ?? 0),
    diplomacy + (nudge.diplomacy ?? 0),
    mercantilism + (nudge.mercantilism ?? 0),
    militarism + (nudge.militarism ?? 0)
  ]
  const [a, e, d, m, k] = raw.map((v, i) =>
    clamp(v + PERSONALITY_JITTER * clamp(jitter[i] ?? 0, -1, 1), TRAIT_MIN, TRAIT_MAX)
  ) as [number, number, number, number, number]
  return { aggression: a, expansionism: e, diplomacy: d, mercantilism: m, militarism: k }
}

/** What each government adds to the traits: a nudge, not a rewrite. */
const GOVERNMENT_NUDGE: Record<GovernmentType, Partial<NationPersonality>> = {
  monarchy: {},
  empire: { aggression: 0.1, expansionism: 0.1 },
  republic: { mercantilism: 0.1, diplomacy: 0.05 },
  democracy: { diplomacy: 0.1, aggression: -0.05 },
  theocracy: { aggression: -0.1, expansionism: -0.05 },
  tribal: { diplomacy: -0.05, mercantilism: -0.05 },
  oligarchy: { mercantilism: 0.1 },
  dictatorship: { militarism: 0.1, aggression: 0.05 }
}
