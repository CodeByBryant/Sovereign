# WorldBox, as its community wiki states it

Notes for the units-and-living-world work ([ADR 0008](../decisions/0008-units-and-a-living-world.md), [ADR 0009](../decisions/0009-nodes-and-gathering.md)). Source: an export of the Official WorldBox Wiki on Fandom (pages named below), supplied by the project owner, plus the game's changelog. The wiki is community-written and partly reverse-engineered from the game's code; treat numbers as "what WorldBox does", not a spec. Nothing here is copied code or art; it is design reference.

## Scale

- Default map sizes (Map Creation): tiny 128 x 128, small 192, standard 256, large 320, huge 384, gigantic 448, titanic 512, iceberg 576 (PC). A "zone" is **8 x 8 tiles**; a "chunk" is 16 x 16. Our default world is 1000 x 1000: about 15 times a standard map. Things that read well at WorldBox's scale (a village is 3 x 3 zones, 24 x 24 tiles) are tiny dots at ours.
- World generation (Map Creation) is layered Perlin noise for height (main, details, bonus; "details" is a quarter and "bonus" a tenth of the scale), then template shapes, then **Random Biomes**, **Spawn Vegetation** and **Spawn Resources** as the last bonus stages. The wiki gives no densities.

## Trees, plants, resources

- Trees, plants, fruit bushes, mineral ores, volcanoes and spawners are all "buildings": static objects on tiles (Category:Buildings). Every biome has its own trees. Wasteland soil cannot hold trees.
- **A tree is one chop** (Wood): every tree gives 5 wood, takes no damage while chopped ("it only shakes, then falls all at once"). So a forest visibly thins as it is cut. Trees come back from seeds (changelog: vegetation spreads seeds; a world law can switch it off) or tree fertilizer.
- Food comes from plants as small amounts (Food): a mushroom, herb or flower is 1 unit, a berry or fruit tree gives 1 to 3 of its fruit besides wood. Animals do not use the city food system: carnivores hunt, herbivores eat plants.
- **Gold does not spawn in the world**; it appears from mines built by a village, and minerals spawn around a mine depending on the biome (Economy, Category:Buildings). Stone, common metals and gems occur in biomes.
- Crops (Jobs, changelog): a windmill marks the centre of a farm; the soil around it becomes field tiles; crops go through 4 stages (about 1 in 16 rolls ripens), farmers fertilise (5 fertilizer, 1 coin) to skip the rolls.

## Villages

- A village starts from a **3 x 3 block of zones** (Villages). Borders grow one zone at a time when a leader or king runs the "claim_land" task (more stewardship, more often); a village will not claim water, lava, mountains, or land its species is not adapted to.
- **Build order** for the four classic civilisations (Villages): bonfire (free) first, then a stockpile (free), a town hall, houses and tents (all need the bonfire), then windmill, dock, well, watch tower, mine, barracks, temple, statue, library, market. Max houses equals the number of zones (+3 for a well or bonfire, +2 for a town hall or temple in the Buildings page). A house pays its cost **when its site is placed**, not at completion; builders (max 3 a village) then carry the work out.
- Costs (Buildings): tent 1 wood; house tier 1 = 5 wood, tier 2 = 4 wood, tier 3 = 5 stone, tier 4 = 10 stone, tier 5 = 15 stone, tier 6 = 20 stone + 10 gold + 2 metals; town hall tier 1 = 10 wood + 5 stone; windmill tier 1 = 5 wood + 5 gold; dock tier 1 = 10 wood; mine = 15 gold.
- **Roads** (Roads): 1 x 1 tiles built by a road builder (humans and dwarves) once the culture knows roads. Whenever a new building is planned, the village joins it to its **two closest buildings**. Units move 50% faster on them but do not steer towards them. Roads remember the terrain tile underneath.
- New villages: settlers (6 to 12 units plus up to 6 relatives) leave a village with at least 30 adults that is old or big enough, if a kingdom has a capital and free zones (on the same island, else by boat). Over the village limit, loyalty drops (rebellion).

## Jobs (how many hands, and why)

Jobs are assigned by what the village is short of (Jobs). Woodcutter: 1 if the village holds more than 15 wood, else 3. Bush, herb and honey gatherers: 1 if food over 100, 4 over 60, 5 over 40, 7 over 20, else 10. Hunter 1 (only prey at least 3 years old), builder 3, cleaner 1, road builder 1, farmer and miner no limit. Warriors up to a third of adults. A job is dropped if the unit wants to reproduce.

## Economy

Gold is the only currency resource (max 999). Villages in a kingdom share surplus: a village gives when it holds more than 30 of a resource (100 wheat, 600 gold) to one that holds less than 10 (20 wheat), 10 at a time, on a timer of about 6 months. Units earn "loot" for building, claiming zones and hauling.

## Yields are small (Category:Resources)

Every gatherable is a small object worth a few units: tree 5 wood; stone deposit 3 stone; common metal ore 2 metal + 1 stone; gem ore 1 gem + 1 stone; silver 1 + 1 stone; gold ore (from a mine only) 20 gold + 20 stone; berry bush 3 berries; herbs, flowers, mushrooms and desert berries 1; a wheat tile 1 wheat; a beehive 10 honey; an ocean tile 1 fish (the water itself is the source, there is no fish object). Villages store these as counters, and share them in tens (give above 30, take below 10).

## Tiles carry the ground look (Tiles, Category:Biomes)

- 185 tiles, 71 unique before variants. Each biome has a **high** and a **low** ground tile (a slightly different shade) and **three art variants** of each, picked automatically "to add more diversity to your worldscape". That is where the textured grass comes from: a per-tile variant, not a noise overlay. Tiles also carry a burn chance, a walking-speed effect and a nutrition value (animals graze the tile).
- 23 biomes plus special ones (sand, hill). Biomes spread into each other: each has a grow strength (5 or 6) and a ~5% chance to take over a neighbour of equal strength; ages speed up the dominant biomes. World generation gives each biome a "pot amount" (grass 8, jungle 6, savanna and maple 5, ...) deciding how much of the map it gets.
- Size classes (Creature Size): chicken and rabbit 6, cat 7, fox 8, dog 10, sheep 11, wolf 12, human 13, cow 14, bear 15, buffalo 16, dragon 17; the same sprite grid is used for all, drawn larger for bigger classes.

## What this says about our design

1. Our deposits hold up to 255 units and a villager takes about 8 a trip; WorldBox's are mostly **single-trip objects** (a tree is 5 wood). Small stocks make a forest visibly thin out and regrow, which is what makes the world read as alive.
2. Jobs follow **need** (low wood, more woodcutters), not a uniform random pick of a kind.
3. A village is a small, spaced set of buildings joined by short roads, with a bonfire and a stockpile first; houses are paid for at placement.
4. Borders are claimed in blocks (8 x 8) by what the village does, not bought with points.
5. Trees, plants and animals live: seeds spread, plants are eaten, animals hunt and breed.
6. The ground should be drawn from a few tile variants per biome (with a high and a low shade), chosen by a hash of the tile, so a meadow looks like one without an overlay.
7. Yields should be a handful of units per object: timber 5, stone 3, metals 2, gems 1, berries 3, with a stock of one to a few yields. (Done: `maxRichness` and the gather table, see ADR 0009.)
