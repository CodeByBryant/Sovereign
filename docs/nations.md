# Nation System

> Technical reference for the nation spawning, territory, and political map systems.

---

## Overview

Nations are autonomous entities that own territory (provinces), have unique visual identity (colour + flag), personality traits driving future AI behaviour, and stats tracking their power.

---

## Spawning Pipeline

**Module:** `NationSpawner.spawnNations()` in `src/core/systems/NationSpawner.ts`

### 1. Find Candidates

Every 4th tile on the map is evaluated for habitability:

| Biome            | Desirability |
| ---------------- | ------------ |
| Grassland        | 1.0          |
| Woodland         | 0.9          |
| Temperate Forest | 0.85         |
| Steppe           | 0.7          |
| Tropical Forest  | 0.7          |
| Savanna          | 0.65         |
| Scrubland        | 0.6          |
| Rainforest       | 0.55         |
| Boreal Forest    | 0.5          |
| Cold Steppe      | 0.4          |
| Highland         | 0.35         |
| Taiga            | 0.35         |
| Wetland          | 0.3          |
| Swamp            | 0.25         |
| Temperate Desert | 0.2          |
| Badlands         | 0.15         |

Tiles adjacent to rivers get a **+0.2 bonus** (river civilizations).

Uninhabitable biomes (ocean, deep ocean, shore, glacier, polar desert, desert, mountain, alpine) are excluded entirely.

### 2. Pick Spawn Points

Greedy selection from shuffled-and-sorted candidates:

- Sorted by score (descending) after Fisher-Yates shuffle
- Each pick must be ≥ `minSpacing` tiles from all existing picks
- Default: 12 nations, 70-tile minimum spacing

### 3. Claim Territory

Each nation claims a **5×5 area** (radius 2) around its spawn point:

- Skips water tiles
- Skips already-claimed tiles
- Skips uninhabitable biomes (ocean, shore, glacier, polar desert)

### 4. Create Nation Entity

Each `Nation` instance receives:

- **Name** — procedural (prefix + root + suffix, ~40% get a government title)
- **Colour** — golden-angle HSL spacing with minimum RGB distance check
- **Flag** — 6 pattern types (solid, horizontal/vertical stripes, cross, diagonal, quartered)
- **Government** — random from 8 types (monarchy, republic, democracy, theocracy, empire, tribal, oligarchy, dictatorship)
- **Personality** — 5 traits, each 0.1–0.9: aggression, expansionism, diplomacy, mercantilism, militarism
- **Stats** — population, military, economy, diplomacy

---

## Nation Class

```ts
class Nation {
  id: string // "nation-0", "nation-1", ...
  name: string // "United Aldoria"
  color: [R, G, B] // Display colour 0–255
  flag: FlagPattern // Pattern type + HSL colours
  government: GovernmentType // 'monarchy' | 'republic' | ...
  personality: NationPersonality
  provinces: Set<number> // Flat tile indices
  capital: number // Spawn tile index
  stats: NationStats // population, military, economy, diplomacy
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

The political overlay is rendered on the main thread after nation spawning:

1. Start with a copy of the biome ImageData
2. For each tile owned by a nation, blend the nation's colour at 45% opacity
3. For border tiles (owned tile with ≥1 non-owned neighbour), darken by 30%
4. Result is chunked into ImageBitmaps like all other view modes

Accessible via the **Political (P)** toolbar button or `P` key.

---

## Ownership Layer

`WorldMap.ownership` is a `Uint8Array` where each byte is the nation's numeric index (0–254). Value `255` = unclaimed.

The spawner writes ownership after claiming territory. The political overlay reads this layer for rendering. The tooltip reads it via `WorldMap.at(x, y).ownerId` for nation info display.

---

## Configuration

```ts
defaultConfig.terrain.nations = {
  count: 12, // Number of nations to spawn
  minSpacing: 70 // Minimum tile distance between capitals
}
```

---

## Future: Expansion & AI

The nation system is designed for future expansion phases:

- **Phase 3** — Organic territory growth with terrain-cost pathfinding, border rendering, natural border detection (rivers, mountains)
- **Phase 4** — Population/economy/tech growth, diplomacy, warfare, AI decision-making via Top-K/Top-P sampling
