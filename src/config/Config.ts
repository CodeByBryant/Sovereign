/**
 * @module Config
 * @description Central configuration for the Sovereign world generator.
 *
 * Every tunable parameter lives here so the generation pipeline,
 * renderer and UI can be adjusted from a single source of truth.
 *
 * @example Changing the world seed
 * ```ts
 * import { defaultConfig } from './Config'
 * defaultConfig.terrain.seed = 42
 * ```
 *
 * @example Making a smaller, island-style map
 * ```ts
 * defaultConfig.terrain.map.width = 800
 * defaultConfig.terrain.map.height = 600
 * defaultConfig.terrain.map.islandMode = true
 * ```
 */
import alea from 'alea'

/** Deterministic PRNG so the seed is stable within a session. */
const seedRng = alea()

export const defaultConfig = {
  /* -------------------------------------------------------------- */
  /*  Canvas / display                                               */
  /* -------------------------------------------------------------- */

  /**
   * Low-level canvas settings.
   *
   * @example Targeting 30 FPS for low-end devices
   * ```ts
   * defaultConfig.canvas.targetFps = 30
   * ```
   */
  canvas: {
    /** CSS background colour drawn behind the map. */
    background: '#050607',
    /**
     * Target frames-per-second for the render loop.
     * The simulation throttles `requestAnimationFrame` to this rate.
     * @default 60
     */
    targetFps: 60
  },

  /* -------------------------------------------------------------- */
  /*  Camera                                                         */
  /* -------------------------------------------------------------- */

  /**
   * Pan / zoom constraints for the viewport camera.
   *
   * @example Allowing deeper zoom
   * ```ts
   * defaultConfig.camera.maxZoom = 6
   * ```
   */
  camera: {
    /** Minimum zoom level (fully zoomed out). @default 0.2 */
    minZoom: 0.2,
    /** Maximum zoom level (fully zoomed in). @default 10 */
    maxZoom: 10,
    /** Multiplicative step per scroll tick. @default 0.1 */
    zoomStep: 0.1
  },

  /* -------------------------------------------------------------- */
  /*  Terrain generation                                             */
  /* -------------------------------------------------------------- */

  terrain: {
    /**
     * World seed – every noise layer derives sub-seeds from this value.
     * Set to a fixed number for reproducible maps.
     *
     * @example Pinning a known seed
     * ```ts
     * defaultConfig.terrain.seed = 1337
     * ```
     */
    seed: Math.floor(seedRng() * 1e9),

    /* ------------------------------------------------------------ */
    /*  Map dimensions & tiling                                      */
    /* ------------------------------------------------------------ */

    /**
     * Map grid dimensions, tile/chunk sizes, and water level.
     *
     * @example A larger, wetter world
     * ```ts
     * defaultConfig.terrain.map.width = 3000
     * defaultConfig.terrain.map.height = 2000
     * defaultConfig.terrain.map.seaLevel = 0.45
     * ```
     */
    map: {
      /** Map width in tiles. @default 2000 */
      width: 2000,
      /** Map height in tiles. @default 2000 */
      height: 2000,
      /**
       * Each logical tile is rendered as `tileSize × tileSize` canvas pixels.
       * Increase for a blockier, more pixel-art look.
       * @default 4
       */
      tileSize: 4,
      /**
       * Tiles per chunk edge. Chunks are turned into `ImageBitmap`s for
       * fast GPU-composited rendering.
       * @default 64
       */
      chunkSize: 64,
      /**
       * Elevation threshold separating ocean from land.
       * Range `[0, 1]`. Higher = more water.
       * @default 0.37
       */
      seaLevel: 0.37,
      /**
       * Minimum fraction of tiles that must be land (0–1).
       * If the generated elevation produces less land than this,
       * the sea level is automatically lowered until the target is met.
       * @default 0.25
       */
      minLandRatio: 0.25,
      /**
       * When `true`, elevation falls off radially from the centre
       * producing a single island continent.
       * @default false
       */
      islandMode: false
    },

    /* ------------------------------------------------------------ */
    /*  Elevation noise                                              */
    /* ------------------------------------------------------------ */

    /**
     * Multi-octave simplex noise controlling the heightmap.
     *
     * `continentScale/Strength` add very-low-frequency bias creating
     * large continental masses; `oceanScale/Strength` carve basins.
     *
     * @example Flatter terrain with bigger continents
     * ```ts
     * defaultConfig.terrain.elevation.persistence = 0.4
     * defaultConfig.terrain.elevation.continentStrength = 0.7
     * ```
     */
    elevation: {
      /** Base noise frequency. Smaller = larger features. @default 0.0008 */
      scale: 0.0008,
      /** Number of fractal octaves. @default 5 */
      octaves: 5,
      /** Amplitude decay per octave (0–1). @default 0.52 */
      persistence: 0.52,
      /** Frequency multiplier per octave. @default 2 */
      lacunarity: 2,
      /** Continent bias noise frequency. @default 0.0002 */
      continentScale: 0.0002,
      /** Blend weight for continent bias (0–1). @default 0.5 */
      continentStrength: 0.5,
      /** Ocean-carving noise frequency. @default 0.00012 */
      oceanScale: 0.00012,
      /** Subtraction strength for ocean basins (0–1). @default 0.3 */
      oceanStrength: 0.3,
      /** Power curve for elevation redistribution (>1 flattens lowlands). @default 1.4 */
      redistributionPower: 1.4
    },

    /* ------------------------------------------------------------ */
    /*  Temperature                                                  */
    /* ------------------------------------------------------------ */

    /**
     * Temperature combines latitude gradient + noise + elevation cooling.
     *
     * @example A colder world overall
     * ```ts
     * defaultConfig.terrain.temperature.latitudeStrength = 0.8
     * defaultConfig.terrain.temperature.elevationCooling = 0.7
     * ```
     */
    temperature: {
      /** Noise frequency. @default 0.0025 */
      scale: 0.0025,
      /** Fractal octaves. @default 3 */
      octaves: 3,
      /** Amplitude decay. @default 0.5 */
      persistence: 0.5,
      /** Frequency multiplier. @default 2 */
      lacunarity: 2,
      /**
       * Weight of the equator→pole gradient vs noise.
       * `1` = pure latitude, `0` = pure noise.
       * @default 0.65
       */
      latitudeStrength: 0.65,
      /** How much elevation reduces temperature (0–1). @default 0.55 */
      elevationCooling: 0.55,
      /** Continentality: how much inland tiles amplify temp extremes (0–1). @default 0.3 */
      continentalStrength: 0.3
    },

    /* ------------------------------------------------------------ */
    /*  Humidity                                                     */
    /* ------------------------------------------------------------ */

    /**
     * Humidity is driven by noise, distance-to-coast and elevation.
     *
     * @example Wetter coasts, drier mountains
     * ```ts
     * defaultConfig.terrain.humidity.coastalInfluence = 0.6
     * defaultConfig.terrain.humidity.elevationDrying = 0.55
     * ```
     */
    humidity: {
      /** Noise frequency. @default 0.004 */
      scale: 0.004,
      /** Fractal octaves. @default 3 */
      octaves: 3,
      /** Amplitude decay. @default 0.45 */
      persistence: 0.45,
      /** Frequency multiplier. @default 2 */
      lacunarity: 2,
      /** Weight of coast-proximity vs noise (0–1). @default 0.45 */
      coastalInfluence: 0.45,
      /** Drying effect of high elevation (0–1). @default 0.45 */
      elevationDrying: 0.45
    },

    /* ------------------------------------------------------------ */
    /*  Rivers (Minecraft-style noise zero-crossing)                 */
    /* ------------------------------------------------------------ */

    /**
     * Rivers are placed where `|noise(x,y)| < threshold`, producing
     * natural winding channels without pathfinding.
     *
     * Two layers exist: wide primary rivers and thinner tributaries.
     *
     * @example Fewer, thinner rivers
     * ```ts
     * defaultConfig.terrain.rivers.primaryThreshold = 0.02
     * defaultConfig.terrain.rivers.primaryWidth = 3
     * ```
     */
    rivers: {
      /** Primary river noise frequency. @default 0.0018 */
      primaryScale: 0.0009,
      /** Tributary noise frequency. @default 0.004 */
      secondaryScale: 0.004,
      /** Width of the primary zero-crossing band (bigger = more river). @default 0.032 */
      primaryThreshold: 0.032,
      /** Width of the tributary zero-crossing band. @default 0.02 */
      secondaryThreshold: 0.02,
      /** Max rendered pixel width of primary rivers. @default 4 */
      primaryWidth: 4,
      /** Max rendered pixel width of tributaries. @default 2 */
      secondaryWidth: 2,
      /** Humidity increase near river tiles (0–1). @default 0.18 */
      humidityBoost: 0.18,
      /** Radius (tiles) for the humidity boost spread. @default 3 */
      humidityRadius: 3,
      /** Normalised elevation above which rivers taper to nothing. @default 0.82 */
      mountainCutoff: 0.82,
      /** Normalised land-height at which rivers begin fading near coasts. @default 0.1 */
      shoreTaper: 0.1,
      /** Domain warp strength for organic river shapes. @default 40 */
      warpStrength: 40,
      /** Noise octaves for river fBm sampling. @default 3 */
      noiseOctaves: 3,
      /** Noise persistence for river fBm sampling. @default 0.5 */
      noisePersistence: 0.5,
      /** Noise lacunarity for river fBm sampling. @default 2.2 */
      noiseLacunarity: 2.2
    },

    /* ------------------------------------------------------------ */
    /*  Strategic points                                             */
    /* ------------------------------------------------------------ */

    /**
     * Detection radii for strategic feature identification.
     *
     * @example Wider strait detection
     * ```ts
     * defaultConfig.terrain.strategic.straitMaxWidth = 20
     * ```
     */
    strategic: {
      /** Search radius for river crossing candidates (tiles). @default 5 */
      riverCrossingRadius: 5,
      /** Saddle-point search radius for mountain passes. @default 8 */
      mountainPassRadius: 8,
      /** Max water gap to qualify as a strait (tiles). @default 12 */
      straitMaxWidth: 12,
      /** Min water-to-total ratio in scan circle for peninsula. @default 0.6 */
      peninsulaMinRatio: 0.6,
      /** Scan radius for peninsula detection (tiles). @default 10 */
      peninsulaRadius: 10
    },

    /* ------------------------------------------------------------ */
    /*  Biome noise jitter                                           */
    /* ------------------------------------------------------------ */

    /**
     * A low-frequency noise field used to jitter temperature/humidity
     * inputs before biome lookup, breaking up sharp biome boundaries.
     *
     * @example More irregular biome edges
     * ```ts
     * defaultConfig.terrain.biomeNoise.tempJitter = 0.2
     * defaultConfig.terrain.biomeNoise.humidityJitter = 0.2
     * ```
     */
    biomeNoise: {
      /** Jitter noise frequency. @default 0.006 */
      scale: 0.006,
      /** Fractal octaves. @default 2 */
      octaves: 2,
      /** Amplitude decay. @default 0.5 */
      persistence: 0.5,
      /** Frequency multiplier. @default 2 */
      lacunarity: 2
    },

    /* ------------------------------------------------------------ */
    /*  Biome classification                                         */
    /* ------------------------------------------------------------ */

    /**
     * Thresholds that convert elevation/temperature/humidity into one
     * of the 26 biome types (see `biomes.ts`).
     *
     * @example More mountainous terrain
     * ```ts
     * defaultConfig.terrain.biomes.mountainElevation = 0.78
     * defaultConfig.terrain.biomes.highlandElevation = 0.68
     * ```
     */
    biomes: {
      /** Land-elevation band immediately above sea level rendered as shore. @default 0.008 */
      shoreBand: 0.008,
      /** Fraction of seaLevel below which water becomes deep ocean. @default 0.55 */
      deepOceanFactor: 0.55,
      /** Elevation above which tiles become mountains. @default 0.85 */
      mountainElevation: 0.85,
      /** Elevation above which tiles become highlands. @default 0.74 */
      highlandElevation: 0.74,
      /** Elevation above which cold tiles become alpine. @default 0.78 */
      alpineElevation: 0.78,
      /** Per-tile temperature jitter from biome noise (0–1). @default 0.1 */
      tempJitter: 0.1,
      /** Per-tile humidity jitter from biome noise (0–1). @default 0.1 */
      humidityJitter: 0.1
    },

    /* ------------------------------------------------------------ */
    /*  Resources                                                    */
    /* ------------------------------------------------------------ */

    /**
     * Tuning for the resource generation layer.
     *
     * Resources are derived from biome type, ore noise, elevation
     * and river proximity.  Gold and iron use an independent simplex
     * noise layer whose frequency is set by `oreScale`.
     *
     * @example Making gold rarer
     * ```ts
     * defaultConfig.terrain.resources.goldRarity = 0.93
     * ```
     */
    resources: {
      /** Ore noise frequency. Smaller = larger deposit clusters. @default 0.008 */
      oreScale: 0.008,
      /** Gold rarity threshold (0–1, higher = rarer). @default 0.88 */
      goldRarity: 0.88,
      /** Iron rarity threshold (0–1, higher = rarer). @default 0.72 */
      ironRarity: 0.72,
      /** Minimum density to register a resource (0–255). @default 30 */
      minDensity: 30
    },

    /* ------------------------------------------------------------ */
    /*  Nations                                                      */
    /* ------------------------------------------------------------ */

    /**
     * Configuration for nation spawning.
     *
     * @example Fewer, more spread-out nations
     * ```ts
     * defaultConfig.terrain.nations.count = 6
     * defaultConfig.terrain.nations.minSpacing = 120
     * ```
     */
    nations: {
      /** Number of nations to spawn. @default 12 */
      count: 12,
      /** Minimum tile distance between spawn points. @default 70 */
      minSpacing: 70,
      /**
       * Alpha blend for territory fill on the political overlay (0–1).
       * @default 0.45
       */
      territoryAlpha: 0.45,
      /**
       * Darkening factor for border tiles on the political overlay (0–1).
       * @default 0.35
       */
      borderDarken: 0.35
    }
  }
}

/** Full application configuration type. */
export type Config = typeof defaultConfig

/** Shorthand type for the strategic sub-section. */
export type StrategicConfig = typeof defaultConfig.terrain.strategic

/** Shorthand type for the resources sub-section. */
export type ResourcesConfig = typeof defaultConfig.terrain.resources

/** Shorthand type for the nations sub-section. */
export type NationsConfig = typeof defaultConfig.terrain.nations
