# 0008: Units, resource nodes as entities, and a world that lives

Status: **Accepted** (the owner asked for it: "actually make units like WorldBox rather than having math do it", with resources as units rather than numbers; the numbers below are the M0 probes)

## Problem

ADR 0007 made the world tick, but nations grow by an abstract points-and-claims system over provinces: a nation earns points and "buys" a province, every tile of it changing hands at once. Nobody walks anywhere, nothing is gathered or built, and a resource is a number in a tile slot. It is a spreadsheet, not a world you can watch. The goal is a WorldBox-style simulation: visible units who walk, settle, gather, carry, build and spread, with territory and nations coming from what they do.

## Decision

**Units are entities, simulated individually.**

- An `EntityStore` of struct-of-arrays rows (kind, tile, state, target, home, carried type and count, a wake tick, ...), deterministic ids, iteration strictly by id, named random streams only. Tier 1 is fully simulated (settler parties, villagers, later soldiers and notables): a budget of about **10,000, hard cap 30,000**. Tier 2 is a cosmetic crowd drawn near the camera from village state; it never feeds back into the simulation, so what the camera sees cannot touch the state hash.
- **Event-driven, not swept.** A unit acts when its timer fires (it arrives, finishes work, gets hungry); it sleeps in a timer wheel in between. Its position is worked out on demand from its route and start tick, which is all a renderer needs for the units on screen.
- **Routes are shared.** A route between two cells is computed once, stored forward and reversed, and reused by everyone who walks it; it is dropped when a building or road changes the ground. Workers revisit the same places, so the hit rate is high.
- **Time.** One tick stays one in-game day. Travel time is the cost of the route over the cost grid divided by a walking speed (a few tiles a day on easy ground), not tiles per tick. Speed is a request: the worker runs as many ticks as it can (`Pacer` already drops a backlog), so a heavy world slows down instead of freezing the page.

**Resource nodes are entities, stored as passive rows.**

- The geology placement (ADR 0005: 22 resources, richness, regional scarcity) stays as the generator. At creation it emits **node rows** (tree, grain, pasture, horses, ore, gems, fish, salt, oil, ...) into the same store: kind, tile, amount, richness, growth stage, age. A node costs nothing per tick; it changes on events (a harvest, a regrowth timer, fire, a seed spreading), the pending-list pattern `ResourceStocks` already uses. Node ids follow tile order, so a tile finds its node by binary search with no extra map.
- The tile slot arrays become **derived read-only views** (rebuilt for the overlay, inspector and legend), so nothing is stored twice.
- What becomes units: **animals** (moving, breeding, hunted), **gatherers** who walk to a node and take from it (replacing `World.extractResource`, which nothing calls), **carried stacks** (a type and a count on the unit) and **stockpiles** in buildings (22 counters each) that must be hauled to and from. Stock numbers are now consequences of what units do; a nation's profile and stats are measured from its stockpiles, population and buildings instead of being inputs.

