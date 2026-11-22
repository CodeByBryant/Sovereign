# 0007: Provinces, nations that own them, and a world that ticks

Status: **Accepted** (the owner chose the scope: provinces, ownership, expansion over natural borders, border rendering and time controls; not the economy)

## Problem

`World.step()` was an empty list. Terrain, resources, routes and nations existed, but nothing happened, so none of the provisional numbers (stats, stocks, regrowth) could be checked against anything, and a nation was a pile of tiles: ownership was one byte per tile and a "province" was a tile index in a set. There was no unit to own, to grow by or to draw a border around, and no way to run time in the app.

## Decision

**A province graph, derived from the land.**

- The land is cut into **provinces** (`terrain/provinces.ts`): the cells of a set of seeds in **travel cost**. One multi-source Dijkstra over the land tiles (the deterministic heap from ADR 0006, the cost of each tile from the route cost grid, capped at `provinces.costCap` so a range can shift a border without ruling a world) gives each tile its cheapest seed. Provinces are connected by construction and their borders are pulled toward ground that is costly to cross: rivers, steep ground, coasts (see the limits).
- **Seeds** are spread `provinces.spacing` tiles apart (20 by default, about 2,100 provinces of a median 465 tiles on 2000 x 2000) preferring cheap ground, so a plain holds a seed and the barrier falls between seeds; every landmass gets at least one. Provinces under `provinces.minArea` merge, smallest first, into the neighbour with the longest shared border; a speck with no neighbour belongs to nobody.
- The layer is **derived, never saved**: `World.create` and `World.restore` both rebuild it from the terrain and the config, so a save stays small and nothing can disagree with the terrain.

**Nations own provinces.**

