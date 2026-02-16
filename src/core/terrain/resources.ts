/**
 * @module ResourceGenerator
 * @description Generates resource layers from terrain data.
 *
 * Each tile gets a `resourceType` (enum 0–7) and `resourceDensity`
 * (0–255). Resources are derived from biome, elevation, humidity,
 * river proximity, and an independent ore noise layer.
 *
 * | Resource    | Source biomes / conditions                        |
 * |-------------|--------------------------------------------------|
 * | Timber      | forest, boreal_forest, taiga, woodland, rainforest |
 * | Stone       | highland, mountain, alpine                        |
 * | Iron        | mountain, highland, badlands + ore noise           |
 * | Gold        | mountain + river-adjacent + rare noise             |
 * | Fertile     | grassland, savanna, wetland + high humidity        |
 * | Fish        | shore-adjacent land                                |
 * | Fur & Game  | taiga, boreal_forest, tundra (cold forests)        |
 */
import { createNoise2D } from 'simplex-noise'
import alea from 'alea'
import { ResourceType } from '../../types/resources'

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface ResourceConfig {
  /** Ore noise frequency. @default 0.008 */
  oreScale: number
  /** Gold rarity threshold (0–1, higher = rarer). @default 0.88 */
  goldRarity: number
  /** Iron rarity threshold (0–1, higher = rarer). @default 0.72 */
  ironRarity: number
  /** Minimum density to register a resource (0–255). @default 30 */
  minDensity: number
}

/* ------------------------------------------------------------------ */
/*  Biome → resource mapping                                          */
/* ------------------------------------------------------------------ */

/** Map biome ID to its primary resource type. null = no inherent resource. */
const BIOME_RESOURCE: Record<number, ResourceType | null> = {
  0: null, // deep_ocean
  1: null, // ocean
  2: null, // shore → handled specially (fish)
  3: null, // polar_desert
  4: null, // glacier
  5: null, // tundra
  6: ResourceType.Stone, // alpine
  7: ResourceType.Timber, // boreal_forest
  8: ResourceType.Fur, // taiga
  9: null, // cold_steppe
  10: null, // temperate_desert
  11: ResourceType.Fertile, // steppe
  12: ResourceType.Fertile, // grassland
  13: ResourceType.Timber, // woodland
  14: ResourceType.Timber, // temperate_forest
  15: null, // chaparral / scrubland
  16: null, // swamp
  17: null, // desert
  18: ResourceType.Stone, // badlands
  19: ResourceType.Fertile, // savanna
  20: ResourceType.Timber, // tropical_forest
  21: ResourceType.Timber, // rainforest
  22: ResourceType.Fertile, // wetland
  23: null, // mangrove
  24: ResourceType.Stone, // highland
  25: ResourceType.Stone // mountain
}

/* ------------------------------------------------------------------ */
/*  Generator                                                          */
/* ------------------------------------------------------------------ */

export function generateResources(
  elevation: Float32Array,
  humidity: Float32Array,
  biomeIds: Uint8Array,
  riverMask: Uint8Array,
  width: number,
  height: number,
  seaLevel: number,
  seed: string | number,
  config: ResourceConfig
): { resourceType: Uint8Array; resourceDensity: Uint8Array } {
  const size = width * height
  const resourceType = new Uint8Array(size)
  const resourceDensity = new Uint8Array(size)

  // Independent noise for ore deposits and density variation
  const oreNoise = createNoise2D(alea(`${seed}-ore`))
  const densityNoise = createNoise2D(alea(`${seed}-res-density`))

  // Pre-compute shore adjacency for fish detection
  const nearWater = new Uint8Array(size)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (elevation[i] > seaLevel) continue // only mark water tiles
      // Mark land neighbours of water tiles
      if (x > 0 && elevation[i - 1] > seaLevel) nearWater[i - 1] = 1
      if (x < width - 1 && elevation[i + 1] > seaLevel) nearWater[i + 1] = 1
      if (y > 0 && elevation[i - width] > seaLevel) nearWater[i - width] = 1
      if (y < height - 1 && elevation[i + width] > seaLevel) nearWater[i + width] = 1
    }
  }

  // Pre-compute river adjacency (within 2 tiles)
  const nearRiver = new Uint8Array(size)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (!riverMask[i]) continue
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let ox = -2; ox <= 2; ox += 1) {
          const nx = x + ox
          const ny = y + oy
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
            nearRiver[ny * width + nx] = 1
          }
        }
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const elev = elevation[i]

      // Skip water tiles
      if (elev <= seaLevel) continue

      const biome = biomeIds[i]
      const oreVal = (oreNoise(x * config.oreScale, y * config.oreScale) + 1) * 0.5
      const densVal = (densityNoise(x * 0.01, y * 0.01) + 1) * 0.5

      // --- Priority: Gold (rarest) > Iron > Fish > biome-default ---

      // Gold: mountain + river-adjacent + rare noise
      if ((biome === 25 || biome === 24) && nearRiver[i] && oreVal > config.goldRarity) {
        resourceType[i] = ResourceType.Gold
        resourceDensity[i] = Math.round(
          ((oreVal - config.goldRarity) / (1 - config.goldRarity)) * 180 + 50
        )
        continue
      }

      // Iron: mountain/highland/badlands + ore noise
      if ((biome === 25 || biome === 24 || biome === 18) && oreVal > config.ironRarity) {
        resourceType[i] = ResourceType.Iron
        resourceDensity[i] = Math.round(
          ((oreVal - config.ironRarity) / (1 - config.ironRarity)) * 200 + 40
        )
        continue
      }

      // Fish: shore-adjacent land tiles
      if (nearWater[i] && biome !== 4 && biome !== 3) {
        resourceType[i] = ResourceType.Fish
        resourceDensity[i] = Math.round(densVal * 150 + 60)
        continue
      }

      // Biome-based default resource
      const baseRes = BIOME_RESOURCE[biome]
      if (baseRes !== null && baseRes !== undefined) {
        const density = Math.round(densVal * 180 + 40)
        if (density >= config.minDensity) {
          resourceType[i] = baseRes

          // Fertile soil gets humidity bonus
          if (baseRes === ResourceType.Fertile) {
            resourceDensity[i] = Math.round(density * (0.5 + humidity[i] * 0.5))
          } else {
            resourceDensity[i] = density
          }
        }
      }
    }
  }

  return { resourceType, resourceDensity }
}
