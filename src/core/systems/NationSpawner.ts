/**
 * @module NationSpawner
 * @description Spawns nations on the world map.
 *
 * Picks N habitable spawn points with minimum spacing, claims a 5×5
 * territory around each, and creates fully-initialised {@link Nation}
 * instances with generated names, colours, flags and personality traits.
 *
 * @example
 * ```ts
 * const nations = spawnNations(elevation, biomeIds, terrainConfig, 12, seed)
 * ```
 */
import alea from 'alea'
import { Nation, type GovernmentType, type NationPersonality } from '../entities/Nation'
import { NameGenerator } from '../entities/NameGenerator'
import { ColorGenerator } from '../entities/ColorGenerator'
import { FlagGenerator } from '../entities/FlagGenerator'
import type { TerrainConfig } from '../terrain/TerrainGenerator'

/* ------------------------------------------------------------------ */
/*  Biome desirability — higher = better spawn location                */
/* ------------------------------------------------------------------ */

/**
 * Biome ids (indices into BIOME_KEYS) that are habitable for spawning.
 * Maps biome id → desirability score (0–1).
 */
const BIOME_DESIRABILITY: Record<number, number> = {
  // grassland (12)
  12: 1.0,
  // woodland (13)
  13: 0.9,
  // temperate_forest (14)
  14: 0.85,
  // steppe (11)
  11: 0.7,
  // savanna (19)
  19: 0.65,
  // boreal_forest (7)
  7: 0.5,
  // chaparral (15)
  15: 0.6,
  // tropical_forest (20)
  20: 0.7,
  // rainforest (21)
  21: 0.55,
  // wetland (22)
  22: 0.3,
  // highland (24)
  24: 0.35,
  // cold_steppe (9)
  9: 0.4,
  // taiga (8)
  8: 0.35,
  // temperate_desert (10)
  10: 0.2,
  // swamp (16)
  16: 0.25,
  // badlands (18)
  18: 0.15
}

const GOVERNMENT_TYPES: GovernmentType[] = [
  'monarchy',
  'republic',
  'democracy',
  'theocracy',
  'empire',
  'tribal',
  'oligarchy',
  'dictatorship'
]

/* ------------------------------------------------------------------ */
/*  Spawn algorithm                                                    */
/* ------------------------------------------------------------------ */

/**
 * Find candidate spawn tiles: habitable, not ocean/extreme, weighted
 * by biome desirability.
 */
function findCandidates(
  elevation: Float32Array,
  biomeIds: Uint8Array,
  riverMask: Uint8Array,
  terrain: TerrainConfig
): { index: number; score: number }[] {
  const { width, height, seaLevel } = terrain
  const candidates: { index: number; score: number }[] = []
  // Sample every 4th tile for speed (we'll have plenty of candidates)
  const step = 4
  for (let y = 4; y < height - 4; y += step) {
    for (let x = 4; x < width - 4; x += step) {
      const idx = y * width + x
      const elev = elevation[idx]
      if (elev <= seaLevel) continue
      const biome = biomeIds[idx]
      const desirability = BIOME_DESIRABILITY[biome]
      if (desirability === undefined || desirability < 0.1) continue
      // Bonus for being near a river
      let riverBonus = 0
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const ni = (y + dy) * width + (x + dx)
          if (ni >= 0 && ni < elevation.length && riverMask[ni]) {
            riverBonus = 0.2
            break
          }
        }
        if (riverBonus > 0) break
      }
      candidates.push({ index: idx, score: desirability + riverBonus })
    }
  }
  return candidates
}

/**
 * Pick N spawn points from candidates ensuring minimum distance between them.
 */
function pickSpawnPoints(
  candidates: { index: number; score: number }[],
  count: number,
  minDist: number,
  width: number,
  rng: () => number
): number[] {
  // Sort by score descending, then pick greedily with distance check
  const shuffled = candidates.slice()
  // Fisher-Yates partial shuffle weighted by score
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = tmp
  }
  // Sort top candidates by score
  shuffled.sort((a, b) => b.score - a.score)

  const selected: number[] = []
  const minDistSq = minDist * minDist

  for (const cand of shuffled) {
    if (selected.length >= count) break
    const cx = cand.index % width
    const cy = (cand.index - cx) / width

    let tooClose = false
    for (const existing of selected) {
      const ex = existing % width
      const ey = (existing - ex) / width
      const dx = cx - ex
      const dy = cy - ey
      if (dx * dx + dy * dy < minDistSq) {
        tooClose = true
        break
      }
    }
    if (!tooClose) {
      selected.push(cand.index)
    }
  }

  return selected
}

