/**
 * @module placement
 * @description Where each resource is found. Instead of thresholding noise, every resource has a rule
 * (data, in `@sovereign/config`) made of
 *
 * - **hard gates**: which biomes can hold it and in what ranges of elevation, temperature, humidity and
 *   distance to the coast;
 * - **soft preferences**: ridges, basins, slopes, height, rivers, the coast, wet and warm ground;
 * - a **regional factor**: smooth geology or ecology noise, from the `geology` stream, that makes whole
 *   regions rich or barren, so scarcity is geographic.
 *
 * Every tile that passes the gates gets a score; the tiles with the highest scores, up to the rule's
 * `share` of the land (or of the water), get the resource. Taking the top share by rank makes the
 * abundance exact on every seed, and since scores are smooth the resource forms coherent patches and
 * veins instead of speckle. Resources claim tiles rarest first, so a rare resource gets its best sites
 * before a common one takes them; each tile has two slots (surface and ground), so one resource per
 * slot, and a richness (1 to 255) from how high the tile ranked: the core of a patch is richest.
 *
 * Deterministic: only `+ - * /` and exact functions, a fixed processing order, and ties (equal scores)
 * broken by tile index.
 */
import {
  BIOME_INDEX,
  BIOME_KEYS,
  RESOURCE_CATALOG,
  type ResourceDef,
  type ResourceSlot,
  type ResourceSlots
} from '@sovereign/contracts'
import type { Range, ResourcePlacementConfig, ResourceRule } from '@sovereign/config'
import { createSimplexNoise2D } from '../noise/simplex'
import { createStream } from '../random/streams'
import { distanceToMask, slopeField, topographicPosition } from './features'

export interface PlacementInput {
  /** The engine seed (a uint32). */
  seed: number
  width: number
  height: number
  seaLevel: number
  elevation: Float32Array
  temperature: Float32Array
  humidity: Float32Array
  biomeIds: Uint8Array
  riverMask: Uint8Array
  config: ResourcePlacementConfig
}

/** Distances (tiles) are measured up to this far; a rule may not ask for more. */
const DISTANCE_LIMIT = 255
/** The smallest score a tile can have once it passes the gates, so a strong dislike never zeroes it. */
const SCORE_FLOOR = 0.05
/** Bins of the score histogram that picks the top tiles. */
const SCORE_BINS = 65536

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** A smooth field in [-1, 1] that can be asked about one tile at a time. */
export interface RegionalSampler {
  at(x: number, y: number): number
}

/**
 * A smooth noise field in [-1, 1] with features about `regionSize` tiles across: the noise is sampled
 * on a coarse grid and interpolated per tile, which is much cheaper than sampling every tile and loses
 * nothing at this scale. Asking tile by tile (instead of filling a whole-map array) means a rule only
 * pays for the tiles that pass its gates. The value is rounded to float32, like a stored field.
 */
export function regionalSampler(
  noise: (x: number, y: number) => number,
  regionSize: number,
  width: number,
  height: number
): RegionalSampler {
  const stride = clamp(Math.floor(regionSize / 6), 1, 16)
  const gw = Math.ceil((width - 1) / stride) + 1
  const gh = Math.ceil((height - 1) / stride) + 1
  const frequency = 1 / regionSize
  const grid = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      grid[gy * gw + gx] = clamp(noise(gx * stride * frequency, gy * stride * frequency), -1, 1)
    }
  }
  return {
    at(x: number, y: number): number {
      const gy = Math.floor(y / stride)
      const fy = y / stride - gy
      const gy1 = Math.min(gy + 1, gh - 1)
      const gx = Math.floor(x / stride)
      const fx = x / stride - gx
      const gx1 = Math.min(gx + 1, gw - 1)
      const top = grid[gy * gw + gx] * (1 - fx) + grid[gy * gw + gx1] * fx
      const bottom = grid[gy1 * gw + gx] * (1 - fx) + grid[gy1 * gw + gx1] * fx
      return Math.fround(top * (1 - fy) + bottom * fy)
    }
  }
}

