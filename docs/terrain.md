# Terrain Generation Pipeline

> Technical reference for the procedural terrain system.

Terrain is one pure, headless function, `generateTerrain(request)` in `packages/simulation/src/terrain/pipeline.ts`. It returns typed fields (`TerrainFields`) and nothing else: colour is the renderer's job and running it off the UI thread is the host's. All randomness comes from named streams derived from the seed, and all noise is the engine's own simplex ([simulation/determinism.md](simulation/determinism.md)), so a seed gives the same terrain, bit for bit, on every machine.

---

## Pipeline Stages

`generateTerrain` runs these stages in order (module names are under `packages/simulation/src/terrain/`):

### 1. Elevation Field

**Module:** `TerrainGenerator.generateElevationField()`

Multi-octave fractal simplex noise with three additive layers:

| Layer          | Frequency          | Purpose           |
| -------------- | ------------------ | ----------------- |
| Base fBm       | `scale × 2^octave` | Detail terrain    |
| Continent bias | `continentScale`   | Large landmasses  |
| Ocean carving  | `oceanScale`       | Deep ocean basins |

Post-processing: power redistribution (`pow(e, redistributionPower)`, default 1.4) compresses lowlands. It uses the engine's own `pow`, not `Math.pow`, whose result differs between JavaScript engines in the last bits.

The elevation, continent and ocean layers each draw from their own random stream (`elevation`, `continent`, `ocean`).

Optional **island mode** multiplies by a radial falloff from map centre.

### 1b. Sea-level rescue

If a seed produces less land than `minLandRatio`, the effective sea level is lowered (never below 0.05) until enough tiles are above water. Every later stage, and the save, uses this effective sea level.

### 2. Water Distance

**Module:** `TerrainGenerator.computeDistanceToWater()`

Multi-pass BFS from all water tiles. Used by both temperature (continentality) and humidity (coastal influence) to avoid computing it twice.

### 3. Temperature Field

**Module:** `TerrainGenerator.generateTemperatureField()`

```
temp = latitudeGradient × latitudeStrength
     + noiseField × (1 - latitudeStrength)
     - elevationCooling × elevation
     + continentalStrength × waterDistance
```

### 4. Humidity Field

**Module:** `TerrainGenerator.generateHumidityField()`

```
humidity = noiseField × (1 - coastalInfluence)
         + coastalProximity × coastalInfluence
         - elevationDrying × elevation
```

### 5. Rivers

**Module:** `RiverGenerator` in `rivers.ts`

Minecraft-style noise zero-crossing: rivers appear where `|noise(x,y)| < threshold`. Two independent layers:

| Layer     | Scale  | Threshold | Width |
| --------- | ------ | --------- | ----- |
| Primary   | 0.0009 | 0.032     | 4px   |
| Secondary | 0.004  | 0.02      | 2px   |

Rivers fade above `mountainCutoff` elevation and taper near shores. Domain warping (`warpStrength: 40`) adds organic curves.

Post-process: humidity boost within `humidityRadius` tiles of rivers.

### 6. Biome Classification

**Module:** `buildBiomeMap()` in `biomes.ts`

26 biome types classified by elevation/temperature/humidity thresholds:

```
Water:  deep_ocean, ocean, shore
Cold:   polar_desert, glacier, tundra, alpine
Cool:   boreal_forest, taiga, cold_steppe
Temp:   temperate_desert, steppe, grassland, woodland,
        temperate_forest, scrubland, swamp
Hot:    desert, badlands, savanna, tropical_forest,
        rainforest, wetland, mangrove
High:   highland, mountain
```

A low-frequency jitter noise field offsets temp/humidity inputs before lookup, breaking up sharp biome boundaries.

### 7. Resources

**Module:** `generateResources()` in `resources.ts`

Each land tile receives a `ResourceType` (0–7) and `resourceDensity` (0–255):

| Resource     | Source                                             |
| ------------ | -------------------------------------------------- |
| Timber       | Forest, boreal_forest, taiga, woodland, rainforest |
| Stone        | Highland, mountain, alpine, badlands               |
| Iron         | Mountain/highland/badlands + ore noise > 0.72      |
| Gold         | Mountain + river-adjacent + ore noise > 0.88       |
| Fertile Soil | Grassland, savanna, wetland (humidity-weighted)    |
| Fish         | Shore-adjacent land tiles                          |
| Fur & Game   | Taiga, boreal_forest (cold forests)                |

Priority: Gold > Iron > Fish > biome-default.

### 8. Strategic Points

**Module:** `detectStrategicPoints()` in `strategic.ts`

Auto-detects geographically significant locations:

| Type           | Detection Method                                         | Score |
| -------------- | -------------------------------------------------------- | ----- |
| River Crossing | Low-elevation land adjacent to river, walkable in 4 dirs | 0–10  |
| Mountain Pass  | Saddle points (local elevation minimum between peaks)    | 0–10  |
| Strait         | Narrow water gap between two landmasses                  | 0–10  |
| Peninsula      | High water-to-total ratio in scan circle                 | 0–10  |

### Colour is not terrain

The pipeline stops at the fields. Turning them into pixels happens in `@sovereign/renderer` (`packages/renderer/src/palettes`): pure functions from a field value to RGBA for each overlay (elevation: blue → green → brown → white; temperature: blue → red; humidity: tan → teal; biome: the 26-colour palette with the river overlay; strategic and resource: the biome base plus highlights; political: territory colour at 45% with borders darkened 35%, see `apps/web/src/viewConfig.ts`). The browser app gets the tile layers from its worker by transfer and hands them to the PixiJS renderer.

---

## Configuration

The terrain parameters are the sections of `WorldConfig` in `packages/config/src/world.ts` (`defaultWorldConfig`), and they are part of a world's identity: they are saved with it and covered by its hash.

```ts
map:         { width, height, seaLevel, islandMode }   // defaults tuned for 2000 x 2000
elevation:   { scale, octaves, persistence, lacunarity, continentScale, oceanScale, ... }
temperature: { scale, octaves, latitudeStrength, elevationCooling, ... }
humidity:    { scale, octaves, coastalInfluence, elevationDrying }
rivers:      { primaryScale, secondaryScale, thresholds, widths, warpStrength, ... }
strategic:   { radii, thresholds }
biomeNoise:  { scale, octaves, jitter amounts }
biomes:      { elevation thresholds, jitter amounts }
resources:   { oreScale, goldRarity, ironRarity, minDensity }
nations:     { count, minSpacing }
timestep:    in-game days per tick
```

`resolveWorldConfig(overrides)` merges per-section partial overrides over the defaults and `validateWorldConfig` rejects values the engine cannot use (side lengths 16 to 8192, at most 4096 x 4096 tiles, at most 255 nations, octaves 1 to 8, and so on) before anything is allocated. The seed is **not** configuration: it is an input to `World.create`.

The spatial frequencies are tuned for a 2000 x 2000 map; a small test map multiplies them (see `packages/simulation/tests/support/worldOptions.ts`) to stay interesting.