/**
 * Claim a 5×5 area around a spawn point, skipping uninhabitable tiles.
 * Returns the set of claimed tile indices.
 */
function claimTerritory(
  spawnIdx: number,
  elevation: Float32Array,
  biomeIds: Uint8Array,
  terrain: TerrainConfig,
  ownerMap: string[],
  nationId: string
): Set<number> {
  const { width, height, seaLevel } = terrain
  const sx = spawnIdx % width
  const sy = (spawnIdx - sx) / width
  const claimed = new Set<number>()
  const radius = 2 // 5×5 → -2 to +2

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = sx + dx
      const ny = sy + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const idx = ny * width + nx
      if (elevation[idx] <= seaLevel) continue
      if (ownerMap[idx] !== '') continue // already claimed
      const biome = biomeIds[idx]
      // Skip ocean / deep ocean / shore / glacier / polar_desert
      if (biome <= 2 || biome === 3 || biome === 4) continue
      ownerMap[idx] = nationId
      claimed.add(idx)
    }
  }
  return claimed
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export interface SpawnResult {
  nations: Nation[]
  /** Per-tile owner id. Empty string = unclaimed. */
  ownerMap: string[]
}

/**
 * Spawn `count` nations on the map.
 *
 * @param elevation     Float32Array of tile elevations.
 * @param biomeIds      Uint8Array of biome indices per tile.
 * @param riverMask     Uint8Array river mask.
 * @param terrain       Terrain config (width, height, seaLevel, etc.).
 * @param count         Number of nations to spawn.
 * @param seed          World seed for deterministic generation.
 * @param minSpacing    Minimum tile distance between spawn points.
 * @returns Nations array and per-tile owner map.
 */
export function spawnNations(
  elevation: Float32Array,
  biomeIds: Uint8Array,
  riverMask: Uint8Array,
  terrain: TerrainConfig,
  count: number,
  seed: string | number,
  minSpacing = 70
): SpawnResult {
  const rng = alea(`${seed}-spawn`)
  const nameGen = new NameGenerator(seed)
  const colorGen = new ColorGenerator(seed)
  const flagGen = new FlagGenerator(seed)

  const { width, height } = terrain
  const ownerMap = new Array<string>(width * height).fill('')

  // Find candidates and pick spawn points
  const candidates = findCandidates(elevation, biomeIds, riverMask, terrain)
  const spawnPoints = pickSpawnPoints(candidates, count, minSpacing, width, rng)

  const nations: Nation[] = []

  for (const spawnIdx of spawnPoints) {
    const id = `nation-${nations.length}`
    const name = nameGen.generate()
    const color = colorGen.generate()
    const flag = flagGen.generate()
    const government = GOVERNMENT_TYPES[Math.floor(rng() * GOVERNMENT_TYPES.length)]

    const personality: NationPersonality = {
      aggression: 0.1 + rng() * 0.8,
      expansionism: 0.1 + rng() * 0.8,
      diplomacy: 0.1 + rng() * 0.8,
      mercantilism: 0.1 + rng() * 0.8,
      militarism: 0.1 + rng() * 0.8
    }

    const provinces = claimTerritory(spawnIdx, elevation, biomeIds, terrain, ownerMap, id)

    const nation = new Nation({
      id,
      name,
      color,
      flag,
      government,
      personality,
      capital: spawnIdx,
      provinces,
      stats: {
        population: Math.floor(50 + rng() * 100),
        military: Math.floor(50 + rng() * 50),
        economy: Math.floor(30 + rng() * 70),
        diplomacy: Math.floor(30 + rng() * 70)
      }
    })

    nations.push(nation)
  }

  return { nations, ownerMap }
}
