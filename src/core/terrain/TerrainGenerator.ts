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
export interface BiomeNoiseConfig extends NoiseLayerConfig {
  tempJitter: number
  humidityJitter: number
}

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
  private temperatureNoise: (x: number, y: number) => number
  private humidityNoise: (x: number, y: number) => number
  private biomeNoise: (x: number, y: number) => number

  /** @param seed - A string or number used to deterministically seed all noise layers. */
  constructor(seed: string | number) {
    this.elevationNoise = this.createNoise(`${seed}-elevation`)
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
          this.elevationNoise
        )
        const ocean = this.sampleLayer(
          x,
          y,
          { scale: config.oceanScale, octaves: 2, persistence: 0.6, lacunarity: 2 },
          this.elevationNoise
        )
        const elevation = this.clamp01(
          base * (1 - config.continentStrength) +
            continent * config.continentStrength -
            ocean * config.oceanStrength
        )
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
    config: TemperatureConfig
  ): Float32Array {
    const { width, height } = terrain
    const temperatures = new Float32Array(width * height)

    for (let y = 0; y < height; y += 1) {
      const latitude = 1 - Math.abs((y / height) * 2 - 1)
      for (let x = 0; x < width; x += 1) {
        const noise = this.sampleLayer(x, y, config, this.temperatureNoise)
        const index = y * width + x
        const elevationCooling = elevation[index] * config.elevationCooling
        temperatures[index] = this.clamp01(
          latitude * config.latitudeStrength +
            noise * (1 - config.latitudeStrength) -
            elevationCooling
        )
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
    config: HumidityConfig
  ): Float32Array {
    const { width, height, seaLevel } = terrain
    const humidity = new Float32Array(width * height)
    const waterDistance = this.computeDistanceToWater(elevation, width, height, seaLevel)

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
  private computeDistanceToWater(
    elevation: Float32Array,
    width: number,
    height: number,
    seaLevel: number
  ): Float32Array {
    const size = width * height
    const distances = new Int32Array(size)
    distances.fill(-1)

    const queueX = new Int32Array(size)
    const queueY = new Int32Array(size)
    let head = 0
    let tail = 0

    for (let i = 0; i < size; i += 1) {
      if (elevation[i] <= seaLevel) {
        distances[i] = 0
        queueX[tail] = i % width
        queueY[tail] = Math.floor(i / width)
        tail += 1
      }
    }

    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]

    while (head < tail) {
      const x = queueX[head]
      const y = queueY[head]
      const index = y * width + x
      const distance = distances[index]
      head += 1

      for (const [dx, dy] of directions) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const nextIndex = ny * width + nx
        if (distances[nextIndex] !== -1) continue
        distances[nextIndex] = distance + 1
        queueX[tail] = nx
        queueY[tail] = ny
        tail += 1
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
