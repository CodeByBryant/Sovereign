import type { SpawnInput } from '../../src/nations/NationSpawner'
import type { World } from '../../src/world/World'

/** The input `World.create` gave the spawner, rebuilt from a world, so a test can spawn again with changes. */
export function spawnInputOf(world: World, over: Partial<SpawnInput> = {}): SpawnInput {
  const t = world.terrain
  return {
    width: t.width,
    biomeIds: t.biomeIds,
    hubs: t.hubs,
    routes: t.routes,
    provinces: { map: world.provinces, facts: world.provinceFacts },
    count: world.config.nations.count,
    seed: world.seed,
    minSpacing: world.config.nations.minSpacing,
    startArea: world.config.nations.startArea,
    ...over
  }
}
