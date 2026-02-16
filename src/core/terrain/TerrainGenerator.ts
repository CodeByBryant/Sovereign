/**
 * @module TerrainGenerator
 * @description Multi-layer procedural terrain generation.
 *
 * Produces four independent Float32Array fields — elevation, temperature,
 * humidity and biome-noise variation — and can render each into an
 * {@link ImageData} for display.
 *
 * Noise is seeded with domain-prefixed strings so every layer is
 * deterministically reproducible from a single seed.
 *
 * @example
 * ```ts
 * const gen = new TerrainGenerator('my-seed')
 * const elev = gen.generateElevationField(terrainConfig)
 * const elevImg = gen.generateElevationMap(elev, terrainConfig)
 * ```
 */
import { createNoise2D } from 'simplex-noise'
import alea from 'alea'

/* ------------------------------------------------------------------ */
/*  Interfaces                                                         */
/* ------------------------------------------------------------------ */

/**
 * Shared parameters for fractal Brownian motion (fBm) noise sampling.
 *
 * @property scale       - Base frequency multiplier (smaller → larger features).
 * @property octaves     - Number of noise layers to sum.
 * @property persistence - Amplitude decay per octave (0–1).
 * @property lacunarity  - Frequency multiplier per octave (usually 2).
 */
export interface NoiseLayerConfig {
  scale: number
  octaves: number
  persistence: number
  lacunarity: number
}

/**
 * Elevation-specific generation parameters.
 *
 * Extends {@link NoiseLayerConfig} with map dimensions, sea-level,
 * island falloff toggle, and continent/ocean shaping knobs.
 */
export interface TerrainConfig extends NoiseLayerConfig {
  seaLevel: number
  islandMode: boolean
  width: number
  height: number
  /** Frequency for broad continental shapes. */
  continentScale: number
  /** Blend weight of continent layer (0–1). */
  continentStrength: number
  /** Frequency for ocean-depth carving. */
  oceanScale: number
  /** Subtractive strength of ocean layer. */
  oceanStrength: number
  /** Elevation redistribution power curve (>1 flattens lowlands, steepens highlands). @default 1.4 */
  redistributionPower?: number
}

/**
 * Temperature field parameters.
 *
 * Temperature combines latitude gradient, noise, and an
 * elevation-cooling penalty.
 */
export interface TemperatureConfig extends NoiseLayerConfig {
  /** How strongly latitude controls temperature (0–1). */
  latitudeStrength: number
  /** Temperature penalty multiplied by elevation (0–1). */
  elevationCooling: number
  /** How strongly continental interior amplifies temperature extremes (0–1). @default 0.3 */
  continentalStrength?: number
}

/**
 * Humidity field parameters.
 *
 * Humidity is a blend of noise, BFS coastal distance, and an
 * elevation-drying factor.
 */
export interface HumidityConfig extends NoiseLayerConfig {
  /** Blend weight of coastal proximity on humidity (0–1). */
  coastalInfluence: number
  /** Humidity penalty multiplied by elevation (0–1). */
  elevationDrying: number
}

/**
 * Biome variation noise parameters.
 *
 * Provides per-tile jitter values that are applied inside the
 * biome classifier to create softer biome edges.
 */
export interface BiomeNoiseConfig extends NoiseLayerConfig {}

/* ------------------------------------------------------------------ */
/*  Generator class                                                    */
/* ------------------------------------------------------------------ */

/**
 * Procedural terrain generator backed by simplex noise (via `simplex-noise`
 * + `alea` PRNG).  Each noise layer is seeded independently so elevation,
 * temperature, humidity and biome-variation are decorrelated.
 */
export class TerrainGenerator {
  private elevationNoise: (x: number, y: number) => number
  private continentNoise: (x: number, y: number) => number
  private oceanNoise: (x: number, y: number) => number
  private temperatureNoise: (x: number, y: number) => number
  private humidityNoise: (x: number, y: number) => number
  private biomeNoise: (x: number, y: number) => number

  /** @param seed - A string or number used to deterministically seed all noise layers. */
  constructor(seed: string | number) {
    this.elevationNoise = this.createNoise(`${seed}-elevation`)
    this.continentNoise = this.createNoise(`${seed}-continent`)
    this.oceanNoise = this.createNoise(`${seed}-ocean`)
    this.temperatureNoise = this.createNoise(`${seed}-temperature`)
    this.humidityNoise = this.createNoise(`${seed}-humidity`)
    this.biomeNoise = this.createNoise(`${seed}-biome-variation`)
  }

