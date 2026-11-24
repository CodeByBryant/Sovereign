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

All nations grow at once from their capitals' provinces over the **graph of provinces** ([terrain.md](terrain.md), section 9). Each step claims the cheapest province any nation can reach next, where stepping from a province to its neighbour costs the distance between their centres times the mean cost of crossing them; a nation stops at the first province that takes it to `nations.startArea` tiles (1,200 by default, so 2 to 4 provinces). Territories spread over easy ground first and reach hard ground last; where two meet on open ground the border is halfway; a nation that is full stops and the others go on, and a province a full nation reached for first goes to the cheapest nation that has room. A province that is mostly ice (glacier, polar desert) cannot be owned (`claimable.ts`); two capitals in one province would share it, so the better hub keeps it. The provinces are kept in claim order.

### 3. The land is measured (`profile.ts`, `provinceProfile.ts`)

`measureProfile` turns a territory (a list of tiles) into a `NationProfile`, a pure function of the tiles and the terrain: the **food** the land yields (the fertility of each biome, +0.3 for a river, +0.15 and a fishery for a coast, grain 1, pasture 0.7), **timber**, **stone**, **horses**, **metals** (iron 1, copper 0.8, coal 0.6), **luxuries**, the number of different **resources**, **coast**, **river** and **high-ground** tiles, the **defence** value of the strategic points inside it, its share of the route network's **traffic**, and its **contacts** (the other capitals within three routes). Resource amounts are the stock left, so a mined-out seam stops counting.

The simulation does not measure tiles: each **province** has its own facts, measured once (`buildProvinceFacts`), and a nation's profile is their sum (`combineProfile`, in claim order), with diversity the size of the union of the provinces' resource kinds (a bit mask) and the contacts it was given. Re-measuring after a claim is a few additions. The tests hold the sum equal to `measureProfile` on the union of the tiles. A change in stocks (a resource taken or regrown) marks the provinces concerned and the world measures them again and re-derives the owner's profile and stats, so `provinceFacts` always equals a fresh computation.

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
  provinces: Set<number> // Province ids, in claim order
  capital: number // A hub tile: the best site it started on (its province is the first claimed)
  stats: NationStats // population, military, economy, diplomacy: derived from the profile
  profile: NationProfile // what its land is like: the sum of its provinces
  expansionPoints: number // saved up toward the next province
}
```

### Methods

| Method               | Description                           |
| -------------------- | ------------------------------------- |
| `addProvince(id)`    | Claim a province                      |
| `removeProvince(id)` | Release a province                    |
| `totalArea`          | Number of owned tiles (the profile's) |

`World.validate()` checks that every province is held by one nation, that the ownership layer says the same tile by tile, that the capital is in one of the nation's provinces, that the profile is the sum of its provinces and the stats are those of the profile.

---

## Expansion (`systems/ExpansionSystem.ts`)

The first system in `World.step()`. Every tick, in a rotating order (starting at the nation whose index is the tick, so when two nations can afford the same province the winner alternates), each nation:

1. earns `expansion.rate x (0.5 + expansionism) x sqrt(population / 100) x timestep` expansion points;
2. buys, while it can pay, the free claimable province on its border with the best **value for the price**: what its land gives (1 + food + timber + stone + 2 x horses + 2 x metals + 2 x luxuries + defence) over `expansion.costPerTile x area x mean cost` (ties to the lower id);
3. on each claim, the owner of the province and of its tiles is written, and the profile is re-summed and the stats re-derived (so a bigger nation feeds more people and expands faster, while the price grows with area).

A nation with nothing to buy holds no points. **Nothing here is random.** Once every province a nation can reach is taken, nothing changes any more (`World.saturated`, "borders settled"); provinces on landmasses no nation can reach by land stay free. On a 2000 x 2000 world the 12 nations settle after about 57 years holding about 89% of the claimable provinces, a tick costs 0.006 ms, and the borders are the same on every run and every engine. See [decision 0007](decisions/0007-provinces-and-expansion.md).

---

## Political Map Overlay

The political overlay is a palette in `@sovereign/renderer` (`politicalRgba`), computed from the biome colours and the ownership layer:

1. Start from the biome colour of each tile
2. For each tile owned by a nation, blend the nation's colour at 45% opacity
3. For border tiles (owned tile with ≥1 neighbour owned by someone else or nobody), darken by 35%
4. For tiles on the line between two provinces of the same nation, dim by 18%, so the provinces show faintly inside a territory
5. The result is uploaded as a texture like every other overlay

The numbers are view settings (`apps/web/src/viewConfig.ts`), not engine configuration.

Accessible via the **Political (P)** toolbar button or `P` key.

---

## Ownership Layer

`WorldMap.ownership` is a `Uint8Array` where each byte is the nation's numeric index (0–254). Value `255` = unclaimed.

The world writes ownership (every tile of a province) when a province is claimed, at creation and as nations grow. The political overlay reads this layer for rendering. The tooltip reads it via `WorldMap.at(x, y).ownerId` for nation info display.

---

## Configuration

```ts
defaultWorldConfig.nations = {
  count: 12, // Number of nations to spawn
  minSpacing: 70, // Minimum tile distance between capitals
  startArea: 1200 // Tiles each nation starts with, in whole provinces
}
defaultWorldConfig.provinces = { spacing: 20, minArea: 40, costCap: 12 }
defaultWorldConfig.expansion = { rate: 1, costPerTile: 0.05 }
```

---

## Future

- **Phase 4** — Pops, production and trade, taxes, technology, notables; the economy will draw stocks down (`World.extractResource`) and nations' profiles already follow
- **Phase 5** — Diplomacy and AI decision-making driven by personality
- **Phase 6** — Warfare: borders move again; nothing yet crosses water, so landmasses without a nation stay free
