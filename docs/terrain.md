# Terrain Generation Pipeline

> Technical reference for the procedural terrain system.

---

## Pipeline Stages

The terrain worker (`terrain.worker.ts`) executes these stages sequentially:

### 1. Elevation Field

**Module:** `TerrainGenerator.generateElevationField()`

Multi-octave fractal simplex noise with three additive layers:

| Layer          | Frequency          | Purpose           |
| -------------- | ------------------ | ----------------- |
| Base fBm       | `scale × 2^octave` | Detail terrain    |
| Continent bias | `continentScale`   | Large landmasses  |
| Ocean carving  | `oceanScale`       | Deep ocean basins |

Post-processing: power redistribution (`e^redistributionPower`) compresses lowlands.

Optional **island mode** multiplies by a radial falloff from map centre.

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

### 9. ImageData Rendering

Each field is rendered to an `ImageData` (RGBA pixel buffer):

- Elevation: blue → green → brown → white gradient
- Temperature: blue → red gradient
- Humidity: tan → teal gradient
- Biome: 26-colour palette with river overlay
- Strategic: biome base + highlighted points
- Resource: biome base + tinted resource deposits
- Political: nation territory colours + borders

All buffers are posted back as **transferable** ArrayBuffers (zero-copy).

---

## Configuration

All parameters live in `Config.ts → defaultConfig.terrain`:

```ts
terrain: {
  seed,                    // World seed (number)
  map: { width, height, tileSize, chunkSize, seaLevel, islandMode },
  elevation: { scale, octaves, persistence, lacunarity, ... },
  temperature: { scale, octaves, latitudeStrength, elevationCooling, ... },
  humidity: { scale, octaves, coastalInfluence, elevationDrying },
  rivers: { primaryScale, secondaryScale, thresholds, widths, ... },
  strategic: { radii, thresholds },
  biomeNoise: { scale, octaves, jitter amounts },
  biomes: { elevation thresholds, jitter amounts },
  resources: { oreScale, goldRarity, ironRarity, minDensity },
  nations: { count, minSpacing }
}
```