**Territory comes from buildings.** A hall or house claims the tiles around it; a contested tile goes to the nearest, strongest claimant by a fixed total order. Ownership stays one byte per tile, now written by claims that grow and shrink as buildings are built or lost. **Provinces leave the engine path** (ADR 0007's layer and `ExpansionSystem` go when claims replace them), which gives back about 1.6 s of creation and 1.3 s of load; regions for war or AI can be derived from ownership on demand. Roads emerge from walking (a per-tile trample count crossing thresholds), seeded along the existing route network.

**Drawn as sprites.** PixiJS sprite layers for units, resource objects (drawn from the node rows: a tree becomes a stump as it is felled and grows back), and buildings and roads, culled to the viewport and gated by zoom (sprites when zoomed in, the existing overlays when out). A procedural pixel-art set covers all 22 resources, units, houses, halls and road tiles, so nothing waits on assets and any art can replace it later behind the same sheet interface.

**Stages**, each ending visibly alive or measurably true, each its own PR with goldens regenerated in their own commit: M1 entities and a world you can see; M2 the gather loop; M3 settle and build; M4 live (hunger, births, hunting); M5 spread (new villages, nations, secession, colonisation by sea); M6 crowds and god powers.

## What the M0 probes measured (2000 x 2000, seed 1337, Node 22, one machine)

`tests/probe/units.probe.ts`: a gatherer loop (idle, pick a spot, A* over the 4-tile cost grid, walk, work, walk home, deposit) for N units, 189 villages, work spots within 10 cells, 1 tile per tick.

| Units  | A* per leg, no sharing   | Shared routes               |
| ------ | ------------------------ | --------------------------- |
| 2,000  | 3.0 ms/tick (336 /s)     | 0.5 ms/tick                 |
| 10,000 | 13 to 16 ms/tick (63 /s) | 0.7 ms/tick (1,400 ticks/s) |
| 30,000 | 42 to 47 ms/tick (21 /s) | 1.2 ms/tick (826 ticks/s)   |

- **Movement is almost free; pathfinding is the whole cost.** Stepping every walker every tick and sleeping them in a timer wheel cost the same (the work is the searches, about 48 microseconds each over about 250 expansions). Cost scales with legs per second, not with ticks, so route sharing is what makes thousands of units affordable: 30,000 units are 35 times cheaper.
- Working out where 3,000 visible units are, from their routes, costs about 0.2 to 0.9 ms a frame.
- Walking faster (more tiles per tick) means more legs per tick: at 4 tiles a tick the shared-route figures are about 4 times higher, so 10,000 units cost about 1.2 ms a tick (800 ticks a second) and the UI's top speed is a request the world may not meet.

`tests/probe/nodes.probe.ts`: the two resource slots as rows.

- **960,000 rows, not 2M** (24% of tiles): 9.6 MB of columns, built in 23 ms.
- A spatial index (grid of 8-tile cells, kind by cell) builds in 30 ms and takes 9.6 MB. "Nearest tree" takes 26 microseconds; a mid-rarity kind (horses, 25,500 nodes) 370 microseconds and a rare one (gold, 2,550) 150 microseconds, which a coarser level of the grid would cut if it matters.
- Hashing the rows takes 94 ms (the six tile layers take 188 ms); the save shrinks from 24 MB of layers to 9.6 MB of rows. The 32 MB of tile to id maps the probe used are unnecessary (binary search over the tile-ordered rows).

So nodes as entities is confirmed and the tile-data fallback in the plan is not needed.

## Alternatives considered

- **Keep expansion as a system and add units on top as decoration.** Rejected: the owner asked for the behaviour, not the picture; a settler who walks but whose claim is bought by points is a lie.
- **Resource nodes as tile data (the ADR 0005 arrays) with units targeting tiles.** Viable (and the fallback), but it keeps a second source of truth and no lifecycle (trees that age and seed, farms that are planted, fire). The probe says rows cost less memory, hash time and save size than the layers, so there is no price to pay for the cleaner model.
- **Every node a JavaScript object.** Rejected: about a million objects would cost far more memory and hash time than typed columns.
- _*Every unit recomputes its route (plain A*)._* Rejected by the probe: 42 ms a tick at 30,000 units.
- **Unit ticks of an hour.** Rejected: it multiplies the ticks the world must run for a given date, and the probe says events, not ticks, are what cost.

## Consequences

- Every world, save, hash and golden changes again (pre-1.0) at the stage that introduces the store (hash 5, save 6). This ADR itself changes no engine behaviour; it adds `MinHeap.clear()` (a heap can serve many searches) and the two probes.
- `ExpansionSystem`, provinces as owners, the profile sums and "Borders settled" are removed when claims from buildings replace them (M3). Until then ADR 0007 stands.
- Colonisation, unrest and secession, and population pressure (all wanted by the owner) arrive as behaviours of units in M5; until then the world still freezes once nothing free is reachable, which is honest about where the build is.

## Limits (honest)

- **The probe is not the game.** It measures walking and searching only. Hunger, building, births, hunting, claiming and the sprites will each cost something, and balance (does a village thrive, starve, expand?) will take far more effort than code.
- **Route sharing assumes revisits.** A world where every worker wants a new place each trip, or where the ground changes every day (roads, buildings), reduces the hit rate; invalidation has to be cheap and local.
- **Speed is bounded.** About 10,000 units at a thousand days a second is not sustainable; the world will run slower than requested at the top setting.
- **Art is real work.** 22 resources in a few states, units, buildings and roads; the procedural set is a start, not the finish.
- **Rendering at scale is unmeasured.** Thousands of sprites need batching and culling, and software-GL e2e cannot judge frame rate; a real-hardware check is needed.

## Guards

M0 adds `tests/heap.test.ts` (`clear()`) and the two probes (`pnpm probe -- tests/probe/units.probe.ts`, `pnpm probe -- tests/probe/nodes.probe.ts`). Each later stage adds its own determinism guard (a replay and a save in the middle give the same hash), cross-engine check and Playwright e2e.