  /* ---------------------------------------------------------------- */
  /*  Elevation                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Produce a raw elevation field in [0, 1].
   *
   * Combines three sub-layers:
   * 1. **Base** – fine-grained terrain noise (fBm).
   * 2. **Continent** – low-frequency shaping.
   * 3. **Ocean** – subtractive carving to deepen seas.
   *
   * If `config.islandMode` is true the result is multiplied by an
   * elliptical falloff so land doesn't touch map edges.
   */
  generateElevationField(config: TerrainConfig): Float32Array {
    const { width, height } = config
    const elevations = new Float32Array(width * height)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const base = this.sampleLayer(x, y, config, this.elevationNoise)
        const continent = this.sampleLayer(
          x,
          y,
          { scale: config.continentScale, octaves: 2, persistence: 0.6, lacunarity: 2 },
          this.continentNoise
        )
        const ocean = this.sampleLayer(
          x,
          y,
          { scale: config.oceanScale, octaves: 2, persistence: 0.6, lacunarity: 2 },
          this.oceanNoise
        )
        const raw = this.clamp01(
          base * (1 - config.continentStrength) +
            continent * config.continentStrength -
            ocean * config.oceanStrength
        )
        // Redistribution: exponent > 1 flattens lowlands and steepens highlands
        const elevation = Math.pow(raw, config.redistributionPower ?? 1.4)
        const index = y * width + x
        elevations[index] = config.islandMode
          ? elevation * this.islandFalloff(x, y, width, height)
          : elevation
      }
    }

    return elevations
  }

  /**
   * Render an elevation array to greyscale {@link ImageData}.
   * Sea pixels are black; land is linearly mapped 0–255.
   */
  generateElevationMap(elevation: Float32Array, config: TerrainConfig): ImageData {
    const { width, height, seaLevel } = config
    const imageData = new ImageData(width, height)

    for (let i = 0; i < elevation.length; i += 1) {
      const value = elevation[i]
      const normalized = value <= seaLevel ? 0 : (value - seaLevel) / (1 - seaLevel)
      const shade = Math.round(normalized * 255)
      const index = i * 4
      imageData.data[index] = shade
      imageData.data[index + 1] = shade
      imageData.data[index + 2] = shade
      imageData.data[index + 3] = 255
    }

    return imageData
  }

  /* ---------------------------------------------------------------- */
  /*  Temperature                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Generate a temperature field in [0, 1].
   *
   * Hotter at the equator (centre row), cooler toward poles and high
   * elevations.  Noise prevents lat-bands from looking perfectly straight.
   */
  generateTemperatureField(
    elevation: Float32Array,
    terrain: TerrainConfig,
    config: TemperatureConfig,
    waterDistance?: Float32Array
  ): Float32Array {
    const { width, height } = terrain
    const temperatures = new Float32Array(width * height)
    const continentalStrength = config.continentalStrength ?? 0.3

    for (let y = 0; y < height; y += 1) {
      const latitude = 1 - Math.abs((y / height) * 2 - 1)
      for (let x = 0; x < width; x += 1) {
        const noise = this.sampleLayer(x, y, config, this.temperatureNoise)
        const index = y * width + x
        const elevationCooling = elevation[index] * config.elevationCooling
        let temp = this.clamp01(
          latitude * config.latitudeStrength +
            noise * (1 - config.latitudeStrength) -
            elevationCooling
        )
        // Continentality: interior tiles have more extreme temperatures
        if (waterDistance && continentalStrength > 0) {
          const inland = waterDistance[index]
          temp = this.clamp01(temp + (temp - 0.5) * continentalStrength * inland)
        }
        temperatures[index] = temp
      }
    }

    return temperatures
  }

  /**
   * Render temperature to a blue→red gradient {@link ImageData}.
   */
  generateTemperatureMap(temperature: Float32Array, terrain: TerrainConfig): ImageData {
    const { width, height } = terrain
    const imageData = new ImageData(width, height)

    for (let i = 0; i < temperature.length; i += 1) {
      const color = this.lerpColor([35, 78, 150], [210, 62, 52], temperature[i])
      const pixel = i * 4
      imageData.data[pixel] = color[0]
      imageData.data[pixel + 1] = color[1]
      imageData.data[pixel + 2] = color[2]
      imageData.data[pixel + 3] = 255
    }

    return imageData
  }

  /* ---------------------------------------------------------------- */
  /*  Humidity                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Generate a humidity field in [0, 1].
   *
   * Higher near coasts (via BFS water distance), lower at high
   * elevations.  Noise adds variance so the map isn't purely smooth
   * distance-gradient.
   */
  generateHumidityField(
    elevation: Float32Array,
    terrain: TerrainConfig,
    config: HumidityConfig,
    precomputedWaterDistance?: Float32Array
  ): Float32Array {
    const { width, height, seaLevel } = terrain
    const humidity = new Float32Array(width * height)
    const waterDistance =
      precomputedWaterDistance ?? this.computeDistanceToWater(elevation, width, height, seaLevel)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        const noise = this.sampleLayer(x, y, config, this.humidityNoise)
        const coastal = 1 - waterDistance[index]
        const elevationDrying = elevation[index] * config.elevationDrying
        humidity[index] = this.clamp01(
          noise * (1 - config.coastalInfluence) +
            coastal * config.coastalInfluence -
            elevationDrying
        )
      }
    }

    return humidity
  }

  /**
   * Render humidity to a brown→blue gradient {@link ImageData}.
   */
  generateHumidityMap(humidity: Float32Array, terrain: TerrainConfig): ImageData {
    const { width, height } = terrain
    const imageData = new ImageData(width, height)

    for (let i = 0; i < humidity.length; i += 1) {
      const color = this.lerpColor([120, 89, 52], [44, 118, 182], humidity[i])
      const pixel = i * 4
      imageData.data[pixel] = color[0]
      imageData.data[pixel + 1] = color[1]
      imageData.data[pixel + 2] = color[2]
      imageData.data[pixel + 3] = 255
    }

    return imageData
  }

  /* ---------------------------------------------------------------- */
  /*  Biome variation noise                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Generate a [0, 1] noise field used to jitter temperature/humidity
   * inside the biome classifier, creating softer biome boundaries.
   */
  generateBiomeNoiseField(config: BiomeNoiseConfig, terrain: TerrainConfig): Float32Array {
    const { width, height } = terrain
    const field = new Float32Array(width * height)

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        field[y * width + x] = this.sampleLayer(x, y, config, this.biomeNoise)
      }
    }

    return field
  }

  /* ---------------------------------------------------------------- */
  /*  Private helpers                                                  */
  /* ---------------------------------------------------------------- */

  /** Create a seeded 2-D simplex noise function. */
  private createNoise(seed: string): (x: number, y: number) => number {
    const rng = alea(seed)
    return createNoise2D(rng)
  }

  /**
   * Fractal Brownian motion (fBm) sampler.
   *
   * Sums `config.octaves` layers, each with halving amplitude
   * (`persistence`) and doubling frequency (`lacunarity`), then
   * normalises the result to [0, 1].
   */
  private sampleLayer(
    x: number,
    y: number,
    config: NoiseLayerConfig,
    noise: (x: number, y: number) => number
  ): number {
    let amplitude = 1
    let frequency = config.scale
    let value = 0
    let maxAmplitude = 0

    for (let octave = 0; octave < config.octaves; octave += 1) {
      const sample = noise(x * frequency, y * frequency)
      value += (sample + 1) * 0.5 * amplitude
      maxAmplitude += amplitude
      amplitude *= config.persistence
      frequency *= config.lacunarity
    }

    return maxAmplitude > 0 ? value / maxAmplitude : 0
  }

  /** Elliptical falloff for island mode – zero at edges, one at centre. */
  private islandFalloff(x: number, y: number, width: number, height: number): number {
    const nx = (x / width) * 2 - 1
    const ny = (y / height) * 2 - 1
    return Math.max(0, 1 - Math.sqrt(nx * nx + ny * ny))
  }

  /**
   * BFS distance-to-water, normalised to [0, 1].
   *
   * Seeds the queue with every sea tile (`elevation <= seaLevel`),
   * then flood-fills outward computing Manhattan distance.  The result
   * is divided by the maximum distance found so coastal tiles → 0,
   * inland centres → 1.
   */
  computeDistanceToWater(
    elevation: Float32Array,
    width: number,
    height: number,
    seaLevel: number
  ): Float32Array {
    const size = width * height
    const distances = new Int32Array(size)
    distances.fill(-1)

    // Single flat-index queue instead of separate X/Y arrays (saves 9.6 MB)
    const queue = new Int32Array(size)
    let head = 0
    let tail = 0

    for (let i = 0; i < size; i += 1) {
      if (elevation[i] <= seaLevel) {
        distances[i] = 0
        queue[tail] = i
        tail += 1
      }
    }

    while (head < tail) {
      const idx = queue[head]
      const distance = distances[idx]
      head += 1
      const x = idx % width
      const y = (idx - x) / width

      // Right
      if (x + 1 < width && distances[idx + 1] === -1) {
        distances[idx + 1] = distance + 1
        queue[tail++] = idx + 1
      }
      // Left
      if (x - 1 >= 0 && distances[idx - 1] === -1) {
        distances[idx - 1] = distance + 1
        queue[tail++] = idx - 1
      }
      // Down
      const below = idx + width
      if (y + 1 < height && distances[below] === -1) {
        distances[below] = distance + 1
        queue[tail++] = below
      }
      // Up
      const above = idx - width
      if (y - 1 >= 0 && distances[above] === -1) {
        distances[above] = distance + 1
        queue[tail++] = above
      }
    }

    let maxDistance = 1
    for (let i = 0; i < size; i += 1) {
      if (distances[i] > maxDistance) maxDistance = distances[i]
    }

    const normalized = new Float32Array(size)
    for (let i = 0; i < size; i += 1) {
      normalized[i] = distances[i] <= 0 ? 0 : distances[i] / maxDistance
    }

    return normalized
  }

  /** Linearly interpolate between two RGB colour tuples. */
  private lerpColor(
    start: [number, number, number],
    end: [number, number, number],
    t: number
  ): [number, number, number] {
    return [
      Math.round(start[0] + (end[0] - start[0]) * t),
      Math.round(start[1] + (end[1] - start[1]) * t),
      Math.round(start[2] + (end[2] - start[2]) * t)
    ]
  }

  /** Clamp a number to the [0, 1] range. */
  private clamp01(value: number): number {
    return Math.min(1, Math.max(0, value))
  }
}