/** The regional field of every tile, as an array (see {@link regionalSampler}). */
export function regionalField(
  noise: (x: number, y: number) => number,
  regionSize: number,
  width: number,
  height: number
): Float32Array {
  const sampler = regionalSampler(noise, regionSize, width, height)
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) out[y * width + x] = sampler.at(x, y)
  }
  return out
}

/** A rule applied to one kind of tile: land, or water. */
interface Pass {
  def: ResourceDef
  rule: ResourceRule
  water: boolean
  share: number
  coastDistance: Range | undefined
  /** The hard limits of this pass: a land or fishery pass uses the rule's, an offshore one its own. */
  elevation: Range | undefined
  temperature: Range | undefined
  humidity: Range | undefined
}

function checkRange(name: string, range: Range | undefined): void {
  if (range === undefined) return
  if (range.length !== 2 || !(range[0] <= range[1])) {
    throw new RangeError(`${name} must be a [min, max] range with min <= max`)
  }
}

function validate(input: PlacementInput): void {
  const size = input.width * input.height
  const lengths: Array<[string, number]> = [
    ['elevation', input.elevation.length],
    ['temperature', input.temperature.length],
    ['humidity', input.humidity.length],
    ['biomeIds', input.biomeIds.length],
    ['riverMask', input.riverMask.length]
  ]
  for (const [name, length] of lengths) {
    if (length !== size) throw new RangeError(`${name} must have one entry per tile (${size})`)
  }
  const { features, rules } = input.config
  if (!Number.isInteger(features.ridgeRadius) || features.ridgeRadius < 1) {
    throw new RangeError('features.ridgeRadius must be an integer of at least 1')
  }
  if (!(features.ridgeScale > 0) || !(features.slopeScale > 0)) {
    throw new RangeError('features.ridgeScale and features.slopeScale must be greater than 0')
  }
  const known = new Set(RESOURCE_CATALOG.map((d) => d.key))
  // Enumerating the rules only checks them: whether this throws does not depend on the order.
  // eslint-disable-next-line no-restricted-properties
  for (const [key, rule] of Object.entries(rules)) {
    if (!known.has(key)) throw new RangeError(`unknown resource "${key}"`)
    if (!(rule.share >= 0 && rule.share <= 1))
      throw new RangeError(`${key}.share must be from 0 to 1`)
    if (!(rule.regional >= 0 && rule.regional <= 1)) {
      throw new RangeError(`${key}.regional must be from 0 to 1`)
    }
    if (!(rule.regionSize > 0)) throw new RangeError(`${key}.regionSize must be greater than 0`)
    for (const name of ['elevation', 'temperature', 'humidity', 'coastDistance'] as const) {
      checkRange(`${key}.${name}`, rule[name])
    }
    if (rule.offshore !== undefined) {
      if (!(rule.offshore.share >= 0 && rule.offshore.share <= 1)) {
        throw new RangeError(`${key}.offshore.share must be from 0 to 1`)
      }
      checkRange(`${key}.offshore.coastDistance`, rule.offshore.coastDistance)
      checkRange(`${key}.offshore.elevation`, rule.offshore.elevation)
    }
  }
}

/**
 * Place every resource for which the config has a rule. Returns fresh slots (the inputs are not
 * modified): for each tile a surface and a ground resource, each with its richness and a full stock.
 */
