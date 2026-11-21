# 0006: Strategic points from a route network, and nations from the land

Status: **Accepted** (the owner asked for both and said to use my own judgement on the design)

## Problem

Two systems read as noise.

**Strategic points** were four local scans on a grid (`terrain/strategic.ts`): a "river crossing" was any river tile with land on two sides, "straits" were found along the axes only, a "peninsula" was a land tile with a lot of water around it, a "pass" a local dip with higher ground around it, each scored by a magic number and one best tile kept per grid cell. They connected to nothing: no route, no nation, no resource. Measured over 10 worlds of 2000 x 2000: about 1,580 points per world, **92% of them river crossings** (one per 53 river tiles, a median 6.7 tiles from the next point), 12 peninsulas, and none of it meant a chokepoint.

**Nations** (`NationSpawner.ts`) were a biome score for the start and then `rng.float()` for everything else: the government (uniform of 8), the five personality traits (0.1 to 0.9), population, military, economy, diplomacy, and the territory was always a 5 x 5 square (25 tiles). The stats correlated with the land at -0.13 to 0.00: pure noise.

## Decision

**Routes first, then strategic points as what the routes have to go through.**

- A **cost grid** (`terrain/cost.ts`) on cells of 4 tiles: what it costs to cross the ground (the biome, steepness, height, the width of a river, a boat in coastal water; open ocean is closed).
- **Hubs** are the best places to live (the shared site score in `terrain/suitability.ts`, which the spawner uses too), best first and at least a spacing apart.
- **Routes** (`terrain/routes.ts`): one multi-source Dijkstra over the grid (own deterministic heap) gives every cell its nearest hub; where two hubs' territories touch, the cheapest meeting is the route between them. This is the natural-neighbour graph of the hubs in travel cost, built in one pass instead of one search per pair (300 hubs x 250,000 cells would be about 45 s; one pass is about 0.3 s). **Traffic** is the weighted betweenness of each route over the hub graph.
- **Strategic points** are read off the routes (`routeFeatures`, a pure function of a route's profile cell by cell): a **pass** where a route climbs over a ridge, a **ford** where it crosses a river (at the narrowest tile), a **strait** where it crosses water between shores, an **isthmus** where it runs over a narrow stretch of land between wider land. Their value comes from the route's traffic and how narrow or high they are. Peninsulas are gone (a headland is not a chokepoint).

**Nations from the land up.**

- Capitals go on hubs, spread out (`nations/capitals.ts`); starting territories grow over the cost of the ground, all at once (`nations/territory.ts`, 1,200 tiles by default), so borders follow mountains, rivers and coasts.
- `measureProfile` (`nations/profile.ts`) measures the territory: food, timber, stone, horses, metals, luxuries, variety, coast, rivers, high ground, strongholds, route traffic and neighbours. It is a pure function of the tiles and the terrain.
- `deriveStats`, `deriveGovernment`, `derivePersonality` (`nations/derive.ts`) are pure functions of the profile. **The stats have no chance in them.** Government and personality get a draw of at most 0.08 and 0.06 from the `spawn` stream, so two nations on similar land are not clones.
- The nation panel shows the land, so the numbers are explainable. Sites near the sea score higher (a port), so some nations have a coast.

## Alternatives considered

- **Better local scans.** Rejected: a local scan cannot say that a place matters, because that depends on where people need to go. The same tile is a chokepoint or a dead end according to the network.
- **A shortest path per pair of hubs.** Rejected for time (about 45 s); the one-pass natural-neighbour graph is the standard way to get a sparse network, and its edges are the routes people would actually use.
- **Stats as a table by government or biome.** Rejected: it would make a nation's numbers a function of a label, not of its land, and nothing could recompute them when the territory changes.
- **Keep some randomness in the stats for variety.** Rejected: variety comes from the land (stats vary from 47 to 195 in population); a seeded jitter stays on government and personality only.

## Consequences

- **Every world, save, hash and golden changes** (pre-1.0). `HASH_SCHEMA_VERSION` is 3 (hubs, routes and each nation's profile are hashed; the test vectors were recomputed with the independent Python reference), `SAVE_FORMAT_VERSION` is 4 (the header carries hubs, routes and profiles), the web database is version 5 and drops older saves. The strategic config was rebuilt and `routes` and `nations.startArea` added. The goldens were regenerated in their own commit.
- **Measured over 10 worlds of 2000 x 2000:** about 160 strategic points per world (was 1,580: about 50 fords, 50 passes, 50 necks and 10 straits, where 92% had been river crossings), the median distance to the next 38 tiles (was 6.7); about 190 hubs and 480 routes. Of 120 nations, every one starts with 1,200 tiles (was 25); all eight governments occur (tribal in only 5, republic in 23); population follows food at a rank correlation of 0.77 (was -0.10), economy follows luxuries at 0.87 (was -0.06) and military follows metals at 0.47 (was -0.13); 41 nations have a coast.
- Creation time is about 6.5 s for 2000 x 2000, the same as before: routes cost about 0.5 s, and the nation code (which builds the cost grid a second time, for the territories) is cheaper than the old one was.
- Hubs, routes and the nation profile are saved: the header grows by a few hundred kilobytes.
- **Cross-engine:** Node 22, Chromium 157 and QuickJS reproduce all 19 pinned values (the depletion golden included), and the full 2000 x 2000 world for seed 1337 hashes to `d9dac93160c04dab7721dd564f68f8a2` on Node and Chromium.

## Limits (honest)

- **The stat formulas are provisional.** No economy exists yet to say what a nation needs; what follows from what is the point, the constants (food per person, the weight of a metal, the government scores) are a first design, calibrated only so that the distributions are plausible (population 34 to 195, military 18 to 150, all eight governments present).
- **Routes are on a 4-tile grid**, so they move in 8 directions and look angular; the points are refined to the exact tile only for fords.
- **A hub at a neck sees no neck.** A land neck is found only where a route runs over it between wider land; a hub sitting on the neck's mouth makes the neck the end of a route and it is not marked. Rare on real maps, where hubs are 60 tiles apart.
- Government is tuned for full-size territories; on test-sized maps (150-tile starts) nearly every nation is tribal.
- **A nation's profile is measured once, at spawn.** When territory changes the simulation must call `measureProfile` again; nothing does yet.

## Guards

`tests/determinism/routes-nations.test.ts` (three 1000 x 1000 worlds, in a CI shard) fails if the points stop lying on routes, one kind swamps the rest, they crowd together, or nation stats stop following from the land (it fails when population is made to ignore food). The heap, the cost grid, the route network, the site score, the route-feature classifier, the capitals, the territory growth, the profile and the derive functions are unit tested on drawn worlds and mutation checked. `pnpm probe -- tests/probe/strategic-nations.probe.ts` is the full measurement (strategic point counts and spacing, route and hub counts, every nation's land and stats and their correlations).
