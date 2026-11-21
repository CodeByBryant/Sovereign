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

The three layers each draw from their own random stream (`elevation`, `continent`, `ocean`). The sum is **not** the elevation: it is only an ordering of the tiles (its values cluster narrowly around the middle, and are not clamped), and it is reshaped by rank in the next stage.

### 1a. Distribution (the rank remap)

The raw field is rescaled to [0, 1] (`scaleToUnit`) and then reshaped by `elevation.profile` with `remapByProfile` ([simulation/determinism.md](simulation/determinism.md), section 6.2): every tile is ranked and receives the elevation the profile gives that rank. Coastlines and ridges do not move; only the values do. The default profile pins the ocean and the mountains the same way on every seed:

| Share of all tiles      | Elevation                       | Becomes            |
| ----------------------- | ------------------------------- | ------------------ |
| lowest 19%              | below 0.2035 (0.55 x sea level) | deep ocean         |
| next 55.5%              | up to 0.37 (sea level)          | ocean              |
| next 3%                 | up to 0.378                     | shore              |
| top 3.6% (14% of land)  | above 0.74                      | highland or higher |
| top 1.9% (7.5% of land) | above 0.78                      | alpine where cold  |
| top 1.0% (4% of land)   | above 0.85                      | mountain           |

So the land is 25.5% of tiles on every seed. The ocean amounts are exactly what the generator produced before the retune ([ADR 0004](decisions/0004-distribution-aware-terrain.md) explains why it needed reshaping).

Optional **island mode** multiplies by a radial falloff from map centre.

### 1b. Sea-level rescue

If a configuration produces less land than `minLandRatio`, the effective sea level is lowered (never below 0.05) until enough tiles are above water. With the default profile and sea level it never fires (land is 25.5%, above the 25% minimum); it exists for custom sea levels. Every later stage, and the save, uses the effective sea level.

### 2. Water Distance

**Module:** `TerrainGenerator.computeDistanceToWater()`

Multi-pass BFS from all water tiles. Used by both temperature (continentality) and humidity (coastal influence) to avoid computing it twice.

### 3. Temperature Field

The generators leave temperature and humidity unclamped (a clamp would create masses of identical tiles that no ranking can separate). Each is rescaled to [0, 1] and then reshaped by rank over **land tiles only** with `temperature.profile` / `humidity.profile`.

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
| Primary   | 0.0009 | 0.023     | 4px   |
| Secondary | 0.004  | 0.0144    | 2px   |

Rivers fade above `mountainCutoff` elevation and taper near shores. Domain warping (`warpStrength: 40`) adds organic curves.

Post-process: humidity boost (`humidityBoost`, 0.18) within `humidityRadius` tiles of rivers. It is applied to the humidity **after** the rank remap, in the units it was written for, so land beside a river ends up wetter than its profile alone says. The thresholds were lowered to 72% of their old values in the retune: with elevation spread out, fewer tiles sit in the shore taper, and the old thresholds would have covered 10.5% of land instead of the 7.4% they used to.

### 6. Biome Classification

**Module:** `determineBiome()` / `classifyBiomes()` in `biomes.ts`

26 biomes from elevation, temperature and humidity. In order:

1. **Water and shore**: below sea level is `deep_ocean` (below 0.55 x sea level) or `ocean`; the next `shoreBand` (0.008) is `shore`.
2. **Elevation gates**: above 0.85 `mountain`; above 0.78 and cold (temperature below 0.45) `alpine`; above 0.74 `highland`.
3. **The climate table** (`biomes.bands` in the config): the first temperature band whose `maxTemperature` is above the tile's temperature, then the first row whose `maxHumidity` is above its humidity; the last band and the last row of each band catch the rest. A row may name a `lowlandBiome` that replaces it within `lowlandBand` (0.05) of sea level (a very wet temperate tile is `swamp` on low ground, `wetland` elsewhere).

```
polar     (< 0.2):  polar_desert, tundra, taiga, glacier
cool      (< 0.4):  cold_steppe, taiga, boreal_forest, swamp
temperate (< 0.7):  temperate_desert, steppe, grassland, woodland, temperate_forest, wetland
tropical  (>= 0.7): desert, badlands, savanna, chaparral, tropical_forest, rainforest, mangrove
```

A low-frequency jitter noise field offsets temperature and humidity before the lookup, breaking up sharp biome boundaries.

**The table is fitted, not guessed.** The temperature profile's knots and every humidity threshold were solved by `tests/probe/fit-climate.probe.ts`: it samples worlds, looks at how land is actually distributed in temperature and humidity, and finds the cut points that give each biome its target share of inland land. Refit it after any change to the field generators. Targets (percent of inland land, that is land that is not shore) and what 10 unseen seeds at 2000 x 2000 produced:

