# Nation System

> Technical reference for the nation spawning, territory, and political map systems.

---

## Overview

Nations are autonomous entities that own territory (provinces), have unique visual identity (colour + flag), personality traits driving future AI behaviour, and stats tracking their power.

---

## Spawning Pipeline

**Module:** `spawnNations()` in `packages/simulation/src/nations/NationSpawner.ts`

A nation is built from the land up. Nothing about it is a free random draw except a small jitter on its government and personality.

### 1. Capitals (`capitals.ts`)

Capitals go on **hubs**, the best places to live that the routes join ([terrain.md](terrain.md), section 8). `chooseCapitals` takes the best site first, never closer than `nations.minSpacing` to a capital already chosen, and prefers sites far from the others (a site's weight times a spread factor from 0.5, at the minimum spacing, to 1, at twice it), so nations spread over the map instead of crowding the best corner. No randomness; ties go to the lower hub index. Fewer than `nations.count` come back if the sites run out.

The site score is shared with the hubs: the biome's desirability (grassland 1.0 down to badlands 0.15; deserts, mountains, ice and tundra are not settled), a river in the cell (+0.2), the sea within a cell (+0.3, a port) and the food, timber and stone within about 12 tiles (up to +0.5), scaled to 0 to 1.

### 2. Starting territory (`territory.ts`)

All nations grow at once from their capitals over the **cost of crossing the ground** (the route cost grid), each step taking the cheapest unclaimed tile any nation can reach, until each has `nations.startArea` tiles (1,200 by default). Territories spread over open ground and stop at mountains, rivers and coasts; where two meet on open ground the border is halfway; a nation that has its area stops and the others go on. Ice (glacier, polar desert) and water cannot be owned. The tiles are kept in claim order.

### 3. The land is measured (`profile.ts`)

`measureProfile` turns a territory into a `NationProfile`, a pure function of the tiles and the terrain: the **food** the land yields (the fertility of each biome, +0.3 for a river, +0.15 and a fishery for a coast, grain 1, pasture 0.7), **timber**, **stone**, **horses**, **metals** (iron 1, copper 0.8, coal 0.6), **luxuries**, the number of different **resources**, **coast**, **river** and **high-ground** tiles, the **defence** value of the strategic points inside it, its share of the route network's **traffic**, and its **contacts** (the other capitals within three routes). Resource amounts are the stock left, so a mined-out seam stops counting.

### 4. Stats, government and personality follow (`derive.ts`)

Pure functions of the profile, so the simulation can call them again whenever a territory changes:

- **Population** from food; **military** from the people, metals, horses, timber, stone, defensible ground and strongholds; **economy** from the variety of resources, luxuries, ports and trade traffic; **diplomacy** from neighbours, trade and wealth. **No randomness at all** in the stats (a test spawns the same land with two seeds and checks they are identical).
- **Government** is the best-scoring of the eight for the nation's facts (a small, poor, isolated people are tribal; a populous, armed one an empire; a trading coast a republic; the owners of great wealth an oligarchy; a high, isolated land a theocracy; a poor, hungry, armed one a dictatorship; a wealthy, connected, peaceful one a democracy), with a draw of at most 0.08 breaking close calls.
- **Personality** follows circumstance (land-poor peoples are hungrier and more expansionist, trade makes merchants, neighbours make diplomats, strongholds and iron make soldiers), nudged a little by the government, with a jitter of at most 0.06 per trait.

The numbers are a first design. No economy exists yet to say what a nation needs, so the constants are provisional; what follows from what is the point. Names, colours and flags still come from their own generators (streams `names`, `colors`, `flags`); the jitter comes from the `spawn` stream.

Measured over 10 worlds of 2000 x 2000 (120 nations): every nation has its 1,200 tiles (it was 25), all eight governments occur, population follows food at a rank correlation of 0.77 (it was -0.10), economy follows luxuries at 0.87 (it was -0.06), military follows metals at 0.47 (it was -0.13). See [decision 0006](decisions/0006-routes-and-nations-from-the-land.md).

---

## Nation Class

```ts
class Nation {
  id: string // "nation-0", "nation-1", ...
  name: string // "United Aldoria"
  color: [R, G, B] // Display colour 0–255
  flag: FlagPattern // Pattern type + HSL colours
  founded: number // Tick the nation was founded at
  government: GovernmentType // 'monarchy' | 'republic' | ...
  personality: NationPersonality
  provinces: Set<number> // Flat tile indices, in claim order
  capital: number // A hub: the best site it started on
  stats: NationStats // population, military, economy, diplomacy: derived from the profile
  profile: NationProfile // what its land is like (measured)
}
```

### Methods

| Method                               | Description                                          |
| ------------------------------------ | ---------------------------------------------------- |
| `addProvince(idx)`                   | Claim a tile                                         |
| `removeProvince(idx)`                | Release a tile                                       |
| `totalArea`                          | Number of owned tiles                                |
| `getBorderProvinces(w, h, ownerMap)` | Tiles with at least one non-owned cardinal neighbour |

---

## Political Map Overlay

The political overlay is a palette in `@sovereign/renderer` (`politicalRgba`), computed from the biome colours and the ownership layer:

1. Start from the biome colour of each tile
2. For each tile owned by a nation, blend the nation's colour at 45% opacity
3. For border tiles (owned tile with ≥1 non-owned neighbour), darken by 35%
4. The result is uploaded as a texture like every other overlay

The two numbers are view settings (`apps/web/src/viewConfig.ts`), not engine configuration.

Accessible via the **Political (P)** toolbar button or `P` key.

---

## Ownership Layer

`WorldMap.ownership` is a `Uint8Array` where each byte is the nation's numeric index (0–254). Value `255` = unclaimed.

The spawner writes ownership after claiming territory. The political overlay reads this layer for rendering. The tooltip reads it via `WorldMap.at(x, y).ownerId` for nation info display.

---

## Configuration

```ts
defaultWorldConfig.nations = {
  count: 12, // Number of nations to spawn
  minSpacing: 70, // Minimum tile distance between capitals
  startArea: 1200 // Tiles each nation starts with
}
```

---

## Future: Expansion & AI

The nation system is designed for future expansion phases:

- **Phase 3** — Organic territory growth with terrain-cost pathfinding, border rendering, natural border detection (rivers, mountains)
- **Phase 4** — Population/economy/tech growth, diplomacy, warfare, AI decision-making via Top-K/Top-P sampling
