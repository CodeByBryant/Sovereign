# 0009: Resource nodes as rows, and villagers who gather

Status: **Accepted** (milestone M2 of [ADR 0008](0008-units-and-a-living-world.md); the owner chose to do the node-store migration and the gather loop together, stockpiles on hall rows, and every land resource plus fish gatherable)

## Problem

After M1 villagers could walk and be seen, but nothing they did mattered: resources were numbers in six tile layers, nobody took anything from them, and nothing was kept anywhere. ADR 0008 decided resource nodes should be entities and that stock should be a consequence of what units do. M2 builds that: a villager walks to a deposit, works it, carries what it took home and drops it in a stockpile, and you can watch the deposit shrink and regrow.

## Decision

**Deposits are rows in their own store, not in the villager store.** `NodeStore` holds `kind`, `tile`, `stock` and `richness` (7 bytes a node, about 960,000 nodes on a 2000 x 2000 map, 6.7 MB) in tile order, a tile's surface node before its ground node, so a tile finds its node by binary search. A felled tree is not removed: it is a node at stock 0, so ids never change. The villager `EntityStore` was the wrong place: it reuses the lowest free id (so a despawned node would shift ids), every unit loop would walk a million rows, its columns ride the save as JSON, and its hash writes four bytes per value.

**The tile slot arrays are write-through views.** `NodeStore.setStock` is the one place stock changes, and it writes the same value into the `terrain.resources` arrays the renderer, the inspector and the nation profiles read. They can never disagree, and none of those readers changed. The cost is memory (the arrays are still about 24 MB); dropping them is a later optimisation. `World.validate` checks the views against the nodes.

**Hash 6 and save 7 cover the nodes, not the six layers.** The state hash writes the node columns (kind, stock, richness as byte arrays and the tiles as a new `writeUint32Array`, with Python reference vectors), then the villagers and halls (with four new columns), then each hall's stockpile. The save ends with a binary node block and the resource layers are rebuilt on load. Measured at 2000 x 2000: world creation about 9 s (unchanged), state hash about 0.6 s, save 70.9 MB (the 24 MB of layers are gone, 6.7 MB of nodes added).

**`NodeIndex` finds "the nearest tree".** A grid of 8-tile cells with the nodes of each kind in each cell (a compressed list), searched in rings and stopped as soon as nothing further out could be closer. Nodes never move, so it is built once and never changes; whether a node has stock left is read live. It is derived, so it is rebuilt on load, never saved. Ties go to the lowest node id.

**Halls and stockpiles.** `EntityKind.Hall` rows, one per capital for now, hold nothing themselves; a hall's 22 counters live in `Stockpiles` (saved in the header, hashed hall by hall in id order). A villager's `hall` column is its hall's row id plus one (0 for none).

**The gather cycle** (`UnitSystem`, the old `WanderSystem`). A villager with a hall that has finished resting picks a resource kind by a counter-based draw, tries up to three kinds in catalogue order from there, walks to the nearest deposit of that kind within `units.searchRadius`, works for the rule's ticks, takes `min(rule.amount, carryCapacity, what is left)` through `ResourceStocks`, hauls it home along the cheapest route and drops it in its hall's stockpile. A deposit in the water (fish) is worked from the nearest land tile next to it (lowest row, then lowest column); a deposit with no land beside it cannot be worked. A villager with no hall, or with nothing in reach, wanders as before. New states: `Work` (at deposit `goal`, until `wake`) and `Haul` (a route home carrying `carriedType` x `carriedCount`). `config.units.gather` is a per-resource table (work ticks, units a trip); a resource not in it is not gathered (pearls, whales and oil are out for now).

**The page keeps up by deltas.** `World.drainStockChanges()` lists the deposits whose stock changed since the host last heard (a deduplicated list kept by `NodeStore`). `ticked` carries it, `applyStockChanges` writes it into the app's copy of the slot arrays, and the sprite layers, the inspector and the overlay all read that copy. The 16 MB resource overlay is only redrawn when it is on screen, and at most every 400 ms.

## Consequences

- **Every world, save, hash and golden changes again** (pre-1.0): hash 6, save 7, web database 8, goldens regenerated in their own commit. All 22 golden values (and their save round trips) match on Node 22, Chromium 157 and QuickJS.
- **Gathering moves nation stats.** A nation's profile and stats are measured from the stocks of the land it holds, so as villagers draw deposits down and they grow back, stats go on changing even after borders have settled. The determinism guard that said "no stat changes after the borders settle" now only says borders and claims hold still. Stats will be measured from stockpiles and population instead in M4.
- **Villagers can find the world empty.** Nothing stops a hall's villagers from stripping every deposit in reach; renewable ones grow back on the existing table, ground ones do not.

## Limits (honest)

- **Balance is not tuned.** Work times, amounts and the carrying limit are provisional numbers, and nobody eats what is stored: stockpiles only grow (M4 gives them a purpose).
- **Nothing is built from what is gathered.** Halls are placed by the old capital system; building comes in M3.
- **Hall stockpiles have no UI yet.** The proof is in the tests and on screen (villagers carrying goods, deposits drawn down), not in a number the player can read.
- **A villager hops to the work tile.** It walks to the deposit's cell and then stands on the work tile, which can be up to a cell's width away.
- **The slot arrays are still stored** (see above), so memory has not dropped.
- **Software-GL e2e cannot judge frame rate.**

## Guards

`tests/node-store.test.ts`, `node-index.test.ts` (including a brute-force comparison), `stockpiles.test.ts`, `gather.test.ts` (every step of the cycle, the edges, conservation, rebuild mid-cycle), `world-nodes.test.ts`, `world-halls.test.ts`, `world-gather.test.ts` (nothing is made or lost, mid-gather save and restore give the same hash, villagers are seen in all four states), the regenerated goldens with a longer gathering entry, and `pnpm --filter @sovereign/web e2e:gather`.