| Biome            | Target | Measured | Biome            | Target | Measured |
| ---------------- | ------ | -------- | ---------------- | ------ | -------- |
| grassland        | 9      | 8.2      | tropical_forest  | 4      | 3.7      |
| tundra           | 7      | 7.9      | mountain         | 4      | 4.5      |
| taiga            | 7      | 8.0      | alpine           | 3      | 2.7      |
| highland         | 7      | 8.7      | cold_steppe      | 3      | 2.9      |
| desert           | 6      | 6.9      | rainforest       | 3      | 2.8      |
| woodland         | 7.5    | 6.8      | chaparral        | 3      | 2.8      |
| temperate_forest | 7.5    | 6.7      | temperate_desert | 2.5    | 2.8      |
| boreal_forest    | 7      | 6.7      | badlands         | 2.5    | 2.6      |
| steppe           | 6      | 5.1      | swamp            | 1.5    | 1.8      |
| savanna          | 5      | 5.0      | polar_desert     | 2      | 1.2      |
| wetland          | 1.5    | 1.1      | glacier          | 0.5    | 0.7      |
| mangrove         | 0.5    | 0.34     |                  |        |          |

All 26 biomes appear in all 10 worlds; 20 of the 23 climate biomes are within +/-30% of target and the others (polar desert, glacier, mangrove) within 0.5x to 2x. The rare polar and wet biomes live in small, seed-specific regions, so they vary most between seeds.

### 7. Resources

**Modules:** `placeResources()` in `placement.ts`, the feature fields in `features.ts`; the catalogue is `RESOURCE_CATALOG` in `@sovereign/contracts` and the rules are `resources` in `@sovereign/config`.

Resources are placed by geology and ecology, not by thresholding noise. There are **22 resources**; each tile has two slots, a **surface** slot (land: a forest, crop, herd or luxury; water: a fishery) and a **ground** slot (a mineral, or oil and salt, which may also lie under shallow sea). A slot holds a `type`, a `richness` (1 to 255, how big the deposit was) and a `stock` (how much is left).

| Slot            | Resources                                                                             |
| --------------- | ------------------------------------------------------------------------------------- |
| Surface (land)  | Timber, Grain, Pasture, Horses, Fur and game, Cotton, Spices, Wine, Tea, Ivory        |
| Surface (water) | Fish, Pearls, Whales                                                                  |
| Ground          | Stone, Iron, Copper, Coal, Oil, Gold, Silver, Salt, Gems (oil and salt also offshore) |

**Placement.** Every resource has a rule (data, `defaultWorldConfig.resources.rules`):

1. **Hard gates** decide which tiles can hold it: biome weights, ranges of elevation, temperature and humidity, a distance to the coast. An offshore deposit (oil, salt) uses only its own coast distance and optional depth range.
2. **Soft preferences** rank the rest: ridges, basins, slope, height, rivers, the coast, wet and warm ground.
3. A **regional factor** (smooth `geology`-stream noise, features `regionSize` tiles across) makes whole regions rich or barren, so scarcity is geographic: some landmasses have no coal or oil.
4. The tiles with the highest score, up to the rule's `share` of the land (or of the water), get the resource. Taking the top share by rank makes the abundance exact on every seed, and since scores are smooth the resource forms patches and veins, not speckle. Resources claim tiles **rarest first**, so a rare resource gets its best sites before a common one takes them. **Richness** comes from how high a tile ranked, so the core of a patch is richest.

