# 0005: Place resources by geology and ecology, in two slots with stocks

Status: **Accepted** (approved by the project owner)

## Problem

Resources read as noise. The generator (`terrain/resources.ts`) gave every land tile at most one resource, and mostly it was a recolour of the biome: every forest tile was timber, every grassland tile fertile soil, each at a density from a fixed-frequency noise that related to nothing. Iron and gold were one noise threshold over the mountain biomes, with no ridges, basins or rivers behind them. There was no coal, oil, copper or any luxury; fish existed only on land tiles beside water, never at sea; there were no quantities, so nothing could be drawn down, owned or traded. About 64% of land carried a resource, so a resource meant nothing. Baseline over 10 worlds of 2000 x 2000: timber 23.3% of land, fertile 17.2%, stone 13.6%, fur 7.0%, iron 2.7%, fish 0.89%, gold 0.055%; clustering (the share of a resource's four neighbours that hold the same resource) 0.97, 0.96, 0.97, 0.96, 0.945 for the land resources and 0.29 for fish.

The economy (roadmap phase 4) and the province graph (phase 3) need resources that are located, finite or renewable, and different from place to place.

## Decision

- **Several resources per tile, in two slots.** A tile has a **surface** slot (land: a forest, crop, herd or luxury; water: a fishery) and a **ground** slot (a mineral, and oil and salt, which may also lie under shallow sea). Each slot has a `type`, a `richness` (1 to 255, the deposit's size, never changes) and a `stock` (what is left). Two slots give "several per tile" without one layer per resource.
- **A catalogue of 22 resources, as data.** Timber, grain, pasture, horses, fur and game, cotton, spices, wine, tea, ivory; stone, iron, copper, coal, oil, gold, silver, salt, gems; fish, pearls, whales. The static facts (id, layer, domain, tier, colour, unit) are `RESOURCE_CATALOG` in `@sovereign/contracts`; the first seven ids are unchanged.
- **Placement is rules plus rank, not noise.** Each resource has a rule in `@sovereign/config`: hard gates (biomes, ranges of elevation, temperature, humidity, distance to the coast), soft preferences (ridge, basin, slope, height, river, coast, wet, warm) and a regional factor (smooth noise from a new `geology` stream that makes whole regions rich or barren). Every tile that passes the gates is scored, and the top `share` of the land (or water) by rank gets the resource: abundance is exact on every seed (the idea of ADR 0004), and since scores are smooth the resource forms patches and veins. Rarest resources claim tiles first. Richness comes from rank, so a patch is richest in its core.
- **Natural scarcity, with a start that prefers plenty.** Geology and ecology decide who is rich: whole landmasses can lack coal, oil or a luxury. The nation spawner scores each start by the food (grain, pasture, fish), timber and stone within about 12 tiles, worth up to half a biome, so nobody picks bare ground while better ground is left. It is a preference, not a guarantee.
- **Depletion.** `World.extractResource(layer, tile, amount)` takes stock and returns what was actually taken. Renewable resources (the surface ones) regrow from `World.step()`, with integer arithmetic and no randomness, by the `regrowth` table (`units` every `period` ticks up to the richness); minerals do not. Only drawn-down tiles are tracked, so a step costs nothing when nothing has been taken. Nothing calls `extractResource` yet.
- **Feature fields** the rules need are pure functions of the terrain (`terrain/features.ts`): distance to the coast, a river or the land; slope; topographic position (a ridge is high against the land around it, a basin low).

## Alternatives considered

- **One slot per tile with a better recolour.** Rejected: it keeps "a tile is its biome" and cannot express coal under a forest or gold in a river bed.
- **One layer per resource (22 layers).** Rejected: memory and save size by 22 for something sparse; two slots hold everything the rules can place.
- **Tune the noise thresholds.** Rejected for the reason in ADR 0004: it cannot give exact abundance or any geology.
- **Static resources only.** The owner chose natural scarcity plus depletion, and stocks cost almost nothing to add now but are hard to add after an economy exists.

## Consequences

- **Every world, save, hash and golden changes** (pre-1.0). `HASH_SCHEMA_VERSION` is 2 (the six resource arrays are hashed, stock included), `SAVE_FORMAT_VERSION` is 3 (thirteen tile layers), the web database is version 4 and drops older saves, and the `ore` and `resourceDensity` random streams are replaced by `geology`. The goldens were regenerated in their own commit.
- **Memory and save size grow** by 4 bytes per tile: a 2000 x 2000 world is about 88 MB (it was about 72 MB), and so is its save. Creation time was 5.8 s and is about 6.5 s (placement costs about 1.2 s; it samples the regional noise only for tiles that pass a rule's gates and walks only land or sea tiles, which cut it from 3.7 s).
- **Measured over 10 worlds of 2000 x 2000:** all 22 resources are present in every world; every share is exact (timber 16.9% of land, grain 13.0, pasture 8.0, stone 7.0, iron 3.0, coal 3.0, copper 1.4, gold 0.25 and so on); clustering is 0.90 to 0.97 for most resources (0.86 to 0.90 for the rarest, whose small patches have a lot of edge) and fish rose from 0.29 to 0.97. Geology holds: 100% of iron, copper, silver and gems and 99% of gold sit on ridges (gold also 96% near a river), coal and oil sit 100% in basins, oil never in the highland, whales mostly in deep ocean, salt in deserts and shallow sea. Landmasses really differ: of the 3.2 landmasses of at least 20 000 tiles in an average world, 1.4 have no stone, 1.1 no salt, 1.0 no ivory and 0.9 no gems, while timber, iron, copper, coal and oil are on every one (fisheries are at sea, so they are not counted per landmass).
- **The ridge and slope scales had to be fitted to the terrain.** The first guesses (ridge scale 0.04, slope scale 0.02) were 5 and 2 times too big, so ridge and basin preferences did almost nothing; they are now a 16-tile window with a full ridge at 0.015 and a steep slope at 0.006, measured on real worlds.
- **An offshore deposit uses only its own gates.** The first version applied a land rule's elevation limits to the sea and placed no offshore oil at all; an offshore deposit now has its own coast distance and optional depth range.

## Limits (honest)

- **The numbers are provisional.** No economy exists yet to say how much of what a nation needs, so shares, richness scale, stock units and regrowth rates are a starting design. About half of all land (the surface slot's 51% across timber, grain, pasture, fur and the luxuries) holds a resource; those basic resources are broad ecology, and the shares are config values that are easy to cut.
- **The stock arrays are copied to the app once**, at world creation; a future economy that draws stocks down will need to send changes to the UI.
- The regional noise is smooth and coarse on purpose; it makes scarcity geographic, not realistic geology.

## Guards

`tests/determinism/resource-coverage.test.ts` (three 1000 x 1000 worlds, in CI on Linux and Windows) fails if a resource disappears, a share leaves its band, a resource leaves its domain, metals leave the ridges or oil and coal leave the basins, or a resource stops forming patches. `pnpm probe -- tests/probe/resource-quality.probe.ts` is the full measurement (shares, clustering, landmass scarcity, geology by biome, ridge, river and coast). The placement engine, the stocks and the nation access grid are unit tested with synthetic worlds and mutation checked.