- `Nation.provinces` is a set of province ids in claim order. The per-tile ownership layer is kept in step (written through when a province changes hands), and the app, the inspector and the political overlay still read it.
- A nation's **profile is the sum of its provinces' profiles** (`nations/provinceProfile.ts`): every fact adds up except diversity, which is the size of the union of the resource kinds (a bit mask per province). Re-measuring after a claim is a handful of additions, and the stats are re-derived (`deriveStats`), which closes the gap ADR 0006 listed ("a nation's profile is measured once"). The tests hold the sum to `measureProfile` on the union of tiles.
- **Province facts follow the stocks.** A resource stock changing (taken or regrown) marks the province, and those beside a changed water tile (a coast's food counts the fishery next to it), dirty; they are measured again and the owner's profile and stats re-derived. The first version snapshotted facts at creation; a world restored after an extraction measured different stocks and the two diverged as soon as a nation claimed a province. The invariant now tested: facts always equal a fresh computation from the current state.
- Starting territories grow over the province graph (centre distance times mean cost), all nations at once, each stopping at the first province that takes it to `nations.startArea`. Provinces that are mostly ice cannot be owned. Two capitals in one province: the better hub keeps it.

**Expansion** (`systems/ExpansionSystem.ts`, first in `World.step()`).

- Every tick a nation earns expansion points, `expansion.rate x (0.5 + expansionism) x sqrt(population / 100)` per day, and buys the free province beside its land with the best **value for the price**: what its land gives (food, materials, luxuries, defence) over `expansion.costPerTile x area x mean cost`. It may buy several in a tick. Ties go to the lower province id.
- **No randomness, no new stream.** The nations are served in a rotating order (start at the nation whose index is the tick), so when two can afford the same province the winner alternates. A nation with nothing to buy holds no points. Once every province a nation can reach is claimed nothing changes any more: the borders are **settled** (`World.saturated`).
- The system's frontiers are derived from the land held and rebuilt on create and restore; `expansionPoints` is state, saved and hashed.

**Time in the app.**

- The worker answers `run { ticks }` with `ticked`: the clock, the nations as they are, and, when provinces changed hands, the ownership layer and (only while the political view is on screen) the political overlay. Those are rebuilt at most every 250 ms, and the held-back update goes out on pause, on a switch to the political view, or when the borders settle (`host/tickRunner.ts`, tested with an injected clock).
- The app paces real time into whole ticks (`host/Pacer.ts`: speeds of 1, 10, 100 and 1000 days per second, a stall catches up by at most 250 ms, a request is capped), with one request in flight at a time. A transport bar in `@sovereign/ui` has the date (365-day years), play / pause, the speeds, and says when the borders have settled. Space plays and pauses, + and - change the speed.
- The political overlay draws province lines faintly inside a nation and its own border strongly.

## Alternatives considered

- **Cells of a coarser grid, refined at the borders.** Rejected after a probe: the tile-level search costs about 0.45 s on 2000 x 2000, inside the budget, and gives exact borders with no refinement step.
- **Provinces by a Voronoi in straight distance.** Rejected: borders would cut across mountains; the point is that they fall on barriers.
- **Facts from richness (the static deposit size) instead of stock.** Simpler and trivially restorable, but it would make the profile ignore depletion, which ADR 0006 promised and the economy will need. Keeping facts in step with stocks costs a few lines and a test.
- **Expansion with a random element.** Rejected: nothing here needs chance, and an exact replay is the exit criterion. Variety comes from the land and from personality.
- **Sending the political overlay on every update.** Rejected: 16 MB at 1000 days a second. It is sent only while it can be seen, and throttled.
- **Making province structure part of the save.** Rejected: it is a pure function of the terrain and config; storing it could only let a file disagree with itself.

## Consequences

- **Every world, save, hash and golden changes** (pre-1.0). `HASH_SCHEMA_VERSION` is 4 (a province fingerprint after the layers; a nation's list is province ids preceded by its expansion points; vectors recomputed with the independent Python reference), `SAVE_FORMAT_VERSION` is 5 and the web database is version 6 and drops older saves. The config gained `provinces` and `expansion`. `NationSnapshot` gained `provinceCount` and the world snapshot `timestep`.
- **Measured over a 2000 x 2000 world** (seed 1337, 12 nations): 2,140 provinces; nations start with 2 to 4 provinces (1,200 to 2,000 tiles); creation takes about 8 s (7.8 to 8.8 s over three runs; it was 6.5 s) and loading a save about 1.3 s (it was 0.16 s), because the province layer, about 1.6 s of work, is rebuilt each time; a tick costs 0.006 to 0.008 ms; the nations settle after 20,825 ticks (57 years) holding 89% of the claimable provinces, the rest lying on landmasses no nation can reach by land. `World.validate()` is clean throughout.
- **A bug found by an invariant test:** on a province graph (unlike the old tile grid) a nation offers each neighbour once, so when the nation that had replaced another's offer on a province filled up, the province was freed and the first nation never saw it again. A freed province is now re-offered from the cheapest neighbour held by a nation with room.
- `growTerritories` works on provinces now; the tile-level version and `Nation.getBorderProvinces` are gone.

- **Cross-engine:** Node 22, Chromium 157 and QuickJS (WASM, not V8) reproduce all 27 pinned values (the ten goldens, the depletion golden, each with a save round-trip, and a world saved in the middle of its growth that goes on exactly like the original), and the full 2000 x 2000 world for seed 1337 after 3,000 ticks hashes to `7641ec2a09f9110eb62ffa6d586f2aac` on Node and Chromium (2,140 provinces, 501 claims).

## Limits (honest)

- **Creation and load are slower** (about +1.6 s of province work each, against a +1 s budget I set myself). The cut is a tile-level search; a cell-level search with refinement at the borders would be faster, and so would saving the cut (a few MB), which would trade away the guarantee that a file cannot disagree with its own terrain. Neither is needed yet.
- **The numbers are provisional.** `expansion.rate`, `costPerTile`, the value weights and the province spacing are a first design tuned with a probe; no economy exists to say what a nation should be able to hold. The pace (a year of growth in 3.65 s at 100 days a second) is a taste choice.
- **Nations never fight**, so "stable" means "everything reachable is claimed"; war (phase 6) will make borders move again. Landmasses without a nation stay free: nothing crosses water yet.
- **Borders are pulled toward barriers, not drawn on them.** Provinces are about the same size everywhere, so a border can only slide by up to half a province toward costly ground. Against the same seeds cut by plain distance (a control), borders sit on 1.07 to 1.13 times the cost of the average land tile (control 1.00 to 1.03), a river is 1.4 to 1.6 times as common beside a border as on land (control 1.0 to 1.06), steep ground 1.1 to 1.3 times (control 0.94 to 1.08); mountain biomes are not enriched at all (0.9 to 1.0 times). Coasts are borders by construction (the sea is no province). A mountain range is therefore as likely to hold a province's middle as its edge. Seeding more densely along barriers, or giving rivers a much higher cost, would pull harder but at the price of uneven provinces; that is a design choice for later. The guard tests the pull against the control, not an absolute number.
- **A big nation snowballs a little** (it feeds more people, so it expands faster), checked only by the price scaling with area; the largest nation of the probe holds 261 provinces and the smallest 43.
- **The political overlay is rebuilt whole**, 16 MB at most every 250 ms while that view is on screen. Partial texture updates are the next step if that becomes the bottleneck on real hardware; the e2e runs in software GL and says nothing about frame rate.
- Expansion points saved up for a province whose neighbours are taken first are kept; a nation never loses points to a rival's claim.

## Guards

`tests/provinces.test.ts`, `tests/province-profile.test.ts`, `tests/territory.test.ts`, `tests/claimable.test.ts`, `tests/expansion.test.ts`, `tests/world-provinces.test.ts`, `tests/world-expansion.test.ts` and `tests/world-stocks.test.ts` (drawn worlds and small generated ones, mutation checked); `tests/determinism/provinces-expansion.test.ts` (1000 x 1000 worlds: provinces connected, sized sensibly and with borders pulled toward costly ground against a control; the nations settle and then nothing changes; a replay, and a save in the middle, give the same hash); two golden entries pin a world still growing and one whose borders have settled, cross-checked on Node, Chromium and QuickJS. `pnpm probe -- tests/probe/phase3-world.probe.ts` is the full measurement (province count and sizes, creation time, growth over time, saturation). The app is covered by `tickRunner`, `Pacer`, `SimulationHost` and store tests and by `pnpm --filter @sovereign/web e2e:time` (play, pause, speeds and keys on desktop; growth and settling in the nation panel; the phone layout).