The feature fields (`features.ts`) are pure functions of the terrain: `distanceToMask` (4-neighbour breadth-first distance to the coast, a river or the land), `slopeField` and `topographicPosition` (a tile's height against the land around it: a ridge is positive, a basin negative; calibrated to real terrain by `features.ridgeRadius`, `ridgeScale` and `slopeScale`).

**Depletion.** `World.extractResource(layer, tile, amount)` takes stock (never more than is there) and returns what was taken. Renewable resources (the surface ones) regrow from `World.step()`: a drawn-down tile gains `units` every `period` ticks up to its richness (the `regrowth` table); minerals never regrow. Only drawn-down tiles are tracked, so stepping stays cheap. Nothing calls `extractResource` yet; the economy will.

Measured over 10 worlds of 2000 x 2000 (see [decision 0005](decisions/0005-resources-by-geology.md)): every resource is present in every world, shares are exact, 98 to 100% of metals sit on ridges, coal and oil sit 100% in basins, and clustering is 0.85 to 0.97 (the old noise scored 0.29 for fish).

### 8. Routes and strategic points

**Modules:** `cost.ts`, `routes.ts`, `suitability.ts` and `strategic.ts` in `terrain/`.

Strategic points are the places a **route network** has to go through, not local scans. The network is built in three steps:

1. **Cost grid** (`buildCostGrid`): the ground on a coarse grid of cells (`routes.cell`, 4 tiles). A land cell costs the base cost plus the mean extra cost of its land tiles (the biome, how steep it is, how high) plus the widest river in it (`routes.cost`), so a ford is found where a river is narrow. Water within `seaReach` cells of land is a sea lane at the sea cost; farther out it is closed, so a boat crosses a strait and never an ocean.
2. **Hubs** (`pickHubs`): the best places to live, by the shared site score (`siteScoreGrid`: the biome, a river, a coast, and the food, timber and stone within reach), best first and at least `routes.hubSpacing` tiles apart.
3. **Routes** (`findRoutes`): one multi-source Dijkstra over the cost grid (a deterministic heap, ties by cell index) gives every cell its nearest hub. Where two hubs' territories touch, the cheapest meeting is the route between them (the natural-neighbour graph of the hubs in travel cost). **Traffic** is betweenness: every pair of hubs adds the product of their weights to each route on its shortest path.

A route is then read cell by cell (`routeFeatures`), and each feature becomes a strategic point, valued 1 to 10 from the traffic of its route (the square root of its share of the busiest) and how narrow or high it is:

| Type           | Where a route...                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| River crossing | crosses a river (a run of river cells of at most `fordMaxRun`); the point is the narrowest river tile of the narrowest cell                          |
| Mountain pass  | is at its highest in a window of `passWindow` cells, at least `passMinElevation` high, with lower ground by `passRise` on both sides along the route |
| Strait         | crosses water between two shores, at most `straitMaxCells` wide; the point is in the middle                                                          |
| Isthmus        | runs over land within `isthmusMaxSeaDistance` cells of the sea, between land at least `isthmusRise` cells farther from it; the point is mid-neck     |

Two points of one kind closer than `mergeRadius` cells are one (the more valuable wins), and routes with under `minTraffic` of the busiest route's traffic have no points. The terrain carries the points, the hubs and the routes (each a list of tiles), all hashed and saved.

Measured over 10 worlds of 2000 x 2000: about 160 points per world (the scans gave about 1,580, 92% of them river crossings: now about 50 fords, 50 passes, 50 necks and 10 straits), a median 38 tiles to the next point (was 6.7), about 190 hubs and 480 routes, and creation about 6.5 s (the same as before: routes cost about 0.5 s, and the new nation code is cheaper than the old). See [decision 0006](decisions/0006-routes-and-nations-from-the-land.md).

### Colour is not terrain

The pipeline stops at the fields. Turning them into pixels happens in `@sovereign/renderer` (`packages/renderer/src/palettes`): pure functions from a field value to RGBA for each overlay (elevation: blue → green → brown → white; temperature: blue → red; humidity: tan → teal; biome: the 26-colour palette with the river overlay; strategic: the biome base dimmed, the route network drawn as lines (brighter with traffic) and a marker per strategic point; resource: the biome base tinted by each tile's dominant resource (luxury over industrial over basic, ground over surface), fading as the stock is drawn down, or, with a focus, a heat map of one resource; political: territory colour at 45% with borders darkened 35%, see `apps/web/src/viewConfig.ts`). The browser app gets the tile layers from its worker by transfer and hands them to the PixiJS renderer.

---

## Configuration

The terrain parameters are the sections of `WorldConfig` in `packages/config/src/world.ts` (`defaultWorldConfig`), and they are part of a world's identity: they are saved with it and covered by its hash.

```ts
map:         { width, height, seaLevel, islandMode }   // defaults tuned for 2000 x 2000
elevation:   { scale, octaves, persistence, lacunarity, continentScale, oceanScale, ..., profile }
temperature: { scale, octaves, latitudeStrength, elevationCooling, ..., profile }
humidity:    { scale, octaves, coastalInfluence, elevationDrying, profile }
rivers:      { primaryScale, secondaryScale, thresholds, widths, warpStrength, ... }
routes:      { cell, hubSpacing, hubMinScore, cost { base, slope, height, river, sea, seaReach, biomes } }
strategic:   { fordMaxRun, straitMaxCells, passRise, passMinElevation, passWindow, isthmus*, mergeRadius, minTraffic }
biomeNoise:  { scale, octaves, jitter amounts }
biomes:      { elevation thresholds, jitter amounts, bands (the climate table), lowlandBand }
resources:   { features, rules (22 placement rules), regrowth }
nations:     { count, minSpacing, startArea }
timestep:    in-game days per tick
```

A `profile` is a list of `[quantile, value]` knots (see 1a); `validateWorldConfig` requires it to start at quantile 0, end at 1, strictly increase in quantile, never decrease in value and stay within [0, 1], and checks the climate table's order and biome names.

`resolveWorldConfig(overrides)` merges per-section partial overrides over the defaults and `validateWorldConfig` rejects values the engine cannot use (side lengths 16 to 8192, at most 4096 x 4096 tiles, at most 255 nations, octaves 1 to 8, and so on) before anything is allocated. The seed is **not** configuration: it is an input to `World.create`.

The spatial frequencies are tuned for a 2000 x 2000 map; a small test map multiplies them (see `packages/simulation/tests/support/worldOptions.ts`) to stay interesting.
