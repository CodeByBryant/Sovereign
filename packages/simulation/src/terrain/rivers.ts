/**
 * @module RiverGenerator
 * @description Minecraft-style procedural river generation.
 *
 * Rivers are placed at the **zero-crossings** of simplex noise:
 * wherever `|noise(x,y)| < threshold` a river tile is marked.
 * Two noise layers create wide primary rivers and thinner
 * tributaries.  Domain-warping adds organic curvature.
 *
 * @example
 * ```ts
 * const rivers = new RiverGenerator(seed)
 * const data = rivers.generate(elevation, humidity, terrain, config)
 * ```
 */
import { createSimplexNoise2D } from '../noise/simplex'
import { createStream } from '../random/streams'
import type { RiverConfig, TerrainConfig } from '@sovereign/config'

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface RiverData {
  /** 1 = river, 0 = no river. Per-tile. */
  riverMask: Uint8Array
  /** Per-tile river width for rendering. */
  riverWidth: Uint8Array
  /** Humidity field with river moisture boost applied. */
  humidity: Float32Array
}

/* ------------------------------------------------------------------ */
/*  Generator - Minecraft-style noise rivers                           */
/* ------------------------------------------------------------------ */

export class RiverGenerator {
  private primaryNoise: (x: number, y: number) => number
  private secondaryNoise: (x: number, y: number) => number
  private warpNoiseX: (x: number, y: number) => number
  private warpNoiseY: (x: number, y: number) => number
  private widthNoise: (x: number, y: number) => number

  /** @param seed - The engine seed (a uint32, see `normalizeSeed`). */
  constructor(seed: number) {
    this.primaryNoise = createSimplexNoise2D(createStream(seed, 'riverPrimary'))
    this.secondaryNoise = createSimplexNoise2D(createStream(seed, 'riverSecondary'))
    this.warpNoiseX = createSimplexNoise2D(createStream(seed, 'riverWarpX'))
    this.warpNoiseY = createSimplexNoise2D(createStream(seed, 'riverWarpY'))
    this.widthNoise = createSimplexNoise2D(createStream(seed, 'riverWidth'))
  }

  /* ---------------------------------------------------------------- */
  /*  Main generation                                                  */
  /* ---------------------------------------------------------------- */

  generate(
    elevation: Float32Array,
    humidity: Float32Array,
    terrain: TerrainConfig,
    config: RiverConfig
  ): RiverData {
    const { width, height, seaLevel } = terrain
    const size = width * height
    const riverMask = new Uint8Array(size)
    const riverWidth = new Uint8Array(size)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const elev = elevation[index]

        // Skip water tiles
        if (elev <= seaLevel) continue

        // ---- domain-warp for more organic shapes ----
        const warpStrength = config.warpStrength ?? 40
        const wx = x + this.warpNoiseX(x * 0.002, y * 0.002) * warpStrength
        const wy = y + this.warpNoiseY(x * 0.002, y * 0.002) * warpStrength

        const octaves = config.noiseOctaves ?? 3
        const persistence = config.noisePersistence ?? 0.5
        const lacunarity = config.noiseLacunarity ?? 2.2

        // ---- primary rivers (abs-noise zero-crossing) ----
        const p = Math.abs(
          this.sampleNoise(
            this.primaryNoise,
            wx,
            wy,
            config.primaryScale,
            octaves,
            persistence,
            lacunarity
          )
        )
        // ---- secondary (tributaries) ----
        const s = Math.abs(
          this.sampleNoise(
            this.secondaryNoise,
            wx,
            wy,
            config.secondaryScale,
            octaves,
            persistence,
            lacunarity
          )
        )

        // ---- taper near shore so rivers don't start at the waterline ----
        const landRatio = (elev - seaLevel) / (1 - seaLevel)
        const shoreFade = Math.min(1, landRatio / config.shoreTaper)
        // ---- taper in high mountains ----
        const mountainFade =
          landRatio > config.mountainCutoff
            ? Math.max(0, 1 - (landRatio - config.mountainCutoff) / 0.15)
            : 1

        const fade = shoreFade * mountainFade

        const isPrimary = p < config.primaryThreshold * fade
        const isSecondary = s < config.secondaryThreshold * fade && !isPrimary

        if (isPrimary || isSecondary) {
          riverMask[index] = 1

          // Width: closer to zero-crossing = wider
          const widthVar = (this.widthNoise(x * 0.02, y * 0.02) * 0.5 + 0.5) * 0.4 + 0.8
          if (isPrimary) {
            const t = 1 - p / Math.max(0.001, config.primaryThreshold * fade)
            riverWidth[index] = Math.max(2, Math.ceil(config.primaryWidth * t * widthVar))
          } else {
            const t = 1 - s / Math.max(0.001, config.secondaryThreshold * fade)
            riverWidth[index] = Math.max(1, Math.ceil(config.secondaryWidth * t * widthVar))
          }
        }
      }
    }

    // Remove isolated river pixels (noise speckle cleanup)
    this.removeSpeckles(riverMask, riverWidth, width, height)

    const boostedHumidity = this.applyHumidityBoost(humidity, riverMask, terrain, config)

    return { riverMask, riverWidth, humidity: boostedHumidity }
  }

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Multi-octave noise sample used for river zero-crossings.
   * Returns in range ~ [-1, 1].
   */
  private sampleNoise(
    noiseFn: (x: number, y: number) => number,
    x: number,
    y: number,
    scale: number,
    octaves = 3,
    persistence = 0.5,
    lacunarity = 2.2
  ): number {
    let value = 0
    let amp = 1
    let freq = scale
    let maxAmp = 0

    for (let o = 0; o < octaves; o += 1) {
      value += noiseFn(x * freq, y * freq) * amp
      maxAmp += amp
      amp *= persistence
      freq *= lacunarity
    }

    return value / maxAmp
  }

  /**
   * Remove single or very small clusters of river pixels that look
   * like speckling instead of continuous channels.
   */
  private removeSpeckles(
    mask: Uint8Array,
    widthArr: Uint8Array,
    width: number,
    height: number
  ): void {
    const minNeighbors = 2

    const toRemove: number[] = []

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x
        if (!mask[index]) continue

        let neighbors = 0
        if (mask[index - 1]) neighbors += 1
        if (mask[index + 1]) neighbors += 1
        if (mask[index - width]) neighbors += 1
        if (mask[index + width]) neighbors += 1

        if (neighbors < minNeighbors) {
          toRemove.push(index)
        }
      }
    }

    for (const index of toRemove) {
      mask[index] = 0
      widthArr[index] = 0
    }
  }

  private applyHumidityBoost(
    humidity: Float32Array,
    riverMask: Uint8Array,
    terrain: TerrainConfig,
    config: RiverConfig
  ): Float32Array {
    const { width, height } = terrain
    const boosted = new Float32Array(humidity)
    const radius = config.humidityRadius

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        if (!riverMask[index]) continue

        for (let oy = -radius; oy <= radius; oy += 1) {
          for (let ox = -radius; ox <= radius; ox += 1) {
            const nx = x + ox
            const ny = y + oy
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue

            const distSq = ox * ox + oy * oy
            if (distSq > radius * radius) continue
            const dist = Math.sqrt(distSq)

            const boost = config.humidityBoost * (1 - dist / (radius + 0.01))
            const target = ny * width + nx
            // Use max instead of += to prevent overlapping stacking
            boosted[target] = Math.min(1, Math.max(boosted[target], humidity[target] + boost))
          }
        }
      }
    }

    return boosted
  }
}
