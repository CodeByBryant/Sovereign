import type { SpawnInput } from '../../src/nations/NationSpawner'
import type { World } from '../../src/world/World'

/** The input `World.create` gave the spawner, rebuilt from a world, so a test can spawn again with changes. */
export function spawnInputOf(world: World, over: Partial<SpawnInput> = {}): SpawnInput {
  const t = world.terrain
  return {
    width: t.width,
    height: t.height,
    seaLevel: t.seaLevel,
    elevation: t.elevation,
    biomeIds: t.biomeIds,
    riverMask: t.riverMask,
    riverWidth: t.riverWidth,
    resources: t.resources,
    strategicPoints: t.strategicPoints,
    hubs: t.hubs,
    routes: t.routes,
    routeConfig: world.config.routes,
    highlandElevation: world.config.biomes.highlandElevation,
    slopeScale: world.config.resources.features.slopeScale,
    count: world.config.nations.count,
    seed: world.seed,
    minSpacing: world.config.nations.minSpacing,
    startArea: world.config.nations.startArea,
    ...over
  }
}