export function placeResources(input: PlacementInput): ResourceSlots {
  validate(input)
  const { width, height, seaLevel, elevation, temperature, humidity, biomeIds, riverMask } = input
  const { features, rules } = input.config
  const size = width * height

  const newSlot = (): ResourceSlot => ({
    type: new Uint8Array(size),
    richness: new Uint8Array(size),
    stock: new Uint8Array(size)
  })
  const slots: ResourceSlots = { surface: newSlot(), ground: newSlot() }

  // ---- what the terrain is like ----
  const land = new Uint8Array(size)
  const sea = new Uint8Array(size)
  let landCount = 0
  for (let i = 0; i < size; i += 1) {
    if (elevation[i] > seaLevel) {
      land[i] = 1
      landCount += 1
    } else {
      sea[i] = 1
    }
  }
  const waterCount = size - landCount
  // the tiles of each domain in ascending order, so a pass walks only the tiles it can use
  const landTiles = new Int32Array(landCount)
  const seaTiles = new Int32Array(waterCount)
  for (let i = 0, l = 0, w = 0; i < size; i += 1) {
    if (land[i] === 1) {
      landTiles[l] = i
      l += 1
    } else {
      seaTiles[w] = i
      w += 1
    }
  }
  const toSea = distanceToMask(sea, width, height, DISTANCE_LIMIT) // for a land tile: steps to the sea
  const toLand = distanceToMask(land, width, height, DISTANCE_LIMIT) // for a water tile: steps to land
  const toRiver = distanceToMask(riverMask, width, height, DISTANCE_LIMIT)
  // against the surrounding land only: a coast stands above the sea but is not a ridge
  const position = topographicPosition(elevation, width, height, features.ridgeRadius, land)
  const slope = slopeField(elevation, width, height)

  // ---- one noise per resource, in catalogue order, from one stream ----
  const stream = createStream(input.seed, 'geology')
  const noises = RESOURCE_CATALOG.map(() => createSimplexNoise2D(stream))

  // ---- the passes: land for most resources, water for fish and kin, both for oil and salt ----
  const passes: Pass[] = []
  for (const def of RESOURCE_CATALOG) {
    const rule = rules[def.key]
    if (rule === undefined) continue
    if (def.domain === 'land' || def.domain === 'both') {
      passes.push({
        def,
        rule,
        water: false,
        share: rule.share,
        coastDistance: rule.coastDistance,
        elevation: rule.elevation,
        temperature: rule.temperature,
        humidity: rule.humidity
      })
    }
    if (def.domain === 'water') {
      passes.push({
        def,
        rule,
        water: true,
        share: rule.share,
        coastDistance: rule.coastDistance,
        elevation: rule.elevation,
        temperature: rule.temperature,
        humidity: rule.humidity
      })
    }
    if (def.domain === 'both' && rule.offshore !== undefined) {
      passes.push({
        def,
        rule,
        water: true,
        share: rule.offshore.share,
        coastDistance: rule.offshore.coastDistance,
        elevation: rule.offshore.elevation,
        temperature: undefined,
        humidity: undefined
      })
    }
  }
  // rarest first, so a rare resource gets its best sites before a common one takes them
  passes.sort((a, b) => a.share - b.share || a.def.id - b.def.id)

  const candidateIndex = new Int32Array(size)
  const candidateScore = new Float32Array(size)
  const bins = new Uint32Array(SCORE_BINS)

  for (const pass of passes) {
    const { def, rule } = pass
    const slot = slots[def.layer]
    const region = regionalSampler(noises[def.id - 1], rule.regionSize, width, height)
    const prefer = rule.prefer ?? {}

    // biome weights (land only)
    const biomeWeight = new Float32Array(256).fill(0)
    if (!pass.water) {
      if (rule.biomes === undefined) biomeWeight.fill(1)
      else {
        for (const key of BIOME_KEYS) {
          const weight = rule.biomes[key]
          if (weight !== undefined) biomeWeight[BIOME_INDEX[key]] = weight
        }
      }
    }

    // ---- score every tile that passes the gates ----
    // The rule's limits and weights are read once, not per tile.
    const tiles = pass.water ? seaTiles : landTiles
    const eLo = pass.elevation?.[0] ?? -Infinity
    const eHi = pass.elevation?.[1] ?? Infinity
    const tLo = pass.temperature?.[0] ?? -Infinity
    const tHi = pass.temperature?.[1] ?? Infinity
    const hLo = pass.humidity?.[0] ?? -Infinity
    const hHi = pass.humidity?.[1] ?? Infinity
    const cLo = pass.coastDistance?.[0] ?? -Infinity
    const cHi = pass.coastDistance?.[1] ?? Infinity
    const coastField = pass.water ? toLand : toSea
    const ridgeW = prefer.ridge
    const basinW = prefer.basin
    const slopeW = prefer.slope
    const heightW = prefer.height
    const riverP = prefer.river
    const coastP = prefer.coast
    const wetW = prefer.wet
    const warmW = prefer.warm
    const regional = rule.regional
    let count = 0
    let min = Infinity
    let max = -Infinity
    for (let k = 0; k < tiles.length; k += 1) {
      const i = tiles[k]
      if (slot.type[i] !== 0) continue
      const base = pass.water ? 1 : biomeWeight[biomeIds[i]]
      if (base <= 0) continue
      const e = elevation[i]
      if (e < eLo || e > eHi) continue
      const t = temperature[i]
      if (t < tLo || t > tHi) continue
      const h = humidity[i]
      if (h < hLo || h > hHi) continue
      const coast = coastField[i]
      if (coast < cLo || coast > cHi) continue

      let preference = 1
      if (ridgeW !== undefined)
        preference += ridgeW * clamp(position[i] / features.ridgeScale, -1, 1)
      if (basinW !== undefined)
        preference += basinW * clamp(-position[i] / features.ridgeScale, -1, 1)
      if (slopeW !== undefined) preference += slopeW * clamp(slope[i] / features.slopeScale, 0, 1)
      if (heightW !== undefined) {
        preference += heightW * clamp((e - seaLevel) / (1 - seaLevel), 0, 1)
      }
      if (riverP !== undefined) {
        preference += riverP.weight * Math.max(0, 1 - toRiver[i] / riverP.within)
      }
      if (coastP !== undefined) {
        preference += coastP.weight * Math.max(0, 1 - coast / coastP.within)
      }
      if (wetW !== undefined) preference += wetW * h
      if (warmW !== undefined) preference += warmW * t

      const x = i % width
      const regionValue = region.at(x, (i - x) / width)
      const score = base * Math.max(SCORE_FLOOR, preference) * (1 + regional * regionValue)
      candidateIndex[count] = i
      candidateScore[count] = score
      count += 1
      if (score < min) min = score
      if (score > max) max = score
    }

    const denominator = pass.water ? waterCount : landCount
    const target = Math.min(count, Math.round(pass.share * denominator))
    if (target <= 0) continue

    // ---- take the highest-scoring `target` tiles: a histogram finds the cut-off ----
    const range = max - min
    const binOf = (score: number): number =>
      range > 0 ? Math.min(SCORE_BINS - 1, Math.floor(((score - min) / range) * SCORE_BINS)) : 0
    bins.fill(0)
    for (let c = 0; c < count; c += 1) bins[binOf(candidateScore[c])] += 1
    let cutBin = SCORE_BINS - 1
    let above = 0
    while (cutBin > 0 && above + bins[cutBin] < target) {
      above += bins[cutBin]
      cutBin -= 1
    }
    let remainingInCutBin = target - above
    const cutScore = min + (cutBin / SCORE_BINS) * range
    for (let c = 0; c < count; c += 1) {
      const b = binOf(candidateScore[c])
      if (b < cutBin) continue
      if (b === cutBin) {
        if (remainingInCutBin === 0) continue
        remainingInCutBin -= 1
      }
      // richness from how far above the cut-off the tile scored: the core of a patch is richest
      const span = max - cutScore
      const rank = span > 0 ? clamp((candidateScore[c] - cutScore) / span, 0, 1) : 1
      const richness = 1 + Math.round(254 * rank)
      const i = candidateIndex[c]
      slot.type[i] = def.id
      slot.richness[i] = richness
      slot.stock[i] = richness
    }
  }
  return slots
}
